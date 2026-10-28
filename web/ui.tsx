import { keywordEntry } from "./form-state";
import { useActivity } from "./interaction";
import {
  cloneElement,
  createContext,
  useContext,
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type KeyboardEvent,
  type FocusEventHandler,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AlertCircle, Check, ChevronDown, LoaderCircle, Info, X } from "lucide-react";

const LayerContext = createContext<HTMLElement | null>(null);
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  drawer = false,
  wide = false,
  busy = false,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  drawer?: boolean;
  wide?: boolean;
  busy?: boolean;
  returnFocus?: () => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const descriptionId = useId();
  const modalContent = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    modalContent.current = node;
    setContainer(node);
  }, []);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          ref={attach}
          className={drawer ? "dialog drawer" : wide ? "dialog dialog-wide" : "dialog"}
          aria-describedby={description ? descriptionId : undefined}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus) {
              event.preventDefault();
              returnFocus();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            modalContent.current?.focus({ preventScroll: true });
          }}
        >
          <LayerContext.Provider value={container}>
            <div className="dialog-heading">
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close className="icon-button ghost" aria-label="Close" disabled={busy}>
                <X />
              </Dialog.Close>
            </div>
            {description && (
              <Dialog.Description id={descriptionId}>{description}</Dialog.Description>
            )}
            {children}
          </LayerContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
interface Confirmation {
  title: string;
  description: string;
  action: string;
  destructive?: boolean;
  emoji?: string;
  details?: { label: string; value: string }[];
  resolve: (accepted: boolean) => void;
}
type ConfirmAction = (spec: Omit<Confirmation, "resolve">) => Promise<boolean>;
const ConfirmationContext = createContext<ConfirmAction | null>(null);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Confirmation | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = useRef<Confirmation | null>(null);
  const close = useCallback((accepted: boolean) => {
    const confirmation = pending.current;
    if (!confirmation) return;
    pending.current = null;
    setCurrent(null);
    confirmation.resolve(accepted);
  }, []);
  const request = useCallback((spec: Omit<Confirmation, "resolve">) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...spec, resolve };
      pending.current = next;
      setCurrent(next);
    });
  }, []);
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    [],
  );
  return (
    <ConfirmationContext.Provider value={request}>
      {children}
      <Dialog.Root
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="scrim" />
          <Dialog.Content
            className="dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancel.current?.focus();
            }}
          >
            <Dialog.Title className="confirmation-heading">
              <Emoji>{current?.emoji ?? (current?.destructive ? "🗑️" : "💬")}</Emoji>
              {current?.title}
            </Dialog.Title>
            <Dialog.Description>{current?.description}</Dialog.Description>
            {current?.details?.length ? (
              <dl className="confirmation-details">
                {current.details.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="dialog-actions">
              <button type="button" ref={cancel} onClick={() => close(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={current?.destructive ? "destructive" : "primary"}
                onClick={() => close(true)}
              >
                {current?.action}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmationContext.Provider>
  );
}
export function useConfirm() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error("ConfirmationProvider is required.");
  return confirm;
}
export function Alert({
  children,
  onRetry,
  retrying = false,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="alert" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying}>
          <PendingLabel pending={retrying} idle="Try again" busy="Retrying…" />
        </button>
      )}
    </div>
  );
}
export function Busy({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" />
      {label}
    </div>
  );
}
interface ControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string | undefined;
  "aria-labelledby"?: string;
  onFocus?: FocusEventHandler<HTMLElement>;
}
export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactElement;
}) {
  const container = useContext(LayerContext);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  useEffect(() => {
    if (!error) setCorrectionOpen(false);
  }, [error]);
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <div className="label-row">
        <label id={id + "-label"} htmlFor={id}>
          {label}
        </label>
        <Popover.Root open={correctionOpen} onOpenChange={setCorrectionOpen}>
          <Popover.Trigger
            type="button"
            className="error-trigger icon-button"
            style={{ visibility: error ? "visible" : "hidden" }}
            aria-label={`Show correction for ${label}`}
          >
            <AlertCircle />
          </Popover.Trigger>
          <Popover.Portal {...(container ? { container } : {})}>
            <Popover.Content
              className="popover correction"
              sideOffset={8}
              collisionPadding={16}
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              {error}
              <Popover.Arrow className="popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {cloneElement(children as ReactElement<ControlProps>, {
        id,
        "aria-invalid": Boolean(error),
        "aria-labelledby": id + "-label",
        "aria-describedby": error ? id + "-correction" : undefined,
        onFocus: (event) => {
          if (error) setCorrectionOpen(true);
          (children.props as ControlProps).onFocus?.(event);
        },
      })}
      {error && (
        <span className="sr-only" id={id + "-correction"}>
          {error}
        </span>
      )}
    </div>
  );
}
interface ChoiceProps extends ControlProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; emoji?: string }[];
  label: string;
  disabled?: boolean;
  placeholder?: string;
}
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
  placeholder = "Choose",
  ...attributes
}: ChoiceProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const selectedText = selected?.label ?? (value || placeholder);
  const selectedId = useId();
  const content = useRef<HTMLDivElement>(null);
  const container = useContext(LayerContext);
  const typed = useRef({ text: "", time: 0 });
  const direction = useRef<"first" | "last">("first");
  const keyboard = (event: KeyboardEvent) => {
    const buttons = Array.from(
      content.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % buttons.length;
      if (event.key === "ArrowUp")
        next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      buttons[next]?.scrollIntoView({ block: "nearest" });
      buttons[next]?.focus({ preventScroll: true });
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typed.current = {
        text: Date.now() - typed.current.time > 700 ? event.key : typed.current.text + event.key,
        time: Date.now(),
      };
      const option = options.find((item) =>
        item.label.toLowerCase().startsWith(typed.current.text.toLowerCase()),
      );
      if (option) {
        buttons[options.indexOf(option)]?.scrollIntoView({ block: "nearest" });
        buttons[options.indexOf(option)]?.focus({ preventScroll: true });
      }
    }
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) typed.current = { text: "", time: 0 };
        setOpen(value);
      }}
    >
      <Popover.Trigger
        type="button"
        {...attributes}
        disabled={disabled}
        className="choice-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            direction.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
        aria-describedby={[attributes["aria-describedby"], selectedId].filter(Boolean).join(" ")}
        data-empty={!value}
      >
        <span className="choice-value">
          {selected?.emoji && <Emoji>{selected.emoji}</Emoji>}
          <span>{selectedText}</span>
        </span>
        <span id={selectedId} className="sr-only">
          Current value: {selectedText}
        </span>
        <ChevronDown />
      </Popover.Trigger>
      <Popover.Portal {...(container ? { container } : {})}>
        <Popover.Content
          ref={content}
          className="popover options"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            typed.current = { text: "", time: 0 };
            requestAnimationFrame(() => {
              const selected =
                content.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
              const options =
                content.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
              const target =
                selected ??
                (direction.current === "last" ? options?.[options.length - 1] : options?.[0]);
              target?.scrollIntoView({ block: "nearest" });
              target?.focus({ preventScroll: true });
            });
          }}
          onKeyDown={keyboard}
        >
          <div role="listbox" aria-label={label}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={option.value === value ? 0 : -1}
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="choice-value">
                  {option.emoji && <Emoji>{option.emoji}</Emoji>}
                  <span>{option.label}</span>
                </span>
                {option.value === value && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function useDraftWarning(dirty: boolean) {
  useActivity(dirty, "draft");
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

interface ChipInputProps extends ControlProps {
  value: string[];
  onChange: (value: string[]) => void;
  onError: (message: string) => void;
  label: string;
  onEditing: (pending: boolean) => void;
}
export function ChipInput({
  value,
  onChange,
  onError,
  label,
  onEditing,
  ...attributes
}: ChipInputProps) {
  const [entry, setEntry] = useState("");
  const confirm = useConfirm();
  const add = async (text = entry) => {
    const parsed = keywordEntry(value, text);
    if (parsed.error) {
      onError(parsed.error);
      if (attributes.id)
        requestAnimationFrame(() => document.getElementById(attributes.id!)?.focus());
      return;
    }
    const values = parsed.values;
    if (
      !(await confirm({
        title: values.length === 1 ? "Add keyword?" : "Add keywords?",
        emoji: "🏷️",
        description: values.join(", "),
        action: values.length === 1 ? "Add keyword" : "Add keywords",
      }))
    )
      return;
    onChange([...value, ...values]);
    setEntry("");
    onEditing(false);
    if (attributes.id)
      requestAnimationFrame(() => document.getElementById(attributes.id!)?.focus());
    onError("");
  };
  const remove = async (term: string) => {
    if (
      !(await confirm({
        title: "Remove keyword?",
        description: 'Remove "' + term + '"?',
        action: "Remove",
        destructive: true,
      }))
    )
      return;
    onChange(value.filter((item) => item !== term));
    if (attributes.id)
      requestAnimationFrame(() => document.getElementById(attributes.id!)?.focus());
    onError("");
  };
  return (
    <div className="chip-input">
      {value.map((term) => (
        <span className="keyword-chip" key={term}>
          <span>{term}</span>
          <button type="button" aria-label={"Remove " + term} onClick={() => void remove(term)}>
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        {...attributes}
        className="chip-entry"
        placeholder={label === "Job title" ? "Add a title" : "Add a keyword"}
        type="text"
        value={entry}
        aria-label={label}
        autoComplete="off"
        onBlur={() => {
          if (entry.trim()) onError(keywordEntry(value, entry).error);
        }}
        onChange={(event) => {
          setEntry(event.target.value);
          onEditing(Boolean(event.target.value.trim()));
          onError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            void add();
          }
          if (event.key === "Backspace" && !entry && value.length) {
            event.preventDefault();
            void remove(value[value.length - 1]!);
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            event.preventDefault();
            const input = event.currentTarget;
            const merged =
              entry.slice(0, input.selectionStart ?? entry.length) +
              text +
              entry.slice(input.selectionEnd ?? entry.length);
            setEntry(merged);
            onEditing(Boolean(merged.trim()));
            void add(merged);
          }
        }}
      />
      <button
        className="chip-add"
        type="button"
        disabled={Boolean(keywordEntry(value, entry).error)}
        aria-label={"Add " + label.toLowerCase()}
        onClick={() => void add()}
      >
        Add
      </button>
    </div>
  );
}

export function Emoji({ children }: { children: string }) {
  return (
    <span className="emoji" aria-hidden="true">
      {children}
    </span>
  );
}
export function PendingLabel({
  pending,
  idle,
  busy,
}: {
  pending: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <span className="pending-label">
      <span aria-hidden={pending} style={{ visibility: pending ? "hidden" : "visible" }}>
        {idle}
      </span>
      <span aria-hidden={!pending} style={{ visibility: pending ? "visible" : "hidden" }}>
        {busy}
      </span>
    </span>
  );
}
export function ActionHint({ label, children }: { label: string; children: ReactNode }) {
  const container = useContext(LayerContext);
  return (
    <Popover.Root>
      <Popover.Trigger type="button" className="icon-button ghost" aria-label={label}>
        <Info aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal {...(container ? { container } : {})}>
        <Popover.Content className="popover correction" sideOffset={8} collisionPadding={16}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

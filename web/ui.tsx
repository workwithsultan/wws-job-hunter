import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AlertCircle, Check, ChevronDown, LoaderCircle, X } from "lucide-react";

const LayerContext = createContext<HTMLElement | null>(null);
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  drawer = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  drawer?: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          ref={setContainer}
          className={drawer ? "dialog drawer" : "dialog"}
          aria-describedby={description ? "dialog-description" : undefined}
        >
          <LayerContext.Provider value={container}>
            <div className="dialog-heading">
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close className="icon-button ghost" aria-label="Close">
                <X />
              </Dialog.Close>
            </div>
            {description && (
              <Dialog.Description id="dialog-description">{description}</Dialog.Description>
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
  resolve: (accepted: boolean) => void;
}
const ConfirmationContext = createContext<
  (spec: Omit<Confirmation, "resolve">) => Promise<boolean>
>(() => Promise.resolve(false));
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Confirmation | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const close = (accepted: boolean) => {
    current?.resolve(accepted);
    setCurrent(null);
  };
  return (
    <ConfirmationContext.Provider
      value={(spec) => new Promise((resolve) => setCurrent({ ...spec, resolve }))}
    >
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
            <Dialog.Title>{current?.title}</Dialog.Title>
            <Dialog.Description>{current?.description}</Dialog.Description>
            <div className="dialog-actions">
              <button ref={cancel} onClick={() => close(false)}>
                Cancel
              </button>
              <button
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
export const useConfirm = () => useContext(ConfirmationContext);
export function Alert({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{children}</span>
      {onRetry && <button onClick={onRetry}>Try again</button>}
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
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        <Popover.Root>
          <Popover.Trigger
            className="error-trigger icon-button"
            style={{ visibility: error ? "visible" : "hidden" }}
            aria-label={`Show correction for ${label}`}
          >
            <AlertCircle />
          </Popover.Trigger>
          <Popover.Portal {...(container ? { container } : {})}>
            <Popover.Content className="popover correction" sideOffset={8} collisionPadding={16}>
              {error}
              <Popover.Arrow className="popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {cloneElement(children as ReactElement<ControlProps>, {
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? id + "-correction" : undefined,
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
  options: { value: string; label: string }[];
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
  const content = useRef<HTMLDivElement>(null);
  const container = useContext(LayerContext);
  const typed = useRef({ text: "", time: 0 });
  const keyboard = (event: KeyboardEvent) => {
    const buttons = Array.from(
      content.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
      if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        {...attributes}
        disabled={disabled}
        className="choice-trigger"
        aria-label={label}
        aria-haspopup="listbox"
      >
        <span>{options.find((option) => option.value === value)?.label ?? placeholder}</span>
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
            requestAnimationFrame(() => {
              const selected =
                content.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
              selected?.scrollIntoView({ block: "nearest" });
              selected?.focus({ preventScroll: true });
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
                {option.label}
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
    const values = text
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!values.length) return;
    if (values.some((item) => item.length > 100 || /["\r]/.test(item))) {
      onError("Use keywords of up to 100 characters, without quotation marks.");
      return;
    }
    if (value.length + values.length > 30) {
      onError("Use no more than 30 keywords.");
      return;
    }
    const seen = new Set(value.map((item) => item.toLowerCase()));
    for (const item of values) {
      if (seen.has(item.toLowerCase())) {
        onError('Already added: "' + item + '".');
        return;
      }
      seen.add(item.toLowerCase());
    }
    if (
      !(await confirm({
        title: values.length === 1 ? "Add keyword?" : "Add keywords?",
        description: values.join(", "),
        action: values.length === 1 ? "Add keyword" : "Add keywords",
      }))
    )
      return;
    onChange([...value, ...values]);
    setEntry("");
    onEditing(false);
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
        disabled={!entry.trim()}
        aria-label={"Add " + label.toLowerCase()}
        onClick={() => void add()}
      >
        Add
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Upload, Check } from "lucide-react";
import { Field, useConfirm, useDraftWarning } from "./ui";
import { readResume, ResumeReadError } from "./pdf-reader";

export function ResumeImport({
  disabled,
  active,
  onReadingChange,
  hasProfile,
  onApply,
}: {
  disabled: boolean;
  active: boolean;
  onReadingChange: (value: boolean) => void;
  hasProfile: boolean;
  onApply: (value: { text: string; name: string; pages: number }) => void;
}) {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active) controller.current?.abort();
  }, [active]);
  useEffect(() => () => controller.current?.abort(), []);
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const confirm = useConfirm();
  useDraftWarning(reading);
  const choose = async (file: File) => {
    if (reading || disabled) return;
    const cancellation = new AbortController();
    controller.current = cancellation;
    setReading(true);
    onReadingChange(true);
    setError("");
    setImported(false);
    try {
      const result = await readResume(file, cancellation.signal);
      cancellation.signal.throwIfAborted();
      const accepted = await confirm({
        title: hasProfile ? "Replace profile text?" : "Use resume text?",
        description: `Use text from ${file.name} (${result.pages} ${result.pages === 1 ? "page" : "pages"})? ${hasProfile ? "This replaces the current profile draft. " : ""}${result.emptyPages.length ? `Pages ${result.emptyPages.join(", ")} have no readable text and may contain scanned content. ` : ""}Review and edit the extracted text before saving. The PDF itself is not stored.`,
        action: "Use resume text",
      });
      if (accepted) {
        onApply({ text: result.text, name: file.name, pages: result.pages });
        setImported(true);
        requestAnimationFrame(() => document.getElementById("review-resume")?.focus());
      }
    } catch (problem) {
      if (cancellation.signal.aborted) return;
      setError(
        problem instanceof ResumeReadError
          ? problem.message
          : "This PDF could not be read. Try another file.",
      );
      requestAnimationFrame(() => document.getElementById("settings-resume")?.focus());
    } finally {
      controller.current = null;
      setReading(false);
      onReadingChange(false);
    }
  };
  return (
    <div className="resume-import" aria-busy={reading}>
      <Field id="settings-resume" label="Resume PDF (required, up to 10 MB)" error={error}>
        <button type="button" disabled={disabled || reading} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          {reading ? "Reading PDF…" : hasProfile ? "Replace resume" : "Upload resume"}
        </button>
      </Field>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        disabled={disabled || reading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      {imported && (
        <span className="saved" role="status">
          <Check aria-hidden="true" />
          Resume text added to draft
        </span>
      )}
    </div>
  );
}

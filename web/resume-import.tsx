import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Eye } from "lucide-react";
import { Field, PendingLabel, ActionHint, Modal, useConfirm, useDraftWarning } from "./ui";
import { readResume } from "./pdf-reader";
import { ResumePreview } from "./resume-preview";
import type { ResumeMetadata } from "../src/shared/resume";

export function ResumeImport({
  disabled,
  active,
  onReadingChange,
  resume,
  available,
  onApply,
}: {
  disabled: boolean;
  active: boolean;
  onReadingChange: (value: boolean) => void;
  resume: ResumeMetadata | null;
  available: boolean;
  onApply: (value: { profile: string; resume: ResumeMetadata; pdf: string }) => Promise<void>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const preview = (element: HTMLButtonElement) => {
    previewTrigger.current = element;
    setPreviewOpen(true);
  };
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active) controller.current?.abort();
  }, [active]);
  useEffect(() => () => controller.current?.abort(), []);
  const input = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  useDraftWarning(reading);
  const choose = async (file: File) => {
    if (reading || disabled) return;
    const cancellation = new AbortController();
    controller.current = cancellation;
    setReading(true);
    onReadingChange(true);
    setError("");
    try {
      const result = await readResume(file, cancellation.signal);
      cancellation.signal.throwIfAborted();
      const accepted = await confirm({
        title: resume ? "Replace resume?" : "Upload resume?",
        emoji: "📄",
        description: `Save ${file.name} (${result.pages} ${result.pages === 1 ? "page" : "pages"}) for job matching? ${resume ? "This replaces your saved resume. " : ""}The PDF stays in your local workspace. Only its extracted text is sent through OpenRouter to your selected model provider during matching.${result.emptyPages.length ? ` Pages ${result.emptyPages.join(", ")} have no readable text.` : ""}`,
        action: resume ? "Replace resume" : "Upload resume",
      });
      if (!accepted) return;
      cancellation.signal.throwIfAborted();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks: string[] = [];
      for (let start = 0; start < bytes.length; start += 32768)
        chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
      await onApply({
        profile: result.text,
        resume: { name: file.name, pages: result.pages },
        pdf: btoa(chunks.join("")),
      });
    } catch (problem) {
      if (cancellation.signal.aborted) return;
      setError(
        problem instanceof Error ? problem.message : "This resume could not be saved. Try again.",
      );
      requestAnimationFrame(() => document.getElementById("settings-resume")?.focus());
    } finally {
      controller.current = null;
      setReading(false);
      onReadingChange(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!replaceButton.current?.closest("[hidden]")) replaceButton.current?.focus();
        }),
      );
    }
  };
  return (
    <div className="resume-import" aria-busy={reading}>
      <Field id="settings-resume" label="Resume PDF (required, up to 10 MB)" error={error}>
        <div className="resume-summary" role="group" tabIndex={-1}>
          <div className="resume-file">
            <FileText aria-hidden="true" />
            <div>
              {resume && available ? (
                <button
                  type="button"
                  className="resume-name ghost"
                  onClick={(event) => preview(event.currentTarget)}
                >
                  {resume.name}
                </button>
              ) : (
                <strong>{resume?.name ?? "Upload your resume"}</strong>
              )}
              <span>
                {resume
                  ? `${resume.pages} ${resume.pages === 1 ? "page" : "pages"}`
                  : "PDF · Up to 20 pages"}
              </span>
            </div>
          </div>
          <div className="resume-actions">
            {resume &&
              (available ? (
                <button type="button" onClick={(event) => preview(event.currentTarget)}>
                  <Eye aria-hidden="true" />
                  Preview
                </button>
              ) : (
                <ActionHint label="Why PDF preview is unavailable">
                  Upload this resume again to enable PDF preview. Your saved matching text is still
                  available.
                </ActionHint>
              ))}
            <button
              type="button"
              ref={replaceButton}
              disabled={disabled || reading}
              onClick={() => input.current?.click()}
            >
              <Upload aria-hidden="true" />
              <PendingLabel
                pending={reading}
                idle={resume ? "Replace" : "Upload PDF"}
                busy="Processing PDF…"
              />
            </button>
          </div>
        </div>
      </Field>
      <Modal
        open={active && previewOpen}
        title={resume?.name ?? "Resume preview"}
        onClose={() => setPreviewOpen(false)}
        returnFocus={() => previewTrigger.current?.focus()}
        wide
      >
        {active && previewOpen && <ResumePreview />}
      </Modal>
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
    </div>
  );
}

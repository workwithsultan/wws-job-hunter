import { useEffect, useState, type FormEvent } from "react";
import type { Workspace } from "../src/shared/model";
import { defaultAssessmentPrompt, assessmentPromptSchema } from "../src/shared/assessment-prompt";
import { api } from "./api";
import { useActivity, useInteractionState } from "./interaction";
import { Alert, PendingLabel, useDraftWarning } from "./ui";

export function PromptSettings({
  workspace,
  reload,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
}) {
  const current = workspace.preferences.assessmentPrompt;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [baseline, setBaseline] = useState(current);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const dirty = editing && draft !== baseline;
  const parsed = assessmentPromptSchema.safeParse(draft);
  const interaction = useInteractionState();
  useDraftWarning(dirty);
  useActivity(busy, "write");
  useEffect(() => {
    if (!editing || !dirty || draft === current) {
      setDraft(current);
      setBaseline(current);
    }
  }, [current, editing, dirty, draft]);
  const locked = workspace.running || busy || interaction.writing;
  const persist = async (value: string) => {
    if (locked) return;
    setBusy(true);
    setFailure("");
    try {
      if (value !== current) {
        await api("/api/preferences/prompt", "PATCH", { assessmentPrompt: value });
        await reload();
      }
      setDraft(value);
      setBaseline(value);
      setEditing(false);
      requestAnimationFrame(() => document.getElementById("edit-assessment-prompt")?.focus());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The prompt could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (editing && dirty && parsed.success) void persist(parsed.data);
  };
  return (
    <form className="prompt-settings" onSubmit={save} noValidate>
      {failure && <Alert>{failure}</Alert>}
      {editing ? (
        <>
          <label htmlFor="assessment-prompt" className="sr-only">
            AI prompt
          </label>
          <textarea
            autoFocus
            id="assessment-prompt"
            rows={18}
            maxLength={8000}
            disabled={locked}
            value={draft}
            aria-invalid={!parsed.success}
            aria-describedby={!parsed.success ? "prompt-error" : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
          {!parsed.success && (
            <p id="prompt-error" className="prompt-error" role="alert">
              {parsed.error.issues[0]?.message}
            </p>
          )}
        </>
      ) : (
        <pre className="prompt-content" aria-label="AI prompt">
          {current}
        </pre>
      )}
      <div className="form-actions">
        {editing ? (
          <>
            <button
              className="primary"
              disabled={locked || !dirty || !parsed.success}
              type="submit"
            >
              <PendingLabel pending={busy} busy="Saving…" idle="Save" />
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setDraft(current);
                setBaseline(current);
                setEditing(false);
                setFailure("");
                requestAnimationFrame(() =>
                  document.getElementById("edit-assessment-prompt")?.focus(),
                );
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            id="edit-assessment-prompt"
            className="primary"
            disabled={locked}
            onClick={() => {
              setDraft(current);
              setBaseline(current);
              setFailure("");
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          disabled={
            locked ||
            (current === defaultAssessmentPrompt && (!editing || draft === defaultAssessmentPrompt))
          }
          onClick={() => void persist(defaultAssessmentPrompt)}
        >
          Reset to default
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import type { Workspace } from "../src/shared/model";
import { defaultAssessmentPrompt, assessmentPromptSchema } from "../src/shared/assessment-prompt";
import { api } from "./api";
import { useActivity, useInteractionState } from "./interaction";
import { Alert, Field, PendingLabel, useConfirm, useDraftWarning } from "./ui";

export function PromptSettings({
  workspace,
  reload,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
}) {
  const current = workspace.preferences.assessmentPrompt;
  const [draft, setDraft] = useState(current);
  const [baseline, setBaseline] = useState(current);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = draft !== baseline;
  const parsed = assessmentPromptSchema.safeParse(draft);
  const interaction = useInteractionState();
  const confirm = useConfirm();
  useDraftWarning(dirty);
  useActivity(busy, "write");
  useEffect(() => {
    if (!dirty || draft === current) {
      setDraft(current);
      setBaseline(current);
    }
  }, [current, dirty, draft]);
  const locked = workspace.running || busy || interaction.writing;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (locked || !dirty || !parsed.success) return;
    if (
      !(await confirm({
        title: "Save AI prompt?",
        description:
          "These instructions will be used for future job assessments. Existing results stay unchanged.",
        action: "Save changes",
        emoji: "💾",
      }))
    )
      return;
    setBusy(true);
    setFailure("");
    try {
      await api("/api/preferences/prompt", "PATCH", { assessmentPrompt: parsed.data });
      await reload();
      setDraft(parsed.data);
      setBaseline(parsed.data);
      setSaved(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The prompt could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="prompt-settings" onSubmit={(event) => void save(event)} noValidate>
      <h2>AI prompt</h2>
      <p className="prompt-description">
        Edit the instructions used to assess job fit. Your resume, search preferences and each job
        posting are added automatically.
      </p>
      {failure && <Alert>{failure}</Alert>}
      <Field
        id="assessment-prompt"
        label="Assessment instructions"
        error={
          !parsed.success ? (parsed.error.issues[0]?.message ?? "Check your prompt.") : undefined
        }
      >
        <textarea
          id="assessment-prompt"
          rows={18}
          maxLength={8000}
          disabled={locked}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
        />
      </Field>
      <p className="prompt-description">
        The response format stays fixed: verdict, score and reason. Save changes to apply edited or
        default instructions.
      </p>
      <div className="form-actions">
        <button className="primary" disabled={locked || !dirty || !parsed.success} type="submit">
          <PendingLabel pending={busy} busy="Saving…" idle="Save changes" />
        </button>
        <button
          type="button"
          disabled={locked || draft === defaultAssessmentPrompt}
          onClick={() => {
            setDraft(defaultAssessmentPrompt);
            setSaved(false);
          }}
        >
          Use default
        </button>
        {dirty && (
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setDraft(current);
              setBaseline(current);
              setFailure("");
              setSaved(false);
            }}
          >
            Cancel
          </button>
        )}
        {saved && (
          <span className="saved" role="status">
            <Check />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

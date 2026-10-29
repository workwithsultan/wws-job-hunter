import { CheckCircle2, CircleDashed, LoaderCircle, Search, AlertCircle } from "lucide-react";
import type { SearchRun } from "../src/shared/model";
import { Alert, Modal } from "./ui";

export function SearchProgress({
  open,
  run,
  failure,
  onRetry,
  onClose,
  onLogs,
  returnFocus,
}: {
  open: boolean;
  run: SearchRun | null;
  failure: string;
  onRetry: () => void;
  onClose: () => void;
  onLogs: () => void;
  returnFocus: () => void;
}) {
  const running = !run || run.status === "running";
  const completed = run?.status === "completed";
  const stage =
    !run || run.message.startsWith("Checking") ? 0 : run.message.startsWith("Discovering") ? 1 : 2;
  const title = running
    ? "Finding your next opportunity"
    : completed
      ? "Search complete"
      : "Search stopped";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      busy={running && !failure}
      returnFocus={returnFocus}
    >
      <div className="search-progress" role="status" aria-live="polite" aria-atomic="true">
        <div
          className={
            "search-progress-symbol" + (running ? " is-searching" : completed ? " is-complete" : "")
          }
          aria-hidden="true"
        >
          {running ? <Search /> : completed ? <CheckCircle2 /> : <AlertCircle />}
        </div>
        <p className="search-progress-message">
          {running
            ? run?.message || "Starting your search…"
            : completed
              ? run.added
                ? `${run.added} new ${run.added === 1 ? "opportunity is" : "opportunities are"} ready in Jobs.`
                : run.found
                  ? "No new opportunities matched this search. Your saved applications are unchanged."
                  : "No postings were found with your current filters in the last 24 hours."
              : run?.message}
        </p>
        {running && (
          <ol className="search-progress-steps" aria-label="Search stages">
            {["Check accounts", "Find postings", "Review fit"].map((label, index) => (
              <li key={label} aria-current={index === stage ? "step" : undefined}>
                {index < stage ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : index === stage ? (
                  <LoaderCircle className="spinner" aria-hidden="true" />
                ) : (
                  <CircleDashed aria-hidden="true" />
                )}
                <span>{label}</span>
                <span className="sr-only">
                  {index < stage ? "Complete" : index === stage ? "In progress" : "Waiting"}
                </span>
              </li>
            ))}
          </ol>
        )}
        {run && (
          <dl className="search-progress-results">
            {[
              ["Found", run.found],
              ["Added", run.added],
              ["Matches", run.matches],
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {failure && <Alert onRetry={onRetry}>{failure}</Alert>}
      {(!running || failure) && (
        <div className="dialog-actions">
          <button className="ghost" onClick={onLogs}>
            Check logs
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}

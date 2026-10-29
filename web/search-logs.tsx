import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { runStatusLabels, type RunList } from "../src/shared/model";
import { runDuration } from "./log-format";
import { api } from "./api";
import { Alert, Busy, Choice, PendingLabel } from "./ui";

export function SearchLogs({
  active,
  version,
  timezone,
}: {
  active: boolean;
  version: number;
  timezone: string;
}) {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = params.get("page") ?? "1";
  const [data, setData] = useState<RunList | null>(null);
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || status !== "running") return;
    const next = new URLSearchParams(params);
    next.delete("status");
    next.delete("page");
    setParams(next, { replace: true });
  }, [active, status, params, setParams]);
  useEffect(() => {
    setData(null);
    setFailure("");
  }, [page, status]);
  useEffect(() => {
    if (!active || status === "running") return;
    let disposed = false;
    setLoading(true);
    const query = new URLSearchParams({ page });
    if (status) query.set("status", status);
    void api<RunList>("/api/runs?" + query)
      .then((value) => {
        if (!disposed) {
          setData(value);
          setFailure("");
        }
      })
      .catch((error) => {
        if (!disposed)
          setFailure(error instanceof Error ? error.message : "Search logs could not be loaded.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [active, version, page, status, retry]);
  const filter = (value: string) => {
    const next = new URLSearchParams();
    if (value) next.set("status", value);
    setParams(next);
  };
  const move = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(value));
    setParams(next);
  };
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: timezone });
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "medium", timeZone: timezone });
  return (
    <div className="collection search-logs">
      <div className="collection-heading">
        <h2>History</h2>
        <button type="button" disabled={loading} onClick={() => setRetry((value) => value + 1)}>
          <RefreshCw aria-hidden="true" className={loading ? "spinner" : undefined} />
          <PendingLabel pending={loading} idle="Refresh" busy="Refreshing…" />
        </button>
      </div>
      <div className="log-toolbar">
        <Choice
          label="Filter search status (optional)"
          value={status}
          onChange={filter}
          options={[
            { value: "", label: "All statuses" },
            ...Object.entries(runStatusLabels)
              .filter(([value]) => value !== "running")
              .map(([value, label]) => ({ value, label })),
          ]}
        />
        <span>Times in {timezone.replaceAll("_", " ")}</span>
      </div>
      {failure ? (
        <div className="collection-body">
          <Alert retrying={loading} onRetry={() => setRetry((value) => value + 1)}>
            {failure}
          </Alert>
        </div>
      ) : !data ? (
        <Busy label="Loading search logs…" />
      ) : (
        <>
          <div
            className="table-scroll"
            role="region"
            aria-label="Search log table"
            tabIndex={0}
            aria-busy={loading}
          >
            <table className="log-table">
              <caption className="sr-only">Search execution history, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                  <th scope="col">Results</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <time dateTime={run.startedAt}>
                        <span>{date.format(new Date(run.startedAt))}</span>
                        <span className="log-clock">{time.format(new Date(run.startedAt))}</span>
                      </time>
                      <span className="log-meta">
                        Run #{run.id}
                        {" · "}
                        {runDuration(run)}
                      </span>
                    </td>
                    <td>
                      <span className={"badge run-" + run.status}>
                        {runStatusLabels[run.status]}
                      </span>
                    </td>
                    <td className="log-results">
                      <span>
                        {run.added.toLocaleString()} added · {run.matches.toLocaleString()} matches
                      </span>
                      <span className="log-meta">{run.found.toLocaleString()} found</span>
                    </td>
                    <td className="log-message">{run.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.runs.length === 0 && (
            <div className="log-empty">
              <h3>{status ? "No searches with this status" : "No searches yet"}</h3>
              <p>
                {status
                  ? "Choose another status to view other searches."
                  : "Run a job search to see its progress, results, and any errors here."}
              </p>
              {status ? (
                <button type="button" onClick={() => filter("")}>
                  Clear filter
                </button>
              ) : (
                <Link to="/search">Search preferences</Link>
              )}
            </div>
          )}
          <div className="pagination">
            <span role="status">
              {data.total.toLocaleString()} {data.total === 1 ? "search" : "searches"}
            </span>
            <div>
              <button
                type="button"
                className="icon-button"
                aria-label="Previous log page"
                disabled={loading || data.page <= 1}
                onClick={() => move(data.page - 1)}
              >
                <ChevronLeft />
              </button>
              <span>
                {data.page} / {data.pages}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Next log page"
                disabled={loading || data.page >= data.pages}
                onClick={() => move(data.page + 1)}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

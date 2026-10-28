import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import type { Workspace } from "../src/shared/model";
import { searchBudget } from "../src/shared/budget";
import { useQuota } from "./providers";
import { useActivity, useInteractionState } from "./interaction";
import { Alert, Emoji } from "./ui";

export function JobQuota({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const { quota, failure, loading, load } = useQuota(
    workspace.connections.serpapiKeys,
    active,
    workspace.running,
  );
  const [expanded, setExpanded] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1280px)");
    const resize = () => setExpanded(wide.matches);
    wide.addEventListener("change", resize);
    return () => wide.removeEventListener("change", resize);
  }, []);
  const interaction = useInteractionState();
  useActivity(loading, "busy");
  const connected = workspace.connections.serpapiKeys.length > 0;
  const budget = searchBudget(quota, workspace.preferences);
  const verified = quota?.complete && budget.remaining !== null;
  const estimatedRuns =
    budget.remaining !== null && budget.searchesPerRun !== null && budget.searchesPerRun > 0
      ? Math.floor(budget.remaining / budget.searchesPerRun)
      : null;
  const nextReset = quota?.accounts
    .map((account) => account.renewalDate)
    .filter((date): date is string => date !== null)
    .sort()[0];
  const resetLabel = nextReset
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(nextReset + "T00:00:00Z"))
    : null;
  return (
    <section className="job-quota" aria-labelledby="job-quota-heading" aria-busy={loading}>
      <div className="quota-heading">
        <h2 id="job-quota-heading">
          <Emoji>🔑</Emoji>SerpApi quota
        </h2>
        {connected && (
          <button
            type="button"
            className="icon-button ghost"
            aria-label="Refresh SerpApi quota"
            disabled={loading || workspace.running || interaction.writing}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" className={loading ? "spinner" : undefined} />
          </button>
        )}
      </div>
      {!connected ? (
        <p>Connect SerpApi to see your remaining search requests and reset dates.</p>
      ) : (loading && !quota) || (!quota && !failure) ? (
        <p role="status">Checking quota…</p>
      ) : failure ? (
        <Alert onRetry={() => void load()}>{failure}</Alert>
      ) : verified ? (
        <>
          <div className="quota-balance">
            <strong>{budget.remaining!.toLocaleString()}</strong>
            <span>requests remaining</span>
          </div>
          <p>
            {estimatedRuns !== null
              ? `About ${estimatedRuns.toLocaleString()} job searches left.`
              : "Set job titles to estimate how many job searches remain."}
          </p>
          <details
            className="quota-account-details"
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary>
              Account balances &amp; resets{" "}
              <span className="quota-summary-date">
                {resetLabel ? `Next reset ${resetLabel}` : "Reset dates unavailable"}
              </span>
            </summary>
            {budget.searchesPerRun !== null && (
              <p className="quota-estimate">
                ~{budget.searchesPerRun.toLocaleString()} requests per search at current settings,
                before retries.
              </p>
            )}
            <ul className="quota-resets">
              {quota.accounts.map((account) => {
                const key = quota.keys.find((key) => key.accountId === account.id);
                return (
                  <li key={account.id}>
                    <span>
                      {key ? `Key •••• ${key.lastFour}` : account.plan}
                      <span className="quota-account-balance">
                        {account.remaining.toLocaleString()} left
                      </span>
                    </span>
                    <span>
                      {account.renewalDate ? (
                        <>
                          Resets{" "}
                          <time dateTime={account.renewalDate}>
                            {new Intl.DateTimeFormat(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              timeZone: "UTC",
                            }).format(new Date(account.renewalDate + "T00:00:00Z"))}
                          </time>
                        </>
                      ) : (
                        "Reset date unavailable"
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="quota-checked" role="status">
              {loading ? (
                "Refreshing quota…"
              ) : workspace.running ? (
                "Search in progress · balance updates when finished."
              ) : (
                <>
                  Checked{" "}
                  <time dateTime={quota.checkedAt}>
                    {new Date(quota.checkedAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </>
              )}
            </p>
            <Link className="quota-settings" to="/settings#serpapi-key">
              Manage keys
            </Link>
          </details>
        </>
      ) : (
        <div role="alert">
          <p>Quota unavailable. Check your connected accounts.</p>
          {quota?.keys
            .filter((key) => key.error)
            .map((key) => (
              <p key={key.id}>
                Key •••• {key.lastFour}: {key.error}
              </p>
            ))}
        </div>
      )}
      {!verified && (
        <Link className="quota-settings" to="/settings#serpapi-key">
          {connected ? "Manage keys" : "Connect SerpApi"}
        </Link>
      )}
    </section>
  );
}

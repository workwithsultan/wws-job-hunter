import { StrictMode, useCallback, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileText,
  ListFilter,
  Menu,
  Play,
  Search as SearchIcon,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  applicationStatuses,
  preferencesSchema,
  sources,
  statusLabels,
  type Job,
  type JobList,
  type JobStatus,
  type Preferences,
  type SearchRun,
  type Workspace,
} from "../src/shared/model";
import { countries } from "../src/shared/countries";
import { workTypes } from "../src/shared/search-scope";
import { searchChanged, searchValid, profileValid } from "./form-state";
import { searchBudget } from "../src/shared/budget";
import type { ResumeMetadata } from "../src/shared/resume";
import { ResumeImport } from "./resume-import";
import { ProviderSettings, useQuota } from "./providers";
import { api, ApiError, dateText } from "./api";
import {
  Alert,
  Busy,
  Choice,
  ChipInput,
  ConfirmationProvider,
  Field,
  Modal,
  useConfirm,
  useDraftWarning,
} from "./ui";
import "./style.css";

const storedTheme = localStorage.getItem("jobHunterAppearance") ?? "system";
if (storedTheme !== "system") document.documentElement.dataset.theme = storedTheme;
const nav = [
  { path: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { path: "/applications", label: "Applications", icon: FileText },
  { path: "/search", label: "Search", icon: SearchIcon },
  { path: "/settings", label: "Settings", icon: Settings2 },
];
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The action could not be completed. Try again.";
function missingSetup(workspace: Workspace) {
  return {
    profile: workspace.preferences.profile.trim().length < 10,
    roles: !workspace.preferences.roles.length,
    providers:
      !workspace.connections.openai ||
      !workspace.connections.serpapi ||
      !workspace.connections.model,
  };
}
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [failure, setFailure] = useState("");
  const [version, setVersion] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [theme, setTheme] = useState(storedTheme);
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const reload = useCallback(async () => {
    try {
      const data = await api<Workspace>("/api/workspace");
      setWorkspace(data);
      setFailure("");
      setVersion((v) => v + 1);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!workspace?.running) return;
    const interval = setInterval(() => void reload(), 2500);
    return () => clearInterval(interval);
  }, [workspace?.running, reload]);
  useEffect(() => {
    if (location.pathname === "/") navigate("/jobs", { replace: true });
    setMobileMenu(false);
    window.scrollTo(0, 0);
    document.title =
      (nav.find((item) => item.path === location.pathname)?.label ?? "Job Hunter") +
      " · Job Hunter";
  }, [location.pathname, navigate]);
  const appearance = (value: string) => {
    setTheme(value);
    localStorage.setItem("jobHunterAppearance", value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  };
  const start = async () => {
    if (!workspace || starting || workspace.running) return;
    const missing = missingSetup(workspace);
    if (missing.profile || missing.providers) {
      navigate("/settings");
      return;
    }
    if (missing.roles) {
      navigate("/search");
      return;
    }
    setStarting(true);
    try {
      const quota = await api<import("../src/shared/model").SerpQuota>(
        "/api/serpapi/quota?refresh=true",
      );
      const budget = searchBudget(quota, workspace.preferences);
      if (!quota.complete)
        throw new Error("Check your SerpApi connection in Settings before searching.");
      if (!budget.remaining)
        throw new Error("No SerpApi searches remain. Check your accounts in Settings.");
      if (!quota.accounts.some((account) => account.remaining > 0 && account.hourlyRemaining !== 0))
        throw new Error("The SerpApi hourly limit has been reached. Try again after it resets.");
      if (
        !(await confirm({
          title: "Start a job search?",
          description: `Estimated usage: ${budget.searchesPerRun} SerpApi searches before retries.${budget.aboveTarget ? ` Your daily target is ${budget.dailyTarget}.` : ""} New jobs will be scored against your profile using OpenAI.`,
          action: "Start search",
        }))
      )
        return;
      await api("/api/runs", "POST", {});
      await reload();
      navigate("/search");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };
  const navigation = (
    <nav aria-label="Main navigation">
      {nav.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={path} onClick={() => setMobileMenu(false)}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
  const current = nav.find((item) => item.path === location.pathname);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="shell">
        <aside className="sidebar">
          <Link to="/jobs" className="brand">
            <img src="/icon.svg" alt="" width="32" height="32" />
            Job Hunter
          </Link>
          {navigation}
          <div className="sidebar-bottom">
            <div className="appearance">
              <Choice
                value={theme}
                onChange={appearance}
                label="Appearance"
                options={[
                  { value: "system", label: "System theme" },
                  { value: "light", label: "Light theme" },
                  { value: "dark", label: "Dark theme" },
                ]}
              />
            </div>
          </div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button ghost mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMobileMenu(true)}
              >
                <Menu />
              </button>
              <Link to="/jobs" className="mobile-brand">
                Job Hunter
              </Link>
            </div>
            {workspace?.running && (
              <span className="run-indicator active" role="status">
                <Clock3 />
                Searching…
              </span>
            )}
          </header>
          <main id="main" tabIndex={-1}>
            <div className="page-heading">
              <div>
                <h1>{current?.label ?? "Page not found"}</h1>
              </div>
              {workspace && (location.pathname === "/jobs" || location.pathname === "/search") && (
                <button
                  className="primary"
                  disabled={workspace.running || starting}
                  onClick={() => void start()}
                >
                  {workspace.running ? <Clock3 /> : <Play />}
                  {workspace.running
                    ? "Searching…"
                    : Object.values(missingSetup(workspace)).some(Boolean)
                      ? "Complete setup"
                      : "Search jobs"}
                </button>
              )}
            </div>
            {failure && <Alert onRetry={() => void reload()}>{failure}</Alert>}
            {!workspace && !failure && <Busy />}
            {workspace && (
              <>
                <section hidden={location.pathname !== "/jobs"} className="page-content">
                  <JobsPage
                    workspace={workspace}
                    version={version}
                    applications={false}
                    active={location.pathname === "/jobs"}
                  />
                </section>
                <section hidden={location.pathname !== "/applications"} className="page-content">
                  <JobsPage
                    workspace={workspace}
                    version={version}
                    applications
                    active={location.pathname === "/applications"}
                  />
                </section>
                <section hidden={location.pathname !== "/search"} className="page-content">
                  <SearchPage
                    workspace={workspace}
                    reload={reload}
                    version={version}
                    active={location.pathname === "/search"}
                  />
                </section>
                <section hidden={location.pathname !== "/settings"} className="page-content">
                  <SettingsPage
                    workspace={workspace}
                    reload={reload}
                    active={location.pathname === "/settings"}
                  />
                </section>
              </>
            )}
            {!current && location.pathname !== "/" && (
              <Link className="button" to="/jobs">
                Back to jobs
              </Link>
            )}
          </main>
        </div>
      </div>
      <Modal open={mobileMenu} onClose={() => setMobileMenu(false)} title="Job Hunter" drawer>
        {navigation}
        <div className="mobile-appearance">
          <Choice
            value={theme}
            onChange={appearance}
            label="Appearance"
            options={[
              { value: "system", label: "System theme" },
              { value: "light", label: "Light theme" },
              { value: "dark", label: "Dark theme" },
            ]}
          />
        </div>
      </Modal>
      {workspace && <JobDetail reload={reload} />}
    </>
  );
}
function JobsPage({
  workspace,
  version,
  applications,
  active,
}: {
  workspace: Workspace;
  version: number;
  applications: boolean;
  active: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<JobList | null>(null);
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const page = params.get("page") ?? "1";
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      const query = new URLSearchParams({ q, status, page, applications: String(applications) });
      void api<JobList>("/api/jobs?" + query)
        .then((value) => {
          if (!controller.signal.aborted) {
            setData(value);
            setFailure("");
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setFailure(errorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [q, status, page, applications, active, version, retry]);
  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "page") next.delete("page");
    next.delete("job");
    setParams(next, { replace: name === "q" });
  };
  const stats = applications
    ? [
        { label: "Applications", value: workspace.totals.applications, icon: FileText },
        { label: "Interviewing", value: workspace.totals.interviewing, icon: Clock3 },
        { label: "Offers", value: workspace.totals.offers, icon: CheckCircle2 },
      ]
    : [
        { label: "Saved jobs", value: workspace.totals.jobs, icon: BriefcaseBusiness },
        { label: "Ready to apply", value: workspace.totals.ready, icon: Sparkles },
        { label: "Needs review", value: workspace.totals.review, icon: CircleDashed },
      ];
  const total = applications ? workspace.totals.applications : workspace.totals.jobs;
  const setupIncomplete = Object.values(missingSetup(workspace)).some(Boolean);
  const searchFailed =
    workspace.lastRun?.status === "failed" || workspace.lastRun?.status === "interrupted";
  const emptyTitle = workspace.running
    ? "Searching for opportunities"
    : searchFailed
      ? "Your search needs attention"
      : workspace.lastRun?.status === "completed"
        ? "No matching jobs found"
        : setupIncomplete
          ? "No jobs yet"
          : "Ready for your first search";
  const emptyMessage = workspace.running
    ? "Your search is running. New jobs will appear here as they are saved."
    : searchFailed
      ? workspace.lastRun!.message
      : workspace.lastRun?.status === "completed"
        ? "The last search did not add matching roles. Try broader target titles or review your search preferences."
        : setupIncomplete
          ? "Add your target roles and profile, then search for jobs that match what you’re looking for."
          : "Your setup is complete. Start a search to discover and assess new opportunities.";
  const emptyAction = workspace.running
    ? "View search progress"
    : searchFailed
      ? "Review search history"
      : setupIncomplete
        ? "Set up your search"
        : "Review search preferences";

  return (
    <>
      <div className="stats">
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="stat" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <Icon aria-hidden="true" />
            </div>
            <strong>{value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <div className="collection">
        <div className="collection-heading">
          <h2>{applications ? "Your applications" : "Your opportunities"}</h2>
          {total > 0 && (
            <a className="button ghost" href="/api/export" download>
              <ArrowDownToLine />
              Export CSV
            </a>
          )}
        </div>
        {total > 0 && (
          <div className="collection-toolbar">
            <label className="search-input">
              <SearchIcon aria-hidden="true" />
              <span className="sr-only">Search saved jobs (optional)</span>
              <input
                type="search"
                value={q}
                maxLength={200}
                onChange={(event) => filter("q", event.target.value)}
                placeholder="Search saved jobs"
              />
            </label>
            <Choice
              value={status}
              onChange={(value) => filter("status", value)}
              label="Filter status (optional)"
              options={[
                { value: "", label: "All statuses" },
                ...Object.entries(statusLabels)
                  .filter(
                    ([key]) => !applications || applicationStatuses.includes(key as JobStatus),
                  )
                  .map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
        )}
        {failure ? (
          <div className="collection-body">
            <Alert onRetry={() => setRetry((v) => v + 1)}>{failure}</Alert>
          </div>
        ) : !data ? (
          <Busy label="Loading jobs…" />
        ) : total === 0 ? (
          <div className="empty-state">
            <div className="empty-symbol">
              {applications ? <FileText /> : <BriefcaseBusiness />}
              <span>
                <SearchIcon />
              </span>
            </div>
            <h3>{applications ? "No applications yet" : emptyTitle}</h3>
            <p>
              {applications
                ? "Once you apply, update the job’s status. Your applications and notes will appear here."
                : emptyMessage}
            </p>
            <Link className="button primary" to={applications ? "/jobs" : "/search"}>
              {applications ? "Browse jobs" : emptyAction}
              <ArrowRight />
            </Link>
          </div>
        ) : data.jobs.length === 0 ? (
          <div className="empty-state compact">
            <ListFilter />
            <h3>No jobs match these filters</h3>
            <p>Try another keyword or show all statuses.</p>
            <button onClick={() => setParams({})}>Clear filters</button>
          </div>
        ) : (
          <>
            <div className="table-scroll" aria-busy={loading}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col" className="numeric">
                      Match
                    </th>
                    <th scope="col" className="desktop-cell">
                      Source
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col" className="desktop-cell">
                      Added
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link
                          className="job-title"
                          to={{
                            search: new URLSearchParams({
                              ...Object.fromEntries(params),
                              job: String(job.id),
                            }).toString(),
                          }}
                        >
                          {job.title}
                          <ArrowUpRight aria-hidden="true" />
                        </Link>
                        <span className="mobile-source">{sources[job.source]}</span>
                      </td>
                      <td className="numeric">
                        <span
                          className={
                            job.score !== null && job.score >= workspace.preferences.threshold
                              ? "score good"
                              : "score"
                          }
                        >
                          {job.score === null ? "—" : job.score + " / 100"}
                        </span>
                      </td>
                      <td className="desktop-cell">{sources[job.source]}</td>
                      <td>
                        <span className={"badge status-" + job.status}>
                          {statusLabels[job.status]}
                        </span>
                      </td>
                      <td className="desktop-cell">
                        <time dateTime={job.createdAt}>{dateText(job.createdAt)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {data.total.toLocaleString()} {data.total === 1 ? "job" : "jobs"}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous page"
                  disabled={data.page <= 1}
                  onClick={() => filter("page", String(data.page - 1))}
                >
                  <ChevronLeft />
                </button>
                <span>
                  {data.page} / {data.pages}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={data.page >= data.pages}
                  onClick={() => filter("page", String(data.page + 1))}
                >
                  <ChevronRight />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
function JobDetail({ reload }: { reload: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const id = params.get("job");
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<JobStatus>("new");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    if (!id) return;
    setJob(null);
    setFailure("");
    setSaved(false);
    let disposed = false;
    void api<Job>("/api/jobs/" + encodeURIComponent(id))
      .then((value) => {
        if (!disposed) {
          setJob(value);
          setStatus(value.status);
          setNotes(value.notes);
        }
      })
      .catch((error) => {
        if (!disposed) setFailure(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [id]);
  const dirty = Boolean(job && (status !== job.status || notes !== job.notes));
  useDraftWarning(dirty);
  const close = async () => {
    if (busy) return;
    if (
      dirty &&
      !(await confirm({
        title: "Discard unfinished changes?",
        description: "Your status and note edits have not been saved.",
        action: "Discard changes",
        destructive: true,
      }))
    )
      return;
    const next = new URLSearchParams(params);
    next.delete("job");
    setParams(next);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!job || busy || !dirty) return;
    setBusy(true);
    try {
      await api("/api/jobs/" + job.id, "PUT", { status, notes });
      setJob({ ...job, status, notes });
      setSaved(true);
      setFailure("");
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !job ||
      busy ||
      !(await confirm({
        title: "Delete this job?",
        description: `Permanently delete “${job.title}” and its notes from this workspace?`,
        action: "Delete job",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api("/api/jobs/" + job.id, "DELETE", {});
      const next = new URLSearchParams(params);
      next.delete("job");
      setParams(next);
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(id)}
      onClose={() => void close()}
      title={job?.title ?? "Job details"}
      drawer
    >
      {failure && <Alert>{failure}</Alert>}
      {!job && !failure && <Busy label="Loading job…" />}
      {job && (
        <form onSubmit={(event) => void save(event)} className="drawer-body">
          <div className="detail-meta">
            <span className="badge">{sources[job.source]}</span>
            <span className="detail-score">
              {job.score === null ? "Not scored" : `${job.score} / 100 match score`}
            </span>
          </div>
          {job.reason && <p className="match-reason">{job.reason}</p>}
          <a className="button" href={job.url} target="_blank" rel="noreferrer noopener">
            Open original posting
            <ExternalLink />
          </a>
          <Field id="jobStatus" label="Application status (required)">
            <Choice
              value={status}
              onChange={(value) => {
                setStatus(value as JobStatus);
                setSaved(false);
              }}
              label="Application status"
              options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field id="jobNotes" label="Notes (optional)">
            <textarea
              value={notes}
              maxLength={12000}
              onChange={(event) => {
                setNotes(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <div className="form-actions">
            <button className="primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {saved && (
              <span className="saved" role="status">
                <Check />
                Changes saved
              </span>
            )}
          </div>
          {job.description && (
            <details className="description">
              <summary>Job description</summary>
              <p>{job.description}</p>
            </details>
          )}
          <div className="danger-zone">
            <button
              className="ghost danger-text"
              type="button"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 />
              Delete job
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function SearchPage({
  workspace,
  reload,
  version,
  active,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  version: number;
  active: boolean;
}) {
  const [draft, setDraft] = useState(workspace.preferences);
  const [baseline, setBaseline] = useState(workspace.preferences);
  const [pending, setPending] = useState({ roles: false, exclusions: false });
  const hasPending = pending.roles || pending.exclusions;
  const dirty = searchChanged(draft, baseline) || hasPending;
  const valid = searchValid(draft, hasPending);
  const [chipVersion, setChipVersion] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runs, setRuns] = useState<SearchRun[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [query, setQuery] = useState("");
  const { quota } = useQuota(workspace.connections.serpapiKeys, active, workspace.running);
  const budget = searchBudget(quota, draft);
  useDraftWarning(dirty);
  useEffect(() => {
    if (!dirty) {
      setDraft(workspace.preferences);
      setBaseline(workspace.preferences);
    }
  }, [workspace.preferences, dirty]);
  useEffect(() => {
    if (workspace.running) setHistoryOpen(true);
  }, [workspace.running]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void api<{ runs: SearchRun[] }>("/api/runs")
      .then((value) => {
        if (!disposed) {
          setRuns(value.runs);
          setHistoryError("");
        }
      })
      .catch((error) => {
        if (!disposed) setHistoryError(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [active, version, historyRetry]);
  useEffect(() => {
    if (!workspace.preferences.roles.length || !workspace.connections.serpapi) {
      setQuery("");
      return;
    }
    let disposed = false;
    void api<{ query: string }>("/api/query")
      .then((value) => {
        if (!disposed) setQuery(value.query);
      })
      .catch((error) => {
        if (!disposed) setFailure(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [workspace.preferences, workspace.connections.serpapi]);
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((v) => ({ ...v, [key]: value }));
    setSaved(false);
    setErrors((v) => ({ ...v, [key]: "" }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !dirty) return;
    const candidate = {
      ...draft,
      profile: workspace.preferences.profile,
      resume: workspace.preferences.resume,
      threshold: workspace.preferences.threshold,
    };
    const result = preferencesSchema.safeParse(candidate);
    const fields: Record<string, string> = {};
    if (!result.success)
      for (const issue of result.error.issues) fields[String(issue.path[0])] = issue.message;
    if (!candidate.roles.length) fields.roles = "Add at least one job title.";
    if ((document.getElementById("search-roles") as HTMLInputElement).value.trim())
      fields.roles = "Add or clear the typed title before saving.";
    if ((document.getElementById("search-exclusions") as HTMLInputElement).value.trim())
      fields.exclusions = "Add or clear the typed keyword before saving.";
    if (Object.keys(fields).length) {
      setErrors(fields);
      document.getElementById("search-" + Object.keys(fields)[0])?.focus();
      return;
    }
    setBusy(true);
    setFailure("");
    try {
      await api("/api/preferences", "PUT", candidate);
      await reload();
      setDraft(candidate);
      setBaseline(candidate);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length) setErrors(error.fields);
      else setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const hours = Array.from({ length: 24 }, (_, value) => ({
    value: String(value).padStart(2, "0"),
    label: String(value).padStart(2, "0"),
  }));
  const minutes = Array.from({ length: 60 }, (_, value) => ({
    value: String(value).padStart(2, "0"),
    label: String(value).padStart(2, "0"),
  }));
  const zones = [...new Set(["UTC", draft.timezone, ...Intl.supportedValuesOf("timeZone")])]
    .sort()
    .map((value) => ({ value, label: value.replaceAll("_", " ") }));
  return (
    <>
      {failure && <Alert>{failure}</Alert>}
      <form onSubmit={(event) => void save(event)} noValidate className="search-form">
        <fieldset disabled={workspace.running || busy}>
          <section className="search-section">
            <h2>Job titles</h2>
            <div className="keyword-grid">
              <Field id="search-roles" label="Include (required)" error={errors.roles}>
                <ChipInput
                  key={"roles-" + chipVersion}
                  onEditing={(value) => {
                    setPending((v) => ({ ...v, roles: value }));
                    setSaved(false);
                  }}
                  value={draft.roles}
                  onChange={(value) => change("roles", value)}
                  onError={(message) => setErrors((v) => ({ ...v, roles: message }))}
                  label="Job title"
                />
              </Field>
              <Field id="search-exclusions" label="Exclude (optional)" error={errors.exclusions}>
                <ChipInput
                  key={"exclusions-" + chipVersion}
                  onEditing={(value) => {
                    setPending((v) => ({ ...v, exclusions: value }));
                    setSaved(false);
                  }}
                  value={draft.exclusions}
                  onChange={(value) => change("exclusions", value)}
                  onError={(message) => setErrors((v) => ({ ...v, exclusions: message }))}
                  label="Excluded keyword"
                />
              </Field>
            </div>
          </section>
          <section className="search-section">
            <h2>Location and work type</h2>
            <div className="keyword-grid">
              <Field id="search-country" label="Country (required)" error={errors.country}>
                <Choice
                  value={draft.country}
                  onChange={(value) => change("country", value)}
                  label="Country"
                  options={[
                    { value: "any", label: "Any country" },
                    ...Object.entries(countries).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </Field>
              <Field id="search-workType" label="Work type (required)" error={errors.workType}>
                <Choice
                  value={draft.workType}
                  onChange={(value) => change("workType", value as Preferences["workType"])}
                  label="Work type"
                  options={Object.entries(workTypes).map(([value, label]) => ({ value, label }))}
                />
              </Field>
            </div>
          </section>
          <section className="search-section">
            <h2 id="source-heading">Job sites (required)</h2>
            <div className="source-chips" role="group" aria-labelledby="source-heading">
              {Object.entries(sources).map(([value, label]) => {
                const selected = draft.sources.includes(value as keyof typeof sources);
                return (
                  <button
                    key={value}
                    type="button"
                    className="source-chip"
                    aria-pressed={selected}
                    disabled={selected && draft.sources.length === 1}
                    onClick={() =>
                      change(
                        "sources",
                        selected
                          ? draft.sources.filter((source) => source !== value)
                          : [...draft.sources, value as keyof typeof sources],
                      )
                    }
                  >
                    <Check
                      aria-hidden="true"
                      style={{ visibility: selected ? "visible" : "hidden" }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
            {budget.remaining !== null && (
              <div className="search-usage" role="status">
                <span>{budget.remaining.toLocaleString()} searches remaining</span>
                {budget.searchesPerRun !== null && <span>~{budget.searchesPerRun} / run</span>}
              </div>
            )}
          </section>
          <section className="search-section">
            <div className="section-heading">
              <h2>Schedule</h2>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.scheduleEnabled}
                  onChange={(event) => change("scheduleEnabled", event.target.checked)}
                />
                <span>Run automatically (optional)</span>
              </label>
            </div>
            {draft.scheduleEnabled && (
              <div className="schedule-fields">
                <div className="form-grid">
                  <div className="time-pair">
                    <Field id="search-hour" label="Hour (required)">
                      <Choice
                        value={draft.scheduleTime.split(":")[0] ?? "09"}
                        onChange={(value) =>
                          change("scheduleTime", value + ":" + draft.scheduleTime.split(":")[1])
                        }
                        label="Hour, 24-hour clock"
                        options={hours}
                      />
                    </Field>
                    <Field id="search-minute" label="Minute (required)">
                      <Choice
                        value={draft.scheduleTime.split(":")[1] ?? "00"}
                        onChange={(value) =>
                          change("scheduleTime", draft.scheduleTime.split(":")[0] + ":" + value)
                        }
                        label="Minute"
                        options={minutes}
                      />
                    </Field>
                  </div>
                  <Field id="search-timezone" label="Timezone (required)" error={errors.timezone}>
                    <Choice
                      value={draft.timezone}
                      onChange={(value) => change("timezone", value)}
                      label="Timezone"
                      options={zones}
                    />
                  </Field>
                </div>
                <div className="field">
                  <label id="days-label">Days (required)</label>
                  <div className="day-options" role="group" aria-labelledby="days-label">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, value) => (
                      <label key={value} className="day-choice">
                        <input
                          type="checkbox"
                          checked={draft.scheduleDays.includes(value)}
                          disabled={
                            draft.scheduleDays.length === 1 && draft.scheduleDays.includes(value)
                          }
                          onChange={(event) =>
                            change(
                              "scheduleDays",
                              event.target.checked
                                ? [...draft.scheduleDays, value]
                                : draft.scheduleDays.filter((day) => day !== value),
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="schedule-note">
                  Runs while the app is open.
                  {workspace.nextRun ? ` Next: ${dateText(workspace.nextRun)}.` : ""}
                </p>
              </div>
            )}
          </section>
          <div className="form-actions">
            <button className="primary" disabled={busy || !dirty || !valid}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {dirty && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(workspace.preferences);
                  setBaseline(workspace.preferences);
                  setPending({ roles: false, exclusions: false });
                  setChipVersion((value) => value + 1);
                  setErrors({});
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
        </fieldset>
      </form>
      <details
        className="history-details"
        open={historyOpen}
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>Search history</summary>
        {historyError ? (
          <Alert onRetry={() => setHistoryRetry((v) => v + 1)}>{historyError}</Alert>
        ) : !runs ? (
          <Busy label="Loading search history…" />
        ) : runs.length === 0 ? (
          <p className="empty-history">No searches yet.</p>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <article className="run-row" key={run.id}>
                <div className="run-top">
                  <span className={"badge run-" + run.status}>
                    {run.status === "running"
                      ? "Running"
                      : run.status === "completed"
                        ? "Completed"
                        : run.status === "interrupted"
                          ? "Interrupted"
                          : "Failed"}
                  </span>
                  <time dateTime={run.startedAt}>{dateText(run.startedAt)}</time>
                  <span className="caption">
                    {run.trigger === "schedule" ? "Scheduled" : "Manual"}
                  </span>
                </div>
                <p>{run.message}</p>
                <div className="run-counts">
                  <span>{run.found} found</span>
                  <span>{run.added} added</span>
                  <span>{run.ready} ready</span>
                  <span>{run.review} need review</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </details>
      {query && (
        <details className="query-details">
          <summary>Search query</summary>
          <pre>{query}</pre>
        </details>
      )}
    </>
  );
}
function SettingsPage({
  workspace,
  reload,
  active,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  active: boolean;
}) {
  const [profile, setProfile] = useState(workspace.preferences.profile);
  const [resume, setResume] = useState<ResumeMetadata | null>(workspace.preferences.resume);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [threshold, setThreshold] = useState(String(workspace.preferences.threshold));
  const [baseline, setBaseline] = useState(workspace.preferences);
  const dirty =
    profile !== baseline.profile ||
    threshold !== String(baseline.threshold) ||
    JSON.stringify(resume) !== JSON.stringify(baseline.resume);
  const valid = profileValid(profile, threshold);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingResume, setReadingResume] = useState(false);
  const [resumeVersion, setResumeVersion] = useState(0);
  const [saved, setSaved] = useState(false);
  useDraftWarning(dirty || (reviewOpen && reviewText !== profile));
  useEffect(() => {
    if (!dirty) {
      setBaseline(workspace.preferences);
      setProfile(workspace.preferences.profile);
      setResume(workspace.preferences.resume);
      setThreshold(String(workspace.preferences.threshold));
    }
  }, [workspace.preferences, dirty]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !dirty) return;
    const fields: Record<string, string> = {};
    if (profile.trim().length < 10) fields.profile = "Upload a readable resume PDF before saving.";
    if (
      !threshold ||
      !Number.isInteger(Number(threshold)) ||
      Number(threshold) < 0 ||
      Number(threshold) > 100
    )
      fields.threshold = "Enter a whole number from 0 to 100.";
    if (Object.keys(fields).length) {
      setErrors(fields);
      document
        .getElementById(fields.profile ? "settings-resume" : "settings-" + Object.keys(fields)[0])
        ?.focus();
      return;
    }
    setBusy(true);
    setFailure("");
    try {
      await api("/api/preferences", "PUT", {
        ...workspace.preferences,
        profile,
        resume,
        threshold: Number(threshold),
      });
      await reload();
      setThreshold(String(Number(threshold)));
      setBaseline({ ...workspace.preferences, profile, resume, threshold: Number(threshold) });
      setErrors({});
      setResumeVersion((value) => value + 1);
      setSaved(true);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ProviderSettings workspace={workspace} reload={reload} active={active} />
      {failure && <Alert>{failure}</Alert>}
      <form className="profile-form" onSubmit={(event) => void save(event)} noValidate>
        <fieldset disabled={busy || workspace.running || readingResume}>
          <h2>Profile</h2>
          <ResumeImport
            key={resumeVersion}
            active={active}
            onReadingChange={setReadingResume}
            disabled={busy || workspace.running || readingResume}
            hasProfile={Boolean(profile.trim())}
            onApply={(value) => {
              setProfile(value.text);
              setResume({ name: value.name, pages: value.pages });
              setSaved(false);
              setErrors((v) => ({ ...v, profile: "" }));
            }}
          />
          {profile && (
            <div className="resume-summary">
              <div>
                <FileText aria-hidden="true" />
                <div>
                  <strong>{resume?.name ?? "Saved profile text"}</strong>
                  {resume && (
                    <span>
                      {resume.pages} {resume.pages === 1 ? "page" : "pages"}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                id="review-resume"
                onClick={() => {
                  setReviewText(profile);
                  setReviewOpen(true);
                }}
              >
                Review text
              </button>
            </div>
          )}
          <div className="short-field">
            <Field
              id="settings-threshold"
              label="Minimum score (required)"
              error={errors.threshold}
            >
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="1"
                value={threshold}
                onBlur={() =>
                  setErrors((v) => ({
                    ...v,
                    threshold:
                      !threshold.trim() ||
                      !Number.isInteger(Number(threshold)) ||
                      Number(threshold) < 0 ||
                      Number(threshold) > 100
                        ? "Enter a whole number from 0 to 100."
                        : "",
                  }))
                }
                onChange={(event) => {
                  setThreshold(event.target.value);
                  setSaved(false);
                  setErrors((v) => ({ ...v, threshold: "" }));
                }}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={!dirty || !valid || busy}>
              {busy ? "Saving…" : "Save profile"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setResumeVersion((value) => value + 1);
                  setProfile(workspace.preferences.profile);
                  setResume(workspace.preferences.resume);
                  setThreshold(String(workspace.preferences.threshold));
                  setBaseline(workspace.preferences);
                  setErrors({});
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
        </fieldset>
      </form>
      <Modal
        open={active && reviewOpen}
        title="Resume text"
        onClose={() => {
          setReviewOpen(false);
          setReviewText("");
        }}
      >
        <Field id="resume-review-text" label="Extracted text (required)">
          <textarea
            className="resume-review-text"
            value={reviewText}
            maxLength={12000}
            onChange={(event) => setReviewText(event.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => {
              setReviewOpen(false);
              setReviewText("");
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={reviewText === profile || reviewText.trim().length < 10}
            onClick={() => {
              setProfile(reviewText);
              setSaved(false);
              setReviewOpen(false);
              setReviewText("");
            }}
          >
            Use changes
          </button>
        </div>
      </Modal>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    </BrowserRouter>
  </StrictMode>,
);

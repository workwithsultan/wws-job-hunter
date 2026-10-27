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
  Circle,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileText,
  ListFilter,
  Menu,
  Play,
  Search as SearchIcon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  applicationStatuses,
  connectionUpdateSchema,
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
import { api, ApiError, dateText } from "./api";
import { Alert, Busy, Choice, ConfirmationProvider, Field, Modal, useConfirm } from "./ui";
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
function useDraftWarning(dirty: boolean) {
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
    if (
      !(await confirm({
        title: "Start a job search?",
        description: `Search ${workspace.preferences.sources.length} job sites for US remote roles, then score new jobs against your profile. Your profile is sent to OpenAI. This uses your SerpApi and OpenAI credits.`,
        action: "Start search",
      }))
    )
      return;
    setStarting(true);
    try {
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
    <nav aria-label="Workspace">
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
            <span className="local-label">
              <ShieldCheck aria-hidden="true" />
              Self-hosted workspace
            </span>
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
              <span className="breadcrumb">
                Workspace <ChevronRight aria-hidden="true" />{" "}
                <span>{current?.label ?? "Page"}</span>
              </span>
            </div>
            <span className={workspace?.running ? "run-indicator active" : "run-indicator"}>
              <span className="status-dot" />
              {workspace?.running ? "Search running" : "Local workspace"}
            </span>
          </header>
          <main id="main" tabIndex={-1}>
            <div className="page-heading">
              <div>
                <h1>{current?.label ?? "Page not found"}</h1>
                <p>
                  {location.pathname === "/jobs"
                    ? "Review your matches and choose what comes next."
                    : location.pathname === "/applications"
                      ? "Track updates and notes for the jobs you apply to."
                      : location.pathname === "/search"
                        ? "Choose your target roles, job sites, and schedule."
                        : location.pathname === "/settings"
                          ? "Your profile, preferences, and connections."
                          : "This page is not in your workspace."}
                </p>
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
                  <SettingsPage workspace={workspace} reload={reload} />
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
            {!applications && setupIncomplete && !workspace.running && !searchFailed && (
              <div className="setup-path">
                <span>
                  <span>1</span>Set your preferences
                </span>
                <span>
                  <span>2</span>Discover matches
                </span>
                <span>
                  <span>3</span>Track applications
                </span>
              </div>
            )}
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
    if (!job || busy) return;
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
  const [rolesText, setRolesText] = useState(workspace.preferences.roles.join("\n"));
  const [exclusionsText, setExclusionsText] = useState(workspace.preferences.exclusions.join("\n"));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runs, setRuns] = useState<SearchRun[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [query, setQuery] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  useDraftWarning(dirty);
  useEffect(() => {
    if (!dirty) {
      setDraft(workspace.preferences);
      setRolesText(workspace.preferences.roles.join("\n"));
      setExclusionsText(workspace.preferences.exclusions.join("\n"));
    }
  }, [workspace.preferences, dirty]);
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
    if (!workspace.preferences.roles.length) {
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
  }, [workspace.preferences]);
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setSaved(false);
    setErrors((v) => ({ ...v, [key]: "" }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const candidate = {
      ...workspace.preferences,
      roles: draft.roles,
      exclusions: draft.exclusions,
      sources: draft.sources,
      limit: draft.limit,
      scheduleEnabled: draft.scheduleEnabled,
      scheduleTime: draft.scheduleTime,
      timezone: draft.timezone,
      scheduleDays: draft.scheduleDays,
    };
    const result = preferencesSchema.safeParse(candidate);
    const fields: Record<string, string> = {};
    if (!result.success)
      for (const issue of result.error.issues) fields[String(issue.path[0])] = issue.message;
    if (!candidate.roles.length) fields.roles = "Add at least one target role.";
    if (Object.keys(fields).length) {
      setErrors(fields);
      document.getElementById("search-" + Object.keys(fields)[0])?.focus();
      return;
    }
    setBusy(true);
    setFailure("");
    try {
      await api("/api/preferences", "PUT", candidate);
      setDirty(false);
      setSaved(true);
      await reload();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length) setErrors(error.fields);
      else setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const setup = missingSetup(workspace);
  const split = (value: string) =>
    value
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean);
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
      <div className="setup-checklist" aria-label="Search setup">
        {[
          { label: "Your profile", complete: !setup.profile, path: "/settings" },
          { label: "Target roles", complete: !setup.roles, path: "/search" },
          { label: "Provider keys", complete: !setup.providers, path: "/settings" },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className={item.complete ? "setup-check complete" : "setup-check"}
          >
            {item.complete ? (
              <CheckCircle2 aria-label="Complete" />
            ) : (
              <Circle aria-label="Incomplete" />
            )}
            <span>{item.label}</span>
            {!item.complete && <ArrowUpRight aria-hidden="true" />}
          </Link>
        ))}
      </div>
      {failure && <Alert>{failure}</Alert>}
      <form onSubmit={(event) => void save(event)} noValidate className="preferences-form">
        <fieldset disabled={workspace.running || busy}>
          <div className="form-section">
            <div className="section-intro">
              <h2>Find the right roles</h2>
              <p>Search remote opportunities in the United States.</p>
            </div>
            <div className="form-content">
              <div className="form-grid">
                <Field
                  id="search-roles"
                  label="Target roles (required; one per line)"
                  error={errors.roles}
                >
                  <textarea
                    value={rolesText}
                    maxLength={3000}
                    onChange={(event) => {
                      setRolesText(event.target.value);
                      change("roles", split(event.target.value));
                    }}
                  />
                </Field>
                <Field
                  id="search-exclusions"
                  label="Excluded title keywords (optional; one per line)"
                  error={errors.exclusions}
                >
                  <textarea
                    value={exclusionsText}
                    maxLength={3000}
                    onChange={(event) => {
                      setExclusionsText(event.target.value);
                      change("exclusions", split(event.target.value));
                    }}
                  />
                </Field>
              </div>
              <div className="field">
                <label id="sources-label">Job sites (required)</label>
                <div className="source-options" role="group" aria-labelledby="sources-label">
                  {Object.entries(sources).map(([value, label]) => (
                    <label className="source-choice" key={value}>
                      <input
                        type="checkbox"
                        checked={draft.sources.includes(value as keyof typeof sources)}
                        disabled={
                          draft.sources.length === 1 &&
                          draft.sources.includes(value as keyof typeof sources)
                        }
                        onChange={(event) =>
                          change(
                            "sources",
                            event.target.checked
                              ? [...draft.sources, value as keyof typeof sources]
                              : draft.sources.filter((source) => source !== value),
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="short-field">
                <Field id="search-limit" label="Results per site (required)" error={errors.limit}>
                  <Choice
                    value={String(draft.limit)}
                    onChange={(value) => change("limit", Number(value))}
                    label="Results per site"
                    options={[10, 20, 30, 40, 50].map((value) => ({
                      value: String(value),
                      label: String(value),
                    }))}
                  />
                </Field>
              </div>
            </div>
          </div>
          <div className="form-section">
            <div className="section-intro">
              <h2>Search on your schedule</h2>
              <p>Scheduled searches run while this app is running.</p>
              {workspace.nextRun && (
                <span className="next-run">
                  <Clock3 />
                  Next: {dateText(workspace.nextRun)}
                </span>
              )}
            </div>
            <div className="form-content">
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={draft.scheduleEnabled}
                  onChange={(event) => change("scheduleEnabled", event.target.checked)}
                />
                <span>Enable scheduled searches (optional)</span>
              </label>
              <fieldset disabled={!draft.scheduleEnabled} className="schedule-fields">
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
              </fieldset>
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save search preferences"}
            </button>
            {dirty && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(workspace.preferences);
                  setDirty(false);
                  setErrors({});
                }}
              >
                Cancel
              </button>
            )}
            {saved && (
              <span className="saved" role="status">
                <Check />
                Preferences saved
              </span>
            )}
          </div>
        </fieldset>
      </form>
      {query && (
        <details className="query-details">
          <summary>Saved search query</summary>
          <pre>{query}</pre>
        </details>
      )}
      <div className="collection">
        <div className="collection-heading">
          <h2>Search history</h2>
          <button className="ghost" onClick={() => setHistoryRetry((v) => v + 1)}>
            Refresh
          </button>
        </div>
        {historyError ? (
          <div className="collection-body">
            <Alert onRetry={() => setHistoryRetry((v) => v + 1)}>{historyError}</Alert>
          </div>
        ) : !runs ? (
          <Busy label="Loading search history…" />
        ) : runs.length === 0 ? (
          <div className="empty-state compact">
            <Clock3 />
            <h3>No searches yet</h3>
            <p>Complete setup, then run your first search. Each run will appear here.</p>
          </div>
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
      </div>
    </>
  );
}
function SettingsPage({
  workspace,
  reload,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
}) {
  const [profile, setProfile] = useState(workspace.preferences.profile);
  const [threshold, setThreshold] = useState(String(workspace.preferences.threshold));
  const [profileDirty, setProfileDirty] = useState(false);
  const [model, setModel] = useState(workspace.connections.model);
  const [openaiKey, setOpenaiKey] = useState("");
  const [serpapiKey, setSerpapiKey] = useState("");
  const [keysDirty, setKeysDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");
  const confirm = useConfirm();
  useDraftWarning(profileDirty || keysDirty);
  useEffect(() => {
    if (!profileDirty) {
      setProfile(workspace.preferences.profile);
      setThreshold(String(workspace.preferences.threshold));
    }
  }, [workspace.preferences, profileDirty]);
  useEffect(() => {
    if (!keysDirty) setModel(workspace.connections.model);
  }, [workspace.connections.model, keysDirty]);
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const fields: Record<string, string> = {};
    if (profile.trim().length < 10)
      fields.profile = "Describe your experience and job requirements in at least 10 characters.";
    if (
      !threshold ||
      !Number.isInteger(Number(threshold)) ||
      Number(threshold) < 0 ||
      Number(threshold) > 100
    )
      fields.threshold = "Enter a whole number from 0 to 100.";
    if (Object.keys(fields).length) {
      setErrors(fields);
      document.getElementById("settings-" + Object.keys(fields)[0])?.focus();
      return;
    }
    setBusy("profile");
    setFailure("");
    try {
      await api("/api/preferences", "PUT", {
        ...workspace.preferences,
        profile,
        threshold: Number(threshold),
      });
      setProfileDirty(false);
      setErrors({});
      setSaved("profile");
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  };
  const saveKeys = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const change = { model, openaiKey, serpapiKey };
    const checked = connectionUpdateSchema.safeParse(change);
    const fields: Record<string, string> = {};
    if (!checked.success)
      for (const issue of checked.error.issues) fields[String(issue.path[0])] = issue.message;
    if (openaiKey && !/^[A-Za-z0-9_\-]+$/.test(openaiKey.trim()))
      fields.openaiKey = "Use an API key without spaces or line breaks.";
    if (serpapiKey && !/^[A-Za-z0-9_\-]+$/.test(serpapiKey.trim()))
      fields.serpapiKey = "Use an API key without spaces or line breaks.";
    if ((workspace.connections.openai || openaiKey.trim()) && !model.trim())
      fields.model = "Enter a model ID available in your OpenAI account.";
    if (Object.keys(fields).length) {
      setErrors(fields);
      document
        .getElementById(
          fields.openaiKey ? "openai-key" : fields.serpapiKey ? "serpapi-key" : "openai-model",
        )
        ?.focus();
      return;
    }
    if (!checked.success) return;
    setErrors({});
    setBusy("keys");
    setFailure("");
    try {
      await api("/api/connections", "PUT", checked.data);
      setOpenaiKey("");
      setSerpapiKey("");
      setKeysDirty(false);
      setSaved("keys");
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  };
  const removeKey = async (provider: "OpenAI" | "SerpApi") => {
    if (
      busy ||
      !(await confirm({
        title: `Remove ${provider} key?`,
        description: `Remove the saved ${provider} key from this installation? Scheduled searches will be disabled until setup is complete again.`,
        action: "Remove key",
        destructive: true,
      }))
    )
      return;
    setBusy("keys");
    try {
      await api("/api/connections", "PUT", {
        model: workspace.connections.model,
        ...(provider === "OpenAI" ? { removeOpenai: true } : { removeSerpapi: true }),
      });
      setSaved("");
      await reload();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      {failure && <Alert>{failure}</Alert>}
      <form className="preferences-form" onSubmit={(event) => void saveProfile(event)} noValidate>
        <fieldset disabled={Boolean(busy) || workspace.running}>
          <div className="form-section">
            <div className="section-intro">
              <h2>Your profile</h2>
              <p>Describe your experience, location, and the roles you want.</p>
            </div>
            <div className="form-content">
              <Field
                id="settings-profile"
                label="Experience and job requirements (required)"
                error={errors.profile}
              >
                <textarea
                  className="profile-input"
                  value={profile}
                  maxLength={12000}
                  onChange={(event) => {
                    setProfile(event.target.value);
                    setProfileDirty(true);
                    setSaved("");
                    setErrors((v) => ({ ...v, profile: "" }));
                  }}
                />
              </Field>
              <div className="short-field">
                <Field
                  id="settings-threshold"
                  label="Minimum match score (required)"
                  error={errors.threshold}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="100"
                    step="1"
                    value={threshold}
                    onChange={(event) => {
                      setThreshold(event.target.value);
                      setProfileDirty(true);
                      setSaved("");
                      setErrors((v) => ({ ...v, threshold: "" }));
                    }}
                  />
                </Field>
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={!profileDirty || Boolean(busy)}>
              {busy === "profile" ? "Saving…" : "Save profile"}
            </button>
            {profileDirty && (
              <button
                type="button"
                onClick={() => {
                  setProfileDirty(false);
                  setErrors({});
                }}
              >
                Cancel
              </button>
            )}
            {saved === "profile" && (
              <span className="saved" role="status">
                <Check />
                Profile saved
              </span>
            )}
          </div>
        </fieldset>
      </form>
      <form className="preferences-form" onSubmit={(event) => void saveKeys(event)} noValidate>
        <fieldset disabled={Boolean(busy) || workspace.running}>
          <div className="form-section">
            <div className="section-intro">
              <h2>Connections</h2>
              <p>
                Use your own provider accounts. Keys stay on the server and are never sent back to
                this browser.
              </p>
            </div>
            <div className="form-content">
              <div className="provider-heading">
                <span className="provider-name">
                  <Sparkles />
                  OpenAI
                </span>
                <span className={workspace.connections.openai ? "badge connected" : "badge"}>
                  {workspace.connections.openai ? "Key saved" : "Not configured"}
                </span>
              </div>
              <Field
                id="openai-key"
                label="OpenAI API key (optional; blank keeps the saved key)"
                error={errors.openaiKey}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={openaiKey}
                  maxLength={500}
                  onChange={(event) => {
                    setOpenaiKey(event.target.value);
                    setKeysDirty(true);
                    setSaved("");
                  }}
                />
              </Field>
              <Field
                id="openai-model"
                label="OpenAI model ID (required for scoring)"
                error={errors.model}
              >
                <input
                  type="text"
                  autoComplete="off"
                  value={model}
                  maxLength={150}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setKeysDirty(true);
                    setSaved("");
                  }}
                />
              </Field>
              {workspace.connections.openai && (
                <button
                  className="ghost danger-text align-start"
                  type="button"
                  onClick={() => void removeKey("OpenAI")}
                >
                  Remove OpenAI key
                </button>
              )}
              <div className="provider-heading provider-separator">
                <span className="provider-name">
                  <SearchIcon />
                  SerpApi
                </span>
                <span className={workspace.connections.serpapi ? "badge connected" : "badge"}>
                  {workspace.connections.serpapi ? "Key saved" : "Not configured"}
                </span>
              </div>
              <Field
                id="serpapi-key"
                label="SerpApi key (optional; blank keeps the saved key)"
                error={errors.serpapiKey}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={serpapiKey}
                  maxLength={500}
                  onChange={(event) => {
                    setSerpapiKey(event.target.value);
                    setKeysDirty(true);
                    setSaved("");
                  }}
                />
              </Field>
              {workspace.connections.serpapi && (
                <button
                  className="ghost danger-text align-start"
                  type="button"
                  onClick={() => void removeKey("SerpApi")}
                >
                  Remove SerpApi key
                </button>
              )}
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={!keysDirty || Boolean(busy)}>
              {busy === "keys" ? "Saving…" : "Save connections"}
            </button>
            {keysDirty && (
              <button
                type="button"
                onClick={() => {
                  setOpenaiKey("");
                  setSerpapiKey("");
                  setKeysDirty(false);
                }}
              >
                Cancel
              </button>
            )}
            {saved === "keys" && (
              <span className="saved" role="status">
                <Check />
                Connections saved
              </span>
            )}
          </div>
        </fieldset>
      </form>
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

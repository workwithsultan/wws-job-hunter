import { InteractionProvider, useInteractionState, useActivity } from "./interaction";
import { countryEmoji, workTypeEmoji } from "../src/shared/emoji";
import { matchScoreLabel } from "../src/shared/assessment";
import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  Pencil,
  Search as SearchIcon,
  Settings2,
  ScrollText,
  Handshake,
  Info,
  Monitor,
  Sun,
  Moon,
  Trash2,
} from "lucide-react";
import {
  applicationStatuses,
  preferencesSchema,
  sources,
  statusLabels,
  visibleJobStatuses,
  type Job,
  type JobList,
  type JobStatus,
  type Preferences,
  type Workspace,
} from "../src/shared/model";
import { countries } from "../src/shared/countries";
import { countryName, workTypes, searchWindows } from "../src/shared/search-scope";
import { searchBudget } from "../src/shared/budget";
import { ResumeImport } from "./resume-import";
import { ProviderSettings } from "./providers";
import { api, ApiError, dateText } from "./api";
import {
  ActionHint,
  Emoji,
  PendingLabel,
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
import { SearchLogs } from "./search-logs";
import { JobQuota } from "./job-quota";
import { SearchProgress } from "./search-progress";
import "./style.css";

const storedTheme = localStorage.getItem("jobHunterAppearance") ?? "system";
if (storedTheme !== "system") document.documentElement.dataset.theme = storedTheme;
const nav = [
  { path: "/jobs", label: "Jobs", emoji: "💼", icon: BriefcaseBusiness },
  { path: "/applications", label: "Applications", emoji: "📋", icon: FileText },
  { path: "/logs", label: "Search logs", emoji: "📜", icon: ScrollText },
  { path: "/settings", label: "Settings", emoji: "⚙️", icon: Settings2 },
];
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The action could not be completed. Try again.";
function missingSetup(workspace: Workspace) {
  return {
    profile: workspace.preferences.profile.trim().length < 10,
    roles: !workspace.preferences.roles.length,
    providers:
      !workspace.connections.openrouter ||
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutTrigger = useRef<HTMLButtonElement | null>(null);
  const [starting, setStarting] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [searchRunId, setSearchRunId] = useState<number | null>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const setupFocusTarget = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRequest = useRef(0);
  useActivity(refreshing, "busy");
  useActivity(starting, "write");
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const interaction = useInteractionState();
  const reload = useCallback(async () => {
    const request = ++refreshRequest.current;
    setRefreshing(true);
    try {
      const data = await api<Workspace>("/api/workspace");
      if (request !== refreshRequest.current) return;
      setWorkspace(data);
      setFailure("");
      setVersion((value) => value + 1);
    } catch (error) {
      if (request === refreshRequest.current) throw error;
    } finally {
      if (request === refreshRequest.current) setRefreshing(false);
    }
  }, []);
  const refresh = useCallback(() => {
    void reload().catch((error) => setFailure(errorMessage(error)));
  }, [reload]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (!workspace?.running) return;
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, [workspace?.running, refresh]);
  useEffect(() => {
    if (location.pathname === "/") navigate("/jobs", { replace: true });
    if (location.pathname === "/search") navigate("/settings" + location.hash, { replace: true });
    setMobileMenu(false);
    window.scrollTo(0, 0);
    document.title =
      (nav.find((item) => item.path === location.pathname)?.label ?? "Job Hunter") +
      " · Job Hunter";
    const frame = requestAnimationFrame(() =>
      document.getElementById("main")?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, navigate]);
  useEffect(() => {
    if (workspace?.running && workspace.lastRun && searchRunId === null) {
      setSearchRunId(workspace.lastRun.id);
      setProgressOpen(true);
    }
  }, [workspace, searchRunId]);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (wide.matches) setMobileMenu(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  const appearance = (value: string) => {
    setTheme(value);
    localStorage.setItem("jobHunterAppearance", value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  };
  const start = async () => {
    if (!workspace || starting || workspace.running || interaction.busy) return;
    if (Object.values(missingSetup(workspace)).some(Boolean)) {
      setupFocusTarget.current = null;
      setSetupOpen(true);
      return;
    }
    if (interaction.dirty) return;
    setStarting(true);
    try {
      const quota = await api<import("../src/shared/model").SerpQuota>(
        "/api/serpapi/quota?refresh=true",
      );
      const budget = searchBudget(quota, workspace.preferences);
      if (!quota.complete)
        throw new Error("Check your SerpApi connection in Settings before searching.");
      if (!budget.remaining)
        throw new Error("No SerpApi requests remain. Check your accounts in Settings.");
      if (!quota.accounts.some((account) => account.remaining > 0 && account.hourlyRemaining !== 0))
        throw new Error("The SerpApi hourly limit has been reached. Try again after it resets.");
      if (
        !(await confirm({
          title: "Start a job search?",
          emoji: "🔎",
          details: [
            { label: "Job titles", value: workspace.preferences.roles.join(", ") },
            { label: "Country", value: countryName(workspace.preferences.country) },
            { label: "Work type", value: workTypes[workspace.preferences.workType] },
            { label: "Search window", value: searchWindows[workspace.preferences.searchWindow] },
            { label: "Search engine", value: "DuckDuckGo via SerpApi" },
            { label: "AI model", value: workspace.connections.model },
          ],
          description: `Estimated usage: ${budget.searchesPerRun} SerpApi requests before retries.${budget.aboveTarget ? ` Your daily target is ${budget.dailyTarget}.` : ""} Your resume text and job descriptions will be sent through OpenRouter to the selected model provider for matching.`,
          action: "Start search",
        }))
      )
        return;
      const { id } = await api<{ id: number }>("/api/runs", "POST", {});
      setSearchRunId(id);
      setProgressOpen(true);
      setWorkspace((value) => (value ? { ...value, running: true } : value));
      await reload();
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
  useEffect(() => {
    if (!location.hash) return;
    const main = document.getElementById("main");
    if (!main) return;
    const focus = () => {
      const target = document.getElementById(location.hash.slice(1));
      if (!target || target.matches(":disabled")) return;
      const current = document.activeElement;
      if (current === document.body || current === main || current === target) target.focus();
      observer.disconnect();
    };
    const observer = new MutationObserver(focus);
    observer.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    const frame = requestAnimationFrame(focus);
    const timeout = setTimeout(() => observer.disconnect(), 10000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [location.pathname, location.hash]);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const utilityControls = (
    <div className="utility-controls">
      <button
        type="button"
        className="ghost about-button"
        onClick={(event) => {
          aboutTrigger.current = event.currentTarget;
          setAboutOpen(true);
        }}
      >
        <Info aria-hidden="true" /> About
      </button>
      <Choice
        value={theme}
        onChange={appearance}
        label="Appearance"
        triggerIcon={<ThemeIcon aria-hidden="true" />}
        options={[
          { value: "system", label: "System theme" },
          { value: "light", label: "Light theme" },
          { value: "dark", label: "Dark theme" },
        ]}
      />
    </div>
  );
  const current = nav.find((item) => item.path === location.pathname);
  const incomplete = workspace ? Object.values(missingSetup(workspace)).some(Boolean) : true;
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
          <div className="sidebar-bottom">{utilityControls}</div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button ghost mobile-menu"
                aria-label="Open navigation"
                aria-expanded={mobileMenu}
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
                <h1>
                  {current && <Emoji>{current.emoji}</Emoji>}
                  {current?.label ?? "Page not found"}
                </h1>
              </div>
              {workspace && location.pathname === "/jobs" && (
                <div className="heading-actions">
                  <button
                    className="primary"
                    ref={searchTrigger}
                    disabled={
                      workspace.running ||
                      starting ||
                      interaction.busy ||
                      (!incomplete && interaction.dirty)
                    }
                    aria-describedby={
                      !incomplete && interaction.dirty ? "search-draft-reason" : undefined
                    }
                    onClick={() => void start()}
                  >
                    {workspace.running ? <Clock3 /> : <Play />}
                    <PendingLabel
                      pending={starting}
                      busy="Preparing search…"
                      idle={workspace.running ? "Searching…" : "Search jobs"}
                    />
                  </button>
                  {!incomplete && interaction.dirty && (
                    <ActionHint label="Why search is unavailable">
                      Save or cancel your changes before starting a search.
                    </ActionHint>
                  )}
                </div>
              )}
            </div>
            {!incomplete && interaction.dirty && (
              <span id="search-draft-reason" className="sr-only">
                Save or cancel your changes before starting a search.
              </span>
            )}
            {failure && (
              <Alert onRetry={refresh} retrying={refreshing}>
                {failure}
              </Alert>
            )}
            {!workspace && !failure && <Busy />}
            {workspace && (
              <>
                <section hidden={location.pathname !== "/jobs"} className="page-content">
                  <JobsPage
                    workspace={workspace}
                    version={version}
                    reload={reload}
                    applications={false}
                    active={location.pathname === "/jobs"}
                  />
                </section>
                <section hidden={location.pathname !== "/applications"} className="page-content">
                  <JobsPage
                    workspace={workspace}
                    version={version}
                    reload={reload}
                    applications
                    active={location.pathname === "/applications"}
                  />
                </section>
                <section hidden={location.pathname !== "/logs"} className="page-content">
                  <SearchLogs
                    active={location.pathname === "/logs"}
                    version={version}
                    timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
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
      <SearchProgress
        open={progressOpen}
        run={workspace?.lastRun?.id === searchRunId ? workspace.lastRun : null}
        failure={failure}
        onRetry={refresh}
        onClose={() => setProgressOpen(false)}
        onLogs={() => {
          setProgressOpen(false);
          navigate("/logs");
        }}
        returnFocus={() => searchTrigger.current?.focus()}
      />
      <Modal open={mobileMenu} onClose={() => setMobileMenu(false)} title="Job Hunter" drawer>
        {navigation}
        <div className="mobile-appearance">{utilityControls}</div>
      </Modal>
      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="About Job Hunter"
        returnFocus={() => aboutTrigger.current?.focus()}
      >
        <section className="about-intro" aria-labelledby="about-personal-note">
          <h3 id="about-personal-note">A note from the creator</h3>
          <p>
            As an Indonesian from a developing country, I landed a remote US job using this
            approach.
          </p>
          <p>
            The key: keep improving your resume, stay consistent, and aim for 200 carefully filtered
            applications.
          </p>
        </section>
        <ol className="about-content">
          <li>
            <h3>The problem</h3>
            <p>
              Job boards can feel like a race: listings may be old, reposted or already attracting
              heavy interest. Imagine a LinkedIn listing showing hundreds of applicants, only for
              Apply to send you to the employer's own application page. Displayed interest does not
              always mean completed applications.
            </p>
          </li>
          <li>
            <h3>Start closer to the source</h3>
            <p>
              Employers manage openings on careers sites and applicant tracking systems (ATS), which
              can also distribute posts to other job boards. Our philosophy: look at those
              employer-hosted postings directly, rather than wait to encounter a repost. Earlier
              discovery is the goal, not a guarantee of fewer applicants.
            </p>
          </li>
          <li>
            <h3>How we search</h3>
            <p>
              Your job titles, country and work type become site-filtered DuckDuckGo queries.
              SerpApi finds results on Greenhouse, Lever, Ashby, Workable and Workday. We read the
              original postings, then AI compares them with your resume. Only confirmed matches
              reach Jobs.
            </p>
          </li>
          <li>
            <h3>A focused shortlist</h3>
            <p>
              Strict matching prioritizes relevance; a score is not a hiring probability. Jobs keeps
              your shortlist visible for 24 hours. That window is not a verified posting age. Apply
              on the original site, then track the application and notes in Applications.
            </p>
          </li>
          <li>
            <h3>Data and costs</h3>
            <p>
              Your data is stored locally. Queries go to SerpApi; extracted resume text and postings
              go through OpenRouter to your selected AI provider. One search can use multiple
              requests and AI credits. Provider limits and charges apply.
            </p>
          </li>
        </ol>
        <p className="about-sources">
          Community inspiration:{" "}
          <a
            href="https://www.reddit.com/r/recruitinghell/comments/1e9kg41/skip_linkedin_and_search_jobs_directly_from_ats/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Search ATS sites with Google
          </a>
          {" · "}
          <a
            href="https://www.reddit.com/r/jobsearchhacks/comments/1dkecdy/another_actual_job_search_hack/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Another job search hack
          </a>
        </p>
      </Modal>
      {workspace && (
        <Modal
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          returnFocus={() => {
            requestAnimationFrame(() => {
              if (setupFocusTarget.current)
                document.getElementById(setupFocusTarget.current)?.focus();
              else searchTrigger.current?.focus();
            });
          }}
          title="Finish setup to search"
          description="Complete these steps before starting your first job search."
        >
          <ul className="setup-list">
            {[
              {
                label: "Resume",
                done: !missingSetup(workspace).profile,
                action: "Add resume",
                target: "/settings#settings-resume",
              },
              {
                label: "OpenRouter key",
                done: workspace.connections.openrouter,
                action: "Connect OpenRouter",
                target: "/settings?tab=connections#openrouter-key",
              },
              {
                label: "AI model",
                done: Boolean(workspace.connections.model),
                blocked: !workspace.connections.openrouter,
                action: "Choose model",
                target: "/settings?tab=connections#openrouter-model",
              },
              {
                label: "SerpApi key",
                done: workspace.connections.serpapi,
                action: "Connect SerpApi",
                target: "/settings?tab=connections#serpapi-key",
              },
              {
                label: "Job titles",
                done: !missingSetup(workspace).roles,
                action: "Set job titles",
                target: "/settings#search-roles",
              },
            ].map((item) => (
              <li key={item.label}>
                {item.done ? (
                  <CheckCircle2 aria-hidden="true" className="setup-done" />
                ) : (
                  <CircleDashed aria-hidden="true" />
                )}
                <span>
                  {item.label}
                  <span className="sr-only">{item.done ? ": Complete" : ": Required"}</span>
                </span>
                {item.done ? (
                  <span className="setup-done">Ready</span>
                ) : item.blocked ? (
                  <span className="setup-blocked">Connect key first</span>
                ) : (
                  <Link
                    onClick={() => {
                      setupFocusTarget.current = item.target.split("#")[1] ?? null;
                      setSetupOpen(false);
                    }}
                    to={item.target}
                  >
                    {item.action}
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" onClick={() => setSetupOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {workspace && <JobDetail reload={reload} />}
    </>
  );
}
function JobsPage({
  reload,
  workspace,
  version,
  applications,
  active,
}: {
  workspace: Workspace;
  version: number;
  reload: () => Promise<void>;
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
  useEffect(() => {
    if (!active || applications) return;
    let disposed = false;
    const refreshOpportunities = () => {
      if (document.visibilityState !== "visible") return;
      void reload().catch((error) => {
        if (!disposed) setFailure(errorMessage(error));
      });
    };
    refreshOpportunities();
    const expiry = workspace.opportunitiesExpireAt;
    const timer = expiry
      ? window.setTimeout(
          refreshOpportunities,
          Math.max(0, new Date(expiry).getTime() - Date.now()) + 100,
        )
      : undefined;
    window.addEventListener("focus", refreshOpportunities);
    document.addEventListener("visibilitychange", refreshOpportunities);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshOpportunities);
      document.removeEventListener("visibilitychange", refreshOpportunities);
    };
  }, [active, applications, workspace.opportunitiesExpireAt, reload]);
  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "page") next.delete("page");
    next.delete("job");
    setParams(next, { replace: name === "q" });
  };
  const stats = [
    {
      label: "Applications",
      value: workspace.totals.applications,
      icon: FileText,
      tone: "applications",
    },
    {
      label: "Interviewed",
      value: workspace.totals.interviewing,
      icon: Clock3,
      tone: "interviews",
    },
    { label: "Offers", value: workspace.totals.offers, icon: Handshake, tone: "offers" },
  ];
  const total = applications ? workspace.totals.applications : workspace.totals.jobs;
  const setupIncomplete = Object.values(missingSetup(workspace)).some(Boolean);
  const searchNeedsAttention =
    workspace.lastRun?.status === "failed" ||
    workspace.lastRun?.status === "interrupted" ||
    workspace.lastRun?.status === "warnings";
  const queueCleared =
    !applications && workspace.totals.jobs === 0 && workspace.totals.applications > 0;
  const emptyTitle = workspace.running
    ? "Searching for opportunities"
    : queueCleared
      ? "No opportunities from the last 24 hours"
      : searchNeedsAttention
        ? workspace.lastRun?.status === "warnings"
          ? "Search completed with warnings"
          : "Your search needs attention"
        : workspace.lastRun?.status === "completed"
          ? "No opportunities from the last 24 hours"
          : setupIncomplete
            ? "No jobs yet"
            : "Ready for your first search";
  const emptyMessage = workspace.running
    ? "Your search is running. New jobs will appear here as they are saved."
    : queueCleared
      ? "Opportunities stay here for 24 hours. Your tracked applications remain in Applications."
      : searchNeedsAttention
        ? workspace.lastRun!.message
        : workspace.lastRun?.status === "completed"
          ? "Opportunities stay here for 24 hours. Run a search to check for recent roles, or review your search preferences."
          : setupIncomplete
            ? "Add your target roles and profile, then search for jobs that match what you’re looking for."
            : "Your setup is complete. Start a search to discover and assess new opportunities.";
  const emptyAction = workspace.running
    ? "View search progress"
    : queueCleared
      ? "View applications"
      : searchNeedsAttention
        ? "Review search logs"
        : setupIncomplete
          ? "Set up your search"
          : "Review search preferences";

  return (
    <div className={applications ? "applications-layout" : "jobs-layout"}>
      {applications && (
        <div className="stats">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div className={"stat stat-" + tone} key={label}>
              <div className="stat-top">
                <span>{label}</span>
                <Icon aria-hidden="true" />
              </div>
              <strong>{value.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      )}
      {!applications && <JobQuota workspace={workspace} active={active} />}
      <div className="collection">
        <div className="collection-heading">
          <h2>{applications ? "Your applications" : "Your opportunities"}</h2>
          <div className="collection-actions">
            {total > 0 && (
              <a
                className="button ghost"
                href={"/api/export?applications=" + String(applications)}
                download
              >
                <ArrowDownToLine />
                Export CSV
              </a>
            )}
            {!applications && <span className="collection-window">Last 24 hours</span>}
          </div>
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
                    ([key]) =>
                      key !== "new" &&
                      key !== "review" &&
                      key !== "not_a_fit" &&
                      (applications
                        ? applicationStatuses.includes(key as JobStatus)
                        : key === "ready"),
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
            <Link
              className="button primary"
              to={
                applications
                  ? "/jobs"
                  : workspace.running
                    ? "/logs"
                    : queueCleared
                      ? "/applications"
                      : searchNeedsAttention
                        ? "/logs"
                        : "/settings"
              }
            >
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
            <div
              className="table-scroll"
              role="region"
              aria-label={applications ? "Applications table" : "Jobs table"}
              tabIndex={0}
              aria-busy={loading}
            >
              <table className="jobs-table">
                <caption className="sr-only">
                  {applications ? "Saved applications" : "Saved job opportunities"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col" className="assessment-cell">
                      Score
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
                  {data.jobs.map((job) => {
                    const addedAt = applications
                      ? job.createdAt
                      : (job.opportunityAt ?? job.createdAt);
                    return (
                      <tr key={job.id}>
                        <td>
                          <a
                            className="job-title"
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {job.title}
                            <ArrowUpRight aria-hidden="true" />
                          </a>
                          <span className="mobile-source">
                            {sources[job.source]} ·{" "}
                            <time dateTime={addedAt}>
                              {new Date(addedAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </time>
                          </span>
                          <span
                            className={
                              "badge mobile-assessment assessment-" + (job.assessment ?? "pending")
                            }
                          >
                            {matchScoreLabel(job)}
                          </span>
                        </td>
                        <td className="assessment-cell">
                          <span className={"badge assessment-" + (job.assessment ?? "pending")}>
                            {matchScoreLabel(job)}
                          </span>
                        </td>
                        <td className="desktop-cell">{sources[job.source]}</td>
                        <td>
                          <div className="job-row-actions">
                            <JobStatusChoice
                              job={job}
                              reload={reload}
                              applications={applications}
                              filterStatus={status}
                            />
                            <Link
                              className="icon-button ghost job-edit"
                              aria-label={"Edit notes for " + job.title}
                              data-job-id={job.id}
                              to={{
                                search: new URLSearchParams({
                                  ...Object.fromEntries(params),
                                  job: String(job.id),
                                }).toString(),
                              }}
                            >
                              <Pencil aria-hidden="true" />
                            </Link>
                          </div>
                        </td>
                        <td className="desktop-cell">
                          <time dateTime={addedAt}>{dateText(addedAt)}</time>
                        </td>
                      </tr>
                    );
                  })}
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
    </div>
  );
}
function JobStatusChoice({
  job,
  reload,
  applications,
  filterStatus,
}: {
  job: Job;
  reload: () => Promise<void>;
  applications: boolean;
  filterStatus: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const confirm = useConfirm();
  const interaction = useInteractionState();
  useActivity(busy, "write");
  const change = async (value: string) => {
    if (busy || interaction.writing || value === job.status) return;
    const status = value as JobStatus;
    if (
      !(await confirm({
        title: "Change application status?",
        description: job.title,
        action: "Change status",
        details: [
          { label: "From", value: statusLabels[job.status] },
          { label: "To", value: statusLabels[status] },
        ],
      }))
    )
      return;
    setBusy(true);
    setFailure("");
    try {
      await api("/api/jobs/" + job.id, "PUT", { status, notes: job.notes });
      await reload();
      if (
        (applications ? !applicationStatuses.includes(status) : status !== "ready") ||
        (filterStatus && filterStatus !== status)
      )
        document.getElementById("main")?.focus({ preventScroll: true });
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={"job-status-control status-" + job.status} aria-busy={busy}>
      <Choice
        label={"Status for " + job.title + " (required)"}
        value={job.status}
        onChange={(value) => void change(value)}
        disabled={busy || interaction.writing}
        options={visibleJobStatuses}
      />
      {failure && <Alert>{failure}</Alert>}
    </div>
  );
}
function JobDetail({ reload }: { reload: () => Promise<void> }) {
  const [params, setParams] = useSearchParams();
  const id = params.get("job");
  const returnJobId = useRef(id);
  useEffect(() => {
    if (id) returnJobId.current = id;
  }, [id]);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<JobStatus>("new");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const interaction = useInteractionState();
  useEffect(() => {
    if (!id) {
      setJob(null);
      setNotes("");
      setStatus("new");
      setSaved(false);
      return;
    }
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
  const dirty = Boolean(id && job && (status !== job.status || notes !== job.notes));
  useDraftWarning(dirty);
  useActivity(busy, "write");
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
    if (!job || busy || interaction.writing || !dirty) return;
    if (
      !(await confirm({
        title: "Save job changes?",
        emoji: "💾",
        description: job.title,
        action: "Save changes",
        details: [
          { label: "Status", value: statusLabels[status] },
          {
            label: "Notes",
            value: notes ? `${notes.length.toLocaleString()} characters` : "No notes",
          },
        ],
      }))
    )
      return;
    setBusy(true);
    try {
      await api("/api/jobs/" + job.id, "PUT", { status, notes });
      setJob({ ...job, status, notes });
      setFailure("");
      await reload();
      setSaved(true);
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
      interaction.writing ||
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
      returnFocus={() =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const links = document.querySelectorAll<HTMLAnchorElement>(
              ".page-content:not([hidden]) [data-job-id]",
            );
            const target = [...links].find((link) => link.dataset.jobId === returnJobId.current);
            (target ?? document.getElementById("main"))?.focus({ preventScroll: true });
          }),
        )
      }
      open={Boolean(id)}
      onClose={() => void close()}
      title={job?.title ?? "Job details"}
      busy={busy}
    >
      {failure && <Alert>{failure}</Alert>}
      {!job && !failure && <Busy label="Loading job…" />}
      {job && (
        <form onSubmit={(event) => void save(event)} className="drawer-body">
          <div className="detail-meta">
            <span className="badge">{sources[job.source]}</span>
            <span className={"badge assessment-" + (job.assessment ?? "pending")}>
              {matchScoreLabel(job)}
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
              disabled={busy || interaction.writing}
              onChange={(value) => {
                setStatus(value as JobStatus);
                setSaved(false);
              }}
              label="Application status"
              options={visibleJobStatuses}
            />
          </Field>
          <Field id="jobNotes" label="Notes (optional)">
            <textarea
              value={notes}
              disabled={busy || interaction.writing}
              maxLength={12000}
              onChange={(event) => {
                setNotes(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <div className="form-actions">
            <button className="primary" disabled={busy || interaction.writing || !dirty}>
              <PendingLabel pending={busy} idle="Save changes" busy="Saving…" />
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
              disabled={busy || interaction.writing}
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
  active,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  active: boolean;
}) {
  const preferences = workspace.preferences;
  const [pending, setPending] = useState({ roles: false, exclusions: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const saving = useRef(false);
  const confirm = useConfirm();
  const interaction = useInteractionState();
  useDraftWarning(pending.roles || pending.exclusions);
  useActivity(busy, "write");
  useEffect(() => {
    if (!active || !preferences.roles.length || !workspace.connections.serpapi) {
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
  }, [active, preferences, workspace.connections.serpapi]);
  const change = async <K extends "roles" | "exclusions" | "country" | "workType" | "searchWindow">(
    key: K,
    value: Preferences[K],
    confirmed = false,
  ): Promise<boolean> => {
    if (saving.current || workspace.running || interaction.writing) return false;
    setSaved(false);
    const candidate = { ...preferences, [key]: value };
    const result = preferencesSchema.safeParse(candidate);
    if (!result.success || (key === "roles" && !candidate.roles.length)) {
      const message =
        !candidate.roles.length && key === "roles"
          ? "Keep at least one job title."
          : (result.error?.issues[0]?.message ?? "Check this setting.");
      setErrors((current) => ({ ...current, [key]: message }));
      requestAnimationFrame(() => document.getElementById("search-" + key)?.focus());
      return false;
    }
    const labels = {
      roles: "Job titles",
      exclusions: "Excluded keywords",
      country: "Country",
      workType: "Work type",
      searchWindow: "Search window",
    };
    const display =
      key === "country"
        ? countryName(candidate.country)
        : key === "workType"
          ? workTypes[candidate.workType]
          : key === "searchWindow"
            ? searchWindows[candidate.searchWindow]
            : (key === "roles" ? candidate.roles : candidate.exclusions).join(", ") || "None";
    saving.current = true;
    try {
      if (
        !confirmed &&
        !(await confirm({
          title: "Update " + labels[key].toLowerCase() + "?",
          description: "This change will be saved for future searches.",
          action: "Save",
          details: [{ label: labels[key], value: display }],
        }))
      )
        return false;
      setBusy(true);
      setSaved(false);
      setFailure("");
      setErrors((current) => ({ ...current, [key]: "" }));
      await api("/api/preferences/search", "PATCH", { [key]: value });
      await reload();
      setSaved(true);
      return true;
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length) setErrors(error.fields);
      else setFailure(errorMessage(error));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
      requestAnimationFrame(() => document.getElementById("search-" + key)?.focus());
    }
  };
  return (
    <>
      {failure && <Alert>{failure}</Alert>}
      <form onSubmit={(event) => event.preventDefault()} noValidate className="search-form">
        <fieldset disabled={workspace.running || busy || interaction.writing}>
          <section className="search-section search-keywords">
            <h2>
              <Emoji>🎯</Emoji>Job titles
            </h2>
            <div className="keyword-grid">
              <Field id="search-roles" label="Include (required)" error={errors.roles}>
                <ChipInput
                  value={preferences.roles}
                  onEditing={(value) => {
                    setPending((current) => ({ ...current, roles: value }));
                    if (value) setSaved(false);
                  }}
                  onChange={(value) => change("roles", value, true)}
                  onError={(message) => setErrors((current) => ({ ...current, roles: message }))}
                  label="Job title"
                />
              </Field>
              <Field id="search-exclusions" label="Exclude (optional)" error={errors.exclusions}>
                <ChipInput
                  value={preferences.exclusions}
                  onEditing={(value) => {
                    setPending((current) => ({ ...current, exclusions: value }));
                    if (value) setSaved(false);
                  }}
                  onChange={(value) => change("exclusions", value, true)}
                  onError={(message) =>
                    setErrors((current) => ({ ...current, exclusions: message }))
                  }
                  label="Excluded keyword"
                />
              </Field>
            </div>
          </section>
          <section className="search-section search-location">
            <h2>
              <Emoji>🌍</Emoji>Location and work type
            </h2>
            <div className="keyword-grid">
              <Field id="search-country" label="Country (required)" error={errors.country}>
                <Choice
                  value={preferences.country}
                  onChange={(value) => void change("country", value)}
                  label="Country"
                  options={[
                    { value: "any", label: "Any country", emoji: countryEmoji("any") },
                    ...Object.entries(countries).map(([value, label]) => ({
                      value,
                      label,
                      emoji: countryEmoji(value),
                    })),
                  ]}
                />
              </Field>
              <Field id="search-workType" label="Work type (required)" error={errors.workType}>
                <Choice
                  value={preferences.workType}
                  onChange={(value) => void change("workType", value as Preferences["workType"])}
                  label="Work type"
                  options={Object.entries(workTypes).map(([value, label]) => ({
                    value,
                    label,
                    emoji: workTypeEmoji[value as keyof typeof workTypes],
                  }))}
                />
              </Field>
            </div>
          </section>
          <section className="search-section">
            <Field
              id="search-searchWindow"
              label="Search window (required)"
              error={errors.searchWindow}
            >
              <Choice
                value={preferences.searchWindow}
                onChange={(value) =>
                  void change("searchWindow", value as Preferences["searchWindow"])
                }
                label="Search window"
                options={Object.entries(searchWindows).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </section>
          <section className="search-section search-sources" aria-labelledby="source-heading">
            <h2 id="source-heading">
              <Emoji>🔗</Emoji>Job sites
            </h2>
            <ul className="site-list">
              {Object.entries(sources).map(([domain, label]) => (
                <li key={domain}>{label}</li>
              ))}
            </ul>
          </section>
          {busy && <p role="status">Saving…</p>}
          {saved && (
            <p className="saved" role="status">
              <Check aria-hidden="true" />
              Saved
            </p>
          )}
        </fieldset>
      </form>
      {query && (
        <details className="query-details">
          <summary>Search query</summary>
          <pre>{query}</pre>
        </details>
      )}
    </>
  );
}
function ResumeSection({
  workspace,
  reload,
  active,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  active: boolean;
}) {
  const [readingResume, setReadingResume] = useState(false);
  const interaction = useInteractionState();
  useActivity(readingResume, "write");
  return (
    <section className="profile-form" aria-labelledby="resume-heading">
      <h2 id="resume-heading">
        <Emoji>📄</Emoji>Resume
      </h2>
      <ResumeImport
        active={active}
        onReadingChange={setReadingResume}
        disabled={workspace.running || readingResume || interaction.writing}
        resume={workspace.preferences.resume}
        available={workspace.resumeAvailable}
        onApply={async (value) => {
          await api("/api/resume", "PUT", value);
          await reload();
        }}
      />
    </section>
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
  const [params] = useSearchParams();
  const connections = params.get("tab") === "connections";
  const searchSetup = !connections;
  return (
    <div className="settings-layout">
      <nav className="settings-tabs" aria-label="Settings sections">
        <Link to="/settings" aria-current={searchSetup ? "page" : undefined}>
          Search setup
        </Link>
        <Link to="/settings?tab=connections" aria-current={connections ? "page" : undefined}>
          Connections
        </Link>
      </nav>
      <div hidden={!searchSetup} className="settings-search">
        <ResumeSection workspace={workspace} reload={reload} active={active && searchSetup} />
        <SearchPage workspace={workspace} reload={reload} active={active && searchSetup} />
      </div>
      <div hidden={!connections} className="settings-connections">
        <ProviderSettings workspace={workspace} reload={reload} active={active && connections} />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InteractionProvider>
      <BrowserRouter>
        <ConfirmationProvider>
          <App />
        </ConfirmationProvider>
      </BrowserRouter>
    </InteractionProvider>
  </StrictMode>,
);

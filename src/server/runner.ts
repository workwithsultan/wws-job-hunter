import { buildAssessmentPrompt } from "../shared/assessment-context.js";
import { OpenRouterClient, OpenRouterError, AssessmentOutputError } from "./openrouter.js";
import { Providers } from "./providers.js";
import { searchBudget } from "../shared/budget.js";
import { assessmentStatus } from "../shared/assessment.js";
import { discoverJobs } from "../discovery/serpapi.js";
import { matchesTitle } from "../discovery/search-query.js";
import { normalizeJobUrl } from "../discovery/url.js";
import { sourceDomains, type Preferences } from "../shared/model.js";
import { Configuration } from "./config.js";
import { Store } from "./store.js";
import { extractPosting, isJobUrl, PostingUnavailableError, PostingReadError } from "./extract.js";

export class Runner {
  running = false;
  updatingConnections = false;
  readonly providers: Providers;
  private task: Promise<void> | undefined;
  private cancellation: AbortController | undefined;
  constructor(
    private readonly store: Store,
    private readonly config: Configuration,
    providers?: Providers,
  ) {
    this.providers = providers ?? new Providers(config);
  }
  missing(preferences = this.store.preferences()): string[] {
    const connections = this.config.connectionStatus();
    return [
      ...(preferences.profile.trim().length < 10 ? ["Complete your profile"] : []),
      ...(!preferences.roles.length ? ["Add your target roles"] : []),
      ...(!connections.openrouter ? ["Save an OpenRouter API key"] : []),
      ...(!connections.serpapi ? ["Save a SerpApi key"] : []),
      ...(!connections.model ? ["Choose an OpenRouter model"] : []),
    ];
  }
  start(): number {
    if (this.updatingConnections)
      throw new Error("Wait for the provider connection update to finish.");
    if (this.running) throw new Error("A search is already running. Wait for it to finish.");
    const missing = this.missing();
    if (missing.length) throw new Error(missing.join(". ") + ".");
    const preferences = this.store.preferences();
    const credentials = this.config.values();
    const id = this.store.startRun();
    this.running = true;
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    this.task = this.execute(id, preferences, credentials, cancellation.signal).finally(() => {
      this.running = false;
      this.task = undefined;
      this.cancellation = undefined;
    });
    return id;
  }
  async stop(): Promise<void> {
    this.cancellation?.abort();
    await this.task;
  }
  private async execute(
    id: number,
    preferences: Preferences,
    credentials: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    const counts = { found: 0, added: 0, matches: 0 };
    let unassessed = 0;
    let handled = 0;
    let recordedFatalIssue = false;
    let stage = "connections";
    try {
      this.store.progress(id, counts, "Checking provider accounts…");
      signal.throwIfAborted();
      const models = await this.providers.models(credentials.OPENROUTER_API_KEY, true);
      signal.throwIfAborted();
      if (!models.includes(credentials.OPENROUTER_MODEL!))
        throw new OpenRouterError(
          "The selected model is unavailable for this key. Choose a model in Settings → Connections.",
        );
      stage = "quota";
      const quota = await this.providers.quota(true);
      signal.throwIfAborted();
      const keys = this.providers.searchKeys(quota);
      if (!keys.length) throw new Error("No SerpApi account has searches available.");
      const budget = searchBudget(quota, preferences);
      stage = "discovery";
      this.store.progress(id, counts, "Discovering jobs…");
      const discovered = await discoverJobs(
        keys.join(","),
        budget.queryBreadth,
        preferences.roles,
        sourceDomains,
        signal,
        preferences,
      );
      counts.found = discovered.length;
      let titleMatches = 0;
      let seen = 0;
      let excludedCount = 0;
      let assessed = 0;
      let rejected = 0;
      let unavailable = 0;
      for (const candidate of discovered) {
        signal.throwIfAborted();
        const url = normalizeJobUrl(candidate.link);
        if (!isJobUrl(url)) throw new Error("The provider returned an unsupported job URL.");
        if (this.store.has(url)) {
          seen++;
          if (this.store.hasValidatedOutcome(url)) handled++;
          continue;
        }
        const source = sourceDomains.find(
          (host) => new URL(url).hostname === host || new URL(url).hostname.endsWith("." + host),
        );
        if (!source) throw new Error("The job source is not supported.");
        this.store.insert({
          title: candidate.title,
          url,
          source,
          snippet: candidate.snippet,
          description: "",
          assessment: null,
          reason: "",
          status: "new",
        });
      }
      stage = "assessment";
      this.store.progress(id, counts, "Reading and assessing job descriptions…");
      const client = new OpenRouterClient(credentials.OPENROUTER_API_KEY!);
      const prompt = buildAssessmentPrompt(preferences);
      const pending = this.store.pending();
      for (const [index, job] of pending.entries()) {
        signal.throwIfAborted();
        this.store.progress(
          id,
          counts,
          `Reading and assessing job descriptions… ${index + 1} of ${pending.length}.`,
        );
        let description: string;
        let details: Record<string, unknown>;
        let title = job.title;
        try {
          const posting = await extractPosting(job.url, signal);
          description = posting.description;
          details = posting.details;
          title = posting.title || job.title;
          this.store.setPosting(job.id, title, description);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof PostingUnavailableError) {
            this.store.assess(job.id, {
              description: "",
              assessment: "not_a_match",
              score: 0,
              reason: error.message,
              status: "not_a_fit",
            });
            unavailable++;
            handled++;
          } else {
            unassessed++;
            this.store.recordIssue(id, job.id, {
              stage: "source",
              code: error instanceof PostingReadError ? error.code : "source_unreadable",
              httpStatus: error instanceof PostingReadError ? error.httpStatus : null,
              message:
                error instanceof PostingReadError
                  ? error.message
                  : "The posting did not provide readable job details.",
            });
          }
          continue;
        }
        const matched = preferences.roles.some((term) => matchesTitle(title, term));
        const excluded = preferences.exclusions.some((term) => matchesTitle(title, term));
        if (!matched || excluded) {
          handled++;
          if (excluded) excludedCount++;
          this.store.assess(job.id, {
            description,
            assessment: "not_a_match",
            score: 0,
            reason: excluded
              ? "Matched an excluded title keyword."
              : "Did not match selected title keywords.",
            status: "not_a_fit",
          });
          continue;
        }
        titleMatches++;
        let result: Awaited<ReturnType<OpenRouterClient["assess"]>>;
        try {
          result = await client.assess(
            credentials.OPENROUTER_MODEL!,
            prompt,
            { title, url: job.url, description, details },
            signal,
          );
        } catch (error) {
          signal.throwIfAborted();
          this.store.recordIssue(id, job.id, {
            stage: "ai",
            code: error instanceof AssessmentOutputError ? error.code : "ai_request_failed",
            httpStatus: error instanceof OpenRouterError ? error.httpStatus : null,
            message:
              error instanceof AssessmentOutputError || error instanceof OpenRouterError
                ? error.message
                : "The AI assessment could not be completed.",
          });
          if (error instanceof AssessmentOutputError) {
            unassessed++;
            continue;
          }
          recordedFatalIssue = true;
          throw error;
        }
        handled++;
        assessed++;
        if (result.verdict === "not_a_match") rejected++;
        const changed = this.store.assess(job.id, {
          description,
          assessment: result.verdict,
          score: result.score,
          reason: result.reason,
          status: assessmentStatus(result.verdict),
        });
        if (changed && result.verdict === "match") {
          counts.added++;
          counts.matches++;
        }
      }
      signal.throwIfAborted();
      const summary = `${counts.found} ATS postings found; ${titleMatches} passed title filters; ${excludedCount} excluded; ${seen} previously discovered; ${unavailable} unavailable; ${assessed} assessed; ${rejected} not a match; ${counts.matches} new ${counts.matches === 1 ? "match" : "matches"}.`;
      const message =
        summary +
        (unassessed
          ? ` ${unassessed} postings could not be assessed. Only confirmed matches are shown. Unassessed postings remain pending for a retry.`
          : "");
      this.store.progress(id, counts, message);
      this.store.finishRun(
        id,
        unassessed ? (handled ? "warnings" : "failed") : "completed",
        message,
      );
    } catch (error) {
      this.store.progress(id, counts, "Search stopped.");
      if (signal.aborted) {
        this.store.finishRun(
          id,
          "interrupted",
          "The app stopped this search. Saved jobs are kept for your next session.",
        );
        return;
      }
      if (!recordedFatalIssue)
        this.store.recordIssue(id, null, {
          stage: "search",
          code: `${stage}_failed`,
          httpStatus: error instanceof OpenRouterError ? error.httpStatus : null,
          message:
            error instanceof OpenRouterError
              ? error.message
              : `The ${stage} stage could not complete.`,
        });
      this.store.finishRun(
        id,
        handled ? "warnings" : "failed",
        stage === "connections"
          ? error instanceof Error
            ? error.message
            : "OpenRouter could not be verified. Check Settings → Connections."
          : stage === "quota"
            ? "SerpApi quota could not be verified, or no searches are available right now. Check your accounts in Settings."
            : stage === "discovery"
              ? "Discovery could not complete. Check SerpApi credentials, quota, and provider availability. No successful empty result is assumed."
              : error instanceof OpenRouterError
                ? error.message + " Unprocessed jobs remain available for the next search."
                : "AI assessment could not complete. Check your OpenRouter key, model access, and credits. Unprocessed jobs remain available for the next search.",
      );
    }
  }
}

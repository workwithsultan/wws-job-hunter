import { buildAssessmentPrompt } from "./assessment-prompt.js";
import { OpenRouterClient, OpenRouterError } from "./openrouter.js";
import { Providers } from "./providers.js";
import { searchBudget } from "../shared/budget.js";
import { assessmentStatus } from "../shared/assessment.js";
import { discoverJobs } from "../discovery/serpapi.js";
import { matchesTitle } from "../discovery/search-query.js";
import { normalizeJobUrl } from "../discovery/url.js";
import { sourceDomains, type Preferences } from "../shared/model.js";
import { Configuration } from "./config.js";
import { Store } from "./store.js";
import { extractDescription, isJobUrl } from "./extract.js";

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
        budget.limitPerSource,
        preferences.roles,
        sourceDomains,
        signal,
        preferences,
      );
      counts.found = discovered.length;
      for (const candidate of discovered) {
        signal.throwIfAborted();
        const url = normalizeJobUrl(candidate.link);
        if (!isJobUrl(url)) throw new Error("The provider returned an unsupported job URL.");
        if (this.store.has(url)) continue;
        const source = sourceDomains.find(
          (host) => new URL(url).hostname === host || new URL(url).hostname.endsWith("." + host),
        );
        if (!source) throw new Error("The job source is not supported.");
        const excluded = preferences.exclusions.some((term) => matchesTitle(candidate.title, term));
        const matched = preferences.roles.some((term) => matchesTitle(candidate.title, term));
        if (!matched) continue;
        this.store.insert({
          title: candidate.title,
          url,
          source,
          snippet: candidate.snippet,
          description: "",
          assessment: excluded ? "not_a_match" : null,
          reason: excluded ? "Matched an excluded title keyword." : "",
          status: excluded ? "not_a_fit" : "new",
        });
      }
      stage = "assessment";
      this.store.progress(id, counts, "Reading and assessing job descriptions…");
      const client = new OpenRouterClient(credentials.OPENROUTER_API_KEY!);
      const prompt = buildAssessmentPrompt(preferences);
      for (const job of this.store.pending()) {
        signal.throwIfAborted();
        this.store.progress(id, counts, "Reading and assessing job descriptions…");
        let description: string;
        try {
          description = await extractDescription(job.url, signal);
        } catch {
          signal.throwIfAborted();
          unassessed++;
          continue;
        }
        const result = await client.assess(
          credentials.OPENROUTER_MODEL!,
          prompt,
          { title: job.title, url: job.url, description },
          signal,
        );
        if (!result) {
          unassessed++;
          continue;
        }
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
      const message = unassessed
        ? `${unassessed} postings could not be assessed. Only confirmed matches are shown. Unassessed postings remain pending for a retry.`
        : "Search complete.";
      this.store.progress(id, counts, message);
      this.store.finishRun(id, unassessed ? "failed" : "completed", message);
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
      this.store.finishRun(
        id,
        "failed",
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

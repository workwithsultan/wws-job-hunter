import { normalizeJobUrl, isJobPostingUrl } from "./url.js";
import { defaultSearchScope, searchRegion, type SearchScope } from "../shared/search-scope.js";
import { setTimeout as delay } from "node:timers/promises";
import type { JobCandidate } from "./types.js";
import { ATS_CORE_DISCOVERY_DOMAINS } from "./constants.js";
import { buildFirstPageSearchQueries, buildAtsQuery as buildQuery } from "./search-query.js";

const SERPAPI_FETCH_ATTEMPTS = 4;
const SERPAPI_FETCH_TIMEOUT_MS = 60000;
const SERPAPI_RETRY_BASE_DELAY_MS = 5000;

interface SerpApiResponse {
  error?: string;
  search_metadata?: { status?: string };
  search_information?: { organic_results_state?: string; total_results?: number };
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
}

export class SerpApiQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpApiQuotaError";
  }
}

export function isSerpApiQuotaError(error: unknown): boolean {
  return error instanceof SerpApiQuotaError;
}

class SerpApiKeyPool {
  private keys: string[];
  private activeIndex = 0;

  constructor(rawApiKeys: string) {
    const keys = rawApiKeys
      .split(/[\s,;]+/)
      .map((key) => key.trim())
      .filter(Boolean);
    this.keys = Array.from(new Set(keys));

    if (this.keys.length === 0) {
      throw new Error("SerpApi discovery requires at least one API key.");
    }
  }

  currentKey(): string {
    return this.keys[this.activeIndex] || "";
  }

  totalKeys(): number {
    return this.keys.length;
  }

  activeKeyNumber(): number {
    return this.activeIndex + 1;
  }

  rotateAfterQuota(domain: string): boolean {
    if (this.activeIndex >= this.keys.length - 1) {
      return false;
    }

    const previousKeyNumber = this.activeKeyNumber();
    this.activeIndex += 1;
    console.warn(
      `[Discovery] SerpApi key ${previousKeyNumber}/${this.totalKeys()} reached quota while searching ${domain}; switching to key ${this.activeKeyNumber()}/${this.totalKeys()}.`,
    );
    return true;
  }
}

export { buildQuery };

export function resultMatchesDomain(link: string, domain: string): boolean {
  try {
    const url = new URL(normalizeJobUrl(link));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase();
    const normalizedDomain = domain.toLowerCase();
    return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
  } catch {
    return false;
  }
}

function isQuotaError(status: number, body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    status === 429 ||
    normalized.includes("quota") ||
    normalized.includes("searches for the month") ||
    normalized.includes("monthly searches") ||
    normalized.includes("run out of searches") ||
    normalized.includes("exhausted")
  );
}

function isNoResultsError(body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    normalized.includes("hasn't returned any results") ||
    normalized.includes("has not returned any results")
  );
}

function sourceLabelForDomain(domain: string): string {
  switch (domain) {
    case "boards.greenhouse.io":
      return "SerpApi: Greenhouse";
    case "jobs.lever.co":
      return "SerpApi: Lever";
    case "jobs.ashbyhq.com":
      return "SerpApi: Ashby";
    case "apply.workable.com":
      return "SerpApi: Workable";
    case "myworkdayjobs.com":
      return "SerpApi: Workday";
    case "applytojob.com":
      return "SerpApi: JazzHR";
    case "jobs.breezy.hr":
      return "SerpApi: BreezyHR";
    case "fountain.com":
      return "SerpApi: Fountain";
    case "bamboohr.com":
      return "SerpApi: BambooHR";
    default:
      return `SerpApi: ${domain}`;
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(ms, undefined, signal ? { signal } : {});
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchSerpApiResponse(
  url: URL,
  domain: string,
  start: number,
  signal?: AbortSignal,
): Promise<{
  status: number;
  ok: boolean;
  payload: SerpApiResponse;
}> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SERPAPI_FETCH_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, SERPAPI_FETCH_TIMEOUT_MS);

    try {
      // A fresh search must replace poisoned cached results on retries.
      if (attempt > 1) url.searchParams.set("no_cache", "true");
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      });

      const body = await response.text();
      const parsed = JSON.parse(body) as SerpApiResponse;
      const confirmedEmpty =
        response.ok &&
        parsed.search_metadata?.status === "Success" &&
        parsed.error &&
        isNoResultsError(parsed.error);
      if (isQuotaError(response.status, parsed.error ?? "") || confirmedEmpty) {
        return { status: response.status, ok: response.ok, payload: parsed };
      }

      if (!response.ok) {
        if (!isRetryableHttpStatus(response.status)) {
          return { status: response.status, ok: false, payload: parsed };
        }
        throw new Error(`HTTP ${response.status}`);
      }
      if (parsed.error || parsed.search_metadata?.status !== "Success") {
        throw new Error("The search provider did not complete the search successfully.");
      }
      const results = parsed.organic_results ?? [];
      if (!Array.isArray(results))
        throw new Error("The search provider returned an invalid result list.");
      if (
        results.length === 0 &&
        parsed.search_information?.total_results !== 0 &&
        parsed.search_information?.organic_results_state?.toLowerCase() !== "fully empty"
      ) {
        throw new Error("The search provider omitted results without confirming an empty search.");
      }
      const invalidCount = results.filter(
        (result) =>
          typeof result.title !== "string" ||
          !result.title.trim() ||
          typeof result.link !== "string" ||
          !resultMatchesDomain(result.link, domain),
      ).length;
      if (invalidCount > 0) {
        throw new Error(
          `The search provider returned ${invalidCount}/${results.length} invalid or off-domain results.`,
        );
      }
      return { status: response.status, ok: true, payload: parsed };
    } catch (error) {
      if (signal?.aborted) throw error;
      // Never include request URLs, credentials, or provider response bodies in logs.
      lastError =
        error instanceof SyntaxError
          ? new Error("The search provider returned invalid JSON.")
          : error;
      if (attempt === SERPAPI_FETCH_ATTEMPTS) {
        break;
      }

      const delayMs = SERPAPI_RETRY_BASE_DELAY_MS * attempt;
      console.warn(
        `[Discovery] SerpApi request for ${domain} page start ${start} failed: ${errorMessage(lastError)}; retrying a fresh search, attempt ${attempt + 1}/${SERPAPI_FETCH_ATTEMPTS}, in ${delayMs}ms.`,
      );
      await sleep(delayMs, signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`SerpApi request failed for ${domain} page start ${start}.`);
}

async function fetchSerpApiPage(args: {
  keyPool: SerpApiKeyPool;
  domain: string;
  limit: number;
  queryBody: string;
  scope: SearchScope;
  signal?: AbortSignal | undefined;
}): Promise<JobCandidate[]> {
  const { keyPool, domain, limit, queryBody, scope, signal } = args;
  const pageSize = 35;
  const jobs: JobCandidate[] = [];
  const sourceLabel = sourceLabelForDomain(domain);

  for (let start = 0; start < limit; start += pageSize) {
    signal?.throwIfAborted();
    let payload: SerpApiResponse | null = null;
    for (let attempt = 1; attempt <= keyPool.totalKeys(); attempt += 1) {
      const params = new URLSearchParams({
        engine: "duckduckgo",
        api_key: keyPool.currentKey(),
        q: buildQuery(domain, queryBody),
        m: String(Math.min(pageSize, limit - start)),
      });
      const region = searchRegion(scope);
      if (region) params.set("kl", region);
      if (scope.searchWindow && scope.searchWindow !== "any") params.set("df", scope.searchWindow);
      if (start > 0) params.set("start", String(start));

      const response = await fetchSerpApiResponse(
        new URL(`https://serpapi.com/search.json?${params.toString()}`),
        domain,
        start,
        signal,
      );
      const parsed = response.payload;
      const providerError = parsed.error ?? "";

      if (isQuotaError(response.status, providerError)) {
        if (keyPool.rotateAfterQuota(domain)) continue;
        throw new SerpApiQuotaError(
          `All configured SerpApi keys are exhausted while searching ${domain}.`,
        );
      }

      if (!response.ok) {
        if (isNoResultsError(providerError)) {
          console.warn(
            `[Discovery] ${sourceLabel} query returned no matching results at page start ${start}; ending this query.`,
          );
          return jobs;
        }

        throw new Error(`SerpApi failed for ${domain}: HTTP ${response.status}.`);
      }

      if (parsed.error) {
        if (isNoResultsError(parsed.error)) {
          console.warn(
            `[Discovery] ${sourceLabel} query returned no matching results at page start ${start}; ending this query.`,
          );
          return jobs;
        }

        throw new Error(`SerpApi failed for ${domain}: the provider reported a search error.`);
      }

      payload = parsed;
      break;
    }

    if (!payload) {
      throw new SerpApiQuotaError(
        `All configured SerpApi keys are exhausted while searching ${domain}.`,
      );
    }

    const organicResults = payload.organic_results ?? [];
    const pageJobs = organicResults
      .filter((result) => result.title && result.link)
      .filter(
        (result) => resultMatchesDomain(result.link!, domain) && isJobPostingUrl(result.link!),
      )
      .map((result) => ({
        title: result.title!.trim(),
        link: result.link!.trim(),
        snippet: result.snippet?.trim() || "",
        source: sourceLabel,
      }));

    jobs.push(...pageJobs);

    if (pageJobs.length < pageSize) {
      break;
    }
  }

  return jobs;
}

export async function discoverJobs(
  apiKey: string,
  queryBreadth: number,
  discoveryTitleTerms: readonly string[],
  domains: readonly string[] = ATS_CORE_DISCOVERY_DOMAINS,
  signal?: AbortSignal,
  scope: SearchScope = defaultSearchScope,
): Promise<JobCandidate[]> {
  signal?.throwIfAborted();
  const keyPool = new SerpApiKeyPool(apiKey);
  const allResults: JobCandidate[][] = [];

  for (const domain of domains) {
    signal?.throwIfAborted();
    try {
      const queries = buildFirstPageSearchQueries(discoveryTitleTerms, queryBreadth, scope);
      const jobs = new Map<string, JobCandidate>();
      for (const queryBody of queries) {
        const page = await fetchSerpApiPage({
          keyPool,
          domain,
          limit: 35,
          queryBody,
          scope,
          signal,
        });
        for (const job of page) {
          const link = normalizeJobUrl(job.link);
          jobs.set(link, { ...job, link });
        }
      }
      allResults.push(Array.from(jobs.values()));
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isSerpApiQuotaError(error)) throw error;
      throw new Error(
        `Discovery incomplete: ${sourceLabelForDomain(domain)} failed. ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  return allResults.flat();
}

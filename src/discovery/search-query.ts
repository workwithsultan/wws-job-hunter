import {
  countryName,
  defaultSearchScope,
  searchWindows,
  searchRegion,
  type SearchScope,
} from "../shared/search-scope.js";

function locationClauses(scope: SearchScope): string[] {
  const clauses: string[] = [];
  if (scope.workType === "remote") clauses.push("remote");
  if (scope.workType === "hybrid") clauses.push("hybrid");
  if (scope.workType === "onsite")
    clauses.push('("on-site" OR onsite OR "on site" OR "in-office")');
  if (scope.country !== "any" && !searchRegion(scope)) clauses.push(countryName(scope.country));
  return clauses;
}

function formatSearchTerm(term: string): string {
  const normalized = term.trim();
  if (!normalized) {
    throw new Error("Search terms must not be empty.");
  }
  if (/["\r\n]/.test(normalized)) {
    throw new Error("Search terms must not contain quotes or line breaks.");
  }

  // Quote only individual tokens that could otherwise become search operators.
  return normalized
    .split(/\s+/)
    .map((word) =>
      /^[A-Za-z0-9]+$/.test(word) && !["OR", "AND", "NOT"].includes(word)
        ? word
        : JSON.stringify(word),
    )
    .join(" ");
}

function compactSearchTerms(discoveryTitleTerms: readonly string[]): string[] {
  if (discoveryTitleTerms.length === 0) {
    throw new Error("At least one discovery title term is required.");
  }

  const formattedTerms = discoveryTitleTerms.map(formatSearchTerm);
  const words = discoveryTitleTerms.map((term) => new Set(term.toLowerCase().trim().split(/\s+/)));
  // A broader word group covers narrower groups regardless of order or adjacency.
  return formattedTerms.filter(
    (_, index) =>
      !words.some((other, otherIndex) => {
        if (otherIndex === index) return false;
        const current = words[index]!;
        return (
          [...other].every((word) => current.has(word)) &&
          (other.size < current.size || otherIndex < index)
        );
      }),
  );
}

function queryForTerms(formattedTerms: readonly string[], scope: SearchScope): string {
  // Rejected terms apply only to titles after discovery, never to page descriptions.
  const groups = formattedTerms.map((term) =>
    formattedTerms.length > 1 && /\s/.test(term) ? `(${term})` : term,
  );
  return [`(${groups.join("\nOR ")})`, ...locationClauses(scope)].join("\n");
}

export function buildSearchQueryBody(
  discoveryTitleTerms: readonly string[],
  scope: SearchScope = defaultSearchScope,
): string {
  return queryForTerms(compactSearchTerms(discoveryTitleTerms), scope);
}

export function buildFirstPageSearchQueries(
  discoveryTitleTerms: readonly string[],
  queryBreadth: number,
  scope: SearchScope = defaultSearchScope,
): string[] {
  if (!Number.isInteger(queryBreadth) || queryBreadth < 1) {
    throw new Error("The source result limit must be a positive integer.");
  }
  const terms = compactSearchTerms(discoveryTitleTerms);
  const maxSearches = Math.max(1, Math.ceil(queryBreadth / 10));
  const batchSize = Math.min(2, Math.ceil(terms.length / maxSearches));
  const queries: string[] = [];
  // Independent first pages avoid the provider's unreliable pagination without adding searches.
  let batch: string[] = [];
  for (const term of terms) {
    if (
      batch.length &&
      (batch.length >= batchSize || queryForTerms([...batch, term], scope).length > 400)
    ) {
      queries.push(queryForTerms(batch, scope));
      batch = [];
    }
    batch.push(term);
  }
  if (batch.length) queries.push(queryForTerms(batch, scope));
  return queries;
}

export function buildSearchQueryPreview(
  discoveryTitleTerms: readonly string[],
  queryBreadth: number,
  domains: readonly string[],
  scope: SearchScope = defaultSearchScope,
): string {
  const queries = buildFirstPageSearchQueries(discoveryTitleTerms, queryBreadth, scope);
  return [
    "Search engine: DuckDuckGo via SerpApi",
    "Target market: " + countryName(scope.country),
    ...(searchRegion(scope) ? ["Search region: " + searchRegion(scope)] : []),
    "Search window: " + searchWindows[scope.searchWindow ?? "any"],
    ...domains.flatMap((domain) =>
      queries.map(
        (body, index) => domain + " · query " + (index + 1) + ":\n" + buildAtsQuery(domain, body),
      ),
    ),
  ].join("\n\n");
}

export function buildAtsQuery(domain: string, body: string): string {
  const site = domain === "boards.greenhouse.io" ? "job-boards.greenhouse.io" : domain;
  const path =
    domain === "apply.workable.com"
      ? "inurl:/j/"
      : domain === "myworkdayjobs.com"
        ? "inurl:/job/"
        : "";
  return [`site:${site}`, path, body].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function matchesTitle(title: string, keyword: string): boolean {
  const words = keyword.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 0 &&
    words.every((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(title);
    })
  );
}

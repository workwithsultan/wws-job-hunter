import { countryName, defaultSearchScope, type SearchScope } from "../shared/search-scope.js";

function locationClauses(scope: SearchScope): string[] {
  const clauses: string[] = [];
  if (scope.workType === "remote") clauses.push("remote");
  if (scope.workType === "hybrid") clauses.push("hybrid");
  if (scope.workType === "onsite")
    clauses.push('("on-site" OR onsite OR "on site" OR "in-office")');
  if (scope.country === "us") clauses.push('("United States" OR USA OR "U.S" OR "US")');
  else if (scope.country === "uk") clauses.push('("United Kingdom" OR UK OR Britain)');
  else if (scope.country !== "any") clauses.push(formatSearchTerm(countryName(scope.country)));
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

  return /[^A-Za-z0-9]/.test(normalized) ? `"${normalized}"` : normalized;
}

function compactSearchTerms(discoveryTitleTerms: readonly string[]): string[] {
  if (discoveryTitleTerms.length === 0) {
    throw new Error("At least one discovery title term is required.");
  }

  const formattedTerms = discoveryTitleTerms.map(formatSearchTerm);
  const normalizedTerms = discoveryTitleTerms.map((term) => term.trim().toLowerCase());
  // A broad term already covers phrases containing that whole term in an OR query.
  return formattedTerms.filter((_, index) => {
    const term = normalizedTerms[index]!;
    return !normalizedTerms.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (term === other) return otherIndex < index;
      return ` ${term} `.includes(` ${other} `);
    });
  });
}

function queryForTerms(formattedTerms: readonly string[], scope: SearchScope): string {
  // Rejected terms apply only to titles after discovery, never to page descriptions.
  return [`(${formattedTerms.join("\nOR ")})`, ...locationClauses(scope)].join("\n");
}

export function buildSearchQueryBody(
  discoveryTitleTerms: readonly string[],
  scope: SearchScope = defaultSearchScope,
): string {
  return queryForTerms(compactSearchTerms(discoveryTitleTerms), scope);
}

export const FIRST_PAGE_SEARCH_DOMAINS: readonly string[] = [
  "boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
];

export function buildFirstPageSearchQueries(
  discoveryTitleTerms: readonly string[],
  limitPerSource: number,
  scope: SearchScope = defaultSearchScope,
): string[] {
  if (!Number.isInteger(limitPerSource) || limitPerSource < 1) {
    throw new Error("The source result limit must be a positive integer.");
  }
  const terms = compactSearchTerms(discoveryTitleTerms);
  const maxSearches = Math.max(1, Math.ceil(limitPerSource / 10));
  const batchSize = Math.ceil(terms.length / maxSearches);
  const queries: string[] = [];
  // Independent first pages avoid the provider's unreliable pagination without adding searches.
  for (let index = 0; index < terms.length; index += batchSize) {
    queries.push(queryForTerms(terms.slice(index, index + batchSize), scope));
  }
  return queries;
}

export function buildSearchQueryPreview(
  discoveryTitleTerms: readonly string[],
  limitPerSource: number,
  domains: readonly string[],
  scope: SearchScope = defaultSearchScope,
): string {
  const standard = buildSearchQueryBody(discoveryTitleTerms, scope);
  const firstPageDomains = domains.filter((domain) => FIRST_PAGE_SEARCH_DOMAINS.includes(domain));
  if (firstPageDomains.length === 0) return standard;
  const queries = buildFirstPageSearchQueries(discoveryTitleTerms, limitPerSource, scope);
  const sections = domains.some((domain) => !FIRST_PAGE_SEARCH_DOMAINS.includes(domain))
    ? [`Standard query:\n${standard}`]
    : [];
  sections.push(
    `Independent first-page searches for ${firstPageDomains.join(", ")}. Each search is restricted to its domain.`,
  );
  sections.push(
    ...queries.map((query, index) => `Query ${index + 1}/${queries.length}:\n${query}`),
  );
  return sections.join("\n\n");
}

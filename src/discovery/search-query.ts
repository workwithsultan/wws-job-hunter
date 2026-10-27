export const REQUIRED_LOCATION_QUERY_CLAUSES = [
  // All previous remote phrases contain this term, so the alternatives were redundant.
  `remote`,
  `("United States" OR USA OR "U.S" OR "US")`,
] as const;

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

function queryForTerms(formattedTerms: readonly string[]): string {
  // Rejected terms apply only to titles after discovery, never to page descriptions.
  return [`(${formattedTerms.join("\nOR ")})`, ...REQUIRED_LOCATION_QUERY_CLAUSES].join("\n");
}

export function buildSearchQueryBody(discoveryTitleTerms: readonly string[]): string {
  return queryForTerms(compactSearchTerms(discoveryTitleTerms));
}

export const FIRST_PAGE_SEARCH_DOMAINS: readonly string[] = [
  "boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
];

export function buildFirstPageSearchQueries(
  discoveryTitleTerms: readonly string[],
  limitPerSource: number,
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
    queries.push(queryForTerms(terms.slice(index, index + batchSize)));
  }
  return queries;
}

export function buildSearchQueryPreview(
  discoveryTitleTerms: readonly string[],
  limitPerSource: number,
  domains: readonly string[],
): string {
  const standard = buildSearchQueryBody(discoveryTitleTerms);
  const firstPageDomains = domains.filter((domain) => FIRST_PAGE_SEARCH_DOMAINS.includes(domain));
  if (firstPageDomains.length === 0) return standard;
  const queries = buildFirstPageSearchQueries(discoveryTitleTerms, limitPerSource);
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

import { sourceDomains, type Preferences, type SerpQuota } from "./model.js";
import {
  buildFirstPageSearchQueries,
  FIRST_PAGE_SEARCH_DOMAINS,
} from "../discovery/search-query.js";

export interface SearchBudget {
  remaining: number | null;
  monthlyLimit: number | null;
  dailyTarget: number | null;
  limitPerSource: number;
  searchesPerRun: number | null;
  aboveTarget: boolean;
}
export function estimateSearches(preferences: Preferences, limit: number): number | null {
  if (!preferences.roles.length) return null;
  return sourceDomains.reduce(
    (sum, domain) =>
      sum +
      (FIRST_PAGE_SEARCH_DOMAINS.includes(domain)
        ? buildFirstPageSearchQueries(preferences.roles, limit).length
        : Math.ceil(limit / 10)),
    0,
  );
}
export function remainingDays(renewal: string, timezone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  return Math.max(1, Math.ceil((Date.parse(renewal + "T00:00:00Z") - today) / 86400000));
}
export function dailySearchTarget(
  balances: readonly { remaining: number; renewalDate: string | null }[],
  timezone: string,
  now = new Date(),
): number | null {
  if (!balances.length || balances.some((balance) => balance.renewalDate === null)) return null;
  return balances.reduce(
    (total, balance) =>
      total + Math.floor(balance.remaining / remainingDays(balance.renewalDate!, timezone, now)),
    0,
  );
}
export function searchBudget(
  quota: SerpQuota | null,
  preferences: Preferences,
  now = new Date(),
): SearchBudget {
  if (!quota?.complete || !quota.accounts.length)
    return {
      remaining: null,
      monthlyLimit: null,
      dailyTarget: null,
      limitPerSource: 10,
      searchesPerRun: estimateSearches(preferences, 10),
      aboveTarget: false,
    };
  const remaining = quota.accounts.reduce((sum, account) => sum + account.remaining, 0);
  const monthlyLimit = quota.accounts.reduce((sum, account) => sum + account.monthlyLimit, 0);
  const dailyTarget = dailySearchTarget(quota.accounts, preferences.timezone, now);
  const target = dailyTarget ?? remaining;
  let limit = 10;
  if (preferences.roles.length) {
    for (const candidate of [20, 30, 40, 50]) {
      if (estimateSearches(preferences, candidate)! <= target) limit = candidate;
    }
  }
  return {
    remaining,
    monthlyLimit,
    dailyTarget,
    limitPerSource: limit,
    searchesPerRun: estimateSearches(preferences, limit),
    aboveTarget: dailyTarget !== null && (estimateSearches(preferences, limit) ?? 0) > dailyTarget,
  };
}

import OpenAI from "openai";
import { z } from "zod";
import { Configuration, keyId } from "./config.js";
import type { SerpAccount, SerpQuota } from "../shared/model.js";

const accountSchema = z.object({
  account_id: z.string().min(1),
  plan_name: z.string(),
  total_searches_left: z.number().int().nonnegative(),
  searches_per_month: z.number().int().nonnegative(),
  plan_renewal_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  account_rate_limit_per_hour: z.number().int().nonnegative().optional(),
  this_hour_searches: z.number().int().nonnegative().optional(),
});
export function isAssessmentModel(id: string): boolean {
  return (
    /^(gpt-(4o|4\.1|[5-9])|o[134])([.-]|$)/.test(id) &&
    !/(audio|realtime|transcrib|tts|image|embedding|search|codex|chat-latest|deep-research|computer-use)/.test(
      id,
    )
  );
}
export class Providers {
  private readonly accounts = new Map<string, { at: number; account: SerpAccount }>();
  private readonly catalogs = new Map<string, { at: number; models: string[] }>();
  constructor(private readonly config: Configuration) {}
  async models(
    key = this.config.values().OPENAI_API_KEY ?? "",
    refresh = false,
  ): Promise<string[]> {
    if (!key) throw new Error("Save an OpenAI API key first.");
    const cached = this.catalogs.get(keyId(key));
    if (!refresh && cached && Date.now() - cached.at < 300000) return cached.models;
    try {
      const client = new OpenAI({ apiKey: key, timeout: 15000, maxRetries: 0 });
      const response = await client.models.list();
      const models = [
        ...new Set(response.data.map((model) => model.id).filter(isAssessmentModel)),
      ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (!models.length) throw new Error("No assessment models are available.");
      this.catalogs.set(keyId(key), { at: Date.now(), models });
      return models;
    } catch {
      throw new Error(
        "Models could not be loaded. Check the OpenAI key, model-list permissions, and connection.",
      );
    }
  }
  async account(key: string, refresh = false): Promise<SerpAccount> {
    const id = keyId(key);
    const cached = this.accounts.get(id);
    if (!refresh && cached && Date.now() - cached.at < 60000) return cached.account;
    try {
      const url = new URL("https://serpapi.com/account.json");
      url.searchParams.set("api_key", key);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Account request failed.");
      const parsed = accountSchema.parse(await response.json());
      const account: SerpAccount = {
        id: keyId("account:" + parsed.account_id),
        plan: parsed.plan_name,
        remaining: parsed.total_searches_left,
        monthlyLimit: parsed.searches_per_month,
        renewalDate: parsed.plan_renewal_date,
        hourlyRemaining:
          parsed.account_rate_limit_per_hour === undefined ||
          parsed.this_hour_searches === undefined
            ? null
            : Math.max(0, parsed.account_rate_limit_per_hour - parsed.this_hour_searches),
      };
      this.accounts.set(id, { at: Date.now(), account });
      return account;
    } catch {
      this.accounts.delete(id);
      throw new Error("Quota could not be checked. Check this SerpApi key and try again.");
    }
  }
  async quota(refresh = false): Promise<SerpQuota> {
    const accounts = new Map<string, SerpAccount>();
    const keys = await Promise.all(
      this.config.serpApiKeys().map(async (key) => {
        const saved = { id: keyId(key), lastFour: key.slice(-4) };
        try {
          const account = await this.account(key, refresh);
          accounts.set(account.id, account);
          return { ...saved, accountId: account.id, error: null };
        } catch (error) {
          return {
            ...saved,
            accountId: null,
            error: error instanceof Error ? error.message : "Quota could not be checked.",
          };
        }
      }),
    );
    return {
      keys,
      accounts: [...accounts.values()],
      complete: keys.length > 0 && keys.every((key) => !key.error),
      checkedAt: new Date().toISOString(),
    };
  }
  searchKeys(quota: SerpQuota): string[] {
    if (!quota.complete)
      throw new Error("Check your SerpApi keys in Settings. Their quota could not be verified.");
    const used = new Set<string>();
    const raw = this.config.serpApiKeys();
    return quota.keys
      .filter((key) => {
        const account = quota.accounts.find((item) => item.id === key.accountId);
        if (
          !account ||
          used.has(account.id) ||
          account.remaining === 0 ||
          account.hourlyRemaining === 0
        )
          return false;
        used.add(account.id);
        return true;
      })
      .map((saved) => raw.find((key) => keyId(key) === saved.id)!);
  }
}

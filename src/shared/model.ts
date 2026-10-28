import { z } from "zod";
export const statusLabels = {
  new: "New",
  ready: "Ready to apply",
  review: "Needs review",
  not_a_fit: "Not a fit",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
} as const;
export const statusSchema = z.enum([
  "new",
  "ready",
  "review",
  "not_a_fit",
  "applied",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
]);
export type JobStatus = z.infer<typeof statusSchema>;
export const applicationStatuses: readonly JobStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
];
export const sources = {
  "boards.greenhouse.io": "Greenhouse",
  "jobs.lever.co": "Lever",
  "jobs.ashbyhq.com": "Ashby",
  "apply.workable.com": "Workable",
  "myworkdayjobs.com": "Workday",
} as const;
export type Source = keyof typeof sources;
const terms = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((v) => !/["\r\n]/.test(v), "Use one term per line without quotation marks."),
  )
  .max(30);
export const preferencesSchema = z
  .object({
    profile: z.string().max(12000),
    roles: terms,
    exclusions: terms,
    sources: z
      .array(
        z.enum([
          "boards.greenhouse.io",
          "jobs.lever.co",
          "jobs.ashbyhq.com",
          "apply.workable.com",
          "myworkdayjobs.com",
        ]),
      )
      .min(1)
      .max(5),
    threshold: z.number().int().min(0).max(100),
    scheduleEnabled: z.boolean(),
    scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
    scheduleDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  profile: "",
  roles: [],
  exclusions: [],
  sources: Object.keys(sources) as Source[],
  threshold: 75,
  scheduleEnabled: false,
  scheduleTime: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  scheduleDays: [1, 2, 3, 4, 5],
};
export interface Job {
  id: number;
  title: string;
  url: string;
  source: Source;
  snippet: string;
  description: string;
  score: number | null;
  reason: string;
  status: JobStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface SearchRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "interrupted";
  found: number;
  added: number;
  ready: number;
  review: number;
  message: string;
  trigger: "manual" | "schedule";
}
export interface SavedKey {
  id: string;
  lastFour: string;
}
export interface Connections {
  openai: boolean;
  openaiLastFour: string;
  serpapi: boolean;
  serpapiKeys: SavedKey[];
  model: string;
}
export interface SerpAccount {
  id: string;
  plan: string;
  remaining: number;
  monthlyLimit: number;
  renewalDate: string | null;
  hourlyRemaining: number | null;
}
export interface SerpQuota {
  keys: (SavedKey & { accountId: string | null; error: string | null })[];
  accounts: SerpAccount[];
  complete: boolean;
  checkedAt: string;
}
export interface Workspace {
  lastRun: SearchRun | null;
  preferences: Preferences;
  connections: Connections;
  running: boolean;
  nextRun: string | null;
  totals: {
    jobs: number;
    ready: number;
    review: number;
    applications: number;
    interviewing: number;
    offers: number;
  };
}
export interface JobList {
  jobs: Job[];
  total: number;
  page: number;
  pages: number;
}
export const jobUpdateSchema = z
  .object({ status: statusSchema, notes: z.string().max(12000) })
  .strict();
export const providerKeySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, "Enter an API key.")
      .max(500)
      .regex(/^[A-Za-z0-9_-]+$/, "Use a key without spaces or line breaks."),
  })
  .strict();

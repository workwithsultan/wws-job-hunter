import type { Assessment } from "./assessment.js";
import { z } from "zod";
import { resumeMetadataSchema } from "./resume.js";
import { countrySchema, workTypeSchema, defaultSearchScope } from "./search-scope.js";
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
export const sourceDomains: readonly Source[] = Object.freeze(Object.keys(sources) as Source[]);
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
    country: countrySchema,
    workType: workTypeSchema,
    profile: z.string().max(12000),
    resume: resumeMetadataSchema.nullable(),
    roles: terms,
    exclusions: terms,
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
  .strict()
  .refine((value) => !value.resume || value.profile.trim().length >= 10, {
    message: "Import readable resume text before saving.",
    path: ["profile"],
  });
const { profile: profileField, resume: resumeField, ...searchFields } = preferencesSchema.shape;
export const profilePreferencesSchema = z
  .object({ profile: profileField, resume: resumeField })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Include at least one profile change.");
export const searchPreferencesSchema = z
  .object(searchFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Include at least one search change.");
export const searchPreferenceKeys = Object.keys(searchFields);
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  ...defaultSearchScope,
  profile: "",
  resume: null,
  roles: [],
  exclusions: [],
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
  assessment: Assessment | null;
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
  matches: number;
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
    matches: number;
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

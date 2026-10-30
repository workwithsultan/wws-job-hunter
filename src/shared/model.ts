import { defaultAssessmentPrompt, assessmentPromptSchema } from "./assessment-prompt.js";
import type { Assessment } from "./assessment.js";
import { z } from "zod";
import { resumeMetadataSchema } from "./resume.js";
import {
  countrySchema,
  workTypeSchema,
  defaultSearchScope,
  defaultSearchWindow,
  searchWindowSchema,
} from "./search-scope.js";
export const statusLabels = {
  new: "New",
  ready: "Need to apply",
  review: "Not qualified", // Legacy storage label; excluded from all active status choices.
  not_a_fit: "Not a fit",
  applied: "Applied",
  interviewing: "Interviewed",
  offer: "Offered",
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
export const visibleJobStatuses = Object.entries(statusLabels)
  .filter(([key]) => key !== "new" && key !== "not_a_fit" && key !== "review")
  .map(([value, label]) => ({ value, label }));
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
    searchWindow: searchWindowSchema.default(defaultSearchWindow),
    profile: z.string().max(12000),
    resume: resumeMetadataSchema.nullable(),
    roles: terms,
    exclusions: terms,
    assessmentPrompt: assessmentPromptSchema.default(defaultAssessmentPrompt),
  })
  .strict()
  .refine((value) => !value.resume || value.profile.trim().length >= 10, {
    message: "Import readable resume text before saving.",
    path: ["profile"],
  });
const { profile: profileField, resume: resumeField } = preferencesSchema.shape;
const searchFields = {
  country: preferencesSchema.shape.country,
  workType: preferencesSchema.shape.workType,
  searchWindow: searchWindowSchema,
  roles: preferencesSchema.shape.roles,
  exclusions: preferencesSchema.shape.exclusions,
};
export const promptPreferencesSchema = z
  .object({ assessmentPrompt: assessmentPromptSchema })
  .strict();
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
  searchWindow: defaultSearchWindow,
  profile: "",
  resume: null,
  roles: [],
  exclusions: [],
  assessmentPrompt: defaultAssessmentPrompt,
};
export interface Job {
  id: number;
  title: string;
  url: string;
  source: Source;
  snippet: string;
  description: string;
  assessment: Assessment | null;
  score: number | null;
  reason: string;
  status: JobStatus;
  notes: string;
  opportunityAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SearchRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "warnings" | "failed" | "interrupted";
  found: number;
  added: number;
  matches: number;
  message: string;
  issueCount: number;
  // Retain the origin of historical runs; new runs are always manual.
  trigger: "manual" | "schedule";
}
export const runStatusLabels = {
  running: "Running",
  completed: "Succeeded",
  warnings: "Completed with warnings",
  failed: "Failed",
  interrupted: "Interrupted",
} as const;
export interface RunIssue {
  id: number;
  runId: number;
  jobId: number | null;
  title: string | null;
  url: string | null;
  stage: "source" | "ai" | "search";
  code: string;
  httpStatus: number | null;
  message: string;
  createdAt: string;
}
export interface RunList {
  runs: SearchRun[];
  total: number;
  page: number;
  pages: number;
}
export interface SavedKey {
  id: string;
  lastFour: string;
}
export interface Connections {
  openrouter: boolean;
  openrouterLastFour: string;
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
  opportunitiesExpireAt: string | null;
  resumeAvailable: boolean;
  lastRun: SearchRun | null;
  preferences: Preferences;
  connections: Connections;
  running: boolean;
  totals: {
    jobs: number;
    matches: number;
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
  .object({
    status: statusSchema.exclude(["new", "not_a_fit", "review"]),
    notes: z.string().max(12000),
  })
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

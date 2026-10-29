import { z } from "zod";
export const assessmentResponseInstructions =
  'Return raw JSON: {"verdict":"match|not_a_match|review","score":0–100 or null,"reason":"brief factual reason"}. Keep reason within 12 words and 80 characters.';
export const assessmentLabels = {
  match: "Match",
  not_a_match: "Not a match",
  review: "Needs review",
} as const;
export type Assessment = keyof typeof assessmentLabels;
export const assessmentSchema = z
  .object({
    verdict: z.enum(["match", "not_a_match", "review"]),
    score: z.number().int().min(0).max(100).nullable(),
    reason: z.string().trim().min(1).max(80),
  })
  .strict();
export function assessmentLabel(value: Assessment | null): string {
  return value === null ? "Not assessed" : assessmentLabels[value];
}
export function assessmentStatus(value: Assessment): "ready" | "not_a_fit" | "review" {
  return value === "match" ? "ready" : value === "not_a_match" ? "not_a_fit" : "review";
}

export function matchScoreLabel(job: {
  assessment: Assessment | null;
  score: number | null;
}): string {
  return job.assessment === "match" && job.score !== null ? `${job.score}%` : "Needs review";
}

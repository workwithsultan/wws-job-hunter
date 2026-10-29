import { z } from "zod";
export const assessmentResponseInstructions =
  'Return raw JSON: {"verdict":"match|not_a_match","score":0–100,"reason":"brief factual reason"}. Return match only for a confirmed fit with a score above 0; otherwise return not_a_match with score 0. Keep reason within 12 words and 80 characters.';
export function withAssessmentOutput(prompt: string): string {
  return prompt + "\n\nRequired output (system-managed):\n" + assessmentResponseInstructions;
}
export const assessmentLabels = {
  match: "Match",
  not_a_match: "Not a match",
} as const;
// Legacy review records remain readable in storage but are never visible or generated.
export type Assessment = keyof typeof assessmentLabels | "review";
export const assessmentSchema = z
  .object({
    verdict: z.enum(["match", "not_a_match"]),
    score: z.number().int().min(0).max(100),
    reason: z.string().trim().min(1),
  })
  .strict();
export function assessmentLabel(value: Assessment | null): string {
  return value === null || value === "review" ? "Not assessed" : assessmentLabels[value];
}
export function assessmentStatus(value: "match" | "not_a_match"): "ready" | "not_a_fit" {
  return value === "match" ? "ready" : "not_a_fit";
}

export function matchScoreLabel(job: {
  assessment: Assessment | null;
  score: number | null;
}): string {
  return job.assessment === "match" && job.score !== null ? `${job.score}%` : "Not assessed";
}

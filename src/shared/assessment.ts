import { z } from "zod";
export const assessmentLabels = {
  match: "Match",
  not_a_match: "Not a match",
  review: "Needs review",
} as const;
export type Assessment = keyof typeof assessmentLabels;
export const assessmentSchema = z
  .object({
    verdict: z.enum(["match", "not_a_match", "review"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export function assessmentLabel(value: Assessment | null): string {
  return value === null ? "Not assessed" : assessmentLabels[value];
}
export function assessmentStatus(value: Assessment): "ready" | "not_a_fit" | "review" {
  return value === "match" ? "ready" : value === "not_a_match" ? "not_a_fit" : "review";
}

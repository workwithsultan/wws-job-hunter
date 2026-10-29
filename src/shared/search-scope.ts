import { z } from "zod";
import { countries } from "./countries.js";

export const workTypes = {
  any: "Any type",
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
} as const;
export const countrySchema = z
  .string()
  .refine(
    (value) => value === "any" || Object.hasOwn(countries, value),
    "Choose a supported country.",
  );
export const workTypeSchema = z.enum(["any", "remote", "hybrid", "onsite"]);
export const searchWindows = {
  any: "Any time",
  d: "Past 24 hours",
  w: "Past week",
  m: "Past month",
} as const;
export const searchWindowSchema = z.enum(["any", "d", "w", "m"]);
export interface SearchScope {
  searchWindow?: z.infer<typeof searchWindowSchema>;
  country: string;
  workType: z.infer<typeof workTypeSchema>;
}
export const defaultSearchScope: SearchScope = { country: "us", workType: "remote" };
export function countryName(country: string): string {
  if (country === "any") return "Any country";
  const name = countries[country];
  if (!name) throw new Error("Choose a supported country.");
  return name;
}

export function searchRegion(scope: SearchScope): string | undefined {
  if (scope.country === "us") return "us-en";
  if (scope.country === "uk") return "uk-en";
  return undefined;
}

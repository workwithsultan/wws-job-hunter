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
export interface SearchScope {
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

export function searchLocation(scope: SearchScope): Record<string, string> {
  return scope.country === "any" ? {} : { gl: scope.country, location: countryName(scope.country) };
}

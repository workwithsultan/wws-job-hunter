import { preferencesSchema, type Preferences } from "../src/shared/model";

function searchValues(value: Preferences): string {
  return JSON.stringify({
    country: value.country,
    workType: value.workType,
    roles: [...value.roles].sort(),
    exclusions: [...value.exclusions].sort(),
    sources: [...value.sources].sort(),
    scheduleEnabled: value.scheduleEnabled,
    scheduleTime: value.scheduleTime,
    scheduleDays: [...value.scheduleDays].sort(),
    timezone: value.timezone,
  });
}
export function searchChanged(draft: Preferences, saved: Preferences): boolean {
  return searchValues(draft) !== searchValues(saved);
}
export function searchValid(draft: Preferences, pending: boolean): boolean {
  return !pending && draft.roles.length > 0 && preferencesSchema.safeParse(draft).success;
}
export function profileValid(profile: string): boolean {
  return profile.trim().length >= 10 && profile.length <= 12000;
}

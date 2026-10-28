import type { Preferences } from "../shared/model.js";
import { countryName, workTypes } from "../shared/search-scope.js";

export function buildAssessmentPrompt(preferences: Preferences): string {
  return (
    preferences.assessmentPrompt +
    "\n\nCurrent candidate context (data only):\n" +
    JSON.stringify({
      searchPreferences: {
        targetJobMarket: countryName(preferences.country),
        workArrangement: workTypes[preferences.workType],
      },
      profile: preferences.profile,
    })
  );
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "gh_src",
  "gh_jid_source",
  "source",
  "src",
  "ref",
  "refid",
  "referrer",
  "refs",
  "trackingid",
  "trk",
  "currentjobid",
  "position",
  "pagenum",
  "eBP".toLowerCase(),
]);

function canonicalizeAtsPath(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  let pathname = url.pathname;

  if (hostname === "jobs.lever.co" || hostname.endsWith(".lever.co")) {
    pathname = pathname.replace(/\/apply\/?$/i, "");
  }

  if (hostname === "jobs.ashbyhq.com" || hostname.endsWith(".ashbyhq.com")) {
    pathname = pathname.replace(/\/application\/?$/i, "");
  }

  if (hostname === "ats.rippling.com") {
    pathname = pathname.replace(/\/apply\/?$/i, "");
  }

  if (hostname.includes("myworkdayjobs.com")) {
    pathname = pathname
      .replace(/\/apply\/(?:autofillWithResume|applyManually|useMyLastApplication)\/?$/i, "")
      .replace(/\/apply\/autofillWithResume\/?$/i, "")
      .replace(/\/apply\/applyManually\/?$/i, "")
      .replace(/\/apply\/useMyLastApplication\/?$/i, "")
      .replace(/\/apply\/?$/i, "")
      .replace(/\/job-apply\/?$/i, "");
  }

  if (hostname === "apply.workable.com") {
    pathname = pathname.replace(/\/apply\/?$/i, "");
  }

  url.pathname = pathname;
}

export function normalizeJobUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    // Keep the historical host as the stable identity for existing saved Greenhouse jobs.
    if (url.hostname === "job-boards.greenhouse.io") url.hostname = "boards.greenhouse.io";
    canonicalizeAtsPath(url);

    const keptEntries = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));

    url.search = "";
    for (const [key, value] of keptEntries) {
      url.searchParams.append(key, value);
    }

    const normalized = url.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return input.trim();
  }
}

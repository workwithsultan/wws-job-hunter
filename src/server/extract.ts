import { isJobPostingUrl } from "../discovery/url.js";
import * as cheerio from "cheerio";
import { sources } from "../shared/model.js";

export function isJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      ["job-boards.greenhouse.io", ...Object.keys(sources)].some(
        (host) =>
          url.hostname === host ||
          (host === "myworkdayjobs.com" && url.hostname.endsWith(".myworkdayjobs.com")),
      )
    );
  } catch {
    return false;
  }
}
export class PostingUnavailableError extends Error {
  constructor() {
    super("This posting is no longer available.");
    this.name = "PostingUnavailableError";
  }
}
const allowedFetch = (url: URL) =>
  isJobUrl(url.href) ||
  (url.protocol === "https:" &&
    url.hostname === "boards-api.greenhouse.io" &&
    !url.username &&
    !url.password &&
    !url.port);
async function read(url: URL, depth = 0, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!allowedFetch(url) || depth > 4)
    throw new Error("The job redirects outside the supported job sites.");
  const response = await fetch(url, {
    redirect: "manual",
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(25000), signal])
      : AbortSignal.timeout(25000),
    headers: { Accept: "text/html,application/json", "User-Agent": "JobHunter/0.1" },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("The job page has an invalid redirect.");
    const next = new URL(location, url);
    if (
      allowedFetch(next) &&
      next.hostname !== "boards-api.greenhouse.io" &&
      !isJobPostingUrl(next.href)
    )
      throw new PostingUnavailableError();
    return read(next, depth + 1, signal);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) throw new PostingUnavailableError();
    throw new Error("The job page could not be read.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The job page is empty.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new Error("The job page exceeds the size limit.");
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function postingContent(html: string, details: Record<string, unknown>) {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $("p,div,li,h1,h2,h3,h4,h5,h6,section,article").each((_index, element) => {
    $(element).append("\n\n");
  });
  const description = $.text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (description.length < 300)
    throw new Error("The posting did not provide a readable description.");
  const provided = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null),
  );
  return { description: description.slice(0, 30000), details: provided };
}
export async function extractPosting(
  link: string,
  signal?: AbortSignal,
): Promise<{ title: string | null; description: string; details: Record<string, unknown> }> {
  signal?.throwIfAborted();
  if (!isJobUrl(link)) throw new Error("The job URL is not supported.");
  const url = new URL(link);
  if (url.hostname === "boards.greenhouse.io" || url.hostname === "job-boards.greenhouse.io") {
    const match = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (match) {
      const json: unknown = JSON.parse(
        await read(
          new URL(
            `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(match[1]!)}/jobs/${match[2]}?content=true`,
          ),
          0,
          signal,
        ),
      );
      if (
        typeof json === "object" &&
        json !== null &&
        "content" in json &&
        typeof json.content === "string"
      )
        return {
          title: "title" in json && typeof json.title === "string" ? json.title : null,
          ...postingContent(json.content, {
            location: "location" in json ? json.location : undefined,
          }),
        };
      throw new Error("The Greenhouse posting did not include a readable description.");
    }
  }
  if (url.hostname.endsWith(".myworkdayjobs.com")) {
    const match = url.pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)$/);
    if (!match) throw new Error("The Workday posting has an unsupported URL.");
    const tenant = url.hostname.split(".")[0]!;
    const endpoint = new URL(
      `/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(match[1]!)}/job/${match[2]}`,
      url.origin,
    );
    const json: unknown = JSON.parse(await read(endpoint, 0, signal));
    if (
      typeof json !== "object" ||
      json === null ||
      !("jobPostingInfo" in json) ||
      typeof json.jobPostingInfo !== "object" ||
      json.jobPostingInfo === null
    )
      throw new Error("Workday did not return job posting details.");
    const info = json.jobPostingInfo;
    if (!("jobDescription" in info) || typeof info.jobDescription !== "string")
      throw new Error("The Workday posting has no readable description.");
    return {
      title: "title" in info && typeof info.title === "string" ? info.title : null,
      ...postingContent(info.jobDescription, {
        location: "location" in info ? info.location : undefined,
        additionalLocations: "additionalLocations" in info ? info.additionalLocations : undefined,
        timeType: "timeType" in info ? info.timeType : undefined,
      }),
    };
  }
  if (url.hostname === "apply.workable.com") {
    const match = url.pathname.match(/^\/([^/]+)\/j\/([^/]+)\/?$/);
    if (!match) throw new Error("The Workable posting has an unsupported URL.");
    const endpoint = new URL(
      `/api/v2/accounts/${encodeURIComponent(match[1]!)}/jobs/${encodeURIComponent(match[2]!)}`,
      url.origin,
    );
    const json: unknown = JSON.parse(await read(endpoint, 0, signal));
    if (
      typeof json !== "object" ||
      json === null ||
      !("description" in json) ||
      typeof json.description !== "string"
    )
      throw new Error("Workable did not return a readable job description.");
    if ("state" in json && ["draft", "closed", "archived"].includes(String(json.state)))
      throw new PostingUnavailableError();
    const locations =
      "locations" in json && Array.isArray(json.locations) ? json.locations : undefined;
    // Workable marks locations hidden from its careers page; they are not advertised restrictions.
    const visibleLocations = locations?.filter(
      (location) =>
        !(
          typeof location === "object" &&
          location !== null &&
          "hidden" in location &&
          location.hidden === true
        ),
    );
    return {
      title: "title" in json && typeof json.title === "string" ? json.title : null,
      ...postingContent(
        [
          json.description,
          "requirements" in json && json.requirements,
          "benefits" in json && json.benefits,
        ]
          .filter((value): value is string => typeof value === "string")
          .join("\n"),
        {
          location: !locations && "location" in json ? json.location : undefined,
          locations: visibleLocations?.length ? visibleLocations : undefined,
          workplace: "workplace" in json ? json.workplace : undefined,
          employmentType: "type" in json ? json.type : undefined,
        },
      ),
    };
  }
  const html = await read(url, 0, signal);
  const $ = cheerio.load(html);
  let structured = "";
  let title: string | null = null;
  let details: Record<string, unknown> = {};
  $('script[type="application/ld+json"]').each((_i, element) => {
    try {
      const value: unknown = JSON.parse($(element).text());
      const visit = (item: unknown): void => {
        if (Array.isArray(item)) {
          item.forEach(visit);
          return;
        }
        if (typeof item !== "object" || item === null) return;
        if (
          "description" in item &&
          "@type" in item &&
          (item["@type"] === "JobPosting" ||
            (Array.isArray(item["@type"]) && item["@type"].includes("JobPosting"))) &&
          typeof item.description === "string" &&
          item.description.length > structured.length
        ) {
          structured = cheerio.load(item.description).text();
          if ("title" in item && typeof item.title === "string") title = item.title;
          details = Object.fromEntries(
            ["jobLocation", "applicantLocationRequirements", "jobLocationType", "employmentType"]
              .filter((key) => key in item)
              .map((key) => [key, (item as Record<string, unknown>)[key]]),
          );
        }
        if ("@graph" in item) visit(item["@graph"]);
      };
      visit(value);
    } catch {
      /* Non-JSON metadata is ignored; visible page content is still checked. */
    }
  });
  $("script,style,nav,footer,header,noscript,svg").remove();
  const blocks = [
    structured,
    ...[".posting-description", ".job-description", ".description", "article", "main"].map(
      (selector) => $(selector).text(),
    ),
  ];
  const description =
    blocks
      .map((value) => value.replace(/\s+/g, " ").trim())
      .sort((a, b) => b.length - a.length)[0] ?? "";
  if (description.length < 300)
    throw new Error("The posting did not provide a readable description.");
  title ??= $(".posting-headline h2, h1").first().text().trim() || null;
  return {
    title: title?.slice(0, 500) ?? null,
    ...postingContent(description.replaceAll("&", "&amp;").replaceAll("<", "&lt;"), details),
  };
}

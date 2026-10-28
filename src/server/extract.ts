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
    return read(new URL(location, url), depth + 1, signal);
  }
  if (!response.ok) {
    await response.body?.cancel();
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
export async function extractDescription(link: string, signal?: AbortSignal): Promise<string> {
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
        return cheerio.load(json.content).text().replace(/\s+/g, " ").trim().slice(0, 30000);
    }
  }
  const html = await read(url, 0, signal);
  const $ = cheerio.load(html);
  let structured = "";
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
          typeof item.description === "string" &&
          item.description.length > structured.length
        )
          structured = cheerio.load(item.description).text();
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
    throw new Error("The description needs manual review. Open the original posting to read it.");
  return description.slice(0, 30000);
}

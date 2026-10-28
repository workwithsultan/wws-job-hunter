import type { SearchRun } from "../src/shared/model";

export function runDuration(run: Pick<SearchRun, "startedAt" | "finishedAt" | "status">): string {
  if (!run.finishedAt) return run.status === "running" ? "In progress" : "Finish time unavailable";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000),
  );
  if (!Number.isFinite(seconds)) throw new Error("Search duration requires valid timestamps.");
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

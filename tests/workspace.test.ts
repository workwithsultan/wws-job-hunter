import { runDuration } from "../web/log-format.js";
import { countryEmoji } from "../src/shared/emoji.js";
import {
  assessmentSchema,
  assessmentLabel,
  assessmentStatus,
  matchScoreLabel,
} from "../src/shared/assessment.js";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  resumeMetadataSchema,
  resumeFileError,
  hasPdfHeader,
  readableResume,
  resumeLimits,
} from "../src/shared/resume.js";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/server/store.js";
import { Configuration } from "../src/server/config.js";
import { searchBudget, remainingDays, dailySearchTarget } from "../src/shared/budget.js";
import { isAssessmentModel } from "../src/server/providers.js";
import { Runner } from "../src/server/runner.js";
import { buildApp } from "../src/server/app.js";
import { sourceDomains, defaultPreferences, preferencesSchema } from "../src/shared/model.js";
import { discoverJobs } from "../src/discovery/serpapi.js";
import { isJobUrl, extractDescription } from "../src/server/extract.js";
import { searchLocation } from "../src/shared/search-scope.js";
import { searchChanged, searchValid, profileValid, keywordEntry } from "../web/form-state.js";
import { countries } from "../src/shared/countries.js";
import {
  buildSearchQueryBody,
  buildSearchQueryPreview,
  buildFirstPageSearchQueries,
} from "../src/discovery/search-query.js";

function installation() {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-check-"));
  writeFileSync(
    join(directory, ".env.local"),
    "APP_HOST=127.0.0.1\nPORT=8790\nDATA_DIR=./data\nOPENAI_API_KEY=\nSERPAPI_API_KEY=\nOPENAI_MODEL=\n",
    { mode: 0o600 },
  );
  const store = new Store(join(directory, "workspace.sqlite"));
  const config = new Configuration(directory);
  const runner = new Runner(store, config);
  return {
    directory,
    store,
    config,
    runner,
    cleanup() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("a new installation starts without jobs, runs, profile data, or provider keys", () => {
  const item = installation();
  try {
    assert.deepEqual(item.store.totals(), {
      jobs: 0,
      matches: 0,
      review: 0,
      applications: 0,
      interviewing: 0,
      offers: 0,
    });
    assert.deepEqual(item.store.runs(), []);
    assert.equal(item.store.preferences().profile, "");
    assert.deepEqual(item.store.preferences().roles, []);
    assert.equal(item.config.connectionStatus().openai, false);
    assert.equal(item.config.connectionStatus().serpapi, false);
  } finally {
    item.cleanup();
  }
});
test("settings persist without generating application records", () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-persistence-"));
  const path = join(directory, "workspace.sqlite");
  try {
    const first = new Store(path);
    first.savePreferences(defaultPreferences);
    first.close();
    const second = new Store(path);
    try {
      assert.deepEqual(second.preferences(), defaultPreferences);
      assert.equal(second.totals().jobs, 0);
      assert.equal(second.runs().length, 0);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("an unconfigured search cannot create a phantom run or spend provider credits", () => {
  const item = installation();
  try {
    assert.throws(() => item.runner.start(), /Complete your profile/);
    assert.equal(item.runner.running, false);
    assert.equal(item.store.runs().length, 0);
  } finally {
    item.cleanup();
  }
});
test("only supported HTTPS job sites can be extracted", () => {
  for (const value of [
    "http://127.0.0.1",
    "https://localhost",
    "https://jobs.lever.co.evil.invalid/posting",
    "https://jobs.lever.co:8443/posting",
    "https://user:password@jobs.lever.co/posting",
    "file:///etc/passwd",
  ])
    assert.equal(isJobUrl(value), false);
  assert.equal(isJobUrl("https://jobs.lever.co/"), true);
});
test("removed schedule settings and operator-bearing queries are rejected", () => {
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, scheduleTime: "25:00" }).success,
    false,
  );
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, scheduleDays: [] }).success,
    false,
  );
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, timezone: "not-a-timezone" }).success,
    false,
  );
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, roles: ['" OR site:localhost'] }).success,
    false,
  );
  assert.throws(() => buildFirstPageSearchQueries([], 10));
});
test("environment changes are atomic and the credential file is private", () => {
  const item = installation();
  try {
    const before = item.config.values();
    assert.throws(() => item.config.update({ OPENAI_MODEL: "\nPORT=1" }));
    assert.deepEqual(item.config.values(), before);
    if (process.platform !== "win32") assert.equal(statSync(item.config.file).mode & 0o777, 0o600);
  } finally {
    item.cleanup();
  }
});
test("API origin, host, validation and empty-state boundaries", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, resolve("."), 8790);
  const base = { host: "127.0.0.1:8790" };
  const write = { ...base, origin: "http://127.0.0.1:8790", "content-type": "application/json" };
  try {
    const workspace = await app.inject({ url: "/api/workspace", headers: base });
    assert.equal(workspace.statusCode, 200);
    assert.equal(workspace.json().totals.jobs, 0);
    assert.equal("OPENAI_API_KEY" in workspace.json(), false);
    assert.equal(
      (await app.inject({ url: "/api/workspace", headers: { host: "untrusted.invalid" } }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers: { ...write, origin: "https://untrusted.invalid" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/runs", headers: base, payload: {} }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/runs", headers: write, payload: {} }))
        .statusCode,
      400,
    );
    assert.equal(item.store.runs().length, 0);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/preferences",
          headers: write,
          payload: { ...defaultPreferences, scheduleEnabled: true },
        })
      ).statusCode,
      400,
    );
    assert.equal("scheduleEnabled" in item.store.preferences(), false);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/preferences",
          headers: write,
          payload: { ...defaultPreferences, threshold: 101 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/api/jobs?status=invalid", headers: base })).statusCode,
      400,
    );
    const jobs = await app.inject({ url: "/api/jobs?q=%27%20OR%201%3D1", headers: base });
    assert.equal(jobs.statusCode, 200);
    assert.equal(jobs.json().total, 0);
    assert.equal((await app.inject({ url: "/api/jobs/1", headers: base })).statusCode, 404);
    assert.equal(
      (await app.inject({ method: "DELETE", url: "/api/jobs/1", headers: write, payload: {} }))
        .statusCode,
      404,
    );
    const exportFile = await app.inject({ url: "/api/export", headers: base });
    assert.equal(exportFile.statusCode, 200);
    assert.equal(exportFile.body.split("\r\n").length, 1);
    const privateFile = await app.inject({ url: "/.env.local", headers: base });
    assert.equal(privateFile.body.includes("APP_HOST="), false);
    const index = await app.inject({ url: "/settings", headers: base });
    assert.equal(index.statusCode, 200);
    assert.match(index.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
  } finally {
    await app.close();
    await item.runner.stop();
    item.cleanup();
  }
});

test("shutdown cancellation stops discovery and extraction before any external request", async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(discoverJobs("", 10, [], undefined, signal), { name: "AbortError" });
  await assert.rejects(extractDescription("https://jobs.lever.co/", signal), {
    name: "AbortError",
  });
});

test("provider metadata stays unavailable rather than invented before keys are connected", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, resolve("."), 8790);
  const read = { host: "127.0.0.1:8790" };
  const write = { ...read, origin: "http://127.0.0.1:8790", "content-type": "application/json" };
  try {
    assert.deepEqual(item.config.connectionStatus().serpapiKeys, []);
    assert.equal("SERPAPI_API_KEY" in item.config.values(), false);
    assert.equal(item.config.values().SERPAPI_API_KEYS, "");
    assert.equal((await app.inject({ url: "/api/openai/models", headers: read })).statusCode, 409);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/openai/key",
          headers: write,
          payload: { key: "" },
        })
      ).statusCode,
      400,
    );
    assert.equal(item.runner.updatingConnections, false);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/serpapi/keys",
          headers: write,
          payload: { key: "" },
        })
      ).statusCode,
      400,
    );
    assert.equal(item.runner.updatingConnections, false);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/openai/model",
          headers: write,
          payload: { model: "gpt-4o" },
        })
      ).statusCode,
      409,
    );
    assert.equal(item.runner.updatingConnections, false);
    const quota = (await app.inject({ url: "/api/serpapi/quota", headers: read })).json();
    assert.deepEqual(quota.accounts, []);
    assert.deepEqual(quota.keys, []);
    assert.equal(quota.complete, false);
    assert.deepEqual(item.store.runs(), []);
    assert.equal(item.store.totals().jobs, 0);
  } finally {
    await app.close();
    await item.runner.stop();
    item.cleanup();
  }
});

test("unknown quota is not reported as zero and model choices exclude unrelated products", () => {
  const budget = searchBudget(null, defaultPreferences);
  assert.equal(budget.remaining, null);
  assert.equal(budget.dailyTarget, null);
  assert.equal(budget.searchesPerRun, null);
  assert.equal(remainingDays("2026-11-27", "Asia/Jakarta", new Date("2026-10-28T05:00:00Z")), 30);
  assert.equal(isAssessmentModel("gpt-4o"), true);
  assert.equal(isAssessmentModel("text-embedding-3-small"), false);
  assert.equal(isAssessmentModel("gpt-4o-realtime-preview"), false);
});

test("country and work type affect discovery queries, provider parameters, and previews", () => {
  const scope = { country: "id", workType: "hybrid" as const };
  const query = buildSearchQueryBody(["Operations"], scope);
  assert.match(query, /Indonesia/);
  assert.match(query, /hybrid/);
  assert.doesNotMatch(query, /remote|United States|USA/);
  assert.deepEqual(searchLocation(scope), { gl: "id", location: "Indonesia" });
  const preview = buildSearchQueryPreview(["Operations"], 20, sourceDomains, scope);
  assert.match(preview, /Indonesia/);
  assert.doesNotMatch(preview, /remote|United States/);
  for (const body of buildFirstPageSearchQueries(["Operations"], 20, scope))
    assert.match(body, /hybrid[\s\S]*Indonesia/);
  const unrestricted = buildSearchQueryBody(["Operations"], { country: "any", workType: "any" });
  assert.equal(unrestricted, "(Operations)");
  assert.deepEqual(searchLocation({ country: "any", workType: "any" }), {});
  assert.match(
    buildSearchQueryBody(["Operations"], { country: "sg", workType: "onsite" }),
    /on-site[\s\S]*Singapore/,
  );
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, country: "invalid" }).success,
    false,
  );
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, workType: "invalid" }).success,
    false,
  );
  assert.equal(Object.values(countries).filter((name) => name === "United Kingdom").length, 1);
});

test("country and work type persist without creating job records", () => {
  const item = installation();
  try {
    item.store.savePreferences({ ...defaultPreferences, country: "id", workType: "hybrid" });
    assert.equal(item.store.preferences().country, "id");
    assert.equal(item.store.preferences().workType, "hybrid");
    assert.equal(item.store.totals().jobs, 0);
    assert.deepEqual(item.store.runs(), []);
  } finally {
    item.cleanup();
  }
});

test("save readiness follows actual changes and rejects incomplete form input", () => {
  const original = structuredClone(defaultPreferences);
  assert.equal(searchChanged(original, defaultPreferences), false);
  assert.equal(searchChanged({ ...original, country: "id" }, original), true);
  assert.equal(searchChanged({ ...original, workType: "any" }, original), true);
  assert.equal(
    searchChanged(
      { ...original, roles: ["Operations", "Success"] },
      { ...original, roles: ["Success", "Operations"] },
    ),
    false,
  );
  assert.equal(searchValid(original, false), false);
  const configured = { ...original, roles: ["Operations"] };
  assert.equal(searchValid(configured, false), true);
  assert.equal(searchValid(configured, true), false);
  assert.equal(profileValid(""), false);
  assert.equal(profileValid("Operations experience"), true);
  assert.equal(profileValid("Operations experience".repeat(1000)), false);
});

test("existing preferences retain US remote behavior when upgraded", () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-upgrade-"));
  const path = join(directory, "workspace.sqlite");
  try {
    const first = new Store(path);
    first.close();
    const { country, workType, resume, ...previous } = defaultPreferences;
    assert.equal(resume, null);
    assert.equal(country, "us");
    assert.equal(workType, "remote");
    const db = new Database(path);
    try {
      db.prepare("INSERT INTO preferences(id,value) VALUES(1,?)").run(
        JSON.stringify({ ...previous, sources: ["jobs.lever.co"], limit: 10, threshold: 75 }),
      );
    } finally {
      db.close();
    }
    const upgraded = new Store(path);
    try {
      assert.deepEqual(upgraded.preferences(), defaultPreferences);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resume selection rejects unsupported, empty, and oversized files before reading", () => {
  assert.equal(resumeFileError({ name: "Resume.PDF", size: 1024 }), "");
  assert.equal(resumeFileError({ name: "Resume.docx", size: 1024 }), "Choose a PDF file.");
  assert.match(resumeFileError({ name: "Resume.pdf", size: 0 }), /empty/);
  assert.match(resumeFileError({ name: "Resume.pdf", size: resumeLimits.bytes + 1 }), /10 MB/);
  assert.equal(hasPdfHeader(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(hasPdfHeader(new TextEncoder().encode("Not a PDF")), false);
  assert.equal(readableResume(""), false);
  assert.equal(readableResume("   "), false);
  assert.equal(readableResume("Operations experience"), true);
  assert.equal(readableResume("\uFFFD".repeat(30)), false);
});

test("PDF worker policy permits only local scripts and leaves provider state untouched", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, resolve("."), 8790);
  try {
    const response = await app.inject({
      url: "/api/workspace",
      headers: { host: "127.0.0.1:8790" },
    });
    assert.match(String(response.headers["content-security-policy"]), /worker-src 'self'/);
    assert.doesNotMatch(String(response.headers["content-security-policy"]), /unsafe-eval|blob:/);
    assert.equal(response.json().preferences.profile, "");
  } finally {
    await app.close();
    await item.runner.stop();
    item.cleanup();
  }
});

test("daily search target scales from one balance to three balances", () => {
  const now = new Date("2026-10-28T05:00:00Z");
  const balance = { remaining: 90, renewalDate: "2026-11-27" };
  assert.equal(dailySearchTarget([balance], "Asia/Jakarta", now), 3);
  assert.equal(dailySearchTarget([balance, balance, balance], "Asia/Jakarta", now), 9);
  assert.equal(dailySearchTarget([], "Asia/Jakarta", now), null);
  assert.equal(
    dailySearchTarget([{ remaining: 90, renewalDate: null }], "Asia/Jakarta", now),
    null,
  );
});

test("resume metadata accepts only a PDF filename and bounded page count", () => {
  assert.equal(resumeMetadataSchema.safeParse({ name: "Resume.pdf", pages: 3 }).success, true);
  assert.equal(resumeMetadataSchema.safeParse({ name: "Resume.docx", pages: 3 }).success, false);
  assert.equal(resumeMetadataSchema.safeParse({ name: "Resume.pdf", pages: 21 }).success, false);
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, resume: { name: "Resume.pdf", pages: 3 } })
      .success,
    false,
  );
});

test("match decisions validate bounded percentage scores without inventing missing scores", () => {
  assert.equal(matchScoreLabel({ assessment: "match", score: 92 }), "92%");
  assert.equal(matchScoreLabel({ assessment: "match", score: null }), "Needs review");
  assert.equal(matchScoreLabel({ assessment: "review", score: 55 }), "Needs review");
  assert.equal(assessmentLabel("match"), "Match");
  assert.equal(assessmentStatus("match"), "ready");
  assert.equal(assessmentStatus("not_a_match"), "not_a_fit");
  assert.equal(assessmentStatus("review"), "review");
  for (const score of [0, 100, null])
    assert.equal(
      assessmentSchema.safeParse({ verdict: "match", score, reason: "Supported evidence." })
        .success,
      true,
    );
  for (const score of [-1, 101, 5.5, "90"])
    assert.equal(
      assessmentSchema.safeParse({ verdict: "match", score, reason: "Supported evidence." })
        .success,
      false,
    );
  assert.equal(
    assessmentSchema.safeParse({ verdict: "match", reason: "Supported evidence." }).success,
    false,
  );
});

test("schema upgrade retains existing numeric scores and keeps assessment and application state separate", () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-assessment-upgrade-"));
  const path = join(directory, "workspace.sqlite");
  try {
    const db = new Database(path);
    db.exec(
      "CREATE TABLE jobs (id INTEGER PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL UNIQUE,source TEXT NOT NULL,snippet TEXT NOT NULL,description TEXT NOT NULL,score INTEGER CHECK(score BETWEEN 0 AND 100),reason TEXT NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);CREATE TABLE runs (id INTEGER PRIMARY KEY,startedAt TEXT NOT NULL,finishedAt TEXT,status TEXT NOT NULL,found INTEGER NOT NULL DEFAULT 0,added INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,review INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',trigger TEXT NOT NULL);PRAGMA user_version=1;",
    );
    db.prepare(
      "INSERT INTO jobs(title,url,source,snippet,description,score,reason,status,notes,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "Operations Manager",
      "https://jobs.lever.co/example/legacy",
      "jobs.lever.co",
      "Operations",
      "Description",
      88,
      "Existing assessment",
      "applied",
      "Keep the original note.",
      "2026-10-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    );
    db.close();
    const store = new Store(path);
    assert.equal(store.allJobs().length, 1);
    assert.equal(store.job(1)?.score, 88);
    assert.equal(store.job(1)?.status, "applied");
    assert.equal(store.job(1)?.notes, "Keep the original note.");
    assert.equal(store.list({ q: "", status: "", applications: true, page: 1 }).total, 1);
    assert.equal(store.totals().matches, 0);
    store.close();
    const check = new Database(path);
    try {
      const columns = check.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
      assert.equal(
        columns.some((c) => c.name === "score"),
        true,
      );
      assert.equal(
        columns.some((c) => c.name === "assessment"),
        true,
      );
      assert.equal(check.pragma("user_version", { simple: true }), 4);
    } finally {
      check.close();
    }
    const reopened = new Store(path);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("country flags use real country codes without changing text labels", () => {
  assert.equal(countryEmoji("us"), "🇺🇸");
  assert.equal(countryEmoji("id"), "🇮🇩");
  assert.equal(countryEmoji("uk"), "🇬🇧");
  assert.equal(countryEmoji("UK"), "🇬🇧");
  assert.equal(countryEmoji("an"), "🇨🇼");
  assert.equal(countryEmoji("any"), "🌍");
  assert.throws(() => countryEmoji("invalid"));
});

test("keyword readiness rejects duplicates and preserves uncommitted input for correction", () => {
  assert.deepEqual(keywordEntry([], "Operations, Support"), {
    values: ["Operations", "Support"],
    error: "",
  });
  assert.match(keywordEntry(["Operations"], "operations").error, /Already added/);
  assert.match(keywordEntry([], "Operations, operations").error, /Already added/);
  assert.match(keywordEntry([], '"Operations"').error, /quotation/);
  assert.match(keywordEntry([], "").error, /Enter/);
  assert.equal(keywordEntry([], "Operations\nSupport").error, "");
});

test("profile and search updates preserve each other's saved settings", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, resolve("."), 8790);
  const headers = {
    host: "127.0.0.1:8790",
    origin: "http://127.0.0.1:8790",
    "content-type": "application/json",
  };
  try {
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/preferences/search",
          headers,
          payload: { country: "id" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/preferences/profile",
          headers,
          payload: { profile: "", resume: null },
        })
      ).statusCode,
      200,
    );
    assert.equal(item.store.preferences().country, "id");
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/preferences/profile",
          headers,
          payload: { country: "us" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/preferences/search",
          headers,
          payload: { resume: null },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/preferences/search",
          headers,
          payload: { sources: ["jobs.lever.co"] },
        })
      ).statusCode,
      400,
    );
    assert.equal(item.store.totals().jobs, 0);
    assert.deepEqual(item.store.runs(), []);
  } finally {
    await app.close();
    await item.runner.stop();
    item.cleanup();
  }
});

test("search logs expose paginated history without creating runs and validate filters", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, resolve("."), 8790);
  try {
    const headers = { host: "127.0.0.1:8790" };
    for (const query of [
      "",
      "?page=20",
      "?status=failed",
      "?status=completed",
      "?status=interrupted",
      "?status=running",
    ]) {
      const response = await app.inject({ method: "GET", url: "/api/runs" + query, headers });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { runs: [], total: 0, page: 1, pages: 1 });
    }
    for (const query of ["?page=0", "?page=1.5", "?status=unknown", "?page=1000001"]) {
      assert.equal(
        (await app.inject({ method: "GET", url: "/api/runs" + query, headers })).statusCode,
        400,
      );
    }
    assert.deepEqual(item.store.runs(), []);
    assert.equal(item.store.totals().jobs, 0);
  } finally {
    await app.close();
    await item.runner.stop();
    item.cleanup();
  }
});

test("interrupted history never presents an unfinished timestamp as an active search", () => {
  const startedAt = "2026-10-28T10:00:00Z";
  assert.equal(
    runDuration({ startedAt, finishedAt: null, status: "interrupted" }),
    "Finish time unavailable",
  );
  assert.equal(
    runDuration({ startedAt, finishedAt: null, status: "failed" }),
    "Finish time unavailable",
  );
  assert.equal(runDuration({ startedAt, finishedAt: null, status: "running" }), "In progress");
});

test("search durations remain readable for short and long runs", () => {
  const startedAt = "2026-10-28T10:00:00Z";
  assert.equal(
    runDuration({ startedAt, finishedAt: "2026-10-28T10:00:18Z", status: "failed" }),
    "18s",
  );
  assert.equal(
    runDuration({ startedAt, finishedAt: "2026-10-28T10:03:12Z", status: "completed" }),
    "3m 12s",
  );
  assert.equal(
    runDuration({ startedAt, finishedAt: "2026-10-28T11:02:00Z", status: "completed" }),
    "1h 2m",
  );
});

test("only assessed matches and review jobs appear in lists, totals, details and CSV", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, item.directory, 8790);
  try {
    const base = {
      title: "Operations Manager",
      source: "jobs.lever.co" as const,
      snippet: "Operations",
      description: "Operations role",
      reason: "Evidence",
    };
    for (const [index, assessment] of ["match", "review", "not_a_match", null].entries()) {
      item.store.insert({
        ...base,
        url: `https://jobs.lever.co/example/${index}`,
        assessment: assessment as "match" | "review" | "not_a_match" | null,
        status: "new",
      });
      if (assessment)
        item.store.assess(index + 1, {
          description: "Operations role",
          assessment: assessment as "match" | "review" | "not_a_match",
          score: assessment === "match" ? 91 : null,
          reason: "Evidence",
          status:
            assessment === "match" ? "ready" : assessment === "review" ? "review" : "not_a_fit",
        });
    }
    const query = { q: "", status: "", applications: false, page: 1 };
    assert.equal(item.store.list(query).total, 2);
    assert.equal(item.store.totals().jobs, 2);
    assert.equal(item.store.has("https://jobs.lever.co/example/2"), true);
    assert.equal(item.store.pending().length, 1);
    item.store.update(1, "applied", "Keep this note.");
    assert.equal(item.store.list({ ...query, applications: true }).total, 1);
    const headers = { host: "127.0.0.1:8790" };
    for (const id of [3, 4])
      assert.equal((await app.inject({ url: "/api/jobs/" + id, headers })).statusCode, 404);
    const csv = await app.inject({ url: "/api/export", headers });
    assert.equal(csv.body.split("\r\n").length, 3);
    assert.match(csv.body, /Score \(%\)/);
    assert.doesNotMatch(csv.body, /example\/2|example\/3/);
    const reopened = new Store(join(item.directory, "workspace.sqlite"));
    assert.equal(reopened.job(1)?.score, 91);
    assert.equal(reopened.job(1)?.notes, "Keep this note.");
    reopened.close();
  } finally {
    await app.close();
    item.cleanup();
  }
});

test("resume replacement atomically persists PDF and matching text and rejects invalid uploads", async () => {
  const item = installation();
  const app = buildApp(item.store, item.config, item.runner, item.directory, 8790);
  try {
    const headers = {
      host: "127.0.0.1:8790",
      origin: "http://127.0.0.1:8790",
      "content-type": "application/json",
    };
    assert.equal((await app.inject({ url: "/api/resume", headers })).statusCode, 404);
    const pdf = Buffer.from("%PDF-1.7\nResume bytes for persistence validation.\n%%EOF");
    const payload = {
      resume: { name: "Resume.pdf", pages: 1 },
      profile: "Operations experience with customer support.",
      pdf: pdf.toString("base64"),
    };
    const saved = await app.inject({ method: "PUT", url: "/api/resume", headers, payload });
    assert.equal(saved.statusCode, 200);
    const preview = await app.inject({ url: "/api/resume", headers });
    assert.equal(preview.headers["content-type"], "application/pdf");
    assert.match(String(preview.headers["content-disposition"]), /^inline/);
    assert.deepEqual(preview.rawPayload, pdf);
    assert.equal(item.store.preferences().profile, payload.profile);
    assert.equal(item.store.hasResumeDocument(), true);
    for (const invalid of ["not-base64", Buffer.from("not a PDF").toString("base64")]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/resume",
        headers,
        payload: { ...payload, pdf: invalid, profile: "This must not replace the saved profile." },
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(item.store.resumeDocument(), pdf);
      assert.equal(item.store.preferences().profile, payload.profile);
    }
    const denied = await app.inject({
      method: "PUT",
      url: "/api/resume",
      headers: { ...headers, origin: "https://example.com" },
      payload,
    });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(item.store.resumeDocument(), pdf);
    item.store.savePreferences({ ...item.store.preferences(), country: "id" });
    assert.deepEqual(item.store.resumeDocument(), pdf);
    item.store.savePreferences({
      ...item.store.preferences(),
      profile: "A different programmatically saved resume summary.",
    });
    assert.equal(item.store.hasResumeDocument(), false);
  } finally {
    await app.close();
    item.cleanup();
  }
});

test("Jobs and Applications partition records by workflow status and preserve data on transfers", () => {
  const item = installation();
  try {
    item.store.insert({
      title: "Operations Manager",
      url: "https://jobs.lever.co/example/workflow",
      source: "jobs.lever.co",
      snippet: "Operations",
      description: "Operations role",
      assessment: null,
      reason: "",
      status: "new",
    });
    item.store.assess(1, {
      description: "Operations role",
      assessment: "match",
      score: 93,
      reason: "Relevant experience",
      status: "ready",
    });
    const query = { q: "", status: "", page: 1 };
    for (const status of [
      "ready",
      "review",
      "applied",
      "interviewing",
      "offer",
      "accepted",
      "rejected",
      "withdrawn",
      "ready",
    ] as const) {
      item.store.update(1, status, "Retain this note.");
      const inJobs = status === "ready" || status === "review";
      assert.equal(item.store.list({ ...query, applications: false }).total, inJobs ? 1 : 0);
      assert.equal(item.store.list({ ...query, applications: true }).total, inJobs ? 0 : 1);
      assert.equal(item.store.totals().jobs, inJobs ? 1 : 0);
      assert.equal(item.store.totals().applications, inJobs ? 0 : 1);
      assert.equal(item.store.totals().matches, inJobs ? 1 : 0);
      assert.equal(item.store.job(1)?.score, 93);
      assert.equal(item.store.job(1)?.notes, "Retain this note.");
    }
    assert.equal(item.store.list({ ...query, applications: false, status: "applied" }).total, 0);
    assert.equal(item.store.list({ ...query, applications: true, status: "ready" }).total, 0);
  } finally {
    item.cleanup();
  }
});

test("manual-only upgrade removes enabled schedules without losing PDF, jobs or history", async () => {
  const item = installation();
  let upgraded: Store | undefined;
  try {
    const pdf = Buffer.from("%PDF-1.7\nExisting local resume.\n%%EOF");
    const preferences = {
      ...defaultPreferences,
      profile: "Operations and customer success experience.",
      resume: { name: "Resume.pdf", pages: 1 },
      roles: ["Operations"],
    };
    item.store.replaceResume(preferences, pdf);
    item.store.insert({
      title: "Operations Manager",
      url: "https://jobs.lever.co/example/retained",
      source: "jobs.lever.co",
      snippet: "Operations",
      description: "Description",
      assessment: "review",
      reason: "Review details",
      status: "review",
    });
    const oldRun = item.store.startRun();
    item.store.finishRun(oldRun, "completed", "Retained history.");
    const db = new Database(join(item.directory, "workspace.sqlite"));
    db.prepare("UPDATE preferences SET value=?").run(
      JSON.stringify({
        ...preferences,
        scheduleEnabled: true,
        scheduleTime: "09:00",
        scheduleDays: [1, 2, 3, 4, 5],
        timezone: "Asia/Jakarta",
      }),
    );
    db.prepare("UPDATE runs SET trigger='schedule' WHERE id=?").run(oldRun);
    db.pragma("user_version = 3");
    db.close();
    upgraded = new Store(join(item.directory, "workspace.sqlite"));
    assert.deepEqual(upgraded.preferences(), preferences);
    assert.deepEqual(upgraded.resumeDocument(), pdf);
    assert.equal(upgraded.job(1)?.title, "Operations Manager");
    assert.equal(upgraded.runs().length, 1);
    assert.equal(upgraded.runs()[0]?.trigger, "schedule");
    const runner = new Runner(upgraded, item.config);
    const app = buildApp(upgraded, item.config, runner, item.directory, 8790);
    try {
      const headers = {
        host: "127.0.0.1:8790",
        origin: "http://127.0.0.1:8790",
        "content-type": "application/json",
      };
      const workspace = await app.inject({ url: "/api/workspace", headers });
      assert.equal("nextRun" in workspace.json(), false);
      const response = await app.inject({
        method: "POST",
        url: "/api/runs",
        headers,
        payload: { trigger: "schedule" },
      });
      assert.equal(response.statusCode, 400);
      const rejected = await app.inject({
        method: "PATCH",
        url: "/api/preferences/search",
        headers,
        payload: { scheduleEnabled: true },
      });
      assert.equal(rejected.statusCode, 400);
      assert.equal(upgraded.runs().length, 1);
      const manualRun = upgraded.startRun();
      assert.equal(upgraded.runs().find((run) => run.id === manualRun)?.trigger, "manual");
      upgraded.finishRun(manualRun, "completed", "Manual history.");
    } finally {
      await app.close();
    }
    const check = new Database(join(item.directory, "workspace.sqlite"));
    const saved = check.prepare("SELECT value FROM preferences WHERE id=1").get() as {
      value: string;
    };
    assert.doesNotMatch(saved.value, /scheduleEnabled|scheduleTime|scheduleDays|timezone/);
    check.close();
  } finally {
    upgraded?.close();
    item.cleanup();
  }
});

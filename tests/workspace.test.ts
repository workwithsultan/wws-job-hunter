import { test } from "node:test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/server/store.js";
import { Configuration } from "../src/server/config.js";
import { searchBudget, remainingDays } from "../src/shared/budget.js";
import { isScoringModel } from "../src/server/providers.js";
import { Runner } from "../src/server/runner.js";
import { buildApp } from "../src/server/app.js";
import { defaultPreferences, preferencesSchema } from "../src/shared/model.js";
import { discoverJobs } from "../src/discovery/serpapi.js";
import { isJobUrl, extractDescription } from "../src/server/extract.js";
import { searchLocation } from "../src/shared/search-scope.js";
import { searchChanged, searchValid, profileValid } from "../web/form-state.js";
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
      ready: 0,
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
    assert.equal(item.runner.nextRun(), null);
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
    assert.throws(() => item.runner.start("manual"), /Complete your profile/);
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
test("invalid schedules and operator-bearing queries are rejected", () => {
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
    assert.equal(item.store.preferences().scheduleEnabled, false);
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
  assert.equal(isScoringModel("gpt-4o"), true);
  assert.equal(isScoringModel("text-embedding-3-small"), false);
  assert.equal(isScoringModel("gpt-4o-realtime-preview"), false);
});

test("country and work type affect discovery queries, provider parameters, and previews", () => {
  const scope = { country: "id", workType: "hybrid" as const };
  const query = buildSearchQueryBody(["Operations"], scope);
  assert.match(query, /Indonesia/);
  assert.match(query, /hybrid/);
  assert.doesNotMatch(query, /remote|United States|USA/);
  assert.deepEqual(searchLocation(scope), { gl: "id", location: "Indonesia" });
  const preview = buildSearchQueryPreview(["Operations"], 20, defaultPreferences.sources, scope);
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
    searchChanged({ ...original, sources: [...original.sources].reverse() }, original),
    false,
  );
  assert.equal(
    searchChanged({ ...original, scheduleDays: [...original.scheduleDays].reverse() }, original),
    false,
  );
  assert.equal(searchChanged({ ...original, threshold: 80 }, original), false);
  assert.equal(searchValid(original, false), false);
  const configured = { ...original, roles: ["Operations"] };
  assert.equal(searchValid(configured, false), true);
  assert.equal(searchValid(configured, true), false);
  assert.equal(profileValid("", "75"), false);
  assert.equal(profileValid("Operations experience", "75"), true);
  assert.equal(profileValid("Operations experience", ""), false);
  assert.equal(profileValid("Operations experience", "101"), false);
});

test("existing preferences retain US remote behavior when upgraded", () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-upgrade-"));
  const path = join(directory, "workspace.sqlite");
  try {
    const first = new Store(path);
    first.close();
    const { country, workType, ...previous } = defaultPreferences;
    assert.equal(country, "us");
    assert.equal(workType, "remote");
    const db = new Database(path);
    try {
      db.prepare("INSERT INTO preferences(id,value) VALUES(1,?)").run(
        JSON.stringify({ ...previous, limit: 10 }),
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

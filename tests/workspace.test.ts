import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/server/store.js";
import { Configuration } from "../src/server/config.js";
import { Runner } from "../src/server/runner.js";
import { buildApp } from "../src/server/app.js";
import { defaultPreferences, preferencesSchema } from "../src/shared/model.js";
import { discoverJobs } from "../src/discovery/serpapi.js";
import { isJobUrl, extractDescription } from "../src/server/extract.js";
import { buildFirstPageSearchQueries } from "../src/discovery/search-query.js";

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

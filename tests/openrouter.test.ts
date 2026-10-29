import { assessmentResponseInstructions } from "../src/shared/assessment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenRouterClient, OpenRouterError } from "../src/server/openrouter.js";
import { Configuration } from "../src/server/config.js";
import { Providers } from "../src/server/providers.js";
import { Store } from "../src/server/store.js";
import { Runner } from "../src/server/runner.js";
import { buildApp } from "../src/server/app.js";

const model = {
  id: "vendor/assessment",
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["structured_outputs", "response_format"],
};
const job = {
  title: "Operations Manager",
  url: "https://jobs.lever.co/example/job",
  description: "Operations experience required.",
};
const assessment = { verdict: "match", score: 92, reason: "Relevant job experience." };
const completion = (
  content: string | null,
  finish_reason = "stop",
  refusal: string | null = null,
) => ({ choices: [{ finish_reason, message: { content, refusal } }] });

test("OpenRouter verifies the key before loading account-filtered compatible models", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unit-test-key");
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/key")) return Response.json({ data: {} });
    assert.equal(url, "https://openrouter.ai/api/v1/models/user");
    return Response.json({
      data: [
        model,
        model,
        { ...model, id: "other/assessment" },
        { ...model, id: "unsupported/json-only", supported_parameters: ["response_format"] },
        {
          ...model,
          id: "unsupported/image",
          architecture: { input_modalities: ["text"], output_modalities: ["image"] },
        },
      ],
    });
  };
  assert.deepEqual(await new OpenRouterClient("unit-test-key", request).models(), [
    "other/assessment",
    "vendor/assessment",
  ]);
  assert.deepEqual(
    calls.map((url) => new URL(url).pathname),
    ["/api/v1/key", "/api/v1/models/user"],
  );
});

test("OpenRouter rejects invalid keys and empty compatible catalogs without a static fallback", async () => {
  let calls = 0;
  const denied: typeof fetch = async () => {
    calls++;
    return Response.json({ error: { message: "Private upstream content" } }, { status: 401 });
  };
  await assert.rejects(
    new OpenRouterClient("unit-test-key", denied).models(),
    /rejected this key \(401\)/,
  );
  assert.equal(calls, 1);
  const unsupported: typeof fetch = async (input) =>
    String(input).endsWith("/key")
      ? Response.json({ data: {} })
      : Response.json({ data: [{ ...model, supported_parameters: [] }] });
  await assert.rejects(
    new OpenRouterClient("unit-test-key", unsupported).models(),
    /No text models with structured output/,
  );
});

test("assessment requests preserve the selected model, require schema support and validate output", async () => {
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, model.id);
    assert.equal(body.models, undefined);
    assert.deepEqual(body.provider, {
      require_parameters: true,
      data_collection: "deny",
      allow_fallbacks: false,
    });
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.deepEqual(body.response_format.json_schema.schema.properties.verdict.enum, [
      "match",
      "not_a_match",
    ]);
    assert.ok(!body.messages[0].content.includes("not_a_match|review"));
    assert.deepEqual(body.response_format.json_schema.schema.required, [
      "verdict",
      "score",
      "reason",
    ]);
    assert.equal(body.response_format.json_schema.schema.properties.reason.maxLength, 80);
    assert.ok(body.messages[0].content.endsWith(assessmentResponseInstructions));
    assert.deepEqual(JSON.parse(body.messages[1].content), job);
    return Response.json(completion(JSON.stringify(assessment)));
  };
  assert.deepEqual(
    await new OpenRouterClient("unit-test-key", request).assess(
      model.id,
      "Candidate resume",
      job,
      new AbortController().signal,
    ),
    assessment,
  );
  assert.equal(calls, 1);
});

test("malformed, out-of-range, refused and truncated assessments never become a false match", async () => {
  for (const payload of [
    completion("not JSON"),
    completion(JSON.stringify({ ...assessment, verdict: "review" })),
    completion(JSON.stringify({ ...assessment, score: null })),
    completion(JSON.stringify({ ...assessment, score: 0 })),
    completion(JSON.stringify({ ...assessment, verdict: "not_a_match", score: 50 })),
    completion(JSON.stringify({ ...assessment, score: 101 })),
    completion(JSON.stringify({ verdict: "match", reason: "Missing score" })),
    completion(JSON.stringify(assessment), "length"),
    completion(null, "stop", "Refused"),
    { choices: [] },
  ]) {
    const request: typeof fetch = async () => Response.json(payload);
    assert.equal(
      await new OpenRouterClient("unit-test-key", request).assess(
        model.id,
        "Resume",
        job,
        new AbortController().signal,
      ),
      null,
    );
  }
});

test("credit failures, provider errors and cancellation are explicit with no generation retry", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return Response.json({ error: { code: 402 } });
  };
  await assert.rejects(
    new OpenRouterClient("unit-test-key", request).assess(
      model.id,
      "Resume",
      job,
      new AbortController().signal,
    ),
    /credits.*insufficient/,
  );
  assert.equal(calls, 1);
  const unavailable: typeof fetch = async () => Response.json({}, { status: 503 });
  await assert.rejects(
    new OpenRouterClient("unit-test-key", unavailable).models(),
    OpenRouterError,
  );
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(
    new OpenRouterClient("unit-test-key", request).assess(
      model.id,
      "Resume",
      job,
      cancellation.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

test("connecting and rotating OpenRouter keys verifies metadata before saving and never reuses direct OpenAI credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunter-openrouter-"));
  writeFileSync(
    join(directory, ".env.local"),
    "APP_HOST=127.0.0.1\nPORT=8790\nDATA_DIR=./data\nOPENAI_API_KEY=old-direct-test-key\nOPENAI_MODEL=old-direct-model\nSERPAPI_API_KEYS=\n",
  );
  const config = new Configuration(directory);
  const store = new Store(join(directory, "workspace.sqlite"));
  const request: typeof fetch = async (input, init) => {
    if (new Headers(init?.headers).get("Authorization") !== "Bearer new-router-test-key")
      return Response.json({}, { status: 401 });
    return Response.json(String(input).endsWith("/key") ? { data: {} } : { data: [model] });
  };
  const runner = new Runner(store, config, new Providers(config, request));
  const app = buildApp(store, config, runner, directory, 8790);
  const headers = {
    host: "127.0.0.1:8790",
    origin: "http://127.0.0.1:8790",
    "content-type": "application/json",
  };
  try {
    assert.equal(config.connectionStatus().openrouter, false);
    assert.equal(config.connectionStatus().model, "");
    const connected = await app.inject({
      method: "PUT",
      url: "/api/openrouter/key",
      headers,
      payload: { key: "new-router-test-key" },
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(config.values().OPENROUTER_API_KEY, "new-router-test-key");
    assert.equal("OPENAI_API_KEY" in config.values(), false);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/openrouter/model",
          headers,
          payload: { model: model.id },
        })
      ).statusCode,
      200,
    );
    const rejected = await app.inject({
      method: "PUT",
      url: "/api/openrouter/key",
      headers,
      payload: { key: "invalid-router-test-key" },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(config.values().OPENROUTER_API_KEY, "new-router-test-key");
    assert.equal(config.values().OPENROUTER_MODEL, model.id);
    const workspace = await app.inject({ url: "/api/workspace", headers });
    assert.equal(workspace.json().connections.openrouter, true);
    assert.equal(workspace.body.includes("new-router-test-key"), false);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("only explicit key-expired responses are presented as expiry, and upstream details stay private", async () => {
  const expired: typeof fetch = async () =>
    Response.json({ error: { code: 401, message: "API key expired" } }, { status: 401 });
  await assert.rejects(new OpenRouterClient("unit-test-key", expired).models(), /key has expired/);
  const denied: typeof fetch = async () =>
    Response.json(
      { error: { code: 401, message: "User not found: private-account-details" } },
      { status: 401 },
    );
  await assert.rejects(new OpenRouterClient("unit-test-key", denied).models(), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /rejected this key \(401\)/);
    assert.doesNotMatch(error.message, /expired|private-account-details/);
    return true;
  });
});

test("system-managed output requirements stay fixed and invalid reason lengths are rejected", async () => {
  for (const [reason, accepted] of [
    ["x".repeat(80), true],
    ["x".repeat(81), false],
    [Array(12).fill("fit").join(" "), true],
    [Array(13).fill("fit").join(" "), false],
  ] as const) {
    const request: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      assert.ok(body.messages[0]!.content.startsWith("Assess relevant experience."));
      assert.ok(body.messages[0]!.content.endsWith(assessmentResponseInstructions));
      return Response.json(completion(JSON.stringify({ ...assessment, reason })));
    };
    const result = await new OpenRouterClient("unit-test-key", request).assess(
      model.id,
      "Assess relevant experience.",
      job,
      new AbortController().signal,
    );
    assert.equal(result !== null, accepted);
  }
});

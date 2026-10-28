import Fastify, { type FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  preferencesSchema,
  jobUpdateSchema,
  providerKeySchema,
  statusSchema,
} from "../shared/model.js";
import { searchBudget } from "../shared/budget.js";
import { keyId } from "./config.js";
import { buildSearchQueryPreview } from "../discovery/search-query.js";
import type { Store } from "./store.js";
import type { Configuration } from "./config.js";
import type { Runner } from "./runner.js";

export function buildApp(
  store: Store,
  config: Configuration,
  runner: Runner,
  root: string,
  port: number,
) {
  const app = Fastify({ logger: false, bodyLimit: 64000, requestTimeout: 30000 });
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!hosts.has(request.headers.host ?? ""))
      return reply.code(403).send({ error: "Open Job Hunter using its localhost address." });
    const origin = request.headers.origin;
    if (origin && ![...hosts].some((host) => origin === `http://${host}`))
      return reply.code(403).send({ error: "Cross-site requests are not allowed." });
    if (
      !["GET", "HEAD"].includes(request.method) &&
      (!origin || !request.headers["content-type"]?.startsWith("application/json"))
    )
      return reply.code(403).send({ error: "Use the Job Hunter interface to make changes." });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: "Check the highlighted values and try again.",
        fields: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    return reply.code(status).send({
      error:
        status === 500
          ? "The request could not be completed. Check your current settings before retrying."
          : error instanceof Error
            ? error.message
            : "The request is invalid.",
    });
  });
  app.get("/api/workspace", async () => ({
    lastRun: store.runs()[0] ?? null,
    preferences: store.preferences(),
    connections: config.connectionStatus(),
    running: runner.running,
    nextRun: runner.nextRun(),
    totals: store.totals(),
  }));
  app.get("/api/jobs", async (request) => {
    const query = z
      .object({
        q: z.string().max(200).default(""),
        status: statusSchema.or(z.literal("")).default(""),
        applications: z.enum(["true", "false"]).default("false"),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(request.query);
    return store.list({ ...query, applications: query.applications === "true" });
  });
  app.get("/api/jobs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const job = store.job(id);
    return job ?? reply.code(404).send({ error: "This job is no longer in your workspace." });
  });
  app.put("/api/jobs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const change = jobUpdateSchema.parse(request.body);
    return store.update(id, change.status, change.notes)
      ? { ok: true }
      : reply.code(404).send({ error: "This job is no longer in your workspace." });
  });
  app.delete("/api/jobs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    return store.delete(id)
      ? { ok: true }
      : reply.code(404).send({ error: "This job is no longer in your workspace." });
  });
  app.put("/api/preferences", async (request, reply) => {
    if (runner.running)
      return reply
        .code(409)
        .send({ error: "Wait for the current search to finish before changing preferences." });
    const preferences = preferencesSchema.parse(request.body);
    if (preferences.scheduleEnabled && runner.missing(preferences).length)
      return reply.code(400).send({
        error:
          "Complete your profile, target roles, and provider settings before enabling a schedule.",
      });
    store.savePreferences(preferences);
    runner.reschedule();
    return { ok: true };
  });
  const connectionChanged = () => {
    if (runner.missing().length)
      store.savePreferences({ ...store.preferences(), scheduleEnabled: false });
    runner.reschedule();
  };
  const withConnections = async <T>(reply: FastifyReply, action: () => Promise<T>) => {
    if (runner.running || runner.updatingConnections)
      return reply
        .code(409)
        .send({ error: "Wait for the current search or connection update to finish." });
    runner.updatingConnections = true;
    try {
      return await action();
    } finally {
      runner.updatingConnections = false;
    }
  };
  app.get("/api/openai/models", async (request, reply) => {
    if (!config.connectionStatus().openai)
      return reply.code(409).send({ error: "Connect an OpenAI key first." });
    try {
      return {
        models: await runner.providers.models(
          undefined,
          (request.query as { refresh?: string }).refresh === "true",
        ),
      };
    } catch (error) {
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : "Models could not be loaded." });
    }
  });
  app.put("/api/openai/key", async (request, reply) =>
    withConnections(reply, async () => {
      const { key } = providerKeySchema.parse(request.body);
      try {
        const models = await runner.providers.models(key, true);
        const current = config.connectionStatus().model;
        config.update({
          OPENAI_API_KEY: key,
          OPENAI_MODEL: models.includes(current) ? current : "",
        });
        connectionChanged();
        return { ok: true };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "The key could not be connected.",
        });
      }
    }),
  );
  app.put("/api/openai/model", async (request, reply) =>
    withConnections(reply, async () => {
      const { model } = z
        .object({ model: z.string().min(1).max(150) })
        .strict()
        .parse(request.body);
      if (!config.connectionStatus().openai)
        return reply.code(409).send({ error: "Connect an OpenAI key first." });
      try {
        const models = await runner.providers.models();
        if (!models.includes(model))
          return reply.code(400).send({ error: "Choose a model available to this key." });
        config.update({ OPENAI_MODEL: model });
        connectionChanged();
        return { ok: true };
      } catch (error) {
        return reply
          .code(502)
          .send({ error: error instanceof Error ? error.message : "Models could not be loaded." });
      }
    }),
  );
  app.delete("/api/openai/key", async (_request, reply) =>
    withConnections(reply, async () => {
      config.update({ OPENAI_API_KEY: "", OPENAI_MODEL: "" });
      connectionChanged();
      return { ok: true };
    }),
  );
  app.get("/api/serpapi/quota", async (request) =>
    runner.providers.quota((request.query as { refresh?: string }).refresh === "true"),
  );
  app.post("/api/serpapi/keys", async (request, reply) =>
    withConnections(reply, async () => {
      const { key } = providerKeySchema.parse(request.body);
      const keys = config.serpApiKeys();
      if (keys.includes(key)) return reply.code(400).send({ error: "This key is already saved." });
      if (keys.length >= 10)
        return reply.code(400).send({ error: "You can connect up to 10 SerpApi accounts." });
      try {
        const [account, quota] = await Promise.all([
          runner.providers.account(key, true),
          runner.providers.quota(),
        ]);
        if (quota.accounts.some((existing) => existing.id === account.id))
          return reply.code(400).send({
            error: "This account is already connected. Another key would share its quota.",
          });
        config.update({ SERPAPI_API_KEYS: [...keys, key].join(",") });
        connectionChanged();
        return { ok: true };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "The key could not be connected.",
        });
      }
    }),
  );
  app.delete("/api/serpapi/keys/:id", async (request, reply) =>
    withConnections(reply, async () => {
      const { id } = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }).parse(request.params);
      const keys = config.serpApiKeys();
      const remaining = keys.filter((key) => keyId(key) !== id);
      if (remaining.length === keys.length)
        return reply.code(404).send({ error: "This key is no longer saved." });
      config.update({ SERPAPI_API_KEYS: remaining.join(",") });
      connectionChanged();
      return { ok: true };
    }),
  );
  app.get("/api/runs", async () => ({ runs: store.runs() }));
  app.get("/api/query", async (_request, reply) => {
    const p = store.preferences();
    if (!p.roles.length || !config.serpApiKeys().length) return { query: "" };
    const quota = await runner.providers.quota();
    if (!quota.complete)
      return reply
        .code(502)
        .send({ error: "Check the SerpApi connection before previewing the query." });
    return {
      query: buildSearchQueryPreview(p.roles, searchBudget(quota, p).limitPerSource, p.sources),
    };
  });
  app.post("/api/runs", async (_request, reply) => {
    if (runner.running || runner.updatingConnections)
      return reply
        .code(409)
        .send({ error: "Wait for the current search or connection update to finish." });
    const missing = runner.missing();
    if (missing.length) return reply.code(400).send({ error: missing.join(". ") + "." });
    return reply.code(202).send({ id: runner.start("manual") });
  });
  app.get("/api/export", async (_request, reply) => {
    const cell = (value: string | number | null) => {
      let text = String(value ?? "");
      if (/^\s*[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const records = store
      .allJobs()
      .map((job) =>
        [
          job.title,
          job.url,
          job.source,
          job.score,
          job.reason,
          job.status,
          job.notes,
          job.createdAt,
        ]
          .map(cell)
          .join(","),
      );
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="job-hunter.csv"')
      .send(["Title,URL,Source,Score,Reason,Status,Notes,Added", ...records].join("\r\n"));
  });
  const publicDir = resolve(root, "public");
  if (existsSync(resolve(publicDir, "index.html"))) {
    app.register(staticFiles, { root: publicDir, cacheControl: false });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ error: "This endpoint does not exist." })
        : reply.sendFile("index.html"),
    );
  } else
    app.get("/", async (_request, reply) =>
      reply
        .code(503)
        .send({ error: "Build the interface with npm run build before starting the server." }),
    );
  return app;
}

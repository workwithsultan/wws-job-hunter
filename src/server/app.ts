import Fastify from "fastify";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  preferencesSchema,
  jobUpdateSchema,
  connectionUpdateSchema,
  statusSchema,
} from "../shared/model.js";
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
  app.put("/api/connections", async (request, reply) => {
    if (runner.running)
      return reply
        .code(409)
        .send({ error: "Wait for the current search to finish before changing provider keys." });
    const change = connectionUpdateSchema.parse(request.body);
    if ((change.removeOpenai && change.openaiKey) || (change.removeSerpapi && change.serpapiKey))
      return reply
        .code(400)
        .send({ error: "Choose either saving or removing a provider key, not both." });
    if (
      !change.removeOpenai &&
      (change.openaiKey || config.connectionStatus().openai) &&
      !change.model
    )
      return reply.code(400).send({ error: "Choose an OpenAI model before saving an OpenAI key." });
    const updates: Record<string, string> = { OPENAI_MODEL: change.model };
    for (const key of [change.openaiKey, change.serpapiKey])
      if (key && !/^[A-Za-z0-9_\-]+$/.test(key))
        return reply
          .code(400)
          .send({ error: "API keys must not contain spaces, quotes, or line breaks." });
    if (change.openaiKey) updates.OPENAI_API_KEY = change.openaiKey;
    if (change.serpapiKey) updates.SERPAPI_API_KEY = change.serpapiKey;
    if (change.removeOpenai) updates.OPENAI_API_KEY = "";
    if (change.removeSerpapi) updates.SERPAPI_API_KEY = "";
    config.update(updates);
    if (runner.missing().length)
      store.savePreferences({ ...store.preferences(), scheduleEnabled: false });
    runner.reschedule();
    return { ok: true };
  });
  app.get("/api/runs", async () => ({ runs: store.runs() }));
  app.get("/api/query", async () => {
    const p = store.preferences();
    return { query: p.roles.length ? buildSearchQueryPreview(p.roles, p.limit, p.sources) : "" };
  });
  app.post("/api/runs", async (_request, reply) => {
    if (runner.running) return reply.code(409).send({ error: "A search is already running." });
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

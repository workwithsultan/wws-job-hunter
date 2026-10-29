import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { Configuration } from "./config.js";
import { Store } from "./store.js";
import { Runner } from "./runner.js";
import { buildApp } from "./app.js";

const root = process.cwd();
const config = new Configuration(root);
const values = config.values();
const port = Number(values.PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Set PORT to a whole number between 1024 and 65535 in .env.local.");
const host = values.APP_HOST;
if (host !== "127.0.0.1" && host !== "::1")
  throw new Error(
    "APP_HOST must be a loopback address. Use an SSH tunnel for access from another computer.",
  );
if (!values.DATA_DIR) throw new Error("Set DATA_DIR in .env.local.");
const directory = resolve(root, values.DATA_DIR);
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const dbPath = resolve(directory, "job-hunter.sqlite");
const store = new Store(dbPath);
chmodSync(dbPath, 0o600);
store.recoverInterrupted();
const runner = new Runner(store, config);
const app = buildApp(store, config, runner, root, port);
await app.listen({ host, port });
console.info(`WWS Job Hunter is ready at http://${host === "::1" ? "[::1]" : host}:${port}`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      await Promise.all([app.close(), runner.stop()]);
      store.close();
    })().catch(() => {
      process.exitCode = 1;
    });
  });

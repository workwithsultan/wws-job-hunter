import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import type { Connections } from "../shared/model.js";

export class Configuration {
  readonly file: string;
  constructor(root: string) {
    this.file = resolve(root, ".env.local");
    if (!existsSync(this.file)) throw new Error("Run npm run setup before starting Job Hunter.");
    chmodSync(this.file, 0o600);
    const values = this.values();
    const obsoleteEmptyKeys = ["OPENAI_API_KEY", "OPENAI_MODEL"].filter(
      (key) => key in values && !values[key],
    );
    if (obsoleteEmptyKeys.length)
      this.update(
        {
          OPENROUTER_API_KEY: values.OPENROUTER_API_KEY ?? "",
          OPENROUTER_MODEL: values.OPENROUTER_MODEL ?? "",
        },
        obsoleteEmptyKeys,
      );
    if ("SERPAPI_API_KEY" in values && !("SERPAPI_API_KEYS" in values)) {
      this.update({ SERPAPI_API_KEYS: values.SERPAPI_API_KEY ?? "" }, ["SERPAPI_API_KEY"]);
    }
  }
  values(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(parseEnv(readFileSync(this.file, "utf8"))).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  connectionStatus(): Connections {
    const values = this.values();
    return {
      openrouter: Boolean(values.OPENROUTER_API_KEY),
      openrouterLastFour: values.OPENROUTER_API_KEY?.slice(-4) ?? "",
      serpapi: this.serpApiKeys().length > 0,
      serpapiKeys: this.serpApiKeys().map((key) => ({ id: keyId(key), lastFour: key.slice(-4) })),
      model: values.OPENROUTER_MODEL ?? "",
    };
  }
  serpApiKeys(): string[] {
    return [
      ...new Set(
        (this.values().SERPAPI_API_KEYS ?? "")
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ];
  }
  update(changes: Record<string, string>, remove: string[] = []): void {
    const values = { ...this.values(), ...changes };
    for (const key of remove) delete values[key];
    for (const value of Object.values(values))
      if (/[\r\n\0]/.test(value)) throw new Error("Configuration values must fit on one line.");
    const temp = this.file + ".next";
    writeFileSync(
      temp,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    renameSync(temp, this.file);
  }
}

export const keyId = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

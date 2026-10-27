import { existsSync, writeFileSync } from "node:fs";
if (!existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    "APP_HOST=127.0.0.1\nPORT=8790\nDATA_DIR=./data\nOPENAI_API_KEY=\nOPENAI_MODEL=\nSERPAPI_API_KEY=\n",
    { mode: 0o600, flag: "wx" },
  );
}
console.info(
  "Local configuration is ready. Build and start the app, then open Settings to connect your providers.",
);

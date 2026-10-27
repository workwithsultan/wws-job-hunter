import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { create } from "tar";
const files = [
  "src",
  "web",
  "tests",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.server.json",
  "vite.config.ts",
  "README.md",
  "SECURITY.md",
  "LICENSE",
  ".gitignore",
  ".nvmrc",
  ".prettierrc.json",
];
const verify = (path) => {
  if (lstatSync(path).isSymbolicLink())
    throw new Error("Source packages cannot contain symbolic links.");
  if (lstatSync(path).isDirectory()) for (const file of readdirSync(path)) verify(join(path, file));
};
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const staging = mkdtempSync(join(tmpdir(), "job-hunter-package-"));
const target = join(staging, "job-hunter");
mkdirSync(target);
mkdirSync("release", { recursive: true });
const output = resolve("release", `job-hunter-self-hosted-${version}.tar.gz`);
try {
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`Missing release source: ${file}`);
    verify(file);
    cpSync(file, join(target, file), { recursive: true });
  }
  await create({ gzip: true, file: output, cwd: staging, portable: true, noMtime: true }, [
    "job-hunter",
  ]);
  console.info(output);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

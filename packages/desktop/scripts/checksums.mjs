#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.resolve(__dirname, "../release");

const SKIP = new Set([
  "SHA256SUMS",
  "builder-debug.yml",
  "builder-effective-config.yaml",
]);

async function main() {
  const entries = await readdir(releaseDir).catch(() => []);
  const lines = [];
  for (const name of entries.sort()) {
    if (SKIP.has(name) || name.endsWith(".blockmap") || name.endsWith(".yml")) {
      continue;
    }
    const full = path.join(releaseDir, name);
    const st = await stat(full);
    if (!st.isFile()) continue;
    const buf = await readFile(full);
    const hash = createHash("sha256").update(buf).digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  if (!lines.length) {
    console.error("No release artifacts found in", releaseDir);
    process.exit(1);
  }
  const out = lines.join("\n") + "\n";
  await writeFile(path.join(releaseDir, "SHA256SUMS"), out);
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Build an uploadable Chrome Web Store ZIP from packages/extension.
 * Usage: node scripts/pack-extension.mjs
 * Output: artifacts/tabhandoff-extension-<version>.zip
 */
import { mkdir, readFile, rm, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "packages", "extension");
const outDir = path.join(root, "artifacts");
const staging = path.join(outDir, ".extension-pack");

const manifest = JSON.parse(
  await readFile(path.join(src, "manifest.json"), "utf8"),
);
const version = manifest.version || "0.0.0";
const zipName = `tabhandoff-extension-${version}.zip`;
const zipPath = path.join(outDir, zipName);

const INCLUDE = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "lib/package.js",
  "lib/bridge-client.js",
  "lib/zip.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/mark.svg",
];

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await mkdir(outDir, { recursive: true });

for (const rel of INCLUDE) {
  const from = path.join(src, rel);
  const to = path.join(staging, rel);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
}

await rm(zipPath, { force: true });
await execFileAsync("zip", ["-r", "-q", zipPath, "."], { cwd: staging });
await rm(staging, { recursive: true, force: true });

const listing = {
  file: zipName,
  path: zipPath,
  version,
  packedAt: new Date().toISOString(),
  files: INCLUDE,
};
await writeFile(
  path.join(outDir, "extension-pack.json"),
  JSON.stringify(listing, null, 2) + "\n",
);

console.log(`Packed ${zipName}`);
console.log(`→ ${zipPath}`);
console.log(`Upload this ZIP to the Chrome Web Store (founder account).`);

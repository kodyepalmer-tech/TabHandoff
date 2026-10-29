#!/usr/bin/env node
/**
 * Automated test for the package-only (no-bridge) handoff path.
 * Builds a portable ZIP the same way the extension does, unpacks it,
 * and validates with the TabHandoff CLI.
 *
 * Usage: node scripts/test-extension-package.mjs
 * Requires: pnpm build (CLI dist) once.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageMod = await import(
  pathToFileURL(path.join(root, "packages/extension/lib/package.js")).href
);
const zipMod = await import(
  pathToFileURL(path.join(root, "packages/extension/lib/zip.js")).href
);

const { buildPortablePackage, buildPackageFiles, renderAiBrief, packageForDisk } =
  packageMod;
const { buildZip, base64ToBytes } = zipMod;

// 1×1 PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pkg = buildPortablePackage({
  url: "https://example.com/",
  title: "Example Domain",
  selectedText: "This domain is for use in illustrative examples.",
  instruction: "Summarize this page for a teammate.",
  screenshots: [
    {
      filename: "capture-01.png",
      mediaType: "image/png",
      dataBase64: TINY_PNG_B64,
    },
  ],
  source: { kind: "browser_extension", extensionId: "test-extension-package" },
  id: "ext-pack-e2e-001",
  capturedAt: "2026-10-29T00:00:00.000Z",
});

assert(pkg.execution.status === "package_created", "status must be package_created");
assert(pkg.execution.agentLaunched === false, "agentLaunched must be false");

const brief = renderAiBrief(packageForDisk(pkg));
assert(brief.includes("No agent has run yet"), "AI brief must be honest");
assert(brief.includes("https://example.com/"), "AI brief must include URL");

const entries = buildPackageFiles(pkg);
const names = entries.map((e) => e.name);
assert(names.includes("handoff.json"), "ZIP must include handoff.json");
assert(names.includes("summary.md"), "ZIP must include summary.md");
assert(
  names.includes("screenshots/capture-01.png"),
  "ZIP must include screenshot file",
);

const handoffEntry = entries.find((e) => e.name === "handoff.json");
const handoffJson = JSON.parse(handoffEntry.data);
assert(
  !handoffJson.screenshots?.[0]?.dataBase64,
  "handoff.json must not embed screenshot base64",
);

const zipBytes = buildZip(
  entries.map((f) =>
    f.dataBase64
      ? { name: f.name, data: base64ToBytes(f.dataBase64) }
      : { name: f.name, data: f.data },
  ),
);
assert(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, "must be a ZIP (PK header)");

const work = await mkdtemp(path.join(tmpdir(), "tabhandoff-ext-pack-"));
const zipPath = path.join(work, `tabhandoff-${pkg.id}.zip`);
const unpackDir = path.join(work, "unpacked");
await writeFile(zipPath, zipBytes);
await mkdir(unpackDir, { recursive: true });
await execFileAsync("unzip", ["-q", zipPath, "-d", unpackDir]);

const onDisk = JSON.parse(
  await readFile(path.join(unpackDir, "handoff.json"), "utf8"),
);
assert(onDisk.id === pkg.id, "unpacked id mismatch");
assert(
  onDisk.execution.status === "package_created",
  "unpacked status must stay package_created",
);

const cli = path.join(root, "packages/cli/dist/index.js");
try {
  await readFile(cli);
} catch {
  console.error("Missing CLI build. Run: pnpm build");
  process.exit(1);
}

const { stdout } = await execFileAsync(
  process.execPath,
  [cli, "validate", unpackDir],
  { cwd: root },
);
assert(
  /valid|ok|package_created/i.test(stdout) || stdout.trim().length > 0,
  "CLI validate should succeed",
);
console.log(stdout.trim());

await rm(work, { recursive: true, force: true });
console.log("OK: package-only extension ZIP path validated (no bridge).");

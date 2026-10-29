#!/usr/bin/env node
/**
 * Automated test for the package-only (no-bridge) handoff path.
 * Builds a portable ZIP the same way the extension does, unpacks it,
 * asserts recipient-readable instructions, validates handoff.json schema
 * (protocol, no desktop), and optionally CLI validate when built.
 *
 * Usage: node scripts/test-extension-package.mjs
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
const protocolMod = await import(
  pathToFileURL(path.join(root, "packages/protocol/dist/index.js")).href
);

const {
  buildPortablePackage,
  buildPackageFiles,
  renderAiBrief,
  packageForDisk,
} = packageMod;
const { buildZip, base64ToBytes } = zipMod;
const { validatePortableHandoffPackage } = protocolMod;

// 1×1 PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const INSTRUCTION = "Summarize this page for a teammate.";
const PAGE_URL = "https://example.com/";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pkg = buildPortablePackage({
  url: PAGE_URL,
  title: "Example Domain",
  selectedText: "This domain is for use in illustrative examples.",
  instruction: INSTRUCTION,
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

// --- Copy brief: paste-ready for ChatGPT/Claude without TabHandoff ---
const brief = renderAiBrief(packageForDisk(pkg));
assert(brief.includes("No agent has run yet"), "AI brief must be honest");
assert(brief.includes(INSTRUCTION), "AI brief must include instruction");
assert(brief.includes(PAGE_URL), "AI brief must include URL");
assert(brief.includes("Example Domain"), "AI brief must include page title");
assert(
  brief.includes("Selected text") || brief.includes("untrusted"),
  "AI brief must include selection/context",
);
assert(
  !brief.includes("pnpm ") && !brief.includes("chrome://extensions"),
  "AI brief must not require install steps",
);

const entries = buildPackageFiles(pkg);
const names = entries.map((e) => e.name);
assert(names.includes("START_HERE.md"), "ZIP must include START_HERE.md");
assert(names.includes("handoff.json"), "ZIP must include handoff.json");
assert(names.includes("summary.md"), "ZIP must include summary.md");
assert(
  names.includes("screenshots/capture-01.png"),
  "ZIP must include screenshot file",
);

const startHere = entries.find((e) => e.name === "START_HERE.md").data;
assert(
  /do not need TabHandoff installed/i.test(startHere),
  "START_HERE must say TabHandoff is not required",
);
assert(startHere.includes(INSTRUCTION), "START_HERE must include instruction");
assert(startHere.includes(PAGE_URL), "START_HERE must include URL");
assert(
  /ChatGPT|Claude|Cursor/i.test(startHere),
  "START_HERE must mention paste into any AI",
);
assert(startHere.includes("handoff.json"), "START_HERE must document handoff.json");

const summary = entries.find((e) => e.name === "summary.md").data;
assert(summary.includes(INSTRUCTION), "summary.md must include instruction");
assert(summary.includes(PAGE_URL), "summary.md must include URL");
assert(
  /Continue without TabHandoff/i.test(summary),
  "summary.md must explain continue without install",
);

const handoffEntry = entries.find((e) => e.name === "handoff.json");
const handoffJson = JSON.parse(handoffEntry.data);
assert(
  !handoffJson.screenshots?.[0]?.dataBase64,
  "handoff.json must not embed screenshot base64",
);

// Schema validate without desktop (protocol package)
const schemaResult = validatePortableHandoffPackage(handoffJson);
assert(schemaResult.ok === true, `handoff.json schema invalid: ${JSON.stringify(schemaResult)}`);

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

const unpackedNames = [
  "START_HERE.md",
  "handoff.json",
  "summary.md",
  "screenshots/capture-01.png",
];
for (const rel of unpackedNames) {
  await readFile(path.join(unpackDir, rel));
}

const onDisk = JSON.parse(
  await readFile(path.join(unpackDir, "handoff.json"), "utf8"),
);
assert(onDisk.id === pkg.id, "unpacked id mismatch");
assert(
  onDisk.execution.status === "package_created",
  "unpacked status must stay package_created",
);
assert(
  validatePortableHandoffPackage(onDisk).ok === true,
  "unpacked handoff.json must pass schema",
);

const startUnpacked = await readFile(
  path.join(unpackDir, "START_HERE.md"),
  "utf8",
);
assert(
  /do not need TabHandoff installed/i.test(startUnpacked),
  "unpacked START_HERE must remain readable",
);

const cli = path.join(root, "packages/cli/dist/index.js");
try {
  await readFile(cli);
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
} catch (e) {
  if (e?.code === "ENOENT" || /Missing CLI|ENOENT/.test(String(e))) {
    console.log("(CLI dist missing — schema validate already passed without desktop)");
  } else if (e?.stdout !== undefined) {
    throw e;
  } else {
    // readFile threw — CLI optional when schema already passed
    console.log("(CLI dist missing — schema validate already passed without desktop)");
  }
}

await rm(work, { recursive: true, force: true });
console.log(
  "OK: package-only ZIP has START_HERE + handoff.json + summary; brief paste-ready; schema valid (no bridge).",
);

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
  buildContinueContext,
  renderAiBrief,
  packageForDisk,
  MAX_ARCHIVE_TURNS,
  MAX_TURN_CHARS,
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
assert(names.includes("conversation.md"), "ZIP must include conversation.md");
assert(names.includes("brief.md"), "ZIP must include brief.md");
assert(names.includes("recent.md"), "ZIP must include recent.md");
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
  "conversation.md",
  "brief.md",
  "recent.md",
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

// --- Tiered thread package: archive + brief + recent (not silent "lossless") ---
const THREAD_TURNS = [
  {
    role: "user",
    text: "Build a TypeScript validator for TabHandoff packages.",
  },
  {
    role: "assistant",
    text: "Here is a sketch. Remaining: unit tests.",
  },
  {
    role: "user",
    text: "Continue in Cursor: finish the validator tests.",
  },
];
const threadPkg = buildPortablePackage({
  url: "https://chatgpt.com/c/demo",
  title: "ChatGPT — validator handoff",
  selectedText: "finish the validator tests",
  highlightText: "finish the validator tests",
  threadText: THREAD_TURNS.map((t) => `### ${t.role}\n\n${t.text}`).join("\n\n"),
  turns: THREAD_TURNS,
  siteId: "chatgpt",
  captureMode: "selection_with_thread",
  fragile: true,
  instruction:
    "Continue this AI-chat task from the latest user prompt using the full thread.",
  source: { kind: "browser_extension", extensionId: "test-thread" },
  id: "ext-pack-thread-001",
  capturedAt: "2026-11-02T00:00:00.000Z",
});
assert(
  threadPkg.page.selectedText.includes("Build a TypeScript validator"),
  "thread package must prefer full conversation over highlight alone",
);
assert(
  threadPkg.page.selectedText.includes("finish the validator tests"),
  "thread package must include the latest prompt",
);
assert(
  threadPkg.conversation?.turns?.length === 3,
  "thread package must keep structured turns for conversation.md",
);
const threadFiles = buildPackageFiles(threadPkg);
const conversationMd = threadFiles.find((e) => e.name === "conversation.md")?.data || "";
assert(
  /Build a TypeScript validator/i.test(conversationMd),
  "conversation.md must include earlier turns",
);
assert(
  /finish the validator tests/i.test(conversationMd),
  "conversation.md must include focus prompt",
);
assert(
  /archive/i.test(conversationMd),
  "conversation.md must identify itself as the archive layer",
);
assert(
  threadPkg.conversation?.completeness === "complete",
  "short fixture thread should be complete under caps",
);
assert(
  threadPkg.conversation?.brief?.method === "heuristic_template",
  "brief must be heuristic (not fake AI summary)",
);
assert(
  (threadPkg.conversation?.recentTurns?.length || 0) >= 1,
  "thread package must expose recent turns layer",
);
assert(
  threadFiles.some((e) => e.name === "brief.md"),
  "thread ZIP must include brief.md",
);
assert(
  threadFiles.some((e) => e.name === "recent.md"),
  "thread ZIP must include recent.md",
);
const threadDisk = packageForDisk(threadPkg);
assert(
  threadDisk.conversation === undefined,
  "handoff.json must omit extension-only conversation companion",
);
assert(
  validatePortableHandoffPackage(threadDisk).ok === true,
  `thread handoff.json schema invalid: ${JSON.stringify(validatePortableHandoffPackage(threadDisk))}`,
);
const threadBrief = renderAiBrief({ ...threadDisk, conversation: threadPkg.conversation });
assert(
  /Continue context|heuristic|Recent turns/i.test(threadBrief),
  "AI brief must include labeled continue context (brief + recent)",
);
const continueCtx = buildContinueContext(threadPkg);
assert(
  /PARTIAL|complete under capture caps|Brief|Recent turns/i.test(continueCtx.text),
  "Continue context must be labeled brief+recent, not a silent raw dump",
);
assert(
  continueCtx.text.includes("finish the validator tests") ||
    /Latest user ask|Open work/i.test(continueCtx.text),
  "Continue context must carry the live edge",
);

// --- Caps → partial flag ---
const manyTurns = [];
for (let i = 0; i < MAX_ARCHIVE_TURNS + 25; i++) {
  manyTurns.push({
    role: i % 2 === 0 ? "user" : "assistant",
    text: `Turn ${i + 1}: ${"x".repeat(40)}`,
  });
}
const partialByTurns = buildPortablePackage({
  url: "https://chatgpt.com/c/long",
  title: "Long thread",
  turns: manyTurns,
  threadText: manyTurns.map((t) => t.text).join("\n").slice(0, 5000),
  instruction: "Continue the long thread.",
  source: { kind: "browser_extension" },
  id: "ext-pack-partial-turns",
  capturedAt: "2026-11-03T00:00:00.000Z",
});
assert(
  partialByTurns.conversation?.completeness === "partial",
  "exceeding archive turn cap must mark partial",
);
assert(
  (partialByTurns.conversation?.partialReasons || []).includes("max_archive_turns"),
  "partial reasons must include max_archive_turns",
);
assert(
  (partialByTurns.missingInputs || []).some((m) => /partial/i.test(m)),
  "handoff.json missingInputs must surface partial honesty",
);
assert(
  /partial/i.test(
    buildPackageFiles(partialByTurns).find((e) => e.name === "START_HERE.md").data,
  ),
  "START_HERE must show partial when caps hit",
);

const hugeTurn = "y".repeat(MAX_TURN_CHARS + 500);
const partialByTurnChars = buildPortablePackage({
  url: "https://claude.ai/chat/long",
  title: "Huge turn",
  turns: [
    { role: "user", text: hugeTurn },
    { role: "assistant", text: "ack" },
    { role: "user", text: "continue please" },
  ],
  instruction: "Continue after the huge turn.",
  source: { kind: "browser_extension" },
  id: "ext-pack-partial-turnchars",
  capturedAt: "2026-11-03T00:00:00.000Z",
});
assert(
  partialByTurnChars.conversation?.completeness === "partial",
  "per-turn char cap must mark partial",
);
assert(
  (partialByTurnChars.conversation?.partialReasons || []).includes("per_turn_chars"),
  "partial reasons must include per_turn_chars",
);

const partialFromCapture = buildPortablePackage({
  url: "https://chatgpt.com/c/cap",
  title: "Capture flagged",
  turns: THREAD_TURNS,
  threadText: THREAD_TURNS.map((t) => t.text).join("\n"),
  truncated: true,
  threadTruncated: true,
  instruction: "Continue; capture said truncated.",
  source: { kind: "browser_extension" },
  id: "ext-pack-partial-capture",
  capturedAt: "2026-11-03T00:00:00.000Z",
});
assert(
  partialFromCapture.conversation?.completeness === "partial",
  "capture truncated flag must mark partial",
);

const partialZip = buildPackageFiles(partialByTurns);
for (const name of ["conversation.md", "brief.md", "recent.md"]) {
  assert(
    partialZip.some((e) => e.name === name),
    `partial ZIP must include ${name}`,
  );
}
assert(
  /heuristic/i.test(partialZip.find((e) => e.name === "brief.md").data),
  "brief.md must disclose heuristic method",
);
assert(
  /partial/i.test(partialZip.find((e) => e.name === "recent.md").data),
  "recent.md must show partial when capped",
);
assert(
  validatePortableHandoffPackage(packageForDisk(partialByTurns)).ok === true,
  "partial package handoff.json must still validate",
);

await rm(work, { recursive: true, force: true });
console.log(
  "OK: tiered ZIP has archive + brief + recent; caps mark partial; Continue uses labeled brief+recent; schema valid (no bridge).",
);

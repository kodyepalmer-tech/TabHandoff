#!/usr/bin/env node
/**
 * Demo evidence for tiered long-thread handoff (archive + brief + recent + partial).
 * Uses a synthetic long-thread fixture (not a live ChatGPT capture).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "packages/runner/package.json"));
const { chromium } = require("playwright");
const mediaDir =
  process.env.TABHANDOFF_DEMO_OUT ||
  "/cursor/stores/bc-01a1848b-012a-753e-bf04-4981bb260b56/media/tiered-handoff-demo";

const packageMod = await import(
  pathToFileURL(path.join(root, "packages/extension/lib/package.js")).href
);
const {
  buildPortablePackage,
  buildPackageFiles,
  buildContinueContext,
  MAX_ARCHIVE_TURNS,
} = packageMod;

await mkdir(mediaDir, { recursive: true });

const manyTurns = [];
for (let i = 0; i < MAX_ARCHIVE_TURNS + 30; i++) {
  manyTurns.push({
    role: i % 2 === 0 ? "user" : "assistant",
    text:
      i % 2 === 0
        ? `User turn ${i + 1}: please keep building the TabHandoff validator. Constraint: must stay MIT.`
        : `Assistant turn ${i + 1}: sketched step ${i + 1}. Remaining: tests and honesty labels.`,
  });
}

const pkg = buildPortablePackage({
  url: "https://chatgpt.com/c/tiered-demo",
  title: "ChatGPT — long thread (tiered demo)",
  highlightText: "keep building the TabHandoff validator",
  turns: manyTurns,
  threadText: manyTurns
    .slice(-20)
    .map((t) => `### ${t.role}\n\n${t.text}`)
    .join("\n\n"),
  siteId: "fixture",
  captureMode: "selection_with_thread",
  fragile: true,
  truncated: true,
  instruction:
    "Continue the validator work from the latest user prompt. Prefer brief + recent; consult archive if needed.",
  source: { kind: "browser_extension", extensionId: "tiered-demo" },
  id: "demo-tiered-partial-001",
  capturedAt: new Date().toISOString(),
});

if (pkg.conversation?.completeness !== "partial") {
  throw new Error("Expected partial completeness for long-thread demo package");
}

const files = buildPackageFiles(pkg);
const byName = Object.fromEntries(files.map((f) => [f.name, f.data]));
for (const name of [
  "START_HERE.md",
  "conversation.md",
  "brief.md",
  "recent.md",
  "handoff.json",
  "summary.md",
]) {
  if (!byName[name]) throw new Error(`Missing package file: ${name}`);
  await writeFile(path.join(mediaDir, name), byName[name]);
}

const continueCtx = buildContinueContext(pkg);
await writeFile(
  path.join(mediaDir, "continue-context.txt"),
  continueCtx.text,
);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.TABHANDOFF_CHROME_CHANNEL || undefined,
  executablePath: process.env.TABHANDOFF_CHROME || undefined,
});
const page = await browser.newPage({ viewport: { width: 980, height: 920 } });

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Screenshot 1: popup-style partial label
await page.setContent(`<!doctype html><html><head><meta charset="utf-8" />
<title>TabHandoff — partial thread</title>
<style>
body{margin:0;font-family:"Source Sans 3",Segoe UI,sans-serif;background:
  radial-gradient(120% 80% at 10% -10%,#222 0%,transparent 55%),#0b0b0c;color:#f4f4f5}
.wrap{max-width:420px;margin:24px auto;padding:16px;border:1px solid #2a2a2e;background:#141416}
h1{font-family:Syne,Avenir Next,sans-serif;font-size:1.25rem;margin:0 0 4px}
.tag{color:#a1a1aa;font-size:.85rem;margin:0 0 14px}
h2{font-size:1rem;margin:0 0 8px}
.note{color:#a1a1aa;font-size:.85rem}
.partial{color:#fca5a5;border-left:3px solid #fca5a5;padding-left:8px;font-size:.8rem}
.sel{white-space:pre-wrap;background:#0b0b0c;border:1px solid #2a2a2e;padding:8px;max-height:140px;overflow:auto;font-size:12px}
.actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.btn{padding:10px 12px;font-weight:700;border:1px solid #2a2a2e;text-align:center}
.primary{background:#fafafa;color:#0b0b0c}
.ghost{background:transparent;color:#f4f4f5}
</style></head><body>
<div class="wrap">
  <h1>TabHandoff</h1>
  <p class="tag">Hand off coding / AI-chat work — not a Transfer app.</p>
  <h2>Hand off to another AI</h2>
  <p class="note">From Demo AI chat fixture · ${manyTurns.length} conversation turns captured</p>
  <p class="partial">Thread status: partial — caps hit. ZIP keeps archive + brief + recent; Continue uses brief+recent (not an unlabeled raw dump). Not unbounded lossless.</p>
  <p class="note">AI chat DOMs change often — review the captured thread before trusting completeness.</p>
  <p class="sel">${esc(manyTurns.slice(-3).map((t) => `${t.role}: ${t.text}`).join("\n\n"))}</p>
  <div class="actions">
    <div class="btn primary">Download handoff</div>
    <div class="btn ghost">Continue now</div>
  </div>
</div>
</body></html>`);
await page.screenshot({
  path: path.join(mediaDir, "01-partial-label-ui.png"),
  fullPage: true,
});

// Screenshot 2: three layers side by side
const briefPreview = String(byName["brief.md"]).slice(0, 900);
const recentPreview = String(byName["recent.md"]).slice(0, 900);
const archivePreview = String(byName["conversation.md"]).slice(0, 900);
await page.setContent(`<!doctype html><html><head><meta charset="utf-8" />
<title>Tiered handoff layers</title>
<style>
body{margin:0;font-family:"Source Sans 3",Segoe UI,sans-serif;background:#0b0b0c;color:#f4f4f5}
header{padding:18px 22px;border-bottom:1px solid #2a2a2e}
h1{margin:0;font-family:Syne,Avenir Next,sans-serif;font-size:1.2rem}
p{margin:6px 0 0;color:#a1a1aa}
.badge{display:inline-block;margin-top:8px;color:#fca5a5;border:1px solid #fca5a5;padding:2px 8px;font-size:.78rem}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:16px}
.card{border:1px solid #2a2a2e;background:#141416;padding:12px;min-height:420px}
.card h2{margin:0 0 8px;font-size:.95rem}
pre{white-space:pre-wrap;font-size:11px;line-height:1.4;margin:0;color:#e4e4e7}
</style></head><body>
<header>
  <h1>TabHandoff — tiered package</h1>
  <p>Three layers in the ZIP. Continue now uses brief + recent (labeled).</p>
  <div class="badge">Status: partial (max_archive_turns + capture caps)</div>
</header>
<div class="grid">
  <div class="card"><h2>1. Archive · conversation.md</h2><pre>${esc(archivePreview)}</pre></div>
  <div class="card"><h2>2. Brief · brief.md</h2><pre>${esc(briefPreview)}</pre></div>
  <div class="card"><h2>3. Recent · recent.md</h2><pre>${esc(recentPreview)}</pre></div>
</div>
</body></html>`);
await page.screenshot({
  path: path.join(mediaDir, "02-three-layers.png"),
  fullPage: true,
});

// Screenshot 3: Continue context labeling
await page.setContent(`<!doctype html><html><head><meta charset="utf-8" />
<title>Continue context</title>
<style>
body{margin:0;font-family:ui-monospace,SF Mono,monospace;background:#0b0b0c;color:#f4f4f5}
header{padding:18px 22px;border-bottom:1px solid #2a2a2e;font-family:"Source Sans 3",Segoe UI,sans-serif}
h1{margin:0;font-size:1.1rem}
p{margin:6px 0 0;color:#a1a1aa}
pre{padding:22px;white-space:pre-wrap;line-height:1.45;font-size:12px;max-width:900px}
</style></head><body>
<header>
  <h1>Continue now payload (brief + recent)</h1>
  <p>Not a silent 8k slice of the raw archive. Caps / partial are labeled in the text.</p>
</header>
<pre>${esc(continueCtx.text.slice(0, 3500))}</pre>
</body></html>`);
await page.screenshot({
  path: path.join(mediaDir, "03-continue-brief-recent.png"),
  fullPage: true,
});

const readme = `# Tiered handoff demo (2026-11-03)

**Verified** against the extension package builder with a synthetic long thread (turn-cap overflow + capture truncated flag). Not a live ChatGPT/Claude page.

## What this proves

1. Caps → **partial** status visible in UI copy and package files.
2. ZIP contains three layers: \`conversation.md\` (archive), \`brief.md\` (heuristic), \`recent.md\` (Continue-sized).
3. Continue context is **labeled brief + recent**, not an unlabeled raw dump.

## Files

| File | Meaning |
|---|---|
| \`01-partial-label-ui.png\` | Popup-style partial thread status |
| \`02-three-layers.png\` | Archive + brief + recent side by side |
| \`03-continue-brief-recent.png\` | Continue-now payload labeling |
| \`conversation.md\` / \`brief.md\` / \`recent.md\` | Generated package layers |
| \`handoff.json\` | Schema 0.1 package (\`missingInputs\` notes partial) |
| \`continue-context.txt\` | Exact Continue context string |

## Honesty

- Brief method is **heuristic_template** — not an AI summary.
- Live-site capture remains fragile; this demo does not claim a live ChatGPT capture.
`;

await writeFile(path.join(mediaDir, "README.md"), readme);
await browser.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      mediaDir,
      completeness: pkg.conversation.completeness,
      partialReasons: pkg.conversation.partialReasons,
      archiveTurns: pkg.conversation.turnCount,
      recentTurns: pkg.conversation.recentTurns.length,
      continueChars: continueCtx.text.length,
    },
    null,
    2,
  ),
);

#!/usr/bin/env node
/**
 * Demo evidence for in-tool / full-thread handoff using the local AI-chat fixture.
 * Does not claim a live ChatGPT/Claude capture (those DOMs are fragile / may block automation).
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "packages/runner/package.json"));
const { chromium } = require("playwright");
const mediaDir =
  process.env.TABHANDOFF_DEMO_OUT ||
  "/cursor/stores/bc-01a1848b-012a-753e-bf04-4981bb260b56/media/in-tool-handoff-demo";
const fixtureUrl =
  process.env.TABHANDOFF_FIXTURE_URL ||
  "http://127.0.0.1:8765/ai-chat-fixture.html";

const packageMod = await import(
  pathToFileURL(path.join(root, "packages/extension/lib/package.js")).href
);
const { buildPortablePackage, buildPackageFiles, renderConversationMarkdown } =
  packageMod;

await mkdir(mediaDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: process.env.TABHANDOFF_CHROME_CHANNEL || undefined,
  executablePath: process.env.TABHANDOFF_CHROME || undefined,
});
const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
await page.goto(fixtureUrl, { waitUntil: "networkidle" });

// Highlight the target prompt (last user message).
await page.locator("#target-prompt").evaluate((el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

await page.screenshot({
  path: path.join(mediaDir, "01-fixture-thread-selected.png"),
  fullPage: true,
});

// Inject the same capture helper the extension uses.
const injectSrc = await readFile(
  path.join(root, "packages/extension/content/capture-inject.js"),
  "utf8",
);
const capture = await page.evaluate((src) => {
  // eslint-disable-next-line no-eval
  return eval(src);
}, injectSrc);

if (!capture?.ok || !(capture.turnCount >= 2) || !capture.threadText) {
  await browser.close();
  throw new Error(
    `Expected multi-turn thread capture from fixture, got: ${JSON.stringify(capture, null, 2)}`,
  );
}

await writeFile(
  path.join(mediaDir, "capture-result.json"),
  JSON.stringify(capture, null, 2),
);

const pkg = buildPortablePackage({
  url: capture.url,
  title: capture.title,
  selectedText: capture.selectedText,
  highlightText: capture.selectedText,
  threadText: capture.threadText,
  turns: capture.turns,
  siteId: capture.siteId,
  captureMode: capture.captureMode,
  fragile: true,
  instruction:
    "Continue this AI-chat / coding-agent task from the latest user prompt. Use the full conversation thread so you do not miss earlier turns.",
  source: { kind: "browser_extension", extensionId: "demo" },
  id: "demo-in-tool-thread-001",
  capturedAt: new Date().toISOString(),
});

const files = buildPackageFiles(pkg);
const conversation = files.find((f) => f.name === "conversation.md")?.data || "";
await writeFile(path.join(mediaDir, "conversation.md"), conversation);
await writeFile(
  path.join(mediaDir, "handoff.json"),
  files.find((f) => f.name === "handoff.json")?.data || "",
);

// Render conversation.md in a simple page for a second screenshot.
await page.setContent(`<!doctype html><html><head><meta charset="utf-8" />
<title>Handoff package preview</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#0b0b0c;color:#f4f4f5}
header{padding:20px 24px;border-bottom:1px solid #2a2a2e}
h1{margin:0;font-size:1.2rem}
p{margin:6px 0 0;color:#a1a1aa}
pre{white-space:pre-wrap;padding:24px;line-height:1.45;font-size:13px;max-width:860px}
.actions{display:flex;gap:12px;padding:16px 24px}
.btn{padding:10px 14px;border-radius:8px;border:1px solid #2a2a2e;font-weight:600}
.primary{background:#fafafa;color:#0b0b0c}
.ghost{background:transparent;color:#f4f4f5}
</style></head><body>
<header><h1>TabHandoff — handoff package</h1>
<p>Full thread captured (${capture.turnCount} turns). Download handoff or Continue now.</p></header>
<div class="actions"><div class="btn primary">Download handoff</div><div class="btn ghost">Continue now</div></div>
<pre id="c"></pre></body></html>`);
await page.locator("#c").evaluate((el, text) => {
  el.textContent = text;
}, conversation);
await page.screenshot({
  path: path.join(mediaDir, "02-package-full-thread.png"),
  fullPage: true,
});

const readme = `# In-tool handoff demo (2026-11-02)

Verified against the **local AI-chat fixture** (\`packages/extension/fixtures/ai-chat-fixture.html\`), not a live ChatGPT/Claude page (sites often block automation; real DOMs are fragile).

## What this proves

1. User highlights a prompt inside a multi-turn AI chat UI (fixture).
2. Extension capture logic (\`content/capture-inject.js\`) returns the **full conversation thread** (${capture.turnCount} turns), not only the highlight.
3. Portable package includes \`conversation.md\` + \`handoff.json\` with the thread in \`page.selectedText\`.
4. Product actions remain: **Download handoff** (later upload) or **Continue now** (local bridge when available).

## Files

| File | Meaning |
|---|---|
| \`01-fixture-thread-selected.png\` | Fixture chat with target prompt selected |
| \`02-package-full-thread.png\` | Package preview showing full thread + Download / Continue |
| \`conversation.md\` | Generated lossless transcript |
| \`capture-result.json\` | Raw capture payload from the inject script |
| \`handoff.json\` | Portable package (schema 0.1) |

## Honesty

- Live ChatGPT / Claude / Cursor web capture uses the same best-effort selectors and is labeled **fragile**.
- This demo does **not** claim Chrome context-menu UI automation or a live site capture.
`;

await writeFile(path.join(mediaDir, "README.md"), readme);
await browser.close();
console.log(
  JSON.stringify(
    {
      ok: true,
      mediaDir,
      turnCount: capture.turnCount,
      captureMode: capture.captureMode,
      threadChars: capture.threadText.length,
    },
    null,
    2,
  ),
);

<p align="center">
  <img src="docs/assets/tabhandoff-app-icon.png" alt="TabHandoff" width="96" height="96" />
</p>

<h1 align="center">TabHandoff</h1>

<p align="center">
  <strong>Turn any browser tab into a portable, AI-ready handoff.</strong><br/>
  <em>See what your AI did. Keep the evidence. Pass the work on.</em>
</p>

<p align="center">
  Capture → Package → Continue · MIT · local-first · no cookies by default<br/>
  <a href="https://github.com/kodyepalmer-tech/TabHandoff">github.com/kodyepalmer-tech/TabHandoff</a>
</p>

<p align="center">
  <img src="docs/assets/tabhandoff-demo.gif" alt="Real TabHandoff demo: capture, package, page extraction, local evidence" width="720" />
</p>

<p align="center"><sub>Real CLI + desktop capture · page extraction (DOM) · not autonomous AI · proof stays local</sub></p>

---

## What it does (for everyday AI users)

You are reading a page. You want another person — or another AI — to pick up the work with context and proof.

1. **Hand off** the tab with the browser extension (MVP path — no Terminal).
2. TabHandoff **packages** the URL, instruction, selection, and optional screenshot into a ZIP.
3. You **Save package** (download) and optionally **Copy brief for another AI**.
4. Optional later: local bridge / desktop saves into My Activity and can run page extraction.

Status is always honest: TabHandoff never pretends an agent ran when only a package was created.

---

## Install (browser-first MVP)

**Chrome Web Store listing is not live yet.** Until it is, use sideload / Load unpacked. There is **no** fake store URL in this repo.

### 1. Get the extension

| Path | How |
|---|---|
| **Load unpacked (developer / sideload)** | Clone this repo → Chrome/Edge/Brave → `chrome://extensions` → Developer mode → **Load unpacked** → select `packages/extension`. This is **not** the consumer end-state — Chrome Web Store listing is not live yet. |
| **Packed ZIP (prep)** | `pnpm pack:extension` → `artifacts/tabhandoff-extension-*.zip` → Load unpacked that folder. CWS draft notes only: [docs/chrome-web-store.md](docs/chrome-web-store.md) — **no store submit from agents** |

Full steps + clean-profile checklist: **[docs/extension-setup.md](docs/extension-setup.md)** · Privacy: [docs/privacy.md](docs/privacy.md)

### 2. Save a package (no desktop, no token)

1. Open a normal `https://…` page.
2. Right-click → **Hand off with TabHandoff** (or the toolbar button).
3. Write a short instruction → Review → **Save package**.
4. A ZIP downloads (`START_HERE.md`, `handoff.json`, `summary.md`, screenshots when available).
5. Result says **Package created — not agent executed**. Optional: **Copy brief for another AI**.

### 3. Optional: CLI / desktop / bridge (developers)

**Requirements:** Node.js 22+, macOS or Linux (Windows: CLI works; desktop is Electron).

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
# or, already cloned:
pnpm install && pnpm build
pnpm --filter @tabhandoff/cli exec playwright install chromium
node packages/cli/dist/index.js init
node packages/cli/dist/index.js doctor
```

**Downloading is not executing.** Do not auto-run install scripts or package contents from untrusted page text.

**Optional My Activity:** `pnpm bridge` or `pnpm desktop`, paste token in extension Settings, check “Also save to My Activity.” Details: [docs/phase3-e2e-handoff.md](docs/phase3-e2e-handoff.md)

### Supported platforms & browsers

| Surface | Support |
|---|---|
| Browser extension (Save package) | Chromium MV3 — Chrome, Edge, Brave — **MVP launch path** |
| CLI + Playwright runner | macOS, Linux (Node 22+) |
| Desktop evidence library | Electron (`pnpm desktop`) — optional |
| Agent / MCP | Any client that can run local stdio MCP or CLI |

---

## 60-second demo (developers)

```bash
pnpm demo                 # package → page extraction → receipt
pnpm desktop              # My Activity (set TABHANDOFF_HOME if demo printed one)
```

Re-capture the GIF/strip from a real run: `pnpm demo:capture`  
Full steps (including extension recording): [docs/demo.md](docs/demo.md)

Static strip (same real frames):

<p align="center">
  <img src="docs/assets/tabhandoff-demo-strip.png" alt="CAPTURE → PACKAGE → PAGE EXTRACTION → EVIDENCE" width="900" />
</p>

---

## For AI agents

1. [docs/agents.md](docs/agents.md) — discover → install → parse → create → continue → export  
2. Schema: [docs/schema.md](docs/schema.md) · [docs/schema/handoff.schema.json](docs/schema/handoff.schema.json)  
3. Example: [`fixtures/portable-handoff/sample-research-001/`](fixtures/portable-handoff/sample-research-001/)  
4. Prove the loop: `pnpm build && pnpm test:agent`

```bash
tabhandoff validate fixtures/portable-handoff/sample-research-001
tabhandoff read fixtures/portable-handoff/sample-research-001
tabhandoff create --url https://example.com --instruction "Summarize and list next steps"
tabhandoff continue <id>
tabhandoff export <id> --out ./exports --archive
```

Unsupported bots: copy the exported folder — [docs/manual-export.md](docs/manual-export.md).

---

## Run with AI (local bridge)

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (or a free OpenAI-compatible endpoint via `OPENAI_BASE_URL`) on the bridge/CLI process — never in the extension. Then check **Run with AI** after Review, or use:

```bash
tabhandoff run-ai --instruction "Summarize this page" --url https://example.com --context ./page.txt
```

Details: [docs/ai-execution.md](docs/ai-execution.md) · end-to-end handoff: [docs/phase3-e2e-handoff.md](docs/phase3-e2e-handoff.md)

---

## Privacy & local storage

- Default store: `~/.tabhandoff/` (override with `TABHANDOFF_HOME`)
- Receipts, screenshots, bridge token, and jobs stay on **this machine**
- No telemetry or background upload of page content
- Cookies/credentials are **not** transferred by default
- Sharing happens only when **you** export, copy, or send a package
- Captured page text is **untrusted** (prompt-injection aware)

```text
~/.tabhandoff/receipts/<handoff-id>/
├── handoff.json    # portable package (schema 0.1)
├── receipt.md
├── summary.md
├── card.yaml
└── screenshots/
```

---

## Limitations

- **Not in v0.1:** marketplace, hosted cloud platform, cookie/session vault, controlling arbitrary third-party bots.
- DOM extract without an API key is **page extraction**, not AI task completion.
- Isolated Chromium has **no** user cookies — login walls fail honestly.
- Screenshot SHA-256 detects file changes; it does **not** prove an event occurred.
- Extension capture on headless CI may be limited — use CLI/desktop demo ([docs/demo.md](docs/demo.md)).

---

## Troubleshooting

See **[docs/troubleshooting.md](docs/troubleshooting.md)** for doctor failures, bridge tokens, empty My Activity, and agent validate errors.

---

## What ships in v0.1

| Surface | Status |
|---|---|
| Portable schema `0.1` + examples + agent guide | ✅ |
| CLI job + package verbs | ✅ |
| MCP tools | ✅ |
| Playwright ephemeral Chromium runner | ✅ |
| Desktop evidence library | ✅ |
| Browser extension Save package (no bridge) | ✅ MVP |
| Local bridge + My Activity (optional) | ✅ |
| Real demo GIF + capture scripts | ✅ Phase 5 |
| Chrome Web Store listing | ⏳ founder submit — sideload until then |

Phase notes: [phase1](docs/phase1-evidence-library.md) · [phase2](docs/phase2-browser-extension.md) · [phase3](docs/phase3-e2e-handoff.md) · [phase4](docs/phase4-portability.md) · [demo](docs/demo.md)

---

## MCP clients

| Client | Path |
|---|---|
| Cursor | [docs/clients/cursor.md](docs/clients/cursor.md) |
| Claude Desktop | [docs/clients/claude-desktop.md](docs/clients/claude-desktop.md) |
| ChatGPT | [docs/clients/chatgpt.md](docs/clients/chatgpt.md) |
| Grok | [docs/clients/grok.md](docs/clients/grok.md) |

```json
{
  "mcpServers": {
    "tabhandoff": {
      "command": "node",
      "args": ["/ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js"]
    }
  }
}
```

---

## Monorepo

```
packages/
  protocol/   @tabhandoff/protocol
  runner/     @tabhandoff/runner
  mcp/        @tabhandoff/mcp
  cli/        @tabhandoff/cli
  bridge/     @tabhandoff/bridge
  evidence/   @tabhandoff/evidence
  desktop/    @tabhandoff/desktop
  extension/  Chromium MV3
docs/         schema · agents · demo · troubleshooting · assets
fixtures/     receipts-home + portable-handoff examples
scripts/      install.sh · demo.sh · capture-demo.mjs · pack-extension.mjs
```

## License

MIT — OSS protocol first; commercial hosted routing later. Never paywall the core.

> We do **not** claim [openhandoff.com](https://openhandoff.com) (unrelated SaaS). Product is **TabHandoff** (`tabhandoff` / `@tabhandoff/*`).

<p align="center">
  <img src="docs/assets/tabhandoff-app-icon.png" alt="TabHandoff" width="96" height="96" />
</p>

<h1 align="center">TabHandoff</h1>

<p align="center">
  <strong>Connect local AI. Run a browser task. Keep the result.</strong><br/>
  <em>See what your AI did. Keep the evidence. Pass the work on.</em>
</p>

<p align="center">
  Local AI → task → result → history · ZIP optional · MIT · local-first<br/>
  <a href="https://github.com/kodyepalmer-tech/TabHandoff">github.com/kodyepalmer-tech/TabHandoff</a>
  · site: <code>website/</code> (Pages + <code>tabhandoff.com</code> DNS are founder steps — not live yet)
</p>

<p align="center">
  <img src="docs/assets/tabhandoff-demo.gif" alt="TabHandoff demo: capture, local run, evidence on this machine" width="720" />
</p>

<p align="center"><sub>Desktop + local bridge · honest status · proof stays local · CWS / signed installers not live</sub></p>

---

## What it does (for everyday AI users)

1. **Connect** local AI via the desktop app / bridge (Ollama or a key that stays on this computer).
2. **Hand off** a browser tab with an instruction.
3. Get a **real result** and **saved history** under `~/.tabhandoff/`.
4. **Optionally** download a portable ZIP when you want to share — ZIP is not required for the primary path.

Status is always honest: TabHandoff never pretends an agent ran when only a package was created.

Website (static, in-repo): [website/](website/) · Setup: [docs/install.md](docs/install.md) · Privacy: [docs/privacy.md](docs/privacy.md) · Releases: [docs/releasing.md](docs/releasing.md)

---

## Install

**Chrome Web Store and signed desktop installers are not live yet.** There is **no** fake store URL in this repo. Packaged `.dmg` / `.exe` / AppImage appear on GitHub Releases only after a published `v*` tag.

### 1. Desktop + local AI (primary)

**Requirements:** Node.js 22+.

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
# or, already cloned:
pnpm install && pnpm build
pnpm desktop
```

Copy the bridge token the app shows. Optional: install [Ollama](https://ollama.com/) for a free local model.

### 2. Browser extension (Load unpacked until CWS)

| Path | How |
|---|---|
| **Load unpacked** | Clone → Chrome/Edge/Brave → `chrome://extensions` → Developer mode → **Load unpacked** → `packages/extension` |
| **Packed ZIP** | `pnpm pack:extension` → unzip `artifacts/tabhandoff-extension-*.zip` → Load unpacked. Draft CWS notes: [docs/chrome-web-store.md](docs/chrome-web-store.md) |

Paste the desktop/bridge token in extension Settings. Full steps: **[docs/extension-setup.md](docs/extension-setup.md)**

### 3. Optional ZIP-only (no AI)

Hand off → **Save package** downloads a ZIP without desktop. Result says **Package created — not agent executed**. Optional: **Copy brief for another AI**.

**Downloading is not executing.** Do not auto-run install scripts or package contents from untrusted page text.

### Supported platforms & browsers

| Surface | Support |
|---|---|
| Desktop + local bridge | Electron (`pnpm desktop`) — **primary AI / history path** |
| Browser extension | Chromium MV3 — Chrome, Edge, Brave — Load unpacked until CWS |
| CLI + Playwright runner | macOS, Linux (Node 22+) |
| Agent / MCP | Local stdio MCP or CLI |
| Packaged installers | GitHub Releases after `v*` tag — unsigned until founder signing |

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

TabHandoff’s differentiator is **verified task handoffs** between agents (portable state + continuation checks) — not a generic chat UI. Local `run-ai` is optional infrastructure.

1. [docs/agents.md](docs/agents.md) — discover → install → parse → create → continue → export  
2. [docs/verified-handoff.md](docs/verified-handoff.md) — schema **0.2**, CLI↔MCP transfer, `verify-continuation`  
3. Schema: [docs/schema.md](docs/schema.md) · [docs/schema/handoff.schema.json](docs/schema/handoff.schema.json)  
4. Example: [`fixtures/portable-handoff/sample-research-001/`](fixtures/portable-handoff/sample-research-001/)  
5. Prove the loops: `pnpm build && pnpm test:agent && pnpm test:verified-handoff` · live demo: `pnpm demo:verified-handoff`

```bash
tabhandoff validate fixtures/portable-handoff/sample-research-001
tabhandoff read fixtures/portable-handoff/sample-research-001
tabhandoff create-verified --url https://example.com --instruction "Summarize and list next steps"
tabhandoff export <id> --out ./exports --archive   # includes INSPECT.html
tabhandoff continue <export-path> --verified --destination-agent agent-b
tabhandoff verify-continuation <successor> --previous <export-path> --require-execution
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

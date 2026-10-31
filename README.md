<p align="center">
  <img src="docs/assets/tabhandoff-app-icon.png" alt="TabHandoff" width="96" height="96" />
</p>

<h1 align="center">TabHandoff</h1>

<p align="center">
  <strong>One task. The next agent picks up where you left off.</strong><br/>
  <em>Your AI was here. Now the next one can pick up.</em>
</p>

<p align="center">
  Open handoff layer for <strong>AI coding agents</strong> · portable verified packages · browser capture today<br/>
  MIT · local-first by default · not a chatbot or model dashboard<br/>
  <a href="https://github.com/kodyepalmer-tech/TabHandoff">github.com/kodyepalmer-tech/TabHandoff</a>
  · site: <a href="https://kodyepalmer-tech.github.io/TabHandoff/">github.io/TabHandoff</a>
</p>

<p align="center">
  <img src="docs/assets/tabhandoff-demo.gif" alt="TabHandoff: capture, package, continue with proof" width="720" />
</p>

<p align="center"><sub>Beachhead: coding-agent handoffs · file/desktop capture &amp; “any agent anywhere” are roadmap · CWS / signed installers not live</sub></p>

---

## What it is

TabHandoff is the **universal handoff and execution layer** for AI agents: an open portable format plus a runnable reference implementation. End goal: seamless, lossless, 1-click — one task, any compatible agent, no lost progress.

**Today (honest):** reliable handoffs between **AI coding agents**; **browser capture** ships; CLI/MCP validate · continue · verify. Local bridge / desktop / `run-ai` are **supporting infrastructure**, not the product story.

**Not shipped (roadmap):** file &amp; desktop capture; “any agent anywhere”; one-click store install; managed compatibility / shared history / governance.

Status is always honest: never pretends an agent ran or a handoff continued without evidence.

Website: [website/](website/) · [docs/verified-handoff.md](docs/verified-handoff.md) · [docs/install.md](docs/install.md) · [docs/privacy.md](docs/privacy.md)

---

## Install

**Chrome Web Store and signed desktop installers are not live yet.** No fake store URL in this repo.

### 1. From source (coding-agent path)

**Requirements:** Node.js 22+.

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
# or, already cloned:
pnpm install && pnpm build
```

### 2. Browser capture (Load unpacked until CWS)

| Path | How |
|---|---|
| **Load unpacked** | Clone → Chrome/Edge/Brave → `chrome://extensions` → Developer mode → **Load unpacked** → `packages/extension` |
| **Packed ZIP** | `pnpm pack:extension` → unzip → Load unpacked. Draft CWS notes: [docs/chrome-web-store.md](docs/chrome-web-store.md) |

Hand off a page → **Save package** (portable ZIP). Optional: local bridge token for loopback. Steps: **[docs/extension-setup.md](docs/extension-setup.md)**

### 3. Continue in a coding agent

See [docs/verified-handoff.md](docs/verified-handoff.md) — `validate` / `create-verified` / `continue` / `verify-continuation`.

**Downloading is not executing.** Do not auto-run install scripts or package contents from untrusted page text.

### Surfaces

| Surface | Role today |
|---|---|
| Browser extension | Capture — Load unpacked until CWS |
| CLI / MCP | Coding-agent handoff validate · continue · verify |
| Desktop / bridge | Optional loopback + history (supporting) |
| Packaged installers | Only after a published `v*` tag — unsigned until signing |

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

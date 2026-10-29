<p align="center">
  <img src="docs/assets/tabhandoff-app-icon.png" alt="TabHandoff" width="96" height="96" />
</p>

<h1 align="center">TabHandoff</h1>

<p align="center">
  <strong>The open handoff protocol for AI agents.</strong><br/>
  <em>Your AI was here. Now the next one can pick up.</em>
</p>

<p align="center">
  Capture → Package → Continue · MIT · no cookies by default<br/>
  <a href="https://github.com/kodyepalmer-tech/TabHandoff">github.com/kodyepalmer-tech/TabHandoff</a>
</p>

---

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
```

Node 22+. Clones to `~/tabhandoff`, builds, installs Chromium, runs `init`. No account.

Already cloned? `./scripts/install.sh`

---

## Demo (what you’re seeing)

**Capture** a URL → **Package** a Task Card → **Continue** in an isolated browser → get a **Receipt** (proof).

<p align="center">
  <img src="docs/assets/tabhandoff-demo-strip.png" alt="CAPTURE → PACKAGE → CONTINUE → RECEIPT — proof stays local" width="900" />
</p>

```bash
cd ~/tabhandoff
node packages/cli/dist/index.js run \
  --url https://playwright.dev/docs/intro \
  --instruction "Extract the page title and first three getting-started steps as markdown" \
  --wait
```

### Where’s the proof?

On **this machine only** (not uploaded to a cloud by default):

```text
~/.tabhandoff/receipts/<handoff-id>/
├── receipt.md      # shareable markdown receipt
├── card.yaml       # Task Card (portable handoff)
└── screenshots/    # before/after stills
```

Open a receipt: `node packages/cli/dist/index.js receipt <handoff-id>`  
Privacy default: cookies/creds are **not** transferred; proof stays local unless *you* copy/share it.
---

## The loop

| Step | What happens |
|---|---|
| **1. Capture** | Browser extension (right-click / toolbar), or CLI/MCP |
| **2. Package** | Portable Task Card: URL, context, instructions, permitted evidence |
| **3. Continue** | Another agent resumes in an **isolated** browser and returns a receipt |

**Safety default:** cookies, credentials, and authenticated browser state are **not** transferred.

---

## Browser extension + end-to-end handoff (Phase 2–3)

Hand off a live tab without opening Terminal for the capture step. With the bridge running, confirm to run **page extraction** (isolated Chromium / DOM — not autonomous AI unless an API key is set):

1. `pnpm build && pnpm bridge` (or `pnpm desktop`)
2. Load unpacked extension from `packages/extension` — see [docs/extension-setup.md](docs/extension-setup.md)
3. Right-click → **Hand off with TabHandoff** → review → **Hand off**
4. Watch status in the popup → open desktop **My Activity** for receipts and screenshots

Details: [docs/phase3-e2e-handoff.md](docs/phase3-e2e-handoff.md)

If the local bridge is off, you still get a downloadable package. TabHandoff never pretends an agent ran when only a package was created. Details: [docs/phase2-browser-extension.md](docs/phase2-browser-extension.md)

## Why star / contribute

- **Protocol first** — open Task Cards + MCP tools other agents can implement
- **Proof every run** — postable receipts (the shareable artifact)
- **Small v0.1** — MCP + Playwright + CLI + extension; no marketplace, no cookie vault

---

## What ships in v0.1

| Surface | Status |
|---|---|
| MCP `handoff_create` / `handoff_status` / `handoff_receipt` | ✅ |
| Playwright **ephemeral** Chromium runner | ✅ |
| CLI (`init` / `run` / `capture` / `status` / `receipt` / `doctor`) | ✅ |
| Receipt markdown + screenshots + Task Card YAML | ✅ |
| Desktop evidence library (My Activity) | ✅ Phase 1 — `pnpm desktop` |

**Not in v1:** marketplace, hosted cloud platform, cookie/session vault, general-purpose agent.

**Mascot (art later):** pigeon messenger.

> We do **not** claim [openhandoff.com](https://openhandoff.com) (unrelated SaaS). Product is **TabHandoff** (`tabhandoff` / `@tabhandoff/*`).

---

## Clients

| Client | Path |
|---|---|
| **Cursor** | [docs/clients/cursor.md](docs/clients/cursor.md) |
| **Claude Desktop** | [docs/clients/claude-desktop.md](docs/clients/claude-desktop.md) |
| **ChatGPT** | [docs/clients/chatgpt.md](docs/clients/chatgpt.md) |
| **Grok** | [docs/clients/grok.md](docs/clients/grok.md) |
| **CLI** | Works alone |

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

## Brand assets

| Asset | Path |
|---|---|
| App icon / avatar (hero) | [`docs/assets/tabhandoff-app-icon.png`](docs/assets/tabhandoff-app-icon.png) — black squircle, white bidirectional arrows |
| Logo (same mark) | [`docs/assets/tabhandoff-logo.png`](docs/assets/tabhandoff-logo.png) |
| SVG mark (B&W ↔ arrows) | [`docs/assets/tabhandoff-mark.svg`](docs/assets/tabhandoff-mark.svg) |
| GitHub social preview (1200×630) | [`docs/assets/tabhandoff-og.png`](docs/assets/tabhandoff-og.png) |
| Demo (static strip) | [`docs/assets/tabhandoff-demo-strip.png`](docs/assets/tabhandoff-demo-strip.png) |

Repo settings → Social preview → upload `docs/assets/tabhandoff-og.png`. Use the **B&W app icon PNG** as the org/user avatar.

---

## Monorepo

```
packages/
  protocol/   @tabhandoff/protocol
  runner/     @tabhandoff/runner
  mcp/        @tabhandoff/mcp
  cli/        @tabhandoff/cli
  evidence/   @tabhandoff/evidence   # index/import/export
  desktop/    @tabhandoff/desktop    # Electron My Activity UI
fixtures/     sample ~/.tabhandoff tree for tests
docs/assets/  app icon · OG · static demo stills
scripts/install.sh
```

### Desktop evidence library

```bash
pnpm build
TABHANDOFF_HOME="$PWD/fixtures/receipts-home" pnpm desktop
```

See [docs/phase1-evidence-library.md](docs/phase1-evidence-library.md).

## License

MIT — OSS protocol first; commercial hosted routing later. Never paywall the core.

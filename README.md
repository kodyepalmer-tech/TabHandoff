# TabHandoff

[![GitHub](https://img.shields.io/badge/github-kodyepalmer--tech%2FTabHandoff-black)](https://github.com/kodyepalmer-tech/TabHandoff)

**TABHANDOFF — The open handoff protocol for AI agents.**

**Your AI was here. Now the next one can pick up.**

Capture → Package → Continue (any agent) + receipt.

Live self-hosted v0.1 — not a stub. MIT · OSS protocol first · small v1 · no marketplace or cloud platform yet.

---

## The loop

| Step | What happens |
|---|---|
| **1. Capture** | Point TabHandoff at a complicated page (CLI/MCP today; browser “Handoff” next) with highlights / task context |
| **2. Package** | Portable open-format bundle: URL, context, instructions, permitted evidence → Task Card on disk |
| **3. Continue** | Another agent resumes via MCP/CLI in an **isolated** browser and returns a result with an **execution receipt** |

**Safety default:** cookies, credentials, and authenticated browser state are **not** transferred. Ephemeral Chromium only — no daily-driver profile clone. Safe context + explicit permissions only.

---

## One-command install

```bash
pnpm install && pnpm build && pnpm --filter @tabhandoff/cli exec playwright install chromium && node packages/cli/dist/index.js init
```

No account required. Then:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js run \
  --url https://example.com \
  --instruction "Extract the main heading and first paragraph as markdown" \
  --wait
```

Shareable artifacts: `~/.tabhandoff/receipts/<id>/` — `receipt.md`, screenshots, `card.yaml` (postable receipt; GIF polish next).

---

## Viral engineering (v0.1)

1. **One-command install** — try the CLI with no account  
2. **Visual handoff** — screenshots + action log every run (agent → proof)  
3. **Shareable receipt** — markdown people can post/remix  
4. **Open format** — Task Cards + MCP (`handoff.create` / `.status` / `.receipt`)  
5. **Distribution loop** — every receipt invites the next agent/person to pick up  

---

## What ships in v0.1

| Surface | Status |
|---|---|
| MCP `handoff_create` / `handoff_status` / `handoff_receipt` | ✅ |
| Playwright **ephemeral** Chromium runner | ✅ |
| CLI (`init` / `run` / `capture` / `status` / `receipt` / `doctor`) | ✅ |
| Receipt markdown + screenshots + Task Card YAML | ✅ |
| DOM extractor (no API key) · optional OpenAI/Anthropic loop | ✅ |

**Not in v1:** marketplace, hosted cloud platform, cookie/session vault, general-purpose agent.

**Mascot (art later):** pigeon messenger — carries a tab like a letter, holds the receipt when done.

> We do **not** claim [openhandoff.com](https://openhandoff.com) (unrelated SaaS). Product is **TabHandoff** (`tabhandoff` / `@tabhandoff/*`).

---

## Clients

| Client | Path |
|---|---|
| **Cursor** | Local stdio MCP — [docs/clients/cursor.md](docs/clients/cursor.md) |
| **Claude Desktop** | Local stdio MCP — [docs/clients/claude-desktop.md](docs/clients/claude-desktop.md) |
| **ChatGPT** | Desktop/Codex stdio; web needs tunnel — [docs/clients/chatgpt.md](docs/clients/chatgpt.md) |
| **Grok** | Grok Build local MCP; grok.com needs public URL — [docs/clients/grok.md](docs/clients/grok.md) |
| **CLI** | Works alone — no chat client required |

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
  protocol/   @tabhandoff/protocol   # open handoff schemas
  runner/     @tabhandoff/runner     # isolated Playwright
  mcp/        @tabhandoff/mcp        # handoff.create / status / receipt
  cli/        @tabhandoff/cli        # bin: tabhandoff
cards/        starter Task Cards
docs/clients/ MCP snippets
```

## License

MIT — OSS protocol first; commercial hosted routing later. Never paywall the core.

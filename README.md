# TabHandoff

> **Live self-hosted — not a demo.** Isolated browser handoffs → receipts + Task Cards.

**Your agent. Your browser. Your proof.**  
Launch: *Give your agent the page. Get the proof.*  
Descriptor: Open-source browser handoffs for AI agents.

**Code / npm / CLI:** `tabhandoff` · `@tabhandoff/*` · bin `tabhandoff`  
**Mascot (art later):** slightly chaotic clever **pigeon** — messenger bag, carries a browser tab like a letter, holds the receipt when the task is done.

> Name note: we do **not** use or claim [openhandoff.com](https://openhandoff.com) (unrelated call-handling SaaS). Brand is **TabHandoff**.

---

## One-line install (from this repo)

```bash
pnpm install && pnpm build && pnpm --filter @tabhandoff/cli exec playwright install chromium && node packages/cli/dist/index.js init
```

Then:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js run \
  --url https://example.com \
  --instruction "Extract the main heading and first paragraph as markdown" \
  --wait
```

Receipts land in `~/.tabhandoff/receipts/<id>/` (`receipt.md`, `card.yaml`, screenshots).

---

## What you get (v0.1)

| Surface | Status |
|---|---|
| MCP tools `handoff_create` / `handoff_status` / `handoff_receipt` (protocol: `handoff.create` · `.status` · `.receipt`) | ✅ |
| Playwright **ephemeral** Chromium (no cookie/session clone) | ✅ |
| CLI alone (`run` / `capture` / `status` / `receipt` / `doctor`) | ✅ |
| Receipt markdown + screenshots + Task Card YAML | ✅ |
| DOM extractor without API key; optional OpenAI/Anthropic agent loop | ✅ |

**Hard rules:** MIT · self-host first · no cookie vault · no daily-driver profile clone.

---

## Clients

| Client | Path |
|---|---|
| **Cursor** | Local stdio MCP — [docs/clients/cursor.md](docs/clients/cursor.md) |
| **Claude Desktop** | Local stdio MCP — [docs/clients/claude-desktop.md](docs/clients/claude-desktop.md) |
| **ChatGPT** | Desktop/Codex: local stdio; Web: remote/tunnel — [docs/clients/chatgpt.md](docs/clients/chatgpt.md) |
| **Grok** | Grok Build local MCP; grok.com connectors need public URL — [docs/clients/grok.md](docs/clients/grok.md) |
| **CLI** | Always works offline — no chat client required |

---

## Monorepo

```
packages/
  protocol/   @tabhandoff/protocol
  runner/     @tabhandoff/runner
  mcp/        @tabhandoff/mcp
  cli/        @tabhandoff/cli   (bin: tabhandoff)
cards/        starter Task Cards
docs/clients/ MCP snippets
```

## License

MIT

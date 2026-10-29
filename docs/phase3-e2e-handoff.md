# Phase 3 — End-to-end handoff

Wire the browser extension through the local bridge into the existing Playwright runner, then show results in the desktop evidence library. **Status is always honest.**

## Flow

1. Extension captures URL / title / selection / screenshot
2. User reviews and confirms (optional **page extraction** checkbox)
3. Bridge stores a portable package under `~/.tabhandoff/receipts/<id>/`
4. If `runWorkflow: true` and Playwright is available, bridge starts `runHandoff`
5. Extension polls `GET /v1/handoffs/:id` for real progress
6. Desktop **My Activity** auto-refreshes to show receipts + screenshots

## Honest labels

| Mode | When | UI language |
|---|---|---|
| Package only | Bridge off, or user unchecked run, or Playwright missing | “Package created — no agent was launched” |
| `dom` | No API key (default) | “Page extraction (deterministic DOM — not autonomous AI)” |
| `llm` | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` set | “Model-assisted isolated browser” |

`agentLaunched` is **false** for DOM page extraction and **true** only for the model-assisted path.

## Bridge API (additions)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/status` | Auth required — lists supported workflows |
| `POST` | `/v1/handoffs` | `runWorkflow: true` starts execution; `wait: true` for tests |
| `GET` | `/v1/handoffs/:id` | Live status, mode, message, screenshot count |

Loopback + bearer token + size limits from Phase 2 are unchanged.

## Demo

```bash
pnpm install && pnpm build
pnpm bridge          # or: pnpm desktop
# Load packages/extension → Settings → paste token
# Open https://example.com → Hand off → keep “page extraction” on → Hand off
# Watch popup status → open desktop My Activity
```

```bash
pnpm test:bridge
```

## Out of scope

Phase 4 §12 agent adoption CLI/guide · Phase 5 viral demo GIF

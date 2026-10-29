# Phase 2 — Browser extension + local bridge

Chromium MV3 extension that captures a tab and creates a **portable handoff package**. A minimal loopback bridge stores packages into `~/.tabhandoff/` for the Phase 1 evidence library. **No agent execution is started** in this phase.

## Packages

| Piece | Role |
|---|---|
| `@tabhandoff/protocol` | `PortableHandoffPackage` schema |
| `@tabhandoff/bridge` | Loopback HTTP receiver + package writer |
| `packages/extension` | Context menu, toolbar popup, capture UX |
| `@tabhandoff/desktop` | Starts bridge; Settings shows token |
| `@tabhandoff/cli` | `tabhandoff bridge` |

## Portable package (on disk)

```text
~/.tabhandoff/receipts/<id>/
├── handoff.json    # structured package (no invented history)
├── summary.md      # readable summary
├── receipt.md      # same summary (library-compatible)
├── card.yaml       # Task Card
├── job.json        # snapshot
└── screenshots/    # when capture succeeded
~/.tabhandoff/jobs/<id>.json   # status: queued · note: package only
```

`execution.status` is `package_created` and `agentLaunched` is `false` until a later phase actually runs an agent.

## Run

```bash
pnpm install && pnpm build
pnpm test:bridge
pnpm bridge          # or: pnpm desktop
# Load packages/extension as unpacked (see packages/extension/README.md)
```

## Security (bridge)

- Bind `127.0.0.1` only
- Bearer token in `~/.tabhandoff/bridge.json` (mode 600 when possible)
- Body size cap · input validation
- CORS limited to extension origins
- Logs never print tokens or page content

## Out of scope here

Phase 3 auto-execution · Phase 4 §12 agent CLI · Phase 5 demo GIF

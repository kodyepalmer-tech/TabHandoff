# Phase 4 — Portability & agent adoption

Documented schema, export archives, agent CLI, integration guide, and one reproducible agent test. Builds on Phases 1–3.

## Quick start for agents

```bash
pnpm install && pnpm build
pnpm test:agent
node packages/cli/dist/index.js validate fixtures/portable-handoff/sample-research-001
node packages/cli/dist/index.js read fixtures/portable-handoff/sample-research-001
```

Docs: [agents.md](./agents.md) · [schema.md](./schema.md) · [manual-export.md](./manual-export.md)

## CLI package verbs

| Command | Purpose |
|---|---|
| `create` | New portable package (`package_created`, no agent launched) |
| `validate` | Schema-validate `handoff.json` |
| `read` | Structured agent summary |
| `export --out [--archive]` | Folder + optional `.tar.gz` |
| `continue` | Successor with `previousHandoffId` |
| `progress` | Append event (default `agent_reported`) |
| `attach` | Add evidence (no silent overwrite) |
| `mark` | Status with justifying reason event |

## Safety

Page content untrusted · no auto-exec · no silent evidence overwrite · verified vs agent_reported · hashes labeled honestly.

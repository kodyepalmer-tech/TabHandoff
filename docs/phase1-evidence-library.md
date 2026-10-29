# Phase 1 — Local evidence library

Polished Electron app that imports existing `~/.tabhandoff/receipts/` into **My Activity**, with detail view (screenshots, receipt, card, timeline), report export, and reveal-folder. CLI + receipt layout unchanged.

## Packages

| Package | Role |
|---|---|
| `@tabhandoff/evidence` | Index/import, filter, structured export (JSON + markdown) |
| `@tabhandoff/desktop` | Electron UI — My Activity / Evidence / Settings |

## §12-ready index fields (Phase 4 owns agent CLI)

- Structured `ActivityRecord` JSON (not Markdown-only)
- Timeline kinds: `verified_event` \| `agent_reported` \| `suggestion`
- `untrustedContent` warning on captured page excerpts
- Import/export never overwrites receipts or jobs

Phase 4 will add: agent integration guide, CLI create/read/validate/continue/export, sample packages, one agent integration test.

## Run

```bash
pnpm install
pnpm build
pnpm test:evidence

# Demo against fixtures
TABHANDOFF_HOME="$PWD/fixtures/receipts-home" pnpm desktop

# Or your real local evidence
pnpm desktop
```

Primary UX target is macOS; Linux CI builds TypeScript and runs evidence tests. Package installers on a Mac host for release.

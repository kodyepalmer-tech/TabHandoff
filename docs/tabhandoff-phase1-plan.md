# TabHandoff Phase 1 plan — Local evidence library

**Scope:** Ship a polished local **My Activity** desktop app that imports existing `~/.tabhandoff/receipts/`. Do **not** expand into full agent CLI/MCP (§12 / Phase 4) in this slice.

**Repo baseline:** pnpm monorepo — `protocol`, `runner`, `mcp`, `cli`. Receipts live under `TABHANDOFF_HOME` / `~/.tabhandoff` as `jobs/<id>.json` + `receipts/<id>/{receipt.md,card.yaml,job.json,screenshots/}`.

---

## Current capabilities (reuse)

| Piece | Status |
|---|---|
| CLI `init` / `run` / `capture` / `status` / `receipt` / `doctor` / `mcp` | Working — preserve |
| Playwright isolated Chromium + DOM/LLM extract | Working — preserve |
| Receipt markdown + Task Card YAML + screenshots | Working — preserve format |
| MCP `handoff_create` / `status` / `receipt` | Working — preserve |
| Job list (`listJobs`) | File scan only; no search UI |

## Risks

- Dual records (`jobs/*.json` SoT vs receipt-dir snapshot) — UI must merge gracefully; tolerate partial/corrupt folders.
- Absolute screenshot paths in `receipt.md` — resolve via `receiptDir/screenshots/` for display.
- Cloud CI is Linux; Electron macOS `.dmg` may not package here — ship macOS-capable source + Linux smoke run.
- Playwright + Electron sandbox conflict — Phase 1 UI is **read-only library** (no runner in-process).

---

## Tech choice (desktop)

**Electron + TypeScript** (simplest maintainable path in this monorepo):

- New `@tabhandoff/evidence` — pure Node indexing/import/export (unit-tested; no Electron).
- New `@tabhandoff/desktop` — Electron main/preload/renderer; IPC to evidence package.
- Plain-language nav: **My Activity · Evidence · Settings** (Hand off deferred to Phase 2/3).
- B&W bidirectional-arrows brand; not a developer console.

macOS is the primary user target; Linux CI builds TS + runs headless evidence tests and can smoke Electron where display allows.

---

## Phase 1 ships

1. **Import / index** existing `~/.tabhandoff/receipts/` (+ `jobs/`).
2. **My Activity** list/grid with thumbnails, search, filters (website, date, status).
3. **Detail view:** screenshots, `receipt.md`, card, timeline, export report, reveal folder.
4. **Settings:** home path display (`TABHANDOFF_HOME`), refresh/re-import.
5. **Tests** for indexing/import; root `pnpm build` still green.
6. CLI + on-disk receipt layout **unchanged**.

## §12 constraints baked into index (no Phase 4 rewrite)

Phase 1 does **not** ship agent create/continue CLI. Index/export fields stay agent-ready:

| Constraint | Phase 1 approach |
|---|---|
| Structured data, not Markdown-only | Index emits `ActivityRecord` JSON (typed); detail can export structured report JSON + readable markdown. Agents must not reverse-engineer prose. |
| Preserve history | Never overwrite `receipts/<id>/` or `jobs/<id>.json` on import/index; regenerate in-memory (or optional cache) only. Export writes **new** files. |
| Verified vs reported vs suggestions | Timeline events tagged `verified_event` \| `agent_reported` \| `suggestion`. Runner actions → verified; `resultSummary` / receipt Result → agent_reported; no invented suggestions. |
| Untrusted page content | Records carry `untrustedContent` + explicit warning; UI labels captured excerpts as untrusted. |
| Phase 4 owns | Agent integration guide; CLI create/read/validate/continue/export; sample packages; one reproducible agent integration test. |

---

## Out of scope (later)

- Phase 2: browser extension  
- Phase 3: local receiver / end-to-end handoff  
- Phase 4: §12 agent adoption surface (CLI/API guide, validate/continue, sample packages, agent integration test)  
- Phase 5: viral demo GIF / polish release  

---

## Acceptance (Phase 1)

- Open app → see existing local evidence without Terminal.
- Search/filter; open a record; view screenshots + receipt + card + timeline.
- Export a report; reveal evidence folder.
- Quit/reopen without losing evidence.
- Existing CLI/MCP/receipts still work.

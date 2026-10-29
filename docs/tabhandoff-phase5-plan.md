# TabHandoff Phase 5 plan — Viral demo + release polish

**Scope:** Make the main workflow reliable enough for a short real demo; ship a real GIF/strip from actual CLI + desktop behavior; improve onboarding (README, install, platforms, schema/agents links, privacy, limitations, troubleshooting); document reproducible demo + capture; update build status. Preserve Phases 1–4.

**Base:** `cursor/phase4-portability-agents-7bb1` (PR #4).

---

## Current capabilities (reuse)

| Piece | Role in Phase 5 |
|---|---|
| CLI `run` / `create` / `receipt` | Demo vertical slice: package → extract → evidence |
| Playwright runner + receipts | Real screenshots for GIF frames |
| Desktop Electron My Activity | Real evidence UI capture via `TABHANDOFF_DEMO_CAPTURE` |
| Extension + bridge | Documented E2E path; cloud VM capture optional |
| Phase 4 schema / agents docs | Linked from README onboarding |

## Risks

- Headless cloud VMs cannot easily record Chromium extension right-click — mitigate with CLI/desktop real capture + honest labels + docs for local extension recording.
- Async `onAction` racing final `updateJob` caused `Unknown handoff id` on fast browser-launch failures — must fix before demo reliability claims.
- Package-only `create` previously wrote job status `queued` (misleading in My Activity) — use honest `package_created`.
- Never fake progress, screenshots, or agent success in demo media.

---

## Tech choice

| Change | Why |
|---|---|
| Await `onAction` + serialize MCP `updateJob` | Demo reliability; no lost final status |
| `package_created` in `HandoffStatus` + desktop label | Honest package-only UX |
| `scripts/demo.sh` + `scripts/capture-demo.mjs` | Reproducible demo + GIF/strip from real runs |
| Electron `TABHANDOFF_DEMO_CAPTURE` | Real desktop frame without fake HTML mock |
| README + `docs/demo.md` + `docs/troubleshooting.md` | Everyday users + agents onboarding |

---

## Phase 5 ships

1. Main workflow reliable for short demo (package → extract or package-only → evidence).
2. Real demo GIF + static strip under `docs/assets/` (plus `demo-frames/` manifest).
3. README focused on product value, install, platforms/browsers, schema/agents links, privacy, limitations, troubleshooting.
4. Reproducible demo + capture instructions (`docs/demo.md`, `pnpm demo` / `pnpm demo:capture`).
5. Store build-status + this plan updated; branch + PR based on Phase 4.

## Out of scope

- Marketplace / hosted cloud / cookie vault
- Fabricated extension GIF on headless CI
- New provider-specific bot integrations

---

## Acceptance (Phase 5)

- `pnpm demo` completes with succeeded page extraction and local receipt/screenshots (after Chromium install).
- Demo GIF/strip frames come from a real handoff id recorded in `docs/assets/demo-frames/manifest.json`.
- README links schema, agents guide, privacy, limitations, troubleshooting.
- Package-only items show as **Package only**, not Queued/Succeeded.
- Phases 1–4 tests/flows still pass (`pnpm test`, `pnpm test:agent`).

# TabHandoff Phase 3 plan — End-to-end handoff

**Scope:** Wire extension → bridge → existing Playwright/DOM (or LLM) runner → receipts → My Activity. Honest status only. No Phase 4 §12 agent adoption CLI/guide.

**Base:** `cursor/phase2-browser-extension-3561` (Phase 2 extension + bridge). Preserve Phase 1–2, CLI, and `~/.tabhandoff/receipts/`.

---

## Current capabilities (reuse)

| Piece | Role in Phase 3 |
|---|---|
| `@tabhandoff/bridge` | Extend: queue run, status API, update packages after execution |
| `@tabhandoff/runner` | Existing `runHandoff` — DOM extract without key; LLM when key present |
| Extension popup | Confirm supported workflow; poll progress; never fake success |
| Desktop My Activity | Auto-refresh so new results appear |
| Receipts / jobs layout | Same folders; runner writes screenshots + receipt.md |

## Risks

- Runner opens an **isolated** browser (no user cookies) — label this clearly; login walls may fail honestly.
- Playwright/Chromium missing → keep `package_created`, do not invent history.
- DOM extract must stay labeled as **page extraction**, not autonomous AI completion.
- Long-running jobs: async execute + status poll; do not block HTTP forever.
- Consequential actions need explicit confirm in the extension review step.

---

## Tech choice

| Change | Why |
|---|---|
| Bridge depends on `@tabhandoff/runner` | Same pipeline as CLI/MCP — no duplicate executor |
| `POST /v1/handoffs` + `runWorkflow` | One confirm creates package and optionally starts supported workflow |
| `GET /v1/handoffs/:id` | Extension + desktop poll real status |
| Capability probe on `/v1/status` | Advertise `dom_extract` / `llm` (when key) honestly |

---

## Phase 3 ships

1. Secure loopback bridge extended (auth, validation, size limits unchanged).
2. On confirm with supported workflow: store package → run Playwright DOM extract (or LLM if key) → update receipts/handoff.json/jobs.
3. Extension shows real progress (queued → running → succeeded/failed/package-only).
4. Results + screenshots land in `~/.tabhandoff/receipts/`; desktop My Activity refreshes.
5. DOM-without-key labeled as page extraction; no invented agent success.
6. If runner unavailable: honest `package_created` path only.
7. Review/confirm copy for “run page extraction”; respect permissions.

## Out of scope

- Phase 4 §12 agent create/read/validate/continue CLI + integration guide
- Phase 5 viral demo GIF polish
- Arbitrary third-party bot control

---

## Acceptance (Phase 3)

- Extension confirm with bridge up → package saved → supported workflow runs → status updates honestly.
- Without Chromium/runner: package still saved; status stays package-created / no fake success.
- DOM mode copy never claims autonomous AI completion.
- Desktop My Activity shows the new evidence after refresh/auto-refresh.
- Existing CLI, Phase 1 library, Phase 2 package-only path still work.
- Tests cover execute + status + package-only fallback.

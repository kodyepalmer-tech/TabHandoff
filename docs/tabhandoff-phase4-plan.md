# TabHandoff Phase 4 plan — Portability + §12 agent adoption

**Scope:** Documented versioned handoff schema, complete package export, agent CLI (create / validate / read / export / continue), append progress + attach evidence + justified status marks, agent integration guide, manual copy path, one reproducible agent integration test. Safety rules from §12 F. No Phase 5 demo GIF.

**Base:** `cursor/phase3-e2e-handoff-0672` (Phase 3 E2E). Preserve Phases 1–3, CLI job verbs, receipts, bridge.

---

## Current capabilities (reuse)

| Piece | Role in Phase 4 |
|---|---|
| `PortableHandoffPackageSchema` (`@tabhandoff/protocol`) | Source of truth; extend with successor link + `blocked`; export parse/validate helpers |
| `buildPortablePackage` / `writeHandoffToHome` (`@tabhandoff/bridge`) | Create + persist packages without inventing history |
| Bridge `patchHandoffExecution` | Pattern for honest event append / status updates |
| Existing CLI `run` / `status` / `receipt` | Keep; add package verbs alongside |
| MCP `handoff_create` / `_status` / `_receipt` | Keep job tools; add package validate/read where useful |
| `~/.tabhandoff/receipts/<id>/` layout | Already portable folder; export copies/archives it |

## Risks

- Dual on-disk shapes (runner receipts without `handoff.json` vs bridge packages with it) — prefer `handoff.json`; document honest upgrade path.
- Status marks must require a justifying event (`verified_event` or labeled `agent_reported`) — never silent overwrite.
- Page content stays untrusted; no auto-exec of downloads; hashes labeled as integrity aids only.
- Do not claim a receiving agent accepted a handoff unless that event is recorded.

---

## Tech choice

| Change | Why |
|---|---|
| Protocol: `previousHandoffId`, status `blocked`, `parse`/`validate` helpers | §12 C/E successor + machine-readable validation without reverse-engineering Markdown |
| Bridge module `portable.ts` | Read / export / append / attach / successor next to existing writer |
| Archive = folder copy + `.tar.gz` | Complete package without original machine; no heavy zip dep |
| CLI package verbs | Primary agent surface; MCP supplements |
| `fixtures/portable-handoff/` + `docs/schema*` | Machine-readable examples for humans + coding agents |
| Integration test in bridge | §12 G loop: parse → validate → read → create/continue → record → export |

---

## Phase 4 ships

1. Schema docs + JSON Schema + example package(s) in repo.
2. `tabhandoff export` — complete folder and/or `.tar.gz` usable offline.
3. CLI: `create`, `validate`, `read`, `export`, `continue` (+ `progress`, `attach`, `mark`).
4. Concise agent integration guide (discover → install → parse → create → continue → export).
5. Documented manual copy/export for unsupported agents.
6. One reproducible agent integration test (no fabricated verification).
7. Safety: untrusted page content; no silent evidence overwrite; verified vs agent_reported; honest hash labeling.
8. README: agent discoverability, limitations, privacy/local-storage.

## Out of scope

- Phase 5 viral demo GIF / release polish
- Numerous provider-specific bot integrations (one portable path first)
- Cookie/session transfer

---

## Acceptance (Phase 4)

- Sample package validates against documented schema.
- Agent (or test client) can parse → validate → read → create/continue → append result honestly → export a package another agent can consume.
- Export works without access to the original machine home beyond the package folder.
- Existing Phase 1–3 flows, CLI job verbs, and receipts still work.
- Docs optimized for humans + coding agents.

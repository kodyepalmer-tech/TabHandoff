# TabHandoff Phase B plan — local-file handoff

**Status:** Approved (founder). Implementing now.  
**Proposal:** [tabhandoff-file-handoff-proposal.md](./tabhandoff-file-handoff-proposal.md)  
**Constraint:** Separate from PR #6 (website / installers / release). No DNS, tags, or website changes. Phase C (live screen capture) is **out of scope**.

---

## Branch base

- **Working branch:** `cursor/phase-b-file-handoff-3732`
- **Checkout base:** `origin/cursor/phase5-viral-demo-3a92` (Phases 1–5 product tip). Current `origin/main` is Phase 1–only and lacks the portable package / bridge / extension stack that Phase B extends.
- **Explicitly excluded:** all `website/`, electron-builder release packaging, Pages/DNS, and other PR #6-only files.
- **PR target:** `main`. Diff vs today’s `main` includes Phases 2–5 history until #6 lands; reviewable Phase B delta is vs Phase 5 tip. Rebase onto post-#6 `main` when that merges (no website conflict expected).

---

## Goal

User selects files in the desktop app (picker or drag-and-drop) → enters an instruction → TabHandoff writes a portable package another agent can `validate` / `read` / `export` / `continue`. Browser handoffs stay first-class and unchanged. No fake URLs.

---

## Schema delta (keep `schemaVersion: "0.1"`)

| Change | Detail |
|---|---|
| `page` | Become **optional** in Zod + `docs/schema/handoff.schema.json` |
| `sources[]` | New optional array (discriminated union: `browser` \| `file` \| `screenshot` \| `note`) per proposal |
| Root rule | **At least one of** `page` **or** non-empty `sources[]` (Zod `.refine` + JSON Schema `anyOf`) |
| Task Card | `startUrl` optional; optional `sourceTypes: string[]` |
| Warning | Extend `UNTRUSTED_CONTENT_WARNING` to cover file excerpts/attachments, not only page text |
| Compat | Existing browser packages (with `page`, no `sources`) remain valid. Migration/compat tests cover old fixtures + new file-only packages |

### File source fields (MVP)

`type: "file"`, `filename` (basename), optional `displayPath`, `mediaType`, `byteSize`, `sha256` (required when bytes were read), optional capped `textExcerpt`, optional `artifactFilename` under `artifacts/`, optional honesty flag `contentStatus: "excerpted" | "attached_not_analyzed"`.

### Extract honesty

| Kind | Behavior |
|---|---|
| Plain text / Markdown / CSV / JSON / common source code | Metadata + SHA-256 + optional capped `textExcerpt` + copy under `artifacts/` |
| PDF / Word / spreadsheets | Metadata + SHA-256 + binary attach; **`contentStatus: "attached_not_analyzed"`** — never claim contents analyzed |
| Images / other | Metadata + hash + attach; no text extract |

---

## Implementation plan (ordered)

1. **Protocol** — `PortableSourceSchema`, optional `page`, refine rule, TaskCard updates, warning string, helpers (`hasPageOrSources`).
2. **JSON Schema + docs** — `docs/schema/handoff.schema.json`, `docs/schema.md` notes for agents.
3. **Fixtures** — keep `sample-research-001` (browser); add `fixtures/portable-handoff/sample-file-001/` file-only package.
4. **Bridge** — `buildFilePortablePackage` (+ limits: max files, per-file / total bytes, excerpt chars); generalize summary/card renderers for file sources; `createFilePortableHandoff` that copies artifacts, hashes, writes store/receipt like `createPortableHandoff`. Browser `buildPortablePackage` / `assertHttpUrl` **unchanged**.
5. **Evidence** — `ActivityRecord.url` optional; add `primarySourceType`, `displayLabel` (filename or hostname); stop writing `https://invalid.invalid/` for file packages; index `handoff.json` `sources[]`.
6. **CLI** — `tabhandoff create --file <path>… --instruction …` (no `--url` required when files given); validate/read/export/continue work on file packages; integrity check helper for artifact SHA-256.
7. **Desktop** — Hand off nav + panel: drop zone, Choose files… (`dialog.showOpenDialog`), instruction, Confirm; IPC only accepts paths returned from picker/drop (fail closed on arbitrary paths); My Activity shows file label; detail lists files + instruction + honest analysis status; Reveal + export still work.
8. **Tests** — see acceptance below.
9. **Docs/status** — this plan; update store `tabhandoff-build-status.md`. No website edits.

---

## Affected files (expected)

| Area | Paths |
|---|---|
| Protocol | `packages/protocol/src/index.ts` |
| Schema docs | `docs/schema/handoff.schema.json`, `docs/schema.md` |
| Fixtures | `fixtures/portable-handoff/sample-file-001/*`, existing sample unchanged |
| Bridge | `packages/bridge/src/package.ts`, `portable.ts`, `limits.ts`, `index.ts`; tests under `packages/bridge/test/` |
| Evidence | `packages/evidence/src/types.ts`, `indexReceipts.ts`, `filters.ts`, `exportReport.ts`, tests |
| CLI | `packages/cli/src/index.ts` |
| Desktop | `packages/desktop/src/main.ts`, `preload.ts`, `renderer/{index.html,app.js,styles.css}` |
| Root scripts (optional) | `package.json` test script alias if new suite |
| Store docs | `docs/tabhandoff-phase-b-plan.md`, `docs/tabhandoff-build-status.md` |

**Not touched:** `website/`, release workflows, DNS/CNAME, extension behavior (browser path), Phase C capture APIs.

---

## Acceptance tests

1. **No-URL package validates** — file-only `handoff.json` with `sources[].type: "file"` and no `page` passes Zod + `tabhandoff validate`.
2. **Browser regression** — `buildPortablePackage` / fixture `sample-research-001` / existing bridge + agent tests still pass; packages still write `page.url`.
3. **Invalid / missing sources** — empty sources + no page rejected; over-cap / oversize rejected with clear error.
4. **Metadata + integrity** — each file records `filename`, `byteSize`, `sha256` matching bytes at capture; mutating artifact fails integrity check.
5. **Excerpt policy** — `.txt`/`.md` may get capped `textExcerpt`; `.docx`/`.pdf` get attach + `attached_not_analyzed` without content-extract claims.
6. **Export / import** — `tabhandoff export` folder/archive validates + reads instruction, file sources, evidence.
7. **Honesty** — `agentLaunched: false`, `execution.status: package_created`; UI/receipt does not claim Office/PDF parsed or agent ran.
8. **Permission boundary** — desktop create IPC rejects paths not from picker/drop session allowlist.
9. **Desktop activity** — file handoff labeled by filename(s), not fake URL; detail lists files + instruction; Reveal works.
10. **Multi-file** — 2–N files within cap → multiple `sources` + artifacts; over-cap fails closed.
11. **Untrusted warning** — covers file excerpts/attachments.
12. **≥1 real file E2E** — create from real temp files → validate → export → re-validate (bridge/CLI test, not mocked schema-only).
13. **Compat** — old browser packages validate under new schema; file-only packages validate; packages missing both page and sources fail.

---

## Browser extension launch status

Inspected on Phase 5 tip (`packages/extension`, bridge, `docs/extension-setup.md`).

| Topic | Reality |
|---|---|
| **What works today** | MV3 unpacked extension: toolbar popup + **right-click “Hand off with TabHandoff”** (`chrome.contextMenus`). Captures tab URL/title/selection/screenshot → local bridge → portable package → optional page extraction. Desktop **My Activity** shows receipts when bridge/desktop is running. |
| **What users must install** | (1) TabHandoff checkout + `pnpm install` / one-command installer; (2) run **`pnpm bridge`** or open **desktop app** (starts bridge on `127.0.0.1:17432`); (3) Chromium-based browser (Chrome / Edge / Brave); (4) **Load unpacked** `packages/extension` with Developer mode; (5) paste bridge access token in extension Settings. |
| **Right-click E2E** | Implemented in code and documented. Proven locally when bridge + token + http(s) page are present. **Not** claimed green on headless cloud CI (no interactive Chromium UI); Phase 5 demos used CLI + desktop capture instead. |
| **Chrome Web Store / Edge Add-ons** | **Not shipped.** Still load-unpacked / sideload. Phase B does **not** block on store listing. |
| **Ready vs in development** | **Ready for developer / early-user sideload** of browser handoffs. **In development / not ready:** store listing, silent OS-wide capture, Finder/Explorer “Hand off” hooks, Phase C live screen capture. |

Phase B keeps this browser path **unchanged** and first-class; file handoff is an additional desktop entry point.

---

## Out of scope (Phase B)

- Phase C live `desktopCapturer` / screen-recording permission UX  
- OS shell extensions / share targets / folder watching  
- Full Word/PDF/Excel semantic extract or OCR  
- Fake `https://` / `file://` URLs as public schema  
- Website, DNS, tags, installers, PR #6  
- Chrome Web Store publish  

---

## Demo how-to (after implement)

```bash
git checkout cursor/phase-b-file-handoff-3732
pnpm install && pnpm build
pnpm test:bridge && pnpm test:evidence && pnpm test:agent

# CLI file handoff (agent-readable)
pnpm tabhandoff create --file ./notes.txt --instruction "Summarize this file"
pnpm tabhandoff validate <id>
pnpm tabhandoff export <id> --out /tmp/handoff-out

# Desktop UI
pnpm desktop
# → Hand off → Choose files / drop → instruction → Confirm → My Activity
```

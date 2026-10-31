# TabHandoff — Project Continuity

**Last updated:** 2026-10-30 (Agent B dogfood continuation; Agent A review 2026-10-29/30, see section 8)
**Status:** This document is the single place a new agent should start. Do not depend on any single chat surviving. Update it at the end of every substantial session with actual branch, commit, test results, blockers, and next action. Never put secrets in it.

## 1. Product vision and positioning

TabHandoff is the universal handoff and execution layer for AI agents.

**Core promise: One task. Any compatible agent. No lost progress.**

Problem: people use multiple AI agents, coding assistants, browser tools, and local models. Switching agents or losing a session loses context, completed work, decisions, artifacts, and remaining tasks.

TabHandoff transfers actual task state so another compatible agent can continue without the user reconstructing everything.

It is **not** another generic chatbot, AI assistant, or model dashboard.

**Beachhead:** reliable AI coding-agent handoffs first. Do not expand into dozens of integrations before one real handoff workflow is excellent.

**Moat:** reliable compatibility, task continuity, verified execution, provenance, distribution, and trust — not just a JSON schema.

**Long-term hypothesis:** open-source handoff protocol and portable reference implementation, plus commercial managed compatibility, history, collaboration, governance, audit, and enterprise controls.

**Messaging honesty rule:** Browser capture is what ships today. File capture, desktop capture, and universal app support are roadmap, not shipped. Do not claim them as shipped. See `docs/roadmap.md` when it lands (currently only in unmerged PR #7, see below).

## 2. Architecture (as in main)

Monorepo, TypeScript, pnpm workspaces. Node.js 22+ required.

```
packages/
  protocol/   @tabhandoff/protocol  — portable schema, source of truth
  runner/     @tabhandoff/runner    — Playwright ephemeral Chromium runner
  mcp/        @tabhandoff/mcp       — local stdio MCP
  cli/        @tabhandoff/cli       — tabhandoff CLI
  bridge/     @tabhandoff/bridge    — local bridge, Run with AI, history
  evidence/   @tabhandoff/evidence  — receipts, evidence library
  desktop/    @tabhandoff/desktop   — Electron evidence library + bridge
  extension/  Chromium MV3 extension — capture surface
docs/         schema, agents, demo, troubleshooting, install, releasing
fixtures/     receipts-home + portable-handoff examples
scripts/      install.sh, demo.sh, capture-demo.mjs, pack-extension.mjs
website/      static site deployed to GitHub Pages
```

Key flows:
- Desktop + local bridge (primary): local AI (Ollama or a provider key that stays on the machine) → browser task → real result → saved history under `~/.tabhandoff/` (override `TABHANDOFF_HOME`).
- Extension: capture only; execution happens on the machine via the bridge. Paste the bridge token in extension Settings.
- Optional ZIP-only: Save package downloads a ZIP without desktop. Status must say **Package created — not agent executed**.
- Verified handoff (schema 0.2): `create-verified` → `export` (includes `INSPECT.html`, viewable without install) → destination `continue` → `run-ai` → `verify-continuation --require-execution`. `continue` alone is **not** successful continuation; verification fails until a destination verified execution event is recorded.
- Security: captured page text is untrusted. Permissions are explicit (allowNetwork / allowFileWrite / allowShell / allowModelCall, default deny). No API keys in packages, inspect HTML, or ZIPs. Cookies/credentials are not transferred by default.

## 3. Repository and branch state — VERIFIED 2026-10-29

- Repo: https://github.com/kodyepalmer-tech/TabHandoff — public, MIT, created 2026-10-28
- Default branch: `main`
- Main HEAD (verified via GitHub): `f90be7c` — "Merge pull request #16 from kodyepalmer-tech/cursor/pages-deploy-fix-c7ea"
- Previous main milestone: `468fa80` — "Merge pull request #13"
- Stars/forks: 0 / 0. Releases: 0. Tags: 0.
- Open PRs: #6, #7, and #17 (see sections 4 and 6 — do NOT merge #6 or #7 as-is; #17 is a draft, docs-only PR and also needs founder approval before merging).
- Open issues: 0. Work tracking currently lives in PRs and chats — a continuity risk.
- Pages preview (verified loads): https://kodyepalmer-tech.github.io/TabHandoff/
- Custom domain: `website/CNAME` contains `tabhandoff.com` (verified in repo). 'DNS is not configured / Porkbun parking' is founder-reported, not independently verified by a DNS check to GitHub Pages IPs in this review. Do not announce tabhandoff.com as live and do not change DNS without explicit founder approval.
- Muse GitHub access: connected 2026-10-29 as `kodyepalmer-tech`, read access to TabHandoff verified. Write tools exist but are still subject to the approval boundaries in section 11.

## 4. Important commits and PRs — VERIFIED

Merged into main:
- PR #8 — Phase B file handoff work (merged)
- PR #11 — Phase 5 integration to main
- PR #13 — Phase 1 AI execution: browser → local AI with tags, doctor, pairing, bridge adopt
- PR #14 — Website/distribution work (distribution site, privacy, release pipeline on main)
- PR #15 — Verified portable task handoffs (schema 0.2), merged via `1f77705`, feature commit `681263f`
- PR #16 — Pages fix: "harden Deploy website after Pages enable", fix commit `334c265`, merge commit `f90be7c`

Open — DO NOT MERGE AS-IS (see section 6):
- PR #6 — "feat: public website, desktop installers, and release pipeline" — head `cursor/website-downloads-3344`, base `main`
- PR #7 — "docs: messaging & roadmap only — universal work handoff (Phase A)" — head `cursor/messaging-universal-handoff-19a5`, base `cursor/website-downloads-3344` (stacked on #6)
- PR #17 — "docs: add PROJECT-CONTINUITY.md" — head `muse/project-continuity-doc`, base `main`, draft, docs-only, commit `2105e33`. This is the PR that adds this file; it is NOT merged.

## 5. Completed and verified features

Verified in this review by file-presence and code-grep in main (not just by agent report). That is file/code verification, NOT runtime verification for desktop/extension/website. Runtime verification now exists for build + unit tests (see below) — Ollama demo remains reported-only:
- Portable schema 0.1 + 0.2, with acceptance criteria, claims (`observed_fact` / `user_statement` / `summary` / `unverified_claim`), tests, permissions, missing inputs, agent identity, provenance, and verification status.
- CLI verbs: `validate`, `read`, `create-verified`, `export`, `continue`, `verify-continuation`, `run-ai`, `doctor`, `smoke`, `demo`
- MCP tools `handoff_validate` / `handoff_read` (plus `handoff_create` / `handoff_status` / `handoff_receipt` for browser jobs); continuation itself is via the CLI `continue` verb, not an MCP tool named continue. CLI↔MCP transfer is via exported packages.
- Desktop evidence library + bridge shipped from source (not as a packaged/signed installer); local bridge, My Activity history. Packaged installers / signed installers not shipped, and desktop UX is not stranger-ready (see section 7). Earlier history called the desktop app partial — that description is about the packaged/consumer UX, not about the source evidence library existing.
- Browser extension Save package (MV3, Load unpacked until Chrome Web Store)
- Static website in `website/`, deployed via `.github/workflows/pages.yml` (GitHub Actions source, job-scoped `pages: write` + `id-token: write`, preflight check for `build_type=workflow`, no `enablement: true`)
- Release pipeline scaffold in main: `.github/workflows/release-desktop.yml` (tag `v*`), electron-builder config, `docs/releasing.md`, `docs/install.md`

Reported, NOT independently re-run in this review (Agent A or Agent B):
- Demonstrated path CLI Agent A → export → MCP/CLI Agent B → Ollama `smollm2:135m` → verification PASS, and incomplete continuation correctly failing verification. Treat as agent-reported until re-run with `pnpm build && pnpm test:verified-handoff` / `pnpm demo:verified-handoff` and the output is recorded here.
- Agent A runtime evidence (2026-10-29/30, local review copy): `pnpm build` PASS, `pnpm test:verified-handoff` 4 pass, full `pnpm test` 55 pass (evidence 10, runner 11, bridge 34), exit 0. Ollama `smollm2:135m` demo path was NOT re-run by Agent A (no Ollama model in that environment).
- Agent B runtime evidence (2026-10-30, fresh clone `agent-b-repo`, main `f90be7c`, branch `muse/dogfood-continuation`): `pnpm install` 384 packages PASS, `pnpm build` PASS exit 0, `pnpm test:verified-handoff` 4 pass, 0 fail. Workaround used: `.npmrc` with `manage-package-manager-versions=false` in the clone only (pnpm 10.34.9 found via npm-global bin; `pnpm` was not on the default PATH in this sandbox) — `.npmrc` was removed before finishing and was NOT committed. Ollama `smollm2:135m` demo path was NOT re-run by Agent B either.

Not shipped:
- Chrome Web Store listing, signed desktop installers, tagged releases
- File capture MVP, desktop capture, cross-app workflows (roadmap Phases B–D only)
- `docs/roadmap.md` in main (exists only in PR #7)
- Automatic access to private Cursor conversations or internal reasoning — never claim this. Dogfooding captures explicit, accessible task state and evidence only.

## 6. Known defects and open questions

1. **PR #6 is obsolete wholesale.** Main already has the website/release work via PR #14, and a newer, safer Pages workflow via PR #16. Merging #6 as-is would revert the Pages preflight/hardening and would revert Phase B / extension-pack work already on main. Main's own `docs/releasing.md` already warns against this. Do not merge #6.
2. **PR #7 is stacked on stale #6.** It must not merge onto #6. Its useful parts — `docs/roadmap.md` and universal messaging copy in README/website — should be rebased onto current main as a fresh PR, or folded into a new website PR, after founder decision on messaging.
   - Disposition (Agent A/B recommendation, founder approval still required to act): close #6 as superseded, do NOT merge #6 or #7 as-is, do NOT discard #7's roadmap content. Agent B preserves `docs/roadmap.md` alone on branch `muse/dogfood-continuation` (local only, not pushed, not merged) as the basis for a fresh roadmap PR.
3. **CNAME vs DNS mismatch.** `website/CNAME` = `tabhandoff.com` (verified). DNS pointing / Porkbun parking status is founder-reported, not independently verified here. Verify Pages custom-domain status before any announcement; do not change DNS without approval.
4. **No continuity doc existed before this file.** That is why a dead Cursor session was a project risk. This file must be updated every substantial session.
5. **No issue tracking.** 0 open issues; decisions live in chats/PRs. Consider opening issues for: continuity doc, PR #6/#7 disposition, FTUX installer/CWS, dogfood session handoff.

## 7. Current blockers

- None blocking the core verified-handoff code in main.
- Blocking adoption: stranger install friction (source-only install, Load unpacked extension, bridge token copy-paste), no installers, no CWS, no tagged release.
- Blocking clean PR hygiene: disposition of PR #6/#7 (see section 6).
- Blocking custom-domain launch: DNS for tabhandoff.com not configured, and founder approval required before changing it.

## 8. Current task and exact next action

**Current task (2026-10-30, Agent B dogfood continuation — successor to Agent A review):**
- Agent B (this step) independently validated Agent A's package, fresh-cloned main `f90be7c`, confirmed PR #17 diff (1 file, 181 lines), applied corrections 1–7 plus Agent B cross-reference/MCP corrections (section 4 cross-ref → section 6, approval boundaries → section 11, MCP continue clarified as CLI) to this file on local branch `muse/dogfood-continuation`, added `docs/roadmap.md` from PR #7 only (with a preservation header, no README/website changes), ran build + verified-handoff tests (see section 5, Agent B evidence), recorded a verified_event, and ran `verify-continuation --require-execution` before exporting the successor package (successor ID and verify outcome are in the Agent B final report; do not treat `continue` alone as success).

**Previous current task (2026-10-29, Muse takeover after Cursor died):**
1. Land this continuity doc on a new branch as a PR — do NOT merge without founder approval.
2. Decide PR #6/#7 disposition with founder: close #6 as superseded, and rebase #7's roadmap/messaging onto current main as a fresh PR — or close #7 if browser-first messaging is kept for the beachhead.
3. Verify Pages custom-domain status (read-only) and audit the stranger install path; report, do not change DNS.
4. Build dogfood session handoff: use schema 0.2 to capture this takeover session (objective, branch, commit, changed files, tests, decisions, blockers, next action), export it, and prove a second agent can continue from it.
5. Re-run and record: `pnpm build`, `pnpm test:verified-handoff`, `pnpm demo:verified-handoff` — record actual output, not agent claims.

**Exact next action after this doc lands:** Founder reviews the continuity-doc PR and the #6/#7 recommendation, then approves (or not) merging the continuity doc PR only. No merge, push to main, release, tag, DNS change, or CWS submission happens without that explicit approval.

## 9. Installation and testing instructions

From source (primary path today):
```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
pnpm desktop          # evidence library + local bridge + history
```

Extension (until CWS):
Chrome/Edge/Brave → `chrome://extensions` → Developer mode → Load unpacked → `packages/extension`, then paste the bridge token in extension Settings.

Key checks:
```bash
pnpm build
pnpm test:evidence && pnpm test:runner && pnpm test:bridge
pnpm test:verified-handoff
pnpm demo:verified-handoff
tabhandoff validate fixtures/portable-handoff/sample-research-001
tabhandoff export <id> --out ./exports --archive   # includes INSPECT.html
tabhandoff verify-continuation <successor> --previous <export-path> --require-execution
```

Smoke: `pnpm smoke` (example.com heading/paragraph extraction).

## 10. Important architectural decisions

- Local-first, honest status: never pretend an agent ran when only a package was created.
- Portable, inspectable packages over a hosted cloud: ZIP / export folder is shareable, INSPECT.html needs no install.
- Verification over claims: `observed_fact` without a verified event fails; `continue` alone is not success.
- Explicit permissions, default deny; no silent shell/network/file writes.
- Beachhead first: coding-agent handoffs and browser capture before file/desktop/universal capture.
- Open protocol first, commercial hosted routing later; never paywall the core (MIT).

## 11. Approval boundaries — FOUNDER RULES

Founder (Kody) must explicitly approve before:
- Merging any PR
- Pushing directly to main
- Publishing releases or tags
- Changing DNS or domain settings
- Submitting to the Chrome Web Store
- Exposing secrets or credentials
- Incurring paid API costs
- Deleting or overwriting existing work

Allowed without that approval: working on branches, routine fixes, testing, documentation, and PR preparation.

## 12. How to work with the founder

- Founder is not a software developer and uses agents to implement. Explain in plain English.
- Give exact copy-paste prompts/steps and say exactly what to click or approve.
- Distinguish verified functionality from agent-reported functionality.
- Do not claim to have inspected GitHub or the live site unless actually done.
- Keep strategy focused on product growth, adoption, virality, defensibility, and potential acquisition — but do not expand scope before the beachhead is excellent.

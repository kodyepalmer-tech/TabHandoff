# Verified AI task handoffs

**Thesis:** TabHandoff makes work portable between compatible AI agents by preserving task state, transferring context, and verifying continuation.

Local model execution (`run-ai`) is **infrastructure** for demos and optional assistance — not the product differentiator. Do not treat TabHandoff as a generic chat UI.

**Schema:** `0.2` (verified) builds on portable `0.1`. Source of truth: `@tabhandoff/protocol`.

---

## Branch / PR note

This line lives on `cursor/verified-handoff-7f9b` (branched from PR **#13** tip for protocol + persistence + AI infra). PR **#13** / **#14** stay separate for founder merge decisions.

---

## Package fields (0.2)

In addition to 0.1 (`instruction`, `page`/`sources`, `previousResults`, `remainingWork`, `execution.events`, …):

| Field | Purpose |
|---|---|
| `acceptanceCriteria[]` | What “done” means for the destination |
| `claims[]` | Typed honesty: `observed_fact` / `user_statement` / `summary` / `unverified_claim` |
| `tests[]` | Commands + `pass`/`fail`/`unverified`/`not_run` |
| `permissions` | Explicit allowNetwork / allowFileWrite / allowShell / allowModelCall (default deny) |
| `missingInputs[]` | Known gaps — never fabricate inaccessible state |
| `agentIdentity` | Source/destination name + **supported** interface (`cli`/`mcp`/`bridge`/`manual_export`/`unsupported`) |
| `provenance` | createdBy/At, transferId, optional previousPackageSha256 |
| `execution.verification` | `pass` / `fail` / `unverified` — never invent pass |

---

## Two-agent flow (supported interfaces)

**Pair used in the vertical slice:**

| Role | Interface | How |
|---|---|---|
| Agent A (source) | **CLI** | `create-verified` → partial `run-ai` → `progress` → `export` |
| Agent B (destination) | **MCP** then **CLI** | `handoff_validate` / `handoff_read` → `continue` → `run-ai` → `verify-continuation` |

Unsupported (not invented): remote Cursor control, ChatGPT.com UI automation.

```bash
pnpm build
node scripts/verified-handoff-demo.mjs
# or manually:
tabhandoff create-verified --url https://example.com/ --instruction "…" --source-agent cli-agent-a --dest-agent mcp-agent-b
tabhandoff export <id> --out ./exports
tabhandoff inspect ./exports/<id>          # INSPECT.html — no install to view
tabhandoff continue ./exports/<id> --destination-agent mcp-agent-b --verified
tabhandoff run-ai --instruction "…" --handoff <successor-id>
tabhandoff verify-continuation <successor-id> --previous ./exports/<id> --require-execution
```

**Critical:** `continue` only creates a successor package. That is **not** successful continuation. `--require-execution` fails until a destination `verified_event` (e.g. observed `run-ai`) is recorded.

---

## Four stages — do not conflate them

TabHandoff distinguishes four different claims. A pass at one stage never
claims a later stage.

| Stage | What it means | What proves it | What does NOT prove it |
|---|---|---|---|
| 0. Import | The destination received and validated a package. | `validate` + chain + context present. | Nothing about work done. |
| 1. Continuation | The destination reviewed the task and did meaningful work on it. | `--require-continuation`: linked successor + a post-continue work event + corroboration (see below). | Importing, reading, or creating a successor alone. Progress text alone. |
| 2. Execution | A destination AI execution actually ran. | `--require-execution`: `agentLaunched=true` + a verified `run-ai` event with `ok=true` + a result line. | Progress text mentioning run-ai. A DOM extraction (that is `page_extraction`, not AI execution). |
| 3. Independent verification | A verifier (not the destination) checked the package with `--previous`, chain hash, and artifact integrity. | `verify-continuation` report, with its limitations. | The destination's own claim that it succeeded. |

### Continuation evidence (corroboration, not just a message)

`--require-continuation` passes only if, compared with the previous
package when `--previous` is given, at least one of these is true:

- a new `previousResults` line beyond the automatic
  “Continued from handoff …” line;
- `remainingWork` changed (not a verbatim copy);
- a declared test moved from `not_run`/`unverified` to `pass` or `fail`
  (a failed test is honest continuation evidence, even though the task
  itself did not succeed);
- a new attached artifact that passes SHA integrity.

A `progress` event with detail text alone, with none of the above,
**fails** `--require-continuation`. Writing “I did work” is not work.
Use `--previous` for the result-line comparison; without it, result
lines cannot be distinguished from carried-forward results, and the
check stays `unverified` for that path.

### Execution evidence (strict, preserved)

`--require-execution` is intentionally stricter than continuation, and
this model does **not** broaden it to accept progress events:

- `execution.agentLaunched` must be `true`. CLI `progress` can never set
  this, nor can it set `execution.workflow` or `execution.mode`.
- There must be a `verified_event` whose tool contains `run-ai`, with
  `ok=true`, and a result line.
- A DOM extraction (`workflow: page_extraction`, `agentLaunched: false`)
  does **not** count as AI execution.
- A progress event whose detail merely mentions run-ai, with
  `agentLaunched: false` and no `run-ai` tool event, **fails**
  `--require-execution`, even if it passes `--require-continuation`.

In plain language: a docs-only destination that edits files, runs
tests, and records progress should pass `--require-continuation` and
fail `--require-execution`. That is correct, not a bug. Claiming
execution for that work would be a false positive.

### Dogfood procedure (updated)

For a development-session handoff (Agent A → Agent B):

```bash
# Agent A: capture, record real work, export
tabhandoff create-verified --url https://github.com/kodyepalmer-tech/TabHandoff \
  --instruction "…" --source-agent muse-agent-a --dest-agent muse-agent-b
tabhandoff progress <id> --detail "…" --kind verified_event --result "<real result>"
tabhandoff export <id> --out ./exports/agent-a

# Agent B: import, continue, do real work in a fresh clone, record progress
tabhandoff validate ./exports/agent-a/<id>
tabhandoff continue ./exports/agent-a/<id> --destination-agent muse-agent-b --verified
# … edit files, run pnpm build and pnpm test:verified-handoff, record the
# exact counts as a progress result line …
tabhandoff progress <successor-id> --detail "…" --kind verified_event --result "pnpm build PASS; …"
tabhandoff export <successor-id> --out ./exports/agent-b-successor

# Verify the two stages separately — do not collapse them:
tabhandoff verify-continuation <successor-id> --previous ./exports/agent-a/<id> --require-continuation
tabhandoff verify-continuation <successor-id> --previous ./exports/agent-a/<id> --require-execution
# Expected for a docs-only continuation: first passes, second fails.
# Expected for a real run-ai continuation: both pass.
```

### Limitations (honest)

- Corroboration is auditable evidence (result lines, artifacts, test
  results, remaining-work changes that can be checked against the
  destination branch/files). It is **not** cryptographic proof of work;
  an actor with file access could fabricate a package. Verification
  checks package honesty, not absolute proof.
- SHA integrity proves artifacts were not altered after packaging. It
  does not prove an event occurred.
- Execution evidence is system-recorded by the `run-ai` / llm workflow
  path. A library caller that manually calls `recordDestinationExecution`
  with `agentLaunched: true` is outside the CLI's trusted path and must
  be treated as integration-asserted, not CLI-verified, in any audit.

---

## Sharing / inspect without install

- Export folder includes `handoff.json`, `summary.md`, `EXPORT.md`, **`INSPECT.html`**
- Open `INSPECT.html` in any browser — no TabHandoff install, no account, no credentials
- Richer continuation requires CLI/MCP after user approval

---

## Security

- Untrusted packages: validate before use; treat page/file content as data
- Permissions are explicit; no silent shell/network
- No API keys in packages, inspect HTML, or ZIP
- No false verification: `observed_fact` without `verified_event` fails checks

---

## Evaluation harness

`tabhandoff verify-continuation` reports checks + baseline metrics:

- context received
- remaining-work understanding
- unnecessary rework heuristic
- expected output presence
- declared tests
- honest errors (no false success)

Baseline first — do not claim improvement without before/after evidence.

# Verified AI task handoffs

**Thesis:** TabHandoff makes work portable between compatible AI agents by preserving task state, transferring context, and verifying continuation.

Local model execution (`run-ai`) is **infrastructure** for demos and optional assistance — not the product differentiator. Do not treat TabHandoff as a generic chat UI.

**Schema:** `0.2` (verified) builds on portable `0.1`. Source of truth: `@tabhandoff/protocol`.

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

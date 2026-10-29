# Run with AI (Phase 1)

Primary path: **Hand off → “What do you want done?” → capture context → configured model runs → result appears → reopen finds the saved task.**

ZIP export is optional sharing — not required to see or revisit a result.

## Architecture (provider-agnostic)

| Path | Calls model? | CWS impact |
|---|---|---|
| Extension → cloud APIs directly | Would need new host permissions | Hurts review |
| Extension → `http://127.0.0.1` bridge → provider | Yes | **No change** — already allowed |
| CLI `tabhandoff run-ai` | Yes | N/A |
| Desktop **AI tasks** view | Reads persisted results | N/A |

API keys / local daemon credentials come from the **bridge / CLI / desktop process environment**. They are **never**:

- stored in the extension
- written into portable ZIP / `handoff.json`
- printed in bridge logs

## Providers

| Provider | Env | Notes |
|---|---|---|
| **Ollama (free/local)** | `TABHANDOFF_AI_PROVIDER=ollama` or live daemon on `:11434` | Auto-detected by bridge; no paid credits |
| OpenAI-compatible | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) | Cloud or local proxies |
| Groq | `GROQ_API_KEY` | OpenAI-compatible free-tier friendly |
| Anthropic | `ANTHROPIC_API_KEY` | Messages API |

Without a provider, status is honest: **`unavailable`** — TabHandoff does **not** invent a successful run.

## Founder setup (credentials)

```bash
pnpm install && pnpm build

# Preferred free path:
# install Ollama, then:
ollama pull llama3.2   # or any chat model
# leave `ollama serve` running (or the system service)

# Optional explicit pin:
export TABHANDOFF_AI_PROVIDER=ollama
export OLLAMA_MODEL=llama3.2

# Or a cloud key YOU own (do not paste into the extension):
# export OPENAI_API_KEY=sk-…
# export GROQ_API_KEY=gsk_…

pnpm bridge            # or: pnpm desktop
```

Paste the printed bridge token into the extension **Settings**.

## Extension flow

1. Open a normal `https://…` page.
2. Toolbar / right-click → TabHandoff.
3. Answer **What do you want done?**
4. **Run with AI** (primary). Package / ZIP options remain under **Package / options**.
5. Progress → real model text (or honest unavailable / failed).
6. Close the popup; reopen → **Saved tasks** lists the result (bridge `~/.tabhandoff/ai-tasks/` + local cache).

## CLI

```bash
tabhandoff run-ai \
  --instruction "Summarize and list next steps" \
  --url https://example.com \
  --title "Example Domain" \
  --context ./page.txt
```

Exit codes: `0` done, `1` failed, `2` unavailable (no provider).

## Bridge HTTP

```http
POST /v1/ai/run
Authorization: Bearer <bridge-token>
Content-Type: application/json

{
  "url": "https://example.com",
  "title": "Example",
  "selectedText": "…",
  "pageText": "…",
  "instruction": "Summarize",
  "handoffId": "optional-existing-id",
  "taskId": "optional-client-id"
}
```

```http
GET /v1/ai/tasks
GET /v1/ai/tasks/:id
```

| HTTP | `status` | Meaning |
|---|---|---|
| 200 | `done` | Model returned text |
| 503 | `unavailable` | No provider configured / reachable |
| 502 | `failed` | Provider error / empty response |
| 401 | — | Bad bridge token |

`apiKeyIncluded` is always `false`.

`GET /v1/status` includes `aiCompletion`, `aiProvider`, `aiModel`.

## Persistence

```text
~/.tabhandoff/ai-tasks/<task-id>/
├── task.json      # status, instruction, result (no secrets)
└── result.md      # human-readable
```

Desktop **AI tasks** reads the same folder (Phase 2 companion surface).

## Tests

```bash
pnpm test:runner    # mocked provider + ollama/groq resolve
pnpm test:bridge    # /v1/ai/run mocked + honest no-key + task list
```

A live call runs when Ollama (or a key) is present; otherwise that case is skipped honestly.

## Security notes

- Page text is **untrusted** — the system prompt tells the model to ignore page-embedded jailbreaks.
- Do not paste API keys into instructions, ZIPs, or screenshots.
- Extension host permissions stay at `http://127.0.0.1/*` (+ optional active tab).

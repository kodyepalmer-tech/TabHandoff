# Run with AI (Priority 4 vertical slice)

Smallest path: **Hand off → instruction → capture context → configured model runs → result appears.**

ZIP export stays secondary (still always available). This slice does **not** expand Chrome Web Store host permissions to OpenAI/Anthropic — the extension talks only to the existing loopback bridge.

## Why bridge / CLI first

| Path | Calls model? | CWS impact |
|---|---|---|
| Extension → `https://api.openai.com` directly | Would need new host permissions | Hurts review / permission surface |
| Extension → `http://127.0.0.1` bridge → provider | Yes | **No change** — already allowed |
| CLI `tabhandoff run-ai` | Yes | N/A |

API keys come from the **bridge/CLI process environment** (or future local settings file). They are **never**:

- stored in the extension
- written into portable ZIP / `handoff.json`
- printed in bridge logs

## Prerequisites

```bash
pnpm install && pnpm build
export OPENAI_API_KEY=sk-…          # or ANTHROPIC_API_KEY=…
# optional: OPENAI_MODEL, OPENAI_BASE_URL (OpenAI-compatible proxies)
pnpm bridge                         # or: pnpm desktop
```

Paste the printed bridge token into the extension Settings (same as My Activity).

Without a key, status is honest: **`unavailable`** — TabHandoff does **not** invent a successful external run.

## Extension flow

1. Capture tab (URL, title, selection, visible text, optional screenshot).
2. Write instruction → Review.
3. Optional checkbox **Run with AI** (shown only when `/v1/status` reports `aiCompletion: true`).
4. Confirm → ZIP downloads; if checked, popup `POST`s `/v1/ai/run` on loopback.
5. Result panel shows **running / failed / done / unavailable** and the model text.

You can still **Download ZIP** and **Copy brief for another AI** afterward.

## CLI

```bash
tabhandoff run-ai \
  --instruction "Summarize and list next steps" \
  --url https://example.com \
  --title "Example Domain" \
  --context ./page.txt

# Attach under an existing receipt folder:
tabhandoff run-ai --instruction "…" --handoff <id> --context ./page.txt
```

Exit codes: `0` done, `1` failed, `2` unavailable (no key).

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
  "handoffId": "optional-existing-id"
}
```

Responses:

| HTTP | `status` | Meaning |
|---|---|---|
| 200 | `done` | Model returned text |
| 503 | `unavailable` | No API key in bridge env |
| 502 | `failed` | Provider error / empty response |
| 401 | — | Bad bridge token |

`apiKeyIncluded` is always `false` in the JSON body.

`GET /v1/status` includes `aiCompletion: boolean` plus existing `pageExtraction` / `agentExecution`.

## Provider

OpenAI-compatible chat completions first (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`). If only `ANTHROPIC_API_KEY` is set, Anthropic Messages is used.

This is **context → completion**, not the Playwright browser agent loop (`tabhandoff run` / `llm_browser`). Both share the same env keys.

## Tests

```bash
pnpm test:runner    # mocked provider
pnpm test:bridge    # includes /v1/ai/run mocked + honest no-key
```

A live call runs only when `OPENAI_API_KEY` is present; otherwise that case is skipped honestly.

## Security notes

- Page text is **untrusted** — the system prompt tells the model to ignore page-embedded jailbreaks.
- Do not paste API keys into instructions, ZIPs, or screenshots.
- Extension host permissions stay at `http://127.0.0.1/*` (+ optional active tab).

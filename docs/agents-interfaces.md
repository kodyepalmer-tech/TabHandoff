# AI agents & TabHandoff — supported interfaces only

TabHandoff does **not** invent proprietary Cursor / Claude / ChatGPT “remote control” APIs. Agents integrate through documented, testable surfaces.

## Supported (implemented)

| Interface | How | Status |
|---|---|---|
| **CLI** | `create` / `create-verified` / `continue` / `validate` / `read` / `inspect` / `export` / `verify-continuation` / `run-ai` | ✅ |
| **MCP (stdio)** | `handoff_create` / `handoff_status` / `handoff_receipt` (+ validate/read) | ✅ |
| **Portable package** | `handoff.json` schema **0.1** or **0.2** + folder / tar.gz (+ `INSPECT.html`) | ✅ |
| **Local bridge HTTP** | Loopback `127.0.0.1` + Bearer token — extension / desktop | ✅ |

Verified agent-to-agent transfer: [verified-handoff.md](./verified-handoff.md).  
Details: [agents.md](./agents.md), [schema.md](./schema.md), [ai-execution.md](./ai-execution.md).

## Local model runtimes (for Run with AI)

| Runtime | Interface | Notes |
|---|---|---|
| **Ollama** | OpenAI-compatible `/v1/chat/completions` + `/api/tags` | Auto-detected; **exact model tags preserved** |
| **LM Studio** | OpenAI-compatible `/v1/models` + `/chat/completions` | Auto-detected on `:1234` |
| Other OpenAI-compatible local | `OPENAI_BASE_URL` + optional key | Extensible |

Hosted (optional, env keys only — never in extension): OpenAI-compatible, Anthropic, Groq.

## Unsupported / not claimed

| Claim | Reality |
|---|---|
| “Control Cursor IDE remotely” via secret API | **Unsupported** — use CLI/MCP from an agent session |
| “Drive ChatGPT.com UI” | **Unsupported** — export brief / package; paste manually |
| Undocumented vendor webhooks | **Not implemented** — will not be invented |

If an agent can run local shell or MCP stdio, use the supported interfaces above. Otherwise use [manual-export.md](./manual-export.md).

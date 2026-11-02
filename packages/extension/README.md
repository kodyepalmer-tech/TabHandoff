# TabHandoff browser extension

**Product path:** Hand off from *inside* an AI chat (ChatGPT / Claude / Cursor web).

1. Highlight a prompt (or click its parent message).
2. Choose **Hand this off to another AI** (in-page bar or right-click).
3. TabHandoff packages the **full surrounding conversation thread** (not just the snippet) so another AI can continue without missing prior turns.
4. Then either:
   - **Download handoff** — portable ZIP (`conversation.md` + `handoff.json`) to upload into another AI later, or
   - **Continue now** — local bridge/desktop destination when available (honest **blocked** if none).

Standalone desktop Transfer is supporting infrastructure, not the value prop.

AI site DOMs change often — thread capture is **best-effort and labeled fragile**. Always review the package.

## Load unpacked

1. Chrome/Edge/Brave → `chrome://extensions` → Developer mode → **Load unpacked** → this folder (`packages/extension`).
2. Open ChatGPT, Claude, Cursor web, or `fixtures/ai-chat-fixture.html` via a local static server.
3. Highlight text → right-click **Hand off selection to another AI** (or use the in-page button on known AI hosts).
4. **Download handoff** or **Continue now**.

Optional: start `pnpm bridge` / `pnpm desktop`, pair in Settings, for Continue now / Run with AI. Keys stay in the bridge process — never in the extension.

## Package contents

| File | Purpose |
|---|---|
| `conversation.md` | Full chat thread around the prompt |
| `START_HERE.md` | How to continue without installing TabHandoff |
| `handoff.json` | Portable schema (`page.selectedText` holds the thread) |
| `summary.md` | Human-readable handoff |

Status is always honest — never pretends an agent ran when only a package was created.

## Store ZIP

```bash
pnpm pack:extension
# → artifacts/tabhandoff-extension-<version>.zip
```

## Permissions (plain language)

| Permission | Why |
|---|---|
| Active tab + scripting | Capture selection, nearest message, and best-effort full thread |
| Context menu | Right-click “Hand off…” |
| Host access (ChatGPT / Claude / Cursor web) | In-page “Hand this off…” bar on those sites |
| Storage | Onboarding, optional bridge token, local task cache |
| `http://127.0.0.1` | Local bridge only (Continue now / Run with AI / My Activity) |

Nothing is uploaded to a TabHandoff cloud by default.

## Tests

```bash
pnpm test:extension-package
```

## Safety

- Bridge binds to **127.0.0.1** only when used.
- Captured page/thread text is **untrusted** (prompt-injection aware).
- See [docs/extension-setup.md](../../docs/extension-setup.md).

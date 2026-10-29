# TabHandoff browser extension

Primary path: **What do you want done?** → **Run with AI** via the local bridge → see the real result → reopen **Saved tasks**.

ZIP export remains available as optional sharing under **Package / options**. Status is always honest — TabHandoff never pretends a model ran when it did not.

## Run with AI (Phase 1)

1. Start the bridge: `pnpm bridge` or `pnpm desktop` (with a provider — see below).
2. Open `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
3. Popup → **Settings** → paste the bridge token.
4. Open any `https://` page → toolbar / right-click **Hand off with TabHandoff**.
5. Answer **What do you want done?** → **Run with AI**.
6. Close and reopen the popup — the task appears under **Saved tasks**.

The extension talks only to `http://127.0.0.1` (existing permission). Model keys stay in the bridge process env — never in extension storage or ZIP packages.

Providers (bridge env): local **Ollama** (auto-detected), `OPENAI_API_KEY`, `GROQ_API_KEY`, or `ANTHROPIC_API_KEY`. Details: [docs/ai-execution.md](../../docs/ai-execution.md).

## Package-only (no bridge)

Still works offline: **Package / options** → download ZIP (`START_HERE.md` + `handoff.json` + summary). Result says **package created — not agent executed**. **Copy brief for another AI** remains available.

## Optional My Activity / page extraction

On **Package / options**, check **Also save to My Activity** and/or isolated page extraction when Playwright is available on the bridge.

## Store ZIP

```bash
pnpm pack:extension
# → artifacts/tabhandoff-extension-<version>.zip
```

See [docs/chrome-web-store.md](../../docs/chrome-web-store.md) and [docs/privacy.md](../../docs/privacy.md).

## Permissions (plain language)

| Permission | Why |
|---|---|
| Read the active tab | Capture title, URL, selection, screenshot, visible text |
| Context menu | Right-click “Hand off…” |
| Storage | Onboarding, optional bridge token, local task cache |
| `http://127.0.0.1` | Local bridge only (Run with AI / My Activity) |

Nothing is uploaded to a TabHandoff cloud by default.

## Tests

```bash
pnpm test:extension-package
```

## Safety

- Bridge binds to **127.0.0.1** only when used.
- Captured page text is **untrusted** (prompt-injection aware).
- See [docs/extension-setup.md](../../docs/extension-setup.md).

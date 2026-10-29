# TabHandoff browser extension

Hand off the current tab as a **portable ZIP package** (`handoff.json` + summary + screenshots). The local bridge/desktop is **optional**. Status is always honest: **package created** — never a fake agent success.

## Package-only (no bridge)

1. Open `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Open any `https://` page → right-click **Hand off with TabHandoff**.
3. Write an instruction → **Save package**.
4. ZIP downloads (`START_HERE.md` + `handoff.json` + `summary.md` + screenshots). Recipients do **not** need TabHandoff installed.
5. Use **Copy brief for another AI** to paste into ChatGPT/Claude/Cursor without a ZIP.

No token required.

## Optional: My Activity / extraction

1. Run `pnpm bridge` or the desktop app; copy the access token.
2. Popup → **Settings** → paste token.
3. On Review, check **Also save to My Activity** (and optionally page extraction).

## Store ZIP

From repo root:

```bash
pnpm pack:extension
# → artifacts/tabhandoff-extension-<version>.zip
```

See [docs/chrome-web-store.md](../../docs/chrome-web-store.md) and [docs/privacy.md](../../docs/privacy.md).

## Permissions (plain language)

| Permission | Why |
|---|---|
| Read the active tab | Capture title, URL, selection, screenshot |
| Context menu | Right-click “Hand off…” |
| Storage | Onboarding + optional bridge token |
| `http://127.0.0.1` | Optional local bridge only |

Nothing is uploaded to a TabHandoff cloud by default.

## Tests

```bash
pnpm test:extension-package
```

## Safety

- Bridge binds to **127.0.0.1** only when used.
- Captured page text is **untrusted** (prompt-injection aware).
- See [docs/extension-setup.md](../../docs/extension-setup.md).

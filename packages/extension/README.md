# TabHandoff browser extension (Phase 2)

Hand off the current tab as a **portable package**. Status is always honest: if no agent runs, the UI says **package created** — never a fake success.

## Load in Chrome / Edge / Brave (unpacked)

1. Build TabHandoff once: from the repo root run `pnpm install && pnpm build`.
2. Start the local bridge **or** the desktop app (either is fine):
   - `pnpm bridge` — prints an access token  
   - or `pnpm desktop` — Settings shows the same token
3. Open `chrome://extensions` (or `edge://extensions`).
4. Turn on **Developer mode**.
5. Click **Load unpacked** and choose this folder:  
   `packages/extension`
6. Pin the TabHandoff toolbar button.
7. Open the extension popup → **Settings** → paste the bridge token → **Save**.

## Everyday use

1. Browse any normal `https://` page.
2. Optionally select text.
3. Right-click → **Hand off with TabHandoff**, or click the toolbar button.
4. Write a plain-language instruction.
5. Review what will be shared → **Create package**.

### If the bridge is running

The package is saved under `~/.tabhandoff/receipts/<id>/` (JSON + summary + screenshots). Open **TabHandoff desktop → My Activity → Refresh**.

### If the bridge is off

You still get a real package: **Copy summary** or **Download package**. No agent is pretended to have run.

## Permissions (plain language)

| Permission | Why |
|---|---|
| Read the active tab | Capture title, URL, selection, screenshot |
| Context menu | Right-click “Hand off…” |
| Storage | Remember your local bridge token |
| `http://127.0.0.1` | Talk only to the TabHandoff bridge on this computer |

Nothing is uploaded to a cloud by default.

## Safety

- Bridge binds to **127.0.0.1** only.
- Requests need your **access token**.
- Captured page text is treated as **untrusted** (prompt-injection aware).
- Phase 2 does **not** launch Playwright/agent execution (that is Phase 3+).

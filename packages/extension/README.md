# TabHandoff browser extension

Hand off the current tab as a **portable package**, optionally run **page extraction** through the local bridge. Status is always honest: if nothing runs, the UI says **package created** — never a fake agent success. DOM extract without an API key is labeled **page extraction**, not autonomous AI.

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
5. Review what will be shared. Leave **page extraction** checked to run the supported workflow in an isolated browser (no cookies copied).
6. Confirm → **Hand off**. Watch real progress in the popup.

### If the bridge is running

The package is saved under `~/.tabhandoff/receipts/<id>/`. When extraction runs, screenshots and a receipt are added. Open **TabHandoff desktop → My Activity** (auto-refreshes).

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
- Confirmation is required before starting page extraction.
- See [docs/phase3-e2e-handoff.md](../../docs/phase3-e2e-handoff.md) for the end-to-end path.

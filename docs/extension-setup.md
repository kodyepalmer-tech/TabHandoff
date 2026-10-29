# Set up TabHandoff in your browser (nontechnical)

You need the TabHandoff project on your computer (already installed if you used the one-command installer).

## 1. Start the local helper

Open a terminal in the TabHandoff folder and run:

```bash
pnpm bridge
```

**Or** open the TabHandoff desktop app (`pnpm desktop`). Either one starts a small helper that only listens on this computer.

Copy the **access token** it shows (a long random string).

## 2. Load the extension

1. Open Chrome, Edge, or Brave.
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Turn **Developer mode** on (top right).
4. Click **Load unpacked**.
5. Choose the folder named `extension` inside `packages` in your TabHandoff project.
6. Pin TabHandoff to the toolbar.

## 3. Connect the extension

1. Click the TabHandoff icon.
2. Click **Settings**.
3. Paste the access token → **Save**.
4. The footer should say **Bridge: on**.

## 4. Hand off a page

1. Open any normal website (`https://…`).
2. Right-click the page (or selected text) → **Hand off with TabHandoff**.  
   Or click the toolbar button.
3. Type what you want done in plain language.
4. Review — leave **page extraction** checked if you want the isolated browser to extract the page (not autonomous AI).
5. Confirm → **Hand off**. Watch the real status in the popup.

If the helper is running, open TabHandoff desktop → **My Activity** (it refreshes automatically) to see receipts and screenshots.

If the helper is not running, use **Download package** or **Copy summary**. The app will **not** claim an AI finished the job when it only saved a package. DOM extraction without an API key is always labeled as **page extraction**, not AI completion.

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Run `pnpm bridge` or open the desktop app; paste the token again |
| Can’t hand off chrome:// pages | Open a regular website instead |
| No screenshot | Some pages block capture — the link and text still hand off |
| Token rejected | Copy the token from desktop **Settings** or the bridge terminal output |

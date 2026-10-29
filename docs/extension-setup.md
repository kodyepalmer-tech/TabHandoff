# Set up TabHandoff in your browser (nontechnical)

## Package-only path (recommended for launch)

You can create and download a handoff **without** the desktop app or any token.

### Load unpacked (dev / pre-CWS)

1. Open Chrome, Edge, or Brave → `chrome://extensions` (or `edge://extensions`).
2. Turn **Developer mode** on.
3. Click **Load unpacked** → choose `packages/extension` in this repo  
   (or unzip `artifacts/tabhandoff-extension-*.zip` from `pnpm pack:extension` into a folder and load that).
4. Pin TabHandoff to the toolbar.
5. First open shows a short welcome — continue.

### Hand off a page (no bridge)

1. Open any normal website (`https://…`).
2. Right-click → **Hand off with TabHandoff**, or click the toolbar button.
3. Type what you want done.
4. Review → **Save package**.
5. A ZIP downloads (`handoff.json` + `summary.md` + screenshots when available).
6. Status says **Package created — not agent executed**.
7. Optional: **Copy brief for another AI** and paste into ChatGPT / Claude / Cursor.

Validate a downloaded package (developers):

```bash
unzip tabhandoff-<id>.zip -d /tmp/th-pack
pnpm build   # once
node packages/cli/dist/index.js validate /tmp/th-pack
```

### Clean-install manual checklist

Use a fresh Chrome profile (or guest) with **no** prior TabHandoff data:

- [ ] Load unpacked / install from store ZIP
- [ ] Welcome onboarding appears once
- [ ] Open https://example.com → right-click Hand off
- [ ] Enter instruction → Save package → ZIP downloads
- [ ] Result does **not** claim an agent ran
- [ ] Copy brief for another AI pastes readable text
- [ ] Bridge footer may say off — still succeeds
- [ ] chrome://extensions itself cannot be handed off (honest message)

Automated coverage: `pnpm test:extension-package` (builds the same ZIP layout and validates via CLI — no browser required).

---

## Optional: local bridge / My Activity

Only needed if you want packages saved into `~/.tabhandoff` or page extraction on this computer.

1. From the TabHandoff folder: `pnpm bridge` **or** open the desktop app.
2. Copy the access token it shows.
3. Extension → **Settings** → paste token → **Save**.
4. On Review, leave **Also save to My Activity** checked.

Token is **not** required for Save package / ZIP download.

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Fine for ZIP download. Start bridge + token only for My Activity |
| Can’t hand off chrome:// pages | Open a regular website instead |
| No screenshot | Some pages block capture — link and text still hand off |
| Token rejected | Copy token from desktop Settings or bridge terminal |

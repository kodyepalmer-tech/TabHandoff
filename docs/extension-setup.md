# Set up TabHandoff in your browser (nontechnical)

**Chrome Web Store is not live.** Install with **Load unpacked** until a founder publishes a store listing.

## Package-first path (recommended)

You can create and download a handoff package without pretending an agent ran. Status stays honest: **package created**.

### Load unpacked

1. From the TabHandoff repo: `pnpm install && pnpm build` (once).
2. Open Chrome, Edge, or Brave → `chrome://extensions` (or `edge://extensions`).
3. Turn **Developer mode** on.
4. Click **Load unpacked** → choose `packages/extension`.
5. Pin TabHandoff to the toolbar.

### Hand off a page

1. Open any normal website (`https://…`).
2. Right-click → **Hand off with TabHandoff**, or click the toolbar button.
3. Type what you want done.
4. Review → confirm.
5. If the local bridge is **off**, use **Download package** or **Copy summary**. No agent is pretended to have run.
6. Optional: start desktop / `pnpm bridge`, paste the token in Settings, and save into My Activity or run page extraction on this computer.

Token is **not** required for package download / copy summary.

Public install page: [website/install.html](../website/install.html#extension) · Privacy: [website/privacy.html](../website/privacy.html)

## Optional: local bridge / My Activity

Only needed if you want packages saved into `~/.tabhandoff` or page extraction on this computer.

1. From the TabHandoff folder: `pnpm bridge` **or** open the desktop app.
2. Copy the access token it shows.
3. Extension → **Settings** → paste token → **Save**.
4. On Review, leave page extraction checked if you want the isolated browser to extract the page (not autonomous AI).

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Fine for package download/copy. Start bridge + token only for My Activity / extraction |
| Can’t hand off chrome:// pages | Open a regular website instead |
| No screenshot | Some pages block capture — the link and text still hand off |
| Token rejected | Copy token from desktop Settings or bridge terminal |
| Looking for Chrome Web Store | Not published yet — use Load unpacked |

More: [troubleshooting.md](./troubleshooting.md) · [website/support.html](../website/support.html)

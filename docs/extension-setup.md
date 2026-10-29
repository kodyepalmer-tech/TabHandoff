# Set up TabHandoff in your browser (nontechnical)

**Primary product path:** desktop + local AI → hand off a tab → real result → saved history.  
**ZIP download is optional** (sharing). **Load unpacked** until Chrome Web Store is published — there is **no** live store URL yet.

Public website (after Pages): [install](../website/install.html) · [privacy](../website/privacy.html) · [support](../website/support.html)

---

## 1. Start desktop / bridge (for Run with AI)

1. From the TabHandoff folder: `pnpm install && pnpm build && pnpm desktop`  
   (or `pnpm bridge` if you only want the loopback helper).
2. Optional free local model: install [Ollama](https://ollama.com/), pull a model, leave it running.
3. Copy the access token the app/terminal shows.

---

## 2. Load unpacked (store not live yet)

Do not follow any third-party “install from store” link claiming to be TabHandoff until the founder publishes one.

1. Open Chrome, Edge, or Brave → `chrome://extensions` (or `edge://extensions`).
2. Turn **Developer mode** on.
3. Click **Load unpacked** → choose `packages/extension` in this repo  
   (or unzip `artifacts/tabhandoff-extension-*.zip` from `pnpm pack:extension` into a folder and load that).
4. Pin TabHandoff to the toolbar.
5. Extension → **Settings** → paste the token → **Save**.

---

## 3. Hand off a page (primary: Run with AI)

1. Open any normal website (`https://…`).
2. Right-click → **Hand off with TabHandoff**, or click the toolbar button.
3. Type what you want done → Review.
4. **Run with AI** when the bridge is connected — result and history stay on this computer (`~/.tabhandoff/`).
5. Optional: also download a portable ZIP if you want to share. ZIP is **not** required for the AI path.

> Note: Full Run with AI UX lands via the product PR track (see open PRs). On builds that only have Save package, use the ZIP path below — status stays honest.

---

## Optional: ZIP-only (no desktop / no token)

You can create and download a handoff **without** the desktop app:

1. Load unpacked as above (token not required).
2. Hand off → Review → **Save package**.
3. A ZIP downloads (`START_HERE.md`, `handoff.json`, `summary.md`, screenshots when available).
4. Status says **Package created — not agent executed**.
5. Optional: **Copy brief for another AI**.

Validate a downloaded package (developers):

```bash
unzip tabhandoff-<id>.zip -d /tmp/th-pack
pnpm build   # once
node packages/cli/dist/index.js validate /tmp/th-pack
```

### Clean-install manual checklist

Use a fresh Chrome profile (or guest) with **no** prior TabHandoff data:

- [ ] Load unpacked
- [ ] Welcome onboarding appears once
- [ ] Open https://example.com → right-click Hand off
- [ ] With bridge: Run with AI succeeds **or** fails honestly (no fake “done”)
- [ ] Without bridge: Save package → ZIP downloads; does **not** claim an agent ran
- [ ] Copy brief for another AI pastes readable text
- [ ] chrome://extensions itself cannot be handed off (honest message)

Automated coverage: `pnpm test:extension-package` (ZIP layout + CLI validate — no browser required).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Start desktop/bridge + paste token for Run with AI / history. Fine for ZIP-only |
| Can’t hand off chrome:// pages | Open a regular website instead |
| No screenshot | Some pages block capture — link and text still hand off |
| Token rejected | Copy token again from desktop Settings or bridge terminal |
| Local model error | Confirm Ollama is running; use the full model tag (e.g. `smollm2:135m`) |

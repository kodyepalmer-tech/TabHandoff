# Set up TabHandoff (first run)

**Everyday path:** desktop + local AI → hand off a tab → real result → history on this computer.  
**ZIP is optional** (sharing). **Load unpacked** until Chrome Web Store — there is **no** store URL yet.  
**Agents:** verified portable packages (schema 0.2) are a separate CLI/MCP path — see [verified-handoff.md](./verified-handoff.md).

Site pages (in-repo; Pages not live yet): [install](../website/install.html) · [privacy](../website/privacy.html) · [support](../website/support.html)

---

## First run (about four steps)

### 1. Desktop

```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
pnpm desktop
```

Optional free local model: install [Ollama](https://ollama.com/), pull a model (use the **full tag**, e.g. `smollm2:135m`), leave it running.  
Copy the **access token** the desktop/bridge prints.

### 2. Extension (Load unpacked)

1. Chrome / Edge / Brave → `chrome://extensions` → **Developer mode** on.  
2. **Load unpacked** → `packages/extension` (or unpack `pnpm pack:extension` output).  
3. Pin the toolbar icon.  
4. **Settings** → paste the token → **Save**.

Do not use third-party “store” links until the founder publishes an official CWS listing.

### 3. Run a task

1. Open a normal `https://…` page (not `chrome://`).  
2. Right-click → **Hand off with TabHandoff** (or toolbar).  
3. Type the instruction → Review → **Run with AI**.  
4. Result + history stay under `~/.tabhandoff/`.  
5. Optional: also download a ZIP to share — not required for AI.

If the bridge is off or there is no provider, the UI stays honest (Save package / unavailable / failed — never a fake “done”).

---

## Optional: ZIP-only (no desktop)

Load unpacked without a token → Review → **Save package**. Status: **Package created — not agent executed**. Optional **Copy brief for another AI**.

```bash
unzip tabhandoff-<id>.zip -d /tmp/th-pack
pnpm build
node packages/cli/dist/index.js validate /tmp/th-pack
```

---

## Quick checklist

- [ ] `pnpm desktop` running; token pasted  
- [ ] Load unpacked  
- [ ] example.com → Run with AI succeeds **or** fails honestly  
- [ ] Without bridge: Save package still works; does not claim an agent ran  
- [ ] `chrome://` pages refuse with an honest message  

Automated ZIP layout check: `pnpm test:extension-package`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Start `pnpm desktop` / `pnpm bridge` + paste token |
| Token rejected | Copy the token again from the desktop/terminal |
| Local model error | Ollama running; full model tag (`name:tag`) |
| Can’t hand off chrome:// | Use a normal https page |
| No screenshot | Some pages block capture — URL + text still work |

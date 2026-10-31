# Set up TabHandoff (browser capture + coding agents)

**Beachhead:** reliable handoffs between **AI coding agents**.  
**Ships today:** browser capture → portable package → CLI/MCP continue & verify.  
**ZIP / local bridge / desktop** are supporting tools. **Load unpacked** until Chrome Web Store — there is **no** store URL yet.  
**Roadmap (not shipped):** file/desktop capture, “any agent anywhere,” one-click store install.

Site: [install](../website/install.html) · [privacy](../website/privacy.html) · [support](../website/support.html)

---

## First run

### 1. Build

```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
```

### 2. Load unpacked

1. Chrome / Edge / Brave → `chrome://extensions` → **Developer mode** on.  
2. **Load unpacked** → `packages/extension` (or unpack `pnpm pack:extension` output).  
3. Pin the toolbar icon.

Do not use third-party “store” links until the founder publishes an official listing.

### 3. Capture → package

1. Open a normal `https://…` page (not `chrome://`).  
2. Right-click → **Hand off with TabHandoff**.  
3. Instruction → Review → **Save package** (portable ZIP).  
4. Status: **package created** is not “agent finished.”

### 4. Continue in a coding agent

```bash
node packages/cli/dist/index.js validate /path/to/unpacked-or-export
# verified path: see docs/verified-handoff.md
```

---

## Optional: local bridge / Run with AI

Only if you want loopback execution or My Activity on this machine:

1. `pnpm desktop` or `pnpm bridge`  
2. Paste the token in extension Settings  
3. Use Run with AI when a provider is available — failures stay honest  

Token is **not** required for Save package.

---

## Quick checklist

- [ ] Load unpacked  
- [ ] example.com → Save package → ZIP downloads; does not claim an agent ran  
- [ ] CLI validate passes on the package  
- [ ] `chrome://` pages refuse with an honest message  

Automated ZIP layout: `pnpm test:extension-package`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bridge: off | Fine for ZIP-only; start desktop/bridge only for loopback |
| Can’t hand off chrome:// | Use a normal https page |
| No screenshot | Some pages block capture — URL + text still work |
| Token rejected | Re-copy from desktop/terminal |

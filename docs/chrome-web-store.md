# Chrome Web Store — TabHandoff listing draft

**Status:** Engineering package ready; **founder** owns developer account, payment, and submit.  
**Do not** create release tags or change DNS as part of this checklist.  
**No live CWS listing URL yet** — docs must not invent one. Until submit+approve, install via Load unpacked / packed ZIP ([extension-setup.md](./extension-setup.md)).

## Package

```bash
pnpm pack:extension
# → artifacts/tabhandoff-extension-<version>.zip
```

Upload that ZIP (not the whole monorepo). Icons 16/32/48/128 are in `packages/extension/icons/`.

## Listing copy (draft)

**Name:** TabHandoff  

**Short description (≤132 chars):**  
Hand off any webpage as a portable package for another person or AI — honest status, no fake agent runs.

**Detailed description:**

TabHandoff turns the tab you’re looking at into a portable handoff another person or AI can continue.

How it works:
1. Install TabHandoff
2. Open a normal webpage
3. Right-click → “Hand off with TabHandoff” (or use the toolbar button)
4. Write a short instruction
5. Save a ZIP package (START_HERE.md + handoff.json + summary + screenshots when available)

You do **not** need the desktop app for the basic path. Packages download locally. Recipients open START_HERE.md or paste “Copy brief for another AI” into ChatGPT/Claude — **no TabHandoff install required** on their side. Status is honest: **package created**, not “agent finished,” unless a local workflow actually ran.

Optional: connect the local TabHandoff bridge later to save into My Activity on your computer (loopback only; token required).

Privacy-first defaults:
- No TabHandoff cloud account required for Save package
- Page cookies/passwords are not copied into packages
- Captured page text is labeled untrusted (prompt-injection aware)

Open source: https://github.com/kodyepalmer-tech/TabHandoff

**Category:** Productivity  
**Language:** English  

## Privacy policy URL

- Source in repo: [`docs/privacy.md`](./privacy.md) / [`docs/privacy.html`](./privacy.html)
- **Founder:** host a public HTTPS copy (prefer `https://tabhandoff.com/privacy` after website PR #6 + Pages/DNS). Until then, a GitHub Pages / raw HTML URL can unblock review if CWS accepts it.

## Store screenshots (founder / design)

Capture from a clean profile after load-unpacked or CWS build:

1. Popup on a normal page with instruction field (first-run welcome optional)
2. Review step showing Save package
3. Result: “Package created — not agent executed” + Copy brief / Download ZIP
4. Right-click context menu on a page

Promo tile / marquee: use B&W mark (`icons/icon-128.png` / brand squircle). Avoid claiming autonomous AI completion.

## Permissions audit (justification for CWS)

| Permission | Justification |
|---|---|
| `contextMenus` | “Hand off with TabHandoff” on page/selection/link |
| `activeTab` | Read URL/title/selection/screenshot only when the user invokes the extension |
| `scripting` | Read selected text on the active tab the user handed off |
| `storage` | Remember first-run onboarding + optional local bridge token/base URL |
| `host_permissions`: `http://127.0.0.1/*` | Optional local bridge only; never a remote TabHandoff API in MVP |
| `optional_host_permissions`: `http(s)://*/*` | Reserved for capture edge cases; prefer activeTab for the happy path |

**CSP / remote code:** Extension is plain JS modules shipped in the ZIP — no remote script load, no eval.

**Single purpose:** Create portable handoff packages from the current browser tab.

## Reviewer notes

- Bridge offline is expected for the launch path; ZIP download must still work.
- chrome:// and other restricted pages show an honest “not supported” message.
- Token paste is **optional** and only for My Activity / extraction.

## Founder submit checklist

- [ ] Chrome Web Store developer account + one-time fee
- [ ] `pnpm pack:extension` → upload ZIP
- [ ] Privacy policy HTTPS URL live
- [ ] Screenshots + listing copy pasted
- [ ] Permissions justifications filled
- [ ] Submit for review; wait for Google

## Manual clean-install smoke (after sideload or CWS)

See [extension-setup.md](./extension-setup.md) § Clean install (package-only).

# TabHandoff Privacy Policy

**Last updated:** 2026-10-29  
**Product:** TabHandoff browser extension, local bridge/desktop, and related CLI  
**Contact:** [GitHub issues](https://github.com/kodyepalmer-tech/TabHandoff/issues) · site [Support](../website/support.html) when Pages is live

This policy describes how TabHandoff handles data. It is written for Chrome Web Store reviewers and everyday users.

## Summary

- **Primary path:** connect local AI (desktop/bridge) → browser task → real result → saved history on this machine.
- **Optional:** download a portable ZIP when you want to share. ZIP is not required for Run with AI.
- Captured page context is processed on **your** computer via loopback (`127.0.0.1`) and/or an AI provider endpoint **you** configure on the bridge — not a TabHandoff cloud account.
- We do **not** sell personal data. We do **not** use captured page content for advertising.

## Data the extension may access

| Data | When | Purpose |
|---|---|---|
| Active tab URL and title | When you open the popup or use “Hand off with TabHandoff” | Identify the page |
| Selected text | When you select text before handoff | Include context you chose |
| Visible-tab screenshot | When Chrome allows capture | Evidence in the package / task |
| Your instruction text | When you type it | Tell the local AI or next person what to do |
| Local bridge token | When you paste it in Settings | Authenticate to the loopback bridge |
| Local AI task history | After Run with AI | Show past results on this computer |

The extension requests:

- `activeTab`, `scripting` — read the page you hand off  
- `contextMenus` — right-click “Hand off with TabHandoff”  
- `storage` — onboarding, bridge settings, local history cache  
- `http://127.0.0.1/*` — talk only to the local bridge  

## Where processing happens

| Path | Where data goes |
|---|---|
| Run with AI (primary) | Extension → local bridge on `127.0.0.1` → local model (e.g. Ollama) or provider API using a key that stays on the bridge/CLI process |
| Save package / ZIP (optional) | Built on-device and downloaded; not uploaded to TabHandoff servers |
| My Activity / receipts | Written under `~/.tabhandoff/` on this machine |

API keys are **not** stored in the extension or inside ZIP packages.

## Retention

- Default store: `~/.tabhandoff/` (override with `TABHANDOFF_HOME`)
- Tasks, receipts, screenshots, and bridge config remain until **you** delete them
- Uninstalling the desktop app does **not** automatically wipe that folder

## What we do **not** collect

- No cookies or passwords from the page are copied into packages by design  
- No browsing history sync to a TabHandoff server  
- No analytics SDK in the extension MVP  
- No automatic background scraping of sites you are not handing off  

## Sharing

When you download a ZIP or copy a brief for another AI, **you** control who receives it. Treat captured page content as **untrusted** (prompt-injection aware).

## Children

TabHandoff is not directed at children under 13.

## Changes

We may update this policy as the product evolves. Material changes will update the date above.

## Public URL note

Stable HTTPS privacy URL after Pages + DNS: `https://tabhandoff.com/privacy.html`  
Until then: this file and `website/privacy.html` in the repository / github.io preview. Founders should publish a stable HTTPS URL before or during CWS submission.

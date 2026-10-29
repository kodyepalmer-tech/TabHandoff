# TabHandoff Privacy Policy

**Last updated:** 2026-10-29  
**Product:** TabHandoff browser extension and related local software  
**Contact:** Use the GitHub repository issues for the TabHandoff project.

This policy describes how the TabHandoff **browser extension** handles data. It is written for Chrome Web Store reviewers and everyday users.

## Summary

- TabHandoff creates a **portable handoff package** from the page you choose (URL, title, optional selected text, optional screenshot, and your instruction).
- By default, packages are **downloaded to your device** as a ZIP. Nothing is uploaded to TabHandoff cloud servers — there is no TabHandoff cloud account required for the core path.
- An **optional** local bridge (desktop app / `pnpm bridge`) can save packages into a folder on **your computer** (`~/.tabhandoff`). That traffic stays on `127.0.0.1` and requires a local access token.
- We do **not** sell personal data. We do **not** use captured page content for advertising.

## Data the extension may access

| Data | When | Purpose |
|---|---|---|
| Active tab URL and title | When you open the popup or use “Hand off with TabHandoff” | Identify the page in the package |
| Selected text | When you select text before handoff | Include context you chose |
| Visible-tab screenshot | When Chrome allows capture | Evidence in the package |
| Your instruction text | When you type it | Tell the next person/AI what to do |
| Local bridge token (optional) | Only if you paste it in Settings | Authenticate to the loopback bridge on your machine |

The extension requests:

- `activeTab`, `scripting` — read the page you hand off  
- `contextMenus` — right-click “Hand off with TabHandoff”  
- `storage` — remember onboarding + optional bridge settings  
- `http://127.0.0.1/*` — talk only to the local bridge when you opt in  

Optional host permissions for broader http(s) may be requested only when needed for capture on pages you visit; the default happy path uses `activeTab`.

## What we do **not** collect

- No cookies or passwords from the page are copied into the package by design.  
- No browsing history sync to a TabHandoff server.  
- No analytics SDK in the extension MVP.  
- No automatic background scraping of sites you are not handing off.

## Local processing & sharing

When you click **Save package**, TabHandoff builds `handoff.json`, a short summary, and screenshots (when available), then downloads a ZIP. If you copy a brief for another AI or share that ZIP, **you** control who receives it.

Treat captured page content as **untrusted** (it may contain prompt-injection text). Recipients should not execute page text as system instructions.

## Children

TabHandoff is not directed at children under 13.

## Changes

We may update this policy as the product evolves. Material changes will update the date above. For Chrome Web Store listings, host a public HTML copy of this policy (for example on https://tabhandoff.com/privacy after the website ships) and point the store listing at that URL.

## Public URL note

Until the production site privacy page is live, reviewers may use this repository file: `docs/privacy.md`. Founders should publish a stable HTTPS URL before or during CWS submission.

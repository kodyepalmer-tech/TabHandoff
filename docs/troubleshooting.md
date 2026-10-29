# Troubleshooting

## Install & doctor

| Problem | Fix |
|---|---|
| `node` too old | Install Node **22+** from https://nodejs.org |
| `playwright-chromium` fails in `tabhandoff doctor` | `pnpm --filter @tabhandoff/cli exec playwright install chromium` |
| `pnpm` missing | Enable Corepack (`corepack enable`) or install from https://pnpm.io |
| Build fails after pull | `pnpm install && pnpm build` |

## Demo / CLI run

| Problem | Fix |
|---|---|
| `Unknown handoff id` during `run` | Upgrade to Phase 5+ (job update race fixed). Re-run after `pnpm build`. |
| Run fails with browser launch error | Install Chromium (see doctor). On Linux servers, ensure required OS libs for Playwright. |
| Login walls / empty authenticated pages | Expected — isolated Chromium has **no** cookies. Use public pages or package-only + manual paste. |
| Want package only | `tabhandoff create …` — status is **Package only**, not Succeeded. |

## Bridge & extension

| Problem | Fix |
|---|---|
| Bridge: off | `pnpm bridge` or open desktop; paste token in extension Settings |
| Token rejected | Copy the token from bridge terminal or desktop **Settings** |
| Can’t hand off `chrome://` pages | Use a normal `https://` site |
| No screenshot in extension | Some pages block capture; URL + text still hand off |
| Popup says package only | Bridge off, Playwright missing, or page extraction unchecked — honest, not a silent failure |

## Desktop evidence library

| Problem | Fix |
|---|---|
| Empty My Activity | Confirm `TABHANDOFF_HOME` (default `~/.tabhandoff`). Click **Refresh**. |
| Partial records | Missing screenshots or receipt — still shown; open detail for notes. |
| “Package only” badge | Package was saved; no runner was launched. Export or continue elsewhere. |
| Electron won’t start on Linux CI | Use `xvfb-run -a pnpm desktop` or `TABHANDOFF_DEMO_CAPTURE=…` for headless capture. |

## Agents & packages

| Problem | Fix |
|---|---|
| Validate fails | Ensure folder has `handoff.json` matching [schema.md](./schema.md) |
| Continue / mark rejected | Status marks need a justifying event (`progress` / reason). |
| Attach overwrites refused | Pass `--overwrite` only when intentional. |
| Prompt injection worries | Treat page text as **untrusted**. Never auto-execute package contents. |

## Privacy defaults

Evidence stays under `TABHANDOFF_HOME` (usually `~/.tabhandoff/`). Nothing is uploaded unless **you** export, copy, or send a package.

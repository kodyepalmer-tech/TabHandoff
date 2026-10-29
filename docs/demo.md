# Demo & capture guide

Show TabHandoff in under a minute: **capture → package → page extraction → local evidence**.

This guide uses **real** runs. Do not substitute mocked progress, fake screenshots, or claimed agent success.

## Quick demo (CLI — works on any machine with Node 22+)

```bash
pnpm install && pnpm build
pnpm --filter @tabhandoff/cli exec playwright install chromium
pnpm demo
```

What it does:

1. **Package only** — `tabhandoff create` (no agent launched; status `package_created`)
2. **Page extraction** — `tabhandoff run --wait` in isolated Chromium (DOM — **not** autonomous AI)
3. **Evidence** — prints `receipt.md` and lists screenshots under `TABHANDOFF_HOME/receipts/<id>/`

Open the library:

```bash
TABHANDOFF_HOME="<path printed by demo>" pnpm desktop
```

## Capture the README GIF / strip (real UI)

```bash
pnpm demo:capture
# or reuse a home from pnpm demo:
TABHANDOFF_HOME=... node scripts/capture-demo.mjs
```

Outputs (committed under `docs/assets/`):

| Artifact | Path |
|---|---|
| Static strip | `docs/assets/tabhandoff-demo-strip.png` |
| Animated GIF | `docs/assets/tabhandoff-demo.gif` |
| Raw page screenshots | `docs/assets/tabhandoff-demo-screenshot.png` (+ `-result`) |
| Per-step frames + manifest | `docs/assets/demo-frames/` |

`TABHANDOFF_DEMO_CAPTURE` makes the Electron desktop write a **real** My Activity PNG, then quit. Labels on the strip say `mode: dom` / `agentLaunched: false` when no API key is set.

Cloud VMs without a display use `xvfb-run` automatically.

## Browser extension E2E (Chrome / Edge / Brave)

Chromium extension capture is awkward on headless cloud VMs. On a normal desktop:

1. `pnpm build && pnpm bridge` (or `pnpm desktop`)
2. Load unpacked `packages/extension` — [extension-setup.md](./extension-setup.md)
3. Open `https://example.com`
4. Right-click → **Hand off with TabHandoff** (or toolbar button)
5. Enter: `Extract the main heading and first paragraph as markdown`
6. Leave **page extraction** checked → **Hand off**
7. Watch honest popup status → desktop **My Activity**

Record with QuickTime / OBS / `gifski` if you want an extension-specific GIF. Keep labels honest (package-only vs page extraction vs model-assisted).

## Package-only path (no Playwright)

```bash
tabhandoff create --url https://example.com --instruction "Summarize and list next steps"
tabhandoff validate <id>
tabhandoff export <id> --out ./exports --archive
```

Never claim an agent ran when only a package was created.

## Honest mode table

| Mode | When | Say |
|---|---|---|
| Package only | Bridge off / unchecked run / create CLI | “Package created — no agent was launched” |
| Page extraction (`dom`) | No API key | “Page extraction (deterministic DOM — not autonomous AI)” |
| Model-assisted (`llm`) | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | “Model-assisted isolated browser” |

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md).

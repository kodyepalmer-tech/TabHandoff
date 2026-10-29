# Phase 5 — Viral demo & release polish

Make the main workflow demoable, ship a **real** GIF/strip, and tighten onboarding.

## Shipped

1. **Reliability** — await async `onAction` in the runner; serialize job updates in MCP store (fixes `Unknown handoff id` races on fast failure paths). Honest `package_created` job status + desktop “Package only” label.
2. **Demo scripts** — `pnpm demo` (`scripts/demo.sh`) and `pnpm demo:capture` (`scripts/capture-demo.mjs` + `TABHANDOFF_DEMO_CAPTURE` Electron frame).
3. **Artifacts** — `docs/assets/tabhandoff-demo.gif`, `tabhandoff-demo-strip.png`, `demo-frames/`.
4. **Docs** — README (everyday users + agents), [demo.md](./demo.md), [troubleshooting.md](./troubleshooting.md).

## Honest demo claim

The GIF shows **page extraction** (DOM, no API key) and a real Electron **My Activity** screenshot. Extension right-click is documented for local Chrome; not claimed in the cloud-captured GIF.

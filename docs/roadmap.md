# TabHandoff roadmap — capture sources

**Positioning:** TabHandoff is a universal, portable handoff layer for work across applications, files, websites, and AI agents. The browser is **one capture source**, not the product boundary.

**Tagline:** Hand off any work. Pick up anywhere.  
**Core promise:** See what your AI did. Keep the evidence. Pass the work on.

**Honesty:** Do not claim universal application support until it is implemented. This document is product direction — phases B–D need explicit approval before architecture work.

---

## Required product surface

| Source | Role today | Near-term |
|---|---|---|
| Browser pages & web apps | **Shipped** (extension + Playwright extract) | Keep; do not market as the only path |
| Local files (Word, PDF, sheets, source, Finder/Explorer) | **Not shipped** | Smallest next capture wedge after release |
| Desktop apps / multi-app workflows | **Not shipped** | Permissioned screenshots + explicit file/app selection first |
| AI agents (discover / consume / continue / return) | **Partial** (schema, CLI, MCP) | Keep improving; portable format already positioned |

---

## What is already implemented

- Chromium extension capture (URL, selection, screenshot)
- Local bridge + Electron evidence library
- Portable `handoff.json` + Markdown receipt
- Agent CLI: create / validate / read / export / continue / progress / attach / mark
- Website + release packaging (merge/release on founder schedule — separate from this messaging track)

**Not implemented:** Finder/Explorer file drop, OS file-association handoff, desktop accessibility automation, cross-app session cloning. Windows/macOS installer OS testing waits on a tagged release.

---

## Phases

### Phase A — Messaging only (safe; no architecture)

1. Product brief / strategy / README / website: universal work handoff; browser as one source.
2. Honest “What’s supported today / Coming next” copy.
3. Keep download/release work on its own PR; messaging does not change release CI.

### Phase B — Local file handoffs (needs approval)

**MVP:** User picks files in the desktop app (or drops onto Hand off) → package includes file metadata + optional content excerpt/hash + user instruction → same portable schema with a new `sources[]` entry type `file`.

| OS | Constraints |
|---|---|
| **macOS** | Sandboxed Electron needs user file picker / drag-drop; Full Disk Access not required for picker-selected files. |
| **Windows** | Open dialog / drag-drop; no silent Explorer hooking in v1. |
| **Linux** | File dialog / drag-drop; document AppImage unrestricted path first. |

**Out of v1 file MVP:** Watching folders, reading arbitrary paths without picker, heavy Office binary parsing, remote file upload.

### Phase C — Desktop capture (after B; needs approval)

**MVP:** Explicit “Attach screenshot” + optional window title (OS APIs where permitted) + user-typed app context — **not** silent screen recording or accessibility-driven control of arbitrary apps.

| OS | Constraints |
|---|---|
| **macOS** | Screen Recording permission (TCC); no capture without prompt. |
| **Windows** | Display capture APIs; avoid claiming UI Automation control until deliberate. |
| **Linux** | Wayland vs X11 differ; portal-based screenshot where required. |

### Phase D — Deeper desktop / multi-app (later)

Supported integrations only (explicit allowlists), never “control my whole desktop” by default. Preserve confirmation for consequential actions.

---

## Schema direction (when Phase B approved)

Extend the portable package with versioned `sources` (non-breaking):

- `type: "browser" | "file" | "screenshot" | "note"` …
- Existing browser fields remain valid
- Agents that only understand browser sources ignore unknown types safely (document forward-compat)

Preserve: stable IDs, append-only evidence, verified vs `agent_reported`.

---

## Privacy defaults

Capture stays local by default. Explicit user permission for each sensitive source. No mandatory cloud upload for core functionality. Cookies/credentials are not transferred by default.

---

## Related docs

- [schema.md](./schema.md) — current portable format
- [agents.md](./agents.md) — agent adoption path
- [install.md](./install.md) · [releasing.md](./releasing.md) — distribution (unchanged by this roadmap)

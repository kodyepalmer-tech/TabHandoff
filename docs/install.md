# Install TabHandoff

Public pages: [website/install.html](../website/install.html) · [website/download.html](../website/download.html) · [website/privacy.html](../website/privacy.html) · [website/support.html](../website/support.html)

**Product order:** desktop + local AI → browser task → real result → saved history. **ZIP is optional.** Load unpacked until Chrome Web Store. Do not invent live CWS or installer URLs.

## Desktop + local AI (primary, from source today)

```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
pnpm desktop          # evidence library + local bridge + history
```

Optional free local model: install [Ollama](https://ollama.com/), pull a model, keep it running. Paste the bridge token into the extension Settings.

CLI quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
```

## Desktop installers (GitHub Releases — when tagged)

Tagged releases publish platform artifacts via `.github/workflows/release-desktop.yml`:

| Platform | Artifact | Arch |
|---|---|---|
| macOS | `.dmg` | arm64 + x64 |
| Windows | NSIS `.exe` | x64 |
| Linux | `.AppImage` + `.deb` | x64 |

Checksums: `SHA256SUMS` on the same release. **If an OS/arch is missing, do not invent a link.**

Early builds are **unsigned** (Gatekeeper / SmartScreen). Signing is founder-only later — see [releasing.md](./releasing.md).

### Verify

```bash
sha256sum -c SHA256SUMS --ignore-missing
# macOS: shasum -a 256 -c SHA256SUMS
```

## Browser extension (Load unpacked until CWS)

**Chrome Web Store is not live.**

1. `pnpm install && pnpm build` (or use a packed `pnpm pack:extension` ZIP)
2. Load unpacked `packages/extension` in Chromium
3. Paste desktop/bridge token for Run with AI / history
4. Optional: also download a ZIP for sharing

Details: [extension-setup.md](./extension-setup.md) · Privacy: [privacy.md](./privacy.md)

## Optional ZIP-only

Save package / Download ZIP works without desktop. Status says package created — not agent executed.

## Page extraction (Playwright)

Packaged desktop includes the library + bridge. Playwright Chromium is optional for isolated page extraction:

```bash
pnpm --filter @tabhandoff/cli exec playwright install chromium
```

## Data & uninstall

- Store: `~/.tabhandoff/` (Windows: `%USERPROFILE%\.tabhandoff\`)
- Override: `TABHANDOFF_HOME`
- Uninstalling the desktop app does **not** delete local receipts by default

More: [troubleshooting.md](./troubleshooting.md) · [releasing.md](./releasing.md)

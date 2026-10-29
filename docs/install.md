# Install TabHandoff

Public pages: [website/install.html](../website/install.html) · [website/download.html](../website/download.html) · [website/privacy.html](../website/privacy.html) · [website/support.html](../website/support.html)

## Desktop installers (GitHub Releases)

Tagged releases publish platform artifacts built by `.github/workflows/release-desktop.yml`:

| Platform | Artifact | Arch |
|---|---|---|
| macOS | `.dmg` | arm64 + x64 |
| Windows | NSIS `.exe` | x64 |
| Linux | `.AppImage` + `.deb` | x64 |

Checksums: `SHA256SUMS` attached to the same release.

**If an OS/arch is missing from a release, do not invent a link.** Use the source path below or wait for CI.

### Verify

```bash
sha256sum -c SHA256SUMS --ignore-missing
# macOS: shasum -a 256 -c SHA256SUMS
```

## From source (current path on every OS)

```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
pnpm desktop          # evidence library + local bridge
```

CLI quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
```

## OS security warnings (unsigned early builds)

| OS | What you’ll see | What to do |
|---|---|---|
| macOS | Gatekeeper / unidentified developer | System Settings → Privacy & Security → Open Anyway, or right-click → Open |
| Windows | SmartScreen | More info → Run anyway **only** for assets from the official GitHub Release |
| Linux | Executable bit / FUSE for AppImage | `chmod +x …AppImage`; install `libfuse2` or use `.deb` |

Code signing and Apple notarization are **not** configured yet. See [releasing.md](./releasing.md).

## Browser extension (start here)

**Chrome Web Store is not live.** Use Load unpacked:

1. `pnpm install && pnpm build`
2. Load unpacked `packages/extension` in Chromium
3. Hand off a page → **Download package** / **Copy summary** if the bridge is off
4. Optional: `pnpm desktop` or `pnpm bridge`, then paste the token for My Activity / extraction

Details: [extension-setup.md](./extension-setup.md) · Privacy: [privacy.md](./privacy.md)

## Page extraction

Packaged desktop includes the library + bridge. Playwright Chromium is optional for isolated page extraction:

```bash
pnpm --filter @tabhandoff/cli exec playwright install chromium
```

Without browsers, handoffs stay package-only — status never fakes execution.

## Data & uninstall

- Store: `~/.tabhandoff/` (Windows: `%USERPROFILE%\.tabhandoff\`)
- Override: `TABHANDOFF_HOME`
- Uninstalling the desktop app does **not** delete local receipts by default

More troubleshooting: [troubleshooting.md](./troubleshooting.md)

# Install TabHandoff

Public site: [github.io/TabHandoff](https://kodyepalmer-tech.github.io/TabHandoff/) · [install](../website/install.html) · [download](../website/download.html) · [privacy](../website/privacy.html) · [support](../website/support.html)

**Product path today:** coding-agent handoffs — browser capture → portable package → CLI/MCP continue & verify. Desktop/bridge optional. No CWS / signed installers until published. File/desktop capture = roadmap.

## From source (coding-agent path)

```bash
git clone https://github.com/kodyepalmer-tech/TabHandoff.git
cd TabHandoff
pnpm install && pnpm build
```

Browser capture: [extension-setup.md](./extension-setup.md) · verified continue: [verified-handoff.md](./verified-handoff.md).

```bash
curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
```

Optional supporting tools: `pnpm desktop` / `pnpm bridge` for loopback.

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
3. Hand off → **Save package** (portable ZIP)
4. Optional: paste desktop/bridge token only for loopback / Run with AI

Details: [extension-setup.md](./extension-setup.md) · Privacy: [privacy.md](./privacy.md)

## Optional ZIP-only / loopback

Save package works without desktop. Status says package created — not agent executed. Bridge/desktop are optional infrastructure.

## Page extraction (Playwright)

```bash
pnpm --filter @tabhandoff/cli exec playwright install chromium
```

## Data & uninstall

- Store: `~/.tabhandoff/` (Windows: `%USERPROFILE%\.tabhandoff\`)
- Override: `TABHANDOFF_HOME`
- Uninstalling the desktop app does **not** delete local receipts by default

More: [troubleshooting.md](./troubleshooting.md) · [releasing.md](./releasing.md)

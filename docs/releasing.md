# Publishing a TabHandoff desktop release

## What CI builds

Workflow: [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml)

On push of a version tag `v*` (and via `workflow_dispatch`):

| Runner | Artifacts |
|---|---|
| `macos-latest` | `TabHandoff-<ver>-mac-arm64.dmg`, `TabHandoff-<ver>-mac-x64.dmg` |
| `windows-latest` | `TabHandoff-<ver>-win-x64.exe` |
| `ubuntu-latest` | `TabHandoff-<ver>-linux-x64.AppImage`, `TabHandoff-<ver>-linux-amd64.deb` |

Also uploads `SHA256SUMS` and attaches everything to the GitHub Release for that tag.

Local Linux build (this is what maintainers can smoke-test without macOS/Windows):

```bash
pnpm install && pnpm build
pnpm --filter @tabhandoff/desktop dist:linux
pnpm --filter @tabhandoff/desktop checksums
# artifacts under packages/desktop/release/
```

## Version publish checklist

1. **Bump version** in root `package.json` and `packages/desktop/package.json` (keep them equal for installer naming).
2. Merge to `main`.
3. **Tag and push:**
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. Wait for **Release desktop** workflow (all three OS jobs).
5. Open https://github.com/kodyepalmer-tech/TabHandoff/releases and confirm assets + `SHA256SUMS`.
6. Open the website **Download** page — it reads `/releases/latest` and only enables buttons for assets that exist.
7. Spot-check one installer per OS you can access; note Gatekeeper/SmartScreen (unsigned until secrets are added).

## Website publish (GitHub Pages → tabhandoff.com)

**Production hostname:** `https://tabhandoff.com` (Porkbun).  
**Host:** GitHub Pages (simplest for this repo — static `website/` + Actions workflow).  
`website/CNAME` already contains `tabhandoff.com`.

1. Merge to `main` so [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) can deploy `website/`.
2. Repo **Settings → Pages → Build and deployment** → Source: **GitHub Actions**.
3. Repo **Settings → Pages → Custom domain** → enter `tabhandoff.com` → Save (enforce HTTPS after DNS propagates).
4. In **Porkbun**, add the DNS records from the founder checklist below — **do not** change DNS from CI/agents; founder-only.
5. Apex + `www` should both resolve; GitHub Pages will serve the site once DNS + custom domain are set.

Interim URL before custom domain: `https://kodyepalmer-tech.github.io/TabHandoff/`

Local preview:

```bash
pnpm website
# → http://127.0.0.1:4173/
# Canonical production host: https://tabhandoff.com
```

### Porkbun DNS (founder — after site + installers work)

Exact records for GitHub Pages custom domain (TTL 600 is fine; Porkbun may show “DNS only”):

| Type | Host / Name | Answer / Value | TTL |
|---|---|---|---|
| `A` | `@` (apex) | `185.199.108.153` | 600 |
| `A` | `@` | `185.199.109.153` | 600 |
| `A` | `@` | `185.199.110.153` | 600 |
| `A` | `@` | `185.199.111.153` | 600 |
| `AAAA` | `@` | `2606:50c0:8000::153` | 600 |
| `AAAA` | `@` | `2606:50c0:8001::153` | 600 |
| `AAAA` | `@` | `2606:50c0:8002::153` | 600 |
| `AAAA` | `@` | `2606:50c0:8003::153` | 600 |
| `CNAME` | `www` | `kodyepalmer-tech.github.io` | 600 |

Notes:
- Remove conflicting Porkbun parking / URL-forward records on `@` / `www` first.
- After DNS propagates, enable **Enforce HTTPS** in GitHub Pages settings.
- Confirm in a browser: `https://tabhandoff.com` and `https://www.tabhandoff.com` (www follows the CNAME to Pages; apex uses A/AAAA).
- IPv4/IPv6 addresses are GitHub Pages published endpoints — re-check [GitHub Pages custom domain docs](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site) if GitHub rotates them.

## Signing / notarization (later)

Not required to ship unsigned OSS builds, but removes scary OS prompts:

| Platform | Secrets / setup |
|---|---|
| macOS | Apple Developer ID certificate + notarization (`CSC_LINK`, `CSC_KEY_PASSWORD`, Apple ID / `APPLE_API_KEY`) |
| Windows | Authenticode cert for electron-builder (`CSC_LINK` / Azure Trusted Signing) |
| Linux | Optional GPG for repo metadata; AppImage/deb work unsigned |

Until then, document Gatekeeper/SmartScreen on the install page (already done).

## Artifact naming

Configured in `packages/desktop/electron-builder.yml`:

- `TabHandoff-${version}-${os}-${arch}.${ext}`
- macOS dmg: `TabHandoff-${version}-mac-${arch}.dmg`

Keep names stable so the download page classifier continues to match.

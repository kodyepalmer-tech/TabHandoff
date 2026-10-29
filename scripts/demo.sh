#!/usr/bin/env bash
# Reproducible TabHandoff demo — real package → page extraction → local evidence.
# Honest labels: DOM path is page extraction, not autonomous AI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEMO_HOME="${TABHANDOFF_HOME:-$(mktemp -d /tmp/tabhandoff-demo.XXXXXX)}"
export TABHANDOFF_HOME="$DEMO_HOME"

CLI=(node "$ROOT/packages/cli/dist/index.js")
URL="${TABHANDOFF_DEMO_URL:-https://example.com}"
INSTRUCTION="${TABHANDOFF_DEMO_INSTRUCTION:-Extract the main heading and first paragraph as markdown}"

echo "🕊️ TabHandoff demo"
echo "   Home: $DEMO_HOME"
echo "   URL:  $URL"
echo ""

if [[ ! -f "$ROOT/packages/cli/dist/index.js" ]]; then
  echo "→ Building…"
  pnpm build
fi

echo "→ doctor"
if ! "${CLI[@]}" doctor; then
  echo ""
  echo "If Playwright Chromium is missing:"
  echo "  pnpm --filter @tabhandoff/cli exec playwright install chromium"
  exit 1
fi

echo ""
echo "→ 1/3 Package only (no agent launched)"
PKG_OUT="$("${CLI[@]}" create --url "$URL" --instruction "$INSTRUCTION" --title "Demo page")"
echo "$PKG_OUT"
PKG_ID="$(printf '%s\n' "$PKG_OUT" | node -e "
  let s=''; process.stdin.on('data', d => s += d);
  process.stdin.on('end', () => {
    const i = s.indexOf('{'); const j = s.lastIndexOf('}');
    const o = JSON.parse(s.slice(i, j + 1));
    if (!o.id) process.exit(1);
    process.stdout.write(o.id);
  });
")"
"${CLI[@]}" validate "$PKG_ID" >/dev/null
echo "   validated package $PKG_ID"

echo ""
echo "→ 2/3 Page extraction (isolated Chromium — not autonomous AI)"
RUN_OUT="$("${CLI[@]}" run --url "$URL" --instruction "$INSTRUCTION" --wait)"
echo "$RUN_OUT"
RUN_ID="$(printf '%s\n' "$RUN_OUT" | node -e "
  let s=''; process.stdin.on('data', d => s += d);
  process.stdin.on('end', () => {
    const i = s.indexOf('{'); const j = s.lastIndexOf('}');
    const o = JSON.parse(s.slice(i, j + 1));
    if (o.status !== 'succeeded') {
      console.error('run failed:', JSON.stringify(o, null, 2));
      process.exit(1);
    }
    process.stdout.write(o.id);
  });
")"

echo ""
echo "→ 3/3 Evidence (local receipt + screenshots)"
"${CLI[@]}" receipt "$RUN_ID" | head -n 40
RECEIPT_DIR="$DEMO_HOME/receipts/$RUN_ID"
echo ""
echo "Proof folder (local — not uploaded):"
echo "  $RECEIPT_DIR"
ls -la "$RECEIPT_DIR" || true
ls -la "$RECEIPT_DIR/screenshots" 2>/dev/null || true

echo ""
echo "✅ Demo complete"
echo "   Package-only id: $PKG_ID"
echo "   Extraction id:   $RUN_ID"
echo "   Open desktop:    TABHANDOFF_HOME=\"$DEMO_HOME\" pnpm desktop"
echo "   Capture frames:  TABHANDOFF_HOME=\"$DEMO_HOME\" node scripts/capture-demo.mjs"
echo ""
echo "Extension E2E (Chrome): see docs/demo.md"

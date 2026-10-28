#!/usr/bin/env bash
# TabHandoff one-command install — clone (if needed) → build → Chromium → init
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
# Or from a clone:
#   ./scripts/install.sh
set -euo pipefail

REPO_URL="${TABHANDOFF_REPO_URL:-https://github.com/kodyepalmer-tech/TabHandoff.git}"
INSTALL_DIR="${TABHANDOFF_DIR:-$HOME/tabhandoff}"
NODE_MAJOR_MIN=22

echo "🕊️  TabHandoff — Your AI was here. Now the next one can pick up."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js ${NODE_MAJOR_MIN}+ required. Install from https://nodejs.org and re-run." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt "$NODE_MAJOR_MIN" ]; then
  echo "❌ Node.js ${NODE_MAJOR_MIN}+ required (found v$(node -v))." >&2
  exit 1
fi

# Prefer an existing checkout if we're already inside one
ROOT=""
if [ -f "package.json" ] && [ -f "pnpm-workspace.yaml" ] && grep -q '"name": "tabhandoff"' package.json 2>/dev/null; then
  ROOT="$(pwd)"
  echo "→ Using current checkout: $ROOT"
elif [ -f "$INSTALL_DIR/package.json" ] && [ -f "$INSTALL_DIR/pnpm-workspace.yaml" ]; then
  ROOT="$INSTALL_DIR"
  echo "→ Using existing install: $ROOT"
  cd "$ROOT"
  if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    git pull --ff-only || true
  fi
else
  if ! command -v git >/dev/null 2>&1; then
    echo "❌ git is required to clone TabHandoff." >&2
    exit 1
  fi
  echo "→ Cloning into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  ROOT="$INSTALL_DIR"
  cd "$ROOT"
fi

cd "$ROOT"

if command -v pnpm >/dev/null 2>&1; then
  PNPM=pnpm
elif command -v corepack >/dev/null 2>&1; then
  echo "→ Enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.33.4 --activate
  PNPM=pnpm
else
  echo "❌ pnpm not found and corepack unavailable. Install pnpm: https://pnpm.io/installation" >&2
  exit 1
fi

echo "→ pnpm install"
"$PNPM" install --frozen-lockfile

echo "→ pnpm build"
"$PNPM" build

echo "→ Playwright Chromium"
"$PNPM" --filter @tabhandoff/cli exec playwright install chromium

echo "→ tabhandoff init"
node packages/cli/dist/index.js init

echo ""
echo "✅ TabHandoff ready at: $ROOT"
echo ""
echo "Try a handoff:"
echo "  cd $ROOT"
echo "  node packages/cli/dist/index.js doctor"
echo "  node packages/cli/dist/index.js run \\"
echo "    --url https://example.com \\"
echo "    --instruction \"Extract the main heading and first paragraph as markdown\" \\"
echo "    --wait"
echo ""
echo "Optional alias:"
echo "  alias tabhandoff='node $ROOT/packages/cli/dist/index.js'"
echo ""
echo "Repo: https://github.com/kodyepalmer-tech/TabHandoff"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 20+ 才能运行引导脚本。"
  exit 1
fi

cd "$ROOT_DIR"
node "$ROOT_DIR/scripts/start-guided.mjs" "$@"

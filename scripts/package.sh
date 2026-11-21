#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/../AgentHub.zip}"
cd "$(dirname "$ROOT")"
zip -qr "$OUT" "$(basename "$ROOT")" \
  -x '*/node_modules/*' '*/dist/*' '*/target/*' '*/.git/*' \
     '*/.DS_Store' '*/Thumbs.db' '*/.env' '*/npm-debug.log*'
echo "Created $OUT"

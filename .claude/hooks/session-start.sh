#!/bin/bash
# クラウドのセッション（Claude Code on the web）の開始時に、アプリの依存関係を入れる。
# 依存を決めるファイル（このスクリプト・package.json・package-lock.json）が前回の成功時から
# 変わっていなければ何もしない。ローカルのセッションでは何もしない。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="$(cd "${CLAUDE_PROJECT_DIR:-.}" && pwd)"
cd "$ROOT"

# 前回の成功時のハッシュは node_modules の中に置く（node_modules ごと消えれば入れ直す。git には入らない）
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # 失敗したときに次回やり直すよう、先に古いハッシュを消す
  rm -f "$hashes"
  # npm install はコンテナのキャッシュを生かせる。package-lock.json に従って入れ、監査と案内の表示は省く
  npm install --no-audit --no-fund
  sha256sum "$ROOT/.claude/hooks/session-start.sh" package.json package-lock.json > "$hashes" || rm -f "$hashes"
fi

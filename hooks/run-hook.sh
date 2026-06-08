#!/bin/sh
# Loom hook runtime wrapper. Resolves bun → npx tsx → fail-open, in that order.
#
# Why this exists: the actual hook implementations are .ts files. They need a
# runtime to execute. bun is fastest (~50ms cold start) and is the recommended
# install per README, but it's not always present (e.g. fresh dev machines,
# CI runners, users who prefer node). This wrapper lets a single settings.json
# hook command work on any machine that has either bun or node.
#
# Usage in settings.json:
#   "command": "sh \"$CLAUDE_PROJECT_DIR/hooks/run-hook.sh\" \"$CLAUDE_PROJECT_DIR/hooks/contract-lock.ts\""
#
# Override the auto-detected runtime by exporting LOOM_HOOK_RUNTIME in your
# shell rc. Common values: "bun", "node --import tsx/esm", "npx --yes tsx".
# Useful when a user has both bun and node and wants to pin one for
# reproducibility, or wants to skip the per-invocation `command -v` lookup.
#
# Fail-open by design: if neither bun nor node is available, this exits 0
# with a stderr warning. Loom hooks never block tool calls on infrastructure
# absence — they only block on contract violations.

set -u

if [ "$#" -lt 1 ]; then
  echo "[loom:run-hook] usage: run-hook.sh <path-to-hook.ts> [args...]" >&2
  exit 0
fi

# Honor explicit runtime override first. Word-split intentionally so users can
# set e.g. LOOM_HOOK_RUNTIME="npx --yes tsx" with arguments.
if [ -n "${LOOM_HOOK_RUNTIME:-}" ]; then
  # shellcheck disable=SC2086
  exec $LOOM_HOOK_RUNTIME "$@"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx --yes tsx "$@"
fi

if command -v node >/dev/null 2>&1; then
  echo "[loom:run-hook] npx not found; node present but cannot resolve tsx. Install bun or npm." >&2
  exit 0
fi

echo "[loom:run-hook] Neither bun nor node found in PATH — skipping hook $1" >&2
exit 0

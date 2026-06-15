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

# Claude Code subprocesses sometimes inherit a minimal PATH that omits Homebrew's
# bin directories — notably when Claude Code is launched from a GUI shortcut,
# Finder, cmux, or any non-login-shell context. bun lives at /opt/homebrew/bin
# on Apple Silicon and /usr/local/bin on Intel; without these, the bun probe
# below misses and falls through to npx tsx, which on Node 25+ has stricter ESM
# resolution that fails to load the tsx loader for hooks' relative .js imports.
# The result is `node:internal/modules/esm/resolve:N` errors that the exit-0
# safety net below cannot catch (resolution failure happens before TypeScript
# loads). Silently disables every PreToolUse contract enforcer.
#
# APPEND (not prepend) so a user's deliberately-pinned runtime (mise/asdf/volta
# /nvm/~/.bun/bin/...) wins over the system Homebrew copy. Only add a candidate
# if its directory actually exists — keeps Linux/Nix/containers a clean no-op
# without naming a platform.
for candidate in /opt/homebrew/bin /usr/local/bin; do
  [ -d "$candidate" ] || continue
  case ":$PATH:" in
    *":$candidate:"*) ;;
    *) PATH="$PATH:$candidate" ;;
  esac
done
export PATH

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

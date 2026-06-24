#!/usr/bin/env bash
# test-install-sandbox.sh — run install.sh in an isolated HOME and verify it.
#
# Usage:
#   scripts/test-install-sandbox.sh              # install from GitHub main
#   scripts/test-install-sandbox.sh --local      # install from this checkout (file://)
#   KEEP=1 scripts/test-install-sandbox.sh       # leave sandbox in place for inspection

set -euo pipefail

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

SANDBOX=$(mktemp -d -t loom-sandbox)
echo "sandbox: $SANDBOX"

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1 set — leaving sandbox at $SANDBOX"
  else
    rm -rf "$SANDBOX"
    echo "removed sandbox"
  fi
}
trap cleanup EXIT

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [ "$LOCAL" = "1" ]; then
  echo "installing from local checkout: $REPO_ROOT"
  # Rewrite BASE to point at the local repo so curl pulls files via file://
  sed "s|BASE=\"https://raw.githubusercontent.com/\${REPO}/\${BRANCH}\"|BASE=\"file://${REPO_ROOT}\"|" \
    "$REPO_ROOT/install.sh" > "$SANDBOX/install-local.sh"
  HOME="$SANDBOX" bash "$SANDBOX/install-local.sh"
else
  echo "installing from GitHub (main)"
  HOME="$SANDBOX" bash "$REPO_ROOT/install.sh"
fi

echo ""
echo "verifying layout"

FAIL=0
assert_file() {
  if [ -f "$1" ]; then
    echo "  OK   $1"
  else
    echo "  FAIL missing: $1"
    FAIL=1
  fi
}

assert_file "$SANDBOX/.claude/run-hook.sh"
assert_file "$SANDBOX/.claude/statusline-renderer.cjs"
assert_file "$SANDBOX/.claude/statusline-command.sh"
assert_file "$SANDBOX/.claude/commands/loom.md"
assert_file "$SANDBOX/.claude/commands/loom-library.md"
assert_file "$SANDBOX/.claude/commands/loom-skill.md"

echo ""
echo "run-hook.sh sanity check (sh -n)"
if sh -n "$SANDBOX/.claude/run-hook.sh"; then
  echo "  OK   run-hook.sh parses cleanly"
else
  echo "  FAIL run-hook.sh has syntax errors"
  FAIL=1
fi

echo ""
if [ "$FAIL" = "0" ]; then
  echo "install sandbox passed"
else
  echo "install sandbox failed"
  exit 1
fi

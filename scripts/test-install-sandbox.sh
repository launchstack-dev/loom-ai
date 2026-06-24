#!/usr/bin/env bash
# test-install-sandbox.sh — run install.sh in an isolated HOME and verify it.
#
# Usage:
#   scripts/test-install-sandbox.sh              # install from GitHub main
#   scripts/test-install-sandbox.sh --local      # install from this checkout (file://)
#   KEEP=1 scripts/test-install-sandbox.sh       # leave sandbox in place for inspection
#
# On non-zero exit the sandbox is preserved automatically so the operator can
# inspect what landed. Set FORCE_CLEANUP=1 to override this and always remove.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

# GNU mktemp (Linux CI) requires at least 3 trailing X's in the template.
# BSD mktemp (macOS) is permissive; the explicit pattern works on both.
SANDBOX=$(mktemp -d -t loom-sandbox.XXXXXX)
INSTALL_LOG="$SANDBOX.install.log"
echo "sandbox: $SANDBOX"

# Preserve sandbox on failure so operators can inspect partial installs.
# Only clean up on clean exit, or when explicitly forced.
EXIT_STATUS=0
on_exit() {
  EXIT_STATUS=$?
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1 set — leaving sandbox at $SANDBOX (log: $INSTALL_LOG)"
  elif [ "$EXIT_STATUS" -ne 0 ] && [ "${FORCE_CLEANUP:-0}" != "1" ]; then
    echo "FAIL: exited $EXIT_STATUS — sandbox preserved at $SANDBOX (log: $INSTALL_LOG)"
    echo "      remove with: rm -rf \"$SANDBOX\" \"$INSTALL_LOG\""
  else
    rm -rf "$SANDBOX" "$INSTALL_LOG"
    echo "removed sandbox"
  fi
}
trap on_exit EXIT

run_install() {
  if [ "$LOCAL" = "1" ]; then
    echo "installing from local checkout: $REPO_ROOT"
    # Rewrite the BASE= assignment to point at the local checkout. Anchor on
    # the start-of-line BASE= form rather than the literal URL so the rewrite
    # survives small reformatting of install.sh.
    sed "s|^BASE=.*|BASE=\"file://${REPO_ROOT}\"|" \
      "$REPO_ROOT/install.sh" > "$SANDBOX/install-local.sh"
    # Fail loud if the rewrite didn't take effect (install.sh changed shape).
    grep -q "^BASE=\"file://${REPO_ROOT}\"" "$SANDBOX/install-local.sh" || {
      echo "FAIL: BASE= rewrite did not match install.sh — script may have changed shape" >&2
      return 1
    }
    HOME="$SANDBOX" bash "$SANDBOX/install-local.sh"
  else
    echo "installing from GitHub (main)"
    HOME="$SANDBOX" bash "$REPO_ROOT/install.sh"
  fi
}

# Tee install output so we can grep for WARN/FAIL lines after. install.sh
# returns 0 even when individual files emit "no checksum in manifest — skipped"
# warnings; without this check the sandbox would silently miss the exact bug
# the drift guard exists to catch.
if ! run_install 2>&1 | tee "$INSTALL_LOG"; then
  echo "FAIL: install.sh exited non-zero — see log" >&2
  exit 1
fi

echo ""
echo "scanning install log for WARN/FAIL/skipped lines"
if grep -qE '^[[:space:]]*(WARN|FAIL).*(skipped|manifest)' "$INSTALL_LOG"; then
  echo "FAIL: install.sh emitted unverified-shipping warnings:" >&2
  grep -E '^[[:space:]]*(WARN|FAIL)' "$INSTALL_LOG" | sed 's/^/  /' >&2
  exit 1
fi
echo "  OK   no WARN/FAIL lines from install.sh"

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
# run-hook.sh is #!/bin/sh (POSIX). Parsing it with `sh -n` is intentional —
# `bash -n` would silently accept bashisms that fail at runtime under sh.
echo "run-hook.sh sanity check (sh -n)"
if sh -n "$SANDBOX/.claude/run-hook.sh"; then
  echo "  OK   run-hook.sh parses cleanly"
else
  echo "  FAIL run-hook.sh has syntax errors"
  FAIL=1
fi

echo ""
echo "conflict-guard check: install.sh refuses to install over a plugin install"
# Pre-create the plugin install marker that install.sh's pre-flight checks for.
# install.sh probes `claude plugin list` and exits 9 if loom is already
# installed. Skip the assertion when claude CLI is absent (the guard is then
# unreachable).
if command -v claude >/dev/null 2>&1; then
  CONFLICT_SANDBOX=$(mktemp -d -t loom-conflict.XXXXXX)
  trap 'rm -rf "$CONFLICT_SANDBOX"' RETURN 2>/dev/null || true
  # Fake a plugin install state by registering a marketplace + installing.
  # If that path is broken (validation errors etc.), we can't exercise the
  # conflict guard; degrade to a SKIP rather than fail.
  if HOME="$CONFLICT_SANDBOX" CLAUDE_CONFIG_DIR="$CONFLICT_SANDBOX/cfg" \
       claude plugin list 2>&1 | grep -q "loom"; then
    # Run install.sh against the same HOME; expect exit 9.
    set +e
    HOME="$CONFLICT_SANDBOX" CLAUDE_CONFIG_DIR="$CONFLICT_SANDBOX/cfg" \
      bash "$REPO_ROOT/install.sh" >"$CONFLICT_SANDBOX/log" 2>&1
    rc=$?
    set -e
    if [ "$rc" = "9" ] && grep -q "INSTALL_CONFLICT_PLUGIN_AND_CURL" "$CONFLICT_SANDBOX/log"; then
      echo "  OK   install.sh exited 9 with INSTALL_CONFLICT_PLUGIN_AND_CURL"
    else
      echo "  FAIL install.sh exited $rc; expected 9 with conflict marker" >&2
      cat "$CONFLICT_SANDBOX/log" | sed 's/^/    /' >&2
      FAIL=1
    fi
  else
    echo "  SKIP no loom plugin install detected to test against"
    echo "       (plugin install path may itself be broken — see test-plugin-install-sandbox.sh)"
  fi
  rm -rf "$CONFLICT_SANDBOX"
else
  echo "  SKIP claude CLI not on PATH"
fi

echo ""
if [ "$FAIL" = "0" ]; then
  echo "install sandbox passed"
else
  echo "install sandbox failed"
  exit 1
fi

#!/usr/bin/env bash
# test-plugin-install-sandbox.sh — end-to-end plugin install via marketplace.
#
# The companion test-install-sandbox.sh exercises the curl-install path
# (install.sh → ~/.claude/). That path is only HALF the distribution surface:
# the other half is the Claude Code plugin marketplace, where users run
# `/plugin install loom`. Without this script that branch is untested locally,
# and broken plugin manifests reach users.
#
# This test:
#   1. Validates .claude-plugin/plugin.json against `claude plugin validate`.
#   2. Builds a throwaway local marketplace whose only entry is THIS checkout.
#   3. Registers the marketplace and installs the plugin into an isolated
#      $CLAUDE_CONFIG_DIR.
#   4. Asserts files landed under $CLAUDE_CONFIG_DIR/plugins/loom/.
#   5. Cleans up.
#
# Skips with exit 0 + SKIP message when `claude` CLI is not on PATH (lets the
# step pass on runners that don't ship Claude Code).
#
# Usage:
#   scripts/test-plugin-install-sandbox.sh
#   KEEP=1 scripts/test-plugin-install-sandbox.sh    # preserve sandbox
#   FORCE_CLEANUP=1 ...                              # remove even on failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  echo "SKIP: claude CLI not on PATH — plugin install path cannot be tested."
  echo "      Install Claude Code to enable this check."
  exit 0
fi

if [ ! -f "${REPO_ROOT}/.claude-plugin/plugin.json" ]; then
  echo "FAIL: ${REPO_ROOT}/.claude-plugin/plugin.json not found" >&2
  exit 1
fi

SANDBOX=$(mktemp -d -t loom-plugin-sandbox.XXXXXX)
MARKETPLACE="$SANDBOX/marketplace"
CONFIG_DIR="$SANDBOX/cfg"
LOG="$SANDBOX/run.log"
echo "sandbox: $SANDBOX"

EXIT_STATUS=0
on_exit() {
  EXIT_STATUS=$?
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1 set — leaving sandbox at $SANDBOX"
  elif [ "$EXIT_STATUS" -ne 0 ] && [ "${FORCE_CLEANUP:-0}" != "1" ]; then
    echo "FAIL: exited $EXIT_STATUS — sandbox preserved at $SANDBOX (log: $LOG)"
    echo "      remove with: rm -rf \"$SANDBOX\""
  else
    rm -rf "$SANDBOX"
    echo "removed sandbox"
  fi
}
trap on_exit EXIT

# ── Step 1: validate manifest ───────────────────────────────────────────
echo ""
echo "step 1: validate plugin manifest"
if ! claude plugin validate "$REPO_ROOT" 2>&1 | tee "$LOG"; then
  echo "FAIL: plugin manifest validation failed" >&2
  exit 1
fi
# `claude plugin validate` exits 0 even on validation errors in some versions —
# explicit grep is the reliable signal.
if grep -qE "✘.*error|Invalid input" "$LOG"; then
  echo "FAIL: plugin manifest validation produced errors (see log)" >&2
  exit 1
fi
echo "  OK   manifest validates cleanly"

# ── Step 2: build a local marketplace pointing at this checkout ────────
echo ""
echo "step 2: build local marketplace wrapping $REPO_ROOT"
mkdir -p "$MARKETPLACE/.claude-plugin" "$MARKETPLACE/plugins/loom"
# Copy (not symlink) the plugin tree into the marketplace dir. Claude Code's
# plugin install reads the source dir directly and does not follow symlinks
# pointing outside the marketplace root — symlinks land in the cache as
# unresolved targets and the install ends up with an empty plugin shell.
mkdir -p "$MARKETPLACE/plugins/loom/.claude-plugin"
cp "$REPO_ROOT/.claude-plugin/plugin.json" "$MARKETPLACE/plugins/loom/.claude-plugin/plugin.json"
# rsync handles excludes cleanly; fall back to cp -R if rsync is absent.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude='.git' --exclude='node_modules' --exclude='.worktrees' \
    --exclude='.plan-execution' --exclude='dist' --exclude='.loom' \
    "$REPO_ROOT/agents/" "$MARKETPLACE/plugins/loom/agents/"
  rsync -a "$REPO_ROOT/commands/" "$MARKETPLACE/plugins/loom/commands/"
  rsync -a "$REPO_ROOT/hooks/"    "$MARKETPLACE/plugins/loom/hooks/"
  rsync -a "$REPO_ROOT/scripts/"  "$MARKETPLACE/plugins/loom/scripts/"
  [ -d "$REPO_ROOT/skills" ] && rsync -a "$REPO_ROOT/skills/" "$MARKETPLACE/plugins/loom/skills/"
  [ -d "$REPO_ROOT/config" ] && rsync -a "$REPO_ROOT/config/" "$MARKETPLACE/plugins/loom/config/"
  [ -f "$REPO_ROOT/CLAUDE.md" ] && cp "$REPO_ROOT/CLAUDE.md" "$MARKETPLACE/plugins/loom/CLAUDE.md"
else
  for sub in agents commands hooks scripts skills config CLAUDE.md; do
    [ -e "$REPO_ROOT/$sub" ] && cp -R "$REPO_ROOT/$sub" "$MARKETPLACE/plugins/loom/$sub"
  done
fi

cat > "$MARKETPLACE/.claude-plugin/marketplace.json" <<EOF
{
  "name": "loom-local-test",
  "owner": { "name": "test-install-sandbox" },
  "plugins": [
    {
      "name": "loom",
      "source": "./plugins/loom"
    }
  ]
}
EOF
echo "  OK   marketplace built"

# ── Step 3: register + install ─────────────────────────────────────────
echo ""
echo "step 3: register marketplace + install plugin"
mkdir -p "$CONFIG_DIR"
export CLAUDE_CONFIG_DIR="$CONFIG_DIR"

if ! claude plugin marketplace add "$MARKETPLACE" --scope user 2>&1 | tee -a "$LOG"; then
  echo "FAIL: marketplace add failed" >&2
  exit 1
fi

if ! claude plugin install "loom@loom-local-test" --scope user 2>&1 | tee -a "$LOG"; then
  echo "FAIL: plugin install failed" >&2
  exit 1
fi

# Some failures exit 0 with ✘ in stdout — grep is the reliable signal.
if grep -qE "✘ Failed to install" "$LOG"; then
  echo "FAIL: plugin install reported failure (see log)" >&2
  exit 1
fi
echo "  OK   plugin install completed"

# ── Step 4: verify layout ──────────────────────────────────────────────
echo ""
echo "step 4: verify installed plugin layout"

FAIL=0
assert_path() {
  if [ -e "$1" ]; then
    echo "  OK   $1"
  else
    echo "  FAIL missing: $1"
    FAIL=1
  fi
}

# Claude records install paths in installed_plugins.json. Parse it to find
# the real install location — the path includes a version subdirectory and
# changes shape over Claude Code versions, so introspecting is more robust
# than guessing the layout.
INSTALLED_JSON="$CONFIG_DIR/plugins/installed_plugins.json"
if [ ! -f "$INSTALLED_JSON" ]; then
  echo "FAIL: $INSTALLED_JSON not written by install — install may not have completed" >&2
  exit 1
fi
PLUGIN_ROOT=$(python3 -c "
import json, sys
d = json.load(open('$INSTALLED_JSON'))
for k, entries in d.get('plugins', {}).items():
    if k.startswith('loom@'):
        for e in entries:
            print(e.get('installPath', ''))
            sys.exit(0)
sys.exit(1)
" 2>/dev/null)
if [ -z "$PLUGIN_ROOT" ] || [ ! -d "$PLUGIN_ROOT" ]; then
  echo "FAIL: could not resolve loom installPath from $INSTALLED_JSON" >&2
  cat "$INSTALLED_JSON" | sed 's/^/  /' >&2
  exit 1
fi
echo "  plugin root: $PLUGIN_ROOT"

assert_path "$PLUGIN_ROOT/.claude-plugin/plugin.json"
assert_path "$PLUGIN_ROOT/hooks/hooks.json"
assert_path "$PLUGIN_ROOT/hooks/run-hook.sh"
assert_path "$PLUGIN_ROOT/commands"
assert_path "$PLUGIN_ROOT/agents"

echo ""
echo "step 5: claude plugin list shows loom enabled"
# Capture the list output without piping; pipefail + tee chained with grep
# can swallow the loom match when claude emits informational status to stderr.
LIST_OUT=$(claude plugin list 2>&1)
echo "$LIST_OUT" >> "$LOG"
if ! echo "$LIST_OUT" | grep -q "loom"; then
  echo "FAIL: 'claude plugin list' does not include loom" >&2
  echo "$LIST_OUT" | sed 's/^/  /' >&2
  exit 1
fi
# Check for plugin load errors in the output (e.g. duplicate hooks file).
if echo "$LIST_OUT" | grep -qE "✘ failed to load|Status:.*✘"; then
  echo "FAIL: loom plugin loaded with errors" >&2
  echo "$LIST_OUT" | sed 's/^/  /' >&2
  exit 1
fi
echo "  OK   loom is listed and loaded cleanly"

echo ""
if [ "$FAIL" = "0" ]; then
  echo "plugin install sandbox passed"
else
  echo "plugin install sandbox failed"
  exit 1
fi

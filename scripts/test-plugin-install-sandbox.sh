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

if ! command -v python3 >/dev/null 2>&1; then
  echo "SKIP: python3 not on PATH — required to parse installed_plugins.json."
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
cp "$REPO_ROOT/.claude-plugin/plugin.json" "$MARKETPLACE/plugins/loom/.claude-plugin/plugin.json" \
  || { echo "FAIL: could not copy plugin.json to marketplace" >&2; exit 1; }

# Excludes apply uniformly across every tree — node_modules can land in scripts/
# after `bun install`, worktrees can nest anywhere, etc.
EXCLUDES=(--exclude='.git' --exclude='node_modules' --exclude='.worktrees'
          --exclude='.plan-execution' --exclude='dist' --exclude='.loom')

if ! command -v rsync >/dev/null 2>&1; then
  # The earlier cp-fallback didn't honor EXCLUDES — would copy node_modules,
  # .git, .loom, etc. into the marketplace tree (gigabytes, silent breakage).
  # rsync ships with every macOS install and every Ubuntu CI image we target,
  # so requiring it (and SKIPping cleanly when absent) is honest. Mirrors the
  # `claude` and `python3` SKIP pattern at the top of this script.
  echo "SKIP: rsync not on PATH — needed to populate the marketplace with excludes."
  exit 0
fi

for sub in agents commands hooks scripts skills config; do
  [ -d "$REPO_ROOT/$sub" ] && rsync -a "${EXCLUDES[@]}" "$REPO_ROOT/$sub/" "$MARKETPLACE/plugins/loom/$sub/"
done
[ -f "$REPO_ROOT/CLAUDE.md" ] && cp "$REPO_ROOT/CLAUDE.md" "$MARKETPLACE/plugins/loom/CLAUDE.md"

# Post-copy verification — rsync exit 23/24 (partial transfer) and cp partial
# failures both abort the script under set -e, but the silent-corruption case
# (some files missing from a "successful" copy) needs an explicit check.
for required in .claude-plugin/plugin.json agents commands hooks/hooks.json hooks/run-hook.sh; do
  [ -e "$MARKETPLACE/plugins/loom/$required" ] || {
    echo "FAIL: marketplace copy missing required path: $required" >&2
    exit 1
  }
done

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
# Pass the JSON path via argv with a quoted heredoc so the shell does NOT
# expand $vars inside the script body (paths with apostrophes or backticks
# would otherwise corrupt the Python literal). Capture stderr so real failures
# — missing python3, JSON parse errors, schema-shape changes — surface in the
# diagnostic instead of being masked as "could not resolve installPath".
PY_ERR=$(mktemp)
PLUGIN_ROOT=$(python3 - "$INSTALLED_JSON" 2>"$PY_ERR" <<'PY' || true
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
if isinstance(d, dict):
    for k, entries in d.get("plugins", {}).items():
        if k.startswith("loom@") and isinstance(entries, list):
            for e in entries:
                if isinstance(e, dict) and e.get("installPath"):
                    print(e["installPath"])
                    sys.exit(0)
sys.exit(1)
PY
)
if [ -z "$PLUGIN_ROOT" ] || [ ! -d "$PLUGIN_ROOT" ]; then
  echo "FAIL: could not resolve loom installPath from $INSTALLED_JSON" >&2
  [ -s "$PY_ERR" ] && { echo "  python error:" >&2; sed 's/^/    /' "$PY_ERR" >&2; }
  sed 's/^/  /' "$INSTALLED_JSON" >&2
  rm -f "$PY_ERR"
  exit 1
fi
rm -f "$PY_ERR"
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
# Check for plugin load errors. Match locale-stable substrings rather than the
# `✘` glyph (unicode handling varies across runners; LANG=C containers break
# the multi-byte match). Anchor on the loom row so a different plugin's failure
# doesn't get attributed to loom.
# Anchor on `loom@` (the plugin@marketplace form `claude plugin list` prints)
# rather than the `❯` glyph that prefixes it — same locale-stability concern
# as the grep below.
LOOM_BLOCK=$(echo "$LIST_OUT" | LC_ALL=C awk '/loom@/,/^[[:space:]]*$/' || true)
[ -z "$LOOM_BLOCK" ] && LOOM_BLOCK="$LIST_OUT"
if echo "$LOOM_BLOCK" | LC_ALL=C grep -qiE "fail|error|disabled|inactive"; then
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

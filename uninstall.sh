#!/bin/bash
# Loom Uninstaller — removes all Loom files from ~/.claude/ and ~/.cache/loom/
#
# Run with:
#   curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/uninstall.sh | bash

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
CACHE_DIR="${HOME}/.cache/loom"

echo "Uninstalling Loom..."
echo ""

# ── Read install-state to find installed files ──
STATE_FILE="${CLAUDE_DIR}/skills/library/install-state.toon"
REMOVED=0

remove_if_exists() {
  local file="$1"
  if [ -f "${file}" ]; then
    rm -f "${file}"
    echo "  DEL  $(basename "${file}")"
    REMOVED=$((REMOVED + 1))
  fi
}

# ── Infrastructure files ──
echo "Removing infrastructure..."
remove_if_exists "${CLAUDE_DIR}/statusline-renderer.cjs"
remove_if_exists "${CLAUDE_DIR}/statusline-command.sh"
remove_if_exists "${CLAUDE_DIR}/loom-update-checker.cjs"

# ── Commands (glob for all loom-* commands) ──
echo ""
echo "Removing commands..."
for f in "${CLAUDE_DIR}"/commands/loom*.md; do
  [ -f "$f" ] || continue
  remove_if_exists "$f"
done

# ── Agents (glob for all loom-installed agents) ──
echo ""
echo "Removing agents..."
for f in "${CLAUDE_DIR}"/agents/*.md; do
  [ -f "$f" ] || continue
  remove_if_exists "$f"
done
for f in "${CLAUDE_DIR}"/agents/protocols/*.md; do
  [ -f "$f" ] || continue
  remove_if_exists "$f"
done

# ── Skills and catalog ──
echo ""
echo "Removing catalog..."
remove_if_exists "${CLAUDE_DIR}/skills/library/library.yaml"
remove_if_exists "${CLAUDE_DIR}/skills/library/install-state.toon"
remove_if_exists "${CLAUDE_DIR}/skills/library/checksums.sha256"

# Remove empty loom directories (but not ~/.claude/ itself)
rmdir "${CLAUDE_DIR}/agents/protocols" 2>/dev/null || true
rmdir "${CLAUDE_DIR}/agents" 2>/dev/null || true
rmdir "${CLAUDE_DIR}/skills/library" 2>/dev/null || true

# ── Cache ──
if [ -d "${CACHE_DIR}" ]; then
  echo ""
  echo "Removing cache..."
  rm -rf "${CACHE_DIR}"
  echo "  DEL  ~/.cache/loom/"
  REMOVED=$((REMOVED + 1))
fi

echo ""
if [ "${REMOVED}" -gt 0 ]; then
  echo "Removed ${REMOVED} item(s). Loom has been uninstalled."
else
  echo "Nothing to remove — Loom was not installed."
fi

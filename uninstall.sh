#!/bin/bash
# Loom Uninstaller — removes only Loom-tracked files from ~/.claude/ and ~/.cache/loom/
#
# SAFE: Only deletes files recorded in install-state.toon. Never globs shared directories.
#
# Run with:
#   curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/uninstall.sh | bash

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
CACHE_DIR="${HOME}/.cache/loom"
STATE_FILE="${CLAUDE_DIR}/skills/library/install-state.toon"

echo "Uninstalling Loom..."
echo ""

REMOVED=0

remove_if_exists() {
  local file="$1"
  if [ -f "${file}" ]; then
    rm -f "${file}"
    echo "  DEL  ${file#${HOME}/}"
    REMOVED=$((REMOVED + 1))
  fi
}

# ── Remove manifest-tracked files ──
if [ -f "${STATE_FILE}" ]; then
  echo "Reading install manifest..."
  # Parse targetPath column from install-state.toon items table
  # Format: name,type,source,targetPath,installedAt (2-space indented rows after header)
  while IFS=',' read -r _name _type _source targetPath _rest; do
    # Skip header line, empty lines, non-indented lines
    targetPath=$(echo "${targetPath}" | xargs)  # trim whitespace
    if [ -z "${targetPath}" ] || [ "${targetPath}" = "targetPath" ]; then
      continue
    fi
    # Safety: only delete under ~/.claude/ or ~/.cache/
    case "${targetPath}" in
      "${HOME}/.claude/"*|"${HOME}/.cache/"*)
        remove_if_exists "${targetPath}"
        ;;
      *)
        echo "  SKIP ${targetPath} (outside allowed directories)"
        ;;
    esac
  done < <(grep "^  " "${STATE_FILE}" 2>/dev/null || true)
else
  echo "No install manifest found at ${STATE_FILE}"
  echo "Falling back to known Loom files only..."
  echo ""

  # Fallback: remove only known Loom infrastructure files (not agent globs)
  echo "Removing infrastructure..."
  remove_if_exists "${CLAUDE_DIR}/statusline-renderer.cjs"
  remove_if_exists "${CLAUDE_DIR}/statusline-command.sh"
  remove_if_exists "${CLAUDE_DIR}/loom-update-checker.cjs"

  echo ""
  echo "Removing commands..."
  # Only remove loom-prefixed command files, not all commands
  for f in "${CLAUDE_DIR}"/commands/loom*.md; do
    [ -f "$f" ] || continue
    remove_if_exists "$f"
  done
  # Remove sub-file directories
  if [ -d "${CLAUDE_DIR}/commands/loom-plan" ]; then
    rm -rf "${CLAUDE_DIR}/commands/loom-plan"
    echo "  DEL  commands/loom-plan/"
    REMOVED=$((REMOVED + 1))
  fi
  if [ -d "${CLAUDE_DIR}/commands/loom-roadmap" ]; then
    rm -rf "${CLAUDE_DIR}/commands/loom-roadmap"
    echo "  DEL  commands/loom-roadmap/"
    REMOVED=$((REMOVED + 1))
  fi
fi

# ── Catalog (always safe to remove — Loom-owned) ──
echo ""
echo "Removing catalog..."
remove_if_exists "${CLAUDE_DIR}/skills/library/library.yaml"
remove_if_exists "${CLAUDE_DIR}/skills/library/install-state.toon"
remove_if_exists "${CLAUDE_DIR}/skills/library/checksums.sha256"

# Remove empty Loom-owned directories (but never ~/.claude/ itself or shared dirs)
rmdir "${CLAUDE_DIR}/commands/loom-plan" 2>/dev/null || true
rmdir "${CLAUDE_DIR}/commands/loom-roadmap" 2>/dev/null || true
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
  echo ""
  echo "Note: Agent .md files in ~/.claude/agents/ were NOT removed."
  echo "Remove them manually if you no longer need them:"
  echo "  ls ~/.claude/agents/*.md"
else
  echo "Nothing to remove — Loom was not installed."
fi

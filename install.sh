#!/bin/bash
# Loom Installer — minimal bootstrap
#
# Fetches the core system from GitHub and installs to ~/.claude/.
# No repo clone needed. Run with:
#   curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
#
# After install, use /loom-library to pull agents and commands on demand.

set -euo pipefail

REPO="launchstack-dev/loom-ai"
BRANCH="main"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
CLAUDE_DIR="${HOME}/.claude"
CACHE_DIR="${HOME}/.cache/loom"

# Files to fetch: source_path -> target_path
declare -a INFRA_FILES=(
  "hooks/statusline-renderer.cjs:${CLAUDE_DIR}/statusline-renderer.cjs"
  "hooks/statusline-command.sh:${CLAUDE_DIR}/statusline-command.sh"
  "hooks/loom-update-checker.cjs:${CLAUDE_DIR}/loom-update-checker.cjs"
)

declare -a COMMAND_FILES=(
  "commands/loom-library.md:${CLAUDE_DIR}/commands/loom-library.md"
  "commands/loom.md:${CLAUDE_DIR}/commands/loom.md"
  "commands/loom-statusline-setup.md:${CLAUDE_DIR}/commands/loom-statusline-setup.md"
)

echo "Installing Loom (minimal bootstrap)..."
echo "Source: github.com/${REPO}@${BRANCH}"
echo "Target: ${CLAUDE_DIR}"
echo ""

# ── Create directories ──
mkdir -p "${CLAUDE_DIR}/agents/protocols"
mkdir -p "${CLAUDE_DIR}/commands"
mkdir -p "${CLAUDE_DIR}/skills/library"
mkdir -p "${CACHE_DIR}"

# ── Helper: fetch a file from GitHub ──
fetch_file() {
  local src="$1"
  local dst="$2"
  local url="${BASE}/${src}"
  # Validate target is under ~/.claude/ or ~/.cache/
  case "${dst}" in
    "${HOME}/.claude/"*|"${HOME}/.cache/"*) ;;
    *) echo "  FAIL ${src} (target outside allowed directories)"; return 1 ;;
  esac

  local tmp
  tmp=$(mktemp "${dst}.XXXXXX")

  if ! curl --max-filesize 10485760 --max-time 15 --max-redirs 5 -sfSL "${url}" -o "${tmp}"; then
    echo "  FAIL ${src} (fetch failed)"
    rm -f "${tmp}"
    return 1
  fi

  if [ ! -s "${tmp}" ]; then
    echo "  FAIL ${src} (empty response)"
    rm -f "${tmp}"
    return 1
  fi

  mv "${tmp}" "${dst}"
  return 0
}

# ── Helper: compute sha256 hash ──
hash_file() {
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    echo "unknown"
  fi
}

# ── Fetch catalog ──
echo "Fetching catalog..."
if fetch_file "skills/library.yaml" "${CLAUDE_DIR}/skills/library/library.yaml"; then
  echo "  OK   library.yaml"
else
  echo "ERROR: Could not fetch library.yaml. Check your network and try again."
  exit 1
fi

FAIL_COUNT=0

# ── Fetch infrastructure files ──
echo ""
echo "Fetching infrastructure..."
for entry in "${INFRA_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  if fetch_file "${src}" "${dst}"; then
    echo "  OK   $(basename "${dst}")"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# Make shell scripts executable
if [ -f "${CLAUDE_DIR}/statusline-command.sh" ]; then
  chmod +x "${CLAUDE_DIR}/statusline-command.sh" || echo "  WARN could not chmod statusline-command.sh"
fi

# ── Fetch core commands ──
echo ""
echo "Fetching commands..."
for entry in "${COMMAND_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  if fetch_file "${src}" "${dst}"; then
    echo "  OK   $(basename "${dst}")"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

if [ "${FAIL_COUNT}" -gt 0 ]; then
  echo ""
  echo "WARNING: ${FAIL_COUNT} file(s) failed to download."
  echo "Run the installer again or check your network connection."
  exit 1
fi

# ── Build install-state.toon ──
echo ""
echo "Building install state..."
STATE_FILE="${CLAUDE_DIR}/skills/library/install-state.toon"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

STATE_TMP=$(mktemp "${STATE_FILE}.XXXXXX")

{
  echo "schemaVersion: 1"
  echo "lastSynced: ${NOW}"
  echo ""
  echo "items[N]{name,type,source,targetPath,installedAt,contentHash}:"
} > "${STATE_TMP}"

# Record infrastructure items
for entry in "${INFRA_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  name=$(basename "${dst}" | sed 's/\.[^.]*$//')
  if [ -f "${dst}" ]; then
    hash=$(hash_file "${dst}")
    echo "  ${name},infrastructure,${BASE}/${src},${dst},${NOW},sha256:${hash}" >> "${STATE_TMP}"
  fi
done

# Record command items
for entry in "${COMMAND_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  name=$(basename "${dst}" .md)
  if [ -f "${dst}" ]; then
    hash=$(hash_file "${dst}")
    echo "  ${name},prompt,${BASE}/${src},${dst},${NOW},sha256:${hash}" >> "${STATE_TMP}"
  fi
done

mv "${STATE_TMP}" "${STATE_FILE}"
echo "  OK   install-state.toon"

# ── Done ──
echo ""
echo "Loom installed (minimal). Next steps:"
echo ""
echo "  /loom-library list          see available agents and commands"
echo "  /loom-library use <name>    install what you need"
echo "  /loom-statusline-setup      configure the status line"
echo "  /loom                       full reference"
echo ""
echo "The status line will notify you when updates are available."

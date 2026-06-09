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
CHECKSUMS_URL="${BASE}/checksums.sha256"
VERIFY_INTEGRITY=true

# Files to fetch: source_path -> target_path
declare -a INFRA_FILES=(
  "hooks/statusline-renderer.cjs:${CLAUDE_DIR}/statusline-renderer.cjs"
  "hooks/statusline-command.sh:${CLAUDE_DIR}/statusline-command.sh"
  "hooks/loom-update-checker.cjs:${CLAUDE_DIR}/loom-update-checker.cjs"
  "hooks/run-hook.sh:${CLAUDE_DIR}/run-hook.sh"
  "config/starship-loom.toml:${CLAUDE_DIR}/config/starship-loom.toml"
)

declare -a COMMAND_FILES=(
  # Core bootstrap commands
  "commands/loom-library.md:${CLAUDE_DIR}/commands/loom-library.md"
  "commands/loom.md:${CLAUDE_DIR}/commands/loom.md"
  "commands/loom-statusline-setup.md:${CLAUDE_DIR}/commands/loom-statusline-setup.md"
  "commands/loom-reference.md:${CLAUDE_DIR}/commands/loom-reference.md"
  # Subcommand files that /loom dispatches to via Read tool
  "commands/loom-init.md:${CLAUDE_DIR}/commands/loom-init.md"
  "commands/loom-auto.md:${CLAUDE_DIR}/commands/loom-auto.md"
  "commands/loom-converge.md:${CLAUDE_DIR}/commands/loom-converge.md"
  "commands/loom-quick.md:${CLAUDE_DIR}/commands/loom-quick.md"
  "commands/loom-pause.md:${CLAUDE_DIR}/commands/loom-pause.md"
  "commands/loom-resume.md:${CLAUDE_DIR}/commands/loom-resume.md"
  "commands/loom-do.md:${CLAUDE_DIR}/commands/loom-do.md"
  "commands/loom-next.md:${CLAUDE_DIR}/commands/loom-next.md"
  "commands/loom-profile.md:${CLAUDE_DIR}/commands/loom-profile.md"
  "commands/loom-status.md:${CLAUDE_DIR}/commands/loom-status.md"
  "commands/loom-debate.md:${CLAUDE_DIR}/commands/loom-debate.md"
  "commands/loom-chain.md:${CLAUDE_DIR}/commands/loom-chain.md"
  "commands/loom-vote.md:${CLAUDE_DIR}/commands/loom-vote.md"
  "commands/loom-triage.md:${CLAUDE_DIR}/commands/loom-triage.md"
  "commands/loom-upgrade.md:${CLAUDE_DIR}/commands/loom-upgrade.md"
  # Noun commands (registered as skills in library.yaml)
  "commands/loom-plan.md:${CLAUDE_DIR}/commands/loom-plan.md"
  "commands/loom-roadmap.md:${CLAUDE_DIR}/commands/loom-roadmap.md"
  "commands/loom-code.md:${CLAUDE_DIR}/commands/loom-code.md"
  "commands/loom-bugfix.md:${CLAUDE_DIR}/commands/loom-bugfix.md"
  "commands/loom-note.md:${CLAUDE_DIR}/commands/loom-note.md"
  "commands/loom-wiki.md:${CLAUDE_DIR}/commands/loom-wiki.md"
  "commands/loom-agent.md:${CLAUDE_DIR}/commands/loom-agent.md"
  "commands/loom-git.md:${CLAUDE_DIR}/commands/loom-git.md"
  "commands/loom-data.md:${CLAUDE_DIR}/commands/loom-data.md"
  # Progressive disclosure sub-files for loom-plan
  "commands/loom-plan/create.md:${CLAUDE_DIR}/commands/loom-plan/create.md"
  "commands/loom-plan/review.md:${CLAUDE_DIR}/commands/loom-plan/review.md"
  "commands/loom-plan/execute.md:${CLAUDE_DIR}/commands/loom-plan/execute.md"
  "commands/loom-plan/test.md:${CLAUDE_DIR}/commands/loom-plan/test.md"
  "commands/loom-plan/status.md:${CLAUDE_DIR}/commands/loom-plan/status.md"
  # Progressive disclosure sub-files for loom-roadmap
  "commands/loom-roadmap/init.md:${CLAUDE_DIR}/commands/loom-roadmap/init.md"
  "commands/loom-roadmap/review.md:${CLAUDE_DIR}/commands/loom-roadmap/review.md"
  "commands/loom-roadmap/mutate.md:${CLAUDE_DIR}/commands/loom-roadmap/mutate.md"
  "commands/loom-roadmap/explore.md:${CLAUDE_DIR}/commands/loom-roadmap/explore.md"
  "commands/loom-roadmap/analyze.md:${CLAUDE_DIR}/commands/loom-roadmap/analyze.md"
  "commands/loom-roadmap/util.md:${CLAUDE_DIR}/commands/loom-roadmap/util.md"
)

echo "Installing Loom (minimal bootstrap)..."
echo "Source: github.com/${REPO}@${BRANCH}"
echo "Target: ${CLAUDE_DIR}"
echo ""

# ── Create directories ──
mkdir -p "${CLAUDE_DIR}/agents/protocols"
mkdir -p "${CLAUDE_DIR}/commands"
mkdir -p "${CLAUDE_DIR}/commands/loom-plan"
mkdir -p "${CLAUDE_DIR}/commands/loom-roadmap"
mkdir -p "${CLAUDE_DIR}/config"
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

  # Try curl first (works for public repos), fall back to gh api (works for private repos)
  if ! curl --max-filesize 10485760 --max-time 15 --max-redirs 5 -sfSL "${url}" -o "${tmp}" 2>/dev/null; then
    if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
      if ! gh api "repos/${REPO}/contents/${src}" --jq '.content' 2>/dev/null | base64 -d > "${tmp}" 2>/dev/null; then
        echo "  FAIL ${src} (fetch failed via curl and gh)"
        rm -f "${tmp}"
        return 1
      fi
    else
      echo "  FAIL ${src} (fetch failed — for private repos, install gh: https://cli.github.com/)"
      rm -f "${tmp}"
      return 1
    fi
  fi

  if [ ! -s "${tmp}" ]; then
    echo "  FAIL ${src} (empty response)"
    rm -f "${tmp}"
    return 1
  fi

  mv "${tmp}" "${dst}"
  return 0
}

# ── Fetch checksums manifest ──
CHECKSUMS_FILE="${CACHE_DIR}/checksums.sha256"
echo "Fetching integrity manifest..."
if fetch_file "checksums.sha256" "${CHECKSUMS_FILE}"; then
  echo "  OK   checksums.sha256"
else
  echo "  WARN No checksums.sha256 found — skipping integrity verification"
  VERIFY_INTEGRITY=false
fi

# ── Helper: verify SHA256 checksum of a downloaded file ──
verify_checksum() {
  local src="$1"
  local dst="$2"
  if [ "${VERIFY_INTEGRITY}" != "true" ]; then return 0; fi
  local expected
  expected=$(grep "  ${src}$" "${CHECKSUMS_FILE}" 2>/dev/null | awk '{print $1}')
  if [ -z "${expected}" ]; then
    echo "  WARN ${src} (no checksum in manifest — skipped)"
    return 0
  fi
  local actual
  actual=$(shasum -a 256 "${dst}" | awk '{print $1}')
  if [ "${actual}" != "${expected}" ]; then
    echo "  FAIL ${src} (checksum mismatch)"
    echo "       expected: ${expected}"
    echo "       got:      ${actual}"
    rm -f "${dst}"
    return 1
  fi
  return 0
}

# ── Fetch catalog ──
echo ""
echo "Fetching catalog..."
if fetch_file "skills/library.yaml" "${CLAUDE_DIR}/skills/library/library.yaml" && verify_checksum "skills/library.yaml" "${CLAUDE_DIR}/skills/library/library.yaml"; then
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
  if fetch_file "${src}" "${dst}" && verify_checksum "${src}" "${dst}"; then
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
  if fetch_file "${src}" "${dst}" && verify_checksum "${src}" "${dst}"; then
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

# Count items
ITEM_COUNT=0
for entry in "${INFRA_FILES[@]}"; do
  dst="${entry#*:}"
  [ -f "${dst}" ] && ITEM_COUNT=$((ITEM_COUNT + 1))
done
for entry in "${COMMAND_FILES[@]}"; do
  dst="${entry#*:}"
  [ -f "${dst}" ] && ITEM_COUNT=$((ITEM_COUNT + 1))
done

{
  echo "schemaVersion: 2"
  echo "lastSynced: ${NOW}"
  echo ""
  echo "items[${ITEM_COUNT}]{name,type,source,targetPath,installedAt}:"
} > "${STATE_TMP}"

# Record infrastructure items
for entry in "${INFRA_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  name=$(basename "${dst}" | sed 's/\.[^.]*$//')
  if [ -f "${dst}" ]; then
    echo "  ${name},infrastructure,${src},${dst},${NOW}" >> "${STATE_TMP}"
  fi
done

# Record command items
for entry in "${COMMAND_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  name=$(basename "${dst}" .md)
  if [ -f "${dst}" ]; then
    echo "  ${name},prompt,${src},${dst},${NOW}" >> "${STATE_TMP}"
  fi
done

mv "${STATE_TMP}" "${STATE_FILE}"
echo "  OK   install-state.toon"

# ── Runtime detection ──
# Loom hooks are .ts files dispatched through hooks/run-hook.sh, which prefers
# bun and falls back to npx tsx. Warn here if neither is available so users see
# the gap at install time rather than as silent fail-open hook errors later.
if command -v bun >/dev/null 2>&1; then
  hook_runtime="bun ($(bun --version))"
elif command -v npx >/dev/null 2>&1; then
  hook_runtime="npx tsx (fallback; ~1-2s cold start per hook — install bun for ~50ms)"
else
  hook_runtime="NONE"
fi

# ── Done ──
echo ""
echo "Loom installed (minimal). Next steps:"
echo ""
echo "  /loom-library list          see available agents and commands"
echo "  /loom-library use <name>    install what you need"
echo "  /loom-statusline-setup      configure the status line"
echo "  /loom                       full reference"
echo ""
echo "Hook runtime: ${hook_runtime}"
if [ "${hook_runtime}" = "NONE" ]; then
  echo ""
  echo "WARNING: Neither bun nor node found. Loom hooks (.ts files) will not execute."
  echo "         Install bun (recommended): brew install bun"
  echo "         Or install node 18+ (fallback): https://nodejs.org"
fi
echo ""
echo "The status line will notify you when updates are available."

#!/bin/bash
# Loom Installer — minimal bootstrap
#
# Fetches the core system from GitHub and installs to ~/.claude/.
# No repo clone needed. Run with:
#   curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
#
# After install, use /loom-library to pull agents and commands on demand.

set -euo pipefail

# ── Exit codes ──
# 0 — success
# 1 — generic failure (network, missing files, MANIFEST_INVALID)
# 9 — INSTALL_CONFLICT_PLUGIN_AND_CURL (Loom already installed as a plugin)

# ── Pre-flight: refuse to install over a plugin install ──
# The curl-installed Loom (~/.claude/) and the marketplace plugin install
# (~/.claude/plugins/loom/) write to overlapping locations and ship distinct
# update paths. Running both leaves the user with two copies fighting over the
# same settings.json — silent hook duplication, partial upgrades. Refuse early.
if command -v claude >/dev/null 2>&1; then
  if claude plugin list 2>/dev/null | grep -q '\bloom\b'; then
    cat >&2 <<'EOF'
INSTALL_CONFLICT_PLUGIN_AND_CURL
Loom is already installed as a Claude Code plugin. The curl path and the
plugin path are mutually exclusive.
Migration: run `/loom-uninstall` first, then re-run this installer.
EOF
    exit 9
  fi
fi

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
  "scripts/probe-hook-runtime.sh:${CLAUDE_DIR}/scripts/probe-hook-runtime.sh"
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
  "commands/loom-plan/materialize.md:${CLAUDE_DIR}/commands/loom-plan/materialize.md"
  # Progressive disclosure sub-files for loom-roadmap
  "commands/loom-roadmap/init.md:${CLAUDE_DIR}/commands/loom-roadmap/init.md"
  "commands/loom-roadmap/review.md:${CLAUDE_DIR}/commands/loom-roadmap/review.md"
  "commands/loom-roadmap/mutate.md:${CLAUDE_DIR}/commands/loom-roadmap/mutate.md"
  "commands/loom-roadmap/explore.md:${CLAUDE_DIR}/commands/loom-roadmap/explore.md"
  "commands/loom-roadmap/analyze.md:${CLAUDE_DIR}/commands/loom-roadmap/analyze.md"
  "commands/loom-roadmap/util.md:${CLAUDE_DIR}/commands/loom-roadmap/util.md"
)

# Hook templates: shipped inert to ~/.claude/templates/. Nothing executes here.
# A project's /loom-init copies these into <project>/hooks/ and <project>/scripts/
# then runs register-loom-hooks.ts to wire them into .claude/settings.json.
# This is the second tier of the install model — per-project enforcement, opt-in
# at /loom-init time. See README "Hook enforcement (per-project)".
declare -a HOOK_TEMPLATE_FILES=(
  "hooks/contract-lock.ts:${CLAUDE_DIR}/templates/hooks/contract-lock.ts"
  "hooks/file-ownership.ts:${CLAUDE_DIR}/templates/hooks/file-ownership.ts"
  "hooks/wiki-write-guard.ts:${CLAUDE_DIR}/templates/hooks/wiki-write-guard.ts"
  "hooks/wiki-impact-warner.ts:${CLAUDE_DIR}/templates/hooks/wiki-impact-warner.ts"
  "hooks/deploy-guard.ts:${CLAUDE_DIR}/templates/hooks/deploy-guard.ts"
  "hooks/context-budget.ts:${CLAUDE_DIR}/templates/hooks/context-budget.ts"
  "hooks/budget-tracker.ts:${CLAUDE_DIR}/templates/hooks/budget-tracker.ts"
  "hooks/typecheck-on-write.ts:${CLAUDE_DIR}/templates/hooks/typecheck-on-write.ts"
  "hooks/wiki-commit-ledger.ts:${CLAUDE_DIR}/templates/hooks/wiki-commit-ledger.ts"
  "hooks/context-monitor.ts:${CLAUDE_DIR}/templates/hooks/context-monitor.ts"
  "hooks/checkpoint-trigger.ts:${CLAUDE_DIR}/templates/hooks/checkpoint-trigger.ts"
  "hooks/status-updater.ts:${CLAUDE_DIR}/templates/hooks/status-updater.ts"
  "hooks/quality-gate.ts:${CLAUDE_DIR}/templates/hooks/quality-gate.ts"
  "hooks/wiki-session-status.ts:${CLAUDE_DIR}/templates/hooks/wiki-session-status.ts"
  "hooks/run-hook.sh:${CLAUDE_DIR}/templates/hooks/run-hook.sh"
  "scripts/register-loom-hooks.ts:${CLAUDE_DIR}/templates/scripts/register-loom-hooks.ts"
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
mkdir -p "${CLAUDE_DIR}/scripts"
mkdir -p "${CLAUDE_DIR}/skills/library"
mkdir -p "${CLAUDE_DIR}/templates/hooks"
mkdir -p "${CLAUDE_DIR}/templates/scripts"
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

# ── Optional tarball sha256 verification (forward-compatible) ──
# When invoked with LOOM_RELEASE_TARBALL pointing at a downloaded release
# tarball and LOOM_RELEASE_MANIFEST pointing at the matching manifest.toon,
# verify the tarball's sha256 against the manifest's `sha256:` field BEFORE
# any extraction. On mismatch: exit with MANIFEST_INVALID without extracting.
# This guards the future per-release tarball install path; the legacy
# file-by-file fetch below remains the default.
if [ -n "${LOOM_RELEASE_TARBALL:-}" ] && [ -n "${LOOM_RELEASE_MANIFEST:-}" ]; then
  if [ ! -f "${LOOM_RELEASE_TARBALL}" ]; then
    echo "MANIFEST_INVALID: tarball not found at ${LOOM_RELEASE_TARBALL}" >&2
    exit 1
  fi
  if [ ! -f "${LOOM_RELEASE_MANIFEST}" ]; then
    echo "MANIFEST_INVALID: manifest not found at ${LOOM_RELEASE_MANIFEST}" >&2
    exit 1
  fi
  expected_sha=$(grep -E '^sha256:' "${LOOM_RELEASE_MANIFEST}" | awk '{print $2}' | head -n 1)
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha=$(sha256sum "${LOOM_RELEASE_TARBALL}" | awk '{print $1}')
  else
    actual_sha=$(shasum -a 256 "${LOOM_RELEASE_TARBALL}" | awk '{print $1}')
  fi
  if [ -z "${expected_sha}" ] || [ "${expected_sha}" != "${actual_sha}" ]; then
    echo "MANIFEST_INVALID: sha256 mismatch (expected ${expected_sha:-<none>}, got ${actual_sha})" >&2
    exit 1
  fi
  echo "  OK   tarball sha256 verified against manifest"
fi

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

# ── Fetch hook templates (inert; staged for per-project /loom-init opt-in) ──
echo ""
echo "Fetching hook templates..."
for entry in "${HOOK_TEMPLATE_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  if fetch_file "${src}" "${dst}" && verify_checksum "${src}" "${dst}"; then
    echo "  OK   $(basename "${dst}")"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# Make the hook wrapper executable so cp -r preserves the +x bit per-project.
if [ -f "${CLAUDE_DIR}/templates/hooks/run-hook.sh" ]; then
  chmod +x "${CLAUDE_DIR}/templates/hooks/run-hook.sh" || echo "  WARN could not chmod templates/hooks/run-hook.sh"
fi

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
for entry in "${HOOK_TEMPLATE_FILES[@]}"; do
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

# Record hook templates (inert until /loom-init copies them per-project)
for entry in "${HOOK_TEMPLATE_FILES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  name=$(basename "${dst}" | sed 's/\.[^.]*$//')
  if [ -f "${dst}" ]; then
    echo "  ${name},hook-template,${src},${dst},${NOW}" >> "${STATE_TMP}"
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

# ── Post-install probe: verify hook wrapper resolves under a stripped PATH ──
# Confirms PR #9's PATH-salvage works on this machine. Non-blocking: a probe
# failure prints a warning and points the user at /loom-doctor.
PROBE_SCRIPT="${CLAUDE_DIR}/scripts/probe-hook-runtime.sh"
# In a fresh curl install, scripts/probe-hook-runtime.sh isn't fetched into
# ~/.claude/. Fall back to running it from the source checkout if present.
if [ ! -f "${PROBE_SCRIPT}" ]; then
  if [ -f "scripts/probe-hook-runtime.sh" ]; then
    PROBE_SCRIPT="scripts/probe-hook-runtime.sh"
  else
    PROBE_SCRIPT=""
  fi
fi
if [ -n "${PROBE_SCRIPT}" ]; then
  echo ""
  echo "Running hook-runtime probe..."
  if sh "${PROBE_SCRIPT}" >/dev/null 2>&1; then
    echo "  OK   hook wrapper resolves runtime under stripped PATH"
  else
    probe_rc=$?
    if [ "${probe_rc}" -eq 2 ]; then
      echo "  SKIP probe target hook missing (non-fatal)"
    else
      echo "  WARN hook-runtime probe failed (exit ${probe_rc})"
      echo "       Run /loom-doctor for diagnostics."
    fi
  fi
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

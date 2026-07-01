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
  "scripts/loom-first-run.ts:${CLAUDE_DIR}/scripts/loom-first-run.ts"
  "scripts/lib/first-run.ts:${CLAUDE_DIR}/scripts/lib/first-run.ts"
  "scripts/lib/install-state.ts:${CLAUDE_DIR}/scripts/lib/install-state.ts"
  # /loom-update CLI + its pure helpers. Shipping these is what gives curl
  # users the channel-aware safe-upgrade path. Without them, the only update
  # mechanism is re-running install.sh, which has no atomic staging, no
  # restart signal, and no rollback. See planning/history/changelog.md
  # 2026-06-25 entry for context on why this was missing.
  "scripts/loom-update.ts:${CLAUDE_DIR}/scripts/loom-update.ts"
  "scripts/lib/update/check.ts:${CLAUDE_DIR}/scripts/lib/update/check.ts"
  "scripts/lib/update/apply.ts:${CLAUDE_DIR}/scripts/lib/update/apply.ts"
  "scripts/lib/update/resume.ts:${CLAUDE_DIR}/scripts/lib/update/resume.ts"
  "scripts/lib/update/rollback.ts:${CLAUDE_DIR}/scripts/lib/update/rollback.ts"
  # Plugin manifest — first-run.ts reads `version` from this file and writes it
  # into ~/.loom/install.toon as installedVersion. Without this, curl installs
  # leave installedVersion as "unknown" and /loom-doctor's version-drift check
  # always warns "Installed unknown differs from latest X.Y.Z" — a confusing
  # false positive masquerading as a real version-drift problem.
  ".claude-plugin/plugin.json:${CLAUDE_DIR}/.claude-plugin/plugin.json"
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
  "commands/loom-update.md:${CLAUDE_DIR}/commands/loom-update.md"
  "commands/loom-uninstall.md:${CLAUDE_DIR}/commands/loom-uninstall.md"
  "commands/loom-test.md:${CLAUDE_DIR}/commands/loom-test.md"
  "commands/loom-doctor.md:${CLAUDE_DIR}/commands/loom-doctor.md"
  # Shared init-guard prelude — included by reference from every /loom-* command
  "commands/_loom-init-guard.md:${CLAUDE_DIR}/commands/_loom-init-guard.md"
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
  "commands/loom-skill.md:${CLAUDE_DIR}/commands/loom-skill.md"
  "commands/loom-change.md:${CLAUDE_DIR}/commands/loom-change.md"
  # F-18 commands — decision-tree router, codebase deepening, throwaway prototypes
  "commands/loom-which.md:${CLAUDE_DIR}/commands/loom-which.md"
  "commands/loom-deepen.md:${CLAUDE_DIR}/commands/loom-deepen.md"
  "commands/loom-prototype.md:${CLAUDE_DIR}/commands/loom-prototype.md"
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
  "commands/loom-roadmap/converge.md:${CLAUDE_DIR}/commands/loom-roadmap/converge.md"
  "commands/loom-roadmap/sign-off.md:${CLAUDE_DIR}/commands/loom-roadmap/sign-off.md"
  "commands/loom-roadmap/status.md:${CLAUDE_DIR}/commands/loom-roadmap/status.md"
  # Progressive disclosure sub-files for loom-auto
  "commands/loom-auto/links/execute.md:${CLAUDE_DIR}/commands/loom-auto/links/execute.md"
  "commands/loom-auto/links/fix.md:${CLAUDE_DIR}/commands/loom-auto/links/fix.md"
  "commands/loom-auto/links/verify.md:${CLAUDE_DIR}/commands/loom-auto/links/verify.md"
  # gstack-adoption commands (M-01 through M-13)
  "commands/loom-benchmark.md:${CLAUDE_DIR}/commands/loom-benchmark.md"
  "commands/loom-benchmark/models.md:${CLAUDE_DIR}/commands/loom-benchmark/models.md"
  "commands/loom-benchmark/perf.md:${CLAUDE_DIR}/commands/loom-benchmark/perf.md"
  "commands/loom-browser.md:${CLAUDE_DIR}/commands/loom-browser.md"
  "commands/loom-canary.md:${CLAUDE_DIR}/commands/loom-canary.md"
  "commands/loom-careful.md:${CLAUDE_DIR}/commands/loom-careful.md"
  "commands/loom-cso.md:${CLAUDE_DIR}/commands/loom-cso.md"
  "commands/loom-design.md:${CLAUDE_DIR}/commands/loom-design.md"
  "commands/loom-design/consultation.md:${CLAUDE_DIR}/commands/loom-design/consultation.md"
  "commands/loom-design/html.md:${CLAUDE_DIR}/commands/loom-design/html.md"
  "commands/loom-design/shotgun.md:${CLAUDE_DIR}/commands/loom-design/shotgun.md"
  "commands/loom-devex.md:${CLAUDE_DIR}/commands/loom-devex.md"
  "commands/loom-devex/review.md:${CLAUDE_DIR}/commands/loom-devex/review.md"
  "commands/loom-diagram.md:${CLAUDE_DIR}/commands/loom-diagram.md"
  "commands/loom-docs.md:${CLAUDE_DIR}/commands/loom-docs.md"
  "commands/loom-docs/generate.md:${CLAUDE_DIR}/commands/loom-docs/generate.md"
  "commands/loom-docs/release.md:${CLAUDE_DIR}/commands/loom-docs/release.md"
  "commands/loom-health.md:${CLAUDE_DIR}/commands/loom-health.md"
  "commands/loom-install.md:${CLAUDE_DIR}/commands/loom-install.md"
  "commands/loom-landing-report.md:${CLAUDE_DIR}/commands/loom-landing-report.md"
  "commands/loom-learn.md:${CLAUDE_DIR}/commands/loom-learn.md"
  "commands/loom-qa.md:${CLAUDE_DIR}/commands/loom-qa.md"
  "commands/loom-retro.md:${CLAUDE_DIR}/commands/loom-retro.md"
  "commands/loom-setup.md:${CLAUDE_DIR}/commands/loom-setup.md"
  "commands/loom-setup/browser-cookies.md:${CLAUDE_DIR}/commands/loom-setup/browser-cookies.md"
  "commands/loom-setup/deploy.md:${CLAUDE_DIR}/commands/loom-setup/deploy.md"
  "commands/loom-ship.md:${CLAUDE_DIR}/commands/loom-ship.md"
  "commands/loom-skillify.md:${CLAUDE_DIR}/commands/loom-skillify.md"
  "commands/loom-spec.md:${CLAUDE_DIR}/commands/loom-spec.md"
  "commands/loom-think.md:${CLAUDE_DIR}/commands/loom-think.md"
  "commands/loom-worktree.md:${CLAUDE_DIR}/commands/loom-worktree.md"
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
# Note: no mkdir for ~/.claude/agents/ — install.sh doesn't fetch agent files
# (the marketplace path / /loom-library ships those). A vestigial
# `agents/protocols/` here would also reintroduce the path-misclassification
# the protocols-at-root move fixes.
mkdir -p "${CLAUDE_DIR}/commands"
mkdir -p "${CLAUDE_DIR}/commands/loom-plan"
mkdir -p "${CLAUDE_DIR}/commands/loom-roadmap"
mkdir -p "${CLAUDE_DIR}/config"
mkdir -p "${CLAUDE_DIR}/scripts"
mkdir -p "${CLAUDE_DIR}/scripts/lib"
mkdir -p "${CLAUDE_DIR}/scripts/lib/update"
mkdir -p "${CLAUDE_DIR}/.claude-plugin"
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

  # Ensure parent dir exists so mktemp can create the staging file.
  # Avoids drift between the explicit mkdir block above and any
  # newly-added nested command paths (e.g. commands/loom-auto/links/).
  mkdir -p "$(dirname "${dst}")"

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
  # Defensive `head -n 1`: if checksums.sha256 ever contains duplicate path
  # entries (e.g. a future installer that manually appends and forgets to
  # dedupe before regenerating), the raw `grep | awk '{print $1}'` returns
  # both hashes joined by a newline and the equality check below fails with
  # a confusing "checksum mismatch" — even when both hashes are identical.
  # Pick the first match. generate-checksums.sh also dedupes its input now,
  # but defending here too is cheap insurance against future drift.
  # Single awk: `$2 == src` is literal equality (no grep regex traps like `.`
  # matching any char in a path); `exit` after the first match handles dedupes
  # for free; awk naturally exits 0 on no-match so no `|| true` is needed
  # to survive `set -euo pipefail`. (Gemini #28 round-2 MEDIUM.)
  expected=$(awk -v src="${src}" '$2 == src {print $1; exit}' "${CHECKSUMS_FILE}" 2>/dev/null)
  if [ -z "${expected}" ]; then
    echo "  WARN ${src} (no checksum in manifest — skipped)"
    return 0
  fi
  local actual
  # Portable SHA-256: BSD/macOS ship `shasum` (Perl), GNU/Alpine ship
  # `sha256sum` from coreutils. install.sh runs in both worlds (macOS dev
  # box, Linux CI, Alpine Docker harness). Original code used `shasum` only
  # and silently failed on Alpine with "shasum: command not found" — the
  # error was hidden because `command substitution` doesn't propagate
  # exit codes under set -e, so `actual` ended up empty, equality failed,
  # and the user saw "checksum mismatch" instead of "shasum missing".
  # Mirror the same fallback already used at lines 224-227 for the tarball
  # verification path. (Surfaced by docker harness 2026-06-26.)
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "${dst}" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "${dst}" | awk '{print $1}')
  else
    # Explicit error — neither hashing utility found. Without this branch,
    # a missing-both environment would fall through to the equality check
    # with `actual` empty and surface as "checksum mismatch" instead of
    # the real "no hasher" cause. Same silent-failure-smokescreen pattern
    # that hid the original Alpine shasum-missing bug. (Gemini #28 round-6.)
    echo "  FAIL ${src} (neither sha256sum nor shasum found on PATH — cannot verify integrity)"
    rm -f "${dst}"
    return 1
  fi
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
# Re-run safety: preserve any user-added rows (kits, third-party items, BYO
# entries) by extracting them from the existing file before we rewrite. The
# preserved set is anything whose `type` is NOT one of the system types this
# installer owns: infrastructure, prompt, hook-template. Those system rows are
# fully owned by install.sh and are always regenerated from the arrays above.
echo ""
echo "Building install state..."
STATE_FILE="${CLAUDE_DIR}/skills/library/install-state.toon"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Cleanup function: idempotent rm -f on both tmpfiles. Installed as an EXIT
# trap BEFORE the mktemp calls — if the second mktemp fails after the first
# succeeded, the EXIT handler still fires and cleans up the leaked tmpfile.
# The cleanup uses `${STATE_TMP:-}` parameter-default expansion so `rm -f ""`
# is a safe no-op while the vars are still unset.
#
# We do NOT issue `trap - EXIT` on the success path — leaving the trap
# installed is safe (rm -f is idempotent) and avoids clearing any other EXIT
# handler that future code in install.sh may install before this block runs.
_loom_cleanup_install_state() {
  rm -f "${STATE_TMP:-}" "${PRESERVED_TMP:-}"
}
trap _loom_cleanup_install_state EXIT

STATE_TMP=$(mktemp "${STATE_FILE}.XXXXXX") || { echo "ERROR: mktemp failed for state tmpfile" >&2; exit 1; }
PRESERVED_TMP=$(mktemp "${STATE_FILE}.preserved.XXXXXX") || { echo "ERROR: mktemp failed for preserved tmpfile" >&2; exit 1; }

# Extract user-added rows (anything NOT owned by install.sh) from the existing
# state file. A "system" row is identified by its 2nd column (`type`) being one
# of: infrastructure, prompt, hook-template. Anything else (agent, skill, kit,
# protocol, byo-kit-item, etc.) is preserved.
#
# Schema-version handling: install.sh writes a v2 5-column header. If the
# existing file is v3 (7 columns: name,type,source,targetPath,sha256,component,
# installedAt — produced by /loom-library sync) we must collapse 7-col rows
# to 5-col before emitting them, or the result is a corrupted file with a
# v2 header but v3 row arity (the sha256 column would be misparsed as
# installedAt). The next /loom-library sync re-migrates to v3, so the
# transient downgrade is acceptable; silent corruption is not.
PRESERVED_COUNT=0
if [ -f "${STATE_FILE}" ]; then
  if ! awk -F',' '
    /^  [^ ]/ {
      type=$2
      if (type != "infrastructure" && type != "prompt" && type != "hook-template") {
        if (NF == 7) {
          # v3 row → v2 row: drop sha256 ($5) and component ($6), keep installedAt ($7).
          print $1 "," $2 "," $3 "," $4 "," $7
        } else {
          print $0
        }
      }
    }
  ' "${STATE_FILE}" > "${PRESERVED_TMP}"; then
    echo "ERROR: awk preservation pass failed — aborting to protect user-added rows in ${STATE_FILE}" >&2
    exit 1
  fi
  # Count rows directly from the filtered output instead of `wc -l` to avoid
  # off-by-one if awk's last record lacks a trailing newline (it shouldn't,
  # but the TOON items[N] header MUST match the body count or parsers fail).
  PRESERVED_COUNT=$(awk 'END{print NR}' "${PRESERVED_TMP}")
fi

# Count system items
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

TOTAL_COUNT=$((ITEM_COUNT + PRESERVED_COUNT))

{
  echo "schemaVersion: 2"
  echo "lastSynced: ${NOW}"
  echo ""
  echo "items[${TOTAL_COUNT}]{name,type,source,targetPath,installedAt}:"
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

# Append preserved user-added rows verbatim
if [ "${PRESERVED_COUNT}" -gt 0 ]; then
  if ! cat "${PRESERVED_TMP}" >> "${STATE_TMP}"; then
    echo "ERROR: failed to append preserved rows to ${STATE_TMP} — aborting to avoid writing a state file whose items[N] header lies about its body" >&2
    exit 1
  fi
fi

mv "${STATE_TMP}" "${STATE_FILE}"
# Tmpfiles already gone after mv (STATE_TMP) and we delete PRESERVED_TMP
# explicitly. EXIT trap remains installed; its cleanup is idempotent.
rm -f "${PRESERVED_TMP}"
if [ "${PRESERVED_COUNT}" -gt 0 ]; then
  echo "  OK   install-state.toon (preserved ${PRESERVED_COUNT} user-added row(s))"
else
  echo "  OK   install-state.toon"
fi

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

# First-run: write ~/.loom/install.toon channel envelope (idempotent, no PII).
# Skips silently if neither bun nor node is available — the envelope is opt-in
# and not required for hook execution.
# Check the commands directly. `hook_runtime` is a formatted display string
# (e.g. "bun (1.1.x)" or "npx tsx (fallback; ...)") — never literal "bun"
# or "node" — so the old `[ "${hook_runtime}" = "bun" ]` form silently
# never matched, first-run never executed, and installedVersion stayed
# "unknown" forever in ~/.loom/install.toon.
#
# Node fallback runtime probe: `--experimental-strip-types` is Node 22.6+;
# on Node 18, 20, and early 22 it errors out. Because the spawn is wrapped
# in `2>/dev/null || true`, that error is invisible — and installedVersion
# is silently left as "unknown" again. Probe the flag with `-e ""` before
# committing to it; otherwise fall through to `npx tsx` if available.
# (Gemini #28 rounds 2-3.)
# Bun runs TypeScript natively — no need for `bunx tsx` (which goes through
# Node's tsx loader via bunx and requires network/cache resolution on first
# run). Plain `bun scripts/loom-first-run.ts` is faster, simpler, and works
# offline. (Gemini #28 round-4 MEDIUM.)
if command -v bun >/dev/null 2>&1; then
  ( cd "${CLAUDE_DIR}" && bun scripts/loom-first-run.ts 2>/dev/null ) || true
elif command -v node >/dev/null 2>&1; then
  # Try `node --experimental-strip-types` directly — if the flag is
  # unsupported (pre-22.6) OR the script fails ESM extension resolution
  # (`.js` imports under strip-types don't resolve to `.ts`), the if
  # condition is false and we fall through to `npx tsx` which handles
  # both. No separate `-e ""` probe needed; the real run is its own probe.
  # (Gemini #28 rounds 5-6.)
  if ( cd "${CLAUDE_DIR}" && node --experimental-strip-types scripts/loom-first-run.ts >/dev/null 2>&1 ); then
    :
  elif command -v npx >/dev/null 2>&1; then
    ( cd "${CLAUDE_DIR}" && npx --yes tsx scripts/loom-first-run.ts 2>/dev/null ) || true
  fi
fi

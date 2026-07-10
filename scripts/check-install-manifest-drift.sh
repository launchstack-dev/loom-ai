#!/usr/bin/env bash
# check-install-manifest-drift.sh — verify install.sh ↔ checksums.sha256 stay in sync.
#
# install.sh fetches files from GitHub and verifies them against checksums.sha256.
# If a contributor adds a new file to install.sh but forgets to add it to the
# manifest, install.sh emits "WARN: no checksum in manifest — skipped" and ships
# the file unverified. The existing verify-checksums.sh catches incorrect hashes
# for listed files but does not catch this completeness gap.
#
# This script catches that drift at PR time. Pairs with scripts/verify-checksums.sh
# (which verifies hashes are *correct* for tracked files); together they cover
# both axes: completeness (this script) and accuracy (verify-checksums.sh).
#
# Exit codes:
#   0  no drift
#   1  drift detected (files fetched but not tracked, or tracked but not fetched)
#   2  invocation error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL="${REPO_ROOT}/install.sh"
MANIFEST="${REPO_ROOT}/checksums.sha256"

[ -f "${INSTALL}" ]  || { echo "ERROR: ${INSTALL} not found" >&2; exit 2; }
[ -f "${MANIFEST}" ] || { echo "ERROR: ${MANIFEST} not found" >&2; exit 2; }

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

# Extract source paths from install.sh's fetch_file calls AND from the
# INFRA_FILES/COMMAND_FILES/HOOK_TEMPLATE_FILES arrays. Both forms appear:
#   "src/path:${CLAUDE_DIR}/..."           (array entry)
#   fetch_file "src/path" "${CLAUDE_DIR}/..." (direct call)
# We don't try to be clever — grep for both patterns and union them.
# Exclude checksums.sha256 itself (fetched separately as the integrity manifest)
# and any '$' variable reference (e.g. the fetch_file function definition).
# LC_ALL=C pins byte-order sort so the comm comparison is deterministic across
# locales (a macOS contributor's default locale orders punctuation differently
# from Ubuntu CI's; without this, drift detection can disagree by platform).
{
  grep -oE '"[^"]+:\$\{CLAUDE_DIR\}' "${INSTALL}" | sed 's/:.*//; s/^"//'
  grep -oE 'fetch_file "[^"$]+"' "${INSTALL}" | sed 's/^fetch_file "//; s/"$//'
} | grep -vE '^(checksums\.sha256|\$)' | LC_ALL=C sort -u > "${TMP}/install-files.txt"

# Sanity check the parser. If both greps stop matching (install.sh refactored
# to a shape we don't recognize), an empty install-files.txt would silently
# look "in sync" against an also-empty manifest — exactly the false-negative
# this guard exists to prevent.
if [ ! -s "${TMP}/install-files.txt" ]; then
  echo "ERROR: extracted zero fetch targets from install.sh — parser likely broken" >&2
  echo "       (check the grep patterns in this script against install.sh's array syntax)" >&2
  exit 1
fi

awk 'NF==2 && $1 !~ /^#/ {print $2}' "${MANIFEST}" | LC_ALL=C sort -u > "${TMP}/manifest-files.txt"

# Files install.sh fetches but the manifest doesn't track (unverified shipping).
# Drop the defensive `|| true` — comm doesn't exit non-zero on empty output, so
# the only thing `|| true` would mask is a real comm failure (unreadable input,
# OOM), which we want to propagate under pipefail.
MISSING=$(comm -23 "${TMP}/install-files.txt" "${TMP}/manifest-files.txt")

# Files the manifest tracks but install.sh doesn't fetch. Less critical (users
# won't get them) but still drift — either install.sh forgot to add the file or
# the manifest has stale entries.
ORPHANS=$(comm -13 "${TMP}/install-files.txt" "${TMP}/manifest-files.txt")

FAIL=0

if [ -n "${MISSING}" ]; then
  echo "ERROR: Files fetched by install.sh but missing from checksums.sha256:" >&2
  echo "${MISSING}" | sed 's/^/  /' >&2
  echo "" >&2
  echo "   These ship to users unverified. Fix: append the paths to" >&2
  echo "   checksums.sha256, then run scripts/generate-checksums.sh." >&2
  echo "" >&2
  FAIL=1
fi

if [ -n "${ORPHANS}" ]; then
  echo "ERROR: Files in checksums.sha256 but not fetched by install.sh:" >&2
  echo "${ORPHANS}" | sed 's/^/  /' >&2
  echo "" >&2
  echo "   These are tracked but won't reach users. Either add them to" >&2
  echo "   install.sh's fetch list, or remove the manifest entry." >&2
  echo "" >&2
  FAIL=1
fi

# ── Completeness axis 2: hooks.json → install list ────────────────────
# Every hook script referenced by the shipped hooks/hooks.json must be a
# fetch target — a registered-but-unshipped hook breaks fresh installs
# (the doctor's hook-files-present check fails on day one). This is the
# exact gap that let hooks/map-freshness.ts go unshipped (2026-07-09).
HOOKS_JSON="${REPO_ROOT}/hooks/hooks.json"
if [ -f "${HOOKS_JSON}" ]; then
  grep -oE '\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\}/[^" ]+\.(ts|cjs|sh)' "${HOOKS_JSON}" \
    | sed -E 's/^\$\{[A-Z_]+\}\///' | LC_ALL=C sort -u > "${TMP}/hooksjson-files.txt"
  HOOK_MISSING=$(comm -23 "${TMP}/hooksjson-files.txt" "${TMP}/install-files.txt")
  if [ -n "${HOOK_MISSING}" ]; then
    echo "ERROR: hooks.json registers hook files that install.sh never ships:" >&2
    echo "${HOOK_MISSING}" | sed 's/^/  /' >&2
    echo "" >&2
    echo "   Fresh installs will register a hook whose file does not exist." >&2
    echo "   Fix: add each path to install.sh (HOOK_TEMPLATE_FILES), then run" >&2
    echo "   scripts/generate-checksums.sh (it appends new entries itself)." >&2
    echo "" >&2
    FAIL=1
  fi
fi

# ── Completeness axis 3: shipped hooks' lib-import closure ────────────
# Shipped hook files import ./lib/*.js siblings; each import (transitively)
# must also ship or the hook crashes at require-time on curl installs.
grep -E '^hooks/.*\.ts$' "${TMP}/install-files.txt" > "${TMP}/closure-worklist.txt" || true
: > "${TMP}/closure-needed.txt"
: > "${TMP}/closure-seen.txt"
PASS=0
while [ -s "${TMP}/closure-worklist.txt" ] && [ "${PASS}" -lt 10 ]; do
  PASS=$((PASS + 1))
  : > "${TMP}/closure-next.txt"
  while IFS= read -r hookfile; do
    grep -qxF "${hookfile}" "${TMP}/closure-seen.txt" && continue
    echo "${hookfile}" >> "${TMP}/closure-seen.txt"
    src="${REPO_ROOT}/${hookfile}"
    [ -f "${src}" ] || continue
    case "${hookfile}" in
      hooks/lib/*) prefix="hooks/lib/" ; pattern='from "\./[a-z0-9-]+\.js"' ;;
      hooks/*)     prefix="hooks/lib/" ; pattern='from "\./lib/[a-z0-9-]+\.js"' ;;
      *) continue ;;
    esac
    while IFS= read -r imp; do
      [ -n "${imp}" ] || continue
      dep="${prefix}$(echo "${imp}" | sed -E 's/^from "\.\/(lib\/)?//; s/\.js"$//').ts"
      echo "${dep}" >> "${TMP}/closure-next.txt"
      if ! grep -qxF "${dep}" "${TMP}/install-files.txt"; then
        echo "${dep} (imported by ${hookfile})" >> "${TMP}/closure-needed.txt"
      fi
    done < <(grep -oE "${pattern}" "${src}" | LC_ALL=C sort -u)
    # Cross-package imports (hooks/ files importing ../scripts/lib/...) must
    # ship too, at a target where the relative path still resolves.
    while IFS= read -r imp; do
      [ -n "${imp}" ] || continue
      dep="$(echo "${imp}" | sed -E 's/^from "\.\.\///; s/\.js"$//').ts"
      if ! grep -qxF "${dep}" "${TMP}/install-files.txt"; then
        echo "${dep} (cross-package import by ${hookfile})" >> "${TMP}/closure-needed.txt"
      fi
    done < <(grep -oE 'from "\.\./scripts/lib/[a-z0-9/.-]+\.js"' "${src}" | LC_ALL=C sort -u)
  done < "${TMP}/closure-worklist.txt"
  LC_ALL=C sort -u "${TMP}/closure-next.txt" > "${TMP}/closure-worklist.txt"
done
if [ -s "${TMP}/closure-needed.txt" ]; then
  echo "ERROR: shipped hook files import lib modules that install.sh never ships:" >&2
  LC_ALL=C sort -u "${TMP}/closure-needed.txt" | sed 's/^/  /' >&2
  echo "" >&2
  echo "   Curl-installed hook templates will crash at import time. Fix: add" >&2
  echo "   each hooks/lib/*.ts to install.sh, then run scripts/generate-checksums.sh." >&2
  echo "" >&2
  FAIL=1
fi

# ── Completeness axis 4: command → workflow driver references ─────────
# Commands that dispatch to a Workflow engine driver must ship that driver.
grep -rhoE 'workflows/[a-z0-9-]+\.mjs' "${REPO_ROOT}/commands" 2>/dev/null \
  | LC_ALL=C sort -u > "${TMP}/workflow-refs.txt" || true
if [ -s "${TMP}/workflow-refs.txt" ]; then
  WF_MISSING=$(comm -23 "${TMP}/workflow-refs.txt" "${TMP}/install-files.txt")
  if [ -n "${WF_MISSING}" ]; then
    echo "ERROR: commands reference Workflow drivers that install.sh never ships:" >&2
    echo "${WF_MISSING}" | sed 's/^/  /' >&2
    echo "" >&2
    echo "   Profile dispatch will fail on installed projects. Fix: add each" >&2
    echo "   workflows/*.mjs to install.sh, then run scripts/generate-checksums.sh." >&2
    echo "" >&2
    FAIL=1
  fi
fi

if [ "${FAIL}" = "0" ]; then
  N=$(wc -l < "${TMP}/install-files.txt" | tr -d ' ')
  echo "install.sh and checksums.sha256 in sync (${N} files; hooks.json, lib closure, and workflow refs complete)"
fi

exit "${FAIL}"

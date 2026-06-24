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

if [ "${FAIL}" = "0" ]; then
  N=$(wc -l < "${TMP}/install-files.txt" | tr -d ' ')
  echo "install.sh and checksums.sha256 in sync (${N} files)"
fi

exit "${FAIL}"

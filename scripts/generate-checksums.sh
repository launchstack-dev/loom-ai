#!/usr/bin/env bash
# generate-checksums.sh — regenerate checksums.sha256 in place.
#
# Reads the path list from the current checksums.sha256 and re-hashes
# each file. Writes the new manifest atomically (.tmp + rename). The
# path list is the source of truth — to add a new file to the manifest,
# append it manually once; subsequent regenerations preserve the line
# (and update its hash whenever the file changes).
#
# Usage:
#   scripts/generate-checksums.sh           # regenerate from repo root
#   scripts/generate-checksums.sh --check   # print would-be diff, exit 1 if drift
#
# Exit codes:
#   0  success (or, with --check, no drift)
#   1  drift detected (--check only) OR a tracked file is missing
#   2  invocation error (missing manifest, no shasum, etc.)

set -euo pipefail

# ── Locate repo root ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${REPO_ROOT}/checksums.sha256"
CHECK_MODE=false

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_MODE=true ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      echo "Usage: $0 [--check]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "${MANIFEST}" ]; then
  echo "ERROR: ${MANIFEST} not found" >&2
  exit 2
fi

if ! command -v shasum &>/dev/null; then
  echo "ERROR: shasum not found (required for SHA-256 digest)" >&2
  exit 2
fi

# ── Extract path list ─────────────────────────────────────────────────
# Each line: "{hash}  {path}". Skip blank lines and comments.
# Portable across bash 3.2 (macOS default) — `mapfile` is bash 4+.
PATHS=()
while IFS= read -r p; do
  [ -n "$p" ] && PATHS+=("$p")
done < <(awk 'NF == 2 && $1 !~ /^#/ { print $2 }' "${MANIFEST}")

if [ "${#PATHS[@]}" -eq 0 ]; then
  echo "ERROR: ${MANIFEST} contains no tracked paths" >&2
  exit 2
fi

# ── Re-hash each tracked file ─────────────────────────────────────────
# Walk the input manifest line by line. Comments and blank lines are
# preserved verbatim; hash+path lines are re-hashed. Order is preserved
# so the diff stays minimal when only a couple of files change.
MISSING=0
TMP_MANIFEST="${MANIFEST}.tmp"
: > "${TMP_MANIFEST}"

# Dedupe path-bearing lines: if the manifest contains the same path more
# than once (e.g. a future installer that manually appended without
# deduping), keep the first occurrence and drop the rest. Without this,
# install.sh's verify_checksum sees two hashes for one path, joins them
# with a newline, and fails its equality check even when both hashes
# match. Comments and blank lines pass through untouched.
DUP_COUNT=0
declare -a SEEN_PATHS=()
_is_seen() {
  local needle="$1" entry
  for entry in "${SEEN_PATHS[@]:-}"; do
    [ "$entry" = "$needle" ] && return 0
  done
  return 1
}

while IFS= read -r line || [ -n "$line" ]; do
  # Preserve comments and blank lines verbatim
  if [ -z "${line}" ] || [ "${line:0:1}" = "#" ]; then
    printf '%s\n' "${line}" >> "${TMP_MANIFEST}"
    continue
  fi
  # Hash+path line: extract path (second field), re-hash, emit new
  p=$(echo "${line}" | awk '{print $2}')
  if [ -z "${p}" ]; then
    # Malformed line — preserve verbatim and warn
    echo "WARN: malformed manifest line: ${line}" >&2
    printf '%s\n' "${line}" >> "${TMP_MANIFEST}"
    continue
  fi
  if _is_seen "${p}"; then
    DUP_COUNT=$((DUP_COUNT + 1))
    continue
  fi
  SEEN_PATHS+=("${p}")
  full="${REPO_ROOT}/${p}"
  if [ ! -f "${full}" ]; then
    echo "MISSING: ${p}" >&2
    MISSING=$((MISSING + 1))
    continue
  fi
  # `shasum -a 256` prints "<hash>  <path>". Compute on the absolute
  # path, then write the repo-relative path so install.sh's consumer
  # finds files in the right place.
  hash=$(shasum -a 256 "${full}" | awk '{print $1}')
  printf '%s  %s\n' "${hash}" "${p}" >> "${TMP_MANIFEST}"
done < "${MANIFEST}"

if [ "${DUP_COUNT}" -gt 0 ]; then
  echo "  Note: deduped ${DUP_COUNT} duplicate path entry(s) from manifest" >&2
fi

if [ "${MISSING}" -gt 0 ]; then
  rm -f "${TMP_MANIFEST}"
  echo "ERROR: ${MISSING} tracked file(s) missing — fix or remove from ${MANIFEST}" >&2
  exit 1
fi

# ── Compare or commit ─────────────────────────────────────────────────
if [ "${CHECK_MODE}" = "true" ]; then
  if cmp -s "${MANIFEST}" "${TMP_MANIFEST}"; then
    rm -f "${TMP_MANIFEST}"
    echo "checksums.sha256 is up to date"
    exit 0
  else
    echo "DRIFT — checksums.sha256 needs regeneration:" >&2
    diff "${MANIFEST}" "${TMP_MANIFEST}" >&2 || true
    rm -f "${TMP_MANIFEST}"
    echo "" >&2
    echo "Fix: scripts/generate-checksums.sh" >&2
    exit 1
  fi
fi

# Commit the new manifest atomically
mv "${TMP_MANIFEST}" "${MANIFEST}"
echo "checksums.sha256 regenerated (${#PATHS[@]} files)"

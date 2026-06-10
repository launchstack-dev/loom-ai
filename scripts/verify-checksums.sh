#!/usr/bin/env bash
# verify-checksums.sh — verify checksums.sha256 is up to date.
#
# Thin wrapper around `generate-checksums.sh --check`. Exists as a
# distinct script so CI workflow files and contributor docs can refer
# to a verb-named command. Exits non-zero on drift; suggests the fix.
#
# Usage: scripts/verify-checksums.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/generate-checksums.sh" --check

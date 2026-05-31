#!/usr/bin/env bash
# verify-release.sh — verify a Loom release tarball against its cosign signature.
#
# Usage:
#   scripts/verify-release.sh <version>
#   scripts/verify-release.sh v0.1.0
#
# Downloads the tarball, signature, and certificate from the GitHub Release
# matching <version>, then runs cosign verify-blob with this repo's OIDC identity
# pinned. Exits 0 on success, non-zero on any failure.
#
# Useful for: end users who want to verify their install before running it,
# CI smoke tests after a release, the install.sh shim's verification step.

set -euo pipefail

REPO="launchstack-dev/loom-ai"
VERSION="${1:-}"

if [ -z "${VERSION}" ]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 v0.1.0" >&2
  exit 2
fi

if ! command -v cosign &>/dev/null; then
  echo "ERROR: cosign not found. Install: https://docs.sigstore.dev/cosign/installation/" >&2
  exit 3
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl not found." >&2
  exit 3
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "${WORKDIR}"' EXIT

BASE="https://github.com/${REPO}/releases/download/${VERSION}"
TARBALL="loom-core-${VERSION}.tar.gz"

echo "Downloading release artifacts for ${VERSION}..."
curl --max-time 60 -fsSL -o "${WORKDIR}/${TARBALL}"      "${BASE}/${TARBALL}"
curl --max-time 60 -fsSL -o "${WORKDIR}/${TARBALL}.sig"  "${BASE}/${TARBALL}.sig"
curl --max-time 60 -fsSL -o "${WORKDIR}/${TARBALL}.crt"  "${BASE}/${TARBALL}.crt"

echo "Verifying cosign signature..."
cosign verify-blob \
  --signature "${WORKDIR}/${TARBALL}.sig" \
  --certificate "${WORKDIR}/${TARBALL}.crt" \
  --certificate-identity-regexp "^https://github\\.com/${REPO}/\\.github/workflows/release\\.yml@" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "${WORKDIR}/${TARBALL}"

echo "Verification PASSED for ${TARBALL}"
echo "Tarball is at: ${WORKDIR}/${TARBALL}"
echo ""
echo "(Note: verification confirms this artifact was produced by the official release"
echo " workflow. It does not assert anything about the tarball's contents beyond provenance.)"

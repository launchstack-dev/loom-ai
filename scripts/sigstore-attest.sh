#!/bin/sh
# sigstore-attest — keyless cosign sign-blob for a release asset.
#
# Consumed by .github/workflows/sigstore-attest.yml (release:published trigger).
# Produces "<asset>.sig" and "<asset>.cert" alongside the asset, signed via
# Fulcio (cert) + Rekor (transparency log) using GitHub Actions OIDC identity.
#
# Usage:
#   scripts/sigstore-attest.sh <path-to-release-asset>
#
# Idempotency: if both <asset>.sig and <asset>.cert already exist, exits 0
# without re-signing — the workflow can re-run safely.
#
# Local verification (after the workflow runs and publishes the .sig/.cert
# files alongside the release asset):
#
#   cosign verify-blob \
#     --signature loom-<ver>.tar.gz.sig \
#     --certificate loom-<ver>.tar.gz.cert \
#     --certificate-identity-regexp "^https://github\\.com/<org>/loom-ai/\\.github/workflows/sigstore-attest\\.yml@" \
#     --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
#     loom-<ver>.tar.gz
#
# This anchors trust to the GitHub Actions OIDC issuer + the specific
# sigstore-attest.yml workflow path in the loom-ai repo. Any signature minted
# from a different workflow or repo will fail verification.
#
# Exit codes:
#   0   signed (or already signed — idempotent)
#   1   usage / I/O error
#   2   cosign sign-blob failed
set -eu

ASSET="${1-}"
if [ -z "${ASSET}" ]; then
  echo "sigstore-attest: usage: $0 <path-to-release-asset>" >&2
  exit 1
fi

if [ ! -f "${ASSET}" ]; then
  echo "sigstore-attest: asset not found: ${ASSET}" >&2
  exit 1
fi

SIG="${ASSET}.sig"
CERT="${ASSET}.cert"

if [ -f "${SIG}" ] && [ -f "${CERT}" ]; then
  echo "sigstore-attest: signature already present (${SIG}, ${CERT}) — skipping" >&2
  exit 0
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "sigstore-attest: cosign not installed on PATH" >&2
  exit 1
fi

# Keyless OIDC flow:
#   --yes                 auto-confirm OIDC consent prompt (required in CI)
#   --output-signature    emit detached .sig
#   --output-certificate  emit Fulcio cert for verify-blob
# The GitHub Actions OIDC token is picked up automatically from
# ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN}, which the workflow exposes via
# `permissions: id-token: write`.
if ! cosign sign-blob \
  --yes \
  --output-signature "${SIG}" \
  --output-certificate "${CERT}" \
  "${ASSET}"; then
  echo "sigstore-attest: cosign sign-blob failed for ${ASSET}" >&2
  exit 2
fi

echo "sigstore-attest: signed ${ASSET}" >&2
echo "  sig:  ${SIG}"
echo "  cert: ${CERT}"
exit 0

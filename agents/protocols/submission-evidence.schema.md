---
schemaVersion: 1
name: submission-evidence
description: SubmissionEvidence — archive of a single marketplace submission attempt, written to marketplace/submission-evidence.toon by `/loom-marketplace submit`.
---

# Submission Evidence Schema

Canonical schema for `marketplace/submission-evidence.toon`. Records the full audit trail of a single Loom-plugin submission to the Claude Code marketplace: release tag, attestation, PR URL, approval-tracking issue, and final outcome. Written by the Phase 11 marketplace submission flow and consumed by maintainer dashboards.

## TOON Exemplar

```toon
SubmissionEvidence:
  schemaVersion: 1
  submittedAt: 2026-06-17T12:34:56Z
  releaseTag: 0.4.0
  sigstoreAttestationUrl: https://search.sigstore.dev/?logIndex=12345678
  marketplacePrUrl: https://github.com/anthropics/claude-code-marketplace/pull/42
  maintainerApprovalIssueUrl: https://github.com/loom-ai/loom-ai/issues/99
  outcome: pending
```

## Top-Level Fields

| Field | Required | Type | Description |
|---|---|---|---|
| schemaVersion | yes | int | Currently `1`. |
| submittedAt | yes | iso8601 | UTC timestamp when the submission PR was opened. |
| releaseTag | yes | string | Semver tag of the release being submitted (e.g. `0.4.0`). Matches `^\d+\.\d+\.\d+(-[\w.]+)?$`. |
| sigstoreAttestationUrl | yes | string | HTTPS URL to the Sigstore transparency log entry for the release artifact. Must start with `https://`. |
| marketplacePrUrl | yes | string | HTTPS URL to the marketplace pull request. Must start with `https://`. |
| maintainerApprovalIssueUrl | yes | string | HTTPS URL to the internal tracking issue used by Loom maintainers to coordinate approval. Must start with `https://`. |
| outcome | yes | enum | `pending` \| `accepted` \| `rejected`. Updated in-place as the submission progresses. |

## Outcome Lifecycle

```
pending  ──(marketplace PR merged)──▶  accepted
   │
   └────(marketplace PR closed without merge)──▶  rejected
```

- `pending`: PR is open and awaiting review. Initial state at submission time.
- `accepted`: PR was merged into the marketplace repo; the release is live.
- `rejected`: PR was closed without merge. The `maintainerApprovalIssueUrl` issue captures the rationale.

## File Location

- **Path:** `marketplace/submission-evidence.toon` at the repo root.
- **One file per submission attempt.** Subsequent submissions append a new file under `marketplace/history/{releaseTag}.toon` and overwrite the canonical file with the latest attempt.
- **Atomic write** (project convention): write to `.tmp`, then `mv`.

## Consumers

- Maintainer dashboards / status pages that surface "is the latest release live in the marketplace?"
- `/loom-marketplace status` (future): renders the most recent SubmissionEvidence.
- CI: reads `outcome` to gate further automation (e.g. publishing release notes only after `accepted`).

## Notes

- URLs are stored as opaque strings. Consumers should not parse them for routing; they exist for human navigation and audit.
- This schema deliberately does *not* embed the attestation payload or PR diff — those live at the linked URLs and are fetched on demand.

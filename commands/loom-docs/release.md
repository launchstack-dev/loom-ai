---
agent: skills/loom-docs-release/SKILL.md
description: "Post-ship doc sync — diff-driven README/CHANGELOG/ARCH updates + diagram drift detection + CHANGELOG sell-test rubric. Surfaces doc-debt in the PR body and exits non-zero when doc-debt is detected without a documented remediation plan."
---

# /loom-docs:release

Post-ship doc sync. See `skills/loom-docs-release/SKILL.md` for the full 7-phase workflow — read diff, classify changes, README parity check, CHANGELOG sell-test, diagram drift, DocSyncReport, exit + PR body.

## Flags

- `--base <ref>` — base git ref (default: `main` or last release tag).
- `--head <ref>` — head ref (default: `HEAD`).
- `--pr <number>` — render the doc-debt list into the PR body.
- `--plan <doc-debt-plan>` — acknowledge open doc-debt entries so the command exits 0.

## Exit Behavior

- **Non-zero exit** when `missingReadme` is non-empty and `--plan` is not supplied. This is the gate that prevents shipping code without shipping docs.
- **Zero exit** otherwise. CHANGELOG sell-test failures and diagram drift are warnings unless the change is a breaking change.

See SKILL.md.

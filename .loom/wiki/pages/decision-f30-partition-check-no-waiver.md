---
pageId: decision-f30-partition-check-no-waiver
category: decision
tags[5]: F-30,partition-check,fail-closed,C-15,design-decision
lastUpdated: 2026-07-11T00:00:00Z
updatedAt: 2026-07-11T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: F-30 partition-check is fail-closed with NO waiver by design — an explicit exception to C-15's every-gate-ships-an-escape rule because a pre-destructive-move partition failure is never safe to override; --dry-run and mandatory human confirm are the sole recourse.
estimatedTokens: 680
bodySections[4]: Summary,Decision,Rationale,Alternatives Considered
sourceRefs[2]:
  planning/ROADMAP.md
  .plan-execution/review-report.md
crossRefs[3]{pageId,relationship}:
  feature-m09-cartography-foundation,relates-to
  contract-map-artifact-schema,relates-to
  component-map-freshness-hook,relates-to
---

## Summary

F-30 (partition-check gate) is **fail-closed with no waiver escape** — an intentional, locked exception to C-15's rule that every gate ships an escape hatch. This decision was made during the C-17 fable-readiness reconciliation layer (applied 2026-07-11) and is not subject to further debate without re-opening C-17.

## Decision

F-30's partition-check has **no warn-ramp and no logged waiver** by design. The only recourse when the partition check fires is:

1. **`--dry-run`** — inspect what the move would do without executing it.
2. **Mandatory human confirm** — an explicit human acknowledgement step before any destructive multi-file move proceeds.

**Check-execution error behavior:** If the partition check itself cannot run (git errors, glob bug double-match, unreadable state), the check MUST fail-closed-with-logged-reason. It MUST NOT fail-open. A check that errors is treated as a failed check.

## Rationale

C-15 requires every gate to ship a warn-ramp + logged escape so that headless/CI/`/loom-auto` runs are not hard-blocked by transient misconfigurations. F-30 is a **destructive-move gate** — it guards a multi-file partition operation that cannot be rolled back trivially. The asymmetry of the risk changes the calculus:

- A transient misconfiguration that trips C-15's escape in a reversible gate wastes time but causes no data loss.
- A transient misconfiguration that bypasses F-30's partition-check before a destructive move can cause irreversible structural corruption.

The accepted risk model is: **false positives** (check fires when the partition is actually safe) are handled by `--dry-run` + human confirm, which are low-cost. **False negatives** (check passes when the partition is actually unsafe) are catastrophic and must not be enabled by a waiver escape.

This makes F-30 an explicit, deliberate exception to C-15 — not an oversight.

## Alternatives Considered

- **Add a logged `--force-partition` escape (C-15 conformance).** Rejected: any logged escape becomes a footgun in CI. A pipeline operator who sets `--force-partition` once to unblock CI creates a standing bypass that survives long after the original reason. The destructive nature of the operation means this is an unacceptable residual risk.
- **Downgrade to warn-first.** Rejected: a warn-first gate on a destructive multi-file move means the operation proceeds in unattended `--auto` mode the moment the grace period expires. Same footgun as above, worse UX.
- **Make the check optional (off by default, opt-in).** Rejected: this inverts the safety posture — every new project starts unprotected, and protection requires explicit action. Fail-closed default is the correct baseline.

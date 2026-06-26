---
pageId: waiver-m-06-precheck
category: waiver
tags[4]: waiver,M-06,M-08,parallelism
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: The M-08-PreCheck-M-06 waiver (granted 2026-06-26) permits F-18 Phases A-6 to execute while F-12 OSS Launch Phase 1 is incomplete, per ROADMAP §873 which explicitly allows this parallelism on non-overlapping surfaces.
estimatedTokens: 520
bodySections[3]: Summary,Status at Waiver Time,Rationale
relatedFiles[2]:
  planning/history/coverage/m-06-waiver.toon
  planning/plans/PLAN-F-18-matt-pocock-skills.md
crossRefs[1]{pageId,relationship}:
  feature-f18-mattpocock-skills-adoption,relates-to
---

## Summary

The M-08-PreCheck-M-06 gate (plan §1953) requires that F-12 OSS Launch Distribution Phase 1 be complete OR a waiver be on disk before Phase 2a implementer-agent spawns. This waiver was granted by operator (jensen) on 2026-06-26. Canonical waiver: `planning/history/coverage/m-06-waiver.toon` (in git; `.plan-execution/` is gitignored).

## Status at Waiver Time

| Item | Status |
|------|--------|
| F-12 Phase 0 | In-flight (4 of 6 deliverables shipped; cosign `workflow_dispatch` verification + 5-stranger cold-install demand test still open per ROADMAP §841) |
| F-12 Phase 1 | Not started (gated on Phase 0 completion) |

## Rationale

ROADMAP.md §873 explicitly permits this parallelism:

> "Phase A may begin in parallel with M-06 Phase 2 (launch) — its protocol/CONTEXT-split/ADR/migration work has no M-07 dependency. Phase B begins post-launch so it benefits from M-06 demand-validation feedback."

F-18 ships no runtime-distribution changes that conflict with the in-flight M-06 OSS launch work:
- No `install.sh` edits
- No signing workflow changes
- No release-workflow edits

The surfaces are disjoint. F-18 Phases A through 6 were executed against this roadmap-level permission.

## Revisit When

When F-12 Phase 1 ships, this waiver becomes historical. At that point Phase B's post-launch demand-validation feedback loop can be exercised against real install telemetry.

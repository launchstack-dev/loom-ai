---
pageId: state-machine-adr
category: state-machine
tags[4]: ADR,state-machine,proposed,superseded
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: The ADR status enum has 4 states (proposed / accepted / deprecated / superseded) with explicit transitions and ADR_REVIVAL_BLOCKED on attempts to un-retire superseded or deprecated records.
estimatedTokens: 620
bodySections[4]: Summary,States,Valid Transitions,Invalid Transitions
relatedFiles[2]:
  planning/plans/PLAN-F-18-matt-pocock-skills.md
  docs/adr/0000-adr-convention.md
crossRefs[2]{pageId,relationship}:
  feature-f18-mattpocock-skills-adoption,implemented-by
  command-loom-prototype,relates-to
---

## Summary

The ADR status enum (plan §533-564, F-18 Phase A, sub-3) governs the lifecycle of Architecture Decision Records stored at `docs/adr/{NNNN}-{kebab-title}.md`. ADRs are authored only when `loom-converge` resolves a blocking conflict or `loom-roadmap converge` records a load-bearing rejection — not lazy-on-first-write.

## States

```
proposed ─→ accepted ─→ deprecated
                  │           ▲
                  └─→ superseded ─→ (supersededBy points to newer ADR)
```

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| `proposed` | Drafted; not yet authoritative. | Default on creation. |
| `accepted` | Authoritative; reviewers must honour this record. | Operator marks accepted at a blocking conflict or load-bearing rejection. |
| `deprecated` | No longer authoritative; no replacement exists. | Operator marks deprecated. |
| `superseded` | Replaced by another ADR; `supersededBy` field set to the new ADR slug. | Operator writes a new ADR that supersedes this one. |

## ADR Schema Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `ADR-{NNNN}`, zero-padded 4-digit, monotonically allocated |
| `title` | string | one-line, max 120 chars |
| `status` | enum | `proposed \| accepted \| deprecated \| superseded` |
| `decision` | string | the chosen path, ≥1 paragraph |
| `rationale` | string | why; what was rejected; what was at stake |
| `supersededBy` | string\|null | FK `ADR-{NNNN}` when `status=superseded` |

## Valid Transitions

| From | To | Trigger | Side Effects |
|------|----|---------|--------------|
| `proposed` | `accepted` | Operator accepts | Cite ADR in reviewers in the affected area |
| `accepted` | `deprecated` | Operator deprecates | Reviewers stop citing it |
| `accepted` | `superseded` | New ADR created referencing this | Set `supersededBy` |
| `proposed` | `superseded` | New ADR supersedes a never-accepted proposal | Set `supersededBy` |

## Invalid Transitions

| From | To | Error Code | Message |
|------|----|-----------|---------|
| `superseded` | `accepted` | `ADR_REVIVAL_BLOCKED` | Write a fresh ADR; do not revive a superseded one |
| `deprecated` | `accepted` | `ADR_REVIVAL_BLOCKED` | Same — fresh ADR |

## ADRs shipped with F-18

| File | Title | Status |
|------|-------|--------|
| `docs/adr/0000-adr-convention.md` | ADR convention itself | accepted |
| `docs/adr/0001-hook-merge-decision-2026-04-25.md` | Hook merge decision | accepted |
| `docs/adr/0002-sign-off-as-sole-path-to-converged.md` | Sign-off as sole path to converged | accepted |
| `docs/adr/0003-archetype-selected-pedagogical-rubrics.md` | Archetype-selected pedagogical rubrics | accepted |

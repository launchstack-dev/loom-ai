---
pageId: state-machine-feedback-loop
category: state-machine
tags[5]: feedback-loop,state-machine,TRDA,stuck-at-loop-construction,loom-converge
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: The FeedbackLoop lifecycle has 8 states (construction → verified-red → iterating → green-candidate → retired, plus escape-set, escape-iterating, stuck-at-loop-construction) with explicit transitions, invalid-transition error codes, and a two-pass retirement ceremony.
estimatedTokens: 1050
bodySections[4]: Summary,States,Valid Transitions,Invalid Transitions
relatedFiles[1]:
  planning/plans/PLAN-F-18-matt-pocock-skills.md
crossRefs[2]{pageId,relationship}:
  protocol-feedback-loop,implements
  feature-f18-mattpocock-skills-adoption,implemented-by
---

## Summary

The FeedbackLoop state machine (plan §436-486) governs the lifecycle of every `loop.toon` artifact from creation through retirement. It has 8 states and 11 valid transitions. The `stuck-at-loop-construction` terminal state surfaces HITL escalation guidance rather than silently blocking.

## State Diagram

```
construction ──→ verified-red ──→ iterating ──→ green-candidate ──→ retired
     │                │                 │                                ▲
     │                │                 ▼                                │
     │                ▼          escape-iterating ──────────────────────→│
     │           escape-set ──→ escape-iterating
     │
     ▼
stuck-at-loop-construction (terminal until HITL intervention)
      │
      └── HITL writes revised loop.toon ──→ construction
```

## States

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| `construction` | `loop.toon` exists but TRDA gates have not all passed; rung may escalate. | Default on first write of `loop.toon`. |
| `verified-red` | TRDA all true; `verifiedRed: true`; `redOutput` captured. | All four `trda` booleans true AND `determinismRuns >= 2`. |
| `iterating` | A fixer/converger is acting against this loop; iterations bind to `loopId`. | Convergence iteration begins from `verified-red`. |
| `green-candidate` | Latest command run reported green; awaiting verification re-run. | Command exits 0. |
| `retired` | Symptom green twice in a row; `retiredAt` set. Immutable. | `loom-converge`/`loom-bugfix` confirms green-twice. |
| `escape-set` | `escapeReason` populated via `--override-loop-gate`. | Operator passes the escape flag. |
| `escape-iterating` | Iterations proceed without TRDA pass; flagged in digest. | Iteration begins from `escape-set`. |
| `stuck-at-loop-construction` | Rung 10 exhausted without TRDA pass. Terminal until HITL intervention; surfaces escalation guidance. | `rung == 10` after failed escalation. |

## Valid Transitions

| From | To | Trigger | Side Effects |
|------|----|---------|--------------|
| (none) | `construction` | First write of `loop.toon` | Atomic write `.tmp` → rename |
| `construction` | `construction` | Rung escalation along the ladder | Append row to `escalationHistory[]`; bump `rung` |
| `construction` | `verified-red` | All TRDA true and `determinismRuns >= 2` | Set `verifiedRed: true`; capture `redOutput` |
| `construction` | `escape-set` | `--override-loop-gate "<reason>"` | Set `escapeReason`; log to convergence digest |
| `construction` | `stuck-at-loop-construction` | `rung == 10` after failed escalation | Print HITL escalation guidance; halt fixer |
| `verified-red` | `iterating` | Iteration begins | — |
| `escape-set` | `escape-iterating` | Iteration begins under escape | Flag in digest |
| `iterating` | `green-candidate` | `command` exits 0 | — |
| `escape-iterating` | `green-candidate` | `command` exits 0 | — |
| `green-candidate` | `retired` | Verification re-run still green | Set `retiredAt` (ISO 8601), atomic write |
| `green-candidate` | `iterating` | Verification re-run goes red again | — |
| `stuck-at-loop-construction` | `construction` | HITL writes revised `loop.toon` | Append `escalationHistory[]` entry with `reason: hitl-revision` |

## Invalid Transitions

| From | To | Error Code | Message |
|------|----|-----------|---------|
| `retired` | any | `LOOP_IMMUTABLE` | Retired loops are queryable but never re-entered; spawn a new loop instead |
| `construction` | `iterating` | `LOOP_NOT_VERIFIED_RED` | Cannot iterate before TRDA pass or escape-set |
| `iterating` | `verified-red` | `INVALID_TRANSITION` | Forward-only; use the `iterating → green-candidate → iterating` cycle |
| `stuck-at-loop-construction` | `verified-red` | `HITL_REQUIRED` | Operator must revise the loop before TRDA re-evaluation |

## Related Pages

- [FeedbackLoop schema](protocol-feedback-loop.md)
- [F-18 feature overview](feature-f18-mattpocock-skills-adoption.md)

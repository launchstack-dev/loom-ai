# Coverage Matrix Schema

Spec→coverage matrix (roadmap C-08, CT6 A3 + GSD goal-backward lens). Written
to `.plan-execution/coverage-matrix.toon` by criteria-mode convergence
planning (criteria-planner-agent) and updated by fixers as gaps close.

The convergence step-recorder (`scripts/lib/engine/iterate.ts record`) counts
every non-`covered` row as a **blocking condition**: convergence cannot be
reached while a requirement — including a phase promise — is uncovered, even
when every task completed and the harness reports zero blocking findings
(M-2 metric "goal-backward convergence"). Each gap receives **one bounded
fix** per iteration from the Workflow driver — never an unbounded loop.

## Schema

```toon
schemaVersion: 1
generatedAt: 2026-07-09T12:00:00.000Z

matrix[3]{requirementId,requirementText,source,coverageStatus,testRefs}:
  C-01,Blocks unauthenticated requests,criteria,covered,S-01;S-02
  C-02,Returns the 401 error shape,criteria,uncovered,
  P-01,Admin audit log records every mutation,phase-promise,partial,S-07
```

## Field Reference

| Field | Type | Description |
|---|---|---|
| requirementId | string, unique | `C-NN` for plan acceptance criteria, `P-NN` for phase promises |
| requirementText | string | The requirement, one line (commas rendered as `;`) |
| source | `criteria` \| `phase-promise` | Where the requirement came from. `phase-promise` rows are the goal-backward set: what the phase PROMISED to deliver (see `protocols/phase-promise.schema.md`) |
| coverageStatus | `covered` \| `partial` \| `uncovered` | `covered` requires at least one passing testRef. `partial` and `uncovered` both count as gaps |
| testRefs | `;`-separated list | Scenario/test identifiers that verify the requirement |

## Rules

1. **Atomic writes** — `.tmp` + rename, like every engine artifact.
2. **Gaps block convergence.** The step-recorder adds `count(status != covered)`
   to the harness `blockingCount` before breaker evaluation.
3. **One bounded fix per gap.** The Workflow driver spawns exactly one fixer
   per gap per iteration, fitted to the remaining agent budget (cut logged).
   A gap that survives its fix simply remains a gap next iteration — the
   normal breakers (STALL/MAX_ITERATIONS) bound the loop.
4. **Fixers close their own rows.** A gap fix updates its row to `covered`
   with a `testRef`; the next `record` call picks the change up from disk.

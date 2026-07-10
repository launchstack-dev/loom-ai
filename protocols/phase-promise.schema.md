# Phase Promise Schema

Goal-backward verification input (roadmap C-08, GSD lens): when a phase's plan
is approved, its deliverables are captured as machine-readable **promises** at
`.plan-execution/phase-{N}-promise.toon`. Convergence then verifies the
artifact delivers what the phase PROMISED — not merely that its tasks
completed.

## Schema

```toon
schemaVersion: 1
phase: 3
promisedBy: planning/plans/PLAN.md
approvedAt: 2026-07-09T12:00:00.000Z

deliverables[2]{promiseId,type,description,testRef}:
  P-01,behavior,Admin audit log records every mutation,S-07
  P-02,export,authMiddleware registered before protected routes,
```

## Field Reference

| Field | Type | Description |
|---|---|---|
| phase | integer | Phase number from the plan |
| promisedBy | path | The plan file the promises were extracted from |
| approvedAt | ISO 8601 ms | When the plan/phase was approved |
| deliverables[].promiseId | string, unique | `P-NN` |
| deliverables[].type | `behavior` \| `export` \| `contract` \| `artifact` | What kind of promise |
| deliverables[].description | string | The promised outcome, one line |
| deliverables[].testRef | string, optional | Scenario/test that verifies it (empty until covered) |

## Flow

1. **Capture** — at plan approval (`/loom-plan execute` Step 1 or the Workflow
   driver's plan phase), phase deliverables + acceptance criteria are written
   as promises.
2. **Materialize** — criteria-planner-agent reads promise files and emits one
   `coverage-matrix.toon` row per deliverable (`source: phase-promise`,
   initially `uncovered` unless a testRef already passes).
3. **Enforce** — uncovered promise rows block convergence via the coverage
   matrix (`protocols/coverage-matrix.schema.md` rule 2).

Atomic writes throughout (`.tmp` + rename).

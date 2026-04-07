# Pipeline State Schema

Tracks meta-orchestrator state for `/loom-auto`. Written to `.plan-execution/pipeline-state.toon`. Enables `--resume` by recording the current stage, iteration count, agent budget, and full stage/failure history.

## Schema

```json
{
  "schemaVersion": "number — always 1",
  "runId": "string — UUID generated at pipeline start",
  "mode": "string — always 'auto'",
  "description": "string — the user's original description passed to --from",
  "planFile": "string — path to PLAN.md",
  "outerIteration": "number — 1-based, current plan-level iteration",
  "maxIterations": "number — outer loop cap, default 3",
  "agentsSpawned": "number — cumulative agents spawned across all stages, >= 0",
  "maxAgents": "number — agent budget ceiling, default 50",
  "fixCycleCount": "number — fix cycles used in the current iteration, 0-2",
  "currentStage": "plan-create | plan-review | plan-integrate | plan-validate | execute | test | review-code | fix-code | complete | escalated",

  "stageHistory": [
    {
      "stage": "string — one of currentStage enum values",
      "status": "succeeded | failed | in_progress | skipped",
      "iteration": "number — which outer iteration this entry belongs to",
      "startedAt": "string — ISO 8601",
      "completedAt": "string | null",
      "agentsUsed": "number — agents consumed by this stage",
      "gateResult": "proceed | fix-and-recheck | revise-plan | escalate | null"
    }
  ],

  "failureLog": [
    {
      "iteration": "number",
      "stage": "string — one of currentStage enum values",
      "error": "string — short description of the failure",
      "resolution": "wave-retry | fix-and-recheck | revise-plan | escalate"
    }
  ]
}
```

## Example

```toon
schemaVersion: 1
runId: uuid
mode: auto
description: "Build a task management API with auth and teams"
planFile: PLAN.md
outerIteration: 2
maxIterations: 3
agentsSpawned: 34
maxAgents: 50
fixCycleCount: 1
currentStage: fix-code

stageHistory[N]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:
  plan-create,succeeded,1,2026-04-06T10:00:00Z,2026-04-06T10:02:30Z,8,proceed
  execute,succeeded,1,2026-04-06T10:02:30Z,2026-04-06T10:15:00Z,18,proceed
  test,succeeded,1,2026-04-06T10:15:00Z,2026-04-06T10:18:00Z,3,proceed
  review-code,succeeded,1,2026-04-06T10:18:00Z,2026-04-06T10:22:00Z,5,fix-and-recheck
  fix-code,failed,1,2026-04-06T10:22:00Z,2026-04-06T10:25:00Z,2,revise-plan
  plan-revise,in_progress,2,2026-04-06T10:25:00Z,,0,

failureLog[N]{iteration,stage,error,resolution}:
  1,review-code,5-critical-findings,fix-and-recheck
  1,fix-code,2-critical-remaining-after-fix,revise-plan
```

## Rules

1. **Atomic writes.** Always write to `pipeline-state.toon.tmp` then rename to `pipeline-state.toon`. Never write directly.
2. **Resume semantics.** On `--resume`, read `currentStage` and `outerIteration` to determine re-entry point. If `currentStage` is `execute`, delegate to `loom-execute-plan --resume` for wave-level resume. For all other stages, restart the current stage from the beginning.
3. **Update on every stage transition.** Write the file at stage entry (status `in_progress`) and stage exit (status `succeeded` or `failed`).
4. **Failure dedup.** Before triggering `revise-plan`, check `failureLog` for identical errors in a prior iteration. If found, escalate immediately (identical-failure circuit breaker).

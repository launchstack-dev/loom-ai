# Pipeline State Schema

Tracks meta-orchestrator state for `/loom-auto`. Written to `.plan-execution/pipeline-state.toon`. Enables `--resume` by recording the current stage, iteration count, agent budget, and full stage/failure history.

## Schema

```toon
schemaVersion: 1
runId: uuid
mode: auto
description: "Build a task management API with auth and teams"
roadmapFile: ROADMAP.md
planFile: PLAN.md
outerIteration: 2
maxIterations: 3
agentsSpawned: 34
maxAgents: 50
fixCycleCount: 1
currentStage: fix-code

stageHistory[N]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:
  roadmap-create,succeeded,1,2026-04-06T09:55:00Z,2026-04-06T09:57:00Z,2,proceed
  roadmap-review,succeeded,1,2026-04-06T09:57:00Z,2026-04-06T09:59:00Z,3,proceed
  roadmap-integrate,succeeded,1,2026-04-06T09:59:00Z,2026-04-06T09:59:30Z,1,proceed
  roadmap-approve,succeeded,1,2026-04-06T09:59:30Z,2026-04-06T09:59:31Z,0,proceed
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
2. **Resume semantics.** On `--resume`, read `currentStage` and `outerIteration` to determine re-entry point. Roadmap stages (`roadmap-create`, `roadmap-review`, `roadmap-integrate`, `roadmap-approve`) re-enter at the corresponding roadmap step. If `currentStage` is `execute`, delegate to `loom-execute-plan --resume` for wave-level resume. For all other stages, restart the current stage from the beginning.
3. **Update on every stage transition.** Write the file at stage entry (status `in_progress`) and stage exit (status `succeeded` or `failed`).
4. **Failure dedup.** Before triggering `revise-plan`, check `failureLog` for identical errors in a prior iteration. If found, escalate immediately (identical-failure circuit breaker).

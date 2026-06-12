# Pipeline State Schema

Tracks meta-orchestrator state for `/loom-auto`. Written to `.plan-execution/pipeline-state.toon`. Enables `--resume` by recording the current stage, iteration count, agent budget, full stage/failure history, and (under schemaVersion 2) the chained-link trampoline cursor.

## Schema

```toon
schemaVersion: 2
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
convergenceEnabled: true
convergeTarget: tests/golden/api-responses.json
convergeConfig:
currentStage: link-complete-verify

# Trampoline cursor (schemaVersion 2+, optional on v1 reads)
nextLink: fix
trampolineIteration: 6
maxTrampolineIterations: 20

stageHistory[N]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:
  roadmap-create,succeeded,1,2026-04-06T09:55:00Z,2026-04-06T09:57:00Z,2,proceed
  plan-create,succeeded,1,2026-04-06T10:00:00Z,2026-04-06T10:02:30Z,8,proceed
  execute,succeeded,1,2026-04-06T10:02:30Z,2026-04-06T10:15:00Z,18,proceed
  converge,succeeded,1,2026-04-06T10:15:00Z,2026-04-06T10:17:00Z,5,proceed
  verify,succeeded,1,2026-04-06T10:17:00Z,2026-04-06T10:24:00Z,2,fix-and-recheck
  fix-code,succeeded,1,2026-04-06T10:24:00Z,2026-04-06T10:27:00Z,3,proceed

linkHistory[N]{link,status,trampolineIteration,outerIteration,startedAt,completedAt,agentsUsed,nextLink,nextLinkReason}:
  verify,complete,1,1,2026-04-06T10:17:00Z,2026-04-06T10:24:00Z,2,fix,fix-and-recheck
  fix,complete,2,1,2026-04-06T10:24:00Z,2026-04-06T10:27:00Z,3,verify,proceed
  verify,complete,3,1,2026-04-06T10:27:00Z,2026-04-06T10:30:00Z,2,done,proceed

failureLog[N]{iteration,stage,error,resolution}:
  1,verify,5-critical-findings,fix-and-recheck
```

## Field Reference

### Core orchestration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | int | yes | `1` (legacy) or `2` (chained-link). v2 adds the trampoline cursor and `linkHistory[]`. Readers MUST tolerate v1 files for back-compat. |
| `runId` | uuid | yes | Unique identifier for this `/loom-auto` invocation. |
| `mode` | enum | yes | Always `auto` for this schema. |
| `description` | string | yes | User-provided `--from` description, or `"Existing plan: {planFile}"`. |
| `roadmapFile` | path | yes | Path to ROADMAP.md (default `ROADMAP.md`). |
| `planFile` | path | yes | Path to PLAN.md (default `PLAN.md`). |
| `outerIteration` | int | yes | Outer plan-revision counter. Increments on REVISE-PLAN / REVISE-ROADMAP. |
| `maxIterations` | int | yes | Outer iteration cap (default `3`). |
| `agentsSpawned` | int | yes | Cumulative count of agents spawned this run. Includes link sub-agents. |
| `maxAgents` | int | yes | Agent budget cap (default `50`). |
| `fixCycleCount` | int | yes | Fix-cycle counter within the current outer iteration. Reset on REVISE-*. |
| `convergenceEnabled` | bool | yes | True if `--converge-target`, `--converge-config`, or `--converge-criteria` was set. |
| `convergeTarget` | path \| null | yes | Path to convergence target file, or null. |
| `convergeConfig` | path \| null | yes | Path to `converge.config`, or null. |
| `currentStage` | string | yes | Current pipeline cursor. See "Stage Vocabulary" below. |

### Trampoline cursor (schemaVersion 2+)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `nextLink` | enum | yes (v2) | What link the trampoline should dispatch next: `planning`, `execute`, `converge`, `verify`, `fix`, `done`. On a v2 file with `currentStage: complete` or `escalated`, set to `done`. |
| `trampolineIteration` | int | yes (v2) | Number of links dispatched so far in this run. Increments on every link dispatch, regardless of outcome. |
| `maxTrampolineIterations` | int | yes (v2) | Trampoline circuit-breaker cap (default `20`). Trampoline halts and escalates when reached. |

### History arrays

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stageHistory[N]` | array | yes | Per-stage record. Carried forward for back-compat with v1 consumers (status line, `/loom status`). Every link writes a stageHistory entry on completion using its link name as `stage`. |
| `linkHistory[N]` | array | yes (v2) | Per-link record. The trampoline appends one entry per dispatched link. Fields: `link`, `status`, `trampolineIteration`, `outerIteration`, `startedAt`, `completedAt`, `agentsUsed`, `nextLink`, `nextLinkReason`. |
| `failureLog[N]` | array | yes | Failures requiring revision or escalation. Used for identical-failure circuit breaker. Schema unchanged from v1. |

## Stage Vocabulary

Values `currentStage` may take. The trampoline writes the `link-complete-{name}` form when a link completes; the `nextLink` field carries the dispatch decision separately.

| Value | Meaning |
|-------|---------|
| `roadmap-create`, `roadmap-review`, `roadmap-integrate`, `roadmap-approve` | Roadmap link sub-stages (still inline today; will move to a `planning` link in Phase 4 of the chained-link migration). |
| `preflight-complete` | Pre-flight scope contract done. |
| `plan-create`, `plan-interpret`, `plan-review`, `plan-integrate`, `plan-validate` | Plan link sub-stages. |
| `execute` | Execution link in progress. |
| `converge` | Convergence link in progress. |
| `verify` | Verify link in progress. |
| `link-complete-{name}` | Trampoline has read the link's `link-result.toon` and is about to route on `nextLink`. Common forms: `link-complete-execute`, `link-complete-verify`, `link-complete-fix`. |
| `fix-code` | Fix link in progress. |
| `complete` | Pipeline finished successfully. Set `nextLink: done`. |
| `escalated` | Circuit breaker tripped or ESCALATE decision. Set `nextLink: done`. |

## Rules

1. **Atomic writes.** Always write to `pipeline-state.toon.tmp` then rename to `pipeline-state.toon`. Never write directly.
2. **Resume semantics.** On `--resume`, read `currentStage` (v1) or `nextLink` + `currentStage` (v2) to determine re-entry. The trampoline uses `nextLink` when present; `currentStage` is the v1 fallback. If a link's `link-result.toon` already exists for the current `trampolineIteration`, the link's own idempotent-resume contract applies — do not re-dispatch.
3. **Update on every transition.** Write the file at stage entry (`status: in_progress`) and stage exit (`status: succeeded` or `failed`). Links additionally write `linkHistory[]` on exit.
4. **Failure dedup.** Before triggering `revise-plan`, check `failureLog` for identical errors in a prior iteration. If found, escalate immediately (identical-failure circuit breaker).
5. **Trampoline circuit breaker.** If `trampolineIteration >= maxTrampolineIterations`, override `nextLink` to `done` and `currentStage` to `escalated`. Write the escalation report.
6. **Counter ownership.** `trampolineIteration` is incremented by the trampoline only, never by a link. `linkHistory[]` is appended by the link (on exit) AND by the trampoline (if the link crashed without writing). `outerIteration` is incremented by the trampoline based on link guidance (`planningHints.incrementOuterIteration`).
7. **v1 → v2 migration.** A v1 file is upgraded in place on first v2 read: set `schemaVersion: 2`, derive `nextLink` from `currentStage` (map per Stage Vocabulary), set `trampolineIteration: 0`, set `maxTrampolineIterations: 20`, leave `linkHistory[]` empty. Never downgrade v2 → v1.

## Cross-references

- `link-result.schema.md` — the envelope each dispatched link writes to `.plan-execution/link-result.toon`. The trampoline reads it on link return and translates `nextLink` / `nextLinkReason` into `pipeline-state.toon` updates per Rule 6.
- `stage-context.schema.md` — the per-stage summary files each link writes alongside its `link-result.toon`. Stage-context files are consumed by subsequent links; `pipeline-state.toon` only references them via `linkHistory[]` entries.
- `~/.claude/commands/loom-auto.md` — the trampoline that reads and writes this file.
- `~/.claude/commands/loom-auto/links/*.md` — link instructions; each link describes which `pipeline-state.toon` fields it reads and writes.

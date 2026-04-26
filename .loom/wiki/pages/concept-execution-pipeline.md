```toon
pageId: concept-execution-pipeline
title: Execution Pipeline
category: concept
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: agents/protocols/execution-conventions.md, agents/protocols/pipeline-state.schema.md
crossRefs[3]{pageId,relationship}:
  concept-convergence,relates-to
  convention-agent-result,relates-to
  component-orchestration-patterns,relates-to
tags[5]: pipeline, waves, execution, state, contracts
staleness: fresh
confidence: high
```

# Execution Pipeline

The Loom execution pipeline is a staged, wave-based system for coordinating parallel agent work. It provides file ownership enforcement, resumable state, and structured handoffs between stages.

Source: `agents/protocols/execution-conventions.md`, `agents/protocols/pipeline-state.schema.md`

---

## Pipeline Stages

The full `/loom-auto` pipeline runs these stages in order:

```
roadmap-create → roadmap-review → roadmap-integrate → roadmap-approve
    ↓
plan-create
    ↓
execute  (Wave 0: contracts → Wave 1+: parallel implementers)
    ↓
converge  (optional — match outputs to deterministic targets)
    ↓
test
    ↓
review-code
    ↓
fix-code  (if review found issues)
    ↓
done
```

Each stage transition is recorded in `pipeline-state.toon`. On `--resume`, the orchestrator reads `currentStage` to re-enter at the correct point.

---

## Wave-Based Execution

The execution stage uses a wave model:

### Wave 0 — Contracts

`contracts-agent` (opus) runs first, alone. It produces:
- Shared TypeScript types and interfaces
- Database schemas
- API contracts
- A `manifest.toon` listing all contract files and their exports

Wave 0 must complete successfully before any Wave 1 agents are spawned. This is the critical serialization point — all downstream agents depend on these shared types.

### Wave 1+ — Parallel Implementers

Multiple `implementer-agent` (opus) instances run in parallel. Each receives:
- The contract files from Wave 0
- Its specific task from PLAN.md
- A file ownership list (which files it may create or modify)

**No two agents may write the same file.** File ownership is assigned by the orchestrator before Wave 1 begins and enforced throughout execution. Violations are detected by `verification-agent` after each wave.

If an implementer needs to modify a file owned by another agent, it writes a `crossBoundaryRequest` in its AgentResult. The orchestrator's wiring step processes these after all Wave N agents complete.

---

## File Ownership

File ownership is the mechanism that prevents merge conflicts in parallel execution:

1. The orchestrator assigns each task a list of files it may create/modify
2. Agents must not write outside their ownership list
3. `verification-agent` runs after each wave and detects drift (files modified by agents that don't own them)
4. Cross-boundary needs are handled via `crossBoundaryRequests` in AgentResult

---

## Pipeline State Tracking

State is written to `.plan-execution/pipeline-state.toon` at every stage transition (entry as `in_progress`, exit as `succeeded` or `failed`):

```toon
schemaVersion: 1
runId: uuid
mode: auto
currentStage: fix-code
outerIteration: 2
maxIterations: 3
agentsSpawned: 34
maxAgents: 50

stageHistory[N]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:
  contracts,succeeded,1,2026-04-06T10:00:00Z,2026-04-06T10:02:30Z,1,proceed
  execute,succeeded,1,2026-04-06T10:02:30Z,2026-04-06T10:15:00Z,18,proceed
  ...
```

**Atomic writes** are mandatory: write to `pipeline-state.toon.tmp` then rename. Never write directly.

The `failureLog` tracks identical-failure patterns across iterations. If the same error recurs, an identical-failure circuit breaker escalates immediately rather than running another fix cycle.

---

## Stage Context and Rolling Context

### Stage Summaries

Every pipeline stage writes a structured `StageContext` summary to `.plan-execution/stage-context/{stage}.toon`. This is the authoritative record of what happened in each stage — what files were touched, what issues were found, what decisions were made.

Writes must be atomic: write to `{path}.tmp`, then `fs.renameSync` to `{path}`.

### Rolling Context

`.plan-execution/rolling-context.md` is a compressed derivative of stage summaries — a human-readable narrative that gives subsequent agents the essential context from prior stages without consuming the full token budget of raw results.

Stage summaries are the **source of truth**. Rolling context is a **compressed derivative**. If they disagree, the stage summary wins.

---

## Directory Structure

```
.plan-execution/
├── .lock                       # PID lock — prevents concurrent runs
├── state.toon                  # Execution state (resumable)
├── pipeline-state.toon         # /loom-auto pipeline state
├── rolling-context.md          # Compressed narrative of prior waves
├── contracts/                  # Wave 0 output
│   ├── manifest.toon           # Contract file registry
│   └── [contract files]        # types.ts, schema.sql, api-types.ts, etc.
├── progress/                   # Agent heartbeat files (ephemeral per wave)
│   └── {taskId}.toon
├── requests/                   # Cross-boundary requests
│   └── {taskId}.toon
├── scope-coverage.toon         # Acceptance criteria coverage matrix
├── stage-context/              # Structured stage summaries
│   ├── contracts.toon
│   ├── execute.toon
│   ├── test.toon
│   ├── review.toon
│   ├── fix.toon
│   └── converge.toon
├── conflicts/                  # Interpretation conflict reports
│   └── {conflictId}.toon
├── convergence/
│   ├── iterations/             # Per-iteration summaries
│   └── e2e/                    # E2E convergence artifacts
├── wave-0-summary.toon         # Machine-readable wave summary
├── wave-0-summary.md           # Human-readable wave summary
└── wave-N-summary.{toon,md}    # Subsequent waves
```

---

## Resumability

The pipeline is fully resumable at any stage boundary:

- On `--resume`, read `currentStage` and `outerIteration` from `pipeline-state.toon`
- Roadmap stages re-enter at the corresponding roadmap step
- `execute` delegates to `loom-execute-plan --resume` for wave-level resume
- `converge` delegates to `loom-converge --resume` for iteration-level resume
- All other stages restart from the beginning of that stage

---

## Agent Budget

The pipeline tracks `agentsSpawned` against `maxAgents` (configured via `--max-agents` flag, default 50):

- Warn at 80% of budget consumed
- Hard-block new spawns at 100%
- Each orchestration pattern reports `agentsUsed` to accumulate toward this count

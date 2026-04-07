# Execution State Schema

Tracks execution progress for resume, auditing, and orchestrator decision-making. Written to `.plan-execution/state.toon`.

## Schema

```toon
schemaVersion: 1
runId: a1b2c3d4-uuid
planFile: PLAN.md
status: running
currentWave: 1
startedAt: 2026-04-07T10:00:00Z
updatedAt: 2026-04-07T10:15:00Z

0:
  status: succeeded
  startedAt: 2026-04-07T10:00:00Z
  completedAt: 2026-04-07T10:05:00Z
  agents: contracts-agent
  tasks[2]{taskId,agent,description,status,fileOwnership,retryCount,startedAt,completedAt}:
    task-001,contracts-agent,Create shared types,succeeded,src/types.ts,0,2026-04-07T10:00:00Z,2026-04-07T10:03:00Z
    task-002,contracts-agent,Create API schemas,succeeded,src/schema.ts,0,2026-04-07T10:00:00Z,2026-04-07T10:04:00Z
  summaryFile: .plan-execution/wave-0-summary.toon
  verificationResult: pass
  verificationChecks[2]{name,status,details}:
    typecheck,pass,
    lint,pass,
  gateApproval: approved

1:
  status: in_progress
  startedAt: 2026-04-07T10:05:00Z
  completedAt:
  agents: implementer-agent
  tasks[2]{taskId,agent,description,status,fileOwnership,retryCount,startedAt,completedAt}:
    task-003,implementer-agent,Implement auth routes,in_progress,src/routes/auth.ts,0,2026-04-07T10:05:00Z,
    task-004,implementer-agent,Implement user routes,pending,src/routes/users.ts,0,,
  summaryFile:
  verificationResult:
  gateApproval: pending

rollingContextFile: .plan-execution/rolling-context.md
lockPid: 12345
```

## Rules

1. **Atomic writes.** Always write to `state.toon.tmp` then rename to `state.toon`. Never write directly.
2. **Update `updatedAt`** on every state change.
3. **Lock file.** Before starting execution, write PID to `.plan-execution/.lock`. Check on startup — if lock exists and PID is alive, abort with error.
4. **Drift detection on resume.** Before `--resume`, compare current file hashes against `fileHashes` from the last completed wave. Warn if any differ.
5. **Retry tracking.** Increment `retryCount` before each retry. If `retryCount >= 2`, mark as failed and report to user.
6. **Wave keys are string numbers** ("0", "1", "2") matching TOON block notation.

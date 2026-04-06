# Execution State Schema

Tracks execution progress for resume, auditing, and orchestrator decision-making. Written to `.plan-execution/state.toon`.

## Schema

```json
{
  "schemaVersion": 1,
  "runId": "string — UUID generated at execution start",
  "planFile": "string — path to the plan being executed",
  "status": "initializing | running | paused | completed | failed",
  "currentWave": "number — index of the wave currently executing or next to execute",
  "startedAt": "string — ISO 8601 timestamp",
  "updatedAt": "string — ISO 8601 timestamp — updated on every state change",

  "waves": {
    "0": {
      "status": "pending | in_progress | succeeded | failed | skipped",
      "startedAt": "string | null",
      "completedAt": "string | null",
      "agents": ["string — agent names involved in this wave"],
      "tasks": [
        {
          "taskId": "string — unique within this run",
          "agent": "string — which agent type handles this",
          "description": "string — short task description",
          "status": "pending | in_progress | succeeded | failed",
          "fileOwnership": ["string — paths this task may modify"],
          "retryCount": "number — incremented on each retry, max 2",
          "result": "AgentResult | null — populated on completion",
          "startedAt": "string | null",
          "completedAt": "string | null"
        }
      ],
      "summaryFile": "string | null — path to wave-N-summary.toon",
      "verificationResult": {
        "status": "pass | fail | null",
        "checks": [
          {
            "name": "string — e.g., 'typecheck', 'tests', 'lint', 'ownership-drift'",
            "status": "pass | fail",
            "details": "string | null — error output if failed"
          }
        ]
      },
      "gateApproval": "approved | rejected | pending | null",
      "fileHashes": {
        "description": "Content hashes of key files at wave completion, for drift detection on resume",
        "contracts": {"path": "sha256-hash"},
        "modified": {"path": "sha256-hash"}
      }
    }
  },

  "rollingContextFile": "string — path to rolling-context.md",
  "lockPid": "number | null — PID of the process holding the execution lock"
}
```

## Rules

1. **Atomic writes.** Always write to `state.toon.tmp` then rename to `state.toon`. Never write directly.
2. **Update `updatedAt`** on every state change.
3. **Lock file.** Before starting execution, write PID to `.plan-execution/.lock`. Check on startup — if lock exists and PID is alive, abort with error.
4. **Drift detection on resume.** Before `--resume`, compare current file hashes against `fileHashes` from the last completed wave. Warn if any differ.
5. **Retry tracking.** Increment `retryCount` before each retry. If `retryCount >= 2`, mark as failed and report to user.
6. **Wave keys are string numbers** ("0", "1", "2") for JSON compatibility.

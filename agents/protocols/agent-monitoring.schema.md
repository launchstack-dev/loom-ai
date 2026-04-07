# Agent Monitoring Protocol

Canonical specification for runtime monitoring of background agents. This protocol enables the orchestrator to track agent progress, detect hung agents, and intervene when necessary.

All orchestrators (`/loom-execute-plan`, `/loom-roadmap`) and all execution agents (`implementer-agent`, `contracts-agent`, `wiring-agent`, `verification-agent`) MUST conform to this spec.

## Progress File

Each agent writes periodic updates to `.plan-execution/progress/{taskId}.toon`.

```toon
taskId: task-003
agent: implementer-agent
wave: 1
phase: implementing
percentComplete: 65
currentActivity: "Writing auth middleware"
filesWritten[2]: src/routes/auth.ts, src/middleware/jwt.ts
issuesSoFar: 0
heartbeatAt: 2026-04-07T10:12:30Z
startedAt: 2026-04-07T10:05:00Z
checkpointCount: 8
```

## Phase Lifecycle

Agents transition through phases in order. Each phase has an expected `percentComplete` range.

| Phase | Range | Description |
|-------|-------|-------------|
| `initializing` | 0–5% | Agent started, reading prompt and setup |
| `reading-contracts` | 5–15% | Reading contract files and existing code |
| `implementing` | 15–85% | Writing code, the main work phase |
| `writing-files` | 85–95% | Finishing file writes, formatting |
| `finalizing` | 95–100% | Preparing AgentResult, last checkpoint |

Phases are strictly ordered. An agent MUST NOT move backward to a previous phase.

## Heartbeat Protocol

1. Agents SHOULD write a progress update every **30 seconds**.
2. Each write MUST use atomic writes (write `.tmp`, rename) per `execution-conventions.md`.
3. Each write MUST increment `checkpointCount`.
4. `heartbeatAt` MUST reflect the actual time of the write.
5. `percentComplete` MUST be monotonically non-decreasing.

## Orchestrator Polling Protocol

After spawning agents, the orchestrator polls progress files on a recurring interval.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pollIntervalSeconds` | 15 | How often to read progress files |
| `staleThresholdSeconds` | 90 | Heartbeat older than this = "stale" |
| `silentGraceSeconds` | 120 | Grace period before warning on missing progress file |
| `timeoutSeconds` | 600 | Default per-agent timeout |

### Status Classification

| Status | Condition |
|--------|-----------|
| `reporting` | Progress file exists, `heartbeatAt` within `staleThresholdSeconds` |
| `silent` | No progress file exists (agent may not support protocol or just started) |
| `stale` | Progress file exists but `heartbeatAt` older than `staleThresholdSeconds` |
| `completed` | Agent has returned its final AgentResult |
| `timed-out` | Agent exceeded configured timeout |

### Escalation Protocol

1. **Silent > `silentGraceSeconds`:** Log warning, continue waiting.
2. **Stale > 1× `staleThresholdSeconds`:** Log warning in dashboard.
3. **Stale > 2× `staleThresholdSeconds`:** Send heartbeat nudge via `SendMessage`.
4. **Stale > 3× `staleThresholdSeconds`:** Present options to user (wait / message / mark failed).
5. **Wall clock > `timeoutSeconds`:** Present timeout options to user.

### SendMessage Intervention

Messages to agents use these prefixes:

| Prefix | Meaning |
|--------|---------|
| `MONITORING:` | Automated heartbeat nudge |
| `REDIRECT:` | User-initiated change of direction |
| `TIMEOUT_WARNING:` | Agent is approaching its timeout limit |

Agents SHOULD check for messages at natural breakpoints (between file writes) and acknowledge by updating their progress file.

## Dashboard Format

The orchestrator renders a progress dashboard after each poll cycle.

```
=== Wave 2 Progress (4 agents) ===  [elapsed: 3m 42s]

  task-2a  implementer  ██████████░░░░░░  65%  implementing   "Writing auth middleware"   ♥ 8s ago
  task-2b  implementer  ████████████░░░░  78%  writing-files  "Created 4/6 routes"       ♥ 3s ago
  task-2c  implementer  ████░░░░░░░░░░░░  25%  implementing   "Reading user model"       ♥ 22s ago
  task-2d  implementer  ░░░░░░░░░░░░░░░░   0%  (silent)       —                          ♥ --

  Completed: 0/4  |  Stale: 0  |  Timed out: 0
```

Progress bar: 16 characters, 1 block per ~6.25%. `♥` shows heartbeat recency.

## Timeout Defaults by Agent Type

| Agent | Timeout |
|-------|---------|
| `contracts-agent` | 300s (5 min) |
| `implementer-agent` | 900s (15 min) |
| `wiring-agent` | 600s (10 min) |
| `verification-agent` | 300s (5 min) |
| `plan-builder-agent` | 300s (5 min) |

Override via `orchestration.toml` `[settings.monitoring]`.

## Graceful Degradation

The monitoring protocol is **ADDITIVE** — it never gates execution:

1. If an agent never writes a progress file, the orchestrator classifies it as `silent` and falls back to the current behavior (wait for completion notification).
2. If progress files are malformed, the orchestrator ignores them and logs a warning.
3. If the orchestrator cannot read progress files (permissions, missing directory), it continues without monitoring.

## Relationship to AgentResult

AgentProgress is **INFORMATIONAL** during execution. AgentResult is **AUTHORITATIVE** on completion.

1. Progress files are ephemeral — cleared at the start of each wave.
2. The final AgentResult is the source of truth for files created, issues found, etc.
3. If `progress.filesWritten` disagrees with `AgentResult.filesCreated`, AgentResult wins.

## Cleanup

The `.plan-execution/progress/` directory is:

1. **Created** by the orchestrator at wave initialization.
2. **Cleared** at the start of each wave (remove all `{taskId}.toon` files).
3. **Not preserved** in wave summaries (ephemeral monitoring data).

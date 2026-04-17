# Team Coordination Protocol

Defines the agent team coordination protocol for multi-agent pipeline execution using Claude Code's experimental agent teams feature.

## Architecture

```
Lead Dispatcher (thin context)
├── execute-teammate (full 200k window)
│   ├── subagent-1 (parallel work)
│   └── subagent-2 (parallel work)
├── review-teammate (full 200k window)
│   └── subagent-1 (parallel work)
├── test-teammate (full 200k window)
├── converge-teammate (full 200k window)
│   ├── subagent-1 (parallel work)
│   └── subagent-2 (parallel work)
└── fix-teammate (full 200k window)
    └── subagent-1 (parallel work)
```

### Roles

| Role | Context | Responsibilities |
|------|---------|-----------------|
| **Lead dispatcher** | Thin -- pipeline state + stage summaries only | Assigns stages, reads stage context from disk, routes messages, monitors progress. |
| **Stage teammate** | Full 200k window | Executes a single pipeline stage with full context. Reads its own instructions and stage summaries from disk. |
| **Subagent** | Scoped to subtask | Handles parallel subtasks within a stage (e.g., parallel file implementation, parallel review). |

### Hard Limits

- **Teammates can spawn subagents** at depth 1 for parallel work within their stage.
- **Subagents CANNOT spawn subagents.** Maximum spawn depth is 1 from any teammate.
- **Teammates CANNOT create their own teams.** Only the lead dispatcher creates teammates.
- **Requires** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` environment variable.

## TeamMessage Format

All inter-agent communication uses TOON-encoded messages.

```toon
from: lead
to: execute
type: stage-complete
payload:
  stage: execute
  wave: 2
  summary: Implemented auth middleware and user CRUD endpoints across 3 files.
  filesChanged[3]: src/auth/middleware.ts,src/routes/users.ts,src/services/user-service.ts
timestamp: 2026-04-17T09:18:42Z
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Sender identifier: `lead` or a stage name (`execute`, `review`, `test`, `converge`, `fix`). |
| `to` | string | Recipient identifier: `lead` or a stage name. |
| `type` | enum | One of: `stage-complete`, `stage-summary`, `budget-warning`, `checkpoint-request`. |
| `payload` | TOON block | Message content, structure depends on `type`. |
| `timestamp` | ISO 8601 | When the message was sent. |

## Message Types

### stage-complete

Sent by teammate to lead when a stage finishes.

```toon
from: execute
to: lead
type: stage-complete
payload:
  stage: execute
  wave: 2
  status: success
  summary: Implemented auth middleware and user CRUD endpoints across 3 agents.
  filesChanged[6]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts,src/routes/auth.ts,src/routes/users.ts,src/services/user-service.ts
  exportsAdded[5]: authMiddleware,signToken,verifyToken,UserService,authRouter
  durationMs: 522000
timestamp: 2026-04-17T09:18:42Z
```

### stage-summary

Sent by lead to teammate when assigning a new stage, carrying context from prior stages.

```toon
from: lead
to: review
type: stage-summary
payload:
  assignedStage: review
  wave: 2
  acceptanceCriteria[3]:
    Auth middleware validates JWT and rejects expired tokens
    User CRUD endpoints follow REST conventions
    All database queries use parameterized statements
  fileOwnership[6]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts,src/routes/auth.ts,src/routes/users.ts,src/services/user-service.ts
  priorStageSummary: Implemented auth middleware with JWT validation and user CRUD endpoints across 3 agents. JWT refresh uses sliding window. Passwords hashed with bcrypt cost 12.
  stageContextPath: .plan-execution/stage-context/execute.toon
  contractPaths[2]: .plan-execution/contracts/types.ts,.plan-execution/contracts/api-types.ts
timestamp: 2026-04-17T09:19:00Z
```

### budget-warning

Sent by teammate to lead when approaching the context budget cap.

```toon
from: converge
to: lead
type: budget-warning
payload:
  estimatedUsed: 155000
  budgetCap: 200000
  utilization: 0.775
  iteration: 3
  message: Approaching budget cap at iteration 3. 4 findings remain. May need checkpoint before next iteration.
timestamp: 2026-04-17T09:42:00Z
```

### checkpoint-request

Sent by lead to teammate, instructing it to write state and prepare for potential context clear.

```toon
from: lead
to: converge
type: checkpoint-request
payload:
  reason: budget-warning
  writeTargets[2]:
    .plan-execution/stage-context/converge.toon
    .plan-execution/convergence/iterations/iter-3.toon
  message: Write current state to disk. Prepare for potential context clear and teammate replacement.
timestamp: 2026-04-17T09:42:05Z
```

## Message Flows

### Flow 1: Stage Assignment

```
Lead                          Teammate
  │                              │
  │──── stage-summary ──────────>│  Lead sends assignment with context paths
  │                              │  Teammate reads stage summaries from DISK
  │                              │  Teammate reads contracts from DISK
  │                              │  Teammate executes stage work
  │                              │  Teammate spawns subagents if needed
  │                              │  Teammate writes stage summary to DISK
  │<──── stage-complete ─────────│  Teammate reports completion
  │                              │
```

### Flow 2: Budget Warning

```
Lead                          Teammate
  │                              │
  │                              │  Teammate detects budget threshold
  │<──── budget-warning ─────────│  Teammate warns lead
  │──── checkpoint-request ─────>│  Lead requests state checkpoint
  │                              │  Teammate writes state to disk
  │<──── stage-complete ─────────│  Teammate completes (or lead replaces)
  │                              │
```

### Flow 3: Full Pipeline

```
Lead
  │
  │──── stage-summary ──────────> execute-teammate
  │<──── stage-complete ──────── execute-teammate
  │
  │  (Lead reads execute stage context from disk)
  │
  │──── stage-summary ──────────> review-teammate
  │<──── stage-complete ──────── review-teammate
  │
  │  (Lead reads review stage context from disk)
  │
  │──── stage-summary ──────────> test-teammate
  │<──── stage-complete ──────── test-teammate
  │
  │  (Lead reads test stage context from disk, decides if convergence needed)
  │
  │──── stage-summary ──────────> converge-teammate
  │<──── budget-warning ──────── converge-teammate
  │──── checkpoint-request ─────> converge-teammate
  │<──── stage-complete ──────── converge-teammate
  │
```

## Teammate Lifecycle

1. **Lead creates teammate** with a `stage-summary` message containing the stage assignment, acceptance criteria, file ownership, and paths to stage context and contract files on disk.

2. **Teammate reads stage summaries from disk** -- not from the lead's context. The lead provides file paths; the teammate reads the content. This keeps the lead's context thin.

3. **Teammate spawns subagents** for parallel work within its stage. Subagents receive scoped subtasks (e.g., "implement these 3 files" or "review this module"). Subagents cannot spawn further subagents.

4. **Teammate writes stage summary to disk** at `.plan-execution/stage-context/{stage}.toon` using atomic writes (write `.tmp`, rename). See `stage-context.schema.md` for the format.

5. **Teammate messages lead** with `stage-complete`, including a compact summary. The lead reads the full stage context from disk if needed for the next stage assignment.

## Fallback Detection

The team coordination protocol requires the experimental agent teams feature. When unavailable, the system falls back to checkpoint+clear mode.

### Detection Logic

```
1. Check env: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
2. If set to "1" → use team coordination protocol
3. If not set or set to any other value → fall back to checkpoint+clear mode
```

### Team Mode (env var set)

- Lead dispatcher creates teammates for each pipeline stage.
- Teammates run in parallel where stages allow (e.g., independent review agents).
- Stage context passes through disk files, not through lead's context window.
- Lead maintains thin state: pipeline position, stage outcomes, budget tracking.

### Checkpoint+Clear Mode (env var not set)

- Single agent executes stages sequentially.
- After each stage, agent writes stage context to disk (same format as team mode).
- Agent checks budget utilization against checkpoint thresholds.
- At checkpoint warning: compress context aggressively, drop cold history.
- At checkpoint critical: write full state to disk, clear context, reload from stage summaries.
- Rolling-context.md serves as the primary context bridge across clears.

### Compatibility

Both modes write identical stage context files to `.plan-execution/stage-context/`. This means:

- A pipeline started in team mode can be resumed in checkpoint+clear mode (and vice versa).
- Stage context files are the shared contract between both execution modes.
- The orchestrator does not need to know which mode produced a stage context file.

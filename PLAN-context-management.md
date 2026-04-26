---
planVersion: 1
name: "Loom Context Management System"
status: approved
created: 2026-04-17
lastReviewed: null
roadmapRef: null
totalPhases: 7
totalWaves: 4
---

# Plan: Loom Context Management System

## Overview

Builds the preemptive context management infrastructure for Loom's multi-agent orchestration pipeline. The system uses a two-path architecture: agent teams as the primary mode for `/loom-auto` (thin lead dispatcher with stage teammates, each a full 200k-window agent), and checkpoint+clear as the fallback for non-auto commands or when agent teams are unavailable. Both paths share a common foundation of stage summaries written to disk at every stage boundary, enforced by a 100k hard-cap context budget per agent.

## Tech Stack

- **TypeScript** for hooks (`hooks/context-budget.ts`, `hooks/checkpoint-trigger.ts`)
- **bun** as runtime for hooks and tests
- **vitest** for test suites
- **Markdown** for protocol specs and agent definitions
- **TOON** for all on-disk artifacts (stage summaries, iteration summaries, budget estimates)

## Schema / Type Definitions

### StageContext

The on-disk format for stage summaries written at every pipeline stage boundary.

| Field | Type | Constraints |
|-------|------|-------------|
| stage | string | One of: contracts, execute, review, test, converge, fix |
| wave | integer | >= 0 |
| iteration | integer | >= 0, only set during convergence |
| startedAt | string | ISO 8601 timestamp |
| completedAt | string | ISO 8601 timestamp |
| durationMs | integer | >= 0 |
| inputTokensEstimate | integer | Estimated tokens consumed entering this stage |
| outputTokensEstimate | integer | Estimated tokens produced by this stage |
| filesChanged | string[] | Paths of files created/modified/deleted |
| exportsAdded | string[] | New exports introduced |
| findingsResolved | integer | Count of findings resolved (0 if not applicable) |
| findingsRemaining | integer | Count of unresolved findings (0 if not applicable) |
| summary | string | 1-3 sentence human-readable summary of what happened |
| keyDecisions | string[] | Architectural or implementation decisions made |
| nextStageHints | string[] | Context the next stage needs to know |

TOON on-disk format:

```toon
stage: execute
wave: 2
iteration: 0
startedAt: 2026-04-17T10:00:00Z
completedAt: 2026-04-17T10:05:30Z
durationMs: 330000
inputTokensEstimate: 45200
outputTokensEstimate: 12800
filesChanged[4]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts,src/auth/index.ts
exportsAdded[2]: authMiddleware,TokenPayload
findingsResolved: 0
findingsRemaining: 0
summary: Implemented auth middleware and JWT token utilities
keyDecisions[1]: Used RS256 over HS256 for token signing
nextStageHints[1]: authMiddleware must be registered before protected routes
```

### ConvergenceIterationSummary

Per-iteration summary written during convergence loops.

| Field | Type | Constraints |
|-------|------|-------------|
| iteration | integer | >= 1 |
| mode | string | One of: criteria, target |
| startedAt | string | ISO 8601 timestamp |
| completedAt | string | ISO 8601 timestamp |
| durationMs | integer | >= 0 |
| harnessResult | string | One of: pass, fail, partial |
| findingsBefore | integer | >= 0 |
| findingsAfter | integer | >= 0 |
| findingsFixed | string[] | Descriptions of resolved findings |
| findingsNew | string[] | Descriptions of new findings introduced |
| filesModified | string[] | Paths modified by fixers |
| stalled | boolean | True if no progress from previous iteration |
| summary | string | 1-3 sentence summary |

TOON on-disk format:

```toon
iteration: 2
mode: criteria
startedAt: 2026-04-17T11:00:00Z
completedAt: 2026-04-17T11:03:15Z
durationMs: 195000
harnessResult: partial
findingsBefore: 8
findingsAfter: 3
findingsFixed[5]: auth middleware 401 on expired token,SQL injection in user lookup,missing index on email column,test assertion wrong status code,error response shape mismatch
findingsNew[0]:
filesModified[3]: src/auth/middleware.ts,src/db/users.ts,test/auth.test.ts
stalled: false
summary: Fixed 5 findings including SQL injection, 3 remain (all in pagination logic)
```

### ContextBudgetConfig

User-configurable budget thresholds. Stored in `.claude/orchestration.toml` under `[settings.contextBudget]`. The core rule: never exceed half the context window.

| Field | Type | Default | Constraints |
|-------|------|---------|-------------|
| contextWindow | integer | 200000 | The agent's context window size in tokens. Set to 1000000 for 1M context sessions. |
| agentBudgetCap | integer | derived | Hard cap per agent = `contextWindow / 2`. 100k for 200k window, 500k for 1M window. |
| checkpointWarning | float | 0.35 | Context monitor warns when this fraction of window remains |
| checkpointCritical | float | 0.25 | Context monitor goes critical at this fraction |

Defaults by window size:

| Window | Agent Budget Cap | Checkpoint Warning | Checkpoint Critical |
|--------|-----------------|-------------------|-------------------|
| 200k | 100,000 tokens | 70k remaining (35%) | 50k remaining (25%) |
| 1M | 500,000 tokens | 350k remaining (35%) | 250k remaining (25%) |

TOML config example:
```toml
[settings.contextBudget]
contextWindow = 200000       # or 1000000 for 1M context
# agentBudgetCap is auto-derived as contextWindow / 2
# override explicitly if needed:
# agentBudgetCap = 150000
checkpointWarning = 0.35
checkpointCritical = 0.25
```

### ContextBudgetEstimate

Returned by the preflight budget reviewer before spawning an agent.

| Field | Type | Constraints |
|-------|------|-------------|
| taskId | string | Unique task identifier |
| contextWindow | integer | The configured context window size |
| agentBudgetCap | integer | The derived or configured hard cap |
| estimatedPromptTokens | integer | Estimated total prompt size in tokens |
| breakdown | ContextBudgetBreakdown | See below |
| withinBudget | boolean | True if estimatedPromptTokens <= agentBudgetCap |
| budgetUtilization | float | estimatedPromptTokens / agentBudgetCap (0.0-1.0) |
| recommendation | string | One of: proceed, split, reject |
| splitSuggestion | string | Only set when recommendation is split |

### ContextBudgetBreakdown

| Field | Type | Constraints |
|-------|------|-------------|
| agentInstructions | integer | Tokens for the agent's .md instructions |
| contractFiles | integer | Tokens for contract file contents |
| rollingContext | integer | Tokens for rolling-context.md |
| stageContext | integer | Tokens for stage summaries being injected |
| taskPrompt | integer | Tokens for the task-specific prompt (objective, criteria, ownership) |
| fileReads | integer | Estimated tokens for files the agent will read from disk |
| overhead | integer | System prompt, tool definitions, formatting overhead |

### TeamMessage

Inter-teammate coordination message format for agent team mode.

| Field | Type | Constraints |
|-------|------|-------------|
| from | string | Sender stage name or "lead" |
| to | string | Recipient stage name or "lead" |
| type | string | One of: stage-complete, stage-summary, budget-warning, checkpoint-request |
| payload | string | TOON-encoded content depending on type |
| timestamp | string | ISO 8601 timestamp |

## Execution Phases

### Phase 0 — Wave 0: Context Management Contracts

**Agent:** contracts-agent
**Objective:** Define the stage summary schema, context budget protocol, and team coordination protocol as protocol specification files.
**Dependencies:** None
**File Ownership:** agents/protocols/stage-context.schema.md, agents/protocols/context-budget.md, agents/protocols/team-coordination.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/stage-context.schema.md | Create | contracts-agent |
| agents/protocols/context-budget.md | Create | contracts-agent |
| agents/protocols/team-coordination.md | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `stage-context.schema.md` defines the StageContext TOON format with all fields from the Schema section, includes examples for each stage type (execute, review, test, converge, fix)
- [ ] `context-budget.md` defines the configurable budget system: ContextBudgetConfig (user-settable via orchestration.toml), the "half the window" default rule, the estimation algorithm (per-component token counting), thresholds for proceed/split/reject, and the ContextBudgetEstimate + ContextBudgetBreakdown types. Documents both 200k and 1M window defaults.
- [ ] `team-coordination.md` defines the TeamMessage format, message flow between lead and teammates, agent team constraints (depth-1 hard limit, no nested teams), and the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` requirement
- [ ] All three files use TOON for example artifacts (not JSON)
- [ ] No forward references to undefined types across the three protocol files

### Phase 1 — Wave 1: Stage Summary Writer

**Agent:** implementer-agent
**Objective:** Add stage summary writing to the execution pipeline so that every stage boundary produces a `.plan-execution/stage-context/{stage}.toon` file.
**Dependencies:** Phase 0
**File Ownership:** agents/protocols/execution-conventions.md, commands/loom-plan.md, commands/loom.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/execution-conventions.md | Modify | implementer-1 |
| commands/loom-plan.md | Modify | implementer-1 |
| commands/loom.md | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] `execution-conventions.md` directory structure includes `stage-context/` subdirectory with `{stage}.toon` and `convergence/iterations/iter-N.toon` entries
- [ ] `execution-conventions.md` documents the stage summary write convention: when to write, what to include, atomic write requirement
- [ ] `loom-plan.md` executor steps include stage summary writes after each wave's verification step
- [ ] `loom.md` auto pipeline includes stage summary writes at every stage boundary (execute, review, test, converge, fix)
- [ ] Stage summary file format matches the StageContext schema from Phase 0

### Phase 2 — Wave 1: Convergence Iteration Summaries

**Agent:** implementer-agent
**Objective:** Update the convergence driver to write per-iteration summaries to disk and read only the last 1-2 iterations instead of accumulating full history in conversation context.
**Dependencies:** Phase 0
**File Ownership:** agents/convergence-driver.md, agents/protocols/convergence-plan.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-2 |
| agents/protocols/convergence-plan.schema.md | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `convergence-driver.md` writes `.plan-execution/convergence/iterations/iter-N.toon` after each iteration using the ConvergenceIterationSummary format
- [ ] `convergence-driver.md` reads only the last 2 iteration summaries from disk when starting a new iteration (not the full accumulated history)
- [ ] `convergence-plan.schema.md` references the iteration summary format and documents the disk-based iteration context strategy
- [ ] Iteration summary files are written atomically (write to `.tmp`, then rename)

### Phase 3 — Wave 1: Context Budget Hook + Structured State Extraction

**Agent:** implementer-agent
**Objective:** Create the context-budget.ts hook that estimates prompt size before agent spawns and blocks any spawn that would exceed the 100k token hard cap. Also create a structured state extraction tool that returns TOON extracts from state files, keeping orchestrator prompts lean.
**Dependencies:** Phase 0
**File Ownership:** hooks/context-budget.ts, hooks/lib/**, hooks/lib/loom-context.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/context-budget.ts | Create | implementer-3 |
| hooks/lib/token-estimator.ts | Create | implementer-3 |
| hooks/lib/loom-context.ts | Create | implementer-3 |

#### Acceptance Criteria
- [ ] `context-budget.ts` is a PreToolUse hook that intercepts `Task` tool calls (subagent spawns)
- [ ] Hook estimates prompt size by summing: agent instruction file size, contract files, rolling-context.md, stage summaries, task prompt, estimated file reads, and system overhead
- [ ] Hook reads `contextWindow` and `agentBudgetCap` from `.claude/orchestration.toml` `[settings.contextBudget]`. Falls back to 200k window / 100k cap if not configured.
- [ ] Hook blocks spawns where estimated total exceeds `agentBudgetCap` and returns an error message including the configured cap, estimated size, and a suggestion to split
- [ ] Token estimation uses character-count / 4 as the baseline heuristic (documented in context-budget.md)
- [ ] Hook fails open: if estimation data is unavailable (missing files, no `.plan-execution/`), the spawn is allowed
- [ ] `token-estimator.ts` exports a reusable `estimateTokens(text: string): number` function and a `estimateFileTokens(path: string): Promise<number>` function
- [ ] `loom-context.ts` is a CLI tool for cross-stage context aggregation. Subcommands: `all-stages` (concatenates all stage summaries into a single TOON view for the quality gate), `pipeline-position` (current stage + progress from pipeline-state.toon + context remaining estimate), `budget-status` (remaining agent budget + context estimate)
- [ ] For single-stage reads, orchestrators read the stage summary file directly (files are small, <1k tokens each). `loom-context.ts` is used when an agent needs a cross-cutting view across multiple stages (e.g., quality gate evaluating all stage results)

### Phase 4 — Wave 2: Checkpoint + Clear Path

**Agent:** implementer-agent
**Objective:** Add checkpoint trigger logic that suggests context resets at natural stage boundaries, create the checkpoint-trigger.ts hook, and add a real-time context monitor hook that warns the orchestrator when context is running low.
**Dependencies:** Phase 1, Phase 2, Phase 3
**File Ownership:** hooks/checkpoint-trigger.ts, hooks/context-monitor.ts, commands/loom-plan.md, commands/loom.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/checkpoint-trigger.ts | Create | implementer-1 |
| hooks/context-monitor.ts | Create | implementer-1 |
| commands/loom-plan.md | Modify | implementer-1 |
| commands/loom.md | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] `checkpoint-trigger.ts` is a PostToolUse or Stop hook that monitors context accumulation and suggests checkpoint+clear when estimated context exceeds 80k tokens
- [ ] `context-monitor.ts` is a PostToolUse hook that reads remaining context percentage (from session metrics or token estimation) and injects warnings into `additionalContext`. Thresholds read from `orchestration.toml` `[settings.contextBudget]`: `checkpointWarning` (default 0.35) and `checkpointCritical` (default 0.25). Debounced (warns every 5 tool uses, severity escalation bypasses debounce)
- [ ] `context-monitor.ts` writes `contextRemaining` percentage to `.plan-execution/status.toon` so the statusline renderer can display context pressure passively (e.g., `ctx:65%` or `ctx:25% !` when critical)
- [ ] `context-monitor.ts` warning message references the appropriate resume command: `/loom-plan execute --resume`, `/loom-converge --resume`, or `/loom-auto --resume` depending on which state files exist. At critical level, recommends `/loom-pause --compact` then `/clear`
- [ ] `loom-plan.md` includes checkpoint logic: after every 2 waves, write all state to disk and present a checkpoint prompt recommending `/clear` then `--resume` with fresh context
- [ ] `loom.md` converge includes checkpoint logic: after every 3 convergence iterations, recommend `/clear` then `--resume`
- [ ] Checkpoint prompt format: display what was saved, the exact resume command to copy-paste, and a `/clear` recommendation — e.g. "Run `/clear` for fresh context, then: `/loom-plan execute --resume`"
- [ ] `/loom-pause --compact` flag added: writes stage summaries for all completed work, updates rolling-context.md, writes continue-here.toon — optimized for context pressure (no git commit, just disk persistence + clear guidance). Prints: "State saved. Run `/clear` then `/loom-resume`"
- [ ] `loom.md` pause subcommand updated with `--compact` flag documentation and implementation
- [ ] `loom.md` auto pipeline detects whether `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set; if not, falls back to checkpoint+clear mode
- [ ] Resume path (`--resume`) reads stage summaries from `.plan-execution/stage-context/` to reconstruct pipeline position
- [ ] Checkpoint writes are atomic and include all state needed to resume: execution state, stage summaries, convergence iteration summaries

### Phase 5 — Wave 3: Agent Team Dispatcher

**Agent:** implementer-agent
**Objective:** Create the thin lead dispatcher agent and stage teammate templates for agent team mode.
**Dependencies:** Phase 4
**File Ownership:** agents/auto-dispatcher.md, agents/context-budget-reviewer.md, agents/stage-teammates/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/auto-dispatcher.md | Create | implementer-1 |
| agents/context-budget-reviewer.md | Create | implementer-1 |
| agents/stage-teammates/execute-stage.md | Create | implementer-1 |
| agents/stage-teammates/review-stage.md | Create | implementer-1 |
| agents/stage-teammates/test-stage.md | Create | implementer-1 |
| agents/stage-teammates/converge-stage.md | Create | implementer-1 |
| agents/stage-teammates/fix-stage.md | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `auto-dispatcher.md` is a thin lead agent that holds only pipeline state and stage summaries, never raw code or full file contents
- [ ] `auto-dispatcher.md` creates stage teammates (execute, review, test, converge, fix) and delegates full stage work to them
- [ ] `auto-dispatcher.md` runs the context-budget-reviewer before spawning each teammate
- [ ] `context-budget-reviewer.md` implements the preflight budget check: estimates the teammate's prompt size and returns proceed/split/reject
- [ ] Each stage teammate `.md` file defines a self-contained agent with clear inputs (stage summaries, file ownership, acceptance criteria) and outputs (stage summary TOON)
- [ ] Stage teammates can spawn subagents for parallel work but subagents cannot spawn further subagents (depth-1 hard limit documented)
- [ ] Agent team constraints documented: teammates cannot create their own teams, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` required
- [ ] `loom.md` auto pipeline updated to use agent team dispatcher when the env var is set

### Phase 6 — Wave 3: Tests and Documentation

**Agent:** implementer-agent
**Objective:** Create vitest test suites for context budget estimation, stage summary parsing, structured state extraction, and context monitoring. Update project documentation with context management conventions.
**Dependencies:** Phase 3, Phase 4, Phase 1
**File Ownership:** test/hooks/**, test/protocol/**, CLAUDE.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/hooks/context-budget.test.ts | Create | implementer-2 |
| test/hooks/context-monitor.test.ts | Create | implementer-2 |
| test/hooks/loom-context.test.ts | Create | implementer-2 |
| test/protocol/stage-context.test.ts | Create | implementer-2 |
| CLAUDE.md | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `context-budget.test.ts` tests token estimation accuracy: known strings produce estimates within 20% of actual tokenizer output
- [ ] `context-budget.test.ts` tests configurable cap enforcement: with default 200k window, 100k cap rejects 120k spawn; with 1M window config, 500k cap allows 120k spawn. Tests custom `agentBudgetCap` override.
- [ ] `context-budget.test.ts` tests fail-open behavior: missing files or directories do not block spawns
- [ ] `context-monitor.test.ts` tests configurable warning thresholds: default 35%/25%, custom thresholds from orchestration.toml, and 1M window scaling
- [ ] `context-monitor.test.ts` tests debounce behavior: warns every 5 tool uses, severity escalation bypasses debounce
- [ ] `loom-context.test.ts` tests structured extraction: `state-snapshot`, `stage-summary`, `pipeline-position`, `budget-status` subcommands return valid TOON
- [ ] `loom-context.test.ts` tests graceful degradation: missing state files return empty/default TOON, not errors
- [ ] `stage-context.test.ts` tests TOON parsing of StageContext: roundtrip encode/decode preserves all fields
- [ ] `stage-context.test.ts` tests validation: missing required fields are caught, invalid stage names are rejected
- [ ] `CLAUDE.md` updated with context budget conventions: 100k hard cap, estimation algorithm reference, stage summary write requirements
- [ ] All tests pass with `bunx vitest run`

**Note:** E2E integration tests (simulated multi-wave execution validating stage summaries + checkpoints + budget enforcement working together) are deferred to a follow-up plan. This phase covers unit and integration tests for individual components.

## Verification Commands

```bash
bunx vitest run
bun run hooks/context-budget.ts --dry-run 2>/dev/null || true
```

## Convergence Targets

- Context budget estimation accuracy: `estimateTokens()` for a 10,000-character input returns a value between 2,000 and 3,000 (character/4 heuristic with bounded error)
- Stage summary roundtrip: encoding a StageContext object to TOON and decoding it back produces an identical object
- Budget hook enforcement: a simulated spawn with 120k estimated tokens is blocked; a spawn with 80k estimated tokens is allowed

# Plan Executor

You are an orchestrator that executes a project plan wave-by-wave using specialized agents. You drive the full lifecycle: initialize state, run contracts, spawn parallel implementers, wire outputs together, verify quality, and manage human approval gates.

## Requirements

$ARGUMENTS

Parse arguments:
- No args: execute `PLAN.md` in the current working directory
- `path/to/plan`: execute that specific plan file
- `--init`: scaffold a PLAN.md template interactively, then stop
- `--dry-run`: show the wave structure without executing
- `--resume`: resume from `.plan-execution/state.json`
- `--wave N`: re-run only wave N using existing contracts and prior outputs
- `--contracts-only`: run only Wave 0 (contracts agent), then stop
- `--rollback-wave N`: revert to the git state before wave N

## Protocols

Before doing anything, read these protocol files to understand the inter-agent contracts:
- `~/.claude/agents/protocols/agent-result.schema.md` — the return format every agent must use
- `~/.claude/agents/protocols/state.schema.md` — execution state structure
- `~/.claude/agents/protocols/execution-conventions.md` — shared rules, directory structure, context compression
- `~/.claude/agents/protocols/validation-rules.md` — AgentResult validation, blocker gates, config validation

## Project-Specific Agents

Check for `.claude/orchestration.toml` in the project root. If it exists, read the `execution:` section to discover app-specific agents. Each declares a `phase` indicating when it runs in the wave lifecycle:

- `pre-contracts` — before contracts-agent (rare, e.g., schema generators)
- `post-contracts` — after contracts-agent, before implementers (e.g., migration generators)
- `post-implementer` — after implementer-agents, before wiring (e.g., seed data, API docs)
- `post-wiring` — after wiring-agent, before verification (e.g., integration setup)

Spawn project-specific agents at their declared phase using `subagent_type: "general-purpose"` with the agent's `.md` file contents embedded in the prompt. Agents with `outputRole: producer` return standard `AgentResult` and create files tracked in state.json.

If `orchestration.toml` declares `settings.maxParallelAgents`, respect that limit when spawning.

## Instructions

### Step 0: Handle Special Flags

**If `--init`:**
1. Ask the user about their project: What are you building? What's the tech stack? What are the major features?
2. Scaffold a PLAN.md with sections: Overview, Tech Stack, Schema/Types, Phases (with wave hints), Acceptance Criteria
3. Include inline comments explaining what each section controls
4. Write the file and stop

**If `--dry-run`:**
1. Read the plan file
2. Analyze it and propose a wave structure:
   - Wave 0: What contracts to create
   - Wave 1-N: What implementation tasks, with file ownership assignments
   - Wiring passes and verification gates
3. Display the proposed structure and stop

**If `--rollback-wave N`:**
1. Read `.plan-execution/state.json`
2. Find the git tag/stash for wave N: `plan-exec-wave-N-pre`
3. Confirm with user, then restore

**If `--resume`:**
1. Read `.plan-execution/state.json`
2. Check for drift: compare current file hashes against `fileHashes` from last completed wave
3. If drift detected, warn user and ask whether to proceed
4. Jump to the appropriate step in the main loop below

### Step 1: Initialize

1. Read the plan file. Confirm it exists and has content.

2. **Validation gate.** Before creating `.plan-execution/`, run plan validation stages 1-4 from `validation-rules.md` Section 6:
   - **Stage 1 (Structure):** Verify frontmatter, required sections, Phase 0 existence and contracts-agent assignment
   - **Stage 2 (Dependencies):** Build dependency graph, run cycle detection (Kahn's algorithm), check for self-deps and undefined references
   - **Stage 3 (Ownership):** Check for same-wave file ownership overlaps, verify deliverables fall within ownership boundaries
   - **Stage 4 (Sizing):** Flag phases with >12 deliverables (blocking), 0 acceptance criteria (blocking), >8 deliverables (warning)

   **If blocking errors found:** Display the full validation report and abort. Suggest the user run `/roadmap --refine` or `/roadmap --validate --deep` to fix issues before retrying.

   **If warnings only:** Display the validation report and ask the user whether to proceed or fix first. Warnings do not block execution but may indicate plan quality issues.

   **If clean:** Proceed to step 3.

3. Analyze the plan to extract or infer:
   - Schema/type definitions (for contracts-agent)
   - Implementation tasks grouped into waves
   - File ownership per task
   - Verification commands (typecheck, test, lint)
   - Acceptance criteria per task
4. Create `.plan-execution/` directory structure:
   - `.plan-execution/.gitignore` containing `*`
   - `.plan-execution/state.json` (initialized per schema)
   - `.plan-execution/rolling-context.md` (empty)
   - `.plan-execution/contracts/` directory
   - `.plan-execution/requests/` directory
5. Create a git tag `plan-exec-start` for rollback safety

### Step 2: Wave 0 — Contracts

1. Update state.json: wave 0 = in_progress
2. Create a git tag `plan-exec-wave-0-pre`
3. Read `~/.claude/agents/contracts-agent.md` for the agent's full instructions
4. Spawn a single Agent (general-purpose) with:
   - The contracts-agent instructions embedded in the prompt
   - The schema/type specifications extracted from the plan
   - The output directory: `.plan-execution/contracts/`
   - Instruction to return an AgentResult JSON as the last block of output

5. Parse the AgentResult from the agent's return value
6. Write `wave-0-summary.json` and `wave-0-summary.md`
7. Update `rolling-context.md` with Wave 0 as HOT entry
8. Update state.json: wave 0 tasks complete

**If `--contracts-only`:** Display results and stop here.

### Step 3: Verify Wave 0

1. Read `~/.claude/agents/verification-agent.md`
2. Spawn verification-agent with:
   - Verification commands from the plan (or auto-detect: try `npm run typecheck`, `npm test`, etc.)
   - File ownership: `{"contracts-agent": [list of files from AgentResult]}`
   - Wave index: 0
3. Parse verification AgentResult
4. Update state.json with verification result

### Step 4: Human Approval Gate

Display to the user:
```
## Wave 0 Complete: Contracts

Files created: [count]
[list of files]

Verification: [pass/fail]
[details if failed]

Next wave: Wave 1 — [description]
Tasks: [count] parallel implementers
Files affected: [count]

Proceed? (yes / re-run wave 0 / abort)
```

Wait for user approval before continuing.

### Step 5: Wave N — Implementation (repeat for each wave)

For each implementation wave (1, 2, ...):

1. Update state.json: wave N = in_progress
2. Create git tag `plan-exec-wave-N-pre`
3. Read `~/.claude/agents/implementer-agent.md`
4. Read `rolling-context.md`
5. For each task in this wave, prepare the implementer prompt:
   - Task objective and acceptance criteria
   - File ownership list for this specific task
   - **Specific** contract file paths relevant to this task (from manifest.json)
   - Rolling context content
   - Technology stack and conventions
6. **Launch all implementer agents in parallel** using the Agent tool — send ALL agent calls in a SINGLE message:
   - Each agent is `general-purpose` with implementer-agent instructions embedded
   - Each agent gets its own scoped prompt (different file ownership, different task)
   - Use `run_in_background: true` for all but one, or send all in one message

7. Collect all AgentResults as they complete

### Step 6: Reconciliation Check

Before wiring, check for problems:
1. **File ownership violations**: Did any agent modify files outside its declared boundary?
2. **Conflicting exports**: Did two agents export the same symbol name?
3. **Cross-boundary requests**: Are there files in `.plan-execution/requests/`?
4. **Contract amendments**: Did any agent flag contract issues?

If blocking conflicts found, report to user and ask how to proceed.

### Step 7: Wiring Pass

1. Read `~/.claude/agents/wiring-agent.md`
2. Spawn wiring-agent with:
   - All implementer AgentResults as JSON in the prompt
   - Contract manifest
   - Wave index
   - Project conventions
3. Parse wiring AgentResult
4. Write `wave-N-summary.json` and `wave-N-summary.md`

### Step 8: Verify Wave N

Same as Step 3 but for wave N:
- Include all file ownership from all implementers + wiring agent
- Run typecheck, tests, lint, ownership drift

### Step 9: Update Context + Gate

1. **Compress rolling-context.md:**
   - Current wave becomes HOT (full summary)
   - Previous HOT becomes WARM (compress to key decisions + interface changes)
   - Oldest WARM becomes COLD (compress to one-line)
   - Target: keep under 10k tokens total

2. Update state.json: wave N complete, store file hashes

3. **Human approval gate** — same format as Step 4:
   - Show files changed, verification results
   - Show next wave preview
   - Ask: proceed / re-run wave / abort

### Step 10: Repeat or Complete

- If more waves remain, go to Step 5
- If all waves complete:

```
## Execution Complete

Run ID: [uuid]
Waves completed: [N]
Total files created: [count]
Total files modified: [count]
Verification: All passing

Rolling context and state preserved in .plan-execution/
Use --resume if you need to re-run any wave.
```

## Error Handling

### Agent failure (timeout or error)
- Mark the task as failed in state.json (increment retryCount)
- If retryCount < 2: retry with error context added to prompt
- If retryCount >= 2: report failure, ask user: skip task / abort wave / abort run
- Other tasks in the wave that succeeded are preserved

### Verification failure
- Display failing checks with file context
- Ask user: fix manually and re-verify / re-run wave / abort

### Unexpected state
- If `.plan-execution/.lock` exists with a live PID, abort with warning
- If state.json is missing or corrupt, offer to reinitialize

## Runtime Feedback

Throughout execution, keep the user informed:
- "Starting Wave N: [description] — [count] agents in parallel"
- As each agent completes: "Agent [name] completed: [success/failure] — [file count] files"
- "Running verification..."
- "Wiring pass complete: [changes summary]"

Never go silent for more than 30 seconds without a status update.

## Subcommand: execute

You are an orchestrator that executes a project plan wave-by-wave using specialized agents. You drive the full lifecycle: initialize state, run contracts, spawn parallel implementers, wire outputs together, verify quality, and manage human approval gates.

### Arguments

Parse remaining arguments:
- No args: execute `PLAN.md` in the current working directory
- `path/to/plan`: execute that specific plan file
- `--init`: scaffold a PLAN.md template interactively, then stop
- `--dry-run`: show the wave structure without executing
- `--resume`: resume from `.plan-execution/state.toon`
- `--wave N`: re-run only wave N using existing contracts and prior outputs
- `--contracts-only`: run only Wave 0 (contracts agent), then stop
- `--rollback-wave N`: revert to the git state before wave N
- `--auto`: skip human approval gates, use automated quality gates instead
- `--no-auto-commit`: disable per-wave auto-commits (code accumulates in working tree)

### Project-Specific Agents

Check for `.claude/orchestration.toml` in the project root. If it exists, read the `execution:` section to discover app-specific agents. Each declares a `phase` indicating when it runs in the wave lifecycle:

- `pre-contracts` -- before contracts-agent (rare, e.g., schema generators)
- `post-contracts` -- after contracts-agent, before implementers (e.g., migration generators)
- `post-implementer` -- after implementer-agents, before wiring (e.g., seed data, API docs)
- `post-wiring` -- after wiring-agent, before verification (e.g., integration setup)

Spawn project-specific agents at their declared phase using `subagent_type: "general-purpose"`. In the prompt, tell the agent to read its instructions from the `.md` file path declared in `orchestration.toml` -- do NOT embed the file contents. Agents with `outputRole: producer` return standard `AgentResult` and create files tracked in state.toon.

If `orchestration.toml` declares `settings.maxParallelAgents`, respect that limit when spawning.

### Kit Agents (Insertion Points)

In addition to project-specific agents (which use the `phase` field), check `orchestration.toml` for kit agents registered under `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]`. Kit agents use the `insertionPoint` field instead of `phase`. See `agents/protocols/kit.schema.md` for the full specification.

**6 insertion points** (kit agents fire at these pipeline boundaries):

- `pre-scope` -- before scope contract generation (only in `/loom-auto`)
- `post-scope` -- after scope contract locked, before roadmap
- `pre-execute` -- before each execution wave starts (before contracts-agent or implementers)
- `post-execute` -- after each execution wave completes (after wiring-agent finishes)
- `pre-verify` -- before verification agent runs (typecheck, test, lint)
- `post-verify` -- after verification agent completes

**Important:** Kit insertion points and project-specific phases are separate systems. `insertionPoint` is for kit agents (`[[kit.*.agents]]`). `phase` is for project agents (`[[execution.agents]]`). Both can coexist in the same orchestration.toml without conflict.

**Discovery and execution at each insertion point:**

1. Read all `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]` entries from orchestration.toml
2. Filter to entries whose `insertionPoint` matches the current pipeline boundary
3. **Conditional activation:** If an entry has a `condition` field (file ownership glob, e.g., `**/*.sql OR **/dbt_project.yml`), check whether any files in the current wave's ownership match the glob. If no match, skip that agent.
4. **Topological sort:** If entries declare `after` or `before` fields, sort them accordingly. If a cycle is detected, log: "Kit agent ordering cycle detected: {agent A} → {agent B} → {agent A}. Halting." and set wave status to failed.
5. **Gates first:** At each insertion point, run gate agents (`[[kit.<name>.gates]]`) before non-gate agents. This ensures quality gates can block before reviewers/producers run.
6. Spawn each agent using `subagent_type: "general-purpose"`, instructing it to read its `.md` file from the `source` path in orchestration.toml.

**Gate evaluation (for `[[kit.<name>.gates]]` agents):**

After a gate agent returns its AgentResult, inspect the `gate` field:

- `gate: pass` or gate field absent → continue normally
- `gate: warn` → log inline warning: "⚠ Gate {agent name} at {insertionPoint}: {gateReason}". Increment `gateWarnCount` in wave summary. Continue.
- `gate: fail` with `failAction: halt` → stop the wave. Display:
  ```
  ## Gate Failed: {agent name}
  
  Insertion point: {insertionPoint}
  Reason: {gateReason}
  
  Actions:
    1. retry   — re-run the gate agent
    2. skip    — ignore this gate and continue
    3. abort   — stop execution
  ```
  Wait for user input (or ESCALATE if `--auto`).
- `gate: fail` with `failAction: retry` → re-run the gate agent up to `retryMax` times (default 3). Display: "Retrying gate {agent name} (attempt {N}/{retryMax})...". On exhaustion, fall through to halt behavior with note: "Gate retries exhausted."
- `gate: fail` with `failAction: warn` → same as `gate: warn` above
- **Malformed gate response** (gate field present but not valid TOON) → treat as `gate: warn` with gateReason: "malformed gate response from {agent}". Never halt on bad data.
- **Agent timeout** → treat as `gate: warn` with gateReason: "gate agent timed out". Continue.

**Zero-overhead path:** If `orchestration.toml` does not exist, or exists but has no `[[kit.*]]` sections, skip all kit agent logic entirely. Do not read or parse orchestration.toml for kit sections unless `[[kit.` appears in the file.

**Wave summary integration:** After all kit agents at an insertion point complete, record in `wave-N-summary.toon`:
```toon
kitGates[N]{agent,insertionPoint,gate,gateReason}:
  data-quality-gate,pre-execute,pass,"All 12 schema checks passed"
kitWarnings: 0
kitHalts: 0
```

**Status line:** When kit agents are running, update `.plan-execution/status.toon` with `kitAgentsRunning: {N}` and `kitInsertionPoint: {current point}`.

### Instructions

#### Step 0: Handle Special Flags

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
1. Read `.plan-execution/state.toon`
2. Find the git tag/stash for wave N: `plan-exec-wave-N-pre`
3. Confirm with user, then restore

**If `--resume`:**
1. Read `.plan-execution/state.toon`
2. **Reconstruct context from stage summaries.** Read all files in `.plan-execution/stage-context/` to rebuild pipeline position:
   - For each `stage-context/*.toon` file, parse `stage`, `wave`, `summary`, `keyDecisions`, `nextStageHints`
   - Determine last completed wave from state.toon `currentWave` and wave statuses
   - Regenerate `rolling-context.md` from stage summaries using tiered compression (hot/warm/cold)
   - This ensures fresh context after a `/clear` + `--resume` cycle
3. Check for drift: compare current file hashes against `fileHashes` from last completed wave
4. If drift detected, warn user and ask whether to proceed
5. Display resume summary:
   ```
   Resuming execution from wave {N+1}/{total}
   Completed waves: {list}
   Context reconstructed from {count} stage summaries
   ```
6. Jump to the appropriate step in the main loop below

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 1: Initialize

1. Read the plan file. Confirm it exists and has content.

2. **Validation gate.** Before creating `.plan-execution/`, run plan validation stages 1-4 from `validation-rules.md` Section 6:
   - **Stage 1 (Structure):** Verify frontmatter, required sections, Phase 0 existence and contracts-agent assignment
   - **Stage 2 (Dependencies):** Build dependency graph, run cycle detection (Kahn's algorithm), check for self-deps and undefined references
   - **Stage 3 (Ownership):** Check for same-wave file ownership overlaps, verify deliverables fall within ownership boundaries
   - **Stage 4 (Sizing):** Flag phases with >12 deliverables (blocking), 0 acceptance criteria (blocking), >8 deliverables (warning)

   **If blocking errors found:** Display the full validation report and abort. Suggest the user run `/loom-roadmap refine` or `/loom-roadmap validate --deep` to fix issues before retrying.

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
   - `.plan-execution/state.toon` (initialized per schema)
   - `.plan-execution/rolling-context.md` (empty)
   - `.plan-execution/contracts/` directory
   - `.plan-execution/requests/` directory
   - `.plan-execution/progress/` directory (for agent monitoring)
5. Create a git tag `plan-exec-start` for rollback safety

#### Step 1.5: Scope Coverage Check

1. For each phase in the plan, collect all `acceptanceCriteria` entries
2. For each criterion, identify task(s) that cover it by matching:
   - File ownership overlap (task owns files in the criterion's domain)
   - Objective keyword matching (task objective addresses the criterion)
3. Write `.plan-execution/scope-coverage.toon`:
   ```toon
   criteria[N]{phaseId,criterion,coveringTasks,status}:
     0,All types compile with npx tsc --noEmit,w0-contracts,pending
     1,All repository functions use parameterized queries,w1-data-layer,pending
     2,Routes access repositories through req.app.locals,w1-api-routes,pending
   ```
   If writing `scope-coverage.toon` fails (disk error, missing directory), warn the user:
   ```
   Warning: Scope tracking unavailable: could not write scope-coverage.toon.
     Scope drift detection will be skipped for this run. Continuing execution.
   ```
   Continue to Step 2 without scope tracking.

4. If any criterion has 0 covering tasks (orphaned):
   ```
   Warning: SCOPE REDUCTION: N acceptance criteria have no covering tasks:

   Phase 2, Criterion: "Dashboard renders user list"
     -> No task owns UI files or has matching objective

   Options: proceed anyway / abort / assign manually
   ```
5. If `--auto`: log orphaned criteria as a warning in state.toon, then proceed. Do not wait for user input. Otherwise, wait for user decision before proceeding.

#### Step 2: Wave 0 -- Contracts

1. Update state.toon: wave 0 = in_progress
2. Create a git tag `plan-exec-wave-0-pre`
3. **Gather wiki context for contracts.** If `.loom/wiki/` exists, read `index.toon` and collect `decision-*`, `convention-*`, and `structure-*` pages (cap at 5 pages). These inform type naming, schema design, and file placement.
4. Spawn a single Agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/contracts-agent.md` first."
   - The schema/type specifications extracted from the plan
   - The output directory: `.plan-execution/contracts/`
   - If wiki pages gathered: include them as `<file-content path="wiki-context">{concatenated pages}</file-content>`
   - Instruction to return an AgentResult as the last block of output

5. Parse the AgentResult from the agent's return value
6. Write `wave-0-summary.toon` and `wave-0-summary.md` to `.plan-execution/`. Also copy `wave-0-summary.toon` to `.plan-history/executions/wave-0-summary.toon` for persistence (see `execution-conventions.md` § Persistence).
7. Update `rolling-context.md` with Wave 0 as HOT entry
8. Update state.toon: wave 0 tasks complete

**If `--contracts-only`:** Display results and stop here.

#### Step 3: Verify Wave 0

1. Spawn verification-agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/verification-agent.md` first."
   - Verification commands from the plan (or auto-detect: try `npm run typecheck`, `npm test`, etc.)
   - File ownership: `{"contracts-agent": [list of files from AgentResult]}`
   - Wave index: 0
3. Parse verification AgentResult
4. Update state.toon with verification result

5. **Write stage context.** Write `.plan-execution/stage-context/contracts.toon` following the `StageContext` schema from `stage-context.schema.md`. Populate fields from the Wave 0 agent results and verification outcome:
   ```toon
   stage: contracts
   wave: 0
   iteration: 0
   startedAt: {wave 0 start timestamp}
   completedAt: {verification completion timestamp}
   durationMs: {wall-clock duration}
   inputTokensEstimate: {estimated from prompt sizes}
   outputTokensEstimate: {estimated from agent output sizes}
   filesChanged[N]: {files from wave-0-summary.toon filesCreated + filesModified}
   exportsAdded[N]: {exports from wave-0-summary.toon}
   findingsResolved: 0
   findingsRemaining: {count from verification result}
   summary: {1-3 sentence summary of contracts generated}
   keyDecisions[N]: {architectural decisions from contracts-agent}
   nextStageHints[N]: {context for the next wave}
   ```
   Use atomic write: write to `stage-context/contracts.toon.tmp`, then rename to `stage-context/contracts.toon`.

#### Step 3.5: Auto-Commit Wave 0

**Skip if `--no-auto-commit` is set.**

If verification passed (Step 3):
1. Read `wave-0-summary.toon` to get `filesCreated` and `filesModified`.
2. Stage those files: `git add {filesCreated} {filesModified}`.
3. Also stage `.plan-history/executions/wave-0-summary.toon` if it was written.
4. Create commit:
   ```
   git commit -m "feat(wave-0): contracts — {entity list from wave summary}"
   ```
5. If commit fails (nothing to stage, hook rejection), log warning and continue.

#### Step 4: Human Approval Gate

If `--auto` is specified, run the Automated Quality Gate (see section below) instead of displaying the approval prompt.

Display to the user:
```
## Wave 0 Complete: Contracts

Files created: [count]
[list of files]

Verification: [pass/fail]
[details if failed]

Next wave: Wave 1 -- [description]
Tasks: [count] parallel implementers
Files affected: [count]

Proceed? (yes / re-run wave 0 / abort)
```

Wait for user approval before continuing.

#### Step 5: Wave N -- Implementation (repeat for each wave)

For each implementation wave (1, 2, ...):

1. Update state.toon: wave N = in_progress
2. Create git tag `plan-exec-wave-N-pre`
3. Read `rolling-context.md`
4. **Pattern check:** If `.claude/orchestration.toml` exists and has `[patterns.*]` entries, check each task's description against pattern triggers. If a task matches a pattern trigger (per `~/.claude/agents/protocols/pattern-executor.md`), execute the pattern instead of spawning a single implementer. The pattern's output replaces the implementer's AgentResult.
5. **Gather wiki context for this wave.** If `.loom/wiki/` exists, read `index.toon` and collect wiki pages relevant to this wave's tasks:
   - `decision-*` pages relevant to the wave's domain (e.g., auth decisions for auth tasks)
   - `convention-*` pages (all — these apply globally)
   - `pattern-*` pages matching the task's implementation area
   - `structure-*` pages (all — file placement guidance applies globally)
   - Cap at 5 pages per task to stay within context budget. If multiple tasks share the same pages, each task still gets its own copy in its prompt.
6. For each task in this wave, prepare the implementer prompt:
   - Instruction: "Read your instructions from `~/.claude/agents/implementer-agent.md` first."
   - Task objective and acceptance criteria
   - File ownership list for this specific task
   - **Specific** contract file paths relevant to this task (from manifest.toon)
   - Rolling context content
   - Technology stack and conventions
   - If `scope-contract.toon` exists, include relevant contract decisions in the prompt (filter to decisions that affect this task's domain — e.g., data access decisions for data layer tasks, auth decisions for auth tasks)
   - If wiki pages gathered: include them as `<file-content path="wiki-context">{concatenated pages relevant to this task}</file-content>`
7. **Clear progress directory:** Remove all `*.toon` files from `.plan-execution/progress/` (fresh wave).

7. **Launch all implementer agents in parallel** using the Agent tool -- send ALL agent calls in a SINGLE message:
   - Each agent is `general-purpose` -- it reads its own instructions from disk
   - Each agent gets its own scoped prompt (different file ownership, different task)
   - Include the agent's `taskId` in the prompt so it can write progress to `.plan-execution/progress/{taskId}.toon`
   - Use `run_in_background: true` for all agents

8. **Monitor agents via polling loop** (per `agent-monitoring.schema.md`):

   While any agent has not completed:
   1. Wait 15 seconds (`pollIntervalSeconds`)
   2. Read `.plan-execution/progress/{taskId}.toon` for each running agent
   3. Classify each agent:
      - **reporting** -- progress file exists, `heartbeatAt` within 90s
      - **silent** -- no progress file (agent may not support protocol or just started)
      - **stale** -- progress file exists but `heartbeatAt` older than 90s
      - **completed** -- agent returned its AgentResult
      - **timed-out** -- wall clock exceeded agent's timeout
   4. **Render dashboard:**
     ```
     === Wave N Progress (K agents) ===  [elapsed: Xm Ys]

       task-id  agent-type  ..........      65%  implementing   "Current activity"  heartbeat 8s ago
       ...

       Completed: X/K  |  Stale: Y  |  Timed out: Z
     ```
   5. **Escalate as needed:**
      - Silent > 120s after spawn -> warn in dashboard
      - Stale > 90s -> warn in dashboard
      - Stale > 180s -> send `MONITORING: heartbeat nudge` via SendMessage to that agent
      - Stale > 270s -> present options to user: wait longer / send custom message / mark failed
      - Wall clock > agent timeout -> present timeout options to user
   6. On agent completion notification -> mark done, proceed to collect AgentResult

   If an agent ignores progress reporting entirely, the loop classifies it as `silent` and continues waiting -- monitoring is additive, never gating.

9. Collect all AgentResults

#### Step 6: Reconciliation Check (after Step 5 completes)

Before wiring, check for problems:
1. **File ownership violations**: Did any agent modify files outside its declared boundary?
2. **Conflicting exports**: Did two agents export the same symbol name?
3. **Cross-boundary requests**: Are there files in `.plan-execution/requests/`?
4. **Contract amendments**: Did any agent flag contract issues?

If `--auto` and blocking conflicts found: attempt auto-resolution by assigning conflicting files to the wiring-agent. If still conflicting after wiring: escalate (set wave status to failed).

If not `--auto` and blocking conflicts found, report to user and ask how to proceed.

#### Step 7: Wiring Pass

1. Spawn wiring-agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/wiring-agent.md` first."
   - All implementer AgentResults in the prompt
   - Contract manifest path
   - Wave index
   - Project conventions
   - If wiki pages gathered for this wave: include `convention-*` and `structure-*` pages as `<file-content path="wiki-context">{concatenated pages}</file-content>`
3. Parse wiring AgentResult
4. Write `wave-N-summary.toon` and `wave-N-summary.md` to `.plan-execution/`. Also copy `wave-N-summary.toon` to `.plan-history/executions/wave-N-summary.toon` for persistence.

#### Step 8: Verify Wave N

Same as Step 3 but for wave N:
- Include all file ownership from all implementers + wiring agent
- Run typecheck, tests, lint, ownership drift

After verification completes, **write stage context.** Write `.plan-execution/stage-context/execute.toon` following the `StageContext` schema from `stage-context.schema.md`. Populate fields from the Wave N agent results and verification outcome:
   ```toon
   stage: execute
   wave: {N}
   iteration: 0
   startedAt: {wave N start timestamp}
   completedAt: {verification completion timestamp}
   durationMs: {wall-clock duration}
   inputTokensEstimate: {estimated from all agent prompt sizes}
   outputTokensEstimate: {estimated from all agent output sizes}
   filesChanged[N]: {deduplicated files from all implementer + wiring AgentResults}
   exportsAdded[N]: {deduplicated exports from all AgentResults}
   findingsResolved: {count from verification improvements vs prior wave}
   findingsRemaining: {count from verification result}
   summary: {1-3 sentence summary of what was implemented}
   keyDecisions[N]: {decisions from implementer agents}
   nextStageHints[N]: {context for the next wave or stage}
   ```
   Use atomic write: write to `stage-context/execute.toon.tmp`, then rename to `stage-context/execute.toon`.

#### Step 8.5: Auto-Commit Wave N

**Skip if `--no-auto-commit` is set.**

If verification passed (Step 8):
1. Read `wave-N-summary.toon` to get `filesCreated` and `filesModified`.
2. Stage those files: `git add {filesCreated} {filesModified}`.
3. Also stage `.plan-history/executions/wave-N-summary.toon` if it was written.
4. Determine commit prefix:
   - If `filesCreated` is non-empty → `feat`
   - If `filesCreated` is empty (all modifications) → `refactor`
5. Create commit:
   ```
   git commit -m "{prefix}(wave-{N}): {phase description from plan}"
   ```
6. If commit fails, log warning and continue.

#### Step 9: Update Context + Gate

1. **Compress rolling-context.md:**
   - Current wave becomes HOT (full summary)
   - Previous HOT becomes WARM (compress to key decisions + interface changes)
   - Oldest WARM becomes COLD (compress to one-line)
   - Target: keep under 10k tokens total

2. Update state.toon: wave N complete, store file hashes

3. **Scope drift check:**
   - If `.plan-execution/scope-coverage.toon` does not exist, skip drift check and note "Scope tracking unavailable" in the human gate summary
   - Otherwise, read `.plan-execution/scope-coverage.toon`
   - For each task that succeeded in this wave, mark its criteria as `covered`
   - For each task that failed and won't be retried (`retryCount >= 2`):
     - Remove the failed task from each criterion's `coveringTasks`
     - Mark a criterion as `orphaned` ONLY if its `coveringTasks` becomes empty AND its status is not already `covered` or `dropped`
   - If new orphans detected, display SCOPE DRIFT warning before the human gate

4. **Human approval gate** -- If `--auto`: run the Automated Quality Gate instead of asking the user. Otherwise, same format as Step 4:
   - Show files changed, verification results
   - Show next wave preview
   - Ask: proceed / re-run wave / abort

#### Step 9.1: Context Checkpoint (every 2 waves)

After updating context and before the contract drift check, evaluate whether a context checkpoint is appropriate:

1. **Check wave count.** If `N % 2 == 0` and `N > 0` (i.e., after waves 2, 4, 6, ...):

2. **Write all state to disk atomically:**
   - Ensure `state.toon` is current (already done in Step 9.2)
   - Ensure `rolling-context.md` is current (already done in Step 9.1)
   - Ensure all `stage-context/*.toon` files are current
   - Write a checkpoint marker to `.plan-execution/checkpoint.toon`:
     ```toon
     checkpointAt: {ISO timestamp}
     wave: {N}
     totalWaves: {total}
     completedWaves[N]: {list of completed wave indices}
     resumeCommand: /loom-plan execute --resume
     stateFiles[N]: state.toon,rolling-context.md,scope-coverage.toon
     ```
     Use atomic write (`.tmp` then rename).

3. **Present checkpoint prompt:**
   ```
   ## Context Checkpoint (Wave {N}/{total})

   State saved to disk:
   - Execution state: .plan-execution/state.toon (wave {N} complete)
   - Rolling context: .plan-execution/rolling-context.md
   - Stage summaries: .plan-execution/stage-context/
   - Scope coverage: .plan-execution/scope-coverage.toon

   Waves completed: {N}/{total}
   Next wave: Wave {N+1} -- {description}

   Run `/clear` for fresh context, then:
     /loom-plan execute --resume
   ```

4. **If `--auto`:** log the checkpoint message but do NOT pause. Continue to the next step. The checkpoint data is on disk if the context monitor hook triggers a forced clear later.

5. **If not `--auto`:** display the checkpoint prompt and wait for user input:
   - `continue` -- proceed without clearing (default)
   - `clear` -- user will manually run `/clear` then `--resume`

#### Step 9.3: Contract Drift Check

If `scope-contract.toon` exists:
1. Read the contract decisions
2. For each file modified in this wave, check if the implementation contradicts any contract decision (e.g., contract says "repository + raw SQL" but agent introduced an ORM import)
3. If violations found, log them in the wave summary: "Contract drift: {decision ID} {decision} — {violation description}"
4. Do NOT block execution for drift — just warn. The review stage will catch and flag these.

#### Step 9.5: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to capture what was built in this wave:

```
subagent_type: "general-purpose"
run_in_background: true
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `wave-complete`
- Event data: wave summary from `.plan-execution/wave-N-summary.toon`, files created/modified, contracts established (wave 0), implementation decisions
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails: (1) Log a warning in state.toon under `wikiUpdateStatus: failed` with the error summary, (2) Increment a `wikiConsecutiveFailures` counter in state.toon, (3) If `wikiConsecutiveFailures >= 2`, add a visible note to the human approval gate: "Wiki updates have failed for {N} consecutive waves. Run `/loom-wiki lint` to diagnose." (4) Continue to the next step. Wiki maintenance never gates the pipeline.

Do NOT count wiki maintenance against circuit breaker thresholds or agent budgets.

#### Step 10: Repeat or Complete

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

### Error Handling

#### Agent failure (timeout or error)
- Mark the task as failed in state.toon (increment retryCount)
- If retryCount < 2: retry with error context added to prompt
- If retryCount >= 2: report failure, ask user: skip task / abort wave / abort run
- Other tasks in the wave that succeeded are preserved

#### Verification failure
- Display failing checks with file context
- Ask user: fix manually and re-verify / re-run wave / abort

#### Unexpected state
- If `.plan-execution/.lock` exists with a live PID, abort with warning
- If state.toon is missing or corrupt, offer to reinitialize

### Automated Quality Gate (--auto mode)

When `--auto` is active, replace all human approval gates (Steps 4 and 9) with this automated decision logic:

**PROCEED** if:
- `verification.status == "pass"` (all checks green)
- Zero blocking issues in any AgentResult
- Zero file ownership violations
- Zero gate halts from kit agents (`kitHalts == 0` in wave summary)

**RETRY** (re-run failed agents, max 2 retries per wave) if:
- Verification failed
- AND all failures are in files owned by this wave's agents
- AND `wave.retryCount < 2`

On retry:
1. Increment `retryCount` in state.toon
2. Re-spawn ONLY the failed agents with error context added to prompt:
   "Your previous attempt failed verification. Errors: [exact typecheck/test output for files you own]. Fix these issues."
3. Re-run wiring-agent with mix of preserved + new results
4. Re-run verification-agent
5. Re-evaluate this gate

**ESCALATE** (set status=paused) if:
- Verification failures are in files NOT owned by this wave
- OR `wave.retryCount >= 2`
- OR reconciliation found blocking conflicts that auto-resolve failed
- OR any kit gate returned `gate: fail` with `failAction: halt` (gate halt — display gate agent name, insertion point, and gateReason in escalation)

On escalate:
1. Set wave status to "failed" in state.toon
2. Set run status to "paused"
3. The calling orchestrator (`/loom-auto`) reads state.toon and decides: revise plan or give up

**GATE-WARN** (proceed with logged warnings) if:
- Kit gates returned `gate: warn` (or `gate: fail` with `failAction: warn`)
- AND all other conditions would PROCEED
- Log all gate warnings in the wave summary. Do not block.

### Runtime Feedback

Throughout execution, keep the user informed:
- "Starting Wave N: [description] -- [count] agents in parallel"
- As each agent completes: "Agent [name] completed: [success/failure] -- [file count] files"
- "Running verification..."
- "Wiring pass complete: [changes summary]"

Never go silent for more than 30 seconds without a status update.

---


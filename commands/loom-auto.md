# Autonomous Pipeline Orchestrator

You are a meta-orchestrator that drives the full software lifecycle autonomously: plan creation, execution, testing, code review, and fix cycles. You loop through these stages until the product works or a circuit breaker trips, then report results to the human.

## Requirements

$ARGUMENTS

Parse arguments:
- `--from "description"`: create a plan from scratch using the description
- `--plan <path>`: start from an existing plan file (default: `PLAN.md`)
- `--resume`: resume from `pipeline-state.toon`
- `--max-iterations N`: outer loop cap (default: 3)
- `--max-agents N`: agent budget cap (default: 50)
- `--dry-run`: show pipeline stages without executing
- `--stop-after <stage>`: stop after a named stage: `plan`, `execute`, `test`, `review`, `fix`

## Protocols

Before doing anything, read these protocol files:
- `~/.claude/agents/protocols/agent-result.schema.md` — return format every agent uses
- `~/.claude/agents/protocols/state.schema.md` — execution state structure
- `~/.claude/agents/protocols/execution-conventions.md` — shared rules, directory structure, context compression
- `~/.claude/agents/protocols/validation-rules.md` — plan validation, blocker gates
- `~/.claude/agents/protocols/pipeline-state.schema.md` — pipeline-state.toon schema for this orchestrator
- `~/.claude/agents/protocols/agent-monitoring.schema.md` — progress reporting and stale detection

---

## Instructions

### Step 0: Initialize

1. Parse `$ARGUMENTS` into local variables:
   - `description` from `--from`
   - `planFile` from `--plan` (default: `PLAN.md`)
   - `resumeMode` from `--resume`
   - `maxIterations` from `--max-iterations` (default: 3)
   - `maxAgents` from `--max-agents` (default: 50)
   - `dryRun` from `--dry-run`
   - `stopAfter` from `--stop-after`

2. **If `--resume`:** jump to the Resume Logic section below.

3. **If `--dry-run`:** display the pipeline stages and stop:
   ```
   ## Pipeline Stages (dry run)

   1. Plan Creation   — loom-roadmap --init --auto
   2. Plan Review      — loom-review-plan
   3. Review Integrate — loom-roadmap --review-integrate
   4. Execution        — loom-execute-plan --auto
   5. Test             — loom-test-plan --run --parallel --auto
   6. Code Review      — loom-review-code --branch
   7. Quality Gate     — automated decision matrix
   8. Fix Cycle        — loom-fix-code --auto (up to 2 cycles)

   Outer loop: up to {maxIterations} iterations
   Agent budget: {maxAgents}
   ```
   Stop here.

4. Create or verify `.plan-execution/` directory structure.

5. **Install enforcement hooks.** Create `.claude/settings.json` in the project directory (if it doesn't already exist) with Loom's deterministic hooks. The hooks live in the meta-orchestration repo at `~/Projects/meta-orchestration/hooks/` and enforce file ownership, contract locks, agent budget, quality gates, and typecheck-on-write. Write this file using the Bash tool:

   ```bash
   mkdir -p .claude
   cat > .claude/settings.json << 'HOOKS_EOF'
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/file-ownership.ts", "timeout": 5000}]
         },
         {
           "matcher": "Write|Edit",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/contract-lock.ts", "timeout": 5000}]
         },
         {
           "matcher": "Agent",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]
         }
       ],
       "PostToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/typecheck-on-write.ts", "timeout": 30000}]
         }
       ],
       "SubagentStop": [
         {
           "matcher": "",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]
         },
         {
           "matcher": "",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/status-updater.ts", "timeout": 5000}]
         }
       ],
       "Stop": [
         {
           "matcher": "",
           "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/quality-gate.ts", "timeout": 5000}]
         }
       ]
     }
   }
   HOOKS_EOF
   ```

   If `.claude/settings.json` already exists, merge the hooks key rather than overwriting. The hooks fail open — if the project has no `.plan-execution/` they exit 0 immediately.

6. Initialize `pipeline-state.toon`:
   ```toon
   schemaVersion: 1
   runId: {generate uuid}
   mode: auto
   description: "{description or 'Existing plan: ' + planFile}"
   planFile: {planFile}
   outerIteration: 1
   maxIterations: {maxIterations}
   agentsSpawned: 0
   maxAgents: {maxAgents}
   fixCycleCount: 0
   currentStage: plan-create

   stageHistory[0]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:

   failureLog[0]{iteration,stage,error,resolution}:
   ```

6. Update status line and proceed to Step 1.

---

### Step 1: Plan Creation (Phase A)

**If `outerIteration == 1` AND no existing plan file (or `--from` provided):**

1a. **Create plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a plan using --init --from '{description}' --auto.
    Write the result to {planFile}."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: plan-create`.

1b. **Review plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-plan.md first.
    Review the plan at {planFile}. Save findings to .plan-history/reviews/."
   ```
   Record agents spawned. Update `currentStage: plan-review`.

1c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate to apply review findings to {planFile}."
   ```
   Record agents spawned. Update `currentStage: plan-integrate`.

1d. **Validate.** Run plan validation stages 1-4 (from `validation-rules.md`):
   - Stage 1: Structure
   - Stage 2: Dependencies (cycle detection)
   - Stage 3: Ownership (no same-wave overlaps)
   - Stage 4: Sizing (deliverable and criteria counts)

   If validation fails after integration: **ESCALATE** — review recommendations broke the plan. Write escalation report and stop.

   If validation passes: update `currentStage: plan-validate`, proceed.

**If `outerIteration > 1` (plan revision after failure):**

1a-alt. **Revise plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine on {planFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - What was tried: {priorAttemptSummary}
    Lock completed phases. Only edit pending/failed phases."
   ```
   Then run steps 1b-1d as above.

**If `--stop-after plan`:** display plan summary and stop.

Check circuit breakers before proceeding.

---

### Step 2: Execution (Phase B)

Update `pipeline-state.toon`: `currentStage: execute`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-execute-plan.md first.
 Execute {planFile} with --auto flag.
 Report all AgentResults. Track agents spawned."
```

Record agents spawned (add to `agentsSpawned`).

On completion, read `.plan-execution/state.toon`:
- If status == `completed`: proceed to Step 3.
- If status == `failed` or `paused`:
  - Record failure context in `pipeline-state.toon` failureLog.
  - Increment `outerIteration`.
  - Check circuit breakers. If clear, go to Step 1 (Phase A with `--refine`).

Log stage result in `stageHistory`.

**If `--stop-after execute`:** display execution summary and stop.

Check circuit breakers before proceeding.

---

### Step 3: Test (Phase C)

Update `pipeline-state.toon`: `currentStage: test`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-test-plan.md first.
 Run tests with --run --parallel --auto flags.
 Report test results: passed count, failed count, pass rate."
```

Record agents spawned. Log stage in `stageHistory`.

**If `--stop-after test`:** display test results and stop.

---

### Step 4: Code Review

Update `pipeline-state.toon`: `currentStage: review-code`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-review-code.md first.
 Review the current branch. Write findings to .plan-execution/review-report.md."
```

Record agents spawned. Log stage in `stageHistory`.

**If `--stop-after review`:** display review summary and stop.

Proceed to the Pipeline Quality Gate.

---

### Step 5: Pipeline Quality Gate

Parse the outputs from Steps 3 and 4:

```
criticalCount  = count of findings where severity == "critical" in review-report.md
warningCount   = count of findings where severity == "warning" in review-report.md
testsPassed    = passed test count from Step 3
testsFailed    = failed test count from Step 3
testPassRate   = testsPassed / (testsPassed + testsFailed)
typecheckPass  = run project typecheck, read exit code (true if 0)
```

Apply the decision matrix:

| Condition | Action |
|-----------|--------|
| `criticalCount == 0` AND `testPassRate == 100%` AND `typecheckPass == true` | **PROCEED** (done) |
| `criticalCount <= 3` AND `testPassRate >= 80%` AND `fixCycleCount < 2` | **FIX-AND-RECHECK** |
| `criticalCount > 3` OR `testPassRate < 80%` OR systemic typecheck failures | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `fixCycleCount >= 2` (already tried fixing twice) | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |

**On PROCEED:** go to Step 7 (Completion).

**On FIX-AND-RECHECK:** go to Step 6 (Fix Cycle).

**On REVISE-PLAN:**
1. Build failure context: remaining critical findings, failing tests, typecheck errors, what fix cycles attempted.
2. Increment `outerIteration`.
3. Check circuit breakers. If clear, go to Step 1 (Phase A with `--refine`).

**On ESCALATE:** go to Step 7 (Escalation report).

---

### Step 6: Fix Cycle

Increment `fixCycleCount`. Update `pipeline-state.toon`: `currentStage: fix-code`.

6a. **Apply fixes.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-fix-code.md first.
    Run with --auto --severity critical,warning flags.
    Apply fixes from .plan-execution/review-report.md."
   ```
   Record agents spawned.

6b. **Convergence detection.** Compare before/after:
   - Did `criticalCount` decrease? (progress)
   - Did `testPassRate` increase? (progress)
   - Are the SAME findings still present (same tag:file:line)? (stuck)

   If stuck (same findings, same failures after fix cycle):
   - Skip directly to REVISE-PLAN. The failure is structural.
   - Do not burn another fix cycle.

6c. **Re-run quick review.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-code.md first.
    Run a quick review (code style + security only).
    Write updated findings to .plan-execution/review-report.md."
   ```

6d. **Re-run verification.** Run typecheck + existing tests.

6e. **Return to Step 5** (Pipeline Quality Gate) with updated results.

Log stage in `stageHistory`.

**If `--stop-after fix`:** display fix results and stop.

---

### Step 7: Completion

**On success (PROCEED from quality gate):**

Update `pipeline-state.toon`: `currentStage: complete`.

Display completion report:
```
## Pipeline Complete

Run ID: {runId}
Description: {description}
Outer iterations: {outerIteration}
Fix cycles: {fixCycleCount}
Agents spawned: {agentsSpawned} / {maxAgents}

### Stage Summary
| Stage | Status | Iteration | Agents | Gate |
|-------|--------|-----------|--------|------|
{stageHistory rows}

### Quality Metrics
- Critical findings: 0
- Test pass rate: 100%
- Typecheck: PASS

All acceptance criteria satisfied. Code is ready for human review.
```

**On escalation (circuit breaker tripped or ESCALATE from gate):**

Update `pipeline-state.toon`: `currentStage: escalated`.

Write `.plan-execution/escalation-report.md`:
```markdown
## Escalation Report

### What Worked
{list of succeeded stages with iteration numbers}

### What Failed
{failed stage, error details, what was tried}

### Iteration History
{stageHistory formatted as timeline}

### Circuit Breaker
{which breaker tripped and why}

### Recommended Action
{contextual suggestion: manual fix, plan redesign, scope reduction}

### Resume Command
Run `/loom-auto --resume` after addressing the above.
```

Display the escalation report to the user.

---

## Circuit Breakers

Check these conditions before every stage transition. If any triggers, go to Step 7 (Escalation).

| Breaker | Condition | Reason |
|---------|-----------|--------|
| **Iteration limit** | `outerIteration > maxIterations` | Prevents infinite plan revision |
| **Agent budget** | `agentsSpawned > maxAgents` | Cost control |
| **Identical failure** | Same verification error string in failureLog across two consecutive iterations | Revision did not help — human insight needed |
| **Fix stall** | Same review findings (tag:file:line match) after 2 fix cycles | loom-fix-code cannot resolve it |
| **Wave deadlock** | A wave failed 2x AND plan revision did not change that wave's phases | Structural issue in plan decomposition |
| **Validation failure** | Plan fails validation stages 1-4 after `--review-integrate` | Review recommendations broke the plan |

When a breaker trips:
1. Record the breaker name and condition in `pipeline-state.toon` failureLog.
2. Set `currentStage: escalated`.
3. Write the escalation report.
4. Stop execution.

---

## Resume Logic

When `--resume` is passed:

1. Read `pipeline-state.toon` from `.plan-execution/`.
2. If file does not exist: "No pipeline state found. Use `--from` to start a new run." Stop.
3. If `currentStage == complete`: "Pipeline already completed. Nothing to resume." Stop.
4. If `currentStage == escalated`: display the escalation report and ask the human what to do.

5. Re-enter the loop at the correct point:

   | `currentStage` value | Re-entry point |
   |----------------------|----------------|
   | `plan-create` | Step 1, sub-step 1a |
   | `plan-review` | Step 1, sub-step 1b |
   | `plan-integrate` | Step 1, sub-step 1c |
   | `plan-validate` | Step 1, sub-step 1d |
   | `execute` | Step 2 (pass `--resume` to loom-execute-plan) |
   | `test` | Step 3 |
   | `review-code` | Step 4 |
   | `fix-code` | Step 6 |

6. Restore all state variables from `pipeline-state.toon`: `outerIteration`, `agentsSpawned`, `fixCycleCount`, `maxIterations`, `maxAgents`.
7. Continue the loop from the re-entry point.

---

## Error Handling

- **Agent failure (timeout or crash):** Record in failureLog. If the stage is retryable (plan-create, execute), retry once with error context. If retry also fails, escalate.
- **Missing protocol files:** Warn and continue with defaults. Do not block the pipeline on missing docs.
- **Disk write failure:** If `pipeline-state.toon` cannot be written, warn the user that resume will not work. Continue execution.
- **Plan file missing:** If `planFile` does not exist and no `--from` provided, tell the user: "No plan found. Use `--from 'description'` to create one, or `--plan path` to specify an existing plan." Stop.
- **Unexpected state in pipeline-state.toon:** If `currentStage` is not a recognized value, treat as corrupted. Offer to reinitialize or abort.

---

## Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status". Include these additional fields for pipeline tracking:

```toon
command: loom-auto
stage: {currentStage}
stageName: {human-readable stage name}
outerIteration: {outerIteration}
fixCycleCount: {fixCycleCount}
agentsSpawned: {agentsSpawned}
agentBudget: {maxAgents}
gateResult: {last quality gate result}
updatedAt: {ISO timestamp}
```

Update the status line at every stage transition and after every agent completes.

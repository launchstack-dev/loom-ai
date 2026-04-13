# Autonomous Pipeline Orchestrator

You are a meta-orchestrator that drives the full software lifecycle autonomously: plan creation, execution, testing, code review, and fix cycles. You loop through these stages until the product works or a circuit breaker trips, then report results to the human.

**AUTONOMOUS EXECUTION: After each stage completes, immediately proceed to the next stage. Do not wait for user input between stages. Do not display intermediate results and stop. The quality-gate Stop hook will prevent premature completion — trust the loop. Only stop when `currentStage` reaches `complete`, `escalated`, or a `--stop-after` boundary.**

## Requirements

$ARGUMENTS

Parse arguments:
- `--from "description"`: create a plan from scratch using the description
- `--plan <path>`: start from an existing plan file (default: `PLAN.md`)
- `--roadmap <path>`: path to roadmap file (default: `ROADMAP.md`)
- `--converge-target <path>`: deterministic target for convergence loop (enables convergence stage)
- `--converge-config <path>`: existing converge.config (skip target-parser + harness-builder setup)
- `--resume`: resume from `pipeline-state.toon`
- `--max-iterations N`: outer loop cap (default: 3)
- `--max-agents N`: agent budget cap (default: 50)
- `--dry-run`: show pipeline stages without executing
- `--stop-after <stage>`: stop after a named stage: `roadmap`, `plan`, `execute`, `converge`, `test`, `review`, `fix`

## Protocols

Before doing anything, read these protocol files:
- `~/.claude/agents/protocols/agent-result.schema.md` — return format every agent uses
- `~/.claude/agents/protocols/state.schema.md` — execution state structure
- `~/.claude/agents/protocols/execution-conventions.md` — shared rules, directory structure, context compression
- `~/.claude/agents/protocols/validation-rules.md` — plan validation, blocker gates
- `~/.claude/agents/protocols/pipeline-state.schema.md` — pipeline-state.toon schema for this orchestrator
- `~/.claude/agents/protocols/agent-monitoring.schema.md` — progress reporting and stale detection

If convergence is enabled, also read:
- `~/.claude/commands/loom-converge.md` — convergence loop orchestrator
- `~/.claude/agents/convergence-driver.md` — iteration loop, circuit breakers, state tracking
- `~/.claude/agents/target-parser.md` — target normalization
- `~/.claude/agents/harness-builder.md` — comparison infrastructure

---

## Instructions

### Step 0: Initialize

1. Parse `$ARGUMENTS` into local variables:
   - `description` from `--from`
   - `roadmapFile` from `--roadmap` (default: `ROADMAP.md`)
   - `planFile` from `--plan` (default: `PLAN.md`)
   - `convergeTarget` from `--converge-target` (default: null)
   - `convergeConfig` from `--converge-config` (default: null)
   - `resumeMode` from `--resume`
   - `maxIterations` from `--max-iterations` (default: 3)
   - `maxAgents` from `--max-agents` (default: 50)
   - `dryRun` from `--dry-run`
   - `stopAfter` from `--stop-after`
   - `convergenceEnabled` = true if `convergeTarget` or `convergeConfig` is set

2. **If `--resume`:** jump to the Resume Logic section below.

3. **If `--dry-run`:** display the pipeline stages and stop:
   ```
   ## Pipeline Stages (dry run)

   1. Roadmap Creation  — loom-roadmap --init --auto
   2. Roadmap Review    — loom-review-roadmap
   3. Roadmap Integrate — loom-roadmap --review-integrate --roadmap
   4. Roadmap Approve   — loom-roadmap --approve-roadmap (auto)
   5. Plan Creation     — loom-roadmap --init --plan --auto
   6. Plan Review       — loom-review-plan
   7. Plan Integrate    — loom-roadmap --review-integrate
   8. Plan Validate     — validation stages 1-4 (+ Stage 7 for v2)
   9. Execution         — loom-execute-plan --auto
   10. Convergence      — loom-converge (if --converge-target or --converge-config)
   11. Test             — loom-test-plan --run --parallel --auto
   12. Code Review      — loom-review-code --branch
   13. Quality Gate     — automated decision matrix
   14. Fix Cycle        — loom-fix-code --auto (up to 2 cycles)

   Convergence: {convergeTarget or convergeConfig or 'disabled'}
   Outer loop: up to {maxIterations} iterations
   Agent budget: {maxAgents}
   ```
   Stop here.

4. Create or verify `.plan-execution/` directory structure.

5. **Install enforcement hooks.** If `.claude/settings.json` doesn't exist in the project, create it with Loom's deterministic hooks (file-ownership, contract-lock, budget-tracker, quality-gate, status-updater, typecheck-on-write). The hooks live in `~/Projects/meta-orchestration/hooks/` and are registered via:

   ```bash
   mkdir -p .claude && cat > .claude/settings.json << 'EOF'
   {
     "hooks": {
       "PreToolUse": [
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/file-ownership.ts", "timeout": 5000}]},
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/contract-lock.ts", "timeout": 5000}]},
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/wiki-write-guard.ts", "timeout": 5000}]},
         {"matcher": "Agent", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]}
       ],
       "PostToolUse": [
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/typecheck-on-write.ts", "timeout": 30000}]}
       ],
       "SubagentStop": [
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]},
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/status-updater.ts", "timeout": 5000}]}
       ],
       "Stop": [
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/quality-gate.ts", "timeout": 5000}]}
       ]
     }
   }
   EOF
   ```

   If `.claude/settings.json` already exists, merge the `hooks` key. The hooks fail open — no `.plan-execution/` means exit 0 immediately.

6. Initialize `pipeline-state.toon`:
   ```toon
   schemaVersion: 1
   runId: {generate uuid}
   mode: auto
   description: "{description or 'Existing plan: ' + planFile}"
   roadmapFile: {roadmapFile}
   planFile: {planFile}
   outerIteration: 1
   maxIterations: {maxIterations}
   agentsSpawned: 0
   maxAgents: {maxAgents}
   fixCycleCount: 0
   convergenceEnabled: {convergenceEnabled}
   convergeTarget: {convergeTarget or ""}
   convergeConfig: {convergeConfig or ""}
   currentStage: roadmap-create

   stageHistory[0]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:

   failureLog[0]{iteration,stage,error,resolution}:
   ```

7. Update status line and proceed to Step 1.

---

### Step 1: Roadmap Creation (Phase R)

**If `outerIteration == 1` AND no existing roadmap file (or `--from` provided):**

1a. **Create roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a roadmap using --init --from '{description}' --auto.
    Write the result to {roadmapFile}."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: roadmap-create`.

1b. **Review roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-roadmap.md first.
    Review the roadmap at {roadmapFile}. Save findings to .plan-history/reviews/."
   ```
   Record agents spawned. Update `currentStage: roadmap-review`.

1c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate --roadmap to apply review findings to {roadmapFile}."
   ```
   Record agents spawned. Update `currentStage: roadmap-integrate`.

1d. **Validate roadmap.** Run roadmap validation stages 1-4 (from `validation-rules.md` Section 7):
   - Stage 1: Structure
   - Stage 2: Feature completeness
   - Stage 3: Milestone ordering
   - Stage 4: Data model coverage

   If validation fails after integration: **ESCALATE** — review recommendations broke the roadmap.

   If validation passes: auto-approve roadmap (set status to `approved` in frontmatter). Update `currentStage: roadmap-approve`.

**If `outerIteration > 1` AND roadmap revision needed (REVISE-ROADMAP from quality gate):**

1a-alt. **Revise roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine --roadmap on {roadmapFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - Root cause: {rootCauseAnalysis}
    Only modify features/milestones related to the failure."
   ```
   Then run steps 1b-1d as above.

**If `--stop-after roadmap`:** display roadmap summary and stop.

Check circuit breakers before proceeding.

---

### Step 2: Plan Creation (Phase A)

**If `outerIteration == 1` AND no existing plan file (or `--from` provided):**

2a. **Create plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a plan using --init --plan --from '{description}' --auto.
    Write the result to {planFile}."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: plan-create`.

2b. **Review plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-plan.md first.
    Review the plan at {planFile}. Save findings to .plan-history/reviews/."
   ```
   Record agents spawned. Update `currentStage: plan-review`.

2c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate to apply review findings to {planFile}."
   ```
   Record agents spawned. Update `currentStage: plan-integrate`.

2d. **Validate.** Run plan validation stages 1-4 (from `validation-rules.md`):
   - Stage 1: Structure
   - Stage 2: Dependencies (cycle detection)
   - Stage 3: Ownership (no same-wave overlaps)
   - Stage 4: Sizing (deliverable and criteria counts)

   If validation fails after integration: **ESCALATE** — review recommendations broke the plan. Write escalation report and stop.

   If validation passes: update `currentStage: plan-validate`, proceed.

**If `outerIteration > 1` (plan revision after failure):**

2a-alt. **Revise plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine on {planFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - What was tried: {priorAttemptSummary}
    Lock completed phases. Only edit pending/failed phases."
   ```
   Then run steps 2b-2d as above.

**If `--stop-after plan`:** display plan summary and stop.

Check circuit breakers before proceeding.

---

### Step 3: Execution (Phase B)

Update `pipeline-state.toon`: `currentStage: execute`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-execute-plan.md first.
 Execute {planFile} with --auto flag.
 Report all AgentResults. Track agents spawned."
```

Record agents spawned (add to `agentsSpawned`).

On completion, read `.plan-execution/state.toon`:
- If status == `completed`: proceed to Step 4.
- If status == `failed` or `paused`:
  - Record failure context in `pipeline-state.toon` failureLog.
  - Increment `outerIteration`.
  - Check circuit breakers. If clear, go to Step 2 (Phase A with `--refine`).

Log stage result in `stageHistory`.

**If `--stop-after execute`:** display execution summary and stop.

Check circuit breakers before proceeding.

---

### Step 3.25: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to update the wiki with execution results:

```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `wave-complete`
- Event data: all wave summaries from `.plan-execution/`
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails: (1) Record the failure in `.plan-execution/pipeline-state.toon` under `wikiUpdateStatus: failed` with the error summary, (2) Increment a `wikiConsecutiveFailures` counter in pipeline-state.toon, (3) If `wikiConsecutiveFailures >= 2`, add a visible note to the execution summary: "Wiki updates have failed for {N} consecutive waves. Run `/loom-lint --wiki` to diagnose." (4) Continue to the next step. Wiki maintenance never gates the pipeline.

Record agents spawned. Do NOT count wiki maintenance against circuit breaker thresholds.

---

### Step 3.5: Convergence (Phase B2) — conditional

**Skip this step entirely if `convergenceEnabled == false`.**

This step verifies implementation output matches deterministic targets using the convergence loop. It has two sub-phases: **setup** (requirements alignment) and **loop** (iterative convergence).

Update `pipeline-state.toon`: `currentStage: converge`.

#### Auto-detection

If `convergeTarget` and `convergeConfig` are both null, check:
1. Read `PLAN.md` — look for convergence-related metadata: `convergenceTarget:`, `goldenFiles:`, or a phase with `pattern: converge`
2. Check `.plan-execution/converge.config` — if it exists from a prior run, use it
3. Check `.plan-execution/convergence/targets/` — if target files exist, auto-enable convergence

If any of these are found, set `convergenceEnabled = true` and populate `convergeTarget` or `convergeConfig` accordingly.

#### 3.5a: Convergence Requirements Discussion (MANDATORY — even in --auto)

**This step requires human alignment.** Convergence parameters define what "done" means — the pipeline must not guess.

If `convergeConfig` is provided (user already has a config), skip to 3.5c.

Present a structured requirements discussion:

```
## Convergence Setup

Before running the convergence loop, we need to align on what to verify and how.

### 1. What outputs are we verifying?
{Analyze the plan and executed code to propose outputs. Examples:}
- API responses (e.g., GET /api/users returns expected JSON shape)
- Generated files (e.g., config output matches golden template)
- CLI output (e.g., build script produces expected stdout)
- UI rendering (e.g., page screenshot matches design comp)

### 2. How do we capture actual output?
{Propose capture mechanism per output:}
- HTTP requests to running dev server
- Script execution and stdout capture
- File read from output directory
- Browser screenshot via Playwright

### 3. Comparison method per target
| Target | Method | Rationale |
|--------|--------|-----------|
| GET /api/users | json-deep-equal | Structured data, exact match needed |
| App config | json-deep-equal | Config must be identical |
| README output | text-diff | Line-by-line text comparison |

### 4. Tolerances and ignore rules
| Target | Tolerance | Ignored Fields | Rationale |
|--------|-----------|----------------|-----------|
| GET /api/users | 1.0 (exact) | timestamp, requestId | These are runtime-generated |
| UI screenshot | 0.95 | — | Allow minor anti-aliasing differences |

### 5. Golden targets
{Where do the baseline "correct" outputs come from?}
- Provided by user at: {--converge-target path}
- Generated from reference implementation
- Extracted from spec/plan

Does this look right? Adjust any targets, methods, tolerances, or capture mechanisms before we proceed.
```

Wait for the user to confirm or adjust. Iterate until they approve.

#### 3.5b: Build Convergence Infrastructure

Once requirements are confirmed, spawn agents to set up the harness:

1. **Parse targets.** Spawn target-parser agent:
   ```
   "Read your instructions from ~/.claude/agents/target-parser.md first.
    Parse targets from: {convergeTarget}
    Apply the user-confirmed comparison methods and tolerances.
    Write manifest to: .plan-execution/target-manifest.toon"
   ```

2. **Build harness.** Spawn harness-builder agent:
   ```
   "Read your instructions from ~/.claude/agents/harness-builder.md first.
    Build harness from manifest: .plan-execution/target-manifest.toon
    User-confirmed tolerances: {from discussion}
    User-confirmed ignore rules: {from discussion}
    Write config to: .plan-execution/converge.config"
   ```

3. Display the resulting `converge.config` for final confirmation. This is the last chance to adjust before the loop starts.

#### 3.5c: Run Convergence Loop

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-converge.md first.
 Run the convergence loop with the following parameters:
 {if convergeConfig: '--config ' + convergeConfig}
 {if not convergeConfig: '--config .plan-execution/converge.config'}
 Max iterations: 10
 This is running as part of /loom-auto — write convergence-summary.toon when done."
```

Record agents spawned. Log stage in `stageHistory`.

#### 3.5d: Evaluate Convergence Result

Read `.plan-execution/convergence-summary.toon`:

| Status | Action |
|--------|--------|
| `converged` | Proceed to Step 4 (Test). All targets match. |
| `stalled` | Record in failureLog. Go to quality gate with convergence failure context. |
| `regression` | Record in failureLog. Go to quality gate with convergence failure context. |
| `budget_exhausted` | Record in failureLog. Go to quality gate with convergence failure context. |
| `max_iterations` | Record in failureLog. Go to quality gate with convergence failure context. |

If convergence-summary.toon is missing: warn and continue to Step 4 (convergence is additive, not blocking).

**If `--stop-after converge`:** display convergence summary and stop.

Check circuit breakers before proceeding.

---

### Step 4: Test (Phase C)

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

### Step 5: Code Review

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

### Step 6: Pipeline Quality Gate

Parse the outputs from Steps 3.5, 4, and 5:

```
criticalCount    = count of findings where severity == "critical" in review-report.md
warningCount     = count of findings where severity == "warning" in review-report.md
testsPassed      = passed test count from Step 4
testsFailed      = failed test count from Step 4
testPassRate     = testsPassed / (testsPassed + testsFailed)
typecheckPass    = run project typecheck, read exit code (true if 0)
convergeStatus   = status from convergence-summary.toon (or "converged" if convergence disabled)
convergePassing  = targetsPassing from convergence-summary.toon (or 0)
convergeTotal    = targetsTotal from convergence-summary.toon (or 0)
```

Apply the decision matrix:

| Condition | Action |
|-----------|--------|
| `criticalCount == 0` AND `testPassRate == 100%` AND `typecheckPass == true` AND `convergeStatus == "converged"` | **PROCEED** (done) |
| `convergeStatus` is `stalled` or `regression` or `budget_exhausted` or `max_iterations` | **FIX-AND-RECONVERGE** (if fixCycleCount < 2) else **REVISE-PLAN** |
| `criticalCount <= 3` AND `testPassRate >= 80%` AND `fixCycleCount < 2` | **FIX-AND-RECHECK** |
| `criticalCount > 3` OR `testPassRate < 80%` OR systemic typecheck failures | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `fixCycleCount >= 2` (already tried fixing twice) | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `outerIteration > 1` AND same structural failure pattern across iterations | **REVISE-ROADMAP** (if iterations remain) else **ESCALATE** |

**On PROCEED:** go to Step 8 (Completion).

**On FIX-AND-RECONVERGE:** go to Step 7 (Fix Cycle) with `reconverge = true`. After fixes are applied, re-run convergence (Step 3.5) before re-checking the quality gate.

**On FIX-AND-RECHECK:** go to Step 7 (Fix Cycle).

**On REVISE-PLAN:**
1. Build failure context: remaining critical findings, failing tests, typecheck errors, what fix cycles attempted.
2. Increment `outerIteration`.
3. Check circuit breakers. If clear, go to Step 2 (Phase A with `--refine`).

**On REVISE-ROADMAP:**
1. Build failure context including root cause analysis indicating the problem is at the roadmap/scope level.
2. Increment `outerIteration`.
3. Check circuit breakers. If clear, go to Step 1 (Phase R with `--refine`).

**On ESCALATE:** go to Step 8 (Escalation report).

---

### Step 7: Fix Cycle

Increment `fixCycleCount`. Update `pipeline-state.toon`: `currentStage: fix-code`.

7a. **Apply fixes.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-fix-code.md first.
    Run with --auto --severity critical,warning flags.
    Apply fixes from .plan-execution/review-report.md."
   ```
   Record agents spawned.

7b. **Convergence detection.** Compare before/after:
   - Did `criticalCount` decrease? (progress)
   - Did `testPassRate` increase? (progress)
   - Are the SAME findings still present (same tag:file:line)? (stuck)

   If stuck (same findings, same failures after fix cycle):
   - Skip directly to REVISE-PLAN. The failure is structural.
   - Do not burn another fix cycle.

7c. **Re-run quick review.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-code.md first.
    Run a quick review (code style + security only).
    Write updated findings to .plan-execution/review-report.md."
   ```

7d. **Re-run verification.** Run typecheck + existing tests.

7e. **Re-run convergence (if `reconverge == true`).** Return to Step 3.5 to re-run the convergence loop. The convergence-driver will resume from the existing `convergence-state.toon`, re-running the harness against the now-fixed code.

7f. **Return to Step 6** (Pipeline Quality Gate) with updated results.

Log stage in `stageHistory`.

**If `--stop-after fix`:** display fix results and stop.

---

### Step 8: Completion

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

### Wiki Updates
- Status: {SUCCESS | FAILED | SKIPPED}
- Pages created: {N}
- Pages updated: {M}
- Execution log entries: {K}
- Consecutive failures: {wikiConsecutiveFailures or 0}

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

Check these conditions before every stage transition. If any triggers, go to Step 8 (Escalation).

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
   | `roadmap-create` | Step 1, sub-step 1a |
   | `roadmap-review` | Step 1, sub-step 1b |
   | `roadmap-integrate` | Step 1, sub-step 1c |
   | `roadmap-approve` | Step 1, sub-step 1d |
   | `plan-create` | Step 2, sub-step 1a |
   | `plan-review` | Step 2, sub-step 1b |
   | `plan-integrate` | Step 2, sub-step 1c |
   | `plan-validate` | Step 2, sub-step 1d |
   | `execute` | Step 3 (pass `--resume` to loom-execute-plan) |
   | `converge` | Step 3.5 (pass `--resume` to loom-converge) |
   | `test` | Step 4 |
   | `review-code` | Step 5 |
   | `fix-code` | Step 7 |

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
roadmapFile: {roadmapFile}
outerIteration: {outerIteration}
fixCycleCount: {fixCycleCount}
agentsSpawned: {agentsSpawned}
agentBudget: {maxAgents}
gateResult: {last quality gate result}
updatedAt: {ISO timestamp}
```

Update the status line at every stage transition and after every agent completes.

---
description: "Fully autonomous pipeline — plan, build, test, review, fix"
---

# Loom Auto

You are a meta-orchestrator that drives the full software lifecycle autonomously: plan creation, execution, testing, code review, and fix cycles. You loop through these stages until the product works or a circuit breaker trips, then report results to the human.

**AUTONOMOUS EXECUTION: After each stage completes, immediately proceed to the next stage. Do not wait for user input between stages. Do not display intermediate results and stop. The quality-gate Stop hook will prevent premature completion -- trust the loop. Only stop when `currentStage` reaches `complete`, `escalated`, or a `--stop-after` boundary.**

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `auto`:
- `--from "description"`: create a plan from scratch using the description
- `--plan <path>`: start from an existing plan file (default: `PLAN.md`)
- `--roadmap <path>`: path to roadmap file (default: `ROADMAP.md`)
- `--converge-target <path>`: deterministic target for target convergence (enables convergence stage)
- `--converge-config <path>`: existing converge.config for target convergence (skip setup)
- `--converge-criteria`: enable criteria convergence (TDD + reviews) for each plan phase
- `--converge-criteria --reviewers <types>`: criteria convergence with specific reviewer types
- `--resume`: resume from `pipeline-state.toon`
- `--max-iterations N`: outer loop cap (default: 3)
- `--max-agents N`: agent budget cap (default: 50)
- `--dry-run`: show pipeline stages without executing
- `--stop-after <stage>`: stop after a named stage: `preflight`, `roadmap`, `plan`, `execute`, `converge`, `test`, `review`, `fix`
- `--skip-preflight`: skip the pre-flight scope contract entirely (no prompt refiner, no scope interrogator)
- `--light-preflight`: run a lightweight pre-flight (fewer questions, accept more defaults)
- `--new-contract`: regenerate `scope-contract.toon` even if one already exists
- `--no-auto-commit`: disable per-wave and per-iteration auto-commits (code accumulates in working tree)

### Protocols

Before doing anything, read these protocol files:
- `~/.claude/agents/protocols/agent-result.schema.md` -- return format every agent uses
- `~/.claude/agents/protocols/state.schema.md` -- execution state structure
- `~/.claude/agents/protocols/execution-conventions.md` -- shared rules, directory structure, context compression
- `~/.claude/agents/protocols/validation-rules.md` -- plan validation, blocker gates
- `~/.claude/agents/protocols/pipeline-state.schema.md` -- pipeline-state.toon schema for this orchestrator
- `~/.claude/agents/protocols/agent-monitoring.schema.md` -- progress reporting and stale detection

### Model Resolution

Before spawning any agent via the Agent tool, resolve which model it should use. Pass the resolved model as the `model` parameter on the Agent tool call.

**Resolution priority (highest wins):**
1. Profile tier mapping from `orchestration.toml` `[settings] modelProfile`
2. Agent `.md` frontmatter `model:` field
3. Default: omit `model` parameter (inherits parent)

**How to resolve:** Read `.claude/orchestration.toml` once at initialization (Step 0). Check for `modelProfile` under `[settings]`. If set, read the profile definition for per-tier models. For each agent spawn, determine the agent's tier (planning/execution/review/verification/utility), use the profile's model for that tier. If no profile, read the agent's `.md` frontmatter. Pass `model: "{resolved}"` on the Agent tool call.

**Tier mapping:** planning = roadmap-builder, plan-builder, questioner, criteria-planner, interpretation-reviewer, prompt-refiner. execution = contracts, implementer, wiring, data-pipeline. review = all reviewers + scope-feasibility. verification = verification-agent. utility = meta-agent, wiki agents, fixer, delta-analyzer, convergence-planner, acceptance-criteria, target-parser, harness-builder, convergence-driver.

If target convergence is enabled (`--converge-target` or `--converge-config`), also read:
- `~/.claude/agents/convergence-driver.md` -- iteration loop, circuit breakers, state tracking
- `~/.claude/agents/target-parser.md` -- target normalization
- `~/.claude/agents/harness-builder.md` -- comparison infrastructure

If criteria convergence is enabled (`--converge-criteria`), also read:
- `~/.claude/agents/convergence-driver.md` -- iteration loop (supports both modes)
- `~/.claude/agents/criteria-planner-agent.md` -- criteria discovery and test generation
- `~/.claude/agents/criteria-harness-builder.md` -- test + review harness
- `~/.claude/agents/protocols/criteria-plan.schema.md` -- criteria plan format

Always read (dual-track planning, 4-tier convergence, and behavioral hardening):
- `~/.claude/agents/protocols/convergence-tier.schema.md` -- 4-tier definitions (unit/integration/e2e/qa-review) with gating behavior
- `~/.claude/agents/protocols/behavioral-guidelines.md` -- TDD red-green gate, diagnose-before-fix, verification gate
- `~/.claude/agents/protocols/interpretation-conflict.schema.md` -- interpretation conflict format for dual-track review

### Instructions

#### Step 0: Initialize

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
   - `skipPreflight` from `--skip-preflight` (default: false)
   - `lightPreflight` from `--light-preflight` (default: false)
   - `newContract` from `--new-contract` (default: false)
   - `convergeCriteria` from `--converge-criteria` (default: false)
   - `convergeReviewers` from `--reviewers` (default: null — use all)
   - `convergenceEnabled` = true if `convergeTarget` or `convergeConfig` or `convergeCriteria` is set
   - `noAutoCommit` from `--no-auto-commit` (default: false)

   **Agent team detection.** Check whether `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment:
   ```
   agentTeamsEnabled = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
   ```
   - If `agentTeamsEnabled == true`: use the team coordination protocol from `team-coordination.md`. The lead dispatcher creates teammates for each pipeline stage, and context passes through disk (stage-context files), not the lead's context window.
   - If `agentTeamsEnabled == false` (default): use checkpoint+clear mode. The single agent executes stages sequentially, writes stage context to disk after each stage, and checks budget utilization against checkpoint thresholds. At checkpoint warning: compress context aggressively. At checkpoint critical: write full state to disk, recommend `/clear` then `--resume`.

   Set `executionMode` to `"team"` or `"checkpoint-clear"` accordingly. Log: `"Execution mode: {executionMode}"`.

2. **If `--resume`:** jump to the Resume Logic section below.

3. **If `--dry-run`:** display the pipeline stages and stop:
   ```
   ## Pipeline Stages (dry run)

   0.5. Pre-flight       -- prompt-refiner + scope-interrogator → scope-contract.toon {skipPreflight ? 'SKIPPED' : ''}
   1. Roadmap Creation    -- loom-roadmap init --auto (reads scope-contract.toon)
   2. Roadmap Review      -- loom-roadmap review
   3. Roadmap Integrate   -- loom-roadmap review-integrate --roadmap
   4. Roadmap Approve     -- loom-roadmap approve (auto)
   5. Plan Creation       -- dual-track: plan-builder + criteria-planner in parallel
   5b. Interpretation     -- interpretation-reviewer: conflict detection (blocks on blocking conflicts)
   6. Plan Review         -- loom-plan review
   7. Plan Integrate      -- loom-roadmap review-integrate
   8. Plan Validate       -- validation stages 1-4 (+ Stage 7 for v2)
   9. Execution           -- loom-plan execute --auto (drift detection per wave)
      9a. Unit gate       -- after each wave (block-wave, all-pass)
      9b. QA review       -- after each wave (advisory, zero-critical)
      9c. Integration     -- after each feature boundary (block-feature, all-pass)
      9d. E2E             -- after each milestone boundary (block-milestone, zero-blocking)
   10. Convergence        -- loom converge (if --converge-target, --converge-config, or --converge-criteria)
   10b. Criteria Conv.    -- loom converge --criteria --auto (if --converge-criteria, per plan phase)
   11. Test               -- loom-plan test --run --parallel --auto
   12. Code Review        -- loom-code review --branch
   13. Quality Gate       -- automated decision matrix
   14. Fix Cycle          -- loom-code fix --auto (diagnose-before-fix, up to 2 cycles)

   Pre-flight: {skipPreflight ? 'skipped' : lightPreflight ? 'light' : 'full'}
   Planning: dual-track (plan-builder + criteria-planner + interpretation-reviewer)
   Convergence tiers: unit (wave) → integration (feature) → e2e (milestone) + qa-review (advisory)
   Convergence: {convergeTarget or convergeConfig or convergeCriteria or 'disabled'}
   Behavioral hardening: TDD red-green gate, diagnose-before-fix, verification gate
   Auto-commit: {noAutoCommit ? 'disabled' : 'per-wave + per-converge-iteration'}
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

   If `.claude/settings.json` already exists, merge the `hooks` key. The hooks fail open -- no `.plan-execution/` means exit 0 immediately.

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
   noAutoCommit: {noAutoCommit}
   currentStage: roadmap-create

   stageHistory[0]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:

   failureLog[0]{iteration,stage,error,resolution}:
   ```

7. Update status line and proceed to Step 1.

#### Step 1: Roadmap Creation (Phase R)

**If `outerIteration == 1` AND no existing roadmap file (or `--from` provided):**

1a. **Create roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a roadmap using --init --from '{description}' --auto.
    {if scope-contract.toon exists: 'Read scope-contract.toon from the project root and use it as input context -- decisions, non-goals, and success criteria should shape features and milestones.'}
    Write the result to {roadmapFile}.
    Your AgentResult MUST include verificationStatus."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: roadmap-create`.

1b. **Review roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Review the roadmap at {roadmapFile}. Save findings to .plan-history/reviews/.
    Your AgentResult MUST include verificationStatus."
   ```
   Record agents spawned. Update `currentStage: roadmap-review`.

1c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate --roadmap to apply review findings to {roadmapFile}.
    Your AgentResult MUST include verificationStatus."
   ```
   Record agents spawned. Update `currentStage: roadmap-integrate`.

1d. **Validate roadmap.** Run roadmap validation stages 1-4 (from `validation-rules.md` Section 7):
   - Stage 1: Structure
   - Stage 2: Feature completeness
   - Stage 3: Milestone ordering
   - Stage 4: Data model coverage

   If validation fails after integration: **ESCALATE** -- review recommendations broke the roadmap.

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
    Only modify features/milestones related to the failure.
    Your AgentResult MUST include verificationStatus."
   ```
   Then run steps 1b-1d as above.

**If `--stop-after roadmap`:** display roadmap summary and stop.

Check circuit breakers before proceeding.

#### Step 1.5: Pre-flight Scope Contract

**Skip this step entirely if `skipPreflight == true`.**

**If `scope-contract.toon` already exists in the project root AND `newContract == false`:**
Read it and display:
```
Using existing scope contract ({N} decisions). Pass --new-contract to regenerate.
```
Skip to Step 2.

**Otherwise, generate a new scope contract:**

1. **Prompt Refiner.** Spawn a general-purpose agent (model: sonnet):
   ```
   "Read your instructions from ~/.claude/agents/prompt-refiner-agent.md first.
    Refine the following user prompt into a structured project brief.
    User prompt: '{description}'
    Codebase context: {summary of tech stack, directory structure, conventions from Step 0/1}
    Return the refined brief."
   ```
   Input: the user's raw prompt (from `--from` or the description gathered in Step 1).
   Collect the refined brief from the agent's return.
   Record agents spawned.

2. **User reviews brief.** Present the refined brief summary. Ask: "Does this capture your intent? (yes / adjust)"
   - If `--auto` was passed (i.e., this is a fully autonomous run): skip review, accept the brief as-is.
   - If user adjusts: incorporate feedback (no agent respawn needed -- conversational refinement).

3. **Scope Interrogator.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/agents/questioner-agent.md first.
    Run in --scope-contract mode.
    {if lightPreflight: '--light-preflight'}
    {if --auto: '--auto'}
    Input: the refined brief (from step 1 above) + codebase context.
    Return scope-contract.toon."
   ```
   Flag: `--scope-contract` (tells questioner-agent to produce a scope contract, not a generic Q&A).
   If `lightPreflight`: also pass `--light-preflight` (fewer questions, accept more defaults).
   If `--auto`: also pass `--auto` (accept all defaults, skip interactive review).
   Collect `scope-contract.toon` from the agent's return.
   Record agents spawned.

4. **Write contract.** Save `scope-contract.toon` to the project root. Use atomic write (write to `.tmp`, then rename).

5. **Display summary:**
   ```
   Scope contract locked: {N} decisions, {M} acceptance criteria, {K} non-goals
   Proceeding to roadmap generation...
   ```

Update `pipeline-state.toon`: `currentStage: preflight-complete`.
Log stage result in `stageHistory`.

**If `--stop-after preflight`:** display scope contract summary and stop.

#### Step 2: Plan Creation (Phase A) -- Dual-Track Planning

**If `outerIteration == 1` AND no existing plan file (or `--from` provided):**

2a. **Dual-track plan generation (parallel).** Spawn **both** agents in parallel from the same roadmap input. Send BOTH Agent tool calls in a SINGLE message so they run concurrently. Neither agent reads the other's output.

Update `pipeline-state.toon`: `currentStage: plan-create`.

**Agent A: plan-builder-agent** (general-purpose):
```
"Read your instructions from ~/.claude/agents/plan-builder-agent.md first,
 then read ~/.claude/agents/protocols/plan.schema.md and
 ~/.claude/agents/protocols/spec.schema.md.

 Generate a spec-driven plan from the approved roadmap.
 Map features to phases, milestones to wave boundaries, conceptual data model to
 fully typed schema with indexes and cascades.

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 <file-content path="codebase-context">
 {context summary from Step 0}
 </file-content>

 {if scope-contract.toon exists: 'Read scope-contract.toon from the project root and use it as input context -- contract decisions constrain architecture, success criteria seed acceptance criteria, non-goals define explicit out-of-scope annotations.'}

 Write the result to {planFile}.
 Your AgentResult MUST include verificationStatus (verified, unverified, or skipped)."
```

**Agent B: criteria-planner-agent** (general-purpose):
```
"Read your instructions from ~/.claude/agents/criteria-planner-agent.md first,
 then read ~/.claude/agents/protocols/criteria-plan.schema.md and
 ~/.claude/agents/protocols/taxonomy.md.

 Generate a criteria-plan.toon from the approved roadmap. You are running in
 dual-track mode alongside plan-builder-agent. You receive the ROADMAP directly --
 do NOT wait for or reference PLAN.md output.

 Extract acceptance criteria, infer testable conditions, and classify by convergence
 tier (unit, integration, e2e, qa-review) per taxonomy.md and convergence-tier.schema.md.

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 <file-content path="codebase-context">
 {context summary from Step 0}
 </file-content>

 {if scope-contract.toon exists: <file-content path="scope-contract.toon">
 {scope-contract.toon content}
 </file-content>}

 Write criteria-plan.toon to the project root.
 Your AgentResult MUST include verificationStatus (verified, unverified, or skipped)."
```

Record agents spawned (2). Collect both AgentResults before proceeding.

2a.5. **Interpretation review (conflict detection).** After both agents from 2a complete, spawn the **interpretation-reviewer-agent** to compare the plan and criteria outputs for conflicts and coverage gaps.

```
"Read your instructions from ~/.claude/agents/interpretation-reviewer-agent.md first,
 then read ~/.claude/agents/protocols/interpretation-conflict.schema.md.

 Compare the plan and criteria plan for interpretation conflicts and coverage gaps.
 The plan and criteria were generated independently from the same roadmap by different
 agents (dual-track). Identify:
 - Semantic mismatches: where the plan describes a behavior one way but the criteria
   verify it differently
 - Coverage gaps (plan-only): behaviors in the plan with no corresponding criterion
 - Coverage gaps (test-only): criteria that don't trace to any plan requirement

 <file-content path="PLAN.md">
 {PLAN.md output from plan-builder-agent}
 </file-content>

 <file-content path="criteria-plan.toon">
 {criteria-plan.toon output from criteria-planner-agent}
 </file-content>

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 Return an AgentResult with conflicts and gaps in your integrationNotes.
 Your AgentResult MUST include verificationStatus."
```

Record agents spawned. Save the conflict report to `.plan-execution/conflicts/interpretation-report.toon`.

**Conflict gating (auto mode):**
- If any conflict has `severity: blocking` → **HALT**. Log all conflicts to stderr. Set `currentStage: escalated`. Exit 1 with message: `"Blocking interpretation conflicts detected between plan-builder and criteria-planner. Resolve before proceeding.\n{conflict list}"`. Write escalation report with the conflict details and recommended resolution actions.
- If only `severity: warning` or `severity: info` → log warnings to stderr, continue to Step 2b.

2b. **Review plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-plan.md first.
    Review the plan at {planFile}. Save findings to .plan-history/reviews/.
    Your AgentResult MUST include verificationStatus."
   ```
   Record agents spawned. Update `currentStage: plan-review`.

2c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate to apply review findings to {planFile}.
    Your AgentResult MUST include verificationStatus."
   ```
   Record agents spawned. Update `currentStage: plan-integrate`.

2d. **Validate.** Run plan validation stages 1-4 (from `validation-rules.md`):
   - Stage 1: Structure
   - Stage 2: Dependencies (cycle detection)
   - Stage 3: Ownership (no same-wave overlaps)
   - Stage 4: Sizing (deliverable and criteria counts)

   If validation fails after integration: **ESCALATE** -- review recommendations broke the plan. Write escalation report and stop.

   If validation passes: update `currentStage: plan-validate`, proceed.

2e. **Write criteria-plan.toon.** Save the criteria-planner-agent output (from 2a, potentially updated by conflict resolutions from 2a.5) to the project root. This file is always generated during plan creation -- it is not gated behind `--converge-criteria`.

**If `outerIteration > 1` (plan revision after failure):**

2a-alt. **Revise plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine on {planFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - What was tried: {priorAttemptSummary}
    Lock completed phases. Only edit pending/failed phases.
    Your AgentResult MUST include verificationStatus."
   ```
   Then run steps 2b-2d as above.

**If `--stop-after plan`:** display plan summary and stop.

Check circuit breakers before proceeding.

#### Step 3: Execution (Phase B) -- with 4-Tier Convergence Gates

Update `pipeline-state.toon`: `currentStage: execute`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-execute-plan.md first.
 Execute {planFile} with --auto flag.
 {if noAutoCommit: '--no-auto-commit'}
 {if scope-contract.toon exists: 'Read scope-contract.toon from the project root. Pass relevant contract decisions to each implementer agent as prompt context.'}
 Report all AgentResults. Track agents spawned.
 All implementer agent AgentResults MUST include verificationStatus (verified, unverified, or skipped) per behavioral-guidelines.md section 7."
```

Record agents spawned (add to `agentsSpawned`).

**Contract drift detection (if `scope-contract.toon` exists):** Before each wave, read `scope-contract.toon` and compare execution trajectory against contract decisions. If drift is detected (e.g., an agent used ORM when contract specified raw SQL, or an agent implemented a feature listed in `nonGoals`), log it in the wave summary as a **contract violation warning**. Do not halt execution for warnings -- record them for the review stage. Format: `contractViolation: {decisionId} -- expected {contracted}, observed {actual}`.

##### 4-Tier Convergence Gates (per convergence-tier.schema.md)

After execution completes (or interleaved with wave execution if the executor supports it), enforce the 4-tier convergence gate hierarchy. Read `criteria-plan.toon` (generated in Step 2) to determine which criteria map to which tiers and boundaries.

**Tier 4 -- Unit tests (after each wave, gatingBehavior: block-wave):**

After each wave completes, run the unit test gate before proceeding to the next wave:

1. Run the project test runner (vitest by default, or the runner specified in project config):
   ```
   "Run unit tests for files changed in wave {waveIndex}.
    passCondition: all-pass -- every unit test must pass.
    Report results as an AgentResult with verificationStatus."
   ```
2. If any unit test fails: **block the next wave**. Record the failure in the wave summary. The executor must fix failing tests before advancing. If fix fails after 1 retry, record in failureLog and escalate to quality gate.

**Tier 2 -- QA Review (after each wave, gatingBehavior: advisory):**

After each wave completes (and after unit tests pass), run a QA review:

1. Spawn qa-review-agent (general-purpose):
   ```
   "Review wave {waveIndex} deliverables against acceptance criteria from criteria-plan.toon.
    passCondition: zero-critical -- critical findings block, warnings are advisory.
    Report results as an AgentResult with verificationStatus."
   ```
2. If critical findings exist: log as blocking issue in wave summary. Advisory findings are recorded but do not block.

**Tier 3 -- Integration tests (after each feature boundary, gatingBehavior: block-feature):**

When a feature boundary is crossed (all phases for a feature are complete), run integration tests:

1. Spawn integration-test-agent (general-purpose):
   ```
   "Run integration tests for feature '{featureName}'.
    Verify cross-phase wiring within the feature.
    passCondition: all-pass -- all integration tests must pass.
    Report results as an AgentResult with verificationStatus."
   ```
2. If any integration test fails: **block the feature** from being marked complete. Record in failureLog. The executor must resolve before proceeding to the next feature.

**Tier 1 -- E2E tests (after each milestone boundary, gatingBehavior: block-milestone):**

When a milestone boundary is crossed (all features in a milestone are complete), run e2e tests:

1. Spawn e2e-runner-agent (general-purpose):
   ```
   "Run end-to-end tests for milestone '{milestoneName}'.
    Execute Playwright tests derived from E2EStory definitions in criteria-plan.toon.
    passCondition: zero-blocking -- zero blocking failures required.
    Report results as an AgentResult with verificationStatus."
   ```
2. If any blocking e2e test fails: **block the milestone** from being marked complete. Record in failureLog. The executor must resolve before proceeding.

##### Execution Completion

On completion, read `.plan-execution/state.toon`:
- If status == `completed`: proceed to Step 4.
- If status == `failed` or `paused`:
  - Record failure context in `pipeline-state.toon` failureLog.
  - Increment `outerIteration`.
  - Check circuit breakers. If clear, go to Step 2 (Phase A with `--refine`).

Log stage result in `stageHistory`.

**Write stage context.** Write `.plan-execution/stage-context/execute.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from execution wave summaries: `stage: execute`, `wave` (last completed wave), files changed, exports added, findings, summary, key decisions, convergence tier results (unit/integration/e2e pass rates per boundary), and next-stage hints. Use atomic write.

**If `--stop-after execute`:** display execution summary and stop.

Check circuit breakers before proceeding.

#### Step 3.25: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to update the wiki with execution results (trigger events defined in `wiki-maintainer-triggers.md`):

```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `wave-complete`
- Event data: all wave summaries from `.plan-execution/`
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails: (1) Record the failure in `.plan-execution/pipeline-state.toon` under `wikiUpdateStatus: failed` with the error summary, (2) Increment a `wikiConsecutiveFailures` counter in pipeline-state.toon, (3) If `wikiConsecutiveFailures >= 2`, add a visible note to the execution summary: "Wiki updates have failed for {N} consecutive waves. Run `/loom-wiki lint --wiki` to diagnose." (4) Continue to the next step. Wiki maintenance never gates the pipeline.

Record agents spawned. Do NOT count wiki maintenance against circuit breaker thresholds.

#### Step 3.5: Convergence (Phase B2) -- conditional

**Skip this step entirely if `convergenceEnabled == false`.**

This step verifies implementation using convergence loops. Two modes:
- **Target convergence** (if `convergeTarget` or `convergeConfig` is set): compare output to golden references
- **Criteria convergence** (if `convergeCriteria` is true): TDD + agent reviews against plan acceptance criteria

Update `pipeline-state.toon`: `currentStage: converge`.

##### Auto-detection

If `convergeTarget` and `convergeConfig` are both null and `convergeCriteria` is false, check:
1. Read `PLAN.md` -- look for convergence-related metadata: `convergenceTarget:`, `goldenFiles:`, or a phase with `pattern: converge`
2. Check `.plan-execution/converge.config` -- if it exists from a prior run, use it
3. Check `.plan-execution/convergence/targets/` -- if target files exist, auto-enable target convergence
4. Check `.plan-execution/criteria-plan.toon` -- if it exists from a prior run, auto-enable criteria convergence

If any of 1-3 are found, set `convergenceEnabled = true` and populate `convergeTarget` or `convergeConfig` accordingly.
If 4 is found, set `convergenceEnabled = true` and `convergeCriteria = true`.

##### Mode Routing

- If `convergeCriteria` is true: jump to **3.5e: Criteria Convergence** below.
- Otherwise: proceed with target convergence (3.5a-3.5d).

##### 3.5a: Convergence Planning

If `convergeConfig` is provided (user already has a config), skip to 3.5c.

If `convergeTarget` is provided (user gave a direct target file), skip to 3.5b.

**Otherwise, run the convergence planner** to discover and refine targets interactively:

1. Spawn convergence-planner-agent (general-purpose):
   ```
   "Read your instructions from ~/.claude/agents/convergence-planner-agent.md first.
    Mode: {if --auto pipeline: 'auto', else: 'light'}
    PLAN.md path: {planFile}
    Scope contract path: scope-contract.toon (if exists)
    Codebase context: {tech stack summary}
    Write plan to: .plan-execution/convergence-plan.toon
    Your AgentResult MUST include verificationStatus."
   ```

2. If planner fails: record in failureLog, go to quality gate with convergence failure context.

3. Read `.plan-execution/convergence-plan.toon`. Set `convergeTarget` to this file path for Step 3.5b.

Record agents spawned.

##### 3.5b: Build Convergence Infrastructure

Once requirements are confirmed, spawn agents to set up the harness:

1. **Parse targets.** Spawn target-parser agent:
   ```
   "Read your instructions from ~/.claude/agents/target-parser.md first.
    Parse targets from: {convergeTarget}
    Apply the user-confirmed comparison methods and tolerances.
    Write manifest to: .plan-execution/target-manifest.toon
    Your AgentResult MUST include verificationStatus."
   ```

2. **Build harness.** Spawn harness-builder agent:
   ```
   "Read your instructions from ~/.claude/agents/harness-builder.md first.
    Build harness from manifest: .plan-execution/target-manifest.toon
    User-confirmed tolerances: {from discussion}
    User-confirmed ignore rules: {from discussion}
    Write config to: .plan-execution/converge.config
    Your AgentResult MUST include verificationStatus."
   ```

3. Display the resulting `converge.config` for final confirmation. This is the last chance to adjust before the loop starts.

##### 3.5c: Run Convergence Loop

Spawn a general-purpose agent:
```
"Convergence logic is inline in this orchestrator. Use the converge subcommand instructions.
 Run the convergence loop with the following parameters:
 {if convergeConfig: '--config ' + convergeConfig}
 {if not convergeConfig: '--config .plan-execution/converge.config'}
 Max iterations: 10
 {if noAutoCommit: '--no-auto-commit'}
 This is running as part of /loom auto -- write convergence-summary.toon when done.
 Your AgentResult MUST include verificationStatus."
```

Record agents spawned. Log stage in `stageHistory`.

##### 3.5d: Evaluate Convergence Result

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

##### 3.5e: Criteria Convergence (if `convergeCriteria == true`)

Run criteria convergence as an auto-mode `/loom converge --criteria`:

1. **Plan criteria.** Spawn criteria-planner-agent:
   ```
   "Read your instructions from ~/.claude/agents/criteria-planner-agent.md first.
    Mode: auto
    PLAN.md path: {planFile}
    {if convergeReviewers: 'Reviewer types: ' + convergeReviewers}
    Scope contract path: scope-contract.toon (if exists)
    Codebase context: {tech stack summary}
    Write plan to: .plan-execution/criteria-plan.toon
    Write tests to: .plan-execution/convergence/criteria/tests/
    Your AgentResult MUST include verificationStatus."
   ```

2. If planner fails: record in failureLog, go to quality gate with criteria convergence failure context.

3. **Build harness.** Spawn criteria-harness-builder:
   ```
   "Read your instructions from ~/.claude/agents/criteria-harness-builder.md first.
    Build criteria convergence harness:
    Criteria plan: .plan-execution/criteria-plan.toon
    Test stubs: .plan-execution/convergence/criteria/tests/
    Project tech stack: {tech stack summary}
    Write outputs to:
    - .plan-execution/convergence/criteria/converge.config
    - .plan-execution/convergence/criteria/harness/
    Your AgentResult MUST include verificationStatus."
   ```

4. If harness-builder fails: record in failureLog, go to quality gate.

5. **Run convergence loop.** Spawn convergence-driver:
   ```
   "Read your instructions from ~/.claude/agents/convergence-driver.md first.
    Convergence mode: criteria
    Config: .plan-execution/convergence/criteria/converge.config
    Harness runner: .plan-execution/convergence/criteria/harness/run-harness.sh
    Criteria plan: .plan-execution/criteria-plan.toon
    Max iterations: 10
    Agent budget: {from orchestration.toml or 30}
    {if noAutoCommit: '--no-auto-commit'}
    This is running as part of /loom auto -- write convergence-summary.toon when done.
    All fixer-agent invocations within the convergence loop MUST include diagnoseLog
    per behavioral-guidelines.md section 6 (Diagnose Before Fix).
    Your AgentResult MUST include verificationStatus."
   ```

6. Record agents spawned. Log stage in `stageHistory`.

7. **Evaluate result.** Same logic as 3.5d -- read convergence-summary.toon and route based on status. Additionally, if frozen conflicts exist, log them in failureLog as info-level (non-blocking).

**If both target and criteria convergence are enabled**, run target convergence first (3.5a-3.5d), then criteria convergence (3.5e). Criteria convergence runs even if target convergence succeeded -- they verify different things.

**Write stage context.** Write `.plan-execution/stage-context/converge.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from convergence-summary.toon: `stage: converge`, `iteration` (final iteration count), findings resolved/remaining, convergence outcome summary, key decisions (e.g., frozen conflicts), and next-stage hints. Use atomic write.

Check circuit breakers before proceeding.

#### Step 4: Test (Phase C)

Update `pipeline-state.toon`: `currentStage: test`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-test-plan.md first.
 Run tests with --run --parallel --auto flags.
 Report test results: passed count, failed count, pass rate.
 Your AgentResult MUST include verificationStatus."
```

Record agents spawned. Log stage in `stageHistory`.

**Write stage context.** Write `.plan-execution/stage-context/test.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from test results: `stage: test`, files changed (test files created), findings remaining (failed test count), summary of test pass rate, key decisions (test framework choices), and next-stage hints (failing test patterns for review). Use atomic write.

**If `--stop-after test`:** display test results and stop.

#### Step 5: Code Review

Update `pipeline-state.toon`: `currentStage: review-code`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-review-code.md first.
 Review the current branch. Write findings to .plan-execution/review-report.md.
 Your AgentResult MUST include verificationStatus."
```

Record agents spawned. Log stage in `stageHistory`.

**Write stage context.** Write `.plan-execution/stage-context/review.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from review-report.md: `stage: review`, findings remaining (critical + warning count), summary of review outcome, key decisions (flagged blocking issues), and next-stage hints (priority fixes for fix cycle). Use atomic write.

**If `--stop-after review`:** display review summary and stop.

Proceed to the Pipeline Quality Gate.

#### Step 6: Pipeline Quality Gate

Parse the outputs from Steps 3.5, 4, and 5:

```
criticalCount    = count of findings where severity == "critical" in review-report.md
warningCount     = count of findings where severity == "warning" in review-report.md
testsPassed      = passed test count from Step 4
testsFailed      = failed test count from Step 4
testPassRate     = testsPassed / (testsPassed + testsFailed)
typecheckPass    = run project typecheck, read exit code (true if 0)
convergeStatus   = status from convergence-summary.toon (or "converged" if convergence disabled)
convergeMode     = convergenceMode from convergence-summary.toon (or "target")
convergePassing  = if convergeMode == "criteria": criteriaPassing, else: targetsPassing (from convergence-summary.toon, or 0)
convergeTotal    = if convergeMode == "criteria": criteriaTotal, else: targetsTotal (from convergence-summary.toon, or 0)
convergeFrozen   = if convergeMode == "criteria": criteriaFrozen, else: 0 (from convergence-summary.toon)
gateFailCount    = count of kit agent AgentResults where gate == "fail" AND failAction == "halt"
gateWarnCount    = count of kit agent AgentResults where gate == "warn" OR (gate == "fail" AND failAction == "warn")
unitGatePass     = all unit test gates passed during execution (from tier 4 results in stage context)
integrationGatePass = all integration test gates passed during execution (from tier 3 results in stage context)
e2eGatePass      = all e2e test gates passed during execution (from tier 1 results in stage context)
unverifiedCount  = count of agent AgentResults where verificationStatus == "unverified"
missingDiagnoseCount = count of fixer-agent AgentResults where diagnoseLog is empty or missing
```

Apply the decision matrix:

| Condition | Action |
|-----------|--------|
| `criticalCount == 0` AND `testPassRate == 100%` AND `typecheckPass == true` AND `convergeStatus == "converged"` AND `unitGatePass` AND `integrationGatePass` AND `e2eGatePass` | **PROCEED** (done). If `unverifiedCount > 0`: log WARNING with count of unverified agent results. If `missingDiagnoseCount > 0`: log WARNING with count of fixer-agents missing diagnoseLog. |
| `convergeStatus` is `stalled` or `regression` or `budget_exhausted` or `max_iterations` | **FIX-AND-RECONVERGE** (if fixCycleCount < 2) else **REVISE-PLAN** |
| `criticalCount <= 3` AND `testPassRate >= 80%` AND `fixCycleCount < 2` | **FIX-AND-RECHECK** |
| `criticalCount > 3` OR `testPassRate < 80%` OR systemic typecheck failures | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `fixCycleCount >= 2` (already tried fixing twice) | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `outerIteration > 1` AND same structural failure pattern across iterations | **REVISE-ROADMAP** (if iterations remain) else **ESCALATE** |
| `gateFailCount > 0` AND any `failAction == "halt"` | **ESCALATE** — kit gate blocked the pipeline. Display gate agent name, insertion point, gateReason. |
| `gateWarnCount > 0` AND all other conditions pass | **PROCEED** with warnings logged — gate warnings do not block. |

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

#### Step 7: Fix Cycle

Increment `fixCycleCount`. Update `pipeline-state.toon`: `currentStage: fix-code`.

7a. **Apply fixes (diagnose-before-fix per behavioral-guidelines.md section 6).** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-fix-code.md first.
    Read ~/.claude/agents/protocols/behavioral-guidelines.md section 6 (Diagnose Before Fix).
    Run with --auto --severity critical,warning flags.
    Apply fixes from .plan-execution/review-report.md.

    MANDATORY: For every fix, follow the diagnose-before-fix protocol:
    1. Read the finding and understand what failed
    2. Query wiki for architectural constraints (/loom-wiki query)
    3. Diagnose root cause before making any code change
    4. Write diagnosis to diagnoseLog in your AgentResult BEFORE applying the fix
    5. Apply the fix
    6. Verify the fix

    Your AgentResult MUST include:
    - verificationStatus: verified (if tests confirm fix), unverified, or skipped
    - diagnoseLog: narrative of what was found, root cause, architectural constraints,
      and why the fix was chosen. An empty diagnoseLog is a protocol violation."
   ```
   Record agents spawned.

   **Validate fixer AgentResult.** After receiving the fixer-agent's AgentResult:
   - If `diagnoseLog` is empty or missing: log a WARNING -- `"Fixer-agent returned without diagnoseLog. This is a protocol violation per behavioral-guidelines.md section 6."`
   - If `verificationStatus` is `unverified`: log a WARNING -- `"Fixer-agent did not verify its fixes. Prioritize for verification-agent review."`

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
    Write updated findings to .plan-execution/review-report.md.
    Your AgentResult MUST include verificationStatus."
   ```

7d. **Re-run verification.** Run typecheck + existing tests.

7e. **Re-run convergence (if `reconverge == true`).** Return to Step 3.5 to re-run the convergence loop. The convergence-driver will resume from the existing `convergence-state.toon`, re-running the harness against the now-fixed code.

7f. **Return to Step 6** (Pipeline Quality Gate) with updated results.

Log stage in `stageHistory`.

**Write stage context.** Write `.plan-execution/stage-context/fix.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from fix cycle results: `stage: fix`, files changed (files modified by fixers), findings resolved/remaining (before vs after counts), summary of what was fixed, key decisions (fix strategies chosen), and next-stage hints (remaining issues for quality gate). Use atomic write.

**If `--stop-after fix`:** display fix results and stop.

#### Step 8: Completion

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

### Planning
- Mode: dual-track (plan-builder + criteria-planner + interpretation-reviewer)
- Interpretation conflicts: {conflict count} ({blocking count} blocking, {warning count} warning)

### Quality Metrics
- Critical findings: 0
- Test pass rate: 100%
- Typecheck: PASS

### 4-Tier Convergence Gates
- Unit (wave): {unitGateResults} -- {passed}/{total} waves passed
- QA Review (wave): {qaReviewResults} -- {critical findings count} critical
- Integration (feature): {integrationGateResults} -- {passed}/{total} features passed
- E2E (milestone): {e2eGateResults} -- {passed}/{total} milestones passed

### Behavioral Hardening
- Agents with verificationStatus: {verifiedCount + unverifiedCount + skippedCount} / {totalAgents}
  - verified: {verifiedCount}, unverified: {unverifiedCount}, skipped: {skippedCount}
- Fixer agents with diagnoseLog: {diagnoseLogCount} / {totalFixerAgents}
  - Protocol violations (empty diagnoseLog): {missingDiagnoseCount}

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
Run `/loom auto --resume` after addressing the above.
```

Display the escalation report to the user.

### Circuit Breakers

Check these conditions before every stage transition. If any triggers, go to Step 8 (Escalation).

| Breaker | Condition | Reason |
|---------|-----------|--------|
| **Iteration limit** | `outerIteration > maxIterations` | Prevents infinite plan revision |
| **Agent budget** | `agentsSpawned > maxAgents` | Cost control |
| **Identical failure** | Same verification error string in failureLog across two consecutive iterations | Revision did not help -- human insight needed |
| **Fix stall** | Same review findings (tag:file:line match) after 2 fix cycles | loom-code fix cannot resolve it |
| **Wave deadlock** | A wave failed 2x AND plan revision did not change that wave's phases | Structural issue in plan decomposition |
| **Validation failure** | Plan fails validation stages 1-4 after `--review-integrate` | Review recommendations broke the plan |
| **Interpretation conflict** | Blocking interpretation conflicts between plan-builder and criteria-planner after dual-track generation | Dual-track outputs are incompatible -- human resolution required |

When a breaker trips:
1. Record the breaker name and condition in `pipeline-state.toon` failureLog.
2. Set `currentStage: escalated`.
3. Write the escalation report.
4. Stop execution.

### Resume Logic

When `--resume` is passed:

1. Read `pipeline-state.toon` from `.plan-execution/`.
2. If file does not exist: "No pipeline state found. Use `--from` to start a new run." Stop.
3. If `currentStage == complete`: "Pipeline already completed. Nothing to resume." Stop.
4. If `currentStage == escalated`: display the escalation report and ask the human what to do.

4.5. **Reconstruct context from stage summaries.** Read all files in `.plan-execution/stage-context/` to rebuild pipeline context:
   - For each `stage-context/*.toon` file, parse `stage`, `wave`, `summary`, `keyDecisions`, `nextStageHints`
   - Regenerate `rolling-context.md` from stage summaries using tiered compression (hot/warm/cold)
   - If `continue-here.toon` exists, read `context` field for additional compressed context
   - This ensures fresh context after a `/clear` + `--resume` cycle
   - Display: `"Context reconstructed from {count} stage summaries"`

5. Re-enter the loop at the correct point:

   | `currentStage` value | Re-entry point |
   |----------------------|----------------|
   | `roadmap-create` | Step 1, sub-step 1a |
   | `roadmap-review` | Step 1, sub-step 1b |
   | `roadmap-integrate` | Step 1, sub-step 1c |
   | `roadmap-approve` | Step 1, sub-step 1d |
   | `plan-create` | Step 2, sub-step 2a (dual-track: plan-builder + criteria-planner) |
   | `plan-interpret` | Step 2, sub-step 2a.5 (interpretation review) |
   | `plan-review` | Step 2, sub-step 2b |
   | `plan-integrate` | Step 2, sub-step 2c |
   | `plan-validate` | Step 2, sub-step 2d |
   | `execute` | Step 3 (pass `--resume` to loom-plan execute) |
   | `converge` | Step 3.5 (pass `--resume` to loom converge) |
   | `test` | Step 4 |
   | `review-code` | Step 5 |
   | `fix-code` | Step 7 |

6. Restore all state variables from `pipeline-state.toon`: `outerIteration`, `agentsSpawned`, `fixCycleCount`, `maxIterations`, `maxAgents`, `noAutoCommit`.
7. Continue the loop from the re-entry point.

### Error Handling

- **Agent failure (timeout or crash):** Record in failureLog. If the stage is retryable (plan-create, execute), retry once with error context. If retry also fails, escalate.
- **Missing protocol files:** Warn and continue with defaults. Do not block the pipeline on missing docs.
- **Disk write failure:** If `pipeline-state.toon` cannot be written, warn the user that resume will not work. Continue execution.
- **Plan file missing:** If `planFile` does not exist and no `--from` provided, tell the user: "No plan found. Use `--from 'description'` to create one, or `--plan path` to specify an existing plan." Stop.
- **Unexpected state in pipeline-state.toon:** If `currentStage` is not a recognized value, treat as corrupted. Offer to reinitialize or abort.

### Status Line Updates

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

---

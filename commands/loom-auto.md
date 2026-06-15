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
   9. Execute Link        -- single dispatched link runs loom-plan execute --auto + deferred tier gates + contract drift scan + wiki update, writes stage-context/execute.toon and link-result.toon
      9a. Unit gate       -- after each wave (block-wave, all-pass) — handled by executor internally
      9b. QA review       -- after each wave (advisory, zero-critical) — handled by executor
      9c. Integration     -- after each feature boundary (block-feature, all-pass) — link runs deferred gates not covered by executor
      9d. E2E             -- after each milestone boundary (block-milestone, zero-blocking) — link runs deferred gates not covered by executor
   10. Convergence        -- loom converge (if --converge-target, --converge-config, or --converge-criteria)
   10b. Criteria Conv.    -- loom converge --criteria --auto (if --converge-criteria, per plan phase)
   11-13. Verify Link     -- single dispatched link runs test + code review + quality gate, writes link-result.toon
   14. Fix Link           -- single dispatched link runs fixer (diagnose-before-fix) + quick review + typecheck/tests + stuck detection, then re-dispatch verify (or converge, or planning)

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

4. Create or verify `.plan-execution/` directory structure, including the `ephemeral/` subdirectory:
   ```bash
   mkdir -p .plan-execution/ephemeral/progress
   mkdir -p .plan-execution/ephemeral/requests
   mkdir -p .plan-execution/stage-context
   mkdir -p .plan-execution/contracts
   mkdir -p .plan-execution/conflicts
   mkdir -p .plan-execution/convergence/iterations
   mkdir -p .plan-execution/convergence/e2e/stories
   mkdir -p .plan-execution/convergence/e2e/tests
   mkdir -p .plan-execution/convergence/e2e/screenshots
   ```

   Write `.plan-execution/.gitignore` (ignores only ephemeral):
   ```
   # Ephemeral session artifacts — locks, heartbeats, live status
   ephemeral/
   ```

5. **Gitignore protection check.** First verify we're in a git repo (`git rev-parse --is-inside-work-tree`). If not, warn and skip this step. Then check for old layout — if `.plan-execution/.gitignore` contains `*`, warn: "Old .plan-execution/ layout detected. Run `/loom-upgrade` first."

   Verify the project's `.gitignore` does not exclude Loom's persistent directories:
   ```bash
   git check-ignore -q planning/history/test 2>/dev/null && echo "BLOCKED" || echo "OK"
   git check-ignore -q .loom/wiki/test 2>/dev/null && echo "BLOCKED" || echo "OK"
   git check-ignore -q .plan-execution/state.toon 2>/dev/null && echo "BLOCKED" || echo "OK"
   ```
   If any path is blocked, warn and offer to add negation rules (see `/loom-init` Step 1.3 for the full fix flow). If running in `--auto` mode, apply the fix automatically and log a warning.

6. **Install enforcement hooks.** This is a SAFETY NET for users who skipped `/loom-init` — that command is the canonical place hooks get registered. Step 6 ensures the pipeline still works if init was bypassed.

   The full Loom hook suite (14 hooks: file-ownership, contract-lock, budget-tracker, context-budget, deploy-guard, quality-gate, status-updater, typecheck-on-write, wiki guards, context-monitor, checkpoint-trigger) is registered via the deterministic helper. The helper copies inert templates from `~/.claude/templates/hooks/` (staged by the curl installer) into the project, then merges entries into `.claude/settings.json` while preserving any unrelated hooks.

   ```bash
   # Detect prior registration: skip if Loom hooks are already in settings.json.
   if [ -f .claude/settings.json ] && grep -q "hooks/file-ownership.ts" .claude/settings.json; then
     echo "Loom hooks already registered — skipping."
   else
     mkdir -p hooks scripts
     if [ -d ~/.claude/templates/hooks ]; then
       cp -r ~/.claude/templates/hooks/. hooks/
     fi
     if [ -f ~/.claude/templates/scripts/register-loom-hooks.ts ]; then
       cp ~/.claude/templates/scripts/register-loom-hooks.ts scripts/
     fi

     # Back up pre-existing settings.json before merge
     if [ -f .claude/settings.json ]; then
       ts=$(date -u +"%Y%m%dT%H%M%SZ")
       cp .claude/settings.json ".claude/settings.json.bak-${ts}"
     fi

     node scripts/register-loom-hooks.ts --replace || \
       echo "WARN: hook registration failed — pipeline will run without full enforcement. Rerun 'node scripts/register-loom-hooks.ts --replace' to fix."
   fi
   ```

   The helper auto-detects whether to emit `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts` (plugin install) or project-relative `hooks/<name>.ts` (dev checkout / curl install), and dispatches through `hooks/run-hook.sh` (bun → npx tsx fallback at exec time). `--replace` purges any stale Loom hook entries (different prefix, different runner) before writing fresh ones, so this is safe to re-run from any starting state. Idempotent when settings already match. Non-fatal on failure: print the script's error, continue with the pipeline.

   > **Note:** This supersedes the legacy `scripts/register-wiki-hooks.ts` (3 wiki hooks only). `register-loom-hooks.ts` covers all 14, including the 3 wiki ones. The legacy script remains callable for backwards compatibility.

   **Wiki hook behavior:**
   - `wiki-session-status` (SessionStart) — surfaces `.loom/wiki/` freshness and injects high-confidence page summaries into session context. Honors `[wiki].sessionContext` (default `minimal`).
   - `wiki-impact-warner` (PreToolUse Write|Edit) — emits informational impact notices when an edit targets files referenced by any flow/contract page. Per-file-per-session dedup and 5-minute session throttle. Honors `[wiki].impactAck` (default `notify`) and `[wiki].impactDedup` / `[wiki].sessionThrottle` (default on).
   - `wiki-commit-ledger` (PostToolUse Bash) — detects successful `git commit` invocations and appends a ledger entry to `.loom/wiki/freshness-ledger.toon` tracking wiki debt vs. fresh status.
   - All three honor `LOOM_WIKI_HOOKS=0` (silence for the session) and fail-open on any error.

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
    Review the roadmap at {roadmapFile}. Save findings to planning/history/reviews/.
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
    Review the plan at {planFile}. Save findings to planning/history/reviews/.
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

#### Step 3: Execute Link (plan execution + tier gates + wiki update)

**Architecture note:** Step 3 (execution + 4-tier gates) and Step 3.25 (wiki update) are bundled into a single dispatched **link** (`execute`). The orchestrator delegates to a fresh agent that wraps `/loom-plan execute --auto`, runs any deferred integration/e2e tier gates, performs the post-execution contract drift scan, updates the wiki (non-blocking), aggregates `stage-context/execute.toon`, and writes a `link-result.toon` envelope with the next-link decision. See `commands/loom-auto/links/execute.md` for the link contract.

##### 3a: Dispatch the execute link

Increment `trampolineIteration`. Update `pipeline-state.toon`: `currentStage: execute`.

Spawn one general-purpose Agent. Model: resolved via the standard priority. The link itself is treated as `tier: execution` for profile lookup (its sub-agents, including the executor and tier-gate runners, are resolved independently per their own frontmatter or the profile).

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-auto/links/execute.md first.
 You are the EXECUTE link of the /loom-auto trampoline. Read pipeline-state.toon
 and the inputs listed in your spec.

 executeHints (forwarded from the trampoline):
   resume: {true if pipeline-state.toon.currentStage was 'execute' on entry, else false}
   waveStart: {optional — leave blank to start from state.toon's wave cursor}
   noAutoCommit: {pipeline-state.toon.noAutoCommit}

 Run /loom-plan execute --auto, run any deferred tier gates (integration at
 feature boundaries, e2e at milestone boundaries), update the wiki if present,
 aggregate stage-context/execute.toon from wave summaries, and write
 .plan-execution/link-result.toon with the gate's nextLink decision.

 Your AgentResult MUST include verificationStatus and a one-line summary.
 The trampoline reads link-result.toon from disk — keep your return body short."
```

Record the AgentResult; the link reports its own `agentsSpawned` total in `link-result.toon` (sum of executor + tier-gate agents + wiki agent). The trampoline does NOT separately count the executor's sub-agents — the link's accounting is authoritative.

##### 3b: Read link-result.toon

After the link returns, read `.plan-execution/link-result.toon`. Validate:
- `link == "execute"` — sanity check
- `schemaVersion == 1`
- `status` is one of `complete`, `failed`, `escalated`
- `nextLink` is one of `planning`, `converge`, `verify`, `done`
- `trampolineIteration` matches the dispatch

On validation failure: write to `failureLog`, set `currentStage: escalated`, go to Step 8.

##### 3c: Print between-link readout

```
─── EXECUTE (outerIter {N}, trampoline iter {M}) ─────────
Executor:    {status} — {wavesCompleted}/{wavesTotal} waves
Files:       {filesChangedCount} changed
Gates:       unit {N}/{N}  integration {N}/{N}  e2e {N}/{N}
QA:          {qaCriticalFindings} critical findings
Contract:    {contractViolations} drift entries
Wiki:        {wikiUpdateStatus}
Decision:    {nextLinkReason in upper case}
Next link:   → {nextLink}
──────────────────────────────────────────────────────────
```

Values pulled from `link-result.toon.gateInputs`. Append to `.plan-execution/trampoline-events.log`.

##### 3d: Route on nextLink

Re-enter the trampoline routing table (Step 4-6d) with the execute link's `nextLink`. Standard arms apply:

- `nextLink: converge` → run inline Step 3.5 (convergence), then dispatch verify
- `nextLink: verify` → dispatch verify link (Step 4-6a)
- `nextLink: planning` → increment `outerIteration` if `planningHints.incrementOuterIteration == true`, go to Step 2 (`--refine`)
- `nextLink: done` (only with `outcome: escalated`) → Step 8 (escalation)

The execute link NEVER routes to `nextLink: fix` directly — fixing only makes sense after verify identifies findings.

**If `--stop-after execute`:** print the readout, then stop. Do not dispatch the next link.

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
 This is running as part of /loom-auto -- write convergence-summary.toon when done.
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

Run criteria convergence as an auto-mode `/loom-converge --criteria`:

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
    This is running as part of /loom-auto -- write convergence-summary.toon when done.
    All fixer-agent invocations within the convergence loop MUST include diagnoseLog
    per behavioral-guidelines.md section 6 (Diagnose Before Fix).
    Your AgentResult MUST include verificationStatus."
   ```

6. Record agents spawned. Log stage in `stageHistory`.

7. **Evaluate result.** Same logic as 3.5d -- read convergence-summary.toon and route based on status. Additionally, if frozen conflicts exist, log them in failureLog as info-level (non-blocking).

**If both target and criteria convergence are enabled**, run target convergence first (3.5a-3.5d), then criteria convergence (3.5e). Criteria convergence runs even if target convergence succeeded -- they verify different things.

**Write stage context.** Write `.plan-execution/stage-context/converge.toon` per `StageContext` schema (`stage-context.schema.md`). Populate from convergence-summary.toon: `stage: converge`, `iteration` (final iteration count), findings resolved/remaining, convergence outcome summary, key decisions (e.g., frozen conflicts), and next-stage hints. Use atomic write.

Check circuit breakers before proceeding.

#### Steps 4-6: Verify Link (test + code review + quality gate)

**Architecture note:** Steps 4 (Test), 5 (Code Review), and 6 (Quality Gate) are bundled into a single dispatched **link** (`verify`). The orchestrator delegates to a fresh agent that handles test, review, and gate calculation, then returns a single envelope on disk with the next-link decision. This keeps the orchestrator's context bounded as the pipeline iterates — see `commands/loom-auto/links/verify.md` for the link contract.

##### 4-6a: Dispatch the verify link

Update `pipeline-state.toon`: `currentStage: verify`. Increment `trampolineIteration` if the field exists (introduced as part of the chained-link refactor; default 0 if missing).

Spawn one general-purpose Agent. Model: resolved via the standard priority (orchestration.toml profile → frontmatter → inherit). The link itself is treated as `tier: verification` for profile lookup.

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-auto/links/verify.md first.
 You are the VERIFY link of the /loom-auto trampoline. Read pipeline-state.toon
 and the stage-context files it references — do NOT read PLAN.md, ROADMAP.md,
 or rolling-context.md.

 Run test (Step 1), code review (Step 2), gather gate inputs (Step 3), apply
 the decision matrix (Step 4), and write .plan-execution/link-result.toon with
 the gate's nextLink decision.

 {if --stop-after test or review: pass through as a hint in the link prompt}

 Your AgentResult MUST include verificationStatus and a one-line summary.
 The trampoline reads link-result.toon from disk — keep your return body short."
```

Record agents spawned (count whatever the link reports in `link-result.toon.agentsSpawned`, typically 2). Do NOT increment `agentsSpawned` based on your own observation of sub-agents — the link is responsible for its own accounting and reports the total.

**Optional sub-stop handling.** If `--stop-after test` or `--stop-after review` is set, pass it through in the link prompt. The link respects these by stopping after the relevant step and writing `link-result.toon` with `status: stopped-early` and `nextLink: done`. The trampoline still reads the envelope and prints the stopped-early summary.

##### 4-6b: Read link-result.toon

After the link agent returns, read `.plan-execution/link-result.toon`. This is the source of truth — the agent's return text is just an acknowledgment.

Validate the envelope:
- `link == "verify"` — sanity check
- `schemaVersion == 1` — schema check
- `status` is one of `complete`, `failed`, `escalated`, `stopped-early`
- `nextLink` is one of `done`, `fix`, `planning`

If validation fails, treat it as a corrupted link: write to `failureLog`, set `currentStage: escalated`, go to Step 8 (Escalation).

##### 4-6c: Print between-link readout

Print a compact summary to the terminal so the user sees the gate decision without scrolling tool results:

```
─── VERIFY (outerIter {N}, trampoline iter {M}) ──────────
Tests:       {testsPassed} passed / {testsFailed} failed   typecheck: {PASS|FAIL}
Review:      {criticalCount} critical / {warningCount} warning
Convergence: {convergeStatus} ({convergePassing}/{convergeTotal})
Gate tiers:  unit:{u} integration:{i} e2e:{e}
Decision:    {nextLinkReason in upper case}
Next link:   → {nextLink}{ extra hint if any}
───────────────────────────────────────────────────────────
```

All values come from `link-result.toon.gateInputs` and `link-result.toon.nextLinkReason`. The readout is mandatory — it is the user's only visibility into the gate when the orchestrator is otherwise quiet between Agent dispatches.

Append the same line-by-line summary (plain text) to `.plan-execution/trampoline-events.log` for post-mortem inspection. If the file does not exist, create it; if it does, append. Atomic writes are not required for this log file — it is purely informational.

##### 4-6d: Route on nextLink

Read `link-result.toon.nextLink` and act:

| `nextLink` | `nextLinkReason` | Action |
|------------|------------------|--------|
| `done` | `proceed` | Go to Step 8 (Completion — success path). |
| `done` | `escalate-*` | Go to Step 8 (Completion — escalation path). Capture `outcomeHints.escalationReason` for the report. |
| `fix` | `fix-and-recheck` | Go to Step 7 (Fix Link dispatch). Forward `link-result.toon.fixHints` (mode, prioritizedFindings, postFixHint) inline in the fix link's dispatch prompt. |
| `fix` | `fix-and-reconverge` | Go to Step 7 (Fix Link dispatch). Forward `fixHints` with `postFixHint: reconverge`. The fix link will route to `nextLink: converge` on success rather than `verify`. |
| `converge` | `fix-and-reconverge` | Re-enter inline Step 3.5 (Convergence) without redispatching the executor. After convergence completes, the trampoline returns to Step 4-6a (verify dispatch). Increment `trampolineIteration`. |
| `planning` | `revise-plan` | If iterations remain: trampoline increments `outerIteration` (the link sets `planningHints.incrementOuterIteration: true`), go to Step 2 (Phase A with `--refine`). Else: Step 8 (Escalation). |
| `planning` | `revise-roadmap` | If iterations remain: increment `outerIteration`, go to Step 1 (Phase R with `--refine`). Else: Step 8 (Escalation). |

All circuit breakers (iteration limit, agent budget, identical failure, fix stall) are still enforced at the orchestrator level **before** dispatching the next link. If a breaker trips, override `nextLink` and go to Step 8 (Escalation).

**On `--stop-after test`, `--stop-after review`, or `--stop-after verify`:** print the readout, then stop. Do not dispatch the next link.

#### Step 7: Fix Link (apply fixes + stuck detection)

**Architecture note:** The Fix Cycle is a dispatched **link** (`fix`). The orchestrator delegates to a fresh agent that runs the fixer (diagnose-before-fix), re-runs a quick review, re-runs typecheck + tests, performs stuck/regression detection, and writes a `link-result.toon` with the next-link decision. See `commands/loom-auto/links/fix.md` for the link contract.

##### 7a: Dispatch the fix link

Increment `trampolineIteration`. Update `pipeline-state.toon`: `currentStage: fix-code`. Note: `fixCycleCount` is incremented BY the link in its Step 0, not by the trampoline — do not double-count.

Read the predecessor `link-result.toon` (still on disk from the verify dispatch) and extract `fixHints` for inclusion in the dispatch prompt.

Spawn one general-purpose Agent. Model: resolved via the standard priority. The link itself is treated as `tier: utility` for profile lookup (it spawns its own utility + review tier sub-agents).

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-auto/links/fix.md first.
 You are the FIX link of the /loom-auto trampoline. Read pipeline-state.toon
 and the inputs listed in your spec — do NOT read PLAN.md, ROADMAP.md,
 or rolling-context.md.

 fixHints (forwarded from the verify link):
   fixMode: {standard | aggressive | targeted}
   postFixHint: {none | reconverge}
   prioritizedFindings[N]: {finding ids}

 Run the fix cycle: snapshot review-report.md, apply fixes (diagnose-before-fix),
 re-run quick review, re-run typecheck + tests, detect progress/stuck/regression,
 write .plan-execution/link-result.toon with the gate's nextLink decision.

 Your AgentResult MUST include verificationStatus and a one-line summary.
 The trampoline reads link-result.toon from disk — keep your return body short."
```

If the verify `link-result.toon` is missing or corrupted on entry, fall through with default `fixHints` (mode: standard, postFixHint: none, no prioritized findings) and log a warning. The fix link's Step 0 will record the issue in its `notes`.

##### 7b: Read link-result.toon

After the link returns, read `.plan-execution/link-result.toon`. Validate:
- `link == "fix"` — sanity check
- `schemaVersion == 1`
- `status` is one of `complete`, `failed`, `escalated`
- `nextLink` is one of `verify`, `converge`, `planning`
- `trampolineIteration` matches the dispatch

On validation failure: write to `failureLog`, set `currentStage: escalated`, go to Step 8.

##### 7c: Print between-link readout

Print the fix-link readout to stdout (analogous to Step 4-6c for verify):

```
─── FIX (outerIter {N}, trampoline iter {M}, cycle {fixCycleCount}) ──────
Critical:    {criticalBefore} → {criticalAfter}
Warnings:    {warningBefore} → {warningAfter}
Tests:       {testsFailedBefore} → {testsFailedAfter} failing
Detection:   progress={bool} stuck={bool} regression={bool}
Diagnose log: {present|MISSING}    Self-verified: {true|false}
Decision:    {nextLinkReason in upper case}
Next link:   → {nextLink}{ extra hint if any}
──────────────────────────────────────────────────────────────────────────
```

Values are pulled from `link-result.toon.gateInputs`. Append the same block to `.plan-execution/trampoline-events.log`.

##### 7d: Route on nextLink

Re-enter the trampoline routing table (Step 4-6d) with the fix link's `nextLink`. The standard arms apply:

- `nextLink: verify` → dispatch verify link again (Step 4-6a)
- `nextLink: converge` → re-enter inline Step 3.5, then dispatch verify
- `nextLink: planning` → increment `outerIteration` if `planningHints.incrementOuterIteration == true`, then go to Step 2 (`--refine`)

The fix link NEVER routes to `nextLink: done` directly — even success paths go back through verify to re-confirm the gate.

**If `--stop-after fix`:** print the readout, then stop. Do not dispatch the next link.

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
Run `/loom-auto --resume` after addressing the above.
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
   | `execute` | Step 3 (execute link). If `link-result.toon` for this `trampolineIteration` exists with `link == execute`, skip the dispatch and route on its `nextLink` — the link is idempotent on resume per its own spec. Otherwise re-dispatch; the link's Step 0 detects existing `state.toon` and passes `--resume` to the executor sub-agent. |
   | `link-complete-execute` | Step 3, sub-step 3d (route on the existing `link-result.toon` without re-dispatching). |
   | `converge` | Step 3.5 (pass `--resume` to loom converge) |
   | `verify` | Steps 4-6 (verify link). If `link-result.toon` already exists for the current `trampolineIteration`, skip the dispatch and route on its `nextLink` — the link is idempotent on resume per its own spec. |
   | `link-complete-verify` | Steps 4-6, sub-step 4-6d (route on the existing `link-result.toon` without re-dispatching). |
   | `fix-code` | Step 7 (fix link). If `link-result.toon` for this `trampolineIteration` exists with `link == fix`, skip the dispatch and route on its `nextLink` — the fix link is idempotent on resume per its own spec. Otherwise re-dispatch the fix link; its Step 0 will detect the existing snapshot at `review-report.before-fix-{iter}.md` and resume mid-link. |
   | `link-complete-fix` | Step 7, sub-step 7d (route on the existing `link-result.toon` without re-dispatching). |

6. Restore all state variables from `pipeline-state.toon`: `outerIteration`, `agentsSpawned`, `fixCycleCount`, `maxIterations`, `maxAgents`, `noAutoCommit`.
7. Continue the loop from the re-entry point.

### Error Handling

- **Agent failure (timeout or crash):** Record in failureLog. If the stage is retryable (plan-create, execute), retry once with error context. If retry also fails, escalate.
- **Missing protocol files:** Warn and continue with defaults. Do not block the pipeline on missing docs.
- **Disk write failure:** If `pipeline-state.toon` cannot be written, warn the user that resume will not work. Continue execution.
- **Plan file missing:** If `planFile` does not exist and no `--from` provided, tell the user: "No plan found. Use `--from 'description'` to create one, or `--plan path` to specify an existing plan." Stop.
- **Unexpected state in pipeline-state.toon:** If `currentStage` is not a recognized value, treat as corrupted. Offer to reinitialize or abort.

### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` per `execution-conventions.md` section "Orchestration Status". Include these additional fields for pipeline tracking:

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

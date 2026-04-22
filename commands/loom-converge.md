---
description: "Convergence loop — target matching or criteria TDD + reviews"
---

# Loom Converge

You are an orchestrator that drives convergence loops. Two modes:

- **Target convergence** (default): compare implementation output against a known-good reference. Iterate until the delta reaches zero or a circuit breaker fires.
- **Criteria convergence** (`--criteria`): run tests and agent reviews against the codebase. Iterate until all blocking criteria pass (TDD + code review + security).

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `converge`:

**Mode selection (mutually exclusive):**
- `--target <path>` -- target convergence: path to the deterministic source
- `--plan` -- target convergence: run convergence planner (interactive target discovery)
- `--criteria` -- criteria convergence: TDD + agent reviews

**Criteria mode options:**
- `--phase N` -- scope criteria to a specific plan phase (criteria mode only)
- `--feature F-NN` -- scope criteria to a feature boundary (criteria mode only)
- `--reviewers <types>` -- comma-separated reviewer types: security,code-review,performance,architecture (criteria mode only)
- `--no-soft` -- tests only, skip agent reviews (criteria mode only)
- `--no-hard` -- reviews only, skip test generation (criteria mode only)

**Tier selection (criteria mode):**
- `--tier <name>` -- run only a single convergence tier: `unit`, `integration`, `e2e`, or `qa-review`
- `--full` -- run all 4 tiers in order: unit → integration → e2e → qa-review
- `--approve-qa` -- bulk-approve all non-blocking QA review findings

**Opt-out flags (criteria mode):**
- `--no-tests` -- skip unit and integration tiers (prints stderr warning)
- `--no-e2e` -- skip e2e tier (prints stderr warning)
- `--e2e` -- shorthand for `--tier e2e` (runs `e2e-test-writer-agent` for story generation then `e2e-runner-agent` for execution)
- `--no-qa-review` -- skip qa-review tier (prints stderr warning)

**Shared options:**
- `--config <path>` -- path to an existing converge.config (skip planner + setup, either mode)
- `--light` -- fewer questions in planner (one consolidated batch)
- `--auto` -- accept all defaults, no interaction
- `--max-iterations N` -- override max iterations (default: 5)
- `--tolerance <threshold>` -- global tolerance override for target mode (0.0-1.0)
- `--dry-run` -- run planner/setup, show config, stop before iteration loop
- `--no-auto-commit` -- disable per-iteration auto-commits during convergence loop
- `--resume` -- resume from `.plan-execution/convergence-state.toon`
- `--status` -- show current convergence state without running anything
- No args: show usage help

### Instructions

#### Step 0: Read Protocols and Resolve Models

**Model Resolution:** Before spawning any agent, resolve its model. Priority: (1) profile tier mapping from `orchestration.toml` `[settings] modelProfile`, (2) agent `.md` frontmatter `model:` field, (3) inherit parent. Tier mapping: convergence-planner = utility, target-parser = utility (haiku), harness-builder = utility, delta-analyzer = utility (haiku), convergence-driver = utility, fixer-agent = utility. Read `.claude/orchestration.toml` once, check `modelProfile`, resolve per spawn.

Read convergence-related protocols:
- `~/.claude/agents/protocols/orchestration-patterns.md` (Pattern 5: Converge + Pattern 6: Criteria Converge)
- `~/.claude/agents/protocols/pattern-executor.md` (Converge execution)
- If `--criteria`: also read `~/.claude/agents/protocols/criteria-plan.schema.md`

#### Step 1: Handle Special Flags

**If no args provided:** display usage help and stop:
```
## Usage: /loom converge

Two modes: target convergence (match a reference) and criteria convergence (satisfy conditions).

### Target Convergence (match a reference)
  --plan                  Interactive target discovery
  --target <path>         Direct target file (skip planner)
  --tolerance <threshold> Global tolerance override (0.0-1.0)

### Criteria Convergence (TDD + reviews)
  --criteria                   Enable criteria mode
  --criteria --phase N         Scope to a specific plan phase
  --criteria --feature F-NN    Scope to a feature boundary
  --criteria --reviewers X,Y   Choose reviewer types (security,code-review,performance,architecture)
  --criteria --no-soft         Tests only (skip agent reviews)
  --criteria --no-hard         Reviews only (skip test generation)

### Tier Selection (criteria mode)
  --tier <name>           Run only one tier: unit, integration, e2e, qa-review
  --full                  Run all 4 tiers in order
  --approve-qa            Bulk-approve non-blocking QA findings
  --no-tests              Skip unit/integration tiers (stderr warning)
  --no-e2e                Skip e2e tier (stderr warning)
  --no-qa-review          Skip qa-review tier (stderr warning)

### Shared Options
  --config <path>         Existing converge.config (skip setup, either mode)
  --light                 Fewer questions in planner (one batch)
  --auto                  Accept all defaults, no interaction
  --max-iterations N      Override max iterations (default: 5)
  --dry-run               Run setup only, show config, stop before loop
  --no-auto-commit        Disable per-iteration auto-commits
  --resume                Resume from saved state
  --status                Show current convergence state

Examples:
  /loom converge --plan                     Target: discover targets from codebase
  /loom converge --plan --light             Target: one-batch discovery
  /loom converge --target golden/api.json   Target: direct reference file
  /loom converge --criteria                 Criteria: TDD + all reviewers from plan
  /loom converge --criteria --phase 3       Criteria: phase 3 acceptance criteria only
  /loom converge --criteria --feature F-01  Criteria: feature F-01 boundary only
  /loom converge --criteria --no-soft       Criteria: pure TDD (tests only)
  /loom converge --criteria --reviewers security,code-review   Criteria: specific reviewers
  /loom converge --criteria --no-hard       Review-only: iterate code reviews on existing code
  /loom converge --tier unit                Run only unit tier convergence
  /loom converge --tier e2e                 Run only e2e tier convergence
  /loom converge --full                     Run all 4 tiers in order
  /loom converge --approve-qa               Bulk-approve non-blocking QA findings
  /loom converge --criteria --no-tests      Skip unit/integration (warns on stderr)
  /loom converge --resume
  /loom converge --status
```

**If `--status`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` or `--criteria` to start a new run." Stop.
3. Detect mode from `convergenceMode` field (default: `target` for backwards compatibility).
4. Display current state:
   - Current iteration and max iterations
   - Mode (target or criteria)
   - **Target mode:** passing and failing target counts, per-target scores
   - **Criteria mode:** passing, failing, and frozen criterion counts. Hard vs soft breakdown. Active conflicts.
   - Convergence rate (improvement percentage from last iteration)
   - Iteration history with per-iteration passing counts
   - Circuit breaker status
5. Suggest next action based on state:
   - If `status == converged`: "Convergence complete. No action needed."
   - If `status == running` or `status == paused`: "Run `/loom converge --resume` to continue."
   - If `status == stalled` or `status == regression`: "Review stuck deltas below. Manual intervention may be needed before `--resume`."
   - If `status == budget_exhausted`: "Increase agent budget in orchestration.toml and `--resume`."
   - **Criteria mode only:** If frozen conflicts exist: "The following criteria have conflicting reviewer findings and were frozen. Review manually: {list}."
   - **Criteria mode:** Display per-tier gate status from `tierState` block:
     ```
     Tier Status:
       unit:        {gateStatus} ({passing}/{total})
       integration: {gateStatus} ({passing}/{total})
       e2e:         {gateStatus} ({passing}/{total})
       qa-review:   {gateStatus} ({passing}/{total})
     ```
6. Stop.

**If `--resume`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` or `--criteria` to start a new run." Stop.
3. Validate the state file has required fields: `iteration`, `maxIterations`, `convergenceMode`, `configPath`, `specPath`. The `specPath` points to the target manifest (target mode) or criteria-plan.toon (criteria mode).
4. If `status == converged`: "Convergence already complete. Nothing to resume." Stop.
5. If `status == regression` or `status == stalled`: warn the user about the prior failure, ask if they want to continue anyway.
6. Restore state variables from the file.
7. Jump to Step 5 (Convergence Loop) at the saved iteration.

**If `--dry-run`:** proceed through Steps 1.5-4 normally; Step 4 will stop execution.

**If neither `--plan` nor `--target` nor `--config` nor `--resume` nor `--criteria` provided:** show usage help and stop.

**If `--criteria` and (`--target` or `--plan`) both provided:** "Error: `--criteria` and `--target`/`--plan` are mutually exclusive. Use `--criteria` for TDD + reviews, or `--target`/`--plan` for golden reference matching." Stop.

**If `--no-soft` and `--no-hard` both provided:** "Error: `--no-soft` and `--no-hard` cannot be combined -- that would produce zero criteria." Stop.

**If `--tier` without `--criteria`:** implicitly enable criteria mode. `--tier` is a criteria-mode flag.

**If `--full` without `--criteria`:** implicitly enable criteria mode. `--full` is a criteria-mode flag.

**If `--tier` and `--full` both provided:** "Error: `--tier <name>` and `--full` are mutually exclusive. Use `--tier` for a single tier or `--full` for all 4." Stop.

**If `--approve-qa`:** this flag can be used standalone (reads existing convergence state and bulk-approves non-blocking QA findings) or combined with a convergence run. When standalone:
1. Read `.plan-execution/convergence-state.toon`.
2. If no state exists: "No convergence state found. Run convergence first." Stop.
3. Read the latest qa-review delta report from `.plan-execution/convergence/qa-review/delta-report.toon`.
4. Filter to non-blocking findings (severity below `blockingSeverities`).
5. Write approvals to `.plan-execution/convergence/qa-approvals.toon`.
6. Display: "Approved {N} non-blocking QA findings. {M} critical/blocking findings remain."
7. Stop.

**If `--feature F-NN`:** validate format matches `F-NN` pattern. If invalid: "Error: `--feature` must use format F-NN (e.g., F-01, F-12)." Stop.

**If `--no-tests`:** print to stderr: `"Warning: --no-tests skips unit/integration convergence gates. Wave/feature gating disabled."` Continue with remaining tiers.

**If `--no-e2e`:** print to stderr: `"Warning: --no-e2e skips end-to-end verification. Milestone gating disabled."` Continue with remaining tiers.

**If `--no-qa-review`:** print to stderr: `"Warning: --no-qa-review skips QA review. Code quality findings will not be collected."` Continue with remaining tiers.

**If `--no-tests` and `--no-e2e` and `--no-qa-review` all provided:** "Error: all tiers skipped -- nothing to converge." Stop.

**If `--criteria` with `--config`:** skip criteria planner + harness builder. Set `configPath` to the provided config path and jump directly to Step 5 (Convergence Loop). The convergence-driver reads `convergenceMode: criteria` from the config.

**If `--criteria` (without `--config`):** jump to Step 1.5C (Criteria Convergence Path).

#### Step 1.5: Run Convergence Planner (target mode -- skip if --target or --config provided)

**If `--plan` is set OR if no `--target` is provided (and no `--config`, no `--resume`):**

1. Spawn convergence-planner-agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/convergence-planner-agent.md` first.

    Mode: {--light ? 'light' : 'interactive'}
    PLAN.md path: {planFile or 'PLAN.md'}
    Scope contract path: scope-contract.toon (if exists)
    Codebase context: {tech stack summary from project scanning}
    {if --target provided: 'Seed target: ' + targetPath}
    Write plan to: .plan-execution/convergence-plan.toon"
   ```

2. If planner fails: "Convergence planning failed: {error}. Provide a target directly with `--target <path>` to skip the planner." Stop.

3. Read `.plan-execution/convergence-plan.toon`.

4. Display plan summary:
   ```
   ## Convergence Plan

   Targets: {N} across {M} categories
   Method: {list of comparison methods used}
   Budget: {maxIterations} iterations, {agentBudget} agent budget
   ```

5. Set the target source for Step 2 to `.plan-execution/convergence-plan.toon` (target-parser reads the plan as a source type).

#### Step 1.5C: Criteria Convergence Path (only if --criteria)

This path replaces Steps 1.5 through 4 for criteria mode. It uses criteria-planner-agent and criteria-harness-builder instead of convergence-planner-agent, target-parser, and harness-builder.

**Step 1.5C.1: Run Criteria Planner**

1. Determine mode flags:
   - `--light` → light mode
   - `--auto` → auto mode
   - Otherwise → interactive mode

2. Spawn criteria-planner-agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/criteria-planner-agent.md` first.

    Mode: {--auto ? 'auto' : --light ? 'light' : 'interactive'}
    PLAN.md path: {planFile or 'PLAN.md'}
    {if --phase: 'Phase filter: ' + phaseNumber}
    {if --feature: 'Feature filter: ' + featureId}
    {if --reviewers: 'Reviewer types: ' + reviewerTypes}
    {if --no-soft: 'Hard criteria only (no agent reviews)'}
    {if --no-hard: 'Soft criteria only (no test generation)'}
    Scope contract path: scope-contract.toon (if exists)
    Codebase context: {tech stack summary}
    Write plan to: .plan-execution/criteria-plan.toon
    Write tests to: .plan-execution/convergence/criteria/tests/"
   ```

3. If planner fails: "Criteria planning failed: {error}." Stop.

4. Read `.plan-execution/criteria-plan.toon`.

5. Display criteria summary:
   ```
   ## Criteria Convergence Plan

   Hard criteria (tests): {N} criteria, {M} test files
   Soft criteria (reviews): {N} criteria across {M} reviewers
   Blocking: {N} criteria must pass
   Advisory: {N} criteria reported but non-blocking
   Budget: {maxIterations} iterations, {agentBudget} agent budget
   ```

**Step 1.5C.2: Build Criteria Harness**

1. Spawn criteria-harness-builder agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/criteria-harness-builder.md` first.

    Build criteria convergence harness:
    Criteria plan: .plan-execution/criteria-plan.toon
    Test stubs: .plan-execution/convergence/criteria/tests/
    Project tech stack: {summary from package.json}

    Write outputs to:
    - .plan-execution/convergence/criteria/converge.config
    - .plan-execution/convergence/criteria/harness/"
   ```

2. If harness-builder fails: "Criteria harness build failed: {error}." Stop.

**Step 1.5C.3: Criteria Requirements Review**

Present the full criteria plan for human alignment:

```
## Criteria Convergence Review

### Hard Criteria (Tests)
| # | Criterion | Tests | Priority | Source |
|---|-----------|-------|----------|--------|
| C-01 | Blocks unauthenticated requests | 1 test | P0 | plan |
| C-02 | Returns 401 with error shape | 3 tests | P0 | plan |

### Soft Criteria (Reviews)
| # | Criterion | Reviewer | Blocking? | Priority |
|---|-----------|----------|-----------|----------|
| C-04 | No injection vulnerabilities | security | Yes | P0 |
| C-05 | Code review clean | code-review | Yes | P1 |

### Iteration Priority Order
1. Fix test failures (correctness)
2. Fix security findings (safety)
3. Fix code review findings (quality)
4. Fix advisory findings (if budget remains)

### Budget
- Max iterations: {N}
- Agent budget: {N}
- Per iteration: 1 test run + {N} reviewers + fixers

Proceed? (yes / adjust / abort)
```

If `--dry-run`: display this and stop.
If `--auto`: skip display, proceed directly.

Wait for response:
- **yes**: set `configPath` to `.plan-execution/convergence/criteria/converge.config` and jump to Step 5.
- **adjust**: ask what to change. Update criteria-plan.toon and re-display.
- **abort**: stop.

After approval, jump directly to Step 5 (Convergence Loop). The convergence-driver detects `convergenceMode: criteria` from the converge.config and adapts its scoring and reporting accordingly.

---

#### Step 2: Parse Targets (target mode -- skip if --config provided)

1. Validate that the `--target` path exists. If not: "Target path `{path}` does not exist. Check the path and try again." Stop.

2. Spawn target-parser agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/target-parser.md` first.

    Parse deterministic targets from: {--target path}
    Source type hint: {if user provided one, otherwise omit}
    Write target manifest to: .plan-execution/target-manifest.toon"
   ```

3. If target-parser fails: "Target parsing failed: {error}. Cannot converge without targets." Stop.

4. Read the target manifest from `.plan-execution/target-manifest.toon`.

5. Display manifest summary:
   ```
   ## Target Manifest

   Source: {--target path}
   Source type: {detected type, e.g. API snapshot, screenshot, test fixture}
   Targets: {N} artifacts
   Comparison methods: {list of methods, e.g. json-deep-equal, pixel-diff, text-exact}
   ```

#### Step 3: Build Harness (skip if --config provided)

1. Gather project context:
   - Read `package.json` (or equivalent) for tech stack
   - Read `orchestration.toml` if it exists for tolerance overrides
   - Note any `--tolerance` override from arguments

2. Spawn harness-builder agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/harness-builder.md` first.

    Build a convergence harness for the following targets:
    Target manifest: .plan-execution/target-manifest.toon
    Project tech stack: {summary from package.json}
    Tolerance overrides: {from --tolerance or orchestration.toml, if any}

    Write outputs to:
    - .plan-execution/converge.config
    - .plan-execution/harness/ (comparison scripts and runner)"
   ```

3. If harness-builder fails: "Harness build failed: {error}. Cannot converge without a comparison harness." Stop.

4. Read the harness config from `.plan-execution/converge.config`.

5. Display harness summary:
   ```
   ## Harness Configuration

   Comparison methods: {list with per-method details}
   Tolerance thresholds: {per-method thresholds}
   Runner: .plan-execution/harness/runner.sh
   Config: .plan-execution/converge.config
   ```

#### Step 4: Convergence Requirements Review

Present the full convergence configuration for human alignment. This is MANDATORY -- convergence parameters define what "done" means.

Display per-target details from the parsed manifest and built harness:

```
## Convergence Configuration Review

### Targets ({N} artifacts)

| # | Target | Source | Comparison | Tolerance | Capture Method |
|---|--------|--------|------------|-----------|----------------|
| 1 | GET /api/users | api-users.json | json-deep-equal | 1.00 | HTTP GET to dev server |
| 2 | Login page | login.png | pixel-diff | 0.95 | Playwright screenshot |
| 3 | App config | config.json | json-deep-equal | 1.00 | File read |

### Per-Target Options

**GET /api/users:**
- Ignored fields: timestamp, requestId (runtime-generated)
- Numeric tolerance: 0.001

**Login page:**
- Viewport: 1280x720 @ 2x density
- Anti-aliasing threshold: 5px

### Budget

- Max iterations: {N}
- Agent budget: {N} fixer agents
- Estimated worst-case: {N targets x maxIterations} agent invocations

### Golden Targets

Source: {--target path}
Stored in: .plan-execution/convergence/targets/

Verify the following are correct before proceeding:
1. Are these the right outputs to test?
2. Are the comparison methods appropriate per target?
3. Are the tolerances right? (1.0 = exact match, lower = fuzzy)
4. Are the right fields being ignored?
5. Is the capture method correct for each target?

Proceed? (yes / adjust / abort)
```

If `--dry-run`: display this summary and stop. Do not proceed to the convergence loop.

Wait for user response:
- **yes**: proceed to Step 5.
- **adjust**: ask which targets/methods/tolerances to change. Update `.plan-execution/converge.config` accordingly and re-display.
- **abort**: stop.

#### Step 5: Convergence Loop

1. Read agent budget from `orchestration.toml` field `settings.maxParallelAgents` (default: 30).

2. Determine mode and paths:
   - **Target mode** (default): `configPath = .plan-execution/converge.config`, `runnerPath = .plan-execution/harness/runner.sh`, `specPath = .plan-execution/target-manifest.toon`, `convergenceMode = target`
   - **Criteria mode** (from Step 1.5C): `configPath = .plan-execution/convergence/criteria/converge.config`, `runnerPath = .plan-execution/convergence/criteria/harness/run-harness.sh`, `specPath = .plan-execution/criteria-plan.toon`, `convergenceMode = criteria`

3. Spawn convergence-driver agent (general-purpose):

   **Target mode:**
   ```
   "Read your instructions from `~/.claude/agents/convergence-driver.md` first.

    Run the convergence loop with the following parameters:
    Convergence mode: target
    Config: {configPath}
    Harness runner: {runnerPath}
    Target manifest: {specPath}
    Max iterations: {--max-iterations or 5}
    Tolerance thresholds: {from converge.config}
    Agent budget: {from orchestration.toml or 30}
    Auto-commit: {--no-auto-commit ? false : true}
    Resume at iteration: {iteration number, 1 if fresh start}"
   ```

   **Criteria mode:**
   ```
   "Read your instructions from `~/.claude/agents/convergence-driver.md` first.

    Run the convergence loop with the following parameters:
    Convergence mode: criteria
    Config: {configPath}
    Harness runner: {runnerPath}
    Criteria plan: {specPath}
    Max iterations: {--max-iterations or 5}
    Agent budget: {from orchestration.toml or 30}
    Auto-commit: {--no-auto-commit ? false : true}
    Resume at iteration: {iteration number, 1 if fresh start}
    {if --tier: 'Tier filter: ' + tierName}
    {if --full: 'Run all tiers: unit, integration, e2e, qa-review'}
    {if --phase: 'Phase scope: ' + phaseNumber}
    {if --feature: 'Feature scope: ' + featureId}
    {if --no-tests: 'Skip tiers: unit, integration'}
    {if --no-e2e: 'Skip tiers: e2e'}
    {if --no-qa-review: 'Skip tiers: qa-review'}
    {if --approve-qa: 'Auto-approve non-blocking QA findings: true'}"
   ```

4. The convergence-driver handles the full iteration loop internally, spawning delta-analyzer and fixer agents as needed. For the e2e tier specifically, it spawns `e2e-test-writer-agent` (model: sonnet, see `agents/e2e-test-writer-agent.md`) to generate YAML stories and Playwright tests, then `e2e-runner-agent` (model: haiku, see `agents/e2e-runner-agent.md`) to execute them.

5. Monitor progress by reading `.plan-execution/convergence-state.toon` periodically. Display progress updates based on mode:

   **Target mode:**
   ```
   === Convergence Progress ===  [iteration {i}/{max} — {max - i} remaining]

     Passing: {n}/{total} targets  ({pct}%)
     Failing: {f}/{total} targets
     Rate:    {rate}% improvement from last iteration
     Agents:  {used}/{budget} budget used

     History:
       Iter 1: {n1}/{total} passing  (rate: --)
       Iter 2: {n2}/{total} passing  (rate: {r2}%)
       Iter 3: {n3}/{total} passing  (rate: {r3}%)
   ```

   **Criteria mode:**
   ```
   === Criteria Convergence Progress ===  [iteration {i}/{max} — {max - i} remaining]

     Criteria: {passing}/{total} passing  ({pct}%)
       Hard (tests):    {hardPassing}/{hardTotal}
       Soft (reviews):  {softPassing}/{softTotal}
     Blocking:  {blockingPassing}/{blockingTotal} passing
     Frozen:    {frozenCriteria} conflicts
     Rate:      {rate}% improvement from last iteration
     Agents:    {used}/{budget} budget used
     {if --tier: 'Tier: ' + tierName + ' only'}
     {if --full: 'Tiers: unit → integration → e2e → qa-review'}

     History:
       Iter 1: {n1}/{total} passing  (blocking: {b1} failing, conflicts: {c1})
       Iter 2: {n2}/{total} passing  (blocking: {b2} failing, conflicts: {c2})
       Iter 3: {n3}/{total} passing  (blocking: {b3} failing, conflicts: {c3})
   ```

6. Update `.plan-execution/status.toon` at each progress check.

#### Step 5.5: Convergence Context Checkpoint (every 3 iterations)

After each progress check in Step 5, evaluate whether a context checkpoint is appropriate:

1. **Check iteration count.** Read current iteration from `.plan-execution/convergence-state.toon`. If `iteration % 3 == 0` and `iteration > 0` (i.e., after iterations 3, 6, 9, ...):

2. **Write all convergence state to disk atomically:**
   - Ensure `convergence-state.toon` is current (written by convergence-driver)
   - Ensure all `convergence/iterations/iter-*.toon` files are current
   - Write `.plan-execution/stage-context/converge.toon` with current convergence progress
   - Update `rolling-context.md` with convergence iteration summaries

3. **Present checkpoint prompt:**
   ```
   ## Convergence Checkpoint (Iteration {i}/{max})

   State saved to disk:
   - Convergence state: .plan-execution/convergence-state.toon
   - Iteration summaries: .plan-execution/convergence/iterations/ ({i} files)
   - Stage context: .plan-execution/stage-context/converge.toon
   - Rolling context: .plan-execution/rolling-context.md

   Progress: {passing}/{total} passing ({pct}%)
   Iterations used: {i}/{max}

   Run `/clear` for fresh context, then:
     /loom converge --resume
   ```

4. **If `--auto`:** log the checkpoint message but do NOT pause. Continue iteration loop. The checkpoint data is on disk if the context monitor hook triggers a forced clear later.

5. **If not `--auto`:** display the checkpoint prompt and wait:
   - `continue` -- proceed without clearing (default)
   - `clear` -- user will manually run `/clear` then `--resume`

#### Step 6: Report Results

When the convergence-driver completes, read the final `.plan-execution/convergence-state.toon` and display a mode-appropriate report:

**Target mode report:**

```markdown
## Convergence Report (Target)

**Status:** {converged | stalled | regression | budget_exhausted | max_iterations}
**Iterations:** {N} of {max}
**Targets:** {passing}/{total} passing

### Target Results
| Target | Method | Score | Threshold | Status |
|--------|--------|-------|-----------|--------|
| GET /api/users | json-deep-equal | 1.00 | 1.00 | pass |
| Login page | pixel-diff | 0.94 | 0.95 | fail |

### Stuck Deltas (if any)
- {target}: {why it's stuck -- e.g. "score plateaued at 0.94 for 3 iterations"}

### Agent Usage
- Total agents spawned: {N}
- Budget remaining: {budget - N}

### Next Steps
{contextual recommendations based on final status}
```

**Criteria mode report:**

```markdown
## Convergence Report (Criteria)

**Status:** {converged | stalled | regression | budget_exhausted | max_iterations}
**Iterations:** {N} of {max}
**Criteria:** {passing}/{total} passing  |  **Frozen:** {frozen} conflicts

### Criteria Results
| # | Criterion | Type | Status | Iterations |
|---|-----------|------|--------|------------|
| C-01 | Blocks unauthenticated requests | hard | pass | 2 |
| C-02 | Returns 401 with error shape | hard | pass | 3 |
| C-06 | Clean separation of concerns | soft | frozen | -- |

### Reviewer Summary
| Reviewer | Findings | Resolved | Remaining |
|----------|----------|----------|-----------|
| test-runner | 5 | 5 | 0 |
| security-reviewer | 2 | 2 | 0 |
| code-reviewer | 3 | 2 | 1 (frozen) |

### Frozen Conflicts (if any)
- C-06: "Extract auth logic to helper" ↔ "Inline is clearer" -- frozen for human review

### Agent Usage
- Total agents spawned: {N} (fixers: {F}, reviewers: {R})
- Budget remaining: {budget - N}

### Next Steps
{contextual recommendations -- same status-based logic, plus:
 - If frozen conflicts exist: "Review frozen conflicts above. These represent reviewer disagreements that cannot be resolved automatically."
 - converged with frozen: "All blocking criteria pass. {N} frozen conflicts remain for human review."}
```

#### Step 7: Save State

1. Save convergence report to `.plan-execution/convergence/convergence-report.md`.

2. If this run was triggered during a `/loom auto` pipeline (check for `.plan-execution/pipeline-state.toon`), save a summary to `.plan-execution/convergence-summary.toon` for the outer loop to read:

   **Target mode:**
   ```toon
   convergenceMode: target
   status: {converged | stalled | regression | budget_exhausted | max_iterations}
   iterations: {N}
   maxIterations: {max}
   targetsPassing: {n}
   targetsTotal: {total}
   agentsUsed: {N}
   stuckDeltas: {count}
   completedAt: {ISO timestamp}
   ```

   **Criteria mode:**
   ```toon
   convergenceMode: criteria
   status: {converged | stalled | regression | budget_exhausted | max_iterations}
   iterations: {N}
   maxIterations: {max}
   criteriaPassing: {n}
   criteriaTotal: {total}
   criteriaFrozen: {frozen}
   blockingPassing: {n}
   blockingTotal: {total}
   agentsUsed: {N}
   frozenConflicts: {count}
   completedAt: {ISO timestamp}
   ```

3. Update final `.plan-execution/status.toon`.

### Error Handling

- **No `--target`, `--criteria`, `--config`, or `--resume`**: show usage help and stop.
- **Target path does not exist** (target mode): "Target path `{path}` does not exist. Check the path and try again." Stop.
- **PLAN.md missing** (criteria mode): "No PLAN.md found. Criteria convergence requires a plan with acceptance criteria." Stop.
- **target-parser fails** (target mode): "Target parsing failed: {error}. Cannot converge without targets." Stop.
- **criteria-planner fails** (criteria mode): "Criteria planning failed: {error}." Stop.
- **harness-builder fails** (either mode): "Harness build failed: {error}. Cannot converge without a harness." Stop.
- **convergence-driver fails**: Save partial state to `.plan-execution/convergence-state.toon` for `--resume`. Display what completed and suggest: "Run `/loom converge --resume` to continue from iteration {N}."
- **convergence-state.toon missing on `--resume`**: "No convergence state found. Use `--target` or `--criteria` to start a new run." Stop.
- **convergence-state.toon from a different source**: Compare `convergenceMode` + source path in state with current flags. If they differ: "Warning: existing convergence state is for a different {mode/source} (`{old}`). Continue with existing state or start fresh? (continue / fresh)" If fresh, delete old state and restart.
- **Agent failure during loop**: The convergence-driver handles internal agent failures. If the driver itself fails, save state and offer `--resume`.

### Status Line Updates

Write `.plan-execution/status.toon` at every phase transition:
```toon
command: converge
phase: {parsing-targets | building-harness | approval-gate | converging | complete}
wave: 0
totalWaves: 1
agentsRunning: {N}
agentsDone: {N}
agentsTotal: {N}
agentsFailed: 0
findings: 0
updatedAt: {ISO timestamp}
```

---

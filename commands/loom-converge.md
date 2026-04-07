# Convergence Pipeline Orchestrator

You are an orchestrator that drives a deterministic convergence loop — comparing current implementation output against a known-good target and iterating until the delta reaches zero or a circuit breaker fires.

## Requirements

$ARGUMENTS

Parse arguments:
- `--target <path>` — path to the deterministic source (required on first run)
- `--config <path>` — path to an existing converge.config (skip target-parser and harness-builder)
- `--max-iterations N` — override max iterations (default: 10)
- `--tolerance <threshold>` — global tolerance override (0.0-1.0)
- `--dry-run` — run target-parser and harness-builder, show manifest and config, stop before iteration loop
- `--resume` — resume from `.plan-execution/convergence-state.toon`
- `--status` — show current convergence state without running anything
- No args: show usage help

## Instructions

### Step 0: Read Protocols

Read convergence-related protocols:
- `~/.claude/agents/protocols/orchestration-patterns.md` (Pattern 5: Converge)
- `~/.claude/agents/protocols/pattern-executor.md` (Converge execution)

### Step 1: Handle Special Flags

**If no args provided:** display usage help and stop:
```
## Usage: /loom-converge

Drive a deterministic convergence loop — compare implementation output
against a known-good target, iterate until the delta reaches zero.

  --target <path>         Path to deterministic source (required on first run)
  --config <path>         Path to existing converge.config (skip setup)
  --max-iterations N      Override max iterations (default: 10)
  --tolerance <threshold> Global tolerance override (0.0-1.0)
  --dry-run               Run setup only, show manifest and config, stop
  --resume                Resume from .plan-execution/convergence-state.toon
  --status                Show current convergence state without running

Examples:
  /loom-converge --target tests/golden/api-responses.json
  /loom-converge --config .plan-execution/converge.config --max-iterations 5
  /loom-converge --resume
  /loom-converge --status
```

**If `--status`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` to start a new run." Stop.
3. Display current state:
   - Current iteration and max iterations
   - Passing and failing target counts
   - Convergence rate (improvement percentage from last iteration)
   - Iteration history with per-iteration passing counts
   - Circuit breaker status
4. Suggest next action based on state:
   - If `status == converged`: "Convergence complete. No action needed."
   - If `status == running` or `status == paused`: "Run `/loom-converge --resume` to continue."
   - If `status == stalled` or `status == regression`: "Review stuck deltas below. Manual intervention may be needed before `--resume`."
   - If `status == budget_exhausted`: "Increase agent budget in orchestration.toml and `--resume`."
5. Stop.

**If `--resume`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` to start a new run." Stop.
3. Validate the state file has required fields: `iteration`, `maxIterations`, `configPath`, `targetManifestPath`.
4. If `status == converged`: "Convergence already complete. Nothing to resume." Stop.
5. If `status == regression` or `status == stalled`: warn the user about the prior failure, ask if they want to continue anyway.
6. Restore state variables from the file.
7. Jump to Step 5 (Convergence Loop) at the saved iteration.

**If `--dry-run`:** proceed through Steps 2-4 normally; Step 4 will stop execution.

**If neither `--target` nor `--config` nor `--resume` provided:** show usage help and stop.

### Step 2: Parse Targets (skip if --config provided)

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

### Step 3: Build Harness (skip if --config provided)

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

### Step 4: Human Approval Gate

Display the convergence setup summary:
```
## Convergence Setup Complete

**Targets:** {N} artifacts from {source type}
**Comparison methods:** {list}
**Tolerance thresholds:** {per-method thresholds}
**Max iterations:** {N}
**Estimated max agents:** {N x maxIterations} fixer agents

Proceed with convergence loop? (yes / adjust config / abort)
```

If `--dry-run`: display this summary and stop. Do not proceed to the convergence loop.

Wait for user response:
- **yes**: proceed to Step 5.
- **adjust config**: tell the user to edit `.plan-execution/converge.config` and re-run with `--config .plan-execution/converge.config`.
- **abort**: stop.

### Step 5: Convergence Loop

1. Read agent budget from `orchestration.toml` field `settings.maxParallelAgents` (default: 30).

2. Spawn convergence-driver agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/convergence-driver.md` first.

    Run the convergence loop with the following parameters:
    Config: {converge.config path}
    Harness runner: .plan-execution/harness/runner.sh
    Target manifest: .plan-execution/target-manifest.toon
    Max iterations: {--max-iterations or 10}
    Tolerance thresholds: {from converge.config}
    Agent budget: {from orchestration.toml or 30}
    Resume at iteration: {iteration number, 1 if fresh start}"
   ```

3. The convergence-driver handles the full iteration loop internally, spawning delta-analyzer and fixer agents as needed.

4. Monitor progress by reading `.plan-execution/convergence-state.toon` periodically. Display progress updates:
   ```
   === Convergence Progress ===  [iteration {i}/{max}]

     Passing: {n}/{total} targets  ({pct}%)
     Failing: {f}/{total} targets
     Rate:    {rate}% improvement from last iteration
     Agents:  {used}/{budget} budget used

     History:
       Iter 1: {n1}/{total} passing  (rate: —)
       Iter 2: {n2}/{total} passing  (rate: {r2}%)
       Iter 3: {n3}/{total} passing  (rate: {r3}%)
   ```

5. Update `.plan-execution/status.toon` at each progress check.

### Step 6: Report Results

When the convergence-driver completes, read the final `.plan-execution/convergence-state.toon` and display the convergence report:

```markdown
## Convergence Report

**Status:** {converged | stalled | regression | budget_exhausted | max_iterations}
**Iterations:** {N} of {max}
**Targets:** {passing}/{total} passing

### Target Results
| Target | Method | Score | Threshold | Status |
|--------|--------|-------|-----------|--------|
| GET /api/users | json-deep-equal | 1.00 | 1.00 | pass |
| Login page | pixel-diff | 0.94 | 0.95 | fail |

### Stuck Deltas (if any)
- {target}: {why it's stuck — e.g. "score plateaued at 0.94 for 3 iterations"}

### Agent Usage
- Total agents spawned: {N}
- Budget remaining: {budget - N}

### Next Steps
{contextual recommendations based on final status:
 - converged: "All targets match within tolerance. Convergence complete."
 - stalled: "The following deltas are stuck. Review the stuck targets above and consider manual intervention, then run `/loom-converge --resume`."
 - regression: "Scores regressed during iteration {N}. Review the fixer agent changes for unintended side effects."
 - budget_exhausted: "Agent budget exhausted with {failing} targets remaining. Increase budget in orchestration.toml and run `/loom-converge --resume`."
 - max_iterations: "Max iterations reached with {failing} targets remaining. Consider increasing --max-iterations or reviewing stuck deltas for structural issues."}
```

### Step 7: Save State

1. Save convergence report to `.plan-execution/convergence-report.md`.

2. If this run was triggered during a `/loom-auto` pipeline (check for `.plan-execution/pipeline-state.toon`), save a summary to `.plan-execution/convergence-summary.toon` for the outer loop to read:
   ```toon
   status: {converged | stalled | regression | budget_exhausted | max_iterations}
   iterations: {N}
   maxIterations: {max}
   targetsPassing: {n}
   targetsTotal: {total}
   agentsUsed: {N}
   stuckDeltas: {count}
   completedAt: {ISO timestamp}
   ```

3. Update final `.plan-execution/status.toon`.

## Error Handling

- **No `--target` and no `--config` and not `--resume`**: show usage help and stop.
- **Target path does not exist**: "Target path `{path}` does not exist. Check the path and try again." Stop.
- **target-parser fails**: "Target parsing failed: {error}. Cannot converge without targets." Stop.
- **harness-builder fails**: "Harness build failed: {error}. Cannot converge without a comparison harness." Stop.
- **convergence-driver fails**: Save partial state to `.plan-execution/convergence-state.toon` for `--resume`. Display what completed and suggest: "Run `/loom-converge --resume` to continue from iteration {N}."
- **convergence-state.toon missing on `--resume`**: "No convergence state found. Use `--target` to start a new run." Stop.
- **convergence-state.toon from a different target**: Compare `targetPath` in state with current `--target`. If they differ: "Warning: existing convergence state is for a different target (`{old}`). Continue with existing state or start fresh? (continue / fresh)" If fresh, delete old state and start from Step 2.
- **Agent failure during loop**: The convergence-driver handles internal agent failures. If the driver itself fails, save state and offer `--resume`.

## Status Line Updates

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

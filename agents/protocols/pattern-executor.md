# Pattern Executor Protocol

Reusable runtime protocol for invoking orchestration patterns. Any orchestrator command follows this protocol to match a task against patterns declared in `orchestration.toml` and execute the corresponding multi-agent topology. Pattern definitions live in `orchestration-patterns.md`; this document covers invocation mechanics.

---

## Trigger Matching

1. The orchestrator has a task with a **semantic label** (e.g., `"architecture-decision"`, `"code-generation"`).
2. Read all `[patterns.*]` entries from `orchestration.toml`.
3. Compare the label against each pattern's `trigger` field.
4. **First match wins.** If no pattern matches, fall back to default single-agent spawn.

---

## Per-Pattern Execution

### Debate

Sequential adversarial rounds followed by synthesis.

1. Spawn advocate with the task prompt. Collect position.
2. Spawn critic with prompt + advocate output. Collect critique.
3. Repeat (advocate rebuttal, critic counter) up to `maxRounds`.
4. Spawn moderator with the full transcript. Return recommendation.

**Error handling:** If any agent fails mid-debate, halt immediately. Return the last complete advocate output as the result. If the moderator fails, return the raw final-round advocate output with an error annotation.

**Budget:** `(maxRounds * 2) + 1` agents (rounds of advocate+critic, plus moderator).

### Chain

Sequential pipeline where each agent refines the prior output.

1. Spawn `agents[0]` with the initial input. Collect output.
2. Spawn `agents[1]` with prior output (and original input if `passOriginalInput = true`).
3. Continue through all agents in array order.
4. Return the final agent's output.

**Error handling:** If agent N fails, halt the chain. Return agent N-1's output with an error annotation noting which step failed and why.

**Budget:** `N` agents (one per pipeline step).

### Vote

Parallel isolated execution with comparative evaluation.

1. Create a worktree (or temp directory) per agent for isolation.
2. Spawn all agents simultaneously with the identical prompt.
3. Collect all solutions. Clean up worktrees.
4. Spawn evaluator with all solutions side-by-side.
5. Return evaluator's chosen or merged solution.

**Error handling:** If fewer than 2 agents succeed, skip the evaluator and return the sole successful solution. If all agents fail, return an error result with no solution.

**Budget:** `N + 1` agents (N solvers + evaluator). Drops to `N` if evaluator is skipped.

### Triage

Lightweight classification then specialist routing.

1. Spawn router (haiku-class model) with the task. Router returns `{ complexity, domains, reasoning }`.
2. Route based on classification:
   - **simple:** Spawn the `simple` specialist (sonnet-class).
   - **complex:** Spawn the `complex` specialist (opus-class).
   - **multi-domain:** Fan out to domain specialists in parallel, merge results.
3. Return specialist output.

**Error handling:** If the router fails, fall back to the `complex` specialist (opus) for the task. Never silently drop a task.

**Budget:** 1 (router) + 1 (simple/complex) or 1 + N (multi-domain).

### Converge

Iterative convergence loop toward a deterministic target.

1. Spawn target-parser with the source reference. Collect target manifest.
2. Spawn harness-builder with target manifest. Collect harness config + comparison scripts.
3. Present harness config to orchestrator for approval gate.
4. Enter convergence loop (iteration 1..`maxIterations`):
   a. Run comparison harness → Delta Report.
   b. If all targets pass (score >= threshold): break loop, report success.
   c. Spawn delta-analyzer with Delta Report → prioritized fix list.
   d. Filter to actionable, non-noise deltas.
   e. Spawn fixer agents in parallel for each actionable delta.
   f. After fixers complete, re-run harness.
   g. Compute convergence rate: `(prior failing - current failing) / prior failing`.
   h. Circuit break if: `convergenceRate < 0.01` for 2 consecutive iterations OR `current failing > prior failing` (regression).
5. Produce convergence report with final status.

**Error handling:**
- **target-parser fails:** Abort pattern, return error (no fallback — can't converge without a target).
- **harness-builder fails:** Abort pattern, return error.
- **delta-analyzer fails mid-loop:** Use previous iteration's fix list if available, otherwise halt loop and return partial result.
- **Fixer agent fails:** Mark that delta as unresolved, continue with remaining fixers.
- **All fixers fail in an iteration:** Halt loop, return partial result.
- **Harness execution fails:** Retry once, then halt loop.

**Budget:** 2 (setup: target-parser + harness-builder) + iterations x (1 delta-analyzer + N fixers). Capped by `maxIterations`. Report `agentsUsed` cumulatively.

### Criteria Converge

Iterative test + review loop that converges when all blocking criteria pass.

1. Spawn criteria-planner-agent with the plan. Collect criteria plan + test stubs.
2. Spawn criteria-harness-builder with the plan + stubs. Collect harness config.
3. **Human approval gate** (skip in auto mode): review criteria plan and test stubs.
4. Enter convergence loop (max `maxIterations` from config):
   a. Run harness: execute tests (hard criteria) + spawn reviewer agents (soft criteria).
   b. Collect delta report with per-criterion pass/fail and findings.
   c. Spawn delta-analyzer with report → fix list (layered priority: tests > security > code review > advisory).
   d. Check for conflicts: if findings oscillate between iterations, freeze that criterion.
   e. Spawn fixer agents in parallel for actionable findings.
   f. After fixers complete, re-run harness.
   g. Compute convergence rate: `(prior blocking failing - current blocking failing) / prior blocking failing`.
   h. Circuit break if: rate < 0.01 for 2 consecutive iterations, regression, all blocking frozen, or budget exhausted.
5. Produce convergence report with final status.

**Error handling:**
- **criteria-planner fails:** Abort pattern, return error.
- **criteria-harness-builder fails:** Abort pattern, return error.
- **delta-analyzer fails mid-loop:** Use previous iteration's fix list if available, otherwise halt loop and return partial result.
- **Fixer agent fails:** Mark that finding as unresolved, continue with remaining fixers.
- **Reviewer agent fails:** Score that reviewer's criteria as failing with error details, continue.
- **All fixers fail in an iteration:** Halt loop, return partial result.
- **Conflict detected:** Freeze criterion, continue loop with remaining criteria.

**Budget:** 2 (setup: criteria-planner + criteria-harness-builder) + iterations x (1 delta-analyzer + N reviewers + M fixers). Reviewer agents count toward budget. Capped by `maxIterations`. Report `agentsUsed` cumulatively.

---

## PatternResult

Every pattern invocation returns a `PatternResult` to the orchestrator.

| Field        | Type     | Required | Description                                  |
|--------------|----------|----------|----------------------------------------------|
| `pattern`    | string   | yes      | Pattern name from `orchestration.toml`       |
| `type`       | enum     | yes      | `debate`, `chain`, `vote`, `triage`, `converge`, or `converge-criteria` |
| `result`     | string   | yes      | Final output text                            |
| `agentsUsed` | integer  | yes      | Total agent invocations consumed             |
| `transcript` | string   | debate   | Compressed argument history                  |
| `rounds`     | integer  | debate   | Actual rounds executed                       |
| `solutions`  | integer  | vote     | Number of solutions compared by evaluator    |
| `routing`    | object   | triage   | `{ complexity: string, domains: string[] }`  |
| `iterations` | integer  | converge | Number of convergence iterations completed   |
| `finalDelta` | object   | converge | `{ passing: N, failing: N, total: N }`       |
| `converged`  | boolean  | converge | True if all targets passed within tolerance  |
| `iterations` | integer  | converge-criteria | Number of convergence iterations completed |
| `criteriaDelta` | object | converge-criteria | `{ passing: N, failing: N, frozen: N, total: N }` |
| `converged`  | boolean  | converge-criteria | True if all blocking criteria pass (frozen excluded) |
| `frozenConflicts` | integer | converge-criteria | Number of criteria frozen due to reviewer conflicts |

---

## Budget Accounting

1. Each pattern reports `agentsUsed` in its result.
2. The orchestrator adds `agentsUsed` to its cumulative `agentsSpawned` counter (tracked in `pipeline-state.toon` or `state.toon`).
3. **Warn** when cumulative agents reach 80% of `maxAgents`.
4. **Block** new pattern invocations when cumulative agents reach 100% of `maxAgents`. The orchestrator must escalate rather than exceed the budget.

---

## Error Summary

| Pattern | Failure Point       | Behavior                                          |
|---------|---------------------|---------------------------------------------------|
| Debate  | Advocate fails      | Halt; return last complete output                 |
| Debate  | Critic fails        | Halt; return current advocate output              |
| Debate  | Moderator fails     | Return raw final-round output with annotation     |
| Chain   | Agent N fails       | Halt; return agent N-1 output with annotation     |
| Vote    | < 2 agents succeed  | Skip evaluator; return sole solution              |
| Vote    | All agents fail     | Return error result, no solution                  |
| Vote    | Evaluator fails     | Return first successful solution with annotation  |
| Triage  | Router fails        | Fall back to complex specialist (opus)            |
| Triage  | Specialist fails    | Escalate to orchestrator                          |
| Converge | target-parser fails | Abort; return error result                       |
| Converge | harness-builder fails | Abort; return error result                     |
| Converge | delta-analyzer fails | Use prior fix list or halt with partial          |
| Converge | Fixer fails         | Mark delta unresolved, continue                  |
| Converge | All fixers fail     | Halt loop; return partial result                 |
| Converge | Harness fails       | Retry once; then halt                            |
| Converge | Stall detected      | Halt loop; return partial with stall flag        |
| Converge | Regression detected | Halt loop; return partial with regression flag   |
| Converge-Criteria | criteria-planner fails | Abort; return error result             |
| Converge-Criteria | criteria-harness fails | Abort; return error result              |
| Converge-Criteria | delta-analyzer fails | Use prior fix list or halt with partial  |
| Converge-Criteria | Fixer fails        | Mark finding unresolved, continue               |
| Converge-Criteria | Reviewer fails     | Score criteria as failing, continue              |
| Converge-Criteria | All fixers fail    | Halt loop; return partial result                 |
| Converge-Criteria | Conflict detected  | Freeze criterion, continue loop                  |
| Converge-Criteria | Stall detected     | Halt loop; return partial with stall flag        |
| Converge-Criteria | Regression detected | Halt loop; return partial with regression flag  |
| Converge-Criteria | All blocking frozen | Halt loop; return partial with stall flag       |

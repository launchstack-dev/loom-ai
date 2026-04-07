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

---

## PatternResult

Every pattern invocation returns a `PatternResult` to the orchestrator.

| Field        | Type     | Required | Description                                  |
|--------------|----------|----------|----------------------------------------------|
| `pattern`    | string   | yes      | Pattern name from `orchestration.toml`       |
| `type`       | enum     | yes      | `debate`, `chain`, `vote`, or `triage`       |
| `result`     | string   | yes      | Final output text                            |
| `agentsUsed` | integer  | yes      | Total agent invocations consumed             |
| `transcript` | string   | debate   | Compressed argument history                  |
| `rounds`     | integer  | debate   | Actual rounds executed                       |
| `solutions`  | integer  | vote     | Number of solutions compared by evaluator    |
| `routing`    | object   | triage   | `{ complexity: string, domains: string[] }`  |

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

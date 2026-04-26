```toon
pageId: component-orchestration-patterns
title: Orchestration Patterns
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: agents/protocols/orchestration-patterns.md, agents/protocols/pattern-executor.md
crossRefs[3]{pageId,relationship}:
  pattern-model-resolution,relates-to
  concept-convergence,relates-to
  concept-execution-pipeline,relates-to
tags[5]: patterns, debate, chain, vote, triage, converge
staleness: fresh
confidence: high
```

# Orchestration Patterns

Loom provides five reusable multi-agent coordination patterns. Each defines a specific interaction topology with deterministic orchestration logic. Patterns are declared in `orchestration.toml` and invoked by commands or other agents.

Source: `agents/protocols/orchestration-patterns.md`, `agents/protocols/pattern-executor.md`

---

## Pattern 1: Debate

**Purpose:** Adversarial reasoning to explore decision tradeoffs.

Two agents argue opposing positions over multiple rounds. A moderator synthesizes the strongest arguments into a final recommendation.

**When to use:** Architecture decisions, technology selection, design reviews where confirmation bias is a risk.

**How it works:**
1. Spawn advocate with the decision prompt — collect position
2. Spawn critic with prompt + advocate output — collect critique
3. Repeat (rebuttal → counter) up to `maxRounds`
4. Spawn moderator with full transcript — return recommendation

**Cost:** `(maxRounds * 2) + 1` agent invocations. Hard cap at `maxRounds` (default 3, max 5).

**orchestration.toml:**
```toml
[patterns.arch-debate]
type = "debate"
agents = ["advocate-agent", "critic-agent"]
moderator = "synthesis-agent"
maxRounds = 3
trigger = "architecture-decision"
```

---

## Pattern 2: Chain (Refinement)

**Purpose:** Progressive quality improvement through sequential transformation.

Each agent receives the prior agent's output and refines it. The chain is strictly ordered.

**When to use:** Code generation with quality stages (draft → refine → harden), document creation, data transformation pipelines.

**How it works:**
1. Spawn `agents[0]` with initial input
2. Spawn `agents[1]` with prior output (and original input if `passOriginalInput = true`)
3. Continue through all agents in array order
4. Return the final agent's output

**Cost:** N agents (one per pipeline step). Cheapest pattern for linear workflows.

**orchestration.toml:**
```toml
[patterns.code-quality-chain]
type = "chain"
agents = ["draft-agent", "refine-agent", "harden-agent"]
trigger = "code-generation"
passOriginalInput = true
```

**Error handling:** If agent N fails, halt and return agent N-1's output with an error annotation.

---

## Pattern 3: Vote (Consensus)

**Purpose:** Diversity of approach for high-stakes decisions.

Multiple agents independently solve the same problem in isolation. An evaluator picks the best solution or merges the strongest elements.

**When to use:** Critical implementations (auth, payments, crypto), problems with multiple valid approaches, high-stakes code where a single agent's blind spots could introduce vulnerabilities.

**How it works:**
1. Create a worktree (or temp directory) per agent for isolation
2. Spawn all agents simultaneously with identical prompt
3. Collect all solutions, clean up worktrees
4. Spawn evaluator with all solutions side-by-side
5. Return evaluator's chosen or merged solution

**Cost:** N + 1 agents (N solvers + evaluator). Most expensive pattern — justified by higher-confidence results.

**orchestration.toml:**
```toml
[patterns.auth-vote]
type = "vote"
agents = ["jwt-agent", "session-agent", "oauth-agent"]
evaluator = "auth-evaluator"
isolation = "worktree"
trigger = "auth-implementation"
```

**Error handling:** If fewer than 2 agents succeed, skip evaluator and return the sole successful solution.

---

## Pattern 4: Triage (Supervisor)

**Purpose:** Cost-efficient routing of mixed-complexity workloads.

A cheap haiku-class model classifies each task and routes to the appropriate specialist. Avoids burning expensive tokens on simple tasks.

**When to use:** Mixed-complexity workloads, cost optimization (route 80% to cheap models), multi-domain projects.

**How it works:**
1. Spawn router (haiku) to classify the task
2. Router returns: `complexity` (simple/complex/multi-domain), `domains`, `reasoning`
3. Route based on classification:
   - **Simple** → Router handles directly (already has context)
   - **Complex** → Spawn designated opus-class specialist
   - **Multi-domain** → Fan out to multiple domain specialists in parallel, merge results

**Cost model:** Router call is cheap. Pattern pays for itself when >50% of tasks are simple.

**orchestration.toml:**
```toml
[patterns.task-triage]
type = "triage"
router = "auto-dispatcher"
specialists = { simple = "sonnet-worker", complex = "opus-specialist" }
trigger = "mixed-workload"
```

---

## Pattern 5: Converge

**Purpose:** Iterative execution until outputs match deterministic targets.

See [concept-convergence](concept-convergence.md) for the full convergence system. The converge pattern is the orchestration wrapper that drives convergence iterations.

**When to use:** API parity verification, visual regression, CLI output matching, any scenario where code must produce specific deterministic outputs.

---

## Trigger Matching

The pattern executor uses first-match logic:

1. The orchestrator has a task with a **semantic label** (e.g., `"architecture-decision"`)
2. Read all `[patterns.*]` entries from `orchestration.toml`
3. Compare the label against each pattern's `trigger` field
4. **First match wins.** If no pattern matches, fall back to default single-agent spawn.

---

## PatternResult Envelope

All patterns return a standard `PatternResult`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Pattern name from orchestration.toml |
| `type` | enum | yes | `debate`, `chain`, `vote`, `triage`, `converge`, or `converge-criteria` |
| `result` | string | yes | Final output or recommendation |
| `agentsUsed` | integer | yes | Total agents spawned (for budget tracking) |
| `transcript` | string | debate only | Compressed argument history |
| `rounds` | integer | debate only | Actual debate rounds completed |
| `solutions` | integer | vote only | Number of solutions evaluated |
| `routing` | object | triage only | `{ complexity, domains }` classification |

---

## Budget Accounting

Every pattern reports `agentsUsed`. The calling orchestrator accumulates this toward its agent budget (e.g., `/loom-auto --max-agents 50`).

- **Warn** at 80% budget consumed
- **Hard-block** pattern invocation at 100%

This prevents runaway pipelines from exhausting the agent budget silently.

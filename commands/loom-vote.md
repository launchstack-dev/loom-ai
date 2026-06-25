---
description: "Parallel independent solutions + evaluator picks best"
---

# Loom Vote

Run parallel independent agents on the same problem, then evaluate and pick the best solution.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `vote`:
- `"problem description"` (required): what to solve
- `--agents <a,b,c>`: agents that independently produce solutions (default: 3 general-purpose agents)
- `--candidates <N>`: number of parallel solutions if using default agents (default: 3)
- `--evaluator <agent>`: agent that compares solutions (default: general-purpose)
- `--isolate`: use git worktrees for full isolation (default: false)

### Protocols

Before doing anything, read:
- `~/.claude/protocols/orchestration-patterns.md` — Pattern 3: Voting
- `~/.claude/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those. Otherwise create N general-purpose agents each prompted with: "Solve this problem independently. Take your own approach — do not try to guess what other agents might do."
2. If `--isolate`, create git worktrees for each agent.
3. Check `orchestration.toml` for matching vote patterns.

#### Step 1: Parallel Solve

Spawn ALL solver agents in a SINGLE message (parallel execution). Each gets the identical problem statement + project context from CLAUDE.md.

Display progress as agents complete:
```
## Vote: {problem}

Spawned {N} independent agents...

  Agent 1: completed (approach: {one-line summary})
  Agent 2: completed (approach: {one-line summary})
  Agent 3: working...
```

#### Step 2: Evaluate

Spawn evaluator agent with all solutions side-by-side:
"Compare these {N} solutions. Score each on: correctness, security, readability, performance, maintainability. Either pick the best or produce a merged solution taking the strongest parts of each. Explain your reasoning."

#### Step 3: Present Result

```
## Evaluation

### Scores
| Agent | Correctness | Security | Readability | Performance | Overall |
|-------|------------|----------|-------------|-------------|---------|
| 1     | 8/10       | 9/10     | 7/10        | 8/10        | 8.0     |
| 2     | 9/10       | 7/10     | 9/10        | 7/10        | 8.0     |
| 3     | 7/10       | 8/10     | 8/10        | 9/10        | 8.0     |

### Winner: Agent {N}
{evaluator's reasoning}

### Selected Solution
{the winning or merged code/artifact}
```

Clean up worktrees if `--isolate` was used. Save to `.plan-execution/vote-{timestamp}.toon`.

### Error Handling

- **Agent fails:** Evaluate from remaining solutions. Minimum 2 solutions needed.
- **All agents produce identical solutions:** Note this in evaluation — high confidence in the approach.
- **No problem provided:** Print usage.

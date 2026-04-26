```toon
pageId: component-context-budget
title: Context Budget Hook
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: hooks/context-budget.ts, hooks/lib/token-estimator.ts
crossRefs[4]{pageId,relationship}:
  component-hooks-system,depends-on
  component-context-monitor,relates-to
  decision-hook-merges,relates-to
  convention-settings-json,relates-to
tags[5]: hooks, context, budget, token-estimation, agents
staleness: fresh
confidence: high
```

# Context Budget Hook

`hooks/context-budget.ts` is a PreToolUse hook on the `Agent` tool. It estimates the token size of an incoming agent prompt before the spawn occurs and blocks spawns that would exceed the configured budget cap. For test agents, it applies tier-specific budget multipliers that reduce the effective cap.

This hook was merged from two prior hooks (`context-budget` + `context-budget-test`) to avoid spawning two separate `bun` processes per Agent call. See [decision-hook-merges](decision-hook-merges.md).

## Trigger

- **Event**: `PreToolUse`
- **Matcher**: `Agent`
- **Entry check**: Exits immediately with `allow()` if `tool_name !== "Agent"` or if the prompt is empty

## Token Estimation Algorithm

Token estimation lives in `hooks/lib/token-estimator.ts`.

### String-Based Estimation

```typescript
estimateTokens(text: string): number
// Math.ceil(text.length / 4)
```

Uses the **characters / 4** heuristic — one token ≈ 4 characters. This is an approximation; actual tokenization varies by model and content type.

### File-Based Estimation

```typescript
estimateFileTokens(filePath: string): Promise<number>
// Math.ceil(fs.statSync(path).size / 4)
```

Uses the file's byte size (via `stat`) rather than reading the file content. This is faster for large files and avoids unnecessary I/O. Returns 0 if the file does not exist or is unreadable (fail-open).

### Full Prompt Breakdown

`estimateContextBudget()` computes a breakdown across all components:

| Component | Source | Method |
|-----------|--------|--------|
| `taskPrompt` | Agent prompt string | chars / 4 |
| `agentInstructions` | Agent `.md` file path extracted from prompt | file stat / 4 |
| `rollingContext` | `.plan-execution/rolling-context.md` | file stat / 4 |
| `stageContext` | `.plan-execution/stage-context/*.toon` | file stat / 4 each |
| `overhead` | Fixed | 5000 tokens (system prompt + tool defs) |

**Total** = sum of all components.

## Budget Configuration

The hook reads config from `.claude/orchestration.toml` under `[settings.contextBudget]`:

```toml
[settings.contextBudget]
contextWindow = 200000          # total context window
# agentBudgetCap = 100000       # defaults to contextWindow / 2 if omitted
```

**Defaults**: `contextWindow = 200000`, `agentBudgetCap = 100000` (50% of window).

Config parsing uses regex extraction of the `[settings.contextBudget]` TOML section. A full TOML parser is not used — only `contextWindow` and `agentBudgetCap` integer values are extracted. If the file does not exist or the section is absent, defaults apply.

## Test Agent Tier Multipliers

Certain agent names and stage markers trigger test-specific budget enforcement with reduced effective caps:

### Recognized Test Agents

| Agent Name | Tier |
|-----------|------|
| `vitest-runner` | `unit` |
| `integration-test-agent` | `integration` |
| `e2e-runner-agent` | `e2e` |
| `e2e-test-writer-agent` | `e2e` |
| `qa-review-agent` | `qa-review` |

Also triggered by prompt content matching `stage: e2e` or `stage: qa-review`.

### Tier Budget Multipliers

| Tier | Multiplier | Rationale |
|------|-----------|-----------|
| `unit` | 0.6 | Unit test agents need minimal context |
| `integration` | 0.8 | Integration tests need moderate context |
| `e2e` | 1.0 | E2E agents need full budget (fixtures, screenshots) |
| `qa-review` | 0.75 | Review agents need moderate context |

Effective cap = `Math.floor(baseCap * multiplier)`.

## Block vs Warning Behavior

| Condition | Action |
|-----------|--------|
| Estimated tokens > effective cap | Block with breakdown message |
| Estimated tokens 80–100% of cap | Allow with utilization warning |
| Estimated tokens < 80% of cap | Allow silently |

The block message includes a full breakdown by component to help diagnose which part of the context is oversized.

## Agent .md Path Resolution

The hook attempts to find the agent's instruction file by scanning the prompt for paths matching patterns like:
- `~/.claude/agents/*.md`
- `~/.loom-ai/agents/*.md`
- `agents/*.md`

Resolved paths are validated to stay within expected directories (`~/.claude/agents`, `~/.loom-ai/agents`, `agents/`). Paths outside these directories are rejected for security.

## Fail-Open Guarantee

Any estimation error allows the spawn. The hook uses the `runHook` harness from `hooks/lib/run-hook.ts`.

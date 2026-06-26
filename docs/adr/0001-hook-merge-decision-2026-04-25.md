# ADR-0001: Hook Merge Decision (2026-04-25)

| Field | Value |
|-------|-------|
| **Number** | 0001 |
| **Title** | Hook Merge Decision (2026-04-25) |
| **Status** | accepted |
| **Date** | 2026-04-25 |
| **SupersededBy** | — |

_Migrated from wiki page `decision-hook-merges` by `scripts/migrate-wiki-decisions-to-adrs.ts`._

# Hook Merge Decision (2026-04-25)

On 2026-04-25, two pairs of hooks were merged to reduce the number of `bun` processes spawned per tool call. This was a performance optimization with no change to the observable behavior of either system.

## Background

Each registered hook spawns a separate `bun` process to execute its TypeScript. The PreToolUse event on `Agent` calls and the PostToolUse event on every tool call were each launching two bun processes — one per registered hook. With every agent spawn touching both pre- and post-hooks, this created measurable overhead at scale.

## Merge 1: context-budget-test → context-budget

### Before

Two hooks registered on PreToolUse/Agent:
- `context-budget.ts` — general agent spawn budget check
- `context-budget-test.ts` — test agent tier-specific budget check

Both hooks independently read `orchestration.toml` config, walked the `stage-context/` directory, and called into `token-estimator.ts`.

### After

Single `context-budget.ts` hook handles both cases:
1. Checks `isTestAgentSpawn()` — if true, routes to test-specific tier logic with multipliers
2. Falls through to general budget check for all other agents

**Result**: One bun process instead of two per Agent tool call.

## Merge 2: checkpoint-trigger → context-monitor

### Before

Two hooks registered on PostToolUse (all tools):
- `context-monitor.ts` — estimated context usage, wrote `status.toon` update
- `checkpoint-trigger.ts` — walked the same `plan-execution/` directory structure to decide whether to inject a checkpoint warning

Both hooks independently called `fs.readdirSync` on `stage-context/` and read the same files to estimate context size.

### After

Single `context-monitor.ts` hook performs both functions:
1. Estimates context, updates `status.toon`
2. Injects checkpoint warning messages based on the same estimate

**Result**: One bun process and one filesystem walk instead of two per every PostToolUse event.

## The SubagentStop Discovery

During the merge investigation, it was confirmed that **Claude Code does not have a `SubagentStop` event**. An earlier design of `budget-tracker.ts` had planned to increment the `agentsSpawned` counter on subagent completion (a `SubagentStop`-style event) to accurately count completions rather than spawns.

Because no such event exists, `budget-tracker.ts` was redesigned to increment the counter on `PreToolUse` (spawn time). This means `agentsSpawned` counts spawns, not completions. An agent that crashes immediately still counts against the budget. This is the conservative/safe behavior — it prevents budget exhaustion from repeated failed spawns.

## Impact

| Metric | Before | After |
|--------|--------|-------|
| bun processes per Agent tool call | 4 (2 pre + 2 post) | 2 (1 pre + 1 post for budget/monitor) |
| bun processes per non-Agent tool call | 2 (2 post) | 1 (1 post for monitor) |
| Filesystem walks per tool call | 2 (monitor + trigger) | 1 |
| Behavior change | None | None |

## Files Removed

- `hooks/context-budget-test.ts` — absorbed into `hooks/context-budget.ts`
- `hooks/checkpoint-trigger.ts` — absorbed into `hooks/context-monitor.ts`

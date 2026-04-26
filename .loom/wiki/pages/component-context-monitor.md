```toon
pageId: component-context-monitor
title: Context Monitor Hook
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: hooks/context-monitor.ts
crossRefs[4]{pageId,relationship}:
  component-hooks-system,depends-on
  component-context-budget,relates-to
  decision-hook-merges,relates-to
  convention-settings-json,relates-to
tags[5]: hooks, context, monitor, checkpoint, statusline
staleness: fresh
confidence: high
```

# Context Monitor Hook

`hooks/context-monitor.ts` is a PostToolUse (all tools) and Stop hook that estimates cumulative context usage, injects checkpoint warnings into Claude's output stream, and writes `contextRemaining` to `status.toon` for statusline display.

This hook was merged from two prior hooks (`context-monitor` + `checkpoint-trigger`) to avoid duplicate filesystem walks on every tool use. See [decision-hook-merges](decision-hook-merges.md).

## Trigger

- **Event**: `PostToolUse` (matcher: empty string = all tools) + `Stop`
- **Can block**: No — only provides feedback via stdout messages

## Context Usage Estimation

The hook estimates context consumed rather than remaining, building up from known signals:

| Component | Token Estimate |
|-----------|---------------|
| System prompt + overhead | 5000 (fixed) |
| Tool interactions | `toolUseCount * 200` |
| `rolling-context.md` | file stat / 4 |
| `stage-context/*.toon` files | file stat / 4 each |
| `wave-N-summary.toon` files | file stat / 4 each |
| `state.toon` | file stat / 4 |
| `pipeline-state.toon` | file stat / 4 |

`remainingFraction = (contextWindow - estimated) / contextWindow`

If no `planExecDir` is found, only the fixed overhead and tool interaction count are used.

## Threshold Configuration

Thresholds are read from `.claude/orchestration.toml`:

```toml
[settings.contextBudget]
contextWindow = 200000
checkpointWarning = 0.35    # warn when 35% or less remains
checkpointCritical = 0.25   # critical when 25% or less remains
```

**Defaults**: `checkpointWarning = 0.35`, `checkpointCritical = 0.25`.

## Debounce Logic

To avoid spamming warnings every tool call, the hook maintains state in `.plan-execution/context-monitor-state.json`:

```json
{ "toolUseCount": 42, "lastWarnAt": 40, "lastSeverity": "warning" }
```

A warning fires when **any** of these conditions is true:

1. **Interval**: `toolUseCount - lastWarnAt >= 5` (warn at most every 5 tool uses)
2. **Severity escalation**: severity just changed from `warning` to `critical` (bypass debounce)
3. **Stop event**: the `Stop` event always fires unconditionally (no debounce)

Stop events are detected by `input.tool_name === undefined`.

## status.toon Update

When a `planExecDir` exists and `status.toon` already exists there, the hook updates two fields atomically:

```toon
contextRemaining: 42
contextCritical: true     # only present when below critical threshold
```

The update uses atomic write: write to `status.toon.tmp`, then `fs.renameSync`. The hook only updates `status.toon` if it already exists — it does not create it. This avoids creating stale status files during non-pipeline sessions.

## Warning Messages

### Warning Severity

```
[context warning] ~42% context remaining (~116000 of 200000 tokens)
When ready to checkpoint: `/clear` then `/loom auto --resume`
```

### Critical Severity

```
--- CONTEXT CHECKPOINT (CRITICAL) ---
Estimated context: 75% used (~150000 tokens of 200000)
Remaining: ~50000 tokens (25%)

Recommended action:
  1. Run `/loom pause --compact` to save all state
  2. Run `/clear` for fresh context
  3. Then: `/loom auto --resume`
---
```

## Resume Command Detection

The hook inspects the plan execution directory to suggest the most appropriate resume command:

| File Present | Suggested Command |
|-------------|------------------|
| `pipeline-state.toon` | `/loom auto --resume` |
| `convergence-state.toon` | `/loom converge --resume` |
| `state.toon` | `/loom-plan execute --resume` |
| (none) | `/loom resume` |

## Fail-Open Guarantee

All filesystem operations are wrapped in try/catch. Any error silently allows the operation. The hook never blocks — PostToolUse and Stop events are advisory-only.

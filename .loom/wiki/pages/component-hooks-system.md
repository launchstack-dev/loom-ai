```toon
pageId: component-hooks-system
title: Hooks System
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[6]: hooks/lib/run-hook.ts, hooks/deploy-guard.ts, hooks/context-budget.ts, hooks/context-monitor.ts, hooks/budget-tracker.ts, hooks/typecheck-on-write.ts
crossRefs[4]{pageId,relationship}:
  component-deploy-guard,relates-to
  component-context-budget,relates-to
  component-context-monitor,relates-to
  convention-settings-json,relates-to
tags[4]: hooks, infrastructure, claude-code, pre-tool-use
staleness: fresh
confidence: high
```

# Hooks System

The Loom hooks system intercepts Claude Code tool calls via the Claude Code hook protocol. Hooks are TypeScript files executed by `bun` before or after tool use, enabling safety guards, budget enforcement, and context monitoring without modifying Claude's core behavior.

## How Hooks Work

Claude Code fires hooks at three lifecycle events:

| Event | When | Can block? |
|-------|------|------------|
| `PreToolUse` | Before a tool call executes | Yes — exit code 2 blocks the call |
| `PostToolUse` | After a tool call completes | No — feedback only |
| `Stop` | When Claude stops responding | No — feedback only |

Each hook process receives a JSON payload on stdin describing the event:

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "git push origin main" }
}
```

The hook writes a JSON response to stdout and exits:
- **Exit 0**: allow (optionally with a message to the agent)
- **Exit 2**: block (with a `reason` field in the response)

For PostToolUse and Stop, only exit 0 is meaningful — those events cannot be blocked.

## The run-hook.ts Harness

`hooks/lib/run-hook.ts` is the shared harness used by every Loom hook. It provides:

1. **stdin consumption** — reads all of stdin into a string, handles partial reads and empty pipes
2. **JSON parsing** — parses the event payload; passes `{}` if stdin is empty
3. **Error isolation** — any error in the handler exits 0, never 2 (fail-open principle)
4. **Response formatting** — serializes block responses to stdout as `{"decision":"block","reason":"..."}`, writes message strings directly

### Fail-Open Pattern

This is the critical safety property: **errors always exit 0**. If a hook crashes, throws, or fails to read its config, the operation proceeds. This prevents a broken hook from accidentally blocking all writes, all agent spawns, or all bash commands. Errors are written to stderr with a `[loom-hook:<name>]` prefix for debugging.

### Helper Functions

```typescript
allow(message?: string): HookResult   // exit 0, optional agent feedback
block(reason: string): HookResult     // exit 2, reason shown to agent
```

## Individual Hooks

### deploy-guard.ts

- **Event**: PreToolUse — matcher: `Bash`
- **Purpose**: Blocks dangerous git push and production deploy commands
- See [component-deploy-guard](component-deploy-guard.md) for full documentation

### context-budget.ts

- **Event**: PreToolUse — matcher: `Agent`
- **Purpose**: Estimates prompt token size before spawning subagents, blocks oversized spawns
- See [component-context-budget](component-context-budget.md) for full documentation

### budget-tracker.ts

- **Event**: PreToolUse — matcher: `Agent`
- **Purpose**: Enforces the pipeline's `maxAgents` spawn budget from `pipeline-state.toon`
- Increments `agentsSpawned` counter on each spawn (counts spawns, not completions — SubagentStop does not exist in Claude Code)
- Warns at 80% utilization; blocks when `agentsSpawned >= maxAgents`
- Fail-open: if `pipeline-state.toon` does not exist or is unreadable, allows all spawns

### context-monitor.ts

- **Event**: PostToolUse (all tools) + Stop
- **Purpose**: Estimates cumulative context usage, injects checkpoint warnings
- See [component-context-monitor](component-context-monitor.md) for full documentation

### typecheck-on-write.ts

- **Event**: PostToolUse — matcher: `Write|Edit`
- **Purpose**: Runs `tsc --noEmit` after any TypeScript file write, feeds errors back as agent feedback
- Never blocks — output is advisory only
- Skipped if `LOOM_SKIP_TYPECHECK` env var is set
- Matches extensions: `.ts`, `.tsx`, `.mts`, `.cts`
- Output truncated to 2000 chars to avoid overwhelming the agent

## Hook Registration

All hooks are registered in `.claude/settings.json` under the `hooks` key. See [convention-settings-json](convention-settings-json.md) for the full registration format and current list.

## Shared Utilities

Hooks import from `hooks/lib/`:

| Module | Purpose |
|--------|---------|
| `run-hook.ts` | Harness, `allow`/`block` helpers, stdin parsing |
| `token-estimator.ts` | Token estimation for budget hooks |
| `context.ts` | `findPlanExecutionDir()`, `readPipelineState()` |

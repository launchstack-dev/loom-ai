```toon
pageId: convention-settings-json
title: settings.json Hook Registration Convention
category: convention
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: .claude/settings.json
crossRefs[3]{pageId,relationship}:
  component-hooks-system,relates-to
  component-deploy-guard,relates-to
  component-context-budget,relates-to
tags[4]: convention, hooks, settings, configuration
staleness: fresh
confidence: high
```

# settings.json Hook Registration Convention

`.claude/settings.json` is the Claude Code project settings file. In Loom, it is the authoritative registry for all hook registrations. The convention is that every project-level hook lives in `hooks/` and is executed via `bun`.

## Hook Registration Format

```json
{
  "hooks": {
    "<EventType>": [
      {
        "matcher": "<ToolPattern>",
        "hooks": [
          {
            "type": "command",
            "command": "bun \"$CLAUDE_PROJECT_DIR/hooks/<hook-name>.ts\"",
            "timeout": <seconds>
          }
        ]
      }
    ]
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `EventType` | `PreToolUse`, `PostToolUse`, or `Stop` |
| `matcher` | Pipe-separated tool names (e.g., `Write\|Edit`) or empty string for all tools |
| `type` | Always `"command"` for shell-executed hooks |
| `command` | Shell command; `$CLAUDE_PROJECT_DIR` expands to the project root |
| `timeout` | Seconds before Claude Code kills the hook process |

### The Empty Matcher

An empty `matcher: ""` matches all tool calls for that event. Used by `context-monitor` to run on every PostToolUse event regardless of which tool was called.

## Convention: bun for All Hooks

All Loom hooks are TypeScript files executed directly by `bun` (no compile step). The command pattern is:

```
bun "$CLAUDE_PROJECT_DIR/hooks/<hook-name>.ts"
```

`$CLAUDE_PROJECT_DIR` is set by Claude Code to the project root. Quoting is required to handle paths with spaces.

## Current Hook Registrations

### PreToolUse

**Matcher: `Write|Edit`**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/contract-lock.ts` | 10s | Prevents writes to locked contract files |
| `hooks/file-ownership.ts` | 10s | Enforces file ownership declared in plan |
| `hooks/wiki-write-guard.ts` | 10s | Guards wiki page writes against format violations |

**Matcher: `Bash`**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/deploy-guard.ts` | 10s | Blocks direct pushes to main/master and production deploys |

**Matcher: `Agent`**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/context-budget.ts` | 10s | Blocks agent spawns that exceed context budget cap |
| `hooks/budget-tracker.ts` | 10s | Enforces pipeline `maxAgents` spawn budget |

### PostToolUse

**Matcher: `Write|Edit`**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/typecheck-on-write.ts` | 30s | Runs `tsc --noEmit` after TypeScript file writes |

**Matcher: (all tools)**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/context-monitor.ts` | 10s | Monitors context usage, injects checkpoint warnings |

### Stop

**Matcher: (all)**

| Hook | Timeout | Purpose |
|------|---------|---------|
| `hooks/quality-gate.ts` | 10s | Final quality check when Claude stops responding |

## Timeout Guidelines

| Hook Type | Recommended Timeout |
|-----------|-------------------|
| Simple pattern matching (deploy-guard) | 10s |
| File stat operations (context-budget, context-monitor) | 10s |
| Compiler invocation (typecheck-on-write) | 30s |
| Any hook that shells out to slow tools | 30s+ |

Hooks that exceed their timeout are killed by Claude Code. All Loom hooks are fail-open, so a timeout results in an allowed operation (exit 0 behavior).

## Adding a New Hook

1. Create `hooks/<hook-name>.ts` using the `runHook` harness from `hooks/lib/run-hook.ts`
2. Add a registration entry to `.claude/settings.json` under the appropriate event and matcher
3. Set a conservative timeout (err high — hooks that time out fall through safely)
4. Ensure the hook always exits 0 on errors (the harness handles this automatically)

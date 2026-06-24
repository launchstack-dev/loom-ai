---
description: "HookFailureLog Schema"
---

# HookFailureLog Schema

Canonical TOON schema for the machine-wide hook failure log at `~/.cache/loom/hook-failures.log`. Append-only; rotated when the file exceeds 1 MB. Written by `hooks/run-hook.sh` when the runtime probe (F-15) cannot locate a usable interpreter. Consumed by `/loom-doctor` F-04 `hooks` category red check.

Paired TypeScript type: `hooks/lib/types/hook-failure-log.ts`.

## Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| timestamp | string | ISO 8601 | per entry |
| hookName | string | required | which hook failed |
| hookScriptPath | string | required | absolute path to the `.ts` file invoked (Phase 2 acceptance asserts on this) |
| pathAtProbe | string | required | full PATH at probe time |
| runtimeAttempted | enum | required | `bun \| npx-tsx \| node \| none` |

## Indexes / Cascade

Append-only log; rotated when >1 MB. No relational structure.

## TOON Reference Example

A single failure entry:

```toon
timestamp: 2026-06-15T11:45:00Z
hookName: PreToolUse
hookScriptPath: /Users/me/.claude/plugins/loom/hooks/pre-tool-use.ts
pathAtProbe: /usr/bin:/bin:/usr/sbin:/sbin
runtimeAttempted: none
```

When several entries accumulate, each is a self-contained TOON document separated by a blank line (append-only). Example sequence:

```toon
timestamp: 2026-06-15T11:45:00Z
hookName: PreToolUse
hookScriptPath: /Users/me/.claude/plugins/loom/hooks/pre-tool-use.ts
pathAtProbe: /usr/bin:/bin
runtimeAttempted: none

timestamp: 2026-06-15T11:50:00Z
hookName: PostToolUse
hookScriptPath: /Users/me/.claude/plugins/loom/hooks/post-tool-use.ts
pathAtProbe: /usr/bin:/bin
runtimeAttempted: bun
```

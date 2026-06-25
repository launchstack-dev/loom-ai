---
description: "PluginRootPointer Schema"
---

# PluginRootPointer Schema

Canonical TOON schema for the per-project pointer file at `.loom/plugin-root`. Written by `/loom-init`. Read by the F-07a plugin-root resolver (Wave 1) to translate plugin-relative paths into absolute paths at runtime. Worktree-aware — each worktree has its own pointer.

Paired TypeScript type: `hooks/lib/types/plugin-root.ts`.

## Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| pluginRoot | string | absolute path, required | exists and readable |
| pluginVersion | string | semver, required | matches installed version |
| initTimestamp | string | ISO 8601, required | RFC 3339 |

## Indexes / Cascade

Singleton per project; not applicable.

## TOON Reference Example

```toon
pluginRoot: /Users/me/.claude/plugins/loom
pluginVersion: v0.1.0
initTimestamp: 2026-06-15T10:35:00Z
```

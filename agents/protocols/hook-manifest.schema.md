---
schemaVersion: 1
name: hook-manifest
description: Loom-side snapshot of Anthropic's `hooks/hooks.json` shape, anchored at `${CLAUDE_PLUGIN_ROOT}` for plugin installs and `${CLAUDE_PROJECT_DIR}` for curl installs.
---

# Hook Manifest Schema

Mirrors the upstream Anthropic `hooks/hooks.json` shape. Declares which hook events Loom wires, with what matcher, command, and timeout.

> **Note:** The upstream schema is owned by Anthropic. This file is a Loom-side snapshot for static validation in `test/plugin-manifest.test.ts`. On upstream schema drift, only this file and `plugin-manifest.schema.md` need updates.

## Registered Events (M-07 scope)

Four hook events are registered. **`UserPromptSubmit` is explicitly reserved for F-10 (wiki-context-suggester) and MUST NOT be registered in M-07.**

| Event | Matcher | Purpose |
|---|---|---|
| `SessionStart` | `*` | `loom-migration` — idempotent legacy-entry rewrite |
| `PreToolUse` | `Write\|Edit` | `pre-write` — ownership/scope checks |
| `PostToolUse` | `Write\|Edit` | `post-write` — wiki + state updates |
| `Stop` | `*` | `stop` — session teardown |

## TOON Exemplar

```toon
HookManifest:
  hooks[4]{event,matcher,command,timeout}:
    SessionStart,*,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration,30
    PreToolUse,Write|Edit,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh pre-write,15
    PostToolUse,Write|Edit,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh post-write,15
    Stop,*,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh stop,10
```

## Canonical Anchors

Two anchor forms are valid; the chosen anchor depends on install source. **Waves 1 and 2 MUST code against these exact strings** (no other variants are accepted by the doctor):

```toon
canonicalAnchors[2]{installSource,prefix}:
  plugin,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh
  curl,${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh
```

Any settings entry whose command starts with neither prefix is flagged as `DOCTOR_BARE_ANCHOR` (legacy pre-PR-8 form) and is a candidate for auto-migration.

## Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| hooks[].event | yes | enum | One of `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`. `UserPromptSubmit` reserved for F-10. |
| hooks[].matcher | yes | string | Tool-name regex (e.g., `Write\|Edit`) or `*` for all. |
| hooks[].command | yes | string | MUST start with one of the canonical anchors above. |
| hooks[].timeout | yes | int (seconds) | Per-hook wall-clock cap. Doctor flags `DOCTOR_HOOK_TIMEOUT` on overshoot. |

## Consumer Cross-Reference

```toon
consumers[2]{wave,agent,usage}:
  wave-1,wave-1-manifest-agent,emits-hooks.json-and-derives-plugin.permissions[]
  wave-2,wave-2-doctor-agent,reads-canonical-anchors-for-DOCTOR_BARE_ANCHOR-and-DOCTOR_ORPHAN_ENTRY-checks
```

## Cross-References

- `plugin-manifest.schema.md` — `permissions[]` is derived from `hooks[].event` + matcher tool names.
- `doctor-report.schema.md` — `DOCTOR_BARE_ANCHOR`, `DOCTOR_ORPHAN_ENTRY`, `DOCTOR_HOOK_TIMEOUT`, `DOCTOR_PERMISSIONS_MISMATCH` reference this contract.
- `migration-evidence.schema.md` — `rewrites[].after` always uses one of the canonical anchors above.

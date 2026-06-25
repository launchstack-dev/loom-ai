---
schemaVersion: 1
name: migration-evidence
description: Hash-based ownership-evidence record appended to `.claude/loom-migration.log.toon` whenever the SessionStart migration hook or `loom-doctor --fix` rewrites a settings entry.
---

# Migration Evidence Schema

Records the inputs, rewrites, and outcome of a single migration attempt against a settings file. The hash-based ownership guard MUST refuse to rewrite when the on-disk `source.sha256` no longer matches the previously recorded hash for the same path — see `MIGRATION_OWNERSHIP_DIVERGED` (no automated `--force` override, by design).

## TOON Exemplar

```toon
MigrationEvidence:
  schemaVersion: 1
  recordedAt: 2026-06-17T12:34:56Z
  installSource: plugin
  source:
    path: /Users/alice/proj/.claude/settings.local.json
    sha256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
  rewrites[2]{key,before,after}:
    hooks.SessionStart[0].command,hooks/run-hook.sh loom-migration,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration
    hooks.PreToolUse[0].command,hooks/run-hook.sh pre-write,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh pre-write
  outcome: applied
  reason: "2 bare-anchor entries rewritten to ${CLAUDE_PLUGIN_ROOT} form"
```

## Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| schemaVersion | yes | int | Currently `1`. |
| recordedAt | yes | iso8601 | UTC timestamp of this migration attempt. |
| installSource | yes | enum | `plugin` \| `curl`. Determines which canonical anchor `after` values use. (Cross-plan note: HF-03 feature-coverage requirement.) |
| source.path | yes | abspath | Absolute path of the settings file being inspected. |
| source.sha256 | yes | hex | SHA-256 of the settings file at evidence-record time. Used by the ownership guard on subsequent runs. |
| rewrites[].key | yes | string | Dotted path into the settings JSON identifying the modified entry. |
| rewrites[].before | yes | string | Original value (pre-rewrite). |
| rewrites[].after | yes | string | New value; MUST use a canonical anchor from `hook-manifest.schema.md`. |
| outcome | yes | enum | `applied` \| `refused-ownership-guard` \| `not-needed` \| `failed`. |
| reason | yes | string | Human-readable explanation; surfaces in doctor output and SessionStart stderr. |

## Outcome Semantics

| Outcome | When | Follow-up |
|---|---|---|
| `applied` | Rewrites succeeded; `source.sha256` refreshed in the same write. | None. |
| `not-needed` | No bare-anchor or orphan entries detected; settings already canonical. | None. |
| `refused-ownership-guard` | On-disk hash differs from recorded evidence. | Surface `MIGRATION_OWNERSHIP_DIVERGED`; require manual remediation. |
| `failed` | IO error or JSON parse failure. | Surface `MIGRATION_SETTINGS_CORRUPT`; exit 2. |

## Consumer Cross-Reference

```toon
consumers[2]{wave,agent,role}:
  wave-2,wave-2-doctor-agent,writes-evidence-from-hooks/loom-migration.ts-and-scripts/loom-doctor.ts--fix
  wave-2,wave-2-doctor-agent-migration-runner,reads-evidence-for-ownership-guard-in-scripts/lib/migration-runner.ts
```

## Cross-References

- `doctor-report.schema.md` — `DOCTOR_VERSION_SKEW` reads `recordedAt`; `MIGRATION_OWNERSHIP_DIVERGED` surfaces `outcome: refused-ownership-guard`.
- `hook-manifest.schema.md` — canonical anchors define valid `rewrites[].after` values.
- `migration-runner.schema.md` — type-level contract for the function that writes these records.

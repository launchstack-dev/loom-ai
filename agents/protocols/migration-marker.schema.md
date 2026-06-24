---
description: "MigrationMarker Schema"
---

# MigrationMarker Schema

Canonical TOON schema for the per-project file at `.loom/migration-in-progress`. Written by F-05 `/loom-migrate-to-plugin` (and the F-12 `/loom-update` flow) BEFORE any mutation, so a crash leaves a resumable marker. Cleared on success.

Paired TypeScript type: `hooks/lib/types/migration-marker.ts`.

The four migration / update steps (F-12 `/loom-update` flow): (1) `download` tarball, (2) `verify` sha256, (3) `swap` files, (4) `clear-marker`. `--resume` reads `stepCompleted` and continues from the next step.

## Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| startedAt | string | ISO 8601, required | RFC 3339 |
| fromChannel | enum | required | `curl \| plugin` |
| toChannel | enum | required | `curl \| plugin` |
| stepCompleted | enum\|null | required | one of: `download \| verify \| swap \| clear-marker \| null`. `--resume` skips completed steps and continues from the next. |

## Indexes / Cascade

Singleton per project; not applicable.

## State Machine

```
absent ──/loom-migrate-to-plugin start──→ present ──success──→ absent
                                              │
                                              └──interrupt──→ present (await /loom-migrate-to-plugin --resume)
```

Invalid transition: clearing the marker without successful migration (`MARKER_REQUIRES_RESUME`).

## TOON Reference Example

Just-started, no steps completed yet:

```toon
startedAt: 2026-06-15T10:30:00Z
fromChannel: curl
toChannel: plugin
stepCompleted: null
```

Mid-flight after tarball verified:

```toon
startedAt: 2026-06-15T10:30:00Z
fromChannel: curl
toChannel: plugin
stepCompleted: verify
```

Final terminal step before file deletion:

```toon
startedAt: 2026-06-15T10:30:00Z
fromChannel: curl
toChannel: plugin
stepCompleted: clear-marker
```

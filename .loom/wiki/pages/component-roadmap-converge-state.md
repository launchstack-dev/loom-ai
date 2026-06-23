```toon
pageId: component-roadmap-converge-state
title: Roadmap Converge State
category: component
domain: code
createdAt: 2026-06-17T00:00:00Z
updatedAt: 2026-06-17T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Durable per-roadmap state (RoadmapConvergeState) plus lock-file, slug derivation, content-hash, and F-13 migration runtime registration.
estimatedTokens: 1000
bodySections[6]: Summary, Entities, On-Disk Layout, Concurrency Lock, Multi-Roadmap Slugging, Migration Runtime
subtype:
sourceRefs[7]: planning/plans/PLAN-roadmap-converge-harness.md, agents/protocols/roadmap-converge-state.schema.toon, agents/protocols/roadmap-readiness.schema.toon, agents/protocols/roadmap-archetypes.toon, scripts/roadmap-converge/state-io.ts, scripts/roadmap-converge/lock.ts, scripts/migrators/roadmap-converge-state/index.ts
crossRefs[4]{pageId,relationship}:
  component-roadmap-converge-driver,relates-to
  concept-roadmap-convergence,implements
  convention-toon-format,follows
  convention-agent-result,relates-to
tags[8]: state, schema, lock, slug, migration, F-13, F-15, roadmap
staleness: fresh
confidence: high
```

# Roadmap Converge State

## Summary

The durable side of F-15. Owns the per-roadmap state file, the readiness schema (dimensions + rubric refs), the archetype enumeration, the lock-file concurrency guard, the multi-roadmap slug derivation, and the F-13 migration registration for `RoadmapConvergeState`.

## Entities

| Entity | Stored | Purpose |
|--------|--------|---------|
| `RoadmapReadinessSchema` | `agents/protocols/roadmap-readiness.schema.toon` | Per-archetype dimensional taxonomy with rubricRef paths |
| `RoadmapDimension` | embedded in state | Runtime status of one dimension (`green`/`yellow`/`red` + evidence/blockers/anchors/delta) |
| `RoadmapRubric` | `agents/protocols/roadmap-rubrics/{name}.md` | Pedagogical exemplars (`## Green` / `## Yellow` / `## Red`) |
| `RoadmapConvergeState` | `.roadmap-converge/{slug}/state.toon` | Durable per-roadmap state; F-13 migration-registered |
| `RoadmapConvergeDigest` | not stored | Rendered view built by `/loom-roadmap status` from state alone |

### RoadmapConvergeState fields (highlights)

`schemaVersion` (= 1), `roadmapPath`, `roadmapSlug`, `archetype`, `round` (≥ 0; round=0 is init), `passLimit` (default 3, max 5), `dimensions[]`, `open_questions[]` (≤ 5 per dimension per pass; aggregate ceiling = `5 × |dimensions|`), `archivedDimensions[]` (retire-dimension audit), `suppressedFindings[]` (overflow beyond 5-cap with `{id,dimension,severity,text,suppressed_at}`), `roadmap_diff_summary`, `paused_at`, `last_reviewer`, `next_action_hint`, `content_hash` (sha256 of ROADMAP.md), `sign_off_state` (`not-eligible` | `eligible` | `signed-off`), `sign_off_at`, `sign_off_diff_hash`.

`OpenQuestion`: `id` (format `Q-NN`, unique within state), `dimension`, `text` (≤ 500 chars), `asked_at`, `resolved_at`, `resolution`.

### Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| pk_state | roadmapSlug | One state per roadmap |
| idx_open_questions_unresolved | resolved_at IS NULL | Fast resume |
| uq_question_id | open_questions[].id | No id collisions |

## On-Disk Layout

```
.roadmap-converge/
  {slug}/
    state.toon              # RoadmapConvergeState (atomic write via .tmp + rename)
    lock                    # {pid, started_at} written at pass start, removed on completion
    last-error.toon         # structured error envelope for resumability
    passes/
      {round}/
        reviews.toon        # per-dimension reviewer findings (audit trail)
```

All writes are atomic per the project convention: write to `{path}.tmp`, then `fs.renameSync`.

## Concurrency Lock

`scripts/roadmap-converge/lock.ts` writes `{pid, started_at}` at pass start using `O_EXCL`-equivalent semantics so the second invocation always observes the lock. The lock is removed on pass completion.

| Condition | Behavior |
|-----------|----------|
| Lock < 10 min old, no `--force` | Abort with `LOCK_CONFLICT` |
| Lock < 10 min old, `--force` | Proceed; overwrite lock |
| Lock > 10 min old | Auto-clear with stderr advisory; proceed |
| No lock | Acquire and proceed |

The 10-minute stale window is currently **hardcoded** in `scripts/roadmap-converge/lock.ts` as `STALE_AFTER_MS = 10 * 60 * 1000`. Making this configurable via `[roadmap.converge].lockStaleSeconds` is planned but not yet wired through — neither `lock.ts` nor `driver.ts` reads the config value today.

## Multi-Roadmap Slugging

`scripts/roadmap-converge/slug.ts` derives a path-safe slug from a roadmap filename:

- `planning/ROADMAP.md` → `ROADMAP`
- `planning/feature/sub-roadmap.md` → `sub-roadmap`
- `planning/Some File.md` → `Some-File`

Algorithm: strip extension, take basename, replace non-alphanumeric with `-`.

**Slug collisions** (two roadmap paths deriving the same slug) abort the second invocation with stderr `SLUG_COLLISION`. The user resolves by renaming the second roadmap. An explicit `--slug` flag is deliberately deferred to a future v2.

## Migration Runtime

State is registered with the F-13 chained walker pattern.

| Artifact | Purpose |
|----------|---------|
| `agents/protocols/schema-versions.toon` | Includes a `roadmapConvergeState` entry pointing at version 1 |
| `scripts/migrators/roadmap-converge-state/detect.ts` | `detectRoadmapConvergeStateVersion(content)` → `{detected, current, outdated}`; throws `MigrationDowngradeError` on future versions |
| `scripts/migrators/roadmap-converge-state/index.ts` | Exports a frozen `MIGRATIONS` map and a pure `migrateToLatest(input, fromVersion, opts, targetVersion?)` walker |

`SCHEMA_VERSION_DRIFT` (exit 2) fires when state.toon is newer than the runtime supports and no downgrade path exists. The v1→v2 migration will land in a separate plan when a v2 is defined.

# Planning Artifact Path Resolution

Loom commands resolve planning artifacts in a deterministic order, preferring the modern `planning/` layout but falling back to legacy root paths so projects that haven't run `/loom-upgrade` continue to work.

This protocol is the single source of truth for the resolution order. Commands that read or write `ROADMAP.md` or `PLAN*.md` MUST follow it.

## Resolution order — reads

When a command needs to read **ROADMAP.md** (or a named variant), search in this order:

1. `planning/ROADMAP.md` (or `planning/{name}.md`) — modern layout, preferred
2. `ROADMAP.md` at repo root (or `{name}.md`) — legacy layout, backward-compatible
3. If neither exists, fail with: `ROADMAP not found. Run /loom-roadmap init to create one.`

**Named-variant rule:** commands that accept `--name <slug>` (e.g. `/loom-roadmap:mutate`) target `ROADMAP-{slug}.md` — i.e. `{name}` above is `ROADMAP-{slug}`. Search `planning/ROADMAP-{slug}.md`, then `ROADMAP-{slug}.md` at root. `/loom-roadmap init` only writes the default `planning/ROADMAP.md`; named variants are created by renaming or by authoring the file directly.

When a command needs to read **PLAN.md** (or `PLAN-{name}.md`), search in this order:

1. `planning/plans/PLAN.md` (or `planning/plans/PLAN-{name}.md`) — active, modern
2. `planning/archive/PLAN.md` (or named variant) — completed/superseded, modern
3. `PLAN.md` at repo root (or `PLAN-{name}.md`) — legacy, backward-compatible
4. If none exist, fail with: `PLAN not found. Run /loom-plan create to generate one.`

When a user passes `--plan <path>` or `--roadmap <path>`, treat the explicit path as canonical and skip the search.

## Resolution order — writes

When a command **creates** a new planning artifact, write to the modern location:

| Command | Default write path |
|---------|-------------------|
| `/loom-roadmap init` | `planning/ROADMAP.md` |
| `/loom-plan create` | `planning/plans/PLAN-{name}.md` (or `planning/plans/PLAN.md`) |
| `/loom-roadmap snapshot` | `planning/history/snapshots/{date}-{name}.md` |
| `/loom-roadmap milestone` | updates `planning/history/roadmap.toon` |
| `/loom-plan execute` (wave summaries) | `.plan-execution/` AND copies to `planning/history/executions/` |
| `/loom-plan review` | `planning/history/reviews/{date}-review.toon` |

Create parent directories if they do not exist (`mkdir -p planning/plans`, etc.).

If the command **updates** an existing artifact (refine, mutate, add, insert, remove, reorder, review-integrate), update it in place at whichever location the resolution found it. Do not silently move legacy artifacts — that's the job of `/loom-upgrade --project` Rule 14.

## Stub root files

When the modern layout is in use, the repository may contain a one-line stub at the root pointing to `planning/ROADMAP.md`. Commands MUST treat the stub as a pointer (not the source of truth) and follow it to the canonical file. Detection: a root `ROADMAP.md` is a stub if it is fewer than 10 lines AND contains the string `planning/ROADMAP.md`.

## Backward compatibility

Projects that have not run `/loom-upgrade --project` (Rule 14) keep their planning artifacts at the repo root. Commands MUST work transparently in either layout. The only command that changes the layout is `/loom-upgrade --project`, which performs the relocation idempotently.

## Cross-references

- `commands/loom-upgrade.md` — Rule 14 defines the migration from legacy root to modern `planning/` layout.
- `protocols/schema-upgrade.md` — Rule 14 detection and migration logic.
- `commands/loom-plan/create.md` — uses this protocol for default write path.
- `commands/loom-roadmap/init.md` — uses this protocol for default write path.

# planning/

This directory holds Loom's own planning artifacts. It's the dogfood: Loom plans itself using Loom.

If you're evaluating Loom, this is also the most concrete documentation you have. The plans here were drafted with `/loom-roadmap init`, refined with `/loom-roadmap review`, executed with `/loom-plan execute`, and reviewed with `/loom-code review`. The history under `history/` is the audit trail.

## Layout

| Path | What |
|------|------|
| `ROADMAP.md` | Active feature roadmap. Features (F-XX), milestones (M-XX), constraints (C-XX). |
| `plans/` | In-flight execution plans. Created by `/loom-plan create`. Read by `/loom-plan execute`. |
| `archive/` | Plans for completed or superseded work. Kept as worked examples. |
| `history/` | Operational records — changelog, reviews, snapshots, execution logs, decisions, abandoned plans. See `history/README.md`. |

## Where new plans land

`/loom-plan create` writes to `planning/plans/PLAN-{name}.md`. The execute, review, test, and status subcommands resolve plans in this order:

1. `planning/plans/PLAN.md` (or named variant)
2. `planning/archive/PLAN.md`
3. `PLAN.md` at repo root (legacy, backward-compatible)

For your own project, run `/loom-upgrade --project` once to migrate any root-level plan artifacts into this layout. The upgrade is idempotent and leaves a one-line stub at the root for GitHub home-page discoverability.

## Why this layout exists

Loom's planning surface area is wide — roadmaps, multi-plan portfolios, execution state, reviews, abandoned explorations. Keeping all of that at the repo root buries the actual codebase and collides with users' own `PLAN.md` files. Scoping under `planning/` namespaces our artifacts, keeps the root clean, and gives users a single conventional directory to look at when they want to see how Loom uses Loom.

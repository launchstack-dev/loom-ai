# planning/history/

Operational records from Loom's own development. Worked examples for evaluating Loom.

These files are not specs or designs — they are the artifacts produced by Loom commands during real runs on this repo. Read them when you want to see what Loom actually does in practice: how reviews score plans, how the executor records progress, how plans get archived when work concludes, how decisions get logged when an exploration is abandoned.

## Layout

| Path | What lives here |
|------|-----------------|
| `roadmap.toon` | Milestone tracker. Written by `/loom-roadmap milestone` and read by `/loom-roadmap status`. |
| `changelog.md` | Append-only changelog of major workflow events — wave completions, review pass results, fixes applied. |
| `plans/` | Older plans, deep archive. Distinct from `planning/archive/` which holds recently completed plans. |
| `reviews/` | Output from `/loom-code review` and `/loom-roadmap review` runs. Timestamped. |
| `executions/` | Per-execution snapshots from `/loom-plan execute`. |
| `snapshots/` | Manual plan-state snapshots from `/loom-roadmap snapshot`. |
| `explorations/` | Multi-persona brainstorm sessions from `/loom-roadmap explore`. |
| `abandoned/` | Plans and pipeline states that were paused or abandoned. Retained for context. |
| `analysis/` | Ad-hoc analysis outputs (codebase audits, dependency graphs, etc.). |
| `test-checklists/` | Manual test checklists captured during E2E milestone convergence. |

## What's gitignored vs tracked

Files here are tracked in Git intentionally. The runtime state directory `.plan-execution/` is gitignored — it churns rapidly and would dominate the diff. `planning/history/` is the durable subset: only artifacts that survive past a single execution.

If you're vendoring Loom into a private project and don't want a public dogfood trail of your own, add `planning/history/` to your `.gitignore`. The Loom commands write here regardless; gitignoring just keeps the records local.

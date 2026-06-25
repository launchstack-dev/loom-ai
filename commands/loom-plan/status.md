---
description: "Show plan progress from execution state; --reconcile detects and fixes stale plan frontmatter."
---

## Subcommand: status

Show plan progress by reading execution state. Optionally reconciles stale frontmatter against the execution record.

### Flags

- `--reconcile` — detect plans whose frontmatter says `draft|reviewed|approved|in-progress` but whose execution record shows all waves succeeded, and fix them in place. Also propagates completion to roadmap milestones referenced via `planRef:`. Without this flag, status is read-only.

### Instructions

1. Resolve plan per `protocols/planning-paths.md` (planning/plans/PLAN.md → planning/archive/PLAN.md → PLAN.md at root) -- if none found, report "No plan found."
2. Check for `.plan-execution/state.toon` -- if missing, report "Plan exists but execution has not started."
3. If state exists, display:
   - Current wave and total waves
   - Per-wave status (pending / in_progress / complete / failed)
   - Agent counts (running / done / failed)
   - Last activity timestamp
   - Scope coverage summary (if `scope-coverage.toon` exists)
4. If `planning/history/reviews/` has review files, show last review date and finding count.
5. If `.plan-execution/test-report.md` exists, show test summary.

### Drift detection (always runs, read-only)

After step 3, compare plan frontmatter `status:` against the execution record:

- Scan `planning/history/executions/wave-*-summary*.toon` (also accept `wave-N-summary-{planSlug}.toon` for multi-plan repos).
- A plan is **execution-complete** if: a wave summary exists for every wave index from `0` (or `1`) through `totalWaves`, each with `status: success`, AND every milestone gate file (`wave-N-gate.toon`) referenced by the plan shows a pass.
- If execution-complete but frontmatter `status:` is not `completed`, flag as **DRIFT** and surface it in the status output:

```
⚠ Drift detected: plan frontmatter says `status: {reviewed|approved|...}` but all {N} waves succeeded.
  Latest wave summary: planning/history/executions/wave-{N}-summary-{slug}.toon ({completedAt})
  Run `/loom-plan status --reconcile` to update the frontmatter.
```

If `--reconcile` was passed, proceed to step 6.

### Step 6: Reconcile (only when `--reconcile` is passed)

For every plan in `planning/plans/PLAN-*.md` (not just the active one — sweep the whole directory so historical drift gets caught):

1. Read frontmatter; if `status: completed` already, skip.
2. Run the drift check above against `planning/history/executions/`.
3. If execution-complete:
   - Set `status: completed`
   - Set `completedAt:` to the `completedAt` timestamp of the **last** wave summary (the wave with the highest index whose `status: success`). Do not use the current wall-clock time — the schema's `Date.now()` ban applies; we want the real completion moment, not the reconcile moment.
   - Atomic write: `{planPath}.tmp` → `fs.renameSync` → `{planPath}`.
4. If the plan's `roadmapRef:` points to an existing roadmap file, find any milestone with a matching `planRef:` and set its `status: completed` + `completedAt:` using the same atomic-write pattern. If multiple roadmap milestones share the plan, update all of them.
5. After the sweep, print:

```
## Reconcile Complete

Plans scanned: {N}
Plans updated: {K}
Roadmap milestones updated: {M}

Updated:
  - planning/plans/PLAN-foo.md (status: reviewed → completed, completedAt: 2026-06-13T19:05:00Z)
  - planning/plans/PLAN-bar.md (status: approved → completed, completedAt: 2026-06-13T00:27:00Z)
```

If zero updates: `No drift detected. {N} plans scanned, all frontmatter accurate.`

### Failure modes

- **No wave summaries found:** plan has not been executed; do not treat as drift.
- **Partial wave summaries (some success, some missing/failed):** report as "execution incomplete," do not reconcile.
- **Schema mismatch (plan uses `complete` instead of canonical `completed`):** treat `complete` as drift and rewrite to `completed`.
- **Multiple plans share a wave-summary index without per-plan suffix:** require the `-{planSlug}` suffix to disambiguate; if ambiguous, skip the plan and log a warning.

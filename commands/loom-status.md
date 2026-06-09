---
description: "Project status overview"
---

# Loom Status

Display a high-level project status overview. Delegates to `/loom-roadmap status` when a roadmap exists, and falls back to basic project info otherwise.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `status`:
- No args: show project status overview
- `--verbose`: show detailed status including all state files

### Instructions

#### Step 1: Check for Roadmap

If `ROADMAP.md` exists:
- Delegate to `/loom-roadmap status` logic. This shows the full unified status view (roadmap + plan + milestones + progress).
- After delegation, render the Wiki Health block (Step 3 below) if `.loom/wiki/` exists.
- Stop.

#### Step 2: Basic Project Info (no roadmap)

If no `ROADMAP.md` exists, display a basic project overview:

```
## Project Status

### Loom Artifacts
  CLAUDE.md:           {found (N lines) | not found}
  CONTEXT.md:          {found (N lines) | not found}
  ROADMAP.md:          not found
  PLAN.md:             {found | not found}
  orchestration.toml:  {found | not found}
  Wiki (.loom/wiki/):  {found (N pages) | not found}

### Execution State
  Pipeline state:      {not found | stage: {currentStage}{ STALE: {N}d since last touch} if stale}
  Execution state:     {not found | status: {status}, wave: {currentWave}}
  Convergence state:   {not found | status: {status}, iter: {iteration}}
  Paused session:      {not found | paused at {phase} on {pausedAt}}

  {if pipeline state is stale (mtime > 7 days, currentStage not in {complete,escalated}):}
    → Stale pipeline-state.toon ({N} days, stage: {currentStage}). Run:
        mv .plan-execution/pipeline-state.toon .plan-history/abandoned/
      (or wait — quality-gate hook auto-skips after 7 days of inactivity.)

### Recent Activity
  Last command:        {from status.toon or "unknown"}
  Last updated:        {from status.toon or "unknown"}

### Quick Tasks
  Total:               {count of .toon files in .plan-history/quick-tasks/}
  Recent:              {last 3 task descriptions with dates}

### Model Profile
  Active:              {profile name or "inherit"}

### Suggested Next Step
  {Run the /loom-next logic to determine suggestion, display one-line version}
```

Then render the Wiki Health block (Step 3) if `.loom/wiki/` exists.

#### Step 3: Wiki Health (when `.loom/wiki/` exists)

When `.loom/wiki/` exists at the project root, render an additional block:

```
### Wiki Health
  Pages:               {N} ({c} component, {f} flow, {ct} contract, {d} decision, ...)
  Coverage:            {pct1}% of significant files have component pages    [{color1}]
                       {pct2}% of public routes have contract pages         [{color2}]
                       Flows are opt-in [opt-in — no target]
  Stale pages:         {M}
  Days since lint:     {dl} (last run: {lint-timestamp})
  Days since ingest:   {di} (last run: {ingest-timestamp})

  {if M > 0}  → Run /loom-wiki refresh to fix {M} stale pages.
  {if dl > 14}  → Run /loom-wiki lint to surface drift.
```

**Coverage thresholds** (color-coded prefix):
- `[green]` if pct >= 80%
- `[amber]` if 60% <= pct < 80%
- `[red]` if pct < 60%

**Coverage computation rules:**
- *Component coverage* = (count of `component-*` pages) / (count of significant files in repo per the heuristics in `wiki-conventions.md` § Significance Threshold).
- *Contract coverage* = (count of `contract-*` pages) / (count of public route handlers detected in the codebase).
- *Flows* are opt-in (per `wiki-conventions.md` § Flow significance) — they have no auto-coverage metric and display `[opt-in — no target]`.
- Coverage % is **computed lazily** only when `/loom-status` is invoked. If the computation runs > 5 seconds (large monorepos), display `Coverage: (computing — run again in a moment)` and skip to the next field.

**Source files:**
- `pageCount` and category breakdown: parse `.loom/wiki/index.toon` `pages[]` typed array and group by `category`.
- `stale` count: same source, filter `staleness == "stale"`.
- `days since lint`: parse `.loom/wiki/log.toon` for the last entry where `operation == "lint"`.
- `days since ingest`: parse `.loom/wiki/log.toon` for the last entry where `operation == "ingest"` (or fall back to `lastUpdated` in index.toon).

### Error Handling

- **File read errors:** Skip any file that cannot be read. Display "error reading" in its status slot.
- **No state at all:** If no Loom artifacts exist whatsoever, display: "No Loom artifacts found. Get started with `/loom-init` (brownfield) or `/loom-roadmap init --from 'description'` (greenfield)."
- **Wiki Health computation timeout:** if coverage % can't be computed in 5s, render the static fields (page count, stale count, days-since-lint/ingest) and substitute `(computing — run again in a moment)` for the coverage lines. The remaining wiki block is always rendered.

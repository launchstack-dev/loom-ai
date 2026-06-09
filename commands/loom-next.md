---
description: "State-aware next step suggestion"
---

# Loom Next

State-aware next step suggestion. Reads project state to determine the logical next action in the Loom workflow.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `next`:
- No args: detect and suggest next step
- `--auto`: execute the suggested step without confirmation
- `--why`: show reasoning for the suggestion

### Instructions

#### Step 1: Read Project State

Scan for all relevant project artifacts:

1. **Loom artifacts:**
   - `CLAUDE.md` -- exists? (boolean)
   - `ROADMAP.md` -- exists? Read frontmatter for `status` field (draft, approved, etc.)
   - `PLAN.md` -- exists? Read frontmatter for review status.
   - `.plan-execution/state.toon` -- exists? Read `status` (in-progress, completed, failed, paused).
   - `.plan-execution/pipeline-state.toon` -- exists? Read `currentStage`.
   - `.plan-execution/continue-here.toon` -- exists? (paused session)
   - `.plan-execution/review-report.md` -- exists? Read finding counts.
   - `planning/history/reviews/` -- any review files? Check dates.
   - `.loom/wiki/` -- exists?

2. **Test state:**
   - Check for test files in common locations (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`)
   - Check if test runner is configured (`package.json` scripts, vitest.config, jest.config, etc.)

3. **Git state:**
   - Current branch name
   - Uncommitted changes count
   - Whether on main/master or a feature branch

#### Step 2: Evaluate State and Determine Next Step

Walk through the Loom workflow stages in order. The first incomplete stage is the suggestion:

| Condition | Suggestion | Reasoning |
|-----------|------------|-----------|
| `continue-here.toon` exists | `/loom-resume` | "You have a paused session. Resume where you left off." |
| `pipeline-state.toon` exists with `currentStage != complete` | `/loom-auto --resume` | "Autonomous pipeline is in progress at stage {currentStage}." |
| `state.toon` exists with `status == in-progress` | `/loom-plan execute --resume` | "Plan execution is in progress at wave {currentWave}." |
| No `CLAUDE.md` and no `ROADMAP.md` | `/loom-init` | "No Loom artifacts found. Start with project onboarding." |
| `CLAUDE.md` exists but no `ROADMAP.md` | `/loom-roadmap init --brownfield` | "Project is onboarded but has no roadmap. Create one." |
| `ROADMAP.md` exists, no reviews in `planning/history/reviews/*roadmap*` | `/loom-roadmap review` | "Roadmap exists but hasn't been reviewed." |
| `ROADMAP.md` exists, reviewed, but `status != approved` | `/loom-roadmap approve` | "Roadmap has been reviewed. Approve it to unlock plan generation." |
| `ROADMAP.md` approved, no `PLAN.md` | `/loom-plan create` | "Roadmap is approved. Generate a plan." |
| `PLAN.md` exists, no reviews in `planning/history/reviews/*review*` (non-roadmap) | `/loom-plan review` | "Plan exists but hasn't been reviewed." |
| `PLAN.md` exists, reviewed, no execution state | `/loom-plan execute` | "Plan is reviewed and ready for execution." |
| Execution completed (`state.toon` with `status == completed`), no test results | `/loom-plan test --run` | "Execution complete. Run tests." |
| Tests exist/ran, no `review-report.md` | `/loom-code review` | "Tests done. Run code review." |
| `review-report.md` exists with critical findings | `/loom-code fix` | "Review found {N} critical findings. Apply fixes." |
| Review clean (no critical findings), tests pass | `/loom-roadmap status` | "Everything looks good. Check overall status." |
| Uncommitted changes on feature branch | `/loom-git commit` | "You have uncommitted changes. Commit them." |

If multiple conditions match, use the highest-priority one (earlier in the table).

#### Step 3: Present Suggestion

Display the suggestion with context:

```
## Next Step

Suggested: {command}
Reason:    {reasoning}

{if --why was set, show the full state analysis:}
State analysis:
  CLAUDE.md:      {exists/missing}
  ROADMAP.md:     {exists/missing/approved/draft}
  PLAN.md:        {exists/missing/reviewed/unreviewed}
  Execution:      {not-started/in-progress/completed/failed}
  Tests:          {not-run/passing/failing}
  Review:         {not-run/clean/has-findings}
  Git:            {branch}, {N} uncommitted changes

Run it? (yes / pick another / show all options)
```

- If user confirms ("yes", "y", or presses enter): execute the suggested command.
- If `--auto` was set: execute immediately without asking.
- If user says "show all options": display the full workflow stages with current status markers, let them pick.
- If user picks another: ask them to specify.

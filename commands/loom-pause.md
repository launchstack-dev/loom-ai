---
description: "Snapshot workflow state for session handoff"
---

# Loom Pause

Snapshot the current workflow state for session handoff. Allows the user to close the current session and resume later with full context restoration.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `pause`:
- No args: snapshot current state
- `--no-commit`: skip the WIP git commit
- `--compact`: optimized for context pressure -- writes stage summaries, updates rolling-context.md, writes continue-here.toon, skips git commit. Designed for use before `/clear` when context is running low.
- `--message "text"`: add a human-readable note to the snapshot

### Instructions

**If `--compact` is set:** jump to the Compact Pause section below.

#### Step 1: Detect Running Workflow

Scan for active workflow state by checking these files in order:

1. `.plan-execution/pipeline-state.toon` -- `/loom-auto` pipeline state
2. `.plan-execution/state.toon` -- `/loom-plan execute` execution state
3. `.plan-execution/convergence-state.toon` -- `/loom-converge` convergence state
4. `.plan-execution/ephemeral/status.toon` -- general status (any command)

For each file found, read its contents and extract:
- `command` or `mode` -- which command is running
- `currentStage` or `status` -- where in the workflow we are
- `phase` or `currentWave` -- specific step within the stage

If NO state files are found:
- Print: "No active workflow detected. Nothing to pause."
- Stop.

#### Step 2: Gather Context Snapshot

Collect all relevant state into a snapshot:

1. **Identify the running command.** Use the highest-priority state file found:
   - `pipeline-state.toon` -> command is `auto`
   - `state.toon` (without pipeline-state) -> command is `execute-plan`
   - `convergence-state.toon` (without state.toon) -> command is `converge`
   - `status.toon` only -> read the `command` field

2. **Read rolling context.** If `.plan-execution/rolling-context.md` exists, read and compress to under 2000 tokens. Preserve: key decisions, blockers, recent pivots, agent outcomes.

3. **Identify completed work.** Read wave summaries from `.plan-execution/wave-*-summary.toon`. Build a list of completed waves with file counts and status.

4. **Identify pending decisions.** Scan the most recent agent results and state for any unanswered prompts, approval gates, or human-input-required markers.

5. **Record what was about to happen next.** Based on the current stage/phase, determine the next action the workflow would take.

6. **Capture git state.** Run `git rev-parse HEAD` to get the current commit SHA.

#### Step 3: Write continue-here.toon

Write `.plan-execution/continue-here.toon` atomically (write to `.tmp`, then rename):

```toon
pausedAt: {ISO-8601 timestamp}
command: {running command, e.g. execute-plan, auto, converge}
phase: {current step, e.g. wave-2-wiring, plan-review, converging-iter-3}
planPath: {PLAN.md path or null}
roadmapPath: {ROADMAP.md path or null}
resumeStep: {exact step to resume from, e.g. "Step 3: Execution", "Step 5: Convergence Loop iter 4"}
pendingDecisions[N]: {any unanswered prompts or approval gates}
completedWork[N]{wave,status,filesChanged}:
  {wave-number},{complete|partial},{file-count}
nextAction: {what was about to happen, e.g. "Run wiring-agent for wave 2", "Execute plan review"}
context: {compressed rolling-context.md snapshot, max 2000 tokens}
gitRef: {current HEAD sha}
message: {user's --message text, or null}
stateFiles[N]: {list of all .plan-execution/ state files that exist}
```

#### Step 4: Git Commit (unless --no-commit)

If `--no-commit` was NOT set:

1. Stage all files in `.plan-execution/` that are not gitignored.
2. Create a WIP commit:
   ```
   git add .plan-execution/continue-here.toon
   git commit -m "WIP: paused at {phase}"
   ```
   If the commit fails (nothing to commit, or hooks reject), warn but continue.

#### Step 5: Display Resume Instructions

Print:

```
## Session Paused

Command:    {command}
Phase:      {phase}
Next action: {nextAction}
Git ref:    {gitRef} (short SHA)
Snapshot:   .plan-execution/continue-here.toon

{if --message was set:}
Note: {message}

To resume in a new session:
  /loom-resume

To resume a specific workflow directly:
  /loom-auto --resume      (if command was auto)
  /loom-plan execute --resume   (if command was execute-plan)
  /loom-converge --resume  (if command was converge)
```

#### Compact Pause (--compact)

Optimized for context pressure situations. Skips git commit, skips detailed context gathering -- focuses on getting state to disk fast so the user can `/clear` and resume.

**Step C1: Detect running workflow.** Same detection logic as Step 1 above. If no state files found, print "No active workflow detected. Nothing to pause." and stop.

**Step C2: Write stage summaries for all completed work.**

1. Read `.plan-execution/state.toon` to identify completed waves.
2. For each completed wave that does NOT already have a `stage-context/*.toon` file, generate one from the wave summary:
   - Read `wave-N-summary.toon`
   - Write `stage-context/execute.toon` (or appropriate stage name) with fields: `stage`, `wave`, `summary`, `filesChanged`, `keyDecisions`, `nextStageHints`
   - Use atomic write (`.tmp` then rename)
3. If convergence state exists, ensure `stage-context/converge.toon` is written from `convergence-state.toon`.

**Step C3: Update rolling-context.md.**

Regenerate `.plan-execution/rolling-context.md` from all stage-context files using tiered compression:
- Most recent stage: HOT (full summary with all fields)
- Previous 2-3 stages: WARM (key decisions + interface changes)
- Older stages: COLD (one-line summary)
- Target: under 10k tokens total

Use atomic write.

**Step C4: Write continue-here.toon.**

Same format as Step 3 above, but with `compactMode: true` added:

```toon
pausedAt: {ISO-8601 timestamp}
command: {running command}
phase: {current step}
compactMode: true
planPath: {PLAN.md path or null}
roadmapPath: {ROADMAP.md path or null}
resumeStep: {exact step to resume from}
nextAction: {what was about to happen}
context: {compressed rolling-context.md, max 2000 tokens}
gitRef: {current HEAD sha}
message: {user's --message text, or null}
stateFiles[N]: {list of all .plan-execution/ state files that exist}
```

Use atomic write (`.tmp` then rename).

**Step C5: Print resume instructions.**

Determine the appropriate resume command:
- If `pipeline-state.toon` exists: `/loom-auto --resume`
- If `state.toon` exists (without pipeline-state): `/loom-plan execute --resume`
- If `convergence-state.toon` exists: `/loom-converge --resume`
- Fallback: `/loom-resume`

Print:
```
State saved. Run `/clear` then `/loom-resume`
```

That single line is the entire output. No headers, no details. The user is under context pressure -- minimize output.

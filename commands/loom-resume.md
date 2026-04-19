---
description: "Restore context from paused session and dispatch to correct workflow"
---

# Loom Resume

Restore context from a paused session and dispatch to the correct workflow command.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `resume`:
- No args: auto-detect and resume from `continue-here.toon` or other state
- `--force`: skip git drift warning and resume anyway
- `--status`: show what would be resumed without actually resuming

### Instructions

#### Step 1: Locate Resumable State

Check for state files in this priority order:

1. `.plan-execution/continue-here.toon` -- explicit pause snapshot (highest priority)
2. `.plan-execution/pipeline-state.toon` -- `/loom auto` pipeline state
3. `.plan-execution/state.toon` -- `/loom-plan execute` execution state
4. `.plan-execution/convergence-state.toon` -- `/loom converge` convergence state

If NONE of these files exist:
- Print: "No resumable state found. Start a new workflow with `/loom auto --from 'description'` or `/loom-plan execute`."
- Stop.

#### Step 2: Read and Validate State

**If `continue-here.toon` exists (from `/loom pause`):**

1. Read all fields from `continue-here.toon`.
2. Validate git state: run `git rev-parse HEAD` and compare with `gitRef` from the snapshot.
   - If they match: proceed silently.
   - If they differ and `--force` was NOT set:
     ```
     Warning: HEAD has moved since pause.
       Paused at: {gitRef}
       Current:   {currentHead}
       Commits diverged: {count}

     This may mean manual changes were made. Continue anyway? (yes / abort)
     ```
     Wait for user response. If "abort", stop.
   - If they differ and `--force` was set: print a one-line note and continue.

3. Restore context:
   - Read `rolling-context.md` if it exists.
   - Read each file listed in `stateFiles[]` to restore full state awareness.
   - Load `completedWork` to understand what's done.
   - Load `pendingDecisions` to know what needs human input.

**If `continue-here.toon` does NOT exist but other state files do:**

1. Read the highest-priority state file found.
2. Determine the command and current stage from the state file.
3. Warn: "No explicit pause snapshot found. Detected incomplete `{command}` workflow at stage `{stage}`. Resume from detected position? (yes / abort)"
4. Wait for confirmation.

#### Step 3: Display Resume Context (if --status)

If `--status` was passed, display what would be resumed and stop:

```
## Resumable State

Source:     {continue-here.toon | pipeline-state.toon | state.toon | convergence-state.toon}
Command:    {command}
Phase:      {phase}
Paused at:  {pausedAt timestamp}
Git ref:    {gitRef}
Git drift:  {none | N commits ahead}

Completed:
  {list of completed waves/stages with file counts}

Pending:
  {pendingDecisions list, or "none"}

Next action: {nextAction}

{if message exists:}
Note: {message}

To resume: /loom resume
```

Stop.

#### Step 4: Dispatch to Correct Command

Based on the detected command, dispatch to the appropriate resume path:

| Command | Dispatch Action |
|---------|----------------|
| `auto` | Read `pipeline-state.toon`. Print: "Resuming autonomous pipeline at stage: {currentStage}". Execute the `/loom auto --resume` logic (Step 0 of the auto subcommand with `--resume`). |
| `execute-plan` | Read `state.toon`. Print: "Resuming plan execution at wave {currentWave}". Execute `/loom-plan execute --resume` logic. |
| `converge` | Read `convergence-state.toon`. Print: "Resuming convergence at iteration {iteration}". Execute the `/loom converge --resume` logic. |
| `create-plan` | Print: "Plan creation was interrupted. Re-running from the beginning." Execute `/loom-plan create` with the original arguments from the snapshot context. |
| Other | Print: "Detected interrupted `{command}` workflow. Cannot auto-resume this command type. Suggested manual action: {nextAction from snapshot}". Stop. |

#### Step 5: Cleanup

After successful dispatch (the resumed command has started running):

1. Delete `.plan-execution/continue-here.toon` -- it has been consumed.
2. Print: "Resumed successfully. continue-here.toon cleaned up."

If the dispatch fails:
- Do NOT delete `continue-here.toon` -- the user can retry.
- Print: "Resume dispatch failed: {error}. State preserved. Try again with `/loom resume` or resume manually."

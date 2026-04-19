---
description: "Zero-ceremony task execution — auto-detects mode, implements, verifies"
---

# Loom Quick

Zero-ceremony task execution. Describe what you need done and Loom Quick handles context gathering, implementation, verification, logging, and optional commit -- adapting its behavior based on whether a plan is active.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `quick`:

If arguments are empty or equal `--help`, print the following help text and stop:

```
/loom quick [flags] <task description>

Execute a task with automatic context, verification, and logging.

Flags:
  --no-verify   Skip verification commands after execution
  --no-commit   Skip the auto-commit offer after execution
  --append      Force plan-aware mode (requires PLAN.md)
  --inject      Force injection mode (requires active plan execution)

Modes (auto-detected):
  standalone    No plan present. Execute, verify, log.
  plan-aware    PLAN.md exists. Choose to append as new phase or run independently.
  injection     Plan execution is running. Inject into current wave or queue for next.

Examples:
  /loom quick Add input validation to the signup form
  /loom quick --no-verify Fix the broken CSS on the dashboard
  /loom quick --append Add a caching layer to the API
  /loom quick --inject --no-commit Add retry logic to the webhook handler
```

### Instructions

#### Step 1: Flag Parsing

Parse arguments by iterating tokens left to right:

1. Any token starting with `--` is a flag. Consume it and continue.
2. The first token that does NOT start with `--` marks the beginning of the task description. All remaining tokens (including any that look like flags) become the task description.

Supported flags: `--no-verify`, `--no-commit`, `--append`, `--inject`.

If a token starts with `--` but is not in the supported list, print a warning and continue:

```
Unknown flag: {flag} (ignored)
```

If both `--append` and `--inject` are present, `--inject` takes precedence.

After parsing, if the task description is empty, print the help text and stop.

#### Step 2: Mode Detection

Detect the execution mode before any work begins.

1. Check if `PLAN.md` exists in the project root. Record as `planExists`.
2. Check if `.plan-execution/state.toon` exists. If it does, read its `status` field. Record `executionRunning` as true only if the file exists AND `status` is `in-progress`.
3. Derive mode from this table:

| `executionRunning` | `planExists` | Derived Mode |
|--------------------|--------------|--------------|
| true | true | `injection` |
| false | true | `plan-aware` |
| false | false | `standalone` |
| true | false | `standalone` (print warning: `Warning: execution state found but no PLAN.md. Running in standalone mode.`) |

4. Apply flag overrides:
   - `--inject` forces `injection` mode. Error if `.plan-execution/state.toon` does not exist or `status` is not `in-progress`: print `Cannot use --inject: no active plan execution.` and stop.
   - `--append` forces `plan-aware` mode. Error if `PLAN.md` does not exist: print `Cannot use --append: no PLAN.md found.` and stop.

5. Print the detected mode:

```
Mode: {mode}
```

#### Step 3: Execute by Mode

Route to the appropriate mode section below.

---

##### Mode: Standalone

**3a. Gather context.**

Read `CLAUDE.md` if it exists. Scan the project structure and relevant source files to understand the codebase context needed for the task.

**3b. Execute the task.**

Implement the described task. Write or modify code as needed. Stay focused on exactly what the user described -- no scope creep.

**3c. Continue to Step 4 (Post-Execution).**

---

##### Mode: Plan-Aware

**3a. Present choice to user.**

Print:

```
PLAN.md detected. How should this task relate to the plan?

  1. Append as new phase to PLAN.md, then execute
  2. Execute independently (standalone mode with plan context)
```

Wait for user selection.

**3b. If user chose "Append" (option 1):**

1. Read `PLAN.md` in full.
2. Find the last phase number and last wave number.
3. Create a new phase section in PLAN.md with:
   - Phase number: last phase + 1
   - Wave number: last wave + 1
   - Title derived from the task description
   - Auto-generated file ownership: analyze the task description for file paths, module names, and component references. Check the codebase for matching files. List the files this task will likely touch.
   - Auto-generated acceptance criteria: derive 2-4 testable criteria from the task description.
   - Dependencies: the last existing phase.
4. Record `planContext` as the path to PLAN.md.
5. Read CLAUDE.md if it exists. Scan relevant source files.
6. Execute the task.
7. Continue to Step 4.

**3c. If user chose "Independent" (option 2):**

Record `planContext` as the path to PLAN.md (for the log) but execute in standalone mode. Read CLAUDE.md, scan relevant files, execute the task, continue to Step 4.

---

##### Mode: Injection

**3a. Read execution state.**

Parse `.plan-execution/state.toon`. Extract:
- `currentWave` -- the wave number currently executing.
- `tasks` -- all tasks with their status, assigned agent, and file ownership.

**3b. Determine file ownership.**

Analyze the task description and the codebase to predict which files this task will modify:
- Parse the task description for file paths, module names, and component references.
- Check the codebase for matching files.
- Produce a candidate `filesOwned[]` list.

**3c. Check for ownership conflicts.**

Compare `filesOwned[]` against every task in the current wave that has `status: in-progress`. A conflict exists if any file in `filesOwned[]` overlaps with another in-progress task's `filesOwned[]`.

**3d. Inject or queue.**

| Conflict? | Action |
|-----------|--------|
| No | Inject into `currentWave`. Add a new task entry to `state.toon` with `status: in-progress` and `agent: quick-task`. Execute the task immediately. |
| Yes | Queue for `currentWave + 1`. Add a new task entry with `status: queued` and `targetWave: currentWave + 1`. Print: `File conflict with in-progress task "{taskId}". Queued for wave {N+1}.` Do NOT execute the task now -- it will be picked up by the plan executor in the next wave. Skip to Step 4 with `verificationResult: skipped`. |

**3e. Update state.toon.**

Write the updated state atomically: write to `.plan-execution/state.toon.tmp`, then rename to `.plan-execution/state.toon`. Include the new task with all standard task fields.

**3f. Execute (if injected, not queued).**

Read CLAUDE.md if it exists. Scan relevant files. Execute the task respecting ownership boundaries -- do NOT modify files owned by other in-progress tasks.

**3g. Post-execution state update.**

After the task completes (or fails), update `state.toon` again:
- Set the injected task's `status` to `completed` or `failed`.
- Record `filesChanged[]` in the task entry.

**3h. Continue to Step 4.**

---

#### Step 4: Post-Execution

Run this section for all modes after task execution completes.

##### 4a. Verification

If `--no-verify` was set, set `verificationResult: skipped` and skip to 4b.

Otherwise, discover verification commands using this priority:

1. **PLAN.md extraction.** If `PLAN.md` exists, look for a `## Verification Commands` section. Parse each line as a command. Skip blank lines, lines starting with `#`, and pure prose. Parse fenced code blocks line-by-line for commands.

2. **Auto-detection.** If no plan-based commands were found, probe these files:

| File | Condition | Command |
|------|-----------|---------|
| `package.json` | `scripts.typecheck` exists | `bun run typecheck` |
| `package.json` | `scripts.test` exists | `bun run test` |
| `package.json` | `scripts.lint` exists | `bun run lint` |
| `tsconfig.json` | File exists (and no `scripts.typecheck`) | `bunx tsc --noEmit` |
| `Makefile` | File exists and has a `check` or `test` target | `make check` or `make test` |

3. **No commands found.** Set `verificationResult: skipped` with an empty verification output block.

Run each discovered command sequentially. For each command:
- Capture exit code.
- Capture combined stdout+stderr, truncated to the last 50 lines on failure.
- Record in verification output as `commandName: exit N` (success) or a block with truncated output (failure).

Overall result:
- All commands exit 0: `verificationResult: pass`
- Any command exits non-zero: `verificationResult: fail`

##### 4b. Write Log File

Generate the log file path and taskId:

1. Take the task description, lowercase it.
2. Split on whitespace, take the first 5 words.
3. Join with hyphens.
4. Replace any character not `[a-z0-9-]` with a hyphen.
5. Collapse consecutive hyphens into one, trim leading/trailing hyphens.
6. Truncate to 50 characters (at the last complete hyphen-delimited segment within the limit).

Path: `.plan-history/quick-tasks/{YYYY-MM-DD}-{slug}.toon`

Create the `.plan-history/quick-tasks/` directory if it does not exist.

If a file with the same name already exists, append `-2`, `-3`, etc. before `.toon`.

Write the log in TOON format with all QuickTaskLog fields:

```toon
taskId: {YYYY-MM-DD}-{slug}
description: {user's original task description, verbatim}
mode: {standalone|plan-aware|injection}

startedAt: {ISO-8601 timestamp from when execution began}
completedAt: {ISO-8601 timestamp from when post-execution finished}

filesChanged[N]: {list of files created, modified, or deleted}

verificationResult: {pass|fail|skipped}
verificationOutput:
  {commandName}: exit {N}

commitHash: {short SHA or null}
planContext: {path to PLAN.md or null}
injectedPhase: {phase identifier or null}
injectedWave: {wave number or null}
```

##### 4c. Offer Commit

If `--no-commit` was NOT set:

Print:

```
Commit changes with /loom-git commit? (y/n)
```

If the user confirms, invoke `/loom-git commit`. Record the resulting commit hash in the log file (update the `commitHash` field). If the user declines, set `commitHash: null`.

If `--no-commit` was set, skip this step and set `commitHash: null`.

##### 4d. Print Summary

Print a summary in this format:

```
--- Quick Task Complete ---
Mode:         {mode}
Task:         {description}
Files:        {comma-separated list of changed files, or "none"}
Verification: {pass|fail|skipped}
Log:          {path to log file}
Commit:       {short SHA or "none"}
```

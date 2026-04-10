# Quick Task Contract

Shared protocols for the `/loom-quick` command. Defines the QuickTaskLog format, mode detection, plan injection, verification reuse, log naming, and flag parsing. All implementers must follow these conventions.

## QuickTaskLog TOON Format

Every quick task execution produces a log file in TOON format with the following fields:

```toon
taskId: 2026-04-09-add-error-handling
description: Add error handling to the API routes
mode: standalone

startedAt: 2026-04-09T14:32:00Z
completedAt: 2026-04-09T14:35:12Z

filesChanged[N]: src/routes/api.ts, src/lib/errors.ts, tests/api.test.ts

verificationResult: pass
verificationOutput:
  typecheck: exit 0
  test: exit 0
  lint: exit 0

commitHash: a1b2c3d
planContext: null
injectedPhase: null
injectedWave: null
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | ISO date + slug: `YYYY-MM-DD-slug` |
| `description` | string | Yes | The user's original task description, verbatim |
| `mode` | enum | Yes | One of: `standalone`, `plan-aware`, `injection` |
| `startedAt` | ISO-8601 | Yes | Timestamp when execution began |
| `completedAt` | ISO-8601 | Yes | Timestamp when execution finished (including verification) |
| `filesChanged` | array | Yes | List of files created, modified, or deleted. May be empty. |
| `verificationResult` | enum | Yes | One of: `pass`, `fail`, `skipped` |
| `verificationOutput` | block | Yes | Per-command results. Each key is the command name, value is `exit N` optionally followed by truncated stderr on failure. Empty block if `verificationResult` is `skipped`. |
| `commitHash` | string or null | Yes | The short SHA of the commit created, or `null` if `--no-commit` was used or commit was skipped |
| `planContext` | string or null | Yes | Path to the PLAN.md that was active, or `null` in standalone mode |
| `injectedPhase` | string or null | Yes | Phase identifier if injected into an active plan execution, or `null` |
| `injectedWave` | integer or null | Yes | Wave number if injected into an active plan execution, or `null` |

## Mode Detection Algorithm

Mode detection runs before task execution begins. It determines how the quick task relates to any active plan.

### Detection Procedure

1. Check if `PLAN.md` exists in the working directory root.
   - Result: `planExists` (boolean).
2. Check if `.plan-execution/state.toon` exists and read its `status` field.
   - Result: `executionRunning` (boolean). True only if the file exists AND `status` is `in-progress`.
3. Derive mode:

| `executionRunning` | `planExists` | Derived Mode |
|--------------------|--------------|--------------|
| true | true | `injection` |
| false | true | `plan-aware` |
| false | false | `standalone` |
| true | false | Invalid state -- treat as `standalone` with a warning |

### Flag Overrides

Flags can force a specific mode. Overrides are checked after auto-detection:

| Flag | Effect | Error Condition |
|------|--------|-----------------|
| `--append` | Forces `plan-aware` mode | Error if `PLAN.md` does not exist: `Cannot use --append: no PLAN.md found.` |
| `--inject` | Forces `injection` mode | Error if `.plan-execution/state.toon` does not exist or `status` is not `in-progress`: `Cannot use --inject: no active plan execution.` |

If both `--append` and `--inject` are present, `--inject` takes precedence.

## Plan-Injection Protocol

When mode is `injection`, the task is inserted into the running plan execution. This requires coordination with in-progress agents to avoid file ownership conflicts.

### Injection Procedure

1. **Read state.** Parse `.plan-execution/state.toon`. Extract:
   - `currentWave` -- the wave number currently executing.
   - `tasks` -- the list of all tasks with their status, assigned agent, and file ownership.

2. **Determine file ownership.** Analyze the task description and the codebase to predict which files the quick task will modify. Use the same heuristics as the plan executor:
   - Parse the task description for file paths, module names, and component references.
   - Check the codebase for matching files.
   - Produce a candidate `filesOwned[]` list.

3. **Check for conflicts.** Compare `filesOwned[]` against every task in the current wave that has `status: in-progress`:
   - A conflict exists if any file in `filesOwned[]` overlaps with another in-progress task's `filesOwned[]`.

4. **Inject or queue:**

| Conflict? | Action |
|-----------|--------|
| No | Inject into `currentWave`. Add a new task entry to `state.toon` with `status: in-progress` and `agent: quick-task`. |
| Yes | Queue for `currentWave + 1`. Add a new task entry with `status: queued` and `targetWave: currentWave + 1`. Print: `File conflict with in-progress task "{taskId}". Queued for wave {N+1}.` |

5. **Update state.toon.** Write the updated state atomically (write to `.tmp`, then rename). Include the new task with all standard task fields.

### Post-Execution State Update

After the quick task completes, update `state.toon`:
- Set the injected task's `status` to `completed` or `failed`.
- Record `filesChanged[]` in the task entry (the actual files modified, which may differ from the predicted `filesOwned[]`).

## Verification Reuse Protocol

Quick tasks reuse existing verification commands when available, falling back to auto-detection.

### Command Discovery

Attempt each source in order. Stop at the first source that yields at least one command.

1. **PLAN.md extraction.** If `PLAN.md` exists, look for a `## Verification Commands` section. Parse each line as a command. Lines that are blank, start with `#`, or are pure prose (no executable content) are skipped. Fenced code blocks within the section are parsed line-by-line for commands.

2. **Auto-detection.** If no plan-based commands were found, probe the following files and extract commands:

| File | Condition | Command |
|------|-----------|---------|
| `package.json` | `scripts.typecheck` exists | `bun run typecheck` |
| `package.json` | `scripts.test` exists | `bun run test` |
| `package.json` | `scripts.lint` exists | `bun run lint` |
| `tsconfig.json` | File exists (and no `scripts.typecheck`) | `bunx tsc --noEmit` |
| `Makefile` | File exists and has a `check` or `test` target | `make check` or `make test` |

**Note:** Use `bun` / `bunx` over `npm` / `npx` when bun is available, per project conventions.

3. **No commands found.** If neither source yields commands, set `verificationResult: skipped` and `verificationOutput` to an empty block.

### Execution

Run each discovered command sequentially. For each command:
- Capture exit code.
- Capture combined stdout+stderr, truncated to the last 50 lines on failure.
- Record in `verificationOutput` as `commandName: exit N` (on success) or a block with the truncated output (on failure).

**Overall result:**
- All commands exit 0: `verificationResult: pass`
- Any command exits non-zero: `verificationResult: fail`
- `--no-verify` flag was set: `verificationResult: skipped`

## Log File Naming Convention

### Path

```
.plan-history/quick-tasks/{YYYY-MM-DD}-{slug}.toon
```

### Slug Generation

1. Take the task description.
2. Lowercase the entire string.
3. Split on whitespace, take the first 5 words.
4. Join with hyphens.
5. Replace any character that is not `[a-z0-9-]` with a hyphen.
6. Collapse consecutive hyphens into a single hyphen.
7. Trim leading and trailing hyphens.
8. Truncate to 50 characters. If truncation lands in the middle of a word, truncate to the last complete hyphen-delimited segment within the 50-character limit.

**Examples:**

| Description | Slug |
|-------------|------|
| `Add error handling to the API routes` | `add-error-handling-to-the` |
| `Fix the broken CSS layout!` | `fix-the-broken-css-layout` |
| `Update package.json dependencies for v2` | `update-package-json-dependencies-for` |

### taskId

The `taskId` field uses the same date and slug: `{YYYY-MM-DD}-{slug}`.

If a log file with the same name already exists, append `-2`, `-3`, etc. before the `.toon` extension:

```
.plan-history/quick-tasks/2026-04-09-add-error-handling-to-the.toon
.plan-history/quick-tasks/2026-04-09-add-error-handling-to-the-2.toon
```

## Flag Parsing Protocol

Flags are parsed from the beginning of the `$ARGUMENTS` string before the task description.

### Parsing Rules

1. Iterate tokens from left to right.
2. A token starting with `--` is a flag. Consume it.
3. The first token that does **not** start with `--` marks the beginning of the task description. All remaining tokens (including any that look like flags) are part of the description.

### Supported Flags

| Flag | Effect |
|------|--------|
| `--no-verify` | Skip verification commands. Sets `verificationResult: skipped`. |
| `--no-commit` | Skip the auto-commit step. Sets `commitHash: null`. |
| `--append` | Force `plan-aware` mode (see Mode Detection). |
| `--inject` | Force `injection` mode (see Mode Detection). |

### Unknown Flags

Any token starting with `--` that is not in the supported list is treated as an unknown flag. Print a warning and continue:

```
Unknown flag: {flag} (ignored)
```

### Examples

```
/loom-quick --no-verify Fix the login timeout bug
  flags: [--no-verify]
  description: "Fix the login timeout bug"

/loom-quick --inject --no-commit Add retry logic to the webhook handler
  flags: [--inject, --no-commit]
  description: "Add retry logic to the webhook handler"

/loom-quick Refactor the --legacy auth module
  flags: []
  description: "Refactor the --legacy auth module"
```

In the third example, `--legacy` is part of the description because `Refactor` (a non-flag token) was encountered first.

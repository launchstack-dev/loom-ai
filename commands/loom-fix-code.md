# Fix Code

Apply code review findings to the codebase automatically. Parses a review report, groups findings by file, spawns fixer-agents in parallel, and verifies the result.

## Instructions

$ARGUMENTS

Parse arguments:
- No args: read from `.plan-execution/review-report.md`
- `--report <path>`: read from a specific report file
- `--severity <levels>`: comma-separated filter (default: `critical,warning`). Options: `critical`, `warning`, `info`
- `--dry-run`: show fix plan, do not apply changes
- `--auto`: skip approval gate after fixes
- `--finding <N>`: fix a single finding by number

---

## Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` § "Orchestration Status".

## Step 1: Read and Parse Review Report

1. Determine report path from args (default: `.plan-execution/review-report.md`)
2. If report does not exist, tell the user: "No review report found. Run `/loom-review-code` first to generate findings." Stop.
3. Parse the report into a structured findings list. Each finding has:
   - `id`: sequential number
   - `severity`: critical | warning | info
   - `tag`: [SEC], [ARCH], [STYLE], [SILENT], [TEST], [TYPE], [SIMPLE], [PLAN], [COMMENT]
   - `file`: file path
   - `line`: line number (if available)
   - `description`: what the issue is
   - `fix`: suggested fix (if available)
   - `reviewer`: which agent found it

## Step 1.5: Dedup Against Prior Fix Reports

1. Check for `.plan-execution/fix-report.toon`. If it exists:
   - Parse the `applied` array to extract content keys (tag + file + line) of previously fixed findings
   - For each current finding, compute its content key: `{tag}:{file}:{line}`
   - Remove any finding whose content key matches an already-applied entry
   - Report: "Skipping N findings already applied in prior run ({date})."
2. If all findings were already applied, report "All findings from this report have been fixed." Stop.

**Note:** Dedup matches by content key (tag + file + line), not by sequential ID. This ensures correctness even if the user runs `/loom-review-code` again and IDs are reassigned in a different order.

## Step 2: Filter Findings

1. Apply `--severity` filter (default: critical + warning)
2. Apply `--finding N` filter if specified (overrides severity filter)
3. If no findings remain after filtering, report "No findings match the filter." Stop.

## Step 3: Group and Validate

1. Group findings by file path
2. For each file, verify it exists using Glob. If a file does not exist:
   - Remove its findings from the batch
   - Report: "Skipping N findings for `<file>` — file not found"
3. If no valid findings remain, stop.

## Step 4: Display Fix Plan

Show a summary table:

```
## Fix Plan

| # | Severity | Tag | File:Line | Description |
|---|----------|-----|-----------|-------------|
| 1 | critical | [SEC] | src/auth.ts:42 | SQL injection in user lookup |
| 2 | warning  | [ARCH] | src/routes.ts:3 | Layer bypass import |
...

Files affected: 5
Findings to apply: 8 (2 critical, 6 warning)
```

If `--dry-run`, stop here.

## Step 5: Assign File Ownership

1. Count total unique files across all findings
2. If <= 8 files: single fixer-agent gets all files
3. If > 8 files: split into batches of <= 8 files each, one fixer-agent per batch
4. Ensure no file appears in more than one batch (strict ownership)

## Step 6: Spawn Fixer Agents

For each batch, spawn a fixer-agent using the Agent tool:

```
subagent_type: "general-purpose"
```

Prompt each agent with:
1. "Read your instructions from `~/.claude/agents/fixer-agent.md` first."
2. The findings assigned to this batch (id, severity, tag, file, line, description, fix)
3. The file ownership list (which files this agent may modify)
4. Project conventions from CLAUDE.md if available

Launch all fixer-agents in a SINGLE message with multiple Agent tool calls (parallel execution).

## Step 7: Collect Results

Wait for all agents to complete. For each AgentResult:
1. Record `filesModified` and `findingsApplied`
2. Record any `unfixable` findings with reasons
3. Record any `issues`
4. Verify no agent modified files outside its ownership boundary

## Step 8: Show Diff for Approval

Run `git diff` to show all changes made by the fixer agents.

Display a summary:

```
## Fix Results

Applied: 7/8 findings
Unfixable: 1 finding
  - #3 src/config.ts:10 [ARCH] — Requires architectural redesign

Files modified: 4
```

If `--auto` was specified, skip to Step 9.

Otherwise, ask: "Apply these changes? (yes / revert / select)"
- **yes**: proceed to verification
- **revert**: run `git checkout -- <modified files>` to undo all changes. Stop.
- **select**: show each change individually for accept/reject

## Step 9: Verification

Run the verification-agent or equivalent checks:
1. **Typecheck**: run the project's type checker (tsc, mypy, etc.)
2. **Tests**: run the project's test suite
3. **Lint**: run the project's linter

Report results:

```
## Verification

Typecheck: PASS
Tests: 138/138 passed
Lint: PASS (2 warnings, 0 errors)
```

If verification fails:
- Show the failures
- Ask: "Verification failed. Keep changes anyway, or revert? (keep / revert)"
- On revert: `git checkout -- <modified files>`

## Step 10: Save Fix Report and Archive

1. Create `.plan-execution/` if it doesn't exist.

2. **Append a run entry to fix-report.toon** (not overwrite — accumulates across runs):

```toon
runs[N]{date,source,filter,appliedCount,unfixableCount,verification}:
  2026-04-06,review-report.md,critical+warning,7,1,PASS

applied[N]{runDate,tag,file,line,description}:
  2026-04-06,[SEC],src/auth.ts,42,Parameterized SQL query
  2026-04-06,[ARCH],src/routes.ts,3,Fixed layer bypass import

unfixable[N]{runDate,tag,file,line,reason}:
  2026-04-06,[ARCH],src/config.ts,10,Requires architectural redesign
```

The `tag:file:line` triple is the content key used for dedup — it uniquely identifies a finding regardless of sequential ID assignment.

3. **Archive the review report** to `.plan-history/`:
   - Create `.plan-history/reviews/` if it doesn't exist
   - Copy `.plan-execution/review-report.md` → `.plan-history/reviews/YYYY-MM-DD-review.md`
   - If ALL findings from the report are now resolved (applied + unfixable across all runs), delete `.plan-execution/review-report.md`
   - If unresolved findings remain (e.g., info-level not yet addressed), keep the report in place for future `/loom-fix-code` runs

4. **Append to changelog** if `.plan-history/changelog.md` exists:
   ```
   ## YYYY-MM-DD — Code fixes applied
   - Source: {report path}
   - Applied: {count} findings ({severity breakdown})
   - Unfixable: {count} findings
   - Verification: {PASS/FAIL}
   ```

## Step 10.5: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to capture applied fixes as finalized design decisions:

```
subagent_type: "general-purpose"
run_in_background: true
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `fixes-applied`
- Event data: applied findings (tag, file, description), unfixable findings with reasons (these become documented design constraints), verification result
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails, log a warning and continue. Wiki maintenance never gates the workflow.

---

## Error Handling

- **No report found**: suggest `/loom-review-code` first
- **File in finding doesn't exist**: skip findings for that file, report it
- **Agent failure**: report which findings were not applied, continue with results from other agents
- **Verification fails**: offer keep/revert, do not force either
- **No `.plan-execution/` dir**: skip saving fix report, mention it

---
description: "Rapid bug fixing with Loom rigor — wiki context, impact assessment, fix archiving"
---

# Loom Bugfix

Rapid bug-fix workflow that applies Loom's rigor (wiki context, impact assessment, agent coordination, fix archiving) without the formality of a full plan/roadmap cycle. Designed for speed with accountability.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `bugfix`:

If arguments are empty or equal `--help`, print the following help text and stop:

```
/loom bugfix [flags] <bug description>

Rapidly fix a bug with wiki context, impact analysis, and archiving.

Flags:
  --severity <level>   Set severity: critical, high, medium, low (auto-detected if omitted)
  --no-verify          Skip verification commands after fix
  --no-commit          Skip the auto-commit offer
  --no-archive         Skip writing to fix archive (not recommended)
  --dry-run            Diagnose and assess impact without applying the fix
  --path <hint>        Hint at suspected file/module path

Examples:
  /loom bugfix The login button returns 500 after password reset
  /loom bugfix --severity critical Users can't check out — payment API timeout
  /loom bugfix --path src/auth/ Token refresh fails silently
  /loom bugfix --dry-run The dashboard is slow when filtering by date
```

### Instructions

#### Step 1: Flag Parsing

Parse arguments by iterating tokens left to right:

1. Any token starting with `--` is a flag. Consume it (and its value if it takes one) and continue.
2. The first token that does NOT start with `--` marks the beginning of the bug description. All remaining tokens become the description.

Supported flags:
- `--severity <level>` — takes next token as value (critical/high/medium/low)
- `--no-verify` — boolean
- `--no-commit` — boolean
- `--no-archive` — boolean
- `--dry-run` — boolean
- `--path <hint>` — takes next token as value

Unknown flags: print warning and continue.

After parsing, if the bug description is empty, print help text and stop.

#### Step 2: Context Preflight

Gather context before spawning agents. This is fast, read-only work.

**2a. Wiki check.**

Check if `.loom/wiki/` exists and has pages. Record `wikiAvailable: true/false`.

If available, read `.loom/wiki/index.toon` and scan for pages related to the bug description:
- Match against module names, component names, and keywords from the description
- Match against any `--path` hint
- Collect up to 5 relevant page IDs as `wikiHints`

**2b. Fix archive check.**

Check if `.loom/fix-archive/index.toon` exists. If so, scan for prior fixes in the same area:
- Match against modules and keywords from the description
- Collect related fix IDs as `priorFixHints`
- If 3+ fixes hit the same module recently, print a warning:
  ```
  Recurring fixes in {module} — consider a deeper investigation after this fix.
  ```

**2c. App background.**

Read CLAUDE.md for project conventions. If ROADMAP.md exists, skim the section headings to understand what's actively being worked on. If PLAN.md exists and describes the affected area, note it.

**2d. Team awareness.**

Check if `.plan-execution/state.toon` exists with `status: in-progress`. If so, read the active tasks and their file ownership. Record `activeOwnership` — the bugfix agent must respect these boundaries.

#### Step 3: Generate Fix Archive Path

Generate the archive entry path and fixId:

1. Take the bug description, lowercase it.
2. Split on whitespace, take the first 6 words.
3. Join with hyphens.
4. Replace any character not `[a-z0-9-]` with a hyphen.
5. Collapse consecutive hyphens, trim leading/trailing.
6. Truncate to 50 characters at the last complete segment.

Path: `.loom/fix-archive/{YYYY-MM-DD}-{slug}.toon`

Create `.loom/fix-archive/` directory if it does not exist.

If a file with the same name exists, append `-2`, `-3`, etc. before `.toon`.

#### Step 4: Spawn Bugfix Analyst

Spawn the `bugfix-analyst-agent` using the Agent tool with subagent_type `general-purpose`. Pass a prompt containing:

```
You are operating as the bugfix-analyst-agent. Read the agent definition at agents/bugfix-analyst-agent.md and follow its approach.

Bug description: {user's description}
Severity: {provided or "auto-detect"}
Path hints: {--path value or "none"}
Wiki available: {true/false}
Wiki hints: {list of relevant page IDs or "none"}
Prior fix hints: {list of related fix IDs or "none"}
Fix archive path: {generated path}
Active file ownership: {ownership map or "none — no active execution"}
Dry run: {true/false}
TaskId: {fixId}

Read the fix-archive schema at agents/protocols/fix-archive.schema.md before writing the archive entry.
{If --no-verify: "Skip verification — do not run test/typecheck/lint commands."}
{If --dry-run: "DIAGNOSTIC ONLY — do NOT apply any code changes. Complete phases 1-2 and 4 (context, diagnosis, impact assessment) then return. Write the archive entry with fix field set to 'DRY RUN — fix not applied' and status partial."}
```

Wait for the agent to return its AgentResult.

#### Step 5: Process Result

Read the AgentResult from the bugfix-analyst-agent.

**5a. Check status.**

| Status | Action |
|--------|--------|
| `success` | Continue to Step 6 |
| `partial` | Print warnings from `issues`, continue to Step 6 |
| `failure` | Print error details. If `--no-archive` was NOT set and no archive entry exists, write a minimal entry with `fix: "Agent failed — see diagnoseLog"`, `verificationResult: skipped`, and `status: failure`. Continue to Step 5c (index update), then skip to Step 7 summary. |

**5b. Validate archive entry.**

If `--no-archive` was NOT set, confirm the archive entry file exists at the generated path. If missing, print a warning — the agent should have written it.

**5c. Update fix archive index.**

If `--no-archive` was set, skip this step.

If the archive entry was written, update `.loom/fix-archive/index.toon`:
- Read existing index (or create new one)
- Append the new entry to the `entries` table
- Update `lastUpdated` and `totalFixes`
- Write atomically (`.tmp` then rename)

#### Step 6: Post-Fix

**6a. Offer commit.**

If `--no-commit` was NOT set and the fix was applied (not dry-run):

```
Commit fix with /loom-git commit? (y/n)
```

If confirmed, invoke `/loom-git commit`. Then backfill the commit hash into the archive entry atomically: read the archive `.toon` file, replace `commitHash: null` with `commitHash: {short SHA}`, write to `.tmp`, rename to the original path.

**6b. Wiki update prompt.**

If wiki is available and the fix touched areas with wiki pages, suggest:

```
Wiki pages may need updating:
  - {page title} ({page ID}) — last updated {date}

Update wiki with /loom-wiki ingest --diff? (y/n)
```

If confirmed, invoke `/loom-wiki ingest --diff`.

#### Step 7: Print Summary

Print a summary in this format:

```
--- Bugfix Complete ---
Bug:            {title from archive entry}
Severity:       {severity}
Category:       {category}
Root Cause:     {rootCause, truncated to 80 chars}
Files Changed:  {comma-separated list or "none (dry run)"}
Impact:         {risk} risk, {scope} scope
Regression:     {comma-separated regression areas or "none identified"}
Verification:   {pass|fail|skipped}
Archive:        {path to archive entry}
Prior Fixes:    {count of related prior fixes or "none"}
Commit:         {short SHA or "none"}
```

If `--dry-run` was set, prefix the summary with:

```
--- Bugfix Diagnosis (dry run — no changes applied) ---
```

If the impact assessment found `recurringPattern: true`, append:

```
NOTE: This is a recurring fix area. Consider creating a tech-debt wiki page
and/or a deeper investigation plan with /loom-plan create.
```

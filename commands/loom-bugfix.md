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
/loom-bugfix [flags] <bug description>

Rapidly fix a bug with wiki context, impact analysis, and archiving.

Flags:
  --severity <level>   Set severity: critical, high, medium, low (auto-detected if omitted)
  --no-verify          Skip verification commands after fix
  --no-commit          Skip the auto-commit offer
  --no-archive         Skip writing to fix archive (not recommended)
  --dry-run            Diagnose and assess impact without applying the fix
  --path <hint>        Hint at suspected file/module path
  --model <model>      Override agent model (opus, sonnet, haiku). Use --model opus for tough bugs.
  --autoconverge       Run as an F-03 convergence loop (debug-harness + fixer-agent integrator)
  --symptom <path>     Path to failing test / repro script / error log (required with --autoconverge)

Examples:
  /loom-bugfix --model opus Complex race condition in the queue worker
  /loom-bugfix The login button returns 500 after password reset
  /loom-bugfix --severity critical Users can't check out — payment API timeout
  /loom-bugfix --path src/auth/ Token refresh fails silently
  /loom-bugfix --dry-run The dashboard is slow when filtering by date
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
- `--model <model>` — takes next token as value (opus/sonnet/haiku). Overrides the agent's frontmatter model for this invocation. Use `--model opus` when the analyst is struggling with a complex bug.
- `--autoconverge` — boolean. Switches the command into F-03 convergence mode (see § Autoconverge Mode below). Mutually exclusive with `--dry-run`.
- `--symptom <path>` — takes next token as value. Required when `--autoconverge` is set. Repo-relative path to a failing test file, repro shell script, or error log.

Unknown flags: print warning and continue.

After parsing, if the bug description is empty, print help text and stop.

#### Step 2: Context Preflight

Gather context before spawning agents. This is fast, read-only work.

**2a. Wiki check.**

Check if `.loom/wiki/` exists and has pages. Record `wikiAvailable: true/false`.

If available, read `.loom/wiki/index.toon` and scan for pages related to the bug description.

**User-facing-language keying (run BEFORE component matching).** When the bug description is framed in user-facing terms, match `flow-*` page titles FIRST, then resolve flows to the components they exercise via `crossRefs`. Prefer a flow title hit over a component-name hit — flow titles describe user-visible behavior, component titles describe code topology, and a user-framed bug is more likely caused by a regression in the flow's success path than by an arbitrary code-named module.

1. **Detect user-facing language in the bug description.** Apply these patterns (case-insensitive) against the description string. If any pattern matches, set `userFacingMode: true`. Keep the pattern set conservative — these patterns will over-match if broadened (calibration risk, same principle as Hook B):

   - `/user(s)? (can'?t|cannot|fails? to|are? unable to|is unable to) \w+/i`
   - `/(checkout|signup|sign-up|login|sign-in|password reset|onboarding|payment|subscription|dashboard) (broken|fails?|doesn'?t work|hangs?|times? out|returns? \d+)/i`
   - `/(error|crash|hang|timeout) (when|while|during|after) \w+/i`
   - `/(can'?t|cannot|unable to) (check ?out|sign ?up|sign ?in|log ?in|reset|submit|complete)/i`
   - `/(button|form|page|screen) (returns?|throws?|shows?) \d+/i`

2. **If `userFacingMode` is true:**
   - Scan `index.toon` for `flow-*` pages whose `title` or `summary` fuzzy-matches tokens from the bug description (lowercase, strip punctuation, drop stopwords; a match is any non-stopword token of length >=4 appearing in the title or summary).
   - For each matched flow page, read its body and add all `crossRefs` entries where `relationship: exercises` to the wiki-lookup candidate set — these are the components the flow touches.
   - Record matched flow pageIds as `bugFixContext.matchedFlows[]` (will be passed to the analyst and persisted in the bugfix archive).
   - Continue with the existing component-matching logic below as a fallback in case no flow matches.

3. **Component matching (existing logic, runs whether or not flows matched):**
   - Match against module names, component names, and keywords from the description.
   - Match against any `--path` hint.
   - Collect up to 5 relevant page IDs as `wikiHints` (union of flow-derived components from step 2 and direct keyword matches).

4. **Surface matched flows prominently in the bug report.** When `bugFixContext.matchedFlows[]` is non-empty, include a line of the form:

   ```
   This bug appears to affect flow `{flow-title}` — the {affected-exit-state} exit path may be regressing.
   ```

   Use the flow's `summary` and `exitStates` (per `agents/protocols/wiki-page.schema.md`) to pick a plausible `{affected-exit-state}`; if uncertain, omit the exit-state clause and keep just the flow name.

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

Spawn the `bugfix-analyst-agent` using the Agent tool with subagent_type `general-purpose`. If `--model` was provided, pass that model on the Agent tool call (e.g., `model: "opus"`). Otherwise, follow the standard model resolution: profile tier → agent frontmatter (`model: sonnet`) → inherit parent. Pass a prompt containing:

```
You are operating as the bugfix-analyst-agent. Read the agent definition at agents/bugfix-analyst-agent.md and follow its approach.

Bug description: {user's description}
Severity: {provided or "auto-detect"}
Path hints: {--path value or "none"}
Wiki available: {true/false}
Wiki hints: {list of relevant page IDs or "none"}
Matched flows: {list of flow pageIds from bugFixContext.matchedFlows[] or "none"}
User-facing mode: {true/false — whether user-facing-language detection fired}
Prior fix hints: {list of related fix IDs or "none"}
Fix archive path: {if --no-archive: "DISABLED — do not write any archive entry", else: generated path}
Active file ownership: {ownership map or "none — no active execution"}
Dry run: {true/false}
TaskId: {fixId}

{If Matched flows is non-empty: "Treat the listed flow pageIds as authoritative user-facing-impact context. Populate affectedFlows[] in your AgentResult with the flow pageIds whose exitStates or steps[].touches intersect the diff. If the bug regresses a specific exit-state on a flow, name it in your root-cause analysis."}
{If --no-archive is NOT set: "Read the fix-archive schema at agents/protocols/fix-archive.schema.md before writing the archive entry."}
{If --no-archive: "Archive is disabled. Do NOT write any fix archive entry or touch .loom/fix-archive/. Skip all archive-related steps."}
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
| `failure` | Print error details. If `--no-archive` was NOT set and no archive entry exists, write a minimal entry with `fix: "Agent failed — see diagnoseLog"`, `verificationResult: skipped`, and `notes: "Agent failure — fix not applied"`. Continue to Step 5c (index update), then skip to Step 7 summary. |

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

## Autoconverge Mode (`--autoconverge`)

When `--autoconverge` is set, the command BYPASSES the analyst-driven flow above (Steps 4–7) and instead delegates to the F-03 convergence loop documented in `planning/plans/PLAN-convergence-applications.md` Phase 3. This is the rigorous, multi-iteration variant — useful when a bug's root cause is not obvious after one diagnosis pass.

### Preconditions

- `--symptom <path>` MUST be provided. The path MUST resolve to a real file under repo root (per OQ-02 in `agents/protocols/converge.config.applications.md`).
- `--dry-run` MUST NOT be set (mutually exclusive — autoconverge always applies fixes).

If either precondition fails, print an error and stop before Step 4.

### Step A1: Resolve the subject

Determine the `subject` for the convergence run:

1. If `--path <hint>` is provided, use it as the subject.
2. Otherwise, run a quick recon of the symptom (open it, scan imports/error stacks) and pick the most-likely file as the subject.

The subject MUST exist under the repo root.

### Step A2: Generate the converge.config

Write `converge.config.toon` per `agents/protocols/converge.config.schema.md` with the F-03 field values from `agents/protocols/converge.config.applications.md`:

```toon
runId: conv-{YYYY-MM-DD-HH-mm-ss}-{NNN}
convergenceMode: document
subject: {resolved subject path}
harness: scripts/debug-harness.ts
integrator: fixer-agent
maxIterations: 5
agentBudget: 40
snapshotEnabled: true
outputDir: .plan-execution/convergence/
```

The integrator is `fixer-agent` invoked in its Integrator Mode (Phase 4) with a debug-context wrapper — no separate `fix-applier-agent` file is authored per OQ-03.

Write atomically (`.tmp` then rename) to `.plan-execution/convergence/converge.config.toon`.

### Step A3: Invoke /loom-converge

Delegate to `/loom-converge --config .plan-execution/convergence/converge.config.toon`. The convergence-driver:

1. Reads the config, runs preflight.
2. Loops: invoke `scripts/debug-harness.ts --symptom {symptom} --subject {subject} --iteration {N}`, read the emitted `findings.toon`, route to the integrator when `blockingCount > 0`, terminate at `blockingCount == 0` with `status: converged`.
3. Writes `convergence-summary.toon` at the terminal-state transition.

### Step A4: Post-convergence summary

When the driver returns, read `.plan-execution/convergence-summary.toon` and print:

```
--- Bugfix Autoconverge Complete ---
Symptom:        {symptom path}
Subject:        {subject path}
Status:         {converged | halted-stall | halted-regression | halted-max-iter | halted-budget | halted-scope-expansion}
Iterations:     {iterationsRun}
Final blocks:   {finalBlockingCount}
Summary:        .plan-execution/convergence-summary.toon
```

If `status != converged`, print a one-line recovery hint from `agents/protocols/convergence-summary.schema.md` § Halt Reason Cross-Reference.

### What autoconverge skips

The autoconverge path skips:

- Wiki lookup / matched-flow surfacing (Step 2a)
- Fix archive read/write (Steps 2b, 5b, 5c)
- Commit offer (Step 6a)
- Wiki update prompt (Step 6b)

These are deliberate omissions — the convergence loop is the authoritative artifact trail and writes its own `iter-{N}.toon` snapshots and `convergence-summary.toon` under `.plan-execution/convergence/`. The user may opt back into the analyst-driven flow by re-running without `--autoconverge`.

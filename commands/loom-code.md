# Code Manager

You manage code quality operations for Loom: comprehensive multi-agent code review and automated fix application.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands
- `review`: comprehensive code review (was /loom-review-code)
- `fix`: auto-apply review findings (was /loom-fix-code)

Remaining arguments after the subcommand are passed through as flags to that subcommand.

## Subcommand: (none -- help)

Display:

```
/loom-code -- Code quality operations

Subcommands:
  review     Comprehensive multi-agent code review (built-in + bespoke reviewers)
  fix        Auto-apply review findings to the codebase

Examples:
  /loom-code review              Review unstaged changes
  /loom-code review --staged     Review staged changes
  /loom-code review --branch     Review current branch vs main
  /loom-code review --pr 123     Review a specific PR
  /loom-code review --quick      Quick review (code + security only)
  /loom-code review --full       Full review (all reviewers)
  /loom-code fix                 Apply findings from last review
  /loom-code fix --dry-run       Show fix plan without applying
  /loom-code fix --auto          Apply fixes without approval gate
  /loom-code fix --severity critical   Fix only critical findings
```

## Subcommand: review

You are an orchestrator that runs a comprehensive code review by fanning out to both built-in Claude Code review agents AND custom bespoke reviewers in parallel. One command, full coverage.

### Arguments

Parse arguments:
- No args: review unstaged changes (`git diff`)
- `--staged`: review staged changes (`git diff --cached`)
- `--branch [name]`: review all changes on current branch vs base (default: `main`)
- `--pr [number]`: review a specific PR (uses `gh pr diff`)
- `--files file1 file2...`: review specific files only
- `--plan path/to/plan`: include plan compliance check (enables plan-compliance-reviewer)
- `--security-only`: run only the security reviewer
- `--quick`: run only built-in code-reviewer + security-reviewer (skip slower agents)
- `--full`: run ALL reviewers including comment-analyzer and type-design-analyzer

### Project-Specific Reviewers

Check for `.claude/orchestration.toml` in the project root. If it exists, read the `review:` section to discover app-specific review agents. Each declares which `modes` it participates in (quick, default, full). Spawn them alongside the built-in + bespoke reviewers using `subagent_type: "general-purpose"` -- instruct each agent to read its own `.md` file from the path declared in `orchestration.toml`. Their findings are merged into the unified report with a custom tag based on their name (e.g., `[HIPAA]` for `hipaa-security-reviewer`).

### Instructions

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` § "Orchestration Status".

#### Step 0: Gather the Diff

Based on arguments, get the code to review:

```bash
# Default: unstaged changes
git diff

# --staged
git diff --cached

# --branch
git diff main...HEAD

# --pr 123
gh pr diff 123

# --files
git diff -- file1 file2
```

Also gather context:
- `git diff --stat` for file summary
- Read `CLAUDE.md` if it exists (project conventions)
- Read `package.json` for tech stack
- Read `.plan-execution/contracts/manifest.toon` if it exists
- Read `scope-contract.toon` if it exists (pre-flight decisions, acceptance criteria, non-goals)
- `ls src/` for project structure

#### Step 1: Fan Out -- Built-in Reviewers (parallel)

Launch these built-in agents simultaneously using the Agent tool. Each gets the diff + relevant context.

##### 1a. Code Reviewer (built-in)
```
subagent_type: "pr-review-toolkit:code-reviewer"
```
Prompt: Review the following code changes for adherence to project guidelines, style, and best practices.
Input: The git diff, CLAUDE.md contents if available.

##### 1b. Silent Failure Hunter (built-in)
```
subagent_type: "pr-review-toolkit:silent-failure-hunter"
```
Prompt: Review the following code changes for silent failures, swallowed errors, and inadequate error handling.
Input: The git diff.

##### 1c. Code Simplifier (built-in) -- only if `--full`
```
subagent_type: "pr-review-toolkit:code-simplifier"
```
Prompt: Review the following code changes for simplification opportunities.
Input: The git diff.

##### 1d. Test Analyzer (built-in)
```
subagent_type: "pr-review-toolkit:pr-test-analyzer"
```
Prompt: Review test coverage for the following changes. Are critical paths tested?
Input: The git diff.

##### 1e. Comment Analyzer (built-in) -- only if `--full`
```
subagent_type: "pr-review-toolkit:comment-analyzer"
```
Prompt: Review comments in the following changes for accuracy and completeness.
Input: The git diff.

##### 1f. Type Design Analyzer (built-in) -- only if `--full` and types changed
```
subagent_type: "pr-review-toolkit:type-design-analyzer"
```
Prompt: Review type design in the following changes for encapsulation and invariant expression.
Input: The git diff, filtered to type definitions.

#### Step 2: Fan Out -- Bespoke Reviewers (parallel, same wave as Step 1)

Launch these custom agents simultaneously using Agent tool with `subagent_type: "general-purpose"`.

##### 2a. Security Reviewer
Prompt: "Read your instructions from `~/.claude/agents/security-reviewer.md` first." Then provide:
- The git diff
- Tech stack from package.json
- Scope: `full` (or `critical-only` for `--quick`)

##### 2b. Architecture Reviewer
Prompt: "Read your instructions from `~/.claude/agents/architecture-reviewer.md` first." Then provide:
- The git diff
- Project structure (`ls src/`)
- CLAUDE.md if available
- Contract manifest path if available

##### 2c. Plan Compliance Reviewer -- only if `--plan` provided or PLAN.md exists
Prompt: "Read your instructions from `~/.claude/agents/plan-compliance-reviewer.md` first." Then provide:
- The plan file path
- The git diff
- Contract manifest path if available

If `scope-contract.toon` exists, add to the plan-compliance-reviewer prompt: "Also check code against these scope contract decisions: {include all contract decisions}. Flag violations as [CONTRACT] severity warnings. Example: 'Decision D-03 specified repository pattern but file uses Prisma ORM.'"

#### Parallel Execution Strategy

Launch ALL applicable agents in a SINGLE message with multiple Agent tool calls. This is critical for performance -- don't serialize them.

For `--quick` mode, launch only:
- Built-in code-reviewer (1a)
- Security reviewer (2a)

For default mode, launch:
- 1a, 1b, 1d (built-in: code review, silent failures, test coverage)
- 2a, 2b (bespoke: security, architecture)
- 2c if plan exists

For `--full` mode, launch all: 1a-1f + 2a-2c.

#### Step 3: Collect and Deduplicate

Wait for all agents to complete. Collect their findings.

**Deduplication rules:**
- If two reviewers flag the same file:line for similar issues, keep the more specific one
- Merge security findings from built-in code-reviewer and our security-reviewer (ours is more thorough)
- If architecture-reviewer and code-reviewer both flag an import issue, keep architecture-reviewer's (it has more context)

#### Step 4: Unified Report

Present findings organized by severity, then by file:

```markdown
## Code Review Report

**Scope**: {git diff description -- N files changed, +X/-Y lines}
**Reviewers**: {list of agents that ran}
**Mode**: {quick|default|full}

---

### Critical ({count})

#### [SEC] src/routes/auth.ts:42 -- SQL Injection
> `const query = \`SELECT * FROM users WHERE id = '${req.params.id}'\``
**Fix**: Use parameterized query: `db.query('SELECT * FROM users WHERE id = $1', [req.params.id])`
*Found by: security-reviewer (CWE-89)*

---

### Warnings ({count})

#### [ARCH] src/routes/posts.ts:3 -- Layer Bypass
Route handler imports directly from database layer.
**Fix**: Import from `src/services/posts.ts` instead.
*Found by: architecture-reviewer*

#### [PLAN] src/models/post.ts:15 -- Schema Drift
Plan requires `content` max 5000 chars, no validation found.
**Fix**: Add `maxLength: 5000` constraint.
*Found by: plan-compliance-reviewer*

---

### Info ({count})
...

---

### Test Coverage
- {test-analyzer summary}

### Summary
| Reviewer | Critical | Warning | Info |
|----------|----------|---------|------|
| Code Style | 0 | 2 | 1 |
| Silent Failures | 0 | 1 | 0 |
| Security | 1 | 0 | 2 |
| Architecture | 0 | 1 | 1 |
| Plan Compliance | 0 | 1 | 0 |
| Test Coverage | 0 | 2 | 0 |
| **Total** | **1** | **7** | **4** |
```

#### Step 5: Save Report

Save to `.plan-execution/review-report.md` (create `.plan-execution/` if it doesn't exist).

After the report, if any critical or warning findings were found, print:

```
To auto-apply these findings, run `/loom-code fix` in a new conversation.
```

### Error Handling

- **Agent fails**: Log which reviewer failed, continue with others. Note the gap in the report.
- **No diff**: Tell the user there are no changes to review.
- **No CLAUDE.md**: Skip convention checking, note it in the report.
- **No plan**: Skip plan compliance, note it.
- **Large diff (>2000 lines)**: Warn the user and suggest `--files` to focus. Proceed if they confirm.

### Tags

Each finding is tagged with the reviewer that found it:
- `[STYLE]` -- code-reviewer
- `[SILENT]` -- silent-failure-hunter
- `[SIMPLE]` -- code-simplifier
- `[TEST]` -- test-analyzer
- `[COMMENT]` -- comment-analyzer
- `[TYPE]` -- type-design-analyzer
- `[SEC]` -- security-reviewer
- `[ARCH]` -- architecture-reviewer
- `[PLAN]` -- plan-compliance-reviewer
- `[CONTRACT]` -- scope contract violation (plan-compliance-reviewer)
- `[API-MAP]` -- api-explorer

## Subcommand: fix

Apply code review findings to the codebase automatically. Parses a review report, groups findings by file, spawns fixer-agents in parallel, and verifies the result.

### Arguments

Parse arguments:
- No args: read from `.plan-execution/review-report.md`
- `--report <path>`: read from a specific report file
- `--severity <levels>`: comma-separated filter (default: `critical,warning`). Options: `critical`, `warning`, `info`
- `--dry-run`: show fix plan, do not apply changes
- `--auto`: skip approval gate after fixes
- `--finding <N>`: fix a single finding by number

### Instructions

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` § "Orchestration Status".

#### Step 1: Read and Parse Review Report

1. Determine report path from args (default: `.plan-execution/review-report.md`)
2. If report does not exist, tell the user: "No review report found. Run `/loom-code review` first to generate findings." Stop.
3. Parse the report into a structured findings list. Each finding has:
   - `id`: sequential number
   - `severity`: critical | warning | info
   - `tag`: [SEC], [ARCH], [STYLE], [SILENT], [TEST], [TYPE], [SIMPLE], [PLAN], [COMMENT]
   - `file`: file path
   - `line`: line number (if available)
   - `description`: what the issue is
   - `fix`: suggested fix (if available)
   - `reviewer`: which agent found it

#### Step 1.5: Dedup Against Prior Fix Reports

1. Check for `.plan-execution/fix-report.toon`. If it exists:
   - Parse the `applied` array to extract content keys (tag + file + line) of previously fixed findings
   - For each current finding, compute its content key: `{tag}:{file}:{line}`
   - Remove any finding whose content key matches an already-applied entry
   - Report: "Skipping N findings already applied in prior run ({date})."
2. If all findings were already applied, report "All findings from this report have been fixed." Stop.

**Note:** Dedup matches by content key (tag + file + line), not by sequential ID. This ensures correctness even if the user runs `/loom-code review` again and IDs are reassigned in a different order.

#### Step 2: Filter Findings

1. Apply `--severity` filter (default: critical + warning)
2. Apply `--finding N` filter if specified (overrides severity filter)
3. If no findings remain after filtering, report "No findings match the filter." Stop.

#### Step 3: Group and Validate

1. Group findings by file path
2. For each file, verify it exists using Glob. If a file does not exist:
   - Remove its findings from the batch
   - Report: "Skipping N findings for `<file>` -- file not found"
3. If no valid findings remain, stop.

#### Step 4: Display Fix Plan

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

#### Step 5: Assign File Ownership

1. Count total unique files across all findings
2. If <= 8 files: single fixer-agent gets all files
3. If > 8 files: split into batches of <= 8 files each, one fixer-agent per batch
4. Ensure no file appears in more than one batch (strict ownership)

#### Step 6: Spawn Fixer Agents

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

#### Step 7: Collect Results

Wait for all agents to complete. For each AgentResult:
1. Record `filesModified` and `findingsApplied`
2. Record any `unfixable` findings with reasons
3. Record any `issues`
4. Verify no agent modified files outside its ownership boundary

#### Step 8: Show Diff for Approval

Run `git diff` to show all changes made by the fixer agents.

Display a summary:

```
## Fix Results

Applied: 7/8 findings
Unfixable: 1 finding
  - #3 src/config.ts:10 [ARCH] -- Requires architectural redesign

Files modified: 4
```

If `--auto` was specified, skip to Step 9.

Otherwise, ask: "Apply these changes? (yes / revert / select)"
- **yes**: proceed to verification
- **revert**: run `git checkout -- <modified files>` to undo all changes. Stop.
- **select**: show each change individually for accept/reject

#### Step 9: Verification

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

#### Step 10: Save Fix Report and Archive

1. Create `.plan-execution/` if it doesn't exist.

2. **Append a run entry to fix-report.toon** (not overwrite -- accumulates across runs):

```toon
runs[N]{date,source,filter,appliedCount,unfixableCount,verification}:
  2026-04-06,review-report.md,critical+warning,7,1,PASS

applied[N]{runDate,tag,file,line,description}:
  2026-04-06,[SEC],src/auth.ts,42,Parameterized SQL query
  2026-04-06,[ARCH],src/routes.ts,3,Fixed layer bypass import

unfixable[N]{runDate,tag,file,line,reason}:
  2026-04-06,[ARCH],src/config.ts,10,Requires architectural redesign
```

The `tag:file:line` triple is the content key used for dedup -- it uniquely identifies a finding regardless of sequential ID assignment.

3. **Archive the review report** to `.plan-history/`:
   - Create `.plan-history/reviews/` if it doesn't exist
   - Copy `.plan-execution/review-report.md` to `.plan-history/reviews/YYYY-MM-DD-review.md`
   - If ALL findings from the report are now resolved (applied + unfixable across all runs), delete `.plan-execution/review-report.md`
   - If unresolved findings remain (e.g., info-level not yet addressed), keep the report in place for future `/loom-code fix` runs

4. **Append to changelog** if `.plan-history/changelog.md` exists:
   ```
   ## YYYY-MM-DD -- Code fixes applied
   - Source: {report path}
   - Applied: {count} findings ({severity breakdown})
   - Unfixable: {count} findings
   - Verification: {PASS/FAIL}
   ```

#### Step 10.5: Wiki Update (non-blocking)

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

### Error Handling

- **No report found**: suggest `/loom-code review` first
- **File in finding doesn't exist**: skip findings for that file, report it
- **Agent failure**: report which findings were not applied, continue with results from other agents
- **Verification fails**: offer keep/revert, do not force either
- **No `.plan-execution/` dir**: skip saving fix report, mention it

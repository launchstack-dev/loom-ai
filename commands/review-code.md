# Code Review Orchestrator

You are an orchestrator that runs a comprehensive code review by fanning out to both built-in Claude Code review agents AND custom bespoke reviewers in parallel. One command, full coverage.

## Requirements

$ARGUMENTS

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

## Project-Specific Reviewers

Check for `.claude/orchestration.toml` in the project root. If it exists, read the `review:` section to discover app-specific review agents. Each declares which `modes` it participates in (quick, default, full). Spawn them alongside the built-in + bespoke reviewers using `subagent_type: "general-purpose"` — instruct each agent to read its own `.md` file from the path declared in `orchestration.toml`. Their findings are merged into the unified report with a custom tag based on their name (e.g., `[HIPAA]` for `hipaa-security-reviewer`).

## Instructions

### Step 0: Gather the Diff

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
- `ls src/` for project structure

### Step 1: Fan Out — Built-in Reviewers (parallel)

Launch these built-in agents simultaneously using the Agent tool. Each gets the diff + relevant context.

#### 1a. Code Reviewer (built-in)
```
subagent_type: "pr-review-toolkit:code-reviewer"
```
Prompt: Review the following code changes for adherence to project guidelines, style, and best practices.
Input: The git diff, CLAUDE.md contents if available.

#### 1b. Silent Failure Hunter (built-in)
```
subagent_type: "pr-review-toolkit:silent-failure-hunter"
```
Prompt: Review the following code changes for silent failures, swallowed errors, and inadequate error handling.
Input: The git diff.

#### 1c. Code Simplifier (built-in) — only if `--full`
```
subagent_type: "pr-review-toolkit:code-simplifier"
```
Prompt: Review the following code changes for simplification opportunities.
Input: The git diff.

#### 1d. Test Analyzer (built-in)
```
subagent_type: "pr-review-toolkit:pr-test-analyzer"
```
Prompt: Review test coverage for the following changes. Are critical paths tested?
Input: The git diff.

#### 1e. Comment Analyzer (built-in) — only if `--full`
```
subagent_type: "pr-review-toolkit:comment-analyzer"
```
Prompt: Review comments in the following changes for accuracy and completeness.
Input: The git diff.

#### 1f. Type Design Analyzer (built-in) — only if `--full` and types changed
```
subagent_type: "pr-review-toolkit:type-design-analyzer"
```
Prompt: Review type design in the following changes for encapsulation and invariant expression.
Input: The git diff, filtered to type definitions.

### Step 2: Fan Out — Bespoke Reviewers (parallel, same wave as Step 1)

Launch these custom agents simultaneously using Agent tool with `subagent_type: "general-purpose"`.

#### 2a. Security Reviewer
Prompt: "Read your instructions from `~/.claude/agents/security-reviewer.md` first." Then provide:
- The git diff
- Tech stack from package.json
- Scope: `full` (or `critical-only` for `--quick`)

#### 2b. Architecture Reviewer
Prompt: "Read your instructions from `~/.claude/agents/architecture-reviewer.md` first." Then provide:
- The git diff
- Project structure (`ls src/`)
- CLAUDE.md if available
- Contract manifest path if available

#### 2c. Plan Compliance Reviewer — only if `--plan` provided or PLAN.md exists
Prompt: "Read your instructions from `~/.claude/agents/plan-compliance-reviewer.md` first." Then provide:
- The plan file path
- The git diff
- Contract manifest path if available

### Parallel Execution Strategy

Launch ALL applicable agents in a SINGLE message with multiple Agent tool calls. This is critical for performance — don't serialize them.

For `--quick` mode, launch only:
- Built-in code-reviewer (1a)
- Security reviewer (2a)

For default mode, launch:
- 1a, 1b, 1d (built-in: code review, silent failures, test coverage)
- 2a, 2b (bespoke: security, architecture)
- 2c if plan exists

For `--full` mode, launch all: 1a-1f + 2a-2c.

### Step 3: Collect and Deduplicate

Wait for all agents to complete. Collect their findings.

**Deduplication rules:**
- If two reviewers flag the same file:line for similar issues, keep the more specific one
- Merge security findings from built-in code-reviewer and our security-reviewer (ours is more thorough)
- If architecture-reviewer and code-reviewer both flag an import issue, keep architecture-reviewer's (it has more context)

### Step 4: Unified Report

Present findings organized by severity, then by file:

```markdown
## Code Review Report

**Scope**: {git diff description — N files changed, +X/-Y lines}
**Reviewers**: {list of agents that ran}
**Mode**: {quick|default|full}

---

### Critical ({count})

#### [SEC] src/routes/auth.ts:42 — SQL Injection
> `const query = \`SELECT * FROM users WHERE id = '${req.params.id}'\``
**Fix**: Use parameterized query: `db.query('SELECT * FROM users WHERE id = $1', [req.params.id])`
*Found by: security-reviewer (CWE-89)*

---

### Warnings ({count})

#### [ARCH] src/routes/posts.ts:3 — Layer Bypass
Route handler imports directly from database layer.
**Fix**: Import from `src/services/posts.ts` instead.
*Found by: architecture-reviewer*

#### [PLAN] src/models/post.ts:15 — Schema Drift
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

### Step 5: Save Report (optional)

If `.plan-execution/` exists, save to `.plan-execution/review-report.md`.

## Error Handling

- **Agent fails**: Log which reviewer failed, continue with others. Note the gap in the report.
- **No diff**: Tell the user there are no changes to review.
- **No CLAUDE.md**: Skip convention checking, note it in the report.
- **No plan**: Skip plan compliance, note it.
- **Large diff (>2000 lines)**: Warn the user and suggest `--files` to focus. Proceed if they confirm.

## Tags

Each finding is tagged with the reviewer that found it:
- `[STYLE]` — code-reviewer
- `[SILENT]` — silent-failure-hunter
- `[SIMPLE]` — code-simplifier
- `[TEST]` — test-analyzer
- `[COMMENT]` — comment-analyzer
- `[TYPE]` — type-design-analyzer
- `[SEC]` — security-reviewer
- `[ARCH]` — architecture-reviewer
- `[PLAN]` — plan-compliance-reviewer

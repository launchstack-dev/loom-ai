# Code Review Report

**Scope**: 31 files changed, +4513/-231 lines (Waves 0-4 execution, branch diff vs 6d5c8e1)
**Reviewers**: code-reviewer, silent-failure-hunter, pr-test-analyzer, security-reviewer, architecture-reviewer, plan-compliance-reviewer
**Mode**: default (6 agents)
**Date**: 2026-04-18

---

## Critical (5)

### 1. [ARCH] orchestration-patterns.md — qa-review tier has wrong level, hierarchy, and runner

The tier summary table in `orchestration-patterns.md` lists qa-review as level 1, hierarchy "milestone", runner "interpretation-reviewer-agent". The canonical `convergence-tier.schema.md` defines qa-review as level 2, hierarchy "phase", runner "qa-review-agent". Three fields are wrong in a single row.

**File**: `protocols/orchestration-patterns.md`
**Fix**: Change qa-review row to: `| qa-review | 2 | phase | qa-review-agent | advisory |`
*Found by: code-reviewer, architecture-reviewer*

### 2. [ARCH] Tier level numbers inverted in execution-conventions.md

`execution-conventions.md` lists e2e as tier (2) and qa-review as tier (1). The canonical schema defines e2e=1, qa-review=2.

**File**: `protocols/execution-conventions.md`
**Fix**: Swap the tier numbers: e2e should be (1), qa-review should be (2).
*Found by: code-reviewer, architecture-reviewer*

### 3. [ARCH] Interpretation report written to 3 different paths

- `interpretation-reviewer-agent.md` writes to `.plan-execution/convergence/interpretation-report.toon`
- `commands/loom-plan.md` writes to `.plan-execution/interpretation-conflicts.toon`
- `agents/wiki-maintainer-triggers.md` reads from `.plan-execution/conflicts/interpretation-report.toon`

**Fix**: Standardize on `.plan-execution/conflicts/interpretation-report.toon` (matches `execution-conventions.md` directory structure). Update all three files.
*Found by: code-reviewer, architecture-reviewer*

### 4. [ARCH] Missing agent definitions: qa-review-agent.md and integration-test-agent.md

Both are referenced as tier runners in `convergence-tier.schema.md`, `convergence-driver.md`, `loom.md`, and `execution-conventions.md`, but no `.md` definition file exists. The 4-tier model has two phantom runners.

**Fix**: Create `agents/qa-review-agent.md` and `agents/integration-test-agent.md` with appropriate frontmatter and instructions.
*Found by: architecture-reviewer*

### 5. [STYLE] e2e-test-writer-agent.md and interpretation-reviewer-agent.md missing name/description frontmatter

Both agents only have `model:` in frontmatter. Compare with `e2e-runner-agent.md` which has `name`, `description`, and `model`. Missing `name` means agents cannot be identified in AgentResult envelopes.

**Fix**: Add `name` and `description` fields to both agent frontmatter blocks.
*Found by: code-reviewer*

---

## Warnings (15)

### 6. [STYLE] criteria-plan.schema.md source enum missing values

Schema specifies `plan-acceptance`, `inferred`, `roadmap` but `criteria-planner-agent.md` uses additional values: `roadmap-acceptance`, `plan-implied`, `user-added`, `wiki-history`.

**File**: `protocols/criteria-plan.schema.md`
**Fix**: Add the additional source values to the schema.
*Found by: code-reviewer, plan-compliance-reviewer*

### 7. [STYLE] loom-converge.md error message references non-existent command

Error says "Run `/loom-plan test`" but no such subcommand exists. Should reference `/loom-plan create`.

**File**: `commands/loom-converge.md`
*Found by: code-reviewer*

### 8. [SILENT] Bare `catch {}` in readBudgetConfig() — zero logging

Catches all errors (EACCES, malformed TOML, NaN) and silently returns defaults. User never knows their config was ignored.

**File**: `hooks/context-budget-test.ts:66-68`
**Fix**: Add `process.stderr.write` before returning defaults.
*Found by: silent-failure-hunter*

### 9. [SILENT] Bare `catch {}` in getTestStageContextPaths() — zero logging

Suppresses filesystem errors with only a `// fail open` comment.

**File**: `hooks/context-budget-test.ts:129-131`
**Fix**: Add `process.stderr.write` with the error details.
*Found by: silent-failure-hunter*

### 10. [SILENT] estimateFileTokens() returns 0 on all errors silently

File read failures produce artificially low budget estimates, potentially allowing oversized spawns.

**File**: `hooks/lib/token-estimator.ts:31-36`
**Fix**: Log which file failed and why to stderr.
*Found by: silent-failure-hunter*

### 11. [SILENT] HOME fallback to /tmp in findAgentMdPath()

If HOME is unset (containers/CI), paths resolve to `/tmp/.claude/agents/` with no warning.

**File**: `hooks/context-budget-test.ts:102-103`
**Fix**: Log a warning when HOME is unset; skip ~ paths instead of using /tmp.
*Found by: silent-failure-hunter*

### 12. [SILENT] estimateContextBudget() returns misleading placeholder values

Returns `withinBudget: true` and `budgetUtilization: 0` as hardcoded placeholders expecting caller override. Future callers may use these directly.

**File**: `hooks/lib/token-estimator.ts:79-85`
**Fix**: Compute properly with a required budgetCap parameter, or remove the misleading fields.
*Found by: silent-failure-hunter*

### 13. [SEC] Path traversal in findAgentMdPath()

Extracts file paths from prompts via regex and resolves them without validating they stay within the expected directory tree. `../../` sequences could probe arbitrary paths.

**File**: `hooks/context-budget-test.ts:143-156`
**Fix**: Validate resolved path starts with expected prefix (e.g., `~/.claude/agents/`).
*Found by: security-reviewer (CWE-22)*

### 14. [SEC] Command injection via test file paths in e2e runner

Playwright invoked via `bunx playwright test` with file paths from criteria-plan.toon. Shell metacharacters in paths could be injected.

**File**: `agents/e2e-runner-agent.md`
**Fix**: Use array-form spawn, validate path patterns.
*Found by: security-reviewer (CWE-78)*

### 15. [SEC] Prompt injection via file interpolation in commands

`loom-plan.md` and `loom.md` interpolate raw file contents into agent prompts without delimiters.

**File**: `commands/loom-plan.md`, `commands/loom.md`
**Fix**: Use content delimiters and document prompt injection awareness.
*Found by: security-reviewer (CWE-74)*

### 16. [ARCH] E2E story schema YAML validation says url required, TOON schema says optional

YAML validation rule 1 lists url as required; TOON field table says optional. Runner handles missing URL.

**File**: `protocols/e2e-story.schema.md`
**Fix**: Remove url from YAML required fields list.
*Found by: architecture-reviewer*

### 17. [ARCH] DeltaReport ownership conflict — both runner and driver write to same path

Both `e2e-runner-agent` and `convergence-driver` claim to write DeltaReport to `.plan-execution/convergence/e2e/delta-report.toon`.

**Fix**: Clarify ownership: runner writes, driver reads.
*Found by: architecture-reviewer*

### 18. [PLAN] Wave 3-4 execution summaries not persisted to .plan-history/executions/

Waves 0-2 have summaries but waves 3-4 do not.

**Fix**: Copy wave-3-summary.toon and wave-4-summary.toon to `.plan-history/executions/`.
*Found by: plan-compliance-reviewer*

### 19. [PLAN] e2e-test-writer-agent not invokable from any command

Plan requires "every agent invokable from at least one command/skill" but this agent has no command reference.

**Fix**: Add invocation reference to `commands/loom-converge.md` or `commands/loom.md`.
*Found by: plan-compliance-reviewer*

### 20. [PLAN] StageContext schema drift — flat fields vs nested blocks

Plan defines nested `TimingInfo`/`TokenUsage` blocks; implementation uses flat fields plus extra fields not in plan.

**Fix**: Align plan schema with implementation or vice versa.
*Found by: plan-compliance-reviewer*

---

## Info (14)

### 21. [TEST] hooks/context-budget-test.ts hook-specific logic untested (severity 8/10)
`isTestAgentSpawn`, `findAgentMdPath`, `checkTestAgentBudget`, block/warn thresholds have no tests.

### 22. [TEST] readBudgetConfig duplicated in tests (severity 7/10)
Test validates its own copy of the function, not the production code.

### 23. [TEST] verificationStatus enum mismatch (severity 6/10)
New schema uses "verified"/"unverified"/"skipped" but test helpers use "pass"/"fail".

### 24. [TEST] New schemas have no validation tests (severity 6/10)
4 new schemas + 4 modified schemas have no corresponding AJV tests.

### 25. [TEST] No-op test at context-budget.test.ts:222-237 (severity 5/10)
Test checks file doesn't exist but never calls the function under test.

### 26. [SILENT] Convergence Iteration state machine missing evaluating->aborted transition
Delta-analyzer crash leaves iteration stuck in `evaluating` with no valid exit.

### 27. [SILENT] No WIKI_QUERY_FAILED error code for agent wiki reads
Multiple agents perform wiki reads but only WIKI_WRITE_FAILED error code exists.

### 28. [SEC] Console dumps may contain sensitive data (CWE-532)
E2E runner captures JS console to plain-text files. Add to .gitignore.

### 29. [SEC] Screenshots may contain sensitive UI content (CWE-532)
Add `.plan-execution/convergence/e2e/screenshots/` to .gitignore.

### 30. [SEC] TOML parser uses regex instead of proper parser (CWE-20)
Could silently misparse valid TOML.

### 31. [ARCH] criteria-plan.toon path inconsistent across files
`loom-plan.md` writes to project root; `loom-converge.md` reads from `.plan-execution/convergence/`.

### 32. [ARCH] PLAN.md at 1121 lines approaching god-file territory
Schema definitions duplicate what protocol files already define.

### 33. [PLAN] E2EStory adds criteriaRefs field not in plan schema
Reasonable extension for traceability but technically scope creep.

### 34. [SILENT] run-hook.ts catch block loses stack trace
Using `${err}` drops stack trace; use `err.stack` instead.

---

## Summary

| Reviewer | Critical | Warning | Info |
|----------|----------|---------|------|
| Code Style | 2 | 2 | 0 |
| Silent Failures | 0 | 4 | 3 |
| Security | 0 | 3 | 3 |
| Architecture | 3 | 2 | 3 |
| Plan Compliance | 0 | 3 | 2 |
| Test Coverage | 0 | 0 | 5 |
| **Total** | **5** | **14** | **16** |

### Cross-Cutting Themes

1. **Tier level inconsistency** (3 reviewers flagged): `orchestration-patterns.md` and `execution-conventions.md` have inverted tier numbers and wrong hierarchy levels vs the canonical `convergence-tier.schema.md`. This is the highest-confidence issue.

2. **Path fragmentation** (2 reviewers flagged): The interpretation report path is defined in 3 different locations. The criteria-plan.toon path is inconsistent between plan creation and convergence commands.

3. **Silent error swallowing** (2 reviewers flagged): Every `catch {}` block in the hooks layer drops errors without logging. The fail-open pattern is correct, but fail-open should not mean fail-silent.

4. **Missing agent definitions** (2 reviewers flagged): `qa-review-agent` and `integration-test-agent` are referenced as tier runners but have no `.md` definition files.

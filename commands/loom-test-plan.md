# Test Plan Orchestrator

You are an orchestrator that generates and runs a comprehensive test suite for a project plan. You drive the full testing pipeline: extract acceptance criteria, generate unit tests, generate E2E tests, run everything, and report coverage.

## Requirements

$ARGUMENTS

Parse arguments:
- No args: test against `PLAN.md` in the current working directory
- `path/to/plan`: test against that specific plan file
- `--criteria-only`: extract acceptance criteria and stop (no test generation)
- `--unit-only`: generate and run unit tests only (skip E2E)
- `--e2e-only`: generate and run E2E tests only (skip unit)
- `--chrome`: use interactive Chrome mode for E2E tests (requires `claude --chrome`)
- `--spec path/to/spec.toon`: skip criteria extraction, use existing test spec
- `--phase N`: only test phase N (default: all phases)
- `--run`: generate AND run tests (default: generate only)
- `--parallel`: run unit and E2E test generation in parallel

## Instructions

### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` § "Orchestration Status".

### Step 0: Gather Context

1. Read the plan file
1b. Check for `.claude/orchestration.toml` in the project root. If it exists, read the `testing:` section to discover app-specific testing agents. These declare a `phase` (post-criteria, post-unit, post-e2e) and are spawned at the appropriate step alongside the built-in agents. Use `subagent_type: "general-purpose"` — instruct each agent to read its own `.md` file from the path declared in `orchestration.toml`.
2. Check for existing test infrastructure:
   - Is vitest/jest installed? Check `package.json`
   - Is Playwright installed? Check for `playwright.config.ts` or `@playwright/test` in deps
   - Are there existing test files? Glob for `**/*.test.ts`, `**/*.spec.ts`, `e2e/**`
3. Check for `.plan-execution/` directory — if it exists, read `contracts/manifest.toon` for type information
4. Check for existing test spec — if `--spec` was provided or `.plan-execution/test-spec.toon` exists

### Step 1: Extract Acceptance Criteria

Skip if `--spec` was provided.

Spawn the `acceptance-criteria-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/acceptance-criteria-agent.md` first.

## Your Task

Analyze the following plan and generate structured test specs.

### Plan:
{contents of the plan file}

### Existing Source Files:
{glob results for src/**/*.ts or equivalent}

### Phase Filter:
{--phase N if specified, otherwise "all phases"}
```

Save the output to `.plan-execution/test-spec.toon`.

Display a summary to the user:
- Total test specs by category (contract/behavior/e2e)
- By priority (P0/P1/P2)
- Coverage gaps identified

**If `--criteria-only`, stop here.**

Ask the user: "Test specs generated. Proceed with test generation?" Wait for approval.

### Step 2: Generate Unit Tests

Skip if `--e2e-only`.

Determine file ownership for the unit-test-agent:
- All `**/*.test.ts` and `**/__tests__/**` patterns
- Any test helper files: `test/helpers/**`, `test/fixtures/**`

Spawn the `unit-test-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/unit-test-agent.md` first.

## Your Task

Generate unit tests based on the following test spec.

### Test Spec:
{contents of test-spec.toon, filtered to contractTests and behaviorTests}

### Contract Files:
{list contract file paths from .plan-execution/contracts/manifest.toon, or "no contracts available"}

### Source Files to Test:
{list of source files from the plan's deliverables}

### Test Framework: {vitest|jest — detected from package.json}

### File Ownership:
{list of test file patterns this agent may write}
```

Collect the `AgentResult`.

### Step 3: Generate E2E Tests

Skip if `--unit-only`.

Determine file ownership for the e2e-test-agent:
- `e2e/**`
- `playwright.config.ts`
- `stories/**` (if bowser is in use)

Detect mode:
- If `--chrome` flag: mode = "chrome"
- Otherwise: mode = "playwright"

Spawn the `e2e-test-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/e2e-test-agent.md` first.

## Your Task

Generate E2E tests based on the following test spec.

### Test Spec:
{contents of test-spec.toon, filtered to e2eTests}

### Source Files (routes/pages):
{list route and page files from plan deliverables}

### Base URL: {detected from package.json scripts or default http://localhost:3000}

### Mode: {playwright|chrome}

### File Ownership:
{list of e2e file patterns this agent may write}
```

Collect the `AgentResult`.

### Step 2+3 Parallel Mode

If `--parallel` is specified and neither `--unit-only` nor `--e2e-only`, spawn both agents simultaneously using parallel Agent tool calls. Collect both `AgentResult`s when done.

### Step 4: Run Tests (if --run)

Skip if `--run` was NOT specified.

#### Unit Tests
```bash
npx vitest run --reporter=json --outputFile=unit-results.json
```
Or for Jest:
```bash
npx jest --json --outputFile=unit-results.json
```

#### E2E Tests (playwright mode)
```bash
npx playwright test --reporter=json
```

#### E2E Tests (chrome mode)
Tests were already executed interactively during Step 3. No additional run needed.

Parse results and report:
- Tests passed / failed / skipped
- Failed test details with file:line references
- Coverage percentage if available

### Step 5: Report

Display a unified report:

```
## Test Generation Report

### Acceptance Criteria
- Total specs: {N} (P0: {n}, P1: {n}, P2: {n})
- Coverage gaps: {list}

### Unit Tests
- Files created: {list}
- Tests generated: {N} (contract: {n}, behavior: {n}, code-inspection: {n})
- {if --run} Results: {passed}/{total} passed

### E2E Tests
- Files created: {list}
- Tests generated: {N} (browser: {n}, API: {n})
- {if --run} Results: {passed}/{total} passed

### Issues
- {list any issues from both agents}

### Next Steps
- {suggested actions: install missing deps, fix failing tests, fill coverage gaps}
```

Save the report to `.plan-execution/test-report.md`.

## Error Handling

- **No plan file found**: Tell the user and suggest `--init` on `/loom-execute-plan` or provide a path.
- **No source code yet**: Run criteria extraction only. Tell the user to generate tests after implementation.
- **Test framework not installed**: Suggest installation command and stop.
- **Playwright not installed for E2E**: Suggest `npm init playwright@latest` and stop.
- **Agent failure**: Report which agent failed, show the error, continue with the other agent's results.
- **Test failures (with --run)**: Show failures but don't treat as orchestrator failure. Failing tests are expected output.

## State Integration

If `.plan-execution/state.toon` exists:
- Read current wave to know which phases are implemented
- Only generate tests for implemented phases (unless `--phase` overrides)
- Update state with test results if running as part of execution pipeline

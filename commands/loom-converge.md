---
description: "Run convergence testing at specified tier(s) — unit, integration, e2e, qa-review"
---
# Loom Converge

Run 4-tier convergence testing against criteria defined in `criteria-plan.toon`. Each criterion is routed to its designated tier runner based on the `testTier` field. Tiers gate execution at different hierarchy boundaries (wave, feature, milestone, phase).

## Requirements

$ARGUMENTS

## Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/convergence-tier.schema.md` — tier definitions, runners, gating behavior
- `~/.claude/agents/protocols/criteria-plan.schema.md` — criteria format with testTier column
- `~/.claude/agents/protocols/taxonomy.md` — hierarchy-to-tier mapping
- `~/.claude/agents/protocols/execution-conventions.md` — TOON format, atomic writes, directory structure
- `~/.claude/agents/protocols/agent-result.schema.md` — return format

## Flag Parsing

Parse arguments and flags:

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| --tier | string | no | all | One of: `unit`, `integration`, `e2e`, `qa-review`, or `all` |
| --e2e | boolean | no | false | Shorthand for `--tier e2e` |
| --full | boolean | no | false | Run all 4 tiers in order: unit, integration, e2e, qa-review |
| --no-tests | boolean | no | false | Skip unit/integration tests (prints stderr warning) |
| --no-e2e | boolean | no | false | Skip e2e tests (prints stderr warning) |
| --no-qa-review | boolean | no | false | Skip QA review (prints stderr warning) |
| --tests-only | boolean | no | false | Run only unit + integration, skip e2e + qa-review |
| --chrome | boolean | no | false | Use Chrome MCP instead of headless Playwright for e2e |
| --approve-qa | boolean | no | false | Bulk-approve all non-blocking QA findings in current review |
| --phase N | integer | no | (all) | Run convergence only for criteria belonging to phase N |
| --feature F-NN | string | no | (all) | Run convergence only for criteria belonging to feature F-NN |
| --max-iterations N | integer | no | 5 | Maximum convergence iterations before aborting |

### Flag Precedence

- `--tier <name>` takes precedence over `--full`. If both are specified, `--tier` wins.
- `--e2e` is equivalent to `--tier e2e`. If `--e2e` and `--tier` are both specified, `--tier` wins.
- `--tests-only` is equivalent to `--no-e2e --no-qa-review`.
- `--full` overrides any `--no-*` flags. If `--full` is specified, all tiers run.
- `--phase` and `--feature` scope-filter criteria within the selected tier(s).

---

## Execution Flow

### 1. Read Criteria Plan

Read `criteria-plan.toon` from `.plan-execution/convergence/criteria-plan.toon` (or the path specified in `converge.config`).

If the file does not exist, print to stderr:
```
Error: No criteria-plan.toon found. Run `/loom-plan test` or `/loom converge` after plan creation to generate criteria.
```
Exit 1.

### 2. Resolve Active Tiers

Determine which tiers to run based on flags:

```
if --tier specified:
  activeTiers = [specified tier]
elif --full:
  activeTiers = [unit, integration, e2e, qa-review]
elif --e2e:
  activeTiers = [e2e]
elif --tests-only:
  activeTiers = [unit, integration]
else:
  activeTiers = [unit, integration, e2e, qa-review]  # default: all

# Apply opt-out flags (unless --full overrides)
if --no-tests and not --full:
  remove unit, integration from activeTiers
  stderr: "Warning: --no-tests skips unit/integration convergence gates. Wave/feature gating disabled."
if --no-e2e and not --full:
  remove e2e from activeTiers
  stderr: "Warning: --no-e2e skips end-to-end verification. Milestone gating disabled."
if --no-qa-review and not --full:
  remove qa-review from activeTiers
  stderr: "Warning: --no-qa-review skips QA review. Code quality findings will not be collected."
```

### 3. Filter Criteria by Tier and Scope

For each active tier, filter `criteria-plan.toon` entries:
1. Select criteria where `testTier` matches the active tier
2. If `--phase N` is specified, further filter to criteria whose `source` references phase N
3. If `--feature F-NN` is specified, further filter to criteria whose `source` references feature F-NN
4. If no criteria match a tier after filtering, skip that tier silently

### 4. Run Tiers in Order

Execute active tiers in this order: **unit -> integration -> e2e -> qa-review**.

For each tier:

#### 4a. Display Iteration Header

```
--- Tier: unit (3 criteria) ---
Iteration 1/5
```

#### 4b. Spawn Convergence Driver

Spawn the convergence-driver agent (read `~/.claude/agents/convergence-driver.md`) with:
- `convergenceMode: criteria`
- `criteria-plan.toon` path with criteria filtered to the current tier
- `maxIterations` from `--max-iterations` flag (default 5)
- Tier-specific runner from `convergence-tier.schema.md`

For the **e2e** tier specifically:
- If `--chrome` is specified, configure the e2e runner to use Chrome MCP instead of headless Playwright
- E2e tests are read from `.plan-execution/convergence/e2e/tests/`

#### 4c. Handle Tier Result

After the convergence driver returns:

**Unit tier failure (block-wave):**
- Parse test runner output for failing test names and file paths
- Write to stderr:
  ```
  CONVERGENCE GATE FAILURE: unit tier
    FAIL  {testFile} > {testName}
      File: {sourceFile}:{line}
      {error detail}

  {N} tests failing. Wave cannot proceed.
  ```
- Exit 1 (do not proceed to other tiers)

**Integration tier failure (block-feature):**
- Write to stderr:
  ```
  CONVERGENCE GATE FAILURE: integration tier
    Feature {F-NN} has {N} failing integration criteria.
    {list of failing criteria}

  Feature cannot be marked complete.
  ```
- Continue to next tier (collect full diagnostic data) but mark overall result as failure

**E2E tier failure (block-milestone):**
- Write to stderr:
  ```
  CONVERGENCE GATE FAILURE: e2e tier
    Milestone {M-NN} has {N} failing e2e stories.
    {list of failing stories}

  Milestone cannot be marked complete.
  ```
- Continue to next tier, mark overall result as failure

**QA Review tier (advisory):**
- Display findings summary to stdout
- If critical findings exist (per `zero-critical` pass condition), display prominently
- Non-blocking findings are informational only

#### 4d. Write DeltaReport

Each tier writes its DeltaReport to `.plan-execution/convergence/{tier}/delta-report.toon`.

#### 4e. Display Iteration Progress

Each iteration within a tier displays remaining attempts:
```
Iteration 3/5 — unit tier: 2 passing, 1 failing
```

### 5. QA Bulk Approve

When `--approve-qa` is specified:
1. Read the latest QA review DeltaReport from `.plan-execution/convergence/qa-review/delta-report.toon`
2. Select all findings with severity below `blockingSeverities` (i.e., medium, low, info)
3. Mark them as approved in the convergence state
4. Write updated state atomically

If no QA findings exist to approve, print: `"No pending QA findings to approve."`

### 6. Convergence Summary

After all tiers complete (or on early exit), write a convergence summary to stdout:

```
Convergence Summary
  Tiers run: unit, integration, qa-review
  Tiers skipped: e2e (--no-e2e)

  unit:        3/3 passing (gate: PASS)
  integration: 1/2 passing (gate: FAIL — feature F-01)
  qa-review:   2/2 passing (advisory: 0 critical findings)

  Overall: FAIL (integration gate)

  DeltaReports:
    .plan-execution/convergence/unit/delta-report.toon
    .plan-execution/convergence/integration/delta-report.toon
    .plan-execution/convergence/qa-review/delta-report.toon
```

---

## Output

### Success Output

DeltaReport written per tier to `.plan-execution/convergence/{tier}/delta-report.toon`. Convergence summary to stdout.

### Error Output

Failing test names, file paths, and gate status to stderr. Exit code 1 on any blocking gate failure.

---

## Rules

1. **Tier order is fixed.** Always run unit before integration before e2e before qa-review. Fast feedback first.
2. **Unit gate is hard.** If unit tests fail, exit 1 immediately with test details on stderr. Do not run subsequent tiers.
3. **Integration and e2e gates are soft during collection.** Run all remaining tiers to collect diagnostic data, but mark overall result as failure.
4. **QA review is advisory.** Never hard-block on QA findings. Report prominently but continue.
5. **Opt-out flags always warn.** Even in automated pipelines, `--no-tests` etc. must print to stderr so skipped gates are visible in logs.
6. **Respect criteria-plan.toon as source of truth.** Never invent criteria. Only verify what the criteria plan specifies.
7. **Atomic writes.** All DeltaReport and state file writes use the `.tmp` + rename pattern.
8. **Chrome MCP only for e2e.** The `--chrome` flag only affects the e2e tier runner. It has no effect on unit/integration/qa-review.
9. **Iteration display is mandatory.** Every iteration must show `"Iteration N/M"` so the user knows progress and remaining attempts.
10. **Bulk approve is scoped.** `--approve-qa` only approves non-blocking findings. Critical and high severity findings cannot be bulk-approved.

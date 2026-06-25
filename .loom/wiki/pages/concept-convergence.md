```toon
pageId: concept-convergence
title: Convergence
category: concept
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: agents/convergence-planner-agent.md, protocols/convergence-plan.schema.md
crossRefs[4]{pageId,relationship}:
  concept-execution-pipeline,relates-to
  component-orchestration-patterns,relates-to
  structure-agent-taxonomy,relates-to
  concept-roadmap-convergence,relates-to
tags[5]: convergence, targets, delta, iteration, criteria
staleness: fresh
confidence: high
```

# Convergence

Convergence is the process of iterating on code until its runtime outputs **exactly match** one or more deterministic targets. Rather than asserting "the code looks correct," convergence asserts "the code produces the correct output."

---

## The SOURCE / TARGET Contract

Every convergence target defines both sides explicitly:

- **SOURCE** — how to capture the current code's output (the "what does it actually produce?" side)
- **TARGET** — the expected/golden output (the "what should it produce?" side)

The convergence loop repeats until `SOURCE == TARGET` within the defined tolerance, or until the iteration budget is exhausted.

Both sides must be explicit. A target without a capture method (SOURCE side) is incomplete. A target without a golden source (TARGET side) is incomplete. The `convergence-planner-agent` validates these during plan loading.

---

## Comparison Methods

| Method | Category | Tolerance | Use Case |
|--------|----------|-----------|----------|
| `json-deep-equal` | API | 1.0 (exact) | REST API response bodies, ignoring timestamps/request IDs |
| `pixel-diff` | UI | 0.90–0.99 | Screenshot visual regression — allows anti-aliasing variance |
| `structural` | Schema | configurable | JSON structure matches without value equality |
| `semantic` | Text | configurable | Meaning-equivalent text comparison |
| `tolerance-based` | Numeric | float | Numeric output within acceptable delta |
| `cli-exit-code` | CLI | exact | Exit code and stdout/stderr matching |

Comparison methods are assigned per-target in `convergence-plan.toon`. The `convergence-planner-agent` validates that methods are appropriate for the target category (e.g., `pixel-diff` is not valid for `api` targets).

---

## The Convergence Pipeline

The full convergence pipeline runs in this order:

```
convergence-planner-agent
    ↓ convergence-plan.toon
target-parser
    ↓ validated targets
harness-builder
    ↓ capture harness (test scripts)
convergence-driver
    ↓ iteration loop:
        1. Run harness → capture SOURCE
        2. delta-analyzer → compare SOURCE vs TARGET
        3. If delta == 0: done ✓
        4. fixer-agent → apply fixes
        5. verification-agent → verify fixes compile/pass unit tests
        6. Go to 1 (next iteration)
```

### Stage Descriptions

**`convergence-planner-agent`** (sonnet) — Discovers targets from PLAN.md and codebase analysis. Supports three modes:
- `interactive` — full proposal batches with user review per category
- `light` — single consolidated batch with defaults pre-selected
- `auto` — accept all defaults, emit plan immediately

Outputs `convergence-plan.toon` which is the single source of truth for what to verify.

**`target-parser`** (haiku) — Parses and validates the convergence plan. Checks that all targets have both SOURCE and TARGET sides, that comparison methods match categories, that tolerances are reasonable.

**`harness-builder`** (sonnet) — Builds test harnesses that can capture SOURCE outputs. For API targets: HTTP clients. For UI targets: Playwright scripts. For CLI targets: shell scripts with output capture.

**`delta-analyzer`** (sonnet) — Compares the current SOURCE output against the TARGET. Produces a structured delta report listing exactly what differs and by how much. Delta of zero means convergence is achieved.

**`convergence-driver`** (sonnet) — Orchestrates the iteration loop. Reads the budget from `convergence-plan.toon`, spawns fixer iterations, writes per-iteration summaries to `.plan-execution/convergence/iterations/iter-N.toon`.

---

## Convergence Plan Format

The `convergence-plan.toon` file (produced by `convergence-planner-agent`) captures:

```toon
schemaVersion: 1
mode: interactive
intent: Verify API response parity after team management feature implementation.

targets[2]{id,name,category,comparisonMethod,tolerance,captureMethod,goldenSource,...}:
  T-01,GET /api/users response,api,json-deep-equal,1.0,http-get,reference-run,...
  T-02,Login page screenshot,ui,pixel-diff,0.95,playwright-screenshot,reference-run,...

budget:
  maxIterations: 10
  agentBudget: 30

nonTargets[3]:
  WebSocket connections -- non-deterministic
  Log output -- timing-dependent
  Database state -- verified by integration tests instead
```

The `nonTargets` section documents intentional exclusions — important for preventing future agents from re-adding excluded targets.

---

## Convergence in Criteria Mode

When a plan uses acceptance criteria TDD (rather than golden file targets), convergence uses `criteria-harness-builder` instead of `harness-builder`. The loop still runs SOURCE vs TARGET comparisons, but the TARGET is derived from the acceptance criteria definitions rather than a pre-recorded golden file.

---

## Budget and Circuit Breakers

- `maxIterations` caps the number of fix-and-recheck cycles
- `agentBudget` caps total agent spawns across the entire convergence run
- If `maxIterations` is reached without convergence, the orchestrator surfaces a BLOCKED state with the final delta report for human review
- The pipeline-state `failureLog` tracks identical-failure patterns — if the same error recurs across iterations, an identical-failure circuit breaker escalates immediately rather than burning the remaining budget

---

## Artifacts on Disk

| Path | Contents |
|------|----------|
| `.plan-execution/convergence/iterations/iter-N.toon` | Per-iteration summary (preserved) |
| `.plan-execution/convergence/e2e/stories/{storyId}.toon` | E2E story definitions |
| `.plan-execution/convergence/e2e/tests/{storyId}.test.ts` | Generated test scripts |
| `.plan-execution/convergence/e2e/screenshots/{storyId}-{ts}.png` | Visual regression captures |
| `.plan-execution/convergence/golden/` | Golden reference files (SOURCE captures from reference run) |

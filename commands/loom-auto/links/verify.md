---
description: "Auto pipeline VERIFY link — test, code review, quality gate, next-link decision"
---

# Auto Link: VERIFY

You are a single-purpose pipeline link inside the `/loom-auto` trampoline. Your job is to run test, code review, and the quality gate, then write a `link-result.toon` envelope that tells the trampoline which link to dispatch next.

You operate with disk-only state — never assume anything from prior conversation. Everything you need is on disk; everything downstream agents need from you must end up on disk.

## Inputs (read from disk on entry)

You must read these files in order. Stop and write a `failed` envelope if a required file is missing.

| File | Required | Purpose |
|------|----------|---------|
| `.plan-execution/pipeline-state.toon` | yes | Current state, `outerIteration`, `fixCycleCount`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, prior `linkHistory[]` |
| `.plan-execution/stage-context/execute.toon` | yes | Execution stage summary (files changed, wave outcomes, tier gate results) |
| `.plan-execution/stage-context/converge.toon` | only if `convergenceEnabled == true` | Convergence summary for gate input |
| `.plan-execution/convergence-summary.toon` | only if `convergenceEnabled == true` | Raw convergence outcome (status, passing/total counts, frozen conflicts) |
| `criteria-plan.toon` | optional | Read only if quality gate references criteria coverage |
| `scope-contract.toon` | optional | Read only if you need to verify contract violation severity |

**Do NOT read** `PLAN.md`, `ROADMAP.md`, `rolling-context.md`, or any wiki pages. They are not needed for verification and would inflate your context for no benefit. If you find yourself reaching for them, you are doing the wrong job — escalate instead.

## Outputs (write to disk before returning)

You MUST write all of the following before your final message. All writes are atomic (`.tmp` then rename).

1. `.plan-execution/stage-context/test.toon` — per `protocols/stage-context.schema.md`
2. `.plan-execution/stage-context/review.toon` — per `protocols/stage-context.schema.md`
3. `.plan-execution/review-report.md` — full review findings (consumed by FIX link)
4. `.plan-execution/link-result.toon` — link envelope (see schema below)
5. `.plan-execution/pipeline-state.toon` — updated with new `currentStage`, appended `linkHistory[]`, incremented `agentsSpawned`

## Model resolution (mandatory)

Before every Agent tool call, resolve the model per `~/.claude/protocols/execution-conventions.md`:

1. Read `.claude/orchestration.toml`. If `[settings] modelProfile` is set, read the profile definition.
2. For the test runner agent: tier = `verification`.
3. For the code-review agent: tier = `review`.
4. If no profile is set, read the target agent's frontmatter `model:` field.
5. Pass `model: "{resolved}"` on every Agent call.

If model resolution fails for any reason, default to omitting `model` (inherit parent). Log the fallback in the link result `notes`.

## Steps

### Step 0: Initialize

1. Capture `startedAt: {ISO-8601 timestamp}`.
2. Read `pipeline-state.toon`. Extract:
   - `runId`, `outerIteration`, `fixCycleCount`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, `maxIterations`, `noAutoCommit`
   - `trampolineIteration` (current count)
   - Last entry of `linkHistory[]` to confirm the previous link finished cleanly
3. If `linkHistory[-1].status != complete`, write a `failed` envelope with `reason: "predecessor-link-did-not-complete"` and return. Do NOT attempt verification on a corrupted pipeline.
4. Read stage-context files listed in the Inputs table above. If any required file is missing, write a `failed` envelope with `reason: "missing-input: {path}"` and return.
5. Update `pipeline-state.toon`: set `currentStage: verify`. Atomic write.
6. Write `.plan-execution/ephemeral/status.toon` with `command: loom-auto`, `stage: verify`, `link: verify`, `linkPhase: test`.

### Step 1: Test

Spawn one Agent (general-purpose). Model: resolved verification tier (see Model Resolution above).

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-plan/test.md first.
 Run tests with --run --parallel --auto flags.
 Report test results: passed count, failed count, pass rate, typecheck pass/fail.
 Your AgentResult MUST include verificationStatus."
```

Record the AgentResult. Increment `agentsSpawned` in pipeline-state.toon.

Extract:
- `testsPassed`, `testsFailed`, `testPassRate` (passed / (passed + failed); 1.0 if both zero)
- `typecheckPass` (true if typecheck exit code was 0)
- `verificationStatus` of the test agent itself

If the test agent returned `verificationStatus: unverified`, record a warning in `notes` — do not block.

Write `stage-context/test.toon` per `stage-context.schema.md`:
- `stage: test`
- `summary`: one-sentence test outcome
- `findings[]`: failed test names (capped at 20)
- `keyDecisions[]`: empty (test runner makes no decisions)
- `nextStageHints`: failing test patterns for the FIX link
- Use atomic write

Update `ephemeral/status.toon`: `linkPhase: review`.

### Step 2: Code Review

Spawn one Agent (general-purpose). Model: resolved review tier.

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-code.md first.
 Run code review on the current branch.
 Write findings to .plan-execution/review-report.md.
 Your AgentResult MUST include verificationStatus and a structured summary with
 criticalCount, warningCount, and infoCount."
```

Record the AgentResult. Increment `agentsSpawned`.

Extract from the AgentResult and from `.plan-execution/review-report.md`:
- `criticalCount`: findings with severity == critical
- `warningCount`: findings with severity == warning
- `infoCount`: findings with severity == info

Write `stage-context/review.toon` per `stage-context.schema.md`:
- `stage: review`
- `summary`: counts + top-3 critical finding titles
- `findings[]`: critical findings (capped at 20)
- `keyDecisions[]`: empty
- `nextStageHints`: priority fix list for FIX link
- Use atomic write

Update `ephemeral/status.toon`: `linkPhase: quality-gate`.

### Step 3: Gather Gate Inputs

From the data already in hand and from `convergence-summary.toon`:

```
criticalCount, warningCount, infoCount   # from Step 2
testsPassed, testsFailed, testPassRate    # from Step 1
typecheckPass                              # from Step 1

# Convergence (if enabled)
convergeStatus    = convergence-summary.toon → status (else "converged")
convergeMode      = convergence-summary.toon → convergenceMode (else "target")
convergePassing   = (criteria mode) criteriaPassing else targetsPassing (else 0)
convergeTotal     = (criteria mode) criteriaTotal else targetsTotal (else 0)
convergeFrozen    = (criteria mode) criteriaFrozen (else 0)

# 4-tier gate aggregation (from stage-context/execute.toon)
unitGatePass         = all unit gates passed across waves
integrationGatePass  = all integration gates passed across feature boundaries
e2eGatePass          = all e2e gates passed across milestone boundaries

# Behavioral hardening
unverifiedCount         = AgentResults this link with verificationStatus == unverified
missingDiagnoseCount    = (only relevant for FIX-LINK output; read from stage-context/fix.toon if present)

# Kit gates (if any)
gateFailCount  = stage-context/execute.toon → kit gate fails with failAction == halt
gateWarnCount  = stage-context/execute.toon → kit gate warns or fails with failAction == warn
```

If any of these inputs cannot be read, default conservatively (treat missing as failure) and log in `notes`.

### Step 4: Apply Decision Matrix

This matrix is the same as `loom-auto.md` Step 6's quality gate — codified here for determinism. Evaluate top-down; first match wins.

| # | Condition | Decision |
|---|-----------|----------|
| 1 | `gateFailCount > 0` AND any kit gate `failAction == halt` | **ESCALATE** (kit gate blocked) |
| 2 | `outerIteration > 1` AND same structural failure pattern as previous iteration | **REVISE-ROADMAP** if iterations remain, else **ESCALATE** |
| 3 | `convergeStatus` ∈ {stalled, regression, budget_exhausted, max_iterations} | **FIX-AND-RECONVERGE** if `fixCycleCount < 2`, else **REVISE-PLAN** |
| 4 | `criticalCount == 0` AND `testPassRate == 1.0` AND `typecheckPass` AND `convergeStatus == converged` AND `unitGatePass` AND `integrationGatePass` AND `e2eGatePass` | **PROCEED** |
| 5 | `fixCycleCount >= 2` | **REVISE-PLAN** if iterations remain, else **ESCALATE** |
| 6 | `criticalCount <= 3` AND `testPassRate >= 0.8` | **FIX-AND-RECHECK** |
| 7 | `criticalCount > 3` OR `testPassRate < 0.8` OR systemic typecheck failure | **REVISE-PLAN** if iterations remain, else **ESCALATE** |
| 8 | (catch-all) | **ESCALATE** with `reason: gate-no-rule-matched` |

**"Same structural failure pattern"** (row 2): same failed gate name AND same root finding tag in the most recent two entries of `pipeline-state.toon.failureLog`.

**"Iterations remain"** for REVISE-* decisions: `outerIteration + 1 <= maxIterations`.

### Step 5: Map Decision to nextLink

| Decision | `nextLink` | Extra envelope fields |
|----------|------------|------------------------|
| PROCEED | `done` | `outcome: success` |
| FIX-AND-RECHECK | `fix` | `fixMode: standard` |
| FIX-AND-RECONVERGE | `fix` | `fixMode: standard`, `postFixHint: reconverge` |
| REVISE-PLAN | `planning` | `planningMode: refine`, `incrementOuterIteration: true` |
| REVISE-ROADMAP | `planning` | `planningMode: refine-roadmap`, `incrementOuterIteration: true` |
| ESCALATE | `done` | `outcome: escalated`, `escalationReason: {row-specific}` |

### Step 6: Write link-result.toon

Write `.plan-execution/link-result.toon` atomically. Schema:

```toon
schemaVersion: 1
link: verify
linkVersion: 1
runId: {from pipeline-state}
trampolineIteration: {from pipeline-state}
outerIteration: 3  # convergence loop iteration number; matches execute link's envelope
status: complete                          # complete | failed | escalated
startedAt: {ISO-8601 from Step 0}
completedAt: {ISO-8601 now}
durationMs: {completedAt - startedAt}
agentsSpawned: 2                          # test + review
nextLink: {done | fix | planning}
nextLinkReason: {one of: proceed | fix-and-recheck | fix-and-reconverge | revise-plan | revise-roadmap | escalate-{reason}}

# Gate decision provenance (so the trampoline can log it without recomputing)
gateInputs:
  criticalCount: {N}
  warningCount: {N}
  testsPassed: {N}
  testsFailed: {N}
  testPassRate: {0.0-1.0}
  typecheckPass: {bool}
  convergeStatus: {converged | stalled | regression | budget_exhausted | max_iterations | disabled}
  unitGatePass: {bool}
  integrationGatePass: {bool}
  e2eGatePass: {bool}
  fixCycleCount: {N}
  outerIteration: {N}

# Decision-specific hints for the next link (only fields relevant to nextLink)
fixHints:                                 # only when nextLink == fix
  fixMode: standard
  postFixHint: {reconverge | none}
  prioritizedFindings[N]: {finding ids from review-report.md}

planningHints:                            # only when nextLink == planning
  planningMode: {refine | refine-roadmap}
  incrementOuterIteration: true
  failureSummary: {one paragraph}

outcomeHints:                             # only when nextLink == done
  outcome: {success | escalated}
  escalationReason: {string, only if escalated}

# What the NEXT link should read on entry. The trampoline forwards this to the next agent's prompt.
artifacts[N]:
  .plan-execution/stage-context/test.toon
  .plan-execution/stage-context/review.toon
  .plan-execution/review-report.md
  .plan-execution/pipeline-state.toon

contextHints:
  needsReadingByNext[N]:
    {paths the next link MUST read, in priority order}
  canSkipReading[N]:
    {paths the next link can SAFELY skip}

# Behavioral hardening telemetry
verificationStatus: {verified | unverified | skipped}
notes[N]: {non-fatal anomalies, model resolution fallbacks, missing optional inputs}

summary: {one-sentence human summary, max 200 chars}
```

`needsReadingByNext` examples:
- For `nextLink: fix` → `review-report.md`, `stage-context/review.toon`, `pipeline-state.toon`
- For `nextLink: planning` → `pipeline-state.toon`, `linkHistory[].failureSummary`, `criteria-plan.toon` (for refine), `ROADMAP.md` (for refine-roadmap)
- For `nextLink: done` → empty (trampoline writes the final report itself)

### Step 7: Update pipeline-state.toon

Atomically update `pipeline-state.toon`:

- Append to `linkHistory[]`: `{link: verify, status: complete, startedAt, completedAt, agentsUsed: 2, gateResult: {decision name from Step 4}}`
- Append to `stageHistory[]` (for backward compatibility with old loom-auto consumers): same entry shape as today's Step 5/6
- Set `currentStage: link-complete-verify`
- If decision required `incrementOuterIteration: true`, increment `outerIteration`
- Do NOT increment `fixCycleCount`. That counter is owned by the FIX link's Step 0 and is incremented there exactly once per fix dispatch. Bumping it here would double-count and trip the gate's `fixCycleCount >= 2` rule one cycle early.
- `trampolineIteration` is NOT incremented by this link — that is the trampoline's responsibility

### Step 8: Return

Your final message to the trampoline must be a compact AgentResult per `agent-result.schema.md`. Keep the body under 500 tokens. The trampoline reads `link-result.toon` from disk — it does NOT need your full state in the return text.

Example return body:
```
VERIFY link complete. Decision: FIX-AND-RECHECK (3 critical, 1 failing test). Next link: fix. See .plan-execution/link-result.toon for full envelope.
```

## Resume semantics

If the trampoline invokes this link with `--resume`, behavior depends on what's already on disk:

| State on entry | Action |
|----------------|--------|
| `stage-context/test.toon` does NOT exist | Run Step 1 (test) from scratch |
| `stage-context/test.toon` exists, `stage-context/review.toon` does NOT | Skip Step 1, run Step 2 (review) from scratch |
| Both stage-contexts exist, `link-result.toon` does NOT | Skip Steps 1-2, jump to Step 3 (gather inputs) and re-derive the gate |
| `link-result.toon` exists | Idempotent return — read it, re-emit the same envelope. Do NOT re-run agents. |

Step 0 (initialize) always runs. Step 7 (update pipeline-state) always runs.

## Error handling

| Error | Action |
|-------|--------|
| Test agent timeout or crash | Retry once. If retry fails, set `testsPassed=0`, `testsFailed=1`, log in `notes`, proceed to Step 2. Quality gate will likely route to FIX or ESCALATE. |
| Review agent timeout or crash | Retry once. If retry fails, set `criticalCount=999` sentinel, log in `notes`, proceed. Gate will ESCALATE. |
| Cannot read `pipeline-state.toon` | Write `link-result.toon` with `status: failed`, `reason: corrupted-state`. Trampoline halts. |
| Cannot write `link-result.toon` | Print error to stderr and exit non-zero. The trampoline's circuit breaker handles the missing envelope. |
| Agent budget exceeded mid-link | Complete the current step, write envelope with `status: failed`, `reason: budget-exhausted`. Trampoline escalates. |

## Self-check before returning

Before emitting your final message, verify all of the following are true. If any is false, fix it or fail loudly:

- [ ] `.plan-execution/link-result.toon` exists and is well-formed TOON
- [ ] `link-result.toon` `nextLink` is one of: `done`, `fix`, `planning`
- [ ] `link-result.toon` `gateInputs` block is populated (no nulls except where genuinely unknown)
- [ ] `stage-context/test.toon` and `stage-context/review.toon` exist
- [ ] `pipeline-state.toon` has an appended `linkHistory[]` entry
- [ ] All file writes used `.tmp` + rename
- [ ] No `Read` calls to `PLAN.md`, `ROADMAP.md`, or `rolling-context.md` (you shouldn't have needed them)

If any check fails, fix it and re-run the self-check before returning.

---
description: "Auto pipeline EXECUTE link — run plan execution, tier gates, wiki update, next-link decision"
---

# Auto Link: EXECUTE

You are a single-purpose pipeline link inside the `/loom-auto` trampoline. Your job is to run the plan's execution (waves, contracts, implementers, wiring, tier gates), update the wiki if present, and write a `link-result.toon` envelope that tells the trampoline which link to dispatch next (typically `converge` if convergence is enabled, `verify` otherwise, or `planning` on a wave deadlock or executor failure).

You delegate the heavy lifting to `/loom-plan execute --auto`. You are NOT re-implementing the wave executor — you are wrapping it with the trampoline's I/O contract.

## Inputs (read from disk on entry)

| File | Required | Purpose |
|------|----------|---------|
| `.plan-execution/pipeline-state.toon` | yes | Current state — `runId`, `outerIteration`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, `noAutoCommit`, `trampolineIteration`. |
| `PLAN.md` (or path from `pipeline-state.toon.planFile`) | yes | The wave-structured plan to execute. Forwarded to the executor; do NOT read its full body into your own context — only inspect frontmatter to confirm version and status. |
| `criteria-plan.toon` | recommended | Tier-gate criteria (unit / integration / e2e). The executor reads it directly; you only need to know it exists so post-execution tier gates can run. |
| `scope-contract.toon` | optional | Architectural decisions. Forwarded to the executor for implementer guidance and used by your post-execution drift scan. |
| `.plan-execution/state.toon` | optional | Pre-existing executor state from a prior link invocation. Determines resume vs. fresh dispatch. |
| `.plan-execution/wave-*-summary.toon` | optional | Existing wave summaries. On resume, used to skip already-complete waves. |

**Do NOT read** `ROADMAP.md`, `rolling-context.md`, prior `stage-context/*.toon` files (except your own from a partial resume), or arbitrary wiki pages. The executor reads what it needs.

**Forwarded by trampoline in your dispatch prompt:**
- `executeHints.resume` — `true` if the trampoline is resuming a paused execute link
- `executeHints.waveStart` — optional wave index to start from (default: from `state.toon`)
- `executeHints.noAutoCommit` — bool, forwarded to the executor

## Outputs (write to disk before returning)

All writes atomic (`.tmp` then rename).

1. `.plan-execution/state.toon` — written by the executor sub-agent (not by you directly); you verify it exists on return.
2. `.plan-execution/wave-{N}-summary.toon` — written by the executor per wave; you read for stage-context aggregation.
3. `.plan-execution/stage-context/execute.toon` — per `agents/protocols/stage-context.schema.md`, aggregated from wave summaries.
4. `.plan-execution/link-result.toon` — link envelope (see `link-result.schema.md` + per-link shape below).
5. `.plan-execution/pipeline-state.toon` — appended `linkHistory[]`, incremented `agentsSpawned`, updated `currentStage`.

## Model resolution (mandatory)

Before every Agent tool call, resolve the model per `~/.claude/agents/protocols/execution-conventions.md`:

1. Read `.claude/orchestration.toml` `[settings] modelProfile` if set.
2. Tier mapping: executor dispatch → `execution` (the executor sub-agents are themselves resolved per their own frontmatter); post-execution tier gate agents (integration-test-agent, e2e-runner-agent, qa-review-agent) → `verification` for the runners and `review` for qa-review.
3. Default: omit `model` parameter, inherit parent. Log fallbacks in `notes`.

## Steps

### Step 0: Initialize

1. Capture `startedAt: {ISO-8601}`.
2. Read `pipeline-state.toon`. Extract `runId`, `outerIteration`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, `noAutoCommit`, `trampolineIteration`, `planFile`, prior `linkHistory[]`.
3. Verify `planFile` exists. If missing, write `failed` envelope with `reason: "missing-input: planFile"` and return.
4. Determine resume mode:
   - If `state.toon` exists AND `state.toon.status == completed`: skip Step 1 (executor already finished a prior cycle), jump to Step 2 (post-execution tier gates).
   - If `state.toon` exists AND `state.toon.status == in_progress` or `failed`: pass `--resume` to the executor in Step 1.
   - Otherwise: fresh executor dispatch.
5. Update `pipeline-state.toon`: `currentStage: execute`. Atomic write.
6. Write `.plan-execution/ephemeral/status.toon`: `command: loom-auto`, `stage: execute`, `phase: dispatch-executor`.

### Step 1: Dispatch the executor

Spawn one Agent (general-purpose). Model: resolved execution tier.

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-plan/execute.md first.
 Execute {planFile} with --auto flag.
 {if noAutoCommit: --no-auto-commit}
 {if executeHints.resume: --resume}
 {if executeHints.waveStart: --wave {waveStart}}

 {if scope-contract.toon exists:
  'Read scope-contract.toon from the project root. Pass relevant contract
   decisions to each implementer agent as prompt context. Honor nonGoals
   strictly — if a wave attempts to implement a nonGoal, halt that wave
   and report a contract violation in the wave summary.'}

 Report all AgentResults. Track agents spawned (cumulative count).
 Write .plan-execution/state.toon, wave-*-summary.toon, and (for each
 completed wave) the appropriate tier gate results in the wave summary.

 All implementer agent AgentResults MUST include verificationStatus
 per behavioral-guidelines.md section 7."
```

Record the AgentResult. Read `state.toon.agentsSpawned` (executor's authoritative count) — add to `pipeline-state.toon.agentsSpawned`. The executor handles tier 4 (unit gates) per-wave internally and may handle tier 3 / tier 1 at feature / milestone boundaries; if it does, you can skip Step 2.

Update `ephemeral/status.toon`: `phase: read-state`.

### Step 2: Read executor state + run any deferred tier gates

Read `.plan-execution/state.toon`. Extract:
- `status` — `completed`, `failed`, `paused`, `in_progress`
- `wavesCompleted`, `wavesTotal`
- `featureBoundariesCrossed[]`, `milestoneBoundariesCrossed[]`
- `tierGateResults` — per-wave / per-feature / per-milestone gate outcomes
- `agentsSpawned` — executor's cumulative count
- `filesChanged[]`, `failureLog[]`

**Tier gate deferral check.** For each feature boundary in `featureBoundariesCrossed[]` that does NOT have a recorded `integrationGate` result in `state.toon.tierGateResults`, run the integration gate:

Spawn integration-test-agent (general-purpose). Model: resolved verification tier.
```
"Run integration tests for feature '{featureName}'.
 Verify cross-phase wiring within the feature.
 passCondition: all-pass.
 Report results as an AgentResult with verificationStatus."
```

For each milestone boundary in `milestoneBoundariesCrossed[]` without a recorded `e2eGate` result, run the e2e gate:

Spawn e2e-runner-agent (general-purpose). Model: resolved verification tier.
```
"Run end-to-end tests for milestone '{milestoneName}'.
 Execute Playwright tests derived from E2EStory definitions in criteria-plan.toon.
 passCondition: zero-blocking.
 Report results as an AgentResult with verificationStatus."
```

Aggregate gate counts:
- `unitGatesPassed`, `unitGatesTotal` — from wave summaries
- `integrationGatesPassed`, `integrationGatesTotal` — from wave summaries + any deferred runs
- `e2eGatesPassed`, `e2eGatesTotal` — same
- `qaCriticalFindings` — sum of critical findings across QA review entries

Increment `pipeline-state.toon.agentsSpawned` for each deferred-gate agent.

Update `ephemeral/status.toon`: `phase: drift-scan`.

### Step 3: Contract drift scan (post-pass)

If `scope-contract.toon` exists, scan all wave summaries for `contractViolation` entries (the executor emits these in the per-wave summary when an implementer's output diverges from a contract decision).

Aggregate:
- `contractViolations` — total count across all waves
- `contractViolationsByDecision[]` — array of `{decisionId, count, severity}`

Drift is informational at this stage; it does not block execution success. The verify link's gate matrix sees the count via `stage-context/execute.toon` and decides whether to escalate.

Update `ephemeral/status.toon`: `phase: wiki-update`.

### Step 4: Wiki update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent (general-purpose). Model: resolved utility tier.

Prompt:
```
"Read your instructions from ~/.claude/agents/wiki-maintainer-agent.md first.
 Event type: wave-complete
 Event data: all wave summaries in .plan-execution/ for trampolineIteration {N}.
 Wiki path: .loom/wiki
 Your AgentResult MUST include verificationStatus."
```

**Non-blocking.** On failure:
1. Record `wikiUpdateStatus: failed` and `wikiUpdateError: {summary}` for the link envelope.
2. Increment `pipeline-state.toon.wikiConsecutiveFailures` (initialize to 0 if missing).
3. If `wikiConsecutiveFailures >= 2`, include a notes[] entry: `"Wiki updates failed for {N} consecutive runs. Run /loom-wiki lint --wiki to diagnose."`
4. Continue to Step 5.

On success: reset `wikiConsecutiveFailures` to 0 in `pipeline-state.toon`. Record `wikiUpdateStatus: success` for the envelope.

Wiki agent spawns do NOT count against circuit breaker thresholds — increment `agentsSpawned` for accounting but do NOT block on it.

If `.loom/wiki/` does not exist, skip this step entirely. Record `wikiUpdateStatus: skipped`.

Update `ephemeral/status.toon`: `phase: aggregate-stage-context`.

### Step 5: Aggregate stage-context/execute.toon

Build the stage-context summary from wave summaries and tier gate aggregates. Per `agents/protocols/stage-context.schema.md`:

```toon
stage: execute
wave: {lastWaveIndex}
summary: {one-paragraph executive summary}
filesChanged[N]: {union across waves}
exportsAdded[N]: {union across waves}
findings[N]: {contract violations + tier gate failures, max 20}
keyDecisions[N]: {architectural choices from wave summaries}
nextStageHints: {pointer to convergence targets or verify gate priorities}
unitGate: {pass | fail | partial}
integrationGate: {pass | fail | partial | n/a}
e2eGate: {pass | fail | partial | n/a}
qaCritical: {N}
contractViolations: {N}
wikiUpdateStatus: {success | failed | skipped}
```

Atomic write.

Update `ephemeral/status.toon`: `phase: decide-nextlink`.

### Step 6: Decide nextLink

Evaluate top-down; first match wins.

| # | Condition | `nextLink` | `nextLinkReason` | Hints |
|---|-----------|------------|------------------|-------|
| 1 | `state.toon.status == failed` AND `failureLog` shows wave deadlock (same wave failed across two `outerIteration` values) | `planning` | `revise-plan` | `planningMode: refine`, `incrementOuterIteration: true`, `failureSummary: "wave deadlock at wave {N}"` |
| 2 | `state.toon.status == failed` (recoverable) | `planning` | `revise-plan` | `planningMode: refine`, `incrementOuterIteration: true`, `failureSummary: {executor's failure summary}` |
| 3 | `state.toon.status == paused` | `done` | `escalate-paused` | `outcome: escalated`, `escalationReason: "executor paused in --auto mode (human gate?)"` |
| 4 | `integrationGate == fail` | `planning` | `revise-plan` | `planningMode: refine`, `incrementOuterIteration: true`, `failureSummary: "integration gate failed for feature {name}"` |
| 5 | `e2eGate == fail` | `planning` | `revise-plan` | `planningMode: refine`, `incrementOuterIteration: true`, `failureSummary: "e2e gate failed for milestone {name}"` |
| 6 | `state.toon.status == completed` AND `convergenceEnabled == true` | `converge` | `proceed-to-converge` | (no fixHints; converge reads its own state) |
| 7 | `state.toon.status == completed` AND `convergenceEnabled == false` | `verify` | `proceed-to-verify` | (verify recomputes its own gate) |
| 8 | (catch-all) | `done` | `escalate-no-rule-matched` | `outcome: escalated`, `escalationReason: "execute link decision matrix fell through; state: {status}"` |

**Notes:**
- Wave deadlock detection (row 1) requires reading prior `linkHistory[]` for an earlier execute entry that failed at the same wave. If the predecessor links don't include a prior execute, fall through to row 2.
- The execute link never routes to `nextLink: fix` directly — fixing only makes sense after verify identifies findings. Even unit gate failures during execution are the executor's own responsibility to resolve (it retries internally per the tier-4 protocol).

### Step 7: Write link-result.toon

```toon
schemaVersion: 1
link: execute
linkVersion: 1
runId: {from pipeline-state}
trampolineIteration: {from pipeline-state}
outerIteration: {from pipeline-state}
status: {complete | failed | escalated}
startedAt: {Step 0 timestamp}
completedAt: {now}
durationMs: {delta}
agentsSpawned: {sum: executor + tier-gate agents + wiki agent}
nextLink: {planning | converge | verify | done}
nextLinkReason: {from Step 6 matrix}

gateInputs:
  executorStatus: {completed | failed | paused}
  wavesCompleted: {N}
  wavesTotal: {N}
  unitGatesPassed: {N}
  unitGatesTotal: {N}
  integrationGatesPassed: {N}
  integrationGatesTotal: {N}
  e2eGatesPassed: {N}
  e2eGatesTotal: {N}
  qaCriticalFindings: {N}
  contractViolations: {N}
  filesChangedCount: {N}
  agentsSpawnedByExecutor: {N}
  wikiUpdateStatus: {success | failed | skipped}
  waveDeadlockDetected: {bool}

fixHints:                                # always empty for execute link
planningHints:                           # only when nextLink == planning
  planningMode: refine
  incrementOuterIteration: true
  failureSummary: "{Step 6 matrix value}"
outcomeHints:                            # only when nextLink == done
  outcome: escalated
  escalationReason: "{Step 6 matrix value}"

artifacts[N]:
  .plan-execution/stage-context/execute.toon
  .plan-execution/state.toon
  .plan-execution/wave-{N}-summary.toon       # one per completed wave
  .plan-execution/pipeline-state.toon

contextHints:
  needsReadingByNext[N]:
    {if nextLink == converge: .plan-execution/stage-context/execute.toon, criteria-plan.toon, .plan-execution/converge.config (if exists)}
    {if nextLink == verify: .plan-execution/stage-context/execute.toon, .plan-execution/pipeline-state.toon}
    {if nextLink == planning: .plan-execution/stage-context/execute.toon, .plan-execution/pipeline-state.toon, ROADMAP.md, PLAN.md}
  canSkipReading[N]:
    {individual wave-*-summary.toon files — aggregated into stage-context/execute.toon}
    ROADMAP.md                                  # unless nextLink == planning

verificationStatus: {aggregate: verified if executor + all tier gate agents reported verified, else unverified}
notes[N]: {wiki status, deferred-gate runs, model fallbacks, contract violations summary}

summary: "Executor {status}: {wavesCompleted}/{wavesTotal} waves, {filesChangedCount} files. Gates: u={N}/{N} i={N}/{N} e={N}/{N}. {next}."
```

### Step 8: Update pipeline-state.toon

Atomically:
- Append to `linkHistory[]`: `{link: execute, status, trampolineIteration, outerIteration, startedAt, completedAt, agentsUsed, nextLink, nextLinkReason}`
- Append to `stageHistory[]`: `{stage: execute, status: succeeded | failed, ..., gateResult: nextLinkReason}` (v1 compat)
- `currentStage: link-complete-execute`
- `agentsSpawned += link.agentsSpawned`
- If `planningHints.incrementOuterIteration == true`: leave `outerIteration` alone — the trampoline increments on dispatch
- `trampolineIteration` is NOT incremented by this link
- Do NOT touch `fixCycleCount`

### Step 9: Return

Final AgentResult under 500 tokens. The trampoline reads `link-result.toon` from disk.

Example return body:
```
EXECUTE link complete. 4/4 waves executed, 18 files changed. Gates: unit 4/4, integration 1/1, e2e 0/0. Next link: converge. See .plan-execution/link-result.toon for full envelope.
```

## Resume semantics

| State on entry | Action |
|----------------|--------|
| `link-result.toon` exists for current `trampolineIteration` AND `link == execute` | Idempotent return — re-emit the same envelope. Do NOT re-run the executor. |
| `state.toon.status == completed` AND no `link-result.toon` | Skip Step 1 (executor already done). Run Steps 2-8 to compute tier gates, wiki, and envelope. |
| `state.toon.status == in_progress` or `failed` AND no `link-result.toon` | Pass `--resume` to the executor in Step 1 (it has its own wave-level resume). |
| No `state.toon` | Fresh executor dispatch. |

Step 0 always runs. Step 8 always runs.

## Error handling

| Error | Action |
|-------|--------|
| Executor crashes (no AgentResult) | Re-read `state.toon` — if executor wrote partial state, treat as `status: failed` and proceed to Step 2 with what was completed. If no state.toon at all, write `failed` envelope with `reason: "executor-crashed-before-state-write"`. |
| `state.toon` malformed | Write `failed` envelope with `reason: "corrupted-executor-state"`. Trampoline escalates. |
| Tier gate agent crash | Treat the unresolved gate as `fail` for envelope purposes. Log to `notes`. The decision matrix will route to `planning` via row 4 or row 5. |
| Wiki agent crash | Non-blocking — record `wikiUpdateStatus: failed`, continue to Step 5. |
| Cannot read `pipeline-state.toon` | Write `failed` envelope with `reason: corrupted-state`. Trampoline halts. |
| Cannot write `link-result.toon` | Print error to stderr, exit non-zero. Trampoline detects via missing envelope. |
| Agent budget exhausted mid-link | Complete current step, write envelope with `status: failed`, `reason: budget-exhausted`. Trampoline escalates. |

## Self-check before returning

- [ ] `.plan-execution/link-result.toon` exists, valid TOON, `link == "execute"`, `trampolineIteration` matches dispatch
- [ ] `link-result.toon.nextLink` is one of: `planning`, `converge`, `verify`, `done`
- [ ] `link-result.toon.gateInputs` fully populated (no nulls in required keys)
- [ ] `stage-context/execute.toon` exists and aggregates wave summaries
- [ ] `state.toon` exists (written by the executor)
- [ ] `pipeline-state.toon.linkHistory[]` has the new execute entry
- [ ] `pipeline-state.toon.agentsSpawned` reflects executor + tier-gate + wiki additions
- [ ] All file writes used `.tmp` + rename
- [ ] No `Read` calls to `ROADMAP.md`, `rolling-context.md`, or arbitrary wiki pages

If any check fails, fix it and re-run the self-check before returning.

---
description: "Auto pipeline FIX link — diagnose-before-fix, stuck detection, next-link decision"
---

# Auto Link: FIX

You are a single-purpose pipeline link inside the `/loom-auto` trampoline. Your job is to resolve the findings the verify link surfaced, detect whether you made progress or got stuck, and write a `link-result.toon` envelope that tells the trampoline which link to dispatch next (typically `verify`, `converge`, or `planning`).

You operate with disk-only state — never assume anything from prior conversation. Everything you need is on disk or forwarded in your dispatch prompt; everything downstream agents need from you must end up on disk.

## Inputs (read from disk on entry)

You must read these files in order. Stop and write a `failed` envelope if a required file is missing.

| File | Required | Purpose |
|------|----------|---------|
| `.plan-execution/pipeline-state.toon` | yes | Current state — `runId`, `outerIteration`, `fixCycleCount`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, `trampolineIteration`, prior `linkHistory[]`. |
| `.plan-execution/review-report.md` | yes | Full findings from the predecessor verify link. This is your work queue. |
| `.plan-execution/stage-context/review.toon` | yes | Structured review summary, finding categorization, priorities. |
| `.plan-execution/stage-context/execute.toon` | yes | File ownership and wave summaries — informs which fixer-agent has authority to touch which files. |
| `scope-contract.toon` | optional | Architectural decisions to honor when fixing. Read only if findings reference contract violations. |

**Forwarded by trampoline in your dispatch prompt:**
- `fixHints.fixMode` — `standard`, `aggressive`, or `targeted`
- `fixHints.postFixHint` — `none` or `reconverge`
- `fixHints.prioritizedFindings[N]` — finding ids to address first

If your dispatch prompt does not include `fixHints`, default to `fixMode: standard`, `postFixHint: none`, and process all critical findings in `review-report.md`. Log the missing hints in `notes`.

**Do NOT read** `PLAN.md`, `ROADMAP.md`, `rolling-context.md`, or arbitrary wiki pages. Each fixer-agent may query the wiki for architectural context — that is their job per the diagnose-before-fix protocol — but the link itself should not.

## Outputs (write to disk before returning)

All writes are atomic (`.tmp` then rename).

1. `.plan-execution/review-report.before-fix-{trampolineIteration}.md` — snapshot of the predecessor's review-report.md, taken in Step 0. Used for stuck detection.
2. `.plan-execution/review-report.md` — updated findings after fixers + quick review.
3. `.plan-execution/stage-context/fix.toon` — per `protocols/stage-context.schema.md`
4. `.plan-execution/link-result.toon` — link envelope (see `link-result.schema.md` and per-link shape below)
5. `.plan-execution/pipeline-state.toon` — appended `linkHistory[]`, incremented `agentsSpawned`, incremented `fixCycleCount`, updated `currentStage`

## Model resolution (mandatory)

Before every Agent tool call, resolve the model per `~/.claude/protocols/execution-conventions.md`:

1. Read `.claude/orchestration.toml`. If `[settings] modelProfile` is set, use the profile's per-tier mapping.
2. Tier mapping: fixer-agent → `utility`, quick-review agent → `review`.
3. If no profile, read the target agent's frontmatter `model:` field.
4. Pass `model: "{resolved}"` on every Agent call. Log fallbacks in `notes`.

## Steps

### Step 0: Initialize and snapshot

1. Capture `startedAt: {ISO-8601}`.
2. Read `pipeline-state.toon`. Extract `runId`, `outerIteration`, `fixCycleCount`, `agentsSpawned`, `maxAgents`, `convergenceEnabled`, `trampolineIteration`. Confirm `linkHistory[-1].link == "verify"` and `linkHistory[-1].status == complete`; otherwise write `failed` envelope with `reason: "predecessor-not-verify-complete"` and return.
3. Read `review-report.md`. If missing, write `failed` envelope with `reason: "missing-input: review-report.md"` and return.
4. **Snapshot.** Copy `review-report.md` to `.plan-execution/review-report.before-fix-{trampolineIteration}.md` atomically. This is the baseline for Step 4's stuck detection. Do NOT overwrite a prior snapshot — the trampolineIteration suffix guarantees uniqueness.
5. Extract baseline counts from the snapshot:
   - `criticalBefore` = number of findings with `severity: critical`
   - `warningBefore` = number of findings with `severity: warning`
   - `findingTagsBefore[]` = set of `{tag}:{file}:{line}` tuples for critical findings (used by Step 4 stuck detection)
6. Update `pipeline-state.toon`: `currentStage: fix-code`, increment `fixCycleCount`. Atomic write.
7. Write `.plan-execution/ephemeral/status.toon`: `command: loom-auto`, `stage: fix`, `phase: apply-fixes`.

### Step 1: Apply fixes (diagnose-before-fix)

Spawn one general-purpose Agent. Model: resolved utility tier.

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-code.md first.
 Read ~/.claude/protocols/behavioral-guidelines.md section 6 (Diagnose Before Fix).
 Run with --auto --severity critical,warning.
 Apply fixes from .plan-execution/review-report.md.

 {if fixHints.prioritizedFindings provided:}
 Process these findings first, in this order: {prioritizedFindings list}.
 After these, proceed to remaining critical findings.

 {if fixHints.fixMode == aggressive:}
 Aggressive mode: also address warning-severity findings, not just critical.

 {if fixHints.fixMode == targeted:}
 Targeted mode: address ONLY the prioritizedFindings. Skip everything else.

 MANDATORY per behavioral-guidelines.md section 6:
 1. Read each finding and understand what failed
 2. Query wiki for architectural constraints (/loom-wiki query)
 3. Diagnose root cause before any code change
 4. Write diagnosis to diagnoseLog BEFORE applying the fix
 5. Apply the fix
 6. Verify the fix

 Your AgentResult MUST include:
 - verificationStatus: verified | unverified | skipped
 - diagnoseLog: narrative root-cause analysis for every fix. An empty diagnoseLog is a protocol violation.
 - filesChanged: paths modified
 - findingsResolved: ids of findings the fixer believes are addressed"
```

Record the AgentResult. Add `agentResult.agentsUsed` (or 1 if missing) to `agentsSpawned` in `pipeline-state.toon`.

**Validate the fixer return:**
- If `diagnoseLog` is empty or missing: log to `notes` — `"Fixer-agent returned without diagnoseLog. Protocol violation per behavioral-guidelines.md section 6."` Set `diagnoseLogPresent: false` for the link envelope.
- If `verificationStatus == unverified`: log to `notes`. Set `fixerSelfVerified: false`.
- If the fixer crashed entirely (no AgentResult or `status: failed`): proceed to Step 4 with `criticalAfter = criticalBefore`, route to `nextLink: planning` with `planningMode: refine`, `failureSummary: "fixer-agent crashed"`. Skip Steps 2-3.

Update `ephemeral/status.toon`: `phase: quick-review`.

### Step 2: Re-run quick review

Spawn one general-purpose Agent. Model: resolved review tier.

Prompt:
```
"Read your instructions from ~/.claude/commands/loom-code.md first.
 Run a quick review (code style + security + correctness sanity check only — NOT a full deep review).
 Focus on the files the fixer modified: {filesChanged from Step 1}.
 Write updated findings to .plan-execution/review-report.md (OVERWRITE the existing file).
 Your AgentResult MUST include verificationStatus and a structured summary with
 criticalCount, warningCount, infoCount."
```

Record the AgentResult. Increment `agentsSpawned`.

Extract from the AgentResult and from the new `.plan-execution/review-report.md`:
- `criticalAfter` = critical findings count after fix
- `warningAfter` = warning findings count after fix
- `findingTagsAfter[]` = set of `{tag}:{file}:{line}` tuples for critical findings

Update `ephemeral/status.toon`: `phase: typecheck-and-test`.

### Step 3: Re-run typecheck + tests

This is a deterministic shell step — not an agent dispatch. Cheaper than spawning a verification agent and the data we need is just exit codes and counts.

1. Run the project typecheck command (from `orchestration.toml` or default `bunx tsc --noEmit`). Capture exit code. `typecheckAfter` = (exit code == 0).
2. Run the unit test command (vitest by default, or as configured). Capture passed/failed counts. `testsPassedAfter`, `testsFailedAfter`.

If either command fails to run at all (binary missing, etc.), log to `notes` and set `typecheckAfter: false`, `testsFailedAfter: 1` as conservative defaults.

Compare to baseline values from `stage-context/test.toon` (written by the predecessor verify link):
- `testsFailedBefore` from prior verify
- `testPassRateBefore` from prior verify

Update `ephemeral/status.toon`: `phase: detect-progress`.

### Step 4: Stuck detection

This is the protocol that keeps the fix loop from spinning on findings it cannot resolve. Compute three booleans from Steps 1-3 data:

```
progressDetected =
  (criticalAfter < criticalBefore) OR
  (testsFailedAfter < testsFailedBefore) OR
  (criticalAfter == criticalBefore AND
   findingTagsAfter ⊂ findingTagsBefore AND
   findingTagsAfter ≠ findingTagsBefore)
  # ^ last clause: same count but different findings — counts as progress

stuckDetected =
  criticalAfter == criticalBefore AND
  findingTagsAfter == findingTagsBefore AND
  testsFailedAfter >= testsFailedBefore
  # ^ identical critical set AND tests no better

regressionDetected =
  criticalAfter > criticalBefore OR
  testsFailedAfter > testsFailedBefore OR
  (typecheckBefore == true AND typecheckAfter == false)
```

`typecheckBefore` is sourced from `stage-context/test.toon` written by the predecessor verify link.

If two or more of these are true, prioritize in order: regression > stuck > progress.

### Step 5: Decide nextLink

Evaluate the routing rules top-down; first match wins.

| # | Condition | `nextLink` | `nextLinkReason` | Hints |
|---|-----------|------------|------------------|-------|
| 1 | Fixer crashed (Step 1 special case) | `planning` | `revise-plan` | `planningMode: refine`, `failureSummary: "fixer-agent crashed"`, `incrementOuterIteration: true` |
| 2 | `regressionDetected == true` | `planning` | `revise-plan` | `planningMode: refine`, `failureSummary: "fix regression: {detail}"`, `incrementOuterIteration: true` |
| 3 | `stuckDetected == true` | `planning` | `revise-plan` | `planningMode: refine`, `failureSummary: "fix loop stuck: same {N} critical findings persist"`, `incrementOuterIteration: true` |
| 4 | `fixCycleCount >= 2` AND `criticalAfter > 0` | `planning` | `revise-plan` | `planningMode: refine`, `failureSummary: "fix budget exhausted with {N} criticals remaining"`, `incrementOuterIteration: true` |
| 5 | `progressDetected == true` AND `fixHints.postFixHint == reconverge` AND `convergenceEnabled == true` | `converge` | `fix-and-reconverge` | (no fixHints needed; converge reads its own state) |
| 6 | `progressDetected == true` | `verify` | `proceed-to-verify` | (verify will recompute its own gate) |
| 7 | (catch-all, shouldn't reach here) | `planning` | `escalate-no-rule-matched` | `planningMode: refine`, `failureSummary: "fix link decision matrix fell through"`, `incrementOuterIteration: true` |

**Notes on the matrix:**
- Rules 1-3 are "abort the fix cycle" — the orchestrator escalates back to plan revision because more fixing won't help.
- Rule 4 is the existing `fixCycleCount >= 2` cap, codified inside the link.
- Rules 5 vs 6: `postFixHint: reconverge` is set by the verify link when the convergence stage previously failed (FIX-AND-RECONVERGE). The fix link doesn't need to interpret why — it just routes accordingly.
- The link never routes to `nextLink: done` directly. Even success cases go back through `verify` to re-confirm the gate.

### Step 6: Write stage-context/fix.toon and link-result.toon

**stage-context/fix.toon** per `stage-context.schema.md`:
- `stage: fix`
- `summary`: one-sentence outcome — counts before/after, decision
- `filesChanged[]`: from fixer-agent's AgentResult
- `findingsResolvedCount`: `criticalBefore - criticalAfter` (if positive, else 0)
- `findingsRemainingCount`: `criticalAfter`
- `keyDecisions[]`: any architectural choices the fixer made (extracted from diagnoseLog)
- `nextStageHints`: remaining finding ids for the next verify or planning link
- Use atomic write

**link-result.toon** with the FIX-specific `gateInputs` shape:

```toon
schemaVersion: 1
link: fix
linkVersion: 1
runId: {from pipeline-state}
trampolineIteration: {from pipeline-state}
outerIteration: 3  # convergence loop iteration number; matches execute link's envelope
status: complete                          # complete | failed | escalated
startedAt: {Step 0 timestamp}
completedAt: {now}
durationMs: {delta}
agentsSpawned: 2                          # fixer + quick-review (1 if fixer crashed)
nextLink: {verify | converge | planning}
nextLinkReason: {from Step 5 matrix}

gateInputs:
  criticalBefore: {N}
  criticalAfter: {N}
  warningBefore: {N}
  warningAfter: {N}
  testsFailedBefore: {N}
  testsFailedAfter: {N}
  typecheckBefore: {bool}
  typecheckAfter: {bool}
  progressDetected: {bool}
  stuckDetected: {bool}
  regressionDetected: {bool}
  diagnoseLogPresent: {bool}              # was fixer's diagnoseLog populated?
  fixerSelfVerified: {bool}               # was fixer's verificationStatus == verified?
  fixCycleCount: {N}                      # post-increment value
  fixMode: {standard | aggressive | targeted}
  postFixHint: {none | reconverge}

fixHints:                                 # only if nextLink == verify or converge
planningHints:                            # only if nextLink == planning
  planningMode: refine
  incrementOuterIteration: true
  failureSummary: "{Step 5 matrix value}"
outcomeHints:                             # always empty for fix link (never routes to done)

artifacts[N]:
  .plan-execution/stage-context/fix.toon
  .plan-execution/review-report.md
  .plan-execution/review-report.before-fix-{trampolineIteration}.md
  .plan-execution/pipeline-state.toon

contextHints:
  needsReadingByNext[N]:
    {if nextLink == verify: .plan-execution/review-report.md, .plan-execution/stage-context/fix.toon, .plan-execution/pipeline-state.toon}
    {if nextLink == converge: .plan-execution/pipeline-state.toon, .plan-execution/converge.config, .plan-execution/stage-context/fix.toon}
    {if nextLink == planning: .plan-execution/pipeline-state.toon, .plan-execution/stage-context/fix.toon, ROADMAP.md, criteria-plan.toon}
  canSkipReading[N]:
    .plan-execution/review-report.before-fix-{trampolineIteration}.md    # historical snapshot, not actionable
    PLAN.md                                                              # only planning link needs this

verificationStatus: {aggregate: verified if both sub-agents verified, else unverified}
notes[N]: {fixer diagnoseLog missing, model resolution fallbacks, etc.}

summary: "Fix cycle {fixCycleCount}: {criticalBefore}→{criticalAfter} critical, {testsFailedBefore}→{testsFailedAfter} failing tests. {decision}."
```

Atomic write both files.

### Step 7: Update pipeline-state.toon

Atomically update `pipeline-state.toon`:

- Append to `linkHistory[]`: `{link: fix, status: complete, trampolineIteration, outerIteration, startedAt, completedAt, agentsUsed: agentsSpawned-this-link, nextLink, nextLinkReason}`
- Append to `stageHistory[]`: `{stage: fix-code, status: succeeded, iteration: outerIteration, ..., gateResult: nextLinkReason}` (back-compat with v1 consumers)
- `currentStage: link-complete-fix`
- `fixCycleCount` was already incremented in Step 0
- If `planningHints.incrementOuterIteration == true`: do NOT increment `outerIteration` here — leave that to the trampoline so the linkHistory entry reflects the pre-increment value. The trampoline reads `planningHints.incrementOuterIteration` and increments after dispatch.
- `trampolineIteration` is NOT incremented by this link.

### Step 8: Return

Final AgentResult, under 500 tokens. The trampoline reads `link-result.toon` from disk.

Example return body:
```
FIX link complete. Cycle 1: 3→0 critical, 1→0 failing tests, no regression. Next link: verify. See .plan-execution/link-result.toon for full envelope.
```

## Resume semantics

If the trampoline invokes this link with `--resume`, behavior depends on what's on disk for the current `trampolineIteration`:

| State on entry | Action |
|----------------|--------|
| `link-result.toon` exists AND `link == fix` AND `trampolineIteration` matches | Idempotent return — re-emit the same envelope. Do NOT re-run agents. |
| `review-report.before-fix-{iter}.md` exists, `link-result.toon` does NOT (or is from prior link) | Snapshot was taken, fixers may have run. Read `review-report.md` to see whether quick review (Step 2) updated it. Compare timestamp: if newer than the snapshot, skip to Step 3. If older or equal, restart from Step 1. |
| Neither exists | Run Step 0 from scratch. |

Step 0 (initialize, snapshot) always runs at least once per trampolineIteration. Subsequent invocations within the same iteration read the existing snapshot.

## Error handling

| Error | Action |
|-------|--------|
| Fixer-agent timeout | Retry once. If retry fails, treat as crash → Step 5 row 1. |
| Quick-review-agent timeout | Retry once. If retry fails, set `criticalAfter = 999` sentinel, log in `notes`. Step 5 will route via regression rule. |
| Cannot read `review-report.md` on entry | Write `link-result.toon` with `status: failed`, `reason: "missing-input: review-report.md"`. Trampoline escalates. |
| Cannot read `pipeline-state.toon` | Write `link-result.toon` with `status: failed`, `reason: corrupted-state`. Trampoline halts. |
| Cannot write `link-result.toon` | Print error to stderr, exit non-zero. Trampoline detects missing envelope via its circuit breaker. |
| Agent budget exceeded mid-link (`agentsSpawned >= maxAgents`) | Skip Step 2 if not yet run; route to `nextLink: planning` with `failureSummary: "budget exhausted in fix cycle"`. |

## Self-check before returning

Before emitting your final message, verify all of the following. If any is false, fix it or fail loudly:

- [ ] `.plan-execution/link-result.toon` exists and is well-formed TOON
- [ ] `link-result.toon` `link == "fix"` and `trampolineIteration` matches your dispatch
- [ ] `link-result.toon` `nextLink` is one of: `verify`, `converge`, `planning`
- [ ] `link-result.toon` `gateInputs` is fully populated (every before/after pair, every detection boolean)
- [ ] `stage-context/fix.toon` exists
- [ ] `review-report.before-fix-{trampolineIteration}.md` snapshot exists
- [ ] `review-report.md` has been overwritten by Step 2 (unless fixer crashed)
- [ ] `pipeline-state.toon.linkHistory[]` has the new fix entry
- [ ] `pipeline-state.toon.fixCycleCount` was incremented exactly once
- [ ] All file writes used `.tmp` + rename
- [ ] No `Read` calls to `PLAN.md`, `ROADMAP.md`, or `rolling-context.md`

If any check fails, fix it and re-run the self-check before returning.

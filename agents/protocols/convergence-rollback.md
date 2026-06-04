# Convergence Rollback Protocol

Defines the rollback behavior when a convergence loop fails to reach its pass condition within `maxIterations`. Rollback restores the codebase to the last known-good checkpoint while preserving diagnostic artifacts for post-mortem analysis.

---

## Rollback Trigger Conditions

Rollback is initiated when ANY of the following conditions are met:

### 1. MAX_ITERATIONS Exhausted

The convergence driver has executed `maxIterations` iterations (from `budget.maxIterations` in the convergence plan) without all gating criteria reaching their `passCondition`.

```toon
trigger: max-iterations-exhausted
iterations: 10
passingCriteria: 5
totalCriteria: 7
remainingFailures: 2
```

### 2. Regression Deadlock

The delta report shows net regression (more criteria failing than the previous iteration) for 3 consecutive iterations. This indicates fixes are making things worse, not better.

```toon
trigger: regression-deadlock
consecutiveRegressions: 3
regressionPattern: "iter-5: 4 failing, iter-6: 5 failing, iter-7: 6 failing"
```

### 3. Budget Exhaustion

The cumulative agent token budget (`budget.agentBudget` in the convergence plan) has been consumed before convergence completes. The convergence driver tracks tokens across all fixer-agent spawns.

```toon
trigger: budget-exhausted
budgetLimit: 30
budgetUsed: 31
iterationsCompleted: 6
```

### 4. Manual Abort

A user issues `/loom-converge --abort` or the orchestrator receives a `SIGINT` during convergence. This is a graceful shutdown -- the current iteration completes, then rollback begins.

```toon
trigger: manual-abort
reason: User requested abort via /loom-converge --abort
iterationsCompleted: 4
```

---

## Rollback Target: Last Wave Checkpoint

Rollback reverts the codebase to the **last wave checkpoint state** -- the git tag created before the convergence loop began.

### Checkpoint Identification

The convergence driver identifies the rollback target using git tags created by the execution pipeline (see `execution-conventions.md` auto-commit convention):

1. **Primary target:** `plan-exec-wave-N-pre` -- the tag created before the wave whose convergence failed.
2. **Fallback:** If no pre-tag exists, use the commit at `HEAD~{number_of_convergence_commits}` to undo all convergence iteration commits.

### Rollback Procedure

```
Step 1: Record rollback intent
Step 2: Preserve diagnostic artifacts
Step 3: Git reset to checkpoint
Step 4: Restore preserved artifacts
Step 5: Write rollback report
```

#### Step 1: Record Rollback Intent

Write rollback intent to `.plan-execution/convergence/rollback-intent.toon` before any destructive operations:

```toon
trigger: max-iterations-exhausted
targetTag: plan-exec-wave-2-pre
targetCommit: abc1234
currentCommit: def5678
iterationsToUndo: 10
timestamp: 2026-04-19T12:00:00Z
```

#### Step 2: Preserve Diagnostic Artifacts

Copy the following to a rollback archive directory BEFORE resetting git state:

```
.plan-execution/convergence/rollback-archive/{timestamp}/
  iterations/           # All iteration summaries (iter-1.toon ... iter-N.toon)
  delta-reports/        # All delta reports from each iteration
  flaky-tests.toon      # Flaky test registry at time of rollback
  rollback-intent.toon  # The intent record from Step 1
  fix-logs/             # Fixer-agent diagnoseLog entries per iteration
```

These files are copied (not moved) -- the originals will be destroyed by the git reset.

#### Step 3: Git Reset to Checkpoint

```bash
git reset --hard {targetTag}
```

This reverts all code changes made during the convergence loop. The working tree matches the state before convergence began.

#### Step 4: Restore Preserved Artifacts

After the git reset, restore the rollback archive:

```bash
mkdir -p .plan-execution/convergence/rollback-archive/{timestamp}
# Archive was written to a temp directory outside the git tree in Step 2
mv /tmp/loom-rollback-{timestamp}/* .plan-execution/convergence/rollback-archive/{timestamp}/
```

Implementation note: Step 2 must write the archive to a location outside the git working tree (e.g., `/tmp/loom-rollback-{timestamp}/`) so it survives the `git reset --hard` in Step 3.

#### Step 5: Write Rollback Report

Write the final rollback report to `.plan-execution/convergence/rollback-report.toon`:

```toon
schemaVersion: 1
timestamp: 2026-04-19T12:05:00Z
trigger: max-iterations-exhausted
targetTag: plan-exec-wave-2-pre
targetCommit: abc1234
rolledBackCommit: def5678
iterationsCompleted: 10
archivePath: .plan-execution/convergence/rollback-archive/2026-04-19T12-00-00Z

preservedArtifacts[N]:
  .plan-execution/convergence/rollback-archive/2026-04-19T12-00-00Z/iterations/
  .plan-execution/convergence/rollback-archive/2026-04-19T12-00-00Z/delta-reports/
  .plan-execution/convergence/rollback-archive/2026-04-19T12-00-00Z/flaky-tests.toon
  .plan-execution/convergence/rollback-archive/2026-04-19T12-00-00Z/fix-logs/

summary: "Convergence failed after 10 iterations. 5 of 7 criteria passing. Rolled back to plan-exec-wave-2-pre. Diagnostic artifacts preserved for post-mortem."

remainingFailures[N]{criterionId,name,lastStatus}:
  C-02,Returns 401 with error shape,failing
  C-04,No injection vulnerabilities,failing
```

---

## Preserved Artifacts

The following artifacts are preserved across rollback for post-mortem analysis:

### Always Preserved

| Artifact | Location After Rollback | Reason |
|----------|------------------------|--------|
| Iteration summaries | `rollback-archive/{ts}/iterations/` | Show convergence trajectory -- which criteria improved, regressed, or stalled |
| Delta reports | `rollback-archive/{ts}/delta-reports/` | Detailed per-iteration diffs for root cause analysis |
| Flaky test registry | `rollback-archive/{ts}/flaky-tests.toon` | Flaky test state at failure point -- needed to distinguish real failures from flakes |
| Fix logs (diagnoseLog) | `rollback-archive/{ts}/fix-logs/` | Fixer-agent reasoning chains -- shows what was attempted and why |
| Rollback intent | `rollback-archive/{ts}/rollback-intent.toon` | Audit trail of what triggered the rollback |

### Never Deleted by Rollback

| Artifact | Location | Reason |
|----------|----------|--------|
| Wiki pages | `.loom/wiki/` | Wiki is a persistent knowledge base. Pages created during failed convergence may contain valid architectural insights. Wiki maintenance is additive (see `execution-conventions.md` wiki integration). |
| Conflict resolutions | `.plan-execution/conflicts/` | Interpretation conflicts resolved during convergence iterations represent agent consensus. Deleting them would force re-resolution in future attempts. |
| Execution log entries | `.loom/wiki/execution-log.toon` | Convergence events (stalls, regressions, rollback) are appended to the execution log. These entries are never removed -- they form the project's execution history. |
| `.plan-history/` artifacts | `.plan-history/` | Wave summaries, review findings, and decision records in `.plan-history/` are committed to git and are not part of the convergence working set. Rollback does not touch this directory. |

### Destroyed by Rollback (Expected)

| Artifact | Reason |
|----------|--------|
| Code changes from fixer agents | These are the convergence attempts that failed -- reverting them is the point of rollback |
| Auto-commits from convergence iterations | `fix(converge-iter-N)` commits are undone by the `git reset --hard` |
| Stage context for converge/fix stages | These described the failed convergence state and are no longer accurate |

---

## Post-Rollback State

After rollback completes, the system is in the following state:

```toon
codebase: reverted to last wave checkpoint (pre-convergence)
convergenceState: aborted
waveState: the wave that triggered convergence is marked as failed
pipelineState: paused -- awaiting user decision
flakyTestRegistry: preserved in rollback archive
wikiPages: intact
conflictResolutions: intact
executionLog: updated with rollback event
```

### User Actions After Rollback

The orchestrator presents the user with these options:

1. **Retry convergence** (`/loom-converge --retry`) -- Re-run convergence from scratch with the same or modified plan. The rollback archive provides context for adjusting the convergence plan (e.g., increasing `maxIterations`, relaxing criteria, quarantining known flaky tests before starting).
2. **Skip convergence** (`/loom-converge --skip`) -- Accept the pre-convergence state and continue to the next wave. Unresolved criteria are logged as warnings.
3. **Manual fix** -- The user fixes the code manually, then runs `/loom-converge` to re-attempt convergence with the manual fixes as a starting point.
4. **Abort execution** (`/loom plan execute --abort`) -- Stop the entire execution pipeline. All progress is preserved in `.plan-history/`.

---

## Rollback Report Schema

```toon
schemaVersion: 1
timestamp: ISO 8601
trigger: max-iterations-exhausted | regression-deadlock | budget-exhausted | manual-abort
targetTag: string
targetCommit: string (short SHA)
rolledBackCommit: string (short SHA)
iterationsCompleted: integer
archivePath: string

preservedArtifacts[N]: list of preserved paths

summary: string (1-3 sentences)

remainingFailures[N]{criterionId,name,lastStatus}:
  criterion ID, criterion name, last known status

regressionHistory[N]{iteration,passing,failing,delta}:
  iteration number, passing count, failing count, change from previous
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | integer | yes | Schema version. Currently `1`. |
| `timestamp` | ISO 8601 | yes | When the rollback completed. |
| `trigger` | enum | yes | What caused the rollback. One of: `max-iterations-exhausted`, `regression-deadlock`, `budget-exhausted`, `manual-abort`. |
| `targetTag` | string | yes | Git tag rolled back to. |
| `targetCommit` | string | yes | Short SHA of the rollback target commit. |
| `rolledBackCommit` | string | yes | Short SHA of the commit that was HEAD before rollback. |
| `iterationsCompleted` | integer | yes | Number of convergence iterations that ran before rollback. |
| `archivePath` | string | yes | Path to the rollback archive directory. |
| `preservedArtifacts` | string[] | yes | List of paths preserved in the archive. |
| `summary` | string | yes | Human-readable summary of the rollback. |
| `remainingFailures` | typed array | yes | Criteria that were still failing at rollback time. |
| `regressionHistory` | typed array | no | Per-iteration pass/fail trajectory for post-mortem analysis. |

---

## Validation Rules

1. **trigger enum.** Must be one of: `max-iterations-exhausted`, `regression-deadlock`, `budget-exhausted`, `manual-abort`.
2. **targetTag exists.** The git tag referenced by `targetTag` must exist in the repository.
3. **archivePath exists.** The rollback archive directory must exist and contain at least `rollback-intent.toon`.
4. **iterationsCompleted >= 1.** At least one iteration must have run before rollback is meaningful.
5. **preservedArtifacts non-empty.** At least the iteration summaries and rollback intent must be preserved.
6. **remainingFailures consistency.** Each `criterionId` in `remainingFailures` must reference a valid criterion from the convergence plan.

---

## Relationship to Other Schemas

- **convergence-tier.schema.md** -- Rollback resets tier verification state. After rollback, all tiers must be re-verified from the checkpoint state.
- **criteria-plan.schema.md** -- The `budget.maxIterations` field in the criteria plan determines the `max-iterations-exhausted` trigger threshold.
- **execution-conventions.md** -- Rollback uses the git tag convention (`plan-exec-wave-N-pre`) defined in the auto-commit section. The rollback archive lives under `.plan-execution/convergence/`.
- **flaky-test.schema.md** -- The flaky test registry is preserved in the rollback archive. Quarantine state from the failed convergence is available for post-mortem and future convergence attempts.
- **agent-result.schema.md** -- The convergence driver's AgentResult after rollback has `status: failure` with rollback details in `diagnoseLog`.
- **behavioral-guidelines.md** -- The "Diagnose Before Fix" discipline applies to post-rollback analysis. Before retrying convergence, agents should review the rollback archive to understand why the prior attempt failed.

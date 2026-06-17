# ConvergenceSummary Schema

Defines the `ConvergenceSummary` TOON artifact written by `convergence-driver` exactly ONCE per convergence run, at the terminal-state transition (converged OR halted). Per locked decision C-11, this file is the AUTHORITATIVE "did we converge" signal for downstream consumers — read by `verify-link` today and by the future `converge-link` when the `/loom-auto` trampoline-link refactor extracts `/loom-plan create`.

`ConvergenceSummary` is the run-level counterpart to `ConvergenceIterationSummary` (per-iteration). It distills the full run into one decision-ready artifact so a fresh-context agent can answer "what happened?" without orchestrator state.

Schema version: **1**. Registered in `schema-versions.toon` as `convergence-summary`.

---

## File Location

| Path | Notes |
|------|-------|
| `.plan-execution/convergence-summary.toon` | Default; ONE file per run, overwritten only by `/loom-converge --resume` on terminal-state re-transition |

**Atomic writes required:** Write to `{path}.tmp` then rename. The terminal-state transition is the ONLY write — the driver MUST NOT write partial summaries mid-loop. See `execution-conventions.md` Atomic Writes section.

**Resume semantics:** `/loom-converge --resume` restores the run from `convergence-state.toon`. If the run reaches a NEW terminal state (e.g., a halted run was resumed and converged), the driver overwrites `convergence-summary.toon` with the new terminal-state shape.

---

## Schema

```toon
runId: conv-2026-06-12-15-30-00-001
convergenceMode: document
subject: planning/PLAN-convergence-generalization.md
harnessName: plan-review-harness
integratorName: plan-builder-agent
status: converged
finalBlockingCount: 0
iterationsRun: 3
haltReason:
startedAt: 2026-06-12T15:00:00.000Z
completedAt: 2026-06-12T15:42:18.045Z
tokensUsed: 145000
```

---

## Required Fields

| Field | Type | Modes | Constraints | Validation Rules |
|-------|------|-------|-------------|------------------|
| `runId` | string | all | required; mirrors `convergence-state.toon.runId` | Unique identifier for this convergence run. Format: `conv-{YYYY-MM-DD-HH-mm-ss}-{NNN}` (driver-generated). |
| `convergenceMode` | enum | all | required; one of `target`, `criteria`, `document` | Mirrors `converge.config.convergenceMode`. |
| `subject` | string (path) | document only; null for target/criteria | required when `convergenceMode == document`; null otherwise | Path to the subject file under iteration. For `target` and `criteria` modes, the literal value `null` (no subject — the "subject" is the entire codebase). |
| `harnessName` | string | all | required | Name or path of the harness that produced findings. Examples: `plan-review-harness` for document mode; `target-runner` for target; `criteria-runner` for criteria. |
| `integratorName` | string | all | required | Name of the agent invoked to apply findings. Examples: `plan-builder-agent` for document mode; `fixer-agent` default for target/criteria. |
| `status` | enum | all | required; one of 6 locked values | Authoritative "did we converge" signal. See Status Enum below. |
| `finalBlockingCount` | integer | all | required; >= 0 | `blockingCount` from the last `findings.toon`. MUST equal 0 if `status == converged`. |
| `iterationsRun` | integer | all | required; >= 1; <= `converge.config.maxIterations` | Number of iterations that actually executed (1-indexed count). |
| `haltReason` | enum (optional) | all | populated when `status` starts with `halted-`; null when `status == converged` | One of the 8 halt-reason values from C-10. See Halt Reason Cross-Reference below. |
| `startedAt` | ISO 8601 timestamp with millisecond precision | all | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` | Locked W-01. Run start (preflight begin). |
| `completedAt` | ISO 8601 timestamp with millisecond precision | all | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` | Locked W-01. Terminal-state transition. |
| `tokensUsed` | integer (optional) | all | non-blocking observability metric | Cumulative agent-spawn output tokens across all iterations. Mirrors `convergence-state.toon.tokensUsed`. NOT used as a gate — surfaces alongside spawn-count for cost telemetry. Absent if not measurable. |

---

## Status Enum (locked C-11)

The `status` field has exactly 7 values. Any other value is a `FINDINGS_SCHEMA_INVALID`-class defect.

| Value | Meaning | `finalBlockingCount` | `haltReason` |
|-------|---------|----------------------|--------------|
| `converged` | Loop reached `blockingCount == 0` cleanly | 0 | null (omitted) |
| `halted-stall` | STALL circuit breaker tripped (`blockingCount` unchanged across 2 consecutive iterations) | > 0 | `STALL` |
| `halted-regression` | REGRESSION circuit breaker tripped (`blockingCount` increased vs prior iteration) | > 0 | `REGRESSION` |
| `halted-budget` | BUDGET_EXHAUSTED tripped (cumulative agent spawns exceeded `converge.config.agentBudget`) | >= 0 | `BUDGET_EXHAUSTED` |
| `halted-max-iter` | MAX_ITERATIONS tripped (`iterationsRun == converge.config.maxIterations` and `blockingCount > 0`) | > 0 | `MAX_ITERATIONS` |
| `halted-scope-expansion` | SCOPE_EXPANSION tripped (integrator added top-level structural section per C-06) | >= 0 | `SCOPE_EXPANSION` |
| `halted-validation` | Post-converge validation gate (Step 5.5 of `/loom-plan create --autoconverge`) re-entered the loop once and the plan STILL failed `validation-rules.md` stages 1–4 (structure / deps / ownership / sizing). The driver itself converged cleanly; the wrapper sets this status after re-entry exhaustion. | > 0 (validation blockers) | `VALIDATION_EXHAUSTED` |

**Note:** Preflight failures (`INTEGRATOR_NOT_FOUND`, `HARNESS_MISSING`, `FINDINGS_SCHEMA_INVALID`, `INTEGRATOR_MODE_AMBIGUOUS`) do NOT produce a `ConvergenceSummary` — the run never reached a terminal-state transition. The driver writes only an `AgentResult` with the preflight `issues[]` row in those cases.

---

## Halt Reason Cross-Reference (locked C-10)

The `haltReason` field is the same enum used by `ConvergenceIterationSummary.haltReason`. The full per-breaker cause + recovery table is in `PLAN-convergence-generalization.md` C-10. Cross-reference summary:

| `haltReason` | Cause (one sentence) | Recovery command |
|--------------|----------------------|------------------|
| `STALL` | `blockingCount` unchanged across 2 consecutive iterations | `/loom-converge --resume` after fixing integrator prompt or splitting work |
| `REGRESSION` | `blockingCount` increased vs prior iteration | `cp` the prior snapshot back, then `/loom-converge --resume` |
| `BUDGET_EXHAUSTED` | Cumulative agent spawns exceeded `converge.config.agentBudget` | Increase `agentBudget`, then `/loom-converge --resume` |
| `MAX_ITERATIONS` | Iteration count reached `converge.config.maxIterations` without convergence | Accept current draft, raise `--max-iterations`, or revert |
| `SCOPE_EXPANSION` | Integrator added a new top-level Phase/Feature/Milestone (C-06) | Approve scope OR `cp` snapshot back; re-invoke |
| `VALIDATION_EXHAUSTED` | Post-converge validation (Step 5.5 of `/loom-plan create --autoconverge`) found blocking structural issues, re-entered the driver once, and validation STILL failed. The driver-owned loop itself converged on reviewer agreement; the wrapper sets this haltReason after re-entry exhaustion. | Run `/loom-plan review --integrate` manually, or `/loom-roadmap refine`, to resolve the structural blockers in `.plan-execution/convergence/validation-failures.toon`, then re-invoke `/loom-plan create --review-integrate --autoconverge`. |
| `INTEGRATOR_NOT_FOUND` | `converge.config.integrator` does not resolve | Fix `integrator` field |
| `HARNESS_MISSING` | `converge.config.harness` path missing OR no `findings.toon` produced | Fix `harness` field or repair harness |
| `FINDINGS_SCHEMA_INVALID` | Harness wrote `findings.toon` failing schema validation | Inspect harness aggregator |

The last three (`INTEGRATOR_NOT_FOUND`, `HARNESS_MISSING`, `FINDINGS_SCHEMA_INVALID`) are preflight or harness-side failures that prevent a terminal-state transition — `ConvergenceSummary` is NOT written for them. They are listed here only for cross-reference completeness with `ConvergenceIterationSummary.haltReason` which may carry them when the failure occurs mid-loop (e.g., harness produces invalid findings on iteration 2).

---

## Validation Rules

1. **All required fields present.** `runId`, `convergenceMode`, `harnessName`, `integratorName`, `status`, `finalBlockingCount`, `iterationsRun`, `startedAt`, `completedAt` MUST all be present. `subject` is required when `convergenceMode == document`; null otherwise. `haltReason` is required when `status` starts with `halted-`; null when `status == converged`. `tokensUsed` is optional in all modes.
2. **`status` consistency.**
   - If `status == converged`, then `finalBlockingCount == 0` AND `haltReason` is null.
   - If `status` starts with `halted-`, then `finalBlockingCount` may be any non-negative integer AND `haltReason` MUST be present.
3. **`status` <-> `haltReason` mapping.** When `status == halted-stall`, `haltReason == STALL`. When `status == halted-regression`, `haltReason == REGRESSION`. When `status == halted-budget`, `haltReason == BUDGET_EXHAUSTED`. When `status == halted-max-iter`, `haltReason == MAX_ITERATIONS`. When `status == halted-scope-expansion`, `haltReason == SCOPE_EXPANSION`. When `status == halted-validation`, `haltReason == VALIDATION_EXHAUSTED` (set by the `/loom-plan create --autoconverge` wrapper, NOT the driver). Other `haltReason` values (`INTEGRATOR_NOT_FOUND`, `HARNESS_MISSING`, `FINDINGS_SCHEMA_INVALID`) may appear only via `ConvergenceIterationSummary`, not in `ConvergenceSummary` (the run never terminated cleanly).
4. **`subject` mode consistency.** Required (non-null path) iff `convergenceMode == document`. MUST equal `converge.config.subject` when present.
5. **`iterationsRun` bounds.** `1 <= iterationsRun <= converge.config.maxIterations`.
6. **Timestamps ordered.** `completedAt > startedAt`.
7. **Timestamp precision (locked W-01).** Both `startedAt` and `completedAt` MUST be ISO 8601 with millisecond precision.
8. **`tokensUsed` non-negative.** When present, MUST be >= 0.
9. **`runId` mirrors state.** MUST equal `convergence-state.toon.runId` for the run.

---

## Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| `converge.config` | `convergence-summary.toon` | RETAIN | OVERWRITE on terminal-state re-transition (resume scenario) |
| `convergence-summary.toon` | `iter-{N}.toon` rows | RETAIN | RETAIN (iter summaries are per-iteration; this summary is the run roll-up) |

---

## Lifecycle and Link Compatibility (C-11)

`ConvergenceSummary` is written EXACTLY ONCE per run, at the terminal-state transition. Per C-11, all `--autoconverge` outputs MUST be reconstructable from disk so a future `loom-auto` link (the planned `converge-link` and the existing `verify-link`) can derive its own `link-result.toon` envelope and a `nextLink in {verify, fix, planning, done}` decision WITHOUT orchestrator-side conversational state.

### Read-side contract for future links

```
+----------------------------+
|  fresh-context agent       |
|  (verify-link or future    |
|   converge-link)           |
+----------------------------+
            |
            v
   read .plan-execution/convergence-summary.toon
            |
            v
   inspect .status
            |
            +----------------+----------------+--------------------------+
            |                |                |                          |
       converged       halted-stall    halted-regression          halted-scope-expansion / max-iter / budget
            |                |                |                          |
            v                v                v                          v
       nextLink=done    nextLink=fix    nextLink=fix              nextLink=planning (revisit plan)
```

This contract is the reason `status` is locked to 6 values (not free-form) — every value MUST map deterministically to a link transition without inspecting `iter-{N}.toon` contents.

### Forbidden writes (C-11)

- Driver MUST NOT add convergence-internal fields to `pipeline-state.toon` (use `convergence-state.toon` and this artifact instead).
- Driver MUST NOT return arbitrary `AgentResult` structures to a conversational caller — the caller reads THIS file from disk.
- Driver MUST NOT introduce new `currentStage` values mid-convergence (reserved for the future converge-link namespace).

---

## Relationship to Other Schemas

- **`findings.schema.md`** — `finalBlockingCount` is the `blockingCount` from the last `findings.toon` (iteration `iterationsRun`).
- **`stage-context.schema.md`** — `ConvergenceIterationSummary.haltReason` shares the enum with this schema's `haltReason`. Iteration summaries cover per-pass detail; this artifact covers the run.
- **`iteration-snapshot.schema.md`** — Snapshots produced during the run are enumerable via `slug` derived from `subject` (when `convergenceMode == document`).
- **`convergence-tier.schema.md`** — `converge.config.maxIterations` bounds `iterationsRun`; `convergence-state.toon.runId` is mirrored here.
- **`link-result.schema.md`** — Future `converge-link` reads THIS file and emits `link-result.toon`. The `status` enum drives `nextLink`.
- **`agent-result.schema.md`** — Driver may also return an `AgentResult` envelope at the conversational layer; that envelope's `integrationNotes` SHOULD cite the path to this file rather than duplicating the run summary.

---

## Examples

### Document-mode converged on iteration 3

```toon
runId: conv-2026-06-12-15-00-00-001
convergenceMode: document
subject: planning/PLAN-convergence-generalization.md
harnessName: plan-review-harness
integratorName: plan-builder-agent
status: converged
finalBlockingCount: 0
iterationsRun: 3
haltReason:
startedAt: 2026-06-12T15:00:00.000Z
completedAt: 2026-06-12T15:42:18.045Z
tokensUsed: 145000
```

### Document-mode halted on scope expansion (under --auto)

```toon
runId: conv-2026-06-12-16-00-00-001
convergenceMode: document
subject: planning/PLAN-x.v2.md
harnessName: plan-review-harness
integratorName: plan-builder-agent
status: halted-scope-expansion
finalBlockingCount: 3
iterationsRun: 2
haltReason: SCOPE_EXPANSION
startedAt: 2026-06-12T16:00:00.000Z
completedAt: 2026-06-12T16:14:02.100Z
tokensUsed: 88000
```

### Target-mode max iterations reached

```toon
runId: conv-2026-06-12-09-15-00-002
convergenceMode: target
subject:
harnessName: target-runner
integratorName: fixer-agent
status: halted-max-iter
finalBlockingCount: 2
iterationsRun: 5
haltReason: MAX_ITERATIONS
startedAt: 2026-06-12T09:15:00.000Z
completedAt: 2026-06-12T09:58:31.250Z
tokensUsed: 210000
```

### Criteria-mode stalled

```toon
runId: conv-2026-06-12-12-00-00-001
convergenceMode: criteria
subject:
harnessName: criteria-runner
integratorName: fixer-agent
status: halted-stall
finalBlockingCount: 4
iterationsRun: 3
haltReason: STALL
startedAt: 2026-06-12T12:00:00.000Z
completedAt: 2026-06-12T12:32:14.500Z
tokensUsed: 175000
```

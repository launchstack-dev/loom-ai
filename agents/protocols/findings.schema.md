---
description: "ConvergenceFindings Schema"
---

# ConvergenceFindings Schema

Defines the `ConvergenceFindings` TOON artifact written by every convergence harness. ConvergenceFindings is the uniform contract between harnesses (which produce findings) and the convergence-driver (which consumes them) — replacing per-mode result shapes that previously lived only inside the driver.

A single `findings.toon` file at `converge.config.outputPath` (default `.plan-execution/convergence/findings.toon`) is the harness's sole output. The convergence-driver reads it after each harness invocation, reduces it to `blockingCount`, and routes:

- `blockingCount == 0` -> loop exits at `converged`
- `blockingCount > 0` -> loop advances to the integrator step

Schema version: **1**. Registered in `schema-versions.toon` as `convergence-findings`.

---

## File Location

| Mode | Path |
|------|------|
| `target` | `.plan-execution/convergence/findings.toon` (default; configurable via `converge.config.outputPath`) |
| `criteria` | Same default; configurable |
| `document` | Same default; configurable |

**Atomic writes required:** Harnesses MUST write to `{path}.tmp` then rename. See `execution-conventions.md` Atomic Writes section.

**Overwrite semantics:** The file is overwritten each iteration. The driver reads the latest version after each harness run. Per-iteration history lives in `iter-{N}.toon`, not here.

---

## Schema

```toon
subject: planning/PLAN.md
harnessName: plan-review
iteration: 1
blockingCount: 5
advisoryCount: 7
producedAt: 2026-06-12T15:30:00.000Z

findings[12]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:
  F-01,phasing,blocking,planning/PLAN.md,##Execution Phases > Phase 3,Wave 2 has 9 deliverables (>8 limit),Split Phase 3 into 3a (schema) and 3b (driver branch),phasing-reviewer-agent
  F-02,strategy,blocking,planning/PLAN.md,##Overview,Plan does not address C-06 scope-expansion guard,Add C-06 cross-reference to Overview,strategy-reviewer-agent
  F-03,phasing,warning,planning/PLAN.md,##Execution Phases > Phase 5,Phase 5 acceptance criteria depend on Phase 11 helper,Promote Phase 11 to same wave,phasing-reviewer-agent
```

---

## Required Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| `subject` | string (path) | required; matches `converge.config.subject` | MUST equal the config's `subject` value. Mismatch -> `FINDINGS_SCHEMA_INVALID`. |
| `harnessName` | string | required | MUST match a registered harness name OR the harness path declared in `converge.config.harness`. |
| `iteration` | integer | required; 1-indexed; >= 1 | Monotonic per run; driver verifies `iteration == driver.currentIteration`. |
| `blockingCount` | integer | required; >= 0 | Drives convergence check. Convergence reached when `blockingCount == 0`. |
| `advisoryCount` | integer | required; >= 0 | Informational only. Does not gate convergence. |
| `producedAt` | ISO 8601 timestamp with millisecond precision | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` | Used for stall-detection regression checks. See Validation Rules below. |
| `findings[]` | typed array | required; may be empty (`[0]:`) | See findings[] row schema below. |

---

## findings[] Row Schema

Each row in the `findings[]` typed array has these columns:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | string | yes | Unique finding identifier within the run (e.g., `F-01`, `C-04`, `T-12`). |
| `dimension` | string | yes | Source dimension. For document-mode plan-review harness, one of the 6 locked reviewer dimensions (`feature-coverage`, `strategy`, `ux`, `phasing`, `parallelization`, `agentic-workflow`) OR the synthetic dimension `structural-validation` emitted by the `/loom-plan create --autoconverge` Step 5.5 post-converge validation gate. For target/criteria modes, harness-defined (e.g., `target-diff`, `test-failure`). |
| `severity` | enum | yes | One of: `blocking`, `warning`, `info`, `advisory`. See Severity Mapping below. |
| `locationPath` | string (path) | yes | File path where the finding applies. For document mode, equals `subject`. For target/criteria modes, the affected source file. |
| `locationAnchor` | string | no | Sub-file locator (heading path, line range, function name). Empty string when whole-file. |
| `summary` | string | yes | One-line statement of the issue. |
| `suggestion` | string | no | Recommended remedy. Consumed by the integrator agent. |
| `reviewerAgent` | string | no | Reviewer attribution (locked W-03). Populated by plan-review harness with one of the 6 reviewer agent names (`feature-coverage-reviewer-agent`, `strategy-reviewer-agent`, `ux-reviewer-agent`, `phasing-reviewer-agent`, `parallelization-reviewer-agent`, `agentic-workflow-reviewer-agent`) OR the synthetic identifier `validation-rules-stages-1-4` when the row is written by the `/loom-plan create --autoconverge` Step 5.5 post-converge validation gate (NOT a real agent — names the rule set that produced the finding). Optional for non-harness contexts (e.g., when a single-agent harness writes findings directly). |

---

## Severity Mapping (AgentResult -> ConvergenceFindings)

The plan-review harness aggregates `AgentResult.issues[]` rows from the 6 reviewer agents. Each reviewer's `severity` enum (per `agent-result.schema.md`) maps deterministically to a `ConvergenceFindings.severity`. The aggregator MUST apply this mapping verbatim. Silent re-categorization is a `FINDINGS_SCHEMA_INVALID` defect.

Two source enums coexist by design — see § "Why two enums" below.

### severityToConvergenceSeverity

| AgentResult severity | ConvergenceFindings severity | `blockingCount` contribution | `advisoryCount` contribution |
|----------------------|------------------------------|------------------------------|------------------------------|
| `critical` | `blocking` | +1 | 0 |
| `high` | `blocking` | +1 | 0 |
| `medium` | `warning` | 0 | +1 |
| `low` | `info` | 0 | +1 |
| `info` | `info` | 0 | +1 |
| `advisory` | `info` | 0 | +1 |
| `blocking` | `blocking` | +1 | 0 |
| `warning` | `warning` | 0 | +1 |

### Why two enums

Loom reviewer agents (`feature-coverage-reviewer-agent`, etc.) emit `severity` values aligned with the convergence-side enum (`{blocking, warning, info}`) per `agent-result.schema.md`'s canonical examples. Non-Loom reviewers and the original mapping table use the classic ladder (`{critical, high, medium, low, info, advisory}`). The aggregator accepts BOTH; the mapping table above is the union. The `info` row is identical across enums.

**Smoke 2 Finding A (2026-06-13)** discovered that the plan-review harness's input-validator only recognized the classic ladder, silently dropping all `severity: warning` and `severity: blocking` rows emitted by Loom reviewers. The mapping table and the input validator have been extended to accept both enums. See `planning/notes/2026-06-13-wave-5-smoke-findings.md` for the recovery trail.

### Invariants

1. **Count consistency.** `blockingCount` MUST equal `count(findings where severity == blocking)`.
2. **Advisory consistency.** `advisoryCount` MUST equal `count(findings where severity in {warning, info, advisory})`.
3. **Total consistency.** `len(findings) == blockingCount + advisoryCount` (within the row level; the typed-array header `findings[N]:` MUST also equal this sum).

A mismatch on any of the above invariants is a `FINDINGS_SCHEMA_INVALID` blocking error per `agent-result.schema.md` error registry.

---

## Validation Rules

1. **All required fields present.** `subject`, `harnessName`, `iteration`, `blockingCount`, `advisoryCount`, `producedAt`, and `findings[]` (possibly empty) MUST all be present.
2. **`subject` matches config.** `subject` MUST equal `converge.config.subject`. The driver checks this on every iteration.
3. **`harnessName` matches config.** `harnessName` MUST equal `converge.config.harness` or its registered alias.
4. **`iteration` matches driver state.** The driver enforces `iteration == driver.currentIteration` on read; mismatch is a `FINDINGS_SCHEMA_INVALID` blocking error.
5. **`blockingCount` and `advisoryCount` non-negative.** Both MUST be >= 0.
6. **Severity invariants.** Counts MUST satisfy the three invariants in Severity Mapping above.
7. **`producedAt` precision (locked W-01).** Timestamp MUST be ISO 8601 with millisecond precision (format `YYYY-MM-DDTHH:mm:ss.sssZ`). The driver uses this for stall-detection regression checks; uniform precision is required so timestamp comparisons across iterations are deterministic. A timestamp at second precision (`...Z` without milliseconds) is a `FINDINGS_SCHEMA_INVALID` defect.
8. **Severity enum.** Each finding's `severity` MUST be one of: `blocking`, `warning`, `info`, `advisory`.
9. **No duplicate IDs.** Two findings with the same `id` within a single `findings.toon` is a `FINDINGS_SCHEMA_INVALID` defect.
10. **`reviewerAgent` enum (when populated).** When the harness is the plan-review harness, `reviewerAgent` MUST be one of the 6 locked reviewer agent names (see findings[] row schema). The synthetic identifier `validation-rules-stages-1-4` is ALSO permitted on rows whose `dimension == structural-validation` — these rows are written by the `/loom-plan create --autoconverge` Step 5.5 wrapper, not by a reviewer agent, but co-mingle in the same `findings.toon` so the integrator can resolve them through the existing convergence loop. For other harnesses, `reviewerAgent` is free-form or omitted.
11. **`structural-validation` dimension coupling.** A row with `dimension == structural-validation` MUST have `reviewerAgent == validation-rules-stages-1-4` (or omit `reviewerAgent`). A row with any other `dimension` MUST NOT use `validation-rules-stages-1-4` as its `reviewerAgent`. This coupling makes the wrapper-vs-reviewer origin of each row unambiguous to the integrator and to downstream tooling.

---

## Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| `converge.config` | `findings.toon` (latest) | OVERWRITE | OVERWRITE — only latest matters at runtime |
| `findings.toon` (iteration N) | `iter-{N}.toon` (driver-written summary) | RETAIN | OVERWRITE on retry within same iteration |
| `findings.toon` (iteration N) | `findings.toon` (iteration N+1) | OVERWRITE | Latest always replaces prior at `outputPath` |

---

## Error Codes

| Code | When emitted |
|------|--------------|
| `FINDINGS_SCHEMA_INVALID` | Harness wrote `findings.toon` but it fails any validation rule above (missing field, severity-count mismatch, timestamp precision violation, duplicate ID, subject/iteration mismatch with driver state). Halt without retry. |
| `HARNESS_MISSING` | Harness was invoked but did not produce `findings.toon` at the configured `outputPath` (timeout or crash). Single retry, then halt. |

See `agent-result.schema.md` Error Categories for the full registry.

---

## Relationship to Other Schemas

- **`agent-result.schema.md`** — Reviewer agents return `AgentResult.issues[]` rows that the plan-review harness aggregates into `findings.toon` using the Severity Mapping table. Source of the locked severity enum.
- **`stage-context.schema.md`** — `ConvergenceIterationSummary.findingsBefore` and `findingsAfter` are derived from successive `findings.toon` `blockingCount` values.
- **`convergence-summary.schema.md`** — `ConvergenceSummary.finalBlockingCount` is the `blockingCount` from the terminal iteration's `findings.toon`.
- **`plan-critique.schema.md`** — `PlanCritique` mirrors this schema's shape so `plan-builder-agent` can consume critic output through the same integrator contract.
- **`iteration-snapshot.schema.md`** — `IterationSnapshot.iteration` matches `ConvergenceFindings.iteration` for the pass.
- **`convergence-tier.schema.md`** — `converge.config.outputPath` field (default `.plan-execution/convergence/findings.toon`) names this file.

---

## Examples

### Document-mode (plan-review harness) — convergence reached

```toon
subject: planning/PLAN-convergence-generalization.md
harnessName: plan-review
iteration: 3
blockingCount: 0
advisoryCount: 4
producedAt: 2026-06-12T16:42:18.045Z

findings[4]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:
  F-08,ux,warning,planning/PLAN-convergence-generalization.md,##Overview,Overview could cite C-11 explicitly,Add one-line C-11 reference,ux-reviewer-agent
  F-09,phasing,info,planning/PLAN-convergence-generalization.md,##Execution Phases > Phase 4,Phase 4 has 1 deliverable (consider merging),Merge with Phase 3 if dependency allows,phasing-reviewer-agent
  F-10,agentic-workflow,info,planning/PLAN-convergence-generalization.md,##Tech Stack,Tech Stack row order is non-canonical,Reorder by layer,agentic-workflow-reviewer-agent
  F-11,strategy,info,planning/PLAN-convergence-generalization.md,##Risks,Risk R-03 lacks mitigation owner,Assign to Phase 7,strategy-reviewer-agent
```

### Target-mode — convergence not yet reached

```toon
subject: src/api/users.ts
harnessName: target-runner
iteration: 2
blockingCount: 2
advisoryCount: 1
producedAt: 2026-06-12T11:08:00.000Z

findings[3]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:
  T-01,target-diff,blocking,src/api/users.ts,GET /api/users response,Response body missing pagination envelope,Wrap result in {data, page} shape,
  T-02,target-diff,blocking,src/api/users.ts,POST /api/users 400 path,Error response missing code field,Add code: "validation-error",
  T-03,target-diff,info,src/api/users.ts,response timing,Response within tolerance,—,
```

### Empty findings (converged on first iteration)

```toon
subject: planning/PLAN-x.v2.md
harnessName: plan-review
iteration: 1
blockingCount: 0
advisoryCount: 0
producedAt: 2026-06-12T09:30:00.000Z

findings[0]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:
```

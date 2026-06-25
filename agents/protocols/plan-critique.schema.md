---
description: "PlanCritique Schema"
---

# PlanCritique Schema

Defines the `PlanCritique` TOON artifact written by `plan-critic-agent`. The critic is a haiku-tier advisory agent that runs against a draft plan BEFORE the first formal review pass, predicting findings that the 6 reviewer agents are likely to raise. Its goal is to let `plan-builder-agent` self-correct cheaply, reducing the blocking-finding count entering the formal review.

`PlanCritique` mirrors the shape of `ConvergenceFindings` (see `findings.schema.md`) so `plan-builder-agent` can consume critic output through the same integrator contract.

Schema version: **1**. Registered in `schema-versions.toon` as `plan-critique`.

---

## File Location

| Path | Notes |
|------|-------|
| `.plan-execution/critique.toon` | Default; one per `/loom-plan create --autoconverge` invocation |

**Atomic writes required:** Write to `{path}.tmp` then rename. See `execution-conventions.md` Atomic Writes section.

**Overwrite semantics:** Each `--autoconverge` invocation overwrites the prior critique. The critic runs at most once per planning run (before the convergence loop begins). The loop's integrator passes consume critique only on iteration 1.

---

## Schema

```toon
subject: planning/PLAN.md
producedBy: plan-critic-agent
producedAt: 2026-06-12T15:00:00.000Z
criticConfidence: 0.65
dimensionsCovered[6]: feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow
predictedBlockingCount: 4
predictedAdvisoryCount: 9

predictedFindings[13]{id,dimension,predictedSeverity,locationHint,concern,suggestion}:
  P-01,phasing,blocking,Phase 3 - Wave 2,Two phases share src/foo/** without wiring boundary,Move shared file ownership to wiring phase
  P-02,strategy,blocking,Overview,Plan does not cite locked decision C-06,Add C-06 cross-reference
  P-03,ux,warning,Overview,Overview is 4 sentences (>3 sentence guideline),Compress to 2 sentences
```

---

## Required Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| `subject` | string (path) | required; the draft plan path | MUST match the path passed to `plan-builder-agent`. |
| `producedBy` | string | required; locked value `plan-critic-agent` | Hard-coded; any other value is a `FINDINGS_SCHEMA_INVALID` defect at consumption time. |
| `producedAt` | ISO 8601 timestamp with millisecond precision | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` | Locked W-01 (timestamp precision applies across all convergence schemas for uniform comparison). |
| `criticConfidence` | float | required; 0.0 <= x <= 1.0 | Self-reported confidence. Advisory only — the integrator uses this to weight critic suggestions versus reviewer findings on iteration 1. NOT used as a gate. |
| `dimensionsCovered[]` | inline array | required; subset of the locked 6-dimension enum | See Locked Dimension Enum below. Order is non-significant. |
| `predictedBlockingCount` | integer | required; >= 0 | MUST equal `count(predictedFindings where predictedSeverity == blocking)`. |
| `predictedAdvisoryCount` | integer | required; >= 0 | MUST equal `count(predictedFindings where predictedSeverity in {warning, info})`. |
| `predictedFindings[]` | typed array | required; may be empty | See predictedFindings[] row schema below. |

---

## Locked Dimension Enum

The 6 dimensions are LOCKED — they correspond one-to-one with the 6 reviewer agents that the plan-review harness invokes. Any value outside this set is a schema-validation error.

| Dimension | Reviewer agent counterpart |
|-----------|----------------------------|
| `feature-coverage` | `feature-coverage-reviewer-agent` |
| `strategy` | `strategy-reviewer-agent` |
| `ux` | `ux-reviewer-agent` |
| `phasing` | `phasing-reviewer-agent` |
| `parallelization` | `parallelization-reviewer-agent` |
| `agentic-workflow` | `agentic-workflow-reviewer-agent` |

The critic SHOULD cover all 6 dimensions on a typical run. If `dimensionsCovered[]` is a strict subset (e.g., due to `CRITIQUE_TOO_LARGE` truncation), the integrator MUST treat the missing dimensions as `unchecked` rather than `clean`.

---

## predictedFindings[] Row Schema

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | string | yes | Unique predicted finding ID within the critique (e.g., `P-01`, `P-02`). The `P-` prefix distinguishes critic predictions from formal `F-` findings. |
| `dimension` | enum | yes | MUST be in `dimensionsCovered[]` AND in the locked 6-dimension enum. |
| `predictedSeverity` | enum | yes | One of: `blocking`, `warning`, `info`. The critic does NOT use the full reviewer enum — it predicts only at convergence-severity granularity. |
| `locationHint` | string | yes | Free-form locator (heading path, "Phase 3 - Wave 2", or "Frontmatter"). Less precise than `ConvergenceFindings.locationAnchor` because the critic is heuristic. |
| `concern` | string | yes | One-line statement of the predicted issue. |
| `suggestion` | string | no | Recommended remedy for `plan-builder-agent` to consider. |

---

## Validation Rules

1. **All required fields present.** `subject`, `producedBy`, `producedAt`, `criticConfidence`, `dimensionsCovered[]`, `predictedBlockingCount`, `predictedAdvisoryCount`, `predictedFindings[]` MUST all be present.
2. **`producedBy` locked.** MUST equal `plan-critic-agent`.
3. **`criticConfidence` range.** MUST be a float in `[0.0, 1.0]` inclusive.
4. **`dimensionsCovered[]` subset.** Every entry MUST be one of the 6 locked dimensions; the array MUST have length 1-6 with no duplicates.
5. **`predictedFindings[].dimension` in `dimensionsCovered[]`.** Every finding's `dimension` MUST appear in the file's `dimensionsCovered[]` array. A finding pointing to a dimension the critic did not cover is a schema-validation error.
6. **Count consistency.** `predictedBlockingCount` MUST equal `count(predictedFindings where predictedSeverity == blocking)`. `predictedAdvisoryCount` MUST equal `count(predictedFindings where predictedSeverity in {warning, info})`. `len(predictedFindings)` MUST equal `predictedBlockingCount + predictedAdvisoryCount`.
7. **`predictedSeverity` enum.** Each row MUST be one of: `blocking`, `warning`, `info`. The critic does NOT emit `advisory`.
8. **No duplicate IDs.** Two predictedFindings with the same `id` is a schema-validation error.
9. **`producedAt` precision (locked W-01).** ISO 8601 with millisecond precision.

---

## Error Codes

| Code | When emitted |
|------|--------------|
| `CRITIQUE_TOO_LARGE` | `plan-critic-agent` produced a critique exceeding the haiku-tier token budget. The agent runs in truncated mode (subset of reviewer instructions) and `dimensionsCovered[]` may be a strict subset of the 6 dimensions. Warning severity — the loop continues, the integrator pass receives a truncated critique. See `agent-result.schema.md` Error Categories. |

---

## Lifecycle

The critic produces the critique exactly once per `/loom-plan create --autoconverge` invocation:

```
plan-builder-agent (Step 4, full-generation mode)
        |
        v
   PLAN.md (draft)
        |
        v
plan-critic-agent (Step 4a)
        |
        v
   critique.toon  <-- THIS SCHEMA
        |
        v
plan-builder-agent (Step 4b, integrator mode w/ critique)
        |
        v
   PLAN.md (revised)
        |
        v
plan-review harness (Step 5, iteration 1 of autoconverge loop)
```

After Step 5, the convergence loop consumes `findings.toon` (per `findings.schema.md`). The critique is no longer read.

---

## Relationship to Other Schemas

- **`findings.schema.md`** — `ConvergenceFindings` is the formal-review counterpart. `PlanCritique` mirrors its shape so `plan-builder-agent` consumes both through the same integrator contract.
- **`agent-result.schema.md`** — The critic emits an `AgentResult` envelope; its `issues[]` are NOT used as the integrator input (the integrator reads `critique.toon` from disk). The AgentResult's `issues[]` carries any `CRITIQUE_TOO_LARGE` warnings.
- **`stage-context.schema.md`** — Critic execution is captured in the planning stage's `keyDecisions[]` and `nextStageHints[]`. The critic does NOT write its own stage-context file (it is a sub-step within the planning stage).
- **`plan.schema.md`** — The `subject` field MUST point at a valid PLAN.md per this schema.

---

## Example

### Critic predicts 4 blocking and 9 advisory concerns

```toon
subject: planning/PLAN-convergence-generalization.md
producedBy: plan-critic-agent
producedAt: 2026-06-12T15:00:00.000Z
criticConfidence: 0.65
dimensionsCovered[6]: feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow
predictedBlockingCount: 4
predictedAdvisoryCount: 9

predictedFindings[13]{id,dimension,predictedSeverity,locationHint,concern,suggestion}:
  P-01,phasing,blocking,Phase 3 - Wave 2,Phase has 11 deliverables (>8 limit),Split into 3a (schema) and 3b (driver) — same wave
  P-02,strategy,blocking,Overview,No reference to locked decision C-06 (scope-expansion guard),Add C-06 cross-reference and explain how F-01 implements it
  P-03,phasing,blocking,Phase 5 - Wave 2,Phase 5 ACs depend on Phase 11 helper but Phase 11 is in Wave 3,Promote Phase 11 to Wave 2 (serial dependency)
  P-04,parallelization,blocking,Wave 1,Two phases declare overlapping File Ownership: agents/convergence-driver.md,Use disjoint sections or merge phases
  P-05,ux,warning,Overview,Overview is 4 sentences; spec guideline is 1-3,Compress to 2 sentences
  P-06,feature-coverage,warning,Feature F-02,No acceptance criterion verifies haiku-tier model resolution,Add AC: critic frontmatter must declare model: haiku
  P-07,agentic-workflow,warning,Phase 7,plan-builder-agent integrator mode entry conditions not documented,Add explicit guard: integrator mode requires {findings.toon + subject}
  P-08,strategy,warning,Risks,Risk R-03 has no mitigation owner,Assign to Phase 7
  P-09,phasing,warning,Phase 4,Phase has 1 deliverable; merge with adjacent same-wave phase,Merge with Phase 3
  P-10,ux,info,Tech Stack,Row order is layer-then-tooling; canonical order is tooling-then-layer,Reorder rows
  P-11,parallelization,info,Wave 3,3 parallel phases — close to dispatch budget cap,Consider serializing W3a + W3b
  P-12,agentic-workflow,info,Frontmatter,planVersion 2 declared but State Machines section omitted,Either add State Machines or downgrade to planVersion 1
  P-13,feature-coverage,info,Milestone M-02,Gate criteria do not name the e2e fixture path,Cite test/e2e/autoconverge-fixture.test.ts
```

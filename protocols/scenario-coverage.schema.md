# Scenario Coverage Report Schema

Traceability artifact at `.plan-execution/ephemeral/scenario-coverage.toon`. Emitted by the `convergence-planner-agent` alongside the criteria-plan. Maps every requirement (`R-NN` from a `contract-*` wiki page or PLAN.md acceptance criterion) to the scenarios that cover it. Flags uncovered requirements as warnings — the report is the audit trail proving the convergence-planner's claim of ≥2× target density vs. acceptance-criteria-only seeding.

Cross-references:
- `scenario.schema.md` — schema of the scenarios referenced by `coveringScenarios[]`
- `contract-page-extensions.schema.md` — `R-NN` IDs come from the `## Requirements` section
- `convergence-tier.schema.md` — `tier` field uses tier names from this schema
- `criteria-plan.schema.md` — criteria-plan and coverage report share scenario references
- `validation-rules.md` — severity conventions

---

## Location

`.plan-execution/ephemeral/scenario-coverage.toon`

Ephemeral artifact; regenerated on each `/loom-converge plan` invocation. Atomic write per `execution-conventions.md`.

---

## File Format

```toon
generatedAt: 2026-05-23T10:00:00Z
generatedBy: convergence-planner-agent
sourcePlan: PLAN-refund-flow.md
sourceContractPages[1]: .loom/wiki/pages/contract-billing.md
totalRequirements: 8
totalScenarios: 11
coverageSummary:
  covered: 6
  uncovered: 1
  partial: 1
entries[8]{requirementId,sourceFile,coveringScenarios,coverageStatus,tier}:
  R-01,.loom/wiki/pages/contract-billing.md,"S-01,S-02",covered,integration
  R-02,.loom/wiki/pages/contract-billing.md,"S-03,S-04,S-09",covered,integration
  R-03,.loom/wiki/pages/contract-billing.md,S-05,covered,unit
  R-04,.loom/wiki/pages/contract-billing.md,"S-07,S-08",covered,integration
  R-05,.loom/wiki/pages/contract-billing.md,S-10,partial,e2e
  R-06,.loom/wiki/pages/contract-billing.md,S-11,covered,qa-review
  R-07,.loom/wiki/pages/contract-billing.md,S-06,covered,integration
  R-08,.loom/wiki/pages/contract-billing.md,,uncovered,
warnings[2]: R-05 has only partial coverage — only happy-path scenarios; add at least one error-tagged scenario, R-08 is uncovered — no scenario references this requirement
```

---

## Top-Level Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `generatedAt` | ISO 8601 | **Required.** When the report was emitted. |
| `generatedBy` | string | **Required.** Agent name (typically `convergence-planner-agent`). |
| `sourcePlan` | string \| null | **Required, nullable.** Path to the PLAN.md whose acceptance criteria contributed requirements. Null for pure contract-page coverage. |
| `sourceContractPages` | string[] | **Required (may be empty).** Paths to `.loom/wiki/pages/contract-*.md` whose `## Requirements` sections contributed requirements. |
| `totalRequirements` | integer | **Required.** Count of `R-NN` IDs across all sources. |
| `totalScenarios` | integer | **Required.** Count of distinct scenarios across all sources. |
| `coverageSummary` | object | **Required.** Aggregate counts: `{covered, uncovered, partial}`. All three keys required, integer values, sum equals `totalRequirements`. |
| `entries` | object[] | **Required, length = `totalRequirements`.** One entry per requirement. See `## Entry Reference`. |
| `warnings` | string[] | **Required (may be empty).** Human-readable warnings — one per uncovered or partial entry. |

---

## Entry Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `requirementId` | string | **Required.** R-NN from a contract page or a plan acceptance criterion ID (e.g., `phase-3-ac-1`). Unique within `entries[]`. |
| `sourceFile` | string | **Required.** Path to the file the requirement was extracted from. For contract pages: `.loom/wiki/pages/contract-{domain}.md`. For plan criteria: the PLAN.md path. |
| `coveringScenarios` | string[] | **Required (may be empty).** Scenario IDs (S-NN) that test this requirement. Empty when `coverageStatus = uncovered`. Comma-separated in inline form. |
| `coverageStatus` | enum | **Required.** One of `covered`, `uncovered`, `partial`. See `## Status Definitions`. |
| `tier` | string \| null | **Required, nullable.** Highest test tier among `coveringScenarios[]` per `convergence-tier.schema.md` (`unit` < `integration` < `e2e` < `qa-review` by cost). Null when `coverageStatus = uncovered`. |

---

## Status Definitions

| Status | Definition | Severity |
|--------|------------|----------|
| `covered` | ≥1 covering scenario AND tag distribution includes a non-`happy-path` scenario when the requirement is functional with a failure mode. | OK |
| `partial` | ≥1 covering scenario but only happy-path coverage (no `error`/`edge-case`/`regression`-tagged scenario), OR `automatable: false` for all covering scenarios when the requirement is functional. | warning |
| `uncovered` | Zero covering scenarios reference this requirement. | warning |

### Heuristic for Linking Scenarios to Requirements

The convergence-planner uses the following resolution chain to associate a scenario with a requirement:

1. **Explicit citation.** If a scenario's `then[]` text contains the literal `R-NN` token, link explicitly.
2. **Same-page derivation.** Scenarios in a `contract-*` page's `## Scenarios` section are candidates for all `R-NN` on that page; the planner uses keyword overlap (>40% token-set Jaccard between requirement text and scenario `given`/`when`/`then`) to associate.
3. **Plan-phase association.** Scenarios under a plan phase whose acceptance criteria contain the requirement's containing criterion are linked.

The resolution chain is run at report emit time; results are deterministic for a given input.

---

## Validation Rules

Severity follows `validation-rules.md` conventions.

| Rule | Severity | Description |
|------|----------|-------------|
| `generatedAt` is ISO 8601 | blocking | Parse failure rejects the report. |
| `totalRequirements` equals `entries[]` length | blocking | Internal consistency. |
| `coverageSummary` keys sum to `totalRequirements` | blocking | Sum of `covered + uncovered + partial` = total. |
| Every `requirementId` unique within `entries[]` | blocking | No duplicates. |
| Every `requirementId` resolves to source | warning | `R-NN` MUST appear in `sourceFile`'s requirements section. |
| Every entry in `coveringScenarios[]` resolves to a scenario | warning | Each `S-NN` MUST exist in a known parent (plan phase or contract page). |
| `coverageStatus = uncovered` iff `coveringScenarios[]` empty | blocking | Empty array requires uncovered status; non-empty forbids uncovered. |
| `coverageStatus = covered` requires tier resolution | blocking | When covered, `tier` MUST be a valid tier name. |
| `coverageStatus = uncovered` requires `tier: null` | blocking | Uncovered entries have no tier. |
| `warnings[]` count matches uncovered + partial | warning | Each non-`covered` entry SHOULD generate a corresponding warning. |
| Density check (info) | info | If `(totalScenarios / totalRequirements) < 2`, log an info finding noting the convergence-planner did not achieve ≥2× target density on this input. |

---

## Convergence-Planner Behavior

The `convergence-planner-agent` (Phase 3 of PLAN-spec-upgrades.md) MUST:

1. **Extract requirements** from:
   - Every `contract-*` page's `## Requirements` section in `sourceContractPages[]`.
   - Every acceptance criterion in `sourcePlan`'s phases that maps to an observable output.
2. **Extract scenarios** from:
   - The same contract pages' `## Scenarios` sections.
   - The same plan's phase `#### Scenarios` subsections.
3. **Run the resolution chain** above to link scenarios to requirements.
4. **Emit the report** with full traceability.
5. **Fail-loud on uncovered requirements** — uncovered entries become warnings; ≥3 uncovered triggers a `partial` status on the criteria-plan emission (per `criteria-plan.schema.md`).

---

## Worked Example

Given a `contract-billing.md` with 4 requirements:

- R-01: Issue invoice (functional)
- R-02: Idempotent capture (functional, with replay error mode)
- R-03: Latency p95 < 200ms (non-functional)
- R-04: Refund bounded by original (functional, with error mode)

And 6 scenarios on the same page:

- S-01: Issue invoice happy path (covers R-01) → tier integration
- S-02: Reject duplicate invoice ID (covers R-01) → tier integration
- S-03: Capture happy path (covers R-02) → tier integration
- S-04: Capture replay returns original (covers R-02) → tier integration
- S-05: Refund happy path (covers R-04) → tier integration
- S-06: Refund exceeding original is rejected (covers R-04) → tier integration

Report:

```toon
generatedAt: 2026-05-23T10:00:00Z
generatedBy: convergence-planner-agent
sourcePlan:
sourceContractPages[1]: .loom/wiki/pages/contract-billing.md
totalRequirements: 4
totalScenarios: 6
coverageSummary:
  covered: 3
  uncovered: 1
  partial: 0
entries[4]{requirementId,sourceFile,coveringScenarios,coverageStatus,tier}:
  R-01,.loom/wiki/pages/contract-billing.md,"S-01,S-02",covered,integration
  R-02,.loom/wiki/pages/contract-billing.md,"S-03,S-04",covered,integration
  R-03,.loom/wiki/pages/contract-billing.md,,uncovered,
  R-04,.loom/wiki/pages/contract-billing.md,"S-05,S-06",covered,integration
warnings[1]: R-03 is uncovered — no scenario references this non-functional latency requirement; consider adding a perf-tagged scenario or marking it qa-review
```

Density: `6 scenarios / 4 requirements = 1.5×` — does not yet meet the 2× threshold. The planner emits an info finding suggesting additional scenarios.

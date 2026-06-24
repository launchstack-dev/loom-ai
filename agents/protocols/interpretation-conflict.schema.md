---
description: "Interpretation Conflict & Coverage Gap Schema"
---

# Interpretation Conflict & Coverage Gap Schema

Defines the TOON schemas for tracking conflicts between plan interpretation and test interpretation, and for gaps where coverage exists in only one side.

These schemas are used by the interpretation-reviewer-agent and the dual-track convergence pipeline to surface mismatches that could cause false-positive convergence or missed regressions.

---

## InterpretationConflict Schema

An InterpretationConflict records a disagreement between how the plan describes a behavior and how tests verify it.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique ID. Format: `IC-NNN` (zero-padded to 3 digits). |
| source | enum | yes | Origin of the conflict: `dual-track`, `coverage-gap`, `semantic-mismatch`. |
| planInterpretation | string | yes | How the plan describes the behavior. Max 1000 characters. |
| testInterpretation | string | yes | How the test suite verifies the behavior. Max 1000 characters. |
| severity | enum | yes | Impact level: `blocking`, `warning`, `info`. |
| status | enum | yes | Resolution state: `open`, `resolved`, `accepted`, `wont-fix`. |
| resolution | string | conditional | Description of how the conflict was resolved. Required when status is `resolved`. |
| resolvedAt | ISO 8601 | conditional | Timestamp of resolution. Required when status is `resolved`. |
| featureRef | string | yes | Feature reference. Format: `F-NN`. |
| phaseRef | string | no | Phase reference. Format: `Phase N`. |
| scenarioRef | string | no | Scenario reference identifying the specific scenario the conflict targets. Format: `Phase {N}.S-{NN}` (plan-phase scenario) or `F-{NN}.S-{NN}` (roadmap-feature scenario). When set, the conflict is scoped to a single Given/When/Then block rather than the broader feature or phase; the interpretation-reviewer-agent uses this to produce more precise findings. At least one of `featureRef`, `phaseRef`, or `scenarioRef` MUST be non-empty (a conflict must target something). |

### Example

```toon
id: IC-001
source: dual-track
planInterpretation: "POST /api/users returns 201 with the created user object including all fields"
testInterpretation: "POST /api/users returns 201 but test only checks id and email fields exist"
severity: warning
status: open
resolution:
resolvedAt:
featureRef: F-01
phaseRef: Phase 2
scenarioRef: Phase 2.S-01
```

### Typed Array Form

```toon
conflicts[N]{id,source,planInterpretation,testInterpretation,severity,status,resolution,resolvedAt,featureRef,phaseRef,scenarioRef}:
  IC-001,dual-track,"Plan says return all fields","Test only checks id and email",warning,open,,,F-01,Phase 2,Phase 2.S-01
  IC-002,semantic-mismatch,"Plan says 401 for expired tokens","Test expects 403 for expired tokens",blocking,resolved,"Aligned on 401 per RFC 6750",2026-04-18T10:00:00Z,F-03,Phase 4,Phase 4.S-03
  IC-003,coverage-gap,"Roadmap feature scenario requires rate-limit","No test covers rate-limit",warning,open,,,F-05,,F-05.S-02
```

---

## CoverageGap Schema

A CoverageGap records a behavior that exists in the plan but has no corresponding test, or a test that verifies behavior not described in the plan.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique ID. Format: `CG-NNN` (zero-padded to 3 digits). |
| source | enum | yes | Gap direction: `plan-only` (plan has it, tests do not), `test-only` (tests have it, plan does not). |
| description | string | yes | What is missing. Max 500 characters. |
| planRef | string | no | Reference to the plan section or acceptance criterion. |
| testRef | string | no | Reference to the test file or test name. |
| severity | enum | yes | Impact level: `blocking`, `warning`, `info`. |
| resolvedAt | ISO 8601 | no | Timestamp when the gap was filled. |
| resolutionRef | string | no | Reference to the commit, file, or PR that resolved the gap. |

### Example

```toon
id: CG-001
source: plan-only
description: "Plan requires rate limiting on POST /api/auth/login but no test covers this behavior"
planRef: Phase 3 Acceptance Criteria item 4
testRef:
severity: blocking
resolvedAt:
resolutionRef:
```

### Typed Array Form

```toon
gaps[N]{id,source,description,planRef,testRef,severity,resolvedAt,resolutionRef}:
  CG-001,plan-only,"Rate limiting on login not tested",Phase 3 AC-4,,blocking,,
  CG-002,test-only,"Test checks admin role but plan has no admin feature",,tests/auth/admin.spec.ts,warning,,
  CG-003,plan-only,"Cascade delete not verified",Phase 2 AC-2,,info,2026-04-18T11:00:00Z,commit abc123
```

---

## Validation Rules

### InterpretationConflict

1. **ID format.** Must match pattern `IC-NNN` (3 digits, zero-padded).
2. **Source enum.** Must be one of: `dual-track`, `coverage-gap`, `semantic-mismatch`.
3. **Severity enum.** Must be one of: `blocking`, `warning`, `info`.
4. **Status enum.** Must be one of: `open`, `resolved`, `accepted`, `wont-fix`.
5. **Resolution required when resolved.** If `status` is `resolved`, both `resolution` and `resolvedAt` must be non-empty.
6. **Feature ref format.** `featureRef` must match pattern `F-NN`.
7. **Phase ref format.** If present, `phaseRef` must match pattern `Phase N` (where N is a non-negative integer).
8. **Max lengths.** `planInterpretation` and `testInterpretation` must not exceed 1000 characters.
9. **Scenario ref format.** If present, `scenarioRef` must match pattern `Phase \d+\.S-\d{2,}` or `F-\d{2,}\.S-\d{2,}`.
10. **At least one target.** At least one of `featureRef`, `phaseRef`, or `scenarioRef` must be non-empty. A conflict that targets nothing is rejected.
11. **Scenario ref consistency.** When `scenarioRef` is set in the form `Phase N.S-NN`, `phaseRef` (if also set) MUST equal `Phase N`. When `scenarioRef` is set in the form `F-NN.S-NN`, `featureRef` (if also set) MUST equal `F-NN`. Mismatches are blocking.

### CoverageGap

1. **ID format.** Must match pattern `CG-NNN` (3 digits, zero-padded).
2. **Source enum.** Must be one of: `plan-only`, `test-only`.
3. **Severity enum.** Must be one of: `blocking`, `warning`, `info`.
4. **At least one ref.** At least one of `planRef` or `testRef` must be non-empty (a gap must reference something).
5. **Max length.** `description` must not exceed 500 characters.
6. **Resolution consistency.** If `resolvedAt` is set, `resolutionRef` should also be set.

---

## Relationship to Other Schemas

- **taxonomy.md** -- Conflicts and gaps reference features and phases from the planning hierarchy.
- **criteria-plan.schema.md** -- Coverage gaps may reference specific criteria entries.
- **convergence-tier.schema.md** -- Blocking conflicts gate convergence at the feature or milestone tier.
- **agent-result.schema.md** -- The interpretation-reviewer-agent returns conflicts and gaps inside its AgentResult envelope.
- **scenario.schema.md** -- Defines the scenarios referenced by `scenarioRef`. Scenario-level conflicts are the finest-grained target the interpretation-reviewer-agent emits.

# Interpretation Report Schema

Defines the `interpretation-report.toon` format produced by the interpretation-reviewer-agent. The interpretation report is the envelope that wraps conflicts and coverage gaps discovered by cross-referencing plan deliverables against test criteria.

This schema references the `InterpretationConflict` and `CoverageGap` schemas defined in `interpretation-conflict.schema.md`.

---

## Schema

```toon
schemaVersion: 1
createdAt: 2026-04-18T10:00:00Z
updatedAt: 2026-04-18T10:15:00Z
reviewedAt: 2026-04-18T10:00:00Z
agent: interpretation-reviewer-agent
agentModel: opus
planSource: PLAN.md
criteriaSource: criteria-plan.toon

summary:
  totalConflicts: 3
  blocking: 1
  warning: 1
  info: 1
  totalGaps: 2
  planOnlyGaps: 1
  testOnlyGaps: 1
  priorResolutionsApplied: 1

conflicts[N]{id,source,planInterpretation,testInterpretation,severity,status,resolution,resolvedAt,featureRef,phaseRef}:
  IC-001,dual-track,"Plan says return all user fields","Test only checks id and email fields",warning,open,,,F-01,Phase 2
  IC-002,semantic-mismatch,"Plan says 401 for expired tokens","Test expects 403 for expired tokens",blocking,open,,,F-03,Phase 4
  IC-003,coverage-gap,"Plan requires pagination on list endpoint","Test asserts unbounded array response",info,open,,,F-02,Phase 3

coverageGaps[N]{id,source,description,planRef,testRef,severity,resolvedAt,resolutionRef}:
  CG-001,plan-only,"Rate limiting on login endpoint not tested",Phase 3 AC-4,,blocking,,
  CG-002,test-only,"Test covers admin role deletion but plan has no admin feature",,tests/auth/admin.spec.ts,warning,,

wikiResolutions[N]{conflictPattern,resolution,wikiRef}:
  "401 vs 403 for expired tokens","Prior resolution: use 401 per RFC 6750",.loom/wiki/auth-decisions.md
```

---

## Field Descriptions

### Header Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | integer | yes | Schema version. Currently `1`. |
| `createdAt` | ISO 8601 | yes | When the report was generated. |
| `updatedAt` | ISO 8601 | yes | Last modification time. |
| `agent` | string | yes | Always `interpretation-reviewer-agent`. |
| `planSource` | string | yes | Path or identifier of the plan document analyzed. Alias: `planRef`. |
| `criteriaSource` | string | yes | Path or identifier of the criteria plan analyzed. Alias: `criteriaRef`. |
| `reviewedAt` | ISO 8601 | yes | Timestamp when the review was performed. Typically equals `createdAt` for initial reports. |
| `agentModel` | string | yes | Model used by the interpretation-reviewer-agent (e.g., `opus`). |

### summary

Nested block. Aggregate counts for quick triage.

| Field | Type | Description |
|-------|------|-------------|
| `totalConflicts` | integer | Total number of conflicts found. |
| `blocking` | integer | Number of conflicts with severity `blocking`. |
| `warning` | integer | Number of conflicts with severity `warning`. |
| `info` | integer | Number of conflicts with severity `info`. |
| `totalGaps` | integer | Total number of coverage gaps found. |
| `planOnlyGaps` | integer | Gaps where the plan has coverage but tests do not. |
| `testOnlyGaps` | integer | Gaps where tests exist but the plan does not describe the behavior. |
| `priorResolutionsApplied` | integer | Number of conflicts suppressed or annotated due to prior wiki resolutions. |

### conflicts

Typed array. Each entry conforms to the `InterpretationConflict` schema defined in `interpretation-conflict.schema.md`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique ID. Format: `IC-NNN` (zero-padded to 3 digits). |
| `source` | enum | Origin: `dual-track`, `coverage-gap`, `semantic-mismatch`. |
| `planInterpretation` | string | How the plan describes the behavior. Max 1000 chars. |
| `testInterpretation` | string | How the test verifies the behavior. Max 1000 chars. |
| `severity` | enum | Impact level: `blocking`, `warning`, `info`. |
| `status` | enum | Resolution state: `open`, `resolved`, `accepted`, `wont-fix`. |
| `resolution` | string | How the conflict was resolved. Required when status is `resolved`. |
| `resolvedAt` | ISO 8601 | Timestamp of resolution. Required when status is `resolved`. |
| `featureRef` | string | Feature reference. Format: `F-NN`. |
| `phaseRef` | string | Phase reference. Format: `Phase N`. |

### coverageGaps

Typed array. Each entry conforms to the `CoverageGap` schema defined in `interpretation-conflict.schema.md`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique ID. Format: `CG-NNN` (zero-padded to 3 digits). |
| `source` | enum | Gap direction: `plan-only`, `test-only`. |
| `description` | string | What is missing. Max 500 chars. |
| `planRef` | string | Reference to plan section or acceptance criterion. |
| `testRef` | string | Reference to test file or test name. |
| `severity` | enum | Impact level: `blocking`, `warning`, `info`. |
| `resolvedAt` | ISO 8601 | When the gap was filled. |
| `resolutionRef` | string | Reference to commit, file, or PR that resolved the gap. |

### wikiResolutions

Typed array. Records prior conflict resolutions found in the project wiki that were applied to suppress or annotate conflicts in this report.

| Column | Type | Description |
|--------|------|-------------|
| `conflictPattern` | string | Description of the conflict pattern matched from wiki. |
| `resolution` | string | The prior resolution that was applied. |
| `wikiRef` | string | Path to the wiki page containing the resolution. |

---

## Validation Rules

1. **All header fields present.** `schemaVersion`, `createdAt`, `updatedAt`, `reviewedAt`, `agent`, `agentModel`, `planSource`, `criteriaSource` must be non-empty.
2. **Summary counts consistent.** `totalConflicts` must equal the length of `conflicts`. `totalGaps` must equal the length of `coverageGaps`. `blocking + warning + info` must equal `totalConflicts`. `planOnlyGaps + testOnlyGaps` must equal `totalGaps`.
3. **Conflict entries valid.** Each conflict must conform to `InterpretationConflict` validation rules in `interpretation-conflict.schema.md`.
4. **Coverage gap entries valid.** Each gap must conform to `CoverageGap` validation rules in `interpretation-conflict.schema.md`.
5. **Severity enum.** All severity values must be one of: `blocking`, `warning`, `info`.
6. **Unique IDs.** All `id` values across conflicts and coverage gaps must be unique.
7. **Wiki resolutions optional.** The `wikiResolutions` array may be empty if no wiki exists or no prior resolutions matched.

---

## Relationship to Other Schemas

- **interpretation-conflict.schema.md** -- Defines the `InterpretationConflict` and `CoverageGap` schemas that this report wraps.
- **taxonomy.md** -- Conflicts and gaps reference features and phases from the planning hierarchy.
- **criteria-plan.schema.md** -- The criteria plan is one of the two inputs cross-referenced by this report.
- **agent-result.schema.md** -- The interpretation-reviewer-agent returns this report inside its AgentResult envelope.
- **convergence-tier.schema.md** -- Blocking conflicts gate convergence at the feature or milestone tier.

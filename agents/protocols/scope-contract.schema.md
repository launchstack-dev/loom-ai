---
description: "Scope Contract Schema"
---

# Scope Contract Schema

Defines the `scope-contract.toon` format produced by the pre-flight scope system (Prompt Refiner + Scope Interrogator). The scope contract is the single source of truth for what is being built, what decisions have been made, and how completion is verified. Every downstream agent (roadmap, plan, execution, review) reads this contract.

## Schema

```toon
schemaVersion: 1
createdAt: 2026-04-13T10:30:00Z
updatedAt: 2026-04-13T11:45:00Z
sourcePrompt: "Add team management with roles and invitations"
briefHash: a1b2c3d4e5f6

intent: Build a team management system with RBAC and invite flows on top of the existing Express API.
mvpScope: CRUD for teams and memberships with admin/member roles, no invitations yet.
fullScope: Full team management with role hierarchy, email invitations, and ownership transfer.

decisions[N]{id,category,question,answer,rationale,source}:
  D-01,architecture,API style,REST endpoints,Matches existing Express routes,codebase-pattern
  D-02,data-model,Primary entities,User + Team + Membership,Core domain from brief,inferred
  D-03,auth,Access control,Role-based (admin/member/viewer),Standard RBAC pattern,user-choice
  D-04,scope,Email notifications,Out of scope for MVP,User confirmed defer to v2,user-choice

assumptions[N]{id,assumption,validated,validatedBy}:
  A-01,SQLite sufficient for expected load,true,user-confirmed
  A-02,No existing user table to migrate from,true,codebase-scan
  A-03,Frontend is out of scope,true,user-confirmed

nonGoals[N]:
  Email notifications
  Real-time updates
  Mobile-specific API
  Data migration from external systems

successCriteria[N]{id,criterion,testable,verificationMethod,convergenceMethod,convergenceTolerance}:
  SC-01,All CRUD endpoints return correct status codes,true,integration test,json-deep-equal,1.0
  SC-02,RBAC enforced on all protected routes,true,auth test suite,json-deep-equal,1.0
  SC-03,TypeScript compiles with no errors,true,tsc --noEmit,cli-exit-code,1.0
  SC-04,All tests pass,true,vitest run,cli-exit-code,1.0

techContext:
  stack: typescript,express,better-sqlite3
  testFramework: vitest
  existingPatterns: repository-pattern,route-handler,middleware-chain
  relatedFiles[N]: src/routes/users.ts,src/db/repositories/user.ts
```

## Field Descriptions

### Header Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | integer | Schema version. Currently `1`. |
| `createdAt` | ISO 8601 timestamp | When the contract was first generated. |
| `updatedAt` | ISO 8601 timestamp | Last modification time. Updated when execution-discovered entries are appended. |
| `sourcePrompt` | string | The original user prompt, truncated to 200 characters. Preserved for traceability. |
| `briefHash` | string | Hash of the `refined-brief.md` that produced this contract. Detects if the brief changed after contract generation. |

### Intent Fields

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | 1-2 sentence refined intent statement. What the user wants, stripped of ambiguity. |
| `mvpScope` | string | 1 sentence minimum viable version. The smallest useful deliverable. |
| `fullScope` | string | 1 sentence complete vision. Everything the user ultimately wants, including deferred items. |

### decisions

Typed array. Every architectural, data, auth, integration, UX, and scope decision resolved during the Scope Interrogator phase.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique decision ID. Format: `D-NN` (zero-padded two digits). Execution-discovered entries continue the sequence. |
| `category` | enum | One of: `architecture`, `data-model`, `auth`, `integration`, `ux`, `scope`, `success`, `constraints`. |
| `question` | string | The decision point that was resolved. Brief, noun-phrase style. |
| `answer` | string | The resolved answer. Concrete and specific, not vague. |
| `rationale` | string | Why this answer was chosen. One sentence. |
| `source` | enum | How the decision was made. One of: `codebase-pattern`, `user-choice`, `inferred`, `default-accepted`, `execution-discovered`. |

### assumptions

Typed array. Inferences the system made that were validated (or not) before execution.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique assumption ID. Format: `A-NN`. |
| `assumption` | string | The inference stated as a factual claim. |
| `validated` | boolean | `true` if confirmed, `false` if unvalidated or disproven. |
| `validatedBy` | enum | How validation occurred. One of: `user-confirmed`, `codebase-scan`, `execution-discovered`, `unvalidated`. |

### nonGoals

Simple inline array. Each entry is a short phrase describing something explicitly excluded from scope. Non-goals prevent scope creep during execution. If an agent encounters work that falls under a non-goal, it must skip it and note the skip in its AgentResult.

### successCriteria

Typed array. Every criterion that must pass for the contract to be considered fulfilled. Criteria come from two sources: decision-implied criteria (generated during the Scope Interrogator phase as decisions are locked) and universal criteria (always included: compilation, tests, lint).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique criterion ID. Format: `SC-NN`. |
| `criterion` | string | What must be true. Written as a testable assertion. |
| `testable` | boolean | `true` if the criterion can be verified automatically. `false` for manual-only checks. |
| `verificationMethod` | string | How to verify. Examples: `integration test`, `vitest run`, `tsc --noEmit`, `grep for pattern`, `manual review`. |
| `convergenceMethod` | enum (optional) | Convergence comparison method if this criterion is convergence-testable. One of: `json-deep-equal`, `pixel-diff`, `text-diff`, `cli-exit-code`, `semantic-html`, `row-diff`. Empty if not convergence-suitable. |
| `convergenceTolerance` | float (optional) | Score threshold 0.0-1.0 for convergence comparison. 1.0 = exact match. Empty if not convergence-suitable. |

### techContext

Nested block. Concrete technical context detected from the codebase. Not aspirational — only includes what actually exists.

| Field | Type | Description |
|-------|------|-------------|
| `stack` | comma-separated list | Primary technologies. Detected from package.json, imports, file extensions. |
| `testFramework` | string | Test runner in use. |
| `existingPatterns` | comma-separated list | Architectural patterns found in the codebase (e.g., `repository-pattern`, `middleware-chain`). |
| `relatedFiles` | inline array | Files in the codebase that overlap with or are relevant to the contracted scope. |

## Contract Evolution Rules

The scope contract is a living document during execution. New entries may be appended but existing entries must not be modified without user approval.

1. **Execution-discovered decisions.** When an execution agent encounters an undecided point not covered by the contract, it appends a new decision with `source: execution-discovered` and continues. The orchestrator flags these in the wave summary for user review.

2. **Execution-discovered assumptions.** If an assumption proves false during execution (e.g., "no existing user table" but one is found), the agent updates `validated` to `false` and sets `validatedBy: execution-discovered`. The orchestrator decides whether to re-plan.

3. **New success criteria.** Execution agents may append criteria with `SC-NN` IDs continuing the existing sequence. These are added, never removed.

4. **Non-goal violations.** If an agent's work touches a listed non-goal, the orchestrator logs a drift warning. Repeated violations trigger a re-plan proposal.

5. **updatedAt field.** Any mutation to the contract updates this timestamp.

6. **Append-only semantics.** New rows are appended to typed arrays. Existing rows are never deleted. Field values on existing rows are only changed for `assumptions.validated` and `assumptions.validatedBy` (to reflect discovered truth).

## Validation Rules

A contract is "complete" and ready for downstream consumption when all of the following hold:

1. **All header fields present.** `schemaVersion`, `createdAt`, `sourcePrompt`, `briefHash`, `intent`, `mvpScope`, `fullScope` must be non-empty.
2. **At least one decision.** The `decisions` array must contain at least one entry.
3. **All assumptions validated.** Every entry in `assumptions` must have `validated: true`. If any assumption has `validated: false` and `validatedBy: unvalidated`, the contract is incomplete — the Scope Interrogator must resolve it before proceeding.
4. **At least one success criterion.** The `successCriteria` array must not be empty.
5. **Universal criteria present.** The following criteria must exist (IDs may vary):
   - TypeScript compilation passes (or equivalent for the detected stack)
   - All tests pass
6. **No empty answers.** Every decision must have a non-empty `answer` and `rationale`.
7. **techContext populated.** The `stack` field must contain at least one technology. `testFramework` must be set.
8. **Valid enums.** All `source` values in `decisions` must be one of the allowed enum values. All `validatedBy` values in `assumptions` must be one of the allowed enum values.
9. **Unique IDs.** All `id` values across `decisions`, `assumptions`, and `successCriteria` must be unique within their respective arrays.

## Relationship to Other Schemas

- **AgentResult** (`agent-result.schema.md`): Execution agents reference contract decision IDs in their `contractAmendments` field when a decision needs revision.
- **Plan** (`plan.schema.md`): Plan tasks inherit success criteria IDs from the contract. Each task's acceptance criteria trace back to one or more `SC-NN` entries.
- **Pipeline State** (`pipeline-state.schema.md`): The orchestrator tracks contract drift (execution-discovered entries, violated non-goals) in the pipeline state.
- **Roadmap** (`roadmap.schema.md`): Features in the roadmap are derived from contract decisions and mvpScope. Non-goals feed the roadmap's out-of-scope annotations.

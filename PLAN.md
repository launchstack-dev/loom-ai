---
planVersion: 2
name: "Loom Convergence Testing & Planning Taxonomy"
status: draft
created: 2026-04-18
lastReviewed: 2026-04-19
roadmapRef: ROADMAP.md
totalPhases: 9
totalWaves: 4
---

# Plan: Loom Convergence Testing & Planning Taxonomy

## Overview

This plan implements a convergence-first testing architecture for Loom where test criteria are co-created in parallel with plans, an interpretation reviewer catches conflicts before execution begins, and a 4-tier convergence model (unit, integration, e2e, QA review) gates execution at phase, feature, and milestone boundaries. The work spans protocol formalization, dual-track parallel planning, a full convergence engine with behavioral hardening, an e2e pipeline backed by Playwright, and cross-system integration with wiki, context management, and logging.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Agent format | Markdown | Claude Code agent/command/skill definitions |
| State format | TOON v1 | All pipeline state, criteria plans, delta reports, conflict reports |
| Test runner (unit) | Vitest / Jest / Pytest | Framework-detected per project |
| Test runner (e2e) | Playwright (latest) | Headless browser automation |
| Browser (authenticated) | Chrome MCP | Real Chrome via `--chrome` flag |
| E2E spec format | YAML | User stories for e2e test discovery |
| Hooks | TypeScript | Context budget, checkpoint, statusline |
| Package manager | Bun (latest) | Preferred; npm fallback |
| Runtime | Node / Bun | TypeScript execution |

## Schema / Type Definitions

### Taxonomy

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| levels | string[] | Required, exactly 4 items | Must be ["milestone", "feature", "phase", "wave"] |
| convergenceLevels | map<string, string[]> | Required | Each level key must exist in levels; values are valid tier names |
| hierarchy | map<string, string> | Required | Maps child level to parent level |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_taxonomy_level | levels[*] | PRIMARY | Level lookup |

#### Cascade Behavior

Not applicable — Taxonomy is a singleton protocol definition, not a relational entity.

---

### CriteriaPlan

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| schemaVersion | integer | Required, >= 1 | Must be positive integer |
| createdAt | string (ISO 8601) | Required | Valid ISO 8601 datetime |
| updatedAt | string (ISO 8601) | Required | Valid ISO 8601 datetime, >= createdAt |
| sourceContext | string | Required, non-empty | Reference to PLAN.md phase or ROADMAP.md feature |
| mode | string | Required | One of: "interactive", "light", "auto" |
| convergenceMode | string | Required | One of: "criteria", "target" |
| intent | string | Required, non-empty | Max 500 chars |
| criteria | CriteriaPlanEntry[] | Required, >= 1 item | Each entry must have unique id |
| reviewers | ReviewerEntry[] | Required, >= 1 item | Each entry must have unique id |
| testConfig | TestConfig | Required | runner must be a known runner name |
| reviewConfig | ReviewConfig | Required | All severity levels valid |
| budget | BudgetConfig | Required | maxIterations >= 1 |

### CriteriaPlanEntry

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: C-NN |
| name | string | Required, non-empty | Max 200 chars |
| type | string | Required | One of: "hard", "soft" |
| verifier | string | Required | One of: "test-runner", "security-review", "code-review", "performance-review", "e2e-runner" |
| passCondition | string | Required | One of: "all-pass", "zero-critical", "zero-blocking" |
| blocking | boolean | Required | — |
| priority | string | Required | One of: "P0", "P1", "P2" |
| source | string | Required | One of: "plan-acceptance", "inferred", "roadmap" |
| rationale | string | Required, non-empty | Max 300 chars |
| testTier | string | Required | One of: "unit", "integration", "e2e", "qa-review" | <!-- Review: Finding 1 — testTier added to live schema -->

### ReviewerEntry

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: R-NN |
| type | string | Required | One of: "test-runner", "security-review", "code-review", "performance-review", "e2e-runner" |
| agent | string | Required, non-empty | Must reference a registered agent |
| dimensions | string | Required | Comma-separated dimension names |
| blocking | boolean | Required | — |
| model | string | Optional | One of: "opus", "sonnet", "haiku", "" |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_criteria | criteria[*].id | PRIMARY | Criterion lookup |
| pk_reviewers | reviewers[*].id | PRIMARY | Reviewer lookup |
| idx_criteria_tier | criteria[*].testTier | INDEX | Filter criteria by convergence tier |
| idx_criteria_priority | criteria[*].priority | INDEX | Filter criteria by priority |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| CriteriaPlan | CriteriaPlanEntry | CASCADE | CASCADE |
| CriteriaPlan | ReviewerEntry | CASCADE | CASCADE |

---

### InterpretationConflict

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: IC-NNN |
| source | string | Required | One of: "dual-track", "coverage-gap", "semantic-mismatch" |
| planInterpretation | string | Required, non-empty | Max 1000 chars |
| testInterpretation | string | Required, non-empty | Max 1000 chars |
| severity | string | Required | One of: "blocking", "warning", "info" |
| status | string | Required | One of: "open", "resolved", "accepted", "wont-fix" |
| resolution | string | Optional | Non-empty when status is "resolved" |
| resolvedAt | string (ISO 8601) | Optional | Required when status is "resolved" |
| featureRef | string | Required | Format: F-NN, must reference a valid feature |
| phaseRef | string | Optional | Format: Phase N, references a plan phase |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_conflict | id | PRIMARY | Conflict lookup |
| idx_conflict_severity | severity | INDEX | Filter by severity |
| idx_conflict_status | status | INDEX | Filter by resolution status |
| idx_conflict_feature | featureRef | INDEX | Find conflicts per feature |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| CriteriaPlan | InterpretationConflict | CASCADE | CASCADE |

---

### CoverageGap

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: CG-NNN |
| source | string | Required | One of: "plan-only", "test-only" |
| description | string | Required, non-empty | Max 500 chars |
| planRef | string | Optional | Reference to plan phase or deliverable |
| testRef | string | Optional | Reference to criteria plan entry |
| severity | string | Required | One of: "blocking", "warning", "info" |
| resolvedAt | string (ISO 8601) | Optional | Required when gap is resolved | <!-- Review: Finding 3 — CoverageGap lacks resolution tracking -->
| resolutionRef | string | Optional | Reference to the fix (commit, criteria entry, etc.) | <!-- Review: Finding 3 -->

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_gap | id | PRIMARY | Gap lookup |
| idx_gap_source | source | INDEX | Filter by gap direction |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| InterpretationConflict | CoverageGap | SET NULL | CASCADE |

---

### ConvergenceTier

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| name | string | Required, unique | One of: "unit", "integration", "e2e", "qa-review" |
| level | integer | Required | 1-4, ascending order of cost |
| hierarchyLevel | string | Required | One of: "wave", "phase", "feature", "milestone" | <!-- Review: Finding 1 — fixed duplicate "phase" enum; added "wave" per 4-level taxonomy -->
| runner | string | Required, non-empty | Agent or CLI tool name |
| passCondition | string | Required | One of: "all-pass", "zero-critical", "zero-blocking" |
| defaultEnabled | boolean | Required | — |
| gatingBehavior | string | Required | One of: "block-wave", "block-feature", "block-milestone", "advisory" |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_tier | name | PRIMARY | Tier lookup |
| uq_tier_level | level | UNIQUE | Ordering uniqueness |

#### Cascade Behavior

Not applicable — ConvergenceTier is a reference/config entity with no foreign keys.

---

### E2EStory

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| name | string | Required, unique per milestone | Non-empty, max 200 chars |
| url | string | Optional | Valid URL when present |
| workflow | string | Required, non-empty | Description of user flow |
| preconditions | string[] | Required | May be empty array |
| format | string | Required | One of: "imperative", "bdd", "checklist" |
| steps | StoryStep[] | Required, >= 1 item | Each step has action and expected |
| milestoneRef | string | Required | Format: M-NN |
| screenshots | string[] | Optional | File paths to captured screenshots |
| consoleDumps | string[] | Optional | File paths to console captures |

### StoryStep

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| action | string | Required, non-empty | Max 500 chars |
| expected | string | Required, non-empty | Max 500 chars |
| status | string | Optional | One of: "pass", "fail", "skipped", null |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_story | name | PRIMARY | Story lookup |
| idx_story_milestone | milestoneRef | INDEX | Stories per milestone |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| E2EStory | StoryStep | CASCADE | CASCADE |

---

### PlaywrightTest

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| storyRef | string | Required | Must reference an existing E2EStory.name |
| testFile | string | Required | Valid file path ending in .spec.ts or .test.ts |
| sessionName | string | Required, unique | Non-empty, kebab-case |
| sessionMode | string | Required | One of: "headless", "chrome-mcp" |
| isolated | boolean | Required | — |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_playwright | storyRef | PRIMARY | Test lookup by story |
| uq_session | sessionName | UNIQUE | Session isolation |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| E2EStory | PlaywrightTest | CASCADE | CASCADE |

---

### DeltaReport

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: DR-NNN |
| tier | string | Required | One of: "unit", "integration", "e2e", "qa-review" |
| criteria | DeltaCriterion[] | Required | Each must reference a valid CriteriaPlanEntry.id |
| findings | Finding[] | Optional | — |
| conflicts | string[] | Optional | References to InterpretationConflict.id values |
| criterionHistory | CriterionHistoryEntry[] | Optional | — |
| screenshotPaths | string[] | Optional | Valid file paths for e2e tier |
| consoleDumpPaths | string[] | Optional | Valid file paths for e2e tier |
| createdAt | string (ISO 8601) | Required | Valid ISO 8601 datetime |
| phaseRef | string | Optional | Format: Phase N, references the phase boundary that triggered this report | <!-- Review: Finding 2 — DeltaReport boundary refs -->
| featureRef | string | Optional | Format: F-NN, references the feature boundary | <!-- Review: Finding 2 -->
| milestoneRef | string | Optional | Format: M-NN, references the milestone boundary | <!-- Review: Finding 2 -->
| iterationRef | integer | Optional | Iteration number for historical comparison | <!-- Review: Finding 4 — DeltaReport needs iterationRef -->

### DeltaCriterion

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| criterionId | string | Required | Must reference CriteriaPlanEntry.id |
| status | string | Required | One of: "pass", "fail", "skipped", "error" |
| evidence | string | Optional | Max 1000 chars |

### Finding

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | Required, unique | Format: FD-NNN |
| severity | string | Required | One of: "critical", "high", "medium", "low", "info" |
| description | string | Required, non-empty | Max 1000 chars |
| file | string | Optional | Valid file path |
| line | integer | Optional | Positive integer when present |
| tier | string | Required | One of: "unit", "integration", "e2e", "qa-review" |
| bulkApprovable | boolean | Required | Default false; true for qa-review findings |

### CriterionHistoryEntry

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| criterionId | string | Required | Must reference CriteriaPlanEntry.id |
| iteration | integer | Required | Positive integer |
| status | string | Required | One of: "pass", "fail", "skipped", "error" |
| timestamp | string (ISO 8601) | Required | Valid ISO 8601 datetime |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_delta | id | PRIMARY | Report lookup |
| idx_delta_tier | tier | INDEX | Filter by convergence tier |
| idx_criterion_status | criteria[*].criterionId, criteria[*].status | COMPOUND | Criterion result lookup |
| idx_delta_boundary | phaseRef, featureRef, milestoneRef | COMPOUND | Boundary lookup | <!-- Review: Finding 2 — index for boundary ref fields -->

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| DeltaReport | DeltaCriterion | CASCADE | CASCADE |
| DeltaReport | Finding | CASCADE | CASCADE |
| DeltaReport | CriterionHistoryEntry | CASCADE | CASCADE |
| ConvergenceTier | DeltaReport | RESTRICT | CASCADE |

---

### AgentResult (extended)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| agent | string | Required | Registered agent name |
| wave | integer | Required | >= 0 |
| taskId | string | Required | Non-empty |
| status | string | Required | One of: "success", "partial", "failure" |
| filesCreated | string[] | Optional | Valid file paths |
| filesModified | string[] | Optional | Valid file paths |
| filesDeleted | string[] | Optional | Valid file paths |
| exportsAdded | ExportEntry[] | Optional | — |
| dependenciesAdded | string[] | Optional | package@version format |
| integrationNotes | string | Optional | Max 2000 chars |
| issues | IssueEntry[] | Optional | — |
| contractAmendments | AmendmentEntry[] | Optional | — |
| crossBoundaryRequests | RequestEntry[] | Optional | — |
| verificationStatus | string | Required (NEW) | One of: "verified", "unverified", "skipped" | <!-- Review: Finding 1 — verificationStatus added -->
| diagnoseLog | string | Optional (NEW) | Diagnosis narrative before fix application | <!-- Review: Finding 1 — diagnoseLog added -->

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_result | taskId | PRIMARY | Result lookup |
| idx_result_status | status | INDEX | Filter by outcome |
| idx_result_verification | verificationStatus | INDEX | Filter unverified results |

#### Cascade Behavior

Not applicable — AgentResult is a standalone envelope, not a child of another entity.

---

### PlanPhase

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | integer | Required, unique | >= 0 |
| name | string | Required, non-empty | Max 200 chars |
| wave | integer | Required | >= 0 |
| feature | string | Required | Format: F-NN, must reference a valid feature |
| agent | string | Required | One of: "contracts-agent", "implementer-agent", "wiring-agent" |
| objective | string | Required, non-empty | Max 500 chars |
| dependencies | integer[] | Required | Each must reference a lower phase number |
| fileOwnership | string[] | Required, >= 1 item | Glob patterns or file paths |
| deliverables | Deliverable[] | Required, 2-8 items | — |
| acceptanceCriteria | string[] | Required, >= 2 items | Each must be testable |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_phase | id | PRIMARY | Phase lookup |
| idx_phase_wave | wave | INDEX | Phases per wave |
| idx_phase_feature | feature | INDEX | Phases per feature |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| PlanPhase | CriteriaPlanEntry (via testTier mapping) | SET NULL | CASCADE |

---

### StageContext (extended)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| stage | string | Required | One of: "contracts", "execute", "review", "test", "converge", "fix", "e2e", "qa-review" |
| summary | string | Required, non-empty | Max 5000 chars |
| timing | TimingInfo | Required | — |
| tokenUsage | TokenUsage | Required | — |
| tier | string | Optional (NEW) | One of: "unit", "integration", "e2e", "qa-review" when stage is test-related |

### TimingInfo

| Field | Type | Constraints |
|-------|------|-------------|
| startedAt | string (ISO 8601) | Required |
| completedAt | string (ISO 8601) | Required, >= startedAt |
| durationMs | integer | Required, >= 0 |

### TokenUsage

| Field | Type | Constraints |
|-------|------|-------------|
| inputTokens | integer | Required, >= 0 |
| outputTokens | integer | Required, >= 0 |
| totalTokens | integer | Required, = inputTokens + outputTokens |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_stage | stage | PRIMARY | Stage lookup |

#### Cascade Behavior

Not applicable — StageContext is a standalone file.

---

### ExecutionLog (extended)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| events | LogEvent[] | Required | Ordered by timestamp |

### LogEvent

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| timestamp | string (ISO 8601) | Required | Valid ISO 8601 datetime |
| type | string | Required | See extended event types below |
| detail | string | Required, non-empty | Max 1000 chars |
| tier | string | Optional | One of: "unit", "integration", "e2e", "qa-review" |
| agentRef | string | Optional | Agent name when applicable |

Extended event types (additions): `criteria-plan-created`, `interpretation-conflict-found`, `conflict-resolved`, `unit-gate-pass`, `unit-gate-fail`, `integration-test-complete`, `e2e-story-written`, `e2e-run-complete`, `e2e-step-failed`, `qa-review-complete`, `qa-finding-bulk-approved`, `convergence-tier-complete`, `tdd-red-confirmed`, `tdd-green-confirmed`, `diagnosis-logged`, `verification-status-set`.

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| idx_event_type | events[*].type | INDEX | Filter by event type |
| idx_event_tier | events[*].tier | INDEX | Filter by convergence tier |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ExecutionLog | LogEvent | CASCADE | CASCADE |

---

## CLI Command Specification

This project does not expose HTTP APIs. The interface is CLI commands and their flags. The following specifies new and modified commands per the roadmap features.

### `/loom-plan create`

**Description:** Creates a plan from a roadmap, now with parallel dual-track planning (plan-builder + criteria-planner run simultaneously). Ref: C-01, C-02.
**Auth:** None (local CLI)

**Arguments/Flags:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| (positional) | string | no | ROADMAP.md | Path to roadmap file |
| --auto | boolean | no | false | Auto mode: accept all defaults, no interaction |
| --estimate | boolean | no | false | Show token cost estimate without executing |
| --skip-test-gen | boolean | no | false | Skip criteria generation (prints stderr warning) | <!-- Review: Finding 7 — renamed from --no-tests to avoid collision with /loom converge --no-tests -->

**Behavior:**
1. Reads ROADMAP.md
2. Spawns plan-builder-agent and criteria-planner-agent in parallel (C-02: neither reads the other's output)
3. Both write to disk: PLAN.md and `.plan-execution/convergence/criteria/criteria-plan.toon`
4. Spawns interpretation-reviewer-agent to read both outputs
5. Produces `.plan-execution/conflicts/interpretation-report.toon`
6. In auto mode: blocking conflicts are fatal (exit 1). In manual mode: conflicts presented as numbered prompts.
7. `--estimate` prints token estimate to stdout and exits without spawning agents

**Success output:** PLAN.md written, criteria-plan.toon written, interpretation-report.toon written
**Error output:** Blocking conflicts listed to stderr with conflict IDs and side-by-side comparison

---

### `/loom converge`

**Description:** Run convergence testing at specified tier(s). Ref: C-03.
**Auth:** None (local CLI)

**Arguments/Flags:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| --tier | string | no | all | One of: "unit", "integration", "e2e", "qa-review", or "all" |
| --e2e | boolean | no | false | Shorthand for --tier e2e |
| --full | boolean | no | false | Run all 4 tiers in order |
| --no-tests | boolean | no | false | Skip unit/integration tests (prints stderr warning) |
| --no-e2e | boolean | no | false | Skip e2e tests (prints stderr warning) |
| --no-qa-review | boolean | no | false | Skip QA review (prints stderr warning) |
| --tests-only | boolean | no | false | Run only unit + integration, skip e2e + qa-review |
| --chrome | boolean | no | false | Use Chrome MCP instead of headless Playwright for e2e |
| --approve-qa | boolean | no | false | Bulk-approve all non-blocking QA findings in current review | <!-- Review: Finding 5 — --approve-qa flag per F-03 roadmap -->
| --phase N | integer | no | (all) | Run convergence only for criteria belonging to phase N | <!-- Review: Finding 6 — scope filter flags -->
| --feature F-NN | string | no | (all) | Run convergence only for criteria belonging to feature F-NN | <!-- Review: Finding 6 -->
| --max-iterations N | integer | no | 5 | Maximum convergence iterations before aborting | <!-- Review: Finding 7 — iteration cap -->

**Behavior:**
1. Reads criteria-plan.toon for criteria with matching testTier
2. For unit tier: runs test runner (vitest/jest/pytest auto-detected), gates wave progression on failure
3. For integration tier: runs at feature completion boundary
4. For e2e tier: runs Playwright tests from `.plan-execution/convergence/e2e/tests/`
5. For qa-review tier: spawns QA reviewer agents (sonnet model per C-05)
6. Produces DeltaReport per tier to `.plan-execution/convergence/`
7. Unit gate failure: stderr shows failing test names + file paths, exit 1
8. QA findings support bulk-approve in manual mode
9. Opt-out flags print stderr warning: "Warning: --no-tests skips unit/integration convergence gates"
10. Each iteration displays remaining attempts (e.g., "Iteration 3/5"). Controlled by `--max-iterations` (default 5). <!-- Review: Finding 7 — iteration cap UX -->

**Success output:** DeltaReport written per tier, convergence summary to stdout
**Error output:** Failing test names, file paths, and gate status to stderr

---

### `/loom auto`

**Description:** Full autonomous pipeline. Modified to include dual-track planning and 4-tier convergence. Ref: C-01, C-02, C-03.
**Auth:** None (local CLI)

**Behavior changes:**
1. Plan creation stage now spawns plan-builder + criteria-planner in parallel
2. Blocking interpretation conflicts are fatal (pipeline halts)
3. After each wave: unit tests gate progression; QA review runs with configurable scope
4. After each feature completes: integration tests run
5. After each milestone completes: e2e tests run
6. AgentResult from all agents must include verificationStatus field (C-06)
7. Fixer-agent diagnoses before fixing, logs diagnosis to diagnoseLog field (C-06)

---

### `/loom upgrade`

**Description:** Migrate old-format project artifacts (v1 plans, pre-convergence schemas) to current format. Uses automatic detection with explicit migration. Ref: schema-upgrade.md.
**Auth:** None (local CLI)

**Arguments/Flags:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| --dry-run | boolean | no | false | Show what would be migrated without modifying files |
| --force | boolean | no | false | Skip confirmation prompt |
| --backup-dir | string | no | .plan-execution/backups/{timestamp} | Custom backup directory |

**Behavior:**
1. Scans project for old-format artifacts: PLAN.md (v1), criteria-plan.toon (missing testTier), AgentResult files (missing verificationStatus), state.toon (old schema)
2. For each detected old-format file, reads migration rules from `agents/protocols/schema-upgrade.md`
3. Shows migration summary: files to upgrade, fields to add, default values to apply
4. Creates backup of all affected files to `--backup-dir`
5. Applies migrations in-place: adds missing required fields with defaults, converts v1→v2 structure where applicable
6. Validates migrated files against current schemas
7. Reports: files migrated, fields added, validation results

**Automatic detection (no CLI needed):**
- Any agent or orchestrator reading a TOON file checks for schema version markers
- If old format detected: emits stderr warning `"Old format detected in {file}. Run /loom upgrade to migrate."`
- Old-format files are still readable (backward compatible) — warning only, no blocking

**Success output:** Migration summary with file count and field additions
**Error output:** Validation failures after migration, with rollback instructions

---

## State Machines

### InterpretationConflict Status

```
open ───→ resolved
  │          │
  │          └───→ (terminal)
  │
  ├───→ accepted
  │        │
  │        └───→ (terminal)
  │
  └───→ wont-fix
           │
           └───→ (terminal)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| open | Conflict discovered, awaiting resolution | Default on creation by interpretation-reviewer |
| resolved | Conflict resolved with a decision | User or auto-resolver provides resolution text |
| accepted | Conflict acknowledged, plan proceeds as-is | User accepts the divergence |
| wont-fix | Conflict is a false positive or not actionable | User marks as non-issue |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| open | resolved | User provides resolution in manual mode | Sets resolvedAt, writes wiki decision page |
| open | accepted | User accepts divergence | Sets resolvedAt |
| open | wont-fix | User marks as non-issue | Sets resolvedAt |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| resolved | open | INVALID_TRANSITION | Resolved conflicts cannot be reopened |
| accepted | open | INVALID_TRANSITION | Accepted conflicts cannot be reopened |
| wont-fix | open | INVALID_TRANSITION | Closed conflicts cannot be reopened |
| resolved | accepted | INVALID_TRANSITION | Already resolved — cannot change disposition |
| resolved | wont-fix | INVALID_TRANSITION | Already resolved — cannot change disposition |
| accepted | resolved | INVALID_TRANSITION | Already accepted — cannot change disposition |
| accepted | wont-fix | INVALID_TRANSITION | Already accepted — cannot change disposition |
| wont-fix | resolved | INVALID_TRANSITION | Already closed — cannot change disposition |
| wont-fix | accepted | INVALID_TRANSITION | Already closed — cannot change disposition |

---

### Convergence Iteration Lifecycle

```
pending ──→ running ──→ evaluating ──→ passed
                │           │
                │           └──→ failed ──→ fixing ──→ running
                │                              │
                │                              └──→ aborted
                └──→ aborted
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| pending | Iteration scheduled but not started | Default on iteration creation |
| running | Tests/reviews executing | Iteration starts |
| evaluating | Results being analyzed by delta-analyzer | All tier runners complete |
| passed | All criteria met | Delta analyzer confirms all-pass |
| failed | One or more criteria not met | Delta analyzer finds failures |
| fixing | Fixer-agent applying corrections | Failed iteration triggers fix cycle |
| aborted | Iteration cancelled (budget exceeded or fatal error) | Max iterations reached or unrecoverable error |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| pending | running | Convergence-driver starts iteration | Creates StageContext, logs event |
| running | evaluating | All tier runners complete | Writes interim DeltaReport |
| running | aborted | Fatal error or budget exceeded | Logs abort reason |
| evaluating | passed | All criteria pass | Writes final DeltaReport, logs convergence-tier-complete |
| evaluating | failed | Any blocking criterion fails | Writes DeltaReport with failures |
| evaluating | aborted | Delta-analyzer agent crashes or times out | Logs abort reason, writes partial DeltaReport if available |
| failed | fixing | Convergence-driver decides to retry | Fixer-agent spawned, diagnoseLog populated |
| fixing | running | Fix applied, next iteration starts | Increments iteration counter |
| fixing | aborted | Max iterations reached or unrecoverable | Logs abort with iteration count |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| pending | evaluating | INVALID_TRANSITION | Must run before evaluating |
| pending | passed | INVALID_TRANSITION | Must run and evaluate before passing |
| pending | failed | INVALID_TRANSITION | Must run and evaluate before failing |
| passed | running | INVALID_TRANSITION | Passed iterations are terminal |
| passed | failed | INVALID_TRANSITION | Passed iterations are terminal |
| aborted | running | INVALID_TRANSITION | Aborted iterations are terminal |
| aborted | fixing | INVALID_TRANSITION | Aborted iterations are terminal |

---

### TDD Gate (Red-Green Cycle)

<!-- Review: Finding 10 — added skipped state and skip/override transitions -->
<!-- Review: Finding 8 — added fix-stubs state and implementing→aborted transition -->
```
stub-written ──→ red-confirmed ──→ implementing ──→ green-confirmed
     │                │                  │                │
     │                └──→ red-failed    └──→ aborted     └──→ (terminal)
     │                       │    │
     │                       │    ├──→ skipped (override)
     │                       │    │
     │                       │    └──→ fix-stubs ──→ stub-written (re-verify)
     │                       │
     │                       └──→ (terminal: agent error)
     │
     └──→ skipped (env failure / --no-tdd)
              │
              └──→ (terminal)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| stub-written | Test stubs exist, not yet run | Criteria-harness-builder completes |
| red-confirmed | Tests run and fail as expected | Implementer-agent runs tests before implementing (C-06) |
| red-failed | Tests unexpectedly pass before implementation | Stubs pass without implementation — indicates bad stubs |
| fix-stubs | Stubs are being corrected after unexpected pass | red-failed triggers stub correction | <!-- Review: Finding 8 — fix-stubs state -->
| implementing | Implementation in progress | Red confirmed, implementer proceeds |
| green-confirmed | Tests pass after implementation | Implementer-agent runs tests after implementing (C-06) |
| aborted | Implementation failed fatally, TDD cycle abandoned | Unrecoverable error during implementation | <!-- Review: Finding 8 — aborted state -->
| skipped | TDD gate bypassed due to environment issues or user override | `--no-tdd` flag, environment probe failure, or user override in manual mode | <!-- Review: Finding 10 -->

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| stub-written | red-confirmed | Test runner exits non-zero | Logs tdd-red-confirmed event |
| stub-written | red-failed | Test runner exits zero | Logs warning — stubs may be trivial |
| red-confirmed | implementing | Implementer-agent starts coding | — |
| implementing | green-confirmed | Test runner exits zero after implementation | Logs tdd-green-confirmed, sets verificationStatus: verified |
| implementing | aborted | Unrecoverable implementation error | Logs tdd-aborted event, sets verificationStatus: "unverified" | <!-- Review: Finding 8 — implementing→aborted -->
| red-failed | fix-stubs | Stubs need correction after unexpected pass | Logs tdd-fix-stubs event | <!-- Review: Finding 8 — fix-stubs loop -->
| fix-stubs | stub-written | Corrected stubs ready for re-verification | Logs tdd-stubs-corrected event, re-enters stub-written for red check | <!-- Review: Finding 8 — fix-stubs→stub-written -->
| stub-written | skipped | `--no-tdd` flag or environment probe failure | Logs tdd-skipped event, sets verificationStatus: "unverified" | <!-- Review: Finding 10 -->
| red-failed | skipped | User override in manual mode | Logs tdd-override event with rationale | <!-- Review: Finding 10 -->

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| stub-written | implementing | INVALID_TRANSITION | Must confirm red (failing) tests before implementing |
| stub-written | green-confirmed | INVALID_TRANSITION | Must go through red-confirmed and implementing |
| red-confirmed | green-confirmed | INVALID_TRANSITION | Must implement before tests can pass |
| skipped | red-confirmed | INVALID_TRANSITION | Skipped gates cannot be retroactively confirmed | <!-- Review: Finding 10 -->
| aborted | implementing | INVALID_TRANSITION | Aborted TDD cycles are terminal | <!-- Review: Finding 8 -->
| aborted | green-confirmed | INVALID_TRANSITION | Aborted TDD cycles are terminal | <!-- Review: Finding 8 -->
| fix-stubs | implementing | INVALID_TRANSITION | Must re-verify red after fixing stubs | <!-- Review: Finding 8 -->
| green-confirmed | fix-stubs | INVALID_TRANSITION | Passed TDD cycles are terminal | <!-- Review: Finding 8 -->

---

## Error Handling Specification

### Error Response Format

All agent and pipeline errors use a consistent TOON structure:

```toon
error:
  code: SCREAMING_SNAKE_CASE
  message: Human-readable description
  details: Additional context or null
```

### Error Categories

| Code | Context | When Used | Retryable |
|------|---------|-----------|-----------|
| VALIDATION_ERROR | Agent input | Agent receives malformed input (bad TOON, missing fields) | No — fix the input |
| SCHEMA_VIOLATION | Plan/criteria validation | TOON file fails schema validation | No — fix the file |
| CONFLICT_BLOCKING | Interpretation reviewer | Blocking conflict found in auto mode | No — resolve conflict |
| CONFLICT_UNRESOLVED | Pipeline | Pipeline proceeds with unresolved blocking conflicts | No — resolve conflicts |
| GATE_FAILED | Convergence | Unit test gate or integration gate fails | Yes — fix and re-run |
| BUDGET_EXCEEDED | Context management | Agent spawn would exceed 100k token budget | No — split the task |
| MAX_ITERATIONS | Convergence | Convergence iteration limit reached without passing | No — manual intervention |
| AGENT_SPAWN_FAILED | Orchestrator | Agent failed to spawn or crashed | Yes — retry once |
| INVALID_TRANSITION | State machine | Attempted invalid state transition | No — fix the trigger |
| FILE_OWNERSHIP_CONFLICT | Plan validation | Two phases in same wave claim same file | No — fix the plan |
| CRITERIA_MISSING | Plan creation | Phase has no acceptance criteria | No — add criteria |
| E2E_STEP_FAILED | E2E runner | Playwright step assertion fails | No — fix implementation or test |
| E2E_SESSION_TIMEOUT | E2E runner | Playwright session exceeds timeout | Yes — increase timeout or fix |
| PLAYWRIGHT_NOT_FOUND | E2E runner | Playwright not installed | No — install playwright |
| QA_REVIEW_BLOCKED | QA review | QA reviewer finds blocking severity issue | No — fix the issue |
| VERIFICATION_MISSING | Pipeline | AgentResult returned without verificationStatus | No — agent must verify |
| DIAGNOSIS_SKIPPED | Fixer-agent | Fixer applied fix without diagnosing first | No — diagnose then fix |
| TDD_RED_FAILED | TDD gate | Test stubs pass before implementation exists | No — fix the stubs |
| WIKI_WRITE_FAILED | Wiki integration | Wiki page write failed (disk error, format error) | Yes — retry once |
| WIKI_QUERY_FAILED | Wiki integration | Wiki query failed (disk error, missing page, parse error) | Yes — retry once |
| CONVERGENCE_ROLLBACK | Convergence | Failed convergence requires rollback to last known good state | No — review rollback and restart | <!-- Review: no rollback story — added error code -->
| SCHEMA_VERSION_MISMATCH | Schema upgrade | Old-format artifact detected during read | No — run `/loom upgrade` to migrate |

### Field-Level Validation Errors

When `code` is `VALIDATION_ERROR` or `SCHEMA_VIOLATION`, the `details` field contains per-field errors:

```toon
error:
  code: VALIDATION_ERROR
  message: Criteria plan validation failed
  details:
    fields:
      criteria[0].testTier: Must be one of: unit, integration, e2e, qa-review
      reviewers[1].model: Must be one of: opus, sonnet, haiku, or empty
```

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| AGENT_SPAWN_FAILED | Immediate retry once | 1 |
| WIKI_WRITE_FAILED | Immediate retry once | 1 |
| WIKI_QUERY_FAILED | Immediate retry once | 1 |
| GATE_FAILED | Fix cycle then retry | Configured in budget.maxIterations |
| E2E_SESSION_TIMEOUT | Increase timeout 2x, retry | 1 |
| All other errors | Do not retry | 0 |

---

## Execution Phases

<!-- PHASE MERGE SUMMARY (addressing review undersized phase warnings):
     - Old Phase 4 (behavioral-guidelines, 1 deliverable) merged into Phase 0 — both are protocol/contract work
     - Old Phase 6 (e2e-runner-agent, 1 deliverable) merged into Phase 5 to form combined E2E Pipeline phase
     - Old Phase 7 (wiki-maintainer-triggers, 1 deliverable) merged into Phase 2 — both are dual-track integration work
     - Old Phase 10 (loom.md, 1 deliverable) merged into Phase 6 (statusline/logging) to form combined Integration phase
     - Context budget moved from Wave 4 to Wave 1 per review recommendation
     - Total: 12 phases collapsed to 9 phases, 5 waves collapsed to 4 waves
-->

### Phase 0 — Wave 0: Contracts, Protocol Foundations & Behavioral Guidelines

**Agent:** contracts-agent
**Objective:** Define the planning taxonomy protocol, all new TOON schemas (interpretation-conflict, convergence-tier, e2e-story), extend existing schemas (criteria-plan with testTier, agent-result with verificationStatus/diagnoseLog), and codify behavioral guidelines for TDD enforcement, diagnose-before-fix, and hard verification gate. Ref: F-01, F-07, C-01, C-03, C-06.
**Dependencies:** None
**File Ownership:** agents/protocols/taxonomy.md, agents/protocols/interpretation-conflict.schema.md, agents/protocols/convergence-tier.schema.md, agents/protocols/e2e-story.schema.md, agents/protocols/criteria-plan.schema.md, agents/protocols/agent-result.schema.md, agents/protocols/plan.schema.md, agents/protocols/roadmap.schema.md, agents/protocols/behavioral-guidelines.md, agents/protocols/schema-upgrade.md

<!-- Review: Finding 8 — merged old Phase 4 (behavioral-guidelines) into Phase 0 to eliminate undersized phase -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/taxonomy.md | Create | contracts-agent |
| agents/protocols/interpretation-conflict.schema.md | Create | contracts-agent |
| agents/protocols/convergence-tier.schema.md | Create | contracts-agent |
| agents/protocols/e2e-story.schema.md | Create | contracts-agent |
| agents/protocols/criteria-plan.schema.md | Modify | contracts-agent |
| agents/protocols/agent-result.schema.md | Modify | contracts-agent |
| agents/protocols/plan.schema.md | Modify | contracts-agent |
| agents/protocols/roadmap.schema.md | Modify | contracts-agent |
| agents/protocols/behavioral-guidelines.md | Modify | contracts-agent |
| agents/protocols/schema-upgrade.md | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `agents/protocols/taxonomy.md` defines the 4-level hierarchy (Milestone > Feature > Phase > Wave) with convergence tier assignments at each level
- [ ] `agents/protocols/criteria-plan.schema.md` includes `testTier` column in criteria array with valid values: unit, integration, e2e, qa-review <!-- Review: Finding 1 — testTier in live schema -->
- [ ] `agents/protocols/agent-result.schema.md` includes required `verificationStatus` field and optional `diagnoseLog` field <!-- Review: Finding 1 — verificationStatus/diagnoseLog in live schema -->
- [ ] `agents/protocols/interpretation-conflict.schema.md` defines InterpretationConflict and CoverageGap TOON schemas with severity field
- [ ] `agents/protocols/convergence-tier.schema.md` defines 4 tiers with runner, passCondition, gatingBehavior fields; hierarchyLevel uses "wave" not duplicate "phase" <!-- Review: Finding 1 — fixed duplicate enum -->
- [ ] `agents/protocols/e2e-story.schema.md` defines E2EStory and PlaywrightTest TOON schemas
- [ ] `behavioral-guidelines.md` documents TDD red-green gate: implementer runs test stubs, confirms failure, implements, confirms passage
- [ ] `behavioral-guidelines.md` documents diagnose-before-fix: fixer reads finding, diagnoses root cause, documents diagnosis in diagnoseLog, then applies fix
- [ ] `behavioral-guidelines.md` documents hard verification gate: AgentResult with verificationStatus "unverified" triggers warning in convergence-driver
- [ ] All schema files parse as valid Markdown with embedded TOON code blocks
- [ ] `agents/protocols/schema-upgrade.md` defines migration rules for each modified schema with version detection, default values for new required fields, and backup-before-migrate protocol
- [ ] schema-upgrade.md covers: criteria-plan (add testTier default "unit"), agent-result (add verificationStatus default "unverified", diagnoseLog default null), plan.schema (v1→v2 field mapping), convergence-tier (new file — no migration)
- [ ] schema-upgrade.md specifies automatic detection: agents reading old-format files emit stderr warning "Old format detected in {file}. Run `/loom upgrade` to migrate."
- [ ] schema-upgrade.md specifies explicit migration: `/loom upgrade` transforms files in-place after creating `.plan-execution/backups/{timestamp}/` backup

#### Convergence Targets
- taxonomy.md contains exactly 4 hierarchy levels and 4 convergence tier assignments
- criteria-plan.schema.md TOON example includes testTier column
- agent-result.schema.md TOON example includes verificationStatus field
- behavioral-guidelines.md contains sections titled "TDD Red-Green Gate", "Diagnose Before Fix", and "Hard Verification Gate"
- schema-upgrade.md defines at least 3 schema migration rules with version detection and default values

---

### Phase 1 — Wave 1: Interpretation Reviewer Agent

**Agent:** implementer-agent
**Objective:** Create the interpretation-reviewer-agent that reads plan-builder output and criteria-planner output independently, identifies conflicts, coverage gaps, and produces interpretation-report.toon. Ref: F-06, C-02.
**Dependencies:** Phase 0
**File Ownership:** agents/interpretation-reviewer-agent.md, agents/protocols/interpretation-report.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/interpretation-reviewer-agent.md | Create | implementer-agent |
| agents/protocols/interpretation-report.schema.md | Modify | implementer-agent | <!-- Review: Finding 1 — file already exists on disk, changed Create→Modify -->

#### Acceptance Criteria
- [ ] `agents/interpretation-reviewer-agent.md` has frontmatter with `model: opus` (per roadmap model assignment)
- [ ] Agent reads PLAN.md summary and criteria-plan.toon summary (context-efficient, not full files)
- [ ] Agent produces `interpretation-report.toon` with conflicts array (each having id, source, planInterpretation, testInterpretation, severity)
- [ ] Agent produces coverage gaps (plan deliverables with no test coverage and test criteria with no plan deliverable)
- [ ] Conflicts have severity values limited to: blocking, warning, info
- [ ] Agent queries wiki for prior conflict resolutions before producing new conflicts

#### Convergence Targets
- interpretation-reviewer-agent.md exists and has model: opus in frontmatter
- interpretation-report.schema.md defines valid TOON schema with conflicts and coverageGaps arrays

---

### Phase 2 — Wave 1: Dual-Track Planning & Wiki Trigger Integration

**Agent:** implementer-agent
**Objective:** Modify plan creation flow so plan-builder-agent and criteria-planner-agent run in parallel from the same roadmap input, with interpretation-reviewer running after both complete. Wire resolved conflicts into wiki decision pages and formalize conflict persistence and wiki triggers. Ref: F-02, F-06, F-08, C-01, C-02.
**Dependencies:** Phase 0, Phase 1 <!-- Review: Finding 10 — implicit dependency on Phase 1's interpretation-report format -->
**File Ownership:** commands/loom-plan.md, agents/criteria-planner-agent.md, agents/wiki-maintainer-triggers.md

<!-- Review: Merged old Phase 7 (wiki-maintainer-triggers, 1 deliverable) into this phase — both concern dual-track planning integration -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-plan.md | Modify | implementer-agent |
| agents/criteria-planner-agent.md | Modify | implementer-agent |
| agents/wiki-maintainer-triggers.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `/loom-plan create` spawns plan-builder-agent and criteria-planner-agent in parallel (neither reads the other's output)
- [ ] criteria-planner-agent.md updated to accept roadmap input directly (not plan output)
- [ ] criteria-planner-agent.md queries wiki for quality history before generating criteria
- [ ] After both agents complete, interpretation-reviewer-agent is spawned to produce conflict report
- [ ] `--estimate` flag prints token cost estimate to stdout without spawning agents
- [ ] In auto mode: blocking conflicts cause exit 1; warnings are logged to stderr
- [ ] In manual mode: blocking conflicts presented as numbered prompts with side-by-side comparison
- [ ] criteria-plan.toon is always generated during plan creation (C-01: not gated behind --converge-criteria)
- [ ] wiki-maintainer-triggers.md defines trigger conditions: criteria-plan created, convergence complete, conflicts resolved, e2e stories verified
- [ ] Resolved conflicts produce wiki decision pages with conflict ID, resolution text, and source references
- [ ] Conflicts persisted to `.plan-execution/conflicts/` directory

#### Convergence Targets
- `/loom-plan create` with a test roadmap produces both PLAN.md and criteria-plan.toon
- `/loom-plan create --estimate` exits 0 with token count on stdout without creating files
- wiki-maintainer-triggers.md lists at least 4 trigger conditions with corresponding wiki page types

---

### Phase 3 — Wave 1: Context Budget Protocol

**Agent:** implementer-agent
**Objective:** Implement context budget preflight for test agent spawns and rolling context compression with HOT/WARM/COLD tiers, ensuring all agents from Wave 2+ have budget compliance infrastructure available. Ref: F-08.
**Dependencies:** Phase 0
**File Ownership:** agents/protocols/stage-context.schema.md, hooks/context-budget-test.ts, agents/protocols/context-budget.md

<!-- Review: Context budget moved from Wave 4 to Wave 1 — agents in Waves 2+ cannot comply with budget protocol that doesn't exist yet -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/stage-context.schema.md | Modify | implementer-agent |
| hooks/context-budget-test.ts | Modify | implementer-agent | <!-- Review: Finding 1 — file already exists on disk, changed Create→Modify -->
| agents/protocols/context-budget.md | Modify | implementer-agent |

#### Acceptance Criteria
- [ ] stage-context.schema.md adds stage values for test-related stages: "e2e", "qa-review" (in addition to existing "test")
- [ ] stage-context.schema.md adds optional `tier` field for convergence tier when stage is test-related
- [ ] hooks/context-budget-test.ts implements preflight budget check for test agent spawns against 100k token cap
- [ ] Rolling context compression documented: HOT = current iteration results, WARM = prior iteration summaries, COLD = archived
- [ ] Rolling-context wiki injection default-on for all execution agents
- [ ] context-budget.md updated with test-agent-specific budget rules

#### Convergence Targets
- stage-context.schema.md includes "e2e" and "qa-review" as valid stage values
- hooks/context-budget-test.ts exports a function that returns boolean for budget check

---

### Phase 4 — Wave 2: 4-Tier Convergence Engine

**Agent:** implementer-agent
**Objective:** Implement the 4-tier testing model with unit tests gating waves, integration tests at feature boundaries, e2e at milestone boundaries, and QA review at phase/feature level. Ref: F-03, C-03.
**Dependencies:** Phase 0, Phase 2, Phase 3
**File Ownership:** agents/convergence-driver.md, agents/convergence-planner-agent.md, commands/loom-converge.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent |
| agents/convergence-planner-agent.md | Modify | implementer-agent |
| commands/loom-converge.md | Modify | implementer-agent | <!-- Review: Finding 1 — file already exists on disk, changed Create→Modify -->

#### Acceptance Criteria
- [ ] convergence-driver.md supports 4 tier types: unit, integration, e2e, qa-review
- [ ] Unit tests gate each wave — wave does not proceed if unit tests fail
- [ ] Integration tests run at feature completion boundary (all phases of a feature complete)
- [ ] E2E tests run at milestone completion boundary
- [ ] QA review runs after each wave with configurable scope
- [ ] `/loom converge --tier unit` runs only unit tier; `--tier e2e` runs only e2e tier
- [ ] `/loom converge --full` runs all 4 tiers in order
- [ ] `/loom converge --approve-qa` bulk-approves non-blocking QA findings <!-- Review: Finding 5 -->
- [ ] `/loom converge --phase N` and `--feature F-NN` scope convergence to boundary <!-- Review: Finding 6 -->
- [ ] `/loom converge --max-iterations N` caps iterations with visible countdown (default 5) <!-- Review: Finding 7 -->
- [ ] Opt-out flags (`--no-tests`, `--no-e2e`, `--no-qa-review`) print stderr warning
- [ ] On unit gate failure: stderr shows failing test names and file paths
- [ ] criteria-plan.toon targets array includes testTier column for tier routing
- [ ] Convergence budget compliant via Phase 3 context-budget preflight

#### Convergence Targets
- convergence-driver.md references all 4 tier names and their gating levels
- `/loom converge --tier unit` with failing tests exits non-zero with test names on stderr

---

<!-- MVP BOUNDARY: Waves 0-2 constitute the minimum viable product (Phases 0-4 + 7).
     Convergence engine + behavioral hardening + dual-track planning + interpretation review + context budget + flaky test detection + rollback.
     Waves 3+ are post-MVP: E2E pipeline, statusline/logging integration, wiring.
     Note: ROADMAP M-01 covers Phases 0-3 (planning foundation). The plan's MVP extends through M-02a (Phases 0-4 + 7) which includes the convergence engine.
     Review: Finding 9 — declare MVP boundary after Wave 2.
     Review: Finding 5 — MVP boundary updated to include Phase 7 (now Wave 2); clarified ROADMAP M-01 vs plan MVP scope. -->

### Phase 5 — Wave 3: E2E Pipeline (Writer + Runner)

**Agent:** implementer-agent
**Objective:** Create the e2e-test-writer-agent that converts acceptance criteria e2e specs into YAML user stories and Playwright test files, and the e2e-runner-agent that executes them with headless/Chrome modes, screenshot audit trails, and console capture. Ref: F-04, F-05, C-04, C-07.
**Dependencies:** Phase 0, Phase 4
**File Ownership:** agents/e2e-test-writer-agent.md, agents/e2e-runner-agent.md, agents/protocols/e2e-story.schema.md

<!-- Review: Merged old Phase 6 (e2e-runner-agent, 1 deliverable) into this phase to eliminate undersized phase and same-wave serial dependency -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/e2e-test-writer-agent.md | Create | implementer-agent |
| agents/e2e-runner-agent.md | Create | implementer-agent |
| agents/protocols/e2e-story.schema.md | Modify | implementer-agent | <!-- Review: Finding 6 — Append-only modification rights; must maintain backward compatibility with Phase 0 schema -->

#### Acceptance Criteria
- [ ] `agents/e2e-test-writer-agent.md` has frontmatter with `model: sonnet` (per roadmap model assignment)
- [ ] Writer agent reads e2e specs from criteria-plan.toon (entries with testTier: e2e)
- [ ] Writer agent produces YAML user stories in `.plan-execution/convergence/e2e/stories/`
- [ ] Writer agent produces Playwright test files in `.plan-execution/convergence/e2e/tests/`
- [ ] Stories support 3 formats: imperative, bdd (Given/When/Then), checklist
- [ ] Each story includes preconditions, steps, and expected outcomes
- [ ] e2e-story.schema.md updated with full YAML story schema including format field and step structure
- [ ] `agents/e2e-runner-agent.md` has frontmatter with `model: haiku` (per roadmap model assignment)
- [ ] Playwright CLI runs headless by default; `--chrome` flag switches to Chrome MCP
- [ ] Each e2e story gets a named Playwright session for parallel isolation (C-07)
- [ ] Screenshots saved to `.plan-execution/convergence/e2e/screenshots/{run}/{story}/{NN_step}.png`
- [ ] On step failure: JS console errors captured, remaining steps marked SKIPPED
- [ ] DeltaReport includes screenshotPaths and consoleDumpPaths for e2e tier entries
- [ ] `/loom converge --e2e` is valid at any point during or after execution
- [ ] e2e-story.schema.md modifications are additive only (no breaking changes to Phase 0 fields) <!-- Review: Finding 6 — cross-wave ownership guard -->

#### Convergence Targets
- e2e-test-writer-agent.md exists with model: sonnet in frontmatter
- e2e-runner-agent.md exists with model: haiku in frontmatter
- e2e-story.schema.md defines YAML story format with preconditions, steps[], format fields

---

### Phase 6 — Wave 3: Statusline, Logging & /loom auto Integration

**Agent:** implementer-agent
**Objective:** Extend statusline with test counts and QA findings, extend execution-log with all test event types, and update the /loom auto pipeline to integrate dual-track planning, 4-tier convergence gates, and behavioral hardening. Agent MUST use grep-based selective reading of dependency files, not linear reads. Ref: F-02, F-03, F-07, F-08. <!-- Review: Finding 2 — ~89k token budget pressure; grep-based reading required -->
**Dependencies:** Phase 2, Phase 4, Phase 5
**File Ownership:** agents/protocols/statusline-contract.md, agents/protocols/execution-log.schema.md, commands/loom.md, commands/loom-upgrade.md

<!-- Review: Merged old Phase 10 (loom.md, 1 deliverable) into this phase to eliminate undersized phase -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/statusline-contract.md | Modify | implementer-agent |
| agents/protocols/execution-log.schema.md | Modify | implementer-agent |
| commands/loom.md | Modify | implementer-agent |
| commands/loom-upgrade.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] statusline-contract.md adds fields: test pass/fail counts, QA finding count, convergence iteration number, convergence pass rate
- [ ] statusline-contract.md documents truncation behavior for narrow terminal widths (truncate right with '...' suffix)
- [ ] execution-log.schema.md adds event types: criteria-plan-created, interpretation-conflict-found, conflict-resolved, unit-gate-pass, unit-gate-fail, integration-test-complete, e2e-story-written, e2e-run-complete, e2e-step-failed, qa-review-complete, qa-finding-bulk-approved, convergence-tier-complete, tdd-red-confirmed, tdd-green-confirmed, diagnosis-logged, verification-status-set
- [ ] Each new event type has tier field (optional, for test-related events)
- [ ] `/loom auto` plan creation stage spawns plan-builder + criteria-planner in parallel
- [ ] `/loom auto` halts on blocking interpretation conflicts (exit 1 with conflict report)
- [ ] After each wave: unit test gate enforced; QA review runs
- [ ] After each feature boundary: integration tests run
- [ ] After each milestone boundary: e2e tests run
- [ ] All agent spawns include verificationStatus in AgentResult
- [ ] Fixer-agent invocations include diagnoseLog in AgentResult
- [ ] `/loom upgrade` scans for old-format artifacts and migrates with backup
- [ ] `/loom upgrade --dry-run` shows migration plan without modifying files
- [ ] Automatic detection: agents reading old-format TOON files emit stderr warning with upgrade instructions
- [ ] Agent spawn stays within 100k token budget by using grep-based selective file reading for all dependency phase outputs <!-- Review: Finding 2 — budget compliance gate -->

#### Convergence Targets
- statusline-contract.md contains test count and QA finding fields
- execution-log.schema.md defines at least 16 new event types with tier field
- commands/loom.md auto subcommand references dual-track planning, 4-tier convergence, and verification gate

---

### Phase 7 — Wave 2: Flaky Test Detection & Convergence Rollback
<!-- Review: Finding 4 — moved from Wave 3 to Wave 2; dependency on Phase 4 only -->

**Agent:** implementer-agent
**Objective:** Add flaky test quarantine to the convergence engine and define rollback behavior for failed convergence iterations, addressing review gaps. Ref: F-03, F-08.
**Dependencies:** Phase 4
**File Ownership:** agents/protocols/flaky-test.schema.md, agents/protocols/convergence-rollback.md

<!-- Review: No flaky test detection mentioned; no rollback story for failed convergence — added as dedicated phase -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/flaky-test.schema.md | Create | implementer-agent |
| agents/protocols/convergence-rollback.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] flaky-test.schema.md defines a FlakyTest record: testId, file, failureRate, lastSeen, quarantined (boolean), quarantineReason
- [ ] Tests failing intermittently across iterations are flagged as flaky and optionally quarantined (excluded from gate)
- [ ] Quarantined tests still run but do not block wave progression; results logged as warnings
- [ ] convergence-rollback.md defines rollback protocol: on MAX_ITERATIONS abort, revert to last wave checkpoint state
- [ ] Rollback preserves DeltaReports and diagnosis logs for post-mortem analysis
- [ ] Rollback does not delete wiki pages or conflict resolutions created during failed iterations

#### Convergence Targets
- flaky-test.schema.md defines quarantine fields and failure rate tracking
- convergence-rollback.md defines rollback trigger conditions and preserved artifacts

---

### Phase 8 — Wave 3: Wiring & Integration Verification

**Agent:** wiring-agent
**Objective:** Connect all new agents, schemas, commands, and hooks into a cohesive system. Verify cross-references, update orchestration patterns, and ensure all protocols are internally consistent. Wiring agent MUST use grep-based insertion point discovery to stay within 100k token budget — do not linearly read all dependency files. Ref: F-08. <!-- Review: Finding 9 — wiring agent budget risk -->
**Dependencies:** Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7
**File Ownership:** agents/protocols/orchestration-patterns.md, agents/protocols/execution-conventions.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/orchestration-patterns.md | Modify | wiring-agent |
| agents/protocols/execution-conventions.md | Modify | wiring-agent |

#### Acceptance Criteria
- [ ] orchestration-patterns.md includes convergence pattern with 4-tier model reference
- [ ] execution-conventions.md directory structure includes new paths: `.plan-execution/conflicts/`, `.plan-execution/convergence/e2e/stories/`, `.plan-execution/convergence/e2e/tests/`, `.plan-execution/convergence/e2e/screenshots/`
- [ ] All new agent .md files are referenced from at least one command or skill
- [ ] All new schema .md files are referenced from at least one agent protocol section
- [ ] No orphan schemas (every schema referenced by at least one agent)
- [ ] No orphan agents (every agent invokable from at least one command/skill)
- [ ] Wiring agent prompt uses grep to find insertion points rather than reading full file contents of all 7 dependency phases <!-- Review: Finding 9 — budget compliance gate -->

#### Convergence Targets
- execution-conventions.md directory tree includes conflicts/, e2e/stories/, e2e/tests/, e2e/screenshots/ paths
- orchestration-patterns.md references "convergence" pattern with 4-tier model

---

## Wave Exit Verification Gates

<!-- Review: Finding 3 — missing wave-exit verification gates between each wave -->

Each wave boundary triggers a verification gate before the next wave begins. These gates are cumulative — later waves include all prior gate checks.

| Transition | Gate | Details |
|-----------|------|---------|
| Wave 0 → Wave 1 | Typecheck all contract files | `bunx tsc --noEmit` on all Phase 0 deliverables; all protocol schemas parse as valid Markdown |
| Wave 1 → Wave 2 | Typecheck + unit tests on Wave 1 deliverables | `bunx tsc --noEmit` full project + `bun test` on Wave 1 phase outputs (Phases 1, 2, 3) |
| Wave 2 → Wave 3 | Typecheck + unit tests + integration tests | Full typecheck + unit tests + integration test suite covering cross-phase interactions (Phases 4, 7); flaky test quarantine operational |
| Wave 3 → done | Full suite | Typecheck + unit tests + integration tests + e2e tests (all phases); wiring verification confirms no orphan agents/schemas |

**Gate failure behavior:** If any gate fails, the next wave does not start. Failures are reported to stderr with specific file paths and test names. The convergence engine's fix cycle may be invoked to resolve gate failures before re-running the gate.

---

## Milestones

### M-01: Planning Foundation (Wave 0-1)

**Phases:** 0, 1, 2, 3
**Features:** F-01, F-02, F-06, F-08 (context budget only)
**Acceptance:** Taxonomy is formalized, dual-track planning runs in parallel, interpretation-reviewer catches known ambiguities in test fixture plans, context budget protocol is available for all subsequent agents.

#### MVP Boundary

M-01 alone delivers: formalized planning taxonomy, parallel test criteria generation, interpretation conflict detection, wiki trigger integration, and context budget infrastructure. A team can use M-01 without M-02+ and still get tests-before-code and ambiguity detection on every plan.

### M-02a: 4-Tier Convergence Engine (Wave 2)

**Phases:** 4, 7 <!-- Review: Finding 4 — Phase 7 moved to Wave 2 -->
**Features:** F-03, F-07
**Depends on:** M-01
**Acceptance:** All 4 tiers execute at their correct hierarchy levels, unit tests gate waves, red-green TDD gate enforced by implementer, fixer diagnoses before fixing, AgentResult requires verification status, --approve-qa and --max-iterations flags operational, flaky test quarantine operational, rollback protocol defined. <!-- Review: Finding 4 — Phase 7 acceptance merged here -->

### M-02b: E2E Pipeline + Cross-System Integration (Wave 3)

**Phases:** 5, 6, 8 <!-- Review: Finding 4 — Phase 7 moved to M-02a/Wave 2 -->
**Features:** F-04, F-05, F-08
**Depends on:** M-02a
**Acceptance:** E2E test writer produces Playwright tests from YAML stories, e2e runner executes with screenshot audit trail, `/loom converge --e2e` works in manual mode and mid-execution, statusline shows test metrics, execution-log records all test events, `/loom auto` integrates full convergence pipeline, all wiring verified. <!-- Review: Finding 4 — flaky test/rollback moved to M-02a -->

---

## Verification Commands

```bash
# Validate all protocol schemas parse as valid Markdown
find agents/protocols/ -name "*.md" -exec sh -c 'head -1 "{}" | grep -q "^#" || echo "FAIL: {}"' \;

# Check new agent files exist
test -f agents/interpretation-reviewer-agent.md && echo "PASS" || echo "FAIL: interpretation-reviewer-agent.md missing"
test -f agents/e2e-test-writer-agent.md && echo "PASS" || echo "FAIL: e2e-test-writer-agent.md missing"
test -f agents/e2e-runner-agent.md && echo "PASS" || echo "FAIL: e2e-runner-agent.md missing"

# Check new protocol files exist
test -f agents/protocols/taxonomy.md && echo "PASS" || echo "FAIL: taxonomy.md missing"
test -f agents/protocols/interpretation-conflict.schema.md && echo "PASS" || echo "FAIL: interpretation-conflict.schema.md missing"
test -f agents/protocols/convergence-tier.schema.md && echo "PASS" || echo "FAIL: convergence-tier.schema.md missing"
test -f agents/protocols/flaky-test.schema.md && echo "PASS" || echo "FAIL: flaky-test.schema.md missing"
test -f agents/protocols/convergence-rollback.md && echo "PASS" || echo "FAIL: convergence-rollback.md missing"

# Check agent frontmatter model assignments
grep -q "model: opus" agents/interpretation-reviewer-agent.md && echo "PASS" || echo "FAIL: interpretation-reviewer model"
grep -q "model: sonnet" agents/e2e-test-writer-agent.md && echo "PASS" || echo "FAIL: e2e-test-writer model"
grep -q "model: haiku" agents/e2e-runner-agent.md && echo "PASS" || echo "FAIL: e2e-runner model"

# Check schema extensions
grep -q "verificationStatus" agents/protocols/agent-result.schema.md && echo "PASS" || echo "FAIL: verificationStatus missing"
grep -q "testTier" agents/protocols/criteria-plan.schema.md && echo "PASS" || echo "FAIL: testTier missing"
grep -q "diagnoseLog" agents/protocols/agent-result.schema.md && echo "PASS" || echo "FAIL: diagnoseLog missing"

# Check behavioral guidelines sections
grep -q "TDD Red-Green Gate" agents/protocols/behavioral-guidelines.md && echo "PASS" || echo "FAIL: TDD section missing"
grep -q "Diagnose Before Fix" agents/protocols/behavioral-guidelines.md && echo "PASS" || echo "FAIL: diagnose section missing"

# Run existing tests to ensure no regressions
bun test || npm test

# TypeScript compilation check
bunx tsc --noEmit || npx tsc --noEmit
```

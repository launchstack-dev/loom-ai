# Validation Rules

Rules that orchestrators enforce when collecting agent output and reading configuration. Every orchestrator command (`execute-plan`, `review-plan`, `test-plan`, `review-code`, `roadmap`) MUST apply these validations.

## 1. AgentResult Validation

Every agent returns an `AgentResult` (JSON or TOON). The orchestrator MUST validate it before processing.

### Required fields
All of these must be present and non-null:
- `agent` — non-empty string
- `wave` — number >= 0
- `taskId` — non-empty string
- `status` — one of: `"success"`, `"failure"`, `"partial"`
- `filesCreated` — array of strings
- `filesModified` — array of strings
- `exportsAdded` — array of objects with `file`, `name`, `kind`
- `issues` — array of objects with `severity`, `description`

### Validation checks
1. **Status consistency**: If `status` is `"success"`, there MUST be zero issues with `severity: "blocking"`
2. **File paths**: All paths in `filesCreated` and `filesModified` must be relative (no leading `/` unless absolute paths are expected)
3. **No duplicate files**: A file cannot appear in both `filesCreated` and `filesModified`
4. **Export consistency**: Every file in `exportsAdded[].file` must appear in either `filesCreated` or `filesModified`
5. **Kind validation**: `exportsAdded[].kind` must be one of: `"function"`, `"class"`, `"const"`, `"type"`, `"interface"`, `"enum"`

### On validation failure
- Log which fields failed validation and the agent name
- Mark the agent's task as `failed` in state.toon
- Include validation errors in the wave summary
- Do NOT silently accept malformed results — surface them to the user

## 2. orchestration.toml Validation

When an orchestrator reads `.claude/orchestration.toml`, validate before spawning any agents from it.

### Structure checks
1. **Top-level sections**: Only `planning`, `execution`, `testing`, `review`, `patterns`, and `settings` are valid
2. **Agent entries require**: `source` (file path that must exist on disk)
3. **Agent entries optional**: `model` (one of: `"opus"`, `"sonnet"`, `"haiku"`), `outputRole` (one of: `"reviewer"`, `"producer"`, `"blocker"`), `phase`, `modes`, `input`
4. **Source files must exist**: Before spawning, verify the `.md` file at `source` exists. If not, warn and skip (don't fail the entire pipeline)
5. **Pattern entries**: Must have a valid `type` (one of: `"debate"`, `"chain"`, `"vote"`, `"triage"`)

### On validation failure
- Warn the user about invalid entries
- Skip invalid agents but continue with valid ones
- Never silently ignore a config file that exists but can't be parsed

## 3. Blocker Gate Enforcement

Project-specific agents with `outputRole: "blocker"` have special semantics.

### Rules
1. **Blockers must pass**: If a blocker agent returns `status: "failure"` or has any `issues` with `severity: "blocking"`, the pipeline MUST halt
2. **Blockers run before synthesis**: In `/loom-review-plan`, blockers must complete and pass before the synthesis step
3. **Blockers run before proceeding**: In `/loom-execute-plan`, a blocker in the `pre-contracts` phase must pass before contracts-agent runs
4. **Blocker failure reporting**: When a blocker fails, display its issues prominently with a clear "BLOCKED" label and ask the user how to proceed (fix and retry / override / abort)
5. **Override tracking**: If the user overrides a blocker, log this decision to `.plan-history/decisions/` with the reason

### Example blocker flow
```
1. Orchestrator reads orchestration.toml
2. Finds agent with outputRole: "blocker"
3. Spawns blocker agent alongside other agents
4. Blocker returns status: "failure" with blocking issues
5. Orchestrator halts pipeline:

   BLOCKED by domain-validator:
   - Missing required HIPAA audit trail in schema
   - No encryption-at-rest specified for PII fields

   Options: (fix and re-run / override with reason / abort)

6. If user overrides: log to .plan-history/decisions/NNN-blocker-override.md
7. Continue pipeline
```

## 4. State.toon Integrity

### On write
- Always use atomic writes (write to `.tmp`, rename)
- Increment `updatedAt` timestamp
- Validate status transitions: `pending → in_progress → succeeded/failed` (no skipping)

### On read (especially --resume)
- Verify `schemaVersion` matches expected version
- Check that `currentWave` is consistent with wave statuses
- Warn if `updatedAt` is more than 24 hours old (stale state)

## 5. Cross-Boundary Request Validation

When processing `.plan-execution/ephemeral/requests/{taskId}.toon`:

1. **Source agent exists**: The `agent` field must match an agent that ran in the current wave
2. **Requested files are valid**: Each `file` in `requests[]` must be a real path (or a path that will exist after wiring)
3. **No self-requests**: An agent cannot request changes to files it already owns
4. **Dedup**: If multiple agents request changes to the same file, flag for human review

## 6. Plan Validation Rules

Plan validation enforces the structural and semantic integrity of PLAN.md files. The authoritative format specification is `plan.schema.md` — these rules describe how orchestrators enforce that spec at runtime.

### When Validation Runs

Plan validation is triggered in four contexts:
- **`/loom-roadmap --init`** — after the plan-builder-agent generates a new plan
- **`/loom-roadmap --refine`** — after the plan-builder-agent refines an existing plan
- **`/loom-roadmap --validate`** — standalone validation (no generation, just check)
- **`/loom-execute-plan`** — as a gate in Step 1 before any agents are spawned

If any **blocking** error is found, the pipeline halts and reports all errors to the user. **Warning**-level issues are reported but do not halt execution. **Info**-level issues are logged but not surfaced unless verbose mode is on.

### Stage 1: Structure Parse — BLOCKING

Validates that the plan conforms to the required document structure.

| Check | Severity | Description |
|-------|----------|-------------|
| Frontmatter exists | blocking | YAML frontmatter with `---` delimiters must be present |
| Required frontmatter fields | blocking | `planVersion`, `name`, `status`, `created`, `totalPhases`, `totalWaves` must all be present and non-null |
| Title matches name | blocking | `# Plan: {name}` must match `frontmatter.name` |
| Required sections present | blocking | Overview, Tech Stack, Schema / Type Definitions, Execution Phases, Verification Commands must all exist |
| Section order | blocking | Required sections must appear in the order specified by plan.schema.md |
| Phase 0 exists | blocking | At least one `### Phase 0` subsection must exist within Execution Phases |
| Phase 0 is contracts | blocking | Phase 0 must have `Agent: contracts-agent`, `Wave: 0`, and `Dependencies: None` |
| Phase field completeness | blocking | Every phase must have Agent, Objective, Dependencies, File Ownership, Deliverables table, and Acceptance Criteria |

### Stage 2: Dependency Graph — BLOCKING

Builds and validates the dependency DAG across all phases.

| Check | Severity | Description |
|-------|----------|-------------|
| Cycle detection | blocking | Run Kahn's algorithm on the adjacency list. Any cycle = blocking error. Report the full cycle path. |
| Self-dependencies | blocking | A phase cannot list itself in its Dependencies field |
| Undefined references | blocking | Every phase number referenced in a Dependencies field must correspond to an existing phase |
| Forward references | blocking | A phase cannot depend on a phase with a higher phase number |
| Wave consistency | warning | A phase in Wave W should only depend on phases in Wave < W. Cross-wave dependencies that violate this are suspicious. |
| Critical path | info | Compute the longest path through the DAG and report it. This is the minimum number of sequential waves required. |

### Stage 3: File Ownership — BLOCKING / WARNING

Validates that file ownership declarations are consistent and non-overlapping within waves.

| Check | Severity | Description |
|-------|----------|-------------|
| Same-wave overlap | blocking | Two phases in the same wave MUST NOT claim the same file or overlapping directory globs |
| Deliverable outside ownership | warning | Every file in a phase's Deliverables table should fall within that phase's declared File Ownership |
| Cross-wave overlap | warning | A file owned by a phase in Wave N and also by a phase in Wave M (M > N) is allowed but flagged for awareness |
| Empty ownership | warning | A phase with no File Ownership declaration is suspicious — flag it |

### Stage 4: Sizing — BLOCKING / WARNING

Validates that phases are appropriately sized for agent context windows.

| Check | Severity | Description |
|-------|----------|-------------|
| >12 deliverables | blocking | A phase with more than 12 deliverables must be split |
| 0 acceptance criteria | blocking | Every phase must have at least one acceptance criterion |
| >8 deliverables | warning | A phase with 9-12 deliverables should be reviewed for splitting opportunities |
| <2 deliverables | warning | A phase with fewer than 2 deliverables should be reviewed for merging opportunities |
| 1 acceptance criterion | warning | A phase with only 1 criterion may lack sufficient verification coverage |
| Non-automatable criteria | warning | Criteria containing subjective language ("should work well", "good", "handles edge cases") are flagged |

### Stage 5: Agent Feasibility — WARNING

Estimates whether an agent can realistically complete a phase within its context window. This stage is optional and can be skipped for fast validation.

| Check | Severity | Description |
|-------|----------|-------------|
| >15 files-in | warning | A phase that must read more than 15 files from prior phases risks context overflow. Count all files in dependency phases' deliverables. |
| >20 files-in | blocking | Hard limit — the phase must be split |
| Deep check (optional) | info | If `agentic-workflow-agent` is available, delegate a deeper feasibility analysis that considers file sizes and complexity |

### Stage 6: Schema Completeness — WARNING

Validates that all type references in the plan resolve to definitions. This stage is optional and can be skipped for fast validation.

| Check | Severity | Description |
|-------|----------|-------------|
| Undefined type references | warning | Entity names referenced in phase deliverables, acceptance criteria, or objectives that do not appear in the Schema / Type Definitions section |
| Orphaned definitions | info | Types defined in Schema / Type Definitions that are never referenced by any phase (may indicate dead schema) |
| Deep check (optional) | info | If `feature-coverage-agent` is available, delegate a deeper completeness analysis that cross-references the plan against the original project description |

### Validation Output Format

Validation results are reported as a structured list:

```
PLAN VALIDATION: {plan name}
================================
Stage 1 (Structure):    PASS
Stage 2 (Dependencies): PASS
Stage 3 (Ownership):    1 warning
Stage 4 (Sizing):       FAIL — 2 blocking errors
Stage 5 (Feasibility):  1 warning
Stage 6 (Schema):       PASS
================================
RESULT: BLOCKED

Blocking errors:
  [Stage 4] Phase 5 has 14 deliverables (max 12)
  [Stage 4] Phase 3 has 0 acceptance criteria

Warnings:
  [Stage 3] src/utils/helpers.ts owned by Phase 2 (Wave 1) and Phase 5 (Wave 2)
  [Stage 5] Phase 4 reads 17 files from prior phases — consider splitting
```

When validation fails with blocking errors, the plan is returned to the plan-builder-agent in Validation Correction Mode for targeted fixes.

## 7. Roadmap Validation Rules

Roadmap validation enforces the structural and semantic integrity of ROADMAP.md files. The authoritative format specification is `roadmap.schema.md` — these rules describe how orchestrators enforce that spec at runtime.

### When Validation Runs

Roadmap validation is triggered in three contexts:
- **`/loom-roadmap --init`** — after the roadmap-builder-agent generates a new roadmap
- **`/loom-roadmap --validate --roadmap`** — standalone roadmap validation
- **`/loom-review-roadmap`** — as a pre-check before spawning review agents

If any **blocking** error is found, the pipeline halts. **Warning**-level issues are reported but do not halt.

### Stage 1: Structure Parse — BLOCKING

| Check | Severity | Description |
|-------|----------|-------------|
| Frontmatter exists | blocking | YAML frontmatter with `---` delimiters must be present |
| Required frontmatter fields | blocking | `roadmapVersion`, `name`, `status`, `created`, `totalFeatures`, `totalMilestones` must all be present and non-null |
| Title matches name | blocking | `# Roadmap: {name}` must match `frontmatter.name` |
| Required sections present | blocking | Vision, Success Metrics, Constraints & Decisions, Tech Stack, Features, Data Model (Conceptual), Milestones, Risks & Mitigations, Out of Scope must all exist |
| Section order | blocking | Required sections must appear in the order specified by roadmap.schema.md |
| Feature count matches | warning | `totalFeatures` in frontmatter should match actual feature count |
| Milestone count matches | warning | `totalMilestones` in frontmatter should match actual milestone count |

### Stage 2: Feature Completeness — BLOCKING / WARNING

| Check | Severity | Description |
|-------|----------|-------------|
| Feature has milestone | blocking | Every feature (F-XX) must reference an existing milestone (M-XX) |
| Feature has entities | warning | Every feature should reference at least one entity from the Data Model |
| Feature has key behaviors | warning | Every feature should have at least 2 key behaviors listed |
| Feature description length | warning | Feature descriptions shorter than 2 sentences may lack context |
| Priority distribution | info | Flag if all features are P0 (no prioritization) or all P2 (no urgency) |

### Stage 3: Milestone Ordering — BLOCKING

| Check | Severity | Description |
|-------|----------|-------------|
| Cycle detection | blocking | Run Kahn's algorithm on milestone dependencies. Any cycle = blocking error. Report the full cycle path. |
| Self-dependencies | blocking | A milestone cannot list itself in its Dependencies field |
| Undefined references | blocking | Every milestone ID referenced in Dependencies must correspond to an existing milestone |
| Forward references | blocking | A milestone cannot depend on a milestone with a higher number |
| All features assigned | warning | Every feature should appear in at least one milestone's Features list |
| Orphan milestones | warning | A milestone with no features assigned may indicate incomplete roadmap |

### Stage 4: Data Model Coverage — WARNING

| Check | Severity | Description |
|-------|----------|-------------|
| Entity referenced by feature | warning | Every entity in the Data Model should be referenced by at least one feature |
| Feature entity exists | warning | Every entity referenced in a feature's "Entities involved" should exist in the Data Model |
| Relationship endpoints exist | warning | Both sides of every relationship must reference entities defined in the Entities table |
| Orphan entities | info | Entities defined but never referenced by any feature |

### Roadmap Validation Output Format

```
ROADMAP VALIDATION: {roadmap name}
================================
Stage 1 (Structure):    PASS
Stage 2 (Features):     1 warning
Stage 3 (Milestones):   PASS
Stage 4 (Data Model):   PASS
================================
RESULT: PASS (0 errors, 1 warning)

Warnings:
  [Stage 2] Feature F-04 has only 1 key behavior — consider adding more
```

## 8. Plan v2 Spec Validation Rules

For `planVersion: 2` plans, these additional checks run after the standard Stage 1-6 plan validation.

### Stage 7: Spec Completeness — BLOCKING / WARNING

| Check | Severity | Description |
|-------|----------|-------------|
| API endpoint referenced but not specified | blocking | An endpoint mentioned in any acceptance criterion must have a full spec in API Specification |
| Entity with status field but no state machine | blocking | Every entity in Schema with a status/state/lifecycle field must have a State Machine defined |
| Error code used but not defined | blocking | Every error code in API Specification error tables must appear in Error Handling Specification |
| Missing error responses on endpoint | warning | Every API endpoint should document at least 400 and 500 error cases |
| No request body on POST/PUT/PATCH | warning | Write endpoints typically need a request body spec |
| Foreign key without index | warning | Every foreign key in Schema should have a corresponding index in the Indexing subsection |
| Foreign key without cascade behavior | warning | Every foreign key should have ON DELETE / ON UPDATE behavior defined |
| Unreachable state | warning | A state with no inbound transition (other than initial) in a state machine |
| Dead-end state without terminal marking | warning | A non-terminal state with no outbound transitions |

## 9. Scope Coverage Validation

### Pre-Execution Coverage Check
Run after plan validation (Step 1) and before Wave 0.

1. **Collect criteria**: For each phase, extract all `acceptanceCriteria` entries.
2. **Map to tasks**: For each criterion, find task(s) whose `fileOwnership` or `objective` plausibly covers it. A criterion is covered if at least one task's objective or owned files overlap with the criterion's domain.
3. **Write matrix**: Write `.plan-execution/scope-coverage.toon` with all criteria and their covering tasks.
4. **Flag orphans**: Any criterion with `coveringTasks: []` gets `status: orphaned` and triggers a SCOPE REDUCTION warning.
5. **User gate**: If orphaned criteria exist, display them and ask user to proceed / abort / assign manually.

### Post-Wave Drift Check
Run after each wave's verification pass.

1. **Update statuses**: Mark criteria as `covered` when their covering task(s) succeed.
2. **Detect drift**: If a task fails and won't be retried, its criteria become `orphaned` again.
3. **Flag new orphans**: Display any newly orphaned criteria as SCOPE DRIFT warnings.
4. **Status `dropped`**: If user explicitly acknowledges and dismisses an orphaned criterion, mark it `dropped`.

### Valid Status Transitions

```
pending → covered    (covering task succeeded)
pending → orphaned   (all covering tasks failed with retryCount >= 2)
orphaned → pending   (user manually assigns a new covering task)
orphaned → dropped   (user explicitly dismisses the criterion)
covered → (terminal) (a covered criterion cannot be un-covered)
dropped → (terminal) (a dropped criterion was explicitly dismissed)
```

**Invalid transitions** (orchestrator must reject):
- `covered` → `orphaned`: once a criterion's covering task succeeded, the criterion stays covered even if other covering tasks later fail
- `dropped` → any other status: user acknowledgment is final

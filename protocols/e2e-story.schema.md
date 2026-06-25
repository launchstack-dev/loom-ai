# E2E Story & Playwright Test Schema

Defines the TOON schemas for end-to-end user stories and their corresponding Playwright test configurations. E2E stories operate at the milestone convergence tier (see `taxonomy.md`) and describe complete user workflows that span multiple features.

---

## E2EStory Schema

An E2EStory describes a user workflow as a sequence of steps with expected outcomes. Stories are the source of truth for what e2e tests verify.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schemaVersion | integer | no | Schema version (currently `2`). **v1 → v2 transition:** v2 introduces `derivedFrom[]` as required, formalizes the scenario-derivation contract (Rules 15–18 / YAML 12–14), and reserves the `UNRESOLVED-*` sentinel for `--auto`-mode placeholders. v1 stories without this field are accepted as legacy and skip Rules 15–18. New stories MUST emit `schemaVersion: 2`. |
| name | string | yes | Unique name within the milestone. Max 200 characters. |
| url | string | no | Starting URL for the workflow. Must be a valid URL if present. |
| workflow | string | yes | Human-readable description of the overall workflow being tested. |
| preconditions | string[] | yes | Setup requirements before the story runs. May be empty. |
| format | enum | yes | Story format: `imperative`, `bdd`, `checklist`. |
| steps | StoryStep[] | yes | Ordered sequence of actions and expectations. At least 1 step required. |
| milestoneRef | string | yes | Milestone this story belongs to. Format: `M-NN`. |
| criteriaRefs | string[] | yes | Criterion IDs from criteria-plan.toon that this story verifies (e.g., `C-01`). Intentional extension beyond original plan scope — added for traceability between E2E stories and convergence criteria. |
| derivedFrom | string[] | yes | Source scenario references that this story derives from. **At least 1 entry required.** Each entry uses the form `{phaseId}.{S-NN}` (e.g., `Phase 4.S-02`) for plan-phase scenarios or `{featureId}.{S-NN}` (e.g., `F-03.S-05`) for roadmap-feature scenarios. E2E stories without a source scenario are rejected as blocking — every story MUST trace back to at least one scenario. See `scenario.schema.md` for scenario IDs. |
| screenshots | string[] | no | File paths to reference screenshots for visual verification. |
| consoleDumps | string[] | no | File paths to console output dumps for debugging. |
| tags | string[] | no | Freeform tags for filtering and grouping (e.g., `smoke`, `regression`, `auth`). Used by `/loom-converge --e2e` to run subsets of stories. |
| storyTimeout | integer | no | Overall timeout for the entire story in milliseconds. Default: 120000 (2 minutes). |

### StoryStep Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | yes | What the user or system does. |
| expected | string | yes | What should happen as a result. |
| status | enum | no | Step result: `pass`, `fail`, `skipped`, or null (not yet run). When a step `fail`s, all subsequent steps are set to `skipped` by the e2e-runner-agent. |
| stepTimeout | integer | no | Per-step timeout in milliseconds. Overrides the default story-level or global timeout. If absent, the runner uses its default (30000ms). |

### Example

```toon
schemaVersion: 2
name: User creates a board and adds first task
url: http://localhost:3000
workflow: New user signs up, creates a board, adds a task, and verifies the task appears
preconditions[N]: Database is seeded with default data, Server is running on port 3000
format: imperative
milestoneRef: M-01
criteriaRefs[N]: C-01, C-02, C-03
derivedFrom[N]: F-01.S-01, F-02.S-01, F-02.S-03
screenshots[N]:
consoleDumps[N]:
tags[N]: smoke, onboarding
storyTimeout: 120000

steps[N]:
  step:
    action: Navigate to /signup and fill in name, email, password
    expected: Redirect to /dashboard with welcome message
    status:
    stepTimeout: 30000
  step:
    action: Click 'New Board' and enter board title 'My First Board'
    expected: Board appears in the board list with title 'My First Board'
    status:
  step:
    action: Click into the board and click 'Add Task' with title 'Setup CI'
    expected: Task 'Setup CI' appears in the board's task list with status 'todo'
    status:
```

### Typed Array Form

```toon
stories[N]{name,url,workflow,format,milestoneRef}:
  User creates board and adds task,http://localhost:3000,Signup then create board and task,imperative,M-01
  User moves task across columns,http://localhost:3000,Drag task from todo to done,imperative,M-01
  Admin deletes a board,http://localhost:3000/admin,Admin removes board and verifies cascade,bdd,M-02
```

---

## PlaywrightTest Schema

A PlaywrightTest links an E2EStory to a concrete Playwright test file and execution configuration.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| storyRef | string | yes | Must reference an existing `E2EStory.name`. |
| testFile | string | yes | Path to the test file. Must end with `.spec.ts` or `.test.ts`. |
| sessionName | string | yes | Unique session identifier. Must be kebab-case. |
| sessionMode | enum | yes | Execution mode: `headless` or `chrome-mcp`. |
| isolated | boolean | yes | Whether the test runs in an isolated browser context. |

### Example

```toon
storyRef: User creates a board and adds first task
testFile: tests/e2e/user-creates-board.spec.ts
sessionName: user-creates-board
sessionMode: headless
isolated: true
```

### Typed Array Form

```toon
playwrightTests[N]{storyRef,testFile,sessionName,sessionMode,isolated}:
  User creates board and adds task,tests/e2e/user-creates-board.spec.ts,user-creates-board,headless,true
  User moves task across columns,tests/e2e/user-moves-task.spec.ts,user-moves-task,headless,true
  Admin deletes a board,tests/e2e/admin-deletes-board.spec.ts,admin-deletes-board,chrome-mcp,false
```

---

## Validation Rules

### E2EStory

1. **Name uniqueness.** `name` must be unique within the same `milestoneRef`.
2. **Name length.** `name` must not exceed 200 characters.
3. **URL format.** If `url` is present, it must be a valid URL (http or https scheme).
4. **Workflow required.** `workflow` must be a non-empty string.
5. **Format enum.** Must be one of: `imperative`, `bdd`, `checklist`.
6. **At least one step.** `steps` array must contain at least 1 StoryStep.
7. **Step completeness.** Every StoryStep must have non-empty `action` and `expected` fields.
8. **Step status enum.** If `status` is present, it must be one of: `pass`, `fail`, `skipped`.
9. **Milestone ref format.** `milestoneRef` must match pattern `M-NN`.
10. **Screenshot paths.** If present, each path in `screenshots` must be a valid file path.
11. **Console dump paths.** If present, each path in `consoleDumps` must be a valid file path.
12. **Tags format.** If present, each tag must be a non-empty kebab-case string.
13. **Story timeout range.** If present, `storyTimeout` must be a positive integer.
14. **Step timeout range.** If present, `stepTimeout` must be a positive integer.
15. **derivedFrom non-empty (v2+).** For `schemaVersion: 2` stories: `derivedFrom` MUST contain at least one entry. An e2e story without a source scenario is rejected as blocking. v1 stories (no `schemaVersion` field) skip this rule.
16. **derivedFrom format (v2+).** For `schemaVersion: 2` stories: each entry MUST match either `Phase {N}.S-{NN}` (plan-phase scenario) or `F-{NN}.S-{NN}` (roadmap-feature scenario). **Exception:** the literal sentinel `UNRESOLVED-{criterionId}` is permitted in `--auto` mode when the upstream criterion has no scenario origin (legacy or `source: inferred`). The sentinel surfaces the gap downstream; the convergence-planner flags any story carrying it as a warning until a real scenario is provided. v1 stories skip this rule.
17. **derivedFrom resolves (v2+).** For `schemaVersion: 2` stories: each non-sentinel referenced scenario MUST exist in the source plan or roadmap. Unresolved references are blocking. `UNRESOLVED-*` sentinels are exempt (they are by definition unresolved). v1 stories skip this rule.
18. **derivedFrom scenario testTier compatibility (v2+).** For `schemaVersion: 2` stories: at least one of the referenced scenarios SHOULD have `testTier: e2e` (explicit or resolved per `scenario.schema.md`). When no referenced scenario resolves to `e2e`, the story is flagged with a warning — the story may still run, but the convergence-planner will surface the mismatch. v1 stories skip this rule.

### PlaywrightTest

1. **Story ref exists.** `storyRef` must reference an existing `E2EStory.name`.
2. **Test file extension.** `testFile` must end with `.spec.ts` or `.test.ts`.
3. **Session name format.** `sessionName` must be kebab-case (lowercase letters, digits, and hyphens only).
4. **Session name uniqueness.** `sessionName` must be unique across all PlaywrightTest entries.
5. **Session mode enum.** Must be one of: `headless`, `chrome-mcp`.

---

## YAML Story Format

E2E stories are written as YAML files for readability and Playwright ecosystem compatibility. This is an explicit exception to the TOON-everywhere rule (app-specific data per CLAUDE.md). The YAML format is the on-disk representation used by the e2e-test-writer-agent; the TOON schema above remains the canonical type definition.

### YAML Schema

```yaml
# Required fields
name: string                  # Unique name within the milestone. Max 200 chars.
url: string                   # Starting URL for the workflow (http/https).
workflow: string              # Human-readable description of the workflow.
milestoneRef: string          # Milestone reference. Format: M-NN.
format: enum                  # One of: imperative, bdd, checklist.

# Preconditions (required, may be empty list)
preconditions:
  - string                    # Setup requirement before the story runs.

# Steps (required, at least 1)
steps:
  - action: string            # What the user or system does.
    expected: string          # What should happen as a result.
    stepTimeout: integer      # Optional per-step timeout in ms (default: 30000).

# Criteria traceability (required)
criteriaRefs:
  - string                    # Criterion IDs from criteria-plan.toon (e.g., C-01).

# Source-scenario traceability (required, at least 1 entry)
derivedFrom:
  - string                    # Scenario refs: "Phase {N}.S-{NN}" or "F-{NN}.S-{NN}".

# Optional fields
screenshots: []               # File paths to reference screenshots.
consoleDumps: []              # File paths to console output dumps.
tags: []                      # Freeform tags for filtering (e.g., smoke, regression).
storyTimeout: integer         # Overall story timeout in ms (default: 120000).
```

### Format Descriptions

| Format | Style | Best For |
|--------|-------|----------|
| `imperative` | Direct action-result pairs | Straightforward user workflows |
| `bdd` | Given/When/Then structure in action/expected fields | Complex business logic with branching conditions |
| `checklist` | Pass/fail verification items | Milestone sign-off gates |

### Imperative Step Example

```yaml
steps:
  - action: Navigate to /signup and fill in name, email, password
    expected: Redirect to /dashboard with welcome message
  - action: Click 'New Board' and enter board title 'My First Board'
    expected: Board appears in the board list
```

### BDD Step Example

```yaml
steps:
  - action: "Given: Admin is logged in and on the admin dashboard"
    expected: Admin dashboard shows list of all boards
  - action: "When: Admin clicks 'Delete' on 'Test Board' and confirms"
    expected: "Then: Board is removed from the list"
  - action: "And: Admin navigates to the tasks page"
    expected: "Then: No tasks from 'Test Board' appear"
```

### Checklist Step Example

```yaml
steps:
  - action: Verify user registration flow completes
    expected: New user account exists in database
  - action: Verify board CRUD operations
    expected: Board can be created, read, updated, and deleted
```

### File Naming Convention

Story files are stored in `.plan-execution/convergence/e2e/stories/` with the naming pattern:

```
{milestone-ref}-{story-slug}.yaml
```

Examples:
- `m-01-user-creates-board.yaml`
- `m-02-admin-deletes-board.yaml`

### YAML Validation Rules

1. **All required fields present.** `name`, `workflow`, `milestoneRef`, `format`, `preconditions`, `steps`, `criteriaRefs`, `derivedFrom` must be present. `url` is optional.
2. **Format enum.** `format` must be one of: `imperative`, `bdd`, `checklist`.
3. **At least one step.** `steps` array must contain at least 1 entry.
4. **Step completeness.** Every step must have non-empty `action` and `expected` fields.
5. **Criteria refs non-empty.** `criteriaRefs` must contain at least one criterion ID.
6. **Criteria refs valid.** Each criterion ID in `criteriaRefs` must match a `C-NN` pattern and reference an existing criterion with `testTier: e2e` in `criteria-plan.toon`.
7. **Milestone ref format.** `milestoneRef` must match pattern `M-NN`.
8. **Name uniqueness.** `name` must be unique within the same `milestoneRef` across all story files.
9. **Step timeout range.** If `stepTimeout` is present, it must be a positive integer (milliseconds). Recommended range: 1000-120000.
10. **Story timeout range.** If `storyTimeout` is present, it must be a positive integer (milliseconds). Recommended range: 10000-600000.
11. **Tags format.** If `tags` is present, each tag must be a non-empty string containing only lowercase letters, digits, and hyphens.
12. **derivedFrom non-empty (v2+).** For `schemaVersion: 2` stories: `derivedFrom` must contain at least one entry. v1 stories skip this rule.
13. **derivedFrom entry format (v2+).** For `schemaVersion: 2` stories: each entry MUST match `Phase \d+\.S-\d{2,}` or `F-\d{2,}\.S-\d{2,}`. **Exception:** the literal sentinel pattern `UNRESOLVED-[\w-]+` is permitted in `--auto` mode for stories generated against legacy criteria with no scenario origin. v1 stories skip this rule.
14. **derivedFrom resolves (v2+).** For `schemaVersion: 2` stories: each non-sentinel referenced scenario MUST exist in the source plan or roadmap (validated at convergence-planner load time). `UNRESOLVED-*` sentinels are exempt. v1 stories skip this rule.

---

## Relationship to Other Schemas

- **taxonomy.md** -- E2E stories operate at the milestone level of the planning hierarchy.
- **convergence-tier.schema.md** -- The `e2e` tier (level 1) defines the runner and pass condition for E2E verification.
- **roadmap.schema.md** -- Milestones referenced by `milestoneRef` and feature scenarios referenced by `derivedFrom[]` (form `F-NN.S-NN`) are defined in the roadmap.
- **agent-result.schema.md** -- The e2e-runner-agent returns test results in the AgentResult envelope with `verificationStatus`.
- **criteria-plan.schema.md** -- Criteria with `testTier: e2e` are the input source for story generation. Stories reference criteria via `criteriaRefs`.
- **scenario.schema.md** -- Canonical leaf-level testable unit. Every e2e story MUST cite ≥1 source scenario via `derivedFrom[]`. The story is the concrete user-journey realization of one or more scenarios.

# Plan Format Specification

Canonical specification for PLAN.md files consumed by the meta-orchestration pipeline. This document is to PLAN.md what `agent-result.schema.md` is to AgentResult — the authoritative format reference.

All orchestrators (`/loom-roadmap`, `/loom-execute-plan`, `/loom-review-plan`, `/loom-test-plan`) and the `plan-builder-agent` MUST conform to this spec.

**Version note:** This spec supports both `planVersion: 1` (original) and `planVersion: 2` (spec-driven). v1 plans continue to work unchanged. v2 plans add API Specification, State Machines, Error Handling, and expanded Schema sections. See `spec.schema.md` for detailed format of v2-only sections.

---

## Frontmatter

Every PLAN.md MUST begin with YAML frontmatter:

```yaml
---
planVersion: 1 | 2
name: "Project Name"
status: draft | reviewed | approved | in-progress | completed
created: YYYY-MM-DD
lastReviewed: YYYY-MM-DD | null
roadmapRef: ROADMAP.md | null
totalPhases: N
totalWaves: N
---
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| planVersion | integer | yes | Schema version. `1` = original format. `2` = spec-driven format with API specs, state machines, error handling. |
| name | string | yes | Project name. Must match `# Plan: {name}` title. |
| status | enum | yes | Plan lifecycle state. |
| created | date string | yes | When the plan was first created. |
| lastReviewed | date string | no | When `/loom-review-plan` last ran. null if never reviewed. |
| roadmapRef | string | no | Path to the ROADMAP.md this plan was generated from. null if created without a roadmap. v2 plans SHOULD set this. |
| totalPhases | integer | yes | Number of phases (excluding verification). |
| totalWaves | integer | yes | Number of execution waves (wave 0 = contracts). |

---

## Required Sections

Every PLAN.md MUST include these sections in this order. Missing or out-of-order required sections are structural errors.

### 1. Title

```markdown
# Plan: {Project Name}
```

The name MUST match `frontmatter.name`.

### 2. Overview

```markdown
## Overview
```

1-3 sentences describing what this builds and why. May include entity relationship descriptions.

### 3. Tech Stack

```markdown
## Tech Stack
```

Languages, frameworks, databases, key dependencies. This informs the contracts-agent about the target environment and the verification-agent about which tools to run.

### 4. Schema / Type Definitions

```markdown
## Schema / Type Definitions
```

MUST contain at least one typed entity definition (table with fields, types, and constraints). This section feeds directly into the contracts-agent in Wave 0.

**Entity tables** use this format:

```markdown
### EntityName

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key |
```

**Completeness rule:** Every entity referenced in any phase's deliverables or acceptance criteria MUST be defined here. References to undefined types are a validation warning.

May also include:
- Database schema SQL
- API route definitions
- TypeScript type specs
- Error formats

**v2 additions:** For `planVersion: 2`, entity tables MUST also include:
- **Validation Rules** column (regex patterns, min/max, custom validators) — or a separate `## Validation Rules` section
- **Indexing** subsection per entity (primary keys, unique constraints, indexes, compound indexes)
- **Cascade Behavior** subsection (ON DELETE / ON UPDATE for every foreign key)
- Optional **SQL Schema** subsection with CREATE TABLE statements

See `spec.schema.md` → "Expanded Schema / Type Definitions" for exact formats.

### 5. API Specification (v2 only)

```markdown
## API Specification
```

**Required for `planVersion: 2` plans that define HTTP endpoints.** Omit for v1 plans or non-API projects.

Each endpoint gets its own `### METHOD /path` subsection with: description, auth requirements, path/query parameters, request body with field types and constraints, success response with JSON shape, error responses with status codes and conditions, and behavior notes for implementation-specific details.

See `spec.schema.md` → "API Specification" for the exact endpoint format, rules, and validation checks.

### 6. State Machines (v2 only)

```markdown
## State Machines
```

**Required for `planVersion: 2` plans where any entity has a status/lifecycle/state field.** Omit if no entities have state fields.

Each stateful entity gets: an ASCII state transition diagram, a States table (state, description, entry condition), a Valid Transitions table (from, to, trigger, side effects), and an Invalid Transitions table (from, to, error code, message).

See `spec.schema.md` → "State Machines" for the exact format, rules, and validation checks.

### 7. Error Handling Specification (v2 only)

```markdown
## Error Handling Specification
```

**Required for `planVersion: 2` plans that define APIs.** Omit for v1 plans or non-API projects.

Defines the consistent error response JSON format, error categories table (code, HTTP status, when used, retryable), field-level validation error format, and retry behavior.

See `spec.schema.md` → "Error Handling Specification" for the exact format, rules, and validation checks.

### 8. Execution Phases

```markdown
## Execution Phases
```

Contains one or more `### Phase N` subsections. See Phase Structure below.

### 9. Verification Commands

```markdown
## Verification Commands
```

Runnable shell commands that the verification-agent executes after each wave:

```markdown
## Verification Commands

```bash
npx tsc --noEmit
npx vitest run
npx eslint src/
`` `
```

---

## Optional Sections

These sections are recommended but not required:

- `## Milestones` — Key checkpoints with dependencies. Auto-derived from phases if absent.
- `## Risks & Mitigations` — Known risks and planned mitigations.
- `## Acceptance Criteria (Final)` — Overall project-level criteria beyond per-phase criteria.
- `## Configuration Specification` — (v2) Environment variables, defaults, validation. See `spec.schema.md`.
- `## Validation Rules` — (v2) Per-field validation rules when not inline in Schema tables. See `spec.schema.md`.

---

## Phase Structure

Each phase is a `### Phase N` subsection within `## Execution Phases`. Phases MUST follow this structure:

```markdown
### Phase N — Wave W: {Phase Name}

**Agent:** {agent name}
**Objective:** {one sentence describing the goal}
**Dependencies:** {comma-separated list of phase numbers, or "None"}
**File Ownership:** {comma-separated directory globs and/or file paths}

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/foo/bar.ts | Create | implementer-1 |
| src/baz.ts | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] {testable criterion}
- [ ] {another testable criterion}

#### Convergence Targets *(optional)*
- {deterministic output to verify, e.g., "GET /api/users returns JSON array (ignore: timestamps)"}
- {e.g., "Error responses match shape: {error: {code, message}}"}
```

### Phase Fields

| Field | Required | Description |
|-------|----------|-------------|
| Phase number | yes | Integer, unique across the plan. Phase 0 is always contracts. |
| Wave number | yes | Which execution wave this phase belongs to. Multiple phases can share a wave (parallel execution). |
| Phase name | yes | Short descriptive name. |
| Agent | yes | Which agent runs this phase (contracts-agent, implementer-agent, wiring-agent). |
| Objective | yes | One sentence describing the goal. |
| Dependencies | yes | List of phase numbers this depends on, or "None". |
| File Ownership | yes | Directories (with `**` glob) and/or individual files this phase exclusively controls. |
| Deliverables | yes | Table of files with Action (Create/Modify/Delete) and Owner hint. |
| Acceptance Criteria | yes | Checkbox list of testable criteria. |
| Convergence Targets | no | Free-text bullets listing deterministic, verifiable outputs. Read by convergence-planner-agent as high-confidence seeds. Only include outputs that are capturable and deterministic (API responses, generated files, CLI exit codes, rendered pages). |

### Dependency Syntax

Dependencies reference phase numbers explicitly:

```markdown
**Dependencies:** Phase 0, Phase 1
**Dependencies:** None
```

**Rules:**
- Phase 0 MUST have `**Dependencies:** None`
- Dependencies MUST reference only phases with a lower phase number (no forward references)
- Dependencies MUST NOT create cycles (A depends on B, B depends on A)
- Dependencies form a DAG (Directed Acyclic Graph)

### File Ownership Syntax

```markdown
**File Ownership:** src/auth/**, src/middleware/auth.ts
```

**Rules:**
- Directories use `**` suffix: `src/auth/**` means all files in `src/auth/` recursively
- Individual files use exact paths: `src/middleware/auth.ts`
- No two phases in the same wave may claim the same file or overlapping directories
- Cross-wave overlaps are allowed (a later wave may modify files from an earlier wave)
- Wiring-agent phases own integration files: `package.json`, barrel/index files, route registrations
- Every file in the Deliverables table MUST fall within the phase's declared ownership

### Acceptance Criteria Format

Criteria MUST be automatable — expressible as a command that either passes or fails.

**Valid criteria:**
- `npx tsc --noEmit exits with code 0`
- `GET /api/users returns 200 with JSON array`
- `All repository functions use parameterized queries`
- `Foreign key constraints are enforced (deleting a user cascades to boards)`

**Invalid criteria (will be flagged by validation):**
- `Should work well` — subjective, not testable
- `Loads in under 200ms` — unmeasurable without test infrastructure
- `Good error handling` — vague, not automatable
- `Handles edge cases` — unspecified which cases

---

## Phase 0 Constraints

Phase 0 is special — it is always the contracts phase:

- Phase 0 MUST exist in every plan
- Phase 0 MUST use Wave 0
- Phase 0 MUST use agent: `contracts-agent`
- Phase 0 MUST have Dependencies: None
- Phase 0 produces the shared types, schemas, and interfaces that all later phases depend on
- Phase 0 files are read-only after Wave 0 completes (per execution-conventions.md)

---

## Sizing Guidelines

| Metric | Acceptable | Warning | Blocking |
|--------|-----------|---------|----------|
| Deliverables per phase | 2-8 | 9-12 | >12 or <2 |
| Acceptance criteria per phase | 2+ | 1 | 0 |
| Files-in per agent (reads) | 1-15 | 16-20 | >20 |
| Phases per plan | 2-10 | 11-15 | >15 |

**Splitting oversized phases:** When a phase exceeds 8 deliverables, split along natural domain boundaries (e.g., separate data layer from API routes, separate notifications from WebSocket).

**Merging undersized phases:** When a phase has <2 deliverables, merge with an adjacent phase in the same domain if file ownership allows.

---

## Validation Stages

Orchestrators validate plans through these stages. Stages are version-aware — v2-only checks are skipped for `planVersion: 1` plans.

### Stage 1: Structure Parse
- Frontmatter exists with required fields (including `roadmapRef` awareness for v2)
- All required sections present in order
- **v2:** API Specification, State Machines, and Error Handling sections must be present (if applicable — API Spec required for API projects, State Machines required if any entity has a status field)
- At least one Phase subsection exists
- Phase 0 exists and is contracts-focused

### Stage 2: Dependency Graph
- Build adjacency list from dependency declarations
- Run cycle detection (Kahn's algorithm)
- Compute critical path (longest path through DAG)
- Check: no forward references, no self-dependencies

### Stage 3: File Ownership
- Build file-to-phase map from ownership declarations
- Check for overlaps within same wave (blocking)
- Check that every deliverable falls within its phase's ownership
- Wiring-agent owned files excluded from overlap checks

### Stage 4: Sizing
- Count deliverables per phase against limits
- Count acceptance criteria per phase (0 = blocking)
- Check criteria text for non-automatable language

### Stage 5: Agent Feasibility (optional, deep)
- Estimate context window requirements per phase
- Flag phases requiring >15 file reads

### Stage 6: Schema Completeness (optional, deep)
- Check all entity references resolve to definitions in Schema section
- Flag undefined type references

### Stage 7: Spec Completeness (v2 only, optional)
- **API coverage:** Every endpoint referenced in acceptance criteria has a full spec in API Specification
- **State machine coverage:** Every entity with a status/state field has a state machine defined
- **Error consistency:** Every error code used in API Specification error tables is defined in Error Handling Specification
- **Index coverage:** Every foreign key in Schema has a corresponding index in the Indexing subsection
- **Cascade coverage:** Every foreign key has ON DELETE / ON UPDATE behavior defined

---

## Examples

### Valid Plan Reference

See `test-fixtures/taskboard/PLAN.md` — a complete, well-structured plan with all required sections, proper Phase 0 contracts, parallel execution tracks in Wave 1, and testable acceptance criteria.

### Invalid Plan Reference

See `test-fixtures/broken-plan/PLAN.md` — demonstrates common errors:
- Missing Phase 0 (no contracts phase)
- Circular dependency (Phase 2 depends on Phase 3, Phase 3 depends on Phase 2)
- Shared file ownership (`src/utils/helpers.ts` in both Phase 2 and Phase 3)
- Oversized phase (Phase 3 has 16 deliverables)
- Missing acceptance criteria per phase
- Untestable criteria ("loads in under 200ms")
- Undefined type reference (`UserProfile` never defined)
- Missing frontmatter

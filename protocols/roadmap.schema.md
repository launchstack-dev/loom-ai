# Roadmap Format Specification

Canonical specification for ROADMAP.md files consumed by the meta-orchestration pipeline. This document is to ROADMAP.md what `plan.schema.md` is to PLAN.md — the authoritative format reference.

All orchestrators (`/loom-roadmap`, `/loom-review-roadmap`, `/loom-auto`) and the `roadmap-builder-agent` MUST conform to this spec.

---

## Frontmatter

Every ROADMAP.md MUST begin with YAML frontmatter:

```yaml
---
roadmapVersion: 1
name: "Project Name"
status: draft | reviewed | approved
created: YYYY-MM-DD
lastReviewed: YYYY-MM-DD | null
targetDate: YYYY-MM-DD | null
totalFeatures: N
totalMilestones: N
---
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| roadmapVersion | integer | yes | Schema version (currently 1). Enables future evolution. |
| name | string | yes | Project name. Must match `# Roadmap: {name}` title. |
| status | enum | yes | Roadmap lifecycle state. `draft` → `reviewed` → `approved`. |
| created | date string | yes | When the roadmap was first created. |
| lastReviewed | date string | no | When `/loom-review-roadmap` last ran. null if never reviewed. |
| targetDate | date string | no | Overall project target completion date. null if open-ended. |
| totalFeatures | integer | yes | Number of features defined in the Features section. |
| totalMilestones | integer | yes | Number of milestones defined in the Milestones section. |

### Status Transitions

```
draft → reviewed    (after /loom-review-roadmap completes)
reviewed → approved (after user approves or /loom-roadmap --approve-roadmap)
approved → draft    (if user requests revision after approval)
```

Once `approved`, the roadmap unlocks plan generation via `/loom-roadmap --init --plan`. Plan generation MUST NOT proceed from a `draft` or `reviewed` roadmap.

---

## Required Sections

Every ROADMAP.md MUST include these sections in this order. Missing or out-of-order required sections are structural errors.

### 1. Title

```markdown
# Roadmap: {Project Name}
```

The name MUST match `frontmatter.name`.

### 2. Vision

```markdown
## Vision
```

2-5 sentences describing: what is being built, who it is for, and why now. This replaces the shallow "Overview" that exists in PLAN.md. The vision should articulate the problem space, the user need, and the strategic rationale — not just the technical output.

**Good vision:**
> "A lightweight task management API for small dev teams who need Trello-like boards without the bloat. Targets solo developers and teams of 2-5 who want a self-hosted, privacy-first alternative. Built now because existing solutions require cloud accounts and don't support local-first data."

**Bad vision:**
> "Build a task management API." *(Too terse, no context)*

### 3. Success Metrics

```markdown
## Success Metrics
```

Measurable outcomes that define project success. Each metric MUST have a name, target value, and measurement method.

```markdown
| Metric | Target | Measurement |
|--------|--------|-------------|
| API response time | p95 < 200ms | vitest benchmark suite on /api/* endpoints |
| Test coverage | > 80% lines | vitest --coverage |
| Type safety | Zero any types | npx tsc --noEmit --strict |
| Schema validation | All endpoints validated | zod schema tests pass |
```

**Rules:**
- At least 2 metrics required
- Each metric must be objectively measurable (no "good performance", "reliable")
- Measurement method must reference a tool or command that can verify it
- Metrics feed into PLAN.md acceptance criteria during plan generation

### 4. Constraints & Decisions

```markdown
## Constraints & Decisions
```

Locked architectural decisions and non-negotiable requirements. This section replaces the standalone CONTEXT.md file — decisions now live inline in the roadmap where they belong. Each entry has a unique ID.

```markdown
### C-01: {Decision Title}
**Decision:** {the chosen approach}
**Rationale:** {why this was chosen, referencing project context}
**Alternatives considered:** {what else was evaluated and why it was rejected}
**Impact:** high | medium | low
```

**Rules:**
- IDs are sequential: C-01, C-02, etc.
- Each decision must have all four fields (Decision, Rationale, Alternatives, Impact)
- Existing CONTEXT.md files are still consumed if present — but new projects should use this inline format
- At least 1 constraint/decision is required (even if it's just the tech stack choice)
- High-impact decisions constrain plan structure (e.g., database choice affects schema, auth strategy affects API design)

### 5. Tech Stack

```markdown
## Tech Stack
```

Languages, frameworks, databases, and key dependencies. This is a strategic choice — it belongs at the roadmap level, not the plan level.

```markdown
| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | Server runtime |
| Language | TypeScript | 5.x | Type safety |
| Framework | Express | 4.18 | HTTP server |
| Database | SQLite | via better-sqlite3 | Embedded data store |
| Testing | Vitest | latest | Unit + integration tests |
| Validation | Zod | 3.x | Runtime type validation |
```

**Rules:**
- At least one entry required
- Version can be "latest" or a specific version constraint
- Purpose column helps reviewers understand why each choice was made

### 6. Features

```markdown
## Features
```

The core of the roadmap. Each feature is a subsection with a unique ID.

````markdown
### F-01: {Feature Name}

**Priority:** P0 | P1 | P2
**Milestone:** M-{NN}
**Description:** 2-5 sentences describing the user-facing behavior and its value.

**Entities involved:** {comma-separated list of entity names from the Data Model section}

**Key behaviors:**
- {concrete, observable behavior 1}
- {concrete, observable behavior 2}
- {concrete, observable behavior 3}

**Convergence targets:** *(optional — deterministic outputs to verify)*
- {verifiable output derived from key behaviors, e.g., "POST /api/teams returns 201 with team JSON (ignore: timestamps, id)"}

**Scenarios:** *(optional — Given/When/Then blocks per `scenario.schema.md`)*

```toon
id: S-01
title: Create team with valid payload
given[1]: The teams endpoint is reachable
when: A client POSTs to /api/teams with a valid payload
whenTriggerType: api-call
then[2]: Response status MUST be 201, Response body MUST contain id and name fields
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

**Open questions:** *(optional — for interactive discussion)*
- {question that needs user input before plan generation}
````

**Rules:**
- Feature IDs are sequential: F-01, F-02, etc.
- Priority levels: P0 (must-have for MVP), P1 (important, not launch-blocking), P2 (nice-to-have)
- Every feature must reference at least one entity from the Data Model section
- Every feature must be assigned to exactly one milestone
- Key behaviors must be concrete and observable (not "handles errors gracefully")
- Convergence targets are optional free-text bullets listing outputs that can be verified deterministically (API responses, generated files, CLI exit codes, rendered pages). The convergence-planner-agent reads these as high-confidence seeds during target discovery. Only include targets that are capturable and deterministic — skip subjective or timing-dependent behaviors.
- The optional **Scenarios** subsection holds one or more scenario blocks per `scenario.schema.md`. Scenarios are the canonical leaf-level testable unit and SHOULD accompany Key behaviors with concrete Given/When/Then formalizations. Scenario `id`s MUST be unique within the feature. When present, the `plan-builder-agent` derives plan-phase scenarios from these per the propagation rules below.
- Open questions are resolved during the interactive discussion phase before plan generation
- At least 2 features required (a single feature is likely too coarse-grained)
- Description should focus on user value, not implementation details

### 7. Data Model (Conceptual)

```markdown
## Data Model (Conceptual)
```

Entity names, their relationships, and key fields at the **conceptual** level. This is NOT the full typed schema — that belongs in PLAN.md. Think entity-relationship diagram in text form.

```markdown
### Entities

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| User | id, name, email, passwordHash | Account holder |
| Board | id, title, ownerId | Collection of tasks |
| Task | id, title, status, boardId, assigneeId | Work item |

### Relationships

| From | To | Type | Description |
|------|-----|------|-------------|
| User | Board | 1:N | A user owns many boards |
| Board | Task | 1:N | A board contains many tasks |
| User | Task | 1:N | A user can be assigned many tasks |
```

**Rules:**
- Every entity must be referenced by at least one feature in the Features section
- Key fields are the important fields — not every column, but enough to understand the entity's shape
- Relationships must use standard cardinality notation: 1:1, 1:N, M:N
- During plan generation, this conceptual model is expanded into fully typed schemas with constraints, indexes, and cascade behavior

### 8. Milestones

```markdown
## Milestones
```

Ordered delivery milestones. Each milestone groups features into a deliverable unit.

```markdown
### M-01: {Milestone Name}

**Features:** F-01, F-02
**Depends on:** None | M-{NN}
**Acceptance:** {1-2 sentence high-level acceptance description}
**Effort:** S | M | L | XL
```

**Rules:**
- Milestone IDs are sequential: M-01, M-02, etc.
- Every feature must be assigned to exactly one milestone (no orphan features)
- Dependencies reference other milestones by ID, not features
- Dependencies MUST NOT create cycles
- Dependencies MUST NOT include forward references (M-02 cannot depend on M-03)
- Effort sizing: S (1-2 features, few entities), M (3-4 features), L (5-6 features), XL (7+ features or cross-cutting concerns)
- Acceptance is high-level — detailed acceptance criteria come in PLAN.md
- During plan generation, milestones map to wave boundaries

### Milestone Dependency Rules

Milestones form a DAG (Directed Acyclic Graph), just like plan phases:
- No self-dependencies (M-01 cannot depend on M-01)
- No cycles (M-01 → M-02 → M-01)
- No forward references (M-01 cannot depend on M-02 if M-02 has a higher number)

---

### 9. Risks & Mitigations

```markdown
## Risks & Mitigations
```

Known risks with planned mitigations.

```markdown
| Risk | Severity | Mitigation |
|------|----------|------------|
| SQLite write contention under concurrent users | medium | Use WAL mode; document single-writer limitation |
| Scope creep from feature requests during development | high | Out of Scope section; strict milestone boundaries |
```

**Rules:**
- Severity: high, medium, or low
- At least 1 risk required (every project has risks; claiming zero risks suggests insufficient analysis)
- Mitigation must be actionable (not "we'll deal with it later")

### 10. Out of Scope

```markdown
## Out of Scope
```

Explicitly lists things NOT being built. Prevents scope creep during planning and execution.

```markdown
- Real-time collaboration (WebSocket sync between users)
- Mobile app or native clients
- Third-party OAuth providers (Google, GitHub login)
- Multi-tenancy / organization-level isolation
- Internationalization (i18n)
```

**Rules:**
- At least 2 items required
- Items should be plausible feature requests that someone might assume are included
- Helps reviewers calibrate scope expectations

---

## Optional Sections

These sections are recommended but not required:

- `## Prior Art` — Existing solutions analyzed, with pros/cons. Informs differentiation.
- `## Non-Functional Requirements` — Performance, scalability, availability targets beyond success metrics.
- `## Open Questions (Global)` — Questions that span multiple features and need resolution before planning.

---

## Validation Stages

Orchestrators validate roadmaps through these stages. All stages are run by `/loom-roadmap --validate --roadmap` and as a pre-check in `/loom-review-roadmap`.

### Stage 1: Structure Parse — BLOCKING

| Check | Severity | Description |
|-------|----------|-------------|
| Frontmatter exists | blocking | YAML frontmatter with `---` delimiters must be present |
| Required frontmatter fields | blocking | `roadmapVersion`, `name`, `status`, `created`, `totalFeatures`, `totalMilestones` must all be present and non-null |
| Title matches name | blocking | `# Roadmap: {name}` must match `frontmatter.name` |
| Required sections present | blocking | Vision, Success Metrics, Constraints & Decisions, Tech Stack, Features, Data Model (Conceptual), Milestones, Risks & Mitigations, Out of Scope must all exist |
| Section order | blocking | Required sections must appear in the order specified above |
| Feature count matches | warning | `totalFeatures` in frontmatter should match actual feature count |
| Milestone count matches | warning | `totalMilestones` in frontmatter should match actual milestone count |

### Stage 2: Feature Completeness — BLOCKING / WARNING

| Check | Severity | Description |
|-------|----------|-------------|
| Feature has milestone | blocking | Every feature must reference an existing milestone (M-XX) |
| Feature has entities | warning | Every feature should reference at least one entity from the Data Model |
| Feature has key behaviors | warning | Every feature should have at least 2 key behaviors listed |
| Feature description length | warning | Feature descriptions shorter than 2 sentences may lack sufficient context |
| Priority distribution | info | Flag if all features are P0 (no prioritization) or all P2 (no urgency) |

### Stage 3: Milestone Ordering — BLOCKING

| Check | Severity | Description |
|-------|----------|-------------|
| Cycle detection | blocking | Run Kahn's algorithm on milestone dependencies. Any cycle = blocking error. |
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
| Orphan entities | info | Entities defined but never referenced by any feature (may indicate dead schema) |

---

## Sizing Guidelines

| Metric | Acceptable | Warning | Guidance |
|--------|-----------|---------|----------|
| Features per roadmap | 2-12 | 13-20 | >20 features suggests scope is too broad; consider splitting into sub-projects |
| Milestones per roadmap | 1-6 | 7-10 | >10 milestones suggests timeline is too long or scope too broad |
| Features per milestone | 1-6 | 7+ | Large milestones should be split |
| Entities per data model | 1-10 | 11-15 | >15 entities suggests a complex domain; ensure features cover all entities |
| Constraints/decisions | 1-8 | 9+ | Too many decisions may indicate over-analysis; focus on high-impact |

---

## Relationship to PLAN.md

The ROADMAP.md is the **strategy** document. The PLAN.md is the **execution spec**.

| Aspect | ROADMAP.md | PLAN.md |
|--------|-----------|---------|
| Abstraction level | What and why | How, exactly |
| Data model | Conceptual (entities + relationships) | Fully typed (fields, types, constraints, indexes, cascades) |
| Features → | Features with behaviors | Phases with deliverables and acceptance criteria |
| Milestones → | Delivery boundaries | Wave boundaries |
| Constraints → | Architectural decisions | Honored as invariants in every phase |
| Tech Stack → | Strategic choices | Referenced by contracts-agent and verification-agent |
| Success Metrics → | Project-level outcomes | Feed into acceptance criteria at phase level |
| API detail | None (features describe behaviors) | Full endpoint specs with request/response/errors |
| Status lifecycle | draft → reviewed → approved | draft → reviewed → approved → in-progress → completed |

### Generation Flow

1. ROADMAP.md is created first (via `/loom-roadmap --init`)
2. ROADMAP.md is reviewed (via `/loom-review-roadmap`)
3. ROADMAP.md is approved (via `/loom-roadmap --approve-roadmap`)
4. PLAN.md is generated FROM the approved ROADMAP.md (via `/loom-roadmap --init --plan`)
5. The `plan-builder-agent` uses the roadmap as its primary input:
   - Features → execution phases
   - Milestones → wave boundaries
   - Data Model → fully typed schema
   - Constraints → invariants
   - Tech Stack → contracts and verification config
   - Success Metrics → final acceptance criteria
   - Feature Scenarios → plan-phase Scenarios (planVersion: 2 only; see Scenario Derivation Rules below)

### Scenario Derivation Rules

When a feature carries a `Scenarios:` subsection and the target plan is `planVersion: 2`:

1. **Every roadmap feature scenario MUST appear in at least one plan phase** that materializes the feature, preserving the original `id`. The plan-builder-agent inserts the scenario into the destination phase's `#### Scenarios` subsection verbatim.
2. **Provenance preserved.** Each propagated scenario carries an implicit `derivedFrom: {featureId}.{S-NN}` linkage tracked by the builder; downstream consumers (criteria planner, e2e story generator) cite this provenance via their own `scenarioRef`/`derivedFrom[]` fields.
3. **No silent renumbering.** The plan-builder-agent MUST NOT renumber a scenario `id` during propagation. If a collision would occur (two features contributing the same `S-NN` to one phase), the builder MUST split the phase or rename the entire feature's scenario range — never the individual scenario.
4. **v1 plans (planVersion 1) MUST drop feature scenarios silently** (with an info-level log). v1 plans have no slot for scenarios; the roadmap retains them as the source of truth.
5. **New plan-only scenarios are permitted.** A plan phase may add scenarios that do not appear in any roadmap feature (e.g., infrastructure or wave-0 contracts scenarios). Such additions do not back-propagate to the roadmap.

---

## Examples

### Valid Roadmap Reference

A well-structured roadmap should have clear feature decomposition, proper milestone grouping, and a conceptual data model that covers all features. See test fixtures for complete examples.

### Common Errors

| Error | Description |
|-------|-------------|
| Missing milestone assignment | Feature F-03 has no `Milestone:` field |
| Circular milestones | M-01 depends on M-02, M-02 depends on M-01 |
| Orphan entity | Entity "AuditLog" defined but not referenced by any feature |
| Vague success metric | "Good performance" — not measurable |
| Missing out-of-scope | Empty Out of Scope section suggests incomplete analysis |
| All P0 priorities | Every feature marked P0 — no real prioritization |

---

## Relationship to Convergence Schemas

- **taxonomy.md** -- Defines the planning hierarchy where milestones and features (roadmap-level concepts) map to convergence tiers: milestones to e2e, features to integration.
- **convergence-tier.schema.md** -- Defines the convergence tier that applies at the milestone level (e2e tier) and feature level (integration tier).
- **criteria-plan.schema.md** -- Criteria plans generated from roadmap features include a `testTier` column for convergence tier assignment and a `scenarioRef` column citing the scenarios that originate each criterion.
- **e2e-story.schema.md** -- E2E stories reference milestones defined in the roadmap via `milestoneRef` (format: `M-NN`) and MUST cite the source scenario(s) via `derivedFrom[]`.
- **interpretation-conflict.schema.md** -- Interpretation conflicts reference features (`featureRef: F-NN`) defined in the roadmap, and may reference individual scenarios via `scenarioRef`.
- **scenario.schema.md** -- Canonical leaf-level testable unit. Roadmap features host scenarios via the optional `Scenarios:` subsection. The plan-builder-agent propagates them into plan-phase `#### Scenarios` blocks per the Scenario Derivation Rules above.

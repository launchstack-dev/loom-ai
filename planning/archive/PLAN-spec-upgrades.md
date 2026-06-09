---
planVersion: 1
name: "Spec Upgrades — Scenarios & Change Lifecycle"
status: draft
created: 2026-05-23
lastReviewed: 2026-05-23
roadmapRef: null
totalPhases: 9
totalWaves: 7
---

# Plan: Spec Upgrades — Scenarios & Change Lifecycle

## Overview

Two upgrades that move Loom from spec-as-documentation parity (OpenSpec) toward enforcement-first BDD as a differentiator.

**Upgrade A — Scenarios layer.** Adds Given/When/Then scenarios as a first-class artifact under acceptance criteria in plans and under key behaviors in roadmap features. Scenarios become the canonical seed for criteria plans, e2e stories, and convergence targets — replacing the current free-text "GET /api/users returns 200" style. Unlike OpenSpec (where scenarios are documentation), Loom scenarios gate convergence: the convergence-planner emits targets directly from scenarios and the verification pipeline blocks on them. M-01 is independently shippable.

**Upgrade B — Change-proposal lifecycle over `contract-*` wiki pages.** Adds an OpenSpec-style change-proposal model layered on top of (not replacing) roadmap+plan. Completed milestones materialize into per-domain `contract-*` wiki pages at `.loom/wiki/pages/contract-{domain}.md` — *the same `contract-*` page category introduced by PLAN-wiki-flows-contracts, with this plan defining the body shape and lifecycle around it*. Subsequent maintenance proceeds as proposals against contract pages. Unlike BMAD's role-driven approval queues, the Loom change lifecycle is tool-driven: there are no human approval queues, only validation gates. The existing `/loom-quick` command remains the zero-ceremony path — it auto-emits a retroactive change proposal so contract pages stay coherent without forcing the full init→review→approve flow on small work.

Both upgrades are opt-in extensions to `planVersion: 2`. v1 plans remain unaffected. M-01 ships independently with a standalone acceptance gate before M-02 begins.

## Tech Stack

- **Markdown** for schema and command documentation
- **TOON** for new artifact frontmatter and on-disk state
- **TypeScript** for validators, parsing, and CLI commands (matches existing `hooks/` conventions)
- **vitest** for test suites
- **bun** / **bunx** preferred; npm fallback

## Pre-Execution Decisions

**D-01: RESOLVED — Option A: Living specs become `contract-*` wiki pages.** Rationale: PLAN-wiki-flows-contracts.md already introduces `contract-*` as a first-class wiki page category; the user's product vision puts the wiki MCP server as the keystone substrate; two artifacts guarantees drift. This plan defines the *body shape* (Purpose, Requirements, Scenarios, Entities, Out of Scope, History) and *change lifecycle* for `category: contract` pages; PLAN-wiki-flows-contracts owns the category and frontmatter. M-02 now depends on PLAN-wiki-flows-contracts MVP (its Wave 1) shipping first.

**D-02: RESOLVED — Option (b): explicit `/loom-plan materialize` subcommand.** Rationale: explicit-first is safer for the first release (no surprise wiki writes from an auto-running hook); predictable invocation for users new to the lifecycle. Option (a) (post-milestone hook on `/loom-plan execute` completion) is captured as a follow-up enhancement once the explicit path has bake time; option (c) was rejected because lazy materialization defers the work until a change is needed and surprises users with first-change latency.

## Schema / Type Definitions

### Scenario

BDD-shaped scenario block usable in roadmap features, plan phases, change proposals, and `contract-*` wiki pages.

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | Format: `S-{NN}` per parent; unique within parent. Validator checks cross-phase collisions when scenarios propagate. |
| title | string | One-line summary, imperative voice |
| given | string[] | 1+ preconditions, RFC 2119 keywords permitted |
| when | string | Exactly one trigger |
| whenTriggerType | string | One of `actor-action`, `system-event`, `api-call`; informs default `testTier` |
| then | string[] | 1+ observable outcomes; internal-state assertions flagged warning |
| stateRef | string \| null | Optional reference to a named state in the parent doc's `## State Machines` section. Validator checks state exists. |
| tags | string[] | From locked enum: `happy-path`, `edge-case`, `error`, `regression`. Project-local extensions via `scenarios.local.yaml`. |
| testTier | string | Optional; one of `unit`, `integration`, `e2e`, `qa-review` |
| automatable | boolean | True if `then` clauses verifiable by command |

### ContractPage Extensions

`category: contract` wiki pages at `.loom/wiki/pages/contract-{domain}.md`. The wiki page category and base frontmatter come from `wiki-page.schema.md` + the wiki-flows-contracts plan; *this* plan extends both with the fields and body sections required for the change lifecycle. Materializer is the only writer for greenfield content; archived change proposals (and `/loom-quick` quick-archive) are the only writers thereafter.

**Extended frontmatter (additive over wiki-page.schema.md):**

| Field | Type | Constraints |
|-------|------|-------------|
| contractVersion | integer | Currently 1 |
| domain | string | kebab-case; matches the `contract-{domain}` portion of pageId |
| contractStatus | string | `active`, `deprecated`, `superseded`. Distinct from wiki `staleness` (which tracks freshness, not lifecycle). |
| sourceChanges | string[] | Change IDs (chg-...) that mutated this page (chronological) |
| deprecatedAt | string \| null | ISO 8601 when status moved to `deprecated` |
| replacedBy | string \| null | Successor `contract-{domain}` pageId — wiki crossRefs[] also gets a `replaces` relationship entry |
| contentChecksum | string | SHA-256 of body sections; manual-edit detector compares against this. Augments wiki `staleness` (which detects freshness drift, not unauthorized edits). |

**Body sections (required for `category: contract` pages):**
- `## Purpose` — domain-level intent
- `## Requirements` — R-NN with `requirementType: functional | non-functional`, RFC 2119 normative language
- `## Scenarios` — Scenario blocks (see Scenario schema)
- `## Entities` — promoted from completed plans
- `## Out of Scope` — explicit exclusions
- `## History` — append-only log of archived changes

Wiki `crossRefs[]`, `sourceRefs[]`, `tags[]`, and `staleness` continue to work as defined in wiki-page.schema.md. The contract-page validator enforces the body section list above; the standard wiki lint rules apply to everything else.

### ChangeProposal

Per-change artifact directory: `.loom/changes/{change-id}/`.

| Field | Type | Constraints |
|-------|------|-------------|
| changeId | string | Format: `chg-{YYYYMMDD}-{kebab-slug}` |
| status | string | `proposed`, `reviewed`, `approved`, `in-progress`, `archived`, `rejected`, `superseded` |
| intent | string | 2-5 sentences |
| scope | object | `included[]` and `excluded[]` both required, both non-empty |
| approach | string | High-level technical strategy |
| affectedSpecs | string[] | Domain names |
| deltas | DeltaBlock[] | Per-domain mutations |
| linkedPlan | string \| null | Optional scoped PLAN.md path |
| reviewedBy | string \| null | Agent or human identity |
| reviewedAt | string \| null | ISO 8601 |
| reviewNotes | string \| null | Free text from reviewer |
| approvedBy | string \| null | Agent or human identity |
| approvedAt | string \| null | ISO 8601 |
| createdAt | string | ISO 8601 |
| archivedAt | string \| null | ISO 8601 |

### DeltaBlock

Per-domain mutation embedded in a ChangeProposal.

| Field | Type | Constraints |
|-------|------|-------------|
| domain | string | Must match an existing `contract-{domain}` wiki page |
| addedRequirements | string[] | New RFC 2119 statements |
| modifiedRequirements | object[] | `{ id, before, after }` — id must exist in target spec |
| removedRequirements | string[] | Requirement IDs to remove — must exist in target spec |
| addedScenarios | Scenario[] | New scenarios |
| modifiedScenarios | object[] | `{ id, before, after }` |
| removedScenarios | string[] | Scenario IDs to remove |
| breakingChange | boolean | True if removed/modified items have downstream references |
| migrationNote | string \| null | Required when `breakingChange: true` |
| rationale | string | Feeds the History section on archive |

### ChangeState

Runtime state at `.plan-execution/ephemeral/changes/{changeId}.toon`. Atomic-write per `execution-conventions.md`. Path constant exported from `hooks/lib/change-paths.ts` to prevent drift between Phase 5/6/7.

| Field | Type | Constraints |
|-------|------|-------------|
| changeId | string | Matches ChangeProposal |
| status | string | Mirrors ChangeProposal.status |
| transitions | object[] | `{ from, to, at, by, reason }` log |
| conflicts | object[] | `{ otherChangeId, conflictingIds[], detectedAt }` — populated when another in-flight change claims the same requirement/scenario IDs |
| supersededBy | string \| null | Set when another archived change invalidates this one |
| updatedAt | string | ISO 8601, monotonic |

### EntityDomainPartition

Explicit partitioning manifest at `.loom/wiki/contract-partition.toon`. Removes heuristic risk from the materializer (Phase 4). Authored manually or via `/loom-plan materialize --propose-partition` before first materialization. Each domain entry becomes one `contract-{domain}` wiki page.

| Field | Type | Constraints |
|-------|------|-------------|
| domain | string | kebab-case |
| entities | string[] | Entity names from the source plan/roadmap |
| description | string | One-line domain summary |

### ScenarioCoverageReport

Traceability artifact at `.plan-execution/ephemeral/scenario-coverage.toon`. Emitted by the convergence-planner alongside criteria-plan output. Maps every R-NN requirement to its covering scenarios; flags uncovered requirements as warnings.

| Field | Type | Constraints |
|-------|------|-------------|
| requirementId | string | R-NN from a `contract-*` wiki page or PLAN.md acceptance |
| coveringScenarios | string[] | Scenario IDs (S-NN) |
| coverageStatus | string | `covered`, `uncovered`, `partial` |
| tier | string | Highest test tier among covering scenarios |

## Execution Phases

### Phase 0 — Wave 0: Net-New Schema Contracts

**Agent:** contracts-agent
**Objective:** Create the four net-new schemas and the authoring template. Pure write-only — no existing-file modifications.
**Dependencies:** None
**File Ownership:** agents/protocols/scenario.schema.md, agents/protocols/contract-page-extensions.schema.md, agents/protocols/change-proposal.schema.md, agents/protocols/change-state.schema.md, agents/protocols/scenario-coverage.schema.md, agents/protocols/entity-domain-partition.schema.md, docs/scenarios-authoring-template.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/scenario.schema.md | Create | contracts-agent |
| agents/protocols/contract-page-extensions.schema.md | Create | contracts-agent |
| agents/protocols/change-proposal.schema.md | Create | contracts-agent |
| agents/protocols/change-state.schema.md | Create | contracts-agent |
| agents/protocols/scenario-coverage.schema.md | Create | contracts-agent |
| agents/protocols/entity-domain-partition.schema.md | Create | contracts-agent |
| docs/scenarios-authoring-template.md | Create | contracts-agent |

#### Acceptance Criteria
- [ ] All 6 schema files exist with TOON frontmatter, Field tables, and validation rule references per existing schema conventions.
- [ ] `scenario.schema.md` includes ≥3 valid and ≥3 invalid examples with the validator error each invalid case produces.
- [ ] `docs/scenarios-authoring-template.md` provides a complete Given/When/Then worked example, a decomposition guide for compound conditions, and an RFC 2119 phrasing cheatsheet — usable by authors in subsequent phases.
- [ ] Field names locked: phase exits with explicit "no field renames after this gate" sign-off written into `.plan-history/decisions/`.
- [ ] `grep -r 'planVersion: 1' agents/protocols/` finds no schema requiring scenarios from v1 plans.

---

### Phase 1 — Wave 1: Existing-Schema Modifications & Cross-References

**Agent:** contracts-agent
**Objective:** Modify the three existing core schemas to add opt-in Scenarios sections AND update all downstream schemas that reference acceptance criteria.
**Dependencies:** Phase 0
**File Ownership:** agents/protocols/plan.schema.md, agents/protocols/roadmap.schema.md, agents/protocols/spec.schema.md, agents/protocols/criteria-plan.schema.md, agents/protocols/e2e-story.schema.md, agents/protocols/convergence-tier.schema.md, agents/protocols/interpretation-conflict.schema.md, agents/protocols/interpretation-report.schema.md, agents/protocols/taxonomy.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/plan.schema.md | Modify | contracts-agent |
| agents/protocols/roadmap.schema.md | Modify | contracts-agent |
| agents/protocols/spec.schema.md | Modify | contracts-agent |
| agents/protocols/criteria-plan.schema.md | Modify | contracts-agent |
| agents/protocols/e2e-story.schema.md | Modify | contracts-agent |
| agents/protocols/convergence-tier.schema.md | Modify | contracts-agent |
| agents/protocols/interpretation-conflict.schema.md | Modify | contracts-agent |
| agents/protocols/interpretation-report.schema.md | Modify | contracts-agent |
| agents/protocols/taxonomy.md | Modify | contracts-agent |

#### Acceptance Criteria
- [ ] `plan.schema.md` adds optional `### Scenarios` subsection under each phase, restricted to `planVersion: 2`.
- [ ] `roadmap.schema.md` adds optional `Scenarios:` subsection per feature with derivation rules.
- [ ] `spec.schema.md` adds a v2 `## Scenarios` section parallel to API Specification and State Machines.
- [ ] `criteria-plan.schema.md` adds `scenarioRef` column; `e2e-story.schema.md` requires `derivedFrom[]` citing scenario IDs.
- [ ] `convergence-tier.schema.md` documents scenario-to-tier mapping (tag-based defaults + `whenTriggerType` fallback + explicit override).
- [ ] `interpretation-conflict.schema.md` adds `scenarioRef` as a valid conflict target.
- [ ] `taxonomy.md` reflects scenarios as the canonical leaf-level testable unit.

---

### Phase 2 — Wave 1: Scenario Parser & Validator

**Agent:** implementer-agent
**Objective:** Implement TypeScript scenario parsing and well-formedness validation. Parallel with Phase 1.
**Dependencies:** Phase 0
**File Ownership:** hooks/lib/scenario-parser.ts, hooks/lib/scenario-validator.ts, hooks/lib/spec-validators/plan-scenarios.ts, hooks/lib/spec-validators/roadmap-scenarios.ts, test/scenario-parser.test.ts, test/scenario-validator.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/scenario-parser.ts | Create | implementer-2 |
| hooks/lib/scenario-validator.ts | Create | implementer-2 |
| hooks/lib/spec-validators/plan-scenarios.ts | Create | implementer-2 |
| hooks/lib/spec-validators/roadmap-scenarios.ts | Create | implementer-2 |
| test/scenario-parser.test.ts | Create | implementer-2 |
| test/scenario-validator.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] Parser returns typed Scenario objects from markdown blocks.
- [ ] Validator enforces: exactly one When; ≥1 Given/Then; entity references resolve; `stateRef` (if present) resolves to a named state in the parent doc's State Machines; `testTier` is valid; ID uniqueness within parent AND across propagated copies.
- [ ] `bunx vitest run test/scenario-parser.test.ts` exits 0 with ≥12 cases (valid + malformed + edge).
- [ ] `bunx vitest run test/scenario-validator.test.ts` exits 0 with ≥10 cases covering every well-formedness rule.
- [ ] Findings emitted with severity matching `validation-rules.md` conventions.
- [ ] `bunx tsc --noEmit` exits 0.

---

### M-01 Integration Gate (not a phase — checkpoint after Phase 3)

After Phase 3 completes, before any M-02 phase begins:
- [ ] Run the taskboard fixture through the full pipeline: roadmap with scenarios → plan with scenarios → convergence-planner emits ≥2× target density vs. acceptance-criteria-only seeding.
- [ ] e2e-test-writer-agent produces e2e stories with `derivedFrom[]` populated for every story.
- [ ] M-01 release notes written; M-01 can ship independently of M-02.

---

### Phase 3 — Wave 2: Builder & Convergence Agent Integration

**Agent:** implementer-agent
**Objective:** Update the four agent definitions that emit or consume scenarios.
**Dependencies:** Phase 1, Phase 2
**File Ownership:** agents/plan-builder-agent.md, agents/roadmap-builder-agent.md, agents/convergence-planner-agent.md, agents/e2e-test-writer-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/plan-builder-agent.md | Modify | implementer-3 |
| agents/roadmap-builder-agent.md | Modify | implementer-3 |
| agents/convergence-planner-agent.md | Modify | implementer-3 |
| agents/e2e-test-writer-agent.md | Modify | implementer-3 |

#### Acceptance Criteria
- [ ] `plan-builder-agent.md` instructs scenario emission for every phase whose acceptance criteria include observable outputs.
- [ ] `roadmap-builder-agent.md` instructs scenario emission for every P0 and P1 feature.
- [ ] `convergence-planner-agent.md` documents scenario ranking precedence (explicit > derived > inferred) and emits ScenarioCoverageReport.
- [ ] `e2e-test-writer-agent.md` populates `derivedFrom[]` from upstream scenarios.
- [ ] All four agent docs reference `scenario.schema.md` in their inputs.

---

### Phase 4 — Wave 3: Contract-Page Materializer (M-02 begins)

**Agent:** contracts-agent
**Objective:** Implement the materializer that converts an approved roadmap + completed plan into per-domain `contract-*` wiki pages. Requires an explicit `EntityDomainPartition` manifest as input (eliminates heuristic risk per Agentic Workflow review).
**Dependencies:** Phase 1, Phase 3; PLAN-wiki-flows-contracts Wave 1 MVP (provides the `contract-*` page category and `wiki-page.schema.md` contract extensions)
**Gate:** M-01 Integration Gate must pass.
**File Ownership:** scripts/materialize-contracts.ts, hooks/lib/contract-page-writer.ts, hooks/lib/checksum.ts, commands/loom-plan/materialize.md, commands/loom-plan.md, test/materialize-contracts.test.ts, test-fixtures/contract-pages/

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/materialize-contracts.ts | Create | contracts-agent |
| hooks/lib/contract-page-writer.ts | Create | contracts-agent |
| hooks/lib/checksum.ts | Create | contracts-agent |
| commands/loom-plan/materialize.md | Create | contracts-agent |
| commands/loom-plan.md | Modify | contracts-agent |
| test/materialize-contracts.test.ts | Create | contracts-agent |
| test-fixtures/contract-pages/example/ | Create | contracts-agent |

#### Acceptance Criteria
- [ ] Reads an `EntityDomainPartition` manifest plus an approved ROADMAP.md + completed PLAN.md, emits one `.loom/wiki/pages/contract-{domain}.md` per domain in the manifest, with `category: contract` and the extended frontmatter from ContractPage Extensions.
- [ ] Contract-page writer is atomic (`.tmp` + rename) per `execution-conventions.md`; computes and stores `contentChecksum` on every write; updates wiki index per wiki-page.schema.md conventions.
- [ ] If source roadmap/plan contains no scenario blocks, emits Scenarios section with placeholder `<!-- no scenarios found — re-run after upgrading to planVersion: 2 -->` and logs a warning.
- [ ] Re-running against unchanged inputs produces byte-identical output.
- [ ] `/loom-plan materialize` subcommand exists, is registered in `commands/loom-plan.md`'s dispatch table, and is the primary trigger surface (per D-02). Supports `--dry-run` to print the materialization plan without writing, and `--propose-partition` to scaffold `contract-partition.toon` if absent.
- [ ] Running `/loom-plan materialize` against the taskboard fixture produces the expected `contract-*` pages and a matching wiki-index entry. Running without an `EntityDomainPartition` manifest exits non-zero with a clear "run --propose-partition first" message.
- [ ] Generated pages pass the existing wiki lint rules (`agents/protocols/wiki-lint-rules.md`) PLUS the new contract-page-specific body-section validator from Phase 7.
- [ ] `bunx vitest run test/materialize-contracts.test.ts` exits 0 with ≥6 cases including empty-scenarios fallback, idempotency, and wiki-index integration.

---

### Phase 5 — Wave 3: /loom-change Query Subcommands

**Agent:** implementer-agent
**Objective:** Implement the read-only `/loom-change` subcommands and the shared change-state runtime. Parallel with Phase 4. Establishes path constants and TOON state shape that Phase 6 will reuse.
**Dependencies:** Phase 0
**File Ownership:** commands/loom-change.md (skeleton), scripts/loom-change/list.ts, scripts/loom-change/status.ts, scripts/loom-change/diff.ts, hooks/lib/change-state.ts, hooks/lib/change-paths.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-change.md | Create | implementer-5 |
| scripts/loom-change/list.ts | Create | implementer-5 |
| scripts/loom-change/status.ts | Create | implementer-5 |
| scripts/loom-change/diff.ts | Create | implementer-5 |
| hooks/lib/change-state.ts | Create | implementer-5 |
| hooks/lib/change-paths.ts | Create | implementer-5 |

#### Acceptance Criteria
- [ ] `hooks/lib/change-paths.ts` exports path constants used by Phase 6 (single source of truth — prevents path drift).
- [ ] `change-state.ts` implements typed read/write of ChangeState files with atomic-write semantics.
- [ ] `/loom-change list` enumerates all changes with status, conflicts, and supersession flags.
- [ ] `/loom-change status {id}` and `/loom-change diff {id}` work against fixture changes.
- [ ] No `library.yaml` writes from this phase (Phase 8 owns it exclusively).

---

### Phase 6 — Wave 4: /loom-change Mutation Subcommands

**Agent:** implementer-agent
**Objective:** Implement the mutation subcommands and the `--quick` integration that lets `/loom-quick` participate in the change lifecycle without ceremony. Builds on Phase 5's query layer for consistency (per Agentic Workflow recommendation: 5b reads 5a as style reference).
**Dependencies:** Phase 4, Phase 5
**File Ownership:** scripts/loom-change/init.ts, scripts/loom-change/review.ts, scripts/loom-change/approve.ts, scripts/loom-change/run.ts, scripts/loom-change/archive.ts, scripts/loom-change/reject.ts, scripts/loom-change/quick-archive.ts, commands/loom-quick.md, test/loom-change/lifecycle.test.ts, test/loom-change/quick-mode.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-change/init.ts | Create | implementer-6 |
| scripts/loom-change/review.ts | Create | implementer-6 |
| scripts/loom-change/approve.ts | Create | implementer-6 |
| scripts/loom-change/run.ts | Create | implementer-6 |
| scripts/loom-change/archive.ts | Create | implementer-6 |
| scripts/loom-change/reject.ts | Create | implementer-6 |
| scripts/loom-change/quick-archive.ts | Create | implementer-6 |
| commands/loom-quick.md | Modify | implementer-6 |
| test/loom-change/lifecycle.test.ts | Create | implementer-6 |
| test/loom-change/quick-mode.test.ts | Create | implementer-6 |

#### Acceptance Criteria
- [ ] `/loom-change init "fix X"` creates `.loom/changes/chg-{date}-fix-x/proposal.md` populated from schema.
- [ ] `/loom-change review` stamps `reviewedBy/reviewedAt/reviewNotes`; `/loom-change approve` stamps `approvedBy/approvedAt`. Both transitions reject illegal moves with clear error codes.
- [ ] `/loom-change archive` is atomic across multi-domain deltas: either all `affectedSpecs` update successfully or none commit. Failed mid-archive logs to `.plan-execution/ephemeral/changes/{changeId}-rollback.toon` for recovery.
- [ ] `/loom-change archive` detects conflicts: if another in-flight change claims overlapping requirement/scenario IDs, populates `conflicts[]` on both and blocks until resolved.
- [ ] `/loom-change archive` sets `supersededBy` on any in-flight change whose target requirements were removed.
- [ ] `/loom-change reject --reason "..."` records rejection rationale; rejected proposals can be revised via re-`init` against the same directory.
- [ ] `scripts/loom-change/quick-archive.ts` exposes a zero-ceremony path: given a deltas object and rationale, it auto-generates a minimal proposal, stamps `reviewedBy: "loom-quick"` and `approvedBy: "loom-quick"`, runs the standard archive (with the same atomicity, conflict, and supersession checks), and writes a retroactive proposal to `.loom/changes/` for audit. No interactive prompts.
- [ ] `commands/loom-quick.md` is updated so that when `.loom/wiki/pages/contract-*.md` files exist in the project, `/loom-quick` invokes `quick-archive.ts` after convergence passes — keeping contract pages coherent without forcing the full init→review→approve flow. When no contract pages exist, `/loom-quick` behavior is unchanged.
- [ ] Round-trip test: init → review → approve → run → archive mutates a contract page; `contentChecksum` is updated; History entry is appended; wiki index is refreshed.
- [ ] Quick-mode test: a `/loom-quick`-style invocation against a project with contract pages produces a retroactive `chg-{date}-*` directory, updates the affected contract page, passes the drift validator (no false manual-edit flag), and skips no atomicity or conflict checks.
- [ ] `bunx vitest run test/loom-change/lifecycle.test.ts test/loom-change/quick-mode.test.ts` exits 0 covering full state machine + quick path including reject, supersession, conflict detection, multi-domain rollback, and quick-archive coherence.

---

### Phase 7 — Wave 5: Change-Proposal & Contract-Page Validators

**Agent:** implementer-agent
**Objective:** Add structural validators for change proposals and contract-page body extensions, plus a manual-edit detection mechanism using checksums. Augments (does not replace) the existing wiki lint rules.
**Dependencies:** Phase 4, Phase 6
**File Ownership:** hooks/lib/spec-validators/change-proposal.ts, hooks/lib/spec-validators/contract-page.ts, hooks/lib/spec-validators/contract-page-drift.ts, test/change-validator.test.ts, test/contract-page-validator.test.ts, test/contract-page-drift.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/spec-validators/change-proposal.ts | Create | implementer-7 |
| hooks/lib/spec-validators/contract-page.ts | Create | implementer-7 |
| hooks/lib/spec-validators/contract-page-drift.ts | Create | implementer-7 |
| test/change-validator.test.ts | Create | implementer-7 |
| test/contract-page-validator.test.ts | Create | implementer-7 |
| test/contract-page-drift.test.ts | Create | implementer-7 |

#### Acceptance Criteria
- [ ] Change-proposal validator enforces: scope.included and scope.excluded both non-empty; every `affectedSpec` resolves to a `contract-{domain}` page in the wiki index; every `modifiedRequirements[].id` and `removedRequirements[]` entry exists in the target contract page; `breakingChange: true` requires `migrationNote`; `addedRequirements[]` does not collide with existing R-NN IDs.
- [ ] Contract-page validator enforces: required body sections (Purpose, Requirements, Scenarios, Entities, Out of Scope, History) all present and in order; R-NN uniqueness; History chronology; `sourceChanges[]` matches History entries; `replacedBy` (if set) resolves to an existing `contract-*` page.
- [ ] Drift validator: recomputes `contentChecksum` from current body, compares to stored value; emits blocking error on mismatch (manual edit detection). Distinct from wiki `staleness` (freshness drift). Includes `/loom-change recover {changeId}` mechanism in test scope to re-apply missing deltas.
- [ ] Validators integrate with the existing wiki lint pipeline — running `loom-wiki lint` surfaces contract-page validator findings alongside standard wiki lint output.
- [ ] `bunx vitest run test/change-validator.test.ts test/contract-page-validator.test.ts test/contract-page-drift.test.ts` exits 0 with ≥18 combined cases.

---

### Phase 8 — Wave 6: Documentation, Migration Guide, Fixture, Catalog

**Agent:** wiring-agent
**Objective:** Documentation, end-to-end fixture, library.yaml catalog updates. Sole owner of `library.yaml`.
**Dependencies:** Phase 3, Phase 6, Phase 7
**File Ownership:** README.md, docs/scenarios-and-changes.md, docs/scenarios-authoring-template.md (extend from Phase 0), test-fixtures/spec-upgrades-e2e/, library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| README.md | Modify | wiring-agent |
| docs/scenarios-and-changes.md | Create | wiring-agent |
| docs/scenarios-authoring-template.md | Modify | wiring-agent |
| test-fixtures/spec-upgrades-e2e/ | Create | wiring-agent |
| library.yaml | Modify | wiring-agent |

#### Acceptance Criteria
- [ ] README documents the scenarios layer with a Given/When/Then example and the change lifecycle in one paragraph each.
- [ ] `docs/scenarios-and-changes.md` walks through greenfield (roadmap → plan w/ scenarios → execute → materialize into `contract-*` wiki pages) and brownfield (existing `contract-*` page → change proposal → execute → archive) end-to-end. Also documents the `/loom-quick` quick-archive path.
- [ ] `test-fixtures/spec-upgrades-e2e/` contains: a roadmap with scenarios, a plan with scenarios, an `EntityDomainPartition` manifest, materialized `contract-*` wiki pages, one archived change, one in-flight change, one rejected change, one `/loom-quick`-originated retroactive change.
- [ ] `library.yaml` includes catalog entries for `/loom-change` and any new commands; `node scripts/validate-library-catalog.js` passes.
- [ ] End-to-end test runs the full pipeline against the fixture and matches a golden final-state file byte-for-byte.

## Verification Commands

```bash
bunx tsc --noEmit
bunx vitest run
bunx eslint hooks/ scripts/
node scripts/validate-library-catalog.js
```

## Milestones

### M-01: Scenarios Layer (Independently Shippable)
**Phases:** 0, 1, 2, 3
**Acceptance:** Plans and roadmaps support optional Scenarios sections; validators enforce well-formedness; builder agents emit scenarios; convergence-planner ≥2× target density on taskboard fixture; e2e-test-writer derives stories from scenarios. M-01 ships with its own release notes BEFORE M-02 begins.

### M-02: Change Lifecycle over Contract Pages
**Phases:** 4, 5, 6, 7, 8
**Depends on:** M-01 Integration Gate passing; PLAN-wiki-flows-contracts Wave 1 MVP shipped (provides `contract-*` page category).
**Acceptance:** `/loom-change` command operates full lifecycle including reject, supersession, conflict detection, and multi-domain atomic archive; `contract-*` wiki pages materialize from approved roadmap+plan via explicit partition manifest; manual edits detected via checksum and surfaced through wiki lint; `/loom-quick` integrates via quick-archive; end-to-end fixture passes.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scenarios drift from flat acceptance criteria | medium | Validator: every observable-output criterion must back to ≥1 scenario; flag drift as warning |
| Contract pages and roadmap content drift | high | Materializer is only writer for greenfield; archived changes (and quick-archive) are only writers thereafter; manual edits blocked via `contentChecksum` drift validator (Phase 7), surfaced through wiki lint |
| Change-proposal lifecycle adds ceremony for small work | medium | Lifecycle opt-in; projects without `contract-*` pages continue using roadmap+plan unchanged; `/loom-quick` integrates via `quick-archive.ts` (Phase 6) so small work in projects WITH contract pages stays zero-ceremony but still coherent |
| Two simultaneous changes mutate the same requirement | high | Archive command populates `conflicts[]` on both and blocks until one is rejected or rebased |
| RFC 2119 phrasing unfamiliar to existing users | low | `docs/scenarios-authoring-template.md` (ships in Phase 0) includes phrasing cheatsheet |
| Scenario tag conventions fragment | low | Tag enum locked in `scenario.schema.md`; project-local extensions via `scenarios.local.yaml` |
| Phase 4 partitioning is heuristic | high | Eliminated by requiring explicit `EntityDomainPartition` manifest as Phase 4 input |
| PLAN-wiki-flows-contracts Wave 1 not yet shipped when M-02 starts | medium | M-02 explicitly depends on wiki-flows-contracts Wave 1 MVP; coordinate sequencing across both plans |

## Acceptance Criteria (Final)

- [ ] A `planVersion: 2` plan can include scenarios under any phase and pass validation.
- [ ] A roadmap feature can include scenarios that propagate (via plan-builder-agent) into phase scenarios.
- [ ] `convergence-planner-agent` produces ≥2× target density vs. acceptance-criteria-only seeding on the taskboard fixture.
- [ ] M-01 ships independently with its own release notes.
- [ ] `/loom-change init` → `archive` round-trip mutates a `contract-*` wiki page deterministically and refreshes the wiki index.
- [ ] Multi-domain atomic archive: a failure mid-archive rolls back all `affectedSpecs` to pre-archive state.
- [ ] Conflict detection blocks two in-flight changes targeting overlapping requirement IDs.
- [ ] Manual edits to a `contract-*` page are detected by checksum drift and surfaced as a blocking finding by `loom-wiki lint`.
- [ ] Re-running materializer against unchanged inputs is byte-identical and produces no wiki-index diff.
- [ ] All new schemas referenced from at least one builder or validator agent.
- [ ] One-substrate property holds: living specs and `contract-*` wiki pages are the same artifact; no `.loom/specs/` directory is created.
- [ ] OpenSpec-parity statement holds: scenarios are first-class testable units with enforcement (not just docs) AND changes archive into per-domain `contract-*` wiki pages.
- [ ] `/loom-quick` against a project with `contract-*` pages produces a retroactive change proposal and updated contract page — zero-ceremony for the user, full coherence for the system.

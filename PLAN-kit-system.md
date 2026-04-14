---
planVersion: 1
name: "Loom Kit System + Data Engineering Kit"
status: draft
created: 2026-04-14
lastReviewed: null
roadmapRef: null
totalPhases: 6
totalWaves: 4
---

# Plan: Loom Kit System + Data Engineering Kit

## Overview

Extend Loom with a kit abstraction — curated groups of agents, commands, and protocols installable as a unit — then build the first kit (data engineering) to validate the design. The kit system adds insertion-point agents, gate primitives, colon-subcommand dispatch, and kit metadata to the existing catalog. Derived from a structured debate that evaluated three approaches and converged on catalog-tags-with-controlled-extension-points.

## Tech Stack

- Agent prompts: Markdown (.md files)
- Protocol schemas: Markdown with TOON examples
- Catalog: YAML (library.yaml)
- Project config: TOML (orchestration.toml)
- Hooks: TypeScript (Node.js)
- Tests: Vitest
- Package manager: npm (bun preferred when available)

## Schema / Type Definitions

### Kit Entry (in library.yaml kits section)

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | required, unique across kits |
| description | string | required, max 200 chars |
| includes | string[] | required, references library item names |
| command | string | optional, kit command file name |
| suggestedConfig | string | optional, path to orchestration.toml fragment |

### Insertion Point (in orchestration.toml)

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | required, kit-prefixed |
| phase | enum | pre-scope, post-scope, pre-execute, post-execute, pre-verify, post-verify |
| after | string | optional, agent name for ordering |
| before | string | optional, agent name for ordering |

### Gate Primitive (AgentResult extension)

| Field | Type | Constraints |
|-------|------|-------------|
| gate | enum | null, pass, fail, warn |
| gateReason | string | required when gate is not null |
| failAction | enum | halt (default), warn, retry |

## Execution Phases

### Phase 0: Kit Foundation Schemas (Wave 0 — Contracts)

**Wave:** 0
**Agent:** contracts-agent
**Description:** Define the kit metadata format, insertion point enum, gate primitive, and naming conventions.

**Deliverables:**
- `agents/protocols/kit.schema.md` — kit manifest format, insertion point definitions, naming conventions
- `agents/protocols/agent-result.schema.md` — extended with gate, gateReason, failAction fields
- `agents/protocols/orchestration-config.schema.md` — extended with kit agent and gate registration

**File Ownership:** `agents/protocols/kit.schema.md`, `agents/protocols/agent-result.schema.md`, `agents/protocols/orchestration-config.schema.md`

**Acceptance Criteria:**
- [ ] kit.schema.md defines the kits section format for library.yaml with all fields from Schema above
- [ ] kit.schema.md enumerates exactly 6 insertion points: pre-scope, post-scope, pre-execute, post-execute, pre-verify, post-verify
- [ ] kit.schema.md documents kit-prefixed naming convention (e.g., data-validate, ml-train) with enforcement rules
- [ ] agent-result.schema.md includes gate, gateReason, failAction fields with documented semantics
- [ ] failAction defaults to halt when gate is fail and no explicit failAction is set
- [ ] orchestration-config.schema.md shows kit agent registration under [[kit.data.agents]] with insertion point and gate examples
- [ ] All schemas use TOON format per project conventions

### Phase 1: Library Command Kit Support (Wave 1)

**Wave:** 1
**Agent:** implementer-agent
**Description:** Extend `/loom-library` to install, list, and remove kits as units.

**Deliverables:**
- `commands/loom-library.md` — updated with kit-aware use, list, remove behavior
- `skills/library.yaml` — updated with empty kits section

**File Ownership:** `commands/loom-library.md`, `skills/library.yaml`

**Acceptance Criteria:**
- [ ] `/loom-library use <kit-name>` installs all items in the kit's includes list
- [ ] `/loom-library list` shows a "Kits" section grouping installed kit items
- [ ] `/loom-library remove <kit-name>` removes all kit items with dependency warning if shared
- [ ] `/loom-library list --kits` shows only kit summaries with install status
- [ ] library.yaml has a valid empty kits section ready for entries
- [ ] Existing library commands (use, sync, update for individual items) work unchanged

### Phase 2: Colon-Subcommand Dispatch (Wave 1)

**Wave:** 1
**Agent:** implementer-agent
**Description:** Route `loom <kit>:<subcommand>` to kit command files via the root loom.md dispatcher.

**Deliverables:**
- `commands/loom.md` — updated dispatch logic for colon-delimited kit subcommands
- `skills/loom-quick-routing.md` — updated routing table with kit-aware patterns

**File Ownership:** `commands/loom.md` (dispatch section only), `skills/loom-quick-routing.md`

**Acceptance Criteria:**
- [ ] `loom data:validate` routes to the data kit's command file with validate as the subcommand
- [ ] `loom help` includes a "Kit Commands" section showing installed kits and their subcommands
- [ ] Unknown kit prefix shows helpful error with install instructions
- [ ] Core subcommands (init, auto, quick, pause, resume, etc.) work unchanged
- [ ] `loom <kit>:` with no subcommand shows that kit's available subcommands

### Phase 3: Executor Insertion Points + Gates (Wave 2)

**Wave:** 2
**Agent:** implementer-agent
**Description:** Update plan execution to discover kit agents at insertion points and evaluate gate returns.

**Deliverables:**
- `commands/loom-plan.md` — execute subcommand updated with insertion-point discovery and gate evaluation
- `commands/loom.md` — auto subcommand updated with gate evaluation at quality gate

**File Ownership:** `commands/loom-plan.md` (execute section), `commands/loom.md` (auto quality gate section)

**Acceptance Criteria:**
- [ ] Before each core phase, executor reads orchestration.toml for kit agents at that insertion point
- [ ] Kit agents within an insertion point are topologically sorted by after/before fields
- [ ] Kit agents returning gate: fail with failAction: halt stop the pipeline with structured error
- [ ] Kit agents returning gate: warn log the warning in wave summary and continue
- [ ] Kit agents returning gate: pass or no gate field proceed normally
- [ ] No kit agents registered means existing behavior unchanged (zero overhead path)
- [ ] Gate evaluation results appear in the wave summary and status line

### Phase 4: Data Engineering Agents (Wave 3)

**Wave:** 3
**Agent:** implementer-agent (5 parallel agents)
**Description:** Create the 5 data engineering domain agents.

**Deliverables:**
- `agents/data-schema-reviewer.md` — reviews schemas for normalization, indexing, migration safety, idempotency
- `agents/data-test-generator.md` — generates data-specific tests: schema validation, row counts, null checks, freshness
- `agents/data-pipeline-agent.md` — specialized implementer for pipeline code (dbt, Dagster, Airflow, SQL, Bauplan)
- `agents/data-lineage-tracker.md` — traces data flow, documents source-to-target mappings in wiki
- `agents/data-quality-gate.md` — gate agent validating data contracts (schema conformance, nullability, type coercion)

**File Ownership:** `agents/data-schema-reviewer.md`, `agents/data-test-generator.md`, `agents/data-pipeline-agent.md`, `agents/data-lineage-tracker.md`, `agents/data-quality-gate.md`

**Acceptance Criteria:**
- [ ] Each agent follows standard prompt format (role, instructions, output as AgentResult envelope)
- [ ] data-schema-reviewer registers at insertion point pre-verify in the review pipeline
- [ ] data-test-generator registers at post-criteria in the testing pipeline
- [ ] data-pipeline-agent has the same interface as implementer-agent (file ownership, task objective, contracts input)
- [ ] data-lineage-tracker registers at post-execute and writes wiki pages to .loom/wiki/
- [ ] data-quality-gate returns gate: pass/fail with failAction: halt and structured gateReason
- [ ] All agents use kit-prefixed names (data-*) per naming convention from kit.schema.md
- [ ] Agent prompts reference user's preferred stack (dbt, Dagster, Airflow, BigQuery, Bauplan) as supported targets, not hardcoded to one tool

### Phase 5: Data Engineering Command + Catalog Entry (Wave 3)

**Wave:** 3
**Agent:** implementer-agent
**Description:** Create the `/loom data:` command and register the complete kit in library.yaml.

**Deliverables:**
- `commands/loom-data.md` — data engineering command with subcommands: profile, validate, lineage, test
- `skills/library.yaml` — updated with data-engineering kit entry referencing all 5 agents + 1 command

**File Ownership:** `commands/loom-data.md`, `skills/library.yaml`

**Acceptance Criteria:**
- [ ] loom data:profile scans a project for data sources, schemas, and pipeline definitions
- [ ] loom data:validate runs data-quality-gate against the current codebase
- [ ] loom data:lineage spawns data-lineage-tracker and displays source-to-target flow
- [ ] loom data:test spawns data-test-generator for data-specific test creation
- [ ] library.yaml kits section contains data-engineering entry with all 6 items in includes
- [ ] `/loom-library use data-engineering` installs all kit items as a unit
- [ ] Command file has frontmatter description showing subcommands for autocomplete
- [ ] Command file includes suggested orchestration.toml fragment in documentation

## Verification Commands

```bash
# Protocol tests
cd test/protocol && npm install && npx vitest run

# Hook tests
cd hooks && npm install && npx vitest run
```

## Notes

- Derived from a 3-round adversarial debate. Key design decisions:
  - Kits attach to core-defined insertion points, not arbitrary new phases
  - Colon-subcommands (loom data:validate) instead of separate top-level commands
  - Gate primitives extend AgentResult with pass/fail/warn + failAction enum
  - Kit-prefixed naming enforced at install time
- Phase 0 is the critical foundation — all other phases depend on it
- Phases 1+2 execute in parallel (Wave 1) — different files
- Phases 4+5 execute in parallel (Wave 3) — different files
- The data-engineering kit validates the kit system — if this works, ML/security/DevOps kits follow the same pattern
- Gate failAction is halt by default because Loom builds code (universal quality gates), not orchestrates pipelines

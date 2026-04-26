---
planVersion: 1
name: "Loom Kit System + Data Engineering Kit"
status: reviewed
created: 2026-04-14
lastReviewed: 2026-04-15
roadmapRef: null
totalPhases: 7
totalWaves: 5
---

# Plan: Loom Kit System + Data Engineering Kit

## Overview

Extend Loom with a kit abstraction — curated groups of agents, commands, and protocols installable as a unit — then build the first kit (data engineering) to validate the design. The kit system adds insertion-point agents, gate primitives, colon-subcommand dispatch, and kit metadata to the existing catalog.

**Audience:** Kits deepen value for existing Loom SWE users by adding domain-specific quality gates and code generation to the pipelines they already use. Data engineering is the first kit because it's the most requested domain extension and validates all three kit mechanisms (insertion points, gates, colon-dispatch). This does not reposition Loom toward data practitioners — it helps SWE teams that write pipeline code get better review, testing, and lineage tracking through Loom's existing workflows.

**Relationship to deng-toolkit:** The `deng-toolkit` marketplace plugin provides standalone catalog tooling (DB metadata sync, ontology building, stored procedure analysis). The `loom data:` kit integrates into Loom's quality gate pipeline — insertion points, gates, code review, wiki lineage. They are complementary, not competing: deng-toolkit manages the catalog, the data kit uses it during pipeline code generation and review.

Derived from a 3-round adversarial debate that evaluated three approaches and converged on catalog-tags-with-controlled-extension-points.

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
| version | string | required, semver (e.g., 1.0.0) |
| minLoomVersion | integer | optional, minimum catalog_version required |
| includes | string[] | required, references library item names |
| command | string | optional, kit command file name |
| suggestedConfig | string | optional, path to orchestration.toml fragment |

### Insertion Point (in orchestration.toml)

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | required, kit-prefixed |
| insertionPoint | enum | pre-scope, post-scope, pre-execute, post-execute, pre-verify, post-verify |
| after | string | optional, agent name for ordering |
| before | string | optional, agent name for ordering |
| condition | string | optional, file ownership glob for conditional activation (e.g., `**/dbt/**`) |

Note: Kit agents use the `insertionPoint` field (6-point enum). Existing app-specific agents continue to use the `phase` field (post-contracts, post-implementer, post-wiring, post-criteria, etc.). These are separate axes — `insertionPoint` is for kit agents registered under `[[kit.<name>.agents]]`, `phase` is for project-specific agents under `[[execution.agents]]` and `[[testing.agents]]`. Phase 0 must document this distinction clearly with a reconciliation table.

### Gate Primitive (AgentResult extension)

| Field | Type | Constraints |
|-------|------|-------------|
| gate | enum | null, pass, fail, warn |
| gateReason | string | required when gate is not null, structured with failing check references |
| failAction | enum | halt (default), warn, retry |
| retryMax | integer | optional, default 3, only used when failAction is retry |

Gate UX contract:
- **Running state:** Display gate agent name, insertion point, elapsed time
- **gate:fail + halt:** Display gateReason, name the insertion point and gate agent, offer actions: retry / skip / abort
- **gate:warn:** Inline non-blocking notice in pipeline output. Summary count of warnings at pipeline completion.
- **gate:fail + retry:** Display retry attempt N of retryMax. On exhaustion, fall through to halt behavior with "retries exhausted" note.
- **Malformed gate response:** Treat as gate:warn with gateReason "malformed gate response from {agent}" — never halt on bad data.
- **Agent timeout:** Treat as gate:warn with gateReason "gate agent timed out" — continue pipeline.

Relationship to existing blocker semantics: `gate` is the kit-agent mechanism. `outputRole: blocker` and `issues[]{severity: blocking}` remain the project-agent mechanism. Both produce the same user-facing BLOCKED screen. gate:fail with failAction:halt is equivalent to outputRole:blocker returning a blocking finding — same UX, different trigger path. Phase 0 must document this equivalence in agent-result.schema.md.

### Data Engineering Agent Contracts (pre-defined for Wave 3 decoupling)

All 5 data engineering agents use kit-prefixed names. File paths, insertion points, and interface contracts are locked here so Phases 4 and 5 can execute in parallel.

| Agent | File | Insertion Point | Role | Template |
|-------|------|----------------|------|----------|
| data-schema-reviewer | agents/data-schema-reviewer.md | pre-verify | reviewer | database-schema-reviewer.md |
| data-test-generator | agents/data-test-generator.md | post-verify | producer | unit-test-agent.md |
| data-pipeline-agent | agents/data-pipeline-agent.md | (implementer) | producer | implementer-agent.md |
| data-lineage-tracker | agents/data-lineage-tracker.md | post-execute | producer | wiki-maintainer-agent.md |
| data-quality-gate | agents/data-quality-gate.md | pre-execute | gate | contracts-agent.md |

Supported targets (all agents): dbt, Dagster, Airflow, BigQuery, Bauplan, raw SQL. Agents detect the user's stack from project files and adapt — they are not hardcoded to one tool.

## Execution Phases

### Phase 0: Kit Foundation Schemas (Wave 0 — Contracts)

**Wave:** 0
**Agent:** contracts-agent
**Description:** Define the kit metadata format, insertion point enum, gate primitive, naming conventions, and data engineering agent contracts. Include a spike: one stub agent + sample kit entry to validate round-trip.

**Deliverables:**
- `agents/protocols/kit.schema.md` — kit manifest format, insertion point definitions, naming conventions, data-eng agent contracts, sample kit entry
- `agents/protocols/agent-result.schema.md` — extended with gate, gateReason, failAction, retryMax fields + blocker equivalence docs
- `agents/protocols/orchestration-config.schema.md` — extended with `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]` sections + reconciliation table mapping insertionPoint vs phase

**File Ownership:** `agents/protocols/kit.schema.md`, `agents/protocols/agent-result.schema.md`, `agents/protocols/orchestration-config.schema.md`

**Acceptance Criteria:**
- [ ] kit.schema.md defines the kits section format for library.yaml with all fields from Schema above including version and minLoomVersion
- [ ] kit.schema.md enumerates exactly 6 insertion points: pre-scope, post-scope, pre-execute, post-execute, pre-verify, post-verify
- [ ] kit.schema.md documents kit-prefixed naming convention (e.g., data-validate, ml-train) with enforcement rules
- [ ] kit.schema.md includes a reconciliation table mapping the 6 kit insertion points to the existing phase vocabulary (post-contracts→post-execute, post-wiring→post-execute, post-criteria→post-verify, etc.)
- [ ] kit.schema.md pre-defines all 5 data engineering agent names, file paths, insertion points, and interface contracts per the Schema section above
- [ ] kit.schema.md includes a complete sample kit entry in TOON format for the data-engineering kit
- [ ] agent-result.schema.md includes gate, gateReason, failAction, retryMax fields with documented semantics
- [ ] agent-result.schema.md documents the equivalence between gate:fail+halt and outputRole:blocker
- [ ] agent-result.schema.md specifies malformed-gate and timeout handling (both degrade to warn, never halt)
- [ ] orchestration-config.schema.md shows kit agent registration under `[[kit.data.agents]]` using `insertionPoint` field (distinct from existing `phase` field)
- [ ] orchestration-config.schema.md includes a `condition` field example for conditional kit agent activation
- [ ] All schemas use TOON format per project conventions

### Phase 1: Library Command Kit Support (Wave 1)

**Wave:** 1
**Agent:** implementer-agent
**Description:** Extend `/loom-library` to install, list, and remove kits as units. Add post-install activation guidance.

**Deliverables:**
- `commands/loom-library.md` — updated with kit-aware use, list, remove behavior
- `skills/library.yaml` — updated with empty kits section + placeholder comment for data-engineering

**File Ownership:** `commands/loom-library.md`, `skills/library.yaml`

**Acceptance Criteria:**
- [ ] `/loom-library use <kit-name>` installs all items in the kit's includes list as a transactional unit, showing progress: `[1/6] Installing data-schema-reviewer...`
- [ ] After kit install completes, display a kit-level summary: "Installed data-engineering kit: 6 items (5 agents, 1 command)" + activation guidance: "Add to your project's orchestration.toml to activate kit agents in pipelines"
- [ ] `/loom-library list` shows a "Kits" section with collapsed view (kit name + item count + description)
- [ ] `/loom-library list --kits` shows only kit summaries with install status
- [ ] `/loom-library remove <kit-name>` removes all kit items; on partial failure, reports which items removed vs failed, leaves install-state.toon consistent with actual disk state, suggests `--force` to retry
- [ ] minLoomVersion check: if kit requires a higher catalog_version than installed, warn before install
- [ ] library.yaml has a valid empty kits section ready for entries
- [ ] Existing library commands (use, sync, update for individual items) work unchanged

### Phase 2: Colon-Subcommand Dispatch + All loom.md Edits (Wave 1)

**Wave:** 1
**Agent:** implementer-agent
**Description:** Route `loom <kit>:<subcommand>` to kit command files. Also pre-wire the quality gate extension in loom.md so Phase 3 only needs to edit loom-plan.md.

This phase owns ALL loom.md edits for the entire plan. No other phase touches loom.md.

**Deliverables:**
- `commands/loom.md` — dispatch block (lines 11-27), reference help section (lines 31-458), Step 6 Pipeline Quality Gate (lines 1315-1358)
- `skills/loom-quick-routing.md` — colon-subcommand exclusion pattern

**File Ownership:** `commands/loom.md`, `skills/loom-quick-routing.md`

**Acceptance Criteria:**
- [ ] Dispatch block: if first argument matches `<word>:<word>`, parse as kit:subcommand, look up kit's command file from install-state.toon, delegate
- [ ] `loom help` includes a "Kit Commands" section (visually separated, before advanced commands) showing installed kits with subcommand lists
- [ ] When no kits installed, help shows: "Kit Commands: none installed. Run /loom-library list --kits to see available kits."
- [ ] Unknown kit prefix shows: "Kit '<name>' not installed. Run /loom-library use <name> to install."
- [ ] `loom <kit>:` with no subcommand shows that kit's available subcommands
- [ ] `loom <kit>:<unknown>` shows: "Unknown subcommand: <unknown>" + valid subcommand list + did-you-mean if edit distance <= 2
- [ ] Core subcommands (init, auto, quick, pause, resume, etc.) work unchanged
- [ ] Step 6 Pipeline Quality Gate decision matrix: add `gateStatus` variable parsed from kit agent AgentResults, add two rows: gate:fail→FIX-AND-RECHECK (if failAction != halt) or ESCALATE (if halt), gate:warn→log and PROCEED
- [ ] loom-quick-routing.md has an exclusion for `<word>:<word>` patterns so they're not intercepted as quick tasks

### Phase 3: Executor Insertion Points + Gates (Wave 2)

**Wave:** 2
**Agent:** implementer-agent
**Description:** Update plan execution to discover kit agents at insertion points and evaluate gate returns. This phase only edits loom-plan.md — loom.md quality gate changes were handled in Phase 2.

**Deliverables:**
- `commands/loom-plan.md` — Project-Specific Agents section (line 425) extended with kit insertion point discovery; Automated Quality Gate section (line 751) extended with gate evaluation

**File Ownership:** `commands/loom-plan.md` (execute subcommand sections only)

**Agent context anchors** (exact insertion locations):
- Insert kit insertion-point discovery immediately after line 436 in the Project-Specific Agents section, following the existing `post-wiring` bullet and before `### Instructions`
- Insert gate evaluation logic into the Automated Quality Gate section (line 751), extending the PROCEED/RETRY/ESCALATE conditions

**Acceptance Criteria:**
- [ ] Project-Specific Agents section lists the 6 kit insertion points alongside the existing 4 execution phases, with a note that kit agents use `insertionPoint` field and project agents use `phase` field
- [ ] Before each core phase boundary, executor reads orchestration.toml for `[[kit.<name>.agents]]` entries at that insertion point
- [ ] Kit agents within an insertion point are topologically sorted by after/before fields; cycle detected → log error and halt
- [ ] Conditional activation: if `condition` glob is set, only spawn kit agent when file ownership matches
- [ ] Kit agents returning gate:fail with failAction:halt stop the wave with structured error showing: gate agent name, insertion point name, gateReason, available actions (retry/skip/abort)
- [ ] Kit agents returning gate:warn log the warning inline and continue; summary count at wave completion
- [ ] Kit agents returning gate:fail with failAction:retry → retry up to retryMax times with visible retry indicator; on exhaustion, fall through to halt
- [ ] Malformed gate TOON or agent timeout → treat as gate:warn, never halt
- [ ] Kit agents returning gate:pass or no gate field proceed normally
- [ ] No kit agents registered means existing behavior unchanged (zero overhead path — no orchestration.toml read if no kit sections exist)
- [ ] Gate evaluation results appear in wave-N-summary.toon and status line

### Phase 4: Data Engineering Agents (Wave 3)

**Wave:** 3
**Agent:** implementer-agent (5 parallel sub-agents, one per file)
**Description:** Create the 5 data engineering domain agents. Names, file paths, insertion points, and templates are locked in Phase 0's kit.schema.md.

**Deliverables:**
- `agents/data-schema-reviewer.md` — reviews schemas for normalization, indexing, migration safety, idempotency (template: database-schema-reviewer.md)
- `agents/data-test-generator.md` — generates data-specific tests: schema validation, row counts, null checks, freshness (template: unit-test-agent.md)
- `agents/data-pipeline-agent.md` — specialized implementer for pipeline code, interface-compatible with implementer-agent.md (template: implementer-agent.md)
- `agents/data-lineage-tracker.md` — traces data flow, documents source-to-target mappings in wiki (template: wiki-maintainer-agent.md)
- `agents/data-quality-gate.md` — gate agent validating data contracts, returns gate:pass/fail (template: contracts-agent.md)

**File Ownership:** `agents/data-schema-reviewer.md`, `agents/data-test-generator.md`, `agents/data-pipeline-agent.md`, `agents/data-lineage-tracker.md`, `agents/data-quality-gate.md`

**Acceptance Criteria:**
- [ ] Each agent follows standard prompt format (role, instructions, output as AgentResult envelope) matching its declared template
- [ ] data-schema-reviewer registers at insertionPoint: pre-verify; returns standard AgentResult (reviewer, no gate)
- [ ] data-test-generator registers at insertionPoint: post-verify; produces test files
- [ ] data-pipeline-agent input section matches implementer-agent.md exactly (task objective, acceptance criteria, file ownership, contract paths, rolling context, tech stack); adds pipeline-specific guidance (idempotency, incremental patterns)
- [ ] data-lineage-tracker registers at insertionPoint: post-execute; writes wiki pages to .loom/wiki/lineage/ with source-to-target mappings
- [ ] data-quality-gate registers at insertionPoint: pre-execute; returns gate:pass/fail with failAction:halt and structured gateReason referencing specific failing checks; quality dimensions: completeness, uniqueness, validity, freshness, referential integrity
- [ ] All agents use kit-prefixed names (data-*) per naming convention from kit.schema.md
- [ ] All agent prompts list supported targets (dbt, Dagster, Airflow, BigQuery, Bauplan) and detect user's stack from project files

### Phase 5: Data Engineering Command + Catalog Entry (Wave 3)

**Wave:** 3
**Agent:** implementer-agent
**Description:** Create the `/loom-data:` command and register the complete kit in library.yaml. Agent names and paths are known from Phase 0 contracts — no dependency on Phase 4 output.

**Deliverables:**
- `commands/loom-data.md` — data engineering command with subcommands: profile, validate, lineage, test
- `skills/library.yaml` — updated with data-engineering kit entry referencing all 5 agents + 1 command

**File Ownership:** `commands/loom-data.md`, `skills/library.yaml`

**Acceptance Criteria:**
- [ ] loom data:profile scans a project for data sources, schemas, and pipeline definitions
- [ ] loom data:validate runs data-quality-gate against the current codebase
- [ ] loom data:lineage spawns data-lineage-tracker and displays source-to-target flow
- [ ] loom data:test spawns data-test-generator for data-specific test creation
- [ ] library.yaml kits section contains data-engineering entry with version: 1.0.0, all 6 items in includes
- [ ] `/loom-library use data-engineering` installs all kit items as a unit
- [ ] Command file has frontmatter description showing subcommands for autocomplete
- [ ] Command file includes suggested orchestration.toml fragment showing how to register kit agents at their insertion points
- [ ] Agent filenames in library.yaml includes list match exactly: data-schema-reviewer, data-test-generator, data-pipeline-agent, data-lineage-tracker, data-quality-gate, loom-data (command)

### Phase 6: Wiring + Integration Verification (Wave 4)

**Wave:** 4
**Agent:** wiring-agent
**Description:** Post-wave integration pass. Verify all cross-phase references are consistent, library.yaml kit entry matches actual agent files, dispatch routes correctly, checksums updated.

**Deliverables:**
- `checksums.sha256` — regenerated for all modified files
- `skills/library.yaml` — verified kit entry includes list matches actual agent file names from Phase 4
- Integration test: `loom data:` dispatch routes to loom-data.md correctly

**File Ownership:** `checksums.sha256`, `skills/library.yaml` (verification only — modify only if Phase 4/5 naming drifted)

**Acceptance Criteria:**
- [ ] All 5 data agent files exist at declared paths in agents/
- [ ] library.yaml kit entry includes list matches actual agent files
- [ ] loom.md dispatch routes `loom data:<subcommand>` to commands/loom-data.md
- [ ] loom-plan.md reads kit insertion points from orchestration.toml correctly
- [ ] agent-result.schema.md gate fields are referenced consistently across loom-plan.md and loom.md
- [ ] checksums.sha256 regenerated for all files modified in this plan
- [ ] All existing tests pass (protocol tests + hook tests)

## Verification Commands

```bash
# Protocol tests
cd test/protocol && npm install && npx vitest run

# Hook tests
cd hooks && npm install && npx vitest run
```

## Notes

- Derived from a 3-round adversarial debate + 6-agent parallel review. Key design decisions:
  - Kits are catalog metadata groups, not architecture (one repo, one catalog)
  - Kit agents use `insertionPoint` field (6-point enum); project agents keep `phase` field — separate axes, documented reconciliation
  - Gate primitives extend AgentResult with pass/fail/warn + failAction enum; malformed/timeout → warn, never halt
  - Colon-subcommands (loom data:validate) instead of separate top-level commands
  - Kit-prefixed naming enforced at install time
  - All data-eng agent names locked in Phase 0 to decouple Phases 4+5
- loom.md ownership consolidated in Phase 2 — no other phase edits this file (resolves the cross-wave contamination risk flagged by 3 review agents)
- Phase 3 gets exact line anchors for surgical loom-plan.md edits
- Phase 6 (wiring pass) verifies cross-phase consistency before declaring done
- The data-engineering kit validates the kit system — if this works, ML/security/DevOps kits follow the same pattern

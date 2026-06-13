---
roadmapVersion: 1
name: "Loom Kit Upgrade — Native Skills as First-Class Resource"
status: approved
created: 2026-06-12
lastReviewed: 2026-06-12
targetDate: null
totalFeatures: 4
totalMilestones: 2
---

# Roadmap: Loom Kit Upgrade — Native Skills as First-Class Resource

## Vision

Loom's kit/library system today bundles agents, prompts, and "skills" — but the items called "skills" in `skills/library.yaml` are actually inter-agent protocol files (AgentResult schema, state.toon schema), not Claude Code's native skill primitive (`.claude/skills/<name>/SKILL.md` with auto-activating `triggers:` frontmatter). This gap means domain conventions duplicate across agents (dbt naming lives in both `data-pipeline-agent.md` and `data-test-generator.md`) and Loom's positioning vs Wire-style fixed-methodology frameworks is invisible because the platform/extension story is fragmented across the README and absent from CLAUDE.md. This upgrade promotes Claude Code native skills to a first-class kit resource, ships `python-conventions` as the demonstrable sample, makes extensibility load-bearing in CLAUDE.md, and seeds an optional `deliverableId?` field for a future per-deliverable approval workflow.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Schema parity | `schema-versions.toon currentVersion` and migrator `CURRENT_VERSION` agree at 4 | `bun test test/protocol/schema-upgrade-v3.test.ts` passes |
| Migration idempotency | v4 input through `migrateToLatest()` returns identical output | golden-file test in `test/library-catalog-v3-to-v4.test.ts` passes |
| Chained walk | v2 → v3 → v4 produces structurally equivalent output to a clean v4 file | `/loom-upgrade --project --from-version library-catalog=2 --to-version library-catalog=4` succeeds |
| Skill auto-activation | `python-conventions` SKILL.md fires on `**/*.py` files; does not fire on `.ts` files | Claude Code skill indicator visible in scratch project |
| Backward compatibility | Existing `data-engineering` kit installs cleanly via legacy bare-name `includes:` | `/loom-library use data-engineering` succeeds with deprecation warning logged |
| Discoverability | All five resource types (agent / prompt / protocol / skill / infrastructure) inferable from `CLAUDE.md` alone | Cold-read audit (new session reads CLAUDE.md, summarizes the extensibility model) |

## Constraints & Decisions

### C-01: Rename `library.skills:` → `library.protocols:`
**Decision:** Rename the existing `skills:` section in `library.yaml` to `protocols:` (these items always installed to `~/.claude/agents/protocols/`). Add a new `skills:` section for Claude Code native skills with target `~/.claude/skills/<name>/SKILL.md`.
**Rationale:** The current name is wrong today — items installed under it are protocol files, not skills. Stretching the name to mean both would compound confusion every time a new kit author reads the catalog. Migration cost is bounded by the existing `library-catalog-migrator.ts` walker pattern.
**Alternatives considered:** Keep `skills:` for protocols and introduce a new namespace (`knowledge`, `domain-skills`). Rejected — preserves a legacy misnomer indefinitely; every future doc has to explain the historical wart.
**Impact:** high

### C-02: Typed `includes:` entries with bare-name fallback for one release
**Decision:** Kit `includes:` entries accept typed form (`skill:name`, `protocol:name`, `agent:name`, `prompt:name`) and legacy bare names. Bare names trigger a deprecation warning and resolve via the existing cross-section lookup. Drop bare-name fallback in v5.
**Rationale:** Once `skill` and `agent` namespaces can collide on a shared name (e.g., `dbt-conventions` skill + `dbt-conventions-reviewer` agent), bare resolution invites silent type-mismatch installs. Typed entries make intent explicit. Fallback preserves existing kit definitions through one minor release.
**Alternatives considered:** Hard-cut to typed entries (breaks existing kit definitions). Keep bare-only (perpetuates ambiguity risk).
**Impact:** medium

### C-03: `python-conventions` as the first sample skill kit
**Decision:** Ship `python-conventions` (Polars-first for new code, ruff/uv tooling, atomic writes, type hints) as the demonstrable native-skill kit. Defer `dbt-platform` skill extraction to a follow-on.
**Rationale:** Broad applicability — any agent touching `.py` files gets the skill, not just data-pipeline agents. Demonstrates cross-cutting (not kit-scoped) activation. Formalizes the user's existing global Polars-first rule into Loom's catalog. Lowest risk — single-file skill, no existing content to refactor.
**Alternatives considered:** `dbt-platform` extracting dbt conventions duplicated across `data-pipeline-agent.md` + `data-test-generator.md`. Strong before/after diff but proves the pattern only inside the data-engineering kit. Save for follow-on once the cross-cutting case lands.
**Impact:** medium

### C-04: Defer per-deliverable approval behavior; seed `deliverableId?` field
**Decision:** Do not implement per-deliverable approval in this upgrade. Add an optional `deliverableId?: string` field to `change-proposal.schema.md`'s DeltaBlock spec. Future `/loom-deliverable approve` can retrofit without another schema bump.
**Rationale:** Per-deliverable approval is a workflow on top of the artifact system, not a property of it. Coupling it to this upgrade triples the surface area (new schema, new command, new state directory, second schema migration). The 5-line additive field reserves the retrofit path with zero behavioral impact today.
**Alternatives considered:** Ship the full workflow now (doubles blast radius); defer entirely without the seed (forces a future schema migration when the workflow lands).
**Impact:** low

### C-05: CLAUDE.md + README extensibility consolidation in scope; long-form doc out of scope
**Decision:** Add a `## Extensibility Model` section to `CLAUDE.md` (load-bearing — every Claude session reads this on start). Consolidate fragmented extensibility coverage in `README.md` (lines 435–447 and 717+) into one cohesive `## Extending Loom` section above install instructions. Defer `docs/extending-loom.md` long-form to a follow-on once 2–3 sample kits exist.
**Rationale:** CLAUDE.md is the load-bearing surface — future Claude sessions reading it today learn nothing about extension. The README consolidation makes the platform-vs-fixed-methodology positioning visible without a marketing-focused rewrite. Long-form docs are more useful with multiple sample kits to reference.
**Alternatives considered:** Ship the long-form doc now (premature without examples); defer all docs (leaves extensibility undiscoverable).
**Impact:** medium

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | Hooks and migrators |
| Language | TypeScript | 5.x | Migrator modules in `hooks/lib/` |
| Package runner | bun | latest | Preferred; npm/npx fallback |
| Testing | vitest | latest | Migration tests, fixture parity tests |
| Data format | TOON | n/a | All Loom on-disk artifacts (per project CLAUDE.md) |
| YAML parsing | js-yaml | (existing dep) | `library.yaml` read/write in the migrator |
| Claude Code native | SKILL.md format | n/a | Skill activation via `triggers:` frontmatter on file patterns |

## Features

### F-01: Library catalog v3 → v4 migration with skills support

**Priority:** P0
**Milestone:** M-01
**Description:** Extend the existing library-catalog migrator with a v3→v4 step that renames `library.skills:` → `library.protocols:`, initializes a new empty `library.skills:` collection, and rewrites `requires: [skill:*]` references to `requires: [protocol:*]`. Update `schema-versions.toon` and the migrator's `CURRENT_VERSION` atomically to keep the parity test green. Verify install-state compatibility — if `components[].type` is a closed enum, plan a coordinated install-state migration.

**Entities involved:** LibraryCatalog, InstallState, SchemaRegistry

**Key behaviors:**
- `/loom-upgrade --project --dry-run` reports v3 catalogs as outdated with `action: auto` and Rule 13
- `/loom-upgrade --project --force` rewrites a v3 catalog to v4 with `library.protocols:` populated and `library.skills:` initialized empty
- Chained walker (`migrateToLatest`) executes v2→v3→v4 in sequence when given a v2 input
- Symlink-managed installs are not clobbered (existing safety check still applies)
- Parity test (`test/protocol/schema-upgrade-v3.test.ts`) passes — `schema-versions.toon` and `CURRENT_VERSION` agree

**Convergence targets:**
- `bun test test/library-catalog-v3-to-v4.test.ts` exits 0
- `bun test test/protocol/schema-upgrade-v3.test.ts` exits 0
- `/loom-upgrade --project --dry-run` produces JSON/TOON output containing `library-catalog,…,Rule 13,auto`
- Migrator output for a v4 input is byte-equivalent to input (idempotency)

### F-02: Installer routing for native skills

**Priority:** P0
**Milestone:** M-01
**Description:** Extend `commands/loom-library.md` so the installer routes `skill:` items to `~/.claude/skills/<name>/SKILL.md` (literal filename — required for Claude Code activation). Rename existing `skills` target-paths bullet to `protocols`. Add typed `includes:` parsing to the kit `use <kit>` flow, accepting both new `{type, name}` form and legacy bare names with a deprecation warning. Update "Source Validation" allowed-prefix check to accept `~/.claude/skills/` paths.

**Entities involved:** Kit, Skill, InstallState

**Key behaviors:**
- `/loom-library use python-conventions` writes `~/.claude/skills/python-conventions/SKILL.md` with exact filename
- `install-state.toon` records the install with `type: skill` and `targetPath` ending in `/SKILL.md`
- Kit `includes: [skill:python-conventions]` resolves correctly via typed entry parsing
- Kit `includes: [python-conventions]` (legacy bare name) resolves via cross-section fallback with deprecation warning logged
- Source-validation rejects target paths outside `~/.claude/skills/` and `~/.claude/agents/`

**Convergence targets:**
- After `/loom-library use python-conventions`: `ls ~/.claude/skills/python-conventions/SKILL.md` exits 0
- After install, `install-state.toon` contains a `components[]` entry with `type: skill`
- `bun test test/installer-skill-routing.test.ts` exits 0

### F-03: `python-conventions` sample skill kit

**Priority:** P0
**Milestone:** M-02
**Description:** Author the first Claude Code native skill in Loom's catalog. Skill activates on `**/*.py`, `**/pyproject.toml`, `**/requirements.txt`. Body codifies Polars-first for new code (keep Pandas in existing code), uv/ruff/pytest tooling preference, atomic file writes for generated outputs, type hints on public functions, TOON output format for Loom artifacts. Register as a `skills:` entry in `library.yaml` and add a single-resource `python-conventions` kit demonstrating the minimal valid kit shape.

**Entities involved:** Skill, Kit, LibraryCatalog

**Key behaviors:**
- Opening any `.py` file in a Claude Code session triggers the `python-conventions` skill (visible via skill indicator)
- Opening a `.ts` file does NOT trigger `python-conventions`
- `library.yaml`'s `library.skills:` section contains a `python-conventions` entry pointing at `skills/python-conventions/SKILL.md`
- `library.yaml`'s `kits:` section contains a `python-conventions` kit with `includes: [skill:python-conventions]`

**Convergence targets:**
- File exists at `skills/python-conventions/SKILL.md` with valid YAML frontmatter containing `triggers:`, `name:`, `description:`
- `bun test test/kit-python-conventions-install.test.ts` exits 0
- Catalog grep: `library.skills:` block in library.yaml contains `python-conventions`

### F-04: Extensibility documentation + `deliverableId?` schema seed

**Priority:** P1
**Milestone:** M-02
**Description:** Add a load-bearing `## Extensibility Model` section to `CLAUDE.md` (~15 lines covering the five resource types, kit abstraction, library.yaml location, `/loom-agent create` wizard, orchestration.toml registration). Consolidate fragmented README coverage at lines 435–447 ("Bespoke reviewers") and 717+ ("Per-Project Extensibility") into one cohesive `## Extending Loom` section above install instructions; the word "extensible" must appear (currently appears 0 times in README). Add an "Authoring kits" subsection with a typed-`includes:` example. Add optional `deliverableId?: string` field to `change-proposal.schema.md`'s DeltaBlock spec.

**Entities involved:** ClaudeMd, Readme, DeltaBlock, KitSchema

**Key behaviors:**
- A future Claude session reading CLAUDE.md cold can summarize all five resource types and the kit/library extension model without consulting other files
- The word "extensible" appears at least once in README.md
- README's "Extending Loom" section appears above install instructions and is contiguous (no duplicated extension content elsewhere)
- `kit.schema.md` documents typed `includes:` entries with the `skill:` resource type and the backward-compatible fallback timeline
- `change-proposal.schema.md`'s DeltaBlock spec lists `deliverableId?: string` as optional with the description "Reserved for future per-deliverable approval lifecycle; safe to omit"

**Convergence targets:**
- `grep -c "extensible" README.md` ≥ 1
- `grep -n "## Extensibility Model" CLAUDE.md` returns one line
- `grep -n "deliverableId" agents/protocols/change-proposal.schema.md` returns at least one line
- docs-auditor agent run reports no fragmented extensibility coverage

## Data Model (Conceptual)

### Entities

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| LibraryCatalog | catalog_version, library.protocols[], library.skills[], library.agents[], library.prompts[], library.infrastructure[], kits[] | The on-disk `library.yaml` catalog. v4 introduces the `protocols`/`skills` split. |
| InstallState | schemaVersion, lastSynced, components[] | Tracks installed items by name, type, source, targetPath, installedAt. New valid `type` value: `skill`. |
| Skill | name, description, triggers[], targetPath | Claude Code native skill bundle. Installs to `~/.claude/skills/<name>/SKILL.md`. `triggers:` are file-pattern globs that auto-activate the skill. |
| Kit | name, description, version, minLoomVersion, includes[], requires[], command?, suggestedConfig? | Bundle of related resources. `includes:` accepts typed entries (`skill:name`) or legacy bare names. |
| Protocol | name, description, source, targetPath | Inter-agent contract file (formerly called "skill"). Installs to `~/.claude/agents/protocols/<name>.md`. |
| DeltaBlock | domain, before, after, deliverableId? | Existing change-proposal field; gains optional `deliverableId?: string` for future per-deliverable approval. |
| SchemaRegistry | schema, currentVersion, migratorKind, migratorPath, rule | `agents/protocols/schema-versions.toon` row. `library-catalog`'s `currentVersion` bumps 3 → 4 in F-01. |

### Relationships

| From | To | Type | Description |
|------|-----|------|-------------|
| Kit | Skill | 1:N | A kit includes zero or more skills via typed `includes:` entries |
| Kit | Protocol | 1:N | A kit includes zero or more protocols |
| Kit | Agent | 1:N | A kit includes zero or more agents |
| Kit | Command | 1:N | A kit includes zero or more commands (the `prompt:` type) |
| Kit | Kit | 1:N | A kit may require other kits via `requires:` (cycle-detected) |
| LibraryCatalog | Kit | 1:N | The catalog registers all kits under `kits:` |
| LibraryCatalog | Skill | 1:N | The catalog registers all skills under `library.skills:` |
| LibraryCatalog | Protocol | 1:N | The catalog registers all protocols under `library.protocols:` |
| InstallState | Skill/Protocol/Agent/Command | 1:N | Each installed item is recorded as a `components[]` entry |
| DeltaBlock | Deliverable | 0:1 | Optional `deliverableId?` references a future deliverable artifact |
| SchemaRegistry | LibraryCatalog | 1:1 | Registry row `library-catalog` defines the current version target |

## Milestones

### M-01: Schema and installer ship native skill support

**Features:** F-01, F-02
**Depends on:** None
**Acceptance:** Library catalog migrator walks v3 → v4 cleanly (parity test green, idempotency test green, chained walk from v2 produces correct shape). `/loom-library use <skill-name>` writes to `~/.claude/skills/<name>/SKILL.md` with literal filename. install-state records `type: skill` entries. `/loom-upgrade --project --dry-run` correctly classifies v3 catalogs as outdated.
**Effort:** M

### M-02: First skill kit ships and extensibility becomes discoverable

**Features:** F-03, F-04
**Depends on:** M-01
**Acceptance:** `python-conventions` skill installs via `/loom-library use python-conventions` and auto-activates on `.py` files in Claude Code. `CLAUDE.md` carries a load-bearing `## Extensibility Model` section. `README.md` carries a consolidated `## Extending Loom` section containing the word "extensible". `change-proposal.schema.md` records optional `deliverableId?` for the future per-deliverable approval workflow.
**Effort:** S

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| External tools (install.sh, loom-update-checker, third-party tooling) grep `library.skills:` and break post-rename | medium | Audit `install.sh`, `hooks/loom-update-checker.cjs`, and `commands/loom-upgrade.md` scan list for hardcoded references before merging. Add a release-note entry calling out the rename. |
| Typo in installer's target path (anything but literal `SKILL.md`) silently breaks Claude Code skill activation | high | F-02 acceptance test asserts the exact suffix `/SKILL.md` via snapshot. Manual smoke test (open `.py` file in Claude Code, observe activation) before merge. |
| install-state `components[].type` is a closed enum that doesn't accept `skill` — would require a coordinated install-state v3→v4 migration | medium | F-01 phase A includes an explicit checkpoint: read `hooks/lib/install-state-migrator.ts` first. If closed enum found, expand F-01 scope to coordinate both migrators atomically before any shipping. |
| Parity drift between `schema-versions.toon` and `CURRENT_VERSION` constant breaks `/loom-upgrade` for all users on the next sync | high | The existing parity test (`test/protocol/schema-upgrade-v3.test.ts`) fails CI on drift. Both must be bumped in the same commit. Reviewers must verify atomicity. |
| Docs drift: F-04 writes documentation referencing field names that change late during F-01/F-02 implementation | low | Sequence F-04 last (after migrator and installer tests are green). Avoid hardcoding field names in docs until schema is locked. |
| `python-conventions` content overlaps the user's global `~/.claude/CLAUDE.md` Polars-first rule | low | Frame kit content as project-level defaults. User-level CLAUDE.md takes precedence per Claude Code's existing precedence model. |

## Out of Scope

- **Per-deliverable approval behavior** — no `/loom-deliverable` command, no `.loom/deliverables/` state directory, no new schema file. Only the additive `deliverableId?` field on the existing change-proposal schema (F-04).
- **Long-form `docs/extending-loom.md`** — defer until 2–3 sample kits exist; CLAUDE.md + README updates are sufficient for this release.
- **`How Loom compares` rewrite to position vs Wire-style fixed-methodology frameworks** — belongs in a marketing-focused PR with a different audience.
- **Kit-scoped hooks and MCP configurations** — both currently global. Adding them to kits is a separate future upgrade.
- **`dbt-platform` sample kit** — chosen over for `python-conventions`. The dbt-conventions extraction from `data-pipeline-agent` + `data-test-generator` is a natural follow-on once the skill pattern is proven.
- **install-state schema v3 → v4 bump** — included ONLY if the F-01 checkpoint finds `components[].type` is a closed enum. Otherwise, install-state stays at v3 with `skill` accepted as a new open-string value.

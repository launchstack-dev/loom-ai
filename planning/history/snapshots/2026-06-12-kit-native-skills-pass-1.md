---
planVersion: 2
name: "Loom Kit Upgrade — Native Skills as First-Class Resource"
status: reviewed
created: 2026-06-12
lastReviewed: 2026-06-12
roadmapRef: planning/ROADMAP-kit-native-skills.md
totalPhases: 13
totalWaves: 5
---

# Plan: Loom Kit Upgrade — Native Skills as First-Class Resource

## Review Integration

<!-- Applied 2026-06-12 from planning/history/reviews/2026-06-12-review.toon -->

**Total findings applied:** 26 of 28 (all 8 blocking + all 17 warning + F-028 info; F-026 and F-027 skipped per user decision)

| Finding | Severity | Change summary |
|---------|----------|----------------|
| F-001 / X-01 | blocking | Moved CLAUDE.md `## Extensibility Model` to Phase 0b (new), ahead of any code deps |
| F-002 | blocking | Added explicit `requires: [skill:*]` → `requires: [protocol:*]` rewrite to migrator spec + agent-entry fixture |
| F-003 / X-04 | blocking | Added Phase 0 deliverable `install-state-audit.toon`; updated schema table note to defer resolution to audit |
| F-004 | blocking | **DEFERRED** — routing skill migration excluded per user decision; out-of-scope note added |
| F-005 / F-006 / X-02 | blocking | Extracted `hooks/lib/skill-router.ts` in Phase 0; Phase 3 wires it; Phase 4 tests import from it |
| F-007 / X-07 | blocking | Added `NOT_IN_CATALOG` error code to Error Handling Specification |
| F-008 / X-07 | blocking | Added post-install session-restart notice to Phase 3 spec and acceptance criteria |
| F-009 | warning | Added Phase 3 to Phase 5's dependency list |
| F-010 | warning | Documented Wave 1 + Wave 2 must merge as one release (no skillInstaller flag) |
| F-011 | warning | Moved `CURRENT_VERSION = 4` bump from Phase 0 to Phase 1; Phase 0 stub is no-op passthrough |
| F-012 | warning | Removed `test-fixtures/install-state-migration/**` from Phase 0 file ownership; added `hooks/lib/install-state-migrator.ts` as read-only input |
| F-013 | warning | Added Wave 0 → Wave 1 gate: `bun run tsc --noEmit` only (not `bun test`) in Phase 0b |
| F-014 | warning | Added `.plan-execution/stage-context/{phase}.toon` deliverables to Phase 0, 0b, 2, 5, 6, 7, 10 |
| F-015 | warning | Added ordered implementation sequence to Phase 3 |
| F-016 | warning | Added `commands/loom-upgrade.md` update to Phase 6 deliverables |
| F-017 | warning | Added `.plan-execution/contracts/catalog-v4-exports.toon` to Phase 0 deliverables |
| F-018 | warning | Added positioning paragraph to `## Extending Loom` README section (Phase 0b) |
| F-019 | warning | F-04 docs priority promoted to P0 via Phase 0b creation (applied with F-001) |
| F-020 | warning | Made `triggers?` consistently optional in SkillEntry interface and schema table; documented fallback behavior |
| F-021 | warning | Added `remove` behavior spec for skill items to Phase 3 |
| F-022 | warning | Added `skills/library.yaml` v2→v4 shape bump to Phase 0 deliverables; strengthened Phase 5 grep target |
| F-023 | warning | Added explicit Wave 1 → Wave 2 gate with `wave-1-gate.toon` deliverable |
| F-024 | warning | Specified `DEPRECATION_WARNING` message body as template string in Error Handling Specification |
| F-025 | warning | Added `/loom-library status` command as Phase 3 deliverable |
| F-028 | info | Added `deprecated?: boolean` and `redirectsTo?: string` to SkillEntry interface and schema table |

**Scope expansion applied:** F-05 (Authoring Scaffolding) added as Phases 8–11 in Wave 4.

**Deferred (out of scope):**
- `loom-bugfix-routing`, `loom-quick-routing`, `loom-git-routing` migration (F-004) — deferred to follow-on; will use the new `/loom-skill create` wizard once it lands.
- F-026 (Wave 3 parallelization) — skipped per user decision.
- F-027 (Wave 4 fold) — skipped per user decision.
- `/loom-kit create` wizard — acknowledged as gap; future work, not required for this upgrade.

---

## Overview

Promotes Claude Code native skills to a first-class kit resource in Loom's library catalog. The upgrade renames `library.skills:` → `library.protocols:` in `library.yaml` (bumping the catalog from v3 to v4), routes `skill:` typed includes to `~/.claude/skills/<name>/SKILL.md`, ships `python-conventions` as the first sample skill kit, makes extensibility load-bearing in `CLAUDE.md` and `README.md`, ships authoring scaffolding (`/loom-skill create` wizard, `/loom-library add` heuristic update, `/loom-agent create` cross-reference, CLAUDE.md authoring section), and seeds an optional `deliverableId?` field on `DeltaBlock` for a future per-deliverable approval workflow.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | TypeScript 5.x | Migrators in `hooks/lib/` |
| Runtime | Node.js 20+ | Hooks and migrators |
| Package runner | bun (preferred), npm/npx fallback | `bun test`, `bun run` |
| Testing | vitest | `bun test` invocation |
| Data format | TOON | All Loom on-disk artifacts |
| YAML parsing | js-yaml (existing dep) | `library.yaml` read/write |
| Skill format | Claude Code SKILL.md | `triggers:` frontmatter, `~/.claude/skills/<name>/SKILL.md` |

---

## Schema / Type Definitions

### LibraryCatalog

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| catalog_version | integer | Required; value must equal 4 post-migration | Must be 4 for v4 documents; migrator guard throws `MigrationSchemaVersionMismatchError` on wrong version |
| repo | string | Required; https URL; host in `{github.com, codeberg.org}` | Validated by `validateRepoUrl()` — throws on non-https, userinfo, fragment, or unknown host |
| loomCoreVersion | string | Required; semver | Validated by `validateSemver()` |
| loomHooksVersion | string | Required; semver | Validated by `validateSemver()` |
| releases | ReleaseEntry[] | Required; may be empty | Each entry validated by `validateSemver(entry.version)` |
| default_dirs | object | Required; structure inherited from v3 | Unchanged by v3→v4 migration |
| library.protocols | ProtocolEntry[] | Required; renamed from `library.skills` in v4 | All items from `library.skills` (v3) move here verbatim |
| library.skills | SkillEntry[] | Required; initialized empty in v4 | New section for Claude Code native skills |
| library.agents | AgentEntry[] | Required; unchanged | |
| library.prompts | PromptEntry[] | Required; unchanged | |
| library.infrastructure | InfraEntry[] | Optional; unchanged | |
| kits | KitEntry[] | Required; typed `includes:` accepted | |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_catalog | catalog_version | PRIMARY (logical) | Version guard in migrator |
| uq_library_protocols_name | library.protocols[].name | UNIQUE (logical) | Prevent duplicate protocol registration |
| uq_library_skills_name | library.skills[].name | UNIQUE (logical) | Prevent duplicate skill registration |
| uq_kits_name | kits[].name | UNIQUE (logical) | Prevent duplicate kit registration |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| LibraryCatalog | KitEntry | N/A — YAML file; no FK enforcement | N/A |
| LibraryCatalog | SkillEntry | N/A | N/A |
| LibraryCatalog | ProtocolEntry | N/A | N/A |

---

<!-- F-003: schema table updated to defer actual version/enum determination to Phase 0 audit deliverable -->
### InstallState (version TBD — audit in Phase 0)

**Note:** The actual `schemaVersion` and whether `type` is an open string or closed enum will be confirmed by the Phase 0 audit of `hooks/lib/install-state-migrator.ts`. The table below records the expected post-upgrade shape; the audit deliverable (`.plan-execution/contracts/install-state-audit.toon`) records the pre-upgrade state found on disk.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| schemaVersion | integer | Current value to be confirmed by Phase 0 audit | Audit records actual value; schema bump only needed if `type` is a closed enum |
| components | InstallStateComponent[] | Required | Kind ∈ `{core, hooks, kit}` |
| items | InstallStateItem[] | Required | `type` ∈ open string (to be confirmed by audit); `skill` now valid |
| items[].type | string | One of: `agent`, `protocol`, `command`, `prompt`, `infrastructure`, `skill` | Validation: `targetPath` for `skill` items MUST end with `/SKILL.md` |
| items[].targetPath | string | For skill type: must be `~/.claude/skills/<name>/SKILL.md` | |
| items[].sha256 | string | Hex; empty only when unreadable at migration time | |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| idx_items_type | items[].type | INDEX (logical) | Fast filter by resource type |
| uq_items_name_type | items[].name + items[].type | UNIQUE (logical) | Detect duplicate installs |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| InstallState | items[] | REMOVE entry when kit uninstalled | UPDATE targetPath if kit renamed |

---

<!-- F-020: triggers? made consistently optional in both interface and schema table; fallback documented -->
### Skill

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| name | string | Required; slug format `[a-z][a-z0-9-]*` | Non-empty; matches directory name under `~/.claude/skills/` |
| description | string | Required | Non-empty |
| triggers | string[] | **Optional** (see note) | When present: each entry is a valid glob (e.g., `**/*.py`); validated by installer. When absent: activation falls back to description-based matching by Claude Code. |
| targetPath | string | Required; ends with `/SKILL.md` | Must be `~/.claude/skills/<name>/SKILL.md` — literal filename required by Claude Code |
| source | string | Required; relative path in repo | Must be accessible relative to repo root |
| deprecated | boolean | Optional | When `true`, Claude Code and `/loom-library status` surface a deprecation notice |
| redirectsTo | string | Optional | Slug of the replacement skill; only meaningful when `deprecated: true` |

<!-- F-028: deprecated? and redirectsTo? added to SkillEntry interface and schema table, mirroring existing agent/prompt pattern -->

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| uq_skill_name | name | UNIQUE (logical) | One entry per skill in `library.skills:` |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| LibraryCatalog | Skill | Remove from `library.skills:` | Update `targetPath` if moved |
| InstallState | Skill item | Remove items entry | Update sha256 on reinstall |

---

### Kit (v4 — typed `includes:`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| name | string | Required; slug | Non-empty |
| description | string | Required | Non-empty |
| version | string | Required; semver | Validated by `validateSemver()` |
| minLoomVersion | integer | Optional | Must be ≤ installed Loom version |
| includes | IncludeEntry[] | Required; ≥1 entry | Each entry: typed form `{type, name}` or legacy bare name (string) |
| requires | string[] | Optional | Kit names; cycle-detected before install |
| command | string | Optional | Filename of command to register |
| suggestedConfig | object | Optional | |

**IncludeEntry (typed form):**

| Field | Type | Constraints |
|-------|------|-------------|
| type | enum | `agent` \| `protocol` \| `skill` \| `prompt` \| `infrastructure` |
| name | string | Must resolve to an entry in the corresponding `library.<type>:` section |

**IncludeEntry (legacy bare-name form):**

A plain string — e.g., `python-conventions`. Resolved via cross-section lookup in priority order: agents → protocols → skills → prompts. Emits a `DEPRECATION_WARNING` at install time. Bare-name support drops in v5.

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| uq_kit_name | name | UNIQUE | One kit per name in `kits:` |
| idx_kit_includes_type | includes[].type | INDEX (logical) | Fast routing by resource type |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| Kit | IncludeEntry | N/A — kit update replaces list | N/A |

---

### SchemaRegistry (row: `library-catalog`)

| Field | Type | Constraints |
|-------|------|-------------|
| schema | string | `library-catalog` |
| file | string | `~/.claude/skills/library/library.yaml` |
| pathKind | string | `home` |
| currentVersion | integer | Bumped 3 → 4 in Phase 1 (not Phase 0) |
| migratorKind | string | `module` |
| migratorPath | string | `hooks/lib/library-catalog-migrator.ts` |
| rule | integer | 13 |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| uq_registry_schema | schema | UNIQUE (in registry TOON file) | One row per schema |

#### Cascade Behavior

N/A — static registry file; no foreign keys.

---

### DeltaBlock (additive `deliverableId?` field)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| domain | string | Required | |
| before | string | Required | |
| after | string | Required | |
| deliverableId | string \| undefined | Optional | When present: non-empty string; reserved for future per-deliverable approval; no behavioral effect in this version |

#### Indexes

N/A — embedded in change-proposal documents; no standalone index.

#### Cascade Behavior

N/A — additive field; no cascade.

---

### SQL Schema

Not applicable — all Loom catalog artifacts are YAML/TOON files, not relational databases. The type definitions above serve as the TypeScript interface contracts for the migrator modules.

**TypeScript interfaces produced by Phase 0 (contracts-agent):**

```typescript
// hooks/lib/library-catalog-migrator.ts additions
export interface LibraryCatalogV4 {
  catalog_version: 4;
  repo: string;
  loomCoreVersion: string;
  loomHooksVersion: string;
  releases: ReleaseEntry[];
  default_dirs: unknown;
  library: {
    protocols: ProtocolEntry[];
    skills: SkillEntry[];
    agents?: AgentEntry[];
    prompts?: PromptEntry[];
    infrastructure?: InfraEntry[];
  };
  kits: KitV4Entry[];
}

// F-020: triggers? consistently optional; F-028: deprecated? and redirectsTo? added
export interface SkillEntry {
  name: string;
  description: string;
  source: string;
  triggers?: string[];          // optional — fallback to description-based activation when absent
  deprecated?: boolean;         // F-028: mirrors existing agent/prompt deprecation support
  redirectsTo?: string;         // F-028: slug of replacement skill; meaningful only when deprecated: true
}

export interface ProtocolEntry {
  name: string;
  description: string;
  source: string;
}

export type TypedInclude =
  | { type: "agent" | "protocol" | "skill" | "prompt" | "infrastructure"; name: string }
  | string; // legacy bare-name; deprecated

export interface KitV4Entry {
  name: string;
  description: string;
  version: string;
  minLoomVersion?: number;
  minCoreVersion?: string;
  minHooksVersion?: string;
  includes: TypedInclude[];
  requires?: string[];
  command?: string;
  suggestedConfig?: unknown;
}
```

---

## API Specification

This project has no HTTP/REST API endpoints — it extends TypeScript migrator modules and YAML catalog files. The "API" for this plan is the migrator-exported function surface and the installer routing command interface.

### migrateLibraryCatalogV3ToV4(v3, opts)

**Description:** Pure-function migrator that transforms a parsed v3 catalog object into a v4 object, renaming `library.skills` → `library.protocols` and initializing an empty `library.skills` collection. Also rewrites any `requires: [skill:*]` entries on agent definitions to `requires: [protocol:*]`.
**Auth:** none (pure function, no HTTP)

**Parameters:**
| Parameter | Type | Required | Constraints | Default |
|-----------|------|----------|-------------|---------|
| v3 | LibraryCatalogV3 | yes | `catalog_version` must equal 3 | — |
| opts | MigrationOptions | yes | `coreVersion` and `hooksVersion` required strings | — |

<!-- F-002: explicit decision — requires: [skill:*] on agent entries is rewritten to requires: [protocol:*] -->
**Returns (LibraryCatalogV4):**
```typescript
{
  catalog_version: 4,
  repo: string,
  loomCoreVersion: string,
  loomHooksVersion: string,
  releases: ReleaseEntry[],
  default_dirs: unknown,
  library: {
    protocols: ProtocolEntry[],   // formerly library.skills
    skills: SkillEntry[],         // new, initialized empty
    agents: AgentEntry[],         // any requires: [skill:*] entries rewritten to requires: [protocol:*]
    prompts: PromptEntry[],
    infrastructure: InfraEntry[],
  },
  kits: KitV4Entry[],
}
```

**Error responses:**
| Condition | Error class | Message |
|-----------|-------------|---------|
| `v3.catalog_version !== 3` | `MigrationSchemaVersionMismatchError` | "Expected catalog_version 3, got {actual}" |
| `v3` is null | `MigrationSchemaVersionMismatchError` | "Expected catalog_version 3, got null" |

**Behavior notes:**
- `library.skills` (v3) maps verbatim to `library.protocols` (v4) — field names of each entry are preserved
- `library.skills` (v4) is initialized as `[]` — the installer populates it as skill items are installed
- `kits[].includes` entries are NOT rewritten by this migrator; typed-form parsing happens in the installer at runtime
- Agent entries with `requires:` arrays containing items prefixed `skill:` have those items rewritten to `protocol:` prefix (F-002)
- The migrator is pure: no I/O, no side effects; caller parses YAML and renames the file atomically

---

### migrateToLatest (library-catalog, chain walk)

**Description:** Chain walker that accepts a catalog at any version from 2 upward and walks it to `CURRENT_VERSION` (4) by chaining `"2->3"` then `"3->4"` steps.
**Auth:** none

**Parameters:**
| Parameter | Type | Required | Constraints | Default |
|-----------|------|----------|-------------|---------|
| input | AnyLibraryCatalog | yes | v2, v3, or v4 object | — |
| fromVersion | number | yes | 2, 3, or 4 | — |
| opts | MigrationOptions | yes | | — |
| targetVersion | number | no | Defaults to `CURRENT_VERSION` | 4 |
| registry | MigrationRegistry | no | Tests inject overrides | frozen built-in |

**Error responses:**
| Condition | Error class |
|-----------|-------------|
| `fromVersion > targetVersion` | `MigrationDowngradeError` |
| Missing step key in registry | `MissingMigrationStepError` |

**Behavior notes:**
- Idempotent: `migrateToLatest(v4Input, 4, opts)` returns input unchanged
- Steps are applied in order: v2→v3 via existing step, then v3→v4 via new step
- Tests may inject `{ ...MIGRATIONS, "3->4": stub }` to exercise partial chains without mutating module state
- <!-- F-011: Phase 0 stubs "3->4" as a no-op passthrough (returns input unchanged) — not a thrower — so bun test stays green between Phase 0 and Phase 1 when CURRENT_VERSION has NOT been bumped yet. Phase 1 replaces the stub with the real implementation AND bumps CURRENT_VERSION -->

---

### detectLibraryCatalogVersion (extended)

**Description:** Detects whether a raw `library.yaml` string is v2, v3, v4, or unknown. Extended to recognize `catalog_version: 4` and the new v4 marker `library.protocols:`.
**Auth:** none

**Parameters:**
| Parameter | Type | Required |
|-----------|------|----------|
| content | string | yes (raw file content) |

**Returns (LibraryCatalogDetectionResult extended):**
```typescript
{
  version: 2 | 3 | 4 | "unknown",
  outdated: boolean,
  reason: string | null,
}
```

**Behavior notes:**
- Line-anchored regex on `catalog_version:` prevents substring smuggling
- v4 marker check: presence of `library.protocols:` (new in v4) alongside `catalog_version: 4`
- v3 file missing `library.protocols:` → `outdated: true` with reason
- v4 file with all markers → `outdated: false`

---

<!-- F-005/F-006/X-02: skill-router.ts extracted as separate module spec -->
### skillRouter (hooks/lib/skill-router.ts)

**Description:** Pure-function helper module extracted in Phase 0 containing the skill routing logic that `commands/loom-library.md` wires at runtime. Phase 4's vitest tests import directly from this module without depending on the markdown command file.
**Auth:** none

**Exported functions:**

```typescript
/** Build the target install path for a skill item */
export function buildSkillTargetPath(name: string): string;
// Returns: ~/.claude/skills/<name>/SKILL.md

/** Parse a typed or bare-name include entry */
export function parseIncludeEntry(entry: TypedInclude): { type: ResourceType; name: string; bare: boolean };
// bare: true triggers DEPRECATION_WARNING logging

/** Validate that a target path is inside an allowed install prefix */
export function validateInstallPath(targetPath: string): { valid: boolean; error?: SourceValidationError };
// Allowed prefixes: ~/.claude/skills/, ~/.claude/agents/

/** Build install-state item record for a skill */
export function buildSkillInstallRecord(name: string, sha256: string): InstallStateItem;

/** Resolve bare-name include to best-match resource type via section priority order */
export function resolveBareNameInclude(
  name: string,
  catalog: LibraryCatalogV4
): { type: ResourceType; name: string } | null;
// Priority order: agents → protocols → skills → prompts

/** Build the remove path for a skill item and determine if parent directory would be empty */
export function buildSkillRemovePlan(name: string): { skillMdPath: string; parentDir: string };
```

---

### /loom-library use \<name\> — skill routing

**Description:** Installer command routing for `skill:` type entries. When a kit's `includes:` lists `skill:python-conventions`, the installer writes `~/.claude/skills/python-conventions/SKILL.md` (literal filename required by Claude Code).
**Auth:** none (local CLI)

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | yes | Kit name or bare skill name |

**Routing table:**
| Item type | Target directory | Filename |
|-----------|-----------------|----------|
| skill | `~/.claude/skills/<name>/` | `SKILL.md` (literal — required for Claude Code activation) |
| protocol | `~/.claude/agents/protocols/` | `<name>.md` |
| agent | `~/.claude/agents/` | `<name>.md` |
| prompt/command | `~/.claude/commands/` | `<name>.md` |

**Success side-effect:** `install-state.toon` gains an item entry with `type: skill` and `targetPath: ~/.claude/skills/<name>/SKILL.md`.

<!-- F-008: post-install restart notice specified -->
**Post-install notice:** After writing `SKILL.md`, the installer prints:
```
Skill {name} installed. Restart your Claude Code session for trigger activation to take effect.
```

**Error responses:**
| Condition | Code | Action |
|-----------|------|--------|
| Target path outside `~/.claude/skills/` or `~/.claude/agents/` | `SOURCE_VALIDATION_ERROR` | Abort install, log path |
| `SKILL.md` source file not found in repo | `MISSING_SOURCE` | Abort install |
| Bare-name resolves to ambiguous type | `DEPRECATION_WARNING` | Proceed with first-match; log warning |
| Kit or skill name not found in `library.yaml` | `NOT_IN_CATALOG` | Abort install, print catalog lookup hint |

**Behavior notes:**
- Source-validation check is extended to accept `~/.claude/skills/` prefix paths (previously only `~/.claude/agents/` was accepted)
- Bare-name fallback resolves in section priority: agents → protocols → skills → prompts; warning logged on match
- All file writes are atomic: write to `.tmp`, then `fs.renameSync`
- Implementation delegates to `hooks/lib/skill-router.ts` pure functions

---

### /loom-library remove \<name\> — skill remove path

<!-- F-021: remove behavior spec for skill-type items -->
**Description:** Remove behavior for `skill:` type items. Deletes `~/.claude/skills/<name>/SKILL.md` and prunes the parent directory if empty.

**Behavior notes:**
- Delete `~/.claude/skills/<name>/SKILL.md`
- If `~/.claude/skills/<name>/` is now empty, remove the directory
- Remove the corresponding `items[]` entry from `install-state.toon`
- Print: `Skill {name} removed. Restart your Claude Code session for deactivation to take effect.`

---

### /loom-library status

<!-- F-025: /loom-library status command spec -->
**Description:** Lists all installed kits and their resource items, resource type per item, `targetPath`, and for skill items the `triggers` patterns read from the installed SKILL.md frontmatter.

**Output format (TOON):**
```toon
installedAt: 2026-06-12T00:00:00Z
kits[N]{name,version,itemCount}:
  python-conventions,1.0.0,1
items[N]{name,type,targetPath,triggers}:
  python-conventions,skill,~/.claude/skills/python-conventions/SKILL.md,"**/*.py,**/pyproject.toml"
```

---

## State Machines

### LibraryCatalog catalog_version

The `catalog_version` field is the lifecycle state of the catalog file. The migration walk is the only state machine.

```
  v2 ──→ v3 ──→ v4 (TERMINAL)
  ↑       ↑
  │       └── (v3 reached by running "2->3" step)
  └────────── (pre-v2 collapses to v2-equivalent)
```

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| v2 | Legacy catalog without releases/versions; `library.skills` = inter-agent protocols | Default at repo creation pre-v3 era; also: pre-v2 files collapse here for chain-walk purposes |
| v3 | Current production format; `library.skills` still means protocol files; `releases[]` present | `migrateLibraryCatalogV2ToV3` completes successfully |
| v4 | Native-skill-aware catalog; `library.protocols` = protocol files; `library.skills` = Claude Code native skills | `migrateLibraryCatalogV3ToV4` completes successfully — TERMINAL for this upgrade |

**Valid transitions:**

<!-- F-002: v3→v4 transition now explicitly includes requires: [skill:*] → requires: [protocol:*] rewrite -->
| From | To | Trigger | Side effects |
|------|-----|---------|--------------|
| v2 | v3 | `migrateToLatest(input, 2, opts)` or `/loom-upgrade --project --force` | Synthesizes `releases[]` entry if `opts.initialRelease` provided; writes normalized `repo` URL |
| v3 | v4 | `migrateToLatest(input, 3, opts)` or `/loom-upgrade --project --force` | Renames `library.skills` → `library.protocols`; initializes `library.skills: []`; rewrites any `requires: [skill:*]` references on agent entries to `requires: [protocol:*]` |
| v2 | v4 | `migrateToLatest(input, 2, opts)` (chain walk) | Executes v2→v3 then v3→v4 in sequence |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|-----------|---------|
| v4 | v3 | `MigrationDowngradeError` | "Cannot downgrade from version 4 to 3" |
| v4 | v2 | `MigrationDowngradeError` | "Cannot downgrade from version 4 to 2" |
| v3 | v2 | `MigrationDowngradeError` | "Cannot downgrade from version 3 to 2" |

---

### InstallState item.type

The `type` field on `items[]` entries is an open string. For this upgrade, `skill` becomes a recognized value alongside `agent`, `protocol`, `command`, `prompt`, `infrastructure`.

```
  (installer routes item) ──→ type: skill ──→ targetPath: ~/.claude/skills/<name>/SKILL.md
                         ──→ type: protocol ──→ targetPath: ~/.claude/agents/protocols/<name>.md
                         ──→ type: agent ──→ targetPath: ~/.claude/agents/<name>.md
```

No lifecycle transitions on `type` itself — it is set at install and does not change.

---

## Error Handling Specification

### Error Response Format

All migrator errors are thrown as typed Error subclasses (not HTTP — these are pure functions):

```typescript
// Existing pattern (mirrors migration-errors.ts)
class MigrationSchemaVersionMismatchError extends Error {
  readonly expected: number;
  readonly actual: unknown;
}
class MigrationDowngradeError extends Error {
  readonly from: number;
  readonly to: number;
}
class MissingMigrationStepError extends Error {
  readonly key: string;
  readonly from: number;
  readonly to: number;
}
class MigrationValidationError extends Error {
  readonly field: string;
  readonly value: unknown;
  readonly constraint: string;
}
```

For installer (`commands/loom-library.md`) user-facing errors, the format follows the existing TOON error envelope:

```toon
status: error
code: SOURCE_VALIDATION_ERROR
message: "Target path '~/.claude/foo/SKILL.md' is outside the allowed install directories"
details: targetPath: ~/.claude/foo/SKILL.md, allowedPrefixes: ~/.claude/skills/, ~/.claude/agents/
```

### Error Categories

<!-- F-007: NOT_IN_CATALOG error code added -->
<!-- F-024: DEPRECATION_WARNING message body specified as template string -->
| Code | Type | When Used | Retryable |
|------|------|-----------|-----------|
| `MIGRATION_VERSION_MISMATCH` | thrown | Input object's `catalog_version` does not match expected `from` version | No — fix the version or use the correct migrator step |
| `MIGRATION_DOWNGRADE` | thrown | `fromVersion > targetVersion` in `migrateToLatest` | No — downgrades not supported |
| `MISSING_MIGRATION_STEP` | thrown | Registry has no `"N->M"` key for a required chain step | No — add the step to `MIGRATIONS` |
| `MIGRATION_VALIDATION_ERROR` | thrown | `repo` URL fails `validateRepoUrl`, version fails `validateSemver` | No — fix the input data |
| `SOURCE_VALIDATION_ERROR` | installer error | `targetPath` outside allowed prefixes | No — fix the kit definition |
| `MISSING_SOURCE` | installer error | Source file not found in repo at declared path | No — fix the `source:` field |
| `NOT_IN_CATALOG` | installer error | Kit or skill name not found in `library.yaml` | No — check name spelling; run `/loom-library list` |
| `DEPRECATION_WARNING` | warning (not thrown) | Bare-name `includes:` resolved via cross-section fallback | No — informational; installer continues |
| `PARITY_DRIFT` | test failure | `schema-versions.toon currentVersion` ≠ `CURRENT_VERSION` constant | No — update both atomically in same commit |

**NOT_IN_CATALOG message:**
```
No kit or skill named {name} found in library.yaml. Run /loom-library list to see available entries.
```

**DEPRECATION_WARNING message template:**
```
DEPRECATION WARNING: bare-name include '{name}' resolved to {type}:{name} via cross-section fallback. Update your kit to use the typed form (e.g. {type}:{name}) before v5. Bare-name support will be removed in library catalog v5.
```

### Field-Level Validation

For `MigrationValidationError`, the error carries:

```typescript
{
  field: "repo" | "release.version" | "catalog_version" | string,
  value: unknown,
  constraint: string, // human-readable e.g. "scheme must be https (got \"http:\")"
}
```

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| Migrator errors (thrown) | Do not retry — fix the input | 0 |
| Installer `MISSING_SOURCE` | Do not retry — fix `source:` in kit definition | 0 |
| Installer `NOT_IN_CATALOG` | Do not retry — fix the name or run list | 0 |
| `DEPRECATION_WARNING` | N/A — not an error | 0 |

---

## Execution Phases

<!-- F-001/X-01/F-019: CLAUDE.md Extensibility Model and README positioning promoted to Phase 0b (P0 priority, no code deps) -->
### Phase 0 — Wave 0: Contracts — Types, Interfaces, Skill Router, Audit Stubs

**Agent:** contracts-agent
**Objective:** Define all TypeScript interfaces for v4 catalog migration, extract the `skill-router.ts` helper module, produce the catalog-v4-exports contract artifact, audit `install-state-migrator.ts`, stub test fixture files, and bump `skills/library.yaml` to v4 shape.
**Dependencies:** None
<!-- F-012: removed test-fixtures/install-state-migration/** from ownership; added install-state-migrator.ts as read-only input -->
**File Ownership:** hooks/lib/library-catalog-migrator.ts (interface additions only), hooks/lib/skill-router.ts (new), test-fixtures/library-catalog-migration/**, skills/library.yaml, .plan-execution/contracts/**

**Read-only inputs:** `hooks/lib/install-state-migrator.ts` (for F-003 audit — do not modify)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `hooks/lib/library-catalog-migrator.ts` | Modify — add `LibraryCatalogV4`, `SkillEntry` (with optional `triggers?`, `deprecated?`, `redirectsTo?`), `ProtocolEntry`, `KitV4Entry`, `TypedInclude` interfaces; extend `AnyLibraryCatalog` union; add `"3->4"` MIGRATIONS stub as **no-op passthrough** (returns input unchanged — NOT a thrower; F-011); do NOT bump `CURRENT_VERSION` yet (that moves to Phase 1) | contracts-agent |
| `hooks/lib/skill-router.ts` | Create — pure-function module with `buildSkillTargetPath`, `parseIncludeEntry`, `validateInstallPath`, `buildSkillInstallRecord`, `resolveBareNameInclude`, `buildSkillRemovePlan` (see API Specification → skillRouter) | contracts-agent |
| `test-fixtures/library-catalog-migration/v3-input.yaml` | Create — minimal valid v3 catalog with one protocol in `library.skills:`, one kit with bare-name include, one agent entry with `requires: [skill:some-protocol]` | contracts-agent |
| `test-fixtures/library-catalog-migration/v4-expected.yaml` | Create — the expected v4 output: `library.protocols:` populated, `library.skills: []`, `catalog_version: 4`, agent entry `requires: [protocol:some-protocol]` | contracts-agent |
| `test-fixtures/library-catalog-migration/v4-idempotency-input.yaml` | Create — v4 input (same as expected) for idempotency test | contracts-agent |
| `.plan-execution/contracts/catalog-v4-exports.toon` | Create — ~10-line artifact listing exact exported function and type names from `hooks/lib/library-catalog-migrator.ts` and `hooks/lib/skill-router.ts` for Wave 1+2 agents to reference | contracts-agent |
| `.plan-execution/contracts/install-state-audit.toon` | Create — audit of `hooks/lib/install-state-migrator.ts`: record actual `schemaVersion` value on disk, whether `items[].type` is open-string or closed enum, and whether a schema bump is needed to add `skill` | contracts-agent |
| `skills/library.yaml` | Modify — detect current version and migrate to v4 shape: rename `library.skills:` → `library.protocols:`, initialize `library.skills: []`, set `catalog_version: 4`. This ensures Phase 5 writes into the correct v4 structure | contracts-agent |
| `.plan-execution/stage-context/phase-0.toon` | Create — record files created/modified, CURRENT_VERSION not yet bumped (Phase 1 responsibility), key interface names, any warnings from install-state audit | contracts-agent |

<!-- F-002: v3-input.yaml fixture now includes an agent entry with requires: [skill:*] to exercise the rewrite path -->
<!-- F-003: install-state-audit.toon records actual on-disk state of install-state-migrator.ts -->
<!-- F-005/F-006/X-02: skill-router.ts extracted in Phase 0 so Phase 4 tests can import pure functions -->
<!-- F-011: CURRENT_VERSION NOT bumped here — moved to Phase 1; stub is no-op passthrough -->
<!-- F-012: test-fixtures/install-state-migration/** removed from ownership -->
<!-- F-013: Wave 0→1 gate: bun run tsc --noEmit only, NOT bun test -->
<!-- F-014: stage-context/phase-0.toon added -->
<!-- F-017: catalog-v4-exports.toon added -->
<!-- F-022: skills/library.yaml bumped to v4 shape in Phase 0 -->

#### Acceptance Criteria

- [ ] `bun run tsc --noEmit` exits with code 0 after interface additions and skill-router.ts creation
- [ ] `LibraryCatalogV4` interface includes `library.protocols` and `library.skills` as distinct typed arrays
- [ ] `SkillEntry.triggers` is typed `string[] | undefined` (optional, not required)
- [ ] `SkillEntry` includes `deprecated?: boolean` and `redirectsTo?: string`
- [ ] `AnyLibraryCatalog` union type includes `LibraryCatalogV4`
- [ ] `CURRENT_VERSION` constant remains at its pre-upgrade value in `hooks/lib/library-catalog-migrator.ts` (NOT bumped to 4 yet — that is Phase 1's responsibility)
- [ ] `"3->4"` MIGRATIONS entry is a no-op passthrough that returns the input object unchanged (does not throw)
- [ ] `hooks/lib/skill-router.ts` exports all six functions listed in the API Specification
- [ ] `.plan-execution/contracts/catalog-v4-exports.toon` exists and lists exported names from both migrator and skill-router modules
- [ ] `.plan-execution/contracts/install-state-audit.toon` exists and records: actual schemaVersion, whether type is open/closed enum, and recommendation
- [ ] `skills/library.yaml` `catalog_version` equals `4` and contains `library.protocols:` and `library.skills:` sections
- [ ] `test-fixtures/library-catalog-migration/v3-input.yaml` contains an agent entry with `requires:` containing a `skill:`-prefixed item
- [ ] Fixture files exist at all declared paths and are valid YAML
- [ ] `.plan-execution/stage-context/phase-0.toon` exists and records this phase's outputs

#### Scenarios

```toon
id: S-01
title: TypeScript compilation succeeds after interface additions and skill-router extraction
given[2]: hooks/lib/library-catalog-migrator.ts has LibraryCatalogV4 and related interfaces added, hooks/lib/skill-router.ts has been created with all six exported functions
when: A developer runs bun run tsc --noEmit
whenTriggerType: system-event
then[2]: Exit code MUST be 0, No type errors MUST appear in either hooks/lib/library-catalog-migrator.ts or hooks/lib/skill-router.ts
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Phase 0 MIGRATIONS 3->4 stub is no-op passthrough, CURRENT_VERSION not yet 4
given[1]: hooks/lib/library-catalog-migrator.ts has been modified per Phase 0 spec
when: The MIGRATIONS["3->4"] stub is called with any v3-shaped object
whenTriggerType: system-event
then[2]: The stub MUST return the input object unchanged (not throw), CURRENT_VERSION MUST NOT equal 4 yet in this phase
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

---

<!-- F-001/F-019/F-018: CLAUDE.md Extensibility Model promoted to P0, ahead of code work; README positioning paragraph added -->
### Phase 0b — Wave 0: Extensibility Documentation (P0 — no code deps)

**Agent:** implementer-agent
**Objective:** Add `## Extensibility Model` section to `CLAUDE.md` and the `## Extending Loom` section to `README.md`. These have zero code dependencies and are the load-bearing platform-positioning deliverables — promoted from Phase 6 per F-001/X-01.
**Dependencies:** None
**File Ownership:** CLAUDE.md, README.md

<!-- F-013: Wave 0 → Wave 1 gate runs after Phase 0b — bun run tsc --noEmit (passes), NOT bun test -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `CLAUDE.md` | Modify — add `## Extensibility Model` section (~15 lines) covering: (1) the five resource types (agent, prompt, protocol, skill, infrastructure), (2) kit abstraction, (3) `skills/library.yaml` location, (4) `/loom-agent create` wizard, (5) `/loom-skill create` wizard (new — see F-05 scope expansion), (6) `orchestration.toml` registration. Include a sub-section `### Authoring Resources` covering: how to author a skill (`/loom-skill create`), how to author a kit (hand-edit pattern; `/loom-kit create` is future work), and the resource-type decision tree (when to use agent vs prompt vs protocol vs skill vs infrastructure) | implementer-agent |
| `README.md` | Modify — consolidate fragmented extensibility content from lines 435–447 and 717+ into one contiguous `## Extending Loom` section above install instructions; ensure the word "extensible" appears; add "Authoring kits" subsection with typed-`includes:` example; add one positioning paragraph contrasting platform model against fixed-methodology alternatives (two sentences max) | implementer-agent |
| `.plan-execution/stage-context/phase-0b.toon` | Create — record files modified, confirm Extensibility Model section is present in CLAUDE.md, record line count of new section | implementer-agent |

<!-- F-018: positioning paragraph added to README ## Extending Loom -->
<!-- F-014: stage-context/phase-0b.toon added -->

#### Acceptance Criteria

- [ ] `grep -n "## Extensibility Model" CLAUDE.md` returns exactly one line
- [ ] The `## Extensibility Model` section names all five resource types: agent, prompt, protocol, skill, infrastructure
- [ ] The `## Extensibility Model` section references `/loom-skill create` wizard
- [ ] The `## Extensibility Model` section includes a `### Authoring Resources` sub-section with resource-type decision tree
- [ ] `grep -c "extensible" README.md` ≥ 1
- [ ] `grep -n "## Extending Loom" README.md` returns exactly one line and it appears above install instructions
- [ ] README `## Extending Loom` section contains a positioning paragraph contrasting platform model against fixed-methodology alternatives
- [ ] No duplicate extensibility content remains elsewhere in README.md (fragmented sections at old line ranges are removed)
- [ ] `.plan-execution/stage-context/phase-0b.toon` exists

#### Wave 0 → Wave 1 Gate

<!-- F-013: explicit gate — tsc only, not bun test -->
After Phase 0 and Phase 0b complete, run `bun run tsc --noEmit` before launching Wave 1. This gate MUST pass (exit 0). Do NOT run `bun test` at this gate — the `"3->4"` no-op passthrough stub makes the migration test suite intentionally red until Phase 1 completes.

Record gate result: `.plan-execution/stage-context/wave-0-gate.toon`

#### Scenarios

```toon
id: S-15
title: CLAUDE.md Extensibility Model section is present and complete
given[1]: CLAUDE.md has been updated with the Extensibility Model section
when: The section heading is searched in CLAUDE.md
whenTriggerType: system-event
then[3]: grep -n "## Extensibility Model" CLAUDE.md MUST return exactly one line, The section MUST name all five resource types, The section MUST reference /loom-skill create
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-16
title: README contains extensible keyword and consolidated Extending Loom section
given[1]: README.md has been updated to consolidate extensibility content
when: grep is run for extensible and for the Extending Loom heading
whenTriggerType: system-event
then[3]: grep -c extensible README.md MUST return a count >= 1, grep -n "## Extending Loom" README.md MUST return exactly one line, The Extending Loom section MUST appear before the install instructions heading
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 1 — Wave 1: v3→v4 Migrator Implementation

**Agent:** implementer-agent
**Objective:** Implement `migrateLibraryCatalogV3ToV4` pure function (including `requires: [skill:*]` rewrite), register it as `"3->4"` in `MIGRATIONS`, extend `detectLibraryCatalogVersion` to recognize v4, and bump `CURRENT_VERSION` to 4 and `schema-versions.toon` atomically.
**Dependencies:** Phase 0
**File Ownership:** hooks/lib/library-catalog-migrator.ts (function implementations), agents/protocols/schema-versions.toon

<!-- F-010: explicit note — Wave 1 and Wave 2 must merge as one release; no window where v4 catalog exists but installer can't honor skill: routing -->
**Release note:** Wave 1 (migrator) and Wave 2 (installer routing) MUST ship as a single merged release. There must be no window where a v4 catalog is in the wild but the installer cannot honor `skill:` routing. Do not merge Wave 1 changes independently.

<!-- F-011: CURRENT_VERSION bump moved here from Phase 0 -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `hooks/lib/library-catalog-migrator.ts` | Modify — replace `"3->4"` no-op stub with real `migrateLibraryCatalogV3ToV4(v3, opts)` implementation; register in `MIGRATIONS["3->4"]`; extend `detectLibraryCatalogVersion` for v4; **bump `CURRENT_VERSION` to 4** (moved from Phase 0 per F-011) | implementer-agent |
| `agents/protocols/schema-versions.toon` | Modify — bump `library-catalog` row `currentVersion` from 3 to 4 (atomically with `CURRENT_VERSION` bump above) | implementer-agent |

<!-- F-002: requires: [skill:*] → requires: [protocol:*] rewrite implemented here -->

#### Acceptance Criteria

- [ ] `migrateLibraryCatalogV3ToV4` correctly renames `library.skills` → `library.protocols` and initializes `library.skills: []`
- [ ] `migrateLibraryCatalogV3ToV4` rewrites all agent `requires:` items prefixed `skill:` to `protocol:` prefix
- [ ] `migrateLibraryCatalogV3ToV4` throws `MigrationSchemaVersionMismatchError` when input `catalog_version !== 3`
- [ ] `migrateToLatest(v3Input, 3, opts)` returns a v4 object
- [ ] `migrateToLatest(v4Input, 4, opts)` returns input unchanged (idempotency)
- [ ] `migrateToLatest(v2Input, 2, opts)` chains v2→v3→v4 and returns v4 object
- [ ] `detectLibraryCatalogVersion` returns `{ version: 4, outdated: false }` for a valid v4 catalog string
- [ ] `CURRENT_VERSION` constant equals `4` in `hooks/lib/library-catalog-migrator.ts`
- [ ] `schema-versions.toon` row for `library-catalog` has `currentVersion: 4`
- [ ] Both `CURRENT_VERSION` and `schema-versions.toon` values agree at 4 (parity)
- [ ] `bun run tsc --noEmit` exits with code 0

#### Convergence Targets

- `migrateToLatest(v3Input, 3, opts)` output JSON-deep-equals fixture `v4-expected.yaml` (ignore: `releasedAt` timestamps)
- `migrateToLatest(v4Input, 4, opts)` output is byte-equivalent to `v4-idempotency-input.yaml`

#### Scenarios

```toon
id: S-03
title: v3 catalog migrates cleanly to v4 with protocol rename and requires rewrite
given[2]: A valid v3 library.yaml with library.skills containing one protocol entry and an agent with requires:[skill:some-protocol] exists, migrateLibraryCatalogV3ToV4 is called with the parsed object
when: migrateLibraryCatalogV3ToV4 is invoked
whenTriggerType: system-event
then[4]: Output catalog_version MUST equal 4, Output library.protocols MUST contain the original library.skills entries, Output library.skills MUST be an empty array, The agent entry requires array MUST contain protocol:some-protocol not skill:some-protocol
stateRef: v4
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-04
title: Chained walk from v2 to v4 produces correct shape
given[1]: A valid v2 library.yaml (no catalog_version or catalog_version: 2)
when: migrateToLatest is called with fromVersion 2 and the built-in MIGRATIONS registry
whenTriggerType: system-event
then[2]: Output catalog_version MUST equal 4, Output MUST have library.protocols and library.skills fields
stateRef: v4
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-05
title: v3->v4 migrator rejects wrong input version
given[1]: A catalog object with catalog_version: 2 is passed to migrateLibraryCatalogV3ToV4
when: migrateLibraryCatalogV3ToV4 is invoked directly
whenTriggerType: system-event
then[1]: A MigrationSchemaVersionMismatchError MUST be thrown
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-06
title: migrateToLatest is idempotent on v4 input
given[1]: A valid v4 library.yaml is parsed into an object
when: migrateToLatest is called with fromVersion 4 and targetVersion 4
whenTriggerType: system-event
then[1]: The returned object MUST be reference-identical to the input (no transformation)
stateRef: v4
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 2 — Wave 1: Migration Test Suite

**Agent:** implementer-agent
**Objective:** Write vitest test files for the v3→v4 migration, golden-file comparison against fixtures, parity test extension, and chained walk verification.
**Dependencies:** Phase 0
**File Ownership:** test/library-catalog-v3-to-v4.test.ts, test/protocol/schema-upgrade-v3.test.ts (extend only)

Note: Phase 1 and Phase 2 are in the same wave. Phase 2 reads the interface contracts from Phase 0 but does not require Phase 1's implementation to be complete — tests can be written against the interface before the implementation lands. The test runner will fail until Phase 1 completes, which is the expected state within the wave.

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `test/library-catalog-v3-to-v4.test.ts` | Create — golden-file test: load `v3-input.yaml`, call `migrateToLatest(parsed, 3, opts)`, deep-compare to `v4-expected.yaml`; idempotency test; chained v2→v4 test; error-path test for wrong input version; **test that agent `requires: [skill:*]` entries are rewritten to `requires: [protocol:*]`** | implementer-agent |
| `test/protocol/schema-upgrade-v3.test.ts` | Modify — extend parity assertion to check `library-catalog` row `currentVersion` equals `CURRENT_VERSION` (4) | implementer-agent |
| `.plan-execution/stage-context/phase-2.toon` | Create — record test files created, fixture paths, known-red status (will green after Phase 1 lands) | implementer-agent |

<!-- F-002: requires rewrite test case added -->
<!-- F-014: stage-context/phase-2.toon added -->

#### Acceptance Criteria

- [ ] `bun test test/library-catalog-v3-to-v4.test.ts` exits 0 (after Phase 1 completes)
- [ ] `bun test test/protocol/schema-upgrade-v3.test.ts` exits 0 with `CURRENT_VERSION === 4` assertion passing
- [ ] Golden-file test loads fixtures from `test-fixtures/library-catalog-migration/`
- [ ] Idempotency test passes: v4 input through `migrateToLatest` returns output structurally identical to input
- [ ] Error-path test: `migrateLibraryCatalogV3ToV4` with v2 input throws `MigrationSchemaVersionMismatchError`
- [ ] Test covers `requires: [skill:*]` → `requires: [protocol:*]` rewrite using the agent-entry fixture in `v3-input.yaml`

#### Wave 1 → Wave 2 Gate

<!-- F-023: explicit inter-wave gate between Wave 1 and Wave 2 -->
Before launching Wave 2, run both:
1. `bun test test/library-catalog-v3-to-v4.test.ts` — must exit 0
2. `bun run tsc --noEmit` — must exit 0

Record gate result: `.plan-execution/stage-context/wave-1-gate.toon`

Wave 2 MUST NOT start until this gate passes.

#### Convergence Targets

- `bun test test/library-catalog-v3-to-v4.test.ts` exits 0
- `bun test test/protocol/schema-upgrade-v3.test.ts` exits 0

#### Scenarios

```toon
id: S-07
title: Golden-file test confirms v3-to-v4 output matches expected fixture including requires rewrite
given[2]: test-fixtures/library-catalog-migration/v3-input.yaml exists with an agent entry containing requires:[skill:*], test-fixtures/library-catalog-migration/v4-expected.yaml exists with the rewritten requires:[protocol:*]
when: bun test test/library-catalog-v3-to-v4.test.ts is executed
whenTriggerType: system-event
then[3]: Test suite MUST exit with code 0, Every field in the output MUST match v4-expected.yaml (ignoring releasedAt timestamps), The requires array rewrite assertion MUST pass
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-08
title: Parity test passes with CURRENT_VERSION at 4
given[1]: schema-versions.toon library-catalog currentVersion is 4 and CURRENT_VERSION constant is 4
when: bun test test/protocol/schema-upgrade-v3.test.ts is executed
whenTriggerType: system-event
then[1]: Test MUST exit with code 0 with no parity-drift assertion failures
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

<!-- F-005/F-006/X-02: Phase 3 now wires skill-router.ts (extracted in Phase 0) into loom-library.md -->
<!-- F-015: ordered implementation sequence added -->
<!-- F-021: remove behavior spec added -->
<!-- F-025: /loom-library status added -->
<!-- F-008: post-install restart notice added as AC -->
### Phase 3 — Wave 2: Installer Routing for Native Skills

**Agent:** implementer-agent
**Objective:** Extend `commands/loom-library.md` to wire `skill-router.ts` helper functions for routing `skill:` typed items to `~/.claude/skills/<name>/SKILL.md`, add typed `includes:` parsing, expand source-validation, record `type: skill` in install-state, add remove behavior for skill items, and add `/loom-library status` command.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-library.md

<!-- F-015: ordered implementation sequence -->
**Implementation sequence (restart-safe — each step is idempotent):**
1. Extend source-validation allowed-prefix check to include `~/.claude/skills/`
2. Add typed `includes:` parser (delegate to `skill-router.ts#parseIncludeEntry`)
3. Add skill routing logic (delegate to `skill-router.ts#buildSkillTargetPath`, `buildSkillInstallRecord`)
4. Update install-state write to record `type: skill` entries
5. Add remove path for skill items (delegate to `skill-router.ts#buildSkillRemovePlan`)
6. Add `/loom-library status` command outputting installed kits, type, targetPath, triggers

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-library.md` | Modify — (1) extend source-validation; (2) add typed `includes:` parsing via `skill-router.ts`; (3) add skill routing via `skill-router.ts`; (4) update install-state write; (5) add skill remove path; (6) add `/loom-library status` command; (7) add `NOT_IN_CATALOG` error handling; (8) add post-install session-restart notice | implementer-agent |

<!-- F-007: NOT_IN_CATALOG error handling added -->
<!-- F-008: post-install restart notice added -->
<!-- F-021: remove path added -->
<!-- F-024: DEPRECATION_WARNING uses specified template string -->
<!-- F-025: /loom-library status added -->

#### Acceptance Criteria

- [ ] `/loom-library use python-conventions` writes `~/.claude/skills/python-conventions/SKILL.md` with literal filename
- [ ] After install, `install-state.toon` `items[]` contains entry with `type: skill` and `targetPath` ending in `/SKILL.md`
- [ ] Post-install notice printed: `"Skill python-conventions installed. Restart your Claude Code session for trigger activation to take effect."`
- [ ] Kit `includes: [skill:python-conventions]` resolves correctly — typed form with no warning
- [ ] Kit `includes: [python-conventions]` (bare name) logs `DEPRECATION_WARNING` using the exact template string in Error Handling Specification
- [ ] Source-validation rejects target paths outside `~/.claude/skills/` and `~/.claude/agents/`
- [ ] `/loom-library use <nonexistent>` outputs `NOT_IN_CATALOG` error with message: `"No kit or skill named <nonexistent> found in library.yaml. Run /loom-library list to see available entries."`
- [ ] `/loom-library remove python-conventions` deletes `~/.claude/skills/python-conventions/SKILL.md` and prunes the empty parent directory
- [ ] After remove, the corresponding `items[]` entry is absent from `install-state.toon`
- [ ] `/loom-library status` outputs installed kits, resource type, targetPath, and triggers for skill items
- [ ] Existing `data-engineering` kit (bare-name `includes:`) installs cleanly with deprecation warning logged — no breakage

#### Convergence Targets

- After `/loom-library use python-conventions`: `ls ~/.claude/skills/python-conventions/SKILL.md` exits 0
- `install-state.toon` `items[]` contains entry with `type: skill` after install
- `/loom-library use data-engineering` succeeds (exit 0) with deprecation warning in log
- `/loom-library use nonexistent-kit` outputs `NOT_IN_CATALOG` error

#### Scenarios

```toon
id: S-09
title: Skill item installs to correct path with literal SKILL.md filename and restart notice
given[2]: python-conventions skill entry exists in library.yaml library.skills, /loom-library use python-conventions is invoked
when: The installer processes the skill item
whenTriggerType: actor-action
then[3]: The file ~/.claude/skills/python-conventions/SKILL.md MUST exist, The install-state.toon items[] MUST contain an entry with type: skill and targetPath ending in /SKILL.md, The output MUST contain the restart notice text
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-10
title: Legacy bare-name include logs deprecation warning with specified message template
given[2]: A kit with includes:[python-conventions] (bare name no type prefix), The python-conventions skill exists in library.yaml
when: /loom-library use <that-kit> is invoked
whenTriggerType: actor-action
then[2]: Install MUST succeed, A DEPRECATION_WARNING MUST be logged with the exact template message referencing the bare-name resolution
stateRef:
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

```toon
id: S-11
title: Source validation rejects path outside allowed directories
given[1]: A kit includes an item with targetPath outside ~/.claude/skills/ and ~/.claude/agents/
when: The installer source-validation check runs
whenTriggerType: system-event
then[1]: The install MUST abort with SOURCE_VALIDATION_ERROR before writing any files
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-21
title: NOT_IN_CATALOG error returned for unknown kit name
given[1]: library.yaml does not contain a kit or skill named nonexistent-kit
when: /loom-library use nonexistent-kit is invoked
whenTriggerType: actor-action
then[2]: The command MUST exit with an error, The output MUST contain the NOT_IN_CATALOG message text including the loom-library list hint
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-22
title: Skill remove deletes SKILL.md and prunes empty parent directory
given[2]: python-conventions skill is installed at ~/.claude/skills/python-conventions/SKILL.md, No other files exist in ~/.claude/skills/python-conventions/
when: /loom-library remove python-conventions is invoked
whenTriggerType: actor-action
then[3]: ~/.claude/skills/python-conventions/SKILL.md MUST not exist, The directory ~/.claude/skills/python-conventions/ MUST not exist (pruned as empty), The items[] entry for python-conventions MUST be removed from install-state.toon
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

<!-- F-005/F-006/X-02: Phase 4 now imports from skill-router.ts (extracted Phase 0) instead of depending on markdown command -->
### Phase 4 — Wave 2: Installer Routing Test Suite

**Agent:** implementer-agent
**Objective:** Write vitest tests for `skill-router.ts` pure functions: skill path construction, typed `includes:` parsing, bare-name deprecation path, source-validation rejection, and skill remove plan.
**Dependencies:** Phase 0, Phase 3
**File Ownership:** test/installer-skill-routing.test.ts

**Note:** Tests import from `hooks/lib/skill-router.ts` (pure functions extracted in Phase 0) — not from the markdown command file. This is the resolution for F-005/F-006/X-02: vitest can import the TypeScript module directly without requiring the Phase 3 markdown to be "runnable".

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `test/installer-skill-routing.test.ts` | Create — tests for: `buildSkillTargetPath` path construction (`~/.claude/skills/<name>/SKILL.md`); `parseIncludeEntry` typed and bare-name forms; `validateInstallPath` rejection for out-of-bounds paths; `resolveBareNameInclude` section-priority order; `buildSkillRemovePlan` output shape | implementer-agent |

#### Acceptance Criteria

- [ ] `bun test test/installer-skill-routing.test.ts` exits 0
- [ ] Test imports from `hooks/lib/skill-router.ts` (not from `commands/loom-library.md`)
- [ ] Test confirms `buildSkillTargetPath("python-conventions")` === `~/.claude/skills/python-conventions/SKILL.md`
- [ ] Test confirms `parseIncludeEntry("python-conventions")` returns `{ bare: true, ... }` (triggers deprecation warning flag)
- [ ] Test confirms `validateInstallPath` returns `{ valid: false }` for disallowed paths
- [ ] Test covers `buildSkillRemovePlan` returning correct path and parent dir

#### Convergence Targets

- `bun test test/installer-skill-routing.test.ts` exits 0

#### Scenarios

```toon
id: S-12
title: Installer skill-routing test suite passes importing from skill-router.ts
given[1]: test/installer-skill-routing.test.ts imports pure functions from hooks/lib/skill-router.ts
when: bun test test/installer-skill-routing.test.ts is executed
whenTriggerType: system-event
then[2]: All tests MUST pass and the suite MUST exit with code 0, No test MUST import from or depend on commands/loom-library.md
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

<!-- F-009: Phase 3 added to Phase 5 dependency list -->
<!-- F-022: Phase 5 writes into v4-shape library.yaml (bumped in Phase 0); grep strengthened -->
### Phase 5 — Wave 2: `python-conventions` Sample Skill Kit

**Agent:** implementer-agent
**Objective:** Author the `python-conventions` SKILL.md with correct triggers and conventions body, register it in the v4-shape `library.yaml`, and add a minimal `python-conventions` kit entry.
**Dependencies:** Phase 0, Phase 3
**File Ownership:** skills/python-conventions/**, skills/library.yaml

**Note on `skills/library.yaml`:** Phase 0 already bumped this file to v4 shape (`library.protocols:` + `library.skills:` sections). Phase 5 appends into the existing `library.skills:` section — no further shape migration needed.

<!-- F-022: strengthened grep target checks below library.protocols: section -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `skills/python-conventions/SKILL.md` | Create — YAML frontmatter with `name`, `description`, `triggers: ["**/*.py", "**/pyproject.toml", "**/requirements.txt"]`; body with Polars-first for new code, uv/ruff/pytest tooling, atomic writes for generated outputs, type hints on public functions, TOON format for Loom artifacts | implementer-agent |
| `skills/library.yaml` | Modify — append `python-conventions` entry under `library.skills:` section (already in v4 shape); append `python-conventions` kit under `kits:` with `includes: [skill:python-conventions]` | implementer-agent |
| `.plan-execution/stage-context/phase-5.toon` | Create — record SKILL.md path, triggers list, library.yaml section confirmed at v4 | implementer-agent |

<!-- F-014: stage-context/phase-5.toon added -->

#### Acceptance Criteria

- [ ] `skills/python-conventions/SKILL.md` exists with valid YAML frontmatter containing `triggers:`, `name:`, `description:`
- [ ] `triggers:` includes `**/*.py`, `**/pyproject.toml`, `**/requirements.txt`
- [ ] `library.yaml` `library.skills:` section contains a `python-conventions` entry pointing at `skills/python-conventions/SKILL.md`
- [ ] `library.yaml` `kits:` section contains a `python-conventions` kit with `includes: [skill:python-conventions]`
- [ ] Skill body covers: Polars-first (new code), keep Pandas in existing code, uv/ruff/pytest, atomic file writes, type hints on public functions, TOON output for Loom artifacts
- [ ] `grep -A5 'library.protocols:' skills/library.yaml` shows the v4 protocols section is present (confirming v4 shape)
- [ ] `grep -A50 'library.skills:' skills/library.yaml | grep 'python-conventions'` returns at least one match (entry is below `library.skills:`)
- [ ] `grep 'python-conventions' skills/library.yaml | wc -l` ≥ 2 (one in library.skills, one in kits)

#### Convergence Targets

- `ls skills/python-conventions/SKILL.md` exits 0
- `grep 'triggers:' skills/python-conventions/SKILL.md` returns at least one line
- `grep -A50 'library.skills:' skills/library.yaml | grep 'python-conventions'` returns ≥ 1 match (not just any line — must be below the skills section header)

#### Scenarios

```toon
id: S-13
title: python-conventions SKILL.md has valid frontmatter with triggers
given[1]: skills/python-conventions/SKILL.md exists
when: The file's YAML frontmatter is parsed
whenTriggerType: system-event
then[3]: The frontmatter MUST contain a non-empty name field, The frontmatter MUST contain a non-empty description field, The frontmatter MUST contain a triggers array with at least **/*.py
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-14
title: library.yaml v4 skills section registers python-conventions
given[1]: skills/library.yaml has been updated with v4 shape and python-conventions registered
when: grep is run for python-conventions in the library.skills section of skills/library.yaml
whenTriggerType: system-event
then[2]: At least one match MUST appear below library.skills: section header, At least one match MUST appear in the kits: section
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

<!-- F-016: loom-upgrade.md update added to Phase 6 deliverables -->
### Phase 6 — Wave 3: Schema Docs, DeltaBlock Seed, loom-upgrade v4 awareness

**Agent:** implementer-agent
**Objective:** Add `deliverableId?` field to `change-proposal.schema.md`, update `kit.schema.md` with typed `includes:` documentation, and update `commands/loom-upgrade.md` to recognize v4 catalog as current (so Phase 7's dry-run criterion is traceable).
**Dependencies:** Phase 0, Phase 1, Phase 3, Phase 5
**File Ownership:** agents/protocols/change-proposal.schema.md, agents/protocols/kit.schema.md, commands/loom-upgrade.md

**Note:** `CLAUDE.md` and `README.md` extensibility documentation was promoted to Phase 0b. This phase handles the remaining schema and tooling docs only.

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `agents/protocols/change-proposal.schema.md` | Modify — add `deliverableId?: string` field to DeltaBlock spec with description "Reserved for future per-deliverable approval lifecycle; safe to omit" | implementer-agent |
| `agents/protocols/kit.schema.md` | Modify — document typed `includes:` entries with the `skill:` resource type; document bare-name backward-compatible fallback timeline (drops in v5) | implementer-agent |
| `commands/loom-upgrade.md` | Modify — extend v4 awareness: recognize `catalog_version: 4` + `library.protocols:` markers as current (not outdated); update scan list to classify v3 catalogs (missing `library.protocols:`) as outdated with `action: auto` and Rule 13; deprecate any v3-only detection patterns | implementer-agent |
| `.plan-execution/stage-context/phase-6.toon` | Create — record files modified, confirm loom-upgrade.md v4 classification logic added | implementer-agent |

<!-- F-016: loom-upgrade.md added; Phase 7 /loom-upgrade criterion is now traceable -->
<!-- F-014: stage-context/phase-6.toon added -->

#### Acceptance Criteria

- [ ] `grep -n "deliverableId" agents/protocols/change-proposal.schema.md` returns at least one line
- [ ] `grep -n "skill:" agents/protocols/kit.schema.md` returns at least one line (typed include example)
- [ ] `grep -n "catalog_version.*4" commands/loom-upgrade.md` returns at least one line (v4 recognized as current)
- [ ] `grep -n "Rule 13" commands/loom-upgrade.md` returns at least one line (v3 classified as outdated with Rule 13)
- [ ] `bun run tsc --noEmit` exits 0 (no TS changes, but sanity check)

#### Convergence Targets

- `grep -n "deliverableId" agents/protocols/change-proposal.schema.md` ≥ 1 line
- `grep -n "skill:" agents/protocols/kit.schema.md` ≥ 1 line
- `grep -n "Rule 13" commands/loom-upgrade.md` ≥ 1 line

#### Scenarios

```toon
id: S-17
title: deliverableId field appears in change-proposal schema
given[1]: agents/protocols/change-proposal.schema.md has been updated
when: grep is run for deliverableId in the file
whenTriggerType: system-event
then[1]: grep -n deliverableId agents/protocols/change-proposal.schema.md MUST return at least one line
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-23
title: loom-upgrade.md recognizes v4 as current and v3 as outdated with Rule 13
given[1]: commands/loom-upgrade.md has been updated with v4 catalog awareness
when: grep is run for Rule 13 in commands/loom-upgrade.md
whenTriggerType: system-event
then[2]: grep -n "Rule 13" commands/loom-upgrade.md MUST return at least one line, v4 catalog markers must be documented as the current (non-outdated) state
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 7 — Wave 4: Wiring, Install Test, and Final Verification

**Agent:** wiring-agent
**Objective:** Wire all outputs — run the full test suite, confirm install smoke test, verify `/loom-upgrade --project --dry-run` classifies v3 catalogs correctly, and confirm backward compatibility of `data-engineering` kit.
**Dependencies:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6
**File Ownership:** test/kit-python-conventions-install.test.ts

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `test/kit-python-conventions-install.test.ts` | Create — integration test: exercises the full install path for `python-conventions` kit; confirms `~/.claude/skills/python-conventions/SKILL.md` is written; confirms install-state entry with `type: skill`; confirms restart notice in output | wiring-agent |
| `.plan-execution/stage-context/phase-7.toon` | Create — record final verification results, any open warnings, Wave 4 exit status | wiring-agent |

<!-- F-014: stage-context/phase-7.toon added -->

#### Acceptance Criteria

- [ ] `bun test` (full suite) exits 0
- [ ] `bun test test/kit-python-conventions-install.test.ts` exits 0
- [ ] `bun test test/library-catalog-v3-to-v4.test.ts` exits 0
- [ ] `bun test test/installer-skill-routing.test.ts` exits 0
- [ ] `bun test test/protocol/schema-upgrade-v3.test.ts` exits 0 (parity at 4)
- [ ] `/loom-upgrade --project --dry-run` output contains `library-catalog` entry with action `auto` and references Rule 13 for v3 catalogs
- [ ] `/loom-library use data-engineering` completes without error (deprecation warning logged, no failure)
- [ ] `ls skills/python-conventions/SKILL.md` exits 0
- [ ] `bun run tsc --noEmit` exits 0

#### Convergence Targets

- `bun test` exits 0 (full suite)
- `/loom-library use data-engineering` exits 0
- `ls ~/.claude/skills/python-conventions/SKILL.md` exits 0 (after install test runs)
- `grep -A50 'library.skills:' skills/library.yaml | grep 'python-conventions'` returns ≥ 1 match

#### Scenarios

```toon
id: S-18
title: Full test suite passes after all phases complete
given[3]: All phase 1-6 deliverables are complete, test fixtures exist, migrator and installer changes are implemented
when: bun test is executed (full suite no filter)
whenTriggerType: system-event
then[1]: bun test MUST exit with code 0 and report zero failures
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-19
title: data-engineering kit installs cleanly via legacy bare-name includes
given[1]: The data-engineering kit in library.yaml uses legacy bare-name includes entries
when: /loom-library use data-engineering is invoked
whenTriggerType: actor-action
then[2]: The command MUST exit with code 0, A DEPRECATION_WARNING MUST appear in output for each bare-name entry
stateRef:
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

```toon
id: S-20
title: loom-upgrade dry-run classifies v3 catalog as outdated with action auto
given[1]: The project library.yaml is at catalog_version 3
when: /loom-upgrade --project --dry-run is invoked
whenTriggerType: actor-action
then[2]: Output MUST contain library-catalog in the outdated items list, Output MUST reference Rule 13 and action auto
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

## F-05 Scope Expansion: Authoring Scaffolding

<!-- F-05 scope expansion: four new deliverables for /loom-skill create wizard, /loom-library add heuristic, /loom-agent create cross-reference, and CLAUDE.md authoring section -->

The following four phases (8–11) implement the authoring scaffolding approved as the F-05 scope expansion. They are assigned to Wave 4 alongside Phase 7 (no file ownership conflicts).

---

### Phase 8 — Wave 4: `/loom-skill create` Wizard

**Agent:** implementer-agent
**Objective:** Implement the `/loom-skill create` wizard as a command at `commands/loom-skill.md` — interview-driven scaffolding that generates a `SKILL.md` with correct frontmatter and registers it in `library.yaml`.
**Dependencies:** Phase 0, Phase 3, Phase 5
**File Ownership:** commands/loom-skill.md

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-skill.md` | Create — `/loom-skill create` wizard implementing the interview flow: (1) ask for skill name (slug validation); (2) ask for description; (3) ask whether file-triggered (offer glob examples) or description-activated (omit triggers); (4) generate `SKILL.md` with frontmatter (`name:`, `description:`, optional `triggers:`); (5) write to `skills/<name>/SKILL.md`; (6) append entry under `library.skills:` in `skills/library.yaml`; (7) ask whether to add to a kit's `includes:` (offer kit name input); (8) print confirmation and restart notice | implementer-agent |

#### Acceptance Criteria

- [ ] `commands/loom-skill.md` exists as a valid Claude Code command file
- [ ] The wizard interview includes: name, description, trigger-or-description-activated choice, optional kit registration
- [ ] Generated SKILL.md has valid YAML frontmatter with at minimum `name:` and `description:`
- [ ] When file-triggered: `triggers:` frontmatter is included with the user-supplied glob patterns
- [ ] When description-activated: `triggers:` frontmatter is omitted
- [ ] The generated entry appears under `library.skills:` in `skills/library.yaml`
- [ ] If the user names a kit in step 7, that kit's `includes:` gains a `skill:<name>` typed entry
- [ ] Confirmation output includes the restart-session notice

#### Convergence Targets

- `ls commands/loom-skill.md` exits 0
- `grep -n "loom-skill create" commands/loom-skill.md` returns at least one line

#### Scenarios

```toon
id: S-24
title: /loom-skill create wizard generates file-triggered SKILL.md and registers in library.yaml
given[2]: commands/loom-skill.md exists, The user provides name=my-skill description=test triggered by **/*.ts
when: /loom-skill create is invoked and interview answers are supplied
whenTriggerType: actor-action
then[3]: skills/my-skill/SKILL.md MUST exist with triggers: containing **/*.ts, library.yaml library.skills section MUST contain a my-skill entry, The confirmation output MUST contain the restart-session notice
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-25
title: /loom-skill create wizard generates description-activated SKILL.md without triggers
given[2]: commands/loom-skill.md exists, The user selects description-activated (no triggers)
when: /loom-skill create is invoked and description-activated is chosen
whenTriggerType: actor-action
then[2]: The generated SKILL.md frontmatter MUST NOT contain a triggers: key, The library.yaml entry MUST still be registered
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

---

### Phase 9 — Wave 4: `/loom-library add` Heuristic Update

**Agent:** implementer-agent
**Objective:** Update the content-classification heuristic in `commands/loom-library.md` to correctly distinguish between native skills (SKILL.md + triggers) and protocol files (inter-agent schema markers) in the post-v4 catalog.
**Dependencies:** Phase 0, Phase 3
**File Ownership:** commands/loom-library.md

**Note:** Phase 3 already modifies `commands/loom-library.md`. Phase 9 is a separate, later modification scoped only to the `add` subcommand's classification heuristic. Both phases are in Wave 4 and there is no file ownership conflict (Phase 3 completes in Wave 2 before Phase 9 begins in Wave 4).

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-library.md` | Modify — update `/loom-library add` classification heuristic: (1) SKILL.md filename + `triggers:` frontmatter → `type: skill`; (2) presence of inter-agent schema markers (AgentResult, state.toon, etc.) → `type: protocol`; (3) `$ARGUMENTS` → `type: prompt`; (4) agent-style markers → `type: agent`; (5) ambiguous → prompt user to choose type explicitly | implementer-agent |

#### Acceptance Criteria

- [ ] A file named `SKILL.md` with `triggers:` frontmatter is classified as `type: skill` by the heuristic
- [ ] A file containing `AgentResult` or `state.toon` schema markers is classified as `type: protocol`
- [ ] A file that is ambiguous between skill and protocol prompts the user to choose
- [ ] Existing classifications (`$ARGUMENTS` → prompt, agent-style → agent) are unchanged
- [ ] `grep -n "SKILL.md" commands/loom-library.md` returns at least one line (heuristic references the filename)

#### Convergence Targets

- `grep -n "SKILL.md" commands/loom-library.md` returns ≥ 1 line
- `grep -n "type: skill" commands/loom-library.md` returns ≥ 1 line (heuristic output documented)

#### Scenarios

```toon
id: S-26
title: /loom-library add classifies SKILL.md with triggers as type:skill
given[1]: A file named SKILL.md with triggers: frontmatter is passed to /loom-library add
when: The classification heuristic runs
whenTriggerType: actor-action
then[1]: The heuristic MUST classify the file as type: skill without user prompt
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-27
title: /loom-library add classifies inter-agent schema file as type:protocol
given[1]: A file containing AgentResult schema markers is passed to /loom-library add
when: The classification heuristic runs
whenTriggerType: actor-action
then[1]: The heuristic MUST classify the file as type: protocol without user prompt
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-28
title: /loom-library add prompts user for ambiguous files
given[1]: A file that matches neither SKILL.md pattern nor schema markers is passed
when: The classification heuristic runs
whenTriggerType: actor-action
then[1]: The heuristic MUST prompt the user to choose the resource type explicitly
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

---

### Phase 10 — Wave 4: `/loom-agent create` Cross-Reference Update

**Agent:** implementer-agent
**Objective:** Update `commands/loom-agent.md` wizard Step 1 to mention `/loom-skill create` as an alternative when the user describes intent-routing or domain-knowledge work rather than actor work.
**Dependencies:** Phase 0b, Phase 8
**File Ownership:** commands/loom-agent.md

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-agent.md` | Modify — add one paragraph to the wizard's Step 1 (or equivalent first interview step) mentioning: "If your goal is applying domain conventions (e.g., coding style, framework preferences) rather than orchestrating actor work, consider `/loom-skill create` instead. Skills activate automatically on matching files and require no orchestration overhead." | implementer-agent |
| `.plan-execution/stage-context/phase-10.toon` | Create — record files modified, confirm cross-reference paragraph location | implementer-agent |

<!-- F-014: stage-context/phase-10.toon added -->

#### Acceptance Criteria

- [ ] `grep -n "loom-skill create" commands/loom-agent.md` returns at least one line
- [ ] The added paragraph appears within the first interview step of the wizard (Step 1 or equivalent)
- [ ] The paragraph mentions "domain conventions" or "domain knowledge" as the differentiating use case
- [ ] Existing wizard steps and behavior are otherwise unchanged

#### Convergence Targets

- `grep -n "loom-skill create" commands/loom-agent.md` returns ≥ 1 line

#### Scenarios

```toon
id: S-29
title: loom-agent create wizard Step 1 cross-references loom-skill create
given[1]: commands/loom-agent.md has been updated
when: grep is run for loom-skill create in commands/loom-agent.md
whenTriggerType: system-event
then[2]: grep -n "loom-skill create" commands/loom-agent.md MUST return at least one line, The line MUST appear within the Step 1 section of the wizard
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 11 — Wave 4: CLAUDE.md Authoring Section

**Agent:** implementer-agent
**Objective:** Add a `### Authoring Resources` sub-section under `## Extensibility Model` in `CLAUDE.md` covering: how to author a skill (pointing at `/loom-skill create`), how to author a kit (hand-edit pattern; note `/loom-kit create` is future work), and the resource-type decision tree.
**Dependencies:** Phase 0b, Phase 8, Phase 10
**File Ownership:** CLAUDE.md

**Note:** Phase 0b already added the `## Extensibility Model` section skeleton. Phase 11 fills in the `### Authoring Resources` sub-section with the full decision tree and wizard references.

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `CLAUDE.md` | Modify — expand or confirm `### Authoring Resources` sub-section under `## Extensibility Model` with: (1) "How to author a skill: run `/loom-skill create`"; (2) "How to author a kit: hand-edit `skills/library.yaml` — add entry under `library.skills:` and a `kits:` entry with typed `includes:`. (`/loom-kit create` wizard is future work)."; (3) resource-type decision tree (agent: orchestrates work; prompt: reusable instruction; protocol: inter-agent schema; skill: domain conventions that activate by file pattern; infrastructure: shared tooling) | implementer-agent |

#### Acceptance Criteria

- [ ] `grep -n "### Authoring Resources" CLAUDE.md` returns exactly one line
- [ ] The sub-section references `/loom-skill create`
- [ ] The sub-section references `/loom-kit create` as future work
- [ ] The resource-type decision tree covers all five types: agent, prompt, protocol, skill, infrastructure
- [ ] The decision tree is expressed as a list or table (not prose only) for cold-read scannability
- [ ] `bun run tsc --noEmit` exits 0 (sanity — no TS changes expected)

#### Convergence Targets

- `grep -n "### Authoring Resources" CLAUDE.md` returns exactly 1 line
- `grep -n "loom-skill create" CLAUDE.md` returns ≥ 1 line (already added in 0b; confirmed present)

#### Scenarios

```toon
id: S-30
title: CLAUDE.md Authoring Resources sub-section is present with decision tree
given[1]: CLAUDE.md has been updated with the Authoring Resources sub-section
when: The sub-section is read
whenTriggerType: system-event
then[3]: grep -n "### Authoring Resources" CLAUDE.md MUST return exactly one line, The sub-section MUST list all five resource types in the decision tree, The sub-section MUST reference /loom-skill create and /loom-kit create (as future work)
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

## Verification Commands

```bash
# Type-check all TS (Wave 0 gate — no bun test at this stage)
bun run tsc --noEmit

# Migration tests (Wave 1 gate + Wave 2 prerequisite)
bun test test/library-catalog-v3-to-v4.test.ts

# Parity test (schema-versions.toon ↔ CURRENT_VERSION)
bun test test/protocol/schema-upgrade-v3.test.ts

# Installer routing tests (import from skill-router.ts)
bun test test/installer-skill-routing.test.ts

# python-conventions install integration test
bun test test/kit-python-conventions-install.test.ts

# Full test suite
bun test

# Skill file exists
ls skills/python-conventions/SKILL.md

# library.yaml v4 shape confirmed
grep 'library.protocols:' skills/library.yaml
grep -A50 'library.skills:' skills/library.yaml | grep 'python-conventions'

# README has extensible keyword
grep -c 'extensible' README.md

# CLAUDE.md has Extensibility Model section
grep -n '## Extensibility Model' CLAUDE.md

# CLAUDE.md has Authoring Resources sub-section
grep -n '### Authoring Resources' CLAUDE.md

# deliverableId field in change-proposal schema
grep -n 'deliverableId' agents/protocols/change-proposal.schema.md

# loom-upgrade.md v4 awareness
grep -n 'Rule 13' commands/loom-upgrade.md

# /loom-skill create wizard exists
ls commands/loom-skill.md

# /loom-library add heuristic references SKILL.md
grep -n 'SKILL.md' commands/loom-library.md

# /loom-agent create cross-reference to /loom-skill create
grep -n 'loom-skill create' commands/loom-agent.md

# data-engineering kit backward compat (manual smoke test)
# /loom-library use data-engineering  →  exits 0, deprecation warning in output

# install-state audit contract exists
ls .plan-execution/contracts/install-state-audit.toon

# catalog-v4-exports contract exists
ls .plan-execution/contracts/catalog-v4-exports.toon
```

---

## Milestones

### M-01: Schema and installer ship native skill support

**Phases:** 0, 0b, 1, 2, 3, 4
**Wave boundary:** End of Wave 2
**Acceptance:**
- Library catalog migrator walks v3 → v4 cleanly (parity test green, idempotency test green, chained walk from v2 produces correct shape)
- `requires: [skill:*]` references on agent entries are rewritten to `requires: [protocol:*]`
- `/loom-library use <skill-name>` writes to `~/.claude/skills/<name>/SKILL.md` with literal filename
- install-state records `type: skill` entries
- `/loom-upgrade --project --dry-run` correctly classifies v3 catalogs as outdated
- `CLAUDE.md` carries a load-bearing `## Extensibility Model` section
- `README.md` carries a consolidated `## Extending Loom` section containing the word "extensible"

### M-02: First skill kit ships and extensibility becomes discoverable

**Phases:** 5, 6, 7
**Wave boundary:** End of Wave 4 (first part)
**Acceptance:**
- `python-conventions` skill installs via `/loom-library use python-conventions` and is positioned for auto-activation on `.py` files
- `change-proposal.schema.md` records optional `deliverableId?` for the future per-deliverable approval workflow
- `commands/loom-upgrade.md` recognizes v4 catalog as current

### M-03: Authoring scaffolding ships (F-05 scope expansion)

**Phases:** 8, 9, 10, 11
**Wave boundary:** End of Wave 4 (concurrent with M-02)
**Acceptance:**
- `/loom-skill create` wizard generates SKILL.md and registers in library.yaml
- `/loom-library add` heuristic correctly classifies SKILL.md + triggers as `type: skill`
- `/loom-agent create` wizard Step 1 cross-references `/loom-skill create`
- `CLAUDE.md` `### Authoring Resources` sub-section includes full resource-type decision tree

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| External tools grep `library.skills:` and break post-rename | Phase 3 implementer audits `install.sh`, `hooks/loom-update-checker.cjs`, `commands/loom-upgrade.md` for hardcoded references before modifying catalog |
| Typo in installer's target path breaks Claude Code activation | Phase 4 test asserts exact suffix `/SKILL.md` via snapshot; Phase 7 smoke test confirms file presence |
| `install-state.toon` `items[].type` is a closed enum | Phase 0 contracts-agent reads `hooks/lib/install-state-migrator.ts` and records findings in `.plan-execution/contracts/install-state-audit.toon`; if closed enum found, Phase 1/3 scope expands to add `skill` to the enum |
| Parity drift between `schema-versions.toon` and `CURRENT_VERSION` | Both updated atomically in Phase 1 (not Phase 0); parity test in Phase 2 enforces drift detection |
| F-04 docs referencing field names that change late during F-01/F-02 | Phase 0b (docs) sequenced in Wave 0 with no code deps — but uses only final schema names from the Schema section which is locked in Phase 0 |
| Wave 1 + Wave 2 deployed independently — v4 catalog with no skill routing | Explicitly blocked: release notes and plan conventions state Wave 1 + Wave 2 must merge as one release |
| `/loom-skill create` generates invalid SKILL.md frontmatter | Phase 8 acceptance criteria verify both frontmatter validity and `triggers:` vs no-triggers paths |

## Out of Scope

- **loom-bugfix-routing, loom-quick-routing, loom-git-routing migration** — deferred to follow-on; will use the new `/loom-skill create` wizard once it lands (F-004 deferred per user decision)
- **Per-deliverable approval behavior** — no `/loom-deliverable` command, no `.loom/deliverables/` state directory, no new schema file. Only the additive `deliverableId?` field on the existing change-proposal schema
- **Long-form `docs/extending-loom.md`** — defer until 2–3 sample kits exist; CLAUDE.md + README updates are sufficient for this release
- **`/loom-kit create` wizard** — acknowledged as gap; future work; the hand-edit pattern and Phase 11's CLAUDE.md authoring section document the workaround
- **`dbt-platform` sample kit** — chosen over for `python-conventions`; natural follow-on once the skill pattern is proven
- **install-state schema bump** — included ONLY if the Phase 0 audit (`.plan-execution/contracts/install-state-audit.toon`) finds `items[].type` is a closed enum; otherwise install-state stays at its current version with `skill` accepted as new open-string value
- **Wave 3 parallelization** (F-026) — skipped per user decision
- **Wave 4 fold** (F-027) — skipped per user decision

---
description: "Scan for old-format Loom artifacts and migrate them to current schema versions"
---
# /loom-upgrade

Scans the project for outdated Loom artifacts and migrates them to the current schema version, with backup.

Two scopes are available:
- **Default (no flag)**: migrates in-flight execution artifacts (`.plan-execution/` files, PLAN.md) — Rules 1-5
- **`--project`**: full project infrastructure audit + migration (orchestration.toml, CLAUDE.md, hooks, wiki, protocols, roadmap) — Rules 1-11

## Requirements

$ARGUMENTS

Parse flags from the arguments string.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Show migration plan without modifying any files. Prints what would be changed and exits. |
| `--force` | `false` | Skip confirmation prompt and apply migrations immediately. |
| `--project` | `false` | Run full project infrastructure upgrade (Rules 6-13) in addition to execution artifact migration (Rules 1-5). |
| `--backup-dir <path>` | `.plan-execution/backups/{timestamp}/` | Override the default backup directory path. |
| `--from-version <schema>=<N>` | (detect) | **Testing/debugging only.** Forces a specific source version for one schema, bypassing detection. Repeatable. Example: `--from-version install-state=2 --from-version library-catalog=2`. Useful when fixtures predate the detector or you're testing the chained walker against synthetic input. |
| `--to-version <schema>=<N>` | (latest) | **Testing/debugging only.** Forces a specific target version (defaults to `CURRENT_VERSION` from the migrator module). Lets you stop the chain partway. Example: `--to-version install-state=3` will halt at v3 even if v4 exists. |

### Execution Steps

Read migration rules from `protocols/schema-upgrade.md`. The schema-upgrade protocol defines 13 artifact types with version detection logic and migration rules. Schema-to-current-version mappings live in `protocols/schema-versions.toon` — that registry is the single source of truth for "what version is current."

For schemas with `migratorKind: module` in the registry (currently `install-state` and `library-catalog`), migration uses the chained walker pattern: `migrateToLatest(parsed, fromVersion, opts, targetVersion?)` walks every step in the schema's `MIGRATIONS` map from `fromVersion` to `targetVersion`. A user upgrading from v2 directly to v5 gets v2→v3→v4→v5 executed in sequence — no special handling needed. See "Adding a new schema version" in schema-upgrade.md for the pattern.

Follow the schema-upgrade.md protocol exactly.

#### Step 1: Scan

Scan the project for artifacts that may need migration.

**Always scan** (execution artifacts — Rules 1-5):

```
.plan-execution/state.toon          → state artifact
.plan-execution/contracts/*.md      → contract artifacts (agent-result)
.plan-execution/**/*.agent-result.toon → AgentResult artifacts
.plan-execution/criteria-plan.toon  → criteria plan artifact
PLAN.md                             → plan artifact
protocols/*.md               → protocol artifacts
```

**Additionally scan when `--project` is set** (project infrastructure — Rules 6-14):

```
.claude/orchestration.toml                          → orchestration config
ROADMAP.md                                          → roadmap format
CLAUDE.md                                           → Loom conventions
.claude/settings.json                               → hook wiring
.loom/wiki/                                         → wiki bootstrapping
protocols/                                   → protocol file completeness
~/.claude/skills/library/install-state.toon         → install-state v3
~/.claude/skills/library/library.yaml               → library catalog v3
ROADMAP.md, PLAN*.md, .plan-history/ (at root)      → plan artifact layout (Rule 14)
```

For each target found, run the appropriate version detection logic defined in `schema-upgrade.md`:

**Execution artifact detection:**
- **agent-result**: Check `.plan-execution/contracts/*.md` and any AgentResult TOON files for missing `verificationStatus` or `diagnoseLog` fields.
- **plan**: Check `PLAN.md` for structural gaps: missing YAML frontmatter, missing Schema/Type Definitions, missing structured deliverable tables, missing wave assignments, missing cross-references. Tier A/B auto-patched; Tier C agent-migrated inline.
- **state**: Check `.plan-execution/state.toon` for missing `schemaVersion` field.
- **convergence-tier**: `convergence-tier.schema.md` is a new file -- detection always returns `outdated: false`. No migration needed.
- **criteria-plan**: Check criteria plan files for missing `testTier` column in criteria arrays.

**Project infrastructure detection (only when `--project`):**
- **orchestration-config**: Check `.claude/orchestration.toml` for missing `[settings.contextBudget]`, `[wiki]`, `[domain]` sections and key fields (`contractType`, `verificationPipeline`, `dataFormat`).
- **roadmap**: Check `ROADMAP.md` for structural gaps: missing YAML frontmatter, unstructured features (no F-XX IDs), unstructured milestones (no M-XX IDs), missing data model, missing cross-references. Tier A/B auto-patched; Tier C agent-migrated inline.
- **claude-md**: Check `CLAUDE.md` for missing TOON convention, model resolution, context budget, and stage summary sections.
- **hooks**: Check `.claude/settings.json` for missing `contract-lock`, `file-ownership`, `context-budget`, `budget-tracker`, `quality-gate` hook entries.
- **wiki**: Check if `.loom/wiki/` exists and has `index.toon`.
- **protocols**: Check `protocols/` for missing required protocol files (13 files minimum).
- **install-state**: Check `~/.claude/skills/library/install-state.toon`. Outdated if `schemaVersion < 3`, missing entirely (treat as pre-v2), or v3 declared but missing `protocolVersion` / `loomCoreVersion` / `loomHooksVersion` / `catalogVersion` / `components[]`. Detection via `detectInstallStateVersion()` in `hooks/lib/install-state-migrator.ts`.
- **library-catalog**: Check `~/.claude/skills/library/library.yaml`. **Current = `catalog_version: 4` with both `library.protocols:` and `library.skills:` markers present** (returns `{version: 4, outdated: false}` — no migration needed). Outdated if `catalog_version < 4`, including: v3 catalogs (declared `catalog_version: 3`, or v3 markers detected via missing `library.protocols:` split — auto-migrated by **Rule 13** v3→v4 chain step), and v2 catalogs (declared `catalog_version: 2` or marker-only — handled by the v2→v3 step in the same Rule 13 chained walker). v3 declared but missing top-level `loomCoreVersion` / `loomHooksVersion` / `releases` is also flagged outdated. Detection via `detectLibraryCatalogVersion()` in `hooks/lib/library-catalog-migrator.ts`; migration via `migrateToLatest()` walks every registered MIGRATIONS step from the detected source version to `CURRENT_VERSION` (currently 4).
- **plan-artifact-layout (Rule 14)**: Check whether legacy planning artifacts live at the repo root and `planning/` is absent. Outdated if any of: (a) non-stub `ROADMAP.md` at root (stub detection via `isRootStub()` in `hooks/lib/planning-paths.ts` — ≤512 bytes AND ≤10 lines AND references `planning/ROADMAP.md`), (b) `PLAN.md` or `PLAN-*.md` at root, (c) `.plan-history/` directory at root — AND `planning/` does not exist (or is empty). Relocation logic in `hooks/lib/planning-paths.ts` resolvers.

Collect all files that report `outdated: true` into a migration manifest.

#### Step 2: Report (--dry-run)

If `--dry-run` is set, print the migration manifest and exit without modifying any files:

```toon
dryRunReport:
  timestamp: {ISO-8601}
  scope: {default | project}
  filesScanned: {count}
  filesNeedingMigration: {count}
  manualActionRequired: {count}
  migrations[N]{file,artifactType,reason,rule,action}:
    path/to/file,agent-result,missing verificationStatus,Rule 2,auto
    PLAN.md,plan,structural gaps — no frontmatter + no schema types + no wave assignments,Rule 3,agent
    .claude/orchestration.toml,orchestration-config,missing wiki section,Rule 6,auto
    ROADMAP.md,roadmap,structural gaps — no F-XX IDs + no data model + no cross-refs,Rule 7,agent
    .loom/wiki/,wiki,directory missing,Rule 10,scaffold
    CLAUDE.md,claude-md,missing entirely,Rule 8,manual
```

The `action` column indicates the migration type:
- `auto` — fully automatic, no follow-up needed
- `agent` — mechanical fixes applied first, then an upgrade agent spawns inline to handle structural migration (with confirmation gate)
- `scaffold` — creates empty directory structure, content population needs a separate command (`/loom-wiki ingest`)
- `manual` — cannot be auto-migrated, prints guidance for the user

Print a human-readable summary to stdout:

```
[loom:upgrade] Dry run complete.
  Scope:    {default | project}
  Scanned:  {N} targets
  Need migration: {M} targets
  Manual action needed: {K} targets
  
  Auto-migratable:
    {file1} — {reason} (Rule {N})
    {file2} — {reason} (Rule {N})

  Scaffolding (will create empty structure):
    .loom/wiki/ — wiki directory missing (Rule 10)

  Manual action required:
    CLAUDE.md — missing entirely; run `/loom-init` (Rule 8)

No files were modified. Run `/loom-upgrade --project` (without --dry-run) to apply migrations.
```

Exit 0.

#### Step 3: Confirm

If `--force` is NOT set and there are files needing migration, print the migration plan and ask for confirmation:

```
[loom:upgrade] Found {N} targets needing migration:

  Auto:
    {file1} — {reason}
    {file2} — {reason}

  Scaffold:
    .loom/wiki/ — create empty wiki structure

  Manual (will be skipped, guidance printed after):
    CLAUDE.md — run `/loom-init`

Backup will be created at: {backup-dir}
Proceed? (y/N)
```

If the user does not confirm, print `[loom:upgrade] Aborted.` and exit 0.

#### Step 4: Backup

Create the backup directory. Default path: `.plan-execution/backups/{ISO-8601-timestamp}/` (e.g., `.plan-execution/backups/2026-04-19T14-30-00Z/`).

Copy every file that will be modified into the backup directory, preserving relative paths:

```
.plan-execution/backups/2026-04-19T14-30-00Z/
  PLAN.md
  .plan-execution/state.toon
  .plan-execution/contracts/agent-result.toon
  .claude/orchestration.toml
  .claude/settings.json
  ROADMAP.md
  CLAUDE.md
```

Only files that exist AND will be modified are backed up. New files (scaffolded wiki, created orchestration.toml) have no backup since they didn't exist before.

**Symlinked sources are skipped.** For each candidate file, `lstat` it first via `isSymlink()` from `hooks/lib/symlink-safety.ts`. If the source is a symlink (dev install, dotfile target, cross-machine portability shim), record it in the report with action=`skip-link` and do NOT copy. The migrate step will also skip these — see `schema-upgrade.md` § Symlink Safety.

Verify the backup is complete before proceeding. If any copy fails, abort with:

```
[loom:upgrade] ERROR: Backup failed for {file}. No files were modified. Aborting.
```

Exit 1.

#### Step 5: Migrate

Apply migration rules from `schema-upgrade.md` in-place. Each file is written atomically (write to `{path}.tmp`, then rename to `{path}`).

**Symlink safety (applies to ALL rules that write).** Before writing to any target — install-state, library-catalog, plan artifacts, or relocation destinations — call `isSymlink(target)` from `hooks/lib/symlink-safety.ts`. If the target is a symlink, skip the write, record action=`skip-link` in the report with the `symlinkSkipAdvisory()` string, and continue with the next file. Symlink skips are not failures — the migration as a whole still exits 0 if every other rule succeeds. See `protocols/schema-upgrade.md` § Symlink Safety for the full rationale and the user opt-in (`cp --remove-destination`).

**Execution artifact rules (always applied):**

- **Rule 1 (criteria-plan)**: Add `testTier` column with default `unit` to criteria arrays.
- **Rule 2 (agent-result)**: Add `verificationStatus: unverified` and `diagnoseLog:` fields to AgentResult TOON blocks that lack them.
- **Rule 3 (plan structural migration)**: Tiered migration:
  - *Tier A (auto)*: Add YAML frontmatter (`planVersion: 2`, `roadmapRef`, `totalPhases`, `totalWaves`)
  - *Tier B (auto)*: Add stub sections (`## CLI Command Spec`, `## State Machines`, `## Error Handling`)
  - *Tier C (agent-driven)*: Spawns `plan-upgrade-agent` inline to restructure: schema type definitions, phase deliverable tables, acceptance criteria checklists, wave assignments, cross-references, scope contract. Confirmation gate before writing (unless `--force`). On skip/failure, keeps Tier A+B patches.
- **Rule 4 (state)**: Add `schemaVersion: 1` to state.toon if missing.

**Project infrastructure rules (applied when `--project`):**

- **Rule 6 (orchestration-config)**: Create `.claude/orchestration.toml` if missing, or append missing sections (`[settings.contextBudget]`, `[wiki]`, `[domain]`) with defaults from `orchestration-config.schema.md`.
- **Rule 7 (roadmap structural migration)**: Tiered migration (only if ROADMAP.md exists — a missing roadmap is not an error):
  - *Tier A (auto)*: Add YAML frontmatter (`roadmapVersion: 1`, `name`, `status`, `totalFeatures`, `totalMilestones`)
  - *Tier B (auto)*: Add missing required section stubs
  - *Tier C (agent-driven)*: Spawns `roadmap-upgrade-agent` inline to restructure: feature IDs (F-XX), milestone IDs (M-XX), constraint IDs (C-XX), data model tables, cross-references, convergence targets. Confirmation gate before writing (unless `--force`). Runs before plan migration (plan depends on roadmap for cross-refs).
- **Rule 8 (claude-md)**: Append missing Loom convention sections to `CLAUDE.md`. If CLAUDE.md is missing entirely, report `manual-required` and print guidance to run `/loom-init`.
- **Rule 9 (hooks)**: Add missing hook entries to `.claude/settings.json`. If settings.json is missing entirely, report `manual-required`. Verify hook source files exist after adding entries.
- **Rule 10 (wiki)**: Create `.loom/wiki/` directory with empty `index.toon`, `log.toon`, `execution-log.toon`, and `pages/` directory. Report `scaffolded` with guidance to run `/loom-wiki ingest`.
- **Rule 11 (protocols)**: Copy missing protocol files from the Loom source directory. Never overwrite existing protocols.
- **Rule 12 (install-state v2 → v3)**: Migrate `~/.claude/skills/library/install-state.toon` via `migrateInstallStateV2ToV3()` from `hooks/lib/install-state-migrator.ts`. Supply a `sha256Resolver` that reads each `targetPath` and computes its hash. Items with unreadable files get `sha256: ""` and a warning. Writes a single `loom-core` component with version `0.0.0` (real version refreshed by the next post-migration upgrade).
- **Rule 13 (library-catalog → current version)**: Migrate `~/.claude/skills/library/library.yaml` to the latest catalog version (currently v4) via the chained walker `migrateToLatest()` in `hooks/lib/library-catalog-migrator.ts`. The walker runs every registered step in `MIGRATIONS` from the detected source version to `CURRENT_VERSION`:
  - **v2 → v3 step** via `migrateLibraryCatalogV2ToV3()`. Reads `loomCoreVersion` and `loomHooksVersion` from the freshly-written install-state.toon (Rule 12 runs first). Synthesizes a single `releases[]` entry derived from the catalog `repo` URL when an `initialRelease` is configured; otherwise emits `releases: []`. Existing kit entries are preserved untouched — v3 fields `minCoreVersion`/`minHooksVersion` are optional and left absent.
  - **v3 → v4 step** via `migrateLibraryCatalogV3ToV4()`. Renames `library.skills` (the legacy non-code resource bucket) to `library.protocols`, inserts a fresh empty `library.skills: []` array (now reserved for Claude Code native skills with SKILL.md), and rewrites every `requires: [skill:*]` entry across agents to `requires: [protocol:*]` (F-002). After migration, the catalog reports `catalog_version: 4` and `detectLibraryCatalogVersion()` returns `outdated: false`. v4 catalogs are recognized as current and skipped — running `/loom-upgrade` against an already-v4 catalog is a no-op.
  
  A user upgrading from v2 directly to v4 gets the v2→v3 and v3→v4 steps applied in sequence via a single `migrateToLatest()` call — see "Adding a new schema version" in `schema-upgrade.md`.
- **Rule 14 (plan artifact relocation)**: Move legacy root-level planning artifacts (`ROADMAP.md`, `PLAN.md`, `PLAN-*.md`, `.plan-history/`) into the modern `planning/` layout. Uses `hooks/lib/planning-paths.ts` `isRootStub()` to skip files that are already stub pointers. PLAN files are classified into `planning/plans/` (active) or `planning/archive/` (status: complete, status: archived, or mtime > 90 days). Writes a one-line `ROADMAP.md` stub at root pointing to `planning/ROADMAP.md` for GitHub home-page discoverability. Idempotent — running twice is a no-op. Conflicts (target already exists) are recorded but never overwritten.

**Migration order**: Rules are applied in numeric order (1-14). Within each rule, files are processed alphabetically. Rule 12 MUST run before Rule 13 within a single pass (Rule 13 reads versions written by Rule 12). Rule 14 runs last in a single pass — it touches filesystem layout, so we let all content migrations finish first.

If a migration rule fails for a specific file (parse error, unexpected format, write failure):
1. Delete the `.tmp` file if it exists.
2. Leave the original file untouched.
3. Record the failure in the upgrade report.
4. Continue with remaining files -- one failure does not abort the batch.

#### Step 5b: Agent Migration (Rules 3 and 7, Tier C)

After mechanical migration (Step 5), check if ROADMAP.md or PLAN.md have Tier C structural gaps. If so:

1. **Order**: Migrate roadmap first, then plan (plan cross-references roadmap).
2. **Spawn agent**: For each file needing Tier C, spawn the appropriate upgrade agent:
   - ROADMAP.md → `roadmap-upgrade-agent` with: patched ROADMAP.md, `roadmap.schema.md`
   - PLAN.md → `plan-upgrade-agent` with: patched PLAN.md, `plan.schema.md`, migrated ROADMAP.md (if available)
3. **Confirm**: Print a diff summary of the agent's proposed changes. Ask user to accept, skip, or abort (unless `--force`).
4. **Write**: On accept, write atomically. On skip, keep Tier A+B patches only. On abort, stop upgrade.
5. **Validate**: Run schema validation on the agent output. If validation fails, revert to Tier A+B version and record failure.

Agent instructions (for both):
```
Read the target schema file. Migrate the input document to match it.
Preserve all existing content and intent — add structure, don't change meaning.
Output the complete migrated document.
```

Model resolution: read agent frontmatter and pass `model:` on the spawn call per CLAUDE.md conventions.

#### Step 6: Validate

Re-run version detection on every migrated file. If any file still reports `outdated: true`, record it as a failed migration.

For `manual-required` and `scaffolded` items, validation is skipped — they are reported as-is in the final report.

#### Step 7: Report

Print the final upgrade report to stdout:

```toon
upgradeReport:
  timestamp: {ISO-8601}
  scope: {default | project}
  filesScanned: {count}
  filesMigrated: {count}
  filesAgentMigrated: {count}
  filesScaffolded: {count}
  filesManualRequired: {count}
  filesFailed: {count}
  filesSkipped: {count}
  filesSkippedLink: {count}
  backupDir: {path}
  migrations[N]{file,rule,status,details}:
    PLAN.md,Rule 3,success,Added 3 missing sections
    .plan-execution/state.toon,Rule 4,success,Added schemaVersion field
    .plan-execution/contracts/result.toon,Rule 2,failed,Parse error on line 14
    PLAN.md,Rule 3,agent-migrated,Frontmatter + stubs + structural migration via plan-upgrade-agent
    .claude/orchestration.toml,Rule 6,success,Added wiki and domain sections
    ROADMAP.md,Rule 7,agent-migrated,Frontmatter + stubs + structural migration via roadmap-upgrade-agent
    .claude/settings.json,Rule 9,success,Added contract-lock and file-ownership hooks
    .loom/wiki/,Rule 10,scaffolded,Created empty wiki structure; run /loom-wiki ingest
    CLAUDE.md,Rule 8,manual-required,Run /loom-init to generate from codebase analysis
    ~/.claude/skills/library/library.yaml,Rule 13,skip-link,Symlinked target — convert with cp --remove-destination to opt in
```

Print a human-readable summary:

```
[loom:upgrade] Migration complete.
  Scope:        {default | project}
  Scanned:      {N} targets
  Migrated:     {M} targets
  Scaffolded:   {S} targets
  Failed:       {F} targets
  Skipped:      {K} targets
  Symlink skip: {L} targets  (run with `cp --remove-destination` to opt in)
  Backup:       {backup-dir}
```

If there are `manual-required` or `partial` items, print a follow-up section:

```
  Manual steps required:
    1. CLAUDE.md is missing — run `/loom-init` to generate it
    2. .claude/settings.json is missing — create it or copy from Loom template

  Recommended follow-ups:
    /loom-wiki ingest         — populate wiki pages from codebase
    /loom-library sync        — ensure installed commands/agents are current
    /loom-status              — verify project health after upgrade
```

Exit 0 if all auto-migrations succeeded. Exit 1 if any auto-migration failed.

## Automatic Detection Integration

Agents reading old-format TOON files emit a stderr warning per the schema-upgrade.md protocol:

```
[loom:schema-upgrade] Old format detected in {filePath}. Run `/loom-upgrade` to migrate.
```

For project infrastructure issues, agents emit a broader warning:

```
[loom:schema-upgrade] Project infrastructure outdated. Run `/loom-upgrade --project` for full audit.
```

This warning is informational only. Agents continue processing with best-effort defaults. They never mutate files -- only `/loom-upgrade` performs transformations.

The `/loom-status` command surfaces upgrade warnings when old-format artifacts are detected, providing a persistent reminder until the user runs `/loom-upgrade`.

## Token Budget Compliance

This command uses grep-based selective file reading to stay within the 100k token agent budget:
- Scan phase uses `grep` or `rg` to check for specific markers (field names, section headers) rather than reading entire files.
- Migration phase reads only files identified as needing migration.
- Large files (> 50KB) are read in chunks using offset/limit parameters.
- Protocol file copying uses file system operations, not content reading.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No files need migration | Print "All artifacts are up to date." Exit 0. |
| Backup directory already exists | Append `-{N}` suffix (e.g., `2026-04-19T14-30-00Z-2/`). |
| Backup write failure | Abort entirely. Exit 1. |
| Migration parse error | Skip file, record failure, continue. |
| Migration write failure | Skip file, record failure, continue. |
| Validation failure (still outdated) | Record as failed migration in report. |
| Permission denied on source file | Skip file, record failure, continue. |
| Hook source file missing | Record as `partial` — entry added but file absent. |
| Protocol source file not found | Record as `failed` — cannot copy what doesn't exist. |
| CLAUDE.md missing (--project) | Record as `manual-required` — needs `/loom-init`. |
| settings.json missing (--project) | Record as `manual-required` — needs manual creation. |
| Target path is a symlink | Record as `skip-link` — skipped, not failed. Exit 0 still possible. User opts in by converting the link with `cp --remove-destination`. |

## Cross-References

- `protocols/schema-upgrade.md` — Migration rules, version detection logic, backup protocol.
- `protocols/agent-result.schema.md` — verificationStatus and diagnoseLog fields (Rule 2).
- `protocols/convergence-tier.schema.md` — Tier definitions (Rule 5, no migration needed).
- `protocols/behavioral-guidelines.md` — TDD and diagnose-before-fix protocols that produce the fields being migrated.
- `protocols/orchestration-config.schema.md` — orchestration.toml full schema (Rule 6).
- `protocols/roadmap.schema.md` — ROADMAP.md full schema (Rule 7).
- `protocols/wiki-conventions.md` — Wiki structure rules (Rule 10).
- `protocols/wiki-index.schema.md` — Wiki index format (Rule 10).

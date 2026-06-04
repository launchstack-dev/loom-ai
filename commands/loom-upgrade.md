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

Read migration rules from `agents/protocols/schema-upgrade.md`. The schema-upgrade protocol defines 13 artifact types with version detection logic and migration rules. Schema-to-current-version mappings live in `agents/protocols/schema-versions.toon` — that registry is the single source of truth for "what version is current."

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
agents/protocols/*.md               → protocol artifacts
```

**Additionally scan when `--project` is set** (project infrastructure — Rules 6-13):

```
.claude/orchestration.toml                          → orchestration config
ROADMAP.md                                          → roadmap format
CLAUDE.md                                           → Loom conventions
.claude/settings.json                               → hook wiring
.loom/wiki/                                         → wiki bootstrapping
agents/protocols/                                   → protocol file completeness
~/.claude/skills/library/install-state.toon         → install-state v3
~/.claude/skills/library/library.yaml               → library catalog v3
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
- **protocols**: Check `agents/protocols/` for missing required protocol files (13 files minimum).
- **install-state**: Check `~/.claude/skills/library/install-state.toon`. Outdated if `schemaVersion < 3`, missing entirely (treat as pre-v2), or v3 declared but missing `protocolVersion` / `loomCoreVersion` / `loomHooksVersion` / `catalogVersion` / `components[]`. Detection via `detectInstallStateVersion()` in `hooks/lib/install-state-migrator.ts`.
- **library-catalog**: Check `~/.claude/skills/library/library.yaml`. Outdated if `catalog_version < 3` or v3 declared but missing top-level `loomCoreVersion` / `loomHooksVersion` / `releases`. Detection via `detectLibraryCatalogVersion()` in `hooks/lib/library-catalog-migrator.ts`.

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

Verify the backup is complete before proceeding. If any copy fails, abort with:

```
[loom:upgrade] ERROR: Backup failed for {file}. No files were modified. Aborting.
```

Exit 1.

#### Step 5: Migrate

Apply migration rules from `schema-upgrade.md` in-place. Each file is written atomically (write to `{path}.tmp`, then rename to `{path}`).

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
- **Rule 13 (library-catalog v2 → v3)**: Migrate `~/.claude/skills/library/library.yaml` via `migrateLibraryCatalogV2ToV3()` from `hooks/lib/library-catalog-migrator.ts`. Reads `loomCoreVersion` and `loomHooksVersion` from the freshly-written install-state.toon (Rule 12 runs first). Synthesizes a single `releases[]` entry derived from the catalog `repo` URL when an `initialRelease` is configured; otherwise emits `releases: []`. Existing kit entries are preserved untouched — v3 fields `minCoreVersion`/`minHooksVersion` are optional and left absent.

**Migration order**: Rules are applied in numeric order (1-13). Within each rule, files are processed alphabetically. Rule 12 MUST run before Rule 13 within a single pass (Rule 13 reads versions written by Rule 12).

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
```

Print a human-readable summary:

```
[loom:upgrade] Migration complete.
  Scope:      {default | project}
  Scanned:    {N} targets
  Migrated:   {M} targets
  Scaffolded: {S} targets
  Failed:     {F} targets
  Skipped:    {K} targets
  Backup:     {backup-dir}
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

## Cross-References

- `agents/protocols/schema-upgrade.md` — Migration rules, version detection logic, backup protocol.
- `agents/protocols/agent-result.schema.md` — verificationStatus and diagnoseLog fields (Rule 2).
- `agents/protocols/convergence-tier.schema.md` — Tier definitions (Rule 5, no migration needed).
- `agents/protocols/behavioral-guidelines.md` — TDD and diagnose-before-fix protocols that produce the fields being migrated.
- `agents/protocols/orchestration-config.schema.md` — orchestration.toml full schema (Rule 6).
- `agents/protocols/roadmap.schema.md` — ROADMAP.md full schema (Rule 7).
- `agents/protocols/wiki-conventions.md` — Wiki structure rules (Rule 10).
- `agents/protocols/wiki-index.schema.md` — Wiki index format (Rule 10).

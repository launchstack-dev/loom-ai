---
description: "Scan for old-format Loom artifacts and migrate them to current schema versions"
---
# /loom upgrade

Scans the project for outdated Loom artifacts and migrates them to the current schema version, with backup.

## Requirements

$ARGUMENTS

Parse flags from the arguments string.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Show migration plan without modifying any files. Prints what would be changed and exits. |
| `--force` | `false` | Skip confirmation prompt and apply migrations immediately. |
| `--backup-dir <path>` | `.plan-execution/backups/{timestamp}/` | Override the default backup directory path. |

### Execution Steps

Read migration rules from `agents/protocols/schema-upgrade.md`. The schema-upgrade protocol defines 5 artifact types with version detection logic and migration rules. Follow that protocol exactly.

#### Step 1: Scan

Scan the project for artifacts that may need migration. Search these paths:

```
.plan-execution/state.toon          → state artifact
.plan-execution/contracts/*.md      → contract artifacts (agent-result)
PLAN.md                             → plan artifact
agents/protocols/*.md               → protocol artifacts
```

For each file found, run the version detection logic defined in `schema-upgrade.md` section "Version Detection Logic":

- **agent-result**: Check `.plan-execution/contracts/*.md` and any AgentResult TOON files for missing `verificationStatus` or `diagnoseLog` fields.
- **plan**: Check `PLAN.md` for missing `## CLI Command Spec`, `## State Machines`, or `## Error Handling` sections.
- **state**: Check `.plan-execution/state.toon` for missing `schemaVersion` field.
- **convergence-tier**: `convergence-tier.schema.md` is a new file -- detection always returns `outdated: false`. No migration needed.
- **criteria-plan**: Check criteria plan files for missing `testTier` column in criteria arrays.

Collect all files that report `outdated: true` into a migration manifest.

#### Step 2: Report (--dry-run)

If `--dry-run` is set, print the migration manifest and exit without modifying any files:

```toon
dryRunReport:
  timestamp: {ISO-8601}
  filesScanned: {count}
  filesNeedingMigration: {count}
  migrations[N]{file,artifactType,reason,rule}:
    path/to/file,agent-result,missing verificationStatus,Rule 2
    PLAN.md,plan,v1 format,Rule 3
```

Print a human-readable summary to stdout:

```
[loom:upgrade] Dry run complete.
  Scanned: {N} files
  Need migration: {M} files
  
  {file1} — {reason}
  {file2} — {reason}
  ...

No files were modified. Run `/loom upgrade` (without --dry-run) to apply migrations.
```

Exit 0.

#### Step 3: Confirm

If `--force` is NOT set and there are files needing migration, print the migration plan and ask for confirmation:

```
[loom:upgrade] Found {N} files needing migration:

  {file1} — {reason}
  {file2} — {reason}

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
```

Verify the backup is complete before proceeding. If any copy fails, abort with:

```
[loom:upgrade] ERROR: Backup failed for {file}. No files were modified. Aborting.
```

Exit 1.

#### Step 5: Migrate

Apply migration rules from `schema-upgrade.md` in-place. Each file is written atomically (write to `{path}.tmp`, then rename to `{path}`).

Migration rules applied (from schema-upgrade.md):

- **Rule 2 (agent-result)**: Add `verificationStatus: unverified` and `diagnoseLog:` fields to AgentResult TOON blocks that lack them.
- **Rule 3 (plan v1 to v2)**: Add missing `## CLI Command Spec`, `## State Machines`, `## Error Handling` sections to PLAN.md with placeholder content.
- **Rule 4 (state)**: Add `schemaVersion: 1` to state.toon if missing.

If a migration rule fails for a specific file (parse error, unexpected format, write failure):
1. Delete the `.tmp` file if it exists.
2. Leave the original file untouched.
3. Record the failure in the upgrade report.
4. Continue with remaining files -- one failure does not abort the batch.

#### Step 6: Validate

Re-run version detection on every migrated file. If any file still reports `outdated: true`, record it as a failed migration.

#### Step 7: Report

Print the final upgrade report to stdout:

```toon
upgradeReport:
  timestamp: {ISO-8601}
  filesScanned: {count}
  filesMigrated: {count}
  filesFailed: {count}
  filesSkipped: {count}
  backupDir: {path}
  migrations[N]{file,rule,status,details}:
    PLAN.md,Rule 3,success,Added 3 missing sections
    .plan-execution/state.toon,Rule 4,success,Added schemaVersion field
    .plan-execution/contracts/result.toon,Rule 2,failed,Parse error on line 14
```

Print a human-readable summary:

```
[loom:upgrade] Migration complete.
  Scanned:  {N} files
  Migrated: {M} files
  Failed:   {F} files
  Skipped:  {S} files
  Backup:   {backup-dir}
```

Exit 0 if all migrations succeeded. Exit 1 if any migration failed.

## Automatic Detection Integration

Agents reading old-format TOON files emit a stderr warning per the schema-upgrade.md protocol:

```
[loom:schema-upgrade] Old format detected in {filePath}. Run `/loom upgrade` to migrate.
```

This warning is informational only. Agents continue processing with best-effort defaults. They never mutate files -- only `/loom upgrade` performs transformations.

The `/loom status` command surfaces upgrade warnings when old-format artifacts are detected, providing a persistent reminder until the user runs `/loom upgrade`.

## Token Budget Compliance

This command uses grep-based selective file reading to stay within the 100k token agent budget:
- Scan phase uses `grep` or `rg` to check for specific markers (field names, section headers) rather than reading entire files.
- Migration phase reads only files identified as needing migration.
- Large files (> 50KB) are read in chunks using offset/limit parameters.

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

## Cross-References

- `agents/protocols/schema-upgrade.md` — Migration rules, version detection logic, backup protocol.
- `agents/protocols/agent-result.schema.md` — verificationStatus and diagnoseLog fields (Rule 2).
- `agents/protocols/convergence-tier.schema.md` — Tier definitions (Rule 5, no migration needed).
- `agents/protocols/behavioral-guidelines.md` — TDD and diagnose-before-fix protocols that produce the fields being migrated.

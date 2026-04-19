# Schema Upgrade Protocol

Defines migration rules for upgrading old-format Loom project artifacts to current schema versions. The governing principle is **automatic detection with explicit migration**: agents detect old formats at read-time and warn on stderr, but only `/loom upgrade` performs the actual transformation.

## Overview

As Loom schemas evolve, existing project artifacts may fall behind the current version. Rather than silently breaking or silently patching, Loom uses a two-phase approach:

1. **Detection phase** — any agent reading an artifact checks for version markers and required fields. If the artifact is outdated, the agent emits a stderr warning and continues with best-effort reading.
2. **Migration phase** — the user explicitly runs `/loom upgrade`, which scans, backs up, transforms, and validates all outdated artifacts in one pass.

This separation ensures agents never silently mutate files the user has not asked to change, while still surfacing staleness early.

## Version Detection

Each schema has a detection strategy based on field presence or explicit version markers.

```toon
detectionRules[N]{schema,file,strategy,oldIndicator,currentVersion}:
  criteria-plan,criteria-plan.toon,field-absence,missing testTier column in criteria array,1
  agent-result,*.agent-result.toon,field-absence,missing verificationStatus or diagnoseLog,1
  plan,PLAN.md,field-absence,missing CLI Command Spec / State Machines / Error Handling sections,2
  state,.plan-execution/state.toon,field-absence,missing schemaVersion field,1
  convergence-tier,convergence-tier.schema.md,new-file,file does not exist yet — no migration needed,1
```

### Detection Logic (pseudocode)

```
function detectVersion(schema, content):
  match schema:
    "criteria-plan":
      if criteria array header lacks "testTier" column → return { outdated: true, reason: "missing testTier" }
    "agent-result":
      if content lacks "verificationStatus:" → return { outdated: true, reason: "missing verificationStatus" }
      if content lacks "diagnoseLog:" → return { outdated: true, reason: "missing diagnoseLog" }
    "plan":
      if content lacks "## CLI Command Spec" AND lacks "## State Machines" → return { outdated: true, reason: "v1 format" }
    "state":
      if content lacks "schemaVersion:" → return { outdated: true, reason: "missing schemaVersion" }
    "convergence-tier":
      return { outdated: false }  // new file, nothing to migrate
  return { outdated: false }
```

## Migration Rules

### Rule 1: criteria-plan.toon — add testTier

**Trigger**: criteria array header does not include `testTier` column.

**Migration**:
- Append `testTier` to the typed-array column header.
- For each existing row, append default value `unit`.

Before:
```toon
criteria[N]{id,name,type,verifier,passCondition,blocking,priority,source,rationale}:
  C-01,Blocks unauthenticated requests,hard,test-runner,all-pass,true,P0,plan-acceptance,Explicit acceptance criterion
```

After:
```toon
criteria[N]{id,name,type,verifier,passCondition,blocking,priority,source,rationale,testTier}:
  C-01,Blocks unauthenticated requests,hard,test-runner,all-pass,true,P0,plan-acceptance,Explicit acceptance criterion,unit
```

**Default value**: `unit`

### Rule 2: AgentResult files — add verificationStatus and diagnoseLog

**Trigger**: file content lacks `verificationStatus:` line or `diagnoseLog:` line.

**Migration**:
- If `verificationStatus:` is missing, insert after the `durationMs:` line with default `unverified`.
- If `diagnoseLog:` is missing, insert after the `verificationStatus:` line with default value `null`.

Before:
```toon
agent: implementer-agent
wave: 1
taskId: task-003
status: success
durationMs: 8200
gate: pass
```

After:
```toon
agent: implementer-agent
wave: 1
taskId: task-003
status: success
durationMs: 8200
verificationStatus: unverified
diagnoseLog: null
gate: pass
```

**Default values**: `verificationStatus: unverified`, `diagnoseLog: null`

### Rule 3: PLAN.md — v1 to v2

**Trigger**: PLAN.md lacks all three sections: `## CLI Command Spec`, `## State Machines`, `## Error Handling`.

**Migration**:
- Append stub sections at the end of PLAN.md (before any trailing blank lines).
- Add `planVersion: 2` as a TOON frontmatter marker at the top of the file if not present.

Stub sections added:

```markdown
## CLI Command Spec

<!-- TODO: Define CLI commands, flags, and usage examples -->

## State Machines

<!-- TODO: Define state transitions for key workflows -->

## Error Handling

<!-- TODO: Define error codes, recovery strategies, and user-facing messages -->
```

**Default values**: `planVersion: 2` (added as first-line marker)

### Rule 4: state.toon — add schemaVersion

**Trigger**: `.plan-execution/state.toon` lacks `schemaVersion:` field.

**Migration**:
- Insert `schemaVersion: 1` as the first line of the file.

Before:
```toon
runId: a1b2c3d4-uuid
planFile: PLAN.md
status: running
```

After:
```toon
schemaVersion: 1
runId: a1b2c3d4-uuid
planFile: PLAN.md
status: running
```

**Default value**: `schemaVersion: 1`

### Rule 5: convergence-tier.schema.md — no migration

This is a new schema file introduced in the current version. No existing artifacts need migration. Detection returns `outdated: false` unconditionally.

## Automatic Detection Protocol

When any agent reads a Loom artifact, it MUST apply the detection logic above. If the artifact is outdated:

1. **Emit a stderr warning** in this exact format:
   ```
   [loom:schema-upgrade] Old format detected in {filePath}. Run `/loom upgrade` to migrate.
   ```
2. **Continue reading** — do NOT block, abort, or refuse to process the file. Apply best-effort defaults in memory so the agent can proceed.
3. **Do NOT mutate the file** — agents never write migration changes. Only `/loom upgrade` does that.
4. **Log the detection** — if a progress heartbeat is active, include a note in the heartbeat:
   ```toon
   warnings[N]: Old format detected in criteria-plan.toon (missing testTier)
   ```

This ensures the user is informed without disrupting agent execution.

## Explicit Migration Protocol

The `/loom upgrade` command performs the full migration pass.

### Execution Steps

1. **Scan** — walk the project for known artifact patterns:
   ```toon
   scanTargets[N]{pattern,schema}:
     criteria-plan.toon,criteria-plan
     .plan-execution/**/*.agent-result.toon,agent-result
     PLAN.md,plan
     .plan-execution/state.toon,state
   ```

2. **Detect** — run version detection on each found file. Collect a list of files needing migration.

3. **Backup** — create a timestamped backup directory and copy all files that will be modified:
   ```
   .plan-execution/backups/{ISO-timestamp}/
   ```

4. **Migrate** — apply migration rules in-place. Each file is written atomically (write to `.tmp`, then `fs.renameSync`).

5. **Validate** — re-run detection on every migrated file. If any file still reports outdated, the migration for that file failed.

6. **Report** — print a summary to stdout:
   ```toon
   upgradeReport:
     timestamp: 2026-04-19T14:30:00Z
     filesScanned: 12
     filesMigrated: 4
     filesSkipped: 8
     backupDir: .plan-execution/backups/2026-04-19T14-30-00Z
     results[N]{file,schema,status,details}:
       criteria-plan.toon,criteria-plan,migrated,added testTier column with default unit
       .plan-execution/wave-0/task-001.agent-result.toon,agent-result,migrated,added verificationStatus and diagnoseLog
       PLAN.md,plan,migrated,added CLI Command Spec / State Machines / Error Handling stubs and planVersion marker
       .plan-execution/state.toon,state,migrated,added schemaVersion: 1
   ```

## Backup Protocol

### Directory Structure

```
.plan-execution/backups/
  2026-04-19T14-30-00Z/
    criteria-plan.toon
    PLAN.md
    state.toon
    wave-0/
      task-001.agent-result.toon
```

The backup directory mirrors the relative paths of the original files so restore is unambiguous.

### Restore Instructions

To restore from backup, copy files back from the backup directory:

```bash
# Restore all files from a specific backup
cp -r .plan-execution/backups/2026-04-19T14-30-00Z/* .

# Restore a single file
cp .plan-execution/backups/2026-04-19T14-30-00Z/criteria-plan.toon ./criteria-plan.toon
```

### Retention

Backup directories are never automatically deleted. The user is responsible for cleanup. The `/loom upgrade` command prints the backup path so the user can verify and remove old backups at their discretion.

## Error Handling

### SCHEMA_VERSION_MISMATCH

When detection finds an outdated artifact, agents MAY attach the error code `SCHEMA_VERSION_MISMATCH` to their internal diagnostics. This code is used for:

- Filtering warnings in agent output
- Triggering upgrade suggestions in `/loom status`
- Tracking migration debt across the project

```toon
error:
  code: SCHEMA_VERSION_MISMATCH
  file: criteria-plan.toon
  schema: criteria-plan
  expected: 1
  detected: 0
  message: "Missing testTier column in criteria array. Run `/loom upgrade` to migrate."
  severity: warning
  action: continue
```

### Migration Failure

If a migration rule fails (parse error, unexpected format, write failure):

1. The original file is left untouched (the `.tmp` file is deleted).
2. The backup copy is retained.
3. The failure is reported in the upgrade report with `status: failed` and a `details` field describing the error.
4. Other files continue migrating — one failure does not abort the batch.

### Unknown Format

If a file matches a scan pattern but cannot be parsed at all (not valid TOON, corrupted), it is logged as `status: skipped` with `details: "Unparseable file"` and left untouched.

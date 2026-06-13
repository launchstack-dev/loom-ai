# IterationSnapshot Schema

Defines the `IterationSnapshot` TOON artifact written by `hooks/lib/iteration-snapshot.ts` (Phase 11 deliverable) before each integrator invocation in document-mode convergence runs. Per locked decision C-07, snapshots are written before every integrator pass and retained forever — they are the rollback safety net for `--autoconverge` and the audit trail for plan evolution.

Schema version: **1**. Registered in `schema-versions.toon` as `iteration-snapshot`.

---

## File Locations

Per pass, two files are written side-by-side under `planning/history/snapshots/`:

```
planning/history/snapshots/
|-- {slug}-pass-1.toon          # this schema (metadata)
|-- {slug}-pass-1.{ext}         # the snapshotted file (verbatim copy of subject)
|-- {slug}-pass-2.toon
|-- {slug}-pass-2.{ext}
|-- ...
```

Where:
- `{slug}` is derived from `converge.config.subject` per the slug rule below.
- `{ext}` is the subject file's trailing extension preserved verbatim (e.g., `.md` for plan files).
- The integer `N` in `pass-{N}` matches `iteration` in the `.toon` metadata file.

**Atomic writes required:** The snapshot helper MUST write the snapshot copy first (`{slug}-pass-{N}.{ext}.tmp` -> rename), then write the metadata file (`{slug}-pass-{N}.toon.tmp` -> rename), then verify the checksum matches the copied file. See `execution-conventions.md` Atomic Writes section.

**Retention:** All snapshots are retained forever per C-07. No GC, no cap, no rotation.

---

## Slug Derivation Rule (locked W-02)

`slug` is the subject file's basename minus its FINAL extension only. Multi-dot filenames keep all but the trailing extension.

| `subject` | `slug` |
|-----------|--------|
| `planning/PLAN-convergence-generalization.md` | `PLAN-convergence-generalization` |
| `planning/PLAN-x.v2.md` | `PLAN-x.v2` |
| `planning/ROADMAP.md` | `ROADMAP` |
| `docs/spec.draft.v3.md` | `spec.draft.v3` |
| `notes.txt` | `notes` |

The rule is: take the basename, find the LAST `.` character, take everything before it. If there is no `.`, the slug equals the basename.

This rule is implementation-agnostic — the snapshot helper, the driver, and any downstream tool MUST derive slugs identically. Tests in `test/protocol/iteration-snapshot.test.ts` cover the multi-dot case.

---

## Schema

```toon
sourcePath: planning/PLAN-convergence-generalization.md
snapshotPath: planning/history/snapshots/PLAN-convergence-generalization-pass-2.md
snapshotChecksum: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
iteration: 2
timestamp: 2026-06-12T15:30:00.000Z
slug: PLAN-convergence-generalization
```

---

## Required Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| `sourcePath` | string (path) | required; equals `converge.config.subject` | MUST be the original subject path (not the snapshot copy). Relative to repo root. |
| `snapshotPath` | string (path) | required; the on-disk copy | MUST exist on the filesystem after snapshot write. Relative to repo root. |
| `snapshotChecksum` | string | required; format `sha256:{hex}` | sha256 hash of `snapshotPath` file contents at write time. Hex is lowercase, 64 chars. Prefix `sha256:` is REQUIRED to allow future algorithm migration. |
| `iteration` | integer | required; 1-indexed pass number | MUST equal the driver's `currentIteration` at write time. Matches the `pass-{N}` suffix in `snapshotPath`. |
| `timestamp` | ISO 8601 timestamp with millisecond precision | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` | Locked W-01. When the snapshot was taken. |
| `slug` | string | required | Derived from `sourcePath` per the locked W-02 slug rule above. MUST match the slug substring in `snapshotPath`. |

---

## Validation Rules

1. **All required fields present.** All 6 fields MUST be present.
2. **`sourcePath` exists at write time.** The subject file MUST exist when the snapshot is taken; if not, the snapshot helper raises `SNAPSHOT_WRITE_FAILED`.
3. **`snapshotPath` exists after write.** After the helper completes, the on-disk copy MUST be present at `snapshotPath`. A missing snapshot file when the metadata exists is an integrity defect.
4. **`snapshotChecksum` matches `snapshotPath`.** Recomputing sha256 over `snapshotPath` MUST yield the recorded checksum. Mismatch indicates tampering or partial write.
5. **`iteration` matches filename.** The `pass-{N}` integer in `snapshotPath` MUST equal `iteration`.
6. **`slug` matches filename.** The slug substring in `snapshotPath` MUST equal `slug`.
7. **`slug` derives from `sourcePath`.** Re-applying the W-02 slug rule to `sourcePath` MUST yield `slug`.
8. **`timestamp` precision (locked W-01).** ISO 8601 with millisecond precision.

A failure of rules 1-8 produces a `SNAPSHOT_WRITE_FAILED` warning (single retry, then continue per locked recovery behavior).

---

## Lifecycle and Retention

| Event | Action |
|-------|--------|
| Iteration N begins (document mode, `snapshotEnabled=true`) | Helper writes `{slug}-pass-{N}.toon` + `{slug}-pass-{N}.{ext}` BEFORE the integrator agent is spawned |
| Iteration N integrator fails / loop halts | Snapshot is RETAINED (no rollback at the file level; user invokes `cp planning/history/snapshots/{slug}-pass-{N}.{ext} {sourcePath}` to revert) |
| Iteration N completes successfully | Snapshot is RETAINED |
| `/loom-converge --resume` | Driver does NOT re-write any existing snapshot; it only writes `pass-{currentIteration}` on the next NEW iteration |
| Run terminates (converged or halted) | All snapshots retained forever per C-07 |

**Cascade behavior:**

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| `converge.config` | `IterationSnapshot` rows | RETAIN | RETAIN per C-07 (keep all forever) |
| `IterationSnapshot` row | snapshot copy at `snapshotPath` | RETAIN | RETAIN (immutable after write) |

---

## Error Codes

| Code | When emitted |
|------|--------------|
| `SNAPSHOT_WRITE_FAILED` | Helper could not write either the metadata file or the copy (disk full, permissions, source missing, checksum mismatch). Single retry with 1s backoff. After retry: warn-and-continue (loop is not halted; missing snapshot is a degraded mode, not a fatal condition). |

See `agent-result.schema.md` Error Categories.

---

## Relationship to Other Schemas

- **`findings.schema.md`** — `IterationSnapshot.iteration` == `ConvergenceFindings.iteration` for the corresponding pass.
- **`stage-context.schema.md`** — `ConvergenceIterationSummary.snapshotRef` points at the `snapshotPath` for the iteration (document mode only).
- **`convergence-summary.schema.md`** — `ConvergenceSummary` references no snapshots directly but its `subject` field provides the slug-derivation source for any downstream tool that needs to enumerate snapshots for a run.
- **`convergence-tier.schema.md`** — `converge.config.snapshotEnabled` (default `true`) and `snapshotDir` (default `planning/history/snapshots/`) gate this schema's write.
- **`hooks/lib/iteration-snapshot.ts`** (Phase 11) — Sole writer of `IterationSnapshot` files. Implementation reference for the slug rule, sha256 algorithm, and atomic-write sequence.

---

## Examples

### Pass 1 of a multi-iteration document-mode run

```toon
sourcePath: planning/PLAN-convergence-generalization.md
snapshotPath: planning/history/snapshots/PLAN-convergence-generalization-pass-1.md
snapshotChecksum: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
iteration: 1
timestamp: 2026-06-12T14:00:00.000Z
slug: PLAN-convergence-generalization
```

### Multi-dot filename (locked W-02 rule)

```toon
sourcePath: planning/PLAN-x.v2.md
snapshotPath: planning/history/snapshots/PLAN-x.v2-pass-3.md
snapshotChecksum: sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
iteration: 3
timestamp: 2026-06-12T16:00:00.000Z
slug: PLAN-x.v2
```

### Non-markdown subject (rare but supported)

```toon
sourcePath: docs/api-spec.json
snapshotPath: planning/history/snapshots/api-spec-pass-1.json
snapshotChecksum: sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9
iteration: 1
timestamp: 2026-06-12T10:30:00.000Z
slug: api-spec
```

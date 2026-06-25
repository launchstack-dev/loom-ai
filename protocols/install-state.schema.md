# Install State Schema

> **Reconciliation note (PLAN-plugin-marketplace-merged, Phase 0B):** This v3 component-inventory at `~/.claude/skills/library/install-state.toon` is preserved unchanged and is consumed only by `loom-update --rollback`. The per-machine channel envelope at `~/.loom/install.toon` introduced by the plugin-marketplace plan is a **separate concern** consumed by the doctor and update CLIs (channel detection, pinning, freshness checks). The two artifacts do not overlap and must not be merged.

Canonical schema for `~/.claude/skills/library/install-state.toon` — the on-disk record of what Loom has installed, at what version, with what integrity. Read by `/loom-upgrade`, the statusline update checker, and rollback machinery.

## Versions

- **v1** (deprecated): pre-2026-04, content-hashed full file inventory.
- **v2** (current): introduced 2026-04 by `0e9cb9e` ("Simplify install-state: drop content hashes, use direct comparison"). Tracks installed items (name, type, source, target, timestamp). No version pinning, no integrity hashes, no rollback support.
- **v3** (this doc): adds per-component version pinning, per-file integrity hashes, snapshot pointer for atomic rollback, and a `protocolVersion` field consumed by hooks for fail-closed compat checks.

## v3 Top-Level Format (TOON, canonical)

```toon
schemaVersion: 3
protocolVersion: 3
lastSynced: 2026-05-07T14:30:00Z
loomCoreVersion: 0.1.0
loomHooksVersion: 0.1.0
catalogVersion: 3

components[3]{name,version,kind,pinned,installedAt}:
  loom-core,0.1.0,core,false,2026-05-07T14:30:00Z
  loom-hooks,0.1.0,hooks,true,2026-05-07T14:30:00Z
  loom-kit-data-engineering,1.0.0,kit,false,2026-05-07T14:30:00Z

items[N]{name,type,source,targetPath,sha256,component,installedAt}:
  loom-library,prompt,commands/loom-library.md,/Users/.../commands/loom-library.md,abc123...,loom-core,2026-05-07T14:30:00Z
  ...

snapshot:
  versionBeforeUpgrade: 0.0.9
  snapshotPath: ~/.cache/loom/snapshot-2026-05-07T14-29-00Z/
  snapshotSha256: def456...
  capturedAt: 2026-05-07T14:29:00Z
  expiresAt: 2026-05-14T14:29:00Z
```

## Field Reference

### Top-level fields

| Field | Required | Type | Description |
|---|---|---|---|
| schemaVersion | yes | int | Schema version of this file. Currently `3`. |
| protocolVersion | yes | int | Protocol version that hooks check for compat. Bumped when state contract changes in a way hooks must observe. Currently `3`. |
| lastSynced | yes | ISO 8601 | Timestamp of last successful install or upgrade. |
| loomCoreVersion | yes | semver | Version of `loom-core` currently installed. |
| loomHooksVersion | yes | semver | Version of `loom-hooks` currently installed. Hooks read this on startup; mismatch with their own embedded version → fail closed. |
| catalogVersion | yes | int | Version of the `library.yaml` catalog format installed. Must match catalog v3 `catalog_version` field. |

### `components[]` table

Tracks each top-level installable unit and its update status.

| Field | Required | Type | Description |
|---|---|---|---|
| name | yes | string | Component identifier. Must be one of `loom-core`, `loom-hooks`, or `loom-kit-<name>`. |
| version | yes | semver | Currently-installed version of this component. |
| kind | yes | enum | One of `core`, `hooks`, `kit`. Determines update policy. |
| pinned | yes | bool | If `true`, `/loom-upgrade` skips this component without explicit `--force` or component-specific flag. Hooks default to `pinned: true`. |
| installedAt | yes | ISO 8601 | Timestamp when this component version was installed. |

### `items[]` table

Per-file inventory. Replaces v2's `items[]` (name, type, source, targetPath, installedAt) with the addition of `sha256` and `component`.

| Field | Required | Type | Description |
|---|---|---|---|
| name | yes | string | Item name (matches `library.yaml` entry). |
| type | yes | enum | `prompt`, `agent`, `infrastructure`, `protocol`, `hook`, `config`. |
| source | yes | path | Repo-relative path of source file in the release tarball. |
| targetPath | yes | abspath | Absolute install path on disk. |
| sha256 | yes | hex | SHA256 of installed file. Verified by `/loom-upgrade` before applying changes; mismatch indicates external modification → blocks upgrade with `--force` override. |
| component | yes | string | Owning component (`loom-core`, `loom-hooks`, or kit name). Drives rollback scoping. |
| installedAt | yes | ISO 8601 | Timestamp of install for this item. |

### `snapshot` block

Records the previous version's state for atomic rollback. Present only when an upgrade is in progress or recently completed (within retention window).

| Field | Required | Type | Description |
|---|---|---|---|
| versionBeforeUpgrade | yes | semver | The version we'd roll back to. |
| snapshotPath | yes | abspath | Directory in `~/.cache/loom/` containing copies of all files this snapshot tracks. |
| snapshotSha256 | yes | hex | Aggregate SHA256 of the snapshot manifest, for tamper detection. |
| capturedAt | yes | ISO 8601 | When the snapshot was taken. |
| expiresAt | yes | ISO 8601 | When the snapshot can be garbage-collected. Default: 7 days post-capture. |

## Migration: v2 → v3

The v2→v3 reader is implemented in `/loom-upgrade` and triggered automatically on first run after a v3-aware Loom installation.

```
v2 → v3 migration steps:
1. Read v2 install-state.toon (schemaVersion: 2).
2. Default loomCoreVersion to "0.0.0", loomHooksVersion to "0.0.0".
3. Default catalogVersion to 2 (the v2-era default — refreshed by Rule 13 in the same upgrade pass).
4. For each item in v2 items[]:
   - Compute sha256 of file at targetPath (best-effort; missing files → skip with warning).
   - Assign component = "loom-core" for all items (v2 has no component concept).
5. Set components[] to a single { name: "loom-core", version: "0.0.0", kind: "core", pinned: false }.
6. Omit snapshot block.
7. Write as v3 atomically (tmp + rename).
```

After migration, the next `/loom-upgrade` will refresh `loomCoreVersion`, `loomHooksVersion`, and split components correctly based on the new release tarball's manifest.

## Forward Compat for v2 Readers

A v2 reader (a hook or installer built before v3 shipped) that encounters a v3 file MUST fail closed — treat the file as outdated/unknown and refuse to operate. Do not attempt best-effort parsing: a v3 file with `protocolVersion: 3` and an unfamiliar `components[]` block contains semantics a v2 reader cannot honor, and any "best-effort" path will silently lose integrity guarantees. This rule mirrors the fail-closed posture on `protocolVersion` mismatch above.

## Atomic Write Discipline

All writes to `install-state.toon` MUST be atomic:

```
1. Write to {path}.tmp
2. fs.renameSync({path}.tmp, {path})
```

Crashes mid-write must never leave a partial file. `/loom-upgrade` and the installer share the same write helper.

## Rollback Scoping

Rollback restores **only** files listed in the active `items[]` table. Files in `~/.claude/` not tracked by `install-state.toon` are not touched. This protects:

- `~/.claude/settings.json` writes by other tools (gsd, hookify, deckos, etc.)
- User-authored agents, commands, hooks
- Any external modifications to non-Loom paths

Rollback algorithm:

```
1. For each item in active items[]:
   - Read snapshot copy from snapshotPath/<rel-source>.
   - Verify snapshot sha256 matches items[].sha256 from pre-upgrade state.
   - Atomically rename snapshot copy to targetPath.
2. Restore install-state.toon itself from snapshot.
3. Delete snapshot directory.
```

If any step fails, leave snapshot intact and surface error — never corrupt state on rollback failure.

## Hook Compat Enforcement

Hooks read `protocolVersion` on every invocation. If the field is missing (corrupt v3 file) OR if `protocolVersion` is below the hook's embedded `MIN_PROTOCOL_VERSION` constant, the hook fails **closed** — denies the operation it was guarding rather than failing open.

Current behavior of `hooks/file-ownership.ts` (the fallback branch that returns `allow` on unreadable install-state) is a v2 holdover and MUST be reversed when v3 is implemented — that branch should fail closed once `protocolVersion` is enforceable. Tracked as part of the version-compat machinery work.

## Discovery

This schema is registered in `library.yaml` as the `install-state-schema` skill, source `protocols/install-state.schema.md`.

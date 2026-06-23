# PluginInstallState Schema

Canonical TOON schema for the per-machine plugin install record at `~/.loom/install.toon`. Tracks what Loom version is installed, how it was installed (curl vs plugin channel), partial-install forensics, and any in-flight update state. Consumed by `/loom-doctor` (F-04), `/loom-update` (F-12), and the F-05 migration flow.

> Naming note: this schema is distinct from `install-state.schema.md` (the library-catalog install record at `~/.claude/skills/library/install-state.toon` consumed by `/loom-upgrade` and the statusline update checker). The two are unrelated.

Paired TypeScript type: `hooks/lib/types/plugin-install-state.ts`.

> Parser note: the nested-block fields below (`migratedFrom`, `updateInProgress` object variant, `installError`) cannot be read by the current `hooks/lib/toon-reader.ts` — its `parseToon()` skips every indented line. Any consumer that materializes those fields must extend `parseToon()` to handle nested blocks or use a different parser. Absent fields surface as `undefined` (not `null`), which is why the corresponding interface fields are typed as optional.

## Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| installedVersion | string | semver `vX.Y.Z`, required | matches `/^v\d+\.\d+\.\d+$/` |
| installTimestamp | string | ISO 8601, required | RFC 3339 datetime |
| installSourceUrl | string | URL, required | https only |
| runtimeVersion | string | required | e.g., `node-20.11`, `bun-1.0.x` |
| channel | enum | `curl \| plugin`, required | one of two values (C-06) |
| source | enum | required | one of: `curl-script`, `marketplace-browse`, `self-hosted-url`, `direct-link`, `migration`, `beta-channel` (C-06) |
| migratedFrom | object\|null | optional | `{channel, version}` populated by F-05; otherwise `null` |
| lastPing | string\|null | ISO 8601, optional | `null` when `doNotTrack=true` |
| doNotTrack | boolean | required | default `false`; `true` after opt-out (F-11) |
| updateInProgress | object\|enum\|null | optional | `{fromVersion, toVersion, startedAt}` while `/loom-update` is mid-flight; replaced by the literal string `"failed"` when `/loom-update --resume` hits an unrecoverable terminal state; `null` when no update is in flight |
| installError | object\|null | optional | `{step: string, message: string, timestamp: string}` populated when install partially fails — partial-install forensic trace consumed by F-04 `install-interrupted` red check |
| pinnedVersion | string\|null | optional | semver `vX.Y.Z` if the user pinned via `claude plugin add loom@<version>`; honored by F-12 `/loom-update` |

### Sub-shapes

**`migratedFrom` object**

| Field | Type | Constraints |
|-------|------|-------------|
| channel | enum | `curl \| plugin` |
| version | string | semver `vX.Y.Z` |

**`updateInProgress` object (when not `"failed"` or `null`)**

| Field | Type | Constraints |
|-------|------|-------------|
| fromVersion | string | semver `vX.Y.Z` |
| toVersion | string | semver `vX.Y.Z` |
| startedAt | string | ISO 8601 / RFC 3339 |

The literal value `"failed"` is the terminal failure state. `/loom-update --resume` MUST refuse to resume from this state and direct the user to `/loom-update --check` or `/loom-doctor --bundle`.

**`installError` object**

| Field | Type | Constraints |
|-------|------|-------------|
| step | string | symbolic name of the failed installer step |
| message | string | human-readable failure description |
| timestamp | string | ISO 8601 / RFC 3339 |

## Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_install | (file path, singleton) | PRIMARY | Single-row per machine |

## Cascade Behavior

Not applicable (no foreign keys; file singleton).

## TOON Reference Example

```toon
installedVersion: v0.1.0
installTimestamp: 2026-06-15T10:30:00Z
installSourceUrl: https://github.com/loom-ai/loom/releases/download/v0.1.0/loom-v0.1.0.tar.gz
runtimeVersion: bun-1.0.x
channel: plugin
source: marketplace-browse
migratedFrom:
  channel: curl
  version: v0.0.9
lastPing: 2026-06-15T11:00:00Z
doNotTrack: false
updateInProgress:
  fromVersion: v0.1.0
  toVersion: v0.1.1
  startedAt: 2026-06-15T12:00:00Z
installError: null
pinnedVersion: null
```

A clean install with no migration, no opt-out, and no update in flight:

```toon
installedVersion: v0.1.0
installTimestamp: 2026-06-15T10:30:00Z
installSourceUrl: https://github.com/loom-ai/loom/releases/download/v0.1.0/loom-v0.1.0.tar.gz
runtimeVersion: bun-1.0.x
channel: plugin
source: curl-script
migratedFrom: null
lastPing: null
doNotTrack: true
updateInProgress: null
installError: null
pinnedVersion: null
```

A terminal update-failure state:

```toon
installedVersion: v0.1.0
installTimestamp: 2026-06-15T10:30:00Z
installSourceUrl: https://github.com/loom-ai/loom/releases/download/v0.1.0/loom-v0.1.0.tar.gz
runtimeVersion: bun-1.0.x
channel: plugin
source: marketplace-browse
migratedFrom: null
lastPing: 2026-06-15T11:00:00Z
doNotTrack: false
updateInProgress: failed
installError:
  step: swap
  message: rename(.tmp, target) failed with EACCES
  timestamp: 2026-06-15T12:05:00Z
pinnedVersion: null
```

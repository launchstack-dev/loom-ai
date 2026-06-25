---
description: "Update Loom — channel-aware (curl or plugin), with check, resume, pin, rollback"
---

# Loom Update

`/loom-update` is the canonical entry-point for keeping Loom current. It is
channel-aware: it reads `~/.loom/install.toon`, detects whether the install
came in via the curl bootstrap or the Claude Code plugin marketplace, and
dispatches accordingly.

The CLI surface ships in Phase 13 and pairs with the marketplace listing
(Phase 12) to give users a complete lifecycle: install → check → update →
rollback.

## Init guard

This command does NOT mutate project state during `--check`. For `--rollback`,
`--resume`, and the default apply path, the install-state envelope at
`~/.loom/install.toon` is the source of truth — if it is missing the CLI exits
with `install-state-missing` and a hint to re-run the installer.

## Requirements

$ARGUMENTS

### Arguments

Parse flags after `update`. If `--help` is present (or arguments are
malformed), print the usage block below and exit 0.

```
/loom-update [flags]

Update Loom — channel-aware (curl or plugin).

Flags:
  --check                Detect drift between installed and latest versions
  --channel <c>          Override channel: curl | plugin
  --resume               Resume from a killed mid-update marker
  --pin <version>        Pin to <version> (writes install.toon.pinnedVersion)
  --json                 With --check: emit JSON per update-check.schema.md
  --rollback             Restore prior version from v3 inventory snapshot
  --help                 Show this help and exit 0

Examples:
  /loom-update --check
  /loom-update --check --json
  /loom-update
  /loom-update --channel curl
  /loom-update --pin 0.2.0
  /loom-update --resume
  /loom-update --rollback
```

## Implementation

The CLI lives at `scripts/loom-update.ts`. It composes four pure helpers:

- `scripts/lib/update/check.ts` — drift detection. Compares
  `install.toon.installedVersion` with the latest manifest entry. Emits a
  single-line text rendering for humans (S-01 acceptance, ASCII `->`) or a
  flat JSON object per `protocols/update-check.schema.md`.
- `scripts/lib/update/apply.ts` — performs the actual update. Writes
  `install.toon.updateInProgress` atomically before the channel-specific
  action, clears it on success. Plugin path delegates to
  `claude plugin update loom` with a fallback to `claude plugin add loom@<v>`.
  Curl path re-runs the install script pinned to the latest tag.
- `scripts/lib/update/resume.ts` — picks up from a killed mid-update marker.
  Sets the terminal `"failed"` sentinel on `install.toon.updateInProgress`
  when `toVersion` is no longer present in the manifest registry, and exits
  non-zero with guidance to run `/loom-update --check` or `/loom-doctor --bundle`.
- `scripts/lib/update/rollback.ts` — reads the v3 component-inventory at
  `~/.claude/skills/library/install-state.toon` (distinct from the per-machine
  envelope), verifies the snapshot SHA256 chain, and atomically restores the
  prior version's files via a `.staged` peer + rename pattern.

All state mutations to `~/.loom/install.toon` use the existing
`writeInstallStateAtomic` helper from `scripts/lib/install-state.ts` (write to
`.tmp`, then `fs.renameSync`).

## Channel detection

```
1. Read ~/.loom/install.toon → state.channel ∈ {"curl", "plugin"}.
2. If --channel is passed, override (test/migration path).
3. plugin → `claude plugin update loom` → fallback `claude plugin add loom@<v>`.
4. curl   → `curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/<tag>/scripts/install.sh | bash`.
```

## Output Contracts

### `--check` (text)

```
Loom v0.1.0 installed -> v0.2.0 available — run /loom-update to apply
```

Exact ASCII `->`. Em-dash before the action hint. When the install is current,
the line collapses to `Loom v<X> installed — up to date`.

### `--check --json`

Flat JSON per `protocols/update-check.schema.md`:

```json
{
  "schemaVersion": 1,
  "currentVersion": "0.1.0",
  "latestVersion": "0.2.0",
  "behind": 1,
  "pinnedVersion": null,
  "generatedAt": "2026-06-18T00:00:00.000Z",
  "channel": "plugin"
}
```

### Plugin update success

Final stdout line is **exactly**:

```
Claude Code restart required to load new plugin version
```

Consumed by the statusline renderer and by docs Phase 11A as the
canonical user-facing string.

### `--resume` unrecoverable

Stderr:

```
Update unrecoverable. Run /loom-update --check OR /loom-doctor --bundle to file an issue.
```

`install.toon.updateInProgress` is set to the terminal `"failed"` string
sentinel (per the InstallState discriminated union). Exit non-zero.

### `--rollback` errors

| Code | Stream | Meaning |
|---|---|---|
| `ROLLBACK_HASH_MISMATCH` | stderr | Snapshot chain SHA256 doesn't match (corruption or tamper) |
| `ROLLBACK_NO_SNAPSHOT` | stderr | v3 inventory lacks a `snapshot:` block |
| `ROLLBACK_IO` | stderr | Read/write or parse failure |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success (apply, resume, check, rollback completed) |
| 1 | Warning / no-op (e.g. nothing to resume, rollback skipped) |
| 2 | Hard failure (network, manifest, IO, parse, install-state-missing) |

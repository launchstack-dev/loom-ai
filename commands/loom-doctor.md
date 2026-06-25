---
description: "Diagnose Loom install health — channel, hook-wiring, settings, tier checks with optional fix"
---

# Loom Doctor

`/loom-doctor` runs a battery of health checks against the current Loom
install and renders a `DoctorReport` (schema:
`protocols/doctor-report.schema.md`, `schemaVersion: 1`). It is the
canonical convergence signal consumed by `/loom-converge` and the primary
entry-point for the channel-migration workflow (Phase 9B).

## Init guard

This command embeds the shared init-guard prelude — see
`commands/_loom-init-guard.md`. Before executing any check, verify
`.loom/plugin-root` is present (or invoke `hooks/lib/init-guard.ts`).
`/loom-doctor` MUST NOT mutate project state when uninitialized.

## Requirements

$ARGUMENTS

### Arguments

Parse flags after `doctor`. If `--help` is present (or arguments are
malformed), print the usage block below and exit 0.

```
/loom-doctor [flags]

Diagnose Loom install health: channel, hook-wiring, settings, tier.

Flags:
  --json                       Emit raw DoctorReport JSON (schemaVersion=1)
  --quiet                      Suppress per-check pass lines (warn/fail only)
  --output-file <path>         Redirect report to file; stderr keeps progress
  --only <id>                  Run only the named check (registry id)
  --reconcile                  Reconcile install channel (requires confirmation)
  --reset-evidence <check-id>  Clear cached evidence for one check (delegates
                               to MigrationRunner.resetEvidence)
  --fix                        Apply remediation via MigrationRunner.run()
  --bundle                     Package a redacted diagnostic tarball under
                               ~/.cache/loom/bundles/
  --yes                        Skip confirmation prompts (required for
                               --reconcile in non-interactive shells)
  --help                       Show this help and exit 0

Examples:
  /loom-doctor
  /loom-doctor --json
  /loom-doctor --only hook-files-present
  /loom-doctor --quiet --output-file doctor.txt
  /loom-doctor --reconcile --yes
  /loom-doctor --reset-evidence channel-files
  /loom-doctor --fix
  /loom-doctor --bundle
```

## Implementation

The CLI lives at `scripts/loom-doctor.ts`. It calls:

- `scripts/lib/doctor/index.ts` — the dispatcher that dynamically discovers
  every check module under `scripts/lib/doctor/checks/*.ts` at runtime via
  `fs.readdirSync` + dynamic `import()`. Static imports of check files are
  forbidden — they would defeat the parallel-compile pattern with Phase 9A2.
- `scripts/lib/doctor/render.ts` — renders the `DoctorReport` to TTY or JSON.
- `scripts/lib/doctor/bundle.ts` — produces the diagnostic tarball at
  `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601}.tar.gz` with
  `installSourceUrl` and `doNotTrack` redacted.

`--fix`, `--reconcile`, and `--reset-evidence` consume the `MigrationRunner`
interface (`scripts/lib/doctor/migration-runner.interface.ts`); the concrete
implementation ships in Phase 9B (`scripts/lib/migration-runner.ts`) and is
injected at runtime — the CLI surface ships independently.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | All checks `pass` (DoctorReport `overallStatus: clean`) |
| 1 | Warnings or problems detected |
| 2 | Internal error (dispatcher crash, unreadable contract) |

## Output Rendering

Per `protocols/doctor-report.schema.md`:

- Per-check line: `{✓ PASS|⚠ WARN|✗ FAIL} {id} ({category}) — {message}`
- Glyphs (`✓`, `⚠`, `✗`) emitted only on a TTY (`process.stdout.isTTY`).
  Text labels (`PASS`, `WARN`, `FAIL`) are always present.
- `--json` dumps the raw report.

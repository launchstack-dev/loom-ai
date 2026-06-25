---
schemaVersion: 1
name: doctor-report
description: DoctorReport with embedded HealthCheck[] — the structured output of `/loom-doctor`, consumed by `/loom-converge` as a first-class convergence signal.
---

# Doctor Report Schema

Canonical schema for the output of `scripts/loom-doctor.ts`. Emitted as TOON by default and as JSON with `--json`. Conformant output is required for `/loom-converge` to treat doctor findings as convergence input.

## TOON Exemplar

```toon
DoctorReport:
  schemaVersion: 1
  generatedAt: 2026-06-17T12:34:56Z
  installSource: plugin
  tier: local
  overallStatus: warnings
  exitCode: 1
  checks[2]{id,category,status,severity,message,remediation}:
    hook-files-present,hook-wiring,pass,info,"All declared hook files exist","none"
    bare-anchor,settings,warn,warning,"3 entries use legacy bare anchor","run /loom-doctor --fix"
  checks[0].evidence:
    paths[1]: .claude/settings.json
    expected: "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh"
    actual: "hooks/run-hook.sh"
```

## Top-Level Fields

| Field | Required | Type | Description |
|---|---|---|---|
| schemaVersion | yes | int | Currently `1`. |
| generatedAt | yes | iso8601 | UTC timestamp of report generation. |
| installSource | yes | enum | `plugin` \| `curl` \| `unknown`. |
| tier | yes | enum | `local` \| `project` \| `mixed`. |
| overallStatus | yes | enum | `clean` \| `warnings` \| `problems`. |
| checks[] | yes | table | Embedded `HealthCheck` records (see below). |
| exitCode | yes | enum | `0` (clean), `1` (warnings/problems), `2` (internal error). |

## Embedded `HealthCheck`

```toon
HealthCheck:
  id: string                  # stable identifier (e.g., "hook-files-present")
  category: string            # channel | hook-wiring | settings | tier
  status: string              # pass | warn | fail
  severity: string            # info | warning | error
  message: string
  remediation: string         # human-readable next step
  evidence:
    paths[]: string
    expected: string
    actual: string
```

| Field | Required | Type | Description |
|---|---|---|---|
| id | yes | string | Stable identifier; used by `--check <id>` flag. Must match one of the 12 registered IDs in the check registry below. |
| category | yes | enum | `channel` \| `hook-wiring` \| `settings` \| `tier`. |
| status | yes | enum | `pass` \| `warn` \| `fail`. |
| severity | yes | enum | `info` \| `warning` \| `error`. |
| message | yes | string | One-line human description. |
| remediation | yes | string | Next step. `"none"` when status is `pass`. |
| evidence.paths[] | yes | string[] | Files inspected. |
| evidence.expected | yes | string | What the check expected to find. |
| evidence.actual | yes | string | What was actually found. |

## Check Registry (12 checks)

The complete set of doctor checks for M-07. Each `id` here is the value accepted by `--check <id>` and emitted in `DoctorReport.checks[].id`. Categories partition into the 4 enum values above. Phase 9A2a contributes 6 checks; Phase 9A2b contributes 6 checks. Three entries are **new in this plan** and marked accordingly.

```toon
checkRegistry[12]{id,category,severity,phase,new}:
  version-drift,channel,warning,9A2a,false
  channel-files,channel,error,9A2a,false
  install-interrupted,channel,error,9A2a,false
  channel-upgrade-available,channel,info,9A2a,true
  tier-ambiguous,tier,error,9A2a,false
  managed-tier-detected,tier,info,9A2a,true
  hook-files-present,hook-wiring,error,9A2b,false
  runner-resolution,hook-wiring,error,9A2b,false
  anchor-form,hook-wiring,warning,9A2b,false
  orphan-entries,hook-wiring,warning,9A2b,false
  bare-anchor,hook-wiring,warning,9A2b,false
  permissions-derived,settings,warning,9A2b,true
```

| id | Category | Severity | Description |
|---|---|---|---|
| `version-drift` | channel | warning | Installed Loom version differs from the latest published release; emits `VERSION_DRIFT_DETECTED`. |
| `channel-files` | channel | error | Channel envelope (`~/.loom/install.toon`) is missing required files or has corrupt structure; emits `CHANNEL_FILES_MIXED`. |
| `install-interrupted` | channel | error | `install.toon.installError` is non-null — the installer terminated mid-step; emits `INSTALL_INTERRUPTED`. |
| `channel-upgrade-available` | channel | info | **New.** Curl install detected on a host where the Claude Code plugin marketplace is reachable; offers optional `/loom-uninstall` then `/plugin install loom`; emits `CHANNEL_UPGRADE_AVAILABLE`. |
| `tier-ambiguous` | tier | error | Loom entries present in BOTH `.claude/settings.json` and `.claude/settings.local.json`; emits `MIGRATION_TIER_AMBIGUOUS`. |
| `managed-tier-detected` | tier | info | **New.** Loom entries detected in `managed-settings.json` (MDM-managed). Loom treats managed-tier entries as immutable and will not modify them; emits `MANAGED_TIER_DETECTED`. |
| `hook-files-present` | hook-wiring | error | All hook files referenced from `hooks/hooks.json` and from settings entries resolve to existing files on disk; emits `DOCTOR_HOOK_MISSING`. |
| `runner-resolution` | hook-wiring | error | `hooks/run-hook.sh` can locate a runner (`bun` or `npx tsx`); emits `DOCTOR_RUNNER_UNRESOLVED`. |
| `anchor-form` | hook-wiring | warning | Settings entries use canonical anchors (`${CLAUDE_PLUGIN_ROOT}` for plugin, `${CLAUDE_PROJECT_DIR}` for curl) matching the install source. |
| `orphan-entries` | hook-wiring | warning | Settings entries reference hook files Loom no longer owns; emits `DOCTOR_ORPHAN_ENTRY`. |
| `bare-anchor` | hook-wiring | warning | Legacy bare-path entries (no anchor variable) detected; emits `DOCTOR_BARE_ANCHOR`. |
| `permissions-derived` | settings | warning | **New.** Validates `plugin.json#permissions[]` equals the union of `event` names plus tool names from `hooks/hooks.json` matchers; emits `DOCTOR_PERMISSIONS_MISMATCH`. |

**Category partition:** `channel` = release/install-source health, `hook-wiring` = on-disk hook artefact health, `settings` = plugin-manifest/settings file derivation correctness, `tier` = settings-tier placement health.

## Error Codes (M-07 set)

The 5 codes defined in Plan section 7 plus 4 new codes contributed by Wave 0:

| Code | Severity | Exit | Source |
|---|---|---|---|
| `DOCTOR_HOOK_MISSING` | error | 1 | Plan §7 |
| `DOCTOR_RUNNER_UNRESOLVED` | error | 1 | Plan §7 |
| `DOCTOR_BARE_ANCHOR` | warning | 1 | Plan §7 |
| `DOCTOR_ORPHAN_ENTRY` | warning | 1 | Plan §7 |
| `MIGRATION_OWNERSHIP_DIVERGED` | warning | 1 | Plan §7 |
| `DOCTOR_HOOK_TIMEOUT` | warning | 1 | **Wave 0 (this schema)** — a hook exceeded its declared `timeoutMs` during the doctor health-check probe. |
| `DOCTOR_PERMISSIONS_MISMATCH` | warning | 1 | **Wave 0 (this schema)** — `hooks.json` matcher union differs from `plugin.json#permissions[]`. |
| `DOCTOR_VERSION_SKEW` | warning | 1 | **Wave 0 (this schema)** — installed Loom version differs from `MigrationEvidence.recordedAt` snapshot version. |
| `DOCTOR_UPDATE_AVAILABLE` | info | 0 | **Wave 0 (this schema)** — newer release detected by `loom-update-checker.cjs`; informational only. |

## Human-readable TOON Output Rendering

When `--json` is not set, the CLI MUST render:

- Header: `[loom-doctor v{version}] installSource={...} tier={...} status={...}`
- Per-check: `{icon} {id} ({category}) — {message}` where icon is `✓` / `⚠` / `✗`
- Footer: `Summary: N checks passed, M warnings, K errors. Exit code: {exitCode}.`

This rendering is asserted via snapshot test in `test/loom-doctor.test.ts`.

## Consumer Cross-Reference

```toon
consumers[2]{wave,agent,usage}:
  wave-2,wave-2-doctor-agent,emits-this-report-from-scripts/loom-doctor.ts
  wave-4,wave-4-e2e-agent,asserts-checks[].id-stability-across-fixtures
```

## Cross-References

- `migration-evidence.schema.md` — `DOCTOR_VERSION_SKEW` reads `recordedAt` from MigrationEvidence; `MIGRATION_OWNERSHIP_DIVERGED` surfaces evidence-divergence findings.
- `hook-manifest.schema.md` — canonical-anchor strings drive `DOCTOR_BARE_ANCHOR`.
- `plugin-manifest.schema.md` — `permissions[]` derivation drives `DOCTOR_PERMISSIONS_MISMATCH`.

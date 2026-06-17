---
planVersion: 2
name: plugin-marketplace-merged
status: approved
created: 2026-06-17
approvedAt: 2026-06-17
lastReviewed: null
roadmapRef: planning/ROADMAP.md
milestoneRef: M-07
featureRefs:
  - F-15
  - F-16
  - F-17
supersedes:
  - planning/plans/PLAN-plugin-distribution.md
  - planning/plans/PLAN-plugin-marketplace-migration.md
totalPhases: 18
totalWaves: 12
lastReviewed: 2026-06-17
lastIntegrated: 2026-06-17
convergenceTiers:
  - unit
  - integration
  - e2e
  - qa-review
reviewRefs:
  - planning/history/reviews/2026-06-17-PLAN-plugin-marketplace-merged-review.toon
  - planning/history/reviews/2026-06-17-PLAN-plugin-marketplace-merged-review-pass2.toon
  - planning/history/reviews/2026-06-17-PLAN-plugin-marketplace-merged-review-pass3.toon
---

# Plan: plugin-marketplace-merged

## Overview

Ship Loom as a native Claude Code plugin (`/plugin marketplace add launchstack-dev/loom-ai`) **and** preserve the curl `install.sh` path as a first-class equivalent for enterprise / MDM-blocked-network installs. This plan supersedes `PLAN-plugin-distribution.md` and `PLAN-plugin-marketplace-migration.md` — see `planning/notes/plan-distribution-vs-migration-reconciliation.md` for the cherry-pick rationale. Three design conflicts are resolved upfront: (1) curl is non-sunset, (2) `register-loom-hooks.ts` is preserved indefinitely for curl users while plugin users get hooks declared via `hooks/hooks.json`, (3) a single unified `/loom-doctor` ships with a check registry merging channel-correctness checks (formerly F-04) with hook-wiring checks (formerly F-16). The plan covers the **full first-class user lifecycle** at MS-F: install, doctor, update, uninstall, and the curl→plugin upgrade journey. Out of scope: install telemetry server (deferred — but a cheap weekly-cron aggregator over locally-written `install.toon.source` ships in Phase 4), doctor v2 advanced schema checks (deferred), sunset criterion machinery (rejected as premature). All deferred items move to ROADMAP M-08 (placeholder).

> **Review integration note (2026-06-17, pass 3 applied — structural convergence):** This plan integrates BLOCKING + CRITICAL findings from passes 1, 2, and 3 (see `reviewRefs` frontmatter). Key changes from the v1 draft: Phase 9 split first into **9A + 9B** (pass 2), then 9A further split into **9A1 (CLI surface — dispatcher, render, bundle, command markdown, integration test) + 9A2 (12 check modules + tests)** (pass 3 fix B-2-3) — 9A1, 9A2, 9B all run parallel in Wave 5a compiling against Phase 0 interfaces. Phase 10 split into **10A (TierResolution logic + register-loom-hooks core, Wave 5b) + 10B (mechanical command-file --tier passthroughs + hooks/hooks.json modification, Wave 5c, surgical-read enforced)** per pass 3 fix C-2-4. Waves 2, 3, 5, 6 decoupled into a/b sub-waves. `MigrationRunner` AND `Check` interfaces both live in **Phase 0** (pass 2 + pass 3 fixes B-2-1, B-2-3) so Wave 5a parallelism is sound. Phase 13 (`/loom-update`) and Phase 14 (`/loom-uninstall`) moved into Wave 6a so MS-F ships a complete lifecycle. New `CHANNEL_UPGRADE_AVAILABLE` doctor check + curl→plugin migration UX added to Phase 9A2. Cheap install-source aggregator added to Phase 4. Phase 8 harness verifies `/loom-converge` is present post-install. `--reconcile`, `--quiet`, `--output-file`, `--reset-evidence` defined in CLI contract. `--json` output standardized on JSON across all CLIs. `--rollback` flag added to `loom-update` with `scripts/lib/update/rollback.ts` deliverable. Render contract gains text labels (`PASS|WARN|FAIL`) alongside `✓⚠✗` glyphs (non-TTY strips glyphs) for terminal/screen-reader parity.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js 18-24, bun (preferred) | Installer, hooks, doctor, scripts |
| Language | TypeScript 5.x (strict, ESM) | Resolver, doctor, manifest generator, tier resolution |
| Testing | vitest (`bunx vitest run`) | Unit + integration + E2E |
| Container | Docker (alpine base) | Clean-machine E2E harness |
| GHA local runner | act (nektos/act) | Phase 6 release-pipeline convergence target |
| Signing | sigstore/cosign | Release asset attestation |
| Data format | TOON | All Loom artifacts per CLAUDE.md |
| Shell | POSIX sh | `install.sh`, `hooks/run-hook.sh`, `scripts/refresh-upstream-schemas.sh` |
| Upstream schema | Anthropic plugin reference (`code.claude.com/docs/en/plugins-reference.md`) | Pinned snapshot in `agents/protocols/upstream/plugin.schema.json`; refreshed by CI |

## Schema / Type Definitions

All schemas live under `agents/protocols/` and were authored in Wave 0 of M-07 (already on disk — `plugin-manifest.schema.md`, `hook-manifest.schema.md`, `doctor-report.schema.md`, `migration-evidence.schema.md`, `settings-tier.schema.md`, `migration-runner.schema.md`, `upstream/plugin.schema.json`). Two additional schemas land in Phase 0 of this plan: `update-check.schema.md` and `submission-evidence.schema.md`. This section is the canonical TypeScript-facing snapshot.

> **Schema reconciliation (review finding):** The `InstallState` definition below is a **per-machine install envelope** at `~/.loom/install.toon`, NOT the on-disk `agents/protocols/install-state.schema.md` v3 component-inventory (which lives at `~/.claude/skills/library/install-state.toon` and tracks per-component SHA256 for rollback). The two schemas describe **different concerns at different paths** — they coexist. Phase 0 includes an explicit acceptance criterion that both schemas remain on disk, neither is renamed, and `~/.loom/install.toon` is the canonical channel/source state for the doctor and update CLIs. The v3 component-inventory is consumed only by the rollback path (see `loom-update --rollback`).

### InstallState (per-machine, at `~/.loom/install.toon`)

| Field | Type | Constraints | Validation Rules |
|---|---|---|---|
| installedVersion | string | required | `/^v\d+\.\d+\.\d+$/` |
| installTimestamp | string | required | ISO 8601 RFC 3339 |
| installSourceUrl | string | required | https only |
| runtimeVersion | string | required | e.g. `node-20.11`, `bun-1.0.x` |
| channel | enum | required | `curl \| plugin` |
| source | enum | required | `curl-script \| marketplace-browse \| self-hosted-url \| direct-link \| migration` |
| migratedFrom | object \| null | optional | `{channel, version}` |
| lastPing | string \| null | optional | ISO 8601 |
| doNotTrack | boolean | required | default `false` |
| updateInProgress | object \| enum \| null | optional | `{fromVersion, toVersion, startedAt}` or `failed` terminal |
| installError | object \| null | optional | `{step, message, timestamp}` |
| pinnedVersion | string \| null | optional | semver matches `installedVersion` regex |

**Indexes:** singleton file; no DB indexes. **Cascade:** N/A.

### PluginManifest (at `.claude-plugin/plugin.json`)

| Field | Type | Constraints | Validation Rules |
|---|---|---|---|
| name | string | required | `"loom"` |
| version | string | required | semver; MUST match `package.json#version` |
| description | string | required | non-empty |
| keywords | string[] | required | non-empty array |
| license | string | required | SPDX identifier (e.g. `"MIT"`) |
| author | object | required | `{name, email?, url?}` |
| repository | string | required | https URL |
| homepage | string | optional | https URL |
| permissions | string[] | required | Derived from `hooks.json` matchers (union of all event names + tool-name matchers). Validated by the `permissions-derived` check in Phase 9A. |
| agents | string | optional | path to agents dir, e.g. `"./agents/"` |
| commands | string \| string[] | optional | path(s) to commands |
| skills | string | optional | path to skills dir |
| hooks | string | optional | path to `hooks.json` |
| mcpServers | string | optional | path to mcp config |
| outputStyles | string | optional | path to styles dir |

**Cascade:** N/A — declarative manifest. **Validates against** the pinned upstream snapshot at `agents/protocols/upstream/plugin.schema.json` (refreshed weekly by `scripts/refresh-upstream-schemas.sh`).

### HookManifest (at `hooks/hooks.json`)

| Field | Type | Constraints |
|---|---|---|
| hooks.SessionStart[] | object[] | `{matcher: "*", hooks: [{type: "command", command: string, timeout?: number}]}` |
| hooks.PreToolUse[] | object[] | `{matcher: regex string, hooks: [...]}` |
| hooks.PostToolUse[] | object[] | same shape |
| hooks.Stop[] | object[] | same shape |

All `command` values MUST use the `${CLAUDE_PLUGIN_ROOT}` anchor. UserPromptSubmit is reserved for F-10 (wiki-context-suggester) and not registered in this plan.

### DoctorReport (CLI output of `loom-doctor`)

| Field | Type | Constraints |
|---|---|---|
| schemaVersion | int | `1` |
| generatedAt | string | ISO 8601 |
| installSource | enum | `plugin \| curl \| unknown` |
| tier | enum | `local \| project \| mixed \| n/a` |
| overallStatus | enum | `clean \| warnings \| problems` |
| checks[] | HealthCheck[] | non-empty |
| exitCode | int | `0 \| 1 \| 2` |

### HealthCheck (embedded in DoctorReport)

| Field | Type | Constraints |
|---|---|---|
| id | string | stable identifier (see check registry below) |
| category | enum | `channel \| hook-wiring \| settings \| tier` |
| status | enum | `pass \| warn \| fail` |
| severity | enum | `info \| warning \| error` |
| message | string | human-readable |
| remediation | string | human-readable next step |
| fixCommand | string \| null | optional CLI command that resolves the problem |
| evidence | object | `{paths[], expected, actual}` |

> **Schema reconciliation (review finding):** The current on-disk `agents/protocols/doctor-report.schema.md` declares the `category` enum as `files | runtime | settings | tier`. This plan's check registry uses `channel | hook-wiring | settings | tier`. Phase 0 includes an explicit acceptance criterion that the on-disk schema is updated to match this plan's enum (i.e., `files` → `hook-wiring`, `runtime` → `channel`). The exemplar block in the on-disk schema must be regenerated to use the new enum values.

**Check registry (the unification):**

| ID | Category | Severity | Source plan |
|---|---|---|---|
| `version-drift` | channel | warn | dist-F-04 |
| `channel-files` | channel | error | dist-F-04 |
| `install-interrupted` | channel | error | dist-F-04 |
| `channel-upgrade-available` | channel | info | NEW (curl→plugin migration UX) |
| `hook-files-present` | hook-wiring | error | mig-F-16 |
| `runner-resolution` | hook-wiring | error | mig-F-16 |
| `anchor-form` | hook-wiring | warn | mig-F-16 |
| `orphan-entries` | hook-wiring | warn | mig-F-16 |
| `bare-anchor` | hook-wiring | warn | mig-F-16 (legacy pre-PR-8) |
| `permissions-derived` | hook-wiring | warn | NEW (validates plugin.json permissions[] matches hooks.json matchers) |
| `tier-ambiguous` | tier | error | mig-F-16 |
| `managed-tier-detected` | tier | info | NEW (graceful-degrade for MDM-managed installs) |

### MigrationEvidence (at `.claude/loom-migration.log.toon`)

| Field | Type | Constraints |
|---|---|---|
| schemaVersion | int | `1` |
| recordedAt | string | ISO 8601 |
| source.path | string | absolute path to settings file |
| source.sha256 | string | hex64 hash at registration time |
| rewrites[] | object[] | `{key, before, after}` |
| outcome | enum | `applied \| refused-ownership-guard \| not-needed \| failed` |
| reason | string | human-readable |

### SettingsTier

```
values:      user, project, local, managed
precedence:  managed > project > local > user
default for register-loom-hooks: local
```

### TierResolution algorithm

Inputs: `explicitFlag (auto|local|project|null)`, `existingLocalEntries (bool)`, `existingProjectEntries (bool)`. Output: `chosenTier (local|project)`, `reason (explicit|preserve-prior|default|conflict-refused)`, `conflictDetected (bool)`. When both `existingLocalEntries` and `existingProjectEntries` are true with no explicit flag, output is `conflict-refused` with the doctor `tier-ambiguous` check firing.

## API Specification

This plan ships CLIs, not HTTP endpoints. Each command's behavior is specified as a CLI contract.

### CLI: `loom-doctor`

```
loom-doctor [--json] [--fix [--reconcile]] [--only <check-id>] [--bundle] [--tier <auto|local|project>]
            [--quiet] [--output-file <path>] [--reset-evidence <check-id>] [--help]
```

| Flag | Behavior |
|---|---|
| `--json` | Emit DoctorReport as **JSON** to stdout (default render is TOON; this flag toggles to JSON for machine consumption) |
| `--fix` | Run idempotent auto-migration via `scripts/lib/migration-runner.ts`, then re-check |
| `--reconcile` | Used with `--fix`. When `channel-files` is failing (mixed-channel state), remove the conflicting channel's files (`~/.claude/plugins/loom/` if `install.toon.channel=curl`, or the curl-installed hook entries if `install.toon.channel=plugin`) and update `install.toon.migratedFrom` with a record of the surviving channel. Requires confirmation prompt unless `--yes` is also passed. |
| `--only <id>` | Run only the named check (renamed from `--check` to avoid collision with `/loom-update --check`) |
| `--bundle` | Produce `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601}.tar.gz` with redacted install.toon + report |
| `--tier auto\|local\|project` | Constrain checks to a tier; default `auto` inspects all |
| `--quiet` | Suppress `pass` checks from rendered output; emit only `warn` and `fail` lines. Exit code semantics unchanged. Intended for CI logs. |
| `--output-file <path>` | Redirect the report (TOON or JSON per `--json`) to `<path>` instead of stdout. Stderr still receives progress lines. |
| `--reset-evidence <check-id>` | Remove the MigrationEvidence record for the named check from `.claude/loom-migration.log.toon`, allowing a subsequent `--fix` to overwrite ownership-divergent settings. Prompts for confirmation; the only walkable recovery path for `MIGRATION_OWNERSHIP_DIVERGED`. |
| `--help` | Print usage to stdout, exit 0 |

**Exit codes:** `0` clean, `1` warnings/problems, `2` internal error. Exit code `9` is reserved for `INSTALL_CONFLICT_PLUGIN_AND_CURL` (install.sh, not doctor).

**Rendering contract** (default, non-JSON path):
- Header: `[loom-doctor v{version}] installSource={...} tier={...} status={...}`
- Per check: `{✓ PASS|⚠ WARN|✗ FAIL} {id} ({category}) — {message}` — text labels alongside the Unicode glyph make the output unambiguous for screen readers, restricted SSH terminals, and CI log scrapers. The glyph is decorative; the text label is the semantic signal.
- Footer: `Summary: N passed, M warnings, K errors. Exit code: {exitCode}.`
- Non-TTY detection: when stdout is not a TTY, glyphs are stripped and only text labels emit (e.g., `PASS hook-files-present (hook-wiring) — All 6 PreToolUse hooks resolve`).

### CLI: `register-loom-hooks.ts`

```
bun scripts/register-loom-hooks.ts [--tier <auto|local|project>] [--mode <project-dir|plugin-root>] [--replace] [--dry-run]
```

| Flag | Behavior |
|---|---|
| `--tier auto` | Default. Resolves via TierResolution |
| `--tier local` | Force `.claude/settings.local.json` |
| `--tier project` | Force `.claude/settings.json`; prints commit notice |
| `--mode` | Path anchor style: `project-dir` (curl) or `plugin-root` (plugin) |
| `--replace` | Overwrite Loom-owned entries |
| `--dry-run` | Print planned writes; no mutation |

`--mode` and `--tier` are orthogonal axes. The value `local` means different things in each — `--mode local` does not exist; `--tier local` writes to `settings.local.json`. `--help` MUST document the distinction.

### CLI: `loom-update`

```
loom-update [--check] [--json] [--channel <curl|plugin>] [--resume] [--rollback] [--pin <version>] [--help]
```

Behavior: `--check` reports drift in a single-line format (`Loom v{a} installed -> v{b} available — run /loom-update to apply`; ASCII `->` arrow used for terminal portability). `--check --json` emits **JSON** (not TOON) `{currentVersion, latestVersion, behind, pinnedVersion}` conforming to `agents/protocols/update-check.schema.md`. `--resume` completes from an `install.toon.updateInProgress` marker. `--rollback` reads the v3 component-inventory at `~/.claude/skills/library/install-state.toon` (per existing on-disk `install-state.schema.md`), verifies the prior snapshot's SHA256 chain, and restores the previous version. Rollback is the documented recovery path for an `install.toon.updateInProgress=failed` terminal state. Final stdout on plugin update: `Claude Code restart required to load new plugin version`.

### CLI: `loom-uninstall`

```
loom-uninstall [--purge-project-state] [--dry-run] [--yes] [--help]
```

Behavior: base prompt 60s timeout exits `1` with no mutation. `--purge-project-state` requires typed `uninstall` literal; any other input rejects. `--dry-run` lists every planned removal without mutation.

### External API Contracts (Anthropic-owned)

- `.claude-plugin/plugin.json` — per `code.claude.com/docs/en/plugins-reference`
- `hooks/hooks.json` — same reference
- Settings tier hierarchy (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`) — per `code.claude.com/docs/en/settings`

Loom treats these as upstream. On schema drift only `agents/protocols/plugin-manifest.schema.md`, `agents/protocols/hook-manifest.schema.md`, and `agents/protocols/upstream/plugin.schema.json` need updates (the last is automated by `scripts/refresh-upstream-schemas.sh` + `.github/workflows/refresh-upstream-schemas.yml`).

## State Machines

### Migration State

```toon
states[]: not-needed, needed, in-progress, applied, refused-ownership-guard, failed
transitions[]{from,to,trigger}:
  not-needed,needed,SessionStart-detects-bare-anchor
  not-needed,needed,SessionStart-detects-orphan-entry
  needed,in-progress,migration-hook-acquires-lock
  in-progress,applied,write-success-and-evidence-recorded
  in-progress,refused-ownership-guard,hash-divergence-detected
  in-progress,failed,io-error-or-schema-corrupt
  applied,not-needed,subsequent-SessionStart-idempotent-pass
  refused-ownership-guard,needed,user-runs-loom-doctor-fix
```

### Doctor State

```toon
states[]: clean, warnings, problems
transitions[]{from,to,trigger}:
  clean,warnings,non-fatal-check-fails
  clean,problems,fatal-check-fails
  warnings,problems,additional-fatal-check
  warnings,clean,fix-applied-and-rechecked
  problems,clean,fix-applied-and-rechecked
  problems,warnings,fix-partially-applied
```

### Update State (drives `install.toon.updateInProgress`)

```toon
states[]: idle, in-progress, completed, failed
transitions[]{from,to,trigger}:
  idle,in-progress,loom-update-apply-invoked
  in-progress,completed,write-success-marker-cleared
  in-progress,failed,unrecoverable-resume-target-missing
  failed,idle,loom-update-check-or-doctor-bundle-resolved
```

## Error Handling Specification

Every error code emitted by any CLI in this plan. JSON envelope: `{error: {code, message, fixCommand?, evidence?}}`.

| Code | Severity | Exit | Source CLI | Remediation |
|---|---|---|---|---|
| `DOCTOR_HOOK_MISSING` | error | 1 | loom-doctor | Re-run `/plugin install loom` or `install.sh`; missing hook file at expected path |
| `DOCTOR_RUNNER_UNRESOLVED` | error | 1 | loom-doctor | Install `bun` or ensure `npx tsx` works; `hooks/run-hook.sh` could not locate a runner |
| `DOCTOR_BARE_ANCHOR` | warning | 1 | loom-doctor | Run `/loom-doctor --fix` to rewrite legacy entries to anchored form |
| `DOCTOR_ORPHAN_ENTRY` | warning | 1 | loom-doctor | Run `/loom-doctor --fix`; entry references a hook file Loom no longer owns |
| `CHANNEL_FILES_MIXED` | error | 1 | loom-doctor | Run `/loom-doctor --fix --reconcile` to align channel state |
| `INSTALL_INTERRUPTED` | error | 1 | loom-doctor | `install.toon.installError` is non-null; rerun installer for the channel listed in `installError.step` |
| `VERSION_DRIFT_DETECTED` | warning | 1 | loom-doctor | Run `/loom-update` |
| `MIGRATION_OWNERSHIP_DIVERGED` | warning | 1 | loom-doctor / SessionStart hook | Settings file hash differs from recorded evidence. Walkable recovery: (1) inspect the divergent settings file (path emitted in `evidence.paths[0]`); (2) if your edit was intentional, run `/loom-doctor --reset-evidence <check-id>` (the `--reset-evidence` flag prompts for confirmation, then removes the stale evidence record and lets the next migration overwrite cleanly); (3) if unexpected, restore the settings file from your VCS history (`git checkout HEAD .claude/settings.local.json`) or backup. No automated `--force` override — by design. |
| `CHANNEL_UPGRADE_AVAILABLE` | info | 0 | loom-doctor | Curl install detected on a machine where the Claude Code plugin marketplace is reachable. Optional upgrade: `/loom-uninstall` (curl side) then `/plugin install loom`. Populates `install.toon.migratedFrom` on completion. |
| `MANAGED_TIER_DETECTED` | info | 0 | loom-doctor | Loom entries detected in `managed-settings.json` (MDM-managed). Loom does not modify the managed tier. Contact your MDM admin for tier changes; doctor will treat managed entries as immutable. |
| `MIGRATION_SETTINGS_CORRUPT` | error | 2 | loom-doctor / SessionStart hook | Settings JSON unparseable; manual repair required |
| `MIGRATION_TIER_AMBIGUOUS` | error | 1 | loom-doctor / register-loom-hooks | Loom entries in BOTH `.claude/settings.json` (N) and `.claude/settings.local.json` (M). Run `bun scripts/loom-doctor.ts --tier auto` for a resolution report; re-run register with explicit `--tier local` or `--tier project`. |
| `MANIFEST_INVALID` | error | 2 | install.sh / first-run | `plugin.json` or `hooks.json` fails schema validation; reinstall from tagged release |
| `MANIFEST_DRIFT` | error | non-zero | manifest-drift CI | Tarball sha256 does not match `manifest.toon.sha256`; rebuild the release asset |
| `NOT_A_GIT_REPO` | error | 1 | loom-init | `cwd` is not inside a git repo |
| `INSTALL_CONFLICT_PLUGIN_AND_CURL` | error | 9 | install.sh | Plugin already registered; uninstall plugin or skip curl install |

**Retry behavior:** none of these errors are auto-retryable. All require user action or a CI fix.

## Execution Phases

### Phase 0 — Wave 0: Contracts & Schemas

**Agent:** contracts-agent
**Objective:** Verify and ratify the Wave 0 schemas already on disk; reconcile the DoctorReport `category` enum with this plan's check registry; add two new schemas (`update-check.schema.md`, `submission-evidence.schema.md`); refresh the upstream snapshot.
**Dependencies:** None
**File Ownership:** agents/protocols/plugin-manifest.schema.md, agents/protocols/hook-manifest.schema.md, agents/protocols/doctor-report.schema.md, agents/protocols/migration-evidence.schema.md, agents/protocols/settings-tier.schema.md, agents/protocols/migration-runner.schema.md, agents/protocols/update-check.schema.md, agents/protocols/submission-evidence.schema.md, agents/protocols/upstream/plugin.schema.json, agents/protocols/upstream/.meta.toon, scripts/validate-toon-schemas.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| agents/protocols/plugin-manifest.schema.md | Modify — add required `permissions: string[]` field (derived from `hooks.json` matchers); update exemplar block | contracts-agent |
| agents/protocols/hook-manifest.schema.md | Verify | contracts-agent |
| agents/protocols/doctor-report.schema.md | Modify — replace `category` enum (`files \| runtime \| settings \| tier`) with this plan's (`channel \| hook-wiring \| settings \| tier`); add the 12-check registry table; regenerate exemplar block to match new enum | contracts-agent |
| agents/protocols/migration-evidence.schema.md | Verify | contracts-agent |
| agents/protocols/settings-tier.schema.md | Modify — document `managed` tier as immutable for Loom; reference `managed-tier-detected` check | contracts-agent |
| agents/protocols/migration-runner.schema.md | Verify | contracts-agent |
| agents/protocols/update-check.schema.md | **Create** — schema for `/loom-update --check --json` output: `{currentVersion, latestVersion, behind: int, pinnedVersion: string \| null}` | contracts-agent |
| agents/protocols/submission-evidence.schema.md | **Create** — schema for `marketplace/submission-evidence.toon`: `{submittedAt, releaseTag, sigstoreAttestationUrl, marketplacePrUrl, maintainerApprovalIssueUrl, outcome: pending \| accepted \| rejected}` | contracts-agent |
| scripts/lib/doctor/migration-runner.interface.ts | **Create (moved from Phase 9A, pass 2 fix B-2-1)** — TypeScript interface `MigrationRunner { run(): Promise<MigrationEvidence>; reconcile(channel): Promise<void>; resetEvidence(checkId): Promise<void> }` consumed by Phase 9A1's `--fix` dispatch and implemented by Phase 9B's `scripts/lib/migration-runner.ts`. Lives in Phase 0 so 9A1 and 9B compile against it in parallel without a sibling dependency. | contracts-agent |
| scripts/lib/doctor/check.interface.ts | **Create (pass 3 fix B-2-3)** — TypeScript interface `Check { id: string; category: 'channel' \| 'hook-wiring' \| 'settings' \| 'tier'; run(state: InstallState): Promise<HealthCheck>; }` implemented by each Phase 9A2 check module and dispatched by Phase 9A1's `scripts/lib/doctor/index.ts`. Same parallel-safety pattern as MigrationRunner. | contracts-agent |
| agents/protocols/upstream/plugin.schema.json | Refresh via `scripts/refresh-upstream-schemas.sh` | contracts-agent |
| agents/protocols/upstream/.meta.toon | Updated by the refresh script | contracts-agent |
| scripts/validate-toon-schemas.ts | Create — validates every `agents/protocols/*.schema.md` | contracts-agent |

#### Acceptance Criteria

- [ ] `bunx tsx scripts/validate-toon-schemas.ts` exits 0
- [ ] Every schema file has a TOON-format exemplar block
- [ ] `agents/protocols/doctor-report.schema.md` `category` enum matches this plan's check registry exactly (`channel \| hook-wiring \| settings \| tier`); the exemplar block uses the new enum values
- [ ] `agents/protocols/doctor-report.schema.md` includes the 12-check registry from this plan (3 new entries: `channel-upgrade-available`, `permissions-derived`, `managed-tier-detected`)
- [ ] `agents/protocols/plugin-manifest.schema.md` declares `permissions: string[]` as a required field
- [ ] **InstallState reconciliation acknowledged:** the existing on-disk `agents/protocols/install-state.schema.md` (v3 component-inventory at `~/.claude/skills/library/install-state.toon`) is preserved unchanged; this plan's `InstallState` (channel envelope at `~/.loom/install.toon`) is a separate concern. A new note at the top of `install-state.schema.md` documents the relationship: v3 is consumed only by `loom-update --rollback`; channel envelope is consumed by doctor + update CLIs.
- [ ] `agents/protocols/update-check.schema.md` and `agents/protocols/submission-evidence.schema.md` exist and validate
- [ ] `scripts/refresh-upstream-schemas.sh --check` exits 0 on CI (snapshot in sync with live docs)
- [ ] `tsc --noEmit` exits 0

#### Convergence Targets

- All nine schema files (7 existing + 2 new) pass the validator
- DoctorReport exemplar block parses against the regenerated category enum
- Upstream snapshot extracted from live docs without manual edits
- Schema linter reports zero references to undefined types

### Phase 1 — Wave 1: Plugin-root resolver

**Agent:** implementer-agent
**Objective:** Implement `hooks/lib/plugin-root-resolver.ts` as the single resolution layer for plugin-root-relative paths.
**Dependencies:** Phase 0
**File Ownership:** hooks/lib/plugin-root-resolver.ts, hooks/lib/plugin-root-resolver.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| hooks/lib/plugin-root-resolver.ts | Create | implementer-agent |
| hooks/lib/plugin-root-resolver.test.ts | Create | implementer-agent |

#### Acceptance Criteria

- [ ] `resolvePluginRoot(cwd)` reads `.loom/plugin-root` and returns absolute path
- [ ] Falls back to repo-relative paths when `.loom/plugin-root` absent
- [ ] `bunx vitest run hooks/lib/plugin-root-resolver.test.ts` exits 0
- [ ] `grep -RE '\${CLAUDE_PLUGIN_ROOT}|~/\.claude/plugins/loom' agents/ skills/ commands/` returns 0 matches outside resolver and the upstream-schema fixture
- [ ] Resolver detects an active plugin install (`${CLAUDE_PLUGIN_ROOT}` set by Claude Code) and returns the plugin path even when a `.loom/plugin-root` pointer is present (plugin wins)

#### Convergence Targets

- Returns `~/.claude/plugins/loom/` when given a project with `.loom/plugin-root`
- Returns repo-relative fallback when pointer absent
- Static lint: no inline `${CLAUDE_PLUGIN_ROOT}` references outside the resolver module

#### Scenarios

```toon
id: S-01
title: Resolver returns absolute plugin root from pointer file
given[2]: A project contains .loom/plugin-root with pluginRoot "~/.claude/plugins/loom", The pointer file is readable
when: resolvePluginRoot(cwd) is invoked
whenTriggerType: api-call
then[2]: The function MUST return "~/.claude/plugins/loom" expanded to absolute path, No error MUST be thrown
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Resolver prefers $CLAUDE_PLUGIN_ROOT over project pointer
given[2]: CLAUDE_PLUGIN_ROOT env var is set to /home/x/.claude/plugins/loom, A project also has .loom/plugin-root pointing elsewhere
when: resolvePluginRoot(cwd) is invoked
whenTriggerType: api-call
then[1]: The function MUST return the env-var path
stateRef:
tags[2]: edge-case, regression
testTier: unit
automatable: true
```

```toon
id: S-03
title: No inline CLAUDE_PLUGIN_ROOT references outside resolver
given[1]: The repo agents/ skills/ commands/ trees exist
when: grep -RE '\${CLAUDE_PLUGIN_ROOT}' is run against those trees excluding hooks/lib/plugin-root-resolver.ts and agents/protocols/upstream/
whenTriggerType: system-event
then[1]: The grep MUST return zero matches
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

### Phase 2 — Wave 1: Plugin manifest + hook PATH safety + mutual-exclusion

**Agent:** implementer-agent
**Objective:** Ship `.claude-plugin/plugin.json`, `hooks/hooks.json`, the PR #9 hook-PATH-wrapper verification, fail-loud logger, and `install.sh` mutual-exclusion probe (exit code 9 on plugin presence).
**Dependencies:** Phase 0
**File Ownership:** .claude-plugin/plugin.json, hooks/hooks.json, hooks/run-hook.sh, hooks/lib/fail-loud-logger.ts, hooks/lib/fail-loud-logger.test.ts, install.sh, scripts/probe-hook-runtime.sh, loom-init-audit-notes.md, test/fixtures/hook-input.json, test/plugin-manifest.test.ts, test/install-mutual-exclusion.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| .claude-plugin/plugin.json | Create — declares name, version, description, license, keywords, author, repository, agents, commands, skills, hooks pointing to hooks/hooks.json | implementer-agent |
| hooks/hooks.json | Create — SessionStart, PreToolUse (Write\|Edit), PostToolUse (Write\|Edit), Stop registered with `${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh` commands | implementer-agent |
| hooks/run-hook.sh | Modify — verify PR #9 PATH prepend intact; append `Tip: run /loom-doctor to diagnose hook health` to stderr when dispatched hook exits non-zero | implementer-agent |
| hooks/lib/fail-loud-logger.ts | Create | implementer-agent |
| hooks/lib/fail-loud-logger.test.ts | Create | implementer-agent |
| install.sh | Modify — add plugin-detection pre-flight (`claude plugin list \| grep -q loom`); abort with exit code 9 and migration recipe when plugin present; add post-install stripped-PATH probe | implementer-agent |
| scripts/probe-hook-runtime.sh | Create — invoked by install.sh post-install and by Docker harness | implementer-agent |
| loom-init-audit-notes.md | Create — Phase 2 audit findings; consumed by Phase 3 when authoring `commands/loom-init.md` | implementer-agent |
| test/fixtures/hook-input.json | Create — minimal Claude Code hook stdin fixture | implementer-agent |
| test/plugin-manifest.test.ts | Create — manifest validates against `agents/protocols/upstream/plugin.schema.json`; every referenced file exists; anchors well-formed | implementer-agent |
| test/install-mutual-exclusion.test.ts | Create — install.sh exits 9 with `INSTALL_CONFLICT_PLUGIN_AND_CURL` when plugin already registered | implementer-agent |

#### Acceptance Criteria

- [ ] `plugin.json` validates against `agents/protocols/upstream/plugin.schema.json` (unit tier)
- [ ] `hooks.json` registers SessionStart, PreToolUse, PostToolUse, Stop with `${CLAUDE_PLUGIN_ROOT}` anchors (unit tier)
- [ ] `env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh hooks/deploy-guard.ts` exits 0 with no stderr (integration tier)
- [ ] Same probe succeeds for all 6 PreToolUse hooks: deploy-guard, context-budget, budget-tracker, contract-lock, file-ownership, wiki-write-guard
- [ ] When neither bun nor node resolves, `~/.cache/loom/hook-failures.log` receives a timestamped entry with `hookScriptPath` populated to the absolute `.ts` path
- [ ] `install.sh` post-install probe runs under stripped PATH and warns on failure
- [ ] `install.sh` exits with code 9 and emits `INSTALL_CONFLICT_PLUGIN_AND_CURL` when a Loom plugin install is detected (integration tier)
- [ ] Minimal-container probe: `docker run --rm -v $PWD:/loom alpine sh /loom/hooks/run-hook.sh /loom/hooks/deploy-guard.ts < /loom/test/fixtures/hook-input.json` exits 0
- [ ] **Tarball sha256 verification (pass 3 fix F-3-5):** `install.sh` computes `sha256sum` of the downloaded release tarball and compares against `manifest.toon.sha256` BEFORE extraction. On mismatch: exit with `MANIFEST_INVALID` and do not extract. Verified by integration test that swaps the tarball for a tampered copy.
- [ ] `loom-init-audit-notes.md` documents the C-16 PATH dependency (NOT `commands/loom-init.md`; that file is owned by Phase 3)

#### Convergence Targets

- All 6 PreToolUse hooks exit 0 under `env -i HOME=$HOME PATH=/usr/bin:/bin`
- Fail-loud log file written on runtime probe failure
- install.sh exit code 9 on mutual-exclusion conflict

#### Scenarios

```toon
id: S-01
title: install.sh refuses to install when plugin already present
given[2]: A machine has Loom installed via /plugin install loom, install.sh is invoked
when: The install.sh pre-flight runs
whenTriggerType: actor-action
then[3]: install.sh MUST exit with code 9, stderr MUST contain INSTALL_CONFLICT_PLUGIN_AND_CURL, stderr MUST print a one-line migration recipe directing the user to /loom-uninstall
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-02
title: Wrapper succeeds under stripped PATH for all 6 PreToolUse hooks
given[2]: Bun is installed at /opt/homebrew/bin/bun, PATH is stripped to /usr/bin:/bin
when: env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh is invoked for each of the 6 PreToolUse hooks
whenTriggerType: api-call
then[2]: Each invocation MUST exit 0, No stderr output MUST be emitted
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

```toon
id: S-03
title: plugin.json validates against the pinned upstream schema
given[1]: agents/protocols/upstream/plugin.schema.json is the current refreshed snapshot
when: ajv validate -s agents/protocols/upstream/plugin.schema.json -d .claude-plugin/plugin.json is invoked
whenTriggerType: system-event
then[1]: The validator MUST exit 0
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

### Phase 3 — Wave 2b: First-invocation graceful no-op (loom-init)

> **Wave 2b serial-after 2a (pass 2 fix B-2-2):** Phase 3 depends on Phase 5's `marketplace/loom-init-success-output.toon`. Placing them in the same wave re-creates the forward-reference race. Phase 3 now runs in Wave 2b after Phases 4 + 5 (Wave 2a) merge.

**Agent:** implementer-agent
**Objective:** Implement graceful no-op for all `/loom-*` commands, 24h suppression marker, and author `commands/loom-init.md` (SOLE writer per Wave 2 ownership resolution).
**Dependencies:** Phase 0, Phase 1, Phase 2, Phase 5 (consumes `marketplace/loom-init-success-output.toon`)
**File Ownership:** hooks/lib/init-guard.ts, hooks/lib/init-guard.test.ts, hooks/lib/dismissal-marker.ts, hooks/lib/dismissal-marker.test.ts, commands/_loom-init-guard.md, commands/loom-init.md

> **Forward-reference resolution (review finding):** v1 of this plan listed `commands/loom-init.md` as `Create` but the file already exists at 22,769 bytes. Phase 3 MODIFIES the existing file: replaces the body to integrate the init-guard snippet, the Phase 2 audit notes, and the Phase 5 success-output spec. The wave-wiring step is folded into Phase 3's own implementer-agent action (no separate wiring agent needed), since the agent already reads Phase 5's output as a dependency.

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| hooks/lib/init-guard.ts | Create | implementer-agent |
| hooks/lib/init-guard.test.ts | Create | implementer-agent |
| hooks/lib/dismissal-marker.ts | Create | implementer-agent |
| hooks/lib/dismissal-marker.test.ts | Create | implementer-agent |
| commands/_loom-init-guard.md | Create — shared snippet imported by every `/loom-*` command | implementer-agent |
| commands/loom-init.md | **Modify** — existing 22,769-byte file; rewrite to integrate init-guard snippet, Phase 2 audit notes (`loom-init-audit-notes.md`), and Phase 5 success-output spec (`marketplace/loom-init-success-output.toon`). Preserve any existing semantics that don't conflict with the merged plan. | implementer-agent |

#### Acceptance Criteria

- [ ] `/loom-status` invoked without `.loom/plugin-root` emits exact prompt: `Loom is not initialized in this project. Run /loom-init to activate.`
- [ ] Same command within 24h of dismissal exits 0 silently
- [ ] `.loom/dismissed-init-prompt` written atomically via `.tmp` rename per CLAUDE.md
- [ ] `bunx vitest run hooks/lib/init-guard.test.ts hooks/lib/dismissal-marker.test.ts` exits 0
- [ ] No `/loom-*` command mutates project state when `.loom/plugin-root` is absent (except `/loom-init` itself)
- [ ] Idempotency: if `.loom/plugin-root` already exists, `/loom-init` is a no-op with stdout `Loom already initialized in this project. Use /loom-update to upgrade or /loom-doctor to diagnose.` and exit 0
- [ ] `/loom-init --help` exits 0 and prints usage to stdout

#### Convergence Targets

- First-display prompt is exact string match
- Suppression marker is TOON-formatted with `dismissedAt` field
- 24h boundary tested with mocked time

#### Scenarios

```toon
id: S-01
title: First /loom-* invocation in uninitialized project prints prompt
given[2]: A git repo has no .loom/plugin-root, No .loom/dismissed-init-prompt exists
when: /loom-status is invoked
whenTriggerType: actor-action
then[3]: stdout MUST equal "Loom is not initialized in this project. Run /loom-init to activate.", The command MUST exit 0, .loom/dismissed-init-prompt MUST be written with current dismissedAt
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Repeat invocation within 24h is silent
given[2]: A git repo has no .loom/plugin-root, .loom/dismissed-init-prompt exists with dismissedAt 1 hour ago
when: /loom-status is invoked
whenTriggerType: actor-action
then[2]: stdout MUST be empty, The command MUST exit 0
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-03
title: /loom-init is idempotent when .loom/plugin-root exists
given[1]: A project already has .loom/plugin-root present from a prior init
when: /loom-init is invoked
whenTriggerType: actor-action
then[3]: stdout MUST equal "Loom already initialized in this project. Use /loom-update to upgrade or /loom-doctor to diagnose.", The command MUST exit 0, No filesystem mutation MUST occur
stateRef:
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

```toon
id: S-04
title: Worktree first-open behaves like fresh project
given[2]: A new worktree has been created from a Loom-initialized main repo, The worktree has no .loom/plugin-root
when: /loom-status is invoked inside the worktree
whenTriggerType: actor-action
then[1]: The graceful no-op prompt MUST fire per S-01
stateRef:
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

### Phase 4 — Wave 2a: install.toon first-run handler + install-source aggregator

**Agent:** implementer-agent
**Objective:** On first invocation (either channel), write `~/.loom/install.toon` with channel, source, runtime version, and timestamps. Detect resumed install state via `updateInProgress` and `installError`. Ship a cheap weekly GHA cron that aggregates opt-in `install.toon.source` reports posted to a GitHub Discussions thread — closes the "lying schema" gap from the strategy review without standing up a telemetry server.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** scripts/lib/install-state.ts, scripts/lib/install-state.test.ts, scripts/lib/first-run.ts, scripts/lib/first-run.test.ts, scripts/install-source-digest.ts, .github/workflows/install-source-digest.yml

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| scripts/lib/install-state.ts | Create — read/write `~/.loom/install.toon` atomically | implementer-agent |
| scripts/lib/install-state.test.ts | Create | implementer-agent |
| scripts/lib/first-run.ts | Create — invoked by SessionStart hook on plugin install AND by install.sh tail on curl install | implementer-agent |
| scripts/lib/first-run.test.ts | Create | implementer-agent |
| scripts/install-source-digest.ts | **Create** — reads a designated GitHub Discussions thread for opt-in user reports of `install.toon.source` values; emits weekly summary counts per source bucket as a discussion comment. No PII, no server, opt-in by user posting. Removes the strategy reviewer's "lying schema" critique. | implementer-agent |
| .github/workflows/install-source-digest.yml | **Create** — weekly cron (Mondays 10:00 UTC) running `scripts/install-source-digest.ts`. Manual dispatch supported. | implementer-agent |
| test/fixtures/discussion-thread.json | **Create (pass 3 fix F-3-7)** — fixture for `scripts/install-source-digest.ts` testing; 3-5 sample posts with `install.toon.source` values | implementer-agent |

#### Acceptance Criteria

- [ ] `install.toon` is written atomically via `.tmp` rename
- [ ] On plugin install, `channel="plugin"` and `source="marketplace-browse"` (default) or `source="direct-link"` when invoked via `/plugin install <url>`
- [ ] On curl install, `channel="curl"` and `source="curl-script"` (default) or `source="self-hosted-url"` when `LOOM_INSTALL_URL` is set
- [ ] `installedVersion` matches the version in `.claude-plugin/plugin.json`
- [ ] First-run handler is idempotent — re-invocation does NOT overwrite an existing `install.toon` unless `installedVersion` differs
- [ ] **Field freeze contract:** `installTimestamp`, `installSourceUrl`, `source`, `channel` are frozen after first write (re-invocation never modifies). `lastPing` may update. `updateInProgress`, `pinnedVersion`, `installError`, `migratedFrom` are never modified by first-run (other CLIs own them). Idempotency means: when `installedVersion` matches, the frozen fields are byte-for-byte unchanged.
- [ ] When the previous install left `updateInProgress` set, the handler preserves it (does not clear); only `loom-update` may clear it
- [ ] `bunx vitest run scripts/lib/install-state.test.ts scripts/lib/first-run.test.ts` exits 0
- [ ] `scripts/install-source-digest.ts` parses a fixture GitHub Discussion thread (test fixture under `test/fixtures/discussion-thread.json`) and emits a TOON-formatted summary
- [ ] `.github/workflows/install-source-digest.yml` validates with `actionlint`

#### Convergence Targets

- `~/.loom/install.toon` exists after first invocation in both channels
- Frozen fields are byte-for-byte stable across re-invocations of the same version
- Atomic write: no partial-write state observable mid-operation
- Weekly digest workflow validates and the script runs on the test fixture

#### Scenarios

```toon
id: S-01
title: Plugin install writes install.toon with channel=plugin
given[1]: A clean machine with no ~/.loom/install.toon
when: SessionStart hook fires on first plugin invocation
whenTriggerType: system-event
then[3]: ~/.loom/install.toon MUST exist, channel MUST equal "plugin", source MUST be one of marketplace-browse/direct-link
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Curl install writes install.toon with channel=curl
given[1]: A clean machine with no ~/.loom/install.toon
when: install.sh completes successfully and invokes first-run
whenTriggerType: system-event
then[2]: channel MUST equal "curl", source MUST equal "curl-script"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: First-run preserves an in-progress update marker
given[1]: install.toon already exists with updateInProgress set
when: first-run is re-invoked
whenTriggerType: system-event
then[1]: updateInProgress MUST be preserved unchanged
stateRef: in-progress
tags[2]: edge-case, regression
testTier: unit
automatable: true
```

### Phase 5 — Wave 2a: Listing copy + loom-init success-output artifact

**Agent:** implementer-agent
**Objective:** Author marketplace listing copy AND the canonical `/loom-init` success-output reference artifact. **This phase fixes the listing-side gap that PLAN-plugin-marketplace-migration left under-specified.**
**Dependencies:** Phase 0
**File Ownership:** marketplace/listing.md, marketplace/listing-checklist.md, marketplace/listing-content-spec.md, marketplace/loom-init-success-output.toon

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| marketplace/listing.md | Create — full marketplace listing copy (140-char summary, 500-char description, screenshots references, categorization tags) | implementer-agent |
| marketplace/listing-checklist.md | Create — pre-submission checklist consumed by Phase 12 publish agent | implementer-agent |
| marketplace/listing-content-spec.md | Create — section-by-section content contract (summary length, description length, screenshot count + alt-text, categorization tags, support contact, version-bump cadence promise) | implementer-agent |
| marketplace/loom-init-success-output.toon | Create — canonical reference artifact for the `/loom-init` success-output; Phase 3 merges this into `commands/loom-init.md` via Wave 2→3 wiring; Phase 8 reads this as source of truth for `test/fixtures/expected-init-output.txt` | implementer-agent |

#### Acceptance Criteria

- [ ] `marketplace/listing.md` summary ≤ 140 chars, description ≤ 500 chars, includes ≥ 3 screenshot references
- [ ] Listing leads with outcomes (planning waves, convergence loops, repo-committed wiki) — NOT a feature list
- [ ] Listing surfaces curl-path mention with the phrase "Enterprise / network-blocked installs use the curl path — see docs"
- [ ] Listing includes verbatim: `Community-supported. GitHub issues only. No SLA.`
- [ ] Listing includes single onboarding CTA: `/plugin marketplace add launchstack-dev/loom-ai` followed by `/plugin install loom`
- [ ] `marketplace/loom-init-success-output.toon` defines three required sections: (a) files written, (b) suggested next command, (c) `Run /loom-doctor to verify` prompt
- [ ] `marketplace/listing-content-spec.md` is the contract referenced by Phase 12 marketplace submission; it includes a section-list table (Header, Outcomes, Quickstart, Decision matrix, Differentiation, Support) with a per-section character budget
- [ ] Named maintainer review gate: before the marketplace submission PR opens (Phase 12), a GitHub issue assigned to the repo owner explicitly approves the listing copy; the submission PR description links to the resolved review issue

#### Convergence Targets

- Listing copy passes outcomes-not-features checklist (file-based assertion: count of feature-noun bullets in first paragraph)
- Single install command present in listing.md (single grep match for `/plugin install loom`)
- Support-expectation language present above any installation section (line-ordering assertion)

#### Scenarios

```toon
id: S-01
title: Listing summary length within marketplace constraint
given[1]: marketplace/listing.md exists
when: The summary section is extracted via the marketplace/listing-content-spec.md selector
whenTriggerType: system-event
then[1]: The summary MUST be no more than 140 characters including whitespace
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: /loom-init success output includes the three required sections
given[1]: /loom-init has completed successfully in a fresh git repo
when: stdout is captured
whenTriggerType: actor-action
then[3]: stdout MUST list files written, stdout MUST include a suggested next command, stdout MUST surface the Run /loom-doctor to verify line
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: Listing copy mentions curl path as non-deprecated alternative
given[1]: marketplace/listing.md exists
when: The file is read
whenTriggerType: system-event
then[1]: The substring "Enterprise / network-blocked installs use the curl path" MUST be present
stateRef:
tags[2]: regression, happy-path
testTier: unit
automatable: true
```

### Phase 6 — Wave 3a: Atomic release pipeline

**Agent:** implementer-agent
**Objective:** Single GHA workflow triggered by `git tag vX.Y.Z`: build tarball, upload to GitHub Releases, generate manifest with sha256, open marketplace-repo PR (gated on passing sigstore workflow), auto-generate CHANGELOG. Convergence target runs locally via `act`.
**Dependencies:** Phase 0, Phase 2, Phase 4
**File Ownership:** .github/workflows/release.yml, scripts/build-release-tarball.ts, scripts/generate-manifest.ts, scripts/generate-changelog.ts, scripts/open-marketplace-pr.ts, fixtures/v0.1.0-test-event.json, docs/release-runbook.md

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| .github/workflows/release.yml | Create | implementer-agent |
| scripts/build-release-tarball.ts | Create — dry-run mode emits `dist/loom-local-test.tar.gz` for Phase 8 fixture | implementer-agent |
| scripts/generate-manifest.ts | Create — emits `.claude-plugin/plugin.json` with sha256 of the tarball | implementer-agent |
| scripts/generate-changelog.ts | Create | implementer-agent |
| scripts/open-marketplace-pr.ts | Create — MUST check for a passing sigstore workflow run before opening the marketplace PR | implementer-agent |
| fixtures/v0.1.0-test-event.json | Create — `act push --eventpath` fixture | implementer-agent |
| docs/release-runbook.md | Create — partial-release recovery runbook | implementer-agent |

#### Acceptance Criteria

- [ ] `act push --eventpath fixtures/v0.1.0-test-event.json` runs the workflow end-to-end locally in dry-run mode without pushing a real tag
- [ ] Workflow produces exactly one tarball; in dry-run mode emits to `dist/loom-local-test.tar.gz` (consumed by Phase 8)
- [ ] `manifest.toon` sha256 matches `sha256sum` of the tarball
- [ ] `CHANGELOG.md` entry is auto-generated and committed
- [ ] No manual intervention required between tag-push and PR-open
- [ ] `open-marketplace-pr.ts` checks for a passing sigstore workflow run on the same commit BEFORE opening the marketplace PR
- [ ] Partial-release rollback documented in `docs/release-runbook.md`: if tarball uploaded but marketplace PR not opened, runbook step is `delete the GitHub Release asset, re-tag with patch bump, re-run workflow`

#### Convergence Targets

- `act push --eventpath fixtures/v0.1.0-test-event.json` exits 0 without manual steps
- Tarball uploaded to GitHub Releases AND manifest PR opened in marketplace repo (after sigstore success)
- CHANGELOG.md entry committed with version header `## vX.Y.Z`

#### Scenarios

```toon
id: S-01
title: Tag push produces single tarball with matching sha256 in manifest
given[2]: A clean main branch at HEAD, GitHub Actions secrets are configured
when: git tag v0.1.0-test and git push --tags are executed
whenTriggerType: system-event
then[3]: The release workflow MUST produce exactly one tarball artifact, manifest.toon.sha256 MUST equal sha256sum of the tarball, The GitHub Release MUST contain the same artifact
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Marketplace PR not opened when sigstore failed
given[2]: Release workflow ran but sigstore-attest workflow failed for the same commit, open-marketplace-pr step runs
when: The script checks for a passing sigstore run
whenTriggerType: system-event
then[2]: The script MUST exit non-zero, No marketplace PR MUST be opened
stateRef:
tags[2]: error, regression
testTier: e2e
automatable: true
```

### Phase 7 — Wave 3b: Manifest-drift CI + sigstore attestation

> **Wave 3b serial-after 3a (review finding):** Phase 7 declares Phase 6 as a dependency AND P6's `open-marketplace-pr.ts` references P7's sigstore workflow by name. The original "Wave 3 parallel" claim was incorrect. Phase 7 runs serial-after Phase 6.

**Agent:** implementer-agent
**Objective:** CI check on every tagged release computes sha256 of the Release asset vs manifest and fails on mismatch; sigstore/cosign attestation on the Release asset. **This phase IS M-06 Phase 1 (signed releases) — the `blockedUntil` dependency from PLAN-plugin-marketplace-migration is self-contained.**
**Dependencies:** Phase 0, Phase 6
**File Ownership:** .github/workflows/manifest-drift.yml, .github/workflows/sigstore-attest.yml, scripts/verify-manifest-drift.ts, scripts/sigstore-attest.sh

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| .github/workflows/manifest-drift.yml | Create | implementer-agent |
| .github/workflows/sigstore-attest.yml | Create | implementer-agent |
| scripts/verify-manifest-drift.ts | Create | implementer-agent |
| scripts/sigstore-attest.sh | Create | implementer-agent |

#### Acceptance Criteria

- [ ] Manifest-drift check fails when a hotfix updates manifest sha256 without rebuilding the release asset
- [ ] `cosign verify` passes against the published Loom public key for every signed asset
- [ ] Sigstore attestation runs BEFORE the marketplace listing PR is opened (workflow ordering enforced via `needs:`)
- [ ] Drift failure emits the `MANIFEST_DRIFT` error code

#### Convergence Targets

- Drift-detected hotfix → CI fails with `MANIFEST_DRIFT`
- `cosign verify --certificate-identity ... <asset>` exits 0 for legit assets
- Workflow DAG: attest runs as a required predecessor of `open-marketplace-pr`

#### Scenarios

```toon
id: S-01
title: Manifest hotfix without asset rebuild fails CI
given[2]: A published release with manifest.sha256 X has an unchanged asset, A hotfix PR modifies manifest.sha256 to Y without touching the asset
when: The manifest-drift CI workflow runs on the PR
whenTriggerType: system-event
then[2]: The workflow MUST exit non-zero, The workflow MUST emit MANIFEST_DRIFT error code
stateRef:
tags[2]: error, regression
testTier: e2e
automatable: true
```

```toon
id: S-02
title: cosign verify passes on signed release asset
given[1]: A release asset has been signed via the sigstore workflow
when: cosign verify --certificate-identity loom-release-bot is invoked against the asset
whenTriggerType: api-call
then[1]: The verification MUST exit 0
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

### Phase 8 — Wave 4: Docker clean-machine harness

**Agent:** implementer-agent
**Objective:** Containerized clean-machine harness — Docker base image, install Claude Code, run `/plugin install loom` against a local tarball fixture (or live registry), exercise first-invocation flow with stripped subprocess PATH.
**Dependencies:** Phase 0, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6
**File Ownership:** test/docker/Dockerfile, test/docker/run-harness.sh, test/plugin-install-e2e.test.ts, test/worktree-init.test.ts, test/fixtures/expected-init-output.txt

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| test/docker/Dockerfile | Create — alpine base, installs node 20 + bun + Claude Code | implementer-agent |
| test/docker/run-harness.sh | Create — accepts `--local-tarball <path>` or `--tag <vX.Y.Z>` | implementer-agent |
| test/plugin-install-e2e.test.ts | Create | implementer-agent |
| test/worktree-init.test.ts | Create | implementer-agent |
| test/fixtures/expected-init-output.txt | Create — generated from `marketplace/loom-init-success-output.toon` | implementer-agent |

#### Acceptance Criteria

- [ ] `bun test test/plugin-install-e2e.test.ts` exits 0 inside a fresh container
- [ ] Harness accepts `--local-tarball <path>` and consumes Phase 6 dry-run output at `dist/loom-local-test.tar.gz`
- [ ] Worktree fixture verifies independent per-worktree `.loom/plugin-root`
- [ ] All 6 PreToolUse hooks pass the PATH-strip verification matrix (env -i, PATH=/usr/bin:/bin)
- [ ] Harness verifies Phase 3 prompt → `/loom-init` → working state pipeline
- [ ] Harness verifies Phase 5 success-output spec; `test/fixtures/expected-init-output.txt` is generated from `marketplace/loom-init-success-output.toon`
- [ ] **`/loom-converge` availability check:** after `/plugin install loom` completes inside the container, the harness asserts `commands/loom-converge.md` exists in the installed plugin path AND `/loom-converge --help` exits 0. Guards the differentiator claim in the Phase 11 README contract. (Same check runs on the curl-installed fixture.)

#### Convergence Targets

- E2E test exits 0 on fresh container build
- Worktree scenario produces independent `.loom/plugin-root` per worktree
- Hook PATH probe matrix: all 6 hooks × stripped PATH = exit 0, no stderr
- `/loom-converge` present and `--help`-responsive in both install paths inside the container

#### Scenarios

```toon
id: S-01
title: Clean-machine harness completes plugin-install end-to-end
given[2]: A fresh Docker container with minimal base image, Claude Code is installed into the container
when: The harness runs /plugin install loom against the local tarball fixture and the subsequent flow
whenTriggerType: system-event
then[3]: The first /loom-* invocation MUST print the Phase 3 graceful no-op prompt, /loom-init MUST succeed and write .loom/plugin-root, A subsequent /loom-status MUST exit 0 without the prompt
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Worktree gets independent .loom/plugin-root
given[2]: The main repo has been Loom-initialized inside the container, A new worktree is created from the main repo
when: /loom-init is invoked inside the worktree
whenTriggerType: actor-action
then[2]: The worktree MUST contain its own .loom/plugin-root, The main repo .loom/plugin-root MUST remain unchanged
stateRef:
tags[2]: edge-case, regression
testTier: e2e
automatable: true
```

```toon
id: S-03
title: All 6 PreToolUse hooks exit 0 under stripped PATH in container
given[1]: The Linux Docker container has bun at /usr/local/bin/bun and PATH is stripped to /usr/bin:/bin
when: env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh is invoked for each of the 6 PreToolUse hooks
whenTriggerType: api-call
then[2]: Every invocation MUST exit 0, No stderr output MUST be emitted from any invocation
stateRef:
tags[2]: regression, happy-path
testTier: e2e
automatable: true
```

### Phase 9A1 — Wave 5a: /loom-doctor CLI surface (dispatcher + rendering)

**Agent:** implementer-agent
**Objective:** Ship the `/loom-doctor` CLI entry, check-module dispatcher, rendering, bundle, and integration test. Does NOT implement check modules (Phase 9A2) or migration runner (Phase 9B). All three Wave 5a phases run in parallel, compiling against Phase 0 interfaces.
**Dependencies:** Phase 0 (consumes `check.interface.ts`, `migration-runner.interface.ts`, all schemas), Phase 1, Phase 2, Phase 4

> **Pass 3 split (B-2-3):** Original Phase 9A had 20 deliverables — over the 12-cap. Split into 9A1 (CLI surface, **6 deliverables**) and 9A2 (12 check modules + test, 13 deliverables). Both reference the `Check` interface declared in Phase 0; the dispatcher uses dynamic `import.meta.glob` (or equivalent) to load `scripts/lib/doctor/checks/*.ts` at runtime, so 9A1 and 9A2 compile independently. **`test/loom-doctor.test.ts` (9A1-owned) MUST NOT statically import any `scripts/lib/doctor/checks/*.ts` file** — it exercises the dispatcher only; static imports would defeat the parallel-compile pattern (parallelization-agent finding).

**File Ownership:** commands/loom-doctor.md, scripts/loom-doctor.ts, scripts/lib/doctor/index.ts, scripts/lib/doctor/bundle.ts, scripts/lib/doctor/render.ts, test/loom-doctor.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| commands/loom-doctor.md | Create | implementer-agent |
| scripts/loom-doctor.ts | Create — CLI entry; argparse for all flags (`--reconcile`, `--quiet`, `--output-file`, `--reset-evidence`); calls dispatcher and renderer | implementer-agent |
| scripts/lib/doctor/index.ts | Create — registry dispatcher; loads `scripts/lib/doctor/checks/*.ts` at runtime (does not statically import the check modules — keeps 9A1 independent of 9A2 at compile time) | implementer-agent |
| scripts/lib/doctor/bundle.ts | Create — `--bundle` output; redaction rules: strip `installSourceUrl`, `doNotTrack`; keep `channel`, `source`, version fields | implementer-agent |
| scripts/lib/doctor/render.ts | Create — TOON / JSON rendering per CLI contract; text labels alongside glyphs; non-TTY strips glyphs | implementer-agent |
| test/loom-doctor.test.ts | Create — integration: dispatcher loads all 12 checks (from 9A2), JSON snapshot of report, exit codes, `--quiet` filters pass lines, `--output-file` writes to path, `--reconcile` requires confirmation, `--reset-evidence` removes named record. **Test depends on 9A2's check modules existing at wave-merge time.** | implementer-agent |

#### Acceptance Criteria

- [ ] `scripts/lib/doctor/index.ts` dynamically discovers and dispatches every check module under `scripts/lib/doctor/checks/*.ts` (no static imports of check files; verified by `tsc --noEmit` passing without 9A2 deliverables present in dev, only at wave-merge time)
- [ ] `/loom-doctor --json` emits DoctorReport conforming to `agents/protocols/doctor-report.schema.md` with `schemaVersion=1`
- [ ] `--reconcile` requires a confirmation prompt unless `--yes` is also passed
- [ ] `--reset-evidence <check-id>` removes the named record from `.claude/loom-migration.log.toon` after confirmation; subsequent `--fix` succeeds where previously refused
- [ ] `--quiet` suppresses `pass` lines; exit codes unchanged
- [ ] `--output-file <path>` redirects report; stderr still receives progress
- [ ] Rendering: per-check line uses format `{✓ PASS|⚠ WARN|✗ FAIL} {id} ({category}) — {message}`; glyphs stripped when stdout is not a TTY
- [ ] `--bundle` produces `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601}.tar.gz` with `installSourceUrl` and `doNotTrack` redacted
- [ ] `--only <id>` runs only the named check
- [ ] `--fix` invokes the `MigrationRunner` interface (implementation injected from Phase 9B at runtime)
- [ ] `/loom-doctor --help` exits 0 and prints usage
- [ ] Wave-merge integration: with 9A2's check modules and 9B's migration-runner present, `/loom-doctor` on a fresh install reports zero problems and exits 0 (e2e tier)

#### Convergence Targets

- Dispatcher dynamically loads all check modules (verified by integration test post-merge)
- JSON output snapshot matches expected format
- Text-label rendering present in both TTY and non-TTY modes
- `--bundle` output is a valid `.tar.gz`

#### Scenarios

(S-01..S-05 from prior 9A section apply — moved here unchanged.)

### Phase 9A2 — Wave 5a: /loom-doctor check modules

**Agent:** implementer-agent
**Objective:** Implement all 12 check modules under `scripts/lib/doctor/checks/`. Each module exports a class conforming to Phase 0's `Check` interface. Pure-function check logic; no dispatcher concerns.
**Dependencies:** Phase 0 (consumes `check.interface.ts`, all schemas), Phase 1, Phase 2, Phase 4

**File Ownership:** scripts/lib/doctor/checks/*.ts (12 modules), scripts/lib/doctor/__tests__/checks.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| scripts/lib/doctor/checks/version-drift.ts | Create — uses injectable fetch interface for testability | implementer-agent |
| scripts/lib/doctor/checks/channel-files.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/install-interrupted.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/channel-upgrade-available.ts | Create — fires on curl machines where Claude Code plugin marketplace is reachable; severity info, exit 0; remediation directs user to `/loom-uninstall` then `/plugin install loom` | implementer-agent |
| scripts/lib/doctor/checks/hook-files-present.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/runner-resolution.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/anchor-form.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/orphan-entries.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/bare-anchor.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/permissions-derived.ts | Create — validates `plugin.json#permissions[]` matches the union of `hooks.json` matchers | implementer-agent |
| scripts/lib/doctor/checks/tier-ambiguous.ts | Create | implementer-agent |
| scripts/lib/doctor/checks/managed-tier-detected.ts | Create — detects Loom entries in `managed-settings.json`; info-severity; does NOT trigger tier-ambiguous | implementer-agent |
| scripts/lib/doctor/__tests__/checks.test.ts | Create — one test per check; uses injectable fetch / fs / install-state fixtures | implementer-agent |

#### Acceptance Criteria

- [ ] Each of the 12 check files exports a default class implementing Phase 0's `Check` interface; verified by `tsc --noEmit` of every module against `scripts/lib/doctor/check.interface.ts`
- [ ] Each check has a corresponding test fixture with at least one happy-path and one fail/warn case
- [ ] `bunx vitest run scripts/lib/doctor/__tests__/checks.test.ts` exits 0
- [ ] `channel-upgrade-available` fires on a curl machine when the plugin marketplace is reachable; info severity; exit code 0
- [ ] `permissions-derived` fires when `plugin.json#permissions[]` does not match the matcher union from `hooks.json`
- [ ] `managed-tier-detected` fires when `managed-settings.json` has Loom entries; does NOT trigger `tier-ambiguous`
- [ ] Network failure on `version-drift` check yields warn, not fail (graceful degradation); uses injectable fetch interface

#### Convergence Targets

- All 12 check modules implement the Check interface
- Each module passes its dedicated test
- Coverage: every check ID in the doctor-report.schema.md registry has a corresponding `scripts/lib/doctor/checks/{id}.ts` file

#### Scenarios

```toon
id: S-01
title: Doctor returns clean on fresh plugin install
given[1]: A fresh plugin install with no drift and no hook failures
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: overallStatus MUST equal "clean", Every check status MUST be "pass", Exit code MUST be 0
stateRef: clean
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Mixed-channel state surfaces channel-files fail with fixCommand
given[2]: install.toon.channel equals "curl", The directory ~/.claude/plugins/loom/ exists
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: The channel-files check MUST be fail, fixCommand MUST equal "/loom-doctor --fix --reconcile", Exit code MUST be 1
stateRef: problems
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-03
title: bare-anchor check fires on legacy pre-PR-8 entries
given[1]: A settings file contains a Loom hook entry with command "scripts/run-hook.sh" lacking either anchor variable
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[2]: The bare-anchor check MUST be warn, fixCommand MUST equal "/loom-doctor --fix"
stateRef: warnings
tags[2]: regression, edge-case
testTier: integration
automatable: true
```

```toon
id: S-04
title: tier-ambiguous fires when entries in both tiers
given[1]: .claude/settings.json AND .claude/settings.local.json BOTH contain Loom hook entries
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: The tier-ambiguous check MUST be fail, fixCommand MUST be null, message MUST direct user to re-run register with explicit --tier
stateRef: problems
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-05
title: channel-upgrade-available fires on curl machine with reachable marketplace
given[2]: install.toon.channel equals "curl", The Claude Code plugin marketplace endpoint is reachable
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: The channel-upgrade-available check MUST be info severity, Exit code MUST be 0, remediation MUST direct user to /loom-uninstall then /plugin install loom
stateRef: clean
tags[1]: happy-path
testTier: integration
automatable: true
```

### Phase 9B — Wave 5a: Migration runner + SessionStart hook

**Agent:** implementer-agent
**Objective:** Implement the migration subsystem that `/loom-doctor --fix` (Phase 9A) and the SessionStart hook both delegate to. Idempotent legacy rewrites, ownership-evidence enforcement, `MIGRATION_OWNERSHIP_DIVERGED` walkable recovery via `--reset-evidence`.
**Dependencies:** Phase 0, Phase 1, Phase 2, Phase 4
**File Ownership:** scripts/lib/migration-runner.ts, scripts/lib/ownership-evidence.ts, hooks/loom-migration.ts, test/loom-migration.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| scripts/lib/migration-runner.ts | Create — implements the `MigrationRunner` interface declared in **Phase 0** (`scripts/lib/doctor/migration-runner.interface.ts`); methods: `run()`, `reconcile(channel)`, `resetEvidence(checkId)` | implementer-agent |
| scripts/lib/__tests__/migration-runner.test.ts | Create — unit test for migration-runner; referenced by Phase 9B AC vitest invocation (pass 3 fix F-3-3) | implementer-agent |
| scripts/lib/ownership-evidence.ts | Create — hash-based file-divergence detector; appends `MigrationEvidence` records to `.claude/loom-migration.log.toon` | implementer-agent |
| hooks/loom-migration.ts | Create — SessionStart hook; calls `migration-runner.run()`; logs one-line user-visible notice on `applied` outcome (`Loom: applied hook migration to {path}. Run /loom-doctor to review.`) | implementer-agent |
| test/loom-migration.test.ts | Create — migration is idempotent, refuses ownership-divergent files, emits MigrationEvidence, `--reset-evidence` clears records | implementer-agent |

#### Acceptance Criteria

- [ ] `scripts/lib/migration-runner.ts` exports a class that conforms to the `MigrationRunner` interface from `scripts/lib/doctor/migration-runner.interface.ts` (**Phase 0** — pass 3 fix R3-1) — verified by `tsc --noEmit`
- [ ] SessionStart migration is idempotent — running twice produces a byte-identical settings file (integration tier)
- [ ] Migration refuses to rewrite a settings entry whose recorded hash differs from on-disk hash; appends a `MigrationEvidence` record with `outcome=refused-ownership-guard` (integration tier)
- [ ] `MIGRATION_OWNERSHIP_DIVERGED` surfaces as a warn check on the next `/loom-doctor` invocation (delegated assertion — verified in `test/loom-doctor.test.ts` from Phase 9A)
- [ ] `resetEvidence(checkId)` removes the named record after confirmation; subsequent `run()` succeeds where previously refused (integration tier)
- [ ] **User-visible migration notice:** on `outcome=applied`, the SessionStart hook prints to stderr `Loom: applied hook migration to {path}. Run /loom-doctor to review.` (closes the "silent settings mutation" UX gap)
- [ ] `bunx vitest run test/loom-migration.test.ts scripts/lib/__tests__/migration-runner.test.ts` exits 0

#### Convergence Targets

- Migration idempotency verified across 3 consecutive SessionStart invocations
- Ownership-guard rejection verified via fixture hash divergence
- Interface compatibility with Phase 9A verified by `tsc --noEmit` of the combined wave

#### Scenarios

```toon
id: S-01
title: SessionStart migration is idempotent
given[1]: A settings file already migrated by a prior SessionStart
when: SessionStart fires again
whenTriggerType: system-event
then[2]: The settings file MUST be byte-identical before and after, MigrationEvidence outcome MUST equal "not-needed"
stateRef: applied
tags[1]: regression
testTier: integration
automatable: true
```

```toon
id: S-02
title: Migration refuses to rewrite ownership-divergent settings
given[2]: MigrationEvidence records sha256 X for a settings file, The on-disk file now has sha256 Y
when: SessionStart attempts the migration
whenTriggerType: system-event
then[3]: No write MUST occur, MigrationEvidence outcome MUST equal "refused-ownership-guard", MIGRATION_OWNERSHIP_DIVERGED MUST surface as a warn check on the next /loom-doctor invocation
stateRef: refused-ownership-guard
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-03
title: --reset-evidence clears the named record after confirmation
given[2]: MigrationEvidence has a record for check-id bare-anchor with outcome refused-ownership-guard, User runs /loom-doctor --reset-evidence bare-anchor and confirms
when: The CLI delegates to MigrationRunner.resetEvidence("bare-anchor")
whenTriggerType: actor-action
then[2]: The matching record MUST be removed from .claude/loom-migration.log.toon, A subsequent /loom-doctor --fix MUST succeed where previously refused
stateRef:
tags[2]: edge-case, recovery
testTier: integration
automatable: true
```

### Phase 10A — Wave 5b: Tier resolution + register-loom-hooks core logic

**Agent:** implementer-agent
**Objective:** Implement the TierResolution algorithm and the `--tier` flag on `register-loom-hooks.ts`. Append the `loom-migration` SessionStart entry to LOOM_HOOKS for curl users. NO command-file edits (Phase 10B) and NO `hooks/hooks.json` modification (Phase 10B). Tight context budget — only reads `register-loom-hooks.ts` + Phase 9B outputs.
**Dependencies:** Phase 0, Phase 9B (consumes `scripts/lib/migration-runner.ts` and `hooks/loom-migration.ts` paths for the LOOM_HOOKS append)

> **Pass 3 split (C-2-4):** Original Phase 10 read 6 large command files (~35k tokens) before any write. Split into 10A (core logic, ~5k context) and 10B (mechanical command-file passthroughs + hooks.json mod, surgical reads only). 10A produces the `--tier` flag contract; 10B applies it to call sites.

**File Ownership:** scripts/register-loom-hooks.ts, scripts/lib/tier-resolution.ts, scripts/lib/tier-resolution.test.ts, test/tier-resolution.test.ts, test/register-loom-hooks-tier.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| scripts/register-loom-hooks.ts | Modify — add `--tier <auto\|local\|project>` flag; default flip to `local`; append `loom-migration` SessionStart entry to LOOM_HOOKS (curl path) | implementer-agent |
| scripts/lib/tier-resolution.ts | Create — TierResolution algorithm | implementer-agent |
| scripts/lib/tier-resolution.test.ts | Create — unit tests (8 input combinations) | implementer-agent |
| test/tier-resolution.test.ts | Create — integration: auto-resolution, explicit overrides, conflict detection | implementer-agent |
| test/register-loom-hooks-tier.test.ts | Create — writes to settings.local.json by default; `--tier project` opts in to settings.json | implementer-agent |

#### Acceptance Criteria

- [ ] Default `register-loom-hooks.ts` invocation writes to `.claude/settings.local.json` (unit tier)
- [ ] `--tier project` writes to `.claude/settings.json` and emits a notice that the file will be committed (unit tier)
- [ ] `--tier auto` resolves to `local` unless `.claude/settings.json` already contains Loom entries (unit tier)
- [ ] Tier conflict surfaces `MIGRATION_TIER_AMBIGUOUS` and refuses to write without explicit `--tier` (integration tier)
- [ ] Re-running preserves prior tier choice (integration tier)
- [ ] `register-loom-hooks.ts` appends `loom-migration` SessionStart entry to LOOM_HOOKS (integration tier)
- [ ] `--mode` and `--tier` flag distinction is documented in `--help` output
- [ ] **TierResolution unit tests cover all 8 input combinations** of (`explicitFlag`, `existingLocalEntries`, `existingProjectEntries`)

#### Convergence Targets

- TierResolution unit tests cover the 8-input matrix
- Default invocation produces a write to `settings.local.json` only
- `MIGRATION_TIER_AMBIGUOUS` surfaces with sample-conflict-listing in stderr

### Phase 10B — Wave 5c: Command-file --tier passthrough + plugin-path migration wiring

**Agent:** implementer-agent
**Objective:** Apply the `--tier` flag passthrough mechanically to 6 entry-point command files; modify `hooks/hooks.json` to register the `loom-migration` SessionStart entry (symmetric with 10A's register-loom-hooks change). Each command file is a 1-line edit; use targeted `Read` operations (offset/limit) to avoid full-file context bloat.
**Dependencies:** Phase 0, Phase 2 (hooks/hooks.json creator), Phase 3 (commands/loom-init.md creator), Phase 10A (consumes `--tier` flag contract)

**File Ownership:** hooks/hooks.json (Modify), commands/loom-init.md (Modify), commands/loom-auto.md (Modify), commands/loom-roadmap/init.md (Modify), commands/loom-quick.md (Modify), commands/loom-change.md (Modify), commands/loom-plan.md (Modify), test/hooks-json-migration.test.ts

> **Surgical-read instruction:** the 6 command files total ~138k bytes. The agent MUST use `Read` with offset/limit anchored on the `register-loom-hooks` invocation line in each file, NOT a full-file read. Pattern: `grep -n "register-loom-hooks" <file>` → Read 20 lines around the match → Edit. Per-file budget: <2k tokens.

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| hooks/hooks.json | Modify — append a SessionStart entry pointing to `${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration` (plugin path; symmetric with 10A's register-loom-hooks change for curl) | implementer-agent |
| commands/loom-init.md | Modify — surgical edit to pass `--tier` through to `register-loom-hooks.ts` invocation | implementer-agent |
| commands/loom-auto.md | Modify — same surgical pattern | implementer-agent |
| commands/loom-roadmap/init.md | Modify — same | implementer-agent |
| commands/loom-quick.md | Modify — same | implementer-agent |
| commands/loom-change.md | Modify — same | implementer-agent |
| commands/loom-plan.md | Modify — same | implementer-agent |
| test/hooks-json-migration.test.ts | Create — asserts `hooks/hooks.json` includes the loom-migration SessionStart entry with the `${CLAUDE_PLUGIN_ROOT}` anchor | implementer-agent |

#### Acceptance Criteria

- [ ] All 6 entry-point commands (loom-init, loom-auto, loom-roadmap/init, loom-quick, loom-change, loom-plan) pass `--tier` through to `register-loom-hooks.ts` (integration tier)
- [ ] `hooks/hooks.json` includes the loom-migration SessionStart entry (integration tier)
- [ ] `bunx vitest run test/hooks-json-migration.test.ts` exits 0
- [ ] Each command-file edit is a single-line change (verified by `git diff --stat` showing ≤2 lines changed per file)

#### Convergence Targets

- All 6 command-file edits land as single-line changes
- `hooks/hooks.json` carries the loom-migration entry symmetric with curl path
- Full plugin-path SessionStart fires loom-migration when a plugin user opens a session

#### Convergence Targets

- TierResolution unit tests cover all 8 input combinations of (`explicitFlag`, `existingLocalEntries`, `existingProjectEntries`)
- Default invocation produces a write to `settings.local.json` and nothing to `settings.json`
- `MIGRATION_TIER_AMBIGUOUS` surfaces with sample-conflict-listing in stderr

#### Scenarios

```toon
id: S-01
title: Default register writes to settings.local.json
given[1]: A project with no prior Loom entries in either settings file
when: bun scripts/register-loom-hooks.ts is invoked without --tier
whenTriggerType: actor-action
then[3]: .claude/settings.local.json MUST exist with Loom hook entries, .claude/settings.json MUST be absent or contain no Loom entries, stdout MUST mention tier=local
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --tier project opts in to committed file with notice
given[1]: A clean project
when: bun scripts/register-loom-hooks.ts --tier project is invoked
whenTriggerType: actor-action
then[3]: .claude/settings.json MUST receive Loom entries, stdout MUST contain "This file will be committed to the repo", .claude/settings.local.json MUST remain unchanged
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: Tier conflict refuses to write without explicit flag
given[1]: BOTH .claude/settings.json AND .claude/settings.local.json already contain Loom entries
when: bun scripts/register-loom-hooks.ts is invoked without --tier
whenTriggerType: actor-action
then[3]: No write MUST occur, stderr MUST contain MIGRATION_TIER_AMBIGUOUS, Exit code MUST be 1
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

### Phase 11 — Wave 6a: Docs + curl-path E2E

> **Wave 6a (review finding):** Phases 11, 13, and 14 all run in Wave 6a in parallel — disjoint file ownership (README/docs vs scripts/lib/update vs scripts/lib/uninstall). Wave 6b runs Phase 12 (marketplace submission) serial-after 6a so the submission PR can reference the canonical README/decision-matrix from P11 AND assert a complete user lifecycle (install + doctor + update + uninstall) is shipped at MS-F.

**Agent:** implementer-agent
**Dependencies:** Phase 0, Phase 2, Phase 3, Phase 9A1, Phase 9A2, Phase 9B, Phase 10A, Phase 10B (pass 2 fix H-2-2 + pass 3 split: was ambiguously "Phase 9" → "Phase 9A, Phase 9B, Phase 10" → now correctly references the 5 leaf phases)

**Agent:** implementer-agent
**Objective:** Restructure README with explicit plugin-path / curl-path sections, decision matrix, and three E2E specs verifying curl-path correctness AND runtime equivalence. **This phase fixes the docs-side gap that PLAN-plugin-marketplace-migration left under-specified.**
**Dependencies (pass 3 cleanup R3-3):** ~~Phase 0, Phase 2, Phase 3, Phase 9, Phase 10~~ — superseded by the corrected dependency block above (Phase 0, Phase 2, Phase 3, Phase 9A1, Phase 9A2, Phase 9B, Phase 10A, Phase 10B). Stale block retained as a strike-through for changelog clarity; execution agents MUST use the corrected dependency list.
**File Ownership:** README.md, planning/notes/plugin-marketplace-rationale.md, test/e2e/curl-install.spec.ts, test/e2e/runtime-equivalence.spec.ts, docs/install-decision-matrix.md

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| README.md | Modify — restructure per the section-list contract below | implementer-agent |
| planning/notes/plugin-marketplace-rationale.md | Create — kit-author guide; why both paths; how to author kits that work under both anchor variables | implementer-agent |
| test/e2e/curl-install.spec.ts | Create — fresh project → `curl install.sh` → run `/loom-doctor` → zero problems | implementer-agent |
| test/e2e/runtime-equivalence.spec.ts | Create — same `/loom-quick` task under each install path produces equivalent hook fire sequence | implementer-agent |
| docs/install-decision-matrix.md | Create — decision tree referenced from README and the marketplace listing | implementer-agent |

**README section-list contract (acceptance reads against this contract — NOT a one-line "restructure"):**

| Section | Required content | Source of truth |
|---|---|---|
| Hero | One-line tagline + headline differentiation claim | C-14 |
| Outcomes | 3-5 bullet outcomes (planning waves, convergence loops, repo-committed wiki, …) | marketplace/listing.md Outcomes section |
| Quickstart — Plugin path | `/plugin marketplace add launchstack-dev/loom-ai` → `/plugin install loom` → `/loom-init` → `/loom-doctor` | marketplace/listing-content-spec.md |
| Quickstart — Curl path | `curl install.sh` → `/loom-init` → `/loom-doctor` | install.sh |
| Decision matrix | Table: when to use plugin (default), when to use curl (enterprise/MDM, air-gapped, customization-heavy) | docs/install-decision-matrix.md |
| Differentiators | `/loom-doctor` ⊕ `/loom-converge` composability claim; convergence loop diagram | C-14 |
| Troubleshooting | Pointer to `/loom-doctor` and `--bundle` for filing issues | commands/loom-doctor.md |
| Support | `Community-supported. GitHub issues only. No SLA.` | marketplace/listing.md |

#### Acceptance Criteria

- [ ] README contains each of the 8 sections above in the listed order (qa-review tier, automated via section-header grep)
- [ ] README Quickstart presents the plugin path FIRST, curl path SECOND
- [ ] Decision matrix is referenced from both README and `marketplace/listing.md`
- [ ] `planning/notes/plugin-marketplace-rationale.md` covers the decision tree for kit authors
- [ ] Curl-install E2E spec runs green on CI (e2e tier)
- [ ] Runtime-equivalence spec asserts identical hook fire order and identical agent registration list across both install paths (e2e tier)
- [ ] README "Differentiators" section surfaces the `/loom-doctor` + `/loom-converge` composability claim (qa-review tier)

#### Convergence Targets

- README section-header grep produces the 8 section markers in order
- Curl E2E spec exits 0
- Runtime-equivalence spec produces matching `checks[].id` arrays from plugin-fixture and curl-fixture invocations

#### Scenarios

```toon
id: S-01
title: README contains all 8 required sections in order
given[1]: README.md exists
when: grep extracts H2 section headers in document order
whenTriggerType: system-event
then[1]: The extracted list MUST match Hero Outcomes Quickstart-Plugin Quickstart-Curl Decision-matrix Differentiators Troubleshooting Support
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Curl install passes loom-doctor on fresh project
given[1]: A fresh temp project directory with no .claude/
when: curl install.sh is invoked then /loom-doctor is run
whenTriggerType: actor-action
then[2]: install.sh MUST exit 0, /loom-doctor MUST report overallStatus clean and exit 0
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Runtime equivalence between install paths
given[2]: A fixture project plugin-install/ with .claude-plugin/plugin.json and ${CLAUDE_PLUGIN_ROOT}-anchored settings, A fixture project curl-install/ with hooks/run-hook.sh and ${CLAUDE_PROJECT_DIR}-anchored settings
when: /loom-doctor --json is invoked against both fixtures
whenTriggerType: api-call
then[2]: The checks[].id arrays MUST be identical across both fixtures, The checks[].status arrays MUST be identical
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

### Phase 12 — Wave 6b: Marketplace submission + plugin-path E2E (human-gate)

**Agent:** implementer-agent for artifact authoring; **human-gate for convergence** (marketplace acceptance is a third-party decision)
**Objective:** Submit Loom to the Anthropic plugin marketplace registry against a signed release tag (Phase 7 is M-06 Phase 1 self-contained); ship the plugin-path E2E spec. **Per the review finding, this phase produces artifacts that an agent can build but the convergence outcome (`outcome=accepted`) is decided by Anthropic. Convergence is qa-review tier; the agent is done when the submission PR opens with all `submission-evidence.toon` fields populated and `cosign verify` passes.**
**Dependencies:** Phase 0, Phase 5 (listing-content-spec), Phase 7 (signed release), Phase 8 (harness), Phase 11 (decision matrix), Phase 13 (loom-update shipped), Phase 14 (loom-uninstall shipped — MS-F is full-lifecycle ship per user decision Q2)
**File Ownership:** test/e2e/plugin-install.spec.ts, marketplace/submission-pr.md, marketplace/submission-evidence.toon

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| test/e2e/plugin-install.spec.ts | Create — fresh project → `/plugin install loom` (against the signed release tag) → `/loom-doctor` → zero problems | implementer-agent |
| marketplace/submission-pr.md | Create — the PR body for the Anthropic marketplace-registry submission; references `marketplace/listing.md` and the resolved maintainer-approval issue | implementer-agent |
| marketplace/submission-evidence.toon | Create — captures submission state: `submittedAt`, `releaseTag`, `sigstoreAttestationUrl`, `marketplacePrUrl`, `maintainerApprovalIssueUrl`, `outcome (pending\|accepted\|rejected)` | implementer-agent |

#### Acceptance Criteria

- [ ] Plugin-install E2E spec runs green on CI against the signed release tag from Phase 7 (e2e tier)
- [ ] `marketplace/submission-pr.md` body conforms to `marketplace/listing-content-spec.md` (qa-review tier)
- [ ] `marketplace/submission-evidence.toon` is populated with `releaseTag`, `sigstoreAttestationUrl`, and `maintainerApprovalIssueUrl` before submission
- [ ] Submission references a `cosign verify`-passing release asset (verified by CI pre-check, blocking submission on failure)
- [ ] Marketplace listing accepted by Anthropic registry (qa-review tier; populates `outcome=accepted` post-merge)

#### Convergence Targets

- E2E plugin-install spec exits 0 against the live release tag
- Submission PR is open with maintainer-approval issue resolved and linked
- `cosign verify` against the release asset exits 0

#### Scenarios

```toon
id: S-01
title: Plugin-install E2E passes against signed release
given[1]: A signed release vX.Y.Z exists per Phase 7
when: /plugin install loom@vX.Y.Z is invoked in a fresh container then /loom-doctor is run
whenTriggerType: actor-action
then[2]: /plugin install MUST exit 0, /loom-doctor MUST report overallStatus clean
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Submission blocked when maintainer approval issue is unresolved
given[1]: marketplace/submission-evidence.toon references a maintainer-approval issue that is still open
when: The submission CI check runs
whenTriggerType: system-event
then[2]: The check MUST exit non-zero, The submission PR MUST NOT be opened
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

### Phase 13 — Wave 6a: /loom-update

> **Moved into Wave 6a (review finding + user decision Q2):** Strategy and UX agents both flagged that shipping the marketplace listing without a working `/loom-update` strands users. `/loom-update` now ships WITH the listing in Wave 6a. MS-F (sign-off gate) requires the full user lifecycle.

**Agent:** implementer-agent
**Objective:** Ship `/loom-update` with `--check`, `--channel`, `--resume`, `--pin`, `--json`; writes `install.toon.updateInProgress` marker; explicit `Claude Code restart required` final line for plugin updates.
**Dependencies:** Phase 0, Phase 1, Phase 4, Phase 9A1, Phase 9A2, Phase 10A (curl-path update calls `register-loom-hooks.ts` with `--tier` flag added by P10A; pass 3 split)
**File Ownership:** commands/loom-update.md, scripts/loom-update.ts, scripts/lib/update/check.ts, scripts/lib/update/apply.ts, scripts/lib/update/resume.ts, scripts/lib/update/rollback.ts, scripts/lib/update/__tests__/*.test.ts, test/loom-update.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| commands/loom-update.md | Create | implementer-agent |
| scripts/loom-update.ts | Create | implementer-agent |
| scripts/lib/update/check.ts | Create | implementer-agent |
| scripts/lib/update/apply.ts | Create | implementer-agent |
| scripts/lib/update/resume.ts | Create | implementer-agent |
| scripts/lib/update/rollback.ts | **Create** — reads `~/.claude/skills/library/install-state.toon` (v3 component inventory), verifies snapshot SHA256 chain, restores prior version | implementer-agent |
| scripts/lib/update/__tests__/update.test.ts | Create | implementer-agent |
| test/loom-update.test.ts | Create — integration: channel detection, resume from marker, **rollback restores prior version after a failed update**, exit codes | implementer-agent |

#### Acceptance Criteria

- [ ] `/loom-update` on curl install re-runs installer pinned to latest tag, preserves repo-root state
- [ ] `/loom-update` on plugin install delegates to `claude plugin update loom`, falls back to plugin add re-run
- [ ] `/loom-update --check --json` returns **JSON** conforming to `agents/protocols/update-check.schema.md` with fields `currentVersion`, `latestVersion`, `behind`, `pinnedVersion` (pass 2 fix C-2-1: was incorrectly "TOON" in v1)
- [ ] `--resume` completes from a mid-update marker
- [ ] Final stdout line on plugin update: `Claude Code restart required to load new plugin version`
- [ ] `--resume` on unrecoverable marker (toVersion gone) sets `install.toon.updateInProgress` to terminal `failed` state with `fixCommand: "/loom-update --check OR /loom-doctor --bundle to file an issue"`; exits non-zero
- [ ] `--pin <version>` writes `install.toon.pinnedVersion` and runs `claude plugin add loom@<version>` (plugin) or pins curl install URL to the tagged release
- [ ] `/loom-update --help` exits 0 and prints usage

#### Convergence Targets

- `--check` output exact-string match
- Marker write is atomic (`.tmp` → rename)
- Channel detection reads `install.toon.channel`

#### Scenarios

```toon
id: S-01
title: --check reports drift in single-line format
given[2]: install.toon.installedVersion equals "v0.1.0", The latest manifest version is "v0.2.0"
when: /loom-update --check is invoked without --json
whenTriggerType: actor-action
then[1]: stdout MUST equal "Loom v0.1.0 installed -> v0.2.0 available — run /loom-update to apply" (ASCII -> matches CLI contract — pass 3 fix F-3-4)
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --check --json returns structured JSON
given[1]: A version drift exists
when: /loom-update --check --json is invoked
whenTriggerType: actor-action
then[1]: stdout MUST be parseable JSON conforming to agents/protocols/update-check.schema.md with fields currentVersion latestVersion behind and pinnedVersion
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: --resume from killed mid-update marker completes update
given[1]: install.toon.updateInProgress contains {fromVersion v0.1.0 toVersion v0.2.0 startedAt T}
when: /loom-update --resume is invoked
whenTriggerType: actor-action
then[3]: The update MUST complete to v0.2.0, install.toon.updateInProgress MUST be cleared, stdout MUST emit the restart-required line
stateRef: in-progress
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-04
title: Unrecoverable marker exits non-zero with failed terminal state
given[1]: install.toon.updateInProgress.toVersion is not in the manifest registry
when: /loom-update --resume is invoked
whenTriggerType: actor-action
then[3]: Exit code MUST be non-zero, install.toon.updateInProgress MUST equal failed, stderr MUST direct user to /loom-update --check or /loom-doctor --bundle
stateRef: failed
tags[1]: error
testTier: integration
automatable: true
```

### Phase 14 — Wave 6a: /loom-uninstall

> **Moved into Wave 6a (review finding + user decision Q2):** Ships with the listing. `install.sh INSTALL_CONFLICT_PLUGIN_AND_CURL` now references a `/loom-uninstall` that actually exists at MS-F — closes the broken-remediation-in-ship-window gap from the UX review.

**Agent:** implementer-agent
**Objective:** Inverse of install; removes `~/.claude/plugins/loom/`, settings.json hook entries, and `~/.loom/`; preserves project-root state by default; `--purge-project-state` requires typed literal confirmation.
**Dependencies:** Phase 0, Phase 1, Phase 4
**File Ownership:** commands/loom-uninstall.md, scripts/loom-uninstall.ts, scripts/lib/uninstall/index.ts, scripts/lib/uninstall/confirm.ts, scripts/lib/uninstall/__tests__/*.test.ts, test/loom-uninstall.test.ts

#### Deliverables

| File | Action | Owner hint |
|---|---|---|
| commands/loom-uninstall.md | Create | implementer-agent |
| scripts/loom-uninstall.ts | Create | implementer-agent |
| scripts/lib/uninstall/index.ts | Create | implementer-agent |
| scripts/lib/uninstall/confirm.ts | Create | implementer-agent |
| scripts/lib/uninstall/__tests__/uninstall.test.ts | Create | implementer-agent |
| test/loom-uninstall.test.ts | Create — integration: base prompt, typed-literal confirm, timeout, dry-run | implementer-agent |

#### Acceptance Criteria

- [ ] After `/loom-uninstall` with `y` confirmation: `claude plugin list` does not include loom; `~/.loom/` absent; project repo unchanged
- [ ] `--purge-project-state` requires typed `uninstall` literal; any other input leaves project state intact and exits 1
- [ ] `--dry-run` produces complete removal preview without mutation
- [ ] Base-prompt 60s timeout exits with code 1 and no mutation
- [ ] `--yes` bypasses all confirmations
- [ ] Base-prompt shows a countdown `(60s)`; on timeout stderr emits `Confirmation timed out after 60s; no changes made.` before exit 1
- [ ] On curl install: removes `register-loom-hooks.ts`-written entries from both settings tiers; respects `tier-ambiguous` state by listing both files in the dry-run preview
- [ ] `/loom-uninstall --help` exits 0 and prints usage

#### Convergence Targets

- Confirmation prompt exact-string match
- Timeout enforcement is deterministic in test (mocked time)
- `--purge-project-state` requires literal `uninstall` (any variation rejects)

#### Scenarios

```toon
id: S-01
title: Base uninstall with y preserves project state
given[1]: A plugin-installed project with .loom/wiki/ orchestration.toml and .plan-execution/
when: /loom-uninstall is invoked and user types "y"
whenTriggerType: actor-action
then[3]: ~/.loom/ MUST be removed, ~/.claude/plugins/loom/ MUST be removed, .loom/wiki/ and orchestration.toml MUST be unchanged
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --purge-project-state without typed confirmation does not mutate
given[1]: A plugin-installed project with project state present
when: /loom-uninstall --purge-project-state is invoked and user types "yes" (not the literal "uninstall")
whenTriggerType: actor-action
then[2]: No project state MUST be removed, Exit code MUST be 1
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-03
title: 60s timeout on base prompt exits 1 with no mutation
given[1]: /loom-uninstall is awaiting confirmation
when: 60 seconds elapse with no input
whenTriggerType: system-event
then[2]: Exit code MUST be 1, No filesystem mutation MUST occur
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-04
title: --dry-run lists every planned removal
given[1]: A plugin-installed project
when: /loom-uninstall --dry-run is invoked
whenTriggerType: actor-action
then[2]: stdout MUST list ~/.claude/plugins/loom/ ~/.loom/ and any settings.json/settings.local.json hook entries to remove, No mutation MUST occur
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

## Verification Commands

```bash
# Global verification (run end-to-end before merge)
bunx tsc --noEmit
bunx vitest run
scripts/refresh-upstream-schemas.sh --check
bunx tsx scripts/validate-toon-schemas.ts
bunx tsx scripts/install-source-digest.ts --fixture test/fixtures/discussion-thread.json
bash test/docker/run-harness.sh --local-tarball dist/loom-local-test.tar.gz
act push --eventpath fixtures/v0.1.0-test-event.json
grep -RE '\${CLAUDE_PLUGIN_ROOT}|~/\.claude/plugins/loom' agents/ skills/ commands/ \
  | grep -v -F agents/protocols/upstream/ \
  | grep -v -F hooks/lib/plugin-root-resolver.ts \
  && exit 1 || exit 0

# Wave-5a end gate (pass 3 fix F-3-6): runs after 9A1 + 9A2 + 9B merge,
# verifies the Check + MigrationRunner interface implementations resolve.
bunx tsc --noEmit -p scripts/lib/doctor/
bunx tsc --noEmit scripts/lib/migration-runner.ts scripts/lib/ownership-evidence.ts
bunx vitest run scripts/lib/doctor/__tests__/checks.test.ts test/loom-doctor.test.ts test/loom-migration.test.ts

# Wave-5b end gate: 10A merged, --tier contract stable.
bunx tsc --noEmit scripts/register-loom-hooks.ts scripts/lib/tier-resolution.ts
bunx vitest run test/tier-resolution.test.ts test/register-loom-hooks-tier.test.ts

# Wave-5c end gate: 10B merged, command files mechanically updated.
git diff --stat HEAD~1 -- commands/loom-init.md commands/loom-auto.md \
  commands/loom-roadmap/init.md commands/loom-quick.md commands/loom-change.md \
  commands/loom-plan.md | awk '$3 > 2 { print "10B violated surgical-read contract:", $0; exit 1 }'
bunx vitest run test/hooks-json-migration.test.ts
```

## Milestones

| Milestone | Gates |
|---|---|
| **MS-A: Schemas & contracts ratified** | Phase 0 complete (Wave 0) |
| **MS-B: Plugin manifest & curl preserved** | Phases 1, 2 (Wave 1); Phases 4, 5 (Wave 2a); Phase 3 (Wave 2b) |
| **MS-C: Atomic signed release pipeline** | Phases 6, 7 complete (Waves 3a, 3b) — satisfies M-06 Phase 1 internally |
| **MS-D: Clean-machine harness green** | Phase 8 complete (Wave 4) — includes `/loom-converge` presence check |
| **MS-E: Doctor + tier flip green** | Phases 9A1, 9A2, 9B (Wave 5a parallel); Phase 10A (Wave 5b); Phase 10B (Wave 5c) |
| **MS-F: Public marketplace listing with full lifecycle** | Phases 11, 13, 14 (Wave 6a) AND Phase 12 (Wave 6b) complete — **M-07 sign-off gate; full lifecycle (install + doctor + update + uninstall) ships atomically with the listing per user decision Q2** |

> **MS-G removed.** v1 of this plan placed `/loom-update` and `/loom-uninstall` in a follow-on Wave 7 (MS-G), shipping AFTER the marketplace listing. Per strategy + UX review findings (`MS-F before MS-G strands marketplace users`), these phases moved into Wave 6a so MS-F is the complete-lifecycle ship gate.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Upstream Anthropic plugin schema drift breaks Phase 2 manifest validation | `scripts/refresh-upstream-schemas.sh` + weekly CI workflow opens drift PRs; `additionalProperties: true` on snapshot so new fields don't break validation |
| `act` GHA-emulation diverges from real GHA, missing Phase 6 regressions | Phase 7 sigstore step runs against real GHA on every tag; Phase 6 `act` covers fast feedback only |
| Mintlify docs-page extractor regex breaks when Anthropic changes docs format | Refresh script fails loudly (exit 1) with clear error; CI surfaces broken extractor as a workflow failure rather than silent stale snapshot |
| Marketplace registry rejects listing | `marketplace/listing-checklist.md` and named maintainer-approval gate catch issues before submission; Phase 12 captures `outcome` for retry workflow |
| Migration ownership-evidence hash mismatch on user-edited settings files | Refuse-by-default `MIGRATION_OWNERSHIP_DIVERGED`; **walkable recovery via `/loom-doctor --reset-evidence <check-id>`** + VCS-restore fallback; no automated `--force` override |
| Tier ambiguity (entries in both tiers) blocks all subsequent register operations | `MIGRATION_TIER_AMBIGUOUS` error directs user to explicit `--tier` resolution; `/loom-doctor --fix` does NOT auto-resolve (deliberate) |
| Doctor check registry grows unboundedly as new failure modes surface | New checks land via the same `scripts/lib/doctor/checks/*.ts` module pattern; registry table in `agents/protocols/doctor-report.schema.md` is the single source of truth |
| **/loom-converge availability drift** — README differentiator names a command that could regress between releases | Phase 8 harness asserts `commands/loom-converge.md` is present and `/loom-converge --help` exits 0 in both install paths; CI fails on regression |
| **Anthropic ships first-party planning primitives, collapsing the differentiator** | Phase 5 listing-content-spec includes a "durable differentiation" paragraph naming moats that survive first-party competition: TOON-artifact portability, git-committed wiki, kit ecosystem, cross-worktree state management |
| **Curl→plugin migration UX strands curl users on plugin-eligible machines** | `channel-upgrade-available` doctor check (Phase 9A) proactively detects and surfaces the upgrade path; populates `install.toon.migratedFrom` post-completion |
| **Install-source field would be a "lying schema" without an aggregator** | Phase 4 ships `scripts/install-source-digest.ts` + weekly GHA cron; opt-in user reports posted to a Discussions thread; no telemetry server needed |

## Acceptance Criteria (Final)

A user who runs `/plugin marketplace add launchstack-dev/loom-ai`, then `/plugin install loom`, then `/loom-init` in a fresh git repo, then `/loom-doctor`:

1. Sees the success-output spec from `marketplace/loom-init-success-output.toon` after `/loom-init`
2. Sees `overallStatus: clean` with exit code 0 from `/loom-doctor`
3. Can run any `/loom-*` command without further setup

A user on an enterprise-managed machine where `/plugin install` is blocked who runs `curl <install_url> | bash`:

1. Completes installation with no plugin-path conflict
2. Same `/loom-init` → `/loom-doctor` sequence produces the same `overallStatus: clean` result
3. `/loom-doctor` correctly identifies `installSource=curl` and `tier=local`

## Deferred (M-08 placeholder)

Items intentionally NOT in this plan, captured for the follow-up roadmap:

- **F-11 install telemetry server** — server not designed; Phase 4's `install-source-digest.ts` (weekly cron over opt-in Discussions reports) covers the attribution gap without a server
- **F-04b doctor v2 advanced schema checks** (`schema-orch`, `schema-wiki`, `plugin-spec`) — defer until schema drift becomes a real user issue
- **F-08 plugin-declared hooks / strip settings.json** — conflicts with first-class curl path; defer indefinitely or until curl is genuinely sunset (no current trigger)
- **F-13/F-14 sunset criterion + triage labels** — needs real launch data; would be premature
- **F-09b listing copy iteration** — explicitly gated on `launchDate + 30d` data
- **F-10b extended fixtures** (stale-schema, mixed-channel, partial-migration) — chase real bugs as they surface in M-07 launch
- **F-07 full plugin-root resolver (library.yaml + hooks)** — Phase 1's minimal resolver is enough for ship; full resolver becomes load-bearing only when the kit ecosystem grows

## Changelog vs v1 of this plan

| Change | Source | Status |
|---|---|---|
| Phase 9 split into 9A (doctor engine) + 9B (migration subsystem); Wave 5 split into 5a (parallel 9A+9B) + 5b (Phase 10) | review pass 1 — phasing, parallelization, agentic-workflow agents | applied |
| Wave 3 split into 3a (Phase 6) + 3b (Phase 7); Wave 6 split into 6a (Phases 11, 13, 14) + 6b (Phase 12) | review pass 1 — parallelization, phasing | applied |
| Phase 3 dependency adds Phase 5; `commands/loom-init.md` action `Create` → `Modify` | review pass 1 — phasing, agentic-workflow | applied |
| `--reconcile`, `--reset-evidence`, `--quiet`, `--output-file` flags added to `/loom-doctor` CLI contract | review pass 1 — feature-coverage, ux | applied |
| `--rollback` added to `/loom-update` CLI contract; new `scripts/lib/update/rollback.ts` deliverable | review pass 1 — feature-coverage, ux | applied |
| `--check --json` standardized on JSON output (was contradictorily TOON in v1) | review pass 1 — ux | applied |
| Render contract gains text labels (`PASS|WARN|FAIL`) alongside `✓⚠✗` symbols; non-TTY mode strips glyphs | review pass 1 — ux | applied |
| `CHANNEL_UPGRADE_AVAILABLE`, `permissions-derived`, `managed-tier-detected`, `CHANNEL_UPGRADE_AVAILABLE`, `MANAGED_TIER_DETECTED` error codes + checks added to registry (12 total) | review pass 1 — feature-coverage; user decision Q1 (curl→plugin migration UX) | applied |
| `MIGRATION_OWNERSHIP_DIVERGED` remediation rewritten with walkable recovery via `--reset-evidence` | review pass 1 — ux | applied |
| Phase 0 reconciles DoctorReport category enum on-disk; new `update-check.schema.md` and `submission-evidence.schema.md` schemas | review pass 1 — feature-coverage | applied |
| InstallState schema-conflict resolution documented (v3 component-inventory vs channel envelope) | review pass 1 — feature-coverage | applied |
| Phase 4 ships `install-source-digest.ts` + weekly GHA cron | user decision Q3 (telemetry stance) | applied |
| Phase 8 harness asserts `/loom-converge` is present post-install | user decision Q4 (verify and add harness check) | applied |
| Phase 13 (`/loom-update`) + Phase 14 (`/loom-uninstall`) moved into Wave 6a; MS-G removed; MS-F becomes full-lifecycle ship gate | user decision Q2 (move 13+14 into Wave 6) + review findings | applied |
| Phase 10 adds `hooks/hooks.json` modification (loom-migration SessionStart for plugin path, symmetric with curl path) | review pass 1 — phasing | applied |
| Phase 12 reclassified as human-gate for convergence (artifact authoring still implementer-agent) | review pass 1 — agentic-workflow | applied |
| Phase 13 dependency adds Phase 10 (curl update calls `register-loom-hooks.ts` with `--tier`) | review pass 1 — phasing | applied |
| Phase 4 field-freeze contract specified (idempotency: which fields are frozen post-first-write vs which update) | review pass 1 — agentic-workflow | applied |
| Risks table gains rows for `/loom-converge` availability, competitive durability, migration UX, install-source aggregation | review pass 1 — strategy, ux | applied |

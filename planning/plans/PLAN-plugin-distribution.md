---
planVersion: 2
name: "Loom Marketplace & Plugin Distribution"
status: approved
created: 2026-06-15
lastReviewed: 2026-06-15
roadmapRef: planning/ROADMAP-plugin-distribution.md
totalPhases: 17
totalWaves: 9
---

# Plan: Loom Marketplace & Plugin Distribution

**Revision Notes:** v2 refinement: applied 6-agent review findings (planning/history/reviews/2026-06-15-PLAN-plugin-distribution-review.toon).

## Overview

This plan implements the ROADMAP for distributing Loom via the Claude Code marketplace as the primary channel, with curl demoted to a documented escape hatch. It delivers M-01 (marketplace day-one launch — submission-blocking + post-submission fast-follow) and M-02 (plugin-native architecture + sunset evaluation). The plan honors all 16 locked constraints (C-01..C-16), emits TOON artifacts per CLAUDE.md, and gates the marketplace listing on a Docker-based clean-machine harness (C-15) that verifies first-invocation UX (C-11) and hook PATH safety (C-16).

Phasing follows roadmap critical path C-13:
- **Phase 1 (M-01 submission-blocking):** F-01, F-02, F-03, F-06, F-07a, F-09a, F-10a, F-15 — 8 features across Waves 0–4
- **Phase 2 (M-01 post-submission fast-follow):** F-04, F-05, F-11, F-12, F-13 — 5 features across Waves 5a/5b–6
- **Phase 3 (M-02 plugin-native):** F-04b, F-07, F-08, F-09b, F-10b, F-14 — 6 features across Waves 7a/7b–8

### Wave restructuring (per v2 refinement)

- **Wave 5a (Phase 9 — F-04 doctor v1) → Wave 5b (Phase 10 — F-05 migrate):** Phase 10 depends on Phase 9. Wave 5 is no longer parallel. Wave 5b starts only after Wave 5a commits and `npx tsc --noEmit` passes.
- **Wave 7 SEQUENTIAL ordering — Wave 7a (Phase 15 only — F-07 full resolver) → Wave 7b (Phase 14 — F-04b doctor v2) → Wave 7c (Phase 16 — F-08 plugin-declared hooks):** Phase 14 reads manifest paths via Phase 15's resolver at runtime, so cannot run parallel with Phase 15. Phase 16 depends on Phase 15 (resolver) AND Phase 14 (doctor for verification). All three serialize. Previous v2 wording ("Phase 14 + Phase 15 parallel") was contradicted by stated dependencies — corrected.
- **Wave 2→3 wiring step (Phase W2W3-Wiring, owned by wiring-agent):** After Phase 3 and Phase 5 both commit in Wave 2, a Wave 3 wiring step (executed by `wiring-agent` BEFORE Phase 6 begins) merges the text from `marketplace/loom-init-success-output.toon` into `commands/loom-init.md`. This is an explicit Wave 3 task with its own deliverable (the patched `commands/loom-init.md`). Phase 3 owns `commands/loom-init.md`; Phase 5 produces only the canonical artifact. Phase 2 (F-15) audit output lives in `loom-init-audit-notes.md` (NOT `commands/loom-init.md`).
- **Phase 17 split (Wave 8):** Phase 17a (F-10b extended fixtures) + Phase 17b-i (F-14 triage wiring, ships immediately post-M-01) + Phase 17b-ii (F-09b listing iteration, gated on `launchDate + 30d` real marketplace data). Phase 17a dependencies: Phase 6, Phase 8, **Phase 10, Phase 11, Phase 13, Phase 14, Phase 16** — the convergence-loop fixture exercises the full CLI surface including doctor v2 and plugin-declared hooks. Phase 17b-ii has an explicit acceptance criterion: copy must reference real manifest-fetch counter data, not synthetic.

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 18–24 (per F-15) | Installer, hooks, doctor |
| Language | TypeScript | 5.x | Installer, doctor, manifest generator, resolver |
| Package runner | bun | latest | Preferred runtime; npm/npx fallback |
| Testing | vitest | latest | Unit + manifest + doctor + migration tests |
| CI | GitHub Actions | n/a | Atomic release pipeline; manifest-drift; sigstore |
| Signing | sigstore/cosign | latest | Release asset attestation (C-08) |
| Container fixture | Docker | n/a | Clean-machine E2E harness (C-15) |
| GHA local runner | act (nektos/act) | latest | Dev dependency. Enables Phase 6 release-pipeline convergence target to run locally via `act push --eventpath fixtures/v0.1.0-test-event.json` instead of pushing a real tag. Marks Phase 6 scenarios `automatable: true`. |
| Data format | TOON | n/a | All Loom artifacts per CLAUDE.md |
| Shell | POSIX sh | n/a | `install.sh`, `hooks/run-hook.sh` |

## Schema / Type Definitions

All schemas use TOON. Canonical schema files live under `protocols/` and are produced by Phase 0.

### InstallState (per-machine, at `~/.loom/install.toon`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| installedVersion | string | semver `vX.Y.Z`, required | matches `/^v\d+\.\d+\.\d+$/` |
| installTimestamp | string | ISO 8601, required | RFC 3339 datetime |
| installSourceUrl | string | URL, required | https only |
| runtimeVersion | string | required | e.g., `node-20.11`, `bun-1.0.x` |
| channel | enum | `curl \| plugin`, required | one of two values (C-06) |
| source | enum | required | one of: `curl-script`, `marketplace-browse`, `self-hosted-url`, `direct-link`, `migration`, `beta-channel` (C-06) |
| migratedFrom | object\|null | optional | `{channel, version}` populated by F-05 |
| lastPing | string\|null | ISO 8601, optional | null when `doNotTrack=true` |
| doNotTrack | boolean | required | default false; true after opt-out |
| updateInProgress | object\|enum\|null | optional | `{fromVersion, toVersion, startedAt}` during `/loom-update`, or `failed` terminal state when `--resume` is unrecoverable |
| installError | object\|null | optional | `{step: string, message: string, timestamp: string}` populated when install partially fails — partial-install forensic trace consumed by F-04 `install-interrupted` red check |
| pinnedVersion | string\|null | optional | semver `vX.Y.Z` if user pinned via `claude plugin add loom@<version>`; honored by F-12 `/loom-update` |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_install | (file path, singleton) | PRIMARY | Single-row per machine |

#### Cascade Behavior

Not applicable (no foreign keys; file-singleton).

### PluginManifest (consumed by Claude Code plugin loader)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| manifestVersion | integer | `=1` for this plan | hard-coded |
| loomVersion | string | semver `vX.Y.Z` | matches release tag |
| sha256 | string | 64 hex chars | matches Release tarball |
| attestationUrl | string | sigstore URL | required for C-08 |
| minClaudeCodeVersion | string | semver | consumed by F-04 |
| compatibilityMatrix | string[] | optional | array of Claude Code spec version ranges (e.g., `["1.0.x", ">=2.0.0 <3.0.0"]`) — TS type MUST be `string[]` not `unknown[]` |
| hooks | array | optional in M-01; required in M-02 (F-08) | plugin-declared hook entries |
| permissions | array | required | scoped per agent |
| entryPoint | string | required | relative path to plugin entry module — consumed by Claude Code plugin loader |
| publisher | string | required | publisher identity (e.g., `loom-ai`) — required for marketplace discoverability |
| categories | string[] | required | marketplace category tags (e.g., `["workflow", "planning", "agents"]`) — required for marketplace discoverability |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_manifest | sha256 | PRIMARY | Drift-detection key (F-06) |

#### Cascade Behavior

Not applicable (immutable per release).

### DoctorReport (F-04 output, at `~/.cache/loom/doctor-report.toon`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| reportVersion | integer | required | discriminator: `1` for M-01 doctor output (Phase 9); `2` after M-02 doctor checks land (Phase 14) |
| generatedAt | string | ISO 8601, required | RFC 3339 |
| loomVersion | string | semver, required | from `install.toon` |
| installChannel | enum | required | `curl \| plugin` (top-level per FC-08) |
| installSource | enum | required | per C-06 enum |
| overall | enum | required | `green \| yellow \| red` |
| checks | array | required | rows: `{name, category, status, detail, fixCommand, docsUrl}` |
| diagnosticBundle | string\|null | optional | path to `.tar.gz` if `--bundle` |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_check | (name) | PRIMARY (per row) | Unique per check name |

#### Cascade Behavior

Not applicable (report is regenerated, not persisted relationally).

### PluginRootPointer (per-project, at `.loom/plugin-root`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| pluginRoot | string | absolute path, required | exists and readable |
| pluginVersion | string | semver, required | matches installed version |
| initTimestamp | string | ISO 8601, required | RFC 3339 |

#### Indexes / Cascade

Singleton per project; not applicable.

### DismissedInitPrompt (per-project, at `.loom/dismissed-init-prompt`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| dismissedAt | string | ISO 8601, required | suppression expires 24h after |

### HookFailureLog (machine-wide, at `~/.cache/loom/hook-failures.log`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| timestamp | string | ISO 8601 | per entry |
| hookName | string | required | which hook failed |
| hookScriptPath | string | required | absolute path to the .ts file invoked (Phase 2 acceptance asserts on this) |
| pathAtProbe | string | required | full PATH at probe time |
| runtimeAttempted | enum | required | `bun \| npx-tsx \| node \| none` |

Append-only log; rotated when >1MB. Consumed by `/loom-doctor` F-04 (hooks-category red check from F-15).

## API Specification

This plan defines CLI surface, not HTTP endpoints. The "endpoints" below specify command contracts (flags, exit codes, stdout/stderr). Loom-hosted telemetry endpoint is specified separately.

### CLI: `/loom-init`

**Description:** Initialize Loom in the current project. Writes `.loom/plugin-root`, `.loom/wiki/` skeleton, and `orchestration.toml` if absent. Penultimate step is the telemetry opt-in prompt (F-11).
**Auth:** none

**Flags:** none in M-01.

**Stdout (success):** Multi-line summary per F-09a UX-NEW-03: (1) files written, (2) suggested next command, (3) telemetry opt-in prompt result, (4) exit message.

**Exit codes:**
| Code | When |
|------|------|
| 0 | Init succeeded |
| 1 | Not a git repo |
| 2 | Network failure during init (rollback completed) |
| 3 | Partial write failure (rollback completed; diagnostic surfaced) |

**Error responses (stderr):**
| Code | When |
|------|------|
| NOT_A_GIT_REPO | `.git/` absent in cwd or ancestors |
| INIT_NETWORK_FAILURE | Cannot fetch manifest/template during init |
| INIT_PARTIAL_WRITE | At least one file write failed; rollback executed |

**Behavior notes:**
- Existing `orchestration.toml` is never overwritten
- Worktree-aware: writes `.loom/plugin-root` per worktree
- Telemetry opt-in: default `N` writes `doNotTrack: true` to `~/.loom/install.toon`

### CLI: `/loom-*` (graceful no-op pre-init, F-02)

**Description:** All `/loom-*` commands check for `.loom/plugin-root` on entry. If absent and `.loom/dismissed-init-prompt.dismissedAt` is older than 24h (or absent), emit single-line prompt and exit 0. Within suppression window, exit 0 silently with no message.
**Auth:** none

**Stdout (no-op, first display):** `Loom is not initialized in this project. Run /loom-init to activate.`
**Stdout (within 24h suppression window):** empty (silent exit 0).

**Exit codes:**
| Code | When |
|------|------|
| 0 | Always (no-op is success) |

**Behavior notes:**
- After first display, write/refresh `.loom/dismissed-init-prompt` with current timestamp
- Suppression is per-project, not global
- Never mutates other state

### CLI: `/loom-doctor` (F-04, M-01 scope-reduced)

**Description:** Reports installed-version drift and channel/file-location consistency.
**Auth:** none

**Flags:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | bool | false | Emit TOON `doctor-report.toon` to stdout (per CLAUDE.md naming) |
| `--only <name>` | string | — | Run only the named check (renamed from `--check` to avoid collision with `/loom-update --check` dry-run-query convention) |
| `--bundle` | bool | false | Produce redacted `.tar.gz` diagnostic bundle. Output path convention: `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601-timestamp}.tar.gz` (Phase 9 S-05 asserts this format). |
| `--fix` | bool | false | Stub in M-01 (emits message that F-04b ships auto-remediation) |

**Checks shipped in M-01:**
- `version-drift` — installed vs latest manifest (skips with yellow on network failure)
- `channel-files` — `install.toon.channel` vs actual file presence at `~/.claude/plugins/loom/` (red on mismatch; suggests `/loom-migrate-to-plugin --reconcile`)
- `hooks` — checks `~/.cache/loom/hook-failures.log` for entries in last 24h (red if any; F-15)
- `install-interrupted` — red check fires when `install.toon.installError` is non-null (partial-install forensic trace; suggests `/loom-update --check` or re-running installer)

**Exit codes:**
| Code | When |
|------|------|
| 0 | overall = green |
| 1 | overall = yellow |
| 2 | overall = red |

**Behavior notes:**
- `fixCommand` restricted to M-01 commands per FC-09: `/loom-migrate-to-plugin --reconcile`, `/loom-update`, `/loom-uninstall`, `/loom-init`
- Red checks first, yellow second, green count-only (information hierarchy)
- `--bundle` redacts secrets from `install.toon` before bundling

### CLI: `/loom-migrate-to-plugin` (F-05)

**Description:** One-way migration from curl install to plugin install, preserving repo-root artifacts.
**Auth:** none

**Flags:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | bool | false | Print before/after diff; no mutation |
| `--reconcile` | bool | false | Repair mixed-channel state |
| `--resume` | bool | false | Resume from `.loom/migration-in-progress` marker |

**Exit codes:**
| Code | When |
|------|------|
| 0 | Migration complete or dry-run succeeded |
| 1 | Migration aborted (network, permissions) |
| 2 | Marker found; user must `--resume` |

**Behavior notes:**
- Writes `.loom/migration-in-progress` before any mutation; clears on success
- Idempotent (running twice on a plugin install is a no-op)
- Preserves `.loom/wiki/`, `.plan-execution/`, `orchestration.toml`

### CLI: `/loom-update` (F-12)

**Description:** Update Loom to the latest release; detects channel from `install.toon`.
**Auth:** none

**Flags:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--check` | bool | false | Report available vs installed; no apply |
| `--channel curl\|plugin` | string | — | Override `install.toon.channel` |
| `--pin <version>` | string | — | Pin to a specific version: `claude plugin add loom@<version>` semantics. Writes `install.toon.pinnedVersion`. See F-01 install path and F-12 update path for full pinning behavior. |
| `--resume` | bool | false | Resume from `install.toon.updateInProgress` |
| `--json` | bool | false | Machine-readable output (TOON) |

**Stdout (`--check`, no `--json`):** `Loom vX.Y.Z installed → vA.B.C available — run /loom-update to apply` or `Loom vX.Y.Z — up to date`.
**Stdout (`--resume` success):** `Update complete: vX.Y.Z → vA.B.C. Restart Claude Code to load the new version.`

**Exit codes:**
| Code | When |
|------|------|
| 0 | Up to date OR update succeeded |
| 1 | Update failed mid-flight; marker remains |
| 2 | Unrecoverable marker (toVersion no longer in registry) |

**Behavior notes:**
- Writes `install.toon.updateInProgress` before any mutation; clears on success
- Restart-required final line is non-suppressible
- Plugin-channel falls back to `claude plugin add @latest` if plugin manager API unavailable

### CLI: `/loom-uninstall` (F-13)

**Description:** Remove Loom from this machine. Project state preserved by default.
**Auth:** none

**Flags:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--purge-project-state` | bool | false | Also delete `.loom/wiki/`, `.plan-execution/`, `orchestration.toml` |
| `--dry-run` | bool | false | Preview removals; no mutation |
| `--yes` | bool | false | Bypass interactive confirmation |

**Interactive prompts:**
- Base: `Remove Loom from this machine? Project-root state (.loom/wiki/, orchestration.toml, .plan-execution/) is preserved. [y/N] (60s)` — 60s countdown; on timeout emit stderr line `Confirmation timed out after 60s; no changes made.` and exit 1
- `--purge-project-state`: typed confirmation `uninstall` required

**Exit codes:**
| Code | When |
|------|------|
| 0 | Uninstall complete or `--dry-run` |
| 1 | User declined (`N` or timeout) |
| 2 | Permission error during removal |

### HTTP: POST `https://telemetry.loom-ai.org/v1/ping` (F-11) — server-side DEFERRED to M-02

**M-01 scope (Phase 13):** Server-side handler is **deferred to M-02**. Phase 13 ships only the client-side opt-in flow (`install.toon` updates) and writes pings to a local JSON queue at `~/.cache/loom/pending-pings.toon`. Hosting decision is explicitly deferred. The C-09 kill-criterion fallback (GitHub Release download ratio vs plugin manifest fetches) becomes the **primary measurement path** in M-01. Phase 13 adds a dedicated step to instrument the manifest-fetch counter via GitHub API.

**M-02 scope:** Server-side ping handler ships when hosting is decided.

**Description:** Opt-in install-channel ping endpoint. Only invoked when `install.toon.doNotTrack=false`.
**Auth:** none (anonymous)

**Request body:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| installedVersion | string | yes | semver |
| channel | enum | yes | `curl \| plugin` |
| source | enum | yes | per C-06 |
| runtimeVersion | string | yes | e.g., `node-20.11` |
| installTimestamp | string | yes | ISO 8601 |

**Success response:** 204 No Content.

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | malformed body |
| 429 | RATE_LIMITED | exceeded per-IP budget |
| 500 | INTERNAL_ERROR | server fault — client logs and drops |

**Behavior notes:**
- Client retries: none (drop on failure; F-11 is best-effort)
- Server retains aggregate counts only — no per-machine identifiers persisted
- Privacy doc linked from listing copy (F-09a)

## State Machines

### InstallState.channel

```
(none) ──install.sh──→ curl ──/loom-migrate-to-plugin──→ plugin
                                                          │
   (none) ──claude plugin add loom──→ plugin              │
                                       ↑__/loom-update____│ (no transition; stays plugin)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| (uninstalled) | No `~/.loom/install.toon` | Default before install |
| curl | Curl-installed | `install.sh` writes record |
| plugin | Plugin-installed | `claude plugin add` first-run handler writes record |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| (uninstalled) | curl | `install.sh` | Writes `install.toon` with channel=curl |
| (uninstalled) | plugin | `claude plugin add` first-run | Writes `install.toon` with channel=plugin |
| curl | plugin | `/loom-migrate-to-plugin` | Sets `migratedFrom={channel:curl, version:X}`; source=`migration` |
| plugin | (uninstalled) | `/loom-uninstall` | Removes `~/.loom/`, `~/.claude/plugins/loom/` |
| curl | (uninstalled) | `/loom-uninstall` | Removes `~/.loom/`; curl never wrote to `~/.claude/plugins/loom/` |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| plugin | curl | NO_REVERSE_MIGRATION | Reverse migration is not supported in M-01; uninstall + re-install instead |

### InstallState.updateInProgress

```
null ──/loom-update start──→ {from,to,startedAt} ──success──→ null
                                    │
                                    ├──interrupt──→ {from,to,startedAt} (persists for /loom-update --resume)
                                    │
                                    └──unrecoverable resume──→ failed (terminal)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| null | No update in flight | Default; cleared on update success |
| in-progress | Update mid-flight | `/loom-update` writes marker pre-mutation |
| failed | `--resume` unrecoverable terminal state | toVersion no longer in registry OR irrecoverable error during `--resume` |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| null | in-progress | `/loom-update` (any apply path) | Writes `{fromVersion, toVersion, startedAt}` |
| in-progress | null | Successful completion | Clears marker; bumps `installedVersion` |
| in-progress | in-progress | Crash/kill | No-op (marker persists for resume) |
| in-progress | failed | `/loom-update --resume` hits unrecoverable condition | Sets state to `failed`; `fixCommand: "/loom-update --check OR /loom-doctor --bundle to file an issue"` |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| null | null | NO_UPDATE_NEEDED | Already at latest (informational, not an error condition) |
| failed | in-progress | UPDATE_FAILED_TERMINAL | Cannot resume from `failed`; run `/loom-update --check` or `/loom-doctor --bundle` |

### MigrationMarker schema (`.loom/migration-in-progress`)

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| startedAt | string | ISO 8601, required | RFC 3339 |
| fromChannel | enum | required | `curl \| plugin` |
| toChannel | enum | required | `curl \| plugin` |
| stepCompleted | enum\|null | required | one of: `download \| verify \| swap \| clear-marker \| null`. `--resume` skips completed steps and continues from the next. |

The four migration/update steps (F-12 `/loom-update` flow): (1) `download` tarball, (2) `verify` sha256, (3) `swap` files, (4) `clear-marker`. `--resume` reads `stepCompleted` and continues from the next step.

### MigrationMarker state machine

```
absent ──/loom-migrate-to-plugin start──→ present ──success──→ absent
                                              │
                                              └──interrupt──→ present (await /loom-migrate-to-plugin --resume)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| absent | No migration in flight | Default |
| present | Migration interrupted or in progress | F-05 writes before any mutation |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| absent | present | F-05 entry | Writes marker file |
| present | absent | F-05 success | Removes marker; updates `install.toon` |
| present | present | F-05 `--resume` | Resumes from marker step; clears on success |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| present | absent | MARKER_REQUIRES_RESUME | Cannot clear marker without successful migration; run `/loom-migrate-to-plugin --resume` |

## Error Handling Specification

### Error Response Format (CLI, TOON)

All CLI errors emit to stderr in TOON envelope:

```toon
error:
  code: SCREAMING_SNAKE_CASE
  message: human-readable description
  fixCommand: /loom-... | null
  docsUrl: https://... | null
```

### Error Categories

| Code | Exit | When | Retryable |
|------|------|------|-----------|
| NOT_A_GIT_REPO | 1 | `/loom-init` invoked outside git repo | No — `cd` to a git repo |
| INIT_NETWORK_FAILURE | 2 | `/loom-init` cannot fetch manifest/template | Yes — retry |
| INIT_PARTIAL_WRITE | 3 | Partial write detected; rollback executed | Yes — retry; check disk permissions |
| NO_REVERSE_MIGRATION | 1 | Plugin → curl migration attempted | No — uninstall + re-install |
| MARKER_REQUIRES_RESUME | 2 | Migration/update marker found | No — run `--resume` |
| MIGRATION_NETWORK_FAILURE | 1 | F-05 cannot fetch plugin tarball | Yes — `--resume` |
| UPDATE_VERSION_GONE | 2 | `--resume` toVersion not in registry | No — `/loom-update --check` |
| UPDATE_RESTART_REQUIRED | 0 | Plugin update succeeded; restart needed | n/a (informational, exit 0) |
| DOCTOR_RED | 2 | `/loom-doctor` overall=red | No — apply listed `fixCommand` |
| DOCTOR_YELLOW | 1 | `/loom-doctor` overall=yellow | n/a — informational |
| UNINSTALL_DECLINED | 1 | User answered N or 60s timeout | No — re-invoke |
| UNINSTALL_PERMISSION | 2 | rm permission denied | No — check ownership |
| HOOK_RUNTIME_NOT_FOUND | 0 (legacy) → red doctor check (F-15) | Wrapper found no bun/npx/node | Yes — install runtime; F-15 logs to `~/.cache/loom/hook-failures.log` |
| TELEMETRY_VALIDATION_ERROR | n/a (HTTP 400) | F-11 ping body invalid | No — fix client |
| TELEMETRY_RATE_LIMITED | n/a (HTTP 429) | F-11 ping exceeded budget | Yes — backoff |
| MANIFEST_DRIFT | non-zero CI | F-06 sha256 mismatch | No — rebuild release |

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| Network (INIT_NETWORK_FAILURE, MIGRATION_NETWORK_FAILURE) | Exponential backoff 1s/2s/4s | 3 |
| Telemetry (F-11) | None (best-effort) | 0 |
| Permission errors | None | 0 |
| Hook runtime not found | n/a (logged, not retried) | 0 |

## Configuration Specification

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| LOOM_HOOK_RUNTIME | string (absolute path) | — | no | Bypass PATH probing in `hooks/run-hook.sh` (F-15). Set absolute bun path. |
| LOOM_TELEMETRY_ENDPOINT | URL | `https://telemetry.loom-ai.org/v1/ping` | no | Override for self-hosted F-11 endpoint |
| LOOM_DOCTOR_BUNDLE_DIR | path | `~/.cache/loom/bundles/` | no | Where `--bundle` writes |

### Validation

- `LOOM_HOOK_RUNTIME` must be an absolute path to an existing executable
- `LOOM_TELEMETRY_ENDPOINT` must be https://
- `LOOM_DOCTOR_BUNDLE_DIR` parent must exist and be writable

### Config Loading

Read from process env on every command invocation. No `.env` file support — Loom is a global CLI, not a per-project service.

## Execution Phases

---

### Phase 0 — Wave 0: Contracts & Schemas

**Agent:** contracts-agent
**Objective:** Materialize all TOON schemas, TypeScript types, build toolchain (tsconfig + package.json), schema validator script, and shared protocol files consumed by downstream phases.
**Dependencies:** None
**File Ownership:** protocols/install-state.schema.md, protocols/plugin-manifest.schema.md, protocols/doctor-report.schema.md, protocols/plugin-root.schema.md, protocols/dismissed-init-prompt.schema.md, protocols/hook-failure-log.schema.md, protocols/migration-marker.schema.md, hooks/lib/types/install-state.ts, hooks/lib/types/plugin-manifest.ts, hooks/lib/types/doctor-report.ts, hooks/lib/types/error-envelope.ts, hooks/lib/types/hook-failure-log.ts, tsconfig.json, package.json, scripts/validate-toon-schemas.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/install-state.schema.md | Create | contracts-agent |
| protocols/plugin-manifest.schema.md | Create | contracts-agent |
| protocols/doctor-report.schema.md | Create | contracts-agent |
| protocols/plugin-root.schema.md | Create | contracts-agent |
| protocols/dismissed-init-prompt.schema.md | Create | contracts-agent |
| protocols/hook-failure-log.schema.md | Create | contracts-agent |
| protocols/migration-marker.schema.md | Create | contracts-agent |
| hooks/lib/types/install-state.ts | Create | contracts-agent |
| hooks/lib/types/plugin-manifest.ts | Create | contracts-agent |
| hooks/lib/types/doctor-report.ts | Create | contracts-agent |
| hooks/lib/types/error-envelope.ts | Create | contracts-agent |
| hooks/lib/types/hook-failure-log.ts | Create — TS type matching the HookFailureLog TOON schema | contracts-agent |
| tsconfig.json | Create — TypeScript 5.x, strict, ESM | contracts-agent |
| package.json | Create — minimal with TypeScript + tsx + vitest deps | contracts-agent |
| scripts/validate-toon-schemas.ts | Create — validates files under `protocols/*.schema.md` | contracts-agent |

#### Acceptance Criteria
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `bunx tsx scripts/validate-toon-schemas.ts` exits 0 and validates every `protocols/*.schema.md`
- [ ] Every schema file has TOON-format reference example
- [ ] Every enum value referenced in roadmap (channel, source) is defined in TypeScript
- [ ] `protocols/install-state.schema.md` includes all 14 fields from Data Model (11 base + `installError`, `pinnedVersion`, `updateInProgress.failed` terminal state)
- [ ] `hooks/lib/types/plugin-manifest.ts` declares `compatibilityMatrix: string[]` (NOT `unknown[]`); TS compiler asserts the array element type
- [ ] **Shared C-12 `--help` enforcement (applied to Phases 3, 9, 10, 11, 12):** every user-facing command exits 0 on `--help` and prints usage to stdout. Phase 0 publishes a shared `help-output` scenario template consumed by downstream phases.

---

### Phase 1 — Wave 1: Plugin-root resolver (F-07a, P0)

**Agent:** implementer-agent
**Objective:** Implement `hooks/lib/plugin-root-resolver.ts` as the single resolution layer for plugin-root-relative paths (C-04, F-07a).
**Dependencies:** Phase 0
**File Ownership:** hooks/lib/plugin-root-resolver.ts, hooks/lib/plugin-root-resolver.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/plugin-root-resolver.ts | Create | implementer-agent |
| hooks/lib/plugin-root-resolver.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `resolvePluginRoot(cwd)` reads `.loom/plugin-root` and returns absolute path
- [ ] Falls back to repo-relative paths when `.loom/plugin-root` absent
- [ ] `bunx vitest run hooks/lib/plugin-root-resolver.test.ts` exits 0
- [ ] `grep -RE '\${LOOM_PLUGIN_ROOT}|~/\.claude/plugins/loom' agents/ skills/ commands/` returns 0 matches outside resolver module

#### Convergence Targets
- Resolver function returns `~/.claude/plugins/loom/` when given a project with `.loom/plugin-root` written
- Resolver returns repo-relative fallback when pointer file is absent
- Static lint: no `${LOOM_PLUGIN_ROOT}` inline in agent/skill/protocol bodies

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
title: Resolver falls back to repo path when pointer absent
given[1]: A project has no .loom/plugin-root file
when: resolvePluginRoot(cwd) is invoked
whenTriggerType: api-call
then[1]: The function MUST return the repo-relative fallback path
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

```toon
id: S-03
title: No inline LOOM_PLUGIN_ROOT references outside resolver
given[1]: The repo agents/ skills/ commands/ trees exist
when: grep -RE '\${LOOM_PLUGIN_ROOT}' is run against those trees excluding hooks/lib/plugin-root-resolver.ts
whenTriggerType: system-event
then[1]: The grep MUST return zero matches
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

---

### Phase 2 — Wave 1: Hook PATH wrapper + audit (F-15, P0)

**Agent:** implementer-agent
**Objective:** Complete F-15: wrapper PATH prepend (already committed in PR #9), loom-init settings.json audit, fail-loud escalation, install.sh post-install probe.
**Dependencies:** Phase 0
**File Ownership:** hooks/run-hook.sh, hooks/lib/fail-loud-logger.ts, hooks/lib/fail-loud-logger.test.ts, install.sh, scripts/probe-hook-runtime.sh, loom-init-audit-notes.md, test/fixtures/hook-input.json

> **Wave-1 ownership note (per blocker resolution):** Phase 2 does NOT write `commands/loom-init.md`. Phase 3 (F-02) is the SOLE writer. Phase 2's audit output is captured in a separate file `loom-init-audit-notes.md`.

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/run-hook.sh | Modify (verify wrapper fix from PR #9 is intact) | implementer-agent |
| hooks/lib/fail-loud-logger.ts | Create | implementer-agent |
| hooks/lib/fail-loud-logger.test.ts | Create | implementer-agent |
| install.sh | Modify (add post-install probe at lines 263-288) | implementer-agent |
| scripts/probe-hook-runtime.sh | Create | implementer-agent |
| loom-init-audit-notes.md | Create — Phase 2 audit findings on settings.json + C-16 PATH dependency, consumed by Phase 3 when authoring `commands/loom-init.md` | implementer-agent |
| test/fixtures/hook-input.json | Create — minimal Claude Code hook stdin fixture for the minimal-container probe | implementer-agent |

#### Acceptance Criteria
- [ ] `env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh hooks/deploy-guard.ts` exits 0 with no stderr
- [ ] Same probe succeeds for all 6 PreToolUse hooks: deploy-guard, context-budget, budget-tracker, contract-lock, file-ownership, wiki-write-guard
- [ ] When neither bun nor node resolves, `~/.cache/loom/hook-failures.log` receives a timestamped entry with `hookScriptPath` populated to the absolute `.ts` path
- [ ] `install.sh` runs the post-install probe under stripped PATH and warns on failure
- [ ] `loom-init-audit-notes.md` documents the C-16 PATH dependency (NOT `commands/loom-init.md`; that file is owned by Phase 3)
- [ ] **Minimal-container PATH probe (catches F-15 regressions before Wave 4):** `docker run --rm -v $PWD:/loom alpine sh /loom/hooks/run-hook.sh /loom/hooks/deploy-guard.ts < /loom/test/fixtures/hook-input.json` exits 0

#### Convergence Targets
- All 6 PreToolUse hooks exit 0 under `env -i HOME=$HOME PATH=/usr/bin:/bin`
- Fail-loud log file written when runtime probe fails
- `install.sh` post-install probe exit code matches probe outcome

#### Scenarios

```toon
id: S-01
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
id: S-02
title: Fail-loud log captures runtime-absent state
given[1]: PATH is stripped and no runtime (bun, npx, node) is reachable
when: hooks/run-hook.sh hooks/deploy-guard.ts is invoked
whenTriggerType: api-call
then[3]: A new entry MUST be appended to ~/.cache/loom/hook-failures.log, The entry MUST include timestamp hookName and pathAtProbe, The wrapper MUST still exit 0 to avoid breaking Claude Code
stateRef:
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-03
title: install.sh post-install probe warns on stripped-PATH failure
given[1]: install.sh has completed file writes
when: install.sh runs the minimal-PATH probe step
whenTriggerType: system-event
then[2]: The probe MUST execute hooks/run-hook.sh under env -i, On non-zero exit the installer MUST print a visible warning naming the failure mode
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

### Phase 3 — Wave 2: First-invocation graceful no-op (F-02, P0)

**Agent:** implementer-agent
**Objective:** Implement C-11 graceful no-op for all `/loom-*` commands, 24h suppression marker, edge-case handling, and author `commands/loom-init.md` (SOLE writer per Wave 2 ownership resolution).
**Dependencies:** Phase 0, Phase 1, Phase 2 (consumes `loom-init-audit-notes.md`)
**File Ownership:** hooks/lib/init-guard.ts, hooks/lib/init-guard.test.ts, hooks/lib/dismissal-marker.ts, hooks/lib/dismissal-marker.test.ts, commands/_loom-init-guard.md, commands/loom-init.md

> **Wave 2→3 wiring step:** After Phase 5 (F-09a) produces `marketplace/loom-init-success-output.toon`, a wiring step merges the success-output text from that artifact into `commands/loom-init.md`. Phase 3 is the SOLE writer of `commands/loom-init.md`; Phase 5 produces only the canonical reference artifact.

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/init-guard.ts | Create | implementer-agent |
| hooks/lib/init-guard.test.ts | Create | implementer-agent |
| hooks/lib/dismissal-marker.ts | Create | implementer-agent |
| hooks/lib/dismissal-marker.test.ts | Create | implementer-agent |
| commands/_loom-init-guard.md | Create (shared snippet for all /loom-* commands) | implementer-agent |
| commands/loom-init.md | Create (SOLE writer; integrates Phase 2 audit notes + Phase 5 success-output spec via Wave 2→3 wiring) | implementer-agent |

#### Acceptance Criteria
- [ ] `/loom-status` invoked without `.loom/plugin-root` emits exact prompt: `Loom is not initialized in this project. Run /loom-init to activate.`
- [ ] Same command within 24h of dismissal exits 0 silently
- [ ] `.loom/dismissed-init-prompt` written atomically via `.tmp` rename per CLAUDE.md
- [ ] `bunx vitest run hooks/lib/init-guard.test.ts hooks/lib/dismissal-marker.test.ts` exits 0
- [ ] No `/loom-*` command mutates project state when `.loom/plugin-root` is absent (except `/loom-init` itself)
- [ ] **Idempotency:** if `.loom/plugin-root` already exists, `/loom-init` is a no-op with stdout "Loom already initialized in this project. Use /loom-update to upgrade or /loom-doctor to diagnose." and exit 0
- [ ] **C-12 `--help`:** `/loom-init --help` exits 0 and prints usage to stdout (shared scenario from Phase 0)

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
title: Invocation after 24h suppression expiry re-prints prompt
given[2]: A git repo has no .loom/plugin-root, .loom/dismissed-init-prompt exists with dismissedAt 25 hours ago
when: /loom-status is invoked
whenTriggerType: actor-action
then[2]: stdout MUST equal the prompt string, dismissedAt MUST be refreshed to current time
stateRef:
tags[1]: regression
testTier: integration
automatable: true
```

```toon
id: S-04
title: /loom-init outside git repo errors
given[1]: cwd is not inside a git repo
when: /loom-init is invoked
whenTriggerType: actor-action
then[2]: stderr MUST contain code NOT_A_GIT_REPO, The command MUST exit 1
stateRef:
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-06
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
id: S-05
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

---

### Phase 4 — Wave 2: Plugin manifest + thin-veneer install (F-01, P0)

**Agent:** implementer-agent
**Objective:** Author the plugin manifest declaring Loom's `agents/`, `commands/`, `skills/`; on plugin activation, materialize the same files curl installer writes (modulo F-02 behavior).
**Dependencies:** Phase 0, Phase 1
**File Ownership:** plugin/manifest.toon, plugin/install-hook.ts, plugin/install-hook.test.ts, plugin/first-run.ts, plugin/first-run.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| plugin/manifest.toon | Create | implementer-agent |
| plugin/install-hook.ts | Create | implementer-agent |
| plugin/install-hook.test.ts | Create | implementer-agent |
| plugin/first-run.ts | Create | implementer-agent |
| plugin/first-run.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `plugin/manifest.toon` declares `manifestVersion=1`, `loomVersion`, `sha256`, `attestationUrl`, `minClaudeCodeVersion`, `permissions`, `entryPoint`, `publisher`, `categories`
- [ ] Acceptance asserts on `entryPoint` (non-empty relative path), `publisher` (`loom-ai`), and `categories` (non-empty `string[]`)
- [ ] First-run handler writes `~/.loom/install.toon` with `channel=plugin` and `source` per C-06
- [ ] `bunx vitest run plugin/` exits 0
- [ ] Manifest validates against `protocols/plugin-manifest.schema.md`

#### Convergence Targets
- Plugin install materializes `~/.claude/plugins/loom/agents/`, `commands/`, `skills/`
- `~/.loom/install.toon` records `channel=plugin` after first run
- Manifest sha256 field is a 64-char hex string matching the release tarball

#### Scenarios

```toon
id: S-01
title: Plugin install populates ~/.claude/plugins/loom/ with packaged resources
given[1]: A clean Claude Code install with no Loom plugin present
when: claude plugin add github:loom-ai/loom is invoked
whenTriggerType: actor-action
then[3]: ~/.claude/plugins/loom/ MUST contain agents/ commands/ and skills/ directories, plugin/manifest.toon MUST be present at the install root, ~/.loom/install.toon MUST record channel=plugin
stateRef: plugin
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: First-run handler records source per C-06
given[1]: Plugin install just completed
when: The first-run handler executes
whenTriggerType: system-event
then[2]: install.toon.source MUST be one of the C-06 enum values, install.toon.channel MUST equal "plugin"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 5 — Wave 2: Outcome-led listing copy (F-09a, P0)

**Agent:** implementer-agent
**Objective:** Author marketplace listing copy and produce the canonical `/loom-init` success-output reference artifact. Phase 5 does NOT write `commands/loom-init.md` directly (Phase 3 is sole writer); a Wave 2→3 wiring step merges the artifact text into the command file.
**Dependencies:** Phase 0
**File Ownership:** marketplace/listing.md, marketplace/listing-checklist.md, marketplace/loom-init-success-output.toon

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| marketplace/listing.md | Create | implementer-agent |
| marketplace/listing-checklist.md | Create | implementer-agent |
| marketplace/loom-init-success-output.toon | Create — canonical reference artifact for UX-NEW-03 success-output spec; Phase 3 merges this into `commands/loom-init.md` via Wave 2→3 wiring; Phase 8 reads this as the source of truth for `test/fixtures/expected-init-output.txt` | implementer-agent |

#### Acceptance Criteria
- [ ] Listing copy leads with outcomes (planning waves, convergence loops, repo-committed wiki)
- [ ] Listing includes C-14 differentiation claim verbatim
- [ ] Listing includes "Community-supported. GitHub issues only. No SLA." above the fold
- [ ] Single onboarding CTA copy-pasteable: `claude plugin add loom`
- [ ] `marketplace/loom-init-success-output.toon` defines the three required sections: (a) files written, (b) suggested next command, (c) telemetry opt-in prompt result
- [ ] **Named maintainer review gate (file-based assertion is insufficient):** before the marketplace submission PR opens, a GitHub issue assigned to the repo owner explicitly approves the listing copy. The submission PR description links to the resolved review issue.

#### Convergence Targets
- Listing copy passes outcomes-not-features checklist (file-based assertion)
- Single install command present in listing.md (single grep match)
- Support-expectation language present above any installation section (line-ordering assertion)

#### Scenarios

```toon
id: S-01
title: Listing copy contains C-14 differentiation claim
given[1]: marketplace/listing.md exists
when: The file content is read
whenTriggerType: system-event
then[1]: The text MUST contain the substring "opinionated workflow loop: roadmap → plan → waves → convergence-gated execution"
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
then[3]: stdout MUST list files written, stdout MUST include a suggested next command, stdout MUST surface the telemetry opt-in prompt
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 6 — Wave 3: Atomic release pipeline (F-03, P0)

**Agent:** implementer-agent
**Objective:** Single GHA workflow triggered by `git tag vX.Y.Z`: build tarball, upload to GitHub Releases, generate plugin manifest with sha256, open marketplace-repo PR (gated on passing sigstore workflow), auto-generate CHANGELOG entry. Convergence target runs locally via `act` instead of pushing a real tag.
**Dependencies:** Phase 0, Phase 4
**File Ownership:** .github/workflows/release.yml, scripts/build-release-tarball.ts, scripts/generate-manifest.ts, scripts/generate-changelog.ts, scripts/open-marketplace-pr.ts, fixtures/v0.1.0-test-event.json, docs/release-runbook.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| .github/workflows/release.yml | Create | implementer-agent |
| scripts/build-release-tarball.ts | Create — dry-run mode emits `dist/loom-local-test.tar.gz` for Phase 8 fixture | implementer-agent |
| scripts/generate-manifest.ts | Create | implementer-agent |
| scripts/generate-changelog.ts | Create | implementer-agent |
| scripts/open-marketplace-pr.ts | Create — MUST check for a passing sigstore workflow run before opening the marketplace PR | implementer-agent |
| fixtures/v0.1.0-test-event.json | Create — `act push --eventpath` fixture | implementer-agent |
| docs/release-runbook.md | Create — partial-release recovery runbook | implementer-agent |

#### Acceptance Criteria
- [ ] **Agent-executable via `act`:** `act push --eventpath fixtures/v0.1.0-test-event.json` runs the workflow end-to-end locally in dry-run mode without pushing a real tag
- [ ] Workflow produces exactly one tarball; in dry-run mode emits to `dist/loom-local-test.tar.gz` (consumed by Phase 8 `--local-tarball` fixture)
- [ ] `manifest.toon` sha256 matches `sha256sum` of the tarball
- [ ] `CHANGELOG.md` entry is auto-generated and committed
- [ ] No manual intervention required between tag-push and PR-open
- [ ] **Phase 6→7 sequencing:** `open-marketplace-pr.ts` checks for a passing sigstore workflow run on the same commit BEFORE opening the marketplace PR (Wave 3 wiring pass wires the `needs:` cross-workflow reference)
- [ ] **Partial-release rollback documented in `docs/release-runbook.md`:** if tarball uploaded but marketplace PR not opened, runbook step is "delete the GitHub Release asset, re-tag with patch bump, re-run workflow"

#### Convergence Targets
- `act push --eventpath fixtures/v0.1.0-test-event.json` exits 0 without manual steps (automatable)
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
title: CHANGELOG.md auto-generated entry committed during release
given[1]: A tag push has triggered the release workflow
when: The workflow completes successfully
whenTriggerType: system-event
then[2]: CHANGELOG.md MUST contain a new "## v0.1.0-test" section header, The change MUST be committed to main by the release bot
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

---

### Phase 7 — Wave 3: Manifest-drift CI + sigstore (F-06, P0)

**Agent:** implementer-agent
**Objective:** CI check on every tagged release computes sha256 of the Release asset vs manifest, fails on mismatch; sigstore/cosign attestation on the Release asset (C-08).
**Dependencies:** Phase 0, Phase 6
**File Ownership:** .github/workflows/manifest-drift.yml, .github/workflows/sigstore-attest.yml, scripts/verify-manifest-drift.ts, scripts/sigstore-attest.sh

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| .github/workflows/manifest-drift.yml | Create | implementer-agent |
| .github/workflows/sigstore-attest.yml | Create | implementer-agent |
| scripts/verify-manifest-drift.ts | Create | implementer-agent |
| scripts/sigstore-attest.sh | Create | implementer-agent |

#### Acceptance Criteria
- [ ] Manifest-drift check fails when a hotfix updates manifest sha256 without rebuilding the release asset
- [ ] `cosign verify` passes against the published Loom public key for every signed asset
- [ ] Sigstore attestation runs BEFORE marketplace listing PR is opened (workflow ordering enforced)

#### Convergence Targets
- Drift-detected hotfix → CI fails with `MANIFEST_DRIFT` error
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

---

### Phase 8 — Wave 4: Docker clean-machine harness (F-10a, P0)

**Agent:** implementer-agent
**Objective:** Containerized clean-machine harness per C-15 — Docker base image, install Claude Code, run `claude plugin add github:loom-ai/loom@<tag>` OR consume a local tarball fixture, exercise first-invocation flow with stripped subprocess PATH (C-16 verification matrix).
**Dependencies:** Phase 0, Phase 2 (hook fix), Phase 3 (F-02), Phase 4 (manifest), Phase 5 (listing copy + success-output artifact), Phase 6 (local tarball fixture)
**File Ownership:** test/docker/Dockerfile, test/docker/run-harness.sh, test/plugin-install-e2e.test.ts, test/worktree-init.test.ts, test/fixtures/expected-init-output.txt

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/docker/Dockerfile | Create | implementer-agent |
| test/docker/run-harness.sh | Create | implementer-agent |
| test/plugin-install-e2e.test.ts | Create | implementer-agent |
| test/worktree-init.test.ts | Create | implementer-agent |
| test/fixtures/expected-init-output.txt | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun test test/plugin-install-e2e.test.ts` exits 0 inside a fresh container
- [ ] Harness accepts `--local-tarball <path>` and consumes the Phase 6 dry-run output at `dist/loom-local-test.tar.gz` (enables Phase 8 to run before a real tag exists)
- [ ] Worktree fixture verifies independent per-worktree `.loom/plugin-root`
- [ ] All 6 PreToolUse hooks pass C-16 verification matrix (env -i, stripped PATH)
- [ ] Harness verifies F-02 prompt → `/loom-init` → working state pipeline
- [ ] Harness verifies F-09a UX-NEW-03 `/loom-init` success output spec; `test/fixtures/expected-init-output.txt` is generated from `marketplace/loom-init-success-output.toon` (Phase 5 artifact is source of truth)

#### Convergence Targets
- E2E test exits 0 on fresh container build
- Worktree scenario produces independent `.loom/plugin-root` per worktree
- Hook PATH probe matrix: all 6 hooks × stripped PATH = exit 0, no stderr

#### Scenarios

```toon
id: S-01
title: Clean-machine harness completes plugin-install end-to-end
given[2]: A fresh Docker container with minimal base image, Claude Code is installed into the container
when: The harness runs claude plugin add github:loom-ai/loom and the subsequent flow
whenTriggerType: system-event
then[3]: The first /loom-* invocation MUST print the F-02 graceful no-op prompt, /loom-init MUST succeed and write .loom/plugin-root, A subsequent /loom-status MUST exit 0 without the prompt
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
title: All 6 PreToolUse hooks exit 0 under stripped PATH
given[1]: The Linux Docker container has bun at /usr/local/bin/bun and PATH is stripped to /usr/bin:/bin (wrapper PATH prepend covers both Linux and macOS paths)
when: env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh is invoked for each of the 6 PreToolUse hooks
whenTriggerType: api-call
then[2]: Every invocation MUST exit 0, No stderr output MUST be emitted from any invocation
stateRef:
tags[2]: regression, happy-path
testTier: e2e
automatable: true
```

---

### Phase 9 — Wave 5a: `/loom-doctor` v1 (F-04, P1)

**Agent:** implementer-agent
**Objective:** Ship scope-reduced `/loom-doctor` with checks (a) version-drift, (d) channel-files, F-15's hooks check, and the `install-interrupted` red check, with `--json`, `--only` (renamed from `--check`), `--bundle`, and stub `--fix`.
**Dependencies:** Phase 0, Phase 1, Phase 2, Phase 4 (doctor reads `install.toon` produced by Phase 4 first-run handler)
**File Ownership:** commands/loom-doctor.md, src/commands/doctor/index.ts, src/commands/doctor/checks/version-drift.ts, src/commands/doctor/checks/channel-files.ts, src/commands/doctor/checks/hooks.ts, src/commands/doctor/bundle.ts, src/commands/doctor/render.ts, src/commands/doctor/__tests__/*.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-doctor.md | Create | implementer-agent |
| src/commands/doctor/index.ts | Create | implementer-agent |
| src/commands/doctor/checks/version-drift.ts | Create | implementer-agent |
| src/commands/doctor/checks/channel-files.ts | Create | implementer-agent |
| src/commands/doctor/checks/hooks.ts | Create | implementer-agent |
| src/commands/doctor/bundle.ts | Create | implementer-agent |
| src/commands/doctor/render.ts | Create | implementer-agent |
| src/commands/doctor/__tests__/doctor.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `/loom-doctor` on a fresh plugin install: all checks green, exit 0
- [ ] `/loom-doctor --json` emits valid `doctor-report.toon` conforming to schema with `reportVersion=1`
- [ ] Mixed-channel state (curl install + `~/.claude/plugins/loom/` present) yields red `channel-files` with `fixCommand: /loom-migrate-to-plugin --reconcile`
- [ ] `install-interrupted` red check fires when `install.toon.installError` is non-null
- [ ] `--bundle` produces a `.tar.gz` with redacted `install.toon` + report (no secrets); output path matches `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601-timestamp}.tar.gz` (S-05 asserts this format)
- [ ] `--fix` emits the stub message and exits 0
- [ ] Network failure on version check yields yellow, not red
- [ ] `--only <name>` runs only the named check (renamed from `--check` to avoid collision with `/loom-update --check`)
- [ ] **C-12 `--help`:** `/loom-doctor --help` exits 0 and prints usage to stdout

#### Convergence Targets
- All three checks present (version-drift, channel-files, hooks)
- Red checks first / yellow second / green summarized — information hierarchy assertion
- `--bundle` output is a valid `.tar.gz` (file command)

#### Scenarios

```toon
id: S-01
title: Doctor returns all green on fresh plugin install
given[1]: A fresh plugin install with no drift and no hook failures
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: overall MUST equal "green", Every check status MUST be "green", Exit code MUST be 0
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Mixed-channel state surfaces red with correct fixCommand
given[2]: install.toon.channel equals "curl", The directory ~/.claude/plugins/loom/ exists
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[3]: The channel-files check MUST be red, fixCommand MUST equal "/loom-migrate-to-plugin --reconcile", Exit code MUST be 2
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-03
title: --json emits valid doctor-report.toon
given[1]: A working /loom-doctor invocation
when: /loom-doctor --json is invoked
whenTriggerType: actor-action
then[2]: stdout MUST be parseable as TOON, The output MUST conform to protocols/doctor-report.schema.md
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-04
title: Network failure yields yellow not red
given[1]: The manifest endpoint is unreachable
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[2]: The version-drift check MUST be yellow with detail mentioning network, Exit code MUST be 1
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-05
title: --bundle produces redacted diagnostic tarball
given[1]: install.toon contains an installSourceUrl that should be preserved and no secrets
when: /loom-doctor --bundle is invoked
whenTriggerType: actor-action
then[3]: A .tar.gz MUST be written to the bundle dir, The filename MUST match the format loom-doctor-{version}-{ISO8601-timestamp}.tar.gz, The bundled install.toon MUST exclude any redactable fields
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 10 — Wave 5b: `/loom-migrate-to-plugin` (F-05, P1)

**Agent:** implementer-agent
**Objective:** Opt-in migration command with `--dry-run`, `--reconcile`, `--resume`, partial-failure recovery via `.loom/migration-in-progress` marker.
**Dependencies:** Phase 0, Phase 1, Phase 4, Phase 9
**File Ownership:** commands/loom-migrate-to-plugin.md, src/commands/migrate/index.ts, src/commands/migrate/dry-run.ts, src/commands/migrate/reconcile.ts, src/commands/migrate/marker.ts, src/commands/migrate/__tests__/*.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-migrate-to-plugin.md | Create | implementer-agent |
| src/commands/migrate/index.ts | Create | implementer-agent |
| src/commands/migrate/dry-run.ts | Create | implementer-agent |
| src/commands/migrate/reconcile.ts | Create | implementer-agent |
| src/commands/migrate/marker.ts | Create | implementer-agent |
| src/commands/migrate/__tests__/migrate.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] Migration on curl-installed project produces a working plugin install with intact `.loom/wiki/`
- [ ] Running twice on a plugin install is a no-op (exit 0, no mutation)
- [ ] `--dry-run` produces complete diff with zero mutations
- [ ] Killed mid-run, marker is detected; `--resume` completes from marker
- [ ] `--reconcile` repairs mixed-channel state detected by `/loom-doctor`
- [ ] **C-12 `--help`:** `/loom-migrate-to-plugin --help` exits 0 and prints usage to stdout

#### Convergence Targets
- Migration preserves all of `.loom/wiki/`, `.plan-execution/`, `orchestration.toml`
- Idempotency: second run is no-op
- Marker file is TOON and atomic-written

#### Scenarios

```toon
id: S-01
title: Migration preserves repo-root state and updates install.toon
given[2]: A project has Loom curl-installed with .loom/wiki/ content, install.toon.channel equals "curl"
when: /loom-migrate-to-plugin is invoked
whenTriggerType: actor-action
then[3]: ~/.claude/plugins/loom/ MUST be populated, install.toon.channel MUST equal "plugin" and source equal "migration", .loom/wiki/ content MUST be unchanged
stateRef: plugin
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --dry-run produces full diff with no mutation
given[1]: A curl-installed project
when: /loom-migrate-to-plugin --dry-run is invoked
whenTriggerType: actor-action
then[3]: stdout MUST list every planned file change, install.toon MUST be unchanged, ~/.claude/plugins/loom/ MUST NOT exist
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: Killed mid-run leaves resumable marker
given[1]: /loom-migrate-to-plugin has been killed after marker write but before completion
when: /loom-migrate-to-plugin --resume is invoked
whenTriggerType: actor-action
then[2]: The migration MUST complete from the marker step, .loom/migration-in-progress MUST be removed on success
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-04
title: Idempotent on already-migrated install
given[1]: A plugin-installed project with install.toon.channel equals "plugin"
when: /loom-migrate-to-plugin is invoked
whenTriggerType: actor-action
then[2]: The command MUST exit 0 with no mutation, stdout MUST indicate the project is already migrated
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

---

### Phase 11 — Wave 6: `/loom-update` (F-12, P1)

**Agent:** implementer-agent
**Objective:** Update command with `--check`, `--channel`, `--resume`, `--json`; writes `install.toon.updateInProgress` marker; explicit "restart required" output.
**Dependencies:** Phase 0, Phase 1, Phase 4
**File Ownership:** commands/loom-update.md, src/commands/update/index.ts, src/commands/update/check.ts, src/commands/update/apply.ts, src/commands/update/resume.ts, src/commands/update/__tests__/*.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-update.md | Create | implementer-agent |
| src/commands/update/index.ts | Create | implementer-agent |
| src/commands/update/check.ts | Create | implementer-agent |
| src/commands/update/apply.ts | Create | implementer-agent |
| src/commands/update/resume.ts | Create | implementer-agent |
| src/commands/update/__tests__/update.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `/loom-update` on curl install re-runs installer pinned to latest tag, preserves repo-root state
- [ ] `/loom-update` on plugin install delegates to `claude plugin update loom`, falls back to plugin add re-run
- [ ] `/loom-update --check --json` returns TOON with `currentVersion`, `latestVersion`, `behind`
- [ ] `--resume` completes from a mid-update marker
- [ ] Final stdout line on plugin update: `Claude Code restart required to load new plugin version`
- [ ] `--resume` on unrecoverable marker (toVersion gone) sets `install.toon.updateInProgress` to terminal `failed` state with `fixCommand` "/loom-update --check OR /loom-doctor --bundle to file an issue"; exits non-zero
- [ ] `--pin <version>` writes `install.toon.pinnedVersion` and runs `claude plugin add loom@<version>` (F-01/F-12 pinning support)
- [ ] **C-12 `--help`:** `/loom-update --help` exits 0 and prints usage to stdout

#### Convergence Targets
- `--check` output exact-string match per UX-NEW-04
- Marker write is atomic (`.tmp` → rename)
- Channel detection reads `install.toon.channel`

#### Scenarios

```toon
id: S-01
title: --check reports drift in single-line format
given[2]: install.toon.installedVersion equals "v0.1.0", The latest manifest version is "v0.2.0"
when: /loom-update --check is invoked without --json
whenTriggerType: actor-action
then[1]: stdout MUST equal "Loom v0.1.0 installed → v0.2.0 available — run /loom-update to apply"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --check --json returns structured TOON
given[1]: A version drift exists
when: /loom-update --check --json is invoked
whenTriggerType: actor-action
then[1]: stdout MUST be parseable TOON with fields currentVersion latestVersion and behind
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
title: Unrecoverable marker (toVersion gone) exits non-zero
given[1]: install.toon.updateInProgress.toVersion is not in the manifest registry
when: /loom-update --resume is invoked
whenTriggerType: actor-action
then[3]: Exit code MUST be non-zero, install.toon.updateInProgress MUST be unchanged, stderr MUST direct user to /loom-update --check or /loom-doctor --bundle
stateRef: in-progress
tags[1]: error
testTier: integration
automatable: true
```

---

### Phase 12 — Wave 6: `/loom-uninstall` (F-13, P1)

**Agent:** implementer-agent
**Objective:** Inverse of install; removes `~/.claude/plugins/loom/`, settings.json hook entries, and `~/.loom/`; preserves project-root state by default; `--purge-project-state` requires typed confirmation.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-uninstall.md, src/commands/uninstall/index.ts, src/commands/uninstall/confirm.ts, src/commands/uninstall/__tests__/*.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-uninstall.md | Create | implementer-agent |
| src/commands/uninstall/index.ts | Create | implementer-agent |
| src/commands/uninstall/confirm.ts | Create | implementer-agent |
| src/commands/uninstall/__tests__/uninstall.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] After `/loom-uninstall` with `y` confirmation: `claude plugin list` does not include loom; `~/.loom/` absent; project repo unchanged
- [ ] `--purge-project-state` requires typed `uninstall` literal; any other input leaves project state intact
- [ ] `--dry-run` produces complete removal preview without mutation
- [ ] Base-prompt 60s timeout exits with code 1 and no mutation
- [ ] `--yes` bypasses all confirmations
- [ ] Base-prompt shows a countdown `(60s)`; on timeout stderr emits `Confirmation timed out after 60s; no changes made.` before exit 1
- [ ] **C-12 `--help`:** `/loom-uninstall --help` exits 0 and prints usage to stdout

#### Convergence Targets
- Confirmation prompt exact-string match per UX-NEW-02
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
stateRef: (uninstalled)
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
title: --dry-run lists every planned removal without mutation
given[1]: A plugin-installed project
when: /loom-uninstall --dry-run is invoked
whenTriggerType: actor-action
then[2]: stdout MUST list ~/.claude/plugins/loom/ ~/.loom/ and any settings.json hook entries to remove, No mutation MUST occur
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 13 — Wave 6: Install telemetry (F-11, P1)

**Agent:** implementer-agent
**Objective:** **M-01 client-side only** — opt-in telemetry plumbing: opt-in prompt inside `/loom-init`, `lastPing` updates, local pending-pings queue, `doNotTrack` honoring, AND a dedicated manifest-fetch counter instrumentation step. Server-side handler is **deferred to M-02** (hosting decision deferred). C-09 kill-criterion fallback (GitHub Release download ratio vs plugin manifest fetches) is the **primary measurement path** in M-01.
**Dependencies:** Phase 0, Phase 1, Phase 3, Phase 5
**File Ownership:** src/telemetry/ping-client.ts, src/telemetry/opt-in-prompt.ts, src/telemetry/__tests__/*.test.ts, src/telemetry/manifest-fetch-counter.ts, docs/privacy.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/telemetry/ping-client.ts | Create — writes to local queue at `~/.cache/loom/pending-pings.toon`; server delivery deferred to M-02 | implementer-agent |
| src/telemetry/opt-in-prompt.ts | Create — 30s timeout; default `doNotTrack: true` on timeout (prevents CI/non-interactive `/loom-init` blocking) | implementer-agent |
| src/telemetry/__tests__/telemetry.test.ts | Create | implementer-agent |
| src/telemetry/manifest-fetch-counter.ts | Create — instruments GitHub API manifest-fetch counter for C-09 kill-criterion primary measurement | implementer-agent |
| docs/privacy.md | Create | implementer-agent |

> **M-02 deferral note:** `telemetry-server/v1/ping-handler.ts` and the HTTP endpoint ship in M-02 once hosting is decided. M-01 writes pings to `~/.cache/loom/pending-pings.toon` only.

#### Acceptance Criteria
- [ ] `/loom-init` opt-in prompt: default `N` writes `doNotTrack: true`; `y` enables `lastPing` updates
- [ ] **Opt-in prompt has a 30s timeout; on timeout `doNotTrack: true` is written** (CI/non-interactive `/loom-init` must not block)
- [ ] Ping client honors `doNotTrack=true` and never queues
- [ ] When `doNotTrack=false`, pings are written to `~/.cache/loom/pending-pings.toon` (server delivery deferred to M-02)
- [ ] Manifest-fetch counter instrumented via GitHub API and surfaced for C-09 evaluation (primary M-01 measurement path)
- [ ] `docs/privacy.md` describes what is collected, links from F-09a listing copy, and documents the M-01→M-02 hosting deferral

#### Convergence Targets
- Opt-in prompt exact-string match per F-11 spec
- `doNotTrack=true` → zero network calls (unit test with mocked HTTP)
- Ping endpoint handler returns documented status codes for documented inputs

#### Scenarios

```toon
id: S-01
title: Default-N opt-in sets doNotTrack and skips pings
given[2]: A fresh /loom-init is mid-flight, The opt-in prompt is the next step
when: User enters empty input (default N)
whenTriggerType: actor-action
then[3]: install.toon.doNotTrack MUST be true, install.toon.lastPing MUST be null, No HTTP request MUST be made to the telemetry endpoint
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: y opt-in enables lastPing updates
given[1]: /loom-init opt-in prompt is active
when: User enters "y"
whenTriggerType: actor-action
then[2]: install.toon.doNotTrack MUST be false, A successful ping MUST update install.toon.lastPing to the current ISO 8601 timestamp
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: Opt-in prompt times out at 30s with doNotTrack default true
given[1]: /loom-init has invoked the opt-in prompt in a non-interactive context
when: 30 seconds elapse with no input
whenTriggerType: system-event
then[2]: install.toon.doNotTrack MUST be true, /loom-init MUST exit 0 without blocking
stateRef:
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

```toon
id: S-04
title: Manifest-fetch counter increments via GitHub API instrumentation
given[1]: A plugin install triggers a manifest fetch
when: The fetch completes
whenTriggerType: system-event
then[1]: The manifest-fetch counter MUST increment (used by C-09 kill-criterion primary measurement)
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

> **M-02 scenarios (deferred):** Ping endpoint HTTP 204/400/429 scenarios ship in M-02 alongside the server-side handler.

---

### Phase 14 — Wave 7a: `/loom-doctor` v2 (F-04b, M-02)

**Agent:** implementer-agent
**Objective:** Add doctor checks (b) `orchestration.toml` schema, (c) `.loom/wiki/` artifact schema, (e) Claude Code plugin spec version; add `--fix` auto-remediation.
**Dependencies:** Phase 9, Phase 15 (plugin-spec check reads manifest paths resolved via Phase 15 full resolver)
**File Ownership:** src/commands/doctor/checks/schema-orch.ts, src/commands/doctor/checks/schema-wiki.ts, src/commands/doctor/checks/plugin-spec.ts, src/commands/doctor/fix.ts, src/commands/doctor/__tests__/v2.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/commands/doctor/checks/schema-orch.ts | Create | implementer-agent |
| src/commands/doctor/checks/schema-wiki.ts | Create | implementer-agent |
| src/commands/doctor/checks/plugin-spec.ts | Create | implementer-agent |
| src/commands/doctor/fix.ts | Create (replaces stub) | implementer-agent |
| src/commands/doctor/__tests__/v2.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] Schema-drift check detects stale `orchestration.toml` versus current schema
- [ ] Wiki artifact-schema check surfaces `/loom-upgrade` as `fixCommand`
- [ ] Plugin-spec check compares manifest `minClaudeCodeVersion` to running CC version (reads manifest paths via Phase 15 resolver)
- [ ] `--fix` runs auto-remediable migrations and reports per-check outcome
- [ ] `/loom-doctor --json` output asserts `reportVersion=2` (discriminator bump from M-01 `reportVersion=1`)

#### Convergence Targets
- All five doctor checks present (a/d from M-01 + b/c/e from M-02 + hooks from F-15)
- `--fix` exits 0 on success, non-zero with per-check status on partial failure

#### Scenarios

```toon
id: S-01
title: Schema-drift check surfaces /loom-upgrade as fixCommand
given[1]: orchestration.toml schema version lags current
when: /loom-doctor is invoked
whenTriggerType: actor-action
then[2]: The schema-orch check MUST be yellow or red, fixCommand MUST equal "/loom-upgrade"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --fix applies auto-remediable schema migration
given[1]: A schema-drift check is yellow with a known migration path
when: /loom-doctor --fix is invoked
whenTriggerType: actor-action
then[2]: The migration MUST be applied, A subsequent /loom-doctor MUST report the check as green
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 15 — Wave 7a: Full plugin-root resolver (F-07, M-02)

**Agent:** implementer-agent
**Objective:** Extend F-07a resolver to cover `library.yaml` and hook bodies; zero inline `${LOOM_PLUGIN_ROOT}` outside resolver.
**Dependencies:** Phase 1
**File Ownership:** hooks/lib/plugin-root-resolver.ts (extend), skills/library.yaml (resolver integration), hooks/lib/library-resolver.ts, hooks/lib/library-resolver.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/plugin-root-resolver.ts | Modify (extend for library.yaml + hooks) | implementer-agent |
| skills/library.yaml | Modify (use resolver variable) | implementer-agent |
| hooks/lib/library-resolver.ts | Create | implementer-agent |
| hooks/lib/library-resolver.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `grep -RE 'LOOM_PLUGIN_ROOT' agents/ skills/ commands/ hooks/` returns 0 matches outside resolver module
- [ ] `library.yaml` resolution uses resolver; hand-authored kits fall back to repo paths
- [ ] `bunx vitest run hooks/lib/library-resolver.test.ts` exits 0

#### Convergence Targets
- Static lint: no inline plugin-root references anywhere outside resolver
- Library resolver handles both packaged and hand-authored kits

#### Scenarios

```toon
id: S-01
title: library.yaml entries resolve plugin-root paths via resolver
given[2]: library.yaml has an entry referencing a packaged skill, .loom/plugin-root is present
when: The library loader resolves the entry
whenTriggerType: api-call
then[1]: The resolved path MUST be the absolute plugin-root path
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Hand-authored kit falls back to repo-relative path
given[1]: library.yaml has an entry that does not reference plugin-root
when: The library loader resolves the entry
whenTriggerType: api-call
then[1]: The resolved path MUST be repo-relative
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-03
title: No LOOM_PLUGIN_ROOT inline outside resolver
given[1]: The repo agents/ skills/ commands/ hooks/ trees exist
when: grep -RE 'LOOM_PLUGIN_ROOT' is run excluding hooks/lib/plugin-root-resolver.ts and hooks/lib/library-resolver.ts
whenTriggerType: system-event
then[1]: The grep MUST return zero matches
stateRef:
tags[1]: regression
testTier: integration
automatable: true
```

---

### Phase 16 — Wave 7b: Plugin-declared hooks (F-08, M-02)

**Agent:** implementer-agent
**Objective:** Migrate all Loom hooks from `~/.claude/settings.json` hand-edits to plugin-manifest declarations (C-07).
**Dependencies:** Phase 4 (manifest), Phase 15 (resolver)
**File Ownership:** plugin/manifest.toon (extend hooks block), plugin/hooks-declarations/*.toon, scripts/strip-settings-json-hooks.ts, test/plugin-hooks.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| plugin/manifest.toon | Modify (add hooks block) | implementer-agent |
| plugin/hooks-declarations/pre-tool-use.toon | Create | implementer-agent |
| plugin/hooks-declarations/post-tool-use.toon | Create | implementer-agent |
| plugin/hooks-declarations/user-prompt-submit.toon | Create | implementer-agent |
| scripts/strip-settings-json-hooks.ts | Create | implementer-agent |
| test/plugin-hooks.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] After plugin install: `~/.claude/settings.json` has zero Loom-related hook entries
- [ ] All Loom hooks fire correctly on PreToolUse/PostToolUse/UserPromptSubmit
- [ ] Worktree scenario: each worktree resolves its own `.loom/plugin-root` through hooks
- [ ] `scripts/strip-settings-json-hooks.ts` removes legacy entries during F-05 migration

#### Convergence Targets
- `settings.json` Loom-hook count after install: 0
- All 6 PreToolUse hooks fire under stripped PATH (F-15 verification matrix preserved)

#### Scenarios

```toon
id: S-01
title: Plugin install leaves settings.json clean of Loom hooks
given[1]: A fresh Claude Code install
when: claude plugin add loom completes
whenTriggerType: actor-action
then[1]: ~/.claude/settings.json MUST contain zero entries referencing Loom hooks
stateRef: plugin
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Plugin-declared hooks fire on PreToolUse
given[1]: A plugin install with hooks declared
when: A tool call triggers PreToolUse
whenTriggerType: system-event
then[1]: All 6 PreToolUse hooks MUST execute and exit 0
stateRef:
tags[2]: happy-path, regression
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Worktree resolves its own .loom/plugin-root through hooks
given[1]: A worktree with its own .loom/plugin-root distinct from the main repo
when: A hook fires inside the worktree
whenTriggerType: system-event
then[1]: The resolved plugin-root MUST equal the worktree-local value
stateRef:
tags[2]: edge-case, regression
testTier: e2e
automatable: true
```

---

### Phase 17a — Wave 8: F-10b extended fixtures (M-02)

**Agent:** wiring-agent
**Objective:** Ship F-10b extended CI fixtures (stale-schema, mixed-channel, partial-migration) and the convergence-loop fixture.
**Dependencies:** Phase 6 (changelog), Phase 8 (F-10a fixture), Phase 10 (`/loom-migrate-to-plugin`), Phase 11 (`/loom-update`), Phase 13 (telemetry), Phase 14 (`/loom-doctor` v2), Phase 16 (plugin-declared hooks) — the convergence-loop fixture exercises the full CLI surface including doctor v2 and plugin-declared hooks; without them the stale-schema and mixed-channel fixtures reference checks that don't exist.
**File Ownership:** test/plugin-convergence-loop.test.ts, test/fixtures/stale-schema/, test/fixtures/mixed-channel/, test/fixtures/partial-migration/

#### Acceptance Criteria
- [ ] Extended F-10b fixture exercises a sample convergence loop end-to-end inside the container
- [ ] Stale-schema, mixed-channel, partial-migration fixtures all exit 0

---

### Phase 17b-i — Wave 8: F-14 triage wiring (M-02; ships immediately post-M-01)

**Agent:** wiring-agent
**Objective:** Ship F-14 support triage wiring (GitHub labels, issue templates, contributing docs). **No marketplace-data dependency** — ships immediately after M-01 listing goes live.
**Dependencies:** Phase 0, Phase 4 (channel/source enum)
**File Ownership:** .github/labels.yml, .github/ISSUE_TEMPLATE/bug.md, .github/ISSUE_TEMPLATE/install-issue.md, docs/contributing.md

#### Acceptance Criteria
- [ ] GitHub labels `channel:curl`, `channel:plugin`, `source:*` exist
- [ ] Issue template prompts for `install.toon` contents and `/loom-doctor --bundle` attachment
- [ ] Triage flow documented in docs/contributing.md

---

### Phase 17b-ii — Wave 8: F-09b listing copy iteration (M-02; gated on launchDate + 30d)

**Agent:** wiring-agent
**Objective:** Ship F-09b listing copy iteration with changelog surfacing. **Gated on real first-30-day marketplace data** — cannot start until `launchDate + 30d`.
**Dependencies:** Phase 6 (changelog), Phase 13 (telemetry / manifest-fetch counter), M-01 launch + 30 days of real marketplace data
**File Ownership:** marketplace/listing.md (Modify), marketplace/changelog-surfacing.ts, marketplace/competitive-scan.md

#### Acceptance Criteria
- [ ] Listing copy iteration references real manifest-fetch counter data from `src/telemetry/manifest-fetch-counter.ts` (not synthetic)
- [ ] Marketplace adjacency scan re-evaluates the C-14 differentiation claim against current marketplace listings
- [ ] Changelog surfacing block in listing.md sourced from Phase 6's auto-generated CHANGELOG.md
- [ ] Gate enforced: phase MUST NOT begin before `launchDate + 30d` (track via GitHub issue with launch timestamp)

---

### Phase 17 — Wave 8: M-02 polish (legacy combined view — superseded by 17a/17b)

**Agent:** wiring-agent
**Objective:** Ship F-09b listing copy iteration with changelog surfacing, F-10b extended CI fixtures, F-14 support triage wiring. This is a wiring/polish phase combining three small features that touch independent files. **Superseded by the 17a/17b split above.**
**Dependencies:** Phase 6 (changelog), Phase 8 (F-10a fixture), Phase 13 (telemetry)
**File Ownership:** marketplace/listing.md (extend — modify), marketplace/changelog-surfacing.ts, test/plugin-convergence-loop.test.ts, test/fixtures/stale-schema/, test/fixtures/mixed-channel/, test/fixtures/partial-migration/, .github/ISSUE_TEMPLATE/bug-report.yml, scripts/create-triage-labels.ts, docs/contributing.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| marketplace/listing.md | Modify (iteration based on first-30-day data) | wiring-agent |
| marketplace/changelog-surfacing.ts | Create | wiring-agent |
| test/plugin-convergence-loop.test.ts | Create | wiring-agent |
| test/fixtures/stale-schema/ | Create | wiring-agent |
| test/fixtures/mixed-channel/ | Create | wiring-agent |
| test/fixtures/partial-migration/ | Create | wiring-agent |
| .github/ISSUE_TEMPLATE/bug-report.yml | Create | wiring-agent |
| scripts/create-triage-labels.ts | Create | wiring-agent |
| docs/contributing.md | Modify (add triage flow) | wiring-agent |

#### Acceptance Criteria
- [ ] Extended F-10b fixture exercises a sample convergence loop end-to-end inside the container
- [ ] Stale-schema, mixed-channel, partial-migration fixtures all exit 0
- [ ] Issue template prompts for `install.toon` contents and `/loom-doctor --bundle`
- [ ] `scripts/create-triage-labels.ts` creates `channel:curl`, `channel:plugin`, and `source:*` labels via gh CLI
- [ ] Listing surfaces per-version changelog sourced from F-03's `CHANGELOG.md`

#### Convergence Targets
- Extended fixture matrix all-green
- Issue template includes the two required prompts
- Triage label set matches roadmap spec

#### Scenarios

```toon
id: S-01
title: Extended fixture exercises convergence loop end-to-end
given[1]: A Docker container with Loom plugin-installed and a sample project
when: A representative convergence loop is executed inside the container
whenTriggerType: system-event
then[1]: The loop MUST complete without manual intervention and exit 0
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Stale-schema fixture surfaces /loom-upgrade fixCommand
given[1]: The stale-schema fixture has orchestration.toml at an older version
when: /loom-doctor is invoked against the fixture
whenTriggerType: actor-action
then[1]: At least one check MUST report fixCommand "/loom-upgrade"
stateRef:
tags[1]: edge-case
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Issue template includes required prompts
given[1]: The bug-report issue template file exists
when: The template content is read
whenTriggerType: system-event
then[2]: The template MUST prompt for install.toon contents, The template MUST prompt for a /loom-doctor --bundle attachment
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-04
title: Triage labels created idempotently
given[1]: A repo without channel:* labels
when: scripts/create-triage-labels.ts is run
whenTriggerType: api-call
then[2]: Labels channel:curl channel:plugin source:curl-script source:marketplace-browse source:self-hosted-url source:direct-link source:migration source:beta-channel MUST exist, Re-running MUST be a no-op
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

## Verification Commands

```bash
# Type-check
bunx tsc --noEmit

# Unit + integration test suites
bunx vitest run

# Static lint: no inline LOOM_PLUGIN_ROOT outside resolver (C-04, F-07a, F-07)
grep -RE '\$\{LOOM_PLUGIN_ROOT\}|~/.claude/plugins/loom' agents/ skills/ commands/ hooks/ \
  | grep -v 'hooks/lib/plugin-root-resolver.ts\|hooks/lib/library-resolver.ts' \
  | wc -l  # must be 0

# C-16 hook PATH probe matrix (F-15)
for hook in deploy-guard context-budget budget-tracker contract-lock file-ownership wiki-write-guard; do
  env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh hooks/$hook.ts < /dev/null
done  # every hook must exit 0 with no stderr

# F-10a clean-machine harness (C-15)
docker build -t loom-harness -f test/docker/Dockerfile .
docker run --rm loom-harness bun test test/plugin-install-e2e.test.ts test/worktree-init.test.ts

# F-06 manifest-drift check
bunx tsx scripts/verify-manifest-drift.ts

# F-06 sigstore verification
cosign verify --certificate-identity loom-release-bot dist/loom-vX.Y.Z.tar.gz

# Schema validation (Phase 0 contracts intact)
bunx tsx scripts/validate-toon-schemas.ts protocols/

# CLI smoke
bunx tsx src/cli.ts loom-doctor --json
bunx tsx src/cli.ts loom-update --check
bunx tsx src/cli.ts loom-uninstall --dry-run
```

## Milestones

### M-01: Marketplace Day-One Launch

**Submission-blocking acceptance (gates listing PR):**
- Phases 0–8 complete
- F-10a Docker harness exits 0 on a clean container (Phase 8)
- F-06 manifest-drift CI check passes; sigstore attestation runs before marketplace PR (Phase 7)
- F-09a listing copy reviewed against outcomes-not-features checklist (Phase 5)
- F-07a resolver static lint clean (Phase 1)
- F-15 hook PATH verification matrix all-green (Phase 2)

**Milestone-completion acceptance (M-01 declared done):**
- Phases 9–13 complete
- `/loom-doctor`, `/loom-update`, `/loom-uninstall` ship with documented flags
- `/loom-migrate-to-plugin` ships with `--dry-run`, `--reconcile`, `--resume`
- F-11 telemetry supports C-03 sunset evaluation

### M-02: Plugin-Native Architecture + Sunset Evaluation

**Acceptance:**
- Phases 14–17 complete
- `~/.claude/settings.json` has zero Loom-hook entries after install (F-08)
- Single resolver layer covers `library.yaml` and hooks (F-07)
- Extended F-10b fixture covers convergence loop + stale-schema + mixed-channel + partial-migration
- Triage labels and issue template wired (F-14)
- C-03 sunset and C-09 kill criterion evaluated at the 90-day mark using F-11 signals (manifest-fetch counter primary in M-01)
- **C-10 activation hook (quarterly review checkpoint):** each quarter, evaluate whether Anthropic has shipped first-party planning primitives; if yes, initiate a 30-day C-10 evaluation window.

## Risks & Mitigations

| Risk | Mitigation | Phase |
|------|------------|-------|
| Hook PATH-inheritance class bug regresses | Phase 2 verification matrix; Phase 8 Docker harness preserves matrix | Phases 2, 8 |
| Manifest drift slips past CI | Phase 7 sha256-compare on every tag | Phase 7 |
| Plugin path semantics change upstream | F-07a/F-07 resolver as single layer; lint enforces no inline refs | Phases 1, 15 |
| First-invocation UX regresses to cliff | F-02 + F-10a harness gates submission | Phases 3, 8 |
| Migration leaves users in mixed-channel state | F-05 marker + `--resume` + `/loom-doctor --reconcile` | Phases 9, 10 |
| Telemetry endpoint outage breaks installs | F-11 ping is best-effort (no retries); `doNotTrack=true` default-N | Phase 13 |

## Acceptance Criteria (Final)

- [ ] Loom is listed on the official Anthropic marketplace under `claude plugin add loom`
- [ ] All 16 ROADMAP constraints C-01..C-16 are honored in shipped code (verified by lints, tests, and harness)
- [ ] All M-01 submission-blocking features (F-01, F-02, F-03, F-06, F-07a, F-09a, F-10a, F-15) have green convergence targets before the marketplace submission PR opens
- [ ] All M-01 post-submission features (F-04, F-05, F-11, F-12, F-13) ship in the first post-listing release
- [ ] M-02 features (F-04b, F-07, F-08, F-09b, F-10b, F-14) ship after M-01 completion
- [ ] At the 90-day mark, C-09 kill criterion is evaluated using F-11 signals; if triggered, the marketplace listing is delisted and curl returns to README primacy

---
planVersion: 2
name: plugin-marketplace-migration
status: draft
created: 2026-06-16
roadmapRef: planning/ROADMAP.md
milestoneRef: M-07
featureRefs:
  - F-15
  - F-16
  - F-17
dependsOn:
  - F-14
  - M-06-Phase-1
totalPhases: 5
convergenceTiers:
  - unit
  - integration
  - e2e
  - qa-review
---

# PLAN: Plugin Marketplace Migration

## 1. Vision

Align Loom's install model with Anthropic's documented Claude Code plugin format (`.claude-plugin/plugin.json` + `hooks/hooks.json`) so users can `/plugin marketplace add launchstack-dev/loom-ai` and `/plugin install loom` to get a fully-wired Loom toolchain — agents, skills, commands, hooks, MCP servers — without any mutation of `~/.claude/settings.json`. The curl `install.sh` path remains a first-class, supported fallback for users on locked-down systems or those who want a tagged, signed release. Both install paths produce equivalent runtime behavior, differing only in the anchor variable (`${CLAUDE_PLUGIN_ROOT}` vs `${CLAUDE_PROJECT_DIR}`). A new `/loom-doctor` skill replaces the existing ad-hoc `cp -n` / `--replace` heuristics with a deterministic, evidence-guarded health check and SessionStart auto-migration. Per-project hook registration defaults to `.claude/settings.local.json` (machine-local, gitignored), with explicit team opt-in to the committed `.claude/settings.json` tier.

## 2. Scope

### In Scope

- `.claude-plugin/plugin.json` manifest describing Loom's agents, skills, commands, hooks, MCP servers
- `hooks/hooks.json` declaring SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop wiring under `${CLAUDE_PLUGIN_ROOT}`
- `install.sh` mutual-exclusion detection (refuse install when plugin already registered; surface migration recipe)
- `/loom-doctor` skill + `scripts/loom-doctor.ts` health-check CLI (TOON + `--json` output)
- `hooks/loom-migration.ts` SessionStart hook with ownership-evidence guarding
- `register-loom-hooks.ts` `--tier <auto|local|project>` flag with default flip to `local`
- Updates to `commands/loom-init.md`, `commands/loom-auto.md`, `commands/loom-roadmap/init.md` to pass through tier
- Two E2E stories (Playwright + Chrome MCP per F-04/F-05): plugin install path, curl install path
- README restructure documenting both install paths and decision matrix
- `planning/notes/plugin-marketplace-rationale.md` for kit authors

### Out of Scope (Non-Goals)

- Deprecating or sunsetting the curl `install.sh` install path
- Migrating wiki-specific hooks (`register-wiki-hooks.ts`) — separate concern, tracked elsewhere
- Managed-settings policy support (`/Library/Application Support/ClaudeCode/managed-settings.json`)
- Plugin marketplace UI changes or contributing to Anthropic's marketplace registry
- Renaming or moving existing hook files (only adding `hooks.json` descriptor alongside)
- Changing the `hooks/run-hook.sh` runtime wrapper contract (F-14)
- Backporting tier flip to projects that have already opted into `project` tier

## 3. Phases

### Phase 0 — Schema Contracts (Wave 0)

Establish TOON/markdown schemas before any implementation so all downstream waves consume stable contracts.

**Deliverables**

| Path | Owner | Purpose |
|---|---|---|
| `agents/protocols/plugin-manifest.schema.md` | wave-0-schemas-agent | Mirrors Anthropic `plugin.json` shape; documents Loom-specific field constraints |
| `agents/protocols/hook-manifest.schema.md` | wave-0-schemas-agent | Mirrors Anthropic `hooks.json` shape; documents `${CLAUDE_PLUGIN_ROOT}` anchoring |
| `agents/protocols/doctor-report.schema.md` | wave-0-schemas-agent | DoctorReport + embedded HealthCheck[] |
| `agents/protocols/migration-evidence.schema.md` | wave-0-schemas-agent | Hash-based ownership evidence record |
| `agents/protocols/settings-tier.schema.md` | wave-0-schemas-agent | SettingsTier enum + TierResolution algorithm |

**Acceptance Criteria**

- All five schema files exist with TOON-formatted exemplar blocks (unit tier)
- Each schema cross-references its consumer (which phase/wave reads it) (qa-review tier)
- No schema references a not-yet-defined type (unit tier — schema linter)

### Phase 1 — F-15 Plugin Manifest (Wave 1)

Ship the native Claude Code plugin manifest and install-time mutual-exclusion.

**Deliverables**

| Path | Owner | Purpose |
|---|---|---|
| `.claude-plugin/plugin.json` | wave-1-manifest-agent | Plugin manifest declaring all Loom resources |
| `hooks/hooks.json` | wave-1-manifest-agent | Hook descriptor referencing `${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh` |
| `install.sh` (edit) | wave-1-manifest-agent | Add plugin-detection pre-flight, mutual-exclusion abort path |
| `tests/plugin-manifest.test.ts` | wave-1-manifest-agent | Vitest: manifest JSON-schema-valid, all referenced files exist, anchors well-formed |
| `tests/install-mutual-exclusion.test.ts` | wave-1-manifest-agent | Vitest: install.sh exits with code `INSTALL_CONFLICT_PLUGIN_AND_CURL` when plugin present |

**Acceptance Criteria**

- `plugin.json` validates against Anthropic's published plugin schema (unit tier)
- `hooks.json` registers SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop with `${CLAUDE_PLUGIN_ROOT}` anchors (unit tier)
- Plugin install produces equivalent runtime behavior to curl install modulo anchor variable (integration tier)
- `install.sh` detects an existing plugin install and refuses with exit code 9 and a one-line migration recipe (integration tier)
- README mentions both install paths in the Quickstart (qa-review tier)

### Phase 2 — F-16 Doctor + Auto-Migration (Wave 2)

Replace ad-hoc install heuristics with a deterministic health check and ownership-guarded migration.

**Deliverables**

| Path | Owner | Purpose |
|---|---|---|
| `commands/loom-doctor.md` | wave-2-doctor-agent | `/loom-doctor` slash command surface |
| `scripts/loom-doctor.ts` | wave-2-doctor-agent | Health-check CLI; emits TOON by default, JSON with `--json` |
| `hooks/loom-migration.ts` | wave-2-doctor-agent | SessionStart hook performing idempotent legacy rewrite |
| `scripts/lib/ownership-evidence.ts` | wave-2-doctor-agent | Hash-based file-divergence detector reused by doctor + migration |
| `tests/loom-doctor.test.ts` | wave-2-doctor-agent | Vitest: health checks (hook files, runner resolution, anchor form, orphans) |
| `tests/loom-migration.test.ts` | wave-2-doctor-agent | Vitest: migration is idempotent, refuses ownership-divergent files, emits MigrationEvidence |

**Acceptance Criteria**

- `/loom-doctor` reports zero problems on a fresh install via either path (e2e tier)
- Doctor exits 0 (healthy), 1 (problems found), 2 (internal error) (unit tier)
- `--json` output conforms to DoctorReport schema (unit tier)
- SessionStart migration is idempotent — running twice produces identical settings file (integration tier)
- Migration refuses to rewrite a settings entry whose recorded hash differs from on-disk hash; surfaces `MIGRATION_OWNERSHIP_DIVERGED` as advisory (integration tier)
- Doctor surfaces `DOCTOR_BARE_ANCHOR` for legacy pre-PR-8 entries (unit tier)
- `--fix` flag delegates to migration logic and re-runs checks (integration tier)

### Phase 3 — F-17 Settings Tier Flip (Wave 3)

Default per-project hook registration into `.claude/settings.local.json`; provide opt-in to committed tier.

**Deliverables**

| Path | Owner | Purpose |
|---|---|---|
| `scripts/register-loom-hooks.ts` (edit) | wave-3-tier-agent | Add `--tier <auto|local|project>` flag; default resolution = `auto` → `local` |
| `scripts/lib/tier-resolution.ts` | wave-3-tier-agent | TierResolution algorithm (extracted) |
| `commands/loom-init.md` (edit) | wave-3-tier-agent | Pass through tier flag |
| `commands/loom-auto.md` (edit) | wave-3-tier-agent | Pass through tier flag |
| `commands/loom-roadmap/init.md` (edit) | wave-3-tier-agent | Pass through tier flag |
| `tests/tier-resolution.test.ts` | wave-3-tier-agent | Vitest: auto-resolution, explicit overrides, conflict detection |
| `tests/register-loom-hooks-tier.test.ts` | wave-3-tier-agent | Vitest: writes to settings.local.json by default; project tier opt-in writes settings.json |

**Acceptance Criteria**

- Default `register-loom-hooks.ts` invocation writes to `.claude/settings.local.json` (unit tier)
- `--tier project` writes to `.claude/settings.json` and emits a notice that the file will be committed (unit tier)
- `--tier auto` resolves to `local` unless `.claude/settings.json` already contains Loom entries (unit tier)
- Tier conflict (entries in both files) surfaces `MIGRATION_TIER_AMBIGUOUS` and refuses to write without explicit `--tier` (integration tier)
- Re-running on an existing project preserves prior tier choice (integration tier)

### Phase 4 — Docs + E2E (Wave 4)

Document both install paths and prove equivalence with E2E stories.

**Deliverables**

| Path | Owner | Purpose |
|---|---|---|
| `README.md` (edit) | wave-4-docs-agent | Restructure Quickstart with plugin path, curl path, decision matrix |
| `planning/notes/plugin-marketplace-rationale.md` | wave-4-docs-agent | Kit-author guide; why both paths; how to author kits that work under both |
| `tests/e2e/plugin-install.spec.ts` | wave-4-e2e-agent | Playwright + Chrome MCP: fresh project → `/plugin install loom` → run `/loom-doctor` → zero problems |
| `tests/e2e/curl-install.spec.ts` | wave-4-e2e-agent | Playwright + Chrome MCP: fresh project → `curl install.sh` → run `/loom-doctor` → zero problems |
| `tests/e2e/runtime-equivalence.spec.ts` | wave-4-e2e-agent | Playwright: same `/loom-quick` task under each install path produces equivalent hook fire sequence |

**Acceptance Criteria**

- README Quickstart has two install paths with clear "use plugin when … / use curl when …" guidance (qa-review tier)
- `planning/notes/plugin-marketplace-rationale.md` covers the decision tree for kit authors (qa-review tier)
- Both E2E specs run green on CI (e2e tier)
- Runtime-equivalence spec asserts identical hook fire order and identical agent registration list (e2e tier)

## 4. Data Model

```toon
PluginManifest:
  name: string                    # "loom"
  version: string                 # semver, matches package.json
  description: string
  author: string                  # "launchstack-dev"
  repository: string              # https URL
  entrypoints[]{type,path}:
    agent,agents/
    skill,skills/
    command,commands/
    hook,hooks/hooks.json
    mcp,.mcp.json
  requires:
    claudeCode: string            # ">=2.0.0"

HookManifest:
  hooks[]{event,matcher,command,timeout}:
    SessionStart,*,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration,30
    PreToolUse,Write|Edit,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh pre-write,15
    PostToolUse,Write|Edit,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh post-write,15
    UserPromptSubmit,*,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh prompt-submit,10
    Stop,*,${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh stop,10

DoctorReport:
  schemaVersion: int              # 1
  generatedAt: iso8601
  installSource: string           # plugin | curl | unknown
  tier: string                    # local | project | mixed
  overallStatus: string           # clean | warnings | problems
  checks[]{id,category,status,severity,message,remediation}:
    # see HealthCheck below
  exitCode: int                   # 0 | 1 | 2

HealthCheck:
  id: string                      # stable identifier, e.g., "hook-files-present"
  category: string                # files | runtime | settings | tier
  status: string                  # pass | warn | fail
  severity: string                # info | warning | error
  message: string
  remediation: string             # human-readable next step
  evidence:
    paths[]: string
    expected: string
    actual: string

MigrationEvidence:
  schemaVersion: int              # 1
  recordedAt: iso8601
  source:
    path: string                  # absolute path to settings file
    sha256: string                # hash at time of registration
  rewrites[]{key,before,after}:
    # entries actually modified
  outcome: string                 # applied | refused-ownership-guard | not-needed | failed
  reason: string                  # human-readable

SettingsTier:
  values[]: user, project, local, managed
  precedence[]: managed, project, local, user
  defaultForRegister: local

TierResolution:
  inputs:
    explicitFlag: string?         # auto | local | project | null
    existingLocalEntries: bool
    existingProjectEntries: bool
  output:
    chosenTier: string            # local | project
    reason: string                # explicit | preserve-prior | default | conflict-refused
    conflictDetected: bool
```

Indexes / cascades: N/A — all artifacts are stateless on-disk descriptors. The only durable state is per-file SHA-256 evidence kept inside `MigrationEvidence` records appended to `.claude/loom-migration.log.toon`.

## 5. API Specification

### CLI: `loom-doctor`

```
loom-doctor [--json] [--fix] [--tier <auto|local|project>]
```

| Flag | Behavior |
|---|---|
| `--json` | Emit DoctorReport as JSON instead of TOON |
| `--fix` | Run idempotent auto-migration before re-checking |
| `--tier` | Constrain checks to a specific tier; default `auto` inspects all |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | All checks pass (overallStatus: clean) |
| 1 | Problems found (overallStatus: warnings or problems) |
| 2 | Internal error (schema corrupt, IO failure) |
| 9 | Reserved for `INSTALL_CONFLICT_PLUGIN_AND_CURL` (install.sh only) |

**DoctorReport JSON output shape** — mirrors the DoctorReport TOON schema above; emitted to stdout when `--json` set. stderr reserved for human-readable progress lines.

### CLI: `register-loom-hooks.ts`

```
bun scripts/register-loom-hooks.ts [--tier <auto|local|project>] [--replace] [--dry-run]
```

| Flag | Behavior |
|---|---|
| `--tier auto` | Default. Resolves via TierResolution algorithm |
| `--tier local` | Force writes to `.claude/settings.local.json` |
| `--tier project` | Force writes to `.claude/settings.json`; prints commit notice |
| `--replace` | Existing behavior: overwrite Loom-owned entries |
| `--dry-run` | Print planned writes without mutating disk |

### External API Contracts (owned by Anthropic)

- `.claude-plugin/plugin.json` — per `code.claude.com/docs/en/plugins-reference`
- `hooks/hooks.json` — per same reference
- `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` tier hierarchy — per `code.claude.com/docs/en/settings`

Loom MUST treat these schemas as upstream. The plan's data model snapshots known fields; on Anthropic schema drift, only `agents/protocols/plugin-manifest.schema.md` and `agents/protocols/hook-manifest.schema.md` need updates.

## 6. State Machines

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

## 7. Error Handling

| Code | Severity | Exit | Remediation |
|---|---|---|---|
| `DOCTOR_HOOK_MISSING` | error | 1 | Re-run `/plugin install loom` or `install.sh`; missing hook file at expected path |
| `DOCTOR_RUNNER_UNRESOLVED` | error | 1 | Install `bun` or ensure `npx tsx` works; `hooks/run-hook.sh` could not locate a runner |
| `DOCTOR_BARE_ANCHOR` | warning | 1 | Run `/loom-doctor --fix` to rewrite legacy entries to anchored form |
| `DOCTOR_ORPHAN_ENTRY` | warning | 1 | Run `/loom-doctor --fix`; an entry references a hook file Loom no longer owns |
| `MIGRATION_OWNERSHIP_DIVERGED` | warning | 1 | Settings file hash differs from recorded evidence; review diff and re-run with `--fix --force` |
| `MIGRATION_SETTINGS_CORRUPT` | error | 2 | Settings JSON unparseable; manual repair required |
| `MIGRATION_TIER_AMBIGUOUS` | error | 1 | Loom entries found in both settings.json and settings.local.json; pass explicit `--tier` |
| `MANIFEST_INVALID` | error | 2 | `plugin.json` or `hooks.json` fails schema validation; reinstall from tagged release |
| `INSTALL_CONFLICT_PLUGIN_AND_CURL` | error | 9 | Plugin already registered; uninstall plugin or skip curl install |

## 8. Acceptance Criteria

### F-15 — Plugin Manifest

- `.claude-plugin/plugin.json` exists and validates against Anthropic's published schema (unit)
- `hooks/hooks.json` registers all five hook events with `${CLAUDE_PLUGIN_ROOT}` anchors (unit)
- `/plugin install loom` registers agents, skills, commands, hooks, MCP servers without touching `~/.claude/settings.json` (e2e)
- `install.sh` detects existing plugin install and aborts with exit 9 + migration recipe (integration)
- Runtime equivalence: same `/loom-quick` invocation fires identical hook sequence under each install path (e2e)

### F-16 — Doctor + Migration

- `/loom-doctor` reports zero problems on fresh plugin install (e2e)
- `/loom-doctor` reports zero problems on fresh curl install (e2e)
- Doctor detects legacy bare-anchor entries from pre-PR-8 installs (unit)
- Doctor detects orphan entries pointing to removed hooks (unit)
- SessionStart migration is idempotent across repeated invocations (integration)
- Migration refuses to rewrite user-modified files; surfaces `MIGRATION_OWNERSHIP_DIVERGED` (integration)
- Doctor JSON output conforms to DoctorReport schema (unit)
- Doctor `--fix` re-runs checks after applying fixes (integration)

### F-17 — Settings Tier Flip

- Default `register-loom-hooks.ts` invocation writes to `.claude/settings.local.json` (unit)
- `.claude/settings.local.json` is in `.gitignore` after default registration (integration)
- `--tier project` writes to `.claude/settings.json` and prints commit notice (unit)
- TierResolution detects conflicts and refuses without explicit flag (integration)
- Re-init preserves prior tier choice (integration)

### M-07 Milestone

- Loom installable via BOTH `/plugin marketplace add` AND curl `install.sh` (e2e)
- Equivalent runtime behavior under both paths (e2e)
- `/loom-doctor` reports clean on fresh install via either path (e2e)
- Default per-project tier is `.claude/settings.local.json` (qa-review)
- README documents both paths with decision matrix (qa-review)
- `planning/notes/plugin-marketplace-rationale.md` documents rationale for kit authors (qa-review)

## 9. File Ownership Matrix

| Wave | Agent | Owned Paths |
|---|---|---|
| 0 | wave-0-schemas-agent | `agents/protocols/plugin-manifest.schema.md`, `agents/protocols/hook-manifest.schema.md`, `agents/protocols/doctor-report.schema.md`, `agents/protocols/migration-evidence.schema.md`, `agents/protocols/settings-tier.schema.md` |
| 1 | wave-1-manifest-agent | `.claude-plugin/plugin.json`, `hooks/hooks.json`, `install.sh`, `tests/plugin-manifest.test.ts`, `tests/install-mutual-exclusion.test.ts` |
| 2 | wave-2-doctor-agent | `commands/loom-doctor.md`, `scripts/loom-doctor.ts`, `hooks/loom-migration.ts`, `scripts/lib/ownership-evidence.ts`, `tests/loom-doctor.test.ts`, `tests/loom-migration.test.ts` |
| 3 | wave-3-tier-agent | `scripts/register-loom-hooks.ts`, `scripts/lib/tier-resolution.ts`, `commands/loom-init.md`, `commands/loom-auto.md`, `commands/loom-roadmap/init.md`, `tests/tier-resolution.test.ts`, `tests/register-loom-hooks-tier.test.ts` |
| 4 | wave-4-docs-agent | `README.md`, `planning/notes/plugin-marketplace-rationale.md` |
| 4 | wave-4-e2e-agent | `tests/e2e/plugin-install.spec.ts`, `tests/e2e/curl-install.spec.ts`, `tests/e2e/runtime-equivalence.spec.ts` |

**Boundary notes**

- Wave 2 reads `scripts/register-loom-hooks.ts` but does not write it; tier mutation is Wave 3's exclusive territory.
- Wave 3 reads `scripts/lib/ownership-evidence.ts` (Wave 2's deliverable) but does not modify it.
- Waves 2 and 3 run sequentially, not in parallel, because Wave 3's tier-resolution tests exercise doctor's evidence helper.
- Wave 4 docs and Wave 4 e2e have disjoint paths and may run in parallel.

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic plugin manifest schema evolves mid-implementation | medium | high | Snapshot current schema in `agents/protocols/plugin-manifest.schema.md`; pin to documented version; doctor surfaces `MANIFEST_INVALID` on drift |
| Curl users miss the migration path to plugin | high | low | `/loom-doctor` prints one-shot migration recipe when curl install detected and plugin available; README decision matrix |
| Ownership-evidence false positives block legitimate migrations | medium | medium | `--fix --force` escape hatch; advisory (not blocking) surfacing of divergence; evidence log preserves before/after for forensic review |
| Tier flip surprises existing users on re-init | medium | medium | TierResolution preserves prior tier choice; `MIGRATION_TIER_AMBIGUOUS` refuses to write without explicit flag when both tiers populated |
| Plugin marketplace publication blocked by M-06 Phase 1 delay | low | high | Phases 0–3 ship independently; Phase 4 publication step is the only one gated on signed-release infrastructure |
| `${CLAUDE_PLUGIN_ROOT}` not set in non-plugin contexts | low | medium | `hooks/run-hook.sh` already falls back to `${CLAUDE_PROJECT_DIR}` (F-14); doctor verifies anchor resolution |

## 11. Rollout / Migration

### From pre-PR-8 (bare-anchor) installs

1. User runs `/loom-doctor` → reports `DOCTOR_BARE_ANCHOR` warnings per legacy entry
2. User runs `/loom-doctor --fix` → SessionStart migration rewrites bare entries to `${CLAUDE_PROJECT_DIR}`-anchored form
3. Migration emits `MigrationEvidence` to `.claude/loom-migration.log.toon`
4. Re-running doctor reports clean

### From PR-8 curl installs to plugin

1. User runs `/plugin marketplace add launchstack-dev/loom-ai` and `/plugin install loom`
2. On next session start, plugin hooks fire alongside legacy curl-registered hooks
3. `/loom-doctor` detects dual registration, prints recipe: remove `.claude/settings.local.json` Loom entries, retain only plugin-registered ones
4. User runs recipe; doctor re-checks clean

### Tier-flip on existing projects

- Projects with prior `.claude/settings.json` Loom entries: TierResolution preserves `project` tier on re-init; no surprise
- Projects with no prior Loom entries: default flip to `local`; README + doctor explain rationale
- Projects with both: `MIGRATION_TIER_AMBIGUOUS` blocks until user passes explicit `--tier`

## 12. Out of Scope

- Deprecating curl `install.sh` path (curl remains a first-class, supported install)
- Migrating wiki-specific hooks (`register-wiki-hooks.ts` is separate concern)
- Managed-settings policy (`/Library/Application Support/ClaudeCode/managed-settings.json`) support
- Plugin marketplace UI changes; this plan only ships the manifest
- Hook file renames, restructures, or merges
- Changes to `hooks/run-hook.sh` runtime wrapper contract (owned by F-14)
- Backporting tier-flip to projects that have explicitly opted into `project` tier
- MCP server lifecycle changes (plugin registers same MCP servers curl already wires)

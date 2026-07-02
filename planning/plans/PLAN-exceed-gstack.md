---
planVersion: 2
name: "Exceed gstack"
status: draft
created: 2026-07-01
lastReviewed: null
roadmapRef: planning/ROADMAP-exceed-gstack.md
totalPhases: 30
totalWaves: 12
---

# Plan: Exceed gstack

## Overview

Executes the approved 26-feature, 9-milestone "Exceed gstack" roadmap: fix 15 verified defects, harden the test and release spines, generate drift-proof docs, ship a free-by-default three-tier eval ladder, and upgrade every gstack-derived skill past its upstream. This plan serves Loom's maintainers and Loom-as-product users; its differentiator is convention-enforced quality that exceeds gstack's machinery-enforced quality while keeping Loom's fork-free extensibility. Foundation-first (C-10): Wave 0 lays shared-file contracts (repo-root `lib/` interfaces per C-02 plus CI gate contracts per C-01) before any parallel work touches the shared surfaces (`lib/`, `hooks/lib/*`, `scripts/*`, `.claude/settings.json`, `README.md`, `skills/library.yaml`, `.github/workflows/*`). Acceptance is not self-declared: the final wave re-runs the 4-agent comparative scorecard and requires every dimension ≥ gstack with overall > 8.3 (C-09).

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | TypeScript 5.x | All hooks, scripts, lib |
| Runtime | Bun (preferred), Node.js 20+ (hook runtime fallback) | C-12 pre-locked |
| Testing | Vitest | Unit, integration, property, meta-tests; `fileParallelism` restored in Phase 19 |
| CI | GitHub Actions | Tiered: PR-blocking gate + nightly gate (C-01) |
| Data format | TOON v1 | All Loom artifacts, agent outputs, eval results |
| Shared core | repo-root `lib/` | New neutral module: TOON parse/serialize, CSV, atomic-fs, entry-guard (C-02) |
| Lint | ESLint flat config | `no-restricted-imports` ban on local primitive reimplementations |
| Platform | Claude Code plugin + direct symlink | Host for the 5 resource types |

No new frameworks (C-12). No telemetry — every metric is repo-derivable (C-09/C-12).

## Schema / Type Definitions

All artifacts are TOON files on disk (this is a tooling repo — "indexes" are lookup keys the reader scripts enforce; "cascade behavior" is referential-cleanup semantics between artifacts). TypeScript types for all entities land in `lib/types.ts` in Phase 0.

### CiGateConfig

Lives in `protocols/ci-gates.contract.md` (contract) and is published per-run to `.loom-ci/gate-status.toon`.

```toon
ciGateConfig:
  tier: pr | nightly
  workflow: pr-gate.yml
  blocking: true
  schedule:                                   # cron, nightly tier only
  checks[6]{name,command,blocking,warnUntilPhase}:
    typecheck,tsc --noEmit -p hooks/tsconfig.json,true,
    lint,bunx eslint .,true,
    changed-file-tests,bun scripts/ci/changed-files-vitest.ts,true,
    hook-drift,bun scripts/ci/check-hook-drift.ts,false,13
    docs-drift,bun scripts/ci/check-docs-drift.ts --check,false,16
    library-catalog,bun scripts/ci/check-library-catalog.ts,true,
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| tier | enum | `pr` \| `nightly` | required; unknown tier is a blocking parse error |
| workflow | string | filename under `.github/workflows/` | must exist on disk |
| blocking | boolean | required | `nightly` tier is never PR-blocking |
| schedule | string \| null | cron expression | required iff tier=nightly |
| checks[] | table | ≥1 row | `name` unique within tier; `warnUntilPhase` empty or a valid phase number |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_gate | tier | PRIMARY | One config per tier |
| uq_check_name | tier, checks.name | UNIQUE | Stable required-check names for branch protection |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| CiGateConfig | EvalTierResult | Orphan results retained (append-only history) | Check rename requires branch-protection update in same PR |
| CiGateConfig | `.loom-ci/gate-status.toon` | Regenerated every run (ephemeral) | Regenerated |

### SharedCoreModule

Registry of `lib/` primitives, declared in `protocols/shared-core.schema.md`.

```toon
sharedCoreModules[4]{name,file,exports,bannedReimplementations}:
  toon,lib/toon.ts,"parseToon,serializeToon","hand-rolled TOON serializers"
  csv,lib/csv.ts,"splitCsvLine,joinCsvLine","local CSV splitters"
  atomic-fs,lib/atomic-fs.ts,"atomicWrite,atomicWriteText","copy-pasted atomicWrite"
  entry-guard,lib/entry-guard.ts,isMain,"top-level main() calls"
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| name | string | unique, kebab-case | required |
| file | string | path under `lib/` | must exist; only `lib/` may define these primitives |
| exports | string[] | ≥1 | every export typed in `lib/types.ts` |
| bannedReimplementations | string | description backing the `no-restricted-imports` lint rule | required |
| migratedCallers | string[] | file paths | appended during Phase 11a/11b strangler migration |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_module | name | PRIMARY | Module lookup |
| uq_export | exports[i] | UNIQUE | No two modules export the same symbol |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| SharedCoreModule | caller imports (hooks/**, scripts/**) | RESTRICT — lint fails if a module is removed while imported | Signature change requires all callers updated in the same phase |

### HookRegistrationManifest

Canonical source: `scripts/lib/loom-hooks-manifest.ts`. Drift report emitted to `.loom-ci/hook-drift.toon`.

```toon
hookRegistrations[N]{hookName,event,matcher,sources,registered,drift}:
  agent-result-validator,SubagentStop,,"settings|hooks.json|manifest",true,none
  context-budget,PreToolUse,Task,"settings|hooks.json|manifest",true,none
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| hookName | string | unique; matches `hooks/{hookName}.ts` | file must exist |
| event | enum | valid Claude Code hook event | `Write\|Edit` registration for context-budget is a known-inert drift (defect 10) |
| matcher | string \| null | tool-name matcher | — |
| sources | string | which of the 3 sources declare it | all three MUST agree after Phase 13 |
| registered | boolean | live in `.claude/settings.json` | — |
| drift | enum | `none` \| `missing-source` \| `event-mismatch` \| `dead-file` | any non-`none` fails the CI drift check (blocking after Phase 13) |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_hook | hookName | PRIMARY | Hook lookup |
| idx_event | event | INDEX | Per-event registration listing |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| hooks/{name}.ts | manifest row | Deleting a hook file requires removing all 3 registration entries in the same commit (drift check enforces) | Event change must propagate to all 3 sources |

### AgentResultFinding

One finding row inside an AgentResult envelope (`protocols/agent-result.schema.md`).

```toon
findings[N]{id,severity,category,confidence,summary}:
  F-01,blocking,security,0.92,"Shell injection via interpolated filename"
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| id | string | `F-\d{2,}` unique within envelope | required — validator blocks (exit 2) when missing |
| severity | enum | `blocking` \| `warning` \| `info` | required — blocking on absence |
| category | string | non-empty | required — blocking on absence |
| confidence | number | 0.0–1.0 | required for pipeline-participant agents (C-07/C-08); missing ⇒ MISSING_REQUIRED_FIELD, blocking |
| summary | string | ≤200 chars | optional fields beyond these warn only |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_finding | envelopeId, id | PRIMARY | Finding lookup within an envelope |
| idx_severity | severity | INDEX | Blocking-finding triage |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| AgentResult envelope | findings[] | Envelope rejection (validator exit 2) discards no data — envelope is re-emitted by the agent | Schema tier change (participant vs utility, C-07) re-classifies enforcement, not data |

### MetricsSnapshot

Repo-derived success metrics. Artifact: `planning/reports/metrics-snapshot.toon`.

```toon
metricsSnapshot:
  capturedAt: 2026-07-01T00:00:00Z
  gitRef: <commit sha>
  metrics[7]{metric,value,target,derivedBy,pass}:
    typecheck-errors,0,0,"tsc --noEmit -p hooks/tsconfig.json",true
    test-source-ratio,1.42,1.4,"bun scripts/metrics-snapshot.ts --metric ratio",true
    tautological-tests,0,0,"bun scripts/audit-tests.ts --count-remaining",true
    defects-closed,15,15,"defect-closure checklist in changelog",true
    ci-gates-green,true,true,"gh run list --workflow pr-gate.yml,nightly-gate.yml",true
    meta-tests-firing,1,1,"bunx vitest run tests/meta",true
    scorecard-overall,8.4,8.3,"bun scripts/scorecard-gate.ts --overall",true
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| capturedAt | string | ISO 8601 | required |
| gitRef | string | 40-char sha | must be an ancestor of `main` |
| metric | enum | one of the 7 pre-registered metric names | unknown metric names are blocking |
| value | scalar | number \| boolean | required; never hand-edited (derivation command is the source) |
| derivedBy | string | re-runnable command | required — no telemetry (C-12) |
| pass | boolean | value meets target | computed, not authored |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_metric | gitRef, metric | PRIMARY | One value per metric per snapshot |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| MetricsSnapshot | changelog metrics block | Changelog entry validation fails if snapshot deleted (METRICS_MISMATCH) | Snapshot regeneration requires changelog re-validation |
| ReleaseVersion | MetricsSnapshot | Snapshot retained (append-only history) | — |

### TautologicalTestAudit

Artifact: `planning/reports/test-audit.toon` (durable, re-runnable).

```toon
testAudit:
  auditedAt: 2026-07-01T00:00:00Z
  suspectCount: 0
  rows[N]{testPath,classification,evidence,action,replacedBy}:
    tests/commands/loom-prototype.test.ts,tautological,"reimplements completion-ceremony.ts",deleted,tests/backfill/completion-ceremony.test.ts
    tests/regressions/stuck-at-loop-construction.test.ts,prompt-grep,"asserts strings it constructs",deleted,
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| testPath | string | unique; repo-relative | file must have existed at auditedAt ref |
| classification | enum | `behavioral` \| `tautological` \| `prompt-grep` | required; 100% of suspects classified (F-12 convergence target) |
| evidence | string | non-empty | required for non-behavioral classifications |
| action | enum | `retained` \| `deleted` \| `backfilled` | see state machine; `behavioral` ⇒ `retained` |
| replacedBy | string \| null | path to backfill test | required when action=backfilled |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_test | testPath | PRIMARY | Classification lookup |
| idx_class | classification | INDEX | Feeds tautological-tests metric |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| TautologicalTestAudit | MetricsSnapshot.tautological-tests | Metric derivation fails (audit is its source) | Re-audit updates the metric on next snapshot |
| audit row (deleted) | test file | Test deletion recorded before file removal — audit row is the tombstone | — |

### ReleaseVersion

Artifacts: git `v*` tag + changelog section in `planning/history/changelog.md`. Schema: `protocols/release-versioning.schema.md`.

```toon
releaseVersion:
  semver: 1.1.0
  tagRef: refs/tags/v1.1.0
  milestone: M-02
  commitRange: v1.0.0..v1.1.0
  status: released
  metrics[N]{metric,value}:
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| semver | string | `\d+\.\d+\.\d+` | derived from conventional commits; version-gate CI enforces bump |
| tagRef | string | `refs/tags/v{semver}` | `v*` namespace contains ONLY semver tags after Phase 10 (defect 13) |
| milestone | string | `M-\d{2}` | tags are cut at milestone boundaries only (C-04) |
| commitRange | string | `{prevTag}..{tag}` | must be non-empty |
| status | enum | see ReleaseVersion state machine | — |
| metrics[] | table | pre-registered names only | filled from MetricsSnapshot, never prose estimates |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_release | semver | PRIMARY | Version lookup |
| uq_tag | tagRef | UNIQUE | One tag per version |
| idx_milestone | milestone | INDEX | Milestone → release mapping |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ReleaseVersion | InstallManifest | Yanked release keeps manifests (audit trail) but install.sh refuses its checksums | — |
| ReleaseVersion | changelog section | Tag deletion forbidden once `released` (move-only policy, refs/exec/* precedent) | — |
| plan-exec-* tags | refs/exec/* | MOVED, never deleted (irreversibility mitigation) | n/a |

### InstallManifest

Artifact: `~/.loom/install-manifest.toon`, written by `install.sh`.

```toon
installManifest:
  release: v1.1.0
  installedAt: 2026-07-01T00:00:00Z
  verified: true
  artifacts[N]{artifact,checksum,installedPath}:
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| release | string | `v` + semver | required |
| verified | boolean | true only when every artifact checksum matched `checksums.sha256` | fail-closed: unverifiable ⇒ abort + rollback, never warn-and-continue (defect 14) |
| artifacts[] | table | ≥1 row | checksum is sha256 hex, 64 chars |
| installedPath | string | absolute | rollback trap removes every recorded path on failure |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_install | release, artifact | PRIMARY | Artifact lookup for rollback |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| InstallManifest | installed files | Rollback (trap) deletes every `installedPath`; manifest written last, atomically | Re-install overwrites manifest after successful verification only |

### DocsGenerationManifest

Artifact: `docs/.generated-manifest.toon`, written by `scripts/generate-docs.ts`.

```toon
docsManifest:
  generatedAt: 2026-07-01T00:00:00Z
  sections[N]{section,targetFile,source,checksum,drift}:
    command-table,README.md,".claude/commands/*.md frontmatter",<sha256>,none
    hook-table,README.md,scripts/lib/loom-hooks-manifest.ts,<sha256>,none
    agent-model-tiers,docs/reference/agents.md,"agents/*.md frontmatter",<sha256>,none
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| section | string | unique; matches `<!-- loom:generated:{section} -->` markers in target | markers must exist in target file |
| targetFile | string | repo-relative | narrative prose outside markers is never touched (C-05) |
| source | string | derivation source description | required |
| checksum | string | sha256 of generated block | drift check recomputes and compares |
| drift | enum | `none` \| `stale` | `stale` fails CI (blocking after Phase 16) |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_section | section | PRIMARY | Section lookup |
| idx_target | targetFile | INDEX | Per-file drift reporting |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| source metadata (frontmatter/manifest) | generated section | Removing a command/hook regenerates the table minus that row | Any source change requires regeneration in the same PR (drift gate) |

### EvalTierResult

Artifact: `evals/results/{runId}.toon`. Schema: `protocols/eval-tier.schema.md`.

```toon
evalTierResult:
  runId: 2026-07-01-t1-8f3a
  tier: t1
  gitRef: <sha>
  status: passed
  llmCalls: 0
  floorRef:                                   # main-floor comparison, t3 only
  results[N]{evalId,outcome,score,judgedScore}:
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| runId | string | `{date}-{tier}-{shortsha}` unique | required |
| tier | enum | `t1` \| `t2` \| `t3` | t1: PR tier, free; t2: nightly, fixtured; t3: opt-in behind `LOOM_EVAL_LLM` (C-03) |
| status | enum | see EvalTierRun state machine | t3 with flag unset ⇒ `skipped`, exit 0, never blocks |
| llmCalls | integer | ≥0 | MUST be 0 for t1 and t2 (free-by-default invariant) |
| floorRef | string \| null | main-branch runId | required for t3 pre-release runs |
| judgedScore | number \| null | 0–10 | t3 only |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_run | runId | PRIMARY | Run lookup |
| idx_tier_ref | tier, gitRef | COMPOUND | Floor comparison against main |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| CiGateConfig | EvalTierResult | Results append-only; never pruned by gate config changes | — |
| EvalTierResult (main floor) | t3 comparison | Missing floor ⇒ EVAL_FLOOR_MISSING, t3 reports advisory-only | — |

### SkillUpgradeMatrix

Per-skill shard: `skills/upgrade-matrix/{skill}.toon` (sharded so parallel Wave-9 phases never share a file).

```toon
skillUpgrade:
  skill: loom-cso
  batch: review
  preambleRef: protocols/skill-preamble.md
  testsPresent: true
  enforcementWired: true
  beyondUpstream: "Adds decision-principles classification pass absent from gstack loom-think"
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| skill | string | unique; matches shard filename | required |
| batch | enum | `review` \| `workflow` \| `ops` | — |
| preambleRef | string | must equal `protocols/skill-preamble.md` | inline preamble >50 lines in the skill body is a blocking violation (C-06) |
| testsPresent | boolean | behavioral tests exist for backing scripts/hooks | required true for completion (C-13) |
| enforcementWired | boolean | claimed enforcement is registered/live | required true where the skill spec claims enforcement |
| beyondUpstream | string | non-empty, names a concrete capability | required — parity is not enough (C-13) |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_skill | skill | PRIMARY | Shard lookup |
| idx_batch | batch | INDEX | Batch completion check |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| skills/{skill}/ | upgrade-matrix shard | Removing a skill removes its shard in the same commit | — |
| SkillUpgradeMatrix | EvalTierResult | Upgraded skills exercised by eval runs; missing shard excludes skill from eval coverage report | — |

### ScorecardResult

Artifact: `planning/reports/scorecard-rerun.toon`; baseline pinned at `planning/reports/scorecard-baseline.toon`.

```toon
scorecard:
  runAt: 2026-07-01T00:00:00Z
  rubricRef: planning/reports/scorecard-baseline.toon
  agents[4]: <same 4 reviewer agents as baseline>
  status: pass
  overall: 8.4
  gstackOverall: 8.3
  dimensions[7]{dimension,loomScore,gstackScore,delta}:
    code-quality,8.5,8.0,0.5
    tests,9.0,9.0,0.0
```

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| rubricRef | string | must reference the pinned baseline rubric | re-run MUST use the identical rubric and agent set (C-09 anti-drift) |
| dimension | string | one of the 7 baseline dimensions | unknown dimension is blocking |
| loomScore / gstackScore | number | 0–10 | gstackScore copied from baseline, never re-scored |
| delta | number | loomScore − gstackScore | acceptance requires delta ≥ 0 for EVERY dimension |
| overall | number | 0–10 | acceptance requires overall > 8.3 |
| status | enum | see ScorecardGate state machine | `pass` only when both conditions hold |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_dim | runAt, dimension | PRIMARY | One score per dimension per run |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ScorecardResult | MetricsSnapshot.scorecard-overall | Metric derivation fails without the scorecard artifact | New run appends; prior runs retained for loop-back audit |
| ScorecardResult (fail) | responsible milestone | Loop-back: trailing dimension re-opens the mapped milestone's phases (see Error Handling) | — |

### Validation Rules

| Entity | Field | Rule | Error |
|--------|-------|------|-------|
| AgentResultFinding | confidence | required (participant agents), 0.0 ≤ x ≤ 1.0 | MISSING_REQUIRED_FIELD (blocking, exit 2) |
| MetricsSnapshot | derivedBy | non-empty re-runnable command | VALIDATION_ERROR |
| TautologicalTestAudit | classification | in enum {behavioral, tautological, prompt-grep} | VALIDATION_ERROR |
| ReleaseVersion | semver | matches `^\d+\.\d+\.\d+$`; tag namespace `v*` semver-only | TAG_NAMESPACE_POLLUTED |
| InstallManifest | checksum | 64-char sha256 hex, verified against checksums.sha256 | CHECKSUM_UNVERIFIABLE (fail-closed) |
| EvalTierResult | llmCalls | MUST be 0 when tier ∈ {t1, t2} | EVAL_TIER_CONTRACT_VIOLATION |
| SkillUpgradeMatrix | beyondUpstream | non-empty concrete capability | VALIDATION_ERROR |
| ScorecardResult | rubricRef | equals pinned baseline path | VALIDATION_ERROR |

## API Specification

This is a tooling repo — the "API" is the set of CLI entry points, script interfaces, and Claude Code hook contracts. Exit-code convention repo-wide: `0` success, `1` operational/validation failure, `2` blocking gate failure (matches Claude Code's hook-blocking semantics), `3` environment/integrity failure. All structured output is TOON on stdout; errors are TOON error records on stderr (see Error Handling Specification).

### lib/ module API (Phase 0 contract, Phases 2a/2b implementation)

**Description:** Neutral shared core (C-02) imported by both `hooks/` and `scripts/`. No CLI — library only.
**Auth:** n/a

| Export | Signature | Behavior |
|--------|-----------|----------|
| `parseToon` | `(text: string) => ToonValue` | Full TOON grammar per CLAUDE.md quick reference; throws `ToonParseError` with line/col |
| `serializeToon` | `(value: ToonValue) => string` | Canonical output: 2-space indent, stable key order; round-trips with `parseToon` |
| `splitCsvLine` | `(line: string, opts?: CsvSplitOptions) => string[]` | Handles quoted fields AND escaped `""` (the `hooks/lib/toon-reader.ts:125` miss); preserves quotes per `scripts/loom-change/archive.ts:1119` reference behavior |
| `joinCsvLine` | `(fields: string[]) => string` | Quotes/escapes inverse of `splitCsvLine` |
| `atomicWrite` | `(path: string, data: string \| Buffer) => void` | Write `{path}.tmp` then `fs.renameSync` — the single sanctioned implementation |
| `isMain` | `(importMeta: ImportMeta) => boolean` | Entry guard: true only when the module is the process entry point; works under both bun and node |

**Behavior notes:**
- ESLint `no-restricted-imports`/`no-restricted-syntax` bans reimplementations outside `lib/` (Phase 2b).
- Breaking signature changes require migrating all callers in the same phase (RESTRICT cascade).

### `bun scripts/ci/check-hook-drift.ts`

**Description:** Compares the three hook-registration sources (`.claude/settings.json`, `hooks/hooks.json`, `scripts/lib/loom-hooks-manifest.ts`) and fails on divergence.
**Auth:** none (CI + local)

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--report <path>` | string | no | `.loom-ci/hook-drift.toon` | Where to write the HookRegistrationManifest drift report |
| `--warn-only` | boolean | no | false | Report drift without failing (used between Phase 1 and Phase 13) |

**stdout:** drift report summary (TOON). **Exit codes:** `0` no drift; `1` drift detected (`HOOK_DRIFT_DETECTED`) unless `--warn-only`; `3` a source file is unreadable.

**Behavior notes:** ships in Phase 1 in `--warn-only` mode (sources are known-divergent, defect 10); Phase 13 reconciles the sources and flips the check to blocking.

### `bun scripts/ci/check-docs-drift.ts`

**Description:** Recomputes generated-docs section checksums against `docs/.generated-manifest.toon`.
**Auth:** none

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check` | boolean | no | true | Compare only, never write |
| `--warn-only` | boolean | no | false | Used between Phase 1 and Phase 16 |

**Exit codes:** `0` no drift; `1` `DOCS_DRIFT_DETECTED` naming each stale section; `3` manifest missing/unparseable.

### `bun scripts/ci/changed-files-vitest.ts`

**Description:** Maps the PR diff to test files (source→test naming convention + explicit test paths) and runs only those under vitest.
**Auth:** none

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--base <ref>` | string | no | `origin/main` | Diff base |
| `--dry-run` | boolean | no | false | Print resolved test list only |

**Exit codes:** `0` all resolved tests pass (or none resolved); `1` test failure; `3` git diff unavailable.

### `bun scripts/ci/check-library-catalog.ts`

**Description:** Validates `skills/library.yaml` (catalog_version, typed `includes:` resolution, kit integrity).
**Exit codes:** `0` valid; `1` `CATALOG_INVALID` with per-entry findings.

### `bun scripts/generate-docs.ts`

**Description:** Regenerates enumerable metadata sections (command table, hook count/table, agent model-tier table) between `<!-- loom:generated:{section} -->` markers from frontmatter + `scripts/lib/loom-hooks-manifest.ts` (C-05).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--write` | boolean | no | false | Rewrite target files atomically (.tmp + rename) |
| `--check` | boolean | no | true | Exit 1 if any section would change |
| `--section <name>` | string | no | all | Restrict to one section |

**Exit codes:** `0` clean/written; `1` drift in `--check` mode; `3` marker missing in a target file (`GENERATION_MARKER_MISSING`).

**Behavior notes:** never touches content outside markers (narrative prose stays hand-authored); writes `docs/.generated-manifest.toon` with per-section checksums.

### `bun scripts/loom-release.ts`

**Description:** Milestone-boundary semver release (C-04): derives the bump from conventional commits since the last `v*` tag, writes the changelog section with pre-registered metric placeholders, and cuts the tag.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--milestone <M-NN>` | string | yes | — | Milestone being closed |
| `--dry-run` | boolean | no | false | Print derived version + changelog section without tagging |
| `--metrics <path>` | string | no | `planning/reports/metrics-snapshot.toon` | Snapshot to embed |

**Exit codes:** `0` released; `1` no conventional commits / derivation ambiguity (`VERSION_DERIVATION_FAILED`); `2` version-gate violation; `3` dirty tree or tag already exists.

### `bun scripts/ci/version-gate.ts`

**Description:** CI check: fails when a release-worthy change (feat/fix/BREAKING conventional commits touching shipped surfaces) lands at a milestone boundary without a version bump.
**Exit codes:** `0` gate satisfied; `1` `VERSION_GATE_FAILED` naming the unversioned commits.

### `bun scripts/ci/migrate-exec-tags.ts`

**Description:** Moves the 17 `plan-exec-*` tags out of the `v*`-adjacent namespace into `refs/exec/*`. **Move, never delete** — irreversibility mitigation.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--execute` | boolean | no | false | Default is dry-run listing the ref moves |
| `--push` | boolean | no | false | Push `refs/exec/*` and tag deletions to origin after local move |

**Exit codes:** `0` migrated (or dry-run clean); `1` `TAG_MIGRATION_CONFLICT` (target ref exists); `3` git unavailable.

**Behavior notes:** each tag is copied to `refs/exec/{name}` and verified (`git rev-parse`) BEFORE the `plan-exec-*` ref is removed; aborts mid-run leave both refs in place (idempotent re-run).

### `install.sh`

**Description:** Loom installer, hardened fail-closed (defect 14, `install.sh:296`).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <name>` | string | no | stable | Release channel |
| `--no-verify` | boolean | no | — | REMOVED — no integrity bypass exists (fail-closed) |

**Exit codes:** `0` installed + manifest written; `1` usage error; `3` `CHECKSUM_UNVERIFIABLE` (unfetchable or mismatched `checksums.sha256`) — aborts BEFORE writing anything, or triggers full trap rollback if mid-install.

**Behavior notes:** `trap 'rollback' ERR EXIT` removes every path recorded in the in-progress InstallManifest on failure; manifest is committed (atomic rename) only after all checksums verify.

### `bun scripts/audit-tests.ts`

**Description:** Tautological-test audit (C-11 first half): classifies suspect tests behavioral/tautological/prompt-grep into `planning/reports/test-audit.toon`.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--suspects <glob>` | string | no | heuristic scan | Restrict the suspect set |
| `--count-remaining` | boolean | no | false | Print count of tautological/prompt-grep tests still in the suite (metric source) |
| `--write` | boolean | no | false | Persist the audit report atomically |

**Exit codes:** `0` all suspects classified; `1` unclassified suspects remain; `--count-remaining` prints the integer and exits 0.

### `bun scripts/eval/run-evals.ts`

**Description:** Eval tier ladder runner (C-03).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--tier <t1\|t2\|t3>` | string | yes | — | Tier to run |
| `--floor <runId>` | string | no | latest main run | t3 regression floor reference |
| `--out <dir>` | string | no | `evals/results/` | EvalTierResult output dir |

**Environment:** `LOOM_EVAL_LLM` — t3 runs ONLY when set; unset ⇒ status `skipped`, exit `0`, never blocks (C-03).

**Exit codes:** `0` tier passed or t3 skipped/advisory; `1` t1/t2 eval failure or `EVAL_FIXTURE_MISSING`; t3 NEVER exits non-zero on judged-score grounds (advisory: floor regression is reported as `EVAL_FLOOR_REGRESSION` warning in the result record).

**Behavior notes:** t1/t2 make zero network/LLM calls (asserted in-process: any attempted LLM call under t1/t2 is `EVAL_TIER_CONTRACT_VIOLATION`, exit 1). t2 replays fixtured LLM I/O from `evals/fixtures/`.

### `bun scripts/metrics-snapshot.ts`

**Description:** Derives all seven success metrics from repo state into `planning/reports/metrics-snapshot.toon` (C-09, no telemetry).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--metric <name>` | string | no | all | Derive a single metric (e.g. `ratio`) |
| `--check` | boolean | no | false | Compare fresh derivation against the committed snapshot; fail on mismatch |
| `--write` | boolean | no | false | Persist snapshot atomically |

**Exit codes:** `0` derived/matching; `1` `METRICS_MISMATCH` in `--check` mode; `3` a derivation command failed to run.

### `bun scripts/scorecard-gate.ts`

**Description:** Evaluates the re-run 4-agent comparative review (F-25): loads `planning/reports/scorecard-rerun.toon` against the pinned baseline and applies the acceptance rule.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--rerun <path>` | string | no | `planning/reports/scorecard-rerun.toon` | Re-run scorecard |
| `--baseline <path>` | string | no | `planning/reports/scorecard-baseline.toon` | Pinned baseline (rubric + gstack scores) |
| `--overall` | boolean | no | false | Print the overall score only |

**Exit codes:** `0` acceptance pass (every dimension delta ≥ 0 AND overall > 8.3); `2` `SCORECARD_BELOW_TARGET` — stderr names every trailing dimension and its responsible milestone (loop-back input); `1` malformed/missing scorecard artifacts.

### Hook: `hooks/agent-result-validator.ts` (Claude Code hook protocol)

**Description:** Validates AgentResult envelopes emitted by pipeline-participant subagents (C-07/C-08). Fixed from the `runHook(main)` no-op at line 155 to the harness signature `runHook("agent-result-validator", handler)`.
**Registration:** `.claude/settings.json` → `SubagentStop` (all three registration sources per Phase 13).

**stdin (JSON per Claude Code hook spec):** the standard `SubagentStop` payload; the handler extracts the agent's final-message AgentResult TOON block.

**stdout/exit contract:**
| Condition | Exit code | stdout/stderr |
|-----------|-----------|---------------|
| Envelope valid | 0 | silent |
| Utility agent (exempt tier, C-07) | 0 | silent |
| Missing OPTIONAL field | 0 | warning line on stderr (`OPTIONAL_FIELD_MISSING`) |
| Missing REQUIRED field (id, severity, category, confidence for participants) | 2 | stderr names the field (`MISSING_REQUIRED_FIELD`) — blocking per Claude Code protocol and `agent-result.schema.md` |
| Envelope unparseable | 2 | `VALIDATION_ERROR` with parse location |

**Behavior notes:** hook stdin/stdout follows Claude Code's JSON protocol (CLAUDE.md exception to TOON-everywhere); the validator's own diagnostics on stderr are plain lines prefixed with the error code.

### Hooks: existing live hooks (context-budget, budget-tracker, file-ownership, deploy-guard)

No interface changes in this plan. Phase 13 corrects context-budget's registration event (currently inert under `Write|Edit` in `hooks/hooks.json`) and renames `hooks/context-budget-test.ts` → `hooks/context-budget-check.ts`; stdin/stdout contracts are unchanged.

## State Machines

### EvalTierResult status

```
pending ──→ running ──→ passed
               │  │
               │  └────→ failed
               │
skipped ←──────┘   (t3 with LOOM_EVAL_LLM unset; terminal)
running ───────────────→ error   (fixture/infra fault; terminal)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| pending | Run record created, tier resolved | Default on creation by `run-evals.ts` |
| running | Evals executing | Tier preconditions met (t3: flag set) |
| skipped | t3 not attempted | `LOOM_EVAL_LLM` unset at dispatch — terminal |
| passed | All evals in tier passed (t3: advisory score recorded) | Last eval completes green — terminal |
| failed | ≥1 t1/t2 eval failed | Any eval failure — terminal |
| error | Infra fault (missing fixture, runner crash) | `EVAL_FIXTURE_MISSING` etc. — terminal |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| pending | running | `run-evals.ts --tier tN` dispatch | runId allocated |
| pending | skipped | t3 dispatch with flag unset | result written with `llmCalls: 0`, exit 0 |
| running | passed | all evals green | EvalTierResult written atomically; t3 also writes floor delta |
| running | failed | any t1/t2 eval red | exit 1; nightly gate reports failure |
| running | error | fixture missing / runner exception | exit 1 with error code |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| skipped | running | EVAL_TIER_CONTRACT_VIOLATION | A skipped t3 run is terminal; start a new run |
| failed | passed | EVAL_TIER_CONTRACT_VIOLATION | Results are immutable; re-run produces a new runId |
| passed | * | EVAL_TIER_CONTRACT_VIOLATION | Terminal state |

### ReleaseVersion status

```
draft ──→ gated ──→ tagged ──→ released
            │                     │
            └──→ rejected         └──→ yanked
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| draft | Version derived from conventional commits, changelog section drafted | `loom-release.ts --dry-run` — default on creation |
| gated | Version-gate CI evaluating the bump | `version-gate.ts` run on the release PR |
| rejected | Gate failed (missing bump / derivation ambiguity) | `VERSION_GATE_FAILED` — terminal for this attempt |
| tagged | `v{semver}` tag created locally | Gate passed, `loom-release.ts` executes |
| released | Tag pushed; release.yml produced changelog + tarball artifacts | release.yml run success — terminal |
| yanked | Release withdrawn; tag retained, installs refused | Maintainer action — terminal |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| draft | gated | Release PR opened | version-gate check runs |
| gated | tagged | `loom-release.ts --milestone M-NN` | tag created; changelog header written with metric placeholders |
| gated | rejected | version-gate exit 1 | stderr lists unversioned commits |
| tagged | released | release.yml completes | tarball artifact + checksums.sha256 published; MetricsSnapshot pinned |
| released | yanked | maintainer yanks | InstallManifest verification refuses the release's checksums |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| draft | tagged | VERSION_GATE_FAILED | Cannot tag without passing the version gate |
| released | tagged | TAG_MIGRATION_CONFLICT | Released tags are immutable; cut a new patch version |
| yanked | released | VALIDATION_ERROR | Yank is terminal; re-release under a new version |

### TautologicalTestAudit classification (per test row)

```
suspect ──→ behavioral (retained; terminal)
   │
   ├──→ tautological ──→ deleted ──→ backfilled
   │                        │            (terminal)
   └──→ prompt-grep ────────┘  (deleted may be terminal when
                                 coverage is proven redundant)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| suspect | Flagged by heuristic scan or manual list | `audit-tests.ts` enumeration — default |
| behavioral | Exercises real logic; kept | Classifier evidence — terminal |
| tautological | Reimplements/asserts its own construction | Classifier evidence recorded |
| prompt-grep | Greps prompt/source strings without behavior | Classifier evidence recorded |
| deleted | Removed from the suite | Deletion commit; audit row is the tombstone |
| backfilled | Replacement behavioral/property/meta test exists | `replacedBy` set — terminal |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| suspect | behavioral | classification with evidence | action=retained |
| suspect | tautological | classification with evidence | queued for deletion |
| suspect | prompt-grep | classification with evidence | queued for deletion |
| tautological | deleted | Phase 15 deletion pass | test file removed; audit row updated |
| prompt-grep | deleted | Phase 15 deletion pass | test file removed |
| deleted | backfilled | Phase 18 backfill lands `replacedBy` | coverage restored (C-11: delete + backfill, never delete alone when coverage regresses) |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| suspect | deleted | VALIDATION_ERROR | Cannot delete an unclassified test — classify first (C-11) |
| behavioral | deleted | VALIDATION_ERROR | Behavioral tests are retained |
| deleted | suspect | VALIDATION_ERROR | Tombstones are immutable; new tests start a new row |

### ScorecardResult status (acceptance gate)

```
pending ──→ evaluated ──→ pass (terminal)
                │
                └──→ below-target ──→ loop-back ──→ pending (new run)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| pending | Re-run scheduled with pinned rubric | Phase 25 dispatch — default |
| evaluated | All 4 agents scored all 7 dimensions | Review complete |
| pass | Every delta ≥ 0 AND overall > 8.3 | `scorecard-gate.ts` exit 0 — terminal (initiative accepted) |
| below-target | ≥1 dimension < gstack OR overall ≤ 8.3 | `scorecard-gate.ts` exit 2 |
| loop-back | Gap mapped to responsible milestone; remediation phases re-opened | Maintainer triage of trailing dimensions |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| pending | evaluated | 4-agent review completes | scorecard-rerun.toon written |
| evaluated | pass | gate exit 0 | MetricsSnapshot.scorecard-overall recorded; Phase 26 unblocked |
| evaluated | below-target | gate exit 2 | stderr names trailing dimensions + responsible milestones |
| below-target | loop-back | maintainer triage | remediation work re-enters the mapped milestone's phases; plan stays `in-progress` |
| loop-back | pending | remediation merged | a NEW re-run (new runAt) is scheduled; prior results retained |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| below-target | pass | SCORECARD_BELOW_TARGET | The gate cannot be overridden; remediate and re-run |
| evaluated | pending | VALIDATION_ERROR | Evaluated runs are immutable; loop-back schedules a new run |

## Error Handling Specification

### Error Record Format

CLI scripts and hooks emit a consistent TOON error record on **stderr** (hook stdin/stdout stays JSON per Claude Code protocol; only Loom's own diagnostics use this shape):

```toon
error:
  code: DOCS_DRIFT_DETECTED
  message: Generated section 'hook-table' is stale in README.md
  details:
    section: hook-table
    expectedChecksum: <sha256>
    actualChecksum: <sha256>
```

### Error Categories

| Code | Exit code | Emitted by | When Used | Retryable |
|------|-----------|------------|-----------|-----------|
| VALIDATION_ERROR | 1 | all scripts | Malformed input/artifact (bad TOON, unknown enum) | No — fix the input |
| MISSING_REQUIRED_FIELD | 2 | agent-result-validator | Participant envelope lacks id/severity/category/confidence | No — agent re-emits |
| OPTIONAL_FIELD_MISSING | 0 (warn) | agent-result-validator | Optional envelope field absent | n/a — advisory |
| HOOK_DRIFT_DETECTED | 1 | check-hook-drift.ts | The 3 registration sources disagree | No — reconcile sources |
| DOCS_DRIFT_DETECTED | 1 | check-docs-drift.ts / generate-docs.ts --check | Generated section stale vs sources | No — run `generate-docs.ts --write` |
| GENERATION_MARKER_MISSING | 3 | generate-docs.ts | Target file lacks `<!-- loom:generated:* -->` markers | No — restore markers |
| CATALOG_INVALID | 1 | check-library-catalog.ts | `skills/library.yaml` fails schema/kit resolution | No |
| TYPECHECK_FAILED | 1 | pr-gate (tsc step) | Any tsc error under hooks tsconfig | No |
| VERSION_GATE_FAILED | 1 | version-gate.ts | Release-worthy change without version bump | No — bump or amend |
| VERSION_DERIVATION_FAILED | 1 | loom-release.ts | No/ambiguous conventional commits since last tag | No — fix commit messages |
| TAG_NAMESPACE_POLLUTED | 1 | version-gate.ts | Non-semver tag found in `v*` after Phase 10 | No — migrate the tag |
| TAG_MIGRATION_CONFLICT | 1 | migrate-exec-tags.ts | `refs/exec/{name}` already exists with different sha | No — manual resolution; source tag left intact |
| CHECKSUM_UNVERIFIABLE | 3 | install.sh | `checksums.sha256` unfetchable or mismatched | Yes — transient network; install is fully rolled back either way |
| ROLLBACK_FAILED | 3 | install.sh trap | A recorded path could not be removed during rollback | No — stderr lists residual paths for manual cleanup |
| EVAL_FIXTURE_MISSING | 1 | run-evals.ts (t2) | Hermetic fixture absent for a configured eval | No — record or restore the fixture |
| EVAL_TIER_CONTRACT_VIOLATION | 1 | run-evals.ts | LLM call attempted under t1/t2, or illegal state transition | No |
| EVAL_FLOOR_REGRESSION | 0 (warn) | run-evals.ts (t3) | Judged score below `main` floor | n/a — advisory, never merge-blocking (C-03) |
| EVAL_FLOOR_MISSING | 0 (warn) | run-evals.ts (t3) | No main-branch floor run available | n/a — advisory |
| METRICS_MISMATCH | 1 | metrics-snapshot.ts --check | Changelog/committed snapshot disagrees with fresh derivation | No — regenerate |
| SCORECARD_BELOW_TARGET | 2 | scorecard-gate.ts | Any dimension < gstack or overall ≤ 8.3 | No — loop-back (see below) |
| REPO_SCOPE_VIOLATION | 1 | loom-version-slot.ts | Worktree from a foreign repo would enter the slot registry | No — filtered out (defect 3) |

### Field-Level Validation Errors

When `code: VALIDATION_ERROR`, `details.fields` maps field → message:

```toon
error:
  code: VALIDATION_ERROR
  message: EvalTierResult failed schema validation
  details:
    fields:
      llmCalls: MUST be 0 for tier t1
      runId: required
```

### Failure Modes by Phase (enumerated)

| Failure mode | Phases at risk | Detection | Mitigation / recovery path |
|--------------|----------------|-----------|---------------------------|
| CI gate false-positive (drift/docs checks fire on legitimate change) | 1, 13, 16 | Check fails on a PR that did regenerate correctly | Checks ship `--warn-only` until their remediation phase lands (hook-drift → Phase 13, docs-drift → Phase 16); false-positive root-caused via the published `.loom-ci/*.toon` report before flipping to blocking; a planted-defect meta-test (Phase 18) proves each gate fires for true positives |
| Changed-file test mapping misses a affected test | 1 | Nightly full suite catches what the PR tier missed | Nightly failure auto-files the mapping gap; mapping rule extended; full suite remains the nightly backstop (C-01) |
| Flaky test blocks the PR gate | 1, 14a–19 | Repeated non-deterministic failure on unrelated PRs | **Flake quarantine path:** move the spec to `tests/quarantine/**` (excluded from PR tier, still run nightly with `continue-on-error`), file it in the Phase 19 deflake worklist; quarantine entries MUST be zero before `fileParallelism:false` is removed |
| Dedup migration regresses a primitive used everywhere | 11a, 11b | lib round-trip/property tests (Phases 2a/2b) + full nightly suite | Strangler order: migrate one caller group per commit; `no-restricted-imports` prevents new divergence; revert granularity is one caller group |
| Typecheck fixes change runtime behavior | 9 | Behavioral tests from Phases 3–8 + nightly suite | F-06 constraint: type-only edits; any fix requiring logic change is split into its own reviewed commit |
| Tag cleanup is irreversible | 10 | — | **Move, not delete:** every `plan-exec-*` tag is copied to `refs/exec/*` and verified via `git rev-parse` before the old ref is removed; `--execute` is opt-in (default dry-run); a pre-migration `git bundle` of all refs is written to `planning/reports/tag-backup.bundle` |
| install.sh rollback leaves partial state | 8 | Simulated mid-install failure test | Trap-based rollback removes every recorded path; `ROLLBACK_FAILED` lists residuals; manifest committed only post-verification so a crashed install is detectable |
| Tautological-test deletion drops real coverage | 15, 18 | test:source ratio metric + audit `replacedBy` completeness | C-11 pairing: deletion (Phase 15) and backfill (Phase 18) are sequenced waves; the final ratio metric (≥1.4:1) gates M-04 acceptance |
| Deflake stalls (~39 load-sensitive failures resist isolation) | 19 | Repeated nightly parallel-mode trial runs | `fileParallelism` removal is gated behind 5 consecutive green parallel nightly runs; until then the workaround stays and the suite remains serial-but-green (roadmap risk #1) |
| Eval fixtures drift from live behavior | 20 | t2 failures on unchanged code | Fixtures are versioned with the code; fixture refresh is a reviewed change; t3 (opt-in) cross-checks judged quality pre-release |
| Scorecard re-run scores below target | 25 | `scorecard-gate.ts` exit 2 | **Loop-back:** gate output names each trailing dimension and its responsible milestone (code-quality→M-02/M-03, tests→M-04, extensibility→M-08, ops→M-05/M-06/M-07); remediation re-enters that milestone's phases; a NEW re-run is scheduled; the plan stays `in-progress` — acceptance cannot be overridden (C-09) |
| Scorecard rubric drift makes scores incomparable | 25 | rubricRef mismatch | Baseline rubric + agent set pinned in `planning/reports/scorecard-baseline.toon` (Phase 25 deliverable); gate refuses a rerun whose rubricRef differs |

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| Network fetch in install.sh (checksums, tarball) | 3 attempts, backoff 1s/2s/4s, then fail-closed | 3 |
| CI transient infra (runner death) | GitHub Actions re-run; no in-script retry | 1 |
| t3 LLM-judge call failure | Retry once, then mark run `error` (advisory — never blocks) | 1 |
| All validation/gate failures (exit 1/2) | Never retried — fix the input | 0 |

## Configuration Specification

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| LOOM_EVAL_LLM | string (API key ref / "1") | — | no | Enables eval tier T3 (LLM-judge). Unset ⇒ T3 skipped, exit 0 (C-03) |
| LOOM_EVAL_FLOOR_REF | string | latest main runId | no | Override the t3 regression-floor run |
| CI | boolean | — | no | Set by GitHub Actions; drift checks default `--warn-only=false` under CI once blocking |
| LOOM_INSTALL_CHANNEL | string | stable | no | install.sh channel selection |
| LOOM_QUARANTINE_INCLUDE | boolean | false | no | Include `tests/quarantine/**` in a local run (nightly sets this) |

### Validation

- `LOOM_EVAL_LLM` is never read by t1/t2 code paths (asserted by test — free-by-default invariant).
- No configuration enables telemetry; there is no endpoint to configure (C-12).
- Secrets are never written into TOON artifacts; `EvalTierResult` records only `llmCalls` counts.

## Execution Phases

Wave map: W0 contracts/prefactor → W1 M-01 foundation → W2 M-02 critical fixes ∥ M-05 ops core → W3 typecheck-zero + release activation → W4 M-03 hygiene → W5 M-04 test work ∥ M-06 docs → W6–W7 test backfill/deflake → W8 M-07 evals ∥ F-22 preamble → W9 M-08 skill batches → W10–W11 M-09 acceptance. Milestone `dependsOn` is honored: M-09 phases run only after M-02/M-04/M-05/M-06/M-07/M-08 phases complete. Wave 2's fan-out of 6 parallel phases (3–8) is within the `maxParallelAgents = 6` cap configured in `.claude/orchestration.toml` (P-07: annotated, no restructure needed). Wave 8 merge order: Phase 20 lands first; Phase 21's `skills/library.yaml` edit merges after Phase 20 completes (P-09). Split phases (2a→2b, 14a→14b) are sequenced within their wave — each suffix pair shares no files and never runs concurrently.

### Phase 0 — Wave 0: Shared-surface contracts and prefactor gate

**Agent:** contracts-agent
**Objective:** Freeze the module boundaries every later wave depends on — `lib/` type contracts (C-02), CI gate/check-name contracts (C-01), and TOON schemas for all new artifacts — so parallel waves never negotiate shared-file shape mid-flight.
**Dependencies:** None
**File Ownership:** lib/types.ts, protocols/shared-core.schema.md, protocols/ci-gates.contract.md, protocols/eval-tier.schema.md, protocols/release-versioning.schema.md, protocols/metrics-snapshot.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| lib/types.ts | Create | contracts-agent |
| protocols/shared-core.schema.md | Create | contracts-agent |
| protocols/ci-gates.contract.md | Create | contracts-agent |
| protocols/eval-tier.schema.md | Create | contracts-agent |
| protocols/release-versioning.schema.md | Create | contracts-agent |
| protocols/metrics-snapshot.schema.md | Create | contracts-agent |

**Preflight (P-10):** before Wave 0 dispatch, verify `contracts-agent` (this phase) and `wiring-agent` (Phases 13/26) are registered in `.claude/orchestration.toml`; halt and register them if absent.

#### Acceptance Criteria
- [ ] `lib/types.ts` compiles standalone: `bunx tsc --noEmit lib/types.ts` exits 0 and exports ToonValue, CsvSplitOptions, AtomicWriteOptions, plus record types for all 12 schema entities
- [ ] `protocols/ci-gates.contract.md` enumerates both tiers with stable check names matching the CiGateConfig schema (branch-protection interface)
- [ ] `protocols/shared-core.schema.md` declares the four modules with export signatures matching the API Specification's lib/ table
- [ ] All four new protocol files define their artifacts in TOON (no JSON examples)

#### Scenarios

```toon
id: S-01
title: Shared-core contracts compile before any implementation exists
given[1]: Phase 0 deliverables are on disk and no lib/ implementation files exist yet
when: tsc --noEmit runs against lib/types.ts
whenTriggerType: system-event
then[2]: The command MUST exit 0, Every entity in the Schema section MUST have a corresponding exported type
tags[1]: happy-path
automatable: true
```

### Phase 1 — Wave 1: Tiered CI gate ladder (F-01)

**Agent:** implementer-agent
**Objective:** Stand up the PR-blocking and nightly workflows per C-01, closing defect 5 (no CI runs the vitest suite).
**Dependencies:** Phase 0
**File Ownership:** .github/workflows/pr-gate.yml, .github/workflows/nightly-gate.yml, scripts/ci/check-hook-drift.ts, scripts/ci/check-docs-drift.ts, scripts/ci/check-library-catalog.ts, scripts/ci/changed-files-vitest.ts, tests/ci/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| .github/workflows/pr-gate.yml | Create | implementer-1 |
| .github/workflows/nightly-gate.yml | Create | implementer-1 |
| scripts/ci/check-hook-drift.ts | Create | implementer-1 |
| scripts/ci/check-docs-drift.ts | Create | implementer-1 |
| scripts/ci/check-library-catalog.ts | Create | implementer-1 |
| scripts/ci/changed-files-vitest.ts | Create | implementer-1 |
| tests/ci/drift-checks.test.ts | Create | implementer-1 |
| tests/ci/changed-files-mapping.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] pr-gate.yml runs typecheck, lint, changed-file vitest, hook-drift, docs-drift, and library-catalog checks with the exact check names from `protocols/ci-gates.contract.md`
- [ ] A PR introducing a TypeScript error under hooks tsconfig produces a failed required check (tsc step exits non-zero)
- [ ] nightly-gate.yml has a cron schedule and runs the full vitest suite plus Docker e2e job
- [ ] hook-drift and docs-drift checks run in `--warn-only` mode (flipped to blocking in Phases 13 and 16 respectively) while typecheck/lint/changed-file/catalog checks are blocking immediately
- [ ] Both workflows publish `.loom-ci/gate-status.toon` as a machine-readable artifact
- [ ] `bunx vitest run tests/ci` exits 0

#### Convergence Targets
- PR-tier workflow exits non-zero when `tsc --noEmit` reports any error
- Nightly-tier workflow schedule triggers the full 1810-test suite
- `bun scripts/ci/check-library-catalog.ts` exits 0 against the current `skills/library.yaml`

#### Scenarios

Derived from F-01.S-01:

```toon
id: S-01
title: PR gate fails on a typecheck error
given[1]: A PR introduces a TypeScript error under the hooks tsconfig
when: The PR-tier CI workflow runs
whenTriggerType: system-event
then[2]: The tsc --noEmit step MUST exit non-zero, The workflow MUST report a failed required check
tags[1]: happy-path
automatable: true
```

### Phase 2a — Wave 1: Shared core parsers — TOON + CSV (F-02)

**Agent:** implementer-agent
**Objective:** Implement the parser half of the neutral `lib/` core — TOON parse/serialize and the correct CSV splitter — against the Phase 0 contracts (C-02). Split from the original Phase 2 (10 deliverables) per P-02; Phase 2b follows, sequenced within Wave 1.
**Dependencies:** Phase 0
**File Ownership:** lib/toon.ts, lib/csv.ts, tests/lib/toon-roundtrip.test.ts, tests/lib/csv.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| lib/toon.ts | Create | implementer-2 |
| lib/csv.ts | Create | implementer-2 |
| tests/lib/toon-roundtrip.test.ts | Create | implementer-2 |
| tests/lib/csv.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `splitCsvLine` passes cases: plain fields, quoted fields with commas, escaped `""` inside quoted fields (the `hooks/lib/toon-reader.ts:125` miss), and quote-preservation matching `scripts/loom-change/archive.ts:1119` reference behavior
- [ ] `serializeToon(parseToon(x))` round-trips for every fixture in tests/lib/toon-roundtrip.test.ts
- [ ] `bunx vitest run tests/lib/toon-roundtrip.test.ts tests/lib/csv.test.ts` exits 0

#### Convergence Targets
- The shared CSV splitter parses escaped `""` correctly (lib/ reference test suite green)

#### Scenarios

Derived from F-02.S-01:

```toon
id: S-01
title: Shared CSV splitter handles escaped double-quotes
given[1]: The shared lib CSV splitter is imported
when: It parses a field containing an escaped "" sequence
whenTriggerType: system-event
then[1]: The parsed field MUST preserve the embedded quote character
tags[1]: happy-path
automatable: true
```

### Phase 2b — Wave 1: Shared core writers, entry-guard, barrel, and lint ban (F-02)

**Agent:** implementer-agent
**Objective:** Implement the writer/shim half of `lib/` — atomic-fs, entry-guard, the `lib/index.ts` barrel — and the `no-restricted-imports` lint ban on local reimplementations (C-02). Sequenced after Phase 2a within Wave 1 (2a→2b ordering, no shared files, per P-02).
**Dependencies:** Phase 0, Phase 2a
**File Ownership:** lib/atomic-fs.ts, lib/entry-guard.ts, lib/index.ts, eslint.config.js, tests/lib/atomic-fs.test.ts, tests/lib/entry-guard.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| lib/atomic-fs.ts | Create | implementer-2 |
| lib/entry-guard.ts | Create | implementer-2 |
| lib/index.ts | Create | implementer-2 |
| eslint.config.js | Modify | implementer-2 |
| tests/lib/atomic-fs.test.ts | Create | implementer-2 |
| tests/lib/entry-guard.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `atomicWrite` writes `{path}.tmp` then renames; a killed process leaves either the old file or the new file, never a partial (asserted by test)
- [ ] `isMain(import.meta)` returns true under `bun lib/entry-guard.ts` direct execution and false under import (both runtimes tested where available)
- [ ] `bunx eslint .` exits non-zero when a fixture file reimplements a banned CSV/TOON/atomic-fs primitive outside `lib/`
- [ ] Importing `lib/index.ts` from both a hook and a script resolves without duplication

#### Convergence Targets
- Importing `lib/` from both a hook and a script resolves without duplication
- Lint exits non-zero when a file reimplements a banned CSV/TOON/atomic-fs primitive

#### Scenarios

Authored for F-02 (split coverage; no additional upstream roadmap scenario):

```toon
id: S-01
title: Lint bans a local primitive reimplementation outside lib/
given[1]: A fixture file reimplements a banned CSV/TOON/atomic-fs primitive outside lib/
when: bunx eslint . runs with the no-restricted-imports ban active
whenTriggerType: system-event
then[1]: Lint MUST exit non-zero naming the banned reimplementation
tags[1]: error
automatable: true
```

### Phase 3 — Wave 2: agent-result-validator fix, registration, blocking enforcement (F-03)

**Agent:** implementer-agent
**Objective:** Repair the silent no-op at `hooks/agent-result-validator.ts:155` (`runHook(main)` → `runHook("agent-result-validator", handler)`), register the hook, and make it blocking on required fields / warn-only on optional fields (C-08, defect 1).
**Dependencies:** Phase 1, Phase 2a, Phase 2b
**File Ownership:** hooks/agent-result-validator.ts, .claude/settings.json, tests/hooks/agent-result-validator*

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/agent-result-validator.ts | Modify | implementer-1 |
| .claude/settings.json | Modify | implementer-1 |
| tests/hooks/agent-result-validator.test.ts | Create | implementer-1 |
| tests/hooks/agent-result-validator-blocking.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `hooks/agent-result-validator.ts:155` region calls `runHook("agent-result-validator", handler)` matching the harness signature in `hooks/lib/run-hook.ts`
- [ ] The hook is registered in `.claude/settings.json` on SubagentStop and executes when fed a hook payload on stdin
- [ ] An AgentResult missing a required field (id, severity, category, confidence) exits 2 with stderr naming the field
- [ ] An AgentResult missing only optional fields exits 0 with a stderr warning
- [ ] `bunx vitest run tests/hooks/agent-result-validator.test.ts tests/hooks/agent-result-validator-blocking.test.ts` exits 0

#### Convergence Targets
- The validator exits non-zero for an AgentResult missing a required field
- The validator exits zero with a warning for an AgentResult missing only an optional field

#### Scenarios

Derived from F-03.S-01:

```toon
id: S-01
title: Validator blocks an envelope missing a required field
given[1]: The agent-result-validator hook is registered and active
when: An AgentResult missing a required field is submitted
whenTriggerType: system-event
then[2]: The hook MUST exit non-zero, The hook MUST name the missing required field
tags[1]: error
automatable: true
```

### Phase 4 — Wave 2: Shell-injection remediation in loom-health (F-04)

**Agent:** implementer-agent
**Objective:** Convert `scripts/loom-health.ts:238` (interpolated shellcheck filenames) to `execFileSync` argv arrays per the house pattern at `hooks/deploy-guard.ts:166-201` (defect 2, site 1). The companion site at `loom-version-slot.ts:147` is fixed in Phase 5, which owns that file this wave.
**Dependencies:** Phase 1
**File Ownership:** scripts/loom-health.ts, tests/scripts/loom-health-exec.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-health.ts | Modify | implementer-2 |
| tests/scripts/loom-health-exec.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `scripts/loom-health.ts:238` region uses `execFileSync` with an argv array; no filename is interpolated into a shell string
- [ ] A test proves a filename containing `;`, `$(...)`, and backticks is passed as a literal argument and no injected command executes
- [ ] `grep -n 'execSync' scripts/loom-health.ts` finds no interpolated-filename invocation

#### Convergence Targets
- A crafted filename containing `;` or `$(...)` does not execute an injected command

#### Scenarios

Derived from F-04.S-01:

```toon
id: S-01
title: Malicious filename does not trigger shell injection
given[1]: loom-health scans a file whose name contains shell metacharacters
when: The shellcheck invocation runs via execFileSync
whenTriggerType: system-event
then[2]: The metacharacters MUST be passed as a literal argument, No injected subcommand MUST execute
tags[1]: error
automatable: true
```

### Phase 5 — Wave 2: version-slot security and cross-repo scoping (F-05 + F-04 second site)

**Agent:** implementer-agent
**Objective:** In `scripts/loom-version-slot.ts`: convert the `:147` `execSync git rev-parse` branch-name interpolation to `execFileSync` argv (F-04 site 2), and apply the repo-scoping filter from `scripts/loom-worktree-scan.ts:421` to the `:231-246` registry write so foreign-repo worktrees are excluded (F-05, defect 3).
**Dependencies:** Phase 1
**File Ownership:** scripts/loom-version-slot.ts, tests/scripts/loom-version-slot-security.test.ts, tests/scripts/loom-version-slot-scope.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-version-slot.ts | Modify | implementer-3 |
| tests/scripts/loom-version-slot-security.test.ts | Create | implementer-3 |
| tests/scripts/loom-version-slot-scope.test.ts | Create | implementer-3 |

#### Acceptance Criteria
- [ ] `loom-version-slot.ts:147` region passes branch names as `execFileSync` argv, never through a shell; a metacharacter branch name is treated literally (test)
- [ ] The `:231-246` registry write filters worktrees by git common-dir to the current repo, matching the `loom-worktree-scan.ts:421` filter
- [ ] With fixtures for two distinct repos on disk, the slot registry contains only the current repo's worktrees
- [ ] `bunx vitest run tests/scripts/loom-version-slot-security.test.ts tests/scripts/loom-version-slot-scope.test.ts` exits 0

#### Convergence Targets
- The slot registry contains only worktrees whose git common-dir resolves to the current repo

#### Scenarios

Derived from F-05.S-01:

```toon
id: S-01
title: Version-slot excludes unrelated-repo worktrees
given[1]: The machine has worktrees from two distinct repos
when: loom-version-slot scans and records worktrees
whenTriggerType: system-event
then[1]: The registry MUST contain only worktrees belonging to the current repo
tags[1]: edge-case
automatable: true
```

### Phase 6 — Wave 2: AgentResult schema reconciliation and tiered mandate (F-07)

**Agent:** implementer-agent
**Objective:** Resolve the `agent-result.schema.md:91` blocking-vs-warn contradiction in favor of blocking (per C-08, implemented in Phase 3), and document the tiered mandate (pipeline participants required, utility agents exempt) with a conformance test (C-07, defect 11).
**Dependencies:** Phase 1
**File Ownership:** protocols/agent-result.schema.md, tests/protocols/agent-result-conformance.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/agent-result.schema.md | Modify | implementer-4 |
| tests/protocols/agent-result-conformance.test.ts | Create | implementer-4 |

#### Acceptance Criteria
- [ ] `agent-result.schema.md` line-91 region states missing `confidence` on a participant envelope is BLOCKING, with no contradictory warn-only language remaining
- [ ] The schema documents the tiered mandate: pipeline-participant agents (stage teammates, reviewers, executors, converge drivers) MUST emit the envelope; standalone/utility agents are exempt
- [ ] The conformance test rejects a participant envelope omitting `confidence` and accepts a utility-agent output without an envelope
- [ ] `bunx vitest run tests/protocols/agent-result-conformance.test.ts` exits 0

#### Convergence Targets
- Conformance test fails a participant AgentResult that omits `confidence`

#### Scenarios

Derived from F-07.S-01:

```toon
id: S-01
title: Conformance test rejects participant envelope missing confidence
given[1]: A pipeline-participant agent emits an AgentResult with a finding lacking confidence
when: The conformance test validates the envelope
whenTriggerType: system-event
then[1]: The test MUST fail the envelope as non-conforming
tags[1]: error
automatable: true
```

### Phase 7 — Wave 2: Milestone semver, version-gate CI, metric-bearing changelog (F-15)

**Agent:** implementer-agent
**Objective:** Introduce milestone-boundary semver tagging derived from conventional commits, a version-gate CI check, and semver headers with pre-registered repo-derivable metrics in `planning/history/changelog.md` (C-04, defect 13 core).
**Dependencies:** Phase 0
**File Ownership:** scripts/loom-release.ts, scripts/ci/version-gate.ts, .github/workflows/version-gate.yml, planning/history/changelog.md, tests/scripts/loom-release.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-release.ts | Create | implementer-5 |
| scripts/ci/version-gate.ts | Create | implementer-5 |
| .github/workflows/version-gate.yml | Create | implementer-5 |
| planning/history/changelog.md | Modify | implementer-5 |
| tests/scripts/loom-release.test.ts | Create | implementer-5 |

#### Acceptance Criteria
- [ ] `bun scripts/loom-release.ts --milestone M-01 --dry-run` derives a semver bump from conventional commits and prints the changelog section with the seven pre-registered metric placeholders
- [ ] A milestone-close run (test fixture repo) produces a `vX.Y.Z` tag and a matching changelog semver header
- [ ] `version-gate.ts` exits 1 when a fixture history contains release-worthy commits at a milestone boundary without a bump
- [ ] `planning/history/changelog.md` gains semver section headers conforming to `protocols/release-versioning.schema.md`
- [ ] `bunx vitest run tests/scripts/loom-release.test.ts` exits 0

#### Convergence Targets
- A milestone-close run produces a new `vX.Y.Z` tag and a matching changelog header

#### Scenarios

Derived from F-15.S-01:

```toon
id: S-01
title: Milestone close cuts a semver tag and changelog entry
given[1]: A milestone's conventional commits are ready to release
when: The release tooling runs at the milestone boundary
whenTriggerType: system-event
then[2]: A semver vX.Y.Z tag MUST be created, The changelog MUST gain a matching semver header carrying the seven pre-registered metric placeholders (real repo-derived values are filled at Phase 26 per F-26)
tags[1]: happy-path
automatable: true
```

### Phase 8 — Wave 2: Fail-closed install integrity with rollback (F-17)

**Agent:** implementer-agent
**Objective:** Make `install.sh:296` integrity verification fail-closed (abort on unverifiable `checksums.sha256` instead of warn-and-continue) and add trap-based rollback of partial installs (defect 14).
**Dependencies:** Phase 0
**File Ownership:** install.sh, tests/install/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| install.sh | Modify | implementer-6 |
| tests/install/install-integrity.test.ts | Create | implementer-6 |
| tests/install/install-rollback.test.ts | Create | implementer-6 |

#### Acceptance Criteria
- [ ] With `checksums.sha256` unfetchable (mocked HTTP failure), `install.sh` exits 3 and installs nothing
- [ ] With a mismatched checksum, `install.sh` exits 3 and the trap removes every partially installed path (post-condition: no artifacts on disk)
- [ ] The happy path (valid checksums) installs unchanged and writes `~/.loom/install-manifest.toon` with `verified: true` via atomic rename
- [ ] `bunx vitest run tests/install` exits 0 (tests drive install.sh in a sandbox HOME)

#### Convergence Targets
- `install.sh` exits non-zero when checksums cannot be verified
- After a simulated mid-install failure, no partial artifacts remain

#### Scenarios

Derived from F-17.S-01:

```toon
id: S-01
title: Install aborts and rolls back on unverifiable checksums
given[1]: checksums.sha256 is unfetchable during install
when: install.sh reaches the integrity verification step
whenTriggerType: system-event
then[2]: The installer MUST exit non-zero, Any partially installed artifacts MUST be rolled back
tags[1]: error
automatable: true
```

### Phase 9 — Wave 3: Typecheck to zero errors (F-06)

**Agent:** implementer-agent
**Objective:** Drive `tsc --noEmit -p hooks/tsconfig.json` from 49 errors to 0 with type-only edits (no runtime behavior change), including removing the dead `.action` read at `scripts/loom-first-run.ts:15`, so the Phase 1 typecheck gate goes green (defect 4).
**Dependencies:** Phase 3, Phase 4, Phase 5
**File Ownership:** hooks/** and scripts/** (type-only edits), EXCLUDING scripts/generate-changelog.ts, scripts/build-release-tarball.ts, and .github/** (owned by Phase 10 this wave)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-first-run.ts | Modify | implementer-1 |
| hooks/** (type-only fixes across error sites) | Modify | implementer-1 |
| scripts/** (type-only fixes, excluding Phase-10-owned files) | Modify | implementer-1 |
| hooks/tsconfig.json | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] `bunx tsc --noEmit -p hooks/tsconfig.json` exits 0 with zero reported errors
- [ ] The dead `.action` read at `scripts/loom-first-run.ts:15` is removed
- [ ] `bunx vitest run` (full suite) passes identically before and after — no runtime behavior change from type fixes
- [ ] Any fix that would require a logic change is split out and flagged in the phase summary rather than silently landed

#### Convergence Targets
- `tsc --noEmit -p hooks/tsconfig.json` exits 0

#### Scenarios

Derived from F-06.S-01:

```toon
id: S-01
title: Typecheck reports zero errors
given[1]: All 49 typecheck errors have been remediated
when: tsc --noEmit runs under the hooks tsconfig
whenTriggerType: system-event
then[1]: The command MUST exit 0 with zero reported errors
tags[1]: happy-path
automatable: true
```

### Phase 10 — Wave 3: Tag-namespace cleanup and release tooling activation (F-16)

**Agent:** implementer-agent
**Objective:** Move the 17 `plan-exec-*` tags to `refs/exec/*` (move, never delete), activate the dormant `release.yml` + `generate-changelog.ts` + `build-release-tarball.ts`, and add behavioral tests for `generate-changelog.ts` (C-04, defect 13 completion).
**Dependencies:** Phase 7
**File Ownership:** scripts/ci/migrate-exec-tags.ts, .github/workflows/release.yml, scripts/generate-changelog.ts, scripts/build-release-tarball.ts, tests/scripts/generate-changelog.test.ts, planning/reports/tag-backup.bundle

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/ci/migrate-exec-tags.ts | Create | implementer-2 |
| planning/reports/tag-backup.bundle | Create | implementer-2 |
| .github/workflows/release.yml | Modify | implementer-2 |
| scripts/generate-changelog.ts | Modify | implementer-2 |
| scripts/build-release-tarball.ts | Modify | implementer-2 |
| tests/scripts/generate-changelog.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `bun scripts/ci/migrate-exec-tags.ts` (dry-run default) lists all 17 `plan-exec-*` moves; `--execute` copies each to `refs/exec/*`, verifies via `git rev-parse`, then removes the old ref — a pre-migration `git bundle` exists at planning/reports/tag-backup.bundle
- [ ] After migration, `git tag -l 'plan-exec-*'` is empty and `git tag -l 'v*'` returns only semver-shaped tags
- [ ] `release.yml` triggers on `v*` tag push and invokes `generate-changelog.ts` + `build-release-tarball.ts`, producing a tarball artifact + `checksums.sha256`
- [ ] `bunx vitest run tests/scripts/generate-changelog.test.ts` exits 0 (previously untested script now covered)
- [ ] A `release.yml` dry-run (workflow_dispatch on a test tag) completes green before enabling on main

#### Convergence Targets
- `git tag -l 'v*'` returns only semver tags (no `plan-exec-*`)
- A release run produces a tarball artifact

#### Scenarios

Derived from F-16.S-01:

```toon
id: S-01
title: v-namespace contains only semver tags after cleanup
given[1]: The 17 plan-exec-* tags have been relocated or deleted
when: The v* tag namespace is listed
whenTriggerType: system-event
then[1]: The listing MUST contain only semver-shaped tags
tags[1]: happy-path
automatable: true
```

### Phase 11a — Wave 4: Duplication dedup — hooks/ callers (F-08)

**Agent:** implementer-agent
**Objective:** Strangler-migrate the hooks/ callers onto `lib/`: the buggy CSV splitter at hooks/lib/toon-reader.ts:125 and the remaining TOON-serializer call sites in hooks/lib/**, plus the shared dedup-migration test (C-02, defect 8). Split from the original Phase 11 (9 deliverables) per P-03; Phase 11b migrates the scripts/ callers in parallel (no shared files).
**Dependencies:** Phase 2a, Phase 2b, Phase 9
**File Ownership:** hooks/lib/toon-reader.ts, remaining serializer call sites in hooks/lib/**, tests/lib/dedup-migration.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/toon-reader.ts | Modify | implementer-1 |
| hooks/lib/** (remaining TOON-serializer call sites) | Modify | implementer-1 |
| tests/lib/dedup-migration.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] All CSV splitting and TOON serialization under hooks/lib/** routes through `lib/`; local implementations are deleted
- [ ] `bunx eslint hooks/` exits 0 — the `no-restricted-imports` ban finds zero local reimplementations under hooks/
- [ ] Migration is one caller-group per commit (strangler order recorded in `protocols/shared-core.schema.md` migratedCallers)
- [ ] Previously divergent hooks behavior (escaped `""` at toon-reader.ts:125) now matches the lib/ reference tests

#### Convergence Targets
- Grep finds zero local reimplementations of CSV split or TOON serialize under hooks/

#### Scenarios

Authored for F-08 (split coverage; the F-08.S-01 roadmap scenario lands in Phase 11b):

```toon
id: S-01
title: toon-reader routes CSV parsing through the shared splitter
given[1]: hooks/lib/toon-reader.ts has been migrated onto lib/ splitCsvLine
when: toon-reader parses a row containing an escaped "" sequence
whenTriggerType: system-event
then[1]: The parsed field MUST preserve the embedded quote character matching the lib/ reference behavior
tags[1]: regression
automatable: true
```

### Phase 11b — Wave 4: Duplication dedup — scripts/ callers (F-08)

**Agent:** implementer-agent
**Objective:** Strangler-migrate the scripts/ callers onto `lib/`: archive.ts:1119 (correct CSV reference), materialize-contracts.ts:787 (divergent), atomicWrite ×3 (loom-browser-daemon.ts:32, loom-install.ts:80, loom-version-slot.ts:216), and the stranded `atomicWriteText` in scripts/loom-change/init.ts (C-02, defect 8).
**Dependencies:** Phase 2a, Phase 2b, Phase 9
**File Ownership:** scripts/loom-change/**, scripts/materialize-contracts.ts, scripts/loom-browser-daemon.ts, scripts/loom-install.ts, scripts/loom-version-slot.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-change/archive.ts | Modify | implementer-2 |
| scripts/loom-change/init.ts | Modify | implementer-2 |
| scripts/materialize-contracts.ts | Modify | implementer-2 |
| scripts/loom-browser-daemon.ts | Modify | implementer-2 |
| scripts/loom-install.ts | Modify | implementer-2 |
| scripts/loom-version-slot.ts | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] All CSV splitting, TOON serialization, and atomic writes in scripts/** route through `lib/`; local implementations are deleted (including `atomicWriteText` in scripts/loom-change/init.ts)
- [ ] `bunx eslint .` exits 0 — the `no-restricted-imports` ban finds zero local reimplementations outside `lib/`
- [ ] `grep -rn "renameSync" hooks/ scripts/ --include='*.ts' | grep -v node_modules` shows no atomic-write pattern outside lib/ imports
- [ ] Migration is one caller-group per commit (strangler order recorded in `protocols/shared-core.schema.md` migratedCallers)
- [ ] Full suite passes: previously divergent behaviors (escaped `""`, quote preservation) now match the lib/ reference tests

#### Convergence Targets
- Grep finds zero local reimplementations of CSV split, TOON serialize, or atomic write outside `lib/`

#### Scenarios

Derived from F-08.S-01:

```toon
id: S-01
title: No duplicate primitive implementations remain
given[1]: The dedup migration is complete
when: The no-restricted-import lint runs across hooks and scripts
whenTriggerType: system-event
then[1]: Lint MUST report zero local reimplementations of CSV, TOON, or atomic-fs primitives
tags[1]: happy-path
automatable: true
```

### Phase 12 — Wave 4: Remove stale committed worktree block from CLAUDE.md (F-09)

**Agent:** implementer-agent
**Objective:** Remove the committed "Worktree Context — READ THIS FIRST" block (claiming branch `m07`) from mainline `CLAUDE.md`, keep injection worktree-only, and add a guard test (defect 9).
**Dependencies:** Phase 1
**File Ownership:** CLAUDE.md, tests/guards/claude-md-worktree.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| CLAUDE.md | Modify | implementer-2 |
| tests/guards/claude-md-worktree.test.ts | Create | implementer-2 |
| scripts/lib/worktree-context injection path (verify + adjust if it commits the block) | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `grep -c "Worktree Context" CLAUDE.md` returns 0 on the committed mainline file
- [ ] The worktree tooling still injects the block into a freshly created worktree's CLAUDE.md (fixture test), and the injected block is not committed back
- [ ] `bunx vitest run tests/guards/claude-md-worktree.test.ts` exits 0

#### Convergence Targets
- `CLAUDE.md` on `main` contains no "Worktree Context — READ THIS FIRST" block

#### Scenarios

Derived from F-09.S-01:

```toon
id: S-01
title: Mainline CLAUDE.md carries no committed worktree block
given[1]: The stale block has been removed from CLAUDE.md
when: A guard test scans the committed CLAUDE.md on main
whenTriggerType: system-event
then[1]: The test MUST find no worktree hard-rules block
tags[1]: regression
automatable: true
```

### Phase 13 — Wave 4: Hook-registration convergence and dead-tooling cleanup (F-10)

**Agent:** wiring-agent
**Objective:** Reconcile the three hook-registration sources (`.claude/settings.json` live, `hooks/hooks.json` template with inert `Write|Edit` context-budget entry, `scripts/lib/loom-hooks-manifest.ts`), delete dead `scripts/validate-toon-schemas.ts`, rename misnamed `hooks/context-budget-test.ts`, and flip the Phase 1 hook-drift check to blocking (defect 10).
**Dependencies:** Phase 3, Phase 11a, Phase 11b
**File Ownership:** .claude/settings.json, hooks/hooks.json, scripts/lib/loom-hooks-manifest.ts, scripts/validate-toon-schemas.ts, hooks/context-budget-test.ts, hooks/context-budget-check.ts, tests/hooks/hook-registration-drift.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| .claude/settings.json | Modify | wiring-agent |
| hooks/hooks.json | Modify | wiring-agent |
| scripts/lib/loom-hooks-manifest.ts | Modify | wiring-agent |
| scripts/validate-toon-schemas.ts | Delete | wiring-agent |
| hooks/context-budget-test.ts | Delete | wiring-agent |
| hooks/context-budget-check.ts | Create | wiring-agent |
| tests/hooks/hook-registration-drift.test.ts | Create | wiring-agent |

#### Acceptance Criteria
- [ ] `bun scripts/ci/check-hook-drift.ts` exits 0 — all three sources agree, and context-budget is registered on its correct event (not the inert `Write|Edit`)
- [ ] `scripts/validate-toon-schemas.ts` (scans nonexistent dirs, validates 0 files) is deleted; nothing references it
- [ ] `hooks/context-budget-test.ts` is renamed to `hooks/context-budget-check.ts` with all registrations and imports updated
- [ ] The pr-gate hook-drift check runs blocking (the `--warn-only` flag is removed from pr-gate.yml)
- [ ] `bunx vitest run tests/hooks/hook-registration-drift.test.ts` exits 0

#### Convergence Targets
- The hook-registration drift check exits 0 (all three sources agree)

#### Scenarios

Derived from F-10.S-01:

```toon
id: S-01
title: Hook-registration drift check passes after reconciliation
given[1]: settings.json, hooks.json, and the manifest have been reconciled
when: The hook-registration drift check runs in CI
whenTriggerType: system-event
then[1]: The check MUST exit 0 reporting no drift across the three sources
tags[1]: happy-path
automatable: true
```

### Phase 14a — Wave 5: Entry guards and shared backfill harness (F-11)

**Agent:** implementer-agent
**Objective:** Guard `loom-version-slot.ts` and `loom-browser-daemon.ts` top-level `main()` calls behind `lib/` `isMain(import.meta)` so they are importable, and author the shared backfill test template + harness that Phases 14b and 19 reference (defect 6 first half; split from the original Phase 14 per P-04, with the shared template as the P-05 context-budget mitigation).
**Dependencies:** Phase 2b, Phase 11b, Phase 13
**File Ownership:** scripts/loom-version-slot.ts, scripts/loom-browser-daemon.ts, tests/helpers/backfill-template.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/loom-version-slot.ts | Modify | implementer-1 |
| scripts/loom-browser-daemon.ts | Modify | implementer-1 |
| tests/helpers/backfill-template.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] Importing `scripts/loom-version-slot.ts` or `scripts/loom-browser-daemon.ts` in a test executes no side effects (`main()` gated behind `isMain(import.meta)`)
- [ ] `tests/helpers/backfill-template.ts` ships the shared behavioral-test scaffold (sandbox tmp-dir/HOME helpers, input → observable-output assertion skeleton) that Phases 14b and 19 import — authored once here, never re-derived per file
- [ ] `bunx tsc --noEmit -p hooks/tsconfig.json` still exits 0 after the guard edits (type surface unchanged)

#### Convergence Targets
- Importing `loom-version-slot.ts` in a test does not execute `main()`

#### Scenarios

Derived from F-11.S-01:

```toon
id: S-01
title: Importing a guarded script does not run main
given[1]: An entry guard has been added to loom-version-slot.ts
when: A test imports the module
whenTriggerType: system-event
then[2]: main() MUST NOT execute on import, The module's exported functions MUST be callable in isolation
tags[1]: happy-path
automatable: true
```

### Phase 14b — Wave 5: Behavioral backfill tests for PR#31 files (F-11)

**Agent:** implementer-agent
**Objective:** Backfill behavioral tests for all eight untested PR#31 files (~2.9k LOC) using the Phase 14a shared template, executed in two context-bounded batches (defect 6 second half). Sequenced after Phase 14a within Wave 5 (14a→14b ordering, no shared files, per P-04).
**Dependencies:** Phase 2a, Phase 11a, Phase 13, Phase 14a
**File Ownership:** tests/backfill/**

**Context-budget mitigation (P-05):** execute per the file-batch manifest below — each batch reads ≤12 files (source files + tests being authored + the shared template); no agent spawn reads more than one batch. Every backfill test imports `tests/helpers/backfill-template.ts` rather than re-deriving harness setup.

#### File-Batch Manifest
| Batch | Source files read (≤12 files per batch incl. tests + template) | Tests authored |
|-------|--------------------------------------------------------------|----------------|
| B1 | scripts/loom-health.ts, scripts/loom-worktree-scan.ts, scripts/loom-browser-daemon.ts, scripts/loom-install.ts | tests/backfill/loom-health.test.ts, tests/backfill/loom-worktree-scan.test.ts, tests/backfill/loom-browser-daemon.test.ts, tests/backfill/loom-install.test.ts |
| B2 | scripts/loom-version-slot.ts, hooks/loom-careful.ts, hooks/agent-result-validator.ts, hooks/preflight-worktree-scan.ts | tests/backfill/loom-version-slot.test.ts, tests/backfill/loom-careful.test.ts, tests/backfill/agent-result-validator.test.ts, tests/backfill/preflight-worktree-scan.test.ts |

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| tests/backfill/loom-health.test.ts | Create | implementer-1 |
| tests/backfill/loom-worktree-scan.test.ts | Create | implementer-1 |
| tests/backfill/loom-browser-daemon.test.ts | Create | implementer-1 |
| tests/backfill/loom-install.test.ts | Create | implementer-1 |
| tests/backfill/loom-version-slot.test.ts | Create | implementer-1 |
| tests/backfill/loom-careful.test.ts | Create | implementer-1 |
| tests/backfill/agent-result-validator.test.ts | Create | implementer-1 |
| tests/backfill/preflight-worktree-scan.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] Each of the eight files has ≥1 behavioral test exercising real logic (input → observable output), not string-grep
- [ ] Every backfill test imports the shared `tests/helpers/backfill-template.ts` harness (no duplicated setup scaffolding)
- [ ] `bunx vitest run tests/backfill` exits 0
- [ ] The new tests run under the Phase 1 changed-file PR gate when their source files change (mapping test in tests/ci passes)

#### Convergence Targets
- All eight files have at least one behavioral test file

#### Scenarios

Authored for F-11 (split coverage; F-11.S-01 lands in Phase 14a):

```toon
id: S-01
title: Every PR#31 file gains a behavioral test
given[1]: Both backfill batches B1 and B2 are complete
when: bunx vitest run tests/backfill executes
whenTriggerType: system-event
then[2]: The run MUST exit 0, Each of the eight PR#31 files MUST have at least one behavioral test exercising input to observable output
tags[1]: happy-path
automatable: true
```

### Phase 15 — Wave 5: Tautological-test audit and deletion (F-12)

**Agent:** implementer-agent
**Objective:** Classify every suspect test (behavioral / tautological / prompt-grep) into a durable, re-runnable TOON audit report, then delete confirmed no-value tests (C-11 first half, defect 7).
**Dependencies:** Phase 1
**File Ownership:** scripts/audit-tests.ts, planning/reports/test-audit.toon, tests/commands/** (deletions), tests/regressions/** (deletions)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/audit-tests.ts | Create | implementer-2 |
| planning/reports/test-audit.toon | Create | implementer-2 |
| tests/commands/** (confirmed tautological tests, incl. loom-prototype.test.ts) | Delete | implementer-2 |
| tests/regressions/** (confirmed prompt-grep tests, incl. stuck-at-loop-construction.test.ts) | Delete | implementer-2 |
| tests/guards/audit-report-complete.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `bun scripts/audit-tests.ts` classifies 100% of the flagged suspect set with evidence per row; `--count-remaining` reports the count of tautological/prompt-grep tests still in the suite
- [ ] Confirmed tautological and prompt-grep tests (including `tests/commands/loom-prototype.test.ts` reimplementing completion-ceremony.ts and `tests/regressions/stuck-at-loop-construction.test.ts` asserting its own strings) are deleted, with audit rows as tombstones
- [ ] `planning/reports/test-audit.toon` conforms to the TautologicalTestAudit schema and is regenerated identically by a re-run (durable + re-runnable)
- [ ] No unclassified suspect is deleted (state-machine rule: suspect → classified → deleted)

#### Convergence Targets
- The audit report classifies 100% of the flagged suspect tests
- Post-deletion, the suite contains zero tests classified tautological or prompt-grep

#### Scenarios

Derived from F-12.S-01:

```toon
id: S-01
title: Audit classifies every suspect test and removes no-value ones
given[1]: The suspect-test set including loom-prototype and stuck-at-loop is enumerated
when: The tautological-test audit runs
whenTriggerType: system-event
then[2]: Each suspect test MUST receive a classification, Confirmed tautological tests MUST be absent from the suite afterward
tags[1]: happy-path
automatable: true
```

### Phase 16 — Wave 5: Generated docs metadata with CI drift-fail (F-18)

**Agent:** implementer-agent
**Objective:** Generate command tables, hook count/table, and the agent model-tier table from frontmatter + `scripts/lib/loom-hooks-manifest.ts` into README/reference docs, flip the Phase 1 docs-drift check to blocking — permanently closing the "fourteen vs Thirteen" hook-count drift and surfacing the 4 undocumented commands (C-05, defect 12 enumerable half).
**Dependencies:** Phase 13
**File Ownership:** scripts/generate-docs.ts, README.md, docs/reference/**, docs/.generated-manifest.toon, scripts/ci/check-docs-drift.ts, tests/scripts/generate-docs.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/generate-docs.ts | Create | implementer-3 |
| README.md | Modify | implementer-3 |
| docs/reference/commands.md | Create | implementer-3 |
| docs/reference/hooks.md | Create | implementer-3 |
| docs/reference/agents.md | Create | implementer-3 |
| docs/.generated-manifest.toon | Create | implementer-3 |
| scripts/ci/check-docs-drift.ts | Modify | implementer-3 |
| tests/scripts/generate-docs.test.ts | Create | implementer-3 |

#### Acceptance Criteria
- [ ] `bun scripts/generate-docs.ts --write` regenerates only content between `<!-- loom:generated:{section} -->` markers; narrative prose is untouched (diff test)
- [ ] README hook counts at all four former drift sites (lines ~51/491 "fourteen" vs ~1277/1353 "Thirteen") come from a single generated source and agree
- [ ] The generated command table lists every shipped command exactly once — including `loom-careful`, `loom-health`, `loom-profile`, `loom-skill` — with the `loom-skill`/`loom-skillify` collision resolved by distinct rows and descriptions
- [ ] `bun scripts/ci/check-docs-drift.ts` exits 1 when a hook is added without regeneration (planted-drift test) and the pr-gate docs-drift check now runs blocking
- [ ] `bunx vitest run tests/scripts/generate-docs.test.ts` exits 0

#### Convergence Targets
- The docs drift check exits non-zero when a generated section is stale
- The generated command table lists every shipped command exactly once

#### Scenarios

Derived from F-18.S-01:

```toon
id: S-01
title: Docs drift check fails on a stale generated section
given[1]: A hook is added but the generated hook table is not regenerated
when: The docs drift check runs in CI
whenTriggerType: system-event
then[1]: The check MUST exit non-zero identifying the stale section
tags[1]: happy-path
automatable: true
```

### Phase 17 — Wave 5: Docs convention and hand-authored drift fixes (F-19)

**Agent:** implementer-agent
**Objective:** Fix the non-enumerable half of defect 12: TOON-convention violations in named agent files, document `modelProfile` in the orchestration-config schema, and rationalize the convergence-driver model-tier mismatch (86KB agent on `model:sonnet` while simpler roadmap-converge-driver gets `opus`).
**Dependencies:** Phase 1
**File Ownership:** agents/e2e-test-agent.md, agents/unit-test-agent.md, agents/code-codex-review-agent.md, agents/implementer-agent.md, agents/fixer-agent.md, agents/verification-agent.md, agents/convergence-driver.md, protocols/orchestration-config.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/e2e-test-agent.md | Modify | implementer-4 |
| agents/unit-test-agent.md | Modify | implementer-4 |
| agents/code-codex-review-agent.md | Modify | implementer-4 |
| agents/implementer-agent.md | Modify | implementer-4 |
| agents/fixer-agent.md | Modify | implementer-4 |
| agents/verification-agent.md | Modify | implementer-4 |
| agents/convergence-driver.md | Modify | implementer-4 |
| protocols/orchestration-config.schema.md | Modify | implementer-4 |

#### Acceptance Criteria
- [ ] "AgentResult JSON" wording at `e2e-test-agent.md:155` and `unit-test-agent.md:76` reads "AgentResult TOON"; raw JSON examples at `code-codex-review-agent.md:53,62` are converted to TOON
- [ ] JSON-brace progress-format strings in implementer/fixer/verification agents are replaced with TOON progress formats
- [ ] `modelProfile` (used in 9 command files) is documented in `protocols/orchestration-config.schema.md`
- [ ] `agents/convergence-driver.md` model tier is corrected (or its `model: sonnet` rationale documented inline adjacent to the frontmatter)
- [ ] A convention grep (`grep -rn "AgentResult JSON" agents/`) returns zero matches

#### Convergence Targets
- A convention lint finds zero "AgentResult JSON" or raw-JSON progress strings in the named agent files

#### Scenarios

```toon
id: S-01
title: Convention lint finds zero raw-JSON references in remediated agent files
given[1]: The named agent files have been converted to TOON-convention wording
when: The convention grep runs across agents/
whenTriggerType: system-event
then[2]: Zero "AgentResult JSON" matches MUST be found, Zero JSON-brace progress-format strings MUST remain in implementer fixer and verification agents
tags[1]: happy-path
automatable: true
```

### Phase 18 — Wave 6: Meta-tests, property tests, and test:source ratio backfill (F-13)

**Agent:** implementer-agent
**Objective:** Backfill behavioral, property, and meta-tests replacing Phase 15 deletions; raise the test:source LOC ratio to ≥1.4:1; land ≥1 property test and ≥1 planted-defect meta-test (C-11 second half — match then exceed gstack's test strength).
**Dependencies:** Phase 14a, Phase 14b, Phase 15
**File Ownership:** tests/property/**, tests/meta/**, tests/backfill/** (additions), scripts/metrics-snapshot.ts, tests/scripts/metrics-snapshot.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| tests/property/toon-roundtrip.property.test.ts | Create | implementer-1 |
| tests/property/merge-order.property.test.ts | Create | implementer-1 |
| tests/meta/planted-defect.test.ts | Create | implementer-1 |
| scripts/metrics-snapshot.ts | Create | implementer-1 |
| tests/backfill/** (behavioral replacements for audited deletions, per test-audit.toon replacedBy) | Create | implementer-1 |
| tests/scripts/metrics-snapshot.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `bun scripts/metrics-snapshot.ts --metric ratio` reports test:source LOC ratio ≥ 1.4, OR `planning/reports/metrics-snapshot.toon` contains an equivalence block `{basis, computedValue, rationale}` that passes the `scripts/metrics-snapshot.ts` schema check — machine-validated either way, no free-prose escape (IC-001)
- [ ] ≥1 property test asserts an invariant over generated inputs (e.g., TOON serialize/parse round-trip is identity; merge is order-independent)
- [ ] The planted-defect meta-test plants a catastrophic regression into a fixture and proves the guarding linter/hook flags it: guard enabled ⇒ test passes (defect caught); guard disabled ⇒ test fails
- [ ] Every `deleted` audit row that regressed coverage has a `replacedBy` backfill test (audit report shows no coverage-regressing deletions without replacement)
- [ ] `bunx vitest run tests/property tests/meta` exits 0

#### Convergence Targets
- The metrics script reports test:source ratio ≥1.4:1
- The planted-defect meta-test exits non-zero when the guard is disabled and zero when enabled

#### Scenarios

Derived from F-13.S-01:

```toon
id: S-01
title: Planted-defect meta-test proves the guard fires
given[1]: A meta-test plants a catastrophic regex/regression into a fixture
when: The guarding linter runs against the planted fixture
whenTriggerType: system-event
then[1]: The linter MUST flag the planted defect, proving the guard is live
tags[1]: regression
automatable: true
```

### Phase 19 — Wave 7: Deflake suite and retire fileParallelism workaround (F-14)

**Agent:** implementer-agent
**Objective:** Isolate the shared-state sources behind ~39 load-sensitive failures, remove `fileParallelism: false` from vitest config (gated on the Phase 1 CI test gate per C-10), and give the 5 Docker-only e2e specs a clean skip or local fallback (defect 15).
**Dependencies:** Phase 1, Phase 18
**File Ownership:** vitest.config.ts, tests/helpers/**, tests/** (fixture-isolation edits), tests/e2e/** (Docker skip/fallback), tests/quarantine/**, .plan-execution/batches/phase-19.toon

**Context-budget mitigation (P-06):** execute per the file-batch manifest below — the ~39 load-sensitive specs are partitioned by test layer into batches of ≤12 files; each spawn reads exactly one batch plus the shared harness files (`tests/helpers/backfill-template.ts` from Phase 14a and `tests/helpers/isolated-fixture.ts`), never the whole worklist.

#### File-Batch Manifest
| Batch | Scope | Cap |
|-------|-------|-----|
| B1 | vitest.config.ts + tests/helpers/** (isolation helper authored first) | ≤12 files |
| B2 | Load-sensitive unit-layer specs (tests/hooks/**, tests/lib/**) | ≤12 files |
| B3 | Load-sensitive integration-layer specs (tests/scripts/**, tests/ci/**, tests/install/**) | ≤12 files |
| B4 | tests/e2e/** Docker skip/fallback + tests/quarantine/** drain | ≤12 files |

The concrete per-batch file list is materialized from the deflake worklist into `.plan-execution/batches/phase-19.toon` as the phase's first deliverable; any batch that would exceed 12 files is split before dispatch.

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| .plan-execution/batches/phase-19.toon | Create | implementer-1 |
| vitest.config.ts | Modify | implementer-1 |
| tests/helpers/isolated-fixture.ts | Create | implementer-1 |
| tests/** (shared mutable fixture isolation across load-sensitive specs) | Modify | implementer-1 |
| tests/e2e/** (Docker detection: clean skip message or local fallback) | Modify | implementer-1 |
| tests/quarantine/ (empty by completion; interim quarantine home) | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `fileParallelism: false` is removed from vitest.config.ts and the full suite passes with parallel file execution across 5 consecutive runs (`for i in 1..5; bunx vitest run` all exit 0)
- [ ] No shared mutable global fixtures remain in the previously load-sensitive specs (each uses tests/helpers/isolated-fixture.ts per-test temp dirs)
- [ ] With Docker unavailable, the 5 Docker-only e2e specs report a clean skip with an explanatory message (exit 0), or run against the local fallback
- [ ] tests/quarantine/ is empty at phase completion (quarantined flakes fixed or deleted via the audit flow)
- [ ] Nightly suite wall-time drops below the 222s serial baseline

#### Convergence Targets
- The suite passes with `fileParallelism` enabled across repeated runs
- Docker-only e2e specs report a clean skip when Docker is unavailable

#### Scenarios

Derived from F-14.S-01:

```toon
id: S-01
title: Suite passes with parallel file execution enabled
given[1]: The fileParallelism:false workaround has been removed
when: The full vitest suite runs in the nightly tier
whenTriggerType: system-event
then[1]: The suite MUST pass without load-sensitive spurious failures
tags[1]: happy-path
automatable: true
```

### Phase 20 — Wave 8: Eval tier ladder T1/T2 free, T3 opt-in (F-20 + F-21)

**Agent:** implementer-agent
**Objective:** Ship the three-tier eval framework (C-03, supersedes gstack-adoption N-03): T1 static/deterministic in the PR tier (free), T2 hermetic with fixtured LLM I/O nightly (free), T3 LLM-judge behind `LOOM_EVAL_LLM` — never merge-blocking, pre-release with a `main` floor.
**Dependencies:** Phase 19
**File Ownership:** scripts/eval/**, evals/**, tests/eval/**, .github/workflows/pr-gate.yml (eval step), .github/workflows/nightly-gate.yml (eval step)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/eval/run-evals.ts | Create | implementer-1 |
| scripts/eval/tiers/t1-static.ts | Create | implementer-1 |
| scripts/eval/tiers/t2-hermetic.ts | Create | implementer-1 |
| scripts/eval/tiers/t3-judge.ts | Create | implementer-1 |
| evals/fixtures/** (hermetic LLM I/O fixtures) | Create | implementer-1 |
| .github/workflows/pr-gate.yml (add T1 step) | Modify | implementer-1 |
| .github/workflows/nightly-gate.yml (add T2 step + floor comparison) | Modify | implementer-1 |
| tests/eval/run-evals.test.ts | Create | implementer-1 |
| tests/eval/t3-gating.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `bun scripts/eval/run-evals.ts --tier t1` completes with `llmCalls: 0` and writes an EvalTierResult TOON record conforming to `protocols/eval-tier.schema.md`
- [ ] `--tier t2` replays fixtured LLM I/O with zero live LLM calls (network access asserted absent in test); a missing fixture yields EVAL_FIXTURE_MISSING, exit 1
- [ ] With `LOOM_EVAL_LLM` unset, `--tier t3` writes status `skipped` and exits 0; no CI configuration makes T3 merge-blocking
- [ ] With `LOOM_EVAL_LLM` set (mocked judge in test), T3 emits a judgedScore compared against the `main` floor run, recording EVAL_FLOOR_REGRESSION as a warning when below
- [ ] pr-gate runs T1; nightly-gate runs T2 with regression floor versus `main`
- [ ] `bunx vitest run tests/eval` exits 0

#### Convergence Targets
- T1 eval run produces an `EvalTierResult` and requires no network/LLM call
- T2 eval run replays a fixture without a live LLM call
- With `LOOM_EVAL_LLM` unset, T3 is skipped and does not block

#### Scenarios

Derived from F-20.S-01:

```toon
id: S-01
title: T1 static eval runs free in the PR tier
given[1]: The T1 static eval suite is configured
when: The PR-tier workflow runs the eval step
whenTriggerType: system-event
then[2]: The T1 evals MUST complete without any LLM call, An EvalTierResult record MUST be written
tags[1]: happy-path
automatable: true
```

Authored for F-21 (no upstream roadmap scenario):

```toon
id: S-02
title: T3 is skipped without the opt-in flag and never blocks merge
given[1]: LOOM_EVAL_LLM is unset in the environment
when: run-evals.ts is invoked with --tier t3
whenTriggerType: system-event
then[3]: The run status MUST be skipped, The process MUST exit 0, No merge-blocking check MUST reference the t3 result
tags[1]: edge-case
automatable: true
```

### Phase 21 — Wave 8: Shared skill preamble protocol resource (F-22)

**Agent:** implementer-agent
**Objective:** Author the skill preamble once as a protocol resource cited by reference (extending the `_loom-init-guard` include pattern), eliminating 700–800-line per-skill preamble bloat (C-06). Foundation for the Wave 9 skill batches — hard ordering per roadmap.
**Dependencies:** Phase 19
**File Ownership:** protocols/skill-preamble.md, skills/library.yaml, tests/skills/preamble-resolution.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/skill-preamble.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |
| tests/skills/preamble-resolution.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `protocols/skill-preamble.md` holds the single shared preamble; it is registered under `library.protocols:` in `skills/library.yaml`
- [ ] A fixture skill declaring the shared-preamble include resolves the preamble at load with no inlined copy in the skill body (test)
- [ ] The include mechanism follows the `_loom-init-guard` shared-include pattern
- [ ] `bunx vitest run tests/skills/preamble-resolution.test.ts` exits 0

#### Convergence Targets
- A skill that references the preamble resolves it without inlined duplication

#### Scenarios

Derived from F-22.S-01:

```toon
id: S-01
title: Skill resolves the shared preamble by reference
given[1]: A skill declares the shared-preamble include
when: The skill is loaded
whenTriggerType: system-event
then[1]: The shared preamble MUST be resolved without any inlined preamble copy in the skill body
tags[1]: happy-path
automatable: true
```

### Phase 22 — Wave 9: Skill upgrades — review and quality batch (F-23)

**Agent:** implementer-agent
**Objective:** Apply C-13 to the review/quality skills — `loom-design*`, `loom-cso` + `loom-spec` (created here via the `loom-think` split, colocated because this phase owns `loom-cso`), `loom-qa`, `loom-devex-review`, `loom-health`: preamble-by-reference, behavioral tests, wired enforcement, and a named beyond-upstream capability per skill.
**Dependencies:** Phase 21
**File Ownership:** skills/loom-design*/**, skills/loom-cso/**, skills/loom-spec/**, skills/loom-qa/**, skills/loom-devex-review/**, skills/loom-health/**, skills/library.yaml, skills/upgrade-matrix/{design,cso,spec,qa,devex-review,health}.toon, tests/skills/review-batch.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/loom-design*/** | Modify | implementer-1 |
| skills/loom-cso/SKILL.md | Create | implementer-1 |
| skills/loom-spec/SKILL.md | Create | implementer-1 |
| skills/loom-qa/** | Modify | implementer-1 |
| skills/loom-devex-review/** | Modify | implementer-1 |
| skills/loom-health/** | Modify | implementer-1 |
| skills/library.yaml (register loom-cso, loom-spec; retire loom-think) | Modify | implementer-1 |
| skills/upgrade-matrix/ (one shard per batch skill) | Create | implementer-1 |
| tests/skills/review-batch.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] Every batch skill references `protocols/skill-preamble.md`; no skill body contains >50 lines of inlined preamble
- [ ] Each skill's backing scripts/hooks have behavioral tests (loom-health backing script already covered by tests/backfill — referenced, not duplicated)
- [ ] Enforcement claimed by each skill's spec is wired and demonstrated by a test
- [ ] Each upgrade-matrix shard names ≥1 concrete capability its gstack upstream lacks, with all four C-13 columns true
- [ ] `bunx vitest run tests/skills/review-batch.test.ts` exits 0

#### Convergence Targets
- The `SkillUpgradeMatrix` records preamble-by-reference, tests-present, enforcement-wired, and a beyond-upstream capability for each batch skill

#### Scenarios

Derived from F-23.S-01:

```toon
id: S-01
title: A review-batch skill records a beyond-upstream capability
given[1]: loom-cso has been upgraded per C-13
when: The skill-upgrade matrix is validated
whenTriggerType: system-event
then[2]: The matrix MUST show loom-cso references the shared preamble, The matrix MUST name at least one capability its gstack upstream lacks
tags[1]: happy-path
automatable: true
```

### Phase 23 — Wave 9: Skill upgrades — workflow batch (F-24 part 1)

**Agent:** implementer-agent
**Objective:** Apply C-13 to the workflow skills: `loom-careful`, `loom-ship`, `loom-retro`, `loom-canary`, `loom-worktree` — same four requirements (preamble-by-reference, behavioral tests, wired enforcement e.g. loom-careful guard and loom-ship version-slot, beyond-upstream capability).
**Dependencies:** Phase 21
**File Ownership:** skills/loom-careful/**, skills/loom-ship/**, skills/loom-retro/**, skills/loom-canary/**, skills/loom-worktree/**, skills/upgrade-matrix/{careful,ship,retro,canary,worktree}.toon, tests/skills/workflow-batch.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/loom-careful/** | Modify | implementer-2 |
| skills/loom-ship/** | Modify | implementer-2 |
| skills/loom-retro/** | Modify | implementer-2 |
| skills/loom-canary/** | Modify | implementer-2 |
| skills/loom-worktree/** | Modify | implementer-2 |
| skills/upgrade-matrix/ (one shard per batch skill) | Create | implementer-2 |
| tests/skills/workflow-batch.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] Every batch skill references the shared preamble with no >50-line inline copy
- [ ] `loom-careful`'s claimed guard and `loom-ship`'s version-slot enforcement are wired and each proven by a behavioral test
- [ ] Each upgrade-matrix shard is complete (no missing columns) with a named beyond-upstream capability
- [ ] `bunx vitest run tests/skills/workflow-batch.test.ts` exits 0

#### Convergence Targets
- The `SkillUpgradeMatrix` shards for careful/ship/retro/canary/worktree are complete (no missing columns)

#### Scenarios

Authored for F-24 (no upstream roadmap scenario):

```toon
id: S-01
title: Workflow-batch skill enforcement is wired and fires
given[1]: loom-careful claims a guard in its spec and the upgrade has wired it
when: The guard's triggering condition is exercised in a behavioral test
whenTriggerType: system-event
then[2]: The guard MUST fire, The upgrade-matrix shard MUST record enforcementWired true
tags[1]: happy-path
automatable: true
```

### Phase 24 — Wave 9: Skill upgrades — ops and authoring batch (F-24 part 2)

**Agent:** implementer-agent
**Objective:** Apply C-13 to the remaining ops/authoring skills: `loom-browser`, `loom-skillify`, `loom-learn`, `loom-benchmark*` — same four requirements per skill.
**Dependencies:** Phase 21
**File Ownership:** skills/loom-browser/**, skills/loom-skillify/**, skills/loom-learn/**, skills/loom-benchmark*/**, skills/upgrade-matrix/{browser,skillify,learn,benchmark}.toon, tests/skills/ops-batch.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/loom-browser/** | Modify | implementer-3 |
| skills/loom-skillify/** | Modify | implementer-3 |
| skills/loom-learn/** | Modify | implementer-3 |
| skills/loom-benchmark*/** | Modify | implementer-3 |
| skills/upgrade-matrix/ (one shard per batch skill) | Create | implementer-3 |
| tests/skills/ops-batch.test.ts | Create | implementer-3 |

#### Acceptance Criteria
- [ ] Every batch skill references the shared preamble with no >50-line inline copy
- [ ] Each skill's backing scripts/hooks have behavioral tests (loom-browser daemon backed by tests/backfill/loom-browser-daemon.test.ts — referenced)
- [ ] Each upgrade-matrix shard is complete with a named beyond-upstream capability
- [ ] `bunx vitest run tests/skills/ops-batch.test.ts` exits 0

#### Convergence Targets
- The `SkillUpgradeMatrix` is complete for every ops/authoring skill (no missing columns)

#### Scenarios

Authored for F-24 (no upstream roadmap scenario):

```toon
id: S-01
title: Ops-batch matrix has no missing columns
given[1]: All ops and authoring batch skills have been upgraded per C-13
when: The upgrade-matrix shards are validated against the SkillUpgradeMatrix schema
whenTriggerType: system-event
then[2]: Every shard MUST have all five fields populated, Every beyondUpstream field MUST be non-empty
tags[1]: happy-path
automatable: true
```

### Phase 25 — Wave 10: Comparative scorecard re-run and acceptance gate (F-25) — M-09 acceptance

**Agent:** implementer-agent
**Objective:** Re-run the same 4-agent comparative review (loom vs gstack) with the pinned baseline rubric; gate acceptance on every dimension ≥ its gstack score and overall > 8.3; on failure, emit the loop-back mapping (C-09 final acceptance).
**Dependencies:** Phase 9, Phase 10, Phase 16, Phase 17, Phase 19, Phase 20, Phase 22, Phase 23, Phase 24
**File Ownership:** scripts/scorecard-gate.ts, planning/reports/scorecard-baseline.toon, planning/reports/scorecard-rerun.toon, planning/reports/pre-scorecard-sweep.toon, tests/scripts/scorecard-gate.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| planning/reports/scorecard-baseline.toon | Create | implementer-1 |
| scripts/scorecard-gate.ts | Create | implementer-1 |
| planning/reports/scorecard-rerun.toon | Create | implementer-1 |
| planning/reports/pre-scorecard-sweep.toon | Create | implementer-1 |
| tests/scripts/scorecard-gate.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `planning/reports/scorecard-baseline.toon` pins the baseline rubric, the 4 reviewer agents, and gstack's per-dimension scores (~8.3 overall); the gate refuses a rerun whose rubricRef differs
- [ ] The 4-agent comparative review is re-run with the identical rubric and agent set; every dimension's score is recorded in `scorecard-rerun.toon` alongside its gstack reference
- [ ] `bun scripts/scorecard-gate.ts` exits 0 only when every dimension delta ≥ 0 AND overall > 8.3; otherwise exits 2 naming each trailing dimension and its responsible milestone (loop-back)
- [ ] Pre-scorecard sweep runs before the scorecard re-run: a security injection sweep across ALL execSync/execFileSync call sites (C-42) plus a code-review gate across all modified files (C-45), with findings recorded in `planning/reports/pre-scorecard-sweep.toon` and zero blocking findings outstanding (closes CG-014/CG-015)
- [ ] Gate behavior is proven by fixture tests: a scorecard with one trailing dimension yields exit 2 and names it
- [ ] `bunx vitest run tests/scripts/scorecard-gate.test.ts` exits 0

#### Convergence Targets
- The `ScorecardResult` records a numeric score per dimension plus an overall
- Acceptance status is `pass` only when all dimension deltas are ≥ 0 and overall > 8.3

#### Scenarios

Derived from F-25.S-01:

```toon
id: S-01
title: Acceptance fails when any dimension trails gstack
given[1]: A re-run scorecard has one dimension scoring below its gstack reference
when: The acceptance gate evaluates the ScorecardResult
whenTriggerType: system-event
then[2]: The gate MUST report acceptance as not-passed, The gate MUST name the trailing dimension
tags[1]: error
automatable: true
```

### Phase 26 — Wave 11: Measured changelog and metrics snapshot (F-26) — M-09 close

**Agent:** wiring-agent
**Objective:** Publish the final measured changelog with all seven pre-registered metrics filled from repo-derived values, persisted as a MetricsSnapshot so every claim is traceable to a re-runnable derivation (C-04/C-09/C-12 close-out).
**Dependencies:** Phase 25
**File Ownership:** planning/history/changelog.md, planning/reports/metrics-snapshot.toon, scripts/metrics-snapshot.ts (extension), tests/scripts/changelog-metrics-match.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/metrics-snapshot.ts | Modify | wiring-agent |
| planning/reports/metrics-snapshot.toon | Create | wiring-agent |
| planning/history/changelog.md | Modify | wiring-agent |
| tests/scripts/changelog-metrics-match.test.ts | Create | wiring-agent |

#### Acceptance Criteria
- [ ] `bun scripts/metrics-snapshot.ts --write` derives all seven success metrics (typecheck errors, test:source ratio, tautological count, defects closed 15/15, CI gate status, meta-test firing, scorecard overall) with `derivedBy` commands
- [ ] The final changelog entry embeds the snapshot values verbatim — no prose estimates; `bun scripts/metrics-snapshot.ts --check` exits 0 (changelog matches snapshot)
- [ ] Every published metric is reproducible: re-running each `derivedBy` command yields the recorded value at the pinned gitRef
- [ ] `bunx vitest run tests/scripts/changelog-metrics-match.test.ts` exits 0

#### Convergence Targets
- The `MetricsSnapshot` contains all seven success metrics with derived values
- The changelog entry's metrics match the snapshot exactly

#### Scenarios

Derived from F-26.S-01:

```toon
id: S-01
title: Changelog metrics match the repo-derived snapshot
given[1]: The MetricsSnapshot has been generated from repo state
when: The final changelog entry is validated against the snapshot
whenTriggerType: system-event
then[1]: Every metric in the changelog MUST equal its value in the snapshot
tags[1]: happy-path
automatable: true
```

## Verification Commands

```bash
# PR-tier gate (run after every wave)
bunx tsc --noEmit -p hooks/tsconfig.json
bunx eslint .
bunx vitest run
bun scripts/ci/check-library-catalog.ts

# Drift gates (warn-only until Phases 13/16, then blocking)
bun scripts/ci/check-hook-drift.ts
bun scripts/generate-docs.ts --check

# Release / ops (Wave 3+)
bun scripts/ci/version-gate.ts
git tag -l 'v*'            # semver tags only after Phase 10
git tag -l 'plan-exec-*'   # empty after Phase 10

# Evals (Wave 8+)
bun scripts/eval/run-evals.ts --tier t1
bun scripts/eval/run-evals.ts --tier t2

# Success metrics (Wave 10+)
bun scripts/audit-tests.ts --count-remaining
bun scripts/metrics-snapshot.ts --check
bun scripts/scorecard-gate.ts
```

## Milestones

| Milestone | Phases | Waves | Depends on (roadmap) | Gate |
|-----------|--------|-------|----------------------|------|
| M-01 Foundation | 0, 1, 2a, 2b | W0–W1 | — | Tiered CI live; `lib/` exists with lint ban |
| M-02 Critical defect fixes | 3, 4, 5, 6, 9 | W2–W3 | M-01 | Validator blocking; argv exec; repo-scoped slots; tsc 0 errors; schema reconciled |
| M-03 Hygiene | 11a, 11b, 12, 13 | W4 | M-01, M-02 | Dedup complete; CLAUDE.md clean; hook drift 0 |
| M-04 Test overhaul | 14a, 14b, 15, 18, 19 | W5–W7 | M-01, M-02 | 8 files tested; audit done; ratio ≥1.4:1; parallelism restored |
| M-05 Release & ops | 7, 8, 10 | W2–W3 | M-01 | Semver + version gate; fail-closed install; clean v* namespace |
| M-06 Docs generation | 16, 17 | W5 | M-01, M-03 | Docs drift-fail live; conventions fixed |
| M-07 Eval ladder | 20 | W8 | M-01, M-04 | T1/T2 free + green; T3 opt-in |
| M-08 Skill upgrades | 21, 22, 23, 24 | W8–W9 | M-01, M-04 | Preamble protocol + all matrix shards complete (workflow/ops matrix completeness is verified advisory via C-37 plus human review at sign-off — IC-002) |
| M-09 Final scorecard | 25, 26 | W10–W11 | M-02, M-04, M-05, M-06, M-07, M-08 | Every dimension ≥ gstack; overall > 8.3; measured changelog |

Semver tags are cut at each milestone boundary via `scripts/loom-release.ts` once Phase 7 lands (retroactive tagging for M-01 at that point).

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Load-sensitive flake resists deflaking, blocking Phase 19 | high | Quarantine path (tests/quarantine/, nightly-only) keeps PR gate green; `fileParallelism` removal gated on 5 consecutive green parallel runs; workaround stays until then (C-01/C-10) |
| Scorecard re-run scores inconsistently vs baseline | high | Rubric + agents + gstack scores pinned in scorecard-baseline.toon (Phase 25 deliverable); gate refuses rubric drift; dimensions anchored to repo-derivable evidence (C-09) |
| Skill-upgrade scope creep (~15 skills × 4 requirements) | high | Batched into Phases 22–24 with per-skill matrix shards; F-24 batches are P2 and can slip without blocking Wave 10 entry (only completed M-08 phases gate M-09 — slippage requires explicit plan refinement, not silent skips) |
| Dedup (Phases 11a/11b) regresses ubiquitous primitives | medium | lib/ lands first with round-trip/property tests (Phases 2a/2b); one caller-group per commit; lint prevents re-divergence; nightly suite backstop |
| Tag migration mishap | medium | Move-not-delete to refs/exec/*, dry-run default, pre-migration git bundle, rev-parse verification per tag |
| Wave-3 typecheck phase collides with parallel file edits | medium | Phase 9 ownership explicitly excludes Phase-10-owned files; wave-end verification runs tsc across everything |
| Single-maintainer bandwidth across 12 waves | medium | Foundation-first (C-10); W2 fans out 6 independent phases; milestones independently shippable and tagged |

## Acceptance Criteria (Final)

Mirrors the roadmap Success Metrics table (C-09) — all repo-derivable:

- [ ] `bunx tsc --noEmit -p hooks/tsconfig.json` exits 0 (from 49 errors)
- [ ] `bun scripts/metrics-snapshot.ts --metric ratio` ≥ 1.4 test:source LOC, OR the snapshot contains a schema-validated equivalence block `{basis, computedValue, rationale}` checked by `scripts/metrics-snapshot.ts` (IC-001)
- [ ] `bun scripts/audit-tests.ts --count-remaining` returns 0 tautological/prompt-grep tests
- [ ] All 15 verified defects closed, each mapped to a shipped phase in the changelog defect-closure checklist
- [ ] PR-tier and nightly-tier CI gates green on `main`
- [ ] ≥1 planted-defect meta-test proves a guard fires (`bunx vitest run tests/meta` exits 0)
- [ ] `bun scripts/scorecard-gate.ts` exits 0: every dimension ≥ its gstack score, overall > 8.3
- [ ] Final measured changelog entry matches `planning/reports/metrics-snapshot.toon` exactly (`--check` exits 0)

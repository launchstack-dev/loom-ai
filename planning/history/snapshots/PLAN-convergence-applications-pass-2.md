---
planVersion: 2
name: "Convergence Applications"
status: draft
created: 2026-06-14
lastReviewed: null
roadmapRef: planning/ROADMAP-convergence-applications.md
totalPhases: 11
totalWaves: 5
---

# Plan: Convergence Applications

## Overview

Wire four additional harness + integrator pairs (code-review, test-run, debug, PR-review) onto the existing document-mode `convergence-driver` substrate. The driver itself is frozen (CA-01); this plan adds harnesses (TypeScript scripts), integrator-mode extensions to `fixer-agent`, two new debug agents, and per-application `--autoconverge` wrappers. Each application is independent (CA-02) and shares the same `ConvergenceFindings` / `IterationSnapshot` / `ConvergenceSummary` contracts.

## Tech Stack

- **Runtime:** bun (preferred) / node fallback for harness scripts (TypeScript)
- **Driver substrate:** `agents/convergence-driver.md` (frozen, do not modify per CA-01)
- **Shared schemas:** `agents/protocols/findings.schema.md`, `iteration-snapshot.schema.md`, `convergence-summary.schema.md` (all frozen)
- **Shared helpers:** `scripts/lib/aggregate-findings.ts` (existing), `hooks/lib/iteration-snapshot.ts` (existing)
- **External tooling:** `gh` CLI (F-04 PR comments + diff retrieval), test runners (bun test, vitest, pytest)
- **Data format:** TOON for all Loom artifacts (findings, summaries, configs, pr-state)
- **Testing:** vitest for unit tests of harnesses + adapters

## Schema / Type Definitions

### IntegratorModeInput

Input contract for `fixer-agent` Integrator Mode and `pr-fixer-agent`.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| findingsPath | string | required, must exist, must conform to findings.schema.md | absolute or repo-relative path |
| subjectPath | string | required, must exist, must be writable | path within repo root |
| roadmapPath | string \| null | optional context | when present, must exist |
| iterationNumber | integer | required, ≥1 | from driver iteration counter |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| — | — | — | In-memory contract; not persisted |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| — | — | — | — |

### ConvergeConfigDocument

Document-mode `converge.config` shape consumed by the driver. New per-application wrappers generate this; the schema is locked but each application adds a small `applicationContext` blob the driver passes opaquely to its harness.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| convergenceMode | "document" | required, locked | enum constant |
| subject | string | required, must resolve to a file under repo root | preflight check #3 |
| harness | string | required, path to harness script | must be executable via bun |
| integrator | string | required, agent name | must exist under `agents/` |
| maxIterations | integer | required, 1-10 | C-05 default per-application |
| snapshotEnabled | boolean | required, default true | locked per C-07 |
| applicationContext | object \| null | optional | opaque to driver; harness reads |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| — | — | — | TOON file, not indexed |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ConvergeConfig | findings.toon (per iter) | n/a (durable) | n/a |
| ConvergeConfig | iteration snapshot | n/a (durable) | n/a |

### TestFinding

Per-failure row emitted by `scripts/test-harness.ts`.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | required, unique within iteration | format `T-NNN` |
| locationPath | string | required | path to test file |
| locationAnchor | string | required | format `describe > it name` |
| summary | string | required, ≤200 chars | first line of failure message |
| severity | "blocking" | required, locked | always blocking — a failing test is by definition blocking |
| detail | string | optional | trimmed stack trace |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| — | — | — | TOON rows; consumer iterates linearly |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| TestFinding | ConvergenceFindings.findings[] | aggregated | aggregated |

### BotReviewFinding

Per-inline-comment row produced by per-bot PR adapters.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| id | string | required, unique within iteration | format `B-NNN` |
| locationPath | string | required | path from `gh pulls/{n}/comments .path` |
| locationAnchor | string | required | format `:{line}` |
| summary | string | required, ≤200 chars | first line of comment body |
| severity | enum: "blocking", "warning", "info" | required | parsed from inline image tag `![high|medium|low]` |
| botName | string | required | one of: `gemini`, `coderabbit`, `copilot` |
| commentId | string | required | upstream bot comment ID for dedup |
| dedupeKey | string | derived | `${locationPath}:${locationAnchor}:${summary}` |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| idx_botFinding_dedupeKey | dedupeKey | INDEX | OQ-04 cross-iteration dedup |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| BotReviewFinding | ConvergenceFindings.findings[] | aggregated | aggregated |

### PrState

Synthetic-subject file maintained by `scripts/pr-review-harness.ts` per OQ-05's resolution path (treat PR as virtual file).

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| prNumber | integer | required, ≥1 | from `gh pr view --json number` |
| headSha | string | required | 40-char SHA |
| baseSha | string | required | 40-char SHA |
| diffHash | string | required | sha256 of `gh pr diff` output |
| commentIds | string[] | required | seen-bot-comment IDs for dedup |
| baselineTimestamp | string | required | ISO 8601; cutoff for new bot reviews |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| — | — | — | TOON file at `.plan-execution/pr-state.toon` |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| PrState | iteration snapshot | engine snapshots verbatim | engine snapshots verbatim |

### DebugSymptom

Input to `agents/debug-investigator-agent.md`.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| symptomType | enum: "failing-test", "error-log", "repro-script" | required | router for investigator strategy |
| symptomPath | string | required | path to test file / log file / repro script |
| reproduceCommand | string | required | bash command the harness re-runs |
| reproduceExitCode | integer | required | exit code that signals "symptom present" |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| — | — | — | passed inline to harness |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| — | — | — | — |

## API Specification

This plan ships scripts + agents + slash commands, not HTTP endpoints. The "API surface" is therefore the wrapper command CLI contract and the harness invocation contract.

### CMD /loom-code review --autoconverge [subject...]

**Description:** F-01 wrapper. Generates a document-mode `converge.config` for code-review convergence and invokes the driver.
**Auth:** none (local CLI)

**Path parameters:** none

**Query parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| --max-iterations | number | no | 3 | C-05 ceiling for code-review |
| --strict-parallelization | flag | no | false | Tighten parallelization-reviewer severity (opt-in per DF-01) |
| --auto | flag | no | false | Non-interactive; halt-on-scope-expansion still active |

**Request body:** N/A (positional args = file paths to review)

**Success response:** Exit code 0 if driver returns `status: converged`
```json
{
  "status": "converged | stalled | halted",
  "iterations": "number",
  "configPath": "string",
  "summaryPath": ".plan-execution/convergence/convergence-summary.toon"
}
```

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 1 | VALIDATION_ERROR | No subject paths provided or paths don't exist |
| 2 | DRIVER_FAILED | Driver halted with non-converged status (stall, regression, scope expansion) |
| 3 | INTEGRATOR_UNAVAILABLE | `fixer-agent` missing Integrator Mode |
| 4 | INTERNAL_ERROR | Unhandled exception in wrapper |

**Behavior notes:**
- Wrapper writes generated config to `.plan-execution/convergence/code-review.config.toon`
- `snapshotEnabled: true` always set explicitly (per DF-02 resolution)
- Spawn-count ceiling: `1 + 3 × (9 + 1) = 31` (9 reviewers + 1 fixer per iter, max 3 iters)

### CMD /loom-test --autoconverge [target]

**Description:** F-02 wrapper. Runs the test harness in a convergence loop until all tests pass.
**Auth:** none

**Path parameters:** none

**Query parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| --runner | string | no | "bun" | One of: bun, vitest, pytest |
| --max-iterations | number | no | 5 | C-05 ceiling for test convergence |
| --auto | flag | no | false | Non-interactive |

**Request body:** N/A (positional `target` = test path or test directory)

**Success response:** Exit code 0 if all tests pass within `maxIterations`
```json
{
  "status": "converged | stalled | halted",
  "iterations": "number",
  "passingTests": "number",
  "failingTests": "number",
  "summaryPath": "string"
}
```

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 1 | VALIDATION_ERROR | Target path missing; unknown `--runner` value |
| 2 | DRIVER_FAILED | Loop halted unconverged |
| 3 | RUNNER_NOT_FOUND | `--runner` binary not on PATH |
| 4 | INTERNAL_ERROR | Unhandled exception |

**Behavior notes:**
- Each failure row → one ConvergenceFindings entry with `severity: blocking`
- Stack traces truncated to first 20 lines in `detail` field
- Spawn ceiling: `1 + 5 × 2 = 11` (1 test-run + 1 fixer per iter)

### CMD /loom-bugfix --autoconverge [symptom]

**Description:** F-03 wrapper. Investigator → fix-applier loop terminating when symptom no longer reproduces.
**Auth:** none

**Path parameters:** none

**Query parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| --symptom-type | enum | yes | — | failing-test \| error-log \| repro-script |
| --reproduce-cmd | string | yes | — | Bash command to re-run; non-zero exit = symptom present |
| --max-iterations | number | no | 4 | |
| --auto | flag | no | false | |

**Request body:** N/A

**Success response:** Exit code 0 when symptom no longer reproduces
```json
{
  "status": "converged | stalled | halted",
  "iterations": "number",
  "rootCause": "string | null",
  "fixDescription": "string | null"
}
```

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 1 | VALIDATION_ERROR | Missing `--symptom-type` or `--reproduce-cmd` |
| 2 | DRIVER_FAILED | Symptom never resolved within `maxIterations` |
| 4 | INTERNAL_ERROR | Unhandled exception |

**Behavior notes:**
- OQ-01 resolution: synthetic-finding workaround. Harness emits `severity: blocking, summary: "symptom still reproduces"` when reproduce command exits non-zero; emits nothing (or only investigator's findings) when it exits 0. Driver's existing `blockingCount == 0` termination then fires naturally — no schema extension needed.
- Spawn ceiling: `1 + 4 × 2 = 9`

### CMD /loom-git review-pr --autoconverge

**Description:** F-04 wrapper. External bot (Gemini priority-1, CodeRabbit/Copilot deferred) convergence loop over the current PR.
**Auth:** none (uses `gh` CLI auth)

**Path parameters:** none

**Query parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| --bot | enum | no | "gemini" | gemini \| coderabbit \| copilot (latter two: design only) |
| --pr | number | no | auto-detect | PR number; falls back to `gh pr view --json number` |
| --max-iterations | number | no | 5 | Matches manual PR #19 trajectory |
| --auto | flag | no | false | |

**Request body:** N/A

**Success response:** Exit code 0 when bot reports zero findings (after dedup)
```json
{
  "status": "converged | stalled | halted",
  "iterations": "number",
  "prNumber": "number",
  "commitsPushed": "number",
  "botName": "string"
}
```

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 1 | VALIDATION_ERROR | No PR detected and `--pr` not supplied |
| 2 | DRIVER_FAILED | Loop halted unconverged |
| 3 | BOT_UNAVAILABLE | Bot adapter not found or bot response timeout |
| 5 | GH_AUTH_FAILED | `gh` CLI not authenticated |
| 4 | INTERNAL_ERROR | Unhandled exception |

**Behavior notes:**
- OQ-02 resolution: harness writes `pr-state.toon` as synthetic subject (engine sees it as a file).
- OQ-04 resolution: adapter reads prior iteration's findings.toon and suppresses entries with matching `(locationPath, locationAnchor, summary)`.
- OQ-05 resolution: per-iteration commits with `fix(pr-iter-{N}/{botName}): {summary}`; PR squash-on-merge produces single combined commit.
- Spawn ceiling: `1 + 5 × 2 = 11` (1 bot-poll + 1 pr-fixer per iter)

### HARNESS-CONTRACT (all four harnesses)

**Description:** Common invocation contract every harness honors. Driver invokes it once per iteration.
**Auth:** n/a (subprocess)

**Request body (env vars / argv):**
| Field | Type | Required | Constraints | Default |
|-------|------|----------|-------------|---------|
| SUBJECT | string | yes | path | — |
| OUTPUT_PATH | string | yes | path under `.plan-execution/convergence/iterations/` | — |
| ITERATION | integer | yes | ≥1 | — |
| CONFIG_PATH | string | yes | path to converge.config | — |

**Success response:** Exit code 0 + a valid `findings.toon` written to `OUTPUT_PATH`.

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 1 | HARNESS_INVALID_OUTPUT | Output file missing or malformed TOON |
| 2 | HARNESS_RUNTIME_ERROR | Internal harness failure |

**Behavior notes:**
- All four harnesses import `scripts/lib/aggregate-findings.ts` to enforce findings.schema.md compliance
- All harnesses respect `convergeConfig.snapshotEnabled` by writing through the existing iteration-snapshot helper

## State Machines

The only entity in this plan with a lifecycle is the convergence loop itself, but that lifecycle lives in the locked driver (`agents/convergence-driver.md`) and is out of scope per CA-01. The new entities (TestFinding, BotReviewFinding, PrState, DebugSymptom, IntegratorModeInput) are all value objects with no state field, so no state-machine subsection is required by `spec.schema.md`. The driver's existing state machine (PENDING → ITERATING → CONVERGED|STALLED|HALTED) is referenced unchanged.

## Error Handling Specification

### Error Response Format

All wrapper commands and harnesses report errors via TOON-formatted `convergence-summary.toon` (driver level) or per-iteration `findings.toon` (harness level). Wrapper CLI exit codes follow this map; structured error objects in `convergence-summary.toon` follow:

```toon
error:
  code: string
  message: string
  details:
```

### Error Categories

| Code | HTTP/Exit | When Used | Retryable |
|------|-----------|-----------|-----------|
| VALIDATION_ERROR | 1 | Wrapper CLI args missing or invalid; converge.config malformed | No — fix the invocation |
| DRIVER_FAILED | 2 | Driver returned non-converged terminal state (stalled, regressed, scope-expanded) | No — review summary |
| INTEGRATOR_UNAVAILABLE | 3 | Configured integrator agent missing or lacks Integrator Mode | No — install/extend agent |
| RUNNER_NOT_FOUND | 3 | Test runner binary not on PATH (F-02) | No — install runner |
| BOT_UNAVAILABLE | 3 | PR-review bot adapter missing or bot reply timeout (F-04) | Yes — re-run after bot delay |
| GH_AUTH_FAILED | 5 | `gh` CLI not authenticated (F-04) | Yes — re-auth and retry |
| HARNESS_INVALID_OUTPUT | 1 (in harness) | Harness wrote malformed findings.toon | No — fix harness bug |
| HARNESS_RUNTIME_ERROR | 2 (in harness) | Internal harness exception | Yes — transient |
| INTERNAL_ERROR | 4 | Unhandled exception in wrapper or agent | Yes — transient |

### Field-Level Validation Errors

When wrappers reject CLI arguments, error `details` contains a `fields` map naming the offending flag and the constraint:

```toon
error:
  code: VALIDATION_ERROR
  message: CLI argument validation failed
  details:
    fields:
      --runner: Must be one of bun, vitest, pytest
      --symptom-type: Required for /loom-bugfix --autoconverge
```

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| BOT_UNAVAILABLE (F-04 bot poll) | Exponential backoff (5s, 15s, 45s) | 3 |
| HARNESS_RUNTIME_ERROR | Immediate retry once | 1 |
| Validation / driver-halt errors | No retry | 0 |

## Configuration Specification

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| LOOM_CONVERGE_MAX_ITERATIONS | number | — (per-app default) | no | Override `--max-iterations` flag globally |
| LOOM_CONVERGE_SNAPSHOT_DIR | string | `.plan-execution/convergence/iterations/` | no | Snapshot output dir |
| GH_TOKEN | string | — | yes (F-04 only) | `gh` CLI authentication |
| BUN_BINARY | string | `bun` | no | Path to bun runtime for harness execution |

### Validation

- `LOOM_CONVERGE_MAX_ITERATIONS` must be 1-10
- `GH_TOKEN` required only when invoking F-04's `/loom-git review-pr --autoconverge`
- `LOOM_CONVERGE_SNAPSHOT_DIR` parent must exist and be writable

### Config Loading

Wrappers read environment variables at invocation time and merge into the generated `converge.config.toon`. CLI flags take precedence over env vars; env vars take precedence over per-application defaults.

## Execution Phases

### Phase 0 — Wave 0: Contracts & Shared Schemas

**Agent:** contracts-agent
**Objective:** Establish the shared types (IntegratorModeInput, TestFinding, BotReviewFinding, PrState, DebugSymptom, ConvergeConfigDocument) and the harness invocation contract that all four applications consume.
**Dependencies:** None
**File Ownership:** agents/protocols/integrator-mode.schema.md, agents/protocols/harness-contract.schema.md, scripts/lib/types/convergence-applications.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/integrator-mode.schema.md | Create | contracts-agent |
| agents/protocols/harness-contract.schema.md | Create | contracts-agent |
| scripts/lib/types/convergence-applications.ts | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `agents/protocols/integrator-mode.schema.md` defines IntegratorModeInput exactly as in Schema section above
- [ ] `agents/protocols/harness-contract.schema.md` documents the four env vars (SUBJECT, OUTPUT_PATH, ITERATION, CONFIG_PATH) and the exit-code contract
- [ ] `scripts/lib/types/convergence-applications.ts` exports TypeScript interfaces matching every entity in the Schema section
- [ ] `bun run tsc --noEmit` exits with code 0 against the new types
- [ ] No file in the deliverables list is referenced by any existing implementation yet (Wave 0 is read-only after this phase)

#### Convergence Targets
- TypeScript declarations compile with `bun run tsc --noEmit` exit code 0
- Schema files parse as valid markdown + YAML frontmatter

#### Scenarios

```toon
id: S-01
title: Contract types compile cleanly
given[1]: scripts/lib/types/convergence-applications.ts is present with all entity interfaces
when: Developer runs bun run tsc --noEmit at repo root
whenTriggerType: api-call
then[1]: Process exits with code 0
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Integrator-mode schema is loadable
given[1]: agents/protocols/integrator-mode.schema.md exists
when: A markdown linter parses the file
whenTriggerType: api-call
then[2]: No syntax errors are reported, The frontmatter YAML parses to an object containing fields findingsPath, subjectPath, roadmapPath, iterationNumber
tags[1]: happy-path
testTier: unit
automatable: true
```

### Phase 1 — Wave 1: fixer-agent Integrator Mode Extension

**Agent:** implementer-agent
**Objective:** Extend `agents/fixer-agent.md` with an Integrator Mode that consumes IntegratorModeInput and writes atomic revisions to `subjectPath`. Mirrors Phase 8's extension of plan-builder-agent (OQ-03: single-agent + new mode, locked).
**Dependencies:** Phase 0
**File Ownership:** agents/fixer-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/fixer-agent.md | Modify | implementer-agent |

#### Acceptance Criteria
- [ ] `agents/fixer-agent.md` contains a new `## Integrator Mode` section documenting input contract (findingsPath + subjectPath + optional roadmapPath + iterationNumber) and output contract (atomic write via `.tmp` + rename, AgentResult envelope listing every finding `id` addressed)
- [ ] Mode-disambiguation table is added: which input shape triggers Integrator Mode vs. normal code-fix mode
- [ ] Error code list includes INTEGRATOR_MODE_AMBIGUOUS, FINDINGS_SCHEMA_INVALID, SUBJECT_UNREADABLE
- [ ] No changes to `agents/convergence-driver.md` (CA-01 enforced)

#### Convergence Targets
- `agents/fixer-agent.md` contains the substring `## Integrator Mode`
- Diff against base branch shows zero modifications to `agents/convergence-driver.md`

#### Scenarios

```toon
id: S-03
title: fixer-agent Integrator Mode addresses a blocking finding
given[2]: A findings.toon with one blocking finding referencing locationAnchor in src/foo.ts exists, src/foo.ts is writable
when: The driver invokes fixer-agent with findingsPath and subjectPath inputs
whenTriggerType: actor-action
then[3]: fixer-agent writes a revised src/foo.ts atomically via .tmp + rename, AgentResult.filesModified contains src/foo.ts, AgentResult.integrationNotes lists the finding id as addressed
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-04
title: fixer-agent halts on ambiguous integrator-mode input
given[1]: fixer-agent is invoked with neither findingsPath nor a code-fix task description
when: The agent runs
whenTriggerType: actor-action
then[2]: Agent returns status failure, issues[] contains a row with code INTEGRATOR_MODE_AMBIGUOUS
tags[1]: error
testTier: integration
automatable: true
```

### Phase 2 — Wave 2: F-01 Code-Review Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/code-review-harness.ts` (runs the 9+ reviewers `/loom-code review` already spawns and emits findings.toon) plus the `/loom-code review --autoconverge` wrapper command.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** scripts/code-review-harness.ts, ~/.claude/commands/loom-code-review-autoconverge.md, scripts/lib/severity-mapping.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/code-review-harness.ts | Create | implementer-agent |
| scripts/lib/severity-mapping.ts | Create | implementer-agent |
| ~/.claude/commands/loom-code-review-autoconverge.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/code-review-harness.ts` invoked with SUBJECT + OUTPUT_PATH + ITERATION env vars exits with code 0 and writes a findings.toon conforming to findings.schema.md
- [ ] Findings include `reviewerAgent` attribution preserved per W-03
- [ ] Wrapper `/loom-code review --autoconverge` generates a `converge.config.toon` with `snapshotEnabled: true`, `maxIterations: 3`, `integrator: fixer-agent`, `harness: scripts/code-review-harness.ts`
- [ ] Wrapper invokes `/loom-converge --config <path>` and propagates `--auto` honestly
- [ ] `--strict-parallelization` flag is wired through to harness env (opt-in tightening per DF-01)
- [ ] Spawn-count ceiling holds at `1 + 3 × (9+1) = 31` in fixture run

#### Convergence Targets
- `bun run scripts/code-review-harness.ts` against a fixture exits 0
- Generated `converge.config.toon` deep-equals the expected shape (ignore timestamps)
- `/loom-code review --autoconverge` against a fixture converges in ≤3 iterations

#### Scenarios

```toon
id: S-05
title: Code-review harness emits canonical findings.toon
given[2]: A subject file with 2 reviewer-flagged blocking issues exists, scripts/code-review-harness.ts is built
when: The harness is invoked with SUBJECT, OUTPUT_PATH, ITERATION=1
whenTriggerType: api-call
then[3]: Exit code is 0, OUTPUT_PATH contains a findings.toon with 2 blocking findings, Each finding row carries a reviewerAgent attribution field
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-06
title: /loom-code review --autoconverge generates a valid converge.config
given[1]: A user runs /loom-code review --autoconverge src/foo.ts --max-iterations 3
when: The wrapper executes
whenTriggerType: actor-action
then[3]: A file at .plan-execution/convergence/code-review.config.toon exists, config.snapshotEnabled is true, config.maxIterations is 3
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-07
title: Strict-parallelization flag tightens reviewer severity
given[1]: scripts/code-review-harness.ts is invoked with LOOM_STRICT_PARALLELIZATION=true
when: A same-wave shared-file write is detected by parallelization-reviewer
whenTriggerType: api-call
then[1]: The resulting finding has severity blocking instead of warning
tags[2]: edge-case, regression
testTier: integration
automatable: true
```

### Phase 3 — Wave 2: F-02 Test-Run Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/test-harness.ts` (parses bun test / vitest / pytest output → findings.toon) plus the `/loom-test --autoconverge` wrapper.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** scripts/test-harness.ts, ~/.claude/commands/loom-test-autoconverge.md, scripts/lib/test-output-parsers/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/test-harness.ts | Create | implementer-agent |
| scripts/lib/test-output-parsers/bun.ts | Create | implementer-agent |
| scripts/lib/test-output-parsers/vitest.ts | Create | implementer-agent |
| scripts/lib/test-output-parsers/pytest.ts | Create | implementer-agent |
| ~/.claude/commands/loom-test-autoconverge.md | Create | implementer-agent |
| test-fixtures/test-convergence-seed/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/test-harness.ts` against the seeded fixture writes findings.toon with one TestFinding row per failure
- [ ] `--runner` flag dispatches to the correct parser; invalid runner returns RUNNER_NOT_FOUND
- [ ] Each TestFinding has `severity: "blocking"`, `locationPath` = test file, `locationAnchor` = "describe > it name"
- [ ] Fixture seeded-failure repo converges in exactly 2 iterations via `/loom-test --autoconverge` (matches roadmap acceptance)
- [ ] Spawn ceiling holds at `1 + 5 × 2 = 11`

#### Convergence Targets
- Test-harness against seeded fixture exits 0 with findings.toon containing expected failures
- Fixture autoconverge run reports `iterations: 2, status: converged`

#### Scenarios

```toon
id: S-08
title: Test harness emits one finding per failure
given[2]: Seeded fixture has 2 failing tests in test-fixtures/test-convergence-seed/, scripts/test-harness.ts is built
when: The harness runs with SUBJECT=test-fixtures/test-convergence-seed/ and --runner=bun
whenTriggerType: api-call
then[3]: findings.toon at OUTPUT_PATH lists 2 blocking findings, Each locationAnchor follows the "describe > it name" format, Each summary is ≤200 chars
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-09
title: Test convergence fixture resolves in 2 iterations
given[1]: Seeded fixture under test-fixtures/test-convergence-seed/ contains 2 deterministically-fixable failures
when: A user runs /loom-test --autoconverge test-fixtures/test-convergence-seed/ --max-iterations 5
whenTriggerType: actor-action
then[2]: convergence-summary.toon reports status converged, iterations is 2
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-10
title: Unknown runner is rejected
given[1]: /loom-test --autoconverge is invoked with --runner=cargo
when: The wrapper executes
whenTriggerType: actor-action
then[2]: Exit code is 3, error.code is RUNNER_NOT_FOUND
tags[1]: error
testTier: integration
automatable: true
```

### Phase 4 — Wave 3: F-03 Debug Investigator + Fix-Applier Agents

**Agent:** implementer-agent
**Objective:** Author `agents/debug-investigator-agent.md` and `agents/fix-applier-agent.md`. The investigator emits findings about probable causes; fix-applier is a thin wrapper that delegates to `fixer-agent`'s Integrator Mode with a debug-context preamble.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** agents/debug-investigator-agent.md, agents/fix-applier-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/debug-investigator-agent.md | Create | implementer-agent |
| agents/fix-applier-agent.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `agents/debug-investigator-agent.md` frontmatter sets `model:` to a tier capable of multi-file reasoning
- [ ] Investigator's output contract is documented: findings.toon where `severity` maps from confidence (high→blocking, medium→warning, low→info) plus a synthetic finding `severity: blocking, summary: "symptom still reproduces"` when the reproduce command exits non-zero (OQ-01 resolution)
- [ ] Fix-applier-agent documents that it is a thin wrapper around `fixer-agent` Integrator Mode with an injected debug context (DebugSymptom)
- [ ] Neither agent writes outside its declared file ownership

#### Convergence Targets
- Both agent .md files exist and validate against agent-frontmatter conventions
- No new schema files under `agents/protocols/` are introduced (CA-01 boundary check)

#### Scenarios

```toon
id: S-11
title: Investigator emits synthetic blocking finding when symptom reproduces
given[2]: A DebugSymptom with reproduceCommand exiting non-zero exists, debug-investigator-agent is invoked
when: The investigator runs its analysis and re-checks the symptom
whenTriggerType: actor-action
then[2]: Emitted findings.toon contains a synthetic finding with severity blocking and summary "symptom still reproduces", The investigator's other findings are also included
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-12
title: Investigator omits synthetic finding when symptom is resolved
given[1]: A DebugSymptom with reproduceCommand exiting 0 (already resolved)
when: The investigator runs
whenTriggerType: actor-action
then[2]: Emitted findings.toon does NOT include the synthetic "symptom still reproduces" finding, blockingCount in findings.toon is 0
tags[1]: edge-case
testTier: integration
automatable: true
```

### Phase 5 — Wave 4: F-03 Debug Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/debug-harness.ts` and the `/loom-bugfix --autoconverge` wrapper. Harness invokes investigator, re-runs symptom, and emits findings.toon honoring the synthetic-finding workaround.
**Dependencies:** Phase 0, Phase 1, Phase 4
**File Ownership:** scripts/debug-harness.ts, ~/.claude/commands/loom-bugfix-autoconverge.md, test-fixtures/debug-convergence-seed/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/debug-harness.ts | Create | implementer-agent |
| ~/.claude/commands/loom-bugfix-autoconverge.md | Create | implementer-agent |
| test-fixtures/debug-convergence-seed/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/debug-harness.ts` against the seeded fixture writes findings.toon with the investigator's findings plus the synthetic symptom-status finding
- [ ] Wrapper auto-detects symptomType when `--symptom-type` is omitted only if a single test file is provided; otherwise fails with VALIDATION_ERROR
- [ ] Fixture (seeded-failing-test repo) converges in 2 iterations: iter 1 = investigator identifies cause; iter 2 = fix-applier resolves; reproduce-cmd exits 0; loop CONVERGED
- [ ] Spawn ceiling holds at `1 + 4 × 2 = 9`
- [ ] No driver or schema files modified (CA-01)

#### Convergence Targets
- `bun run scripts/debug-harness.ts` exits 0 on seeded fixture
- Fixture autoconverge run reports `iterations: 2, status: converged`

#### Scenarios

```toon
id: S-13
title: Debug fixture converges in 2 iterations
given[1]: test-fixtures/debug-convergence-seed/ contains a seeded failing test and a known cause
when: User runs /loom-bugfix --autoconverge --symptom-type failing-test --reproduce-cmd "bun test test-fixtures/debug-convergence-seed/" --max-iterations 4
whenTriggerType: actor-action
then[2]: convergence-summary.toon reports status converged, iterations is 2
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-14
title: Missing --reproduce-cmd is rejected
given[1]: User runs /loom-bugfix --autoconverge --symptom-type failing-test (no reproduce-cmd)
when: The wrapper executes
whenTriggerType: actor-action
then[2]: Exit code is 1, error.code is VALIDATION_ERROR with details.fields["--reproduce-cmd"] set
tags[1]: error
testTier: integration
automatable: true
```

### Phase 6 — Wave 3: F-04 Gemini Adapter + Shared PR-Adapter Interface

**Agent:** implementer-agent
**Objective:** Author the shared adapter interface and ship the Gemini adapter (priority-1 per CA-05; consumer Gemini sunsets July 17, 2026). CodeRabbit + Copilot are design-only at this phase.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** scripts/lib/pr-review-adapters/**, scripts/lib/types/pr-adapter.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/lib/types/pr-adapter.ts | Create | implementer-agent |
| scripts/lib/pr-review-adapters/gemini.ts | Create | implementer-agent |
| scripts/lib/pr-review-adapters/coderabbit.ts | Create | implementer-agent |
| scripts/lib/pr-review-adapters/copilot.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `scripts/lib/types/pr-adapter.ts` exports the PrAdapter interface (input: PrState; output: BotReviewFinding[])
- [ ] Gemini adapter posts `/gemini review` via `gh pr comment`, polls `gh api repos/{owner}/{repo}/pulls/{n}/reviews` for a new `gemini-code-assist[bot]` review past baselineTimestamp, fetches inline comments via `gh api .../pulls/{n}/comments`, transforms each comment into a BotReviewFinding (path = `.path`, anchor = `:{line}`, summary = first line of body, severity parsed from `![high|medium|low]` image tag)
- [ ] Gemini adapter reads prior iteration's findings.toon and suppresses entries with matching `(locationPath, locationAnchor, summary)` (OQ-04 dedup, REQUIRED)
- [ ] CodeRabbit + Copilot adapter files exist as stubs that throw `BOT_UNAVAILABLE: not yet implemented` but export the PrAdapter interface (contract locked early per CA-05)
- [ ] No driver or schema files modified

#### Convergence Targets
- `bun run tsc --noEmit` exits 0 against all adapter files
- Gemini adapter unit-tested with mocked `gh` responses passes 100%

#### Scenarios

```toon
id: S-15
title: Gemini adapter transforms inline comments into BotReviewFindings
given[2]: A mocked gh pulls/{n}/comments response with 3 inline comments tagged ![high] ![medium] ![low], scripts/lib/pr-review-adapters/gemini.ts is built
when: The adapter's transform function runs
whenTriggerType: api-call
then[2]: Output contains 3 BotReviewFinding rows, Severities are blocking, warning, info respectively
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-16
title: Gemini adapter dedups stale anchor re-flags
given[2]: Prior iteration findings.toon contains entry (src/foo.ts, :42, "missing semicolon"), Current bot review re-flags same location with same summary
when: The adapter runs its dedup pass
whenTriggerType: api-call
then[1]: The duplicate finding is suppressed and absent from emitted findings.toon
tags[2]: edge-case, regression
testTier: unit
automatable: true
```

```toon
id: S-17
title: CodeRabbit adapter throws BOT_UNAVAILABLE
given[1]: scripts/lib/pr-review-adapters/coderabbit.ts is invoked
when: The adapter runs
whenTriggerType: api-call
then[1]: It throws an error with code BOT_UNAVAILABLE and message indicating "not yet implemented"
tags[1]: error
testTier: unit
automatable: true
```

### Phase 7 — Wave 4: F-04 PR-Review Harness + Wrapper + pr-fixer-agent

**Agent:** implementer-agent
**Objective:** Ship `scripts/pr-review-harness.ts` (dispatcher), `agents/pr-fixer-agent.md`, and the `/loom-git review-pr --autoconverge` wrapper. Harness maintains `pr-state.toon` as the synthetic subject (OQ-02 resolution).
**Dependencies:** Phase 0, Phase 1, Phase 6
**File Ownership:** scripts/pr-review-harness.ts, agents/pr-fixer-agent.md, ~/.claude/commands/loom-git-review-pr-autoconverge.md, test-fixtures/pr-convergence-canned/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/pr-review-harness.ts | Create | implementer-agent |
| agents/pr-fixer-agent.md | Create | implementer-agent |
| ~/.claude/commands/loom-git-review-pr-autoconverge.md | Create | implementer-agent |
| test-fixtures/pr-convergence-canned/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `scripts/pr-review-harness.ts` reads `converge.config.applicationContext.botAdapter` and dispatches to the matching adapter
- [ ] Harness writes `pr-state.toon` (PrState entity) as the subject file at the path the driver expects; first action of each iteration refreshes headSha, baseSha, diffHash via `gh` CLI
- [ ] `agents/pr-fixer-agent.md` documents an input contract of findings.toon + PR diff context (fetched via `gh pr diff`) and writes revisions to the working tree
- [ ] Wrapper auto-detects PR number via `gh pr view --json number`; falls back to `--pr` flag
- [ ] Wrapper commits per-iteration with message `fix(pr-iter-{N}/{botName}): {summary}` (OQ-05)
- [ ] Canned-bot fixture under `test-fixtures/pr-convergence-canned/` converges in 2 iterations
- [ ] Spawn ceiling: `1 + 5 × 2 = 11`
- [ ] No driver or schema files modified

#### Convergence Targets
- `bun run scripts/pr-review-harness.ts` against the canned fixture exits 0
- Canned fixture autoconverge run reports `iterations: 2, status: converged`
- `pr-state.toon` is the only file the engine snapshots (clean abstraction confirmed)

#### Scenarios

```toon
id: S-18
title: PR-review harness writes pr-state.toon as synthetic subject
given[1]: A current PR exists and gh CLI is authenticated
when: scripts/pr-review-harness.ts is invoked for iteration 1
whenTriggerType: api-call
then[3]: pr-state.toon is written at the path declared by SUBJECT, It contains prNumber, headSha, baseSha, diffHash, baselineTimestamp, The file conforms to the PrState schema
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-19
title: PR convergence on canned fixture resolves in 2 iterations
given[1]: test-fixtures/pr-convergence-canned/ contains a canned Gemini-response sequence converging in 2 rounds
when: User runs /loom-git review-pr --autoconverge --bot gemini --pr 999 --max-iterations 5
whenTriggerType: actor-action
then[2]: convergence-summary.toon reports status converged, iterations is 2
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-20
title: Auto-detect PR number when --pr is omitted
given[1]: gh pr view --json number returns {"number": 42}
when: User runs /loom-git review-pr --autoconverge --bot gemini (no --pr)
whenTriggerType: actor-action
then[1]: The generated converge.config has applicationContext.prNumber set to 42
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-21
title: Missing gh auth halts gracefully
given[1]: GH_TOKEN is unset and gh CLI returns auth-failed
when: User runs /loom-git review-pr --autoconverge
whenTriggerType: actor-action
then[2]: Exit code is 5, error.code is GH_AUTH_FAILED
tags[1]: error
testTier: integration
automatable: true
```

### Phase 8 — Wave 5: Documentation, Disambiguation, README

**Agent:** implementer-agent
**Objective:** Add README rows disambiguating `/loom-code review --autoconverge` from existing `/loom-code fix`; document the locked `--autoconverge` convention across all five applications; cross-link the four new wrappers from the existing convergence docs.
**Dependencies:** Phase 2, Phase 3, Phase 5, Phase 7
**File Ownership:** README.md, docs/convergence-applications.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| README.md | Modify | implementer-agent |
| docs/convergence-applications.md | Create | implementer-agent |

#### Acceptance Criteria
- [ ] README contains a disambiguation table row distinguishing `/loom-code review --autoconverge` (this roadmap) from `/loom-code fix` (existing one-shot)
- [ ] README documents that `--autoconverge` is the locked flag name across plan-creation, code-review, test-run, debug, and PR-review (CA-06)
- [ ] `docs/convergence-applications.md` summarizes each application's harness path, integrator, default maxIterations, and spawn ceiling
- [ ] All cross-links to the four wrapper commands resolve to existing slash-command files

#### Convergence Targets
- README diff includes the disambiguation table row (text-diff target)
- `docs/convergence-applications.md` lists exactly 5 applications (plan-creation + F-01..F-04)

#### Scenarios

```toon
id: S-22
title: README disambiguates review vs fix
given[1]: README.md has been modified by Phase 8
when: A reader greps README.md for "/loom-code review --autoconverge" and "/loom-code fix"
whenTriggerType: api-call
then[2]: Both strings appear, A table row clearly separates their semantics
tags[1]: happy-path
testTier: unit
automatable: true
```

### Phase 9 — Wave 5: Wiring & Registry Updates

**Agent:** wiring-agent
**Objective:** Register the four new slash commands and three new agents (`debug-investigator-agent`, `fix-applier-agent`, `pr-fixer-agent`) in `skills/library.yaml` and `.claude/orchestration.toml` registries; wire the four wrappers' file paths into any kit definitions that ship them.
**Dependencies:** Phase 2, Phase 3, Phase 5, Phase 7
**File Ownership:** skills/library.yaml, .claude/orchestration.toml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/library.yaml | Modify | wiring-agent |
| .claude/orchestration.toml | Modify | wiring-agent |

#### Acceptance Criteria
- [ ] `skills/library.yaml` contains `library.agents:` entries for `debug-investigator-agent`, `fix-applier-agent`, `pr-fixer-agent`
- [ ] `skills/library.yaml` contains `library.prompts:` entries for the four new `/loom-*` commands
- [ ] `.claude/orchestration.toml` integrator-registry entry maps each application to its configured integrator (F-01, F-02, F-04 → `fixer-agent`; F-03 → `fix-applier-agent`)
- [ ] `bun run scripts/validate-library.ts` (or equivalent) exits with code 0

#### Convergence Targets
- `skills/library.yaml` YAML parses and contains all expected new keys
- `.claude/orchestration.toml` TOML parses and integrator-registry table is complete

#### Scenarios

```toon
id: S-23
title: Library registers all four new wrappers
given[1]: skills/library.yaml has been edited by Phase 9
when: A YAML parser loads it
whenTriggerType: api-call
then[2]: library.prompts contains entries for loom-code-review-autoconverge, loom-test-autoconverge, loom-bugfix-autoconverge, loom-git-review-pr-autoconverge, library.agents contains entries for debug-investigator-agent, fix-applier-agent, pr-fixer-agent
tags[1]: happy-path
testTier: unit
automatable: true
```

### Phase 10 — Wave 5: End-to-End Convergence Fixture Sweep

**Agent:** implementer-agent
**Objective:** Author an integration script that runs each of the four `/loom-*-autoconverge` wrappers against its fixture and asserts convergence + spawn-ceiling adherence. Final acceptance gate before merge.
**Dependencies:** Phase 8, Phase 9
**File Ownership:** scripts/test-convergence-applications.ts, .github/workflows/convergence-applications.yml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/test-convergence-applications.ts | Create | implementer-agent |
| .github/workflows/convergence-applications.yml | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/test-convergence-applications.ts` runs all four fixtures sequentially and asserts each reports `status: converged`
- [ ] Script captures per-application spawn count and asserts `≤ 1 + maxIterations × spawnsPerIter`
- [ ] Script re-reads `convergence-summary.toon` shape from all five applications (plan-creation + F-01..F-04) and asserts they share the same circuit-breaker enum and summary shape (Success Metric #4 from roadmap)
- [ ] GitHub Actions workflow runs the sweep on every push to main

#### Convergence Targets
- `bun run scripts/test-convergence-applications.ts` exits 0
- All four `convergence-summary.toon` outputs deep-equal the expected shape (ignore: timestamps, runIds)

#### Scenarios

```toon
id: S-24
title: End-to-end sweep converges all four applications
given[1]: All four fixtures and wrappers exist
when: bun run scripts/test-convergence-applications.ts is executed
whenTriggerType: api-call
then[2]: Process exits with code 0, Each application's convergence-summary.toon reports status converged
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-25
title: All five applications share circuit-breaker enum
given[1]: convergence-summary.toon files from plan-creation, F-01, F-02, F-03, F-04 fixture runs exist
when: The sweep script reads each summary's circuitBreaker.enum field
whenTriggerType: api-call
then[1]: The enum values are identical across all five applications
tags[2]: happy-path, regression
testTier: e2e
automatable: true
```

```toon
id: S-26
title: Spawn-count ceiling enforced for F-02
given[1]: /loom-test --autoconverge fixture is configured with maxIterations=5
when: The sweep captures spawn count for the F-02 run
whenTriggerType: api-call
then[1]: Captured spawn count is ≤ 11
tags[2]: edge-case, regression
testTier: e2e
automatable: true
```

## Verification Commands

```bash
bun run tsc --noEmit
bun run vitest run scripts/lib/
bun run scripts/test-convergence-applications.ts
bun run scripts/validate-library.ts
```

## Acceptance Criteria (Final)

- [ ] All four new wrappers (`/loom-code review --autoconverge`, `/loom-test --autoconverge`, `/loom-bugfix --autoconverge`, `/loom-git review-pr --autoconverge`) exist and pass their fixtures
- [ ] `fixer-agent` Integrator Mode is documented and exercised by F-01, F-02, F-04
- [ ] `debug-investigator-agent`, `fix-applier-agent`, `pr-fixer-agent` exist and are registered
- [ ] Zero modifications to `agents/convergence-driver.md`, `agents/protocols/findings.schema.md`, `iteration-snapshot.schema.md`, `convergence-summary.schema.md` (CA-01 enforced via diff)
- [ ] End-to-end fixture sweep exits 0
- [ ] Success Metric #4 verified: all five applications share circuit-breaker enum + summary shape
- [ ] Spawn-count ceilings hold per application

## Milestones

### M-01: Code-Review + Test-Run Convergence

**Phases:** 0, 1, 2, 3
**Waves:** 0, 1, 2
**Acceptance:** F-01 + F-02 wrappers exist, fixtures pass, `fixer-agent` Integrator Mode locked, no driver/schema changes.

### M-02: Debug Convergence (custom termination)

**Phases:** 4, 5
**Waves:** 3, 4
**Depends on:** M-01
**Acceptance:** Investigator + fix-applier ship; OQ-01 synthetic-finding workaround proven via fixture; no engine change.

### M-03: PR-Review Convergence (Gemini priority-1)

**Phases:** 6, 7
**Waves:** 3, 4
**Depends on:** M-01
**Acceptance:** Gemini adapter ships; canned-bot fixture converges in 2 iterations; OQ-02 synthetic-subject workaround proven; CodeRabbit/Copilot stubs lock the adapter contract.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| CA-01 violation: a phase touches `agents/convergence-driver.md` or a frozen schema | high | Phase 10's sweep script asserts no diff against those files; CI fails the PR |
| OQ-04 dedup gap causes loop oscillation in F-04 | high | Phase 6 acceptance criterion requires dedup wired in adapter; S-16 covers regression |
| Gemini sunsets July 17, 2026 before F-04 ships | medium | Phase 6 prioritizes Gemini adapter ahead of CodeRabbit/Copilot stubs; M-03 critical path is short |
| Spawn-count explosion when reviewers fan out | medium | Per-phase ceiling asserted by S-26-style scenarios; CI runs sweep on every push |
| Wave 3 parallelism (Phase 4 + Phase 6) shares no files but both depend on Phase 1 fixer-agent edit | low | File ownership audited in Phase 9 wiring; Phases 4 and 6 read fixer-agent but never write |

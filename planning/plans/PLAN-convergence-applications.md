---
planVersion: 2
name: "Convergence Applications — Wire 4 Harness+Integrator Pairs"
status: draft
created: 2026-06-14
lastReviewed: null
roadmapRef: planning/ROADMAP-convergence-applications.md
totalPhases: 9
totalWaves: 4
---

# Plan: Convergence Applications — Wire 4 Harness+Integrator Pairs

## Overview

Wires four new applications (code-review, test-run, debug, PR-review) onto the frozen document-mode `convergence-driver` substrate shipped by the convergence-generalization plan. Each application is a self-contained `(harness + integrator + wrapper)` triple — no driver changes, no schema extensions. Per CA-02, F-01..F-04 share no files and run in parallel waves after a single shared contracts pass.

## Tech Stack

- TypeScript, executed via **bun** (precedent: `scripts/plan-review-harness.ts`)
- Tests: **vitest** under `test/`
- Linting: `bun run lint`; type-check: `tsc --noEmit`
- On-disk artifacts: **TOON** (per CLAUDE.md)
- Shared helpers (reused verbatim, never modified by this plan):
  - `scripts/lib/aggregate-findings.ts` — severity mapping + finding aggregation
  - `hooks/lib/iteration-snapshot.ts` — per-iteration subject snapshot
- External tooling: `gh` CLI (F-04 only), `bun test` / `vitest` / `pytest` (F-02 only)

## Schema / Type Definitions

### ConvergenceFindings (existing, locked — referenced verbatim per CA-01)

Defined in `agents/protocols/findings.schema.md`. Each harness in this plan emits a `findings.toon` document conforming to that schema. The columns below are restated as the **row shape every new harness MUST produce** so the agents can wire correctly without re-reading the locked schema.

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| id | string | `F-NN`, unique within the iteration | regex `^F-\d{2,}$` |
| severity | enum | one of `blocking`, `warning`, `info` | must match enum |
| locationPath | string | repo-relative path (file or virtual pseudo-path) | non-empty |
| locationAnchor | string | line ref (`:N`), header anchor, or `describe > it` selector | non-empty |
| summary | string | one-line human description | 1-200 chars |
| suggestion | string | optional fix hint | 0-500 chars |
| reviewerAgent | string | attribution token (e.g., `gemini`, `bun-test`, `debug-investigator-agent`) | non-empty |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_finding | id | PRIMARY | Row lookup inside the iteration |
| idx_dedup | locationPath, locationAnchor, summary | COMPOUND | Used by F-04 Gemini adapter for cross-iteration dedup per OQ-04 |

#### Cascade Behavior

No FK relationships — `findings.toon` is a leaf artifact; lifetime is bounded by `.plan-execution/convergence/iterations/iter-{N}.toon`.

### F-01 finding row variant (code-review)

| Column | Source | Notes |
|--------|--------|-------|
| severity | reviewer envelope `severity` → `severityToConvergenceSeverity()` | preserves W-03 mapping |
| locationPath | reviewer envelope `findings[].filePath` | repo-relative |
| locationAnchor | reviewer envelope `findings[].line` formatted as `:N` | `:0` when whole-file |
| reviewerAgent | name of the reviewer (`code-reviewer`, `security-reviewer`, etc.) | one of the 9+ reviewers `/loom-code review` spawns |

### F-02 finding row variant (test-run)

| Column | Source | Notes |
|--------|--------|-------|
| severity | always `blocking` | every test failure blocks |
| locationPath | test file path from runner output | runner-specific parsing |
| locationAnchor | `"{describe chain} > {it name}"` | matches vitest/bun convention |
| summary | first line of failure message | stripped of ANSI |
| reviewerAgent | `bun-test` \| `vitest` \| `pytest` | from `--runner` flag |

### F-03 finding row variant (debug)

| Column | Source | Notes |
|--------|--------|-------|
| severity | investigator confidence → `high=blocking`, `medium=warning`, `low=info` | per F-03 acceptance |
| **synthetic symptom-still-reproduces row** | emitted by harness re-run step | `severity=blocking, summary="symptom still reproduces", locationPath=<symptomPath>, locationAnchor=":0", reviewerAgent="debug-harness"` (per OQ-01 decision) |
| reviewerAgent | `debug-investigator-agent` for probable causes; `debug-harness` for the synthetic row | distinct |

When the symptom no longer reproduces, the synthetic row is omitted; if the investigator also produced no `blocking` rows, `blockingCount → 0` and the driver declares CONVERGED. **No `customTerminationOutcome` field is added** (OQ-01).

### F-04 finding row variant (PR-review)

| Column | Source | Notes |
|--------|--------|-------|
| severity | parsed from inline image tag `![high\|medium\|low]` → `blocking\|warning\|info` | per F-04 acceptance |
| locationPath | bot comment `.path` | PR-relative |
| locationAnchor | `:{line}` from bot comment `.line` | line-anchored |
| reviewerAgent | bot adapter name (`gemini`, `coderabbit`, `copilot`) | from `botAdapter` config |
| dedup behavior | adapter reads prior iter's `findings.toon` from `.plan-execution/convergence/iterations/iter-{N-1}.toon`; suppresses matching `(locationPath, locationAnchor, summary)` triples | OQ-04 |

### ConvergeConfig (existing, referenced — extended fields per application)

Defined in `agents/protocols/converge.config.schema.md` (existing, locked structurally). Per OQ-02 decision, `subject` MUST resolve to a real file under repo root; F-04 uses a `pr-state.toon` projection.

| Field | F-01 | F-02 | F-03 | F-04 |
|-------|------|------|------|------|
| mode | `document` | `document` | `document` | `document` |
| subject | target file(s) under review | code under test (single file or barrel) | symptom file (failing test path / repro script) | `.plan-execution/pr-review/pr-state.toon` (synthetic, per OQ-02) |
| harness | `scripts/code-review-harness.ts` | `scripts/test-harness.ts` | `scripts/debug-harness.ts` | `scripts/pr-review-harness.ts` |
| integrator | `fixer-agent` (Integrator Mode) | `fixer-agent` (Integrator Mode) | `fix-applier-agent` (== `fixer-agent` in debug context) | `pr-fixer-agent` (extends `fixer-agent`) |
| maxIterations | 3 | 5 | 5 | 5 |
| botAdapter (F-04 only) | — | — | — | `gemini` \| `coderabbit` \| `copilot` |
| prNumber (F-04 only) | — | — | — | integer (resolved by wrapper from `gh pr view`) |
| runner (F-02 only) | — | `bun` \| `vitest` \| `pytest` | — | — |

### IterationSnapshot (existing, locked — referenced)

Defined in `agents/protocols/iteration-snapshot.schema.md`. All four applications snapshot via `hooks/lib/iteration-snapshot.ts` verbatim. F-04's `subject` resolves to `pr-state.toon`, which is a real file — the snapshot mechanism is unchanged (per OQ-02 decision).

### ConvergenceSummary (existing, locked — NOT extended)

Per OQ-01 decision, F-03 uses synthetic-finding workaround instead of the `customTerminationOutcome` field originally proposed in CA-04. The schema is read-only in this plan.

## API Specification

This plan ships no HTTP endpoints. The user-facing surface is **CLI commands and slash-command wrappers**, specified below. (Spec.schema.md treats CLI command specs as the equivalent of endpoint specs for non-HTTP projects; the same field shape is used.)

### CLI: `bun run scripts/code-review-harness.ts`

**Description:** Spawns the same 9+ reviewers `/loom-code review` invokes, aggregates findings, writes `findings.toon`.
**Auth:** none

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subject` | string | yes | — | repo-relative path to file (or comma-list) under review |
| `--output` | string | no | `.plan-execution/convergence/iterations/iter-{N}/findings.toon` | findings output path |
| `--iteration` | number | yes | — | current iteration index (driver supplies) |

**Success:** exit code 0, `findings.toon` written atomically.
**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | REVIEWER_SPAWN_FAILED | A reviewer agent spawn returned non-success |
| 2 | OUTPUT_PATH_UNWRITABLE | Cannot write `findings.toon` |
| 3 | SUBJECT_UNREADABLE | `--subject` path missing |

**Behavior notes:**
- Reviewers run in parallel via existing `/loom-code review` spawn mechanism
- Per-reviewer findings aggregated through `scripts/lib/aggregate-findings.ts` (verbatim)
- `severityToConvergenceSeverity()` mapping preserved per W-03
- Atomic write: `{output}.tmp` → rename → `{output}`

### CLI: `bun run scripts/test-harness.ts`

**Description:** Runs the test runner, parses output, emits one blocking finding per failure.
**Auth:** none

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subject` | string | yes | — | code under test (file or directory) |
| `--runner` | enum | no | `bun` | `bun` \| `vitest` \| `pytest` |
| `--output` | string | no | `.plan-execution/convergence/iterations/iter-{N}/findings.toon` | findings output path |
| `--iteration` | number | yes | — | current iteration index |

**Success:** exit code 0 (regardless of test pass/fail — the harness is a parser, not a gate). `findings.toon` empty `findings[]` array when all tests pass.

**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | RUNNER_SPAWN_FAILED | The test runner binary not found / could not start |
| 2 | RUNNER_OUTPUT_UNPARSEABLE | Stdout did not match expected format for the selected runner |
| 3 | OUTPUT_PATH_UNWRITABLE | Cannot write `findings.toon` |

**Behavior notes:**
- Each failure → 1 finding row: `severity=blocking`, `locationAnchor="{describe} > {it}"`, `summary` is first non-empty line of failure message
- Exit code 0 even when tests fail; the driver reads `blockingCount` to decide
- Runner-specific parser modules under `scripts/lib/test-runners/{bun,vitest,pytest}.ts`

### CLI: `bun run scripts/debug-harness.ts`

**Description:** Invokes the debug investigator, then re-runs the symptom; emits findings.toon with synthetic symptom row per OQ-01.
**Auth:** none

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--symptom` | string | yes | — | failing test path, repro script, or error log file |
| `--subject` | string | yes | — | code file(s) implicated (passed to investigator) |
| `--output` | string | no | `.plan-execution/convergence/iterations/iter-{N}/findings.toon` | findings path |
| `--iteration` | number | yes | — | current iteration index |

**Success:** exit code 0. If the symptom still reproduces, `findings.toon` contains the synthetic blocking row plus any investigator findings. If resolved, synthetic row is omitted.

**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | INVESTIGATOR_SPAWN_FAILED | `debug-investigator-agent` spawn returned non-success |
| 2 | SYMPTOM_UNRUNNABLE | The `--symptom` path is missing or not executable |
| 3 | OUTPUT_PATH_UNWRITABLE | Cannot write `findings.toon` |

**Behavior notes:**
- Symptom re-run step: shell out to the symptom path; non-zero exit means "still reproduces"
- Synthetic finding row when symptom still reproduces: `id=F-99, severity=blocking, summary="symptom still reproduces", reviewerAgent="debug-harness"`
- Convergence triggered when synthetic row absent AND investigator emits no blocking findings → `blockingCount=0`

### CLI: `bun run scripts/pr-review-harness.ts`

**Description:** Dispatcher reading `converge.config.botAdapter`; delegates to a per-bot adapter.
**Auth:** `gh` CLI auth (inherited from environment)

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--config` | string | yes | — | path to `converge.config` |
| `--output` | string | no | `.plan-execution/convergence/iterations/iter-{N}/findings.toon` | findings path |
| `--iteration` | number | yes | — | current iteration index (used by Gemini dedup) |

**Success:** exit code 0; `findings.toon` written; `pr-state.toon` refreshed.

**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | ADAPTER_UNKNOWN | `botAdapter` value not in `{gemini, coderabbit, copilot}` |
| 2 | GH_CLI_UNAVAILABLE | `gh` not on PATH or not authenticated |
| 3 | PR_NOT_FOUND | `prNumber` does not resolve via `gh pr view` |
| 4 | ADAPTER_TIMEOUT | Bot did not produce a review within adapter's poll budget |
| 5 | OUTPUT_PATH_UNWRITABLE | Cannot write findings or pr-state |

**Behavior notes:**
- First action each iteration: refresh `pr-state.toon` (head SHA, base SHA, diff hash, comment IDs) per OQ-02
- Per OQ-04, Gemini adapter dedups against `iter-{N-1}.toon` on `(locationPath, locationAnchor, summary)`
- `pr-state.toon` is the driver's `subject` — atomic write to `.tmp` then rename

### Slash command wrappers

| Command | Generates | Invokes |
|---------|-----------|---------|
| `/loom-code review --autoconverge` | `converge.config` (harness=code-review-harness, integrator=fixer-agent, maxIterations=3) | `/loom-converge --config <path>` |
| `/loom-test --autoconverge` | `converge.config` (harness=test-harness, integrator=fixer-agent, maxIterations=5, runner inferred) | `/loom-converge --config <path>` |
| `/loom-bugfix --autoconverge` | `converge.config` (harness=debug-harness, integrator=fix-applier-agent, maxIterations=5) | `/loom-converge --config <path>` |
| `/loom-git review-pr --autoconverge` | `converge.config` (harness=pr-review-harness, integrator=pr-fixer-agent, botAdapter resolved, prNumber from `gh pr view`, maxIterations=5) | `/loom-converge --config <path>` |

All four wrappers honor the locked flag name `--autoconverge` (CA-06). No per-application synonyms.

## State Machines

The convergence loop state machine is owned by `agents/convergence-driver.md` (locked per CA-01) and referenced here without modification. The loop states are:

```
INITIALIZING ──→ ITERATING ──→ CONVERGED (terminal)
                     │
                     ├──→ STALLED (terminal)
                     ├──→ REGRESSING (terminal)
                     ├──→ MAX_ITER_REACHED (terminal)
                     └──→ SCOPE_EXPANSION (terminal)
```

**Reference, not redefinition:** see `agents/convergence-driver.md` § Convergence Loop. This plan ships zero state-machine changes. Per OQ-01, F-03 reuses the existing `blockingCount==0` terminal check via a synthetic finding row instead of introducing a new state or terminal cause.

### Per-application terminal mapping

| Application | Normal terminal | Cause |
|-------------|-----------------|-------|
| F-01 code-review | CONVERGED | All reviewers report zero blocking findings |
| F-02 test-run | CONVERGED | Test runner reports no failures (`findings[]` empty) |
| F-03 debug | CONVERGED | Synthetic symptom row absent AND investigator emits no blocking findings |
| F-04 PR-review | CONVERGED | Bot adapter (post-dedup) reports zero blocking findings |

## Error Handling Specification

### Error envelope shape

All CLI harnesses use the existing TOON-encoded `AgentResult` envelope on exit, plus a process exit code. Per CA-01, the envelope shape is locked.

```
status: success | partial | failure
exitCode: 0 | 1 | 2 | ...
errors[N]{code,message,severity}:
  CODE,human-readable message,blocking|warning|info
```

### Error categories (cross-harness)

| Code | Exit Status | Where | Retryable |
|------|-------------|-------|-----------|
| REVIEWER_SPAWN_FAILED | 1 | F-01 code-review-harness | No — fix reviewer agent registration |
| RUNNER_SPAWN_FAILED | 1 | F-02 test-harness | No — install runner |
| RUNNER_OUTPUT_UNPARSEABLE | 2 | F-02 test-harness | No — upstream runner format drift |
| INVESTIGATOR_SPAWN_FAILED | 1 | F-03 debug-harness | No — fix investigator registration |
| SYMPTOM_UNRUNNABLE | 2 | F-03 debug-harness | No — fix symptom path |
| ADAPTER_UNKNOWN | 1 | F-04 pr-review-harness | No — config error |
| GH_CLI_UNAVAILABLE | 2 | F-04 pr-review-harness | Yes — install/auth `gh` |
| PR_NOT_FOUND | 3 | F-04 pr-review-harness | No — wrong PR number |
| ADAPTER_TIMEOUT | 4 | F-04 pr-review-harness | Yes — transient bot delay |
| OUTPUT_PATH_UNWRITABLE | varies | All harnesses | No — disk / permission |
| SUBJECT_UNREADABLE | 3 | All harnesses | No — fix path |
| INTEGRATOR_MODE_AMBIGUOUS | — (in AgentResult) | fixer-agent / pr-fixer-agent | No — caller supplies wrong inputs |

### Per-application failure modes (CA-honoring)

| Failure | Manifested by | Driver action |
|---------|---------------|---------------|
| F-01 reviewer flakes mid-iteration | Harness exits non-zero | Driver treats as iteration failure; circuit breaker counts toward stall |
| F-02 test runner segfaults | Harness exits non-zero | Same as above |
| F-03 symptom path stops being executable mid-loop | `SYMPTOM_UNRUNNABLE` | Halts; user investigates |
| F-04 Gemini API/sunsets unavailable | `ADAPTER_TIMEOUT` | Halts; CodeRabbit/Copilot path remains |
| Loop oscillates (Gemini stale-anchor re-flag) | Adapter dedup suppresses → `blockingCount→0` cleanly | CONVERGED (per OQ-04) |
| Per-iter commit fails (F-04) | `pr-fixer-agent` reports `status: partial` | Driver halts after AgentResult inspection |

### Retry

Harnesses themselves do NOT retry — retry is the driver's responsibility (existing circuit-breaker logic). Per OQ-05, F-04's wrapper commits each iteration; squash-on-merge produces a single PR commit.

## Execution Phases

### Phase 0 — Wave 0: Shared Contracts

**Agent:** contracts-agent
**Objective:** Author the shared converge.config field-extension docs and the per-application finding-row schema rows so F-01..F-04 can be implemented in parallel without coordinating.
**Dependencies:** None
**File Ownership:** `agents/protocols/converge.config.applications.md`, `agents/protocols/findings.applications-rows.md`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/converge.config.applications.md | Create | contracts-agent |
| agents/protocols/findings.applications-rows.md | Create | contracts-agent |

These docs are TOON-compatible markdown (per CLAUDE.md: schemas defined in protocol files; tables/text are markdown). They reference the existing locked schemas verbatim and add only:
- The per-application field columns from the matrix above (no schema changes)
- The synthetic-finding row contracts for F-03 (OQ-01) and the `pr-state.toon` shape for F-04 (OQ-02)
- The dedup rule shape for F-04 Gemini (OQ-04)

#### Acceptance Criteria
- [ ] `agents/protocols/converge.config.applications.md` exists and references `agents/protocols/converge.config.schema.md` without modifying it.
- [ ] `agents/protocols/findings.applications-rows.md` documents F-01..F-04 row variants without modifying `agents/protocols/findings.schema.md`.
- [ ] `npx tsc --noEmit` exits with code 0 (no code in this phase, but the existing project type-checks).
- [ ] `bun run lint` exits with code 0.

#### Scenarios

```toon
id: S-01
title: Contracts phase produces both protocol docs and does not modify locked schemas
given[2]: The locked schemas in agents/protocols/ are unchanged on disk, contracts-agent is invoked for Phase 0
when: The agent writes both new protocol docs
whenTriggerType: actor-action
then[3]: agents/protocols/converge.config.applications.md MUST exist, agents/protocols/findings.applications-rows.md MUST exist, git diff against agents/protocols/converge.config.schema.md and findings.schema.md and iteration-snapshot.schema.md and convergence-summary.schema.md MUST be empty
stateRef:
tags[1]: happy-path
automatable: true
```

---

### Phase 1 — Wave 1: F-01 Code-Review Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/code-review-harness.ts` that emits canonical `findings.toon` from the existing `/loom-code review` reviewer fan-out, plus the `--autoconverge` wrapper on `/loom-code review`.
**Dependencies:** Phase 0, Phase 4 (e2e scenarios S-02 and S-03 require fixer-agent Integrator Mode to be shipped first)
**File Ownership:** `scripts/code-review-harness.ts`, `scripts/lib/code-review-harness/**`, `~/.claude/commands/loom-code.md` (modify — `--autoconverge` flag only), `test/code-review-harness.test.ts`, `test/fixtures/code-review/**`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/code-review-harness.ts | Create | implementer-agent |
| scripts/lib/code-review-harness/spawn-reviewers.ts | Create | implementer-agent |
| ~/.claude/commands/loom-code.md | Modify (add `--autoconverge` documentation + behavior section only) | implementer-agent |
| test/code-review-harness.test.ts | Create | implementer-agent |
| test/fixtures/code-review/converges-in-2-iters/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/code-review-harness.ts --subject test/fixtures/code-review/converges-in-2-iters/input.ts --iteration 0` exits with code 0 and writes a `findings.toon` whose `blockingCount` is non-zero.
- [ ] `findings.toon` rows include `reviewerAgent` attribution per W-03.
- [ ] `bun test test/code-review-harness.test.ts` exits with code 0.
- [ ] `/loom-code review --autoconverge` generates a `converge.config` with `harness=scripts/code-review-harness.ts`, `integrator=fixer-agent`, `maxIterations=3`.
- [ ] Running `/loom-converge --config <generated path>` against the fixture converges within 2 iterations (`status: converged` in `convergence-summary.toon`).
- [ ] `npx tsc --noEmit` and `bun run lint` exit with code 0.

#### Convergence Targets
- `findings.toon` output of the harness against fixture input (json-deep-equal, ignore: timestamps, ids)
- `convergence-summary.toon` terminal state after running the wrapper against fixture (status field)

#### Scenarios

```toon
id: S-01
title: Code-review harness emits canonical findings.toon for a flawed input
given[2]: A fixture file test/fixtures/code-review/converges-in-2-iters/input.ts contains seeded code-quality issues, The 9+ reviewers /loom-code review spawns are registered
when: A user invokes bun run scripts/code-review-harness.ts --subject {fixture} --iteration 0
whenTriggerType: api-call
then[3]: Exit code MUST be 0, findings.toon MUST be written atomically at the default output path, findings[] MUST contain rows with severity blocking and reviewerAgent attribution
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: /loom-code review --autoconverge converges the fixture in 2 iterations
given[2]: The fixer-agent Integrator Mode from Phase 4 is shipped, The code-review fixture converges-in-2-iters is on disk
when: A user invokes /loom-code review --autoconverge --subject {fixture}
whenTriggerType: actor-action
then[2]: convergence-summary.toon MUST report status converged, iterationCount MUST be 2 or less
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Subject outside ownership triggers SCOPE_EXPANSION halt
given[1]: A converge.config generated by the wrapper names a single subject file
when: An integrator iteration touches a file outside the subject set
whenTriggerType: system-event
then[1]: Driver MUST halt with cause SCOPE_EXPANSION
stateRef:
tags[2]: error, regression
testTier: e2e
automatable: true
```

---

### Phase 2 — Wave 1: F-02 Test-Run Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/test-harness.ts` (with `bun`/`vitest`/`pytest` runners), a `/loom-test --autoconverge` wrapper, and a fixture that converges in exactly 2 iterations.
**Dependencies:** Phase 0, Phase 4 (e2e scenario S-04 requires fixer-agent Integrator Mode to be shipped first)
**File Ownership:** `scripts/test-harness.ts`, `scripts/lib/test-runners/**`, `~/.claude/commands/loom-test.md` (Create — new command), `test/test-harness.test.ts`, `test/fixtures/test-harness/**`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/test-harness.ts | Create | implementer-agent |
| scripts/lib/test-runners/bun.ts | Create | implementer-agent |
| scripts/lib/test-runners/vitest.ts | Create | implementer-agent |
| scripts/lib/test-runners/pytest.ts | Create | implementer-agent |
| ~/.claude/commands/loom-test.md | Create | implementer-agent |
| test/test-harness.test.ts | Create | implementer-agent |
| test/fixtures/test-harness/converges-in-2-iters/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/test-harness.ts --subject test/fixtures/test-harness/converges-in-2-iters/src --runner bun --iteration 0` exits with code 0 and emits a `findings.toon` with one blocking row per failing test.
- [ ] Spawn-count per iteration is exactly 2 (`1 test-run + 1 fixer`); ceiling at `maxIterations=5` is `1 + 5×2 = 11` and is asserted in the test suite.
- [ ] Vitest and pytest runner branches parse their respective output formats (asserted via two additional fixture files).
- [ ] `/loom-test --autoconverge` against the fixture converges in exactly 2 iterations.
- [ ] `bun test test/test-harness.test.ts`, `npx tsc --noEmit`, `bun run lint` all exit with code 0.

#### Convergence Targets
- `findings.toon` for fixture (json-deep-equal, ignore: timestamps)
- Final test runner exit code after convergence (cli-exit-code: 0)
- `convergence-summary.toon` status after wrapper run

#### Scenarios

```toon
id: S-01
title: Test-harness emits one blocking finding per test failure
given[2]: A fixture src tree under test/fixtures/test-harness/converges-in-2-iters/src has 3 failing tests, bun test is on PATH
when: A user invokes bun run scripts/test-harness.ts --subject {src} --runner bun --iteration 0
whenTriggerType: api-call
then[3]: Exit code MUST be 0, findings.toon MUST contain exactly 3 rows, every row MUST have severity blocking
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: All tests passing emits empty findings array
given[1]: The fixture has been fixed and all tests pass
when: A user invokes bun run scripts/test-harness.ts --subject {src} --runner bun --iteration 1
whenTriggerType: api-call
then[2]: Exit code MUST be 0, findings.toon findings[] MUST be empty
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: Unknown runner output triggers RUNNER_OUTPUT_UNPARSEABLE
given[1]: A vitest version emits a format the parser does not recognize
when: A user invokes the harness with --runner vitest
whenTriggerType: api-call
then[2]: Exit code MUST be 2, AgentResult errors[] MUST include code RUNNER_OUTPUT_UNPARSEABLE
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-04
title: /loom-test --autoconverge converges the fixture in exactly 2 iterations
given[2]: Phase 4 fixer-agent Integrator Mode is shipped, The test-harness fixture is on disk
when: A user invokes /loom-test --autoconverge --subject test/fixtures/test-harness/converges-in-2-iters/src
whenTriggerType: actor-action
then[2]: convergence-summary.toon status MUST be converged, iterationCount MUST equal 2
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

---

### Phase 3 — Wave 1: F-03 Debug Investigator + Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `debug-investigator-agent`, `scripts/debug-harness.ts` (with synthetic symptom-row workaround per OQ-01), and `/loom-bugfix --autoconverge` wrapper. Per OQ-03 (single-agent + new mode), `fix-applier-agent` is `fixer-agent` invoked with a debug-context wrapper — no new agent file is authored for it; Phase 4 (fixer-agent Integrator Mode) supplies the integrator.
**Dependencies:** Phase 0, Phase 4 (Phase 4 must complete before the e2e acceptance criteria of this phase can be verified — see F-11 fix)
**File Ownership:** `agents/debug-investigator-agent.md` (Create), `scripts/debug-harness.ts`, `scripts/lib/debug-harness/**`, `~/.claude/commands/loom-bugfix.md` (modify — `--autoconverge` flag only), `test/debug-harness.test.ts`, `test/fixtures/debug/**`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/debug-investigator-agent.md | Create | implementer-agent |
| scripts/debug-harness.ts | Create | implementer-agent |
| scripts/lib/debug-harness/synthetic-symptom.ts | Create | implementer-agent |
| ~/.claude/commands/loom-bugfix.md | Modify (`--autoconverge` flag + behavior section) | implementer-agent |
| test/debug-harness.test.ts | Create | implementer-agent |
| test/fixtures/debug/converges-in-2-iters/** | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/debug-harness.ts --symptom test/fixtures/debug/converges-in-2-iters/repro.sh --subject test/fixtures/debug/converges-in-2-iters/src/buggy.ts --iteration 0` exits with code 0 and emits a `findings.toon` containing the synthetic blocking row `summary="symptom still reproduces"` plus investigator findings.
- [ ] After the fixer applies the suggested change, iteration 1 re-runs the harness and the synthetic row is absent; if investigator findings are non-blocking, `blockingCount=0`.
- [ ] `convergence-summary.toon` reports `status: converged` and NO `customTerminationOutcome` field is added (per OQ-01 decision).
- [ ] `/loom-bugfix --autoconverge --symptom <path>` end-to-end converges the fixture in exactly 2 iterations.
- [ ] `npx tsc --noEmit`, `bun run lint`, `bun test test/debug-harness.test.ts` all exit with code 0.

#### Convergence Targets
- `findings.toon` for the fixture, iteration 0 (json-deep-equal — must contain the synthetic row)
- `findings.toon` for the fixture, iteration 1 post-fix (must NOT contain the synthetic row)
- `convergence-summary.toon` (no extra fields beyond locked schema)

#### Scenarios

```toon
id: S-01
title: Symptom still reproduces emits synthetic blocking finding
given[2]: A fixture repro script test/fixtures/debug/converges-in-2-iters/repro.sh exits non-zero on the buggy code, debug-investigator-agent is registered
when: A user invokes bun run scripts/debug-harness.ts --symptom {repro} --subject {src} --iteration 0
whenTriggerType: api-call
then[3]: Exit code MUST be 0, findings.toon MUST contain a row with summary "symptom still reproduces" and severity blocking and reviewerAgent "debug-harness", findings.toon MUST also contain probable-cause findings from debug-investigator-agent
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Symptom resolution omits the synthetic row and triggers CONVERGED
given[2]: The buggy code has been patched per the investigator's suggestion, The repro script now exits 0
when: A user invokes the harness for iteration 1
whenTriggerType: api-call
then[3]: Exit code MUST be 0, findings.toon MUST NOT contain a row with reviewerAgent "debug-harness", findings.toon blockingCount MUST be 0
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: convergence-summary.toon must not gain a customTerminationOutcome field
given[1]: The fixture has converged via the synthetic-row path
when: The driver writes convergence-summary.toon
whenTriggerType: system-event
then[1]: convergence-summary.toon keys MUST be exactly the keys defined in agents/protocols/convergence-summary.schema.md
stateRef:
tags[2]: regression, edge-case
testTier: integration
automatable: true
```

---

### Phase 4 — Wave 1: fixer-agent Integrator Mode + pr-fixer-agent

**Agent:** implementer-agent
**Objective:** Extend `agents/fixer-agent.md` with an Integrator Mode (input contract: `findingsPath + subjectPath` → atomic revised file write), and ship a new `agents/pr-fixer-agent.md` that thin-wraps fixer-agent with PR-diff context-injection. Per OQ-03, fixer-agent stays a single agent with a new mode (not a separate `fixer-integrator-agent.md`).

> **Note (F-11 fix):** Phase 4 is placed in Wave 1 but its Integrator Mode is a prerequisite for the e2e acceptance criteria of Phases 1, 2, and 3. Within Wave 1, Phase 4 MUST be completed and merged before the e2e scenarios of Phases 1-3 are exercised. Harness-level work in Phases 1-3 may proceed in parallel with Phase 4; the e2e verification gate at each phase boundary waits on Phase 4.

**Dependencies:** Phase 0
**File Ownership:** `agents/fixer-agent.md` (Modify — append Integrator Mode section only), `agents/pr-fixer-agent.md` (Create), `test/fixer-agent-integrator-mode.test.ts`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/fixer-agent.md | Modify (append Integrator Mode section mirroring plan-builder-agent's) | implementer-agent |
| agents/pr-fixer-agent.md | Create | implementer-agent |
| test/fixer-agent-integrator-mode.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `fixer-agent.md` contains an `## Integrator Mode` section that names the input disambiguation matrix (findings.toon + subject → integrator mode), specifies atomic `.tmp` + rename writes, names error codes `INTEGRATOR_MODE_AMBIGUOUS`, `FINDINGS_SCHEMA_INVALID`, `SUBJECT_UNREADABLE`, and references `agents/protocols/findings.schema.md`.
- [ ] `pr-fixer-agent.md` declares its delegation to `fixer-agent` Integrator Mode plus PR-diff context injection via `gh pr diff`; does NOT duplicate fixer-agent's prose.
- [ ] An integration test asserts that invoking `fixer-agent` with `findings.toon + subjectPath` writes a revised subject file atomically.
- [ ] An integration test asserts that calling `fixer-agent` with neither a roadmap nor `findings.toon` returns `INTEGRATOR_MODE_AMBIGUOUS`.
- [ ] `npx tsc --noEmit`, `bun run lint`, `bun test` exit with code 0.

#### Convergence Targets
- Revised subject file produced by Integrator Mode against a fixture findings.toon (text-diff vs golden expected output)
- AgentResult envelope shape on ambiguous input (json-deep-equal: `status=failure, errors[].code=INTEGRATOR_MODE_AMBIGUOUS`)

#### Scenarios

```toon
id: S-01
title: fixer-agent Integrator Mode rewrites the subject atomically
given[2]: A fixture findings.toon at test/fixtures/fixer-integrator/findings.toon flags 2 blocking issues in subject.ts, The subject file exists at test/fixtures/fixer-integrator/subject.ts
when: The fixer-agent is invoked with findingsPath and subjectPath
whenTriggerType: actor-action
then[3]: A subject.ts.tmp MUST appear and be renamed to subject.ts, The revised subject.ts MUST address both blocking findings, AgentResult MUST report status success and filesModified[0] subject.ts
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Ambiguous input returns INTEGRATOR_MODE_AMBIGUOUS
given[1]: fixer-agent is invoked with neither a roadmap nor a findings.toon
when: The agent processes its inputs
whenTriggerType: actor-action
then[2]: AgentResult status MUST be failure, errors[] MUST include code INTEGRATOR_MODE_AMBIGUOUS
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-03
title: pr-fixer-agent injects PR diff context before delegating to fixer-agent
given[2]: gh CLI is authenticated, A PR number is available via gh pr view
when: pr-fixer-agent is invoked with findingsPath subjectPath prNumber
whenTriggerType: actor-action
then[2]: The agent MUST shell out to gh pr diff to read the PR diff before invoking fixer-agent, fixer-agent MUST be invoked with the PR diff included as integrator context
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 5 — Wave 2: F-04 Gemini Adapter (PRIORITY ONE — CA-05)

**Agent:** implementer-agent
**Objective:** Ship the per-bot Gemini adapter at `scripts/lib/pr-review-adapters/gemini.ts` with cross-iteration dedup per OQ-04. This phase ships ONLY Gemini; CodeRabbit and Copilot are deferred per CA-05 + roadmap "Out of Scope."
**Dependencies:** Phase 0, Phase 4
**File Ownership:** `scripts/lib/pr-review-adapters/gemini.ts`, `scripts/lib/pr-review-adapters/types.ts`, `test/pr-review-adapters/gemini.test.ts`, `test/fixtures/pr-review/gemini/**`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/lib/pr-review-adapters/types.ts | Create (adapter contract interface) | implementer-agent |
| scripts/lib/pr-review-adapters/gemini.ts | Create | implementer-agent |
| test/pr-review-adapters/gemini.test.ts | Create | implementer-agent |
| test/fixtures/pr-review/gemini/round-1-comments.json | Create (canned bot response) | implementer-agent |
| test/fixtures/pr-review/gemini/round-2-comments.json | Create | implementer-agent |
| test/fixtures/pr-review/gemini/iter-0-findings.toon | Create (for dedup test) | implementer-agent |

#### Acceptance Criteria
- [ ] Adapter exports a function matching the type declared in `types.ts`: `(prNumber, iteration, priorFindingsPath?) → Promise<ConvergenceFindings>`.
- [ ] Severity parsing extracts `high|medium|low` from inline image tags `![high]` / `![medium]` / `![low]` and maps to `blocking|warning|info`.
- [ ] Dedup: when `priorFindingsPath` is supplied, the adapter suppresses any finding whose `(locationPath, locationAnchor, summary)` triple matches a row in the prior iteration. Asserted via fixture in `test/fixtures/pr-review/gemini/`.
- [ ] Unit tests cover: severity parsing of all three tags, dedup behavior, empty-reviews response (returns empty `findings[]`).
- [ ] `npx tsc --noEmit`, `bun run lint`, `bun test test/pr-review-adapters/gemini.test.ts` exit with code 0.

#### Convergence Targets
- `findings.toon` produced from canned Gemini fixture round 1 (json-deep-equal vs golden)
- `findings.toon` produced from canned round 2 with prior-findings supplied (must show dedup applied)

#### Scenarios

```toon
id: S-01
title: Gemini adapter parses severity tags from inline image markup
given[1]: A canned Gemini comments fixture contains comments with image tags ![high], ![medium], ![low]
when: The adapter processes the fixture
whenTriggerType: api-call
then[1]: Returned findings[] severity values MUST be blocking, warning, info respectively
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Dedup suppresses identical (path, anchor, summary) triples from prior iteration
given[2]: A prior iteration findings.toon contains a row with locationPath src/foo.ts locationAnchor :42 summary "missing null check", The current Gemini fixture re-flags the same path anchor and summary
when: The adapter runs with priorFindingsPath supplied
whenTriggerType: api-call
then[1]: Returned findings[] MUST NOT contain a row matching that triple
stateRef:
tags[2]: regression, edge-case
testTier: unit
automatable: true
```

```toon
id: S-03
title: Empty Gemini review returns empty findings[]
given[1]: The canned fixture returns no inline comments
when: The adapter runs
whenTriggerType: api-call
then[2]: Exit MUST be success, findings[] MUST be an empty array
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 6 — Wave 3: F-04 PR-Review Dispatcher Harness + Wrapper

**Agent:** implementer-agent
**Objective:** Ship `scripts/pr-review-harness.ts` (dispatcher that reads `botAdapter` and delegates to the Gemini adapter), the `pr-state.toon` projection layer (OQ-02), and the `/loom-git review-pr --autoconverge` wrapper (per-iteration commit per OQ-05).
**Dependencies:** Phase 0, Phase 4, Phase 5
**File Ownership:** `scripts/pr-review-harness.ts`, `scripts/lib/pr-review-harness/**` (pr-state writer, wrapper-config generator), `~/.claude/commands/loom-git.md` (modify — add `review-pr --autoconverge` subcommand documentation), `test/pr-review-harness.test.ts`, `test/fixtures/pr-review/canned-pr/**`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/pr-review-harness.ts | Create | implementer-agent |
| scripts/lib/pr-review-harness/pr-state-writer.ts | Create | implementer-agent |
| scripts/lib/pr-review-harness/wrapper-config.ts | Create | implementer-agent |
| ~/.claude/commands/loom-git.md | Modify (`review-pr --autoconverge` subcommand only) | implementer-agent |
| test/pr-review-harness.test.ts | Create | implementer-agent |
| test/fixtures/pr-review/canned-pr/** | Create (PR fixture that converges in 2 iterations) | implementer-agent |

#### Acceptance Criteria
- [ ] `bun run scripts/pr-review-harness.ts --config <path> --iteration 0` writes a `pr-state.toon` containing head SHA, base SHA, diff hash, comment IDs (per OQ-02).
- [ ] Dispatcher correctly delegates to `gemini.ts` when `botAdapter=gemini`; returns `ADAPTER_UNKNOWN` exit code 1 for unknown adapters.
- [ ] `/loom-git review-pr --autoconverge` resolves the PR number from `gh pr view --json number`, generates a `converge.config` with `harness=scripts/pr-review-harness.ts`, `integrator=pr-fixer-agent`, `subject=.plan-execution/pr-review/pr-state.toon`, `maxIterations=5`.
- [ ] Against the canned fixture PR, the loop converges in 2 iterations, each iteration produces a commit with message `fix(pr-iter-{N}/gemini): {summary}` (per OQ-05).
- [ ] `convergence-summary.toon` reports `status: converged` and contains no field outside the locked schema.
- [ ] `npx tsc --noEmit`, `bun run lint`, `bun test test/pr-review-harness.test.ts` exit with code 0.

#### Convergence Targets
- `pr-state.toon` shape after iteration 0 (json-deep-equal vs golden)
- `convergence-summary.toon` after full wrapper run (status field, no extra fields)
- Per-iteration commit messages (text-diff vs `fix(pr-iter-{N}/gemini): {summary}` regex)

#### Scenarios

```toon
id: S-01
title: PR-review harness writes pr-state.toon as the synthetic subject
given[2]: A PR exists and gh CLI is authenticated, converge.config names botAdapter gemini and prNumber 42
when: A user invokes bun run scripts/pr-review-harness.ts --config {path} --iteration 0
whenTriggerType: api-call
then[3]: A file pr-state.toon MUST be written atomically, pr-state.toon MUST contain headSha baseSha diffHash and commentIds keys, pr-state.toon MUST be the subject the driver snapshots
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Unknown botAdapter triggers ADAPTER_UNKNOWN
given[1]: converge.config names botAdapter "unsupportedBot"
when: The dispatcher reads the config
whenTriggerType: api-call
then[2]: Exit code MUST be 1, AgentResult errors[] MUST include ADAPTER_UNKNOWN
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-03
title: /loom-git review-pr --autoconverge converges canned PR in 2 iterations with per-iteration commits
given[2]: A canned PR fixture is available and gh CLI is mocked to return the canned responses, Phase 4 Integrator Mode and Phase 5 Gemini adapter are shipped
when: A user invokes /loom-git review-pr --autoconverge
whenTriggerType: actor-action
then[3]: convergence-summary.toon status MUST be converged within 2 iterations, Exactly 2 commits MUST be produced with messages matching fix(pr-iter-{N}/gemini), convergence-summary.toon MUST NOT contain a customTerminationOutcome key
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-04
title: Subject snapshot mechanism treats pr-state.toon like any other file
given[1]: pr-state.toon is the configured subject
when: The driver invokes hooks/lib/iteration-snapshot.ts
whenTriggerType: system-event
then[2]: The snapshot mechanism MUST be called verbatim with no special-casing for PR subjects, A snapshot file MUST appear under .plan-execution/convergence/iterations/iter-{N}/
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

---

### Phase 7 — Wave 3: README Disambiguation + Cross-Application Docs

**Agent:** implementer-agent
**Objective:** Add a disambiguation table to the README distinguishing `/loom-code review --autoconverge` (this plan) from `/loom-code fix` (existing one-shot), per the F-01 risk-mitigation row and the maintenance-verbs table precedent (`/loom-library` vs `/loom-upgrade`). Document the cross-application unified surface of `--autoconverge` per CA-06.
**Dependencies:** Phase 1, Phase 2, Phase 3, Phase 6
**File Ownership:** `README.md` (modify — add one disambiguation table + one short subsection only)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| README.md | Modify (one disambiguation table + one Convergence Applications subsection) | implementer-agent |

#### Acceptance Criteria
- [ ] README.md contains a table row distinguishing `/loom-code review --autoconverge` from `/loom-code fix`.
- [ ] README.md mentions the five applications (plan-creation + 4 new) sharing the `--autoconverge` flag (CA-06).
- [ ] No code or schema changes in this phase.

#### Scenarios

This phase ships documentation only and produces no programmatically observable output beyond the rendered README. The acceptance criteria are satisfied by direct file inspection — no `#### Scenarios` block is emitted per Step 2.9 (wiring/docs-only phase exemption).

---

### Phase 8 — Wave 3: Spawn-Count Ceiling Tests + Cross-Application Schema Verification

**Agent:** implementer-agent
**Objective:** Author a single integration test that re-reads `agents/protocols/convergence-summary.schema.md`, `findings.schema.md`, `iteration-snapshot.schema.md`, and `converge.config.schema.md` from all five wiring fixtures (plan-creation existing + F-01..F-04 new) and asserts they all conform to the locked schemas. Also asserts spawn-count ceilings per application (per Success Metrics in the roadmap).
**Dependencies:** Phase 1, Phase 2, Phase 3, Phase 6
**File Ownership:** `test/convergence-applications/cross-application-schema.test.ts`, `test/convergence-applications/spawn-ceiling.test.ts`

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/convergence-applications/cross-application-schema.test.ts | Create | implementer-agent |
| test/convergence-applications/spawn-ceiling.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] Cross-application schema test asserts all 5 applications produce `convergence-summary.toon` files whose keys are a subset of the locked schema (no `customTerminationOutcome` anywhere — verifies OQ-01 decision held).
- [ ] Spawn-ceiling test asserts: F-01 ceiling = `1 + 3 × 2 = 7`; F-02 ceiling = `1 + 5 × 2 = 11`; F-03 ceiling = `1 + 5 × 2 = 11`; F-04 ceiling = `1 + 5 × 2 = 11`.
- [ ] Tests detect cross-iteration regressions by parsing all five `convergence-summary.toon` outputs from the fixtures.
- [ ] `bun test test/convergence-applications/`, `npx tsc --noEmit`, `bun run lint` exit with code 0.

#### Convergence Targets
- 5 `convergence-summary.toon` files parsed against locked schema (json-deep-equal on key sets)
- Spawn-count per iteration from each fixture run (exact-equality cli outputs)

#### Scenarios

```toon
id: S-01
title: All five applications produce convergence-summary.toon conforming to the locked schema
given[1]: All 5 application fixtures have been run to completion
when: The cross-application schema test inspects each convergence-summary.toon
whenTriggerType: system-event
then[2]: Every file's top-level keys MUST be a subset of the keys defined in convergence-summary.schema.md, No file MUST contain a customTerminationOutcome key
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Spawn-count ceilings hold per application
given[1]: Each application has been run against its fixture with maxIterations from the application's wrapper default
when: The spawn-ceiling test counts agent spawns per iteration
whenTriggerType: system-event
then[4]: F-01 total spawns MUST be 7 or less, F-02 total spawns MUST be 11 or less, F-03 total spawns MUST be 11 or less, F-04 total spawns MUST be 11 or less
stateRef:
tags[1]: regression
testTier: integration
automatable: true
```

## Verification Commands

```bash
npx tsc --noEmit
bun run lint
bun test
```

Per-phase verification expands the above with phase-scoped test runs:
```bash
bun test test/code-review-harness.test.ts                    # Phase 1
bun test test/test-harness.test.ts                           # Phase 2
bun test test/debug-harness.test.ts                          # Phase 3
bun test test/fixer-agent-integrator-mode.test.ts            # Phase 4
bun test test/pr-review-adapters/gemini.test.ts              # Phase 5
bun test test/pr-review-harness.test.ts                      # Phase 6
bun test test/convergence-applications/                      # Phase 8
```

## Milestones

| Milestone | Phases | Roadmap Acceptance |
|-----------|--------|---------------------|
| M-01: Code-Review + Test-Run Convergence Shipped | Phases 0, 1, 2, 4 | F-01 + F-02 wrappers exist; fixtures pass; fixer-agent Integrator Mode shipped; spawn ceilings hold |
| M-02: Debug Convergence Shipped | Phase 3 (depends on M-01) | F-03 wrapper exists; synthetic-finding workaround verified; no schema extension (OQ-01) |
| M-03: PR-Review Convergence Shipped | Phases 5, 6, 7, 8 (depends on M-01) | F-04 Gemini adapter ships; canned PR fixture converges in 2 iterations; `pr-state.toon` synthetic subject works (OQ-02); per-iteration commits with squash-on-merge (OQ-05); cross-application schema test passes |

### Wave-to-Milestone Mapping

| Wave | Phases | Milestone(s) |
|------|--------|--------------|
| 0 | Phase 0 | prerequisite for all |
| 1 | Phases 1, 2, 3, 4 (parallel harness work; e2e gates of Phases 1-3 wait on Phase 4 completion per F-11 fix) | completes M-01 + M-02 |
| 2 | Phase 5 (requires Wave 1 complete, specifically Phase 4 — fixer-agent Integrator Mode — per Phase 5 Dependencies) | M-03 (Gemini adapter) |
| 3 | Phases 6, 7, 8 | completes M-03 |

> **Dependency chain (F-12 fix):** Phase 4 (Wave 1) → Phase 5 (Wave 2) → Phase 6 (Wave 3). Wave 2 cannot begin until Phase 4 is complete because Phase 5's `Dependencies` field lists `Phase 4` explicitly. This chain is linear: Wave 2 starts only after all of Wave 1 merges (including Phase 4).

## Risks & Mitigations

| Risk | Mitigation in this plan |
|------|-------------------------|
| F-03 termination requires invasive driver changes | OQ-01 decision locks synthetic-finding workaround; Phase 3 ships that exact pattern; cross-application schema test (Phase 8 S-01) asserts no `customTerminationOutcome` key appears |
| F-04 subject extension breaks C-11 link-readiness | OQ-02 decision locks `pr-state.toon` synthetic-file workaround; Phase 6 S-01 + S-04 assert the snapshot mechanism is unchanged |
| Gemini stale-anchor re-flag causes oscillation | OQ-04 decision: Phase 5 S-02 asserts dedup against prior iter's `findings.toon` |
| Engine accidentally modified | Phase 0 S-01 acceptance includes `git diff` against the four locked schemas being empty; Phase 8 cross-application schema test re-verifies on every run |

## Acceptance Criteria (Final)

- [ ] All four applications converge their fixtures via `/loom-converge --mode document` against the unchanged driver.
- [ ] `git diff` against `agents/convergence-driver.md`, `hooks/lib/iteration-snapshot.ts`, `agents/protocols/findings.schema.md`, `convergence-summary.schema.md`, `iteration-snapshot.schema.md` is empty (CA-01).
- [ ] `--autoconverge` flag is the only autoconvergence flag exposed (CA-06) — no per-application synonyms exist in `~/.claude/commands/loom-code.md`, `~/.claude/commands/loom-test.md`, `~/.claude/commands/loom-bugfix.md`, `~/.claude/commands/loom-git.md`.
- [ ] Phase 8 cross-application schema and spawn-ceiling tests pass.
- [ ] `npx tsc --noEmit && bun run lint && bun test` exits with code 0 at the plan's completion.

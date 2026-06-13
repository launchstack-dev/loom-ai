---
planVersion: 2
name: "Convergence Generalization — Document Mode + Plan Critic"
status: reviewed
created: 2026-06-12
lastReviewed: 2026-06-12
roadmapRef: planning/ROADMAP-convergence-generalization.md
totalPhases: 15
totalWaves: 5
---

<!-- Pass-2 integration: applied 9 blocking findings (PF-01..PF-08, PF-11) + 25 warnings + 7 info findings. See planning/history/snapshots/2026-06-12-convergence-generalization-pass-1.md for pre-integration snapshot. -->

# Plan: Convergence Generalization — Document Mode + Plan Critic

## Overview

This plan extends Loom's existing `convergence-driver` to support a third `document` mode, adds a haiku-tier `plan-critic-agent` that preempts common review findings before the first formal review, and wraps `/loom-plan create` with an `--autoconverge` flag that drives the loop until clean or circuit-broken. The "codebase" being modified is Loom itself — every artifact is a markdown agent file, a TOON schema, a slash-command file, or a vitest suite under `test/`.

<!-- Applied: PF-01 (CC-01) — Phase 11 promoted to Wave 2 so its snapshot helper ships alongside Phase 5's safeguards, making M-01's snapshot ACs testable in the same wave. -->
Three roadmap features map to fifteen phases across five waves. Wave 0 locks the protocol contracts (extended `converge.config` schema, `ConvergenceFindings`, `PlanCritique`, `IterationSnapshot`). Waves 1-2 deliver F-01 (driver document mode + the snapshot helper that backs it) and gate Milestone M-01. Waves 3-4 deliver F-02 (critic) and F-03 (plan-review harness + `--autoconverge`) on top of the locked driver, and gate Milestone M-02.

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Orchestration agents | Markdown agent files | — | `convergence-driver.md`, `plan-builder-agent.md`, new `plan-critic-agent.md` |
| Slash commands | Markdown command files | — | `commands/loom-plan/create.md`, `commands/loom-converge.md` |
| Schemas / on-disk artifacts | TOON | 1 | `converge.config`, `findings.toon`, `iter-{N}.toon`, `critique.toon`, `snapshot.toon` |
| Helper code | TypeScript | 5.x | `hooks/lib/` helpers (token-estimator already exists; new helpers if any land here) |
| Runtime | Bun | latest | `bun run`, `bun test` |
| Test framework | Vitest | latest | `test/protocol/` suites, `test/e2e/` fixtures |
| Critic model tier | Haiku | — | Per C-04, advisory-only critic spawn |
| Integrator model tier | Inherit from agent frontmatter | — | `plan-builder-agent` (opus), `fixer-agent` (sonnet) — driver does not pick the tier |
| Verification pipeline | `tsc --noEmit`, `bun run lint`, `bun test` | — | Per CLAUDE.md `keyTouchPoints.verificationPipeline` |

## Schema / Type Definitions

This plan is purely meta-orchestration — there is no application database. All entities are on-disk TOON artifacts or in-memory agent payloads. There is no SQL schema. The "validation rules" and "cascade behavior" subsections are framed as TOON-schema invariants and lifecycle relationships between files.

### ConvergeConfig (extended)

The existing `converge.config` TOON file gains three new fields. Existing `target` and `criteria` mode runs must continue to load unchanged configs.

| Field | Type | Constraints | Default | Validation Rules |
|-------|------|-------------|---------|------------------|
| convergenceMode | enum | one of: `target`, `criteria`, `document` | `target` (backwards compat) | New value `document` accepted; unknown values blocking-error |
| subject | string (path) | required when `convergenceMode == document`; relative to repo root | — | Must exist on first iteration; resolved against repo root |
| integrator | string (agent name) | required when `convergenceMode == document`; must be a known agent registered in `agents/` | `fixer-agent` for `target`/`criteria` modes (backwards compat) | Must resolve to an `.md` under `agents/`; model resolution per CLAUDE.md applies |
| harness | string (path) | required for all modes; for document mode points to a TS script under `scripts/` or a registered harness agent | — | Must produce `findings.toon` at the configured `outputPath` per iteration |
| outputPath | string (path) | required; where the harness writes `findings.toon` | `.plan-execution/convergence/findings.toon` | Driver reads this path after each harness invocation |
| maxIterations | integer | 1-10 | 5 (existing default); 3 for `--autoconverge` per C-05 | Blocking error if `> 10` |
| agentBudget | integer | required; counts loop agent spawns | 30 (existing default) | Cumulative across iterations; preflight check before loop |
| scopeGuardEnabled | boolean | optional; document-mode only | `true` | When true, scope-expansion guard (see error code `SCOPE_EXPANSION`) is armed |
| snapshotEnabled | boolean | optional; document-mode only | `true` | When true, auto-snapshot per C-07 is written before each integrator invocation |
| snapshotDir | string (path) | optional | `planning/history/snapshots/` | Slug + pass-number filename appended by driver |

#### Indexes (TOON-artifact relationships)

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| primary | configPath | PRIMARY | One config per convergence run; identifies the loop |
| relation | configPath → integrator | FOREIGN-LIKE | Driver dispatch lookup |
| relation | configPath → harness | FOREIGN-LIKE | Driver harness invocation lookup |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| converge.config | iter-{N}.toon (per-iteration) | RETAIN | RETAIN — iter summaries preserved for debrief |
| converge.config | findings.toon (latest) | OVERWRITE | OVERWRITE — only latest matters at runtime |
| converge.config | snapshot.toon (per-pass) | RETAIN | RETAIN per C-07 (keep all forever) |

### ConvergenceHarness (new contract — interface, not on-disk)

Every harness conforms to the same interface: invoked with `(subject, configPath)`, produces a `findings.toon` at `outputPath`.

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | unique within Loom; e.g., `plan-review`, `target-diff`, `criteria-test-review` |
| invocation | "ts-script" \| "agent" | how the driver invokes it |
| subjectShape | "file" \| "directory" | what `subject` points at |
| produces | path-glob | always writes `findings.toon` at `config.outputPath` |
| iterationField | "iteration" | findings carries iteration number for the driver's history table |

### ConvergenceFindings (new TOON schema)

Uniform output of any harness. Replaces per-mode result shapes that previously lived only inside the driver. Stored at `config.outputPath` (default `.plan-execution/convergence/findings.toon`).

```toon
subject: planning/PLAN.md
harnessName: plan-review
iteration: 1
blockingCount: 5
advisoryCount: 7
producedAt: 2026-06-12T15:30:00Z

findings[12]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion}:
  F-01,phasing,blocking,planning/PLAN.md,##Execution Phases > Phase 3,Wave 2 has 9 deliverables (>8 limit),Split Phase 3 into 3a (schema) and 3b (driver branch)
  ...
```

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| subject | string (path) | required; matches `converge.config.subject` | Must equal the config's subject value |
| harnessName | string | required | Must match a registered harness in `converge.config.harness` |
| iteration | integer | required; 1-indexed | Monotonic per run; driver verifies `iteration == driver.currentIteration` |
| blockingCount | integer | required; >= 0 | Drives convergence check; convergence reached at `blockingCount == 0` |
| advisoryCount | integer | required; >= 0 | Informational only |
| producedAt | ISO 8601 timestamp (ms precision) | required; format `YYYY-MM-DDTHH:mm:ss.sssZ` <!-- Applied: W-01 — lock timestamp precision --> | Used for stall-detection regression checks |
| findings[] | typed array | rows of `{id, dimension, severity, locationPath, locationAnchor, summary, suggestion, reviewerAgent}` <!-- Applied: W-03 — reviewerAgent attribution --> | Sum of `severity in {blocking}` MUST equal `blockingCount`; sum of `severity in {warning, info, advisory}` MUST equal `advisoryCount`; `reviewerAgent` is optional but populated by plan-review harness with one of the 6 reviewer names |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| findings.toon (iteration N) | iter-{N}.toon (driver-written summary) | RETAIN | OVERWRITE on retry within same iteration |
| findings.toon (iteration N) | findings.toon (iteration N+1) | OVERWRITE | Latest always replaces prior at `outputPath` |

#### Severity Mapping (AgentResult → ConvergenceFindings)

<!-- Applied: PF-09 (CC-03 / W-18) — explicit severity mapping table consumed by the plan-review harness aggregator (Phase 9) -->

The plan-review harness aggregates `AgentResult.issues[]` rows from the 6 reviewer agents. Each reviewer's `severity` enum (per `agent-result.schema.md`) maps deterministically to a `ConvergenceFindings.severity`:

| AgentResult severity | ConvergenceFindings severity | blockingCount contribution | advisoryCount contribution |
|----------------------|------------------------------|----------------------------|----------------------------|
| critical | blocking | +1 | 0 |
| high | blocking | +1 | 0 |
| medium | warning | 0 | +1 |
| low | info | 0 | +1 |
| info | info | 0 | +1 |
| advisory | info | 0 | +1 |

The aggregator MUST apply this mapping verbatim. Silent re-categorization is a `FINDINGS_SCHEMA_INVALID` defect.

### PlanCritique (new TOON schema)

Output of `plan-critic-agent`. Stored at `.plan-execution/critique.toon`. Mirrors the shape of `findings.toon` so `plan-builder-agent` can consume it through the same integrator contract.

```toon
subject: planning/PLAN.md
producedBy: plan-critic-agent
producedAt: 2026-06-12T15:00:00Z
criticConfidence: 0.65
dimensionsCovered[6]: feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow
predictedBlockingCount: 4
predictedAdvisoryCount: 9

predictedFindings[13]{id,dimension,predictedSeverity,locationHint,concern,suggestion}:
  P-01,phasing,blocking,Phase 3 - Wave 2,Two phases share src/foo/** without wiring boundary,Move shared file ownership to wiring phase
  ...
```

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| subject | string (path) | required; the draft plan path | Must match the path passed to plan-builder |
| producedBy | string | required; always `plan-critic-agent` | Locked value for schema check |
| producedAt | ISO timestamp | required | — |
| criticConfidence | float | required; 0.0-1.0 | Self-reported confidence; advisory only |
| dimensionsCovered[] | inline array | required; subset of the 6 dimension names | Must be a subset of `{feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow}` |
| predictedBlockingCount | integer | required; >= 0 | Sum of rows with `predictedSeverity == blocking` |
| predictedAdvisoryCount | integer | required; >= 0 | Sum of rows with `predictedSeverity in {warning, info}` |
| predictedFindings[] | typed array | rows of `{id, dimension, predictedSeverity, locationHint, concern, suggestion}` | `dimension` MUST be in `dimensionsCovered[]` |

### IterationSnapshot (new TOON schema)

Per-pass snapshot record per C-07. Stored at `planning/history/snapshots/{slug}-pass-{N}.toon` accompanied by the snapshotted file at `planning/history/snapshots/{slug}-pass-{N}.{ext}`.

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|------------------|
| sourcePath | string (path) | required; equals `converge.config.subject` | — |
| snapshotPath | string (path) | required; the on-disk copy | Must exist on the filesystem after snapshot write |
| snapshotChecksum | string (sha256) | required | Computed by snapshot helper; used to detect tampering |
| iteration | integer | required; 1-indexed pass number | Matches the driver's `currentIteration` |
| timestamp | ISO timestamp | required | — |
| slug | string | required | Derived from subject basename minus the FINAL extension only (e.g., `planning/PLAN-convergence-generalization.md` → `PLAN-convergence-generalization`; `planning/PLAN-x.v2.md` → `PLAN-x.v2`). Multi-dot filenames keep all but the trailing extension. <!-- Applied: W-02 — slug ambiguity --> |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| converge.config | IterationSnapshot rows | RETAIN | RETAIN — per C-07 (keep all forever) |

### ConvergenceIterationSummary (extended; existing schema at `agents/protocols/stage-context.schema.md`)

Extended with two optional fields for document mode parity. The on-disk shape MUST remain identical across all three modes per F-01 acceptance.

| Existing field | Required | Notes |
|---|---|---|
| iteration, mode, timestamps, durationMs, harnessResult, findingsBefore, findingsAfter, findingsFixed, findingsNew, filesModified, stalled, summary | yes | Unchanged |

| New field | Type | Required | Notes |
|---|---|---|---|
| subject | string (path) | document mode only; null in `target`/`criteria` | Mirrors `converge.config.subject` |
| snapshotRef | string (path) | document mode only; null in `target`/`criteria` | Path to the IterationSnapshot for this iteration |
| haltReason | enum (optional) | populated when the driver halts; null otherwise | One of `STALL`, `REGRESSION`, `BUDGET_EXHAUSTED`, `MAX_ITERATIONS`, `SCOPE_EXPANSION`; surfaced in stdout halt message and `iter-{N}.toon` <!-- Applied: I-01 — haltReason field --> |
| tokensUsed | integer (optional, cumulative) | non-blocking observability metric; written per iteration to `convergence-state.toon` | Sum of agent-spawn output tokens across iterations 1..N; absent on iter-1.toon if not measurable. Surfaces alongside spawn-count for cost telemetry; NOT used as a gate. <!-- Applied: W-NEW-03 (pass-2) — tokensUsed schema owner added so Phase 14's AC has a typed home --> |

### ConvergenceSummary (run-end artifact at `.plan-execution/convergence-summary.toon`)

<!-- Added: C-11 (trampoline-link compat) — explicit schema for the artifact a future loom-auto converge link will read as its authoritative "did we converge" signal. Existing driver code already emits this for target/criteria modes; this section makes the document-mode shape explicit so the link can read it without translation. -->

Written by the convergence-driver exactly once per run, at terminal-state transition (converged OR halted). Atomic write (`.tmp` + rename). One file per run; resume restores it.

| Field | Type | Modes | Description |
|-------|------|-------|-------------|
| runId | string | all | Unique identifier for this convergence run; mirrors `convergence-state.toon.runId` |
| convergenceMode | enum | all | `target` \| `criteria` \| `document` |
| subject | string (path) | document only; null for target/criteria | Path to the subject file/dir under iteration |
| harnessName | string | all | Name or path of the harness that produced findings (e.g., `plan-review-harness` for document mode; `target-runner` for target; `criteria-runner` for criteria) |
| integratorName | string | all | Name of the agent invoked to apply findings (e.g., `plan-builder-agent` for document; `fixer-agent` default for target/criteria) |
| status | enum | all | `converged` \| `halted-stall` \| `halted-regression` \| `halted-budget` \| `halted-max-iter` \| `halted-scope-expansion`. **Authoritative source of truth for "did we converge" — read by verify-link today and future converge-link** |
| finalBlockingCount | integer | all | blockingCount at run end (== 0 if status=converged) |
| iterationsRun | integer | all | Number of iterations that actually executed (≥ 1; bounded by maxIterations) |
| haltReason | enum (optional) | all | Matches `ConvergenceIterationSummary.haltReason`; null if status=converged |
| startedAt | ISO timestamp (ms) | all | Run start |
| completedAt | ISO timestamp (ms) | all | Terminal-state transition |
| tokensUsed | integer (optional) | all | Mirrors `convergence-state.toon.tokensUsed` cumulative total; non-blocking observability |

## API Specification

Loom is a meta-orchestration tool, not an HTTP service. There are no REST/HTTP endpoints in scope for this plan. The "API" surface is the set of inter-agent file contracts and slash-command flags. Each contract is captured in the State Machines and Error Handling sections below.

The two new slash-command flag surfaces are:

### `/loom-plan create --autoconverge [--max-iterations N] [--skip-critic]`

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| --autoconverge | flag | no | off (opt-in per Q-01) | Wraps Step 4 with a convergence loop using mode=document |
| --max-iterations | integer | no | 3 (per C-05) | Hard cap on iterations; overrides `converge.config.maxIterations` for the generated config |
| --skip-critic | flag | no | off | Bypasses plan-critic-agent in Step 1; preserves legacy dual-track behavior |
| --auto | flag | no | off | Existing flag; combinable with `--autoconverge` for end-to-end non-interactive runs |
| --no-auto-commit | flag | no | off | Existing flag; auto-snapshots (C-07) still run regardless |

### `/loom-converge --mode document --subject <path> --integrator <agent>`

`/loom-converge` gains pass-through flags so document-mode loops can be invoked directly without `/loom-plan create`. Used by F-03 acceptance fixtures.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| --mode | enum | yes (for document mode) | `target` | One of `target`, `criteria`, `document` |
| --subject | string (path) | yes when mode=document | — | Subject file path |
| --integrator | string | yes when mode=document | — | Integrator agent name |
| --harness | string | yes when mode=document | — | Harness path or registered name |
| --max-iterations | integer | no | 3 for document mode, 5 otherwise | Per C-05 |
| --resume | flag | no | off <!-- Applied: PF-07 (B-02) — document existing --resume flag --> | Restore the loop from `.plan-execution/convergence/convergence-state.toon` and continue from the next un-completed iteration; works across all three modes (target, criteria, document) |
| --resume-config | string (path) | no | — <!-- Applied: PF-07 (B-02) — document --resume-config flag --> | Path to an alternate `converge.config` TOON file (for tests + concurrent runs); used by `/loom-plan create --autoconverge` Step 5 to point at the generated config |
| --output-dir | string (path) | no | `.plan-execution/convergence/` <!-- Applied: W-05 — output-dir for concurrent runs --> | Override the convergence working directory; used by CI and concurrent fixture runs to avoid stomping on the default location |

## State Machines

### ConvergeRun (mode=document)

```
preflight ──→ snapshotting ──→ integrating ──→ harnessing ──→ converged
   │              ↑                                  │              
   │              └──────────────────────────────────┘              
   │                                                                
   └──→ aborted-preflight                                            
                                                                    
   any state ──→ halted (SCOPE_EXPANSION | STALL | REGRESSION | BUDGET | MAX_ITERS)
```

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| preflight | Driver validates `converge.config`, resolves integrator + harness, runs context-budget preflight | On every `/loom-converge` invocation |
| snapshotting | Auto-snapshot of `subject` to `planning/history/snapshots/` per C-07 | At the start of each iteration before integrator runs |
| integrating | Driver spawns the named `integrator` agent with `findings.toon` + current `subject` | After snapshot completes (iterations >= 2; skipped on iteration 1 — no findings yet) |
| harnessing | Driver invokes `harness` against `subject`; harness writes `findings.toon` | After integrator completes (or as first step on iteration 1) |
| converged | `findings.toon.blockingCount == 0`; loop exits cleanly | Default success terminal state |
| halted | Circuit breaker fired; loop exits with `haltReason` | Terminal state on any circuit-breaker condition |
| aborted-preflight | Config invalid, integrator unresolvable, harness missing | Terminal state from preflight failure |

**Valid transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| preflight | snapshotting | Iteration 1 starts, snapshotEnabled=true | Writes `snapshot.toon`; copies subject file |
| preflight | harnessing | Iteration 1 starts, snapshotEnabled=false | Skips snapshot |
| harnessing | integrating | Iteration N >= 2 starts and `blockingCount > 0` | Writes `iter-{N-1}.toon`; spawns integrator |
| integrating | snapshotting | Iteration N+1 begins | Writes pre-integration snapshot for iteration N+1 |
| harnessing | converged | `findings.toon.blockingCount == 0` | Writes final `iter-{N}.toon`; appends changelog trajectory |
| any | halted | Circuit breaker condition met | Writes `iter-{N}.toon` with `stalled=true` or `haltReason=*` |
| any | aborted-preflight | Preflight failure | No iter file written |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|-----------|---------|
| harnessing | converged (with blockingCount > 0) | DRIVER_INVARIANT | Driver MUST NOT mark converged while blocking findings remain |
| integrating | converged | DRIVER_INVARIANT | Driver MUST re-harness after integrator before claiming convergence |
| converged | any | TERMINAL_STATE | Convergence runs are append-only; resume creates a new run |
| halted | converged | TERMINAL_STATE | A halted run cannot self-recover; user must re-invoke |

## Error Handling Specification

### Error Response Format

All driver and harness errors surface as `AgentResult.issues[]` rows per the existing `agent-result.schema.md`. New error codes are added to the registry below; the JSON-equivalent (in TOON) format is unchanged.

```toon
issues[N]{severity,code,description,file,line,suggestion}:
  blocking,SCOPE_EXPANSION,Integrator added a new top-level phase during integration,planning/PLAN.md,Phase 9,Approve scope add or revert
```

### Error Categories (new codes — F-01, F-03 scope)

| Code | Severity | When Used | Retryable | Owner Phase |
|------|----------|-----------|-----------|-------------|
| SCOPE_EXPANSION | blocking | Integrator added a top-level structural section (Phase, Feature, Milestone) during integration; driver halts per C-06 | No — user must approve scope or revert | F-01 (Phase 5) |
| INTEGRATOR_NOT_FOUND | blocking | `converge.config.integrator` does not resolve to an `agents/{name}.md` file | No — fix config | F-01 (Phase 2) |
| HARNESS_MISSING | blocking | `converge.config.harness` path does not exist or harness produces no `findings.toon` | No — fix config or harness | F-01 (Phase 2) |
| FINDINGS_SCHEMA_INVALID | blocking | Harness wrote `findings.toon` but it fails `ConvergenceFindings` schema validation | No — fix harness output | F-01 (Phase 2) |
| SNAPSHOT_WRITE_FAILED | warning | Auto-snapshot per C-07 failed; loop continues but logs warning | Yes — single retry | F-03 (Phase 11) |
| INTEGRATOR_MODE_AMBIGUOUS | blocking | `plan-builder-agent` invoked with neither a roadmap (full-plan mode) nor `findings.toon` (integrator mode) | No — orchestrator-side bug | F-03 (Phase 8) |
| CRITIQUE_TOO_LARGE | warning | `plan-critic-agent` produced a critique exceeding the configured token budget; revise pass receives a truncated critique | Advisory | F-02 (Phase 6) |

### Existing codes referenced (unchanged)

| Code | Severity | Notes |
|------|----------|-------|
| STALL | blocking | Existing driver circuit breaker; document mode reuses it unchanged |
| REGRESSION | blocking | Same |
| BUDGET_EXHAUSTED | blocking | Same |
| MAX_ITERATIONS | blocking | Same; default 3 for document mode per C-05 |

### Retry Behavior

| Error type | Strategy | Max retries |
|------------|----------|-------------|
| SNAPSHOT_WRITE_FAILED | Single retry with backoff (1s), then warn-and-continue | 1 |
| HARNESS_MISSING transient (e.g., bun script crash) | Single retry, then halt | 1 |
| FINDINGS_SCHEMA_INVALID | No retry; halt with diagnostic | 0 |
| SCOPE_EXPANSION (interactive) | No retry; halt and prompt user | 0 |
| SCOPE_EXPANSION (under `--auto`) | No retry; halt with exit code 1, no prompt; machine-readable haltReason on stderr <!-- Applied: PF-04 (B-06) — C-08 resolution --> | 0 |
| INTEGRATOR_NOT_FOUND | No retry; halt at preflight | 0 |

## Plan-Local Constraints

<!-- Applied: PF-04 (B-06) — new C-08 plan-local constraint resolving --auto vs SCOPE_EXPANSION; PF-05 (B-04/B-05) — locked progress + halt message formats -->

These constraints are plan-local refinements consistent with — and not contradicting — the roadmap's locked decisions (C-01 through C-07). They resolve ambiguities surfaced in pass-1 review.

### C-08: `--auto` + SCOPE_EXPANSION reconciliation

**Decision:** When the driver is running under `--auto` (non-interactive) and the scope-expansion guard fires, the driver MUST:
1. Write `haltReason: SCOPE_EXPANSION` to `iter-{N}.toon` and to `convergence-state.toon`.
2. Emit a machine-readable halt line to stderr: `{"haltReason":"SCOPE_EXPANSION","iteration":N,"subject":"<path>","snapshot":"<snapshotPath>"}`.
3. Exit the process with code 1.
4. NOT prompt the user (no `--auto` invariant violation).

Under interactive mode (no `--auto`), the existing behavior holds: the loop halts and the user is prompted to approve scope addition or revert.

**Rationale:** Preserves the non-interactive promise of `--auto` (Q-01) while keeping scope expansion as a hard halt signal (C-06). Exit code 1 lets shell wrappers and CI distinguish a SCOPE_EXPANSION halt from a clean convergence (exit 0). The JSON stderr line is parseable by `/loom-resume` and external orchestrators.

**Applies to:** Phase 5 (driver implementation), Phase 10 (`--autoconverge` wiring), Phase 14 (e2e fixture).

### C-09: Driver stdout progress line format

**Decision:** During every document-mode iteration, the driver MUST emit exactly one progress line to stdout AFTER the harness completes and BEFORE the next state transition:

```
[autoconverge] iteration {N}/{max} — blockingCount: {prev} → {curr} ({fixed} fixed, {new} new)
```

Where:
- `{N}` is the 1-indexed current iteration
- `{max}` is `converge.config.maxIterations`
- `{prev}` is `blockingCount` from iteration N-1 (or `—` on iteration 1)
- `{curr}` is `blockingCount` from the just-completed harness run
- `{fixed}` is the count of finding IDs present in iteration N-1 but absent in iteration N
- `{new}` is the count of finding IDs present in iteration N but absent in iteration N-1

On iteration 1 the line uses `—` for `prev`, `fixed`, and `new`. On convergence the line is followed by a `[autoconverge] CONVERGED — blockingCount: 0` line. The progress line is the sole UX signal for long-running loops.

**Rationale:** Pass-1 review B-04 flagged that there is no defined visibility surface for multi-iteration runs. A locked single-line format keeps the surface narrow and parseable.

### C-10: Per-breaker halt message + recovery format

**Decision:** Whenever the driver halts (any haltReason), it MUST emit exactly one halt block to stdout with this shape:

```
[autoconverge] HALTED: {haltReason} — {one-sentence cause}
[autoconverge] Recovery: {recovery command}
```

The cause and recovery strings are locked per haltReason:

| haltReason | one-sentence cause | recovery command |
|------------|-------------------|------------------|
| STALL | blockingCount unchanged across 2 consecutive iterations — integrator made no measurable progress | Inspect the latest findings.toon and re-invoke `/loom-converge --resume` after fixing the integrator prompt or splitting the work |
| REGRESSION | blockingCount increased from the prior iteration — the integrator introduced new blocking findings | Review `planning/history/snapshots/{slug}-pass-{N}.{ext}` and `cp` the prior snapshot back, then re-invoke `/loom-converge --resume` |
| BUDGET_EXHAUSTED | cumulative agent spawns exceeded converge.config.agentBudget | Increase `agentBudget` in `converge.config` and re-invoke `/loom-converge --resume` |
| MAX_ITERATIONS | iteration count reached converge.config.maxIterations without convergence | Either accept the current draft, raise `--max-iterations`, or revert to a snapshot and re-invoke |
| SCOPE_EXPANSION | integrator added a new top-level Phase/Feature/Milestone — scope changes require explicit user consent (C-06) | Inspect the latest plan, either approve the new scope (commit + re-invoke without `--autoconverge`) or `cp` `planning/history/snapshots/{slug}-pass-{N}.{ext}` back and re-invoke |
| INTEGRATOR_NOT_FOUND | the agent named in `converge.config.integrator` does not exist under `agents/` | Fix the `integrator` field in `converge.config` to a registered agent name |
| HARNESS_MISSING | the path named in `converge.config.harness` does not exist or returned no `findings.toon` | Fix the `harness` field in `converge.config` or repair the harness script |
| FINDINGS_SCHEMA_INVALID | harness wrote `findings.toon` but its contents fail schema validation (e.g., blockingCount mismatch) | Inspect `findings.toon` and the harness aggregator; the harness is producing malformed output |
| CRITIQUE_TOO_LARGE | critic prompt would exceed the haiku-tier token budget; critic ran in truncated mode (subset of reviewer instructions) | Critic findings may be incomplete; if the integrator pass below the formal-review pass-1 baseline does not produce ≤50% reduction, manually re-run with `--skip-critic` and rely on the formal review |
| INTEGRATOR_MODE_AMBIGUOUS | plan-builder integrator-mode entry received input that matches neither `{findings.toon + subject}` (integrator-mode) nor `{ROADMAP path}` (full-generation mode) | Inspect the agent invocation — the orchestrator passed malformed input; check `commands/loom-plan/create.md` Step 5 for argument-passing bug |

**Rationale:** Pass-1 review B-05 flagged that the five circuit breakers all halt with no defined user-facing text. A locked per-breaker (cause + recovery) format makes the halt experience self-service.

**Applies to:** Phase 2 (driver loop-body output), Phase 4 (circuit-breaker docs), Phase 10 (`--autoconverge` surface), Phase 14 (e2e fixture stdout assertions).

### C-11: Future loom-auto link compatibility

**Decision:** All `--autoconverge` outputs MUST be reconstructable from disk. `convergence-summary.toon` is the authoritative "did we converge" signal; its `status` field is the source of truth read by verify-link today and by the future converge-link. The plan's outputs (PLAN.md, criteria-plan.toon, findings.toon, convergence-summary.toon, iter-{N}.toon, snapshot.toon, critique.toon) must be sufficient for a fresh-context agent (a future loom-auto link) to derive its own `link-result.toon` envelope and a `nextLink ∈ {verify, fix, planning, done}` decision without orchestrator-side conversational state.

**Rationale:** A parallel session is restructuring `/loom-auto` into a trampoline + dispatched-links architecture (commits 3872228, 1e1b31a). Three links already shipped (verify, fix, execute); two are queued (converge — Phase 4; planning — Phase 5). When the planning link extracts `/loom-plan create` (and `--autoconverge` with it), the link must be able to read this plan's on-disk outputs and emit a `link-result.toon` per `agents/protocols/link-result.schema.md` without any translation layer. Aligning now is one-line cheaper than retrofitting later.

**Alternatives considered:** (a) Delay link-compat until the converge-link is built (rejected — every additional output we add without explicit shape is a future translation burden). (b) Pre-emptively write the `--autoconverge` wrapper as a loom-auto link directly (rejected — premature; the planning link is the proper home, and its design is owned by the parallel session).

**Impact:** low. The plan already keeps state strictly on disk and avoids adding orchestrator-side state to pipeline-state.toon. C-11 is mostly a confirmation + one explicit additive artifact (ConvergenceSummary) so the link contract is satisfied without surprises.

**Applies to:** Phase 0 (schema for convergence-summary.toon), Phase 2 (driver writes the summary at terminal-state transition), Phase 10 (`--autoconverge` produces it reachable from disk), Phase 14 (fixture asserts the artifact is shaped for link consumption).

**Forbidden:**
- Adding convergence-internal fields to `pipeline-state.toon` (use `convergence-state.toon` instead)
- Returning arbitrary `AgentResult` structures from the driver back to a caller (write to disk, caller reads)
- Introducing new `currentStage` values mid-convergence (reserved for the future converge-link's namespace)
- Inline orchestrator code that mutates PLAN.md from conversational state (anything the planning logic needs must be reconstructable from disk on a fresh agent invocation)

## Execution Phases

### Phase 0 — Wave 0: Contracts — Schemas + Locked Decision Hooks

**Agent:** contracts-agent
**Objective:** Land all TOON schema additions and protocol-doc updates so downstream phases have a single, stable contract to read from.
**Dependencies:** None
**File Ownership:** agents/protocols/convergence-tier.schema.md, agents/protocols/stage-context.schema.md, agents/protocols/schema-versions.toon, agents/protocols/findings.schema.md, agents/protocols/plan-critique.schema.md, agents/protocols/iteration-snapshot.schema.md, agents/protocols/convergence-summary.schema.md <!-- Added: C-11 — convergence-summary.toon schema is load-bearing for future loom-auto converge-link / verify-link -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/convergence-tier.schema.md | Modify | contracts-agent (add `convergenceMode: document` enum value, `subject`, `integrator`, and `harness` field rows to ConvergeConfig table; document `scopeGuardEnabled`, `snapshotEnabled`, `snapshotDir`; note `outputPath` default of `.plan-execution/convergence/findings.toon`) <!-- Applied: PF-03 (B-01) — explicit harness field row in deliverable; the harness field already exists in the in-plan schema table at line 47 but the Phase 0 deliverable description omitted it. --> |
| agents/protocols/stage-context.schema.md | Modify | contracts-agent (extend `ConvergenceIterationSummary` with optional `subject` and `snapshotRef` fields; assert shape uniformity across all 3 modes) |
| agents/protocols/findings.schema.md | Create | contracts-agent (new `ConvergenceFindings` schema doc per the Schema section) |
| agents/protocols/plan-critique.schema.md | Create | contracts-agent (new `PlanCritique` schema doc per the Schema section) |
| agents/protocols/iteration-snapshot.schema.md | Create | contracts-agent (new `IterationSnapshot` schema doc per the Schema section) |
| agents/protocols/convergence-summary.schema.md | Create | contracts-agent (new `ConvergenceSummary` schema doc per the Schema section; document all 11 fields including the `status` enum and the document-mode `subject` field) <!-- Added: C-11 — explicit schema for the run-end artifact a future loom-auto converge-link will read --> |
| agents/protocols/schema-versions.toon | Modify | contracts-agent (register the four new schemas with version 1) |

#### Acceptance Criteria
- [ ] `agents/protocols/findings.schema.md` exists and documents all 7 ConvergenceFindings fields with validation rules
- [ ] `agents/protocols/plan-critique.schema.md` exists and documents the 7 PlanCritique fields plus the `dimensionsCovered` locked enum of 6 dimensions
- [ ] `agents/protocols/iteration-snapshot.schema.md` exists and documents the 6 IterationSnapshot fields including sha256 checksum requirement
- [ ] `agents/protocols/convergence-tier.schema.md` documents the `document` value in the convergenceMode enum and the `subject`/`integrator`/`harness`/`outputPath`/`scopeGuardEnabled`/`snapshotEnabled`/`snapshotDir` fields <!-- Applied: PF-03 (B-01) — harness + outputPath explicitly named -->
- [ ] `ConvergeConfig` Validation Rules subsection documents timestamp precision as ISO 8601 with millisecond precision (`producedAt: 2026-06-12T15:30:00.000Z`) so stall-detection regression checks compare uniformly <!-- Applied: W-01 — lock timestamp precision -->
- [ ] `IterationSnapshot` slug derivation rule documents handling of filenames with multiple dots (e.g., `PLAN-x.v2.md` → slug `PLAN-x.v2`; basename minus FINAL extension only) <!-- Applied: W-02 — slug ambiguity -->
- [ ] `ConvergenceFindings` schema includes a `reviewerAgent` field on each `findings[]` row preserving attribution after aggregation (string, optional for non-harness contexts) <!-- Applied: W-03 — preserve reviewer attribution -->
- [ ] `ConvergenceFindings` schema includes a `severityToConvergenceSeverity` mapping table in the doc body: AgentResult `critical|high` → `blocking`; `medium` → `warning`; `low|info` → `info` <!-- Applied: PF-09 / CC-03 / W-18 — harness aggregator severity mapping -->
- [ ] `ConvergenceIterationSummary` extension table lists `haltReason` as an optional enum field across all three modes (values: `STALL`, `REGRESSION`, `BUDGET_EXHAUSTED`, `MAX_ITERATIONS`, `SCOPE_EXPANSION`) <!-- Applied: I-01 — haltReason field on iter summary -->
- [ ] `agents/protocols/stage-context.schema.md` `ConvergenceIterationSummary` section explicitly states uniform shape across `target`, `criteria`, `document` and lists `subject`/`snapshotRef` as optional document-mode fields
- [ ] `agents/protocols/schema-versions.toon` registers `convergence-findings`, `plan-critique`, `iteration-snapshot`, `convergence-summary` each at version 1
- [ ] `agents/protocols/convergence-summary.schema.md` exists and documents all 11 ConvergenceSummary fields including the `status` enum (6 values), the document-mode `subject` field, and the `haltReason` cross-reference to ConvergenceIterationSummary <!-- Added: C-11 — link contract requires this artifact -->
- [ ] `bun test test/protocol/schema-validation.test.ts` exits with code 0

#### Convergence Targets
- New schema docs follow the existing format pattern (frontmatter + Required/Optional sections) so they parse the same way existing protocol docs do
- `schema-versions.toon` decodes via `@toon-format/toon` without warnings

#### Scenarios

```toon
id: S-01
title: ConvergeConfig schema accepts convergenceMode=document with required fields
given[2]: agents/protocols/convergence-tier.schema.md documents the document mode, A converge.config TOON file declares convergenceMode=document with subject + integrator + harness fields
when: The schema validator parses the config
whenTriggerType: system-event
then[2]: Validation passes with no errors, Missing subject or integrator when mode=document produces a blocking validation error
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: ConvergenceFindings schema rejects mismatched blockingCount
given[1]: A findings.toon has blockingCount=2 but only 1 finding row with severity=blocking
when: The ConvergenceFindings schema validator runs over the file
whenTriggerType: system-event
then[2]: Validation fails with error code FINDINGS_SCHEMA_INVALID, Error message names the count mismatch
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

---

### Phase 1 — Wave 1: Driver Mode Detection + Config Loading

**Agent:** implementer-agent
**Objective:** Teach `convergence-driver.md` to accept `convergenceMode: document` in `converge.config`, resolve `subject` + `integrator` + `harness`, and run the preflight checks (INTEGRATOR_NOT_FOUND, HARNESS_MISSING) before entering the loop.
**Dependencies:** Phase 0
**Implicit reads:** commands/loom-converge.md (current command surface so Mode Detection language stays in sync with the command's flag table) <!-- Applied: I-16 — implicit dep on loom-converge.md -->
**File Ownership:** agents/convergence-driver.md (Mode Detection + Input + Preflight sections only — body of loop is Phase 2)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent (add `document` to the Mode Detection list; extend Input section to call out `subject` and `integrator`; add Preflight Validation subsection covering INTEGRATOR_NOT_FOUND and HARNESS_MISSING) |

#### Acceptance Criteria
- [ ] `agents/convergence-driver.md` Mode Detection section lists `document` as the third accepted value
- [ ] Driver's preflight section documents resolving `integrator` to an `agents/{name}.md` file and halting with `INTEGRATOR_NOT_FOUND` if absent
- [ ] Driver's preflight section documents validating `harness` existence and halting with `HARNESS_MISSING` if absent
- [ ] Driver's preflight section documents the model-resolution requirement (per CLAUDE.md) for the resolved integrator before spawning
- [ ] Driver instructions describe loading the new `converge.config` fields without breaking backwards compatibility for `target`/`criteria` configs
- [ ] Preflight emits a user-facing diagnostic when an old-style `converge.config` declares `convergenceMode: document` without a `subject` field (message: `Document-mode config is missing required field 'subject' (path to subject file). Update converge.config or remove convergenceMode:document.`) — distinct from a raw schema-validation error <!-- Applied: W-09 — friendlier missing-subject message -->

#### Convergence Targets
- A `converge.config` lacking `subject` when `convergenceMode: document` causes the driver to write a blocking preflight issue (verified by inspection of driver text)

#### Scenarios

```toon
id: S-01
title: Driver halts at preflight when integrator agent does not exist
given[2]: converge.config declares convergenceMode=document and integrator=nonexistent-agent, agents/nonexistent-agent.md does not exist
when: The convergence-driver runs preflight
whenTriggerType: system-event
then[2]: Driver halts before iteration 1 with code INTEGRATOR_NOT_FOUND, AgentResult.issues includes a blocking row referencing the missing agent
stateRef:
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-02
title: Driver accepts a valid document-mode config
given[2]: converge.config declares convergenceMode=document with valid subject + integrator + harness, All referenced files exist
when: The convergence-driver runs preflight
whenTriggerType: system-event
then[1]: Driver enters the loop without errors
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 2 — Wave 1: Driver Loop Body — Document Mode Branch

**Agent:** implementer-agent
**Objective:** Add the document-mode branch to `convergence-driver.md`'s loop: read `findings.toon` after each harness invocation, compute convergence from `blockingCount`, spawn the config-named integrator instead of hardcoded `fixer-agent`. Existing target/criteria branches MUST NOT be touched.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** agents/convergence-driver.md (Convergence Loop + Scoring Differences + Output Format sections — coordinated with Phase 1; same file but disjoint sections, see Risks)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent (extend Convergence Loop pseudocode with a document-mode branch; extend Scoring Differences By Mode table with a document-mode row; extend Output Format with document-mode report shape; integrator spawn is config-driven per C-03) |

#### Acceptance Criteria
- [ ] Driver's Convergence Loop section pseudocode shows a single loop with mode-specific branches (NOT a forked loop); document-mode branch reads `findings.toon` and uses `blockingCount` for convergence check
- [ ] Driver's Scoring Differences By Mode table gains a `document` column: unit = blocking finding count, passing = blockingCount==0, regression = blockingCount > prior_blockingCount
- [ ] Driver's Output Format section includes a document-mode report variant showing `convergenceMode: document`, `subject:`, `blockingHistory[]`
- [ ] Driver's Output Format section documents the per-iteration stdout progress line per C-09: `[autoconverge] iteration {N}/{max} — blockingCount: {prev} → {curr} ({fixed} fixed, {new} new)` <!-- Applied: PF-05 (B-04) — progress visibility format -->
- [ ] Driver's Output Format section documents the convergence-success line: `[autoconverge] CONVERGED — blockingCount: 0` emitted after the final iteration's progress line <!-- Applied: PF-05 (B-04) / W-13 — empty-state success message -->
- [ ] Driver's Output Format section documents the FINDINGS_SCHEMA_INVALID raise condition when harness output fails schema validation (per Error Handling table) <!-- Applied: I-01 / supporting --> 
- [ ] Driver's Fixer Agent Management section is renamed conceptually to "Integrator Agent Management" or augmented with text clarifying that "integrator" is config-driven per C-03; explicit note that target/criteria modes default `integrator` to `fixer-agent` for backwards compat
- [ ] All existing target-mode and criteria-mode references in the driver remain unchanged (verified by diff scope)
- [ ] Driver's Convergence Loop section documents that at terminal-state transition (converged OR halted), the driver writes `convergence-summary.toon` atomically with all 11 fields per `agents/protocols/convergence-summary.schema.md` — `status` is the authoritative "did we converge" signal for downstream consumers (verify-link today, future converge-link). Per C-11, this artifact must be reconstructable from disk for future loom-auto link extraction. <!-- Added: C-11 — terminal-state write of convergence-summary.toon -->
- [ ] `bun test test/protocol/schema-validation.test.ts` exits with code 0
- [ ] `bun test test/protocol/pipeline-loop.test.ts` exits with code 0

#### Convergence Targets
- Loop pseudocode contains exactly one `for iteration` block (verifiable via grep)
- A canned `findings.toon` with `blockingCount=0` causes the driver to exit at convergence-check step on iteration 1 (verifiable via fixture in Phase 13)
- A run that exits the loop (any path) leaves `convergence-summary.toon` on disk with `status` matching the actual outcome (verifiable in Phase 13 + Phase 14 fixtures per C-11)

#### Scenarios

```toon
id: S-01
title: Document-mode loop converges on iteration 1 with zero blocking findings
given[2]: converge.config has convergenceMode=document, A fixture harness writes findings.toon with blockingCount=0 on first invocation
when: The driver runs the loop
whenTriggerType: system-event
then[2]: Driver exits at convergence-check after iteration 1 with status=converged, iter-1.toon is written with summary noting zero blocking findings
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Document-mode loop spawns the integrator named in config (not hardcoded fixer-agent)
given[2]: converge.config integrator=plan-builder-agent, Findings.toon has blockingCount>0 after iteration 1
when: The driver enters iteration 2 integrator step
whenTriggerType: system-event
then[2]: Driver spawns plan-builder-agent (not fixer-agent), Spawn call includes resolved model per CLAUDE.md frontmatter rule
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

### Phase 3 — Wave 1: Driver Resume + State File Mode Awareness

**Agent:** implementer-agent
**Objective:** Extend the driver's `convergence-state.toon` write/read paths to round-trip `convergenceMode: document` plus the new `subject` field, and the per-iteration history table to record blocking-finding counts.
**Dependencies:** Phase 1, Phase 2
**File Ownership:** agents/convergence-driver.md (State Tracking section + iter-{N}.toon writing rules)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent (extend State Tracking with a document-mode example showing `convergenceMode: document`, `subject:`, and a `history[]` table whose columns include `blockingCount`; document that `--resume` rebuilds iteration state from the last `iter-{N}.toon` regardless of mode) |
| test/protocol/stage-context.test.ts | Modify | implementer-agent (extend existing test suite to assert the extended ConvergenceIterationSummary shape parses for all three modes; cover document-mode `subject` + `snapshotRef` + `haltReason` optional fields) <!-- Applied: I-17 — missing test deliverable row --> |

#### Acceptance Criteria
- [ ] Driver's State Tracking section contains a document-mode example block showing the new fields
- [ ] Driver instructions explicitly state that `iter-{N}.toon` shape MUST be identical across all three modes (the new `subject` and `snapshotRef` fields are present but null for non-document modes)
- [ ] Resume path documented: on `/loom-converge --resume`, driver reads `convergence-state.toon`, detects `convergenceMode: document`, and continues from the last completed iteration
- [ ] `bun test test/protocol/stage-context.test.ts` exits with code 0 (validates the extended ConvergenceIterationSummary shape)

#### Convergence Targets
- A fixture state file with `convergenceMode: document` round-trips through TOON encode/decode losslessly

#### Scenarios

```toon
id: S-01
title: Iteration summary shape is uniform across all three modes
given[3]: A target-mode iter-1.toon, A criteria-mode iter-1.toon, A document-mode iter-1.toon
when: The stage-context schema validator parses all three
whenTriggerType: system-event
then[2]: All three pass validation against the same ConvergenceIterationSummary schema, Document-mode file populates subject and snapshotRef; other modes leave them null
stateRef:
tags[2]: regression, happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Resume restores a document-mode loop from convergence-state.toon
given[2]: A convergence-state.toon shows convergenceMode=document and iteration=2 completed, /loom-converge --resume is invoked
when: The driver starts up
whenTriggerType: system-event
then[2]: Driver detects document mode and continues from iteration 3, No re-run of iteration 1 or 2 occurs
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 4 — Wave 1: Circuit Breaker Parity for Document Mode

**Agent:** implementer-agent
**Objective:** Confirm and document that the existing circuit breakers (STALL, REGRESSION, BUDGET_EXHAUSTED, MAX_ITERATIONS) apply identically in document mode with `blockingCount` as the comparison metric.
**Dependencies:** Phase 2, Phase 3
**File Ownership:** agents/convergence-driver.md (Circuit Breakers section)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent (extend Circuit Breakers table with a "Document mode comparison metric" column noting `blockingCount`; add a Document Mode subsection clarifying stall = `blockingCount` unchanged for 2 iterations, regression = `currentBlocking > priorBlocking`, budget = sum of harness + integrator spawns; cross-reference C-05 default of 3 iterations) |

#### Acceptance Criteria
- [ ] Driver's Circuit Breakers table or accompanying text names `blockingCount` as the document-mode metric for STALL and REGRESSION
- [ ] Driver text explicitly states all 4 breakers work identically across modes (DRY goal from C-01 verified by inspection)
- [ ] Driver text references C-05 for the default max-iterations of 3 in document mode
- [ ] Driver Circuit Breakers section documents the locked halt-message format per C-10: each breaker has a one-sentence cause string and a recovery command string emitted on halt, sourced from the C-10 table <!-- Applied: PF-05 (B-05) — halt message format per breaker -->

#### Convergence Targets
- A document-mode loop where iteration 2's `blockingCount == iteration 1's blockingCount` AND iteration 3's stays equal triggers STALL (verified by Phase 13 fixture)

#### Scenarios

```toon
id: S-01
title: Document-mode loop halts with STALL when blockingCount stays flat
given[1]: Iterations 1 and 2 both report blockingCount=4 from the harness
when: The driver evaluates circuit breakers after iteration 2
whenTriggerType: system-event
then[2]: Driver writes haltReason=STALL to iter-2.toon, Driver exits the loop without spawning iteration 3 integrator
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-02
title: Document-mode loop halts with REGRESSION when blockingCount increases
given[1]: Iteration 1 reports blockingCount=3 and iteration 2 reports blockingCount=5
when: The driver evaluates circuit breakers after iteration 2
whenTriggerType: system-event
then[2]: Driver writes haltReason=REGRESSION to iter-2.toon, Driver report includes a diff showing 3->5
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

---

<!-- Applied: PF-01 (CC-01 / B-08) — Phase 5's ACs are split into doc-only (verifiable on Phase 5 landing) and helper-dependent (verifiable after Phase 11 ships, also in Wave 2). Phase 11 is promoted to Wave 2 and runs serially after Phase 5 within W2. -->

### Phase 5 — Wave 2: Scope-Expansion Guard + Auto-Snapshot — M-01 Driver Layer

**Agent:** implementer-agent
**Objective:** Document the document-mode-only safeguards in the driver: scope-expansion detection (per C-06) and auto-snapshot writing (per C-07). Driver-text only; the helper that actually writes the snapshot lands in Phase 11 (same wave, serial dependency).
**Dependencies:** Phase 2, Phase 3, Phase 4
**File Ownership:** agents/convergence-driver.md (Document Mode Safeguards subsection — new). The IterationSnapshot schema doc was created in Phase 0; this phase wires usage on the driver side only.

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/convergence-driver.md | Modify | implementer-agent (add new Document Mode Safeguards subsection covering: scope-expansion guard with precise definition of "top-level structural addition" — new Phase, Feature, or Milestone heading vs. additions within existing phases; SCOPE_EXPANSION halt behavior under both interactive and `--auto` modes per C-08; auto-snapshot write before each integrator invocation; snapshot filename slug derivation rule; cite `hooks/lib/iteration-snapshot.ts` helper from Phase 11 as the implementation owner) |

#### Acceptance Criteria — Driver-Doc Layer (verifiable on Phase 5 landing)
- [ ] Driver Document Mode Safeguards subsection defines scope expansion as adding a new top-level `### Phase N`, `### F-NN`, or `### M-NN` heading (additions of acceptance-criteria bullets, deliverables, or convergence-target bullets within existing phases do NOT trigger the guard)
- [ ] Driver text states the loop halts with `haltReason: SCOPE_EXPANSION` and exits cleanly when the guard fires; under interactive mode the subject file is left in the post-integration state and a user prompt is recorded; under `--auto` mode the driver exits with code 1 and a machine-readable stderr line per C-08 (no prompt) <!-- Applied: PF-04 (B-06) — C-08 wired into Phase 5 AC -->
- [ ] Driver text states an `IterationSnapshot` row is written to `planning/history/snapshots/{slug}-pass-{N}.{ext}` and a sibling `snapshot.toon` record before every integrator spawn (iterations >= 2 in document mode)
- [ ] Driver text documents calling `writeIterationSnapshot(...)` from `hooks/lib/iteration-snapshot.ts` (helper landed in Phase 11) and the `SNAPSHOT_WRITE_FAILED` warn-and-continue behavior per the Error Handling table
- [ ] Driver text defines scope-expansion detection regex precisely: `^### Phase \d+`, `^### F-\d+`, `^### M-\d+` (line-anchored, exact heading-level 3) <!-- Applied: I-12 — scope-expansion regex defined -->
- [ ] Driver text cross-references C-08 (auto + SCOPE_EXPANSION), C-09 (progress format), and C-10 (halt message format) <!-- Applied: PF-04 + PF-05 -->
- [ ] `bun test test/protocol/pipeline-loop.test.ts` exits with code 0

#### Acceptance Criteria — Helper-Dependent Layer (verifiable after Phase 11 ships)
<!-- Applied: PF-01 (CC-01 / B-08) — these ACs depend on Phase 11's writeIterationSnapshot helper; both phases ship in Wave 2 so the M-01 gate is testable when W2 closes -->
- [ ] A document-mode loop reaching iteration 2 calls `writeIterationSnapshot` and produces `planning/history/snapshots/{slug}-pass-2.{ext}` plus the sibling `.toon` record (verified by Phase 13 fixture, which runs in W5; intra-W2 verification is by direct helper invocation in a unit test after Phase 11 lands)
- [ ] A simulated EIO on the first snapshot write triggers exactly one retry from the helper, then either succeeds or surfaces `SNAPSHOT_WRITE_FAILED` per the Error Handling table

#### Convergence Targets
- A document-mode integrator that adds a new `### Phase 11` to the subject triggers `haltReason: SCOPE_EXPANSION`
- A document-mode integrator that only modifies an existing phase's acceptance criteria does NOT trigger the guard
- Every iteration with `iteration >= 2` writes a snapshot file under `planning/history/snapshots/`

#### Scenarios

```toon
id: S-01
title: Scope-expansion guard halts the loop (interactive mode) with user prompt
given[2]: PLAN.md has 10 phases at start of iteration 2 integrator step, Integrator returns a revised PLAN.md with 11 phases (added Phase 10b)
when: The driver runs its scope-expansion check after integrator completes (no --auto flag set)
whenTriggerType: system-event
then[3]: Driver writes haltReason=SCOPE_EXPANSION to iter-2.toon, Driver exits the loop, User-prompt message per C-10 is recorded asking to approve scope addition or revert
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

```toon
id: S-04
title: Scope-expansion under --auto halts with exit code 1 and no prompt
given[2]: Driver is running under --auto (non-interactive), Integrator returns a revised subject with a new top-level phase added
when: The driver runs its scope-expansion check after integrator completes
whenTriggerType: system-event
then[3]: Driver writes haltReason=SCOPE_EXPANSION to iter-2.toon and convergence-state.toon, Driver emits a machine-readable JSON line to stderr per C-08, Driver process exits with code 1 — no interactive prompt
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```
<!-- Applied: PF-04 (B-06) — new scenario covering the --auto branch of C-08 -->

```toon
id: S-02
title: Scope-expansion guard does NOT trigger on acceptance-criteria additions
given[2]: PLAN.md Phase 3 has 4 AC bullets at start of iteration 2, Integrator adds 2 more AC bullets to Phase 3 (still 10 phases total)
when: The driver runs its scope-expansion check
whenTriggerType: system-event
then[2]: Driver does NOT halt with SCOPE_EXPANSION, Driver proceeds to harness re-run
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-03
title: Auto-snapshot writes a per-iteration snapshot file before integrator runs
given[2]: A document-mode loop reaches iteration 2 integrator step, snapshotEnabled=true (default)
when: The driver enters the snapshotting state
whenTriggerType: system-event
then[3]: planning/history/snapshots/PLAN-{slug}-pass-2.md exists, A matching IterationSnapshot record is written, sha256 checksum matches the snapshot file contents
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 6 — Wave 3 (W3a): Plan-Critic Agent + Concerns Checklist

**Agent:** implementer-agent
**Objective:** Create `agents/plan-critic-agent.md` as a haiku-tier advisory agent that reads the draft plan and the 6 reviewer agent instructions, then writes a `PlanCritique` TOON file with predicted blocking and advisory findings.
**Dependencies:** Phase 0 (PlanCritique schema), M-01 (Phases 1-5 + Phase 11 complete since 11 is now W2)
**File Ownership:** agents/plan-critic-agent.md, agents/plan-critic-checklist.md
**Wave sub-label:** W3a (parallel with Phase 8) <!-- Applied: CC-05 (I-13) — W3 sub-ordering -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/plan-critic-agent.md | Create | implementer-agent (frontmatter `model: haiku` per C-04; system-prompt instructs reading PLAN.md + the 6 reviewer agent `.md` files; output is a `PlanCritique` TOON block; advisory-only — no gating; max ~30 concerns per checklist) |
| agents/plan-critic-checklist.md | Create | implementer-agent (30-item concerns checklist distilled from the 6 reviewer agents; each item names the dimension it serves) |

#### Acceptance Criteria
- [ ] `agents/plan-critic-agent.md` has YAML frontmatter with `model: haiku`
- [ ] Agent prompt instructs reading the 6 reviewer agent files (`feature-coverage-agent.md`, `strategy-agent.md`, `ux-agent.md`, `phasing-agent.md`, `parallelization-agent.md`, `agentic-workflow-agent.md`) using project-relative paths under `agents/` (NOT home-relative `~/.claude/agents/` — those resolve correctly for global agents but the project ships its own copies under `.loom-ai/agents/`; Loom's resolution order is project-first) <!-- Applied: I-18 — path fix -->
- [ ] Agent prompt explicitly states critic is advisory-only — does not gate, block, or produce schema artifacts beyond `critique.toon`
- [ ] Agent prompt declares `dimensionsCovered[]` must come from the locked enum of 6 dimensions
- [ ] `agents/plan-critic-checklist.md` contains exactly 30 numbered concerns, each tagged with one of the 6 dimensions
- [ ] Output format documented in the agent prompt matches the `PlanCritique` schema from `agents/protocols/plan-critique.schema.md`

#### Convergence Targets
- The critic prompt body fits within the 100k context budget cap when run against a 20-phase plan + 6 reviewer agent files (verified by token-estimator on a fixture)

#### Scenarios

```toon
id: S-01
title: Plan-critic produces a valid PlanCritique TOON block for a fixture plan
given[2]: A fixture PLAN.md with known reviewer-flaggable issues exists, plan-critic-agent is invoked with the plan as input
when: The agent completes
whenTriggerType: system-event
then[3]: Agent writes .plan-execution/critique.toon, critique.toon parses against the PlanCritique schema with no errors, predictedFindings contains at least one row tagged with each of phasing, parallelization, agentic-workflow dimensions
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

<!-- Applied: CC-05 (I-13) — Wave 3 is internally W3a (Phases 6 + 8 parallel) → W3b (Phase 7 after Phase 6). The "Wave 3" label remains for the executor; the sub-ordering is via explicit deps. Phase 7 belongs to W3b. -->

### Phase 7 — Wave 3 (W3b): Wire Critic Into create.md Step 1 + Step 1.7 Revise

**Agent:** implementer-agent
**Objective:** Extend `commands/loom-plan/create.md` Step 1 (currently dual-track: plan-builder + criteria-planner) into a triple-track with `plan-critic-agent`. Add a new Step 1.7 that re-spawns `plan-builder` with the critique as additional context to produce a revised draft before validation. Add the `--skip-critic` flag.
**Dependencies:** Phase 6
**File Ownership:** commands/loom-plan/create.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-plan/create.md | Modify | implementer-agent (rewrite Step 1 description to triple-track parallel spawn of plan-builder + criteria-planner + plan-critic; insert Step 1.7 "Critic Revise Pass" after Step 1 and before Step 2 validation; document `--skip-critic` flag and its effect of bypassing both the critic spawn and Step 1.7; explicitly call out that critic runs only on initial `create`, NOT on `--review-integrate` per Q-02) |

#### Acceptance Criteria
- [ ] Step 1 documents three parallel agent spawns (plan-builder, criteria-planner, plan-critic) with their respective input contracts
- [ ] Step 1.7 documents the revise pass: read `critique.toon`, re-spawn plan-builder with the critique injected as context, write the revised PLAN.md atomically
- [ ] Step 1.7 explicitly removes any stale `.plan-execution/critique.toon` from prior runs before the critic spawn (so a `--skip-critic` followed by a normal run does not consume a stale critique) <!-- Applied: W-11 — stale critique handling -->
- [ ] Step 1.7 completion echoes `.plan-execution/critique.toon` path + `predictedBlockingCount` to stdout so the user sees what the critic addressed <!-- Applied: W-16 / I-09 — critique discoverability -->
- [ ] Step 1 + Step 1.7 documentation explains the relationship between `critique.toon` (advisory predictions, output of plan-critic-agent) and `findings.toon` (formal review aggregate, output of plan-review harness): different artifacts, distinct filenames, distinct schemas, distinct lifecycle <!-- Applied: W-10 — explain critique vs findings -->
- [ ] `--skip-critic` flag is documented in the command flags section; behavior: skips both critic spawn AND Step 1.7, falling back to legacy dual-track behavior
- [ ] `--skip-critic` flag combination matrix documents interaction with `--autoconverge` (compatible — autoconverge still runs after Step 4) and `--review-integrate` (Q-02 — critic already skipped on review-integrate; `--skip-critic` is a no-op here) <!-- Applied: W-11 — flag combination matrix -->
- [ ] Step 1.7 documentation cites Q-02 explicitly: critic does NOT run on `--review-integrate` invocations
- [ ] Critic spawn includes the haiku model resolution per CLAUDE.md (frontmatter `model: haiku`)
- [ ] Token-budget preflight runs before the critic spawn (existing context-budget hook applies)
- [ ] Step 1.7 documentation includes an explicit starting-state assertion: the create.md file MUST be at the post-Phase-7 commit before Phase 10 (Wave 4) edits run; a grep gate (`grep -q "Step 1.7" commands/loom-plan/create.md`) is documented as Phase 10's pre-edit check <!-- Applied: PF-10 (CC-04) — inter-wave grep gate -->

#### Convergence Targets
- `commands/loom-plan/create.md` grep for "Step 1.7" returns exactly one match
- `commands/loom-plan/create.md` grep for "--skip-critic" returns at least two matches (flag definition + Step 1.7 conditional)

#### Scenarios

```toon
id: S-01
title: /loom-plan create runs critic in parallel by default
given[2]: A valid ROADMAP.md exists, /loom-plan create is invoked without --skip-critic
when: The orchestrator reaches Step 1
whenTriggerType: actor-action
then[2]: plan-builder + criteria-planner + plan-critic are all spawned in parallel, Step 1.7 re-spawns plan-builder with critique.toon contents
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --skip-critic falls back to legacy dual-track behavior
given[2]: A valid ROADMAP.md exists, /loom-plan create --skip-critic is invoked
when: The orchestrator reaches Step 1
whenTriggerType: actor-action
then[3]: Only plan-builder + criteria-planner are spawned (no plan-critic), Step 1.7 is skipped, Validation proceeds with the dual-track output
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

---

### Phase 8 — Wave 3: Plan-Builder Integrator-Mode Entry Point

**Agent:** implementer-agent
**Objective:** Extend `agents/plan-builder-agent.md` with an "integrator mode" entry point: input is `findings.toon` + current PLAN.md path, output is the revised PLAN.md. Disambiguate from existing full-plan generation mode by input shape (no roadmap → ambiguous; raise INTEGRATOR_MODE_AMBIGUOUS).
**Dependencies:** M-01 (Phases 1-5 + Phase 11 complete) <!-- Applied: W-17 — Phase 8 owns plan-builder-agent.md and Phase 6 owns plan-critic-agent.md + plan-critic-checklist.md. Disjoint files. Phase 8 has no dep on Phase 6; both can run in W3a (parallel). The pass-1 plan listed "Phase 6 dep" which was self-contradictory; removed. -->
**File Ownership:** agents/plan-builder-agent.md
**Wave sub-label:** W3a (parallel with Phase 6) <!-- Applied: CC-05 (I-13) — W3 sub-ordering -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/plan-builder-agent.md | Modify | implementer-agent (add new "Integrator Mode" section before "Validation Correction Mode"; document input contract: `findings.toon` path + current subject path; document output contract: revised subject content written atomically; raise `INTEGRATOR_MODE_AMBIGUOUS` if neither roadmap nor findings.toon is provided; reference C-03 explicitly) |

#### Acceptance Criteria
- [ ] Plan-builder agent doc has a top-level "Integrator Mode" subsection
- [ ] Agent doc documents the input contract: when `findings.toon` is present AND a current subject path is provided, run in integrator mode
- [ ] Agent doc documents the output contract: produce a revised subject as a complete document (NOT a diff/patch), written atomically
- [ ] Agent doc raises `INTEGRATOR_MODE_AMBIGUOUS` (per Error Handling table) when neither roadmap nor findings are provided
- [ ] Agent doc cross-references the scope-expansion guard from Phase 5 — integrator MAY add scope, but the driver will halt the loop if it does
- [ ] `bun test test/protocol/plan-validation.test.ts` exits with code 0

#### Convergence Targets
- A fixture findings.toon + a draft PLAN.md fed to plan-builder integrator mode produces a revised PLAN.md whose changed sections trace to specific findings (verified in Phase 13 e2e fixture)

#### Scenarios

```toon
id: S-01
title: Plan-builder integrator mode revises PLAN.md per findings.toon
given[3]: A draft PLAN.md exists, A findings.toon with 3 blocking findings exists, plan-builder is invoked with --integrator-mode + both paths
when: The agent completes
whenTriggerType: system-event
then[2]: PLAN.md is rewritten atomically, Each blocking finding has a corresponding edit in the diff
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Plan-builder raises INTEGRATOR_MODE_AMBIGUOUS with neither roadmap nor findings
given[1]: plan-builder is invoked with neither --roadmap nor --findings.toon arguments
when: The agent runs
whenTriggerType: system-event
then[2]: Agent halts with INTEGRATOR_MODE_AMBIGUOUS, AgentResult.issues includes a blocking row naming the ambiguity
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

---

<!-- Applied: CC-03 (PF-09 / W-28 / W-20) — Phase 9 dependency reversed (Phase 2 consumes findings; Phase 9 produces them — Phase 9 only needs Phase 0's schema). Added explicit files-in list, agent-spawn mechanism, AgentResult-to-ConvergenceFindings mapping reference. -->

### Phase 9 — Wave 4: Plan-Review Harness Script

**Agent:** implementer-agent
**Objective:** Create a TypeScript harness script under `scripts/` that invokes the 6 reviewer agents in parallel against a subject PLAN.md, aggregates their AgentResults, and writes a `ConvergenceFindings` TOON file matching the schema from Phase 0.
**Dependencies:** Phase 0 (schemas) — Phase 9 produces what Phase 2 documents consuming, so Phase 2 is not a hard dep <!-- Applied: W-20 — reversed-causality fix -->
**Implicit reads:** commands/loom-plan/review.md (reviewer-agent list of record), agents/feature-coverage-agent.md, agents/strategy-agent.md, agents/ux-agent.md, agents/phasing-agent.md, agents/parallelization-agent.md, agents/agentic-workflow-agent.md (frontmatter model resolution), agents/protocols/agent-result.schema.md (input shape for aggregator), agents/protocols/findings.schema.md (output shape) <!-- Applied: PF-09 (CC-03 / W-28) — explicit files-in list -->
**File Ownership:** scripts/plan-review-harness.ts, scripts/lib/aggregate-findings.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| scripts/plan-review-harness.ts | Create | implementer-agent (entry point; reads converge.config, invokes the 6 reviewer agents per existing review.md flow, calls aggregateFindings, writes findings.toon atomically) |
| scripts/lib/aggregate-findings.ts | Create | implementer-agent (aggregator: takes 6 AgentResult envelopes, flattens to typed findings rows, computes blockingCount + advisoryCount, returns ConvergenceFindings shape) |

#### Acceptance Criteria
- [ ] `scripts/plan-review-harness.ts` accepts a `converge.config` path argument
- [ ] Script spawns the 6 reviewer agents named in `commands/loom-plan/review.md` (feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow) in parallel
- [ ] Agent-spawn mechanism documented: harness invokes the Claude Code SDK's `Agent` tool via the shared helper at `hooks/lib/spawn-agent.ts` (or, if absent, documents the contract for landing it as a sibling deliverable); spawn calls pass the resolved model from each agent's frontmatter <!-- Applied: PF-09 (CC-03 / W-28) — spawn mechanism named -->
- [ ] Aggregator references the Severity Mapping table from the ConvergenceFindings Schema section (AgentResult `critical|high` → `blocking`; `medium` → `warning`; `low|info|advisory` → `info`) and applies it verbatim <!-- Applied: PF-09 (CC-03 / W-18) — explicit aggregator severity mapping -->
- [ ] Aggregator preserves `reviewerAgent` attribution on each `findings[]` row (one of the 6 reviewer names) <!-- Applied: W-03 -->
- [ ] Aggregator produces a `ConvergenceFindings` TOON block whose `blockingCount` and `advisoryCount` match the sum of severities in `findings[]`
- [ ] Findings.toon is written atomically (write to `.tmp`, rename)
- [ ] Each reviewer agent spawn resolves its model per CLAUDE.md frontmatter rule
- [ ] Partial-failure UX: when one of 6 reviewers returns `AgentResult.status=failed`, the harness writes a stderr warning naming the failed reviewer and the harness exits with code 0 (failures recorded in `findings.toon`, not propagated) <!-- Applied: W-15 — partial-failure warning -->
- [ ] `tsc --noEmit` exits with code 0
- [ ] `bun run lint` exits with code 0
- [ ] `bun test test/protocol/schema-validation.test.ts` (covers ConvergenceFindings shape) exits with code 0

#### Convergence Targets
- A run against a known-broken fixture PLAN.md produces `findings.toon` with `blockingCount >= 1`
- A run against a known-clean fixture PLAN.md produces `findings.toon` with `blockingCount == 0`

#### Scenarios

```toon
id: S-01
title: Plan-review harness writes a valid findings.toon for a broken fixture plan
given[2]: A fixture PLAN.md with known structural issues exists, scripts/plan-review-harness.ts is invoked against it
when: The harness completes
whenTriggerType: system-event
then[3]: .plan-execution/convergence/findings.toon exists, blockingCount >= 1, Schema validation passes on the output
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Plan-review harness exits cleanly when one reviewer agent fails
given[2]: A fixture PLAN.md exists, One of the 6 reviewer agents returns AgentResult.status=failed
when: The harness completes
whenTriggerType: system-event
then[3]: Harness writes findings.toon with findings from the 5 successful reviewers, Findings.toon has an entry noting the failed reviewer, Harness exits with code 0 (failures are recorded, not propagated)
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

---

<!-- Applied: PF-10 (CC-04 / W-23) — Phase 10 starting state explicitly named (post-Phase-7 create.md). Phase 7 is W3b; Phase 10 is W4. Inter-wave handoff is the W3-completion gate. -->
<!-- Applied: W-24 — Phase 10 lists Phase 9 as a dep; therefore Phase 9 and Phase 10 cannot run in parallel within W4. They run serially: Phase 9 then Phase 10. -->

### Phase 10 — Wave 4: `--autoconverge` Flag on /loom-plan create

**Agent:** implementer-agent
**Objective:** Wire `--autoconverge`, `--max-iterations N`, and pass-through `--auto` / `--no-auto-commit` flags into `commands/loom-plan/create.md`. After Step 4 (initial write) the orchestrator writes a generated `converge.config` and invokes the driver.
**Dependencies:** Phase 5 (M-01 complete), Phase 7 (Step 1.7 already in place — pre-edit grep gate `grep -q "Step 1.7" commands/loom-plan/create.md` MUST pass), Phase 8 (integrator entry point exists), Phase 9 (harness exists — Phase 9 + Phase 10 run serially within W4)
**Starting state requirement:** The Phase 10 agent MUST be given the post-Phase-7-commit version of `commands/loom-plan/create.md` as input. Pre-Phase-7 input is a workflow defect (Step 1.7 would be missing). <!-- Applied: PF-10 (CC-04 / W-23) -->
**File Ownership:** commands/loom-plan/create.md (Step 5 — new, after Step 4). library.yaml is NOT owned by this phase; all catalog updates are owned by Phase 12 to avoid double-write per CC-02. <!-- Applied: PF-02 (B-09 / CC-02) -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-plan/create.md | Modify | implementer-agent (add Step 5 "Autoconverge Loop" gated on `--autoconverge`; document config generation with `convergenceMode=document`, `subject={planPath}`, `harness=scripts/plan-review-harness.ts`, `integrator=plan-builder-agent`, `maxIterations=3` per C-05 unless `--max-iterations` overrides; document invoking `/loom-converge --resume-config <path>` with the generated config; document `--auto` compat including C-08 SCOPE_EXPANSION handling; document `--no-auto-commit` interaction with auto-snapshot per C-07; do NOT touch library.yaml — Phase 12 sole owner) |

#### Acceptance Criteria
- [ ] `commands/loom-plan/create.md` Step 5 is gated on the `--autoconverge` flag
- [ ] Step 5 generates a `converge.config` TOON file with the locked-decision defaults: mode=document, integrator=plan-builder-agent, harness=scripts/plan-review-harness.ts, maxIterations=3, scopeGuardEnabled=true, snapshotEnabled=true
- [ ] `--max-iterations N` overrides only the maxIterations field; all other defaults stay
- [ ] Step 5 invokes the convergence-driver via `/loom-converge --resume-config <path>` (the documented entry point — no "or equivalent" hedging) <!-- Applied: W-29 — removed hedge -->
- [ ] Step 5 documents that `--auto` flows through transparently to the inner driver invocation (non-interactive end-to-end per Q-01 and F-03), and that under `--auto` a SCOPE_EXPANSION halt exits with code 1 + machine-readable stderr per C-08 (no prompt) <!-- Applied: PF-04 (B-06) -->
- [ ] Step 5 documents that `--no-auto-commit` disables iteration-level git commits but NOT auto-snapshots (C-07 is independent of git commits)
- [ ] On driver halt (any haltReason), Step 5 leaves the plan in its last-good state and surfaces the haltReason + locked C-10 cause/recovery message to the user (or to stderr under `--auto`) <!-- Applied: PF-05 (B-05) -->
- [ ] Step 5 documents the `--autoconverge` + `--review-integrate` interaction (Q-02: critic skipped on review-integrate; autoconverge still runs; documented as a supported combination) <!-- Applied: I-04 -->
- [ ] Step 5 documents `--dry-run` flag (preview the generated converge.config without invoking the driver) — emits the config TOON to stdout and exits 0 <!-- Applied: W-04 — --dry-run preview -->
- [ ] Step 5 documents link-extraction-readiness per C-11: wrapper outputs (`planning/plans/PLAN-{slug}.md`, `.plan-execution/convergence-summary.toon`, `.plan-execution/criteria-plan-{slug}.toon`, `planning/history/snapshots/{slug}-pass-{N}.{ext}`, all `.plan-execution/convergence/iterations/iter-{N}.toon`) must be sufficient for a fresh-context agent (future loom-auto planning-link or converge-link) to derive a `link-result.toon` envelope and `nextLink ∈ {verify, fix, planning, done}` decision without orchestrator-side conversational state. No `pipeline-state.toon` mutation by the wrapper. <!-- Added: C-11 — link-extraction-readiness -->

#### Convergence Targets
- A fixture invocation of `/loom-plan create --autoconverge --auto` against the autoconverge **test fixture** roadmap at `test/e2e/convergence/fixtures/autoconverge/ROADMAP.md` (NOT the live planning file) completes without prompting — verified in Phase 14, not Phase 13 <!-- Applied: PF-06 (B-07) — Phase 13 covers driver mode parity only; --autoconverge belongs to Phase 14. W-21 — fixture path lives under test/, not planning/. -->
- The generated `converge.config` for `--autoconverge` matches the expected defaults exactly (no drift)
- All wrapper outputs land on disk before the wrapper returns (verified by Phase 14 fixture inspecting the artifact set after a synthetic run) per C-11

#### Scenarios

```toon
id: S-01
title: --autoconverge wires the document-mode loop after initial plan write
given[2]: A valid ROADMAP.md exists, /loom-plan create --autoconverge is invoked
when: The orchestrator reaches Step 5
whenTriggerType: actor-action
then[3]: A converge.config with mode=document is written, /loom-converge is invoked with the generated config, On convergence the changelog records a multi-pass trajectory entry
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --autoconverge with --max-iterations override
given[2]: /loom-plan create --autoconverge --max-iterations 5 is invoked, ROADMAP.md is valid
when: Step 5 generates converge.config
whenTriggerType: actor-action
then[2]: converge.config.maxIterations equals 5, All other defaults (scopeGuardEnabled, snapshotEnabled, harness, integrator) match the locked defaults
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

---

<!-- Applied: PF-01 (CC-01 / B-08) — Phase 11 promoted from Wave 4 to Wave 2. Phase 11 ships immediately after Phase 5 (serial within W2 since 11 depends on 5). This makes Phase 5's helper-dependent ACs verifiable when W2 closes, and lets the M-01 wave boundary be a real gate rather than a paper one. Downstream Phase 13 / Phase 14 deps on Phase 11 still resolve (Phase 11 now lands earlier, not later). -->

### Phase 11 — Wave 2: Snapshot Helper + Slug Derivation

**Agent:** implementer-agent
**Objective:** Implement the snapshot helper invoked by the driver: derives the slug from the subject filename, writes the snapshot file + sibling `IterationSnapshot` TOON record, computes sha256 checksum, handles `SNAPSHOT_WRITE_FAILED` with one retry.
**Dependencies:** Phase 5 (driver documents WHEN to snapshot), Phase 0 (IterationSnapshot schema exists)
**File Ownership:** hooks/lib/iteration-snapshot.ts, test/protocol/checksums.test.ts (extended for snapshot checksums) <!-- Applied: I-19 — checksums.test.ts in deliverables -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/iteration-snapshot.ts | Create | implementer-agent (exports `writeIterationSnapshot(subject, iteration, snapshotDir): IterationSnapshot`; slug from basename minus FINAL extension only (multi-dot safe per Schema doc); sha256 via Node `crypto`; atomic write of both the file copy and the sibling `.toon` record; single retry on EIO/EACCES then `SNAPSHOT_WRITE_FAILED`) |
| test/protocol/checksums.test.ts | Modify | implementer-agent (extend existing suite to cover snapshot file + sibling .toon record checksum integrity, retry-on-EIO path, keep-all-forever retention assertion) <!-- Applied: I-19 — missing test deliverable row --> |

#### Acceptance Criteria
- [ ] `hooks/lib/iteration-snapshot.ts` exports `writeIterationSnapshot` with the documented signature
- [ ] Helper computes sha256 checksum of the snapshot file contents
- [ ] Helper writes atomically (`.tmp` then rename) per CLAUDE.md
- [ ] Helper retries once on transient write failure, then surfaces `SNAPSHOT_WRITE_FAILED`
- [ ] `tsc --noEmit` exits with code 0
- [ ] `bun test test/protocol/checksums.test.ts` exits with code 0 (extended to cover snapshot checksums)

#### Convergence Targets
- A fixture call to `writeIterationSnapshot('planning/PLAN.md', 2, 'planning/history/snapshots/')` produces both files with matching checksum
- A simulated EIO on the first write triggers exactly one retry

#### Scenarios

```toon
id: S-01
title: writeIterationSnapshot produces a file + sibling record with matching sha256
given[2]: A subject file planning/PLAN.md exists, snapshotDir planning/history/snapshots/ exists
when: writeIterationSnapshot is called with iteration=2
whenTriggerType: system-event
then[3]: planning/history/snapshots/PLAN-pass-2.md exists, planning/history/snapshots/PLAN-pass-2.toon exists, Both files reference the same sha256 checksum
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: writeIterationSnapshot retries once on transient write failure
given[2]: A subject file exists, The first atomic-rename attempt is mocked to throw EIO
when: writeIterationSnapshot is called
whenTriggerType: system-event
then[2]: Helper performs exactly one retry, On retry success the snapshot files exist
stateRef:
tags[2]: edge-case, error
testTier: unit
automatable: true
```

---

### Phase 12 — Wave 5: Wiring — Library + Reference + Wiki Conventions

**Agent:** wiring-agent
**Objective:** Update advertise-and-discover surfaces: `library.yaml`, `commands/loom-reference.md`, `commands/loom-plan.md`, and the convergence section of `agents/protocols/execution-conventions.md` to mention document mode + autoconverge. Single owner to keep these in sync.
**Dependencies:** Phase 5, Phase 7, Phase 9 (execution-conventions.md adds TS harness pattern), Phase 10 (advertised flags), Phase 11 (snapshot helper convention) <!-- Applied: W-26 — add Phase 9 dep -->
**File Ownership:** library.yaml (sole owner per PF-02 / CC-02), commands/loom-reference.md, commands/loom-plan.md, agents/protocols/execution-conventions.md (Convergence and Quality Infrastructure subsection only) <!-- Applied: PF-02 (B-09 / CC-02) — library.yaml owned solely here -->

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| library.yaml | Modify | wiring-agent (advertise `--autoconverge`, `--skip-critic`, `--max-iterations` on `/loom-plan create`; advertise `--mode document` on `/loom-converge`) |
| commands/loom-reference.md | Modify | wiring-agent (add `/loom-plan create --autoconverge` row; add `/loom-converge --mode document` row; document the new convergence mode in the modes table) |
| commands/loom-plan.md | Modify | wiring-agent (link out to the new flags from the subcommand index) |
| agents/protocols/execution-conventions.md | Modify | wiring-agent (Convergence and Quality Infrastructure subsection — add a brief paragraph naming document mode + linking to the schemas created in Phase 0) |

#### Acceptance Criteria
- [ ] `library.yaml` grep for `--autoconverge` returns ≥ 1 entry under `/loom-plan create`
- [ ] `library.yaml` grep for `mode: document` (or `--mode document`) returns ≥ 1 entry under `/loom-converge`
- [ ] `commands/loom-reference.md` grep for `--autoconverge` returns ≥ 1 row in the flags or commands table
- [ ] `agents/protocols/execution-conventions.md` Convergence subsection mentions the three modes (target, criteria, document) and links to `findings.schema.md` + `iteration-snapshot.schema.md`
- [ ] `bun test test/protocol/library-catalog.test.ts` exits with code 0

#### Convergence Targets
- Catalog tests pass with the new entries
- Reference docs stay aligned with command-file flag definitions

#### Scenarios

```toon
id: S-01
title: library.yaml advertises the new flags for /loom-plan create
given[1]: Phase 10 added --autoconverge, --skip-critic, --max-iterations to /loom-plan create
when: library-catalog.test.ts runs
whenTriggerType: system-event
then[2]: All three flags are present in library.yaml under /loom-plan create, Test exits with code 0
stateRef:
tags[2]: happy-path, regression
testTier: unit
automatable: true
```

---

### Phase 13 — Wave 5: M-01 Acceptance Fixture — Driver Document-Mode E2E

**Agent:** implementer-agent
**Objective:** Land the vitest e2e fixture that exercises the document-mode driver against a canned harness and a canned no-op integrator. Verifies F-01 acceptance: mode parity, resume, circuit-breaker parity, scope-expansion guard, auto-snapshot, uniform iter-{N}.toon shape.
**Dependencies:** Phase 5 (M-01 complete), Phase 11 (snapshot helper exists)
**File Ownership:** test/e2e/convergence/document-mode.test.ts, test/e2e/convergence/fixtures/document-mode/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/e2e/convergence/document-mode.test.ts | Create | implementer-agent (suite covering happy-path convergence, stall, regression, scope expansion, snapshot writes, resume from iter-1.toon) |
| test/e2e/convergence/fixtures/document-mode/converge.config | Create | implementer-agent (canned config with mode=document) |
| test/e2e/convergence/fixtures/document-mode/canned-harness.ts | Create | implementer-agent (fixture harness with scripted blockingCount sequences) |
| test/e2e/convergence/fixtures/document-mode/canned-integrator.md | Create | implementer-agent (no-op integrator agent file used purely to exercise dispatch) |
| test/e2e/convergence/fixtures/document-mode/subject.md | Create | implementer-agent (fixture subject file to be snapshotted) |

#### Acceptance Criteria
- [ ] `test/e2e/convergence/document-mode.test.ts` contains at least 6 vitest cases covering: happy-path convergence at iteration 1, stall after 2 flat iterations, regression on blockingCount increase, scope-expansion guard fires on top-level phase addition, snapshot file exists after iteration 2, resume from saved state.toon
- [ ] All cases pass: `bun test test/e2e/convergence/document-mode.test.ts` exits with code 0
- [ ] Fixture iter-{N}.toon files validate against the same `ConvergenceIterationSummary` schema used by target/criteria modes
- [ ] Fixture `converge.config` declares `integrator: canned-integrator` resolved through the same dispatch path as production integrators

#### Convergence Targets
- All 6 cases pass deterministically (no flakes across 10 consecutive runs)
- Snapshot fixtures match exact sha256 checksums

#### Scenarios

```toon
id: S-01
title: Document-mode driver converges happy-path on fixture
given[2]: Canned harness writes findings.toon with blockingCount=0 on first call, Canned integrator is a no-op
when: /loom-converge --mode document is invoked against the fixture config
whenTriggerType: system-event
then[3]: Loop exits at iteration 1 with status=converged, iter-1.toon is written with subject and snapshotRef populated, No integrator spawn occurs (loop exits at convergence check before integrator)
stateRef:
tags[2]: happy-path, regression
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Document-mode loop resumes from saved state.toon mid-run
given[2]: A pre-seeded convergence-state.toon shows iteration=2 completed in document mode, A pre-seeded iter-2.toon shows blockingCount=2
when: /loom-converge --resume is invoked
whenTriggerType: system-event
then[2]: Driver continues from iteration 3 (does NOT re-run iterations 1 or 2), Final report includes iterations 1-2 as part of the history table
stateRef:
tags[1]: regression
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Scope-expansion fixture halts the loop
given[2]: Canned integrator returns a subject with a new top-level phase added, Initial blockingCount > 0 so integrator runs
when: Driver completes integrator step and runs scope-expansion check
whenTriggerType: system-event
then[2]: Driver writes haltReason=SCOPE_EXPANSION to iter-2.toon, Snapshot for iteration 2 still exists (snapshot writes BEFORE integrator per Phase 5)
stateRef:
tags[2]: error, regression
testTier: e2e
automatable: true
```

---

### Phase 14 — Wave 5: M-02 Acceptance Fixture — `/loom-plan create --autoconverge`

**Agent:** implementer-agent
**Objective:** Land the vitest e2e fixture for the full plan creation + autoconverge flow against a roadmap fixture with known-flaggable issues. Verifies F-02 + F-03 acceptance: critic reduces first-pass blocking count, autoconverge reaches zero blocking within ≤ 2 iterations or hits a documented circuit breaker, `--autoconverge --auto` is non-interactive.
**Dependencies:** Phase 13 (driver fixture in place), Phase 10 (autoconverge wired), Phase 11 (snapshots ready), Phase 12 (catalog updated)
**File Ownership:** test/e2e/convergence/autoconverge.test.ts, test/e2e/convergence/fixtures/autoconverge/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/e2e/convergence/autoconverge.test.ts | Create | implementer-agent (suite covering: pre-critic baseline blocking count, post-critic pass-1 blocking count ≤ 50% baseline, autoconverge happy-path converges within 2 iterations, --auto compatibility, scope-expansion halts and leaves plan in last-good state, --skip-critic falls back to legacy behavior) |
| test/e2e/convergence/fixtures/autoconverge/ROADMAP.md | Create | implementer-agent (fixture roadmap with known reviewer-flaggable issues — modeled on the kit-native-skills pass-1 trajectory) |
| test/e2e/convergence/fixtures/autoconverge/canned-reviewers/ | Create | implementer-agent (canned reviewer outputs simulating the 6 review dimensions for deterministic fixture runs) |
| test/e2e/convergence/fixtures/autoconverge/baseline-critique.toon | Create | implementer-agent (golden PlanCritique output for shape validation) |

#### Acceptance Criteria
- [ ] `test/e2e/convergence/autoconverge.test.ts` contains at least 5 vitest cases: pre/post-critic blocking-count comparison, happy-path 2-iteration convergence, `--auto` non-interactivity, scope-expansion halts cleanly, `--skip-critic` fallback path
- [ ] All cases pass: `bun test test/e2e/convergence/autoconverge.test.ts` exits with code 0
- [ ] Post-critic pass-1 blocking-finding count is ≤ 50% of pre-critic baseline (success metric from F-02 Convergence Targets)
- [ ] Autoconverge fixture converges to `blockingCount=0` within 2 iterations OR halts with a named circuit breaker (no infinite loops, no timeouts)
- [ ] `--autoconverge --auto` flow records no interactive prompts in the fixture run log; a fixture simulating SCOPE_EXPANSION under `--auto` exits with code 1 and emits the C-08 machine-readable stderr line <!-- Applied: PF-04 (B-06) — C-08 fixture coverage -->
- [ ] `--skip-critic` fixture run produces a final PLAN.md that **passes a shape check** versus a legacy dual-track + manual review-integrate sequence: same total phase count, same milestone count, same blockingCount=0 — NOT byte-equal text comparison (which would not survive non-deterministic LLM output) <!-- Applied: PF-12 (W-08) — soften structural-equivalence assertion -->
- [ ] **Spawn-count ceiling assertion (replaces token-cost AC):** total Agent tool invocations across the autoconverge run ≤ **15** (== 1 critic [runs once per Q-02, initial-create only] + maxIterations × (6 reviewers + 1 integrator); fixture uses maxIterations=2, so ceiling = 1 + 2×7 = 15). Counted from fixture run logs by counting `Agent` tool call sites in the trace. General formula: `ceiling = 1 + maxIterations × 8`. <!-- Applied: PF-08 (B-03) — replace token-cost with verifiable spawn-count ceiling. B-NEW-01 (pass-2) — corrected arithmetic: critic runs once (not per iteration) per Q-02; 16 → 15. I-NEW-03 — formula parameterized on maxIterations. -->
- [ ] **Token-cost observability (non-blocking):** the fixture emits a `tokensUsed` total to `convergence-state.toon` and to the test log so cost can be tracked over time; no assertion threshold (cost-ceiling stays informational pending real-world calibration). <!-- Applied: PF-08 (B-03) — observability without unverifiable assertion -->
- [ ] Fixture covers `--autoconverge --review-integrate` combination per Q-02: autoconverge still loops, critic stays off, no errors <!-- Applied: I-04 -->
- [ ] Fixture asserts changelog has a multi-pass trajectory entry of the locked format `trajectory: pass-1 blocking=N, pass-2 blocking=N, ...` after a converged run <!-- Applied: W-14 — changelog format -->
- [ ] **Link-extraction readiness assertion (per C-11):** after the fixture run completes, the on-disk artifact set under `.plan-execution/` and `planning/` is shaped such that a fresh-context agent reading only those files (and the dispatch prompt) could derive a `link-result.toon` envelope per `agents/protocols/link-result.schema.md` and a `nextLink` decision. Specifically: `convergence-summary.toon` exists with all 11 fields populated, `status` ∈ {converged, halted-*} matches the actual outcome, `subject` points to a real file, and `iterationsRun` matches the count of `iter-{N}.toon` files. Test does NOT need to construct the envelope — only assert input completeness. <!-- Added: C-11 — link contract input completeness fixture -->

#### Convergence Targets
- Final PLAN.md from `--autoconverge` has zero blocking findings when re-run through the plan-review harness
- Changelog has a multi-pass trajectory entry after the run

#### Scenarios

```toon
id: S-01
title: --autoconverge converges to zero blocking findings on the fixture roadmap
given[2]: A fixture ROADMAP.md with reviewer-flaggable issues exists, /loom-plan create --autoconverge --auto is invoked
when: The full pipeline completes
whenTriggerType: actor-action
then[3]: Final PLAN.md re-run through plan-review-harness produces findings.toon with blockingCount=0, Run completes within 2 convergence iterations, planning/history/snapshots/ contains snapshots for each iteration
stateRef:
tags[2]: happy-path, regression
testTier: e2e
automatable: true
```

```toon
id: S-02
title: Critic reduces first-pass blocking finding count by at least 50%
given[2]: A pre-critic baseline run produced 8 blocking findings on the fixture, A post-critic run runs against the same fixture
when: Both first-pass review counts are compared
whenTriggerType: system-event
then[1]: Post-critic blocking count is at most 4 (50% of baseline)
stateRef:
tags[1]: regression
testTier: e2e
automatable: true
```

```toon
id: S-03
title: Scope-expansion halts --autoconverge cleanly
given[2]: A fixture configured so the integrator returns a plan with a new top-level phase, /loom-plan create --autoconverge is invoked
when: The loop reaches iteration 2 scope check
whenTriggerType: actor-action
then[3]: Loop halts with haltReason=SCOPE_EXPANSION, PLAN.md is left in its last-good (pre-integration) state via the snapshot, User-prompt message names next actions (approve or revert)
stateRef:
tags[2]: error, edge-case
testTier: e2e
automatable: true
```

```toon
id: S-04
title: --skip-critic --autoconverge falls back to legacy behavior plus convergence loop
given[2]: A fixture ROADMAP.md exists, /loom-plan create --skip-critic --autoconverge --auto is invoked
when: The full pipeline completes
whenTriggerType: actor-action
then[3]: No plan-critic agent is spawned, Step 1.7 is skipped, Autoconverge loop still runs after Step 4
stateRef:
tags[1]: edge-case
testTier: e2e
automatable: true
```

## Verification Commands

```bash
bun install
tsc --noEmit
bun run lint
bun test
bun test test/protocol/schema-validation.test.ts
bun test test/protocol/stage-context.test.ts
bun test test/protocol/pipeline-loop.test.ts
bun test test/protocol/library-catalog.test.ts
bun test test/protocol/checksums.test.ts
bun test test/protocol/plan-validation.test.ts
bun test test/e2e/convergence/document-mode.test.ts
bun test test/e2e/convergence/autoconverge.test.ts
```

## Milestones

<!-- Applied: PF-01 (CC-01) — Phase 11 added to M-01 since it now ships in W2 alongside Phase 5. PF-11 (W-22) — Phase 13 added to M-01 (it is the M-01 e2e fixture; deferred to W5 only because the fixture infrastructure needs Phase 12's catalog updates first for end-to-end determinism). Phase 11 removed from M-02. -->

### M-01: Driver Supports Document Mode
**Phases:** 0, 1, 2, 3, 4, 5, 11
**Verification fixture:** Phase 13 (Wave 5; closes after M-02 phases start — see Wave boundary)
**Depends on:** None
**Wave boundary:** Logical close at end of Wave 2 (Phases 5 + 11 land). Phase 13 is the M-01 *verification fixture* in Wave 5 — it depends on M-01 being complete, so it cannot be a member of M-01's Phases list (circular). M-02 phases (6-10, 12, 14) begin after the Wave 2 logical close; Phase 13 retroactively validates M-01 correctness end-to-end. <!-- Applied: B-NEW-02 (pass-2) — Phase 13 removed from Phases list to break circular ref. -->

**Acceptance:** `convergence-driver.md` reads `convergenceMode: document` configs, spawns the named integrator, reads uniform `findings.toon`, applies all 4 circuit breakers (STALL, REGRESSION, BUDGET_EXHAUSTED, MAX_ITERATIONS) plus the new SCOPE_EXPANSION halt (with C-08 `--auto` reconciliation), writes auto-snapshots per iteration via `hooks/lib/iteration-snapshot.ts`, and resumes from saved state — verified by Phase 13's e2e fixture (canned harness + canned integrator). Target/criteria mode behavior is unchanged (regression assertion in Phase 2 acceptance).

### M-02: Plan Creation Converges Automatically
**Phases:** 6, 7, 8, 9, 10, 12, 14
**Depends on:** M-01
**Wave boundary:** End of Wave 5 (Phase 14 completes)
**Acceptance:** `/loom-plan create --autoconverge` on the autoconverge fixture roadmap (modeled on kit-native-skills) converges to zero blocking findings within 2 iterations OR halts with a named circuit breaker. The critic reduces first-pass blocking-finding count by ≥ 50% versus a no-critic baseline. `--autoconverge --auto` produces no interactive prompts (SCOPE_EXPANSION halts emit machine-readable stderr + exit 1 per C-08). Scope-expansion + stall + max-iterations all halt the loop cleanly with snapshots preserved. Spawn-count ceiling per Phase 14 (≤ 15 spawns at maxIterations=2; general formula `1 + maxIterations × 8`) — token-cost tracking remains an observability metric, not an assertion.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Driver edits to `agents/convergence-driver.md` across Phases 1-5 collide on the same file | high | All five phases own the same file but disjoint sections (Phase 1 = Mode Detection + Preflight, Phase 2 = Loop Body + Output, Phase 3 = State Tracking, Phase 4 = Circuit Breakers, Phase 5 = Document Mode Safeguards). They run serially within Wave 1 (Phases 1-4) and Wave 2 (Phase 5). Phase 11 (Wave 2, after Phase 5) does NOT touch the driver file — it adds `hooks/lib/iteration-snapshot.ts`. The wiring-agent in Phase 12 does NOT touch the driver file either. |
| Phase 5 + Phase 11 coupling (M-01 gate testability) | high | Resolved by promoting Phase 11 to Wave 2 immediately after Phase 5. Phase 5 lands the driver-text contract; Phase 11 lands the helper that fulfills the contract. Both ship in W2 so M-01's snapshot-related ACs are testable when W2 closes. <!-- Applied: PF-01 (CC-01) --> |
| library.yaml double-write between Phase 10 and Phase 12 | medium | Resolved: Phase 10 no longer touches library.yaml; Phase 12 is sole owner of all advertise-and-discover updates. <!-- Applied: PF-02 (CC-02) --> |
| Phase 7 (W3b) and Phase 10 (W4) both modify create.md in disjoint sections — risk of Phase 10 agent receiving pre-Phase-7 input | medium | Pre-edit grep gate: Phase 10 starting-state assertion requires `grep -q "Step 1.7" commands/loom-plan/create.md` to pass; if it does not, the orchestrator halts before spawning Phase 10. Phase 7 ships in W3b which closes before W4 starts. <!-- Applied: PF-10 (CC-04 / W-23) --> |
| Critic agent prompt grows past haiku context budget when reading 6 reviewer files + plan | medium | Phase 6 includes a token-budget preflight check on the critic spawn before each invocation. If oversize, raise `CRITIQUE_TOO_LARGE` and run the critic with a truncated reviewer-instruction subset. Per C-04, checklist is capped at 30 items. |
| Plan-builder integrator mode confused with full-plan generation mode | medium | Phase 8 documents the input-shape disambiguation: full-plan mode needs `--roadmap`; integrator mode needs `--findings.toon` + current subject. `INTEGRATOR_MODE_AMBIGUOUS` raised on either-absent. |
| `--autoconverge` produces a plan the user dislikes and there is no rollback | low | C-07 auto-snapshots run per iteration to `planning/history/snapshots/` (kept forever per Q-03). User can `git checkout` or `cp` any snapshot back over the live plan. Auto-commit is disabled by default in document mode (only `--no-auto-commit` distinction is whether the SNAPSHOT writes — they always do — vs. the git-history writes). |
| Scope-expansion guard false-positives | medium | Phase 5 defines "structural expansion" precisely as adding a new `### Phase N`, `### F-NN`, or `### M-NN` heading. AC additions, deliverable additions, convergence-target additions, and re-orderings within existing phases do NOT trigger the guard. Test coverage in Phase 13 S-02 explicitly checks this. |
| Phase 13 + Phase 14 e2e tests are slow and flaky | medium | Both fixtures use canned harnesses and canned integrators — no live LLM spawns in the test path. Run determinism is bounded by sha256 checksums on snapshots and structural assertions on TOON outputs, not LLM-output text matching. |

## Acceptance Criteria (Final)

- [ ] All 15 phases' acceptance criteria pass (Phase 0 through Phase 14)
- [ ] `bun test` exits with code 0 across all suites
- [ ] `tsc --noEmit` exits with code 0
- [ ] `bun run lint` exits with code 0
- [ ] Grep verification: only `agents/convergence-driver.md` contains a `for iteration` / `while iteration` loop pattern across `agents/` and `scripts/` (DRY guard from C-01)
- [ ] M-01 acceptance fixture (Phase 13) passes 10 consecutive runs without flakes
- [ ] M-02 acceptance fixture (Phase 14) passes 10 consecutive runs without flakes
- [ ] All 7 locked decisions (C-01 through C-07) are honored as inspected in the relevant phase deliverables
- [ ] All 3 resolved open questions (Q-01 opt-in flag, Q-02 critic on create only, Q-03 snapshots forever) are honored as inspected in Phase 7 + Phase 10 + Phase 11

Plan returned. Key design choices the orchestrator should know:

- 15 phases (Phase 0 through Phase 14) across 5 waves. Wave 0 (Phase 0) is contracts. Wave 1 holds Phases 1-4 (driver mode detection, loop body, state, breakers — same file but disjoint sections, serial via dependencies). Wave 2 holds Phase 5 (safeguards, driver-doc layer) AND Phase 11 (snapshot helper implementation) — serial pair, Phase 11 depends on Phase 5; M-01 logical close. Wave 3 holds Phases 6-8 (critic + wiring + integrator mode): W3a runs Phases 6 + 8 in parallel; W3b runs Phase 7 after Phase 6. Wave 4 holds Phases 9 + 10 (harness then autoconverge — serial within W4 since 10 depends on 9). Wave 5 holds Phases 12-14 (wiring + two acceptance fixtures). M-01 verification closes at Phase 13; M-02 closes after Phase 14. <!-- Applied: PF-01 (CC-01) — Phase 11 promoted to W2. CC-05 (I-13) — W3 sub-ordering documented. W-24 — Phase 9+10 serial within W4. -->
- M-01 → M-02 wave dependency satisfied: Phases 6, 8 list M-01 (Phases 1-5 + Phase 11 complete) as a dependency, so the F-02/F-03 phases cannot start until F-01 lands.
- File ownership is non-overlapping within a wave. `agents/convergence-driver.md` is touched by Phases 1-5 sequentially (each depends on the prior), never in parallel. `commands/loom-plan/create.md` is touched by Phases 7 and 10 in different waves (Wave 3 vs Wave 4) — disjoint sections, gated by Phase 10's pre-edit grep check on `Step 1.7`. `library.yaml` is touched only by Phase 12 (PF-02 resolution).
- Schema/Type Definitions section defines 6 new/extended TOON entities with validation rules, indexing relationships, and cascade behavior — no SQL.
- Error Handling defines 6 new error codes (SCOPE_EXPANSION, INTEGRATOR_NOT_FOUND, HARNESS_MISSING, FINDINGS_SCHEMA_INVALID, SNAPSHOT_WRITE_FAILED, INTEGRATOR_MODE_AMBIGUOUS, CRITIQUE_TOO_LARGE) anchored to specific phases.
- A `ConvergeRun (mode=document)` state machine is defined per the optional state-machine instruction (real lifecycle).
- Every phase has a `#### Scenarios` block with locked-enum tags, honest `whenTriggerType`, and `testTier` aligned to vitest unit/integration/e2e.
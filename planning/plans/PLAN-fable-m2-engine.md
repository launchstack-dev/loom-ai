# M-2 Design — Engine Port to Workflow + Track A Guarantees

Status: in-progress · Roadmap: `planning/ROADMAP-fable-readiness.md` (C-04, C-07, C-08) · Created: 2026-07-09

Design decisions for the M-2 port, recorded before implementation. Chunks land as
separate commits, each with tests. Exit criteria = the six M-2 metrics in the roadmap.

## Ground truth (from the design pass)

1. **Today's orchestration is a relay.** Harness scripts (`plan-review-harness.ts` etc.)
   write `spawn-request.toon` and exit; the markdown driver agent
   (`agents/convergence-driver.md`, ~1000 lines) makes the Agent calls, writes envelopes,
   re-invokes the harness in aggregate mode. Loop logic is prompt-following.
2. **The loop is already specified DRY.** One state machine across target/criteria/document
   modes; locked haltReason enums (`STALL`, `REGRESSION`, `BUDGET_EXHAUSTED`,
   `MAX_ITERATIONS`, `SCOPE_EXPANSION`, plus preflight reasons); uniform `iter-{N}.toon`;
   locked stdout lines (`[autoconverge] …`). The port must preserve these exactly
   (metric: circuit-breaker parity).
3. **Workflow scripts are sandboxed** — no fs/Node access. Loop mechanics, breakers, and
   budget accounting can live in the script; every file write (state, findings, snapshots,
   summaries) must go through spawned agents or the existing TS harnesses they run.
4. **Wave execution's hardest machinery is compensation.** 15s heartbeat polling,
   stale-agent detection, run_in_background choreography exist because a markdown
   orchestrator cannot await agents. Workflow `parallel()`/`pipeline()` replace them.
5. **Fan-out literals found (C-07 violations to fix):** the 6 locked plan-review reviewers
   (`plan-review-harness.ts:107-132`) and the findings-schema `reviewerAgent` enum bound
   to those 6 names.

## Decisions

### D-M2-01: The Workflow script is the driver
`workflows/loom-converge.mjs` and `workflows/loom-execute.mjs` (installed to
`.claude/workflows/`) own: iteration loop, all five circuit breakers, agent budget,
concurrency, resume (Workflow journal + `resumeFromRunId`), and the locked stdout
progress lines (via `log()`). They spawn: harness runs (agent executes the existing TS
harness via Bash and returns the findings as schema-validated structured output),
integrators/fixers/reviewers (direct `agent()` calls with `model:` resolved per the
mandatory chain), and a state-writer step (the terminal agent persists
`convergence-state.toon` / `iter-{N}.toon` / `convergence-summary.toon` via the existing
atomic-write conventions). Harness scripts and `aggregate-findings.ts` are unchanged.

### D-M2-02: Driver selection keys off the discipline profile (single seam intact)
`/loom-converge` and `/loom-plan execute` resolve the profile via
`loom-doctor --only discipline-profile --json`. `standard`/`minimal` → launch the
Workflow driver. `strict` → the markdown fallback driver (frozen). No other conditional
surface is added; command docs contain the dispatch rule, not resolution logic.

### D-M2-03: Parameterized shape (C-07 enforcement)
Workflow drivers take `args = { mode, subject, harness, integrator, reviewers[],
maxIterations, agentBudget, … }` hydrated from `converge.config` + orchestration.toml.
Reviewer panels come from config/registration ([[review.agents]] + criteria-plan
`reviewers[]`), with today's 6 plan-review reviewers as the *default panel*, not a
literal in the engine. Scripts enforce only caps (`agentBudget`, `maxIterations`,
per-dimension finding caps); requested shape exceeding a cap is clamped and logged.
`findings.schema.md`'s `reviewerAgent` enum loosens to "a registered reviewer id".
Metric check: grep engine scripts for fixed fan-out literals → none.

### D-M2-04: Re-validation gate is additive evolution of quality-gate (C-08, C-11)
`hooks/quality-gate.ts` keeps its mid-stage stop-block (unchanged strict behavior) and
gains completion re-validation: when execution/pipeline state claims a terminal stage,
the hook independently re-runs acceptance checks — `[domain].verificationPipeline`
commands (bounded timeout) and blocking `criteria-plan.toon` rows — and blocks the stop
if any fail or were skipped, naming the failing criterion. Core layer, all profiles.
Fail-open only on missing state (no Loom run), never on failing checks.

### D-M2-05: Map-freshness gate ships dormant-until-maps-exist
New PreToolUse gate (core) on `/loom-plan create` + `/loom-converge`: if
`.loom/wiki/maps/*.toon` exist, compare each map's `lastMappedCommit` against
`git rev-parse HEAD`; stale past `mapFreshnessThreshold` touched files → fail closed
with remedy text. When no maps exist the gate passes (absence ≠ stale) — Track B1/B2
(`/loom-map`, map serialization) are explicitly out of M-2 scope per the handoff, so the
gate is built and tested against fixture maps and activates the day maps land.

### D-M2-06: Adversary + coverage matrix + goal-backward land in engine defaults
- `agents/adversary-agent.md` (refute-the-work role; blocking/warning findings only),
  registered via `[[review.agents]]` per CONTEXT.md D-01, included in default convergence
  panels.
- `protocols/coverage-matrix.schema.md` + emission in criteria mode; the Workflow driver
  spawns **one bounded fixer per uncovered row** (never a loop per gap), budget-capped.
- Goal-backward: `phase-promise.toon` captured at plan approval (deliverables +
  acceptance refs); criteria mode auto-generates blocking criteria with
  `source: phase-promise`; fixture `completed-tasks-with-missing-wiring` must fail
  convergence.

### D-M2-07: Freeze = label + pointer, not rewrite
`agents/convergence-driver.md`, `commands/loom-plan/execute.md` § orchestration loop, and
the monitoring choreography protocols get a `> **FALLBACK (frozen)**` banner naming the
Workflow driver as authoritative and scoping edits to bugfixes. Corpus-reduction metric
counts these files as retired-from-authoritative.

## Chunks (commit sequence)

1. **Engine lib:** `scripts/lib/engine/` — breaker evaluation (pure, locked haltReasons),
   config hydration (converge.config → workflow args), model resolution helper
   (orchestration.toml tier → frontmatter → inherit), findings validation. Unit tests
   against the locked enums. (The pure core both drivers share.)
2. **Convergence Workflow driver** (`workflows/loom-converge.mjs`) + command dispatch in
   `loom-converge.md` + breaker-parity fixtures (each haltReason reproduced).
3. **Wave-execution Workflow driver** (`workflows/loom-execute.mjs`) + dispatch in
   `loom-plan/execute.md`.
4. **Track A:** re-validation gate (quality-gate evolution) + map-freshness gate +
   adversary agent + coverage matrix + phase-promise/goal-backward, each with fixtures.
5. **Freeze + metrics:** fallback banners, corpus-line count, full metric verification,
   milestone summary.

## Out of scope (M-2)
`/loom-map` and map serialization (Track B); learnings.toon (CT6 note, separate);
docs/hooks.md (nice-to-have, only if time permits); TOON freeze (M-3); deleting any
markdown driver.

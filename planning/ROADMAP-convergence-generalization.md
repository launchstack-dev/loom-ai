---
roadmapVersion: 1
name: "Convergence Generalization — Document Mode + Plan Critic"
status: approved
created: 2026-06-12
lastReviewed: 2026-06-12
targetDate: null
totalFeatures: 3
totalMilestones: 2
---

# Roadmap: Convergence Generalization — Document Mode + Plan Critic

## Vision

Loom already has a generalized iteration engine: `convergence-driver` runs the loop (harness → analyze → fix → re-harness) with stall, regression, and budget circuit breakers, and ships with two modes — `target` (golden-diff) and `criteria` (tests + reviewers on code). What's missing is a third mode for **document review convergence**: iterating a markdown/TOON artifact against a panel of reviewer agents until blocking findings reach zero. Plan creation today requires 3 manual `--review-integrate` passes (8 → 5 → 0 blocking findings on the kit-native-skills plan) because (a) plan-builder writes a first draft blind to what the 6 reviewers care about, and (b) no orchestrator loops review-integrate automatically with safeguards. This roadmap fixes both: generalize the driver to support a `document` convergence mode so plan-review, criteria-review, and (later) PR-review all reuse the same loop; add a fast `plan-critic-agent` that preempts the most common reviewer findings before the first formal review; and expose `--autoconverge` on `/loom-plan create` as a thin wrapper that drives the loop with scope-expansion + stall guards.

### Positioning

This is a Loom-internal workflow improvement, not a user-facing feature. The strategic value is **DRY across convergence use cases**: once document mode lands, future "review-and-iterate" surfaces (PR comments + Gemini bot, criteria-plan review, wiki page review) plug into the same loop with only a new harness + integrator pair — no new iteration logic.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Plan convergence iterations | ≤ 2 review/integrate passes from first draft to zero blocking findings | Run `/loom-plan create --autoconverge` on a fixture roadmap; count iterations in `.plan-execution/convergence/iterations/` |
| First-draft blocker reduction | First-pass review surfaces ≤ 3 blocking findings (down from ~8 today) | Compare pass-1 review counts pre-critic vs post-critic on the same fixture roadmap |
| Driver DRY | Zero loop logic duplicated outside `convergence-driver.md` | Grep for `for iteration` / `while iteration` patterns; only `convergence-driver` matches |
| Mode parity | All three modes (`target`, `criteria`, `document`) share circuit breakers, state files, and resume semantics | Inspection: same `iter-{N}.toon` shape, same `convergence-state.toon` shape, `--resume` works for all three |
| Scope guard | Loop halts when integration adds phases/features instead of silently growing the plan | Fixture test: feed the integrator a review with a scope-add finding; loop exits with `SCOPE_EXPANSION` reason |
| Cost ceiling | `--autoconverge` total agent spawns per run ≤ `1 + maxIterations × 8` (default maxIterations=2 → ≤ 15 spawns) | Spawn-count accounting: count `Agent` tool invocations in fixture trace logs. `tokensUsed` is tracked as a non-blocking observability metric on `convergence-state.toon` but NOT asserted (mixed-tier costs make token-cost comparisons unreliable). <!-- Updated 2026-06-12 pass-2 per B-NEW-01 + W-NEW-04: token-cost AC was unverifiable; replaced with automatable spawn-count ceiling. --> |

## Constraints & Decisions

### C-01: Reuse `convergence-driver` — no parallel loop engine
**Decision:** Document-mode convergence runs through the existing `convergence-driver.md` loop. Add a third value to `convergenceMode` (`document`), but do not fork the driver or create a parallel orchestrator.
**Rationale:** The driver already implements stall detection, regression detection, budget exhaustion, max-iterations, resume, auto-commit, and `iter-{N}.toon` state writes. Forking would create two loops to maintain and diverge over time. The driver loop is mode-agnostic — only harness + scoring differ.
**Alternatives considered:** Build a new `document-converge-driver.md` (rejected — duplicates 200+ lines of circuit-breaker logic). Special-case document mode in `/loom-plan create` outside the driver (rejected — `--autoconverge` would not get resume, auto-commit, or stall detection for free).
**Impact:** high

### C-02: Harness contract = subject + findings.toon
**Decision:** Every convergence harness conforms to a uniform contract: input is a `subject` path (file or directory) + harness-specific config; output is a `findings.toon` written to a known location. The driver reads findings.toon to decide convergence, regardless of mode.
**Rationale:** Today the driver consumes a Delta Report (target mode) or test+review aggregate (criteria mode) — same loop, different parsers. Formalizing one findings shape lets any new harness (plan-review, PR-review, wiki-review) drop into the loop without driver changes.
**Alternatives considered:** Keep per-mode result shapes and translate inside the driver (rejected — pushes mode-awareness into the driver, defeats the DRY goal).
**Impact:** high

### C-03: Integrator dispatch is config-driven
**Decision:** `convergence-driver` currently hardcodes `fixer-agent` as the modifier. Make the integrator agent name a field on `converge.config` (`integrator: plan-builder-agent` or `integrator: fixer-agent` etc.). Driver spawns whatever the config names.
**Rationale:** Code fixes use `fixer-agent`; plan edits use `plan-builder-agent` with `--review-integrate` semantics; criteria edits use `criteria-planner-agent`. Different subject types need different integrators. The driver should not know about integrator specifics.
**Alternatives considered:** Hardcode a switch on `convergenceMode` inside the driver (rejected — couples driver to every future integrator; brittle when adding PR-review).
**Impact:** medium

### C-04: Critic agent is haiku-tier, advisory-only
**Decision:** `plan-critic-agent` runs as a third leg of the dual-track step (becomes triple-track) on haiku tier. Its output feeds back to `plan-builder-agent` for a revise pass before the first formal review. It is advisory: it does not block, gate, or produce schema artifacts.
**Rationale:** The critic's job is to preempt the cheap, high-volume findings (wave-gate ACs missing, ownership boundary fuzz, AC scenarios not enumerated) that the 6 review agents flag mechanically. A haiku agent reading the 6 reviewer instructions and skimming the draft plan can catch ~60% of these at <5% of the cost of a full review pass. Making it advisory keeps it out of the protocol — it's a quality lever, not a gate.
**Alternatives considered:** Run all 6 reviewers as the critic (rejected — equivalent to running a full review twice). Make the critic blocking (rejected — adds a new gate to a flow that already has interpretation-reviewer as a blocker; protocol gets harder to reason about).
**Impact:** medium

### C-05: `--autoconverge` has a hard max-iterations cap
**Decision:** `/loom-plan create --autoconverge` defaults to `max-iterations: 3` (configurable via `--max-iterations N`). Hard cap on iterations regardless of convergence rate.
**Rationale:** Matches the empirical convergence trajectory (kit-native-skills converged in exactly 3 passes). Higher caps invite runaway token cost when stall detection misfires. Lower caps fail too eagerly on legitimately complex plans.
**Alternatives considered:** Match `loom-converge --max-iterations 5` default (rejected — too generous for document mode; review cost is high). No cap, rely on stall detector (rejected — single failure mode could spend 20× budget).
**Impact:** medium

### C-06: Scope expansion during integration halts the loop
**Decision:** If `plan-builder --review-integrate` adds new phases, features, or milestones to the plan during an integration pass, the driver writes `haltReason: SCOPE_EXPANSION` and exits the loop. The plan is saved, the user is prompted to either approve the scope addition (re-running the loop manually) or revert.
**Rationale:** Pass-2 of kit-native-skills added 5 phases (F-05 authoring scaffolding) during integration, which triggered a fresh wave of findings in pass-3. Scope expansion is a roadmap-level decision, not a review-finding-driven decision. Treating it as a loop-halt signal forces explicit human consent and prevents the loop from spinning on its own additions.
**Alternatives considered:** Allow unbounded scope expansion (rejected — observed failure mode). Detect scope expansion as a stall signal (rejected — semantically wrong; stall means "no progress," scope expansion means "new work introduced").
**Impact:** high

### C-07: Auto-snapshot before every integration pass
**Decision:** Before each integration iteration, the driver writes a snapshot of the current subject (e.g., `planning/history/snapshots/{plan-slug}-pass-{N}.md`). Snapshots are timestamped and slug-prefixed for retrieval.
**Rationale:** Lesson learned from kit-native-skills pass-1: the plan-builder overwrote in-place with no git commit, leaving no rollback path. Auto-snapshots make every iteration recoverable without requiring auto-commit (which may not be desired in document mode).
**Alternatives considered:** Rely on auto-commit per iteration (rejected — adds noise to git history for document-only changes; user may not want a commit per pass). No snapshots, trust git working tree (rejected — directly caused the kit-native-skills pass-1 incident).
**Impact:** low

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Orchestration | `convergence-driver.md` | existing | Generalized loop engine (extended, not replaced) |
| Config format | TOON | 1 | `converge.config`, `findings.toon`, `iter-{N}.toon` |
| Critic agent | Markdown agent + haiku model | — | Fast preempt of common reviewer findings |
| Integrator dispatch | Markdown agent (config-driven) | — | `plan-builder-agent` for plans, `fixer-agent` for code |
| Plan harness | TypeScript wrapper | — | Spawns 6 review agents, aggregates to `findings.toon` |
| State | TOON | 1 | `convergence-state.toon`, per-iteration summaries |

## Features

### F-01: Convergence Driver Document Mode

**Priority:** P0
**Milestone:** M-01
**Description:** Extend `convergence-driver.md` to support a third `convergenceMode: document`. Add a `subject` field to `converge.config` pointing at the file under iteration, and an `integrator` field naming the agent that applies findings. Generalize the harness invocation contract so any harness producing a `findings.toon` (subject, findings[], blockingCount, advisoryCount) is a valid driver input. Convergence is reached when `blockingCount == 0` or a circuit breaker fires.

**Entities involved:** ConvergeConfig, ConvergenceHarness, ConvergenceFindings, ConvergenceIntegrator

**Key behaviors:**
- `convergenceMode: document` is accepted by the driver alongside `target` and `criteria`
- `converge.config` accepts `subject: <path>` and `integrator: <agent-name>` fields
- Driver reads `findings.toon` after each harness invocation and computes convergence from `blockingCount`
- Driver spawns the agent named in `integrator` (not hardcoded `fixer-agent`) with the prior findings + subject as input
- Circuit breakers (stall, regression, budget, max-iterations) work identically across all three modes
- `--resume` restores document-mode loops from `convergence-state.toon` like the other modes
- Scope-expansion guard: if the integrator's modification adds top-level structural sections to the subject, write `haltReason: SCOPE_EXPANSION` and exit (see C-06)
- Auto-snapshot per iteration writes to `planning/history/snapshots/{slug}-pass-{N}.{ext}` before integrator runs (see C-07)

**Convergence targets:**
- `convergence-state.toon` for a document-mode run contains `convergenceMode: document` and `subject: <path>`
- `iter-{N}.toon` shape is identical across all three modes (verified by schema test)
- A document-mode loop with no fixture findings exits at iteration 1 with `status: converged`

### F-02: Plan Critic Agent

**Priority:** P0
**Milestone:** M-02
**Description:** New `plan-critic-agent` (haiku tier) runs as a third leg of the existing dual-track plan creation step. It reads the draft plan + criteria + the 6 reviewer agent instruction files, then produces a `critique.toon` enumerating the most likely findings the reviewers will surface. The orchestrator passes this critique back to `plan-builder-agent` for a revise pass before writing the plan to disk. Goal: cut first-formal-review blocking-finding count from ~8 to ≤3.

**Entities involved:** PlanCritique, PlanDraft, CriteriaDraft

**Key behaviors:**
- `plan-critic-agent.md` exists with a concerns checklist distilled from feature-coverage, strategy, ux, phasing, parallelization, and agentic-workflow agents (~30 items total)
- Critic runs in parallel with `plan-builder` and `criteria-planner` in `/loom-plan create` Step 1 (becomes triple-track)
- Critic output `critique.toon` lists predicted findings with `predictedSeverity` (blocking/warning/info) and `dimension` (which reviewer is likely to flag it)
- New Step 1.7 in `create.md` re-spawns `plan-builder` with the critique as additional context; builder revises before validation
- Critic is advisory: zero predicted-blocking findings does not skip the formal review; the formal review remains the source of truth
- Critic runs on haiku tier per orchestration.toml profile (see C-04)
- `--skip-critic` flag bypasses the critic for fast iteration during development

**Convergence targets:**
- On a fixture roadmap with known reviewer-flaggable issues, post-critic pass-1 review surfaces ≤ 50% of the pre-critic baseline finding count
- `critique.toon` is written to `.plan-execution/critique.toon` and conforms to a schema

### F-03: Plan-Review Convergence Loop

**Priority:** P0
**Milestone:** M-02
**Description:** Wrap the existing `/loom-plan review` 6-agent flow as a plan-review harness (subject = PLAN.md, output = findings.toon). Wrap `plan-builder-agent --review-integrate` semantics as the document-mode integrator for plan subjects. Add `--autoconverge` to `/loom-plan create` that, after the initial dual-track + critic generation, writes a `converge.config` with `mode=document`, `subject=<plan-path>`, `harness=plan-review`, `integrator=plan-builder-agent`, then invokes the convergence-driver to loop until clean or circuit-broken.

**Entities involved:** PlanReviewHarness, ConvergeConfig, ConvergenceFindings, PlanIntegrationResult

**Key behaviors:**
- Plan-review harness script invokes the 6 reviewer agents in parallel, aggregates their AgentResults, and writes `findings.toon` (subject, findings[], blockingCount, advisoryCount)
- Plan-builder-agent gains an "integrator mode" entry point that consumes `findings.toon` + current subject and produces the next subject draft
- `/loom-plan create --autoconverge` is recognized; after Step 4 (initial write), the orchestrator writes a generated `converge.config` and invokes the driver
- `--max-iterations N` overrides the default of 3 (see C-05)
- Scope-expansion guard (C-06) and auto-snapshot (C-07) trigger per pass
- On convergence, the changelog is appended with a multi-pass summary (`trajectory: pass-1 blocking=N, pass-2 blocking=N, ...`) similar to existing manual-trajectory entries
- On circuit breaker fire (stall/regression/budget/max-iterations/scope-expansion), the loop exits cleanly, the plan is left in its last-good state, and the user is prompted with next actions
- `--autoconverge` is compatible with `--auto` (non-interactive end-to-end)

**Convergence targets:**
- `/loom-plan create --autoconverge --auto` on a fixture roadmap completes without prompting and produces a plan with zero blocking findings
- The same fixture run via `--autoconverge` and via three manual `--review-integrate` passes produce structurally equivalent final plans (within whitespace)

## Data Model (Conceptual)

### Entities

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| ConvergeConfig | convergenceMode, subject, integrator, harness, maxIterations, agentBudget | Existing TOON config, gains `subject` + `integrator` + harness path for document mode |
| ConvergenceHarness | name, subject, configPath, outputPath | Generalized harness contract; instances include plan-review, criteria-review (future), pr-review (future) |
| ConvergenceFindings | subject, findings[], blockingCount, advisoryCount, harnessName, iteration | Uniform output shape; drives driver convergence check |
| ConvergenceIntegrator | agentName, modeHint, subjectPath | Driver looks up integrator by agentName in config; spawns with subject + prior findings |
| PlanCritique | dimensions[], predictedFindings[], criticConfidence | Output of plan-critic-agent; predicted-finding shape mirrors review findings for builder consumption |
| IterationSnapshot | sourcePath, snapshotPath, iteration, timestamp | Pre-integration snapshot record; one per pass under `planning/history/snapshots/` |

### Relationships

| From | To | Type | Description |
|------|-----|------|-------------|
| ConvergeConfig | ConvergenceHarness | 1:1 | A config names exactly one harness |
| ConvergeConfig | ConvergenceIntegrator | 1:1 | A config names exactly one integrator |
| ConvergenceHarness | ConvergenceFindings | 1:N | One harness writes one findings.toon per iteration |
| ConvergenceFindings | ConvergenceIntegrator | 1:1 | Driver passes the latest findings to the integrator per iteration |
| PlanCritique | PlanDraft | 1:1 | One critique advises one plan-builder revise pass |
| IterationSnapshot | ConvergeConfig | N:1 | Many snapshots accrue under one converge run |

## Milestones

### M-01: Driver Supports Document Mode

**Features:** F-01
**Depends on:** None
**Acceptance:** `convergence-driver.md` reads `convergenceMode: document` configs, spawns the named integrator, reads uniform `findings.toon`, applies all circuit breakers, and resumes from saved state — verified by a fixture harness producing canned findings and a fixture integrator that no-ops.
**Effort:** S

### M-02: Plan Creation Converges Automatically

**Features:** F-02, F-03
**Depends on:** M-01
**Acceptance:** `/loom-plan create --autoconverge` on the kit-native-skills roadmap (or a smaller fixture) converges to zero blocking findings within 2 iterations, scope-expansion + stall guards are exercised by separate fixture tests, and `--autoconverge --auto` is end-to-end non-interactive.
**Effort:** M

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Driver refactor breaks `loom-converge` (target + criteria modes) | high | Land F-01 behind a `convergenceMode: document` switch; existing modes keep current code paths until F-01 is verified. Run the existing convergence test suite as part of F-01 acceptance. |
| Critic agent becomes a 7th reviewer (scope creep) | medium | Cap concerns checklist at 30 items in C-04. Reject additions during F-02 review if the critic prompt grows past a token threshold. Critic stays haiku-tier. |
| Plan-builder integrator mode confuses with full-plan generation mode | medium | Integrator mode reads from `findings.toon` + current plan; full-plan mode reads from ROADMAP.md. Different input contracts make the entry points unambiguous. Document both in plan-builder-agent.md. |
| `--autoconverge` produces a plan the user dislikes with no rollback | low | Auto-snapshot per pass (C-07) + final state saved before any commit. User can `git checkout` any snapshot. No auto-commit in document mode by default. |
| Scope-expansion guard false-positives on legitimate review-driven additions (e.g., a new AC) | medium | Guard fires only on top-level structural additions (phases, features, milestones), not on AC additions within existing phases. Define "structural" precisely in F-01 acceptance criteria. |

## Out of Scope

- PR-review convergence (Gemini bot + inline comments + CI status feeding a loop). Becomes a small additional feature in a follow-on roadmap once F-01 lands and the harness/integrator pattern is proven.
- Code-review convergence loop (looping `/loom-code review` + `/loom-code fix` until clean). Mostly already works via criteria mode; needs a thin wrapper, not a driver change.
- Criteria-plan review convergence (looping reviewers on `criteria-plan.toon`). Same pattern as plan-review; defer until F-03 ships and the abstraction is validated.
- Wiki-page review convergence. Same.
- Multi-subject convergence (one config, many subjects iterated together). Not needed for plan review; revisit if a use case emerges.

## Open Questions

*(All resolved at approval time 2026-06-12. Recorded here for traceability; treat as locked decisions on par with the C-NN section.)*

- **Q-01 (resolved):** `--autoconverge` is **opt-in** for first ship — explicit flag required, default plan-creation flow unchanged. Revisit after empirical data on convergence rate and token cost. Avoids surprise token spend; preserves the simple `/loom-plan create` mental model.
- **Q-02 (resolved):** Critic runs during **initial create only**, not during `--review-integrate` passes. Rationale: integration passes already operate against concrete reviewer findings (no need to predict). Adding critic cost per pass doubles cycle cost for marginal gain. Revisit if pass-2+ iterations still surface high blocking counts after F-02 ships.
- **Q-03 (resolved):** Auto-snapshot retention is **keep all forever**. Snapshots are small markdown files; pruning policy is premature optimization. Add a `/loom-plan snapshots prune` command later if disk usage becomes a concern.

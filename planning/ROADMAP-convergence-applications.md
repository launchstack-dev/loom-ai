---
schemaVersion: 1
title: Convergence Applications — wire 4 more harness+integrator pairs to the document-mode driver
roadmapId: convergence-applications
created: 2026-06-14
dependsOn: convergence-generalization (PR #18 — merged)
status: approved
---

# Roadmap: Convergence Applications

## Vision

The `convergence-generalization` plan (PR #18, merged) generalized the convergence-driver into a substrate that any iterative loop can attach to. In `--mode document`, the driver knows nothing about its application — it consumes `subject + harness + integrator + (config)` and runs the loop with circuit breakers, snapshots, stall/regression detection, scope-expansion guards, `--auto` non-interactivity, and C-11 link-extraction readiness.

That substrate currently has **one application wired** (plan creation via `/loom-plan create --autoconverge`). This roadmap wires **four more**, each independent, each reusing the engine verbatim. The unit of work per application is small: one harness script + one integrator wiring + one wrapper command/flag. The engine is free.

### Positioning

We dogfooded the unbuilt PR-review application by hand on PR #19 (5 rounds: trigger Gemini → fetch findings → apply fixes → push → repeat, with the same `4 → 4 → 2 → 3 → 2` trajectory a real `findings.toon` series would have produced). Manual execution proved the pattern fits; automation removes the labor.

## Success Metrics

- All 4 applications converge their respective fixture inputs end-to-end via `/loom-converge --mode document` against the existing driver, **without any new driver code**.
- Each application ships a wrapper that auto-detects sensible defaults (subject, harness path, integrator agent) — users don't hand-author `converge.config` for the common case.
- Spawn-count ceilings hold per application (formula `1 + maxIterations × spawnsPerIter`, where `spawnsPerIter` differs by harness).
- The five total applications (plan-creation + 4 new) share the same circuit-breaker enum and convergence-summary.toon shape — verified by re-reading the contract-page-extensions schema across all five wiring fixtures.

## Constraints & Decisions

### CA-01: Engine is frozen; this roadmap adds wirings only

No changes to `agents/convergence-driver.md`, `hooks/lib/iteration-snapshot.ts`, `agents/protocols/findings.schema.md`, `convergence-summary.schema.md`, or `iteration-snapshot.schema.md`. If a wiring needs a feature the engine doesn't provide, the wiring is wrong — escalate to a follow-up "convergence-engine v2" roadmap rather than fork the engine.

### CA-02: Each application is independent and parallelizable

Features F-01 through F-04 share no files. Phase-level dependencies are explicit and acyclic. A team could execute all four in parallel waves.

### CA-03: Reuse `fixer-agent` as the default integrator

`fixer-agent` already applies code-review-style findings; extend it with an Integrator Mode (input contract: `findingsPath + subjectPath`) mirroring the Phase 8 extension to `plan-builder-agent`. F-01, F-02, F-04 all default to `fixer-agent`; F-03 (debug) needs a different integrator (see CA-04).

### CA-04: Debug application's termination is custom, not `blockingCount`

For F-03 (debug), the harness emits findings about probable causes, but the loop terminates when the **symptom no longer reproduces** (custom criterion: re-run the failing test/repro/log-line and check for resolution). Driver supports custom termination via the existing `converge.config.terminationCriterion` extensibility point if it exists; if not, F-03 implementation may extend convergence-summary.toon with an optional `customTermination` field — flagged for design review.

### CA-05: External-bot adapters (F-04) are per-bot

The PR-review harness is not a single script — it's a registry. Gemini, CodeRabbit, GitHub Copilot Reviews each need their own adapter that translates the bot's inline-comment format into ConvergenceFindings TOON. Adapter contract: read PR identifier → return findings.toon (synchronous from harness's POV; internally polls + transforms). Gemini-consumer-version sunsets July 17, 2026 — Gemini adapter is the highest-priority first build; CodeRabbit second.

### CA-06: `--autoconverge` is the locked flag name

Every wrapper command exposes `--autoconverge` (matching `/loom-plan create --autoconverge`). Don't invent per-application synonyms; users learn one flag and it works across plan creation, code review, test runs, debug, and PR review.

## Tech Stack

- All harness scripts: TypeScript, executed via bun (matches `scripts/plan-review-harness.ts` precedent from Phase 9)
- Shared findings-aggregator helper: `scripts/lib/aggregate-findings.ts` (already exists; reused verbatim by F-01 and F-02; F-03 and F-04 may need lightweight extensions for non-blocking-count termination)
- Snapshots via `hooks/lib/iteration-snapshot.ts` (already exists; reused verbatim across all applications)
- Per-bot PR adapters: `scripts/lib/pr-review-adapters/{gemini,coderabbit,copilot}.ts` (F-04)

## Features

### F-01: Code-Review Convergence Loop

**Description:** Wire `/loom-code review` into the convergence-driver as a harness, with `fixer-agent` as the integrator. The loop iterates a file set (or working-tree diff) until reviewers report zero blocking findings.

**Acceptance:**
- New `scripts/code-review-harness.ts` runs the same 9+ reviewers `/loom-code review` already spawns and emits findings.toon in the canonical shape (severityToConvergenceSeverity mapping applied verbatim; reviewerAgent attribution preserved per W-03).
- `fixer-agent` gains an Integrator Mode (input contract: `findings.toon + subjectPath` → revised file(s); output is atomic write). Mirrors Phase 8's extension to plan-builder-agent.
- New `/loom-code review --autoconverge` wrapper generates a document-mode `converge.config` (harness=code-review-harness, integrator=fixer-agent, maxIterations=3 per C-05) and invokes `/loom-converge --config <path>`.
- `--auto` pass-through honors C-08 SCOPE_EXPANSION (a code change that touches files outside the original subject set halts).

### F-02: Test-Run Convergence Loop

**Description:** Wire a test runner (bun test / pytest / vitest) into the driver. Each test failure becomes a finding with `severity=blocking`; loop iterates the code under test until all tests pass.

**Acceptance:**
- New `scripts/test-harness.ts` runs `bun test {target}` (or via `--runner` flag: `pytest`, `vitest`), parses output, emits findings.toon (one row per failure: `locationPath = path/to/test.ts`, `locationAnchor = "describe > it name"`, `summary = first line of failure message`, `severity = blocking`).
- `fixer-agent`'s Integrator Mode (from F-01) consumes findings and revises the code under test.
- New `/loom-test --autoconverge` wrapper OR a `--autoconverge` flag on existing test entry point. Default `maxIterations=5` (test convergence usually needs more iterations than plan convergence because each fix may unmask additional failures).
- Spawn-count ceiling per iteration: 1 test-run + 1 fixer = 2; ceiling at maxIterations=5 = `1 + 5×2 = 11`.
- Fixture: a tiny seeded-failure repo where test passes after exactly 2 iterations.

### F-03: Debug Convergence Loop

**Description:** Wire an investigation agent + a fix-applier into the driver to converge on a failing symptom. Termination criterion is custom: re-run the symptom and check for resolution (NOT `blockingCount`).

**Acceptance:**
- New `agents/debug-investigator-agent.md` reads a symptom (failing test path, error log, repro script) + codebase context and emits findings.toon with probable causes (severity per confidence: high=blocking, medium=warning, low=info).
- New `agents/fix-applier-agent.md` consumes the investigator's findings + the symptom + the file(s) implicated and revises them. May be `fixer-agent` reused with a debug-context wrapper.
- New `scripts/debug-harness.ts` invokes the investigator, then re-runs the symptom (custom termination check: does the symptom still reproduce?) and reports the result in convergence-summary.toon under a new optional `customTerminationOutcome` field. **Schema extension flagged for design review** before implementation (CA-04).
- New `/loom-bugfix --autoconverge` wrapper (extends the existing `/loom-bugfix` command) OR `/loom-converge --mode document --subject <symptom-file> --harness scripts/debug-harness.ts --integrator fix-applier-agent`.
- Fixture: a seeded-failing-test repo where the investigator correctly identifies the cause in iteration 1 and the fix-applier resolves it in iteration 2.

### F-04: PR-Review Convergence Loop (external bots)

**Description:** Wire external PR-review bots (Gemini, CodeRabbit, GitHub Copilot Reviews) as harnesses. Each bot has a per-bot adapter that translates its inline-comment format into ConvergenceFindings. Integrator is a PR-fixer that reads findings + the PR diff and applies fixes to the working tree.

**Acceptance:**
- New `scripts/pr-review-harness.ts` is a thin dispatcher — reads `converge.config.botAdapter` (e.g., `gemini` | `coderabbit` | `copilot`) and dispatches to the matching `scripts/lib/pr-review-adapters/{name}.ts`.
- New `scripts/lib/pr-review-adapters/gemini.ts` (PRIORITY ONE — consumer Gemini sunsets July 17, 2026): post `/gemini review` via `gh pr comment`, poll the pulls/{n}/reviews endpoint for a new gemini-code-assist[bot] review past a baseline timestamp, fetch inline comments via pulls/{n}/comments, transform into ConvergenceFindings (each comment becomes a finding: path = .path, anchor = `:{line}`, summary = first line of body, severity = parsed from the inline image tag `![high|medium|low]`). Emit findings.toon to the standard outputPath.
- New `scripts/lib/pr-review-adapters/coderabbit.ts` and `copilot.ts` (FOLLOWING — design only in this roadmap; impl deferred to a follow-up). Contract: same adapter interface as Gemini's.
- New `agents/pr-fixer-agent.md` reads findings.toon + the PR diff context (current branch HEAD's diff vs base) and applies revisions to the working tree. May be `fixer-agent` extended.
- New `/loom-git review-pr --autoconverge` wrapper auto-detects the PR number from `gh pr view --json number`, runs the loop, commits each iteration's fixes with a structured commit message (`fix: address {botName} round {N} findings`), and pushes after convergence.
- Subject-extension flagged: `convergence-driver` currently expects `subject` as a file path. PR-review's subject is a git ref (or PR number); F-04 may need a thin shim that treats the PR diff as a virtual file. **Design review before implementation.**
- Fixture: a canned PR with a canned bot-response sequence (pre-populate `reviewer-results/` style envelopes) that converges in 2 iterations.

## Data Model (Conceptual)

### Entities

- **ConvergenceFindings** (existing, locked): the contract every harness emits. F-01 through F-04 all produce this verbatim; no new fields.
- **IterationSnapshot** (existing, locked): per-iteration subject snapshot. Works for any file. F-04's "subject" is a virtual diff snapshot rather than a flat file copy — schema-extension flagged.
- **ConvergenceSummary** (existing, locked, possibly extended by F-03): terminal-state envelope. F-03 may add `customTerminationOutcome: string` for non-blockingCount termination criteria. **Locked C-11 (link-extraction-readiness) must continue to hold after any extension.**

### Relationships

- One `converge.config` → one harness → one integrator → many iterations
- Each application defines its own `harness` + `integrator` pair; the engine is the shared substrate
- Per-application wrappers (F-01: `/loom-code review --autoconverge`, F-02: `/loom-test --autoconverge`, F-03: `/loom-bugfix --autoconverge`, F-04: `/loom-git review-pr --autoconverge`) generate the matching `converge.config` and invoke `/loom-converge --config <path>` exactly the same way `/loom-plan create --autoconverge` does today.

## Milestones

### M-01: Code-Review + Test-Run Convergence Shipped

**Features:** F-01, F-02
**Acceptance:** Both wrappers exist; both pass their fixtures; both reuse `fixer-agent` Integrator Mode; spawn-count ceilings hold; no driver/schema changes.

### M-02: Debug Convergence Shipped (custom termination)

**Features:** F-03
**Depends on:** M-01 (so fixer-agent's Integrator Mode is locked before F-03 starts)
**Acceptance:** Investigator + fix-applier agents land; custom termination via re-run-symptom works; schema extension (if needed) is reviewed + locked.

### M-03: PR-Review Convergence Shipped (Gemini adapter as priority-one)

**Features:** F-04 (Gemini adapter shipped; CodeRabbit/Copilot deferred)
**Depends on:** M-01
**Acceptance:** `/loom-git review-pr --autoconverge` against a canned-bot fixture converges in 2 iterations. Subject-extension (PR-as-virtual-subject) design-reviewed and either confirmed unnecessary or shipped as a minimal driver-spec patch (escalation to engine-v2 roadmap if invasive).

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| F-03 custom termination requires invasive driver changes | high | Design review BEFORE F-03 implementation. If invasive (touches loop-body conditional or terminal-state transition), defer to a "convergence-engine v2" roadmap rather than fork the engine here. |
| F-04 subject-extension (PR-as-virtual-file) breaks C-11 link-readiness | medium | F-04 first phase is design + spike against link-result.schema.md. If link-extraction can derive `nextLink` from a PR-shaped subject without engine changes, ship. Otherwise defer. |
| Each application's harness reimplements common parsing (severity mapping, location-path resolution) | medium | All four harnesses import `scripts/lib/aggregate-findings.ts` (already locked from Phase 9). Adapter contract enforced via the existing `ConvergenceFindings` schema — TOON-level validation catches drift. |
| Gemini sunsets before F-04's Gemini adapter ships | medium | Sequence work: prioritize F-04 Gemini adapter as the first F-04 phase. CodeRabbit + Copilot deferred but adapter contract locked early so their phases are pure additions. |
| Per-bot adapter explosion in F-04 (every new review service needs a fresh adapter) | low | Single dispatcher pattern (`scripts/pr-review-harness.ts` reads `botAdapter` config) + locked adapter interface. New bots are pure additions; no engine changes. |
| Users confuse `/loom-code review --autoconverge` (this roadmap) with `/loom-code fix` (existing one-shot) | low | F-01 acceptance includes a README disambiguation table row similar to the maintenance-verbs table in PR #19 (`/loom-library` vs `/loom-upgrade`). |

## Out of Scope

- **Engine changes.** Any feature that requires modifying `agents/convergence-driver.md`, `findings.schema.md`, `iteration-snapshot.schema.md`, or `convergence-summary.schema.md` (other than the F-03 optional `customTerminationOutcome` field if approved) escalates to a separate "convergence-engine v2" roadmap.
- **CodeRabbit and GitHub Copilot Reviews adapters.** Contracts locked in F-04 design; implementations deferred.
- **Cross-application orchestration** (e.g., "run F-01 then F-02 then F-03 in sequence on the same subject"). Each application stands alone; composing them is its own roadmap.
- **Visualization / TUI for live convergence runs.** Existing stdout-progress contract (C-09) is sufficient.
- **Anything outside `/loom-converge --mode document`.** Target and criteria modes are untouched by this roadmap.

## Open Questions

- **OQ-01:** F-03's custom termination — does the existing driver support a pluggable termination check, or does it always read `blockingCount` from findings.toon? If the latter, F-03 needs a small driver extension (against CA-01) or a workaround (e.g., harness emits `findings.toon` with `blockingCount=0` only when the symptom no longer reproduces, treating the symptom-check as a synthetic finding). **Decide before F-03 starts.**

  **Decision (2026-06-14):** Synthetic-finding workaround. Driver hard-codes `blockingCount == 0` in document mode (see `agents/convergence-driver.md` Convergence Loop step 2) — no pluggable termination hook exists. F-03's debug-harness re-runs the symptom as part of emitting `findings.toon`. If the symptom still reproduces, emit a synthetic finding `severity=blocking, summary="symptom still reproduces"`. When resolved, that finding disappears and `blockingCount → 0` → driver declares CONVERGED. **CA-01 compliant; no engine change.** CA-04's `customTerminationOutcome` schema extension is therefore unnecessary — `status: converged` is the correct signal because convergence IS "blocking findings cleared."

- **OQ-02:** F-04's subject — can `subject` in `converge.config` be a PR identifier (`gh:pr:19`) instead of a file path, with the driver treating it as opaque? Or does the driver require a real file? Probably needs a tiny spec clarification in `agents/convergence-driver.md` (one-line change to "subject is opaque to the engine; only the harness interprets it"). **Decide before F-04 starts.**

  **Decision (2026-06-14):** Synthetic-file workaround. Driver preflight check #3 explicitly resolves `subject` to "an existing file under the repo root"; snapshot writer copies it per iteration. PR identifier as subject breaks both. Solution: F-04 harness maintains `pr-state.toon` (head SHA + base SHA + diff hash + comment IDs) as the subject. First action each iteration is to refresh that file. The PR identifier lives inside `converge.config` as an additional field the harness reads. The integrator (`pr-fixer-agent`) reads findings + uses `gh` CLI to fetch the diff. Snapshot mechanism just snapshots `pr-state.toon` — clean. **CA-01 compliant; no engine change.** The driver believes it's iterating a file; the file is a PR projection.

- **OQ-03:** Should `fixer-agent`'s Integrator Mode be a single new mode on the existing agent, or a separate `fixer-integrator-agent.md`? Phase 8 used the former pattern for plan-builder; symmetry argues for the same here. **Default to single-agent + new mode.**

  **Decision (2026-06-14):** Single agent + new mode. Locked.

- **OQ-04:** Does F-04's Gemini adapter need to handle Gemini's "stale anchor re-flag" behavior (we observed in PR #19 round 3 that Gemini re-flagged already-fixed code at the same line number)? Probably yes — adapter should dedupe findings against the prior iteration's findings.toon (same `locationPath:locationAnchor:summary` → suppress). **Decide before F-04 implementation.**

  **Decision (2026-06-14):** Required. Adapter reads prior iteration's `findings.toon` from `.plan-execution/convergence/iterations/iter-{N-1}.toon` and suppresses entries with matching `(locationPath, locationAnchor, summary)`. Failure mode without dedup is silent loop oscillation that triggers REGRESSION incorrectly. Applies to all per-bot adapters (Gemini priority-one; CodeRabbit/Copilot inherit the contract).

- **OQ-05:** Convergence on a non-merging branch — F-04 commits per iteration; what's the right squash/merge strategy for the resulting commits? Probably squash-on-merge so the PR shows a single "fix(pr-review): applied {botName} findings (N iterations)" commit. **Decide before F-04 ships.**

  **Decision (2026-06-14):** Per-iteration commits with structured message (`fix(pr-iter-{N}/{botName}): {summary}`) for forensic trail; PR squash-on-merge produces a single `fix(pr-review): applied {botName} findings (N iterations)` commit on `main`. Matches manual execution on PR #19.

## Notes

Authored 2026-06-14 by the same session that shipped convergence-generalization PR #18 and PR #19. The trigger was an observation that the document-mode driver we just built is fully general and should apply to test-runs / debugs / code-review / PR-review — not just plan creation. The Gemini-loop manual execution on PR #19 (rounds 1–5) is the unbuilt F-04 application executed by hand; trajectory `4 → 4 → 2 → 3 → 2`.

Next step: route this roadmap through `/loom-plan create` (with or without `--autoconverge` — recursively dogfooding the existing system) to produce a phased PLAN with wave assignments. F-01 + F-02 land first as M-01; F-03 + F-04 follow once the integrator mode + adapter contracts are locked.

---
roadmapVersion: 1
name: "Exceed gstack"
status: approved
created: 2026-07-01
lastReviewed: 2026-07-01
targetDate: null
totalFeatures: 26
totalMilestones: 9
---

# Roadmap: Exceed gstack

## Vision

Loom-ai and Garry Tan's gstack (github.com/garrytan/gstack) were subjected to a completed 4-agent comparative review across seven quality dimensions. Loom leads on prompt-assets and ties on architecture and docs, but trails on code quality (6 vs 8), tests (6 vs 9), extensibility (7 vs 8), and ops polish (7 vs 9) — overall ~7.1 vs ~8.3. This initiative closes and then reverses those gaps: fix 15 verified defects, harden the test and release spines, generate drift-proof docs, add a free-by-default eval tier ladder, and upgrade every gstack-derived skill past its upstream. Success is not self-declared — it is confirmed by re-running the same 4-agent review and requiring every dimension to meet or beat gstack with an overall score above 8.3. The work sequences foundation-first: CI gates and a shared core library land before any defect fix, and defect fixes land before the exceed milestones.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Typecheck errors | 0 under hooks tsconfig | `tsc --noEmit -p hooks/tsconfig.json` in CI (currently 49 errors) |
| Test:source ratio | ≥ 1.4:1 by LOC (or a justified equivalent) | LOC comparison script over `tests/**` vs source `**/*.ts` |
| Tautological tests | 0 remaining in suite | tautological-test audit report (F-12) shows zero `tautological` / `prompt-grep` classifications |
| Verified defects closed | 15 of 15 | defect-closure checklist, each defect mapped to a shipped feature |
| CI gates | all green (PR tier + nightly tier) | GitHub Actions run status on both workflow tiers |
| Meta-tests present | ≥ 1 planted-defect meta-test that fires | vitest meta-test suite proves a linter/guard catches an intentionally planted regression |
| Comparative scorecard | every dimension ≥ gstack; overall > 8.3 | re-run of the same 4-agent comparative review at initiative close (F-25) |

## Constraints & Decisions

### C-01: Tiered CI gates
**Decision:** PR-blocking gate = `tsc --noEmit` (0 errors) + lint + changed-file vitest + hook-registration drift check + docs drift check + library-catalog validate. Nightly gate = full 1810-test suite + Docker e2e + eval tiers with a regression floor versus `main`.
**Rationale:** The full suite is serial and runs ~222s with admitted load-sensitive flakiness; gate the deterministic, fast classes hard on every PR and move the heavy, slow, or flaky tiers to nightly so PR feedback stays fast and green.
**Alternatives considered:** Run the full 1810-test suite on every PR — rejected: 222s serial plus ~39 load-sensitive spurious failures would make PRs chronically red and slow.
**Impact:** high

### C-02: Shared core library at repo-root `lib/`
**Decision:** Introduce a neutral shared core library at repo-root `lib/` (TOON parse/serialize, CSV, atomic-fs, entry-guard) imported by both `hooks/` and `scripts/`; add a `no-restricted-import` lint ban on local reimplementations; migrate via the strangler pattern. This library must precede all parser/serializer dedup work.
**Rationale:** There are ≥5 divergent CSV splitters, ≥4 hand-rolled TOON serializers, and `atomicWrite` copy-pasted three times; a single neutral module removes the drift surface and lets dedup proceed against one source of truth.
**Alternatives considered:** Keep per-module reimplementations and reconcile by hand — rejected: that is the status quo that produced the divergence (e.g., `hooks/lib/toon-reader.ts:125` misses escaped `""`).
**Impact:** high

### C-03: Three-tier, free-by-default eval framework
**Decision:** Eval runs in three tiers: T1 static/deterministic (free, PR-tier), T2 hermetic behavioral with fixtured LLM I/O (free, nightly), T3 LLM-judge opt-in behind a `LOOM_EVAL_LLM` env flag, never merge-blocking, run pre-release with a floor versus `main`. This SUPERSEDES the gstack-adoption scope-contract item N-03 (eval framework was previously out of scope; it is now in scope).
**Rationale:** Free deterministic and hermetic tiers give continuous signal at zero cost; LLM-judge is expensive and nondeterministic, so it is opt-in and advisory rather than a merge gate.
**Alternatives considered:** Merge-blocking LLM-judge on every PR — rejected: cost and nondeterminism make it unsuitable as a hard gate.
**Impact:** high

### C-04: Milestone-boundary semver release
**Decision:** Tag semver versions at milestone boundaries (conventional-commit-derived), add version-gate CI, move or delete the 17 `plan-exec-*` tags out of the `v*` namespace (to `refs/exec/*` or delete), and give the changelog semver headers plus pre-registered repo-derivable metrics.
**Rationale:** The only tag across 207 commits is `v0.0.1` and the `v*` namespace is polluted with 17 `plan-exec-*` tags; milestone-boundary semver gives a clean, meaningful release cadence for a single-maintainer project.
**Alternatives considered:** Version every merge (gstack style) — rejected: too granular for this project's cadence and would multiply release overhead.
**Impact:** medium

### C-05: Generated docs for enumerable metadata
**Decision:** Generate enumerable metadata sections (command tables, hook count/table, agent model-tier table) from frontmatter plus the hooks manifest into README and reference docs, with a CI drift-fail check. Narrative prose stays hand-authored.
**Rationale:** README drift is a recurring defect ("fourteen" vs "Thirteen" hook counts, undocumented shipped commands); generating the enumerable parts from source removes the drift class permanently while preserving human-authored voice.
**Alternatives considered:** Keep docs fully hand-authored — rejected: it produced the current drift and cannot be trusted to stay in sync.
**Impact:** medium

### C-06: Shared skill preamble by reference
**Decision:** Author the skill preamble once as a protocol resource cited by reference (extending the `_loom-init-guard` include pattern); apply it to all PR#31 gstack-derived skills.
**Rationale:** gstack skills carry 700–800-line preamble bloat duplicated per skill; a single referenced protocol keeps each skill lean and keeps the shared contract in one place.
**Alternatives considered:** Inline the full preamble into each skill (gstack's approach) — rejected: duplication and bloat, and it drifts per skill.
**Impact:** medium

### C-07: Tiered AgentResult mandate
**Decision:** Pipeline-participant agents (stage teammates, reviewers, executors, converge drivers) MUST emit the AgentResult envelope; standalone/utility agents are exempt. The policy is documented in `protocols/agent-result.schema.md` and enforced by a conformance test.
**Rationale:** The envelope is load-bearing for pipeline coordination but pure overhead for one-shot utility agents; tiering the mandate keeps the contract where it matters.
**Alternatives considered:** Mandate the envelope on every agent — rejected: utility agents gain nothing and it invites boilerplate.
**Impact:** medium

### C-08: agent-result-validator correctness and enforcement
**Decision:** Fix the `runHook` call in `hooks/agent-result-validator.ts:155`, register the hook in `.claude/settings.json`, make it blocking on required fields per the schema, and warn-only for optional fields.
**Rationale:** The validator has been a silent no-op since merge (wrong harness signature) and is unregistered; the schema's required-field guarantees are currently unenforced.
**Alternatives considered:** Leave the confidence check non-blocking — rejected: `agent-result.schema.md:91` says a missing required field MUST be rejected.
**Impact:** high

### C-09: Repo-derivable success criteria plus final acceptance review
**Decision:** Convergence targets are repo-derivable metrics — typecheck 0 errors; test:source ratio ≥1.4:1 by LOC or a justified equivalent; 0 tautological tests in the suite; all 15 defects closed; CI gates green; meta-tests present — AND final acceptance is a re-run of the 4-agent comparative review in which every dimension is ≥ its gstack score and overall > 8.3.
**Rationale:** Repo-derivable metrics keep progress falsifiable without telemetry; the comparative review re-run is the definitional acceptance for "exceed gstack."
**Alternatives considered:** Subjective maintainer sign-off only — rejected: not falsifiable and not comparable against gstack.
**Impact:** high

### C-10: Foundation-first sequencing
**Decision:** M-01 (CI gates + shared lib) lands before the defect-fix milestones, which land before the exceed milestones. Hard dependencies: the C-02 shared lib precedes all dedup; the CI test gate precedes removing the `fileParallelism` workaround.
**Rationale:** Dedup cannot proceed without the shared library, and the flaky-suite workaround cannot be safely removed until CI is running the suite; ordering prevents rework and regressions.
**Alternatives considered:** Run milestones in parallel — rejected: violates the two hard dependencies above and risks dedup drift.
**Impact:** high

### C-11: Tautological-test remediation flow
**Decision:** Audit-classify every suspect test (behavioral vs tautological vs prompt-grep), delete the confirmed no-value tests, and backfill behavioral, meta-, and property tests in their place.
**Rationale:** ~20% of tests are tautological or prompt-grep (e.g., a test that reimplements the code it asserts, or asserts strings it itself constructs); deleting without backfill would drop coverage, so remediation pairs deletion with replacement.
**Alternatives considered:** Delete all suspect tests outright — rejected: some are salvageable and coverage must not regress.
**Impact:** medium

### C-12: Pre-locked toolchain
**Decision:** TypeScript, bun-preferred with a Node hook runtime, vitest, GitHub Actions, TOON everywhere, the 5-resource extensibility model, and no telemetry collection (all metrics must be repo-derivable).
**Rationale:** The toolchain is settled; new frameworks would add surface area without advancing the exceed goal, and telemetry is explicitly excluded.
**Alternatives considered:** Introduce new test/eval/release frameworks — rejected: locked toolchain, and repo-derivable metrics avoid a telemetry dependency.
**Impact:** medium

### C-13: gstack-derived skill upgrades beyond upstream
**Decision:** Each gstack-derived skill (loom-design*, loom-think→loom-cso/loom-spec, loom-careful, loom-health, loom-ship, loom-retro, loom-qa, loom-canary, loom-devex-review, loom-benchmark*, loom-worktree, loom-browser, loom-skillify, loom-learn) gets: preamble-by-reference (C-06), behavioral tests for its backing scripts/hooks, wired enforcement where its spec claims enforcement, and at least one capability its gstack upstream lacks (documented per-skill in the feature's acceptance criteria).
**Rationale:** The initiative goal is to exceed, not match; every ported skill must demonstrably surpass its upstream on a named axis.
**Alternatives considered:** Match parity with gstack skills — rejected: parity does not move the scorecard past gstack.
**Impact:** high

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.x | Type safety across hooks, scripts, and agents |
| Runtime | Bun | latest | Primary runtime for scripts and hooks |
| Runtime (fallback) | Node.js | 20+ | Hook runtime and fallback when Bun is unavailable |
| Testing | Vitest | latest | Unit, integration, meta-, and property tests |
| CI | GitHub Actions | current | Tiered PR-blocking and nightly gates |
| Platform | Claude Code plugin + direct symlink | current | Host for agents, prompts, skills, infrastructure |
| Data Format | TOON | v1 | All Loom artifacts, agent outputs, and eval results |
| Shared core | repo-root `lib/` | new | Neutral TOON/CSV/atomic-fs/entry-guard module (C-02) |

## Features

### F-01: Tiered CI gate ladder

**Priority:** P0
**Milestone:** M-01
**Description:** Establish the tiered CI defined in C-01. A PR-blocking workflow runs `tsc --noEmit` (0 errors), lint, changed-file vitest, a hook-registration drift check, a docs drift check, and library-catalog validate. A separate nightly workflow runs the full 1810-test suite, Docker e2e, and the eval tiers with a regression floor versus `main`. Closes defect 5 (no CI runs the vitest suite: 8 workflows exist but only `install-command-coverage.yml` runs 1 file).

**Entities involved:** CiGateConfig

**Key behaviors:**
- PR-tier workflow blocks merge on typecheck, lint, changed-file tests, and the three drift/validate checks.
- Nightly-tier workflow runs the full suite, Docker e2e, and eval tiers against a `main` regression floor.
- Both tiers publish machine-readable status consumed by the success-metrics checklist.

**Convergence targets:**
- PR-tier workflow exits non-zero when `tsc --noEmit` reports any error.
- Nightly-tier workflow schedule triggers the full 1810-test suite.

**Scenarios:**

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

### F-02: Shared core library at repo-root `lib/`

**Priority:** P0
**Milestone:** M-01
**Description:** Create the neutral shared core library mandated by C-02 at repo-root `lib/`, exposing TOON parse/serialize, a correct CSV splitter, an atomic-fs helper, and an entry-guard helper, importable by both `hooks/` and `scripts/`. Add a `no-restricted-import` lint rule banning local reimplementations. This library must land before any dedup work (defect 8) and before the entry-guard-dependent test backfill (defect 6).

**Entities involved:** SharedCoreModule

**Key behaviors:**
- `lib/` exports TOON parse/serialize, CSV split, atomic write, and an `isMain(import.meta)` entry-guard helper.
- The CSV splitter correctly handles escaped `""` (the case `hooks/lib/toon-reader.ts:125` currently misses).
- Lint `no-restricted-import` fails when a module reimplements a banned primitive locally.

**Convergence targets:**
- Importing `lib/` from both a hook and a script resolves without duplication.
- Lint exits non-zero when a file reimplements a banned CSV/TOON/atomic-fs primitive.

**Scenarios:**

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

### F-03: agent-result-validator fix, registration, and blocking enforcement

**Priority:** P0
**Milestone:** M-02
**Description:** Fix defect 1 and implement C-08. `hooks/agent-result-validator.ts:155` calls `runHook(main)` but the harness signature is `runHook(name, handler)`, making it a silent no-op since merge; it is also unregistered in `.claude/settings.json`. Correct the call, register the hook, make it blocking on required fields per the schema, and warn-only for optional fields.

**Entities involved:** HookRegistrationManifest, AgentResultFinding

**Key behaviors:**
- `hooks/agent-result-validator.ts:155` calls `runHook(name, handler)` with the correct arity.
- The hook is registered in `.claude/settings.json` and actually executes.
- The validator blocks (non-zero) on a missing required field and warns (non-blocking) on a missing optional field.

**Convergence targets:**
- The validator exits non-zero for an AgentResult missing a required field.
- The validator exits zero with a warning for an AgentResult missing only an optional field.

**Scenarios:**

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

### F-04: Shell-injection remediation via argv execution

**Priority:** P0
**Milestone:** M-02
**Description:** Fix defect 2, two shell-injection sites. `scripts/loom-health.ts:238` interpolates filenames into `execSync` for shellcheck, and `scripts/loom-version-slot.ts:147` interpolates registry-sourced branch names into `execSync git rev-parse`. Convert both to `execFileSync` argv arrays following the house pattern at `hooks/deploy-guard.ts:166-201`.

**Entities involved:** SharedCoreModule

**Key behaviors:**
- `scripts/loom-health.ts:238` passes filenames as an argv array to `execFileSync`, not an interpolated shell string.
- `scripts/loom-version-slot.ts:147` passes branch names as argv, never through a shell.
- A test proves a filename/branch containing shell metacharacters is treated as a literal argument.

**Convergence targets:**
- A crafted filename containing `;` or `$(...)` does not execute an injected command.

**Scenarios:**

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

### F-05: Cross-repo state contamination fix in version-slot

**Priority:** P1
**Milestone:** M-02
**Description:** Fix defect 3. `scripts/loom-version-slot.ts:231-246` records unrelated repositories' worktrees into the slot registry (cross-repo contamination), whereas `scripts/loom-worktree-scan.ts:421` filters correctly. Apply the same repo-scoping filter so version-slot only records worktrees belonging to the current repository.

**Entities involved:** ReleaseVersion

**Key behaviors:**
- `loom-version-slot.ts` filters worktrees to the current repo before recording, matching `loom-worktree-scan.ts:421`.
- Worktrees from an unrelated repo are excluded from the slot registry.

**Convergence targets:**
- The slot registry contains only worktrees whose git common-dir resolves to the current repo.

**Scenarios:**

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

### F-06: Typecheck to zero errors

**Priority:** P0
**Milestone:** M-02
**Description:** Fix defect 4: 49 typecheck errors under the hooks tsconfig, including the dead `.action` read at `scripts/loom-first-run.ts:15`. Drive `tsc --noEmit` to 0 errors so the C-01 PR-tier typecheck gate can go green. Remove dead reads and correct type mismatches without changing runtime behavior.

**Entities involved:** MetricsSnapshot

**Key behaviors:**
- `tsc --noEmit` under the hooks tsconfig reports 0 errors.
- The dead `.action` read at `scripts/loom-first-run.ts:15` is removed.
- No runtime behavior changes as a side effect of type fixes.

**Convergence targets:**
- `tsc --noEmit -p hooks/tsconfig.json` exits 0.

**Scenarios:**

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

### F-07: AgentResult confidence schema/impl reconciliation

**Priority:** P1
**Milestone:** M-02
**Description:** Fix defect 11 and codify C-07. `protocols/agent-result.schema.md:91` says a missing `confidence` MUST be rejected (blocking), but the implementation only warns (non-blocking). Reconcile the two — align the implementation to the schema per C-08's blocking rule — and document the tiered AgentResult mandate (pipeline-participant agents required, utility agents exempt) in the schema, enforced by a conformance test.

**Entities involved:** AgentResultFinding

**Key behaviors:**
- The implementation blocks on missing `confidence` for pipeline-participant agents, matching the schema.
- `agent-result.schema.md` documents the tiered mandate (participant vs utility).
- A conformance test asserts a participant agent's envelope is rejected without required fields.

**Convergence targets:**
- Conformance test fails a participant AgentResult that omits `confidence`.

**Scenarios:**

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

### F-08: Duplication dedup onto the shared core

**Priority:** P1
**Milestone:** M-03
**Description:** Fix defect 8 by migrating all divergent primitives onto the F-02 shared core (strangler migration per C-02). Consolidate ≥5 divergent CSV splitters (`hooks/lib/toon-reader.ts:125` misses escaped `""`; `scripts/loom-change/archive.ts:1119` is correct; `materialize-contracts.ts:787` preserves quotes others strip), ≥4 hand-rolled TOON serializers, and the `atomicWrite` copy-pasted three times (`loom-browser-daemon.ts:32`, `loom-install.ts:80`, `loom-version-slot.ts:216`); retire the stranded `atomicWriteText` in `scripts/loom-change/init.ts`.

**Entities involved:** SharedCoreModule

**Key behaviors:**
- All CSV splitting routes through the shared `lib/` splitter; local copies are deleted.
- All TOON serialization routes through the shared serializer.
- All atomic writes route through the shared atomic-fs helper; the stranded `atomicWriteText` is removed.

**Convergence targets:**
- Grep finds zero local reimplementations of CSV split, TOON serialize, or atomic write outside `lib/`.

**Scenarios:**

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

### F-09: Remove stale committed worktree-context block from CLAUDE.md

**Priority:** P0
**Milestone:** M-03
**Description:** Fix defect 9. `CLAUDE.md` carries a committed "Worktree Context — READ THIS FIRST" block claiming branch `m07`/`.worktrees/m07`, injecting false hard rules ("stay in this directory", "do not switch branches") into every session on `main`. Remove the committed block so it is only ever injected by the worktree tooling into actual worktrees, not baked into the mainline file.

**Entities involved:** DocsGenerationManifest

**Key behaviors:**
- The stale worktree-context block is removed from the committed `CLAUDE.md` on `main`.
- The worktree tooling still injects the block into real worktrees at creation time.
- A guard test asserts `main`'s `CLAUDE.md` contains no hard-coded worktree hard-rules block.

**Convergence targets:**
- `CLAUDE.md` on `main` contains no "Worktree Context — READ THIS FIRST" block.

**Scenarios:**

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

### F-10: Hook-registration convergence and dead-tooling cleanup

**Priority:** P1
**Milestone:** M-03
**Description:** Fix defect 10. Reconcile hook-registration drift across three sources: `.claude/settings.json` (live) vs `hooks/hooks.json` (registers context-budget under `Write|Edit` where it is inert) vs `scripts/lib/loom-hooks-manifest.ts`. Delete the dead `scripts/validate-toon-schemas.ts` (scans nonexistent `agents/`/`protocols/`, validates 0 files, exits 0) and rename `hooks/context-budget-test.ts` (a hook implementation misnamed as a test). The hook-registration drift check from F-01 enforces convergence going forward.

**Entities involved:** HookRegistrationManifest

**Key behaviors:**
- The three registration sources agree; context-budget is registered on the correct event, not the inert `Write|Edit`.
- `scripts/validate-toon-schemas.ts` is removed (or repointed to real paths and made to validate >0 files).
- `hooks/context-budget-test.ts` is renamed to reflect that it is a hook implementation, not a test.

**Convergence targets:**
- The hook-registration drift check exits 0 (all three sources agree).

**Scenarios:**

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

### F-11: Entry guards and behavioral backfill for untested PR#31 files

**Priority:** P0
**Milestone:** M-04
**Description:** Fix defect 6. Eight PR #31 TypeScript files (~2.9k LOC) are untested: `loom-health.ts`, `loom-worktree-scan.ts`, `loom-browser-daemon.ts`, `loom-install.ts`, `loom-version-slot.ts`, `loom-careful.ts`, `agent-result-validator.ts`, `preflight-worktree-scan.ts`. `loom-version-slot.ts` and `loom-browser-daemon.ts` call `main()` at top level with no entry guard, making them un-importable for tests. Add `isMain(import.meta)` entry guards (from F-02's `lib/`) so they are importable, then backfill behavioral tests for all eight.

**Entities involved:** SharedCoreModule, MetricsSnapshot

**Key behaviors:**
- `loom-version-slot.ts` and `loom-browser-daemon.ts` guard their `main()` behind an entry-guard so importing the module has no side effect.
- Each of the eight files gains behavioral tests exercising real logic (not string-grep).
- The new tests run under the F-01 changed-file PR gate.

**Convergence targets:**
- Importing `loom-version-slot.ts` in a test does not execute `main()`.
- All eight files have at least one behavioral test file.

**Scenarios:**

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

### F-12: Tautological-test audit and deletion

**Priority:** P1
**Milestone:** M-04
**Description:** Implement the first half of C-11 for defect 7. ~20% of tests are tautological or prompt-grep — e.g., `tests/commands/loom-prototype.test.ts` reimplements `completion-ceremony.ts`, and `tests/regressions/stuck-at-loop-construction.test.ts` asserts strings it itself constructs. Audit and classify every suspect test (behavioral vs tautological vs prompt-grep) into a durable TOON report, then delete the confirmed no-value tests.

**Entities involved:** TautologicalTestAudit

**Key behaviors:**
- Every suspect test is classified behavioral / tautological / prompt-grep in a TOON audit report.
- Confirmed tautological and prompt-grep tests are deleted.
- The audit report is durable and re-runnable so the success metric can read it.

**Convergence targets:**
- The audit report classifies 100% of the flagged suspect tests.
- Post-deletion, the suite contains zero tests classified tautological or prompt-grep.

**Scenarios:**

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

### F-13: Meta-tests, property tests, and test:source ratio backfill

**Priority:** P1
**Milestone:** M-04
**Description:** Implement the second half of C-11 and match-then-exceed gstack's test strength (its 9/10 rests on a 1.4:1 test:source ratio, property tests, meta-tests, and issue-pinned regressions). Backfill behavioral, property, and meta-tests to replace deleted tautological tests and to raise the test:source LOC ratio to ≥1.4:1. Add at least one property test (e.g., a merge/serialize round-trip that is order-independent) and at least one meta-test that plants a catastrophic defect and proves a linter/guard fires.

**Entities involved:** MetricsSnapshot, TautologicalTestAudit

**Key behaviors:**
- Test:source LOC ratio reaches ≥1.4:1 (or a justified equivalent) measured by the metrics script.
- At least one property test asserts an invariant over generated inputs.
- At least one meta-test plants a regression and asserts a guard/linter catches it.

**Convergence targets:**
- The metrics script reports test:source ratio ≥1.4:1.
- The planted-defect meta-test exits non-zero when the guard is disabled and zero when enabled.

**Scenarios:**

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

### F-14: Deflake suite and retire fileParallelism workaround

**Priority:** P1
**Milestone:** M-04
**Description:** Fix defect 15. Remove the `vitest fileParallelism:false` workaround (masking ~39 load-sensitive spurious failures and forcing a serial 222s suite) by isolating the shared-state sources that cause load-sensitivity, and provide a local fallback for the 5 Docker-only e2e specs that currently fail out of the box. Per C-10, this depends on the F-01 CI test gate being live so regressions are caught. The full suite runs in the nightly tier.

**Entities involved:** CiGateConfig

**Key behaviors:**
- `fileParallelism:false` is removed and the suite passes with parallel file execution.
- The ~39 load-sensitive failure sources are isolated (no shared mutable global fixtures).
- The 5 Docker-only e2e specs skip cleanly (with a clear message) or run against a local fallback outside Docker.

**Convergence targets:**
- The suite passes with `fileParallelism` enabled across repeated runs.
- Docker-only e2e specs report a clean skip when Docker is unavailable.

**Scenarios:**

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

### F-15: Milestone semver, version-gate CI, and metric-bearing changelog

**Priority:** P0
**Milestone:** M-05
**Description:** Implement the core of C-04 for defect 13. The only tag across 207 commits is `v0.0.1`. Introduce milestone-boundary semver tagging derived from conventional commits, add a version-gate CI check, and give `planning/history/changelog.md` semver headers plus pre-registered, repo-derivable success metrics (converting it from an agent journal to a real changelog).

**Entities involved:** ReleaseVersion, MetricsSnapshot

**Key behaviors:**
- A milestone boundary produces a semver tag derived from conventional commits.
- Version-gate CI fails when a release-worthy change lands without a version bump.
- The changelog carries semver section headers and pre-registered repo-derivable metrics per version.

**Convergence targets:**
- A milestone-close run produces a new `vX.Y.Z` tag and a matching changelog header.

**Scenarios:**

```toon
id: S-01
title: Milestone close cuts a semver tag and changelog entry
given[1]: A milestone's conventional commits are ready to release
when: The release tooling runs at the milestone boundary
whenTriggerType: system-event
then[2]: A semver vX.Y.Z tag MUST be created, The changelog MUST gain a matching semver header with metrics
tags[1]: happy-path
automatable: true
```

### F-16: Tag-namespace cleanup and dormant release tooling activation

**Priority:** P1
**Milestone:** M-05
**Description:** Complete C-04 / defect 13. Move or delete the 17 `plan-exec-*` tags polluting the `v*` namespace (to `refs/exec/*` or delete). Activate the dormant `release.yml`, `generate-changelog.ts`, and `build-release-tarball.ts`, and add tests for the previously untested `generate-changelog.ts`.

**Entities involved:** ReleaseVersion

**Key behaviors:**
- The 17 `plan-exec-*` tags are relocated to `refs/exec/*` or deleted; `v*` contains only semver tags.
- `release.yml` runs on a real trigger and invokes `generate-changelog.ts` + `build-release-tarball.ts`.
- `generate-changelog.ts` gains behavioral tests.

**Convergence targets:**
- `git tag -l 'v*'` returns only semver tags (no `plan-exec-*`).
- A release run produces a tarball artifact.

**Scenarios:**

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

### F-17: Fail-closed install integrity with rollback

**Priority:** P0
**Milestone:** M-05
**Description:** Fix defect 14. `install.sh:296` fails open on an integrity downgrade — an unfetchable `checksums.sha256` currently WARNs and continues. Make integrity verification fail-closed (abort on unverifiable checksums) and add trap-based rollback so a partial install is fully reverted on failure.

**Entities involved:** InstallManifest

**Key behaviors:**
- An unfetchable or mismatched `checksums.sha256` aborts the install (non-zero exit), not a warn-and-continue.
- A `trap` handler rolls back partial install state on any failure.
- The happy path (valid checksums) installs unchanged.

**Convergence targets:**
- `install.sh` exits non-zero when checksums cannot be verified.
- After a simulated mid-install failure, no partial artifacts remain.

**Scenarios:**

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

### F-18: Generated docs metadata with CI drift-fail

**Priority:** P1
**Milestone:** M-06
**Description:** Implement C-05 and fix the enumerable half of defect 12. Generate the command tables, hook count/table, and agent model-tier table into README and reference docs from frontmatter plus the hooks manifest, with a CI drift-fail check (the F-01 docs drift check). This permanently closes the "fourteen" (README lines 51, 491) vs "Thirteen" (1277, 1353) hook-count drift and surfaces the four undocumented shipped commands (`loom-careful`, `loom-health`, `loom-profile`, `loom-skill` — the last colliding with the documented `loom-skillify`).

**Entities involved:** DocsGenerationManifest

**Key behaviors:**
- Command tables, hook count/table, and the agent model-tier table are generated from source metadata.
- CI fails when generated sections drift from committed docs.
- All shipped commands (including `loom-careful`, `loom-health`, `loom-profile`, `loom-skill`) appear in the generated command table, with the `loom-skill`/`loom-skillify` collision resolved.

**Convergence targets:**
- The docs drift check exits non-zero when a generated section is stale.
- The generated command table lists every shipped command exactly once.

**Scenarios:**

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

### F-19: Docs convention and hand-authored drift fixes

**Priority:** P2
**Milestone:** M-06
**Description:** Fix the non-enumerable half of defect 12. Correct TOON-convention violations: "AgentResult JSON" wording in `e2e-test-agent.md:155` and `unit-test-agent.md:76`; raw JSON in `code-codex-review-agent.md:53,62`; JSON-brace progress-format strings in the implementer/fixer/verification agents. Add `modelProfile` (used in 9 command files but absent) to `protocols/orchestration-config.schema.md`. Rationalize the model-tier mismatch where `agents/convergence-driver.md` (86KB) runs on `model:sonnet` while the simpler `roadmap-converge-driver.md` gets `opus`.

**Entities involved:** DocsGenerationManifest

**Key behaviors:**
- TOON-convention wording replaces raw-JSON references in the named agent files.
- `modelProfile` is documented in `protocols/orchestration-config.schema.md`.
- The convergence-driver model-tier assignment is corrected or its rationale documented.

**Convergence targets:**
- A convention lint finds zero "AgentResult JSON" or raw-JSON progress strings in the named agent files.

### F-20: Free eval tiers T1 (static) and T2 (hermetic)

**Priority:** P1
**Milestone:** M-07
**Description:** Implement the free-by-default half of C-03 (which supersedes gstack-adoption N-03). Ship the eval framework and its T1 static/deterministic tier (free, PR-tier) and T2 hermetic behavioral tier with fixtured LLM I/O (free, nightly). Results are written as TOON `EvalTierResult` records.

**Entities involved:** EvalTierResult

**Key behaviors:**
- T1 static evals run in the PR tier at zero LLM cost.
- T2 hermetic evals replay fixtured LLM I/O in the nightly tier.
- Both tiers emit `EvalTierResult` TOON records.

**Convergence targets:**
- T1 eval run produces an `EvalTierResult` and requires no network/LLM call.
- T2 eval run replays a fixture without a live LLM call.

**Scenarios:**

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

### F-21: Opt-in eval tier T3 (LLM-judge) with regression floor

**Priority:** P2
**Milestone:** M-07
**Description:** Implement the opt-in half of C-03. Ship T3 LLM-judge behind the `LOOM_EVAL_LLM` env flag — never merge-blocking, run pre-release with a scored floor versus `main`. When the flag is unset, T3 is skipped entirely.

**Entities involved:** EvalTierResult

**Key behaviors:**
- T3 runs only when `LOOM_EVAL_LLM` is set; otherwise it is skipped.
- T3 is never a merge-blocking gate.
- T3 compares the release candidate's judged score against a `main` floor.

**Convergence targets:**
- With `LOOM_EVAL_LLM` unset, T3 is skipped and does not block.
- With the flag set, T3 emits a judged score compared to `main`.

### F-22: Shared skill preamble protocol resource

**Priority:** P0
**Milestone:** M-08
**Description:** Implement C-06. Author the skill preamble once as a protocol resource cited by reference, extending the `_loom-init-guard` include pattern, so gstack-derived skills no longer carry 700–800-line inline preamble bloat. This is the foundation the skill-upgrade batches (F-23, F-24) build on.

**Entities involved:** SkillUpgradeMatrix

**Key behaviors:**
- A single protocol resource holds the shared skill preamble.
- Skills reference the preamble via an include directive rather than inlining it.
- A test asserts a referencing skill resolves the shared preamble at load.

**Convergence targets:**
- A skill that references the preamble resolves it without inlined duplication.

**Scenarios:**

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

### F-23: Skill upgrades — review and quality batch

**Priority:** P1
**Milestone:** M-08
**Description:** Apply C-13 to the review/quality gstack-derived skills: `loom-design*`, `loom-cso`, `loom-qa`, `loom-devex-review`, `loom-health`. Each gets the F-22 preamble-by-reference, behavioral tests for its backing scripts/hooks, wired enforcement where its spec claims enforcement, and at least one capability its gstack upstream lacks (documented per-skill in acceptance criteria).

**Entities involved:** SkillUpgradeMatrix

**Key behaviors:**
- Each skill in the batch references the shared preamble (no inline bloat).
- Each skill's backing scripts/hooks gain behavioral tests.
- Each skill documents at least one capability beyond its gstack upstream in the `SkillUpgradeMatrix`.

**Convergence targets:**
- The `SkillUpgradeMatrix` records preamble-by-reference, tests-present, enforcement-wired, and a beyond-upstream capability for each batch skill.

**Scenarios:**

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

### F-24: Skill upgrades — workflow and ops batch

**Priority:** P2
**Milestone:** M-08
**Description:** Apply C-13 to the workflow/ops gstack-derived skills: `loom-careful`, `loom-ship`, `loom-retro`, `loom-canary`, `loom-worktree`, `loom-browser`, `loom-skillify`, `loom-learn`, `loom-benchmark*`, and the `loom-think`→`loom-cso`/`loom-spec` split. Same four requirements as F-23: preamble-by-reference, behavioral tests, wired enforcement, and a documented beyond-upstream capability per skill.

**Entities involved:** SkillUpgradeMatrix

**Key behaviors:**
- Each workflow/ops skill references the shared preamble and gains behavioral tests.
- Enforcement is wired wherever the skill spec claims it (e.g., `loom-careful` guard, `loom-ship` version-slot).
- Each records a beyond-upstream capability in the `SkillUpgradeMatrix`.

**Convergence targets:**
- The `SkillUpgradeMatrix` is complete for every workflow/ops skill (no missing columns).

### F-25: Comparative scorecard re-run and acceptance gate

**Priority:** P0
**Milestone:** M-09
**Description:** Implement the final-acceptance half of C-09. Re-run the same 4-agent comparative review that produced the baseline (loom ~7.1 vs gstack ~8.3). Record every dimension's new score into a `ScorecardResult` and gate acceptance on every dimension being ≥ its gstack score with overall > 8.3. If any dimension falls short, the initiative is not complete and the gap feeds back into the responsible milestone.

**Entities involved:** ScorecardResult

**Key behaviors:**
- The 4-agent comparative review is re-run with the same rubric as the baseline.
- Each dimension's new score is recorded in a `ScorecardResult` alongside the gstack reference.
- Acceptance passes only when every dimension ≥ gstack and overall > 8.3.

**Convergence targets:**
- The `ScorecardResult` records a numeric score per dimension plus an overall.
- Acceptance status is `pass` only when all dimension deltas are ≥ 0 and overall > 8.3.

**Scenarios:**

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

### F-26: Measured changelog and metrics snapshot

**Priority:** P1
**Milestone:** M-09
**Description:** Close C-04/C-09 by publishing a final measured changelog whose pre-registered metrics are filled in with repo-derived values — the typecheck error count, test:source ratio, tautological-test count, defects-closed tally, CI-gate status, and the scorecard deltas. Persist the values as a `MetricsSnapshot` so the changelog claims are traceable to a re-runnable source, honoring C-12's no-telemetry constraint.

**Entities involved:** MetricsSnapshot, ScorecardResult

**Key behaviors:**
- The final changelog entry embeds repo-derived metric values, not prose estimates.
- A `MetricsSnapshot` TOON artifact records each metric and how it was derived.
- Every published metric is reproducible by re-running its derivation command.

**Convergence targets:**
- The `MetricsSnapshot` contains all seven success metrics with derived values.
- The changelog entry's metrics match the snapshot exactly.

**Scenarios:**

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

## Data Model (Conceptual)

### Entities

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| CiGateConfig | tier, checks[], blocking, schedule | Definition of a PR-blocking or nightly CI gate tier |
| SharedCoreModule | name, exports[], migratedCallers[] | A primitive in repo-root `lib/` (TOON, CSV, atomic-fs, entry-guard) |
| HookRegistrationManifest | hookName, event, source, registered | Canonical record reconciling the three hook-registration sources |
| AgentResultFinding | id, confidence, severity, category | A single reviewer finding within an AgentResult envelope |
| MetricsSnapshot | metric, value, derivedBy, capturedAt | A repo-derived success metric and its derivation command |
| TautologicalTestAudit | testPath, classification, action | Classification of a suspect test and the action taken |
| ReleaseVersion | semver, tagRef, commitRange, metrics[] | A milestone-boundary semver release and its changelog metrics |
| InstallManifest | artifact, checksum, installedAt, verified | Install-time record supporting fail-closed integrity and rollback |
| DocsGenerationManifest | section, source, generated, lastDrift | A generated docs section and its drift status |
| EvalTierResult | tier, evalId, outcome, judgedScore | Result record for a T1/T2/T3 eval run |
| SkillUpgradeMatrix | skill, preambleRef, testsPresent, enforcementWired, beyondUpstream | Per-skill upgrade tracking against C-13's four requirements |
| ScorecardResult | dimension, loomScore, gstackScore, delta | A dimension score from the re-run 4-agent comparative review |

### Relationships

| From | To | Type | Description |
|------|-----|------|-------------|
| CiGateConfig | EvalTierResult | 1:N | A gate tier runs many eval-tier results |
| SharedCoreModule | HookRegistrationManifest | 1:N | Shared modules are consumed by registered hooks |
| ReleaseVersion | MetricsSnapshot | 1:N | Each release pins a set of derived metrics |
| ReleaseVersion | InstallManifest | 1:N | A release produces install artifacts with integrity records |
| SkillUpgradeMatrix | EvalTierResult | 1:N | Upgraded skills are exercised by eval-tier runs |
| ScorecardResult | MetricsSnapshot | N:1 | Scorecard dimensions are summarized into the final metrics snapshot |
| DocsGenerationManifest | ReleaseVersion | N:1 | Generated docs are refreshed at release boundaries |
| TautologicalTestAudit | MetricsSnapshot | N:1 | Audit outcomes feed the tautological-test-count metric |

## Milestones

### M-01: Foundation — CI gates and shared core library

**Features:** F-01, F-02
**Depends on:** None
**Acceptance:** The tiered CI ladder (PR-blocking + nightly) is live and the repo-root `lib/` shared core exists with a `no-restricted-import` ban. All later milestones can rely on gates and a single source of truth for primitives.
**Effort:** M

### M-02: Critical defect fixes — correctness and security

**Features:** F-03, F-04, F-05, F-06, F-07
**Depends on:** M-01
**Acceptance:** The agent-result-validator is fixed, registered, and blocking; both shell-injection sites use argv execution; cross-repo state contamination is filtered out; typecheck is at 0 errors; and the AgentResult confidence schema/impl mismatch is reconciled with a conformance test.
**Effort:** L

### M-03: Hygiene defect fixes — dedup, stale docs, registration drift

**Features:** F-08, F-09, F-10
**Depends on:** M-01, M-02
**Acceptance:** All divergent CSV/TOON/atomic primitives route through the shared core; the stale committed worktree block is removed from `CLAUDE.md`; and hook registration converges across the three sources with dead tooling cleaned up.
**Effort:** M

### M-04: Test overhaul

**Features:** F-11, F-12, F-13, F-14
**Depends on:** M-01, M-02
**Acceptance:** The eight untested PR#31 files are importable and behaviorally tested; tautological tests are audited and removed; property and meta-tests exist and the test:source ratio is ≥1.4:1; and the `fileParallelism` workaround is retired with Docker-only e2e specs handled locally.
**Effort:** L

### M-05: Release and ops hardening

**Features:** F-15, F-16, F-17
**Depends on:** M-01
**Acceptance:** Milestone-boundary semver tagging with version-gate CI and a metric-bearing changelog is live; the `v*` namespace is clean and dormant release tooling is activated and tested; and install integrity is fail-closed with trap-based rollback.
**Effort:** M

### M-06: Docs generation and drift elimination

**Features:** F-18, F-19
**Depends on:** M-01, M-03
**Acceptance:** Enumerable docs metadata is generated with a CI drift-fail check (closing the hook-count and undocumented-command drift), and the hand-authored TOON-convention and schema drift fixes are applied.
**Effort:** S

### M-07: Eval tier ladder

**Features:** F-20, F-21
**Depends on:** M-01, M-04
**Acceptance:** The free T1 (static) and T2 (hermetic) eval tiers run in PR and nightly respectively, and the opt-in T3 LLM-judge tier runs behind `LOOM_EVAL_LLM` with a `main` floor, never merge-blocking.
**Effort:** M

### M-08: Skill upgrades beyond upstream

**Features:** F-22, F-23, F-24
**Depends on:** M-01, M-04
**Acceptance:** The shared skill preamble protocol exists, and every gstack-derived skill references it, gains behavioral tests, wires its claimed enforcement, and records at least one beyond-upstream capability in the skill-upgrade matrix.
**Effort:** L

### M-09: Final scorecard and measured release

**Features:** F-25, F-26
**Depends on:** M-02, M-04, M-05, M-06, M-07, M-08
**Acceptance:** The 4-agent comparative review is re-run and every dimension meets or beats gstack with overall > 8.3, and the final measured changelog and metrics snapshot record repo-derived values for all seven success metrics.
**Effort:** M

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Load-sensitive flaky suite (~39 spurious failures) resists deflaking, blocking F-14 | high | Isolate shared mutable fixtures incrementally; keep the full suite nightly (C-01) so PR feedback stays green while deflaking proceeds; gate `fileParallelism` removal behind repeated green runs |
| Scorecard subjectivity — the 4-agent re-run may score dimensions inconsistently vs the baseline | high | Reuse the exact baseline rubric and agents; anchor each dimension to repo-derivable evidence (C-09) so scores are defensible, not vibes |
| Scope creep on skill upgrades — C-13 lists ~15 skills, each with four requirements | high | Batch into F-23/F-24 with an explicit `SkillUpgradeMatrix`; the beyond-upstream capability must be named per skill, and P2 batch (F-24) can slip without blocking the scorecard |
| Single-maintainer bandwidth across 9 milestones | medium | Foundation-first sequencing (C-10) front-loads leverage; milestones are independently shippable so partial progress still improves dimensions |
| Dedup migration (F-08) introduces regressions in primitives used everywhere | medium | Land the shared lib (F-02) with property/round-trip tests first; strangler-migrate callers behind the `no-restricted-import` lint; rely on the M-04 test gate |
| Release-tooling activation (F-16) mishandles the 17 `plan-exec-*` tags | medium | Move tags to `refs/exec/*` rather than hard-delete where possible; dry-run the release workflow before enabling on `main` |

## Out of Scope

- Telemetry collection of any kind (C-12 requires all metrics to be repo-derivable — no phone-home, no usage analytics)
- npm publishing / distribution as an npm package
- Multi-host generation in gstack's style (generating host-specific variants beyond the existing plugin + direct-symlink paths)
- Full browser-daemon parity with gstack's persistent Chromium stack (the F-33 browser daemon from gstack-adoption is not re-scoped here)
- Adopting new test, eval, or release frameworks beyond the locked toolchain (C-12)
- Rewriting hand-authored narrative documentation prose (only enumerable metadata is generated, per C-05)
- Verbatim forking of gstack code (the exceed goal is native re-authoring, consistent with the prior initiative's adopt-don't-fork stance)

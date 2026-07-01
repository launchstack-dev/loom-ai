## 2026-06-13 -- Wave 4 executed (convergence-generalization, --auto) — M-02 closed contract-level

- **Wave 4:** Phase 9 → Phase 10 serial-pair. Phase 10 deps Phase 9 because Step 5 cites the harness path Phase 9 creates.
- **Phase 9 (implementer-agent, opus) — plan-review harness:** 5 new files + 1 modified, ~2720 lines, 49 new tests.
  - `scripts/lib/aggregate-findings.ts` (443 lines): PURE aggregator applying severityToConvergenceSeverity verbatim from findings.schema.md (critical|high → blocking, medium → warning, low|info|advisory → info); preserves W-03 reviewerAgent per row; ID sequence stable across reviewers; FindingsInvariantViolation thrown on count mismatch; no Date.now, no fs, deterministic under injected now().
  - `hooks/lib/spawn-agent.ts` (171 lines): spawn-request contract module — writeSpawnRequest writes spawn-request.toon atomically; documents the bridge from standalone Bun script to Claude Code Agent tool (driver fulfills request and re-invokes harness). Module does NOT invoke any LLM API.
  - `scripts/plan-review-harness.ts` (698 lines): entry-point CLI `bun run scripts/plan-review-harness.ts --config <path> --iteration <N> [--results-dir <path>]`. ONE-PHASE-VIA-INJECTION dispatch: with --results-dir + 6 envelopes → aggregate directly; else write spawn-request and exit 0 with stderr instruction. Partial-failure UX (AC 9): stderr warning, exit 0, failures aggregated from remaining reviewers (NOT propagated). Normalizes envelope.agent to schema-side `-reviewer-agent` form so actual agent .md files don't need renaming.
  - Tests (711 + 695 lines, 27 + 22 = 49): aggregator unit tests (each of 6 severity enum values, ID stability, dimension derivation, invariant throws, W-03 attribution preserved) + harness integration tests (both dispatch modes, atomic-write .tmp cleanup, CLI arg parsing).
  - `hooks/tsconfig.json` extended `include` array with `scripts/lib/**/*` + `scripts/plan-review-harness.ts` (single-tsconfig verification surface).
  - 11/11 ACs met.
- **Phase 10 (implementer-agent, opus) — --autoconverge wrap:** `commands/loom-plan/create.md` +123 lines (452 → 575). Pre-edit grep gate (`grep -q "Step 1.7" commands/loom-plan/create.md`) passed before edit per Phase 7's structural gate contract.
  - Arguments adds `--autoconverge`, `--max-iterations N` (1-10 bound), `--dry-run`.
  - New `#### Step 5: Autoconverge Loop (--autoconverge only)` inserted BETWEEN Step 4 (initial write) and Step 4.5 (wiki update) — so autoconverge runs after initial PLAN.md write but before wiki capture, allowing the wiki to capture both initial + converged plan.
  - Skip clause (no-op without --autoconverge); --dry-run preview (emit config TOON to stdout, exit 0, driver NOT invoked); converge.config generation with locked defaults table (9 fields: mode=document, integrator=plan-builder-agent, harness=scripts/plan-review-harness.ts, maxIterations=3 per C-05, scopeGuardEnabled=true per C-06, snapshotEnabled=true per C-07, snapshotDir=planning/history/snapshots/, agentBudget=30, outputPath default); --max-iterations N override (ONLY maxIterations); invokes `/loom-converge --resume-config <path>`; --auto pass-through (C-08 SCOPE_EXPANSION exits 1 + stderr JSON, no prompt — Q-01 end-to-end non-interactive); --no-auto-commit pass-through (iteration commits off, snapshots STILL write per C-07 independent of git); halt handling with locked C-10 cause/recovery cross-ref; flag interactions matrix (7 rows including `--review-integrate` Q-02 supported combo); link-extraction readiness C-11 with 7-row disk-output manifest (PLAN-{slug}.md + convergence-summary.toon + criteria-plan-{slug}.toon + snapshots/{slug}-pass-{N}.{ext} + iter-{N}.toon + critique.toon + findings.toon) sufficient for fresh-context link-decision WITHOUT pipeline-state.toon mutation.
  - 10/10 ACs met.
- **Verification (orchestrator re-run post-commit on feature branch):** `bunx tsc --noEmit -p hooks/tsconfig.json` exit 0; `bun test test/protocol/` → 455 pass / 0 fail / 1114 expect calls (+49 tests +164 expects from W3 baseline of 406/950); `bun test hooks/` → 134/0 (no regression from Phase 9's tsconfig edit); ownership drift clean (7 declared files); grep counts: Step 5=12, --autoconverge=23, --max-iterations=4, --dry-run=6, C-11=6. Reconciliation: 0 cross-boundary requests, 0 ownership violations, 0 conflicting exports, 0 contract amendments.
- **Wiring pass: skipped** — harness is a standalone executable script; aggregator + spawn-agent are imported only by the harness; no barrel/route/index files. Vitest auto-discovers new test files via test/protocol/ path. Same explicit no-op pattern as Waves 1-3.
- **Stage context:** `.plan-execution/stage-context/execute.toon` rewritten for Wave 4 with 6 keyDecisions + 6 nextStageHints for Wave 5.
- **Auto-commit:** `18c28e2` on `convergence-generalization` branch (PR #18). 8 files changed (5 new + 2 modified + 1 summary persistence), +730 net lines in the functional commit. Tag `plan-exec-convergence-generalization-wave-4-post` set.
- **Persistence:** `planning/history/executions/wave-4-summary-convergence-generalization.toon`.
- **Automated Quality Gate decision: PROCEED.**
- **M-02 CLOSED CONTRACT-LEVEL.** F-02 (critic + wiring, W3) + F-03 (plan-review harness + --autoconverge wrap, W4) both shipped. W5 Phase 14 e2e fixture is the M-02 close gate.
- **Contract reconciliation flagged for W5 Phase 12 (NON-blocking):** Phase 10 cited `/loom-converge --resume-config <path>` per plan AC verbatim; existing `commands/loom-converge.md` uses `--config`. Phase 12 (wiring) reconciles by either adding `--resume-config` alias OR aligning Step 5 wording to `--config`. Contract-only — no functional change to wrapper behavior.
- **Token cost (this wave):** ~209k spawned-agent tokens (Phase 9 130k heaviest single agent so far + Phase 10 79k). Cumulative across run: ~1.008M (W0 186k + W1 290k + W2 146k + W3 177k + W4 209k).
- **Halt reason: context-pressure-at-wave-boundary** (Step 9.1). Wave 5 is the FINAL wave (Phases 12 + 13 parallel → Phase 14 serial) estimated 200-300k tokens. `/clear` + `/loom-plan execute --resume --auto` for fresh window.
- **Next:** Wave 5 = W5a parallel (Phase 12 wiring library.yaml + loom-reference.md + loom-plan.md + execution-conventions.md; Phase 13 M-01 e2e fixture test/e2e/convergence/document-mode.test.ts + fixture files — disjoint) → W5b serial (Phase 14 M-02 e2e fixture test/e2e/convergence/autoconverge.test.ts against fixture roadmap at test/e2e/convergence/fixtures/autoconverge/ROADMAP.md). Plan complete when W5 lands.

## 2026-06-13 -- Wave 3 executed (convergence-generalization, --auto) — F-02 shipped

- **Wave 3:** W3a parallel (Phase 6 + Phase 8 — disjoint files, no inter-dep) → W3b serial (Phase 7 after Phase 6). First true parallel spawn in this run.
- **Phase 6 (implementer-agent, opus):** created `agents/plan-critic-agent.md` (147 lines, frontmatter `model: haiku`, advisory-only, locked 6-dim enum, severity enum `{blocking, warning, info}` — no `advisory`, hard ceilings 30 findings/200 chars, project-relative agent paths under `agents/`) and `agents/plan-critic-checklist.md` (45 lines, exactly 30 numbered concerns at 5 per dimension). 6/6 ACs met.
- **Phase 8 (implementer-agent, opus):** extended `agents/plan-builder-agent.md` (290 → 350) with new `## Integrator Mode` section before Validation Correction Mode. Input Contract 4-row disambiguation matrix (roadmap-only / findings+subject / both / neither → AMBIGUOUS); Output Contract (complete document not diff, atomic write); Scope-Expansion Caveat with verbatim cross-ref to `agents/convergence-driver.md § Document Mode Safeguards § Scope-Expansion Guard`; Error Handling (INTEGRATOR_MODE_AMBIGUOUS, FINDINGS_SCHEMA_INVALID, SUBJECT_UNREADABLE). 6/6 ACs met.
- **Phase 7 (implementer-agent, opus, serial after Phase 6):** rewrote `commands/loom-plan/create.md` (353 → 452). Arguments adds `--skip-critic`. Step 1 renamed Triple-Track with stale critique cleanup (`rm -f .plan-execution/critique.toon`) at top. Three spawns documented — plan-builder + criteria-planner in parallel; on plan-builder completion, plan-critic spawns sequentially with `model: "haiku"` + context-budget preflight. New `#### Step 1.7: Critic Revise Pass` inserted between Step 1.5 and Step 2 (matches existing Step 1.5 / Step 4.5 / Step R interstitial pattern): skip conditions cover `--skip-critic` AND `--review-integrate` (Q-02 citation: review-integrate is the formal integrator path consuming findings.toon from a completed review); short-circuit on `predictedBlockingCount==0`; otherwise re-spawn plan-builder-agent in Integrator Mode (Phase 8 deliverable) with critique injected; stdout echo of critique.toon path + counts; 6-row critique.toon-vs-findings.toon comparison table (Producer / Schema / Path / Lifecycle / Severity / ID-prefix); flag combination matrix; Phase 10 structural grep gate `grep -q "Step 1.7" commands/loom-plan/create.md` (structural rather than commit-hash-based so it survives squash/rebase/merge). 11/11 ACs met.
- **Verification (orchestrator re-run post-commit on feature branch):** `bunx tsc --noEmit -p hooks/tsconfig.json` exit 0; `bun test test/protocol/` → 406 pass / 0 fail / 950 expect calls (baseline preserved; W3 is markdown-only — no new tests); `grep -c "Step 1.7" commands/loom-plan/create.md` → 12; `grep -c -- "--skip-critic" commands/loom-plan/create.md` → 9; ownership drift clean (only the 4 declared files modified). Reconciliation: 0 cross-boundary requests, 0 ownership violations, 0 conflicting exports, 0 contract amendments.
- **Wiring pass: skipped** — same explicit no-op pattern as Waves 1-2. All Wave 3 files are markdown agent/command definitions; no static-import barrels/routes/index files.
- **Stage context:** `.plan-execution/stage-context/execute.toon` rewritten for Wave 3 with 5 keyDecisions + 5 nextStageHints for Wave 4.
- **Auto-commit:** `3d44e52` on `convergence-generalization` branch (PR #18). 5 files changed, +430/-3 lines. Tag `plan-exec-convergence-generalization-wave-3-post` set.
- **Persistence:** `planning/history/executions/wave-3-summary-convergence-generalization.toon` (suffixed convention).
- **Automated Quality Gate decision: PROCEED.**
- **F-02 SHIPPED** — critic agent + critic wiring complete. M-02 progress: F-03 (plan-review harness + --autoconverge) is W4.
- **Token cost (this wave):** ~177k spawned-agent tokens (Phase 6 64k + Phase 8 50k + Phase 7 63k). Cumulative across run: ~799k (W0 186k + W1 290k + W2 146k + W3 177k).
- **Halt reason: context-pressure-at-wave-boundary** (Step 9.1 always-checkpoint rule). Wave 4 estimated 200-300k tokens (Phase 9 is the heaviest single agent so far: TS harness + aggregator + tests). `/clear` + `/loom-plan execute --resume --auto` for fresh window.
- **Next:** Wave 4 = Phase 9 (plan-review harness: `scripts/plan-review-harness.ts` + `scripts/lib/aggregate-findings.ts` + tests) → Phase 10 (wrap `/loom-plan create` with `--autoconverge`). Phase 10 uses the Step 1.7 anchor that Phase 7 landed here. **M-02 closes contract-level at end of W4.**

## 2026-06-13 -- Wave 2 executed (convergence-generalization, --auto) — M-01 logically closed

- **Wave 2:** Phase 5 → Phase 11 serial-pair. Disjoint files; Phase 11 deps Phase 5 only by contract (driver doc cites the helper Phase 11 implements).
- **Phase 5 (implementer-agent, opus):** `agents/convergence-driver.md` +93 lines (921 → 1014). New H2 `## Document Mode Safeguards` between Circuit Breakers and State Tracking, documenting:
  - Scope-Expansion Guard (C-06): three line-anchored regexes (`^### Phase \d+`, `^### F-\d+`, `^### M-\d+`); fires between Convergence Loop step 7 and step 8; halts with `haltReason: SCOPE_EXPANSION`.
  - Interactive vs `--auto` divergence (C-08): interactive records prompt + exit 0; `--auto` exits code 1 with stderr JSON.
  - Auto-Snapshot Writer (C-07): write before every integrator spawn for `iteration >= 2`; sole writer is `hooks/lib/iteration-snapshot.ts::writeIterationSnapshot`; `SNAPSHOT_WRITE_FAILED` is warn-and-continue (snapshotRef: null on iter row, loop NOT halted).
  - 7/7 driver-doc ACs met.
- **Phase 11 (implementer-agent, opus):** new `hooks/lib/iteration-snapshot.ts` (321 lines) + extended `test/protocol/checksums.test.ts` (+241 lines, 8 → 14 tests). Exports: `writeIterationSnapshot` (async), `deriveSlug`, `SnapshotWriteFailed`, two types. Wired locked decisions:
  - W-01 ms-precision ISO 8601 via `now().toISOString()`.
  - W-02 slug derivation (basename minus FINAL dot only; multi-dot + extension-less cases tested).
  - C-07 collision guard via `existsSync` (throws `SNAPSHOT_WRITE_FAILED: snapshot already exists` rather than silently overwriting the keep-all-forever invariant).
  - sha256 via `node:crypto` with `sha256:` prefix matching `hooks/lib/checksum.ts` convention.
  - Atomic write order: copy `{path}.{ext}.tmp` → rename, then metadata `{path}.toon.tmp` → rename, then sha256 verify.
  - Single try/catch retry with 1s backoff; test seam via `_writeFileImpl` + `sleep` injection options.
  - 6 new tests: happy-path, multi-dot filename, extension-less subject, source-missing short-circuit, EIO-retry-success, keep-all-forever retention. 6/6 ACs met.
- **Verification (orchestrator re-run on main post-commit):** `bunx tsc --noEmit -p hooks/tsconfig.json` exit 0; `bun test test/protocol/` → 406 pass / 0 fail / 950 expect calls (+6 from W2); lint skip (not configured); ownership drift clean (only the 3 declared files modified). Reconciliation: 0 cross-boundary requests, 0 ownership violations, 0 conflicting exports (Phase 5 doc-only; Phase 11 exports 5 symbols in a new module), 0 contract amendments.
- **Wiring pass: skipped** — same explicit no-op pattern as Wave 1. iteration-snapshot.ts is a new isolated helper imported at runtime by the convergence-driver agent prompt; no static-import barrel/route/index wiring needed. Vitest auto-discovers the extended checksums.test.ts.
- **Stage context:** `.plan-execution/stage-context/execute.toon` written atomically with 6 keyDecisions + 5 nextStageHints for Wave 3+.
- **Auto-commit:** `2036a6c` — 4 files changed, +729/-0 lines. Tag `plan-exec-convergence-generalization-wave-2-post` set.
- **Persistence:** `planning/history/executions/wave-2-summary-convergence-generalization.toon` (suffixed to avoid colliding with the prior kit-native-skills run's `wave-2-summary.toon` — same naming convention used for Wave 1's persistence).
- **Automated Quality Gate decision: PROCEED.**
- **M-01 LOGICALLY CLOSED at end of W2.** F-01 driver document mode + snapshot helper now both shipped. Phase 13 (W5) e2e fixture provides end-to-end verification.
- **Token cost (this wave):** ~146k spawned-agent tokens (Phase 5 78k + Phase 11 67k). Cumulative across run: ~622k (W0 186k + W1 290k + W2 146k).
- **Halt reason: context-pressure-at-wave-boundary** (Step 9.1 always-checkpoint rule). Wave 3 has 3 phases (W3a Phase 6 + Phase 8 parallel, W3b Phase 7 serial) estimated 250-350k tokens — `/clear` + `/loom-plan execute --resume --auto` for fresh window.
- **Next:** Wave 3 = W3a parallel (Phase 6 — plan-critic-agent + checklist; Phase 8 — plan-builder integrator-mode entry point; disjoint files) → W3b serial (Phase 7 — wire critic into commands/loom-plan/create.md as third parallel track + Step 1.7 revise pass + --skip-critic flag).

## 2026-06-13 -- Wave 1 recovery + drift-prevention postmortem (convergence-generalization)

- **Symptom:** `/loom-plan execute --resume --auto` preflight halted before Wave 2. State.toon claimed Wave 1 = success, but on-disk file shapes (`agents/convergence-driver.md` at 520 lines, `test/protocol/stage-context.test.ts` at 399 lines) did not match the wave-1-summary expectations (921 + 1077 lines). Tag `plan-exec-convergence-generalization-wave-1-post` pointed at commit `4d1f2f2`, which was NOT reachable from `main` HEAD.
- **Root cause:** Wave 1 auto-commit `4d1f2f2` was made on local `pr-16-followups` branch AFTER `origin/pr-16-followups` head `ab63d66` had been pushed. PR #17 merged the remote head (without the Wave 1 commit) into main; post-merge cleanup left `4d1f2f2` as a dangling commit reachable only via the tag.
- **Recovery:** `git cherry-pick 4d1f2f2` onto main → commit `4787bbf` (`recover(wave-1): cherry-pick 4d1f2f2`). Re-verification on main post-cherry-pick: `tsc --noEmit -p hooks/tsconfig.json` exit 0 + `bun test test/protocol/` → 400 pass / 0 fail / 910 expect calls. All 23/23 Wave 1 acceptance criteria remain met.
- **Why drift detection missed it:**
  - `state.schema.md` Rule 4 ("Compare current file hashes against `fileHashes`") is correct in spec but `fileHashes` was empty in state.toon. `execute.md` provides no template for populating it in Step 3/Step 8/Step 9, so it never gets written.
  - Even when populated, hash-only comparison can miss the actual failure mode here: "the commit producing those file contents is not reachable from HEAD." That requires a `git merge-base --is-ancestor {lastWaveCommit} HEAD` check, which the protocol does not specify.
- **Postmortem written:** `planning/notes/2026-06-13-orphaned-wave-1-postmortem.md` — four gaps identified, four surgical fixes proposed (~85 lines of edits across two protocol files). Fixes NOT applied this session to avoid destabilizing the mid-flight `--resume` chain. Suggested next action: file a small `execution-drift-hardening` plan after M-02 closes.
- **Next:** Wave 2 (Phase 5 → Phase 11 serial) resumes from `main` HEAD = `4787bbf`. Checkpoint refreshed; resume command unchanged.

## 2026-06-13 -- Wave 0 executed (convergence-generalization, --auto)

- Run ID: `convergence-generalization-20260613-001`
- Mode: `--auto` (Automated Quality Gate replacing human approval gates; context-pressure-halt at wave boundaries per Step 9.1)
- Rollback tag: `plan-exec-convergence-generalization-start`
- Prior state archived: `.plan-execution/state-kit-native-skills-final.toon.bak` + `.plan-execution/backups/kit-native-skills-archive/` (M-02/M-03 closed earlier today, state.toon now free)
- **Phase 0 (contracts-agent, opus):** 7 schema deliverables landed in one spawn
  - **Created (4):** `findings.schema.md` (ConvergenceFindings + severityMapping table + reviewerAgent attribution), `plan-critique.schema.md` (locked 6-dim enum), `iteration-snapshot.schema.md` (W-02 slug rule + sha256), `convergence-summary.schema.md` (C-11 link-compat keystone with 6-value status enum)
  - **Modified (3):** `convergence-tier.schema.md` (ConvergeConfig adds document mode + subject/integrator/harness fields), `stage-context.schema.md` (ConvergenceIterationSummary mode-uniform shape + subject/snapshotRef/haltReason/tokensUsed optional fields), `schema-versions.toon` (registry 19 → 23)
  - **Manifest:** `.plan-execution/contracts/manifest.toon` lists all 7 deliverables with locked-decisions cross-reference table
  - **Locked decisions wired:** C-08, C-09, C-10, C-11, W-01, W-02, W-03, CC-03 — all reflected in schema bodies with cross-refs documented
- **Wave 0 → Wave 1 verification gate:** `tsc --noEmit -p hooks/tsconfig.json` exit 0 + `bun test test/protocol/schema-validation.test.ts` 17/17 (31 assertions) exit 0 + file ownership clean. Lint not configured (skipped, acceptable for schema-only wave). Recorded in `wave-0-summary.toon`.
- **Stage context:** `.plan-execution/stage-context/contracts.toon` written atomically with 5 keyDecisions + 4 nextStageHints for Phase 1+.
- **Auto-commit:** `c9223e3` — 8 files changed, +977/-24 lines
- **Automated Quality Gate decision: PROCEED** (verification.status=pass, zero blocking issues, zero ownership violations, zero gate halts)
- **Halt reason: context-pressure** — conversation context at high pressure after ~186k spawned-agent tokens this turn (contracts 152k + verification 34k) plus substantial prior session history. Per Step 9.1's "Always checkpoint" rule, halting cleanly for `/clear` + `/loom-plan execute --resume --auto` to continue Wave 1 in a fresh context window. `--auto` mode is preserved through resume.
- **Token cost (this wave):** ~186k spawned-agent tokens. Wave 1 estimate: ~250-350k for 4 serial implementers on `agents/convergence-driver.md`.
- **Next:** Wave 1 = Phase 1 → 2 → 3 → 4 serial chain (all touching `agents/convergence-driver.md` in disjoint sections; deps enforce ordering)

## 2026-06-13 -- Trampoline-link compat additions (convergence-generalization)

- Triggered by handoff from parallel session refactoring `/loom-auto` into trampoline + dispatched-links architecture (commits 3872228, 1e1b31a). Three links shipped (verify/fix/execute); two queued (Phase 4 converge-link, Phase 5 planning-link).
- Plan: planning/plans/PLAN-convergence-generalization.md (1370 → 1411 lines, +41 net)
- Five additive edits + one new plan-local constraint, all non-structural:
  - **New schema entry: ConvergenceSummary** (`.plan-execution/convergence-summary.toon`) — 11 fields including `status` enum (`converged` | `halted-stall` | `halted-regression` | `halted-budget` | `halted-max-iter` | `halted-scope-expansion`), `subject` (document mode), `harnessName`, `integratorName`, `finalBlockingCount`, `iterationsRun`. Authoritative "did we converge" signal read by verify-link today and future converge-link.
  - **Phase 0 expanded:** adds `protocols/convergence-summary.schema.md` to file ownership + deliverable row; new AC asserting the 11-field schema; schema-versions.toon registers 4 schemas (was 3).
  - **Phase 2 AC added:** driver writes convergence-summary.toon atomically at terminal-state transition; new Convergence Target verifying status field matches actual outcome.
  - **Phase 10 AC added:** wrapper outputs must be sufficient for fresh-context agent to derive link-result.toon envelope without orchestrator state; new Convergence Target verifying all wrapper outputs land on disk before return.
  - **Phase 14 AC added:** fixture verifies link-extraction readiness — convergence-summary.toon has all 11 fields, status matches outcome, subject points to real file, iterationsRun matches iter-{N}.toon count. Test asserts input completeness without constructing the envelope.
  - **New constraint C-11:** Future loom-auto link compatibility — all autoconverge outputs reconstructable from disk; convergence-summary.toon.status is source of truth; no pipeline-state.toon mutation for convergence internals; no AgentResult returns to caller; no new currentStage values mid-convergence; no inline orchestrator mutation of PLAN.md from conversational state.
- 11 cross-references to C-11 throughout the plan body for traceability.
- **Why additive (not restructuring):** The plan already had the right philosophy (state on disk, agents self-contained, no orchestrator-side mutation). The trampoline architecture shares this philosophy. The additions just make the existing disk-driven design explicit enough for future link extraction with zero translation.
- **Not done:** did NOT pre-emptively refactor `--autoconverge` into its own loom-auto link (that's the planning-link's responsibility, owned by parallel session). Did NOT add link-result.toon emission to Phase 10 (planning-link reads disk and constructs its envelope, not the wrapper's job).
- Status: reviewed; ready for execute now that state.toon is free (kit-native-skills M-02/M-03 closed earlier today).

## 2026-06-13 -- M-02 formally closed (kit-native-skills)

- M-02 auto gate had passed on 2026-06-12T23:32Z (commit `159ea39`). The remaining qa-review-tier item was the live skill-activation smoke test in a fresh Claude Code session.
- Smoke test completed 2026-06-13T10:30Z. Verdict: **PASS**.
  - Skill installed at `~/.claude/skills/python-conventions/SKILL.md` via canonical `/loom-library use python-conventions` flow (real file copy, sha256 recorded in `install-state.toon` items[] with `component: loom-core`).
  - Fresh session manifest lists `python-conventions: Python ecosystem conventions for new code — Polars over Pandas, uv/ruff/pytest tooling, atomic file writes, type hints on public functions, TOON format for Loom artifacts.`
  - py-trigger fires: unprompted recommendation of Polars + uv + ruff + pytest on `/tmp/python-conventions-smoke/scratch.py`.
  - ts-trigger suppressed: no python-conventions advice on `/tmp/python-conventions-smoke/scratch.ts` (only TS-native conventions recommended).
- Caveats recorded in `.plan-execution/stage-context/phase-7.toon manualSmokeTestResult`:
  - Description visibility in the manifest doesn't fully isolate trigger-glob match vs description-based activation. Either path is a PASS for M-02 scope; stronger isolation is a future kit-author-experience test.
  - Global `~/.claude/CLAUDE.md` independently mandates Polars for new Python code. The cleaner signal is the negative case (ts-trigger suppression).
- Side finding (non-blocking, info-level for a future review pass): `commands/loom-library.md` Step 5 documents the API surface (validateInstallPath, buildSkillTargetPath, buildSkillInstallRecord) but leaves the execution layer (Bash `mkdir -p` + `cp` + `shasum` + install-state row append) implicit. The implicit execution path was walked manually this run; the markdown should codify it.
- One-timer fix during the smoke-test gap: removed a one-off `ln -s` symlink that had been used as a quick install hack, replaced with the canonical real-file copy + install-state.toon registration.

**Both M-02 and M-03 are now CLOSED for `planning/plans/PLAN-kit-native-skills.md`. OSS launch is fully unblocked.**

---

## 2026-06-13 -- Code fixes applied (kit-native-skills review)

- Source: `.plan-execution/review-report.md` → archived to `planning/history/reviews/2026-06-13-review.md`
- 6-reviewer parallel review on the kit-native-skills M-03 wave commits (35 files, +5,131/−360 lines across b8f7bfd / b6e27f3 / eef7dbf / 159ea39 / 8072c41 / 2d20858 / 69c3386 plus 2 loom-auto refactor commits).
- Findings: 4 critical / 12 warning / 8 info (24 total after dedup across reviewers)
- Applied: 16 findings (4 critical + 12 warning); 0 unfixable
- Commits:
  - `a80bf19` fix(phase-0): commit untracked Phase 0 deliverables + Phase 0b README section (3 critical git-ops findings — branch was unmergeable without these)
  - `cb02113` fix(review): apply 13 findings from kit-native-skills review (code/test fixes)
- Verification: tsc exit 0 • bun test 0 failures • validate-library-catalog.js exit 0 with 0 warnings (105 entries correctly counted post-fix)
- Headline fixes: ALLOWED_INSTALL_PREFIXES now includes `~/.claude/commands/`; YAML description escaping (CWE-116); BARE_NAME_PRIORITY now includes infrastructure; REPO_ROOT clamp on validator source paths (CWE-22); validator totalEntries counter now includes protocols + infrastructure (was undercounting by 37+ entries); single source of truth for slug validation between commands/loom-library.md and wizard-interview.ts; field-level validation in v3→v4 migrator before unsafe cast.
- Test coverage adds: NEW `test/validate-library-catalog.test.ts` (fixture-driven); BARE_NAME_PRIORITY infrastructure test; ask-kit-registration y-path + finalize idempotency tests; partial-v4 detection branch test.
- Info-level findings (8) left in `.plan-execution/review-report.md` for opportunistic cleanup. Run `/loom-code fix --severity info` to apply.

---

## 2026-06-12 -- Pass-2 inline edits (convergence-generalization)
- Pass-2 review: planning/history/reviews/2026-06-12-convergence-generalization-review-2.toon (15 findings: 2 blocking, 8 warning, 5 info — 78% blocking reduction from pass-1's 9 blocking)
- Path chosen: inline edits (no third plan-builder spawn) per user decision
- Applied: 2 blocking + 3 highest-impact warnings = 5 fixes
  - **B-NEW-01:** Phase 14 spawn-count ceiling 16 → 15 (critic runs once per Q-02, not per iteration; formula `1 + maxIterations × 8` documented inline); M-02 acceptance also updated
  - **B-NEW-02:** Removed Phase 13 from M-01 Phases list (was circular — Phase 13 depends on M-01 complete); added "Verification fixture" annotation explaining the W5 retroactive validation
  - **W-NEW-02:** Added `CRITIQUE_TOO_LARGE` and `INTEGRATOR_MODE_AMBIGUOUS` rows to C-10 halt-message table (was claiming "any haltReason" coverage)
  - **W-NEW-03:** Added `tokensUsed` field to `ConvergenceIterationSummary` schema (optional cumulative observability metric); Phase 14 AC now has typed schema owner
  - **W-NEW-04:** Updated roadmap success-metric line 31 to match plan reality — spawn-count accounting instead of token accounting (documentation debt closed)
- Deferred (5 warnings + 5 info) to execution-time discovery per user decision:
  - W-NEW-01 (C-08 vitest stderr capture mechanism) — Phase 14 implementer choice
  - W-NEW-05 (halt messages don't echo unresolved value) — Phase 1 implementer choice
  - W-NEW-06 (CRITIQUE_TOO_LARGE truncation visibility) — partially addressed by W-NEW-02 row
  - W-NEW-07 (changelog trajectory format only in fixture AC) — Phase 14 implementer choice
  - W-NEW-08 (aggregate-findings.test.ts severity mapping unit test) — Phase 9 implementer choice
  - All 5 info findings (Phase 5 scenario reordering, C-09 cross-mode UX, etc.) — cosmetic/observational
- Plan file: planning/plans/PLAN-convergence-generalization.md (~1370 lines, +10 from pass-2 integrate net)
- Roadmap file: planning/ROADMAP-convergence-generalization.md (1 line edit at success metric)
- Trajectory: pass-0 blocking=9, pass-2 blocking=2, post-pass-2 inline-edit blocking=0. **Plan converged.** Pass-3 review (if run) expected fully clean.
- Status: reviewed; ready for /loom-plan execute --dry-run
- Note: every applied edit carries `<!-- Applied: B-NEW-NN (pass-2) -->` or `<!-- Applied: W-NEW-NN (pass-2) -->` annotation for full audit trail

## 2026-06-12 -- Plan review-integrated pass 1 (convergence-generalization)
- Generated via /loom-plan create --review-integrate --name convergence-generalization
- Source review: planning/history/reviews/2026-06-12-convergence-generalization-review.toon (60 findings: 9 blocking, 31 warning, 20 info from 6 specialized reviewers)
- Pre-integration snapshot: planning/history/snapshots/2026-06-12-convergence-generalization-pass-1.md (1202 lines, captured before plan-builder edit)
- Applied: 41 of 60 findings (9/9 blocking, 22/31 warning, 8/20 info — mechanical only); 19 skipped with rationale
- Plan file: planning/plans/PLAN-convergence-generalization.md (1360 lines, +158 from pass-1)
- Status: draft → reviewed; lastReviewed: 2026-06-12; planVersion 2 retained
- **Load-bearing fixes applied:**
  - CC-01 (PF-01): Phase 11 promoted W4 → W2 (serial after Phase 5). Phase 5 M-01 gate now testable in-wave. Downstream deps (Phase 13/14) still valid.
  - CC-02 (PF-02): library.yaml removed from Phase 10 ACs; Phase 12 is sole owner (no more double-write).
  - PF-04 (B-06): New constraint **C-08** locked — under --auto, SCOPE_EXPANSION exits 1 with stderr-only halt (no prompt). Preserves --auto non-interactivity promise. Phase 5 S-04 scenario added.
  - PF-05 (B-04/B-05): New constraints **C-09** (stdout progress format: `[autoconverge] iteration N/max — blockingCount: prev → curr (X fixed, Y new)`) + **C-10** (per-breaker halt-message-and-recovery table). Wired into Phases 2, 4, 10 ACs.
  - PF-08 (B-03): Phase 14 token-cost AC replaced with spawn-count ceiling (≤16 spawns/run) + non-blocking `tokensUsed` observability field on convergence-state.toon.
  - PF-03 (B-01): Phase 0 contracts now explicitly list `harness` + `outputPath` schema field deliverables (ConvergeConfig table complete).
  - PF-07 (B-02): /loom-converge flag table gains `--resume`, `--resume-config`, `--output-dir`.
- **Structural changes:**
  - Phase 11: W4 → W2 (joins Phase 5 in M-01 driver layer)
  - Wave 3 sub-labels: W3a (Phases 6+8 parallel) → W3b (Phase 7 after Phase 6)
  - Phase 8 dep contradiction removed (now deps M-01 only, not Phase 6 "parallel")
  - Phase 9 dep on Phase 2 removed (reversed causality)
  - Phase 12 dep expanded to include Phase 9
  - M-01 milestone phases: now includes 11 + 13 (was 5)
  - M-02 milestone phases: removed Phase 11 (now in M-01)
  - totalPhases 15 + totalWaves 5 unchanged
- **New AC additions per phase:** Phase 0 +5, Phase 1 +1, Phase 2 +3, Phase 4 +1, Phase 5 +5+S-04 scenario, Phase 7 +5, Phase 9 +3, Phase 10 +3 -1, Phase 14 +2 + AC rewrite
- **New section: ## Plan-Local Constraints** (C-08/C-09/C-10 + scope-expansion-regex from I-12 + slug-multi-dot rule from W-02)
- **Open questions surfaced for orchestrator (NOT applied due to scope-expansion guard C-06):**
  - W-12 (Snapshot rollback UX): Reviewer suggested /loom-plan snapshots list/diff/restore commands. Roadmap Q-03 defers this. Treating as scope expansion. **User decides whether to action in pass-2 or defer.**
  - W-30 (Phase 13 canned-harness invocation pattern): Could add module-vs-spawn prescription. Left to Phase 13 implementer's discretion. **User decides whether to action in pass-2 or defer.**
  - CG-012 (info, deferred from pass-0): ConvergeRun state-machine DRIVER_INVARIANT tests still uncovered; test-spec recommends 3 behavior tests in Phase 13 fixture. Plan-side not actioned.
- **Annotations:** Every applied change carries `<!-- Applied: PF-NN (origin-id) — ... -->` HTML comments for pass-2 review audit trail
- **Trajectory:** pass-1 review had 9 blocking, pass-2 review expected to have ≤3 (load-bearing CC-01/CC-02 fixed + mechanical warnings closed). Pass-3 (if needed) should be clean.

## 2026-06-12 -- Wave 0 executed (kit-native-skills, contracts-only)
- Run ID: kit-native-skills-20260612-001
- Mode: --contracts-only (halts after Wave 0 success)
- Rollback tag: plan-exec-kit-native-skills-start
- Prior state backed up: .plan-execution/state-daip-paused.toon.bak
- **Phase 0 (contracts-agent, opus):** 8 files created — hooks/lib/{skill-router,wizard-interview,library-add-heuristic}.ts (3 new TS modules, 31 exports), 3 contract artifacts (catalog-v4-exports, install-state-audit, manifest), 1 stage-context (phase-0.toon). library-catalog-migrator.ts extended with v4 interfaces + no-op MIGRATIONS["3->4"] passthrough + throwing migrateLibraryCatalogV3ToV4 stub. CURRENT_VERSION correctly remained at 3 (Phase 1 owns bump).
- **Install-state audit finding:** items[].type is OPEN STRING — no install-state schema bump needed when Phase 1 ships skill type
- **Phase 0b (implementer-agent, opus):** CLAUDE.md gained ## Extensibility Model section (line 81, ~25 lines) with five-resource-type table, kit abstraction, authoring wizards, ### Authoring Resources placeholder per N-02. README.md gained ## Extending Loom section (lines 49-73) with platform-vs-fixed-methodology positioning (word "extensible" added — count: 1), use-vs-author distinction, typed-includes authoring example. Older sections at ~line 460 and ~line 749 NOT removed (Phase 6 owns DRY-up; TODO comment left at README:43). Phase-0b stage-context written by orchestrator (cross-boundary request).
- **Wave 0 → Wave 1 gate:** bunx tsc --noEmit -p hooks/tsconfig.json exit 0. Recorded in wave-0-gate.toon. Gate type: typecheck-only (no bun test — Phase 0 stubs intentionally throw).
- **Status:** success-contracts-only-stopped. To resume: /loom-plan execute --plan planning/plans/PLAN-kit-native-skills.md --resume
- **Token cost (this wave):** ~225k output tokens across 2 agent spawns (contracts at 146k, docs at 78k)

## 2026-06-12 -- Test spec generated (convergence-generalization, criteria-only stop)
- Generated via /loom-plan test on planning/plans/PLAN-convergence-generalization.md
- acceptance-criteria-agent (sonnet) — single-step run, fan-out to unit-test-agent + e2e-test-agent skipped per user choice
- Test spec: .plan-execution/test-spec-convergence-generalization.toon (462 lines, 73KB)
- Totals: 94 specs (49 contract / 28 behavior / 17 e2e); 73 P0 / 16 P1 / 5 P2
- Gap closure: ALL 5 interpretation-reviewer high-severity error-code gaps closed — INTEGRATOR_NOT_FOUND (bt-1-01+ct-1-02), HARNESS_MISSING (bt-1-02+ct-1-03), FINDINGS_SCHEMA_INVALID (bt-2-02+ct-0-08+bt-0-01+ct-2-05), INTEGRATOR_MODE_AMBIGUOUS (bt-8-02+ct-8-04), MAX_ITERATIONS parity (bt-4-04+bt-4-05+e2e-13-06)
- Additional 9 secondary gaps surfaced + closed: SNAPSHOT_WRITE_FAILED retry, CRITIQUE_TOO_LARGE, sha256 integrity, triple-track parallel spawn, library.yaml catalog drift, --no-auto-commit semantics, snapshot keep-all retention, autoconverge ≤2-iter upper bound (IC-003), snapshot-as-rollback mechanism (IC-004)
- IC-001 resolved (critic checklist count): test-spec anchored to plan's Phase 6 AC-5 "exactly 30" via ct-6-04; criteria-plan "25-35 range" superseded
- Remaining gap (info, deferred): CG-012 — ConvergeRun state machine invalid-transition guards (DRIVER_INVARIANT errors); plan defines but no phase-level AC; agent recommends 3 behavior tests in Phase 13 fixture; not blocking
- Stop reason: user opted for criteria-only equivalent — implementer agents will read test-spec.toon and write tests alongside implementation during /loom-plan execute; defers ~75-120k token spend on writing 94 red-state test files

## 2026-06-12 -- Plan created from roadmap (convergence-generalization)
- Generated via /loom-plan create --name convergence-generalization
- Source: planning/ROADMAP-convergence-generalization.md (status: approved at draft time; 3 features, 2 milestones, 7 locked decisions, all 3 Open Questions resolved at approval)
- planVersion: 2 (spec-driven; Schema / Type Definitions, API Specification, State Machines, Error Handling sections all present)
- Phases: 15 (Phase 0 contracts + 14 implementation/wiring/acceptance phases), Waves: 5
- Wave map: W0 contracts (Phase 0); W1 driver mode detection + loop branch + resume + breaker parity (Phases 1-4); W2 scope-guard + auto-snapshot + M-01 gate (Phase 5); W3 critic agent + create.md wiring + integrator-mode entry (Phases 6-8); W4 plan-review harness + --autoconverge + snapshot helper (Phases 9-11); W5 wiring + M-01/M-02 acceptance fixtures (Phases 12-14)
- Dual-track generation: plan-builder-agent (opus) + criteria-planner-agent (sonnet) in parallel; interpretation-reviewer-agent (opus) post-merge
- Criteria plan: .plan-execution/criteria-plan-convergence-generalization.toon (34 criteria; 15 unit, 12 integration, 3 e2e, 4 qa-review; 30 hard + 4 soft; 3 reviewers — test-runner blocking, code-review advisory, security-review blocking)
- Interpretation conflicts: 0 blocking, 3 warning (IC-001 critic checklist count "exactly 30" vs C-17 "25-35 range"; IC-003 C-25 omits ≤2-iteration upper bound from F-03 metric; IC-004 C-28 doesn't verify snapshot-rollback as the mechanism), 1 info (IC-002 critic model resolution layer mismatch)
- Plan-only coverage gaps flagged by interpretation-reviewer: 5 high-severity error-code gaps (INTEGRATOR_NOT_FOUND, HARNESS_MISSING, FINDINGS_SCHEMA_INVALID, INTEGRATOR_MODE_AMBIGUOUS, MAX_ITERATIONS parity) + 8 advisory; criteria-planner did not surface error-handling table content. Resolution path: extend criteria-plan via /loom-plan test before convergence begins (M-01 gate will fail otherwise)
- Notes assimilated: note-004 (context-management redesign), note-005 (context-budget system), note-006 (convergence iteration summaries — directly relevant to F-01), note-007 (agent teams experimental flag), note-008 (per-wave auto-commits; auto-snapshot in F-01 is additive, distinct from git commits) — all marked assimilatedTo: PLAN-convergence-generalization.md
- Frontmatter fix: totalPhases corrected 14 → 15 post-generation (Phase 0 inclusive count)
- Reports written: planning/plans/PLAN-convergence-generalization.md (1202 lines), .plan-execution/conflicts/interpretation-report-convergence-generalization.toon
- Status: draft; awaiting /loom-plan review (6-agent panel) + criteria gap-close before /loom-plan execute

## 2026-06-12 -- Plan revised pass 4 architectural (kit-native-skills)
- Triggered by /loom-plan test acceptance-criteria-agent finding: Phases 8 & 9 logic in markdown commands not unit-testable (same shape as F-005/X-02 from pass-1)
- Pre-revision snapshot: planning/history/snapshots/2026-06-12-kit-native-skills-pass-3.md (116 KB)
- Resolution chosen: extract TS helpers mirroring skill-router.ts pattern (pass-1 fix). Phases 8/9 become wiring-layer only.
- New Phase 0 deliverables: hooks/lib/wizard-interview.ts (~120 lines — validateSkillSlug, detectExistingSkill, interviewStep, generateSkillMdContent, generateLibraryYamlEntry) and hooks/lib/library-add-heuristic.ts (~80 lines — classifyAddSource, formatAmbiguousPrompt, formatDeprecationWarning)
- Phase 4 scope extended: now owns test/wizard-interview.test.ts and test/library-add-heuristic.test.ts in addition to test/installer-skill-routing.test.ts
- Phase 8 narrowed: objective changed to wiring+UX layer; calls wizard-interview.ts for state machine + validation
- Phase 9 narrowed: objective changed to wiring+UX layer; calls library-add-heuristic.ts for classification + prompt formatting
- API Specification section extended with 6 new function specs (3 per module)
- catalog-v4-exports.toon extended to cover all 4 modules (migrator + skill-router + wizard-interview + library-add-heuristic)
- Plan file: planning/plans/PLAN-kit-native-skills.md (2109 lines, +179 from pass-3)
- Structural: 13 phases / 7 waves unchanged; status: reviewed
- Test spec updated: .plan-execution/test-spec-kit-native-skills.toon (120 → 158 specs, +38 net)
  - 26 new tests for wizard-interview.ts (8 slug validation cases, 3 detect-existing, 7 state-machine transitions, 5 content/entry generation, 1 crash-recovery, 1 decline-kit-registration)
  - 14 new tests for library-add-heuristic.ts (8 classification cases, 3 ambiguous-prompt assertions, 2 deprecation-warning assertions, 1 contract)
  - Closes CG-03 (decline kit-reg path), CG-04 (empty triggers array), partially CG-10 (atomic write)
  - 8 remaining gaps (CG-01 trigger exclusivity, CG-02 dir-non-empty, CG-05/06/07/08/09 various, CG-10 partial)
- Status: EXECUTION-READY — unit/e2e test generation can now proceed via unit-test-agent + e2e-test-agent

## 2026-06-12 -- Plan review-integrated pass 3 (kit-native-skills)
- Generated via /loom-plan create --review-integrate --name kit-native-skills (third pass)
- Source review: planning/history/reviews/2026-06-12-review-3.toon (8 new findings: 0 blocking, 5 warning, 2 nice-to-have, 1 info + 1 open from earlier + 2 executor caveats)
- Pre-integration snapshot: planning/history/snapshots/2026-06-12-kit-native-skills-pass-2.md (107 KB)
- Applied: 11 of 11 mechanical findings (no design choices needed)
- Key cleanups: P3-01 (Phase 0 header staleness — removed library.yaml refs from Phase 0 Objective + File Ownership; Phase 5 Note updated); P3-02 (wave-5-gate.toon added to Phase 9; Phase 10 read-guard AC); P3-03 (wave-4-gate read-guard ACs on Phases 8 + 9); P3-04 (S-31 wizard crash-recovery scenario); P3-05 (Wave 7 high-severity risk row + wave-7-gate.toon as M-03 terminal marker); P3-06 (slug validation AC); P3-07 (phase-1/3/4.toon stage-context writes); P3-08 (cross-file enforcement AC for PLAN-oss-launch.md)
- F-002/F-005 (pass-1 open): python-conventions manual smoke test promoted to Phase 7 gate AC — declared required before M-02 close
- E-01 executor caveat: comment block added explaining wave-4-gate AC re-run fragility
- Plan file: planning/plans/PLAN-kit-native-skills.md (1930 lines, +73 from pass-2)
- Structural: 13 phases / 7 waves unchanged; status: reviewed
- Trajectory: pass-1 blocking=8, pass-2 blocking=5, pass-3 blocking=0. **Plan converged.** Pass-4 review (if run) expected fully clean.
- Status: EXECUTION-READY pending criteria-plan.toon extension for Phases 8-11 (via /loom-plan test)

## 2026-06-12 -- Plan review-integrated pass 2 (kit-native-skills)
- Generated via /loom-plan create --review-integrate --name kit-native-skills (second pass)
- Source review: planning/history/reviews/2026-06-12-review-2.toon (25 new findings: 5 blocking, 15 warning, 5 info)
- Pre-integration snapshot: planning/history/snapshots/2026-06-12-kit-native-skills-pass-1.md (89 KB) — captured this cycle per prior lesson
- Applied: 25 of 25 findings (all blocking + all warning + all info)
- Structural changes: 5 waves → 7 waves; 13 phases unchanged. Wave 4 was advertised as 5-parallel but was actually 3-fan + 2-serial; restructured into sequential gating waves
- Key resolutions: N-01 (wizard→installer wiring — explicit /loom-library use instruction added to wizard completion output); N-02 (Phase 0b vs Phase 11 CLAUDE.md conflict — Phase 0b writes placeholder, Phase 11 fills); N-03 (wizard idempotency + step-correction escape); N-04 (ambiguous-prompt copy specified inline); N-05/N-12 (Phase 7 now gates Phases 8-11)
- N-19 user resolution: **OSS launch hard-depends on full M-03 completion (Phase 11 terminal)**. Recorded in Milestones + Risks sections. Cross-reference to PLAN-oss-launch.md flagged.
- New wave structure: Wave 4 = Phase 7 only (M-02 gate). Wave 5 = Phases 8 + 9 parallel. Wave 6 = Phase 10. Wave 7 = Phase 11 (M-03 terminal).
- Side-effect: .plan-execution/criteria-plan.toon C-10 naming fix applied (components[] → items[] in criterion name; body was already correct)
- Plan file: planning/plans/PLAN-kit-native-skills.md (1857 lines, +130 from pass-1)
- Trajectory: pass-1 review had 8 blocking, pass-2 review had 5 blocking (all on new content), pass-3 review should be clean (mechanical tightenings only)

## 2026-06-12 -- Plan review-integrated (kit-native-skills)
- Generated via /loom-plan create --review-integrate --name kit-native-skills
- Source review: planning/history/reviews/2026-06-12-review.toon (28 findings: 8 blocking, 17 warning, 3 info)
- Applied: 26 findings (all blocking + all warning + F-028 info); F-026 and F-027 skipped per user decision; F-004 deferred (will use /loom-skill create wizard)
- Scope expansion: F-05 authoring scaffolding added (Phases 8-11) per user decision — /loom-skill create wizard, /loom-library add heuristic update, /loom-agent create cross-reference, CLAUDE.md authoring section
- Structural changes: 8 phases / 4 waves → 13 phases / 5 waves; status: draft → reviewed
- Key changes: Phase 0 expanded (skill-router.ts extraction, install-state audit, catalog-v4-exports contract, library.yaml v2→v4 bump); Phase 0b new (CLAUDE.md/README docs promoted to P0); Phase 1 owns CURRENT_VERSION bump (was Phase 0); Wave 1+2 merge as one release per F-010
- Plan file: planning/plans/PLAN-kit-native-skills.md (1727 lines)
- KNOWN GAPS: (a) Snapshot of pre-integration plan was NOT captured (plan-builder overwrote in place; file was never committed so no git history either) — going forward, snapshot before letting plan-builder edit. (b) criteria-plan.toon does not yet cover Phases 8-11 (F-05 authoring scaffolding) — re-run criteria-planner-agent or extend manually before execution.

## 2026-06-12 -- Plan created from roadmap (kit-native-skills)
- Generated via /loom-plan create planning/ROADMAP-kit-native-skills.md --name kit-native-skills
- Source: planning/ROADMAP-kit-native-skills.md (status: approved)
- planVersion: 2
- Phases: 8 (Phase 0 contracts → Phase 7 wiring), Waves: 4, Deliverables: 30+
- API endpoints: 4 migrator/installer surfaces; State machines: 2 (catalog_version lifecycle, install-state item.type)
- Validation: passed (structural check)
- Criteria plan: .plan-execution/criteria-plan.toon (33 criteria after resolutions, 4 reviewers: test-runner blocking, security-review blocking, code-review advisory, qa-review advisory)
- Interpretation conflicts: 3 originally blocking; resolved via criteria fix (IC-001 components[]→items[], IC-004 added C-33 for kit.schema.md typed-includes) and 1 downgraded to warning (IC-006 test-files-on-disk — convergence runs after waves, so files exist by evaluation time)
- Plan file: planning/plans/PLAN-kit-native-skills.md

## 2026-04-25 -- Code fixes applied
- Source: review-report.md (commits 26083c1 + 5701dd6)
- Applied: 11 findings (2 critical, 9 warning)
- Unfixable: 0 findings
- Verification: SKIP (markdown-only changes, no typecheck/test applicable)
- Key fixes: step numbering, best-effort parse boundary, cli-exit-code enum, Stage 8 all-versions note, field mapping docs, merge precedence, deterministic heuristic

## 2026-04-19 -- Wave 3 execution complete (all waves done)
- Executed via /loom-plan execute --resume
- Wave 3: Phases 5, 6, 8 (E2E pipeline, statusline/logging/auto, wiring)
- Agents: 2 implementers (parallel) + 1 wiring agent
- Files created: 1 (commands/loom-upgrade.md)
- Files modified: 8 (e2e agents, e2e-story schema, statusline, loom.md, orchestration-patterns, execution-conventions, loom-auto)
- Verification: PASS (all structural and ownership checks green)
- Open issues: e2e passCondition mismatch (warning), loom-converge e2e agent refs (info)

## 2026-04-19 -- Review findings applied (review-integrate)
- Source: .plan-history/reviews/2026-04-19-review.toon (6-agent review)
- Applied: 10 findings (3 critical, 7 important)
- Unfixable: 0
- Verification: PASS (0 structural errors, 1 warning: Phase 4→7 same-wave dependency in Wave 2)
- Key changes:
  - 3 deliverable actions changed Create→Modify (loom-converge.md, context-budget-test.ts, interpretation-report.schema.md)
  - Phase 6 + Phase 8: grep-based selective reading mandated for budget compliance
  - Wave Exit Verification Gates section added between Execution Phases and Milestones
  - Phase 7 moved from Wave 3 to Wave 2, added to M-02a milestone
  - MVP boundary updated to include Phase 7, ROADMAP M-01 vs plan MVP clarified
  - e2e-story.schema.md cross-wave handoff contract added (append-only for Phase 5)
  - --no-tests renamed to --skip-test-gen on /loom-plan create (collision with /loom converge)
  - TDD Gate: fix-stubs state + implementing→aborted transition added
  - Phase 2 dependency: Phase 1 added (interpretation-report format dependency)
- Old version: .plan-history/snapshots/PLAN-pre-review-integrate-2026-04-19.md

## 2026-04-19 -- Plan regenerated from roadmap (merge mode)
- Generated via /loom-plan create (merge)
- Source: ROADMAP.md (approved)
- planVersion: 2
- Phases: 9 (down from 12), Waves: 4 (down from 5), Deliverables: 23
- Acceptance criteria: 84, State machines: 3, Error codes: 20
- Validation: passed (0 errors, 3 warnings)
- Key changes:
  - Merged 4 undersized phases (old Phases 4, 6, 7, 10) into adjacent phases
  - Moved context budget protocol from Wave 4 to Wave 1
  - Added Phase 7: Flaky Test Detection & Convergence Rollback
  - Collapsed 5 waves to 4 waves
  - MVP boundary: end of Wave 2 (Phases 0-4)
- Previous version: .plan-history/snapshots/PLAN-pre-merge-2026-04-19.md

## 2026-04-18 -- Code fixes applied (info pass)
- Source: .plan-execution/review-report.md (6-agent review)
- Applied: 9 findings (info severity)
- Unfixable: 3 (enum mismatch helpers not found, schema AJV tests need dedicated task, PLAN.md refactor)
- Already resolved: 2 (.gitignore already covers console dumps + screenshots)
- Verification: PASS (4 pre-existing timing flakes in statusline-e2e)
- Key fixes: test coverage for budget hooks, readBudgetConfig dedup, stack trace preservation, state machine transition, WIKI_QUERY_FAILED error code, criteria-plan.toon path standardization

## 2026-04-18 -- Code fixes applied
- Source: .plan-execution/review-report.md (6-agent review)
- Applied: 19 findings (5 critical, 14 warning)
- Unfixable: 0
- No fix needed: 1 (StageContext schema already aligned)
- Verification: PASS (5 pre-existing timing flakes in statusline-e2e)
- Key fixes: tier level corrections, 2 new agent definitions, path standardization, silent-error logging, path traversal guard, prompt injection delimiters

## 2026-04-18 -- Plan updated via review-integrate
- Applied via /loom-plan create --review-integrate
- Source: .plan-history/reviews/2026-04-18-review.toon (6-agent review)
- Findings applied: 10 (5 critical, 4 important, 1 structural)
- Schema fixes: ConvergenceTier.hierarchyLevel enum fixed, DeltaReport +3 fields (phaseRef, featureRef, milestoneRef, iterationRef), CoverageGap +2 fields (resolvedAt, resolutionRef)
- CLI fixes: /loom converge +4 flags (--approve-qa, --phase, --feature, --max-iterations)
- Wave reorganization: Phase 4 → Wave 1, Phase 7 → Wave 2, Phase 11 → Wave 4; totalWaves 6 → 5
- State machine: TDD Gate +skipped state with env-failure and override transitions
- MVP boundary declared at end of Wave 2 (Phases 0, 1, 2, 3, 4, 7)
- Validation: passed (0 errors, 7 warnings)
- Old version snapshot: .plan-history/snapshots/PLAN-pre-review-integrate-2026-04-18.md

## 2026-04-18 -- Plan created from roadmap
- Generated via /loom-plan create --full --auto
- Source: ROADMAP.md (approved)
- planVersion: 2
- Phases: 12, Waves: 6, Deliverables: 20
- CLI commands specified: /loom-plan create, /loom converge, /loom auto
- State machines: 3 (InterpretationConflict, Convergence Iteration, TDD Gate)
- Error categories: 19 codes
- Schema entities: 13+ (Taxonomy, CriteriaPlan, InterpretationConflict, CoverageGap, ConvergenceTier, E2EStory, PlaywrightTest, DeltaReport, AgentResult extended, PlanPhase, StageContext extended, ExecutionLog extended)
- Validation: passed (0 errors, 7 warnings)
- Overwrote previous plan: "Loom Quick Command" (v1)

## 2026-04-18 — Roadmap approved

- Status: reviewed → approved
- Approved via /loom-roadmap approve
- Ready for plan generation via /loom-plan create

## 2026-04-18 — Roadmap refined: wiki consultation behaviors added

- Added wiki-query pre-generation to F-02: plan-builder and criteria-planner consult wiki before generating
- Added wiki-query dedup to F-06: interpretation-reviewer checks prior resolutions before flagging conflicts
- Added wiki-query constraint check to F-07: fixer-agent consults wiki before applying fixes
- Added wiki-query protocol formalization to F-08: rolling-context wiki injection default-on, opt-out via --no-wiki-context

## 2026-04-18 — Roadmap refined: review-integrate

- Applied 29 review findings (7 blocking, 15 warning, 7 info) from 4-agent review
- Source: /loom-roadmap review-integrate using .plan-history/reviews/2026-04-18-roadmap-review.toon
- Structural changes:
  - Split M-02 into M-02a (4-Tier Convergence + Behavioral Hardening) and M-02b (E2E Pipeline)
  - Threaded F-07 (Superpowers patterns) into M-02a, promoted to P0
  - Removed standalone M-03 (Behavioral Hardening), renumbered M-04 → M-03
  - Demoted F-05 from P0 to P1
- Schema additions: interpretationConflict schema, testTier field, conflict resolution UX, diagnoseLog field
- Data model consolidated from 16 to 13 entities
- Added: MVP Boundary statement, Positioning subsection, cost-per-cycle metric, failure state UX definitions
- Added: --tier filter, --estimate flag, --approve-qa, progress indicators, opt-out warnings
- Validation: passed (0 blocking errors, 0 warnings)

## 2026-04-18 — Roadmap reviewed

- Reviewed via /loom-roadmap review (4 agents in parallel)
- Agents: scope-feasibility, feature-coverage, strategy, ux
- Findings: 7 blocking, 15 warning, 7 info
- Cross-cutting themes: M-02 overload, P0 inflation, missing schemas, under-specified failure states
- Status updated: draft → reviewed

## 2026-04-18 — Roadmap created: Loom Convergence Testing & Planning Taxonomy

- Generated via /loom-roadmap init
- Features: 8, Milestones: 4
- Validation: passed (0 errors, 1 warning — missing Out of Scope, fixed inline)

## 2026-04-09 — Plan created: Loom Git Command
- Generated via /loom-create-plan
- Source: direct feature description (no roadmap)
- planVersion: 1
- Phases: 5, Waves: 3, Deliverables: 6
- Subcommands: commit, push, pr, merge, cleanup, review-pr

## 2026-06-25 — ROADMAP-byo-kits.md review-integrate

Folded 26 review findings (3 agents) into planning/ROADMAP-byo-kits.md.

**Constraints added:** C-07 (target-path scope per type), C-08 (differentiation vs private plugin), C-09 (demand validation gate), C-10 (no infrastructure items in kits v1), C-11 (extend components[] not parallel kits[] table).

**Features added:** F-07 (local path source, promoted from Q-01), F-08 (init-kit scaffold for authoring discoverability). totalFeatures 6 → 8.

**Verb surface:** kept existing add | remove | update | sync (no hyphenated add-kit/remove-kit/update-kit). Scheme-based dispatch via github: prefix.

**Resolved:** Q-01 (→ F-07), Q-02 (→ C-07). **Still open:** Q-03 (plugin-clobber risk, BLOCKING M-01), Q-04, Q-05.

**Acceptance criteria upgraded** for F-02/F-03/F-04/F-05 with: gh auth 3-state error reporting, --dry-run, --check-only, --check-upstream, KIT_REF_NOT_FOUND, KIT_CHECKSUM_FAIL, KIT_NAME_CONFLICT, KIT_DRIFT, KIT_STALE errors, progress feedback, success-state output, mutable-ref warning, remove-confirmation guard.

Status: reviewed (was draft → reviewed via /loom-roadmap review on 2026-06-25). Not yet approved — Q-03 verification and C-09 demand gate are explicit prerequisites.

Review record: planning/history/reviews/2026-06-25-roadmap-byo-kits-review.toon

## 2026-06-25 — ROADMAP-byo-kits.md autoconverge (rounds 2-3)

Round 2 surfaced 1 critical + 2 high + 3 medium + 1 low. Round 3 ran clean on feature-coverage, surfaced 1 high on UX (F-05 success output). All integrated.

**Round 2 integration:**
- F-09 added (new feature): `/loom-library checksum <directory>` companion to F-08, full acceptance criteria + error codes
- C-07 scope enum: `{project, global}` with explicit override prompt text and --force suppression
- C-11 authoritative-read rule: `components[]` wins; auxiliary file rewrites on mismatch; F-04 flags `KIT_STATE_INCONSISTENT`
- F-01 acceptance: scope enum validation + Q-03 dependency note
- F-02 `KIT_REF_REQUIRED` for `github:owner/repo` with no `@ref` (no silent default to mutable @main)
- F-07 `KIT_MANIFEST_NOT_FOUND` for missing local kit.toon
- F-08 `KIT_DIRECTORY_NOT_EMPTY` refusing non-empty target without --force
- M-01 exit expanded with full error-code list + end-to-end authoring loop verification
- Q-04 resolved: `list` surfaces all `components[]` rows including kits naturally

**Round 3 integration:**
- F-05 success output: `Kit '{name}' updated: <old-sha> → <new-sha>, N files replaced.` with changed-file list

**Converge status:** converged after 3 rounds. 0 critical, 0 high findings remain across feature-coverage + strategy + ux.

**Still open (by design):** Q-03 (plugin clobber - M-01 entry gate), Q-05 (kit.toon format version policy - defer to first breaking change).

totalFeatures: 6 → 8 → 9
Constraints: 6 → 11

## 2026-06-25 — ROADMAP-byo-kits.md Q-03 resolved

**Code-read findings:**
- `~/.loom/install.toon` is the plugin/update envelope (written by `scripts/lib/update/apply.ts`, `scripts/loom-update.ts`)
- `~/.claude/skills/library/install-state.toon` is the core component inventory, written ONLY by `install.sh:350` (full overwrite, no merge)
- Plugin upgrade does NOT touch the library install-state file — plugin-installed users would have been safe
- Curl re-install DOES overwrite it — curl users would have lost any user-added rows

**Decision:** Isolate kit state into dedicated `~/.claude/skills/library/kits.toon` instead of extending `components[]` in install-state.toon. Both channels (plugin + curl) are now safe by construction — no merge logic needed in either installer.

**Roadmap changes:**
- C-11 rewritten: dedicated `kits.toon` schema, `kits[]` + `items[]` with kit foreign-key column
- Conceptual Data Model updated
- M-01 entry criteria: Q-03 removed as gate (resolved), M-06 demoted from hard prerequisite to recommended (kit state no longer depends on install-state v3 wiring)
- F-01 dependency note removed (storage layout now stable)
- Open Questions: Q-03 moved to Resolved with code-read summary

**Status:** roadmap is now blocked only on C-09 demand validation gate (3-team conversation). All structural and schema prerequisites resolved.

## 2026-06-25 — ROADMAP-byo-kits.md C-09 deferred to post-OSS-launch

**Reason:** Original C-09 required polling 3 Loom-using teams. Loom's user base at current stage (main ROADMAP.md M-06 OSS launch still IN-FLIGHT) cannot supply 3 independent teams to poll. Gate as written was unsatisfiable.

**Decision:** Defer C-09 execution until after M-06 5-stranger cold-install milestone. Original three-team poll criterion preserved verbatim for execution at that point.

**Roadmap changes:**
- C-09 rewritten with deferral framing + rationale explaining why "lower the bar" and "drop the gate" were rejected
- M-01 entry criteria: M-06 5-stranger milestone added as the first gate; C-09 chained behind it
- Risks section: theatre risk mitigated by post-OSS deferral; new risk added for OSS-launch-slips-and-BYO-stalls (mitigated — no engineering cost while dormant)

**Status:** Roadmap is now fully converged and unblocked. All schema, structural, and design prerequisites resolved. Implementation cannot begin until M-06 ships and C-09 gate clears, but no further roadmap work is needed.

## 2026-06-25 — ROADMAP-byo-kits.md APPROVED

Status: reviewed → approved. Frontmatter `approvedAt: 2026-06-25` set.

**Approval summary:**
- 9 features, 11 constraints, 2 milestones
- 3 converge rounds — 0 critical / 0 high findings remain
- Q-03 resolved by code-read (kit state isolated to dedicated kits.toon file)
- Q-04 resolved during converge (list walks kits.toon naturally)
- C-09 demand validation deferred to post-OSS-launch (no fictitious-team theatre)
- Implementation gate: main ROADMAP.md M-06 OSS launch → C-09 poll → M-01 start

Plan generation unlocked: `/loom-plan create planning/ROADMAP-byo-kits.md` is valid once M-06 ships and demand gate clears. No engineering action required today.

## 2026-06-25 — Safe upgrade path PR (fix/safe-upgrade-path)

**Problem:** Three unsafe upgrade paths in production:
1. `/loom-update` shipped in source but NOT distributed by install.sh — curl users had no safe channel-aware updater.
2. `/loom-library update` and `/loom-library sync` would re-pull system files (hooks, scripts/lib/*, prompts) while Claude Code was live — Claude Code itself rejected this as unsafe in a real user session.
3. Re-running `install.sh` to upgrade silently wiped any user-added rows in `install-state.toon` (kits, BYO items, agents added later).

**Fix (this PR):**

1. **`install.sh` ships `/loom-update`** — added to COMMAND_FILES + INFRA_FILES:
   - `commands/loom-update.md`
   - `scripts/loom-update.ts`
   - `scripts/lib/update/{check,apply,resume,rollback}.ts`
2. **`install.sh` preserves user-added rows on re-run** — awk filter extracts non-system rows (type ∉ {infrastructure, prompt, hook-template}) from existing install-state.toon and appends them verbatim after regenerating the system rows. Print line confirms count of preserved rows.
3. **`/loom-library update` + `sync` refuse system files** — rows with type ∈ {infrastructure, prompt, hook-template} are surfaced under a read-only "System files (skipped — use /loom-update)" section with explicit recovery copy. Library command never writes them.

**Tests:** new `test/install-state-preservation.test.ts` (7 tests) exercises the awk preservation filter against fixtures covering: system-rows-stripped, agent rows preserved, BYO kit rows preserved, skill rows preserved, header lines ignored, empty user-set, protocol rows preserved. All pass.

**Regression:** 41 existing install/plugin tests still pass.

**Net effect on a curl-installed machine:**
- After the next `curl ... | bash`, the user has `/loom-update` available.
- After that, `/loom-update` is the canonical safe-upgrade path (atomic staging, restart signal, rollback).
- `/loom-library update` is now safe — it only writes user-domain items.
- Re-running install.sh is also safe — it preserves user-added rows.

## 2026-06-25 — Code fixes applied (PR #24 review)

- Source: .plan-execution/review-report.md (PR #24 fix/safe-upgrade-path)
- Applied: 8 findings (4 critical + 4 warning)
- Unfixable: 0
- Verification: PASS (9/9 preservation tests, 41/41 install+plugin regression)
- Fix report: .plan-execution/fix-report.toon
- Archived review: planning/history/reviews/2026-06-25-pr24-safe-upgrade-review.md

Key fixes: GEM-01 (awk v3→v2 column collapse), SILENT-01/02/04 (mktemp/awk/cat error checks), STYLE-01/02 (scoped EXIT trap + awk row count), GEM-02/SILENT-03 (test parity + stderr assert), GEM-03 (two new v3-to-v2 conversion test cases).

## 2026-06-25 — Feature added: Matt Pocock Skills Adoption
- Feature ID: F-18
- Slug: matt-pocock-skills-adoption
- Milestone: M-08 (new — Matt Pocock Skills Adoption, NOT STARTED)
- Placement: appended (after F-17)
- Source: review of `mattpocock/skills` (MIT), conversation 2026-06-25
- Scope: 5 sub-phases (A Foundations, B Tight-red feedback loop, C Codebase health + planning, D Inbox + convergence hygiene, E Session + presentation polish) covering 21 sub-items
- Attribution: MIT — all adopted patterns credited inline ("Adapted from mattpocock/skills, MIT")

## 2026-06-25 — Roadmap review-integrate iteration 1 applied to F-18 / M-08
- Source: planning/history/reviews/2026-06-25-roadmap-review.toon (3 reviewers, 24 findings, 8 cross-cutting themes)
- Applied:
  - Attribution policy: removed inline per-file attribution requirement; switched to NOTICE + README acknowledgment (strategy F1)
  - Priority split: Phase B P1, Phases A/C/D/E P2 (strategy F2 + ux F23 + feature-coverage)
  - CONTEXT.md content separation: split into CONTEXT.md (glossary) + DECISIONS.md (locked decisions); precedence rule vs rolling-context [WIKI] documented (strategy F3 + feature-coverage F12)
  - ADR vs wiki decision pages: ADRs primary, wiki decision-* deprecated with one-shot migration (strategy F4)
  - FeedbackLoop schema expanded: escalationHistory[], linkedLoops[], parentLoopId, trda{} block, escapeReason, retirement ceremony (feature-coverage F10 + ux F22 + strategy F5)
  - Phase B gate escape hatch: --override-loop-gate "<reason>" + named stuck-at-ladder dead-end (ux F21)
  - Two in-progress UX states named explicitly (no loop / loop not red) (ux F22)
  - /loom-which moved Phase E → Phase A (ux F23 + feature-coverage F16)
  - OutOfScopeEntry schema authored in protocols/out-of-scope.schema.md (feature-coverage F9)
  - loom-bugfix Phase 1 gate scope explicit: applies to ALL paths (feature-coverage F11)
  - convergence-state.toon migration scheduled in Phase A (feature-coverage F19)
  - HTML report mode: opt-in --html flag with plain-text fallback (strategy F8 + ux F24)
  - Vocabulary mapping table added to protocols/codebase-design.md spec (all 3 agents)
  - Triage state machine: all transitions defined + AI disclaimer prefix + timestamps (feature-coverage F18 + ux)
  - findings.schema.md confidence field added (feature-coverage F13)
  - tdd-coach: edit existing agent (not new file) + no-silent-regression rule (feature-coverage F14, F17)
  - Sediment sweep: mid-flight after Phase B + final at Phase E (feature-coverage F20)
  - Skill autoload audit gets deprecation notices (ux)
  - /loom-prototype completion-signal defined (ux)
  - /loom-which vs /loom-reference relationship clarified: decision-tree vs table (feature-coverage F16)
  - Loop retirement ceremony defined (feature-coverage F15)
  - Data Model section: added FeedbackLoop, OutOfScopeEntry, TriageState, ADR entities + 5 relationships
  - M-08 dependency reframed: no hard dep on M-07; Phase A may parallel M-06 Phase 2

## 2026-06-25 — Roadmap review-integrate iteration 2 applied to F-18 / M-08
- Source: re-review iter2 (3 reviewers in parallel; strategy + ux verdict=converged, feature-coverage verdict=needs-another-pass with 3 blocking + 4 high)
- Applied:
  - Data Model FeedbackLoop row: added redOutput, runtimeMs, determinismRuns, typed trda{}/escalationHistory[]/linkedLoops[] (feature-coverage NEW-B1, NEW-B2)
  - Data Model new rows: CodebaseDesignVocab, SkillAuthoringPrinciple, Handoff, Prototype (feature-coverage NEW-B3, GAP-1, GAP-2)
  - Phase A sub-4b: explicit v1→v2 version label + detectConvergenceStateVersion/migrateConvergenceStateV1toV2 function names matching F-13 walker pattern (feature-coverage GAP-3)
  - Phase B sub-8: --loops output format specified as TOON table with named columns; loom-converge interaction spec added to Phase B deliverables (feature-coverage GAP-4 + ux Issue 1)
  - TriageState + OutOfScopeEntry + ADR rows tightened (typed enums, actor field on transitions)

## 2026-06-25 — Feature added: F-19 Autoconverge Harness Extension into Test + Execute Metasteps
- Feature ID: F-19
- Slug: autoconverge-test-execute-extension
- Milestone: M-08 (appended after F-18)
- Source: verification of `commands/loom-plan/{create,test,execute}.md` + `commands/loom-converge.md` against autoconverge intent (2026-06-25 Explore agent report)
- Five verified gaps closed:
  - Orphaned criteria-plan.toon (written by /loom-plan create, never read by /loom-plan test)
  - No /loom-plan test --autoconverge (generated tests never reviewed)
  - No /loom-plan execute --autoconverge (only --auto for quality gates, no document-mode wrapper)
  - No per-symptom binding anywhere (fixer reruns full wave; converge harness is single signal)
  - Document-mode harness is single-file only (cannot converge a test directory)
- Five phases (A bridge, B test-autoconverge, C execute-autoconverge, D harness primitives, E orchestration.toml lifecycle)
- Reuses F-18 Phase B loop.toon as the per-symptom atom — one schema, four entry points
- New entities: CriteriaTestBinding, ExecuteLoopMap
- M-08 phasing updated to include F-19 phases 6–10
- Frontmatter: totalFeatures 18 → 19

## 2026-06-25 — F-19 review autoconverged in 2 iterations + polish pass
- iter1: 3 reviewers, all needs-another-pass (4 blockers + 4 highs feature-coverage; 4 issues strategy; 6 issues UX)
- iter2: 3 reviewers, all converged (1 low feature-coverage, 1 medium strategy, 1 low UX residuals)
- Polish pass applied:
  - regenerating added to CriteriaTestBinding status enum (feature-coverage residual)
  - Phase B/D coupling note added to slip boundary (strategy residual)
  - Phase C item 13 render mode specified — append-only with iteration header (UX residual)
- Findings saved at planning/history/reviews/2026-06-25-F19-review-iter1.toon
- Verdict: converged. F-19 ready for /loom-plan create.

## 2026-06-25 — Testing-coverage additions to F-18 + F-19 (sanity sweep converged)
- F-18 gains sub-22 (test-coverage audit) + sub-23 (bootstrap testing note). Sub-item count 21 → 23.
- F-19 gains sub-27 (test-coverage audit) + sub-28 (bootstrap testing note) + sub-29 (test-fixture sub-deliverables — 4 fixtures: unverifiable-criterion, multi-tier-failure, broken-harness, well-formed-harness). Sub-item count 26 → 29.
- Convergence targets extended: coverage audit + fixtures lines added.
- M-08 Effort line updated to XL with full deliverable inventory.
- M-08 Phasing step 8 corrected: F-19 Phase B P2 → P1 (pre-existing inconsistency).
- 4th fixture added (well-formed-harness) closing positive-path coverage for Phase D --per-symptom-binding.
- Sanity sweep: feature-coverage-agent verdict converged. No new blockers.

## 2026-06-25 — PLAN.md created for F-18 (Matt Pocock Skills Adoption)
- Plan: planning/plans/PLAN-F-18-matt-pocock-skills.md (1645 lines, planVersion 2)
- Criteria: planning/plans/PLAN-F-18-criteria-plan.toon (39 criteria + 3 noTest)
- Generation path:
  - Step 1 triple-track: plan-builder (opus) + criteria-planner (opus) parallel, plan-critic (haiku) sequential
  - Step 1.5 interpretation review: 7 conflicts + 8 gaps; 4 blockers resolved by promoting sub-11/16/17/20 from criteria-plan noTest to C-36..C-39
  - Step 1.7 critic revise (opus integrator): 17 of 24 findings applied surgically; 7 info-level deferred to converge loop
- All 10 F-18 convergence targets mapped to criteria
- Plan structure: 7 phases (Phase 0 Contracts+Prefactor through Phase 6 Test-coverage audit) across 6 waves (Wave 0–5)

## 2026-06-25 — F-18 PLAN autoconverged through 3 iterations
- Iter 1 (6 reviewers): 19 blocking + 23 high findings; verdict needs-another-pass across all 6
- Iter 2 (Bucket A + B integrator): 14 mechanical findings closed by direct edits + 9 substantive structural edits via opus integrator
- Iter 3 (2-reviewer sanity sweep): parallelization converged; feature-coverage flagged 1 new residual (architecture-reviewer dual-phase ownership)
- Polish pass: documented architecture-reviewer Phase 4/Phase 5b sequential carve-out
- Final state: 1963 lines, 9 phases (0/1/2a/2b/3/4/5a/5b/6), 7 waves (0/1/2a/2b/3/4/5), 56 Applied: annotations, new Wave Gates section + Milestones with M-08-PreCheck-M-06 and M-08-MidCheckpoint
- Frontmatter: totalPhases 9, totalWaves 7
- All 10 F-18 roadmap convergence targets covered by ≥1 criterion AND ≥1 plan scenario
- Snapshots: pass-0 (1647), pass-1 (1647), pass-2 (1963), pass-3 (1965)
- Ready for /loom-plan execute or /loom-plan test

## 2026-07-01 — Feature added: /loom-spec --auto-mutate flag
- Feature ID: F-37
- Slug: loom-spec-auto-mutate-flag
- Milestone: M-03 (Think + Spec Flow)
- Placement: appended (into M-03 after F-09)
- Priority: P1
- Target roadmap: planning/ROADMAP-gstack-adoption.md
- Origin: dogfooded via /loom-spec (skill run on itself) during first live-test of gstack-adoption skills
- Related SKILL/command updates: skills/loom-spec/SKILL.md (Inputs + Phase 4 Mutation cadence section), commands/loom-spec.md (description)
- Notes: mutation performed via /loom-roadmap:mutate (proper audit-trail path). `--name` flag treated as target-roadmap convention despite not being documented in the mutate command spec — flag as a UX gap for a future backlog note.

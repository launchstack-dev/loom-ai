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
  - **Phase 0 expanded:** adds `agents/protocols/convergence-summary.schema.md` to file ownership + deliverable row; new AC asserting the 11-field schema; schema-versions.toon registers 4 schemas (was 3).
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

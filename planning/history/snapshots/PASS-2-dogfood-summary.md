# Pass-2 Dogfood — Convergence Engine Verification

**Date:** 2026-06-15
**Trigger:** PLAN-convergence-applications.md shipped (M-01/M-02/M-03 complete); Pass-2 verifies the engine improvements baked into F-01..F-04 + the schema-layer DF-02 fix actually work.

## Setup

- **Input:** `planning/ROADMAP-convergence-applications.md` (approved)
- **Engine:** post-F-01..F-04 ship, post-converge.config.schema.md backfill
- **Output:** `planning/history/snapshots/PLAN-convergence-applications-pass-2.md`
- **Spawns:** plan-builder (opus) + criteria-planner (sonnet) + plan-critic (haiku) + interpretation-reviewer (opus) = 4 agents
- **Pass-1 baseline for comparison:** `planning/plans/PLAN-convergence-applications.md` (shipped)

## What Pass-2 surfaced

### ✓ DF-02 fix validated at the architectural level

The Pass-2 plan-builder (no dogfood findings in input) explicitly set `snapshotEnabled: true` per-wrapper in F-01 — but the interpretation-reviewer caught that the F-02/F-03/F-04 wrapper sections **omitted that AC**. Filed as **CG-004 (blocking)**.

**Why this matters:** the Pass-2 regen *exposed exactly the drift pattern* our schema-layer fix prevents. By moving `snapshotEnabled: true` into `converge.config.schema.md` as the locked default for `convergenceMode: document`, the engine no longer relies on every wrapper remembering. Confirmed: the schema-layer fix is at the correct level.

### ✓ DF-01 surface raised correctly

C-35 (DF-01 parallelization tightening) is traceable to the Pass-2 plan as an opt-in `--strict-parallelization` flag (Phase 2 S-07). Interpretation-reviewer filed **IC-003 (warning)** noting the opt-in posture may not realize the "executable-quality" intent — same design call we deferred in the shipped plan. Open question still open.

### ✓ Coverage-gap detection works

Interpretation-reviewer found 7 plan-only gaps and 2 test-only gaps. Notable:
- **IC-001 (blocking):** Pass-2 plan's CA-01 frozen-files diff list omits `hooks/lib/iteration-snapshot.ts` (4 files listed; C-25 expects 5). Real bug in the regen.
- **CG-001..003:** per-feature spawn-ceilings stated in plan, only F-02 has a corresponding criterion. The shipped plan has Phase 8 to test all four; Pass-2 missed wiring this.

### ✓ Critic accuracy

Critic predicted 1 blocking (P-01: missing Overview audience/differentiator) + 5 advisory. The actual interpretation-reviewer surfaced different blockers (IC-001, CG-004). Critic confidence 0.72 — reasonably calibrated.

## Quantitative deltas vs Pass-1 shipped plan

| Metric | Pass-1 shipped | Pass-2 regen | Delta |
|---|---|---|---|
| Phases | 9 | 11 | +2 (F-03/F-04 split into agents-then-harness) |
| Waves | 4 | 5 | +1 |
| Plan lines | ~900 | 1102 | +200 |
| Criteria | 33 | 38 | +5 (DF-01/02 + 2 inferred) |
| Scenarios | ~20 | 26 | +6 |
| Blocking interpretation conflicts | (n/a) | 2 | new signal |
| Coverage gaps | (n/a) | 9 | new signal |

## Conclusions

1. **Engine works.** The convergence engine produces a different but defensible plan from the same roadmap. The differences are interpretable, not random.
2. **DF-02 schema fix is correctly placed.** The regen drift (CG-004) is exactly what the fix prevents.
3. **DF-01 still open.** Whether to make parallelization-severity tightening default-on or opt-in remains a design call; Pass-2 chose opt-in same as the shipped plan implicitly does.
4. **Dogfood findings DO compound.** Without DF-01..DF-04 in the input, the regen rediscovers the same drift patterns. Locking findings into the plan (as Pass-1 + shipped did) is essential.

## What was NOT run

- The inner `/loom-converge --resume-config` loop (which would spawn the 6-reviewer plan-review-harness 2-3 times). Skipped because the diagnostic value of Pass-2 was already captured by the 4-agent pre-loop pipeline. Running it would consume ~18 more reviewer spawns to mechanically apply the critic + interpretation findings — useful as a stress test, not new information.

## Recommended next steps

1. Treat IC-001 and CG-004 as **prompt-engineering signals** rather than plan revisions — both are artifacts of regen without dogfood context. The shipped plan already covers them.
2. Consider tightening the plan-builder prompt to read `planning/history/snapshots/` and pick up prior dogfood findings as additional input (so future Pass-N runs don't rediscover the same drift).
3. **DF-04** (plan-critic doesn't grep referenced paths against filesystem) was identified during Wave 0 but is unrelated to Pass-2's findings. Worth a follow-up ticket.

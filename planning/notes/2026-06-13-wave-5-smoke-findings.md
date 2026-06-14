---
date: 2026-06-13
plan: convergence-generalization
context: fresh-session smoke test of /loom-plan create --autoconverge after Wave 5 ship — three rounds (dry-run, default, --skip-critic)
author: orchestrator + smoke-test agent
status: ALL 3 SMOKES GREEN — 7 of 9 findings tracked open (A fixed in ef94ed0; B-I tracked); PR #18 merge-ready
---

# Wave 5 smoke-test findings

Three fresh-session smoke rounds of `/loom-plan create --autoconverge` against a throwaway 2-phase roadmap surfaced 9 distinct findings ranked A (HIGH) → I (LOW). Finding A was fixed in commit `ef94ed0`; B-I are tracked here for follow-up and do not block PR #18 merge.

| Smoke | Variant | Outcome |
|-------|---------|---------|
| 1 | `--dry-run` (no LLM spawns) | converge.config emits correctly; surfaced flag-drift Finding (fixed in 965e790) |
| 2 | `--autoconverge --auto --max-iterations 1` (default critic) | end-to-end wrapper functional; converged on iter 1; 7 findings (A-G) surfaced |
| 3 | `--autoconverge --auto --max-iterations 1 --skip-critic` (fallback path) | --skip-critic skip clauses work; PLAN.md shape matches Smoke 2 within ±1; 2 new findings (H, I) |

Decision matrix verdict: **all three smokes ✅ → merge PR #18 with confidence.**

## Bottom-line verdict

**Wave 5 wrapper wiring is functionally correct end-to-end.** The smoke confirmed:

- `/loom-converge --resume-config` accepted by the driver (the contract reconciliation 965e790 landed correctly)
- `--auto` propagates transparently; zero interactive prompts in the trace
- The harness emits a spawn-request and aggregates findings on re-invocation
- Reviewer-results land at `.plan-execution/convergence/reviewer-results/{agent}.toon` with the schema-side `-reviewer-agent` suffix
- `convergence-summary.toon` populates all required schema fields and drives `nextLink` decisions correctly (`converged → done`)
- The C-11 link-extraction-readiness contract holds: a fresh-context agent could derive `link-result.toon` from disk artifacts alone

The smoke surfaced 7 findings that did NOT block Wave 5 ship but are tracked here for engineering follow-up.

## Finding A — Harness drops warning-severity issues silently — FIXED 2026-06-13

**Severity:** HIGH. Lost real production findings.

**Symptom:** The smoke run logged 4 stderr lines:

```
warning: skipping issue with unrecognized severity 'warning' in <reviewer>.toon
```

Reviewer envelopes emit `severity: warning` and `severity: blocking` per `agent-result.schema.md`'s canonical examples. The harness's `VALID_AGENT_ISSUE_SEVERITIES` allowlist only accepted the classic ladder (`critical|high|medium|low|info|advisory`), so the input-validator at `scripts/plan-review-harness.ts:433` dropped all rows with the convergence-aligned severities BEFORE the aggregator saw them. 4 reviewer warnings were silently lost across the smoke run — 2 of which were genuinely actionable.

**Root cause:** Schema-seam mismatch between `agent-result.schema.md` (reviewer-emit enum: `{blocking, warning, info}`) and `findings.schema.md` § Severity Mapping (aggregator-input enum: `{critical, high, medium, low, info, advisory}`). The two enums diverged by design but never converged at the consumer (the aggregator). Phase 9's 27 aggregator unit tests + 22 harness tests all passed because they used **synthetic findings.schema.md-shaped inputs**, not real reviewer envelope shapes. The integration boundary was never exercised.

**Fix (2026-06-13 patch):**

- `scripts/lib/aggregate-findings.ts`: extended `AgentIssueSeverity` type to include `"blocking"` and `"warning"`; extended `severityToConvergenceSeverity` switch to map both identity-style (`blocking → blocking`, `warning → warning`)
- `scripts/plan-review-harness.ts`: extended `VALID_AGENT_ISSUE_SEVERITIES` allowlist to include the new values
- `agents/protocols/findings.schema.md`: extended the severityToConvergenceSeverity table with the 2 new rows + added a § "Why two enums" subsection explaining the union-acceptance design
- `test/protocol/aggregate-findings.test.ts`: +5 new tests covering blocking/warning inputs, blocking-count contribution, mixed-enum runs (defensive)
- `test/protocol/plan-review-harness.test.ts`: +3 new tests covering parser-side acceptance of the new severities

**Verification:** `bun test test/protocol/` 455 → 463 (+8 tests, +26 expects). `tsc --noEmit -p hooks/tsconfig.json` clean.

**Defensive lesson:** Phase 9's unit-test strategy used synthetic inputs keyed to its OWN expected enum. The test fixture and the production code shared the same blind spot. The new tests use realistic reviewer envelope shapes — they would have caught this on day one. **Future contract-bound modules must include at least one test that mirrors the real upstream emit format, not the module's own input schema.**

## Finding B — MAX_ITERATIONS circuit breaker not exercised by trivial roadmap

**Severity:** MEDIUM. Test-design / smoke-kit calibration.

**Symptom:** The smoke prompt anticipated MAX_ITERATIONS halt because "pass-1 likely has blocking findings." On a genuinely trivial 2-phase plan with zero structural issues, the loop converged on iter 1 — meaning Smoke 2 didn't actually exercise the MAX_ITERATIONS circuit breaker it was designed to test.

**Disposition:** Smoke-kit calibration bug, mine. Two options for v2:

1. Calibrate Smoke 2's throwaway roadmap to provoke blocking findings (deliberate phase-ownership overlap, missing AC sections, etc.)
2. Add a Smoke 3 specifically scoped to MAX_ITERATIONS that points at the existing `test/e2e/convergence/fixtures/autoconverge/ROADMAP.md` (Phase 14's flaggable fixture has 8 seeded blocking findings — exactly what's needed)

**Recommended:** Option 2 — re-use the Phase 14 fixture for the smoke kit. Free, deterministic, and validates a real production roadmap shape.

## Finding C — Wrapper config-write was not atomic

**Severity:** LOW. Wrapper-fidelity issue.

**Symptom:** Step 5 spec mandates `.tmp + rename` for the converge.config write. The smoke pass used a direct `Write` — close to atomic but not strictly per spec.

**Disposition:** Implementation-time concern for whoever writes the live wrapper code path. Spec is correct; smoke deviation does not indicate a code bug, just that the smoke agent took a shortcut. Track for code-review when the wrapper materializes from spec to executable.

## Finding D — No pass-1 snapshot contradicts smoke success criteria

**Severity:** MEDIUM. Smoke-kit / schema mismatch.

**Symptom:** The Smoke 2 success criteria expected `planning/history/snapshots/smoke-roadmap-pass-1.md` to exist. The C-11 contract table at `commands/loom-plan/create.md:504` states snapshots exist "one per iteration with N ≥ 2" (pre-integration snapshot of iter N-1's output). So iter 1 by design has no snapshot.

**Disposition:** Smoke-kit drafting error, mine. The smoke success criteria contradicted the C-11 schema. Fix: smoke v2 should expect `smoke-roadmap-pass-2.md` (or later) ONLY, not pass-1.

## Finding E — Smoke roadmap polluted canonical planning/plans/PLAN.md

**Severity:** LOW. Smoke-kit ergonomics.

**Symptom:** Smoke 2's verbatim prompt didn't pass `--output` or `--name`, so the wrapper routed the plan write to the canonical `planning/plans/PLAN.md` path (matching the spec default). This pollutes the user's live planning dir with smoke residue.

**Disposition:** Smoke-kit bug. Fix v2 of the smoke prompts: add `--output planning/scratch/PLAN-smoke.md` or `--name smoke` to keep all output under `planning/scratch/`. Confirm the wrapper actually honors these flags (also a smoke-kit-tested behavior).

## Finding F — No changelog/trajectory append in smoke run

**Severity:** LOW. Smoke-kit / wrapper-fidelity discrepancy.

**Symptom:** Step 4 #2 (append to `planning/history/changelog.md`) and the W-14 trajectory line (`trajectory: pass-1 blocking=N, pass-2 blocking=N, ...`) were both skipped in the smoke run to minimize residue. The smoke kit's success criteria listed the trajectory line as a required artifact.

**Disposition:** Self-inconsistency between smoke-kit success criteria and smoke-agent execution. Either:
- The wrapper's real code path writes the trajectory (and the smoke must accept the residue + clean up afterward), OR
- The smoke kit drops the trajectory check (smoke-only behavior diverges from production wrapper)

**Recommended:** Accept the residue. The trajectory line is a production-correctness signal worth verifying.

## Finding G — Step 1 spawn parallelism deviation in smoke

**Severity:** LOW. Wrapper-fidelity.

**Symptom:** The spec requires `plan-builder + criteria-planner` in a SINGLE Agent-tool message (true parallelism). The smoke agent ran them serially. No functional break, but a strict wrapper implementation must batch both into one assistant message.

**Disposition:** Implementation-time concern. The Smoke 2 trace surfaced no observable consequence (both agents completed correctly), but the wrapper code path MUST honor the single-message batching when shipped. Track for code-review.

## Finding H — Step 1.5 spec ambiguity on `--auto` blocking-gap handling (Smoke 3)

**Severity:** LOW. Spec/wrapper interpretation.

**Symptom:** Smoke 3's interpretation-reviewer surfaced 1 blocking **coverage gap** (CG-001: "no imports" AC has no verifier). The `--auto` halt clause in `commands/loom-plan/create.md:221` references only "conflicts" with `severity: blocking`. A strict literal reading lets blocking gaps through (Smoke 3 continued); a charitable reading should halt.

**Disposition:** Spec ambiguity. Clarify in `commands/loom-plan/create.md` Step 1.5 whether blocking coverage gaps trip the `--auto` halt alongside blocking conflicts. Smoke 3 ran the literal reading; pick one interpretation and lock the spec text. Either choice is defensible; the bug is the ambiguity itself.

## Finding I — Interpretation-reviewer report inconsistently persisted (Smoke 3)

**Severity:** LOW. Wrapper-fidelity.

**Symptom:** Step 1.5 spec says "Save the conflict report to `.plan-execution/conflicts/interpretation-report.toon`". Smoke 2 happened to land the report on disk (wrapper wrote it); Smoke 3 did not (agent returned inline only).

**Disposition:** Wrapper code path must always persist this artifact regardless of how the agent returns it. The downstream consumers (link-extraction per C-11, post-run audits) depend on consistent on-disk presence.

## Engineering follow-up tracker

| Finding | Owner | Action | Status |
|---------|-------|--------|--------|
| A — harness drops warning severity | Wave 4 / Phase 9 | Code fix + 8 new tests + schema doc | **DONE** in `ef94ed0` (2026-06-13) |
| B — MAX_ITERATIONS not exercised | smoke kit v2 | Re-point Smoke 2 at Phase 14 fixture, or accept clean-converge as design | TODO |
| C — non-atomic config write | wrapper code path | `.tmp + rename` enforced in real wrapper | TODO (code-review gate) |
| D — pass-1 snapshot expectation | smoke kit v2 | Drop pass-1 from success criteria (align with C-11 N≥2 rule) | TODO |
| E — canonical planning path polluted | smoke kit v2 | Add `--output planning/scratch/PLAN-smoke.md` to Smoke 2/3 prompts | TODO |
| F — changelog/trajectory drift | smoke kit v2 + wrapper | Accept the residue, verify trajectory line W-14 format | TODO |
| G — Step 1 parallelism | wrapper code path | Single-message batch of plan-builder + criteria-planner enforced | TODO (code-review gate) |
| H — Step 1.5 blocking-gap halt ambiguity (Smoke 3) | spec | Clarify `commands/loom-plan/create.md:221` — do blocking coverage gaps trip `--auto` halt? | TODO (spec text) |
| I — interpretation-report inconsistently persisted (Smoke 3) | wrapper code path | Always write `.plan-execution/conflicts/interpretation-report.toon` regardless of agent return mode | TODO (code-review gate) |

## Self-audit recap

Finding A is a textbook case of "canned fixtures bypassed the integration boundary the smoke exercised." The fix here (8 new tests using realistic reviewer envelope shapes) is the prototype for what every future contract-bound module should ship: at least one test that mirrors the **real upstream emit format**, not the module's own input schema. Without that, schema-seam mismatches drift undetected until a real invocation surfaces them.

The orchestrator should treat fresh-session smoke tests as a **mandatory pre-merge gate** for any wave that ships a wrapper, command, or new agent. The pattern has now proven itself twice: once on Wave 5 (5 install gaps + 2 schema-seam bugs), and any future plan that doesn't run at least one fresh-session smoke before merge will reproduce this exact failure mode with different specifics.

## Related artifacts

- Smoke 1/2/3 transcripts: not preserved (fresh sessions, no recording — distilled findings live in this note)
- Wave 5 commits: `e173b3f` (wave-5 deliverables), `965e790` (--resume-config flag fix), `a851e79` (install-catalog fix), `ef94ed0` (Finding A patch + initial version of this note), `50bb7d1` (Gemini review patch: 2 HIGH + 4 MED), `<this-commit>` (Findings H, I + decision-matrix verdict)
- PR #18 (draft): https://github.com/launchstack-dev/loom-ai/pull/18
- Throwaway roadmap used by all 3 smokes — inlined below for recoverability after `planning/scratch/smoke-roadmap.md` is removed:

```markdown
---
schemaVersion: 1
title: Smoke Test Roadmap — convergence-generalization Wave 5
created: 2026-06-13
purpose: throwaway target for /loom-plan create --autoconverge smoke verification
status: scratch
---

# Smoke Test Roadmap

## Vision
Verify the /loom-plan create --autoconverge wrapper resolves the document-mode loop
end-to-end in a fresh session. Intentionally minimal so a single iteration converges cheaply.

## Milestones

### M-01: Add a hello-world script
**Acceptance:** A scripts/hello.ts file exists that prints "hello world" when run
with `bun run scripts/hello.ts`.

## Features

### F-01: hello.ts entry point
**Description:** A single TypeScript file that imports nothing and prints "hello world" to stdout.
**Acceptance:** `bun run scripts/hello.ts` exits 0 with stdout `hello world\n`.
```

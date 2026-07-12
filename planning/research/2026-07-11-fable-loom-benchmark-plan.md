# Benchmark plan: proving Fable+Loom > bare Fable

- Date: 2026-07-11
- Question: does Loom measurably improve outcomes when a Fable-tier model is already the driver — and should Loom claim token efficiency?
- Status: design (not yet executed). Reuses `/loom-benchmark` harness patterns, `metrics-snapshot.toon` conventions, and `scripts/scorecard-gate.ts`.

## Claims under test

- **H1 (outcome):** Fable+Loom completes more verified requirements of a fixed e2e app build than bare Fable, at equal or better defect rates.
- **H2 (drift):** Fable+Loom exhibits less scope drift (out-of-scope work, missed requirements) and less convention drift (violations of stated constraints).
- **H3 (economics):** Fable+Loom costs MORE raw tokens but FEWER cost-weighted dollars per verified requirement, because Loom pushes bulk tokens to cheaper worker tiers and caps rework with convergence breakers.

H3's framing is the answer to "should Loom claim token efficiency" — see §6.

## Arms

| Arm | Driver | Tooling | Runs |
|---|---|---|---|
| A — bare Fable | Fable 5 | vanilla Claude Code, no Loom assets, spec pasted as one prompt, free iteration | 3 |
| B — Fable + Loom | Fable 5 | full pipeline: `/loom-think` (skippable if spec is judged non-fuzzy) → `/loom-roadmap init` → `/loom-plan create` → `/loom-plan execute` → `/loom-converge --criteria --full` | 3 |
| C — Loom without Fable (control) | Opus | same pipeline as B, `quality` profile | 3 |

Arm C exists to isolate the driver's contribution and to evidence the README's two-modes claim (guarantees hold without Fable; speed/judgment degrade). Run order randomized; runs spaced to respect Fable window limits; fresh clone per run, no context reuse.

## Task: a fixed e2e app build

**"LinkBoard"** — a small full-stack app sized so drift has room to appear (~12–15 files, 3 natural phases) but 9 total runs stay feasible:

- Magic-link auth (no passwords)
- Boards + links CRUD with per-user ownership
- One deliberately tricky feature: public share links with per-link rate limiting (the interpretation-conflict magnet)
- SQLite + typed API + minimal server-rendered UI

**Locked spec document:** 25–30 numbered requirements (R-01…), 5 named constraints (e.g., TypeScript strict, no ORM, no client framework, atomic writes, all endpoints typed), and 8–10 **explicit non-goals** (drift tripwires: no OAuth, no websockets, no admin panel…). Every arm receives the identical spec text and nothing else.

## Measurement — referee independent of all arms

Authored **before** any run, held out from every arm:

1. **Acceptance suite** (~30 checks): API contract tests + Playwright stories keyed 1:1 to R-numbers. Same suite grades all 9 runs.
2. **Blinded review panel:** 3 non-fable reviewers (sonnet/opus) score defects and code quality per dimension, repo anonymized (Loom artifacts like `.plan-execution/` stripped before review so the panel can't identify the arm).

### Metrics

| Class | Metric | Source |
|---|---|---|
| Outcome | acceptance pass rate (primary); requirements completed %; blinded defect count | held-out suite; panel |
| Tokens | raw input/output tokens (driver + every subagent); **cost-weighted dollars** (per-tier pricing); tokens-to-first-green; tokens and dollars **per passed acceptance check** | session JSONL accounting |
| Drift | non-goals implemented (count); requirements missed; constraint violations (of the 5 named); interpretation divergence (behavior vs R-number, judged) | diff vs locked spec; panel |
| Process | wall-clock; human interventions (count, scripted-only); runaway-loop incidents (iterations past first stall) | run logs |

**Operator protocol:** no ad-hoc steering. Allowed operator responses are enumerated in advance (approve plan / answer from a scripted FAQ derived from the spec / decline additions). Any question outside the FAQ is answered "use your judgment" — verbatim, all arms.

### Scorecard (TOON, per run)

```
benchmarkRun:
  arm: B
  runId: linkboard-b2
  driverModel: fable-5
  acceptance: {passed: 27, total: 30}
  requirementsCompleted: 28
  defectsBlinded: 3
  tokens: {raw: 2140000, costUsd: 18.40, perPassedCheck: 79259, usdPerPassedCheck: 0.68}
  drift: {nonGoalsBuilt: 0, requirementsMissed: 2, constraintViolations: 0}
  process: {wallMinutes: 94, interventions: 2, runawayIncidents: 0}
```

Aggregate: per-arm medians; report every raw scorecard (no averaging away variance across 3 runs); success = B beats A on acceptance AND drift with non-overlapping ranges, and B's `usdPerPassedCheck` ≤ A's.

## Predicted shape (pre-registered so the result is honest either way)

- A finishes faster on wall-clock for the easy 70%, then bleeds tokens on rework for the tricky feature; drift appears as unrequested extras and 2–4 missed requirements.
- B spends 20–40% more raw tokens up front (criteria, reviews, contracts) and wins on acceptance, drift, and bounded worst case (breakers stop runaway loops; A's rework is unbounded).
- C lands near B on acceptance/drift, behind on wall-clock and judgment-seam quality — evidencing "structure, not model IQ, carries the guarantees."

If B does NOT beat A on acceptance+drift, that is a roadmap-level finding about Loom's overhead, not a reporting problem — record it.

## 6. Should Loom claim token efficiency?

**Not raw token efficiency — no.** The honest prediction is that Loom spends *more* raw tokens than a bare agent on the same task; a raw-efficiency claim would be falsified by our own benchmark. The defensible claims, in order of strength:

1. **Cost per verified outcome.** Dollars per passed acceptance check. Loom routes bulk tokens to sonnet/haiku workers while a bare-Fable run pays driver prices for everything — Loom can win on dollars even while losing on token count, and should win decisively per *verified* requirement once A's rework is priced in.
2. **Bounded worst case.** Circuit breakers cap the maximum spend of a failed direction (`STALL`/`REGRESSION`/`BUDGET_EXHAUSTED`); a bare agent's rework loop has no ceiling. "Predictable spend" is a claim no raw-efficiency number provides.
3. **Artifact-level efficiency stays scoped.** The existing "TOON ~30–60% smaller than JSON" line (docs/internals.md) is about state files, not runs — keep it scoped there and note C-05 froze the format precisely because cheaper long context weakened this as a headline.

Positioning sentence for the README (post-benchmark, with numbers): *"Loom spends more tokens planning and verifying — and fewer dollars per requirement that actually ships."*

## Execution checklist (when green-lit)

- [ ] Write LinkBoard spec + non-goals + constraint list; freeze it
- [ ] Author held-out acceptance suite + Playwright stories; freeze
- [ ] Script the operator FAQ; freeze
- [ ] Token/cost accounting script over session JSONL (per-tier price table pinned)
- [ ] 9 runs (A×3, B×3, C×3), randomized order, fresh clones, Fable-window aware (`/loom-fable status` recorded per run)
- [ ] Blinded panel review (Loom artifacts stripped)
- [ ] Scorecards → `planning/reports/fable-loom-benchmark.toon`; findings doc; README positioning update only if H1+H2 hold

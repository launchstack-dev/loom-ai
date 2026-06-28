---
name: feedback-loop
description: Feedback-loop construction discipline — 10-rung ladder (failing test → curl → CLI+fixture diff → headless browser → trace replay → throwaway harness → fuzz → bisection → differential → HITL bash), TRDA gate definition, and tighten-the-loop heuristics. Auto-loads during loom-converge loop construction, loom-bugfix Phase-1 gate, or any session where you are writing or evaluating a FeedbackLoop artifact.
triggers:
  - ".plan-execution/loops/**"
  - "**/loop.toon"
  - "**/feedback-loop*"
---

# Feedback-Loop Construction Skill

A feedback loop is the atomic unit of convergence work. It encodes a tight,
verified-red, deterministic, agent-runnable signal that a fixer can iterate
against without HITL input on every cycle. This skill governs how to construct
that signal using the 10-rung ladder and how to evaluate it against the TRDA
gate.

---

## TRDA Gate

Every loop must pass four boolean checks before it leaves `construction` state
and enters `verified-red`. ALL FOUR must be true simultaneously.

| Bit | Name | Meaning |
|-----|------|---------|
| `tight` | Tight | The command exercises ONLY the symptom — no upstream noise, no side-effect leakage into the result. |
| `redCapable` | Red-capable | The harness output is parseable into a verified-red signal: structured stderr + non-zero exit code. |
| `deterministic` | Deterministic | Two consecutive invocations both produce red (`determinismRuns >= 2`). |
| `agentRunnable` | Agent-runnable | A fixer agent can execute the command in CI without HITL input on every iteration. |

**Tight loops compound.** Each rung ascended without a TRDA pass narrows the
search space and forces the harness toward the minimum reproducible signal.
Resist the urge to widen scope when the loop is failing TRDA — widening trades
determinism for coverage and almost always fails both.

**Red signals must be deterministic.** A flaky red is worse than no red: it
trains the fixer to accept false greens and hides genuine regressions.

**Escape hatch:** An operator may bypass TRDA via `--override-loop-gate
"<reason>"` (minimum 8 characters). The `escapeReason` is written to
`loop.toon` and flagged prominently in the convergence digest. This does NOT
mean TRDA is optional — it means the operator is accepting the risk explicitly.

---

## 10-Rung Ladder

Rungs are ordered by isolation precision (rung 1 = most precise) and HITL
involvement (rung 10 = human-in-the-loop bash session). Always start at rung 1
and escalate only after the current rung fails TRDA.

### Rung 1 — Failing test

Run the single failing test file or test case directly:

```
bunx vitest run tests/path/to/file.test.ts
```

This is the preferred rung. Tight by construction (tests name the symptom),
redCapable (vitest structured exit + stderr), deterministic when no global
state leaks, agentRunnable in CI.

Escalate if: the test itself is flaky, the symptom cannot be expressed as a
test, or the harness setup has side effects that make `determinismRuns < 2`.

### Rung 2 — curl

Issue an HTTP request against a locally running service and assert on the
response body or status:

```
curl -sf http://localhost:3000/api/endpoint | jq -e '.field == "expected"'
```

Tight loops require isolating the endpoint under test from other requests.
Escalate if the server startup is non-deterministic or if the response is
environment-dependent.

### Rung 3 — CLI+fixture diff

Run a CLI command against a pinned fixture and diff the output:

```
my-cli --input fixtures/input.json > /tmp/actual.json
diff fixtures/expected.json /tmp/actual.json
```

Red when diff exits non-zero. Tight when the fixture is minimal and covers
only the symptom. Escalate if the CLI reads from global config that drifts.

### Rung 4 — Headless browser

The headless browser rung drives Playwright or Puppeteer against a local dev
server and asserts on DOM state or network response:

```
bunx playwright test tests/e2e/symptom.spec.ts --headed=false
```

Tight loops target a single page or flow. Escalate if the E2E suite startup
is slow (> 30 s) or if screenshots fail TRDA determinism.

### Rung 5 — Trace replay

The trace replay rung replays a captured trace file (HTTP recording, DB query
log, event stream) and asserts on the replayed output. Useful when the live
service is unavailable or its state is non-deterministic.

```
bunx replay-tool --trace fixtures/trace.har --assert expected-response.json
```

Tight when the trace covers only the symptom path. Escalate if trace capture
introduces its own flakiness.

### Rung 6 — Throwaway harness

The throwaway harness rung writes a minimal, single-purpose script that
exercises the failing code path directly, bypassing framework scaffolding:

```ts
// harness.ts (temp — delete after retirement)
import { failingFn } from "../src/module";
const result = failingFn(fixtureInput);
if (result !== expected) { process.exit(1); }
```

Tight by design: the harness contains exactly the symptom. Escalate if the
harness itself is too complex to trust as a signal source.

### Rung 7 — Fuzz

The fuzz rung runs a property-based fuzzer targeting the symptom surface:

```
bunx fast-check --entryPoint tests/fuzz/symptom.fuzz.ts --runs 100
```

Tight when the fuzzer is seeded and the run count is bounded.
Escalate if fuzzer setup time exceeds budget or if shrinking is non-deterministic.

### Rung 8 — Bisection

The bisection rung uses `git bisect` to identify the commit that introduced
the regression:

```
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-sha>
git bisect run bunx vitest run tests/path/to/symptom.test.ts
```

Tight because bisection narrows the commit range automatically.
Escalate if the test itself was introduced after the regression (bisection
cannot find what did not yet exist).

### Rung 9 — Differential

The differential rung compares output between two implementations, branches,
or versions to isolate the divergence:

```
diff <(OLD_VERSION=1 node --import tsx src/cli.ts < fixture.txt) \
     <(OLD_VERSION=0 node --import tsx src/cli.ts < fixture.txt)
```

Tight when the fixture is minimal. Escalate if the diff is too large to parse
deterministically (> 200 lines).

### Rung 10 — HITL bash

The HITL bash rung is the terminal rung. A human operator runs the symptom
manually in a bash session.

A human operator runs the symptom manually in a bash session and documents
the exact sequence of commands that reproduces it. This is the terminal rung:
reaching it without a TRDA pass transitions the loop to
`stuck-at-loop-construction` and surfaces the escalation guidance block.

Tight HITL sessions reproduce the symptom in a clean environment (fresh
checkout, no IDE state). The operator records the minimal command sequence and
then re-enters the loop at rung 1 with that sequence as the new `command`.

---

## Tighten-the-Loop Heuristics

Tight loops are the foundation of fast convergence. Apply these in order when
a loop fails TRDA or converges slowly.

### H-1: Minimize the command surface

Remove every flag, file, and argument that is not directly related to the
symptom. A tight command names the symptom in its output.

### H-2: Pin all external state

Tight loops do not read from mutable global config, live databases, or network
services unless those are the symptom source. Pin with fixtures, stubs, or
environment variables.

### H-3: Assert on exit code first

Red loops exit non-zero. If the command exits 0 even when failing, it is not
redCapable. Add an explicit assertion or switch rungs.

### H-4: Prefer speed over completeness

Tight loops run in < 10 s. A slow loop delays every iteration of the fixer.
If the fastest rung is > 10 s, escalate to a rung with a smaller surface.

### H-5: Two consecutive reds before advancing

Never mark `deterministic: true` after a single red run. The minimum is
`determinismRuns >= 2`. Three consecutive reds provide higher confidence in
environments with background noise.

### H-6: Record the red output verbatim

The `redOutput` field in `loop.toon` holds the exact stderr + stdout from the
last red run (max 64 KB, truncated with `[truncated at 64KB]`). The fixer uses
this as its ground truth. Do not summarize — preserve the raw text.

---

## Loop Lifecycle Summary

```
construction ──→ verified-red ──→ iterating ──→ green-candidate ──→ retired
     │                │                 │                                ▲
     │                ▼                 ▼                                │
     │           escape-set ──→ escape-iterating ──────────────────────→ │
     ▼
stuck-at-loop-construction (terminal until HITL intervention)
```

A loop is **retired** exactly once, after the symptom is observed green twice
in a row across a verification re-run. Retired loops are **immutable** —
queryable but never re-entered. A regression spawns a new loop with
`linkedLoops[].relation: spawned-from-symptom`.

**Re-retiring a retired loop exits `LOOP_IMMUTABLE` (exit 8).** The loop
state snapshot at retirement is preserved and queryable indefinitely.

---

## Error Codes (Loop-Relevant)

| Code | Exit | Trigger |
|------|------|---------|
| `LOOP_NOT_VERIFIED_RED` | 4 | Iteration attempted before TRDA pass |
| `STUCK_AT_LOOP_CONSTRUCTION` | 5 | Rung 10 exhausted, verifiedRed still false |
| `LOOPID_NOT_FOUND` | 6 | Read/write to a loopId that does not exist |
| `RETIRE_NOT_GREEN` | 7 | Retirement attempted before command exits 0 |
| `LOOP_IMMUTABLE` | 8 | Any write to a retired loop |
| `HARNESS_OUTPUT_INCOMPATIBLE` | 9 | Output not parseable into verified-red signal |
| `CRITERION_UNVERIFIABLE` | 10 | No rung produces a deterministic red |

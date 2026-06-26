# `loom-converge` Phase-0 Interaction Protocol (F-18)

This protocol covers the interactive Phase-0 loop-construction surface of `loom-converge` — the exact prompts and state transitions an operator sees when invoked without a verified-red `loop.toon`, and the stdout/stderr output lines that a doctest harness can assert against.

**Scope:** This document covers the TWO Phase-0 interaction states. The full 10-rung ladder, `--construct-loop` interactive walkthrough, and `stuck-at-loop-construction` recovery flow are also documented here with literal expected stdout lines. The `--criteria` mode is explicitly exempt (FC-H6) and produces NONE of the output lines documented here.

---

## State 1: "no loop.toon yet"

**Precondition:** `.plan-execution/loops/` directory does not exist OR contains no `*.toon` files.

**Trigger:** `loom-converge` is invoked without `--criteria`, without `--loop-id`, and without `--construct-loop`.

### Expected stderr output (verbatim, parseable by doctest harness)

```
errorCode: NO_LOOP_CONSTRUCTED
message: Phase 0 of loom-converge did not produce a loop.toon and no --loop-id was passed.
hint: Construct a loop with loom-converge --construct-loop or bind an existing loop with --loop-id <id>; list active loops with loom-converge --loops.
```

### Expected stdout output (verbatim, parseable by doctest harness)

```
[loom-converge] Phase 0: no verified-red loop found.
RECOMMENDATION: Start loop construction with: loom-converge --construct-loop
The 10-rung ladder (rung 1 default) will run your test/repro command twice to verify deterministic red.
```

**Exit code:** `4`

**State file:** No `loop.toon` is written. No `convergence-state.toon` changes.

---

## State 2: "loop exists, verifiedRed: false"

**Precondition:** `.plan-execution/loops/{loopId}.toon` exists with `verifiedRed: false` (the loop is in `construction` state, actively walking the 10-rung ladder).

**Trigger:** `loom-converge` is invoked without `--criteria`, without `--loop-id`, and the single existing loop is not yet verified red.

### Expected stderr output (verbatim, parseable by doctest harness)

```
errorCode: LOOP_NOT_VERIFIED_RED
message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.
hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.
```

### Expected stdout output (verbatim, parseable by doctest harness)

The `{currentRung}` and `{nextRung}` placeholders are substituted at runtime with the numeric values from `loop.toon.rung`:

```
[loom-converge] Phase 0: loop exists but not yet verified-red (rung: {currentRung}).
currentRung: {currentRung}
suggestion: Escalate with loom-converge --construct-loop --escalate-rung to try rung {nextRung}.
```

**Exit code:** `4`

**State file:** `loop.toon` is NOT modified by this output path.

---

## State 3: "stuck-at-loop-construction" (rung 10 exhausted)

**Precondition:** `loop.toon.rung == 10` and `verifiedRed: false` after a failed escalation attempt.

**Trigger:** The loop-construction step attempts rung 10 and TRDA still does not pass.

### Expected stderr output (verbatim, parseable by doctest harness)

```
errorCode: STUCK_AT_LOOP_CONSTRUCTION
message: The 10-rung ladder was exhausted without a verified-red loop.
hint: See HITL escalation guidance below.
hitlGuidance:
  state: stuck-at-loop-construction
  operatorQuestions[3]:
    - Q1: Is the symptom reproducible by a human manually running the command outside the harness?
    - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?
    - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?
  reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \"<one-sentence-reason>\""
  fallback: "If revision is not productive after 2 attempts, retire the loop with --retire-loop <loopId> and open a HITL issue."
```

**Exit code:** `5`

**State file:** `loop.toon.state` is set to `stuck-at-loop-construction`. No `convergence-state.toon` changes.

---

## State 4: "loop exists, verifiedRed: true" (gate passes)

**Precondition:** `.plan-execution/loops/{loopId}.toon` exists with `verifiedRed: true`.

**Trigger:** `loom-converge` is invoked and the gate check succeeds.

### Expected stdout output (verbatim, parseable by doctest harness)

```
[loom-converge] Phase 0: verified-red loop bound (loopId: {loopId}, rung: {rung}).
[loom-converge] All iterations will run command: {command}
```

**Exit code:** `0` (gate passes; convergence loop proceeds)

---

## State 5: "escape-set" (`--override-loop-gate` active)

**Precondition:** Operator passed `--override-loop-gate "<reason>"`.

**Trigger:** Gate is bypassed via the escape hatch.

### Expected stdout output (verbatim, parseable by doctest harness)

```
⚠ ESCAPE-SET: override-loop-gate active — escapeReason: "<reason>"
[loom-converge] Proceeding without a verified-red loop. All findings are advisory under escape mode.
```

This callout MUST appear before any convergence digest output. It is also written to the convergence digest as the first line under the run header.

**Exit code:** `0` (proceeds; escape path)

**State file:** `loop.toon.escapeReason` is set to `"<reason>"` atomically (`.tmp` + rename).

---

## `--criteria` Exemption (FC-H6)

When `loom-converge` is invoked with `--criteria`:

- **None of the above output lines are emitted.**
- **No `loop.toon` is written.**
- **No Phase-0 gate check runs.**
- The command proceeds directly to the criteria convergence path (Step 1.5C in `commands/loom-converge.md`).

This exemption is permanent and unconditional. A doctest asserting `loom-converge --criteria` MUST assert that stderr contains no `LOOP_NOT_VERIFIED_RED` and that `.plan-execution/loops/` gains no new files.

---

## TRDA Gate Summary

The Tight-Red-Deterministic-Agentrunnable (TRDA) gate is what Phase-0 construction must pass to advance from `construction` → `verified-red`. All four bits must be `true`:

| Bit | Verified by |
|-----|-------------|
| `tight` | Operator assertion (loop command exercises ONLY the symptom) |
| `redCapable` | Harness output is parseable into a red signal (exit code + structured stderr). Failure → `HARNESS_OUTPUT_INCOMPATIBLE` (exit 9). |
| `deterministic` | Two consecutive invocations both red (`determinismRuns >= 2`). |
| `agentRunnable` | A fixer agent can execute the command without HITL input. |

If `redCapable` fails during ladder traversal:

```
errorCode: HARNESS_OUTPUT_INCOMPATIBLE
message: The harness command's stdout/stderr cannot be parsed into a verified-red signal (TRDA redCapable check failed).
hint: Escalate to the next rung on the 10-rung ladder OR refactor the harness to emit a parseable red marker (exit code + structured stderr).
```

Exit code: `9`.

If the full ladder completes without a `redCapable` rung:

```
errorCode: CRITERION_UNVERIFIABLE
message: TRDA evaluation determined that no rung on the 10-rung ladder can produce a deterministic red for this criterion.
hint: Flag the criterion for human review with loom-converge --flag-criterion <id> "<reason>"; the criterion is recorded in the convergence digest and skipped from auto-iteration.
```

Exit code: `10`.

---

## Doctest Harness Notes

The literal stdout/stderr lines documented in States 1–5 above are parseable by a doctest harness. The harness:

1. Invokes the command against a fixture project directory.
2. Captures stdout and stderr separately.
3. Asserts that each **verbatim** line (after substituting `{loopId}`, `{rung}`, `{command}`, `{currentRung}`, `{nextRung}` with fixture values) appears in the appropriate stream.
4. Asserts the exit code.

The angle-bracket placeholders (`<loopId>`, `<one-sentence-reason>`) in `reviseLoopCommand` and `fallback` are LITERAL in the output — the runtime has not yet substituted them. A doctest asserting State 3 MUST match the literal strings `<loopId>` and `<one-sentence-reason>` verbatim.

# FeedbackLoop Schema (F-18 Phase B)

Defines the `FeedbackLoop` TOON artifact written by the Phase-0 loop-construction gate in `loom-converge` and the Phase-1 gate in `loom-bugfix`. A FeedbackLoop encodes a tight, verified-red, deterministic, agent-runnable signal a fixer can iterate against.

Schema version: **1**. Storage: one file per loop at `.plan-execution/loops/{loopId}.toon`. Atomic writes mandatory (`.tmp` then `fs.renameSync`).

The full lifecycle state machine lives in `planning/plans/PLAN-F-18-matt-pocock-skills.md` § State Machines / FeedbackLoop lifecycle.

---

## Schema

```toon
loopId: 7a3d6e2b-1c4f-4a98-9d12-bb7a8c1e0f33
command: bunx vitest run tests/foo.test.ts
symptom: Reducer drops the second event when batched
rung: 4
verifiedRed: true
redOutput: |
  FAIL tests/foo.test.ts > reduces batched events
    Expected: [a, b]
    Received: [a]
runtimeMs: 1830
determinismRuns: 3
retiredAt: null
parentLoopId: null
escapeReason: null

trda:
  tight: true
  redCapable: true
  deterministic: true
  agentRunnable: true

escalationHistory[2]{fromRung,toRung,reason,at}:
  1,2,"initial command non-deterministic",2026-06-25T10:12:33.000Z
  2,4,"jumped to per-test isolation",2026-06-25T10:14:21.000Z

linkedLoops[1]{loopId,relation}:
  c1f2...e9,sibling
```

---

## Field schema

| Field | Type | Constraints | Validation Rule |
|-------|------|-------------|-----------------|
| `loopId` | string (UUID v4) | primary key, required | matches `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` |
| `command` | string | required, non-empty, single shell-executable command | 1..4096 chars |
| `symptom` | string | required, one-sentence description | 1..500 chars |
| `rung` | integer | required, 1..10 | range 1..10 |
| `verifiedRed` | boolean | required | — |
| `redOutput` | string \| null | captured stderr+stdout when `verifiedRed=true` | max 64KB; truncate with marker `[truncated at 64KB]` |
| `runtimeMs` | integer | wall-time of last red verification | >= 0 |
| `determinismRuns` | integer | consecutive red runs observed | >= 2 required to pass TRDA `deterministic` |
| `retiredAt` | string (ISO 8601) \| null | set when symptom green twice in a row | null until retirement; immutable after set |
| `parentLoopId` | string (UUID v4) \| null | FK → FeedbackLoop.loopId | — |
| `escapeReason` | string \| null | populated by `--override-loop-gate "<reason>"` | min 8 chars when set |
| `trda` | object | required, four booleans | `{tight, redCapable, deterministic, agentRunnable}` — ALL four MUST be true to pass the gate |
| `escalationHistory[]` | typed array | append-only audit log | rows: `{fromRung:int, toRung:int, reason:string, at:ISO8601}` |
| `linkedLoops[]` | typed array | sibling/child relations | rows: `{loopId:UUID, relation:child\|sibling\|spawned-from-symptom}` |

---

## TRDA gate

The Tight-Red-Deterministic-Agentrunnable gate is the single gate Phase-0 loop construction must pass:

| Bit | Means | Verification |
|-----|-------|--------------|
| `tight` | Command exercises ONLY the symptom — no upstream noise. | Operator-asserted; failures surface as `rung` escalations. |
| `redCapable` | Harness output is parseable into a verified-red signal (exit code + structured stderr). | Failure → `HARNESS_OUTPUT_INCOMPATIBLE` (exit 9). |
| `deterministic` | Two consecutive invocations both red. | `determinismRuns >= 2`. |
| `agentRunnable` | A fixer agent can execute the command without HITL input. | Operator-asserted; flaky env → escalate rung. |

All four MUST be `true` for the loop to advance from `construction` → `verified-red`.

---

## Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_loop` | loopId | PRIMARY | Row lookup |
| `idx_loop_parent` | parentLoopId | INDEX | Walk loop trees |
| `idx_loop_retired` | retiredAt | INDEX | `--loops` table filters active vs retired |

---

## Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| FeedbackLoop (parent) | FeedbackLoop (child via `parentLoopId`) | SET NULL | CASCADE |
| FeedbackLoop | FeedbackLoop (linkedLoops[].loopId) | SET NULL | CASCADE |

---

## Retirement Ceremony

A loop is retired exactly once, after the symptom has been observed green twice in a row across a verification re-run. The ceremony has four steps:

1. **First-green observation.** The fixer's `command` exits 0. State advances to `green-candidate`.
2. **Verification re-run.** `loom-converge` (or `loom-bugfix`) re-runs the `command` against a clean working tree. If red, state reverts to `iterating`.
3. **Retire write.** On the second green, the converger writes `retiredAt: <ISO 8601>` and flips `idx_loop_retired`. The write is atomic.
4. **Convergence digest entry.** The retired loop is summarised in the convergence digest with `loopId`, `rung`, `runtimeMs`, and total iteration count.

After retirement the loop is **immutable** — queryable but never re-entered. A regressed symptom spawns a new loop (with `linkedLoops[].relation: spawned-from-symptom` pointing at the retired predecessor).

---

## Error codes

See `planning/plans/PLAN-F-18-matt-pocock-skills.md` § Error Handling Specification for the full registry. Loop-relevant codes:

- `LOOP_NOT_VERIFIED_RED` (exit 4)
- `NO_LOOP_CONSTRUCTED` (exit 4)
- `STUCK_AT_LOOP_CONSTRUCTION` (exit 5)
- `LOOPID_NOT_FOUND` (exit 6)
- `RETIRE_NOT_GREEN` (exit 7)
- `LOOP_IMMUTABLE` (exit 8)
- `HARNESS_OUTPUT_INCOMPATIBLE` (exit 9)
- `CRITERION_UNVERIFIABLE` (exit 10)

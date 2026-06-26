---
pageId: protocol-feedback-loop
category: protocol
tags[5]: feedback-loop,TRDA,schema,retirement-ceremony,loom-converge
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Defines the FeedbackLoop TOON artifact — UUID-keyed loop envelope with TRDA gate (tight+redCapable+deterministic+agentRunnable), 10-rung escalation ladder, and a two-pass retirement ceremony.
estimatedTokens: 1000
bodySections[5]: Summary,Schema Overview,TRDA Gate,Retirement Ceremony,Error Codes
relatedFiles[2]:
  protocols/feedback-loop.schema.md
  skills/feedback-loop/SKILL.md
crossRefs[3]{pageId,relationship}:
  state-machine-feedback-loop,implements
  feature-f18-mattpocock-skills-adoption,implemented-by
  protocol-codebase-design,relates-to
---

## Summary

The `FeedbackLoop` schema (introduced in F-18 Phase B) is the on-disk TOON artifact that encodes a tight, verified-red, deterministic, agent-runnable reproduction signal. Every `loom-converge` and `loom-bugfix` iteration binds to exactly one `loopId`. Schema source of truth: `protocols/feedback-loop.schema.md`. Schema version: **1**.

## Storage

One file per loop at `.plan-execution/loops/{loopId}.toon`. Writes are atomic (`.tmp` then `fs.renameSync`).

## Schema Overview

| Field | Type | Key Constraint |
|-------|------|----------------|
| `loopId` | UUID v4 | primary key, immutable |
| `command` | string | 1..4096 chars, single shell-executable command |
| `symptom` | string | 1..500 chars, one-sentence description |
| `rung` | integer | 1..10, current ladder rung |
| `verifiedRed` | boolean | required |
| `redOutput` | string\|null | max 64 KB; truncated with `[truncated at 64KB]` |
| `runtimeMs` | integer | ≥ 0 |
| `determinismRuns` | integer | ≥ 2 required for TRDA `deterministic` bit |
| `retiredAt` | ISO 8601\|null | immutable once set |
| `parentLoopId` | UUID\|null | FK → FeedbackLoop.loopId |
| `escapeReason` | string\|null | min 8 chars; set by `--override-loop-gate` |
| `trda` | object | `{tight, redCapable, deterministic, agentRunnable}` |
| `escalationHistory[]` | typed array | `{fromRung, toRung, reason, at}` |
| `linkedLoops[]` | typed array | `{loopId, relation: child\|sibling\|spawned-from-symptom}` |

## TRDA Gate

The Tight-Red-Deterministic-Agentrunnable gate is the single gate Phase-0 must pass before a loop leaves `construction` and enters `verified-red`. All four bits must be simultaneously `true`.

| Bit | Meaning | Failure path |
|-----|---------|--------------|
| `tight` | Command exercises only the symptom — no upstream noise. | Escalate rung. |
| `redCapable` | Harness output parseable into verified-red (structured stderr + non-zero exit). | `HARNESS_OUTPUT_INCOMPATIBLE` (exit 9). |
| `deterministic` | Two consecutive invocations both red (`determinismRuns >= 2`). | Rerun and verify. |
| `agentRunnable` | A fixer agent can execute the command without HITL input. | Escalate rung; or HITL bash (rung 10). |

An operator may bypass the gate via `--override-loop-gate "<reason>"` (≥ 8 chars). The `escapeReason` is written to `loop.toon` and flagged in the convergence digest.

## Retirement Ceremony

A loop is retired exactly once, after the symptom is observed green twice in a row:

1. **First-green observation** — command exits 0; state advances to `green-candidate`.
2. **Verification re-run** — `loom-converge`/`loom-bugfix` re-runs against a clean working tree. If red, state reverts to `iterating`.
3. **Retire write** — on second green, writes `retiredAt: <ISO 8601>` atomically.
4. **Convergence digest entry** — retired loop summarised with `loopId`, `rung`, `runtimeMs`, and total iteration count.

After retirement the loop is **immutable**. A regressed symptom spawns a new loop with `linkedLoops[].relation: spawned-from-symptom`.

## Error Codes

| Code | Exit | Trigger |
|------|------|---------|
| `LOOP_NOT_VERIFIED_RED` | 4 | Iteration before TRDA pass |
| `NO_LOOP_CONSTRUCTED` | 4 | Phase-0 absent and `--loop-id` not passed |
| `STUCK_AT_LOOP_CONSTRUCTION` | 5 | Rung 10 exhausted, TRDA still false |
| `LOOPID_NOT_FOUND` | 6 | `--loop-id` references non-existent file |
| `RETIRE_NOT_GREEN` | 7 | Retirement attempted while symptom still red |
| `LOOP_IMMUTABLE` | 8 | Write to a retired loop |
| `HARNESS_OUTPUT_INCOMPATIBLE` | 9 | Output not parseable into verified-red signal |
| `CRITERION_UNVERIFIABLE` | 10 | No rung produces a deterministic red |

## Related Pages

- [FeedbackLoop state machine](state-machine-feedback-loop.md)
- [F-18 feature overview](feature-f18-mattpocock-skills-adoption.md)

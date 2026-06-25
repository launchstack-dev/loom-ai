```toon
pageId: component-roadmap-converge-driver
title: Roadmap Converge Driver
category: component
domain: code
createdAt: 2026-06-17T00:00:00Z
updatedAt: 2026-06-17T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Per-pass driver orchestrating content-hash check, per-dimension reviewer fan-out, 5-finding cap, integrator/stall/pass-cap handling, and three user-facing /loom-roadmap commands.
estimatedTokens: 1100
bodySections[6]: Summary, Commands, Pipeline, State Machine, Error Codes, Configuration
subtype:
sourceRefs[8]: planning/plans/PLAN-roadmap-converge-harness.md, scripts/roadmap-converge/driver.ts, scripts/roadmap-converge/integrator.ts, scripts/roadmap-converge/stall-detector.ts, commands/loom-roadmap/converge.md, commands/loom-roadmap/sign-off.md, commands/loom-roadmap/status.md, agents/roadmap-converge-driver.md
crossRefs[5]{pageId,relationship}:
  concept-roadmap-convergence,implements
  component-roadmap-converge-state,relates-to
  decision-sign-off-purity,decided-by
  decision-archetype-rubrics,relates-to
  concept-convergence,relates-to
tags[7]: roadmap, driver, commands, state-machine, F-15, M-07, pipeline
staleness: fresh
confidence: high
```

# Roadmap Converge Driver

## Summary

The driver is the orchestration spine for F-15. It owns the pass loop, dispatches per-dimension reviewer agents, enforces the 5-finding output cap, threads integrator/stall/pass-cap halt logic, and renders the digest. Three user-facing commands sit on top of it; one agent (`roadmap-converge-driver.md`) wraps the entry point; the agent for cold-start archetype detection plugs in via a typed `archetypeDetectionHook` seam.

## Commands

### `/loom-roadmap converge`

Run one pass. Args:

| Flag | Default | Purpose |
|------|---------|---------|
| `--roadmap <path>` | `planning/ROADMAP.md` | Target roadmap; state at `.roadmap-converge/{slug}/state.toon` |
| `--pass-cap <N>` | `[roadmap.converge] maxPasses` or 3 | Per-invocation override; max 5 |
| `--force` | false | Bypass stale-lock check (≤ 10 min) |

Exit codes: `0` pass completed (questions to answer OR sign-off eligible), `1` halted (cap / blockers / lock), `2` schema-version drift.

### `/loom-roadmap sign-off`

The ONLY path to `converged`. Lives in its own file (`commands/loom-roadmap/sign-off.md`); CI grep guard ensures no other code path writes `sign_off_state = "signed-off"`. Renders a `git diff` between `state.sign_off_diff_hash` (or initial) and now, paged, with empty-diff and no-pager fallbacks.

Args: `--roadmap`, `--yes` (skip interactive confirm; still requires explicit CLI invocation).

### `/loom-roadmap status`

Pure read; renders `RoadmapConvergeDigest` from `state.toon`. `--all` scans `.roadmap-converge/*/state.toon` and emits one digest per slug. Vitest grep guard enforces zero writes from status.md / digest.ts.

## Pipeline

```
/loom-roadmap converge
    ↓
acquireLock({pid, started_at})              ← stale (> 10 min) auto-cleared
    ↓
contentHashCheck(ROADMAP.md, state.content_hash)
    ↓ (mismatch → flag all dimensions delta_since_last = invalidated + stderr notice)
fanOut: roadmap-converge-reviewer × dimensions[]      ← model = reviewerModel (sonnet)
    ↓ each reviewer sees ONLY its dimension's evidenceRef[] + rubric file
renderByStatus:
    green  → emit nothing
    yellow → emit green-band exemplar inline with finding
    red    → emit green-band + red-band exemplars inline with finding
    ↓
cap5Findings(findings) → state.open_questions[]
overflow → state.suppressedFindings[] + stderr "N suppressed"
    ↓
writeStateAtomic(.tmp + rename)
releaseLock
    ↓
emitDigest → stderr
```

Re-invocation after user answers questions enters the integrator pass: `roadmap-converge-integrator` agent reads resolved `open_questions[]` (those with non-empty `resolution`), applies surgical edits to ROADMAP.md, increments `state.round`, recomputes `content_hash`.

## State Machine

Ten states; details in `concept-roadmap-convergence` and the plan. Notable transitions:

| From | To | Trigger |
|------|----|---------|
| init | pass-in-progress | `/loom-roadmap converge` |
| pass-in-progress | batched-questions | reviewer findings non-empty |
| pass-in-progress | sign-off-eligible | findings empty AND all green |
| batched-questions | user-input | driver returns to user |
| user-input | integrator-pass | re-invocation after questions resolved |
| integrator-pass | dimensions-updated | mutator applies resolutions |
| dimensions-updated | pass-in-progress | not yet all-green; round < passLimit |
| dimensions-updated | halted-pass-cap | round == passLimit, not all-green |
| dimensions-updated | halted-stalled | two passes identical statuses, no resolved questions |
| sign-off-eligible | converged | `/loom-roadmap sign-off` (only path) |

Terminal: `converged`, `halted-pass-cap`, `halted-stalled`.

## Error Codes

| Code | Exit | When |
|------|------|------|
| LOCK_CONFLICT | 1 | Concurrent converge; lock < 10 min |
| CONTENT_HASH_MISMATCH | 0 (advisory) | User manually edited ROADMAP.md between passes |
| ARCHETYPE_LOW_CONFIDENCE | 1 | Cold-start cannot pick a default |
| SIGNOFF_NOT_ELIGIBLE | 1 | sign-off precondition failed |
| SCHEMA_VERSION_DRIFT | 2 | state.toon newer than runtime; no downgrade path |
| ROADMAP_NOT_FOUND | 1 | `--roadmap <path>` missing |
| PASS_CAP_REACHED | 1 | round == passLimit |
| STALL_DETECTED | 1 | Two passes identical statuses + no resolved |
| RUBRIC_MISSING | 1 | DimensionDef.rubricRef does not resolve |
| EVIDENCE_REF_BROKEN | 0 (warning) | Anchor in evidenceRef[] no longer resolves |

All errors emit a one-line stderr message AND a structured `.roadmap-converge/{slug}/last-error.toon` envelope for resumability.

## Configuration

`.claude/orchestration.toml`:

```toml
[roadmap.converge]
maxPasses = 3                 # default 3; clamped to [1, 5]
defaultRoadmap = "planning/ROADMAP.md"
stateRoot = ".roadmap-converge"
lockStaleSeconds = 600        # 10 min; MUST be ≥ 60
reviewerModel = "sonnet"
driverModel = "opus"
retire = ["tool-selection"]   # per-project dimension skip-list

[roadmap.converge.rubricOverrides]
# "vision" = "protocols/roadmap-rubrics/vision-strict.md"
```

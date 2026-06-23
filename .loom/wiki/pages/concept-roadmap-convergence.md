```toon
pageId: concept-roadmap-convergence
title: Roadmap Convergence
category: concept
domain: code
createdAt: 2026-06-17T00:00:00Z
updatedAt: 2026-06-17T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Subjective convergence loop that drives ROADMAP.md toward sign-off via review → batched-question → mutate cycles graded against per-dimension rubrics.
estimatedTokens: 600
bodySections[4]: Summary, Loop Shape, Dimensions and Rubrics, Relation to Code Convergence
subtype:
sourceRefs[1]: planning/plans/PLAN-roadmap-converge-harness.md
crossRefs[4]{pageId,relationship}:
  concept-convergence,relates-to
  component-roadmap-converge-driver,implemented-by
  component-roadmap-converge-state,implemented-by
  decision-sign-off-purity,decided-by
tags[6]: roadmap, convergence, F-15, M-07, dimensions, rubrics
staleness: fresh
confidence: high
```

# Roadmap Convergence

## Summary

Roadmap convergence is the **subjective sibling** of code convergence. Where code convergence drives outputs to exactly match deterministic targets (`SOURCE == TARGET`), roadmap convergence drives a `planning/ROADMAP.md` toward a state where every documented dimension (vision, milestones, tool-selection, data-model, success-metrics, constraints, risks, out-of-scope) is graded **green** against a pedagogical rubric, and the user has explicitly signed off.

Implemented as F-15 / M-07. Ships three commands — `/loom-roadmap converge`, `/loom-roadmap sign-off`, `/loom-roadmap status` — and a durable state file per roadmap at `.roadmap-converge/{slug}/state.toon`.

## Loop Shape

```
[init/round=0] → [pass-in-progress] → [batched-questions] → [user-input]
                                  ↘                              ↓
                                   [sign-off-eligible] ← [integrator-pass]
                                              ↓
                                       [converged]   ← /loom-roadmap sign-off
```

Each pass:

1. **Content-hash check** — sha256 of ROADMAP.md compared to `state.content_hash`. Mismatch flags every dimension as `delta_since_last = invalidated` and prints a one-line diff notice.
2. **Reviewer fan-out** — one `roadmap-converge-reviewer` agent per dimension (model `sonnet`). Each reviewer sees only its dimension's section anchors plus its rubric file.
3. **5-finding cap** — driver hard-caps reviewer output at 5 findings per pass at the output layer; overflow rows append to `suppressedFindings[]` with a `"N suppressed"` stderr footer.
4. **State write + batched questions** — open questions written into `state.open_questions[]` (max 5 per pass), `paused_at` set, lock released, control returned to the user.
5. **Integrator pass** — when user re-runs `/loom-roadmap converge` after answering, the `roadmap-converge-integrator` agent applies resolutions as surgical ROADMAP.md edits (atomic via `.tmp` + rename).

Halt conditions: `halted-pass-cap` (round == passLimit, default 3, max 5), `halted-stalled` (two successive passes with identical dimension statuses and no resolved questions). The stall check is **skipped when the pass converged** (all dimensions green and no unresolved questions) — convergence is success, not stall.

## Dimensions and Rubrics

Eight MVP default dimensions, each backed by a pedagogical rubric file at `agents/protocols/roadmap-rubrics/{name}.md` with exactly three required sections (`## Green`, `## Yellow`, `## Red`):

- `vision`, `milestones`, `tool-selection`, `data-model`, `success-metrics`, `constraints`, `risks`, `out-of-scope`

Reviewer rendering dispatches on dimension status: green emits nothing, yellow emits the green-band exemplar inline with the finding, red emits both green and red exemplars inline.

Archetypes (`cli`, `web-app`, `library`, `data-pipeline`, `research`, `default`) select the active `RoadmapReadinessSchema`. The `roadmap-archetype-detector` agent runs on cold-start and presents a confirm-or-correct prompt with the best-guess default-highlighted.

## Relation to Code Convergence

| Axis | Code convergence | Roadmap convergence |
|------|------------------|---------------------|
| Truth source | Golden file / acceptance criteria | Reviewer judgment against rubric |
| Loop body | fixer-agent applies code edits | integrator-agent applies ROADMAP edits |
| Termination | `SOURCE == TARGET` within tolerance | All dimensions green + zero unresolved + explicit user sign-off |
| Auto-terminating | Yes (delta == 0) | No — `converged` is reachable ONLY via `/loom-roadmap sign-off` |
| Halt budget | `maxIterations` | `[roadmap.converge] maxPasses` (default 3, max 5) |

The shape is duplicated for v1; sharing a common core with `/loom-converge` is explicitly deferred per the F-15 open product question.

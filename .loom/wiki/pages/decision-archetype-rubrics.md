```toon
pageId: decision-archetype-rubrics
title: Archetype-Selected Pedagogical Rubrics
category: decision
domain: code
createdAt: 2026-06-17T00:00:00Z
updatedAt: 2026-06-17T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Per-dimension green/yellow/red rubric files selected by detected project archetype, with status-conditional inline rendering and per-project retire/override hooks.
estimatedTokens: 550
bodySections[3]: Summary, Rationale, Alternatives Considered
subtype:
sourceRefs[4]: planning/plans/PLAN-roadmap-converge-harness.md, agents/protocols/roadmap-readiness.schema.toon, agents/protocols/roadmap-archetypes.toon, agents/protocols/roadmap-rubrics/
crossRefs[3]{pageId,relationship}:
  concept-roadmap-convergence,decides
  component-roadmap-converge-state,relates-to
  component-roadmap-converge-driver,relates-to
tags[6]: archetype, rubric, dimensions, pedagogy, F-15, M-07
staleness: fresh
confidence: high
```

# Archetype-Selected Pedagogical Rubrics

## Summary

Each roadmap dimension (vision, milestones, tool-selection, data-model, success-metrics, constraints, risks, out-of-scope) is graded by a reviewer agent against a **pedagogical rubric file** that defines what `## Green`, `## Yellow`, and `## Red` look like for that dimension. Rubric files live at `agents/protocols/roadmap-rubrics/{name}.md` and ship green/yellow/red exemplars verbatim — not heuristics or scores.

Which rubric set applies is selected by **archetype**: `cli`, `web-app`, `library`, `data-pipeline`, `research`, or `default`. The `roadmap-archetype-detector` agent runs on cold-start (reading CLAUDE.md, manifest files), presents a confirm-or-correct prompt with the best-guess default-highlighted, and writes the resolved archetype into `state.archetype`. The MVP ships eight default-archetype rubrics; per-archetype overrides land via `[roadmap.converge.rubricOverrides]` in `.claude/orchestration.toml`.

**Status-conditional rendering** dispatches at the driver's per-dimension renderer:

- `green` → emit nothing
- `yellow` → emit the green-band exemplar inline with the finding
- `red` → emit both the green-band and red-band exemplars inline with the finding

Per-project escape hatches:

- `retire = ["tool-selection"]` in `[roadmap.converge]` skips dimensions entirely (recorded in `state.archivedDimensions[]`).
- `rubricOverrides` swaps individual rubric files per dimension without forking the default set.

## Rationale

Roadmap quality is judgment, not arithmetic. A numeric "score this dimension 1-10" rubric would force reviewers to pick a number and then justify it backward; the resulting variance across model versions and prompt edits would erode trust. Showing the reviewer concrete green / yellow / red exemplars from the rubric file and asking "which band does this roadmap section land in?" produces calibrated, comparable judgments because the calibration anchors are visible.

Status-conditional rendering keeps reviewer prompts cheap when things are working: a green dimension burns zero exemplar tokens. When something is wrong, the user sees both what good looks like (the green band) and what their roadmap currently looks like (the red band), which makes the gap actionable rather than abstract.

Archetype selection exists because the same dimension means different things to different projects. "Success metrics" for a CLI looks like exit codes and command counts; for a data pipeline it looks like throughput and freshness SLOs. Forcing one universal rubric per dimension would either be uselessly vague or hostile to half the project types. The 5-archetype enumeration plus `default` is a deliberate floor that keeps the surface small while admitting per-project overrides for the long tail.

Retiring a dimension is a release-valve for the stall trap: if a project genuinely doesn't care about, say, `tool-selection` (it's a research notebook), the dimension can be archived rather than perpetually stuck yellow.

## Alternatives Considered

- **Numeric scoring (0-100).** Rejected: variance across model runs would dominate the signal; users couldn't compare passes.
- **One universal rubric per dimension, no archetypes.** Rejected: vagueness made it useless for half the project types we sampled.
- **Free-form reviewer prompts with no rubric file.** Rejected: drift between passes; no calibration anchor; impossible to audit.
- **Embed rubrics inside the schema TOON.** Rejected: rubrics need rich prose with markdown headers; storing them as markdown files makes them human-editable and per-project overridable.
- **Auto-retire stuck dimensions.** Rejected: silently dropping a dimension hides project drift. Explicit `retire = [...]` in config makes the decision visible and reviewable.

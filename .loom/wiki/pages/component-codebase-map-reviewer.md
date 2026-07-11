---
pageId: component-codebase-map-reviewer
category: component
subtype: ""
tags[4]: M-09,cartography,F-21,reviewer-agent
lastUpdated: 2026-07-08T00:00:00Z
updatedAt: 2026-07-08T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: codebase-map-reviewer is the M-09 sonnet-tier reviewer agent that marks module coverage in the codebase map via the existing /loom-converge fan-out, driving coverage to 1.0 without introducing a new loop primitive (C-13).
estimatedTokens: 420
bodySections[3]: Summary,Constraints,References
relatedFiles[1]:
  agents/codebase-map-reviewer.md
crossRefs[4]{pageId,relationship}:
  feature-m09-cartography-foundation,implements
  command-loom-map,exercised-by
  contract-map-artifact-schema,consumes
  component-context-budget,relates-to
---

## Summary

`codebase-map-reviewer` is the reviewer agent introduced in M-09 Phase 2 (Wave 2). It participates in the `/loom-converge` reviewer fan-out spawned by `/loom-map build`/`refresh`. On each convergence pass it marks module coverage on the in-progress `codebase-map.toon`, signalling consensus when all in-scope modules are covered (`coverage == 1.0`).

The agent is registered in `orchestration.toml [review]` per D-01 (never hardcoded). It is not spawned directly — only `/loom-map` invokes it through the existing `/loom-converge` machinery.

## Constraints

- `model: sonnet` frontmatter (no fable/Mythos tier per memory rule).
- Stays within the 100k spawn cap enforced by `hooks/lib/token-estimator.ts` (C-11).
- Consumes `protocols/map-artifact.schema.md` and reads the in-progress map from `.loom/maps/codebase-map.toon`.
- Does NOT write new map files (write ownership belongs to `/loom-map`).
- Convergence is bounded (no unbounded loop); non-consensus after cap → `MAP_CONVERGE_FAILED` + surplus gaps to `.loom/learnings.toon`.

## References

- Agent file (planned): `agents/codebase-map-reviewer.md`
- Registration: `.claude/orchestration.toml [review] codebase-map-reviewer`
- Schema: `protocols/map-artifact.schema.md`
- Invoked via: `/loom-map` → `/loom-converge`

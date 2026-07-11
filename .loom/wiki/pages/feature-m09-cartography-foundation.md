---
pageId: feature-m09-cartography-foundation
category: feature
tags[7]: M-09,cartography,loom-map,map-artifact,F-20,F-21,F-22,F-23,C-17
lastUpdated: 2026-07-11T00:00:00Z
updatedAt: 2026-07-11T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: M-09 Cartography Foundation (C-17 reconciled) ports CT6's map front-end into Loom — serializing the integration cross-ref graph, adding /loom-map, and stamping lastMappedCommit on writes; the mapStale flip is fork-owned (PR #42 Track A). Blocked until M-06 Phase 2 (C-16).
estimatedTokens: 1100
bodySections[6]: Summary,Features,C-17 Scope Reconciliation,Execution Blocked Until M-06 Phase 2,Build Order,References
relatedFiles[2]:
  planning/plans/PLAN-ct6-cartography.md
  planning/ROADMAP.md
crossRefs[7]{pageId,relationship}:
  contract-map-artifact-schema,implements
  command-loom-map,implements
  component-codebase-map-reviewer,implements
  component-map-freshness-hook,implements
  component-hooks-system,relates-to
  convention-toon-format,relates-to
  decision-f30-partition-check-no-waiver,relates-to
---

## Summary

M-09 Cartography Foundation (planVersion 2, 6 phases / 4 waves) ports CT6's map surface into Loom over existing primitives — no SQLite, no daemon (C-11). It introduces four net-new features: F-20 (integration-map serialization), F-21 (/loom-map command), F-22 (map freshness hook — producer-side only, post-C-17), F-23 (map precondition gate). All map artifacts are TOON-on-disk with atomic writes. The only net-new command is `/loom-map` (C-13).

**EXECUTION BLOCKED UNTIL M-06 PHASE 2 (C-16).** Maps are a retention lever, not an acquisition lever; activating them ahead of an unproven launch starves the only A-priority and ships a first-run wall to brand-new installers. The orchestrator MUST refuse `/loom-plan execute` until M-06 Phase 2 clears.

## Features

| Feature | Short description | Wave | C-17 status |
|---------|-------------------|------|-------------|
| F-20 | Integration-map serialization — `wiki-maintainer-agent` serializes its 8-relation cross-ref graph to `integration-map.toon` on every maintenance pass | Wave 1 | SURVIVES |
| F-21 | `/loom-map` command — build + status/diff/resolve/refresh; drives coverage to 1.0 via `/loom-converge` fan-out | Wave 2 | SURVIVES |
| F-22 | Map freshness hook — PreToolUse producer-side stamping: stamps `lastMappedCommit` + optional `mapContentSha` on write; the `mapStale` flip is fork-owned (PR #42 Track A) | Wave 3 | SURVIVES (collapsed to producer-side stamping + path reconcile) |
| F-23 | Map precondition gate — warn-first auto-invoking fail-closed gate on `/loom-plan create` and `/loom-converge` | Wave 3 | SURVIVES |

## C-17 Scope Reconciliation

C-17 (fable-readiness reconciliation layer) narrowed M-09's scope in two areas:

**F-22 scope collapse (most significant):** M-09 builds the **producer side only** — stamping `lastMappedCommit` on every map write. The `mapStale` flip logic ships in the fork's `hooks/map-freshness.ts` (PR #42 Track A, already shipped), not in this branch. This avoids rebuilding fork code and establishes a clean producer/gate split.

**C-26 new integration criterion:** Verifies that the producer write-path (`.loom/wiki/maps/*.toon` on this branch) matches the fork gate read-path. A path mismatch would leave the fork gate dormant — silently allowing everything because it never finds a `lastMappedCommit` to check. C-26 is an integration-tier criterion verified against the merged fork.

**Freshness model (CWE-345):** `mapStale` is advisory-cache-only. Gates MUST derive freshness from git (`diff HEAD vs lastMappedCommit`; non-ancestor ⇒ stale-by-default). See `contract-map-artifact-schema` § Integrity and Freshness Model.

**M-09 acceptance (amended):** M-09 delivers maps carrying `lastMappedCommit`; the fork's shipped freshness hook reads that stamp to flip `mapStale`. The acceptance criterion does NOT assert the flip as an M-09 deliverable.

## Execution Blocked Until M-06 Phase 2

C-16 freeze: no M-09 phase may begin until M-06 OSS launch completes its Phase 2 gate (public launch + 5-stranger cold-install demand test). The plan is captured-not-executable; the orchestrator enforces this.

## Build Order

Wave 0 (Phase 0): contracts-agent extracts shared surfaces (`MapArtifact` schema, `map-state.ts`, `.loom/wiki/maps/` directory, `orchestration.toml` gates seam).

Wave 1 (Phase 1): F-20 integration-map serialization wired into `wiki-maintainer-agent`.

Wave 2 (Phase 2): F-21 `/loom-map` command + `codebase-map-reviewer` agent.

Wave 3 (Phases 3+4): F-23 gate and F-22 **producer-side stamping** run in parallel; Phase 5 (wiring-agent) closes the dogfood loop, verifies C-26 (write-path == fork-gate read-path), and lands the README section.

## References

- Canonical plan: `planning/plans/PLAN-ct6-cartography.md`
- Key contracts: C-11 (TOON + atomic writes), C-13 (no new loop primitive), C-15 (warn-first fail-closed), C-16 (M-06 Phase 2 gate), C-17 (fable-readiness reconciliation), C-26 (producer write-path == fork gate read-path)
- MapArtifact schema (planned): `protocols/map-artifact.schema.md`
- Maps directory (planned): `.loom/wiki/maps/`
- Fork (Track A): PR #42 — ships `hooks/map-freshness.ts` (mapStale flip), `agents/adversary-agent.md`, `hooks/lib/revalidation.ts`, evolved `quality-gate.ts`
- Locked design decision: F-30 partition-check fail-closed with no waiver (see `decision-f30-partition-check-no-waiver`)

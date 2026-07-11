---
pageId: command-loom-map
category: command
subtype: ""
tags[5]: M-09,loom-map,cartography,F-21,slash-command
lastUpdated: 2026-07-08T00:00:00Z
updatedAt: 2026-07-08T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Net-new /loom-map slash command (F-21) builds convergence-reviewed codebase and route maps, and exposes status/diff/resolve/refresh read-only verbs; the only net-new command in M-09 (C-13).
estimatedTokens: 760
bodySections[4]: Summary,Verbs,Contracts,References
relatedFiles[1]:
  commands/loom-map.md
crossRefs[5]{pageId,relationship}:
  feature-m09-cartography-foundation,implements
  contract-map-artifact-schema,consumes
  component-codebase-map-reviewer,exercises
  component-map-freshness-hook,relates-to
  component-hooks-system,relates-to
---

## Summary

`/loom-map` is the net-new slash command shipped in M-09 Phase 2 (Wave 2). It produces and queries the first-class codebase/route map by: (1) extracting `mod://` nodes for every top-level source directory; (2) writing `codebase-map.toon` + `route-map.toon` atomically; (3) refreshing the integration-map (owned by `wiki-maintainer-agent`); and (4) driving map coverage to `1.0` via the existing `/loom-converge` reviewer fan-out — no new loop primitive (C-13).

`/loom-map` exclusively owns `codebase-map.toon` and `route-map.toon`. It only consumes/refreshes `integration-map.toon` (owned by `wiki-maintainer-agent`). All writes are atomic `.tmp`+rename.

## Verbs

| Verb | Write? | Description |
|------|--------|-------------|
| *(default / `build`)* | Yes | Extract nodes, write maps, fan-out `codebase-map-reviewer` until `coverage == 1.0` |
| `refresh` | Yes | Rebuild + clear `mapStale`, update `lastMappedCommit` to HEAD |
| `status` | No | Report fresh/stale + coverage without rebuild |
| `diff [--since <commit>]` | No | Added/removed/changed `mod://` nodes since `lastMappedCommit` or `--since` |
| `resolve <path-or-id>` | No | Node lookup; exit non-zero + `MAP_NODE_UNRESOLVED` if absent |

**Read-only verbs** (`status`, `diff`, `resolve`) never write artifacts or spawn reviewers (META tier).

**Wiki bridge:** `mod://` nodes with no corresponding `component-*` wiki page are surfaced to `wiki-maintainer-agent` as ingestion candidates, preventing map↔wiki drift (mirrors F-10).

## Contracts

- **C-11**: no SQLite, no daemon; TOON-on-disk with atomic writes.
- **C-13**: `/loom-map` is the only net-new command in M-09.
- **C-15**: ships `warn`-first; auto-invokes and proceeds on success; fails closed only if the auto-build fails.
- **L-002**: all flags (`--reviewers`, `--since`, `--skip-map-gate`) conform to the canonical-flag convention.
- **Escape**: `--skip-map-gate "<reason>"` proceeds and writes the reason to `.plan-execution/` state and `DECISIONS.md`.
- **Bounded convergence**: reviewer iterations are capped; surplus gaps route to `.loom/learnings.toon` (`MAP_CONVERGE_FAILED`).

## References

- Command file (planned): `commands/loom-map.md`
- Maps directory (planned): `.loom/maps/`
- Schema: `protocols/map-artifact.schema.md`
- Reviewer: `agents/codebase-map-reviewer.md`

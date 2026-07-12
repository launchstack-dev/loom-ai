---
pageId: contract-map-artifact-schema
category: contract
contractType: schema
subtype: schema
tags[6]: M-09,map-artifact,TOON,schema,cartography,CWE-345
lastUpdated: 2026-07-11T00:00:00Z
updatedAt: 2026-07-11T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: MapArtifact is the TOON-on-disk schema for all map files under .loom/maps/; defines kind/path/lastMappedCommit/mapStale/staleThreshold/coverage/mapContentSha/edgeTypes[]/nodes[]/edges[] with per-file two-writer ownership, atomic writes, and git-derived freshness (CWE-345).
estimatedTokens: 1340
bodySections[4]: Summary,Shape,Invariants,Integrity and Freshness Model
authorityFile: protocols/map-artifact.schema.md
producers[1]: wiki-maintainer-agent
consumers[3]: command-loom-map,component-map-freshness-hook,component-codebase-map-reviewer
compatibilityPolicy: none
relatedFiles[1]:
  protocols/map-artifact.schema.md
crossRefs[6]{pageId,relationship}:
  feature-m09-cartography-foundation,produced-by
  command-loom-map,consumed-by
  component-map-freshness-hook,consumed-by
  component-codebase-map-reviewer,consumed-by
  convention-toon-format,relates-to
  decision-f30-partition-check-no-waiver,relates-to
---

## Summary

`MapArtifact` is the single net-new entity introduced in M-09. It is a TOON file under `.loom/maps/`, owned per-file by two writers: `wiki-maintainer-agent` owns `integration-map.toon` (kind `integration`); `/loom-map` owns `codebase-map.toon` and `route-map.toon` (kinds `codebase`/`route`). The schema is authoritative at `protocols/map-artifact.schema.md` (created in Wave 0). All writes MUST use atomic `.tmp`+rename.

`endpoint-trace` is a forward-declared `kind` for M-11 (F-28) — M-09 emits `codebase`/`route`/`integration` only.

## Shape

```toon
kind: codebase
path: .loom/maps/codebase-map.toon
lastMappedCommit: 0000000000000000000000000000000000000000
mapStale: false
staleThreshold: 10
coverage: 1.0
mapContentSha: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
edgeTypes[4]: imports, calls, routes-to, renders
nodes[N]{id,kind,path,label}:
  mod://hooks/lib,module,hooks/lib,Hook shared libraries
  mod://agents,module,agents,Agent definitions
edges[M]{from,to,type}:
  mod://agents,mod://hooks/lib,imports
```

| Field | Type | Constraints |
|-------|------|-------------|
| kind | enum | `codebase`, `route`, `integration`, `endpoint-trace` (M-09 emits first three only) |
| path | string | repo-relative, MUST start with `.loom/maps/` |
| lastMappedCommit | string | 40-char git SHA-1 or `null` before first build |
| mapStale | boolean | default `false`; **advisory-cache-only** — never the sole gate input; flipped by `map-freshness` hook (F-22); cleared by `/loom-map refresh` |
| staleThreshold | integer | ≥1, default 10; configurable via `orchestration.toml [gates] mapStaleThreshold` |
| coverage | float | 0.0–1.0; `1.0` = consensus (F-21) |
| mapContentSha | string | optional; `sha256:<hex>` digest of the artifact body, computed on write; detects hand-edited maps |
| edgeTypes | string[] | ≥1; per-kind vocabulary (codebase: `imports,calls,routes-to,renders`; route: `routes-to,renders`; integration: 8 wiki cross-ref relations) |
| nodes | Node[] | Each node has stable `mod://` id (M-09) or `func://` (reserved for M-11) |
| edges | Edge[] | Each edge's `type` MUST be a member of `edgeTypes[]` |

**Node id scheme:** `mod://<relpath>` for modules/directories (M-09). `func://<relpath>#<symbol>` reserved for M-11 (F-28).

**Per-kind edgeTypes vocabularies:**
- `codebase`: `imports, calls, routes-to, renders`
- `route`: `routes-to, renders`
- `integration`: the 8 wiki cross-ref relations already computed by `wiki-maintainer-agent` (e.g., `references, depends-on, supersedes, implements, tests, documents, extends, conflicts-with`)

## Invariants

1. **Path constraint** — `path` MUST start with `.loom/maps/`. Writes outside the maps dir are rejected with `MAP_PATH_OUTSIDE_DIR`.
2. **Per-file single-owner** — `integration-map.toon` is exclusively owned by `wiki-maintainer-agent`; `codebase-map.toon` and `route-map.toon` are exclusively owned by `/loom-map`. Cross-owner writes are blocked by the file-ownership hook.
3. **Atomic writes** — all writes go to `{path}.tmp` then `fs.renameSync` to the target. No partial files on the target path.
4. **EdgeType membership** — every `edges[].type` MUST appear in the artifact's `edgeTypes[]`. Violation: `MAP_EDGE_TYPE_INVALID`.
5. **kind immutability** — a map artifact's `kind` cannot change after creation. Violation: `MAP_KIND_IMMUTABLE`.
6. **lastMappedCommit format** — MUST match `^[0-9a-f]{40}$` when non-null.
7. **Wholesale refresh** — nodes[]/edges[] are atomically replaced on every refresh (never partially mutated).
8. **Two-writer no-collision** — per-file ownership and atomic writes together prevent the two-writer race in `.loom/maps/`.
9. **mapStale is advisory-cache-only** — downstream gates MUST derive freshness from git (diff HEAD vs `lastMappedCommit` over tracked files) and treat `mapStale: false` as a cache hint, never a standalone pass condition. A non-ancestor `lastMappedCommit` implies stale-by-default regardless of the stored flag.
10. **Optional mapContentSha** — when present, the `sha256:` digest MUST match the artifact body on read by any gate that enforces integrity. A digest mismatch indicates a hand-edited map and gates MUST treat the artifact as stale.

## Integrity and Freshness Model

**CWE-345 (Insufficient Verification of Data Authenticity) mitigation:** The `mapStale` boolean alone is insufficient because any writer can stamp `mapStale: false` without actually re-mapping. The freshness model therefore requires a two-layer check:

1. **Git-derived freshness (mandatory):** Gates compute `git diff HEAD <lastMappedCommit> -- <tracked files>`. If `lastMappedCommit` is not an ancestor of HEAD, the artifact is stale regardless of `mapStale`.
2. **Advisory cache (optional fast path):** `mapStale: true` allows a gate to short-circuit without the git check. `mapStale: false` is a cache hint that may still be overridden by the git diff.
3. **Content integrity (optional):** `mapContentSha` detects hand-edited maps. When the digest does not match the artifact body, the gate treats the artifact as stale and logs the mismatch.

**Producer-gate path contract (C-26):** The producer side (M-09) stamps `lastMappedCommit` at `.loom/maps/*.toon`. The fork gate (`hooks/map-freshness.ts`) MUST read from that exact path. Mismatch between the producer write-path and the gate read-path causes a dormant gate (the fork gate silently allows everything because it never finds a stamp to check). C-26 verifies path agreement end-to-end.

**F-25 fork-audit (Track-A):** `verified-output.toon` verdict rows in the fork's quality gate MUST be attributable to a distinct verification pass. Any pass row with empty `evidence` is rejected by the Stop hook (CWE-807). This requirement applies to the fork's `quality-gate.ts` during the Track-A audit, not to M-09 itself.

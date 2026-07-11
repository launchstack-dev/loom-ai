---
pageId: component-map-freshness-hook
category: component
subtype: ""
tags[6]: M-09,cartography,F-22,hooks,PreToolUse,CWE-345
lastUpdated: 2026-07-11T00:00:00Z
updatedAt: 2026-07-11T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: map-freshness is a PreToolUse Write|Edit hook (F-22) that stamps lastMappedCommit on the producer side (M-09 scope); the fork's shipped hooks/map-freshness.ts owns the mapStale flip; freshness is always git-derived — mapStale is advisory-cache-only, never the sole gate input.
estimatedTokens: 900
bodySections[5]: Summary,Scope Split (M-09 vs Fork),Behavior,Contracts,References
relatedFiles[2]:
  hooks/map-freshness.ts
  hooks/map-freshness.test.ts
crossRefs[6]{pageId,relationship}:
  feature-m09-cartography-foundation,implements
  contract-map-artifact-schema,consumes
  component-hooks-system,relates-to
  command-loom-map,relates-to
  convention-settings-json,relates-to
  decision-f30-partition-check-no-waiver,relates-to
---

## Summary

`map-freshness` is the PreToolUse hook introduced in M-09 Phase 4 (Wave 3). It is registered in `hooks/hooks.json` under the `Write|Edit` matcher via the `run-hook.sh` wrapper — the same shape as `file-ownership.ts`.

**Key post-C-17 update:** M-09 builds the **producer side only** — stamping `lastMappedCommit` on write. The `mapStale` flip logic ships in the fork's `hooks/map-freshness.ts` (PR #42 Track A), not in this branch. Freshness is always git-derived; `mapStale` is advisory-cache-only and never the sole gate input (CWE-345 mitigation). See `contract-map-artifact-schema` § Integrity and Freshness Model.

## Scope Split (M-09 vs Fork)

| Responsibility | Owner |
|---|---|
| Stamp `lastMappedCommit` on every map write | M-09 (this branch) |
| Flip `mapStale: true` at drift threshold | Fork (`hooks/map-freshness.ts` in PR #42 Track A) |
| Git-derived freshness check in downstream gates | Fork gate read-path |
| `mapContentSha` digest computation | M-09 write-path (optional field) |

**C-26 integration criterion:** The M-09 producer MUST write `lastMappedCommit` at `.loom/maps/*.toon`. The fork gate MUST read from that exact path. C-26 verifies producer write-path == fork gate read-path end-to-end; a path mismatch causes a dormant gate.

## Behavior

### Producer side (M-09 scope)

On every `Write` or `Edit` tool call that touches a map artifact:

1. Reads the affected map artifact(s) from `.loom/maps/` using `hooks/lib/map-state.ts`.
2. Stamps `lastMappedCommit` = current git HEAD SHA on the artifact (`.tmp`+rename atomic write).
3. Optionally computes and stamps `mapContentSha` (`sha256:` digest of the artifact body) to enable hand-edit detection.
4. Always returns `decision: "allow"`.

### Degraded-input clause

Missing/malformed `lastMappedCommit`, unresolvable HEAD (detached/shallow/fresh repo), or corrupt TOON map are all treated as **fail-closed**: the artifact is treated as stale (`mapStale: true` is set) and the reason is logged. These conditions MUST NOT be treated as fresh to prevent downstream gates from silently passing on unmapped state.

### Fork-owned flip (Track A)

The fork's `hooks/map-freshness.ts` (shipped, not on this branch):

1. Reads `lastMappedCommit` from the artifact and runs `git diff HEAD <lastMappedCommit>` over tracked files to derive drift count.
2. **Pre-stale warning band** (default 70% of `staleThreshold`): emits a nudge to `/loom-status`/`/loom-next` state when drift ≥ warn band but < threshold (no flag change, no stderr spam).
3. **Stale flip**: if drift ≥ `staleThreshold`, atomically sets `mapStale: true` on the affected artifact. Does NOT create new map files.
4. Non-ancestor `lastMappedCommit` ⇒ stale-by-default regardless of stored flag.
5. Always returns `decision: "allow"` — even on error, non-git repo, or missing map.

**Clearing staleness:** only `/loom-map refresh` can clear `mapStale` and update `lastMappedCommit` to HEAD. The hook cannot clear the flag.

## Contracts

- **Fail-open** (fork hook): unreadable state, no map, non-git repo → `allow` with no message.
- **Fail-closed on degraded input** (producer side): malformed stamp or git error → treat as stale, log reason, never fail-open.
- **mapStale is advisory-cache-only**: gates MUST NOT use `mapStale: false` as a standalone pass condition; they MUST re-derive from git (`diff HEAD vs lastMappedCommit`).
- **Read-only on map ownership**: the hook only reads and atomically flips the `mapStale` flag on existing artifacts. It never creates new map files (creation belongs to F-20/F-21 owners).
- **No stderr spam**: pre-stale nudge surfaces only in `/loom-status`/`/loom-next` state.
- **Config**: `staleThreshold` from `orchestration.toml [gates] mapStaleThreshold` (default 10); `mapStaleWarnBand` (default 0.7).

## References

- Hook file (planned): `hooks/map-freshness.ts`
- Test file (planned): `hooks/map-freshness.test.ts`
- Shared lib: `hooks/lib/map-state.ts`
- Hook registration: `hooks/hooks.json` PreToolUse Write|Edit
- Config: `.claude/orchestration.toml [gates]`
- Fork: PR #42 Track A — ships the mapStale flip + fork gate
- Integration criterion: C-26 (producer write-path == fork gate read-path)

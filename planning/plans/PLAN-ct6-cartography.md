---
planVersion: 2
name: "Cartography Foundation (M-09)"
status: draft
created: 2026-07-08
lastReviewed: 2026-07-08
roadmapRef: planning/ROADMAP.md
totalPhases: 6
totalWaves: 4
executionBlocked: true
unblockCondition: "M-06 Phase 2 cleared (public launch + 5-stranger cold-install demand test)"
executionBlockReason: "C-16 launch gate — captured, not pre-launch-executable"
---

<!-- B1 (review 2026-07-08): C-16 is now machine-readable via the frontmatter `executionBlocked`/`unblockCondition` fields above — `/loom-plan execute` preflight MUST hard-fail while `executionBlocked: true`, not rely on the prose banner below. The unblock is manual: flip `executionBlocked: false` once M-06 Phase 2 clears (source of truth: ROADMAP M-06 status). -->


# Plan: Cartography Foundation (M-09)

## Overview

M-09 ports CT6's map front-end into Loom over existing primitives (no SQLite, no daemon — C-11): serialize the integration cross-ref graph the `wiki-maintainer-agent` already computes (F-20); add a net-new `/loom-map` command that produces a convergence-reviewed first-class codebase/route map (F-21); make a fresh map a warn-first, auto-invoking fail-closed precondition for planning (F-23); and stamp maps with `lastMappedCommit` so a PreToolUse hook trips `mapStale` past a touched-file threshold (F-22). Build order is F-20 → F-21 → F-23 → F-22, with a Wave-0 prefactor that extracts the shared surfaces (`MapArtifact` TOON schema, the `.loom/maps/` two-writer ownership contract, the shared `map-state.ts` git/staleness lib, and the `orchestration.toml` `[review]`+`[gates]` seams) so later waves never collide on the same file.

> **⚠️ EXECUTION BLOCKED UNTIL M-06 PHASE 2 (C-16).** This plan is **captured, not pre-launch-executable.** No M-09 phase may begin until the OSS launch (M-06) clears its Phase 2 gate (public launch + the 5-stranger cold-install demand test). The ports are a retention lever, not an acquisition lever; activating them ahead of an unproven launch starves the only A-priority and ships a first-run wall to brand-new installers. The plan exists now to preserve the decomposition; the orchestrator MUST refuse `/loom-plan execute` on this plan while M-06 Phase 2 is open.

> **🔗 RECONCILED WITH FABLE-READINESS 2026-07-10 (ROADMAP C-17) — re-plan before executing.** M-09 is the **KEYSTONE** of the reconciled CT6 scope: F-20/F-21 is the map producer the fable-readiness fork (PR #42) lacks, and it *activates the fork's already-built-but-dormant map-freshness gate* (`hooks/map-freshness.ts` allows everything until a producer writes `.loom/maps/*.toon`). Two changes land when this plan is unblocked: **(1)** the F-22 phase collapses — the fork already shipped the freshness *gate*, so F-22 reduces to producer-side `lastMappedCommit` stamping + **confirming the producer's write path matches the fork gate's `.loom/maps/` read path** (if the fork gate reads `.loom/wiki/maps/`, either realign it or the producer). **(2)** the `/loom-map` coverage convergence should be authored on the fork's Workflow engine (`scripts/lib/engine/*`), not the markdown-prompt loop this plan currently assumes. Re-run `/loom-plan create --review-integrate` (or a fresh plan pass) against the post-reconcile ROADMAP before `/loom-plan execute`.

## Review-Integrated Changes (2026-07-08)

This plan was reviewed by 8 agents (`planning/history/reviews/2026-07-08-review.toon`; eng 6.9/10, devex 7.7/10). Resolutions to the 6 blocking + key warning findings, applied to this plan:

- **B4/B5 — maps relocated to `.loom/maps/`** (was `.loom/wiki/maps/`). Verified in code: `hooks/wiki-write-guard.ts` blocks any non-wiki-agent write under `.loom/wiki/` during an active run, so `/loom-map`'s implementer (Phase 2, via the Write tool) would have been hard-blocked; and `hooks/file-ownership.ts:41` exempts `.loom/wiki/` unconditionally, so the plan's stated two-writer mitigation was false. Relocating out of the wiki tree makes `file-ownership.ts` the real per-file enforcer with **zero hook edits**. All path refs updated across plan + roadmap + criteria.
- **B6 — integration-map `edgeTypes[]` corrected** to the maintainer's actual vocabulary (`exercises/exercised-by`, `triggers/triggered-by`, `produces/produced-by`, `consumes/consumed-by`, `implements`) — the prior list was invented and would have failed F-20's `MAP_EDGE_TYPE_INVALID` on first run. Schema/Data-Model bullet updated; auto-inverse edge-count rule stated for S-05.
- **B1 — C-16 is now machine-enforced** via `executionBlocked: true`/`unblockCondition` frontmatter (see top); `/loom-plan execute` preflight hard-fails on it rather than trusting prose.
- **B2 — Wave 3 relabeled: Wave 3a = {Phase 3, Phase 4} (parallel) → Wave 3b = {Phase 5} (join).** Phase 5 depends on both P3 and P4; it is a sequential integration/join phase, not a co-equal parallel peer. Wave metadata below reflects 3a/3b.
- **B3 — Phase 2 reviewer budget preflight added:** before the `codebase-map-reviewer` fan-out, `hooks/lib/token-estimator.ts` `estimateContextBudget` MUST confirm the reviewer prompt is under the 100k cap; on overage, chunk the map by top-level dir. This is now a Phase 2 acceptance item + scenario, not just a Tech-Stack assertion.

**Warnings folded in (apply during execution):**
- **Split Phase 4** (eng F-04): keep `map-freshness.ts`+test+`hooks.json` as the hook phase; move the `/loom-status`+`/loom-next` pre-stale-nudge surfacing to the Phase 5 wiring-agent. Define the nudge-state channel (`.plan-execution/ephemeral/map-nudge.toon`) as a Phase 0 contract (the hook writes it via fs — not the Write tool — so no ownership guard applies).
- **Progress signal** (ux + devex F-01, plan-critic — top TTHW risk, predictedTTHW≈270s): the warn-mode auto-build MUST stream `codebase-map-reviewer` progress ("covered N/M modules…") via heartbeat (`.plan-execution/progress/{taskId}.toon`) rather than one `~N min` line. Phase 2 + Phase 3 acceptance item.
- **F-23 stale-path pending-test** (phasing PH-02, eng F-03): author S-20 as a `.skip`/pending test in Phase 3 guarding the stale branch; un-skip in Phase 5. Encode the Phase 3↔Phase 4 ordering (P4 completes the stale path P3 stubs).
- **F-21 non-convergence rollback** (eng F-05): if F-21 cannot reach `coverage == 1.0` on the target repo, F-23 ships presence-only and never auto-invokes a known-failing build; the C-15 `warn→block` ramp is gated on demonstrated convergence.
- **`route-map.toon` coverage** (feature-coverage F-ROUTE): add one route-map acceptance criterion (accept "empty-but-valid on a routeless repo" — loom-ai has no HTTP routes) or declare it a Non-Goal for M-09; currently it is a deliverable no test defends.
- **MapArtifact schema hardening** (feature-coverage): add `schemaVersion: 1`; add per-node `covered: bool` (so the `coverage < 1.0` non-consensus path can name uncovered modules); either add a per-node `contentHash` for `diff` "changed" or narrow `diff`/S-10 to added/removed for M-09; add a logical `uq_edge(from,to,type)` invariant; collapse the relational-DB "Indexes/Cascade" framing to a short "in-artifact invariants" list.
- **`/loom-map` surface** (ux + devex F-07): add `help`/usage + unknown-verb behavior (`MAP_UNKNOWN_VERB`), a build/refresh success confirmation line, and `--format toon|json` on `status`/`diff`. Guard `--skip-map-gate` against an empty reason.
- **Upgrade/rollback** (devex F-03/F-04): add an existing-install upgrade item (`/loom-upgrade` stamps `[gates]`/`[review]`; first post-upgrade `/loom-wiki` pass emits `integration-map.toon`; CHANGELOG entry) and document that `requireFreshMap = off` + deleting `.loom/maps/` is a clean rollback.
- **Gate re-entrancy + silent-flip** (eng F-11/F-06): assert `/loom-map` never itself trips the F-23 gate and never retries auto-build into a loop; make a failed `mapStale` write observable rather than silently dropped.
- Emit the Phase-0 `[gates]` block with inline comments + a `mapStaleWarnBand ∈ (0,1]` validation rule (devex F-05); freeze `orchestration.toml` after Phase 0 (eng F-08); move the `docs/troubleshooting.md` gate entry into Phase 3 (devex F-06).

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Command/agent format | Markdown + YAML frontmatter | Claude Code `/loom-map` command + `codebase-map-reviewer` agent |
| Map artifacts | TOON | `.loom/maps/{integration,codebase,route}-map.toon` (C-11: TOON-on-disk) |
| Hooks | TypeScript (`hooks/*.ts`, run via `run-hook.sh`) | PreToolUse `map-freshness` gate; shared `hooks/lib/map-state.ts` |
| Git introspection | `node:child_process` execSync (per `hooks/lib/ambient-state.ts` pattern) | `lastMappedCommit` vs HEAD drift computation |
| Reviewer machinery | Existing `/loom-converge` + reviewer fan-out | Drives map coverage to consensus — **no new loop primitive** (C-13) |
| Config | `.claude/orchestration.toml` | `[review]` reviewer registration + `[gates] requireFreshMap` (C-13, D-01) |
| Token estimation | `hooks/lib/token-estimator.ts` | Enforce 100k spawn cap on `codebase-map-reviewer` (C-11) |
| Package manager | Bun (npm fallback) | Test + typecheck |

## Schema / Type Definitions

The single net-new entity is `MapArtifact`. It is the standing TOON map under `.loom/maps/`, written by two owners (`wiki-maintainer-agent` for the `integration` kind, `/loom-map` for `codebase`/`route`), each holding **per-file ownership** with atomic `.tmp`+rename to prevent the shared-dir two-writer collision (F-22.1). `PlanPhase`, `WikiPage`, `ExecutionLog`, and `AgentResult` are pre-existing entities (shipped M-01–M-08) referenced but not redefined here.

### MapArtifact

| Field | Type | Constraints | Validation Rule |
|-------|------|-------------|-----------------|
| kind | enum | one of `codebase`, `route`, `integration`, `endpoint-trace` | Rejected if outside enum. `endpoint-trace` is **forward-declared only** for M-11 (F-28) — M-09 emits `codebase`/`route`/`integration` only. |
| path | string | repo-relative, MUST start with `.loom/maps/` | Path outside the maps dir is a blocking write error. |
| lastMappedCommit | string | 40-char git SHA-1 (or `null` before first build) | Must match `^[0-9a-f]{40}$` when non-null. |
| mapStale | boolean | default `false` | Flipped `true` by the freshness hook (F-22); cleared by a `/loom-map` refresh. |
| staleThreshold | integer | ≥1, default 10 | Touched-file count past which `mapStale` flips. Configurable via `orchestration.toml`. |
| coverage | float | 0.0–1.0 | Fraction of in-scope modules the reviewer marks covered; `1.0` = consensus (F-21). |
| edgeTypes | string[] | ≥1 entry; per-layer vocabulary (CT6-001) | `codebase`/`route` maps MUST declare their edge-type set. Reuse-cite (F-27, M-10b) validates citation shape against this. |
| nodes | Node[] | see below | Each node has a stable id. |
| edges | Edge[] | see below | Each edge's `type` MUST be a member of `edgeTypes[]`. |

**MapArtifact TOON shape (canonical):**

```toon
kind: codebase
path: .loom/maps/codebase-map.toon
lastMappedCommit: 0000000000000000000000000000000000000000
mapStale: false
staleThreshold: 10
coverage: 1.0
edgeTypes[4]: imports, calls, routes-to, renders
nodes[N]{id,kind,path,label}:
  mod://hooks/lib,module,hooks/lib,Hook shared libraries
  mod://agents,module,agents,Agent definitions
edges[M]{from,to,type}:
  mod://agents,mod://hooks/lib,imports
```

- **codebase-map edgeTypes:** `imports, calls, routes-to, renders`
- **route-map edgeTypes:** `routes-to, renders`
- **integration-map edgeTypes:** the **actual** relation vocabulary `wiki-maintainer-agent` computes (verified against `agents/wiki-maintainer-agent.md` §"Maintain Cross-References" + `protocols/wiki-page.schema.md`) — the 4 auto-inverse pairs `exercises/exercised-by`, `triggers/triggered-by`, `produces/produced-by`, `consumes/consumed-by`, plus `implements`. F-20 serializes, it does not invent — so this list MUST be read from the maintainer at authoring time, not guessed. **Auto-inverse cardinality (eng F-10):** the serializer records each directional edge once (both `produces` and its `produced-by` inverse are distinct rows), so F-20's `edges[] count == sum(crossRefs[])` assertion counts directional entries; state this rule in `protocols/map-artifact.schema.md` and in S-05.

Node `id` scheme: `mod://<relpath>` for modules/directories, `func://<relpath>#<symbol>` reserved for M-11 (F-28) — M-09 emits `mod://` node ids only.

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_map_path | path | PRIMARY (one file per path) | One artifact per `.loom/maps/*.toon` file |
| uq_node_id | nodes[].id | UNIQUE (within artifact) | Node ids unique per map (enables `resolve` verb) |
| idx_edge_type | edges[].type | INDEX (logical) | `edgeTypes[]` membership check + `diff` verb grouping |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| MapArtifact | Node (embedded) | CASCADE (deleting map removes its nodes) | CASCADE |
| MapArtifact | Edge (embedded) | CASCADE | CASCADE |
| WikiPage | MapArtifact (integration edges) | SET NULL edge (drop dangling cross-ref) | re-serialize on next pass |

There is no relational DB (C-11); "cascade" here documents in-artifact invariants the writers enforce: a map refresh rewrites `nodes[]`/`edges[]` wholesale (atomic replace), never partial mutation.

## API Specification

M-09 has no HTTP endpoints. The command/subcommand surface and the PreToolUse hook interface are the API. Only `/loom-map` is net-new (C-13); everything else extends existing commands.

### `/loom-map [status|diff|resolve|refresh]`

**Description:** Net-new command that produces and queries the first-class codebase/route map, refreshes the F-20 integration map, and drives coverage to consensus via the existing `/loom-converge` reviewer fan-out.
**Auth:** none (local CLI). Runs under the standard Loom init-guard (`_loom-init-guard`).
**Invocation:** slash command; no HTTP.

**Subcommands (verbs):**

| Verb | Arguments | Behavior | Exit / Output |
|------|-----------|----------|---------------|
| *(default / `build`)* | `[--reviewers N] [--skip-map-gate "<reason>"]` | Extract `mod://` nodes for every top-level source dir; write `codebase-map.toon` + `route-map.toon`; consume/refresh `integration-map.toon`; spawn `codebase-map-reviewer` ×N through `/loom-converge` until `coverage == 1.0`. Atomic `.tmp`+rename per file. | Exit 0 on consensus; non-zero if convergence fails after bounded iterations (C-11 bounded loop). |
| `status` | none | Report fresh/stale + coverage **without rebuild** (idempotent query; surfaces the no-op path). | Exit 0; prints `map fresh` / `map stale (N/threshold touched)` + coverage per artifact. |
| `diff` | `[--since <commit>]` | Added/removed/changed `mod://` nodes since `lastMappedCommit` (default) or `--since`. | Exit 0; prints node-level diff (parity with Sourcegraph/CodeScene visibility the freshness gate needs). |
| `resolve` | `<path-or-id>` | Node lookup for pre-flight citation validation (shared with F-28/F-27). | Exit 0 + node record if found; exit non-zero + "node not in map" if absent. |
| `refresh` | none | Rebuild + clear `mapStale`, update `lastMappedCommit` to current HEAD. | Exit 0; equivalent to default build but explicit about the stale-clear intent. |

**Behavior notes:**
- `status`/`diff`/`resolve` are **read-only** (META tier) — never write artifacts, never spawn reviewers.
- Default/`build`/`refresh` are the only WRITE paths; they own `codebase-map.toon`+`route-map.toon` exclusively and only *read/consume* `integration-map.toon` (owned by the maintainer).
- All new flags pass the L-002 canonical-flag-convention audit (`--reviewers`, `--since`, `--skip-map-gate`).
- **Wiki bridge:** `mod://` nodes with no corresponding `component-*` wiki page are emitted to `wiki-maintainer-agent` as ingestion candidates (mirrors F-10), preventing map↔wiki drift.

### PreToolUse hook: `map-freshness`

**Description:** F-22 staleness detector. Registered under `hooks/hooks.json` PreToolUse `Write|Edit` matcher.
**Interface (Claude Code hook protocol — JSON stdin/stdout, per CLAUDE.md exception):**

| Field (stdin) | Type | Description |
|---------------|------|-------------|
| tool_input.file_path | string | File about to be written/edited |
| cwd | string | Project root for locating `.loom/maps/` |

| Field (stdout) | Type | Description |
|----------------|------|-------------|
| decision | `"allow"` \| `"block"` | Freshness hook is **fail-open** — always `allow`; never blocks a write. |
| message | string | Pre-stale nudge when drift crosses the warning band (e.g. "map is 70% toward stale — 7 of 10 touched"). |

**Behavior notes:**
- Computes touched-file drift = count of git-tracked files changed since `lastMappedCommit` (via `hooks/lib/map-state.ts`, using the `ambient-state.ts` execSync git pattern).
- Flips `mapStale: true` on the affected artifact (atomic write) once drift ≥ `staleThreshold`. This is a **side effect**, not a block — the hook's decision is always `allow` (staleness is enforced later by the F-23 gate, not here).
- Pre-stale warning band (default 70% of threshold) surfaces to `/loom-status` and `/loom-next` state, not stderr spam.
- Fail-open: unreadable state, no map, or non-git repo → `allow` with no message (mirrors `file-ownership.ts`).

### Command extension: `/loom-plan create` + `/loom-converge` map precondition (F-23)

**Description:** Fail-closed-*with-recourse* precondition wired into each command's existing preflight (Step 0). Not a net-new command (C-13). `/loom-auto` inherits it because it invokes these commands as links.
**Config:** `orchestration.toml` `[gates] requireFreshMap = warn|block|off` (default `warn`).
**Escape:** `--skip-map-gate "<reason>"` (mirrors the shipped F-18 `--override-loop-gate` precedent).

| Mode | Map absent | Map stale (post-F-22) | Map fresh |
|------|-----------|-----------------------|-----------|
| `off` | proceed | proceed | proceed |
| `warn` (default) | **auto-invoke `/loom-map`**; proceed on success, fail closed only if the auto-build itself fails | (until F-22 lands: presence-only, treated as fresh) auto-refresh; proceed | proceed |
| `block` | exit non-zero + state-specific remedy | exit non-zero + stale remedy naming drifted files | proceed |

## State Machines

### MapArtifact mapStale (freshness lifecycle)

```
   (build)              drift >= threshold
  ────────►  fresh  ──────────────────────►  stale
   ▲           │                               │
   │           │ drift in warn band            │ /loom-map refresh
   │           ▼ (side-effect: nudge)          │
   │        pre-stale ──────────────────────────┘
   │                    drift >= threshold
   └──────────────── /loom-map (build|refresh) ◄───┘
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| fresh | `mapStale: false`, `lastMappedCommit == HEAD` (or drift < warn band) | Default on `/loom-map build`/`refresh` at consensus |
| pre-stale | drift ≥ warn band (default 70% of threshold) but < threshold | Freshness hook detects warn-band drift |
| stale | `mapStale: true`, drift ≥ `staleThreshold` | Freshness hook flips flag (F-22) |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| fresh | pre-stale | `map-freshness` hook (PreToolUse Write/Edit) detects warn-band drift | Emit nudge to `/loom-status`/`/loom-next` state; no flag change |
| pre-stale | stale | `map-freshness` hook detects drift ≥ threshold | Set `mapStale: true` (atomic write) |
| fresh | stale | drift jumps past threshold in one write | Set `mapStale: true` |
| stale | fresh | `/loom-map refresh` | Rebuild nodes/edges, clear `mapStale`, set `lastMappedCommit = HEAD` |
| pre-stale | fresh | `/loom-map refresh` | Same as above |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| stale | fresh (without rebuild) | MAP_STALE_NOT_CLEARED | Cannot clear `mapStale` except via `/loom-map refresh` — HEAD unchanged |
| *(any)* | *(kind change)* | MAP_KIND_IMMUTABLE | A map artifact's `kind` cannot change after creation |

### requireFreshMap gate (F-23 gate mode)

```
        [gates] requireFreshMap
   off ──────── warn ──────── block
    │            │              │
 proceed   auto-invoke     fail-closed
           /loom-map       + remedy
           (fail iff       + --skip-map-gate
            build fails)     escape (logged)
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| off | Gate disabled | `requireFreshMap = off` |
| warn | Default first release; auto-heals | `requireFreshMap = warn` (default) |
| block | Hard precondition after battle-testing | `requireFreshMap = block` |

**Valid transitions:** operator edits `orchestration.toml` (config-driven, not runtime). `warn → block` is the intended ramp per C-15 after the map story is proven.

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| block | *(proceed on absent/stale map)* | MAP_GATE_BLOCKED | naming the unmet condition + one-line remedy + where-to-look (F-25 legibility bar); overridable only via `--skip-map-gate "<reason>"` |

## Error Handling Specification

### Error Response Format

The CLI/hook surface is not HTTP; errors are rendered as human-readable stderr + a structured record in `.plan-execution/` state and `execution-log`. The consistent shape:

```toon
error:
  code: MAP_GATE_BLOCKED
  message: No fresh codebase map — run /loom-map first
  remedy: /loom-map
  where: .loom/maps/codebase-map.toon
```

### Error Categories

| Code | Exit / decision | When used | Retryable |
|------|-----------------|-----------|-----------|
| MAP_GATE_BLOCKED | exit non-zero (block mode) | `/loom-plan create` or `/loom-converge` with absent/stale map under `block` | Yes — run `/loom-map` then retry, or `--skip-map-gate` |
| MAP_AUTOBUILD_FAILED | exit non-zero (warn mode) | Auto-invoked `/loom-map` itself failed (C-15 fail-closed-on-autobuild-fail) | Yes — fix the build error, re-run |
| MAP_CONVERGE_FAILED | exit non-zero | `codebase-map-reviewer` fan-out did not reach `coverage == 1.0` in bounded iterations | Yes — re-run `/loom-map`; unresolved gaps logged to `.loom/learnings.toon` |
| MAP_NODE_UNRESOLVED | exit non-zero | `/loom-map resolve <id>` finds no matching node | No — fix the citation |
| MAP_STALE_NOT_CLEARED | write rejected | Attempt to clear `mapStale` without a rebuild | No — use `/loom-map refresh` |
| MAP_KIND_IMMUTABLE | write rejected | Attempt to mutate a map's `kind` | No |
| MAP_EDGE_TYPE_INVALID | validation error | An edge's `type` is not in the artifact's `edgeTypes[]` | No — fix the map |
| MAP_PATH_OUTSIDE_DIR | write rejected | A map write targets a path outside `.loom/maps/` | No |

### State-Specific Remedy Text (UX-02, C-15)

Remedy is **not one hardcoded string**:
- **absent-map (warn):** `"building your codebase map (~N min)…"` (then proceeds)
- **absent-map (block):** `"No codebase map found. Run /loom-map to build one, or pass --skip-map-gate \"<reason>\"."`
- **stale-map (block):** `"Map is stale — files X, Y, Z drifted since last map. Run /loom-map to refresh."`
- **autobuild-failed:** names the underlying `/loom-map` failure + "fix and re-run, or --skip-map-gate."

### Retry / Escape Behavior

| Situation | Strategy |
|-----------|----------|
| warn-mode auto-invoke | one auto-build attempt; fail closed only if it errors (C-15) |
| `--skip-map-gate "<reason>"` | proceed; write reason to `.plan-execution/` state + append to `DECISIONS.md`; surface prominently in the digest each iteration |
| convergence non-consensus | bounded (no unbounded loop, C-11); surplus gaps → `.loom/learnings.toon` |

## Configuration Specification

| Variable (orchestration.toml) | Type | Default | Required | Description |
|-------------------------------|------|---------|----------|-------------|
| `[gates] requireFreshMap` | enum `warn\|block\|off` | `warn` | no | F-23 map precondition mode (C-15 ramp: ships `warn`, flips `block` after battle-testing) |
| `[gates] mapStaleThreshold` | integer | 10 | no | Touched-file drift count past which `mapStale` flips (F-22) |
| `[gates] mapStaleWarnBand` | float | 0.7 | no | Fraction of threshold at which the pre-stale nudge fires |
| `[review] codebase-map-reviewer` | string (path) | — | yes (F-21) | Registers the reviewer per D-01 (never hardcoded); e.g. `"agents/codebase-map-reviewer.md"` |

### Config Loading

Read once at command init from `.claude/orchestration.toml` (same pattern as `loom-auto.md` Step 0). Absent keys resolve to defaults above. The `[gates]` block does not exist in the repo today — Phase 0 creates it. `--skip-map-gate` (CLI) overrides the config gate for a single invocation.

## Execution Phases

### Phase 0 — Wave 0: Cartography Contracts + Shared-Surface Prefactor

**Agent:** contracts-agent
**Objective:** Extract every surface that two later waves would otherwise collide on — the `MapArtifact` TOON schema, the `.loom/maps/` two-writer ownership contract, the shared `map-state.ts` git/staleness lib, and the `orchestration.toml` `[review]`+`[gates]` seams — into stable module boundaries so Waves 1–3 proceed in parallel without file-ownership conflicts.
**Dependencies:** None
**File Ownership:** protocols/map-artifact.schema.md, hooks/lib/map-state.ts, hooks/lib/map-state.test.ts, .claude/orchestration.toml, .loom/maps/.gitkeep

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/map-artifact.schema.md | Create | contracts-agent |
| hooks/lib/map-state.ts | Create | contracts-agent |
| hooks/lib/map-state.test.ts | Create | contracts-agent |
| .claude/orchestration.toml | Modify | contracts-agent |
| .loom/maps/.gitkeep | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `protocols/map-artifact.schema.md` defines the `MapArtifact` TOON schema with all fields (`kind, path, lastMappedCommit, mapStale, staleThreshold, coverage, edgeTypes[], nodes[], edges[]`), the `mod://`/`func://` id scheme, per-kind `edgeTypes[]` vocabularies, and the two-writer per-file ownership + atomic `.tmp`+rename contract.
- [ ] `hooks/lib/map-state.ts` exports `readMapArtifact(path)`, `computeDrift(lastMappedCommit)` (git-tracked changed-file count via execSync, fail-open on non-git), `isStale(artifact)`, and `writeMapArtifactAtomic(path, artifact)` (writes `.tmp` then renames).
- [ ] `bunx tsc --noEmit` exits with code 0.
- [ ] `bun test hooks/lib/map-state.test.ts` passes with ≥6 cases (drift count, threshold flip, warn-band, non-git fail-open, atomic write, edgeTypes membership).
- [ ] `.claude/orchestration.toml` contains a `[gates]` block with `requireFreshMap = "warn"`, `mapStaleThreshold = 10`, `mapStaleWarnBand = 0.7`, and a `[review]` block registering `codebase-map-reviewer` per D-01.
- [ ] `.loom/maps/.gitkeep` exists so the shared maps directory is tracked before any writer runs.

#### Convergence Targets
- `bun test hooks/lib/map-state.test.ts` exits 0 (cli-exit-code).
- Parsing `.claude/orchestration.toml` yields `[gates].requireFreshMap == "warn"` and `[review]["codebase-map-reviewer"]` resolves to a path (json-deep-equal on parsed config, ignore ordering).

#### Scenarios

```toon
id: S-01
title: map-state computes touched-file drift against lastMappedCommit
given[2]: A git repo at HEAD commit C, A MapArtifact with lastMappedCommit set to an earlier commit with 3 files changed since
when: computeDrift is called with that lastMappedCommit
whenTriggerType: system-event
then[2]: The returned drift count MUST equal 3, The function MUST NOT throw
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: map-state fails open on a non-git directory
given[1]: A directory that is not a git repository
when: computeDrift is called
whenTriggerType: system-event
then[2]: The function MUST return 0 (or null), The function MUST NOT throw
stateRef:
tags[2]: edge-case, error
testTier: unit
automatable: true
```

```toon
id: S-03
title: writeMapArtifactAtomic writes via tmp then rename
given[1]: A target path under .loom/maps/
when: writeMapArtifactAtomic is called with a valid MapArtifact
whenTriggerType: system-event
then[3]: A .tmp file MUST be created then renamed onto the target, The final file MUST parse as valid TOON, No partial file MUST remain on the target path if the write is interrupted
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-04
title: orchestration.toml gates block defaults to warn
given[1]: The repo orchestration.toml after Phase 0
when: The config is parsed
whenTriggerType: system-event
then[2]: gates.requireFreshMap MUST equal "warn", review.codebase-map-reviewer MUST resolve to a file path
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 1 — Wave 1: Integration-Map Serialization (F-20)

**Agent:** implementer-agent
**Objective:** Have `wiki-maintainer-agent` serialize the 8-relation cross-ref graph it already computes to `.loom/maps/integration-map.toon` on every `/loom-wiki` maintenance pass, atomically and as sole owner of that one file.
**Dependencies:** Phase 0
**File Ownership:** agents/wiki-maintainer-agent.md, agents/wiki-maintainer-triggers.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/wiki-maintainer-agent.md | Modify | implementer-agent |
| agents/wiki-maintainer-triggers.md | Modify | implementer-agent |

#### Acceptance Criteria
- [ ] `wiki-maintainer-agent.md` instructs the maintainer to serialize its computed cross-ref graph to `.loom/maps/integration-map.toon` (kind `integration`) on each maintenance pass, conforming to `protocols/map-artifact.schema.md`, using `writeMapArtifactAtomic` semantics (`.tmp`+rename).
- [ ] The maintainer owns `integration-map.toon` **exclusively** (single-owner governance preserved); it does not write `codebase-map.toon` or `route-map.toon`.
- [ ] `integration-map.toon` declares its `edgeTypes[]` as the 8 wiki cross-ref relations; no graph *discovery* is added — existing computation is persisted only.
- [ ] After a `/loom-wiki` maintenance pass on a repo with ≥2 cross-referenced pages, `integration-map.toon` exists and its `edges[]` count equals the total `crossRefs[]` entries across all pages.
- [ ] The artifact round-trips through the maintainer without edge loss (re-serialization is idempotent absent wiki changes).

#### Convergence Targets
- After a maintenance pass on a ≥2-cross-ref fixture, `.loom/maps/integration-map.toon` exists and `len(edges) == sum(crossRefs)` (json-deep-equal on edge count, ignore ordering).
- Second maintenance pass with no wiki changes produces byte-identical `edges[]` (text-diff, ignore `lastMappedCommit`).

#### Scenarios

```toon
id: S-05
title: Maintenance pass serializes integration cross-ref graph
given[2]: A wiki with at least 2 pages that cross-reference each other, The wiki-maintainer runs a maintenance pass
when: The maintenance pass completes
whenTriggerType: system-event
then[3]: A file .loom/maps/integration-map.toon MUST exist, Its edges count MUST equal the total crossRefs entries across all pages, It MUST parse as valid TOON conforming to map-artifact.schema.md
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-06
title: Integration map round-trips without edge loss
given[1]: An integration-map.toon written by a prior maintenance pass
when: The maintainer runs a second pass with no wiki changes
whenTriggerType: system-event
then[2]: The edges array MUST be unchanged (ignoring lastMappedCommit), No edges MUST be dropped or duplicated
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

### Phase 2 — Wave 2: `/loom-map` Command + `codebase-map-reviewer` (F-21)

**Agent:** implementer-agent
**Objective:** Ship the net-new `/loom-map` command (build + `status`/`diff`/`resolve`/`refresh` verbs + wiki bridge) and the `codebase-map-reviewer` agent, driving `codebase-map.toon`/`route-map.toon` coverage to consensus through the existing `/loom-converge` fan-out — no new loop primitive.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-map.md, agents/codebase-map-reviewer.md, .loom/maps/codebase-map.toon, .loom/maps/route-map.toon

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-map.md | Create | implementer-agent |
| agents/codebase-map-reviewer.md | Create | implementer-agent |
| .loom/maps/codebase-map.toon | Create | implementer-agent (via command dogfood) |
| .loom/maps/route-map.toon | Create | implementer-agent (via command dogfood) |

#### Acceptance Criteria
- [ ] `commands/loom-map.md` defines the default `build` path plus `status`, `diff`, `resolve`, and `refresh` verbs per the API Specification; `status`/`diff`/`resolve` are read-only and never spawn reviewers or write artifacts.
- [ ] `/loom-map` writes `codebase-map.toon` and `route-map.toon` (owned exclusively by `/loom-map`) and only *consumes/refreshes* `integration-map.toon` (owned by the maintainer) — the two-writer contract from Phase 0 holds.
- [ ] `codebase-map.toon` enumerates every top-level source directory with `coverage == 1.0` (zero uncovered modules) at consensus; each map declares its `edgeTypes[]` (CT6-001).
- [ ] `codebase-map-reviewer.md` has `model: sonnet` frontmatter, is registered in `orchestration.toml [review]` (Phase 0), stays within the 100k spawn cap, and marks module coverage through the existing `/loom-converge` machinery.
- [ ] A second `/loom-map` run with no code changes is a no-op and `/loom-map status` reports "map fresh".
- [ ] `/loom-map diff --since <commit>` lists added/removed/changed `mod://` nodes; `/loom-map resolve <path-or-id>` returns the node record or exits non-zero with `MAP_NODE_UNRESOLVED`.
- [ ] Wiki bridge: `mod://` nodes with no `component-*` wiki page are surfaced to `wiki-maintainer-agent` as ingestion candidates.
- [ ] All new flags (`--reviewers`, `--since`, `--skip-map-gate`) conform to the L-002 canonical-flag convention.

#### Convergence Targets
- `/loom-map` on the loom-ai repo produces `codebase-map.toon` + `route-map.toon` under `.loom/maps/`; `codebase-map.toon` covers every top-level source dir with `coverage == 1.0` (json-deep-equal on covered-module set).
- Second `/loom-map` with no changes: `/loom-map status` exits 0 printing "map fresh" (cli-exit-code + text-diff).
- `/loom-map resolve <known-id>` exits 0; `/loom-map resolve <absent-id>` exits non-zero (cli-exit-code).

#### Scenarios

```toon
id: S-07
title: loom-map builds a convergence-reviewed codebase map
given[2]: The loom-ai repo with no existing codebase-map.toon, requireFreshMap is off (no gate interference)
when: A user runs /loom-map
whenTriggerType: actor-action
then[3]: .loom/maps/codebase-map.toon MUST exist, It MUST enumerate every top-level source directory with coverage equal to 1.0, It MUST declare a non-empty edgeTypes array
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-08
title: Second loom-map run with no changes is an idempotent no-op
given[1]: A fresh codebase-map.toon built against the current HEAD
when: A user runs /loom-map status with no intervening code changes
whenTriggerType: actor-action
then[2]: The command MUST report "map fresh", It MUST NOT rewrite the artifact or spawn a reviewer
stateRef: fresh
tags[2]: happy-path, edge-case
testTier: e2e
automatable: true
```

```toon
id: S-09
title: loom-map resolve rejects an absent node id
given[1]: A codebase-map.toon that does not contain node id mod://does/not/exist
when: A user runs /loom-map resolve mod://does/not/exist
whenTriggerType: actor-action
then[2]: The command MUST exit non-zero, The output MUST name the unresolved node with error code MAP_NODE_UNRESOLVED
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

```toon
id: S-10
title: loom-map diff reports node-level changes since lastMappedCommit
given[2]: A codebase-map.toon built at commit C, A new top-level source directory added and committed after C
when: A user runs /loom-map diff
whenTriggerType: actor-action
then[2]: The output MUST list the new directory as an added mod:// node, Removed and changed nodes MUST be reported in their own groups
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-11
title: Uncovered wiki-less module surfaces as an ingestion candidate
given[1]: A structurally-important mod:// node with no corresponding component- wiki page
when: /loom-map completes its build
whenTriggerType: system-event
then[1]: That node MUST be emitted to wiki-maintainer-agent as a documentation-gap ingestion candidate
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 3 — Wave 3a: Map Precondition Gate on Planning (F-23)

**Agent:** implementer-agent
**Objective:** Wire the warn-first, auto-invoking, escapable fail-closed map precondition into the `/loom-plan create` and `/loom-converge` preflights (Step 0), so `/loom-auto` inherits it — blocking (in `block` mode) or auto-healing (in `warn` mode) when no fresh map exists.
**Dependencies:** Phase 0, Phase 2
**File Ownership:** commands/loom-plan/create.md, commands/loom-converge.md, docs/hooks.md, docs/troubleshooting.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-plan/create.md | Modify | implementer-agent |
| commands/loom-converge.md | Modify | implementer-agent |
| docs/hooks.md | Modify | implementer-agent |
| docs/troubleshooting.md | Modify | implementer-agent |

#### Acceptance Criteria
- [ ] `/loom-plan create` Step 0 and `/loom-converge` Step 0 check for a fresh (present, non-stale) map before proceeding, reading `[gates] requireFreshMap` and consuming `hooks/lib/map-state.ts`.
- [ ] In `block` mode with no `codebase-map.toon`, `/loom-plan create` exits non-zero with a **state-specific** remedy (absent-map text) and error code `MAP_GATE_BLOCKED`.
- [ ] In the default `warn` mode with no map, the gate **auto-invokes `/loom-map`** and proceeds on success; it fails closed with `MAP_AUTOBUILD_FAILED` only if the auto-build itself fails (so `/loom-auto`/headless/CI never dead-end — C-15).
- [ ] `--skip-map-gate "<reason>"` proceeds and writes the reason to `.plan-execution/` state and appends to `DECISIONS.md`, surfacing prominently (mirrors the shipped `--override-loop-gate`).
- [ ] `/loom-auto` inherits the gate through its `/loom-plan create` + `/loom-converge` link invocations (no separate loom-auto edit required); the inheritance is documented.
- [ ] **Interim behavior (SF-03):** because F-23 lands before F-22 in this wave order, the gate is **presence-only** until Phase 4 ships; the stale-map path is documented as deferred to Phase 4, and the stale-specific convergence target is explicitly NOT asserted in this phase (an explicit acceptance sub-item, not a gap).
- [ ] A documented CI recipe for headless runs ships in `docs/troubleshooting.md`; `docs/hooks.md` gains an entry for the map gate; the block remedy meets the F-25 legibility bar (names unmet condition + one-line remedy + where-to-look).

#### Convergence Targets
- `/loom-plan create` with no `codebase-map.toon` and `[gates] requireFreshMap = block` exits non-zero with a state-specific remedy (cli-exit-code + stderr text-diff).
- Same invocation under default `warn` auto-invokes `/loom-map` and proceeds to plan generation (cli-exit-code 0; presence of `codebase-map.toon` after the run).
- `--skip-map-gate "reason"` proceeds and appends a reason line to `DECISIONS.md` (text-diff on the appended line, ignore timestamp).

#### Scenarios

```toon
id: S-12
title: Block mode fails closed when no codebase map exists
given[2]: No .loom/maps/codebase-map.toon is present, orchestration.toml sets gates.requireFreshMap to block
when: A user runs /loom-plan create
whenTriggerType: actor-action
then[2]: The command MUST exit non-zero, stderr MUST show error code MAP_GATE_BLOCKED with a state-specific absent-map remedy naming /loom-map
stateRef:
tags[2]: error, happy-path
testTier: e2e
automatable: true
```

```toon
id: S-13
title: Warn mode auto-invokes loom-map and proceeds
given[2]: No codebase-map.toon is present, gates.requireFreshMap is warn (default)
when: A user runs /loom-plan create
whenTriggerType: actor-action
then[3]: The gate MUST auto-invoke /loom-map, codebase-map.toon MUST exist after the run, Plan generation MUST proceed and exit 0
stateRef:
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-14
title: Warn mode fails closed only when the auto-build itself fails
given[2]: No codebase-map.toon is present and gates.requireFreshMap is warn, The auto-invoked /loom-map fails
when: A user runs /loom-plan create
whenTriggerType: actor-action
then[2]: The command MUST exit non-zero with error code MAP_AUTOBUILD_FAILED, The remedy MUST name the underlying build failure
stateRef:
tags[2]: error, edge-case
testTier: e2e
automatable: true
```

```toon
id: S-15
title: skip-map-gate proceeds and logs the reason
given[2]: No codebase-map.toon is present and gates.requireFreshMap is block, The user passes --skip-map-gate "spike branch, map not needed"
when: A user runs /loom-converge --skip-map-gate "spike branch, map not needed"
whenTriggerType: actor-action
then[3]: The command MUST proceed past the gate, The reason MUST be appended to DECISIONS.md, The reason MUST be recorded in .plan-execution state
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

### Phase 4 — Wave 3a: Map Freshness Hook (F-22)

> **⚠️ RECONCILED SCOPE (C-17, 2026-07-10):** the fork (PR #42) already ships `hooks/map-freshness.ts` + its test. At re-plan, Phase 4 reduces to: (a) verify/align the fork gate's read path against the producer's `.loom/maps/` write path, (b) producer-side `lastMappedCommit` stamping, (c) the from-scratch `map-freshness.ts` Create deliverables below are DROPPED unless absent on the merge base.

**Agent:** implementer-agent
**Objective:** Stamp maps with `lastMappedCommit` and register a fail-open PreToolUse `map-freshness` hook that flips `mapStale` past the touched-file threshold, with a pre-stale warning band surfaced to `/loom-status`/`/loom-next` — converting staleness from a surprise block into a nudge, and completing the F-23 gate's stale path.
**Dependencies:** Phase 0, Phase 2
**File Ownership:** hooks/map-freshness.ts, hooks/map-freshness.test.ts, hooks/hooks.json, commands/loom-status.md, commands/loom-next.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| ~~hooks/map-freshness.ts~~ (dropped per C-17 — fork ships it) | ~~Create~~ | ~~implementer-agent~~ |
| ~~hooks/map-freshness.test.ts~~ (dropped per C-17 — fork ships it) | ~~Create~~ | ~~implementer-agent~~ |
| hooks/hooks.json | Modify | implementer-agent |
| commands/loom-status.md | Modify | implementer-agent |
| commands/loom-next.md | Modify | implementer-agent |

#### Acceptance Criteria
- [ ] The pre-existing `hooks/map-freshness.ts` (shipped in the fable-readiness fork as a PreToolUse `Write|Edit` hook) is aligned and validated against this plan's contract: it computes drift via `hooks/lib/map-state.ts`, flips `mapStale: true` (atomic write) once drift ≥ `staleThreshold`, and is **fail-open** — its `decision` is always `allow` (it never blocks a write). Alignment work, not creation from scratch.
- [ ] The hook is registered in `hooks/hooks.json` under the PreToolUse `Write|Edit` matcher via the `run-hook.sh` wrapper (same shape as `file-ownership.ts`).
- [ ] A pre-stale warning state (default 70% of threshold) is surfaced in `/loom-status` and `/loom-next`; `mapStale` and the current `staleThreshold` are visible in `/loom-status`.
- [ ] After committing changes to N files exceeding the threshold, the hook flips `mapStale: true` on the affected artifact; a `/loom-map refresh` clears it and updates `lastMappedCommit` to the new HEAD.
- [ ] The `.loom/maps/` two-writer collision is prevented: the hook only *reads*/flips the flag on existing artifacts via atomic write; it never creates new map files (that stays with the F-20/F-21 owners).
- [ ] With F-22 landed, the F-23 gate's stale path (Phase 3, deferred) now activates: `bunx tsc --noEmit` exits 0 and `bun test hooks/map-freshness.test.ts` passes.

#### Convergence Targets
- After committing > `staleThreshold` file changes, reading the affected artifact shows `mapStale == true` (json-deep-equal on the flag).
- `/loom-map refresh` clears `mapStale` and sets `lastMappedCommit == HEAD` (json-deep-equal, resolve HEAD via git).
- `bun test hooks/map-freshness.test.ts` exits 0 (cli-exit-code).

#### Scenarios

```toon
id: S-16
title: Freshness hook flips mapStale past the threshold
given[2]: A fresh codebase-map.toon with staleThreshold 10, 11 git-tracked files changed and committed since lastMappedCommit
when: A Write or Edit tool call triggers the map-freshness PreToolUse hook
whenTriggerType: system-event
then[2]: The affected artifact MUST have mapStale set to true, The hook decision MUST remain allow (it MUST NOT block the write)
stateRef: stale
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-17
title: Pre-stale warning band surfaces before hard staleness
given[2]: A fresh codebase-map.toon with staleThreshold 10, 7 files changed since lastMappedCommit
when: The map-freshness hook runs
whenTriggerType: system-event
then[2]: mapStale MUST remain false, A pre-stale nudge (7 of 10 touched) MUST be surfaced to loom-status/loom-next state
stateRef: pre-stale
tags[2]: happy-path, edge-case
testTier: unit
automatable: true
```

```toon
id: S-18
title: loom-map refresh clears staleness and re-stamps the commit
given[1]: A codebase-map.toon with mapStale true
when: A user runs /loom-map refresh
whenTriggerType: actor-action
then[2]: mapStale MUST become false, lastMappedCommit MUST equal the current git HEAD
stateRef: fresh
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

```toon
id: S-19
title: Freshness hook fails open when map state is unreadable
given[1]: A repo where the codebase-map.toon is missing or corrupt
when: A Write triggers the map-freshness hook
whenTriggerType: system-event
then[2]: The hook MUST return decision allow, The hook MUST NOT throw or block the write
stateRef:
tags[2]: edge-case, error
testTier: unit
automatable: true
```

---

### Phase 5 — Wave 3b (join): Wiring + Dogfood Close-Out

**Agent:** wiring-agent
**Objective:** Connect the parallel Wave-3 outputs into a coherent whole — verify the F-23 gate now honors the F-22 stale path end-to-end, dogfood `/loom-map` + the gate on loom-ai itself, and land the README `/loom-map` section — without touching any single-owner file from Waves 1–2.
**Dependencies:** Phase 3, Phase 4
**File Ownership:** README.md, .loom/learnings.toon

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| README.md | Modify | wiring-agent |
| .loom/learnings.toon | Modify | wiring-agent |

#### Acceptance Criteria
- [ ] README gains a full `/loom-map` section (per the "docs must keep pace" convention — a section per surface, not a table row) covering the build path, the four verbs, the freshness gate, and the `[gates] requireFreshMap` ramp.
- [ ] Dogfood (DEVEX-F-07): running `/loom-map` then exercising the F-23 gate (absent → auto-build → fresh → force-stale → block/nudge) on loom-ai itself completes end-to-end; friction is captured to `.loom/learnings.toon`.
- [ ] With F-22 present, `/loom-converge` in `block` mode blocks on a stale map with a stale-specific remedy naming the drifted files, and a `/loom-map refresh` clears it (the Phase-3 deferred stale path is now verified live).
- [ ] `bunx tsc --noEmit` and `bun test` both exit 0 across the full M-09 surface.

#### Convergence Targets
- End-to-end: force-stale → `/loom-converge` (block mode) exits non-zero naming drifted files → `/loom-map refresh` → `/loom-converge` proceeds (cli-exit-code sequence).

#### Scenarios

```toon
id: S-20
title: Stale map blocks converge in block mode with a drifted-files remedy
given[2]: A codebase-map.toon with mapStale true from the F-22 hook, orchestration.toml sets gates.requireFreshMap to block
when: A user runs /loom-converge
whenTriggerType: actor-action
then[3]: The command MUST exit non-zero, The remedy MUST name the drifted files, After a /loom-map refresh the same command MUST proceed
stateRef: stale
tags[2]: error, regression
testTier: e2e
automatable: true
```

```toon
id: S-21
title: README documents the /loom-map surface
given[1]: The repo after Wave 3
when: The README is inspected for a /loom-map section
whenTriggerType: system-event
then[2]: A dedicated /loom-map section MUST exist, It MUST document the four verbs and the requireFreshMap ramp
stateRef:
tags[1]: happy-path
testTier: qa-review
automatable: false
```

## Verification Commands

```bash
# Contracts + libs
bunx tsc --noEmit
bun test hooks/lib/map-state.test.ts
bun test hooks/map-freshness.test.ts

# Config wiring (Phase 0)
grep -q 'requireFreshMap' .claude/orchestration.toml
grep -q 'codebase-map-reviewer' .claude/orchestration.toml

# Net-new surfaces present, nothing else net-new (C-13)
test -f commands/loom-map.md
test -f agents/codebase-map-reviewer.md

# Map artifacts after a build
test -f .loom/maps/integration-map.toon
test -f .loom/maps/codebase-map.toon
test -f .loom/maps/route-map.toon

# Full suite + lint
bun test
bun run lint

# Docs kept pace
grep -q 'loom-map' README.md
grep -q 'requireFreshMap' docs/hooks.md
```

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **F-21 map-coverage may not converge** (F-21 is the critical-path linchpin; F-23/F-27/F-28/F-30/F-32 all hard-depend on `codebase-map.toon`). | Bounded convergence (C-11) — cap reviewer iterations; on non-consensus emit `MAP_CONVERGE_FAILED` and route surplus gaps to `.loom/learnings.toon` rather than looping. Any F-21 slip cascades, so it anchors Wave 2 (early). |
| **`.loom/maps/` two-writer collision** (maintainer writes `integration`; `/loom-map` writes `codebase`/`route`). | Maps relocated OUT of `.loom/wiki/` to `.loom/maps/` (review B4) so `hooks/wiki-write-guard.ts` — which blocks any non-wiki-agent write under `.loom/wiki/` during an active run — no longer applies. Under `.loom/maps/`, `hooks/file-ownership.ts` provides the real per-file enforcement (each map file is owned by its writing task). **Correction (review B5):** the prior claim that `file-ownership.ts` guarded the old `.loom/wiki/maps/` path was false — `file-ownership.ts:41` exempts `.loom/wiki/` unconditionally. Per-file ownership + atomic `.tmp`+rename now holds because the maps live where file-ownership actually governs. |
| **Gate becomes a wall users route around** (the exact F-23 risk C-15 warns about). | Ships `warn`-first with auto-invoke + `--skip-map-gate` logged escape; only flips to `block` after battle-testing. |
| **F-23 before F-22 leaves a half-gate.** | Explicit SF-03 interim: presence-only gate in Phase 3; stale path deferred to Phase 4 and verified in Phase 5 — documented as an acceptance sub-item, not a gap. |
| **Pre-launch activation starves M-06 (C-16).** | Plan captured, not executable; orchestrator refuses execution until M-06 Phase 2 clears. |

## Acceptance Criteria (Final)

- [ ] `wiki-maintainer-agent` serializes `integration-map.toon` each pass; `/loom-map` produces convergence-reviewed `codebase-map.toon`/`route-map.toon` (each declaring `edgeTypes[]`) at `coverage == 1.0`.
- [ ] Maps carry `lastMappedCommit`; the PreToolUse `map-freshness` hook flips `mapStale` past `staleThreshold` (fail-open) and surfaces a pre-stale nudge.
- [ ] The map precondition on `/loom-plan create` and `/loom-converge` ships `warn`-first with auto-invoke + a `--skip-map-gate` logged escape; `/loom-auto` inherits it.
- [ ] Only `/loom-map` is net-new (C-13); no SQLite/daemon/1M-context introduced (C-11); all artifacts are TOON-on-disk with atomic writes.
- [ ] Docs (DEVEX-F-02): README `/loom-map` section, `docs/hooks.md` gate entry, `docs/troubleshooting.md` block+remedy entry. Dogfooded on loom-ai (DEVEX-F-07).

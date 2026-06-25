---
name: plan-distribution-vs-migration-reconciliation
created: 2026-06-17
revised: 2026-06-17
author: m07-followup-session
status: decision
relatesTo:
  - planning/plans/PLAN-plugin-distribution.md
  - planning/plans/PLAN-plugin-marketplace-migration.md
  - planning/ROADMAP.md (M-07, F-15, F-16, F-17)
  - planning/ROADMAP-plugin-distribution.md (M-01, M-02)
---

# Reconciliation: plugin-distribution vs plugin-marketplace-migration

## TL;DR

**Neither plan ships a complete marketplace migration as written.** Execute a cherry-picked merge: distribution's submission machinery (Phases 0-8) + migration's runtime correctness (Phases 0-3) + a unified doctor that supersedes both. Drop 9 of distribution's phases into a follow-up roadmap. Resolve three design conflicts before kicking Wave 1 or the two doctors collide at integration time.

## What each plan actually delivers

### PLAN-plugin-distribution (1,973 lines, 17 phases, 9 waves, status `approved`)

**Executable as-written:** Phases 0-8 (the submission-blocking critical path) plus Phases 9 (doctor v1), 11 (update), 12 (uninstall). All have named files, exact-string acceptance criteria, TOON scenarios, and convergence targets.

**Bloat / premature / unbuildable as-written:**
- **Phase 13 (F-11) telemetry** — server is *explicitly* deferred; what ships is a local queue and a manifest-fetch counter. The C-09 kill criterion the telemetry supports has a GitHub Release download-ratio fallback already specified, making the apparatus optional.
- **Phase 14 (F-04b) doctor v2** — 5 acceptance bullets, zero scenarios for the `schema-orch` or `schema-wiki` checks. Check logic is undefined.
- **Phase 16 (F-08) plugin-declared hooks** — the *correct* end-state but directly competes with migration's `register-loom-hooks.ts` strategy. Shipping both creates a dual code path.
- **Phase 17a, 17b-i, 17b-ii** — 17b-ii is gated on `launchDate + 30d` real data. It's a future ROADMAP entry, not a phase.
- **Phase 17 (legacy)** — marked `superseded` but not deleted from the file.

### PLAN-plugin-marketplace-migration (503 lines, 5 phases, status `draft`)

**Executable as-written:** Phases 0-3. Strong specs, tight scope, runtime-correct.

**Half-spec'd:**
- **Phase 4a docs** — "Restructure Quickstart with plugin path, curl path, decision matrix" is one sentence of acceptance. Exactly the failure pattern flagged in MEMORY.md (`docs_must_keep_pace`): a one-line acceptance for a user-facing surface.
- **Phase 4b marketplace listing** — "marketplace listing submission" with no spec for what the listing contains: no copy, no screenshots, no categorization, no support contact. This is the listing-side gap.

**Misleading frontmatter:** `blockedUntil: M-06-Phase-1` — only Phase 4b is genuinely gated. Phases 0-3 plus 4a's E2E specs ship independently. ~85% of the plan's value lands without M-06.

**Quiet over-engineering:**
- Migration state machine (§6) has 6 states for a functionally 3-state flow.
- `MigrationEvidence` as a durable on-disk TOON log for a 1-shot rewrite is heavier than the checksum sidecar it replaces.
- `DOCTOR_VERSION_SKEW` / `DOCTOR_UPDATE_AVAILABLE` (HF-04 patches) duplicate `/loom-upgrade`'s job.

## The three real design conflicts

These are not overlap — they are contradictions that must be resolved before either plan executes alongside the other.

### Conflict 1: Curl install path status

| Distribution | Migration |
|---|---|
| C-01/C-03/C-09: curl is "demoted to documented escape hatch", machinery for delisting plugin OR demoting curl from README based on telemetry trend | "Deprecating or sunsetting the curl install.sh path" is an **explicit non-goal**. Curl is a first-class equivalent for enterprise / MDM-blocked networks |

**Resolution required:** Pick one positioning. Migration's framing is narrower and more honest — there are real enterprise contexts where the marketplace is blocked at the network layer and the only viable install is `curl`. The sunset machinery (C-03, C-09, F-11 telemetry, F-13 evaluation) is premature optimization. **Recommendation: adopt migration's positioning.** Drop C-03/C-09 machinery from the merged plan.

### Conflict 2: Hooks ownership

| Distribution | Migration |
|---|---|
| F-08 (Phase 16): plugin manifest's `hooks.json` owns hook registration. `register-loom-hooks.ts` is deleted. `~/.claude/settings.json` is never touched by Loom | F-17 (Phase 3): keep `register-loom-hooks.ts`, add `--tier auto\|local\|project` flag. Per-project default flips to `.claude/settings.local.json` |

**Resolution required:** These can coexist *only* if curl users stay on `register-loom-hooks.ts` and plugin users get `hooks.json`. If F-08 ships and curl is first-class, then both paths must continue to work — which is the migration plan's position. **Recommendation: adopt migration's F-17. Keep `register-loom-hooks.ts` indefinitely for curl users. Defer F-08 (plugin-declared hooks) — `hooks.json` in the plugin manifest already declares hooks for plugin installs; F-08's "strip settings.json" step is the part to drop.**

### Conflict 3: Doctor scope and check registry

| Distribution F-04 (Phase 9) | Migration F-16 (Phase 2) |
|---|---|
| Channel correctness: version-drift, channel-files, hooks, install-interrupted | Hook wiring correctness: hook-files-present, runner resolution, anchor form, orphan entries, bare-anchor legacy, tier ambiguity |
| ReportVersion=1 | Same shape, different check IDs |

**Resolution required:** Same command name `/loom-doctor`, same report envelope, *orthogonal* check sets. Distribution's F-04b (Phase 14) doctor v2 adds schema checks that *partially* overlap migration F-16's anchor/orphan work — two implementations would have to be reconciled later. **Recommendation: unify upfront. Single doctor with a check registry that merges both sets:**

```
channel-correctness:  version-drift, channel-files, install-interrupted          (from F-04)
hook-wiring:          hook-files-present, runner-resolution, anchor-form,
                      orphan-entries, bare-anchor, tier-ambiguity                (from F-16)
```

Doctor v2 schema checks (F-04b) defer to follow-up roadmap — `additionalProperties: true` on the upstream schema means drift detection is not load-bearing for ship.

## The merged executable plan

Phases that survive cherry-pick:

| # | Source | Feature | Wave | What |
|---|---|---|---|---|
| 0 | merged | F-15 contracts + migration-runner + settings-tier schemas | 0 | All TOON schemas on disk (already done — `protocols/upstream/`, `plugin-manifest.schema.md`, `hook-manifest.schema.md`, `doctor-report.schema.md`, `migration-evidence.schema.md`, `settings-tier.schema.md`, `migration-runner.schema.md`) |
| 1 | dist-F-07a | Minimal plugin-root resolver | 1 | `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` resolution lib + lint check |
| 2 | dist-F-15 / mig-F-15 | Plugin manifest + hook PATH safety + install.sh mutual-exclusion probe | 1 | `.claude-plugin/plugin.json`, `hooks/hooks.json`, install.sh exit code 9 on conflict, stripped-PATH hook probe |
| 3 | dist-F-02 | Graceful no-op + 24h dismissal in `commands/loom-init.md` | 2 | First-run handler, idempotent `/loom-init` |
| 4 | dist-F-01 | Plugin manifest first-run handler + `~/.loom/install.toon` with `channel=plugin` | 2 | install.toon persistence, channel detection |
| 5 | dist-F-09a | Listing copy + init success-output artifact (maintainer-approved) | 2 | The listing-side work migration's Phase 4b leaves under-specified |
| 6 | dist-F-03 | Atomic release pipeline (`act`-runnable) | 3 | Single `git tag` → tarball + marketplace manifest + GitHub Release in lock-step |
| 7 | dist-F-06 | Manifest-drift CI + sigstore attestation | 3 | Supply-chain gate (also satisfies M-06 Phase 1 dep) |
| 8 | dist-F-10a | Docker clean-machine E2E harness | 4 | First-invocation UX verified in a clean alpine container |
| 9 | **unified doctor** | F-04 ∪ F-16 check registry | 5 | Single `/loom-doctor` with channel + hook-wiring + tier checks |
| 10 | mig-F-17 | settings.local.json as default per-project tier, `--tier` flag on `register-loom-hooks.ts` | 5 | Curl-user tier flip; plugin users unaffected |
| 11 | mig-Phase-4a (expanded) | README restructure + 3 E2E specs | 6 | **With section-list contract**, not a one-line acceptance |
| 12 | mig-Phase-4b (expanded) | Marketplace submission | 6 | **With listing-content deliverable** (copy, screenshots, support contact, version-bump cadence) |
| 13 | dist-F-12 | `/loom-update` | 7 | Honors `pinnedVersion`; flips channel via `/loom-doctor --fix` |
| 14 | dist-F-13 | `/loom-uninstall` | 7 | Cleanly removes both channels |

**Deferred to a follow-up roadmap (call it M-08?):**

- F-04b doctor v2 (advanced schema checks) — only valuable after schema drift becomes a real user issue
- F-07 full plugin-root resolver (library.yaml + hooks) — minimal resolver from Phase 1 is enough for ship
- F-08 plugin-declared hooks / strip settings.json — conflicts with first-class curl
- F-11 telemetry — server isn't designed, GHA counter trend is the cheap fallback
- F-13/F-14 sunset criterion + triage labels — needs real launch data
- F-09b listing iteration — explicitly gated on launch+30d
- F-10b extended fixtures (stale-schema/mixed-channel/partial-migration) — chase real bugs as they surface

## Action items before Wave 1

1. **Author the merged plan file** as `planning/plans/PLAN-plugin-merged.md` with the 14 phases above, copying acceptance criteria verbatim from the source plans. Mark both source plans `superseded-by: PLAN-plugin-merged.md`. *(Out of scope for this session — needs a focused planning pass with the user.)*
2. **Update ROADMAP.md M-07** to point at the merged plan and include the deferred items as a new M-08 placeholder.
3. **Resolve `blockedUntil: M-06-Phase-1`** — Phase 7 of the merged plan IS M-06 Phase 1 (sigstore attestation), so the dependency is self-contained. Drop the blocker.
4. **Fix the under-specified phases** before they reach an implementer-agent:
   - Phase 11 README restructure: write a section-list contract (Hero, Quickstart, Plugin install path, Curl install path, Decision matrix, Troubleshooting → `/loom-doctor`, etc.)
   - Phase 12 marketplace submission: write a listing-content deliverable (140-char summary, 500-char description, screenshots, categorization, support contact, version-bump cadence)

## What survives from this session's earlier shipping

- `scripts/refresh-upstream-schemas.sh` and `.github/workflows/refresh-upstream-schemas.yml` are still load-bearing for the merged plan's Phase 0 / Phase 2 manifest validation. They are not affected by the cherry-pick decision.
- Wave 0 schemas on disk are reused as-is — they were authored for migration but every one is also valid for the merged plan.

# Loom OSS Launch — Installation & Distribution Architecture

**Status:** Phase 0 IN-FLIGHT (last updated 2026-06-04). 4 of 6 Phase 0 deliverables shipped to disk (schemas v3, version cadence, verify-release, cosign spike workflow). Two preconditions remain before Phase 0 closes: (a) cosign spike workflow needs a real `workflow_dispatch` run on GitHub Actions to verify keyless signing end-to-end (~2 hours, low risk); (b) 5-stranger demand test gates the plan — if 4+/5 cold-install bounces, the entire installation polish stream halts pending re-scoping. Phase 1 (release workflow + install-state v3 implementation) cannot start until both gates clear. Convergence engine + scenarios + change-proposal lifecycle (M-01 through M-03 + spec-upgrades) all shipped — the launch story is "convergence-first dev tool" not "yet another orchestrator."

**Original lock:** 2026-05-07 — incorporates 4-agent review (strategy, phasing, architecture, devil's advocate).
**Owner:** Jensen (solo maintainer)
**Scope:** installation/distribution architecture only. Repo readiness, WIP scrub, and launch announcement are sibling streams.

## Goal

Public open-source launch of Loom in a fresh repo under `launchstack-dev`. Polish installation tooling to 2026 best practice for a public OSS dev tool with elevated permissions (hooks intercept tool calls, modify `~/.claude/`).

## Context

- Repo target: fresh repo under `launchstack-dev` (clean cut from current WIP-laden working copy; this transplant landed on `oss-launch-spec-upgrades`).
- License: **Apache 2.0** (commit `b8a8f46` on local-main lineage; restored on this branch). Chosen over MIT for the explicit patent grant and the contributor protections that matter for a tool with elevated permissions (hooks intercept tool calls, modify `~/.claude/`).
- Cross-platform vision: Claude Code primary; OpenCode/Codex/Pi follow (per ROADMAP F-09 / C-09). All on-disk state is platform-agnostic TOON.
- Solo maintainer. Loom dogfoods its own implementation work.
- Current install: `curl|bash` from `main`, fetches ~50 individual files, sha256 manifest fetched from the same branch it's verifying.

## Demand validation precondition

**5-stranger test runs before Phase 0 closes.** Recruit 5 Claude Code users from Discord; have them run the current `install.sh` cold; observe bounce rate and friction points. If 4+/5 bounce, distribution polish is solving the wrong problem and this plan halts pending re-scoping. Time cost: ~2 days. Findings feed Phase 0 cadence and channel decisions.

## Architecture (after 6 debate rounds + 4-agent review)

### Distribution channels (3, down from 4)

- **Homebrew**: `launchstack-dev/homebrew-tap/loom` — formula auto-generated from each GitHub Release. Mac dev path of least resistance.
- **curl|bash**: `install.sh` shim — downloads signed release tarball, verifies, unpacks. Falls back to `gh api` for private installs. Universal fallback.
- **Claude Code plugin manifest**: stub-only — redirects to `curl|bash` install. Pure discovery surface, no install logic. Targets the marketplace audience without committing to plugin-spec stability.

**npm dropped.** The thin-wrapper-around-GH-Releases pattern was rejected by the architecture review (supply-chain footgun without compensating value). Revisit only if `loom-core` ever becomes a real Node package with importable modules — at which point publish it directly, not as a fetcher shim.

### Source of truth

- **GitHub Releases** is canonical: signed tarball + SHA256 manifest + release notes per version.
- **Signing**: cosign + Sigstore via GitHub Actions (keyless, OIDC-backed). Validation spike in Phase 0.
- Installer pins to the latest tag by default; accepts `--ref vX.Y.Z` for explicit version.
- Tarball verification happens in the installer with cosign's public verification flow — no rolled-our-own crypto.

### Versioned components

- `loom-core` — commands, protocols, schemas. Atomic, prompted updates, semver.
- `loom-kit-*` — specialized agents, language packs, integrations. Pulled on demand; auto-update on use (opt-in by definition).
- `loom-hooks` — file-ownership, contract-lock, statusline, etc. Never auto-update; explicit `/loom-upgrade --hooks` shows diff and requires confirmation.

### Version-compat machinery (NEW — closes the silent-fail gap)

The differentiated update model only works if components can declare their cross-component requirements. Without this, a stale hook or a kit that needs hook v2 features creates either a security regression (file-ownership.ts fails open on unreadable state, masking the security boundary's disappearance) or a silent UX cliff.

**Schema additions:**
- `kit.schema.md` gains `minHooksVersion`, `minCoreVersion`.
- `loom-core` startup performs a **fail-closed** version-compat check: if installed `loom-hooks` is below `minHooksVersion` for `loom-core`'s expected protocol, refuse to run and surface the upgrade prompt instead of degrading silently.
- Kit install flow checks `minHooksVersion` / `minCoreVersion` before activation; if unmet, blocks the kit and prompts the user to upgrade the gating component (with diff-and-confirm for hooks).
- `file-ownership.ts` and other hooks inspect `state.toon` for a `protocolVersion` field; on mismatch, fail **closed**, not open.

### State & rollback (REVISED — file-scoped)

Extend `install-state.toon` with:
- per-component pinned versions
- integrity hash for every installed file
- last-known-good snapshot for atomic rollback on failed upgrade

**Rollback is file-scoped, not directory-scoped.** Loom only restores files listed in `install-state.toon`'s tracked manifest. Other tools (gsd, hookify, deckos, etc.) writing to `~/.claude/settings.json` or other shared paths between snapshot and apply are not clobbered by Loom rollback.

**Atomicity strategy:** stage installs to `~/.cache/loom/staging-vX.Y.Z/`, verify integrity, then atomically swap into `~/.claude/` paths file-by-file with `rename(2)`. On failure, swap back from snapshot. Symlink-based versioned install dirs considered but rejected — too disruptive to current `~/.claude/` layout.

### Update UX

- Statusline: `v0.5.0 available — /loom-upgrade` (existing pattern, unchanged).
- `/loom-upgrade` — prompted, atomic, rollback on failure. Shows summary of which components will move (core / kits / hooks) and surfaces any cross-component requirements.
- `/loom-upgrade --kits` — silent, additive only. Blocks if a kit's `minHooksVersion` / `minCoreVersion` is unmet.
- `/loom-upgrade --hooks` — shows diff, requires explicit confirmation.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Multi-channel distribution (Homebrew + curl + plugin stub) | Locked, npm dropped |
| 2 | Tagged releases as default | Locked |
| 3 | Hybrid: atomic core + on-demand kits | Locked, requires catalog v3 schema |
| 4 | Plugin manifest as discovery shim (stub-only) | Locked, scope reduced to redirect-only |
| ~~5~~ | ~~GH Releases canonical, npm thin wrapper~~ | **Cut.** GH Releases canonical, no npm. |
| 6 | Differentiated update semantics by component risk | Locked, **requires version-compat machinery (new section above)** |
| 7 | File-scoped rollback (NEW) | Locked, replaces naive directory snapshot |
| 8 | First-version cadence: `v0.0.x` series until schemas stabilize | Locked |

## Phase 0 — Spikes and contracts (Day 1, no shippable artifact)

Nothing in Phases 1+ starts until Phase 0 closes.

- **5-stranger demand test** — STILL OUTSTANDING. Go/no-go on the entire plan. Recruit 5 Claude Code users from Discord; have them run the current `install.sh` cold; observe bounce rate and friction points. If 4+/5 bounce, distribution polish is solving the wrong problem and this plan halts pending re-scoping. Time cost: ~2 days.
- **Cosign/Sigstore OIDC spike** — WORKFLOW AUTHORED (`.github/workflows/cosign-spike.yml`), UNVERIFIED. Needs an actual run in `launchstack-dev` org repo with default Actions permissions to confirm keyless signing works. Failure forces fallback to GPG-signed releases.
- **Catalog schema v3** — LANDED at `agents/protocols/library-catalog.schema.md`. Adds `releases[]` block (signed tarball URLs), top-level `loomCoreVersion` / `loomHooksVersion`, kit-level `minCoreVersion` / `minHooksVersion`. v2→v3 migration is backward-compatible.
- **`install-state.toon` schema v3** — LANDED at `agents/protocols/install-state.schema.md`. Adds pinned versions per component, per-file integrity hashes, snapshot pointer, `protocolVersion` for hook fail-closed checks, v2→v3 reader spec.
- **Fresh-repo decision** — LANDED at `.plan-history/explorations/2026-05-07-fresh-repo-decision.md`. **Option B (`git filter-repo`)** confirmed by maintainer 2026-05-07. Audit + rewrite execution scheduled at end of Phase 0 / start of Phase 1. Falls back to Option A only if audit surfaces unscrubbable content.
- **`v0.0.x` cadence policy** — LANDED at `docs/version-cadence.md`. Patch-only inside v0.0.x; exit to v0.1.0 after 30 days of stable v3 schemas in production.

**Phase 0 status (2026-05-26):** 4/6 deliverables landed. Remaining: 5-stranger test (high-impact, not started) and cosign spike verification (~2 hours, low risk). Phase 0 does not close until both are settled.

## Effort estimate (revised)

| Phase | Task | Days |
|---|---|---|
| 0 | Spikes + contracts (above) | 1.0 |
| 0 | 5-stranger test (parallel) | 2.0 |
| 1 | GH Actions release workflow + cosign + tag trigger | 1.5 |
| 1 | `install-state.toon` v2 implementation + migration reader | 1.5 |
| 1 | Catalog v3 schema implementation + library.yaml migration | 0.5 |
| 1 | Plugin manifest stub | 0.25 |
| 2 | Homebrew formula generator | 0.75 |
| 2 | `install.sh` rewrite as shim | 0.5 |
| 2 | Release notes + version bump tooling | 0.5 |
| 3 | Version-compat machinery (kit checks, hook fail-closed, core startup gate) | 1.0 |
| 3 | `/loom-upgrade` differentiated semantics | 1.5 |
| 4 | CI test matrix (macOS/Ubuntu: install → use → upgrade → rollback → schema-v1 upgrade) | 1.5 |
| | **Total work-days** | **~12.5** |

5-stranger test runs concurrent with Phase 0 spikes; calendar impact ~2 days. Loom-assisted implementation collapses authoring time but cannot collapse cosign/CI human-in-the-loop verification. Realistic calendar: **~6–8 days**.

## Phase order and critical path

**Critical path** (cannot parallelize):
Phase 0 spike → catalog v3 schema doc → `install-state.toon` v2 schema doc → GH Actions workflow produces signed tagged tarball → version-compat machinery → `/loom-upgrade` with rollback → CI matrix passes.

Off the critical path (can be broken at launch and tarball-direct install still works): Homebrew formula, plugin manifest, `install.sh` shim polish.

## Sibling streams (out of scope, but blocking the launch)

- Repo readiness (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / `.github/` templates / secrets sweep with gitleaks or trufflehog).
- WIP scrub and fresh-repo migration logistics (depends on Phase 0 fresh-repo decision).
- Positioning statement and launch announcement (HN / X / dev.to / Discord). **Strategy review flagged absence of positioning statement as HIGH.** Draft alongside Phase 1.
- OpenCode / Codex / Pi platform-specific install adapters (deferred per ROADMAP F-09).

## Open questions (post-revision)

- Cross-platform discovery parity: should we commit now to a discovery-shim pattern for each platform we eventually support, or only do Claude Code's plugin manifest? (Strategy flagged the Claude Code-only manifest as a vaporware-signal risk.)
- Plugin manifest stub format: pinned to spec date, with explicit "may break" note in the release? Or skip until spec stabilizes?
- Version cadence: does a `loom-hooks` patch bump count as a "loom-core" patch or get its own version stream? Affects how the statusline notifier categorizes updates.

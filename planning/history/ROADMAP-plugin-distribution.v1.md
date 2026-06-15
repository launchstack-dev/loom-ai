---
roadmapVersion: 1
name: "Loom Marketplace & Plugin Distribution"
status: reviewed
created: 2026-06-15
lastReviewed: 2026-06-15
targetDate: null
totalFeatures: 10
totalMilestones: 2
sources:
  - planning/history/explorations/2026-06-15-marketplace-plugin-distribution.toon
  - .plan-execution/debate-20260615-090957.toon
  - .plan-execution/debate-20260615-091500-marketplace-day-one.toon
---

# Roadmap: Loom Marketplace & Plugin Distribution

## Vision

Loom ships today as a `curl | bash` installer that writes to both `~/.claude/` and the project repo root. That distribution model loses on discoverability (Claude Code users browse the marketplace, not GitHub READMEs), trust signal (curl-piping triggers reasonable security skepticism), and update ergonomics (every release is a hand-tested re-install). This roadmap makes the Claude Code marketplace/plugin the **primary** distribution channel and demotes curl to a documented escape hatch for power users, CI bootstrap, air-gapped, and customization-heavy installs. The end-state is a single atomic release pipeline (one `git tag` → one tarball → marketplace manifest + GitHub Release in lock-step) with first-class first-invocation UX (no manual `/loom-init` cliff), a concrete signal-gated sunset criterion for curl prominence, and a single-resolver-layer for repo-root artifacts so Anthropic's inevitable future changes to plugin path semantics do not metastasize across every Loom agent.

### Positioning

Loom remains the planning + convergence workflow layer on top of Claude Code. Plugin distribution is how that layer reaches users; it does not change what Loom is. If Anthropic ships first-party planning primitives, Loom repositions as the *opinionated workflow layer* over them — not as a competing planning tool.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| First-invocation success | 100% of `claude plugin add loom` installs reach a usable state without manual `/loom-init` | Containerized clean-machine install fixture passes |
| Marketplace install share | Plugin installs ≥ curl installs within 90 days of marketplace listing | GitHub Release asset downloads vs marketplace install telemetry |
| Sunset criterion satisfaction | Plugin installs ≥ 5× curl over rolling 30-day window AND `loom doctor` parity for 2 consecutive releases AND `/loom-migrate-to-plugin` shipped ≥ 60 days | Quarterly review of telemetry signals |
| Release pipeline atomicity | 0 releases where marketplace manifest and GitHub Release asset disagree on sha256 | CI manifest-drift check on every tagged release |
| Hook installation cleanliness | 0 `settings.json` hook hand-edits in Phase 2 | Plugin-declared hooks ship in plugin manifest |
| Repo-root artifact resolution | All `${LOOM_PLUGIN_ROOT}` references route through a single resolver function | Static lint check; no inline path references in agent prompts |
| Supply-chain attestation | 100% of GitHub Release assets sigstore-signed | Verification step in CI before publish |

## Constraints & Decisions

### C-01: Marketplace is the Primary Distribution Channel
**Decision:** The Claude Code marketplace/plugin is the **primary** install path. Curl remains a documented escape hatch for power users, CI bootstrap, air-gapped, and customization-heavy installs.
**Rationale:** Plugins/marketplace are GA with a documented manifest. For a Claude Code extension, absence from the official extension surface is invisibility, not a soft funnel cost. Two prior debates converged on this position.
**Alternatives considered:** Curl-primary with marketplace mirror (rejected — "sequence without a clock" collapses to permanent dual-channel; discoverability cost compounds monthly).
**Impact:** high

### C-02: Marketplace Listing Day One — With UX-Cliff Precondition
**Decision:** Submit to the official Anthropic marketplace from day one. **Hard precondition:** first-invocation UX must work without manual `/loom-init` — either auto-run `/loom-init` on first plugin invocation, or make all `/loom-*` commands graceful no-ops with a clear "run `/loom-init` to activate" message until init completes. Self-hosted plugin URL (`claude plugin add github:loom-ai/loom`) ships as a documented co-equal install path, not a hidden fallback.
**Rationale:** Self-hosted-only Phase 1 produces no attribution baseline (no browse surface to measure marketplace funnel from), and gatekeeping via technical-user-only install defeats Phase 1's demand-validation purpose. But rejection risk on a thin-veneer plugin with a known `/loom-init` cliff is real, so the cliff must be fixed before submission.
**Alternatives considered:** Self-hosted Phase 1, marketplace Phase 2 (rejected after debate — academic attribution baseline, tautological demand validation). Marketplace day one without UX-cliff fix (rejected — high rejection risk, poor early reviews durably affect launch).
**Impact:** high

### C-03: Sunset Criterion is Signal-Gated, Not Date-Gated
**Decision:** Curl is demoted from README to advanced-install doc when **all three** are true: (a) plugin install count ≥ 5× curl over rolling 30-day window, (b) `loom doctor` reports parity across both channels for two consecutive releases, (c) `/loom-migrate-to-plugin` opt-in command has shipped for ≥ 60 days. Until all three: both channels first-class.
**Rationale:** A pure date trigger fires whether the underlying signals justify it or not. A 5× ratio captures momentum; parity captures functional correctness; the 60-day migration runway prevents stranding existing users.
**Alternatives considered:** Date-based sunset (rejected — disconnected from signal); never demote (rejected — permanent dual-channel maintenance tax).
**Impact:** high

### C-04: Single Resolver Layer for `${LOOM_PLUGIN_ROOT}`
**Decision:** All references to plugin-root-relative paths route through a single resolver function. The variable never appears inline in agent prompts, skill bodies, or protocol files. `/loom-init` writes a `.loom/plugin-root` pointer file so repo-root code can locate the plugin install directory.
**Rationale:** Anthropic will change plugin path semantics (sandbox model, content-addressed bundles, signed packaging — pick the future). Every inline path reference is a migration coupon issued against ourselves. A single resolver localizes the migration cost.
**Alternatives considered:** Inline `${LOOM_PLUGIN_ROOT}` in agent prompts (rejected — debt that bites in 18 months); ship absolute paths only (rejected — breaks worktree behavior).
**Impact:** high

### C-05: One Artifact, Two Delivery URLs
**Decision:** A single `git tag vX.Y.Z` triggers a single GitHub Actions workflow that (a) builds one tarball, (b) uploads it to GitHub Releases (curl install source), (c) generates a plugin manifest pointing at the same Release asset URL with sha256, (d) opens a PR to the marketplace repo bumping the manifest. Curl installer fetches the same Release asset the manifest references. The release is never built twice.
**Rationale:** Two-build pipelines drift silently. A single artifact with two delivery URLs makes drift impossible by construction; the manifest-hash CI check catches the rare case where the publish step half-completes.
**Alternatives considered:** Separate build per channel (rejected — drift inevitable); manifest-only build (rejected — strands curl users).
**Impact:** high

### C-06: Channel-of-Install Flag Baked at Install Time
**Decision:** Curl installer writes `install.channel = curl` to `~/.loom/install.toon`. Plugin install path is detected via presence of `~/.claude/plugins/loom/`. Issue tracker uses `channel:curl` and `channel:plugin` labels for support triage.
**Rationale:** Support triage is impossible without knowing how a user got Loom installed. The flag costs nothing at install time and gates an entire class of "I installed via X and Y is broken" debugging.
**Impact:** medium

### C-07: Plugin-Declared Hooks, Not `settings.json` Hand-Edits
**Decision:** Phase 2 ships hooks via the plugin manifest's hooks declaration. Plugin-declared hooks resolve relative to the plugin root and version-lock with the agent code that reads their output. Phase 1 may continue to hand-edit `settings.json` during the thin-veneer wrapper era; the migration to plugin-declared hooks is part of Phase 2's `${LOOM_PLUGIN_ROOT}` work.
**Rationale:** Hand-edited `settings.json` hooks drift on every update and break across worktrees. Plugin-declared hooks are the only forward-compatible answer.
**Impact:** medium

### C-08: Supply-Chain Attestation Before Phase 2
**Decision:** Sigstore/cosign attestation on the GitHub Release asset ships before the official marketplace listing goes live. The plugin manifest verifies the sha256 against the signed attestation.
**Rationale:** A compromised GitHub token could republish a poisoned tarball to both channels; the manifest-hash check catches drift but not signed-but-malicious. Attestation closes the loop.
**Alternatives considered:** Defer to Phase 2 follow-on (rejected — supply-chain incidents in similar tooling have shown the cost of "we'll add signing later").
**Impact:** medium

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | Installer logic, hooks, `loom doctor` |
| Language | TypeScript | 5.x | Installer, doctor, manifest generator |
| Package runner | bun | latest | Preferred; npm/npx fallback |
| Testing | vitest | latest | Manifest generation, doctor checks, migration |
| CI | GitHub Actions | n/a | Atomic release pipeline, manifest-drift check, sigstore attestation |
| Signing | sigstore/cosign | latest | Release asset attestation |
| Container fixture | Docker (or equivalent) | n/a | End-to-end plugin install verification on clean machine |
| Data format | TOON | n/a | `install.toon`, `loom doctor` reports, all Loom artifacts |

## Features

### F-01: Plugin manifest + thin-veneer install path

**Priority:** P0
**Milestone:** M-01
**Description:** Author the plugin manifest declaring Loom's `agents/`, `commands/`, `skills/`, and (Phase 2) `hooks/` directories. Phase 1 manifest wraps existing installer logic — on plugin activation, it materializes the same files the curl installer writes today (modulo first-invocation behavior — see F-02). Publish at a self-hosted GitHub URL so `claude plugin add github:loom-ai/loom` works pre-marketplace.

**Convergence targets:**
- `claude plugin add github:loom-ai/loom` succeeds on a clean Claude Code install
- Post-install, `~/.claude/plugins/loom/` contains the manifest and packaged resources
- `~/.loom/install.toon` records `channel = plugin`

### F-02: First-invocation UX (UX-cliff precondition for marketplace submission)

**Priority:** P0
**Milestone:** M-01
**Description:** Eliminate the manual `/loom-init` cliff for plugin users. Either (a) auto-run `/loom-init` the first time any `/loom-*` command is invoked in a project lacking `.loom/plugin-root`, or (b) every `/loom-*` command checks for `.loom/plugin-root` and graceful-no-ops with a clear "run `/loom-init` to activate Loom in this project" message until init completes. **This feature gates marketplace submission** (per C-02).

**Convergence targets:**
- On a clean project, `claude plugin add loom` followed by any `/loom-*` command produces either a working result or a clear actionable prompt — never a confusing error
- Containerized clean-machine fixture verifies first-invocation success without manual `/loom-init`

### F-03: Atomic release pipeline (one artifact, two delivery URLs)

**Priority:** P0
**Milestone:** M-01
**Description:** Single GitHub Actions workflow triggered by `git tag vX.Y.Z`: builds one tarball, uploads to GitHub Releases, generates plugin manifest with sha256, opens PR to marketplace repo bumping manifest. Curl installer pins to the latest tag and fetches the same Release asset the manifest references. Channel flag baked at install time per C-06.

**Convergence targets:**
- `git tag v0.1.0 && git push --tags` triggers the workflow end-to-end without manual intervention
- Marketplace manifest and GitHub Release asset agree on sha256 (CI check, see F-06)
- Curl installer fetches the same tarball the manifest references

### F-04: `loom doctor` v1 — version + schema + channel drift checks

**Priority:** P0
**Milestone:** M-01
**Description:** New `/loom-doctor` command that checks (a) installed Loom version vs latest manifest, (b) `orchestration.toml` schema version vs current, (c) `.loom/wiki/` artifact schema vs available `/loom-upgrade` migrations, (d) install-channel flag vs actual file locations, (e) Claude Code plugin spec version vs what the manifest targets. Output: TOON report with red/yellow/green per check and the exact follow-up command to run.

**Convergence targets:**
- `/loom-doctor` on a fresh plugin install reports all checks green
- `/loom-doctor` on a deliberately-broken install (e.g., schema mismatch) reports the specific failure and the exact `/loom-upgrade` command to fix it

### F-05: `/loom-migrate-to-plugin` opt-in migration command

**Priority:** P0
**Milestone:** M-01
**Description:** Opt-in command for existing curl-installed users to move to the plugin channel without losing committed `.loom/wiki/`, `.plan-execution/`, or `orchestration.toml` state. Detects current install channel, materializes the plugin install, preserves repo-root artifacts, and updates `install.channel` to `plugin`.

**Convergence targets:**
- On a project with curl-installed Loom and committed `.loom/wiki/`, running `/loom-migrate-to-plugin` produces a working plugin install with all wiki content intact
- The command is idempotent (running twice is a no-op)
- Documentation surfaces the messaging "Do nothing — both work. New projects: use the plugin. Existing projects: `/loom-doctor` will tell you when to switch."

### F-06: Manifest-drift CI check + sigstore attestation

**Priority:** P0
**Milestone:** M-01
**Description:** CI check on every tagged release: compute sha256 of the GitHub Release asset, compare to the sha256 in the marketplace-published manifest, fail on mismatch. Sigstore/cosign attestation on the Release asset; manifest references the attestation. (Per C-05, C-08.)

**Convergence targets:**
- A hotfix that updates the manifest without rebuilding the Release asset fails CI
- Release asset has a verifiable sigstore signature; `cosign verify` passes against the published public key

### F-07: `${LOOM_PLUGIN_ROOT}` single resolver layer

**Priority:** P1
**Milestone:** M-02
**Description:** All references to plugin-root-relative paths route through one resolver function. The variable never appears inline in agent prompts, skill bodies, or protocol files. `/loom-init` writes `.loom/plugin-root`; the resolver reads it. `library.yaml` resolution is taught the variable and falls back to repo paths for hand-authored kits. (Per C-04.)

**Convergence targets:**
- A grep for `LOOM_PLUGIN_ROOT` in agent prompts and skill bodies returns 0 matches
- All path resolution goes through `hooks/lib/plugin-root-resolver.ts` (or equivalent)
- Hand-authored kits (no plugin install) continue to resolve via repo paths

### F-08: Plugin-declared hooks (migrate from settings.json edits)

**Priority:** P1
**Milestone:** M-02
**Description:** Migrate all Loom hooks from `~/.claude/settings.json` hand-edits to plugin-manifest declarations. Hooks version-lock with the plugin and resolve relative to the plugin root. Hook bodies use the `${LOOM_PLUGIN_ROOT}` resolver (F-07) to find repo-root state. (Per C-07.)

**Convergence targets:**
- After plugin install, `~/.claude/settings.json` has no Loom-related hook entries
- All Loom hooks fire correctly on PreToolUse/PostToolUse/UserPromptSubmit events
- Hooks work correctly across worktrees (each worktree resolves its own `.loom/plugin-root` pointer)

### F-09: Official Anthropic marketplace listing with outcome-led copy

**Priority:** P1
**Milestone:** M-02
**Description:** Submit Loom to the official Anthropic marketplace. Listing copy leads with outcomes ("ship features with rigor — convergence loops, planning waves, repo-committed wiki"), not feature lists. Explicit support expectation-capping ("community-supported, GitHub issues only, no SLA"). Submission gated on F-02 (first-invocation UX) and F-06 (sigstore attestation) per C-02 and C-08.

**Convergence targets:**
- Loom is listed on the official Anthropic marketplace
- Listing copy passes a "lead with outcomes, not features" review checklist
- Support-expectation language is present and prominent
- F-02 and F-06 are verifiably complete before submission

### F-10: CI fixture for end-to-end plugin install

**Priority:** P1
**Milestone:** M-02
**Description:** Containerized Claude Code harness (or vitest-mocked plugin runtime) that simulates a clean-machine plugin install end-to-end: install plugin, run `/loom-init`, run a sample convergence loop, verify output. Replaces hand-testing on the maintainer's laptop. Covers worktree behavior under plugin install (each worktree gets its own `.loom/plugin-root`).

**Convergence targets:**
- `bun test test/plugin-install-e2e.test.ts` exits 0 on a clean container
- Worktree fixture verifies that two worktrees of the same repo independently resolve to the same plugin root
- CI runs the fixture on every PR touching the manifest or installer logic

## Milestones

### M-01: Phase 1 — Marketplace Day-One Launch

**Features:** F-01, F-02, F-03, F-04, F-05, F-06
**Acceptance:** Loom is listed on the official Anthropic marketplace. First-invocation works without manual `/loom-init`. Atomic release pipeline produces a single sigstore-signed artifact served via both channels. Existing curl users have an opt-in migration path. `/loom-doctor` covers version, schema, and channel drift.
**Target:** TBD (gated on F-02 and F-06 completion; see C-02 and C-08)

### M-02: Phase 2 — Plugin-Native Architecture + Sunset

**Features:** F-07, F-08, F-09, F-10
**Acceptance:** Repo-root artifact resolution routes through a single resolver layer. Hooks are plugin-declared, not hand-edited into `settings.json`. CI fixture verifies end-to-end plugin install. Sunset criterion (C-03) is evaluated quarterly; when satisfied, curl is demoted from the README to an advanced-install doc.
**Target:** TBD (gated on M-01 completion and sunset-criterion telemetry)

## Risks

| Risk | Severity | Mitigation | Source |
|------|----------|------------|--------|
| `${LOOM_PLUGIN_ROOT}` becomes migration debt if Anthropic changes plugin path semantics | High | Single resolver layer (C-04, F-07); never inline in agent prompts | Skeptic, exploration round 2 |
| Silent manifest drift after a hotfix bypasses the atomic pipeline | High | CI hash-compare check on every tagged release (F-06) | Skeptic, exploration round 2 |
| Supply-chain attack via compromised GitHub token republishes poisoned tarball to both channels | High | Sigstore/cosign attestation before marketplace listing (C-08, F-06) | Ops, exploration round 2 |
| Marketplace submission rejected or earns durable bad early reviews due to `/loom-init` cliff | High | UX-cliff fix is a hard precondition for submission (C-02, F-02) | Debate 2 |
| Dual-channel maintenance becomes permanent (sunset never fires) | Medium | Signal-gated sunset criterion in roadmap (C-03); quarterly evaluation | PM, debates 1 + 2 |
| Brand dilution in marketplace adjacency to lightweight planning tools | Medium | Outcome-led listing copy (F-09); positioning as workflow layer not planning primitive | PM, exploration round 2 |
| Anthropic ships first-party planning primitive | Low–Medium | Reposition Loom as opinionated workflow layer over Anthropic primitives; do not compete on planning primitives directly | PM, exploration round 2 |
| Support volume exceeds maintainer capacity post-launch | Medium | Expectation-capping in listing copy (F-09); 2-week support-volume threshold triggers tightening | Critic, debate 2 |
| Worktree behavior under plugin install untested | Medium | CI fixture covers worktree scenarios explicitly (F-10) | Engineer, exploration round 1 |

## Open Questions

These need product/maintainer input before M-01 starts:

1. **F-02 implementation choice:** auto-run `/loom-init` on first invocation, OR graceful no-op with prompt? Auto-run is fewer steps for the user but writes to the repo without explicit consent; graceful no-op is more conservative but adds one step.
2. **F-10 timing:** Phase 1 must-have (Engineer's preference — prevents hand-tested releases) or Phase 2 follow-on (current plan, accepts hand-testing risk for M-01)?
3. **Kill threshold:** adopt Skeptic's "<500 marketplace-attributed installs AND <15% browse-attributed in 90 days = kill" as-is, or adjust based on community size at launch?
4. **Sunset trigger numerics:** the 5× ratio in C-03 is from PM round 2 — does the team want to validate that ratio against historical curl install rates, or treat it as a working assumption to revisit at first sunset evaluation?

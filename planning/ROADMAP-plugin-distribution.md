---
roadmapVersion: 4
name: "Loom Marketplace & Plugin Distribution"
status: approved
created: 2026-06-15
lastReviewed: 2026-06-15
lastRefined: 2026-06-15
targetDate: null
totalFeatures: 15
totalMilestones: 2
sources:
  - planning/history/explorations/2026-06-15-marketplace-plugin-distribution.toon
  - .plan-execution/debate-20260615-090957.toon
  - .plan-execution/debate-20260615-091500-marketplace-day-one.toon
  - planning/history/reviews/2026-06-15-roadmap-plugin-distribution-review.toon
  - 2026-06-15 user report: hook PATH-inheritance bug (folded into C-16 + F-15)
priorVersion: planning/history/ROADMAP-plugin-distribution.v1.md
---

# Roadmap: Loom Marketplace & Plugin Distribution

## Vision

Loom ships today as a `curl | bash` installer that writes to both `~/.claude/` and the project repo root. That distribution model loses on discoverability (Claude Code users browse the marketplace, not GitHub READMEs), trust signal (curl-piping triggers reasonable security skepticism), and update ergonomics (every release is a hand-tested re-install). This roadmap makes the Claude Code marketplace/plugin the **primary** distribution channel and demotes curl to a documented escape hatch for power users, CI bootstrap, air-gapped, and customization-heavy installs. The end-state is a single atomic release pipeline (one `git tag` → one tarball → marketplace manifest + GitHub Release in lock-step) with first-class first-invocation UX (no manual `/loom-init` cliff), a concrete signal-gated sunset criterion for curl prominence, and a single-resolver-layer for repo-root artifacts so Anthropic's inevitable future changes to plugin path semantics do not metastasize across every Loom agent.

### Primary Persona

**Solo or small-team developer using Claude Code for serious feature work** — comfortable with OSS tooling and `git tag` semantics, wants structured planning and convergence rigor without per-seat SaaS cost, files good bug reports, and accepts "community-supported, no SLA" if expectations are stated clearly upfront. This persona reads READMEs, browses marketplaces, and runs CLI commands without GUI training wheels. All listing copy, support-capping language, kill-criterion thresholds, and error messages are tuned for this audience.

### Positioning

Loom remains the planning + convergence workflow layer on top of Claude Code. Plugin distribution is how that layer reaches users; it does not change what Loom is. Differentiation in the marketplace adjacency (vs lightweight planning helpers, slash-command bundles, generic agent kits): Loom ships *opinionated workflow* — convergence loops, planning waves, repo-committed wiki, signal-gated phase transitions — not a grab bag of helpers. If Anthropic ships first-party planning primitives, Loom repositions as the *opinionated workflow layer* over them (see C-10).

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| First-invocation success | 100% of `claude plugin add loom` installs surface the init-prompt without error; `/loom-init` succeeds on first invocation in a clean repo | Containerized clean-machine fixture (F-10a) passes |
| Marketplace install share | Plugin installs ≥ curl installs within 90 days of marketplace listing | GitHub Release asset downloads vs install-channel ping (F-11) |
| Sunset criterion satisfaction | Plugin installs ≥ 5× curl over rolling 30-day window AND `loom doctor` parity for 2 consecutive releases AND `/loom-migrate-to-plugin` shipped ≥ 60 days | Quarterly review of F-11 telemetry signals |
| Release pipeline atomicity | 0 releases where marketplace manifest and GitHub Release asset disagree on sha256 | CI manifest-drift check on every tagged release |
| Hook installation cleanliness | 0 `settings.json` hook hand-edits in Phase 2 | Plugin-declared hooks ship in plugin manifest |
| Repo-root artifact resolution | All `${LOOM_PLUGIN_ROOT}` references route through `plugin-root-resolver.ts` | Static lint check; no inline path references in agent prompts |
| Supply-chain attestation | 100% of GitHub Release assets sigstore-signed | Verification step in CI before publish |
| Browse-attributed installs | ≥ 15% of new actives in first 90 days originate from marketplace browse (not direct link) | `install.toon` `source` sub-field (F-11) |

## Constraints & Decisions

### C-01: Marketplace is the Primary Distribution Channel
**Decision:** The Claude Code marketplace/plugin is the **primary** install path. Curl remains a documented escape hatch for power users, CI bootstrap, air-gapped, and customization-heavy installs.
**Rationale:** Plugins/marketplace are GA with a documented manifest. For a Claude Code extension, absence from the official extension surface is invisibility, not a soft funnel cost. Two prior debates converged on this position.
**Impact:** high

### C-02: Marketplace Listing Day One — With UX-Cliff Precondition
**Decision:** Submit to the official Anthropic marketplace from day one. **Hard precondition:** first-invocation UX must work without manual `/loom-init`. Per resolved Open Question 1 (now C-11), the implementation is **graceful no-op with prompt** — all `/loom-*` commands check for `.loom/plugin-root` and no-op with a clear "run `/loom-init` to activate Loom in this project" message until init completes. Self-hosted plugin URL (`claude plugin add github:loom-ai/loom`) ships as a documented co-equal install path.
**Rationale:** Self-hosted-only Phase 1 produces no attribution baseline. Gatekeeping defeats demand validation. Rejection risk on a thin-veneer plugin with a known UX cliff is real, so the cliff must be fixed before submission.
**Impact:** high

### C-03: Sunset Criterion is Signal-Gated, Not Date-Gated
**Decision:** Curl is demoted from README to advanced-install doc when **all three** are true: (a) plugin install count ≥ 5× curl over rolling 30-day window, (b) `loom doctor` reports parity across both channels for two consecutive releases, (c) `/loom-migrate-to-plugin` opt-in command has shipped for ≥ 60 days.
**Telemetry dependency:** F-11 owns measurement. If Anthropic does not expose per-plugin install telemetry to publishers, F-11 falls back to opt-in install-channel pings against a Loom-hosted endpoint (or GitHub Release download counts as a strict floor).
**Impact:** high

### C-04: Single Resolver Layer for `${LOOM_PLUGIN_ROOT}`
**Decision:** All references to plugin-root-relative paths route through `hooks/lib/plugin-root-resolver.ts`. The variable never appears inline in agent prompts, skill bodies, or protocol files. `/loom-init` writes a `.loom/plugin-root` pointer file (see Data Model below). A minimal resolver ships in M-01 alongside F-02 (per F-07a); F-07 in M-02 extends it to hooks and `library.yaml`.
**Impact:** high

### C-05: One Artifact, Two Delivery URLs
**Decision:** A single `git tag vX.Y.Z` triggers a single GitHub Actions workflow that (a) builds one tarball, (b) uploads it to GitHub Releases (curl install source), (c) generates a plugin manifest pointing at the same Release asset URL with sha256, (d) opens a PR to the marketplace repo bumping the manifest. The release is never built twice. Manifest-drift CI check (F-06) enforces atomicity.
**Impact:** high

### C-06: Install Source Disambiguation
**Decision:** `install.toon` records both `channel` (curl | plugin) and `source` (curl-script | marketplace-browse | self-hosted-url | direct-link | migration). Curl installer writes both; plugin install writes them via the first-run handler. Issue tracker uses `channel:*` and `source:*` labels for triage. **The browse-attributed install metric (Success Metrics row 8) requires the `source` sub-field** — without it, self-hosted plugin URLs are conflated with marketplace browse and C-02's demand-validation thesis is untestable.
**Impact:** high

### C-07: Plugin-Declared Hooks, Not `settings.json` Hand-Edits
**Decision:** Phase 2 ships hooks via the plugin manifest's hooks declaration. Phase 1 thin-veneer may continue to hand-edit `settings.json`; migration to plugin-declared hooks is part of F-08 in M-02.
**Impact:** medium

### C-08: Supply-Chain Attestation Before Marketplace Submission
**Decision:** Sigstore/cosign attestation on the GitHub Release asset ships **before** the marketplace listing goes live. The plugin manifest verifies the sha256 against the signed attestation.
**Impact:** medium

### C-09: Phase 1 Kill Criterion (Promoted from OQ-3)
**Decision:** If **fewer than 500 marketplace-attributed installs (sourced via marketplace browse per C-06, not direct link)** AND **fewer than 15% of new active users in first 90 days** originate from marketplace browse, the marketplace bet is killed: delist from official marketplace, return curl to README primacy, retain plugin as self-hosted-URL-only path for the power-user audience.
**Telemetry-unavailable fallback:** if F-11 opt-in pings cover <20% of known installs at the 90-day mark, the kill criterion defaults to the GitHub Release asset download ratio: curl downloads divided by plugin-manifest fetches. Plugin manifest fetches act as the install proxy; ratio must be ≥ 5:1 (plugin:curl) to avoid kill. This ensures evaluation is never deferred indefinitely due to measurement ambiguity.
**Rationale:** For unfunded OSS, a kill threshold is a first-class strategic decision, not an open question. Numbers from Skeptic round 2 of debate; revisit at first 90-day evaluation.
**Impact:** high

### C-10: Anthropic-Primitive Repositioning Trigger
**Decision:** If Anthropic ships first-party planning primitives (e.g., a `/plan` slash command with roadmap + wave semantics, or an official "convergence" surface), Loom enters a 30-day evaluation window. Decision points: (a) deprecate Loom's planning layer and retain only convergence + wiki + extensibility; (b) reposition as the opinionated workflow shell over Anthropic primitives; (c) continue head-to-head if Loom's depth (convergence loops, signal-gated phase transitions, kit/library system) materially exceeds the primitive surface. Default: (b).
**Impact:** medium

### C-11: First-Invocation Implementation = Graceful No-Op (Resolved OQ-1)
**Decision:** All `/loom-*` commands check for `.loom/plugin-root` on entry. If absent, the command emits a single-line prompt — *"Loom is not initialized in this project. Run `/loom-init` to activate."* — and exits with code 0. No state is written, no prompts are interactive. The "Loom is not initialized" message is suppressed for 24 hours after first display per project (tracked via `.loom/dismissed-init-prompt`).
**Rationale:** Auto-run has implicit-consent issues (writing to repos a user is just visiting, e.g., contributing to someone else's PR). Graceful no-op is reversible, predictable, and matches the explicit-consent model the rest of Loom uses.
**Impact:** high

### C-12: Documentation Surfaces Bound to Features
**Decision:** Every feature shipping a user-facing command (F-02, F-04, F-05, F-12, F-13) must ship: (1) inline `--help` output, (2) a documentation entry under `docs/commands/`, (3) a link from `loom doctor`'s output where the command is the suggested fix, (4) coverage in F-09a listing copy where relevant.
**Impact:** low

### C-13: Internal Critical Path Within M-01
**Decision:** Within M-01, two sub-tiers separate marketplace-submission-blocking work from milestone-completion work:
- **Submission-blocking (P0):** F-01, F-02, F-03, F-06, F-07a, F-09a, F-10a. These must complete before the marketplace submission PR opens. Seven features.
- **Milestone-required, post-submission fast-follow (P1 within M-01):** F-04, F-05, F-11, F-12, F-13. These ship in the first post-listing release; M-01 is not declared complete without them, but they do not block the listing going live.
**Rationale:** v2 review flagged M-01 as oversized (12 features) for unfunded OSS. Splitting the critical path within the milestone preserves the M-01 scope while removing the "all 12 must land together" blocking batch. New users arrive via the listing on submission-blocking work alone; migration, update, uninstall, and telemetry are valuable but not day-zero discovery surfaces.
**Impact:** high

### C-14: Competitive Differentiation Claim (for F-09a listing copy)
**Decision:** The listing's one-line differentiation claim, drafted here for strategic review (not deferred to copy-writing): *"Loom isn't a slash-command bundle or planning helper — it's an opinionated workflow loop: roadmap → plan → waves → convergence-gated execution, with a repo-committed wiki that survives the conversation."* F-09a copy work refines wording but the substantive claim (workflow loop + convergence gating + repo-committed wiki) is locked here.
**Impact:** medium

### C-15: F-10a Verification Infrastructure (Resolved OQ-1)
**Decision:** F-10a ships as a **Docker-based clean-machine harness** from day one, not a vitest-mocked plugin runtime. The harness pulls a minimal base image, installs Claude Code, runs `claude plugin add github:loom-ai/loom@<tag>` against the actual marketplace tarball, and exercises the first-invocation flow with a stripped subprocess PATH (per C-16). A vitest unit-level test covers the resolver function and other pure logic, but it does **not** count toward C-02's clean-machine precondition — only the Docker harness does.
**Rationale:** A mock cannot satisfy C-02's "clean machine" requirement, and the v3 review correctly flagged that "start with mock, escalate if needed" is a deferred bet sitting on the submission-blocking critical path. Locking Docker upfront eliminates the mid-sprint scope-change risk; the cost (one-time harness authoring, slower CI step) is bounded and lower than the cost of a scope event during submission week.
**Impact:** medium

### C-16: Hook Subprocess PATH Safety
**Decision:** The hook wrapper (`hooks/run-hook.sh`) must prepend `/opt/homebrew/bin` and `/usr/local/bin` to `PATH` before any runtime probe (bun → npx tsx → node fallback). The fix is a no-op when those paths are already present. **Rationale:** Claude Code launched from a GUI shortcut, cmux, Finder, or any non-login-shell context inherits a minimal `PATH` that does not include Homebrew's bin directory; `bun` lives at `/opt/homebrew/bin/bun`, so the probe falls through to `npx tsx`, which on Node 25+ has stricter ESM resolution that fails to load the tsx loader for `import "./lib/run-hook.js"`. The result is `node:internal/modules/esm/resolve:N` errors that the wrapper's exit-0 safety net cannot catch (resolution failure happens before TypeScript loads), surfaced by Claude Code as "Failed with non-blocking status code." This silently disables six PreToolUse contract enforcers (deploy-guard, contract-lock, file-ownership, wiki-write-guard, context-budget, budget-tracker). The fix MUST land before marketplace submission per F-15.
**Verification:** F-10a Docker harness exercises the wrapper under `env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh hooks/<hook>.ts` for all six PreToolUse hooks; all must exit 0 with no stderr.
**Impact:** high

## Data Model

All schemas live under `agents/protocols/` and use TOON per CLAUDE.md. Sketches below; canonical definitions ship as part of the features that produce them.

### `install.toon` (per-machine install state, at `~/.loom/install.toon`)
```
installedVersion: vX.Y.Z              # the Loom version installed
installTimestamp: 2026-06-15T12:00Z   # ISO 8601
installSourceUrl: github.com/...      # the URL the user installed from
runtimeVersion: node-20.11            # captured at install time
channel: curl | plugin                # see C-06
source: curl-script | marketplace-browse | self-hosted-url | direct-link | migration | beta-channel  # see C-06; beta-channel for github:...@beta refs
migratedFrom: { channel, version } | null  # populated by /loom-migrate-to-plugin
lastPing: 2026-06-15T18:00Z          # for F-11 opt-in telemetry
doNotTrack: false                    # set true on opt-out at first /loom-init; suppresses F-11 pings
updateInProgress: null               # { fromVersion, toVersion, startedAt } during /loom-update; cleared on success
```

### Plugin Manifest (consumed by Claude Code's plugin loader)
```
manifestVersion: 1                    # this manifest format
loomVersion: vX.Y.Z                   # the Loom release this manifest describes
sha256: <hex>                         # of the GitHub Release tarball
attestationUrl: sigstore://...        # for F-06 verification
minClaudeCodeVersion: X.Y             # supplied to F-04 doctor check (e)
compatibilityMatrix: [...]            # additional CC spec versions supported
hooks: [...]                          # plugin-declared hooks (M-02 / F-08)
permissions: [...]                    # scoped per agent
```

### `doctor-report.toon` (F-04 output)
```
generatedAt: 2026-06-15T12:00Z
loomVersion: vX.Y.Z
installChannel: curl | plugin         # embedded at top level per FC-08; redacted-safe
installSource: marketplace-browse | ...  # see C-06; embedded at top level
overall: green | yellow | red
checks[N]{name, category, status, detail, fixCommand, docsUrl}:
  version-drift, version, green, ..., ..., ...
  channel-files, channel, red, ..., /loom-migrate-to-plugin --reconcile, ...
  schema-drift, schema, yellow, ..., /loom-upgrade, ...        # F-04b (M-02) only
  plugin-spec, spec, green, ..., ..., ...                       # F-04b (M-02) only
diagnosticBundle: <path-to-shareable-tarball>  # redacted; for GitHub issue attachment
```

### `.loom/plugin-root` (per-project pointer, written by `/loom-init`)
```
pluginRoot: ~/.claude/plugins/loom/
pluginVersion: vX.Y.Z
initTimestamp: 2026-06-15T12:00Z
```

### `.loom/dismissed-init-prompt` (per-project no-op suppression marker, written by F-02)
```
dismissedAt: 2026-06-15T12:00Z       # ISO 8601; suppression expires 24h after this
```

**Serialization note:** all files named `*.toon` are TOON. The `/loom-doctor --json` flag emits TOON (not RFC-8259 JSON) — the flag name is conventional for "machine-readable" but the format follows CLAUDE.md's TOON-everywhere mandate. CI fixtures (F-10a) parse via the Loom TOON parser. If true JSON output is needed later, a `--json-strict` flag can be added without breaking the default.

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | 20+ | Installer logic, hooks, `loom doctor` |
| Language | TypeScript | 5.x | Installer, doctor, manifest generator |
| Package runner | bun | latest | Preferred; npm/npx fallback |
| Testing | vitest | latest | Manifest generation, doctor checks, migration |
| CI | GitHub Actions | n/a | Atomic release pipeline, manifest-drift check, sigstore attestation |
| Signing | sigstore/cosign | latest | Release asset attestation |
| Container fixture | Docker | n/a | End-to-end plugin install verification on clean machine |
| Data format | TOON | n/a | `install.toon`, `doctor-report.toon`, all Loom artifacts |

## Features

### F-01: Plugin manifest + thin-veneer install path

**Priority:** P0 · **Milestone:** M-01

Author the plugin manifest declaring Loom's `agents/`, `commands/`, `skills/`, and (Phase 2) `hooks/` directories. Manifest schema per Data Model above. Phase 1 manifest wraps existing installer logic — on plugin activation, it materializes the same files the curl installer writes today, modulo first-invocation behavior (F-02).

**Convergence targets:**
- `claude plugin add github:loom-ai/loom` succeeds on clean Claude Code install
- Post-install, `~/.claude/plugins/loom/` contains the manifest and packaged resources
- `~/.loom/install.toon` records `channel = plugin`, `source` per C-06

### F-02: First-invocation graceful-no-op UX (UX-cliff precondition)

**Priority:** P0 · **Milestone:** M-01 · **Decision:** C-11 (graceful no-op)

All `/loom-*` commands check for `.loom/plugin-root` on entry. If absent, emit single-line prompt and exit code 0 — no state mutation. Suppression: 24 hours after first display per project via `.loom/dismissed-init-prompt`. **This feature gates marketplace submission** (per C-02).

**Error/edge states defined:**
- **No git repo:** `/loom-init` itself errors with "Loom requires a git repository"; `/loom-*` commands fall through to the no-op prompt
- **Network error during `/loom-init`:** roll back partial writes; report which step failed; surface `/loom-doctor` for diagnostics
- **Missing `orchestration.toml` after init:** `/loom-init` writes a default; existing file is never overwritten
- **Worktree first-open:** worktree has no `.loom/plugin-root`; behaves identically to fresh project — the no-op prompt fires; user runs `/loom-init` per worktree
- **Repeated invocations within suppression window:** silent no-op exit code 0 (no message)

**Convergence targets:**
- F-10a containerized clean-machine fixture verifies first-invocation prompt → `/loom-init` → working state
- F-10a worktree fixture verifies independent per-worktree init

### F-03: Atomic release pipeline (one artifact, two delivery URLs)

**Priority:** P0 · **Milestone:** M-01

Single GHA workflow triggered by `git tag vX.Y.Z`: builds one tarball, uploads to GitHub Releases, generates plugin manifest with sha256, opens PR to marketplace repo bumping manifest, **generates `CHANGELOG.md` entry** as part of the workflow. Curl installer pins to latest tag and fetches the same Release asset.

**Convergence targets:**
- `git tag v0.1.0 && git push --tags` triggers workflow end-to-end without manual intervention
- Marketplace manifest and GitHub Release asset agree on sha256 (CI check, F-06)
- `CHANGELOG.md` entry is auto-generated and committed as part of the release

### F-04: `/loom-doctor` v1 — channel + version drift (scope-reduced)

**Priority:** P1 within M-01 (post-submission fast-follow per C-13) · **Milestone:** M-01

Reduced scope per review feedback: ships only checks (a) installed Loom version vs latest manifest and (d) install-channel flag vs actual file locations. Output per `doctor-report.toon` schema (Data Model).

**Flags:** `--json` (machine-readable per Data Model schema), `--check <name>` (single check), `--bundle` (produces shareable diagnostic tarball for GitHub issues — redacted of secrets).

**Network-degraded behavior:** version check skips with `status: yellow, detail: "could not reach manifest endpoint"` on network failure. Local checks still run.

**Mixed-channel detection:** if `channel = curl` in `install.toon` but `~/.claude/plugins/loom/` exists (or vice versa), emit `status: red, fixCommand: /loom-migrate-to-plugin --reconcile` with `docsUrl` pointing to the broken-state recovery doc.

**Information hierarchy:** when multiple checks fail, output lists `red` checks first with prioritized `fixCommand`; `yellow` second; `green` summarized as count only.

**`fixCommand` constraint (FC-09):** M-01 `fixCommand` values are restricted to commands that exist in M-01: `/loom-migrate-to-plugin --reconcile`, `/loom-update`, `/loom-uninstall`, `/loom-init`. The `--fix` auto-remediation flag ships in F-04b (M-02). A stub `--fix` exists in M-01 that emits "auto-remediation ships in F-04b; run the listed fixCommand manually" and exits 0.

**Convergence targets:**
- `/loom-doctor` on fresh plugin install: all checks green
- `/loom-doctor --json` on broken install: machine-parseable, F-10a CI fixture asserts on field values
- `/loom-doctor --bundle` produces a `.tar.gz` with redacted `install.toon` + doctor report

### F-04b: `/loom-doctor` v2 — schema integration (deferred to M-02)

**Priority:** P1 · **Milestone:** M-02

Adds checks (b) `orchestration.toml` schema vs current, (c) `.loom/wiki/` artifact schema vs available `/loom-upgrade` migrations, (e) Claude Code plugin spec version vs manifest target. Adds `--fix` flag for auto-remediable issues (schema migrations with known upgrade paths).

### F-05: `/loom-migrate-to-plugin` with `--dry-run` + partial-failure recovery

**Priority:** P1 within M-01 (post-submission fast-follow per C-13) · **Milestone:** M-01

Opt-in command for existing curl-installed users. Detects current install channel, materializes plugin install, preserves repo-root artifacts (`.loom/wiki/`, `.plan-execution/`, `orchestration.toml`), updates `install.channel` to `plugin` and `install.source` to `migration`.

**`--dry-run` mode (P0):** print before/after diff of every mutation — files added under `~/.claude/plugins/loom/`, settings.json hook entries to be removed, `install.toon` field changes — without writing.

**Partial-failure recovery:** writes `.loom/migration-in-progress` marker before any mutation; clears it on success. If marker is found by `/loom-doctor` or a future `/loom-migrate-to-plugin` invocation, surfaces "migration in progress or interrupted — run `/loom-migrate-to-plugin --resume`".

**Per-project vs global:** command operates per-project. `/loom-doctor` (F-04) detects unmigrated curl-install projects and surfaces the command with the project path.

**Convergence targets:**
- On project with curl-installed Loom + committed `.loom/wiki/`: command produces working plugin install with all wiki content intact
- Command is idempotent (running twice is a no-op)
- `--dry-run` produces complete change preview without any mutation
- Partial-failure recovery: deliberately killing the process mid-run leaves a detectable marker; `--resume` completes from the marker

### F-06: Manifest-drift CI check + sigstore attestation

**Priority:** P0 · **Milestone:** M-01

CI check on every tagged release: compute sha256 of the GitHub Release asset, compare to the sha256 in the marketplace-published manifest, fail on mismatch. Sigstore/cosign attestation on the Release asset; manifest references the attestation URL (per C-08).

**Convergence targets:**
- A hotfix that updates the manifest without rebuilding the Release asset fails CI
- Release asset has a verifiable sigstore signature; `cosign verify` passes against the published public key

### F-09a: Outcome-led marketplace listing copy (promoted from M-02)

**Priority:** P0 (submission-blocking per C-13) · **Milestone:** M-01

Listing copy authored *before* marketplace submission. Leads with outcomes for the primary persona (see Vision): *"Add Loom to Claude Code in one click. Get planning waves, convergence loops, and a repo-committed wiki — out of the box."* Competitive differentiation per C-14: *"Not a slash-command bundle or planning helper — an opinionated workflow loop: roadmap → plan → waves → convergence-gated execution, with a repo-committed wiki that survives the conversation."* Explicit support-expectation capping: "Community-supported. GitHub issues only. No SLA."

**Single onboarding step surfaced:** the listing's "Install" CTA produces a single copy-pasteable command (`claude plugin add loom` or self-hosted URL) and tells the user the next step is `/loom-init` in their project.

**`/loom-init` success output spec (UX-NEW-03):** on first successful init, output a short summary: (a) what was written (`.loom/plugin-root`, `.loom/wiki/` skeleton, `orchestration.toml` if absent), (b) the suggested next command (typically `/loom-roadmap init` for a new project or `/loom-status` for a brownfield project), (c) the telemetry opt-in prompt (per F-11), presented as the penultimate step before exit.

**Convergence targets:**
- Listing copy reviewed against an outcomes-not-features checklist before submission
- Single onboarding command is prominently displayed
- Support-expectation language is present above the fold
- `/loom-init` success summary spec implemented and verified by F-10a

### F-10a: CI fixture — first-invocation + worktree (promoted from M-02)

**Priority:** P0 · **Milestone:** M-01

Containerized clean-machine harness simulating end-to-end first invocation: install plugin, run any `/loom-*` command (verify graceful no-op prompt fires), run `/loom-init`, verify working state. Includes a worktree scenario: open a worktree, verify independent per-worktree init.

**This fixture is the verification mechanism for C-02's hard precondition.** F-02 acceptance depends on this.

**Convergence targets:**
- `bun test test/plugin-install-e2e.test.ts` exits 0 on a clean container
- Worktree fixture verifies independent init per worktree

### F-11: Install telemetry collection (sunset-criterion plumbing)

**Priority:** P1 within M-01 (post-submission fast-follow per C-13) · **Milestone:** M-01

**Telemetry opt-in interaction point:** opt-in is presented as the penultimate step inside `/loom-init`, after `orchestration.toml` is written and before exit. The prompt is one line: *"Send anonymous install pings to help us evaluate the curl→plugin sunset criterion? [y/N]"*. Default `N` writes `doNotTrack: true`; `y` enables `lastPing` updates.


Owns measurement for C-03 sunset criterion and C-09 kill criterion. Collects: GitHub Release asset download counts (curl, public API), marketplace install count (if Anthropic exposes; otherwise fall back), opt-in install-channel pings from `install.toon` `lastPing` (to a Loom-hosted endpoint, off by default, advertised in listing copy and `/loom-init`).

**Fallback path if marketplace telemetry is unavailable:** publish the opt-in ping endpoint; sunset evaluation uses ping ratio + GitHub Release downloads as proxy. Document this clearly so the 5× ratio remains computable.

**Convergence targets:**
- Quarterly sunset evaluation can be computed from collected signals
- Opt-in pings respect a "do not track" preference if set in `install.toon`
- Privacy doc surfaced from listing copy

### F-12: `/loom-update` command

**Priority:** P1 within M-01 (post-submission fast-follow per C-13) · **Milestone:** M-01

User-facing update command. For plugin installs: delegates to `claude plugin update loom` if Claude Code's plugin manager exposes it; otherwise re-runs plugin add against the latest manifest. For curl installs: re-runs the curl installer pinned to the latest tag. Detects channel via `install.toon`.

**Flags:**
- `--check` — report available vs installed version without applying. Used by `/loom-doctor` version drift check.
- `--channel curl | plugin` — override channel detection when `install.toon` is stale or wrong (known state after partial migration).
- `--resume` — resume from `install.toon.updateInProgress` marker.

**Update-in-progress marker (FC-07):** writes `install.toon.updateInProgress = { fromVersion, toVersion, startedAt }` before any mutation; clears on success. `/loom-doctor` detects the marker and surfaces `/loom-update --resume` as the fixCommand.

**Error states defined (UX-NEW-01):**
- **Download fails mid-transfer:** marker remains; report which step failed; `/loom-update --resume` retries from the marker.
- **Claude Code plugin manager API unavailable:** falls back to plugin add re-run; if that also fails, marker remains and user is directed to `/loom-update --channel curl` as the escape path.
- **Requires restart after update:** output emits "Claude Code restart required to load new plugin version" as the last line; no silent state where the user thinks the update succeeded but the new version isn't loaded.

**Terminal output for `--check` (UX-NEW-04):** without `--json`, output is one line: `Loom vX.Y.Z installed → vA.B.C available — run /loom-update to apply`. If up to date: `Loom vX.Y.Z — up to date`.

**Terminal output for `--resume`:** progress line per recovery step (`Resuming update vX.Y.Z → vA.B.C — step N/M: <step name>`); on success: `Update complete: vX.Y.Z → vA.B.C. Restart Claude Code to load the new version.`; on unrecoverable marker (e.g., toVersion no longer in registry): `Update marker references vA.B.C which is no longer available. Run /loom-update --check to see current options, or /loom-doctor --bundle to file an issue.` — and exits non-zero without clearing the marker.

**Convergence targets:**
- `/loom-update` succeeds on both curl and plugin installs, preserving all repo-root artifacts
- `/loom-update --check --json` returns structured TOON with `currentVersion`, `latestVersion`, `behind`
- `/loom-update --resume` completes from a deliberately-killed mid-update marker
- All three error states produce the documented output

### F-13: `/loom-uninstall` command

**Priority:** P1 within M-01 (post-submission fast-follow per C-13) · **Milestone:** M-01

Inverse of install. Removes `~/.claude/plugins/loom/`, settings.json hook entries, and `~/.loom/`. **Project-root state preserved by default** (`.loom/wiki/`, `.plan-execution/`, `orchestration.toml`).

**Confirmation prompts (UX-NEW-02):**
- **Base uninstall:** prompt `Remove Loom from this machine? Project-root state (.loom/wiki/, orchestration.toml, .plan-execution/) is preserved. [y/N]`. Accepted input: `y` or `Y`. Default `N` on empty input or any other key. Timeout: 60 seconds → defaults to `N` and exits with code 1.
- **`--purge-project-state`:** stronger prompt requiring typed confirmation — `This will PERMANENTLY DELETE .loom/wiki/, .plan-execution/, and orchestration.toml in the current repo. Type 'uninstall' to confirm:`. Only the literal string `uninstall` proceeds.
- **`--yes`:** bypass all confirmations (for CI / scripted uninstall).

**`--dry-run`:** report what would be removed without mutation, in the same diff format as F-05.

**Convergence targets:**
- After `/loom-uninstall` (with `y` confirmation): `claude plugin list` does not include loom; `~/.loom/` is gone; project repo is unchanged unless `--purge-project-state` is used
- `--purge-project-state` without typed `uninstall` confirmation does not mutate
- `--dry-run` produces complete preview
- 60s timeout on base prompt exits with code 1 and no mutation

### F-07a: Minimal `${LOOM_PLUGIN_ROOT}` resolver (M-01 subset)

**Priority:** P0 (submission-blocking per C-13) · **Milestone:** M-01

Single-function resolver in `hooks/lib/plugin-root-resolver.ts`. Reads `.loom/plugin-root`, returns the absolute path with fallback to repo-relative paths for hand-authored kits. Used by F-02, F-04, F-05, F-12, F-13 in M-01. F-07 in M-02 extends this resolver to hooks and `library.yaml` rewriting.

**Convergence targets (FC-11 reconciled — strict subset of F-07):**
- All M-01 features that resolve plugin-root paths use `plugin-root-resolver.ts`
- No inline references to `${LOOM_PLUGIN_ROOT}` or hard-coded `~/.claude/plugins/loom` paths in agent prompts, skill bodies, or M-01 protocol files outside the resolver module

### F-07: `${LOOM_PLUGIN_ROOT}` resolver — full coverage (extends F-07a)

**Priority:** P1 · **Milestone:** M-02

Extends F-07a to cover `library.yaml` resolution and hook bodies. `library.yaml` learns the variable; falls back to repo paths for hand-authored kits.

**Convergence targets:**
- Grep for `LOOM_PLUGIN_ROOT` in agent prompts, skill bodies, protocol files returns 0 matches
- All path resolution goes through `plugin-root-resolver.ts`

### F-08: Plugin-declared hooks (migrate from `settings.json` edits)

**Priority:** P1 · **Milestone:** M-02

Migrate all Loom hooks from `~/.claude/settings.json` hand-edits to plugin-manifest declarations. Hooks version-lock with the plugin and use F-07's full resolver to find repo-root state.

**Convergence targets:**
- After plugin install, `~/.claude/settings.json` has no Loom-related hook entries
- All Loom hooks fire correctly on PreToolUse/PostToolUse/UserPromptSubmit events
- Hooks work across worktrees (each resolves its own `.loom/plugin-root`)

### F-09b: Listing copy iteration + per-version changelog surfacing

**Priority:** P1 · **Milestone:** M-02

Iterate on F-09a copy based on first 30 days of marketplace data. Surface per-version changelog inside the listing (sourced from F-03's auto-generated `CHANGELOG.md`).

### F-10b: CI fixture — sample convergence loop + extended scenarios

**Priority:** P1 · **Milestone:** M-02

Extends F-10a fixture to run a sample convergence loop end-to-end inside the container, covering the full pipeline. Adds scenarios for: stale schema, mixed-channel detection, partial-migration recovery.

### F-14: Support triage wiring

**Priority:** P1 · **Milestone:** M-02

Creates GitHub `channel:curl`, `channel:plugin`, `source:*` labels. Issue template prompts for `install.toon` contents and `/loom-doctor --bundle` attachment. Documents the triage flow in `docs/contributing.md`.

### F-15: Hook subprocess PATH robustness + fail-loud audit

**Priority:** P0 (submission-blocking per C-13) · **Milestone:** M-01

Address the hook-wrapper PATH-inheritance class of bug (see C-16) before the marketplace listing ships. Three deliverables:

**(a) Wrapper PATH prepend (5-line fix to `hooks/run-hook.sh`):**
```sh
# After arg-count check, before LOOM_HOOK_RUNTIME handling:
for candidate in /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in
    *":$candidate:"*) ;;
    *) PATH="$candidate:$PATH" ;;
  esac
done
export PATH
```
Safe no-op when paths already present. Inherits to `~/.claude/run-hook.sh` via `install.sh` for curl-installed users and via the plugin tarball for marketplace-installed users.

**(b) `/loom-init` settings.json template audit:**
Audit whatever `/loom-init` scaffolds into a project's `.claude/settings.json`. If it wires PreToolUse hooks against `hooks/*.ts` routed through the wrapper, document the dependency on C-16's PATH fix. Optionally: emit a warning at `/loom-init` time if `bun` is not in the user's interactive shell, or write `LOOM_HOOK_RUNTIME` to an absolute bun path in the project's `settings.json` to bypass PATH probing entirely.

**(c) Fail-loud escalation:**
Today the wrapper's "Neither bun nor node found in PATH" path writes one stderr line and exits 0 — contract enforcement is silently bypassed. Escalate to a more visible warning: write to `~/.cache/loom/hook-failures.log` with a timestamp + which hook failed + the PATH at probe time. Surface via `/loom-doctor` as a `red` check (`channel: hooks`) when the log has entries in the last 24h.

**README/install.sh prerequisites tightening:**
- Pin Node range to 18–24 OR add a prominent "Node 25+ requires bun — npx tsx fallback is unreliable" note in the Prerequisites section.
- `install.sh` lines 263-288 validate that some runtime exists in the installer's PATH; add a post-install verification step that runs a probe hook under `env -i HOME=$HOME PATH=/usr/bin:/bin` and warns the user if it fails — that's the actual GUI-launch failure mode.

**Convergence targets:**
- All six PreToolUse hooks (`deploy-guard`, `context-budget`, `budget-tracker`, `contract-lock`, `file-ownership`, `wiki-write-guard`) exit 0 with no stderr under `env -i HOME=$HOME PATH=/usr/bin:/bin sh hooks/run-hook.sh hooks/<hook>.ts`
- F-10a Docker harness includes this verification matrix
- Fail-loud log writes to `~/.cache/loom/hook-failures.log` when no runtime resolves; `/loom-doctor` surfaces the log
- README/install.sh prerequisites updated; post-install minimal-PATH probe runs and reports

## Milestones

### M-01: Phase 1 — Marketplace Day-One Launch

**Internal critical path (per C-13):**
- **Submission-blocking (P0):** F-01, F-02, F-03, F-06, F-07a, F-09a, F-10a, **F-15** — these gate the marketplace submission PR
- **Post-submission fast-follow (P1 within M-01):** F-04, F-05, F-11, F-12, F-13 — ship in the first post-listing release; required for M-01 completion

**Submission acceptance** (when the marketplace listing goes live):
- Loom is listed on the official Anthropic marketplace
- First-invocation graceful-no-op (C-11) works on a clean machine, verified by F-10a
- Atomic release pipeline produces a single sigstore-signed artifact served via both channels
- Listing copy is outcome-led, includes C-14 differentiation claim, reviewed against checklist before submission
- Single resolver layer (F-07a) lints clean

**Milestone-completion acceptance:**
- `/loom-doctor` (F-04, scope-reduced), `/loom-update` (F-12), `/loom-uninstall` (F-13) ship with `--json`, `--dry-run`, `--resume`, and confirmation prompts as specified
- Existing curl users have an opt-in migration path (F-05) with dry-run + partial-failure recovery
- F-11 telemetry collection supports C-03 sunset evaluation (and C-09 kill-criterion fallback)

**Target:** TBD (gated on submission-blocking set verified by F-10a; F-06 sigstore attestation; F-09a listing-copy review)

### M-02: Phase 2 — Plugin-Native Architecture + Sunset Evaluation

**Features:** F-04b, F-07, F-08, F-09b, F-10b, F-14
**Acceptance:**
- Plugin-declared hooks replace all `settings.json` hand-edits
- Single resolver layer covers `library.yaml` and hook bodies
- CI fixture covers sample convergence loop end-to-end
- Sunset criterion (C-03) is evaluated quarterly using F-11 signals
- Kill criterion (C-09) is evaluated at 90-day mark; if triggered, marketplace listing is delisted and curl returns to README primacy
- Support triage labels and issue template wired

**Target:** TBD (gated on M-01 completion and sunset/kill-criterion telemetry from F-11)

## Risks

| Risk | Severity | Mitigation | Source |
|------|----------|------------|--------|
| `${LOOM_PLUGIN_ROOT}` becomes migration debt if Anthropic changes plugin path semantics | High | Single resolver layer (C-04, F-07a, F-07); never inline in agent prompts | Skeptic, exploration round 2 |
| Silent manifest drift after a hotfix bypasses the atomic pipeline | High | CI hash-compare check on every tagged release (F-06) | Skeptic, exploration round 2 |
| Supply-chain attack via compromised GitHub token | High | Sigstore/cosign attestation before marketplace listing (C-08, F-06) | Ops, exploration round 2 |
| Marketplace submission rejected or earns durable bad early reviews due to `/loom-init` cliff | High | UX-cliff fix as hard precondition (C-02, F-02); F-10a verifies | Debate 2 |
| **Marketplace fails to become primary discovery surface** | High | Named kill criterion C-09 with concrete thresholds; if triggered, delist + return curl to README primacy | Strategy review |
| Marketplace install telemetry unavailable from Anthropic | High | F-11 fallback to opt-in install-channel pings + GitHub Release download counts | Scope + Strategy review |
| Dual-channel maintenance becomes permanent | Medium | Signal-gated sunset criterion C-03; quarterly evaluation; kill criterion C-09 as backstop | PM, debates |
| Brand dilution in marketplace adjacency | Medium | F-09a outcome-led listing copy in M-01 (not M-02); competitive differentiation statement | PM, review |
| Anthropic ships first-party planning primitive | Medium | C-10 named scenario with 30-day evaluation window; default to repositioning as workflow shell | Strategy review |
| Support volume exceeds maintainer capacity post-launch | Medium | Expectation-capping in F-09a copy; 2-week threshold triggers tightening | Critic, debate 2 |
| Worktree behavior under plugin install untested | Medium | F-10a includes worktree scenario in M-01 (not M-02 as v1 had) | Engineer + UX review |
| Marketplace review/approval latency unknown | Medium | M-01 target date deliberately TBD; assume 4-8 weeks for first listing | Strategy review |
| F-02 graceful no-op prompt becomes noise after repeated invocations | Low | 24-hour suppression per project via `.loom/dismissed-init-prompt` (C-11) | UX review |
| **Hook subprocess PATH-inheritance bug silently disables all PreToolUse contract enforcers** under GUI-launched Claude Code | High | C-16 wrapper PATH prepend; F-15 fail-loud audit; F-10a Docker harness verifies under stripped PATH; submission-blocking | User report 2026-06-15 |
| `npx tsx` ESM fallback fragile on Node 25+ | Medium | F-15 pins README prerequisites to Node 18–24 OR strongly prefers bun; LOOM_HOOK_RUNTIME absolute-path option in /loom-init settings template | User report 2026-06-15 |
| Fail-open hook wrapper silently bypasses contract enforcement | Medium | F-15 fail-loud log (`~/.cache/loom/hook-failures.log`) + `/loom-doctor` red check | User report 2026-06-15 |

## Open Questions

OQ-1 (F-02 implementation) — **RESOLVED** as C-11 (graceful no-op).
OQ-3 (kill criterion) — **RESOLVED** as C-09.
OQ-4 (F-10a infrastructure) — **RESOLVED** as C-15 (Docker harness from day one).
Beta channel — **RESOLVED** as `source: beta-channel` enum value, documented in advanced-install path only.

Remaining:
1. **Marketplace telemetry availability:** Confirmed with Anthropic before M-01 start? If unavailable, F-11 fallback (opt-in pings) becomes the primary signal — C-09 fallback rule (GitHub Release download ratio) is the backstop. **This is a research item, not a design decision** — answer determines fallback weighting, not the overall plan.
2. **Sunset trigger numerics:** the 5× ratio in C-03 is a working assumption from PM round 2. Validate against historical curl install rates at first sunset evaluation; revisit if ratio is unreachable in normal adoption curves.

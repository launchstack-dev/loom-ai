---
roadmapVersion: 1
name: "BYO Kits — Pinned, Atomic, Drift-Free Private Kit Distribution"
status: approved
created: 2026-06-25
lastReviewed: 2026-06-25
lastIntegrated: 2026-06-25
approvedAt: 2026-06-25
convergeRound: 3
convergeStatus: converged
q03ResolvedAt: 2026-06-25
targetDate: null
totalFeatures: 9
totalMilestones: 2
sources:
  - 2026-06-25 user conversation — drift across machines via /loom-library, request for private/team kit story
  - planning/ROADMAP-plugin-distribution.md — establishes plugin as primary, atomic distribution channel
  - planning/ROADMAP-kit-native-skills.md — establishes typed kit includes (v4 catalog)
  - planning/history/reviews/2026-06-25-roadmap-byo-kits-review.toon — review findings integrated below
priorVersion: null
---

# Roadmap: BYO Kits — Pinned, Atomic, Drift-Free Private Kit Distribution

## Vision

Loom's core distribution is solved: the plugin ships atomically, every machine at the same pinned version. But the secondary surface — `/loom-library` — still re-pulls files from `main` on every sync, with no checksum verification and no kit-level transactionality. Teams that want to ship their own internal kits (proprietary agents, private domain skills, company-specific commands) currently have to either fork Loom or accept the same drift that made `/loom-library` klugy in the first place. This roadmap adds three small primitives — external kit manifests, pinned sources, and atomic checksum-verified installs — that let any team ship a private GitHub repo as a versioned Loom kit. Same `/loom-library` UX (no new verbs), same convergence guarantee the plugin gives core Loom, no new install channel.

### Primary Persona

**Small-team tech lead at a company using Loom for internal work** — has 3-15 engineers using Loom, wants to share a curated set of agents/commands/skills across the team (e.g., "Acme-Corp-style code reviewer", "deploy-via-our-CI command", "our domain-specific data conventions skill"). Comfortable with `gh auth`, GitHub private repos, and semver tags. Will NOT publish their kit publicly. Cares more about *every engineer's machine being identical at a known version* than about discoverability.

### Positioning

BYO Kits is an *extension* of the existing `/loom-library` surface, not a replacement. The plugin remains the primary channel for core Loom. Public kits ship as PRs to `skills/library.yaml`. Private kits live in the team's own repo and install via `/loom-library add github:acme/internal-kit@v1.2.0` with the same atomicity guarantees the plugin provides core Loom. The verb surface stays unified — the existing `add | remove | update | sync` commands learn to detect `github:` scheme prefixes and dispatch to the kit-manifest install path. **No hyphenated `add-kit` / `remove-kit` / `update-kit` verbs are introduced.**

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Pin specificity | 100% of BYO kit installs record a resolved commit SHA (not just a tag) | install-state.toon `components[]` row with `kind: kit` has non-empty `pinSha` |
| Install atomicity | 0 partial installs on checksum failure | integration test: corrupt one file in a manifest, verify entire install aborts and no files are written |
| Cross-machine convergence | A containerized fixture (mirror of ROADMAP-plugin-distribution F-10a) installing the same `kit@v1.2.0` on two fresh containers produces byte-identical kit files | Docker harness test in M-02 acceptance |
| Drift detection | `loom doctor --kits` flags any kit whose installed sha256 ≠ manifest sha256 | unit test: tamper with installed file, run doctor, expect a `KIT_DRIFT` finding |
| Upstream staleness | `loom doctor --kits --check-upstream` flags any kit whose pinned ref has been superseded | integration test: install at `v1.0.0`, tag `v1.1.0`, run with `--check-upstream`, expect `KIT_STALE` finding |
| Backward compatibility | All existing `kits:` entries in `library.yaml` install unchanged | regression suite: `/loom-library use data-engineering` succeeds with no migration step |
| Private-repo auth flow | Private GitHub kit installs without exposing tokens to Loom code | fixture test using a private repo + `gh auth status` check |
| Demand validation | ≥ 2 of 3 polled Loom-using teams confirm they hit kit drift AND would use this over a private plugin | gate before M-01 start (see C-09) |

## Constraints & Decisions

### C-01: Kits Live in External Repos, Not in `library.yaml`
**Decision:** BYO kits are defined by a `kit.toon` manifest at the root of an external repo. They are NOT registered in the central `skills/library.yaml`. The catalog file remains the registry only for public, curated kits.
**Rationale:** Forcing private kits through a central registry would require either (a) running a private catalog server or (b) writing private kit metadata into the public Loom repo. Both are non-starters. Letting each repo declare its own manifest keeps trust and ownership local.
**Alternatives considered:** Central registry with auth (rejected — operational burden, leaks kit existence); fork Loom and edit `library.yaml` (rejected — defeats convergence to upstream)
**Impact:** high

### C-02: Pins Are Always Resolved to Commit SHA
**Decision:** Users may specify `github:owner/repo@v1.2.0` (tag) or `github:owner/repo@main` (branch), but the installer resolves to a 40-char commit SHA at install time and records the SHA — never the symbolic ref alone — in `install-state.toon`. Mutable-ref installs (`@main`) print an explicit warning before proceeding.
**Rationale:** Tags are mutable. Branches are mutable. A team that installs `kit@v1.2.0` on Monday and again on Friday must get the same bytes both times. Recording the SHA makes drift detection deterministic. The mutable-ref warning closes a common foot-gun.
**Alternatives considered:** Trust tags (rejected — tag re-pointing is a known supply-chain footgun); require explicit SHA (rejected — bad UX for the common case)
**Impact:** high

### C-03: Atomic All-or-Nothing Install
**Decision:** The installer fetches every file in the manifest into a staging directory (`~/.cache/loom/kits/<name>-<sha>/`), verifies every sha256, and only then renames into place. Any failure (missing file, bad checksum, network error) aborts the install with zero files written. The staging cache is preserved on network failure to allow cheap retry; deleted on validation failure.
**Rationale:** Partial installs are the root cause of `/loom-library`'s historical drift problem. A team that installs a kit must either fully succeed or be in the same state as before — never a half-applied middle state. Preserving cache on transient network errors avoids re-downloading verified files on retry.
**Alternatives considered:** Per-file commit (rejected — re-introduces drift); skip checksum on retry (rejected — defeats the integrity guarantee)
**Impact:** high

### C-04: Auth Goes Through `gh` CLI, Never Through Loom
**Decision:** Private kit fetches use `gh api repos/{owner}/{repo}/contents/...` exclusively. Loom never reads, stores, or forwards tokens. The installer distinguishes and reports three distinct auth failure states: (a) `gh` not installed → prints install URL; (b) `gh` installed but not authenticated → prints `gh auth login`; (c) `gh` authenticated but the API returns 404 on the repo → prints a repo-access / privacy explanation.
**Rationale:** Credential storage is a security responsibility we should not assume. `gh` already solves it correctly. The three-way error split prevents the common "I see GH_AUTH_REQUIRED but I AM logged in" confusion.
**Alternatives considered:** Accept `GITHUB_TOKEN` env var (rejected — invites token-in-shell-history mistakes); custom OAuth flow (rejected — months of work to re-solve what gh ships today)
**Impact:** medium

### C-05: Backward Compatible With Existing Kit Definitions
**Decision:** Existing kit definitions in `skills/library.yaml` (data-engineering, python-conventions, shell-conventions) continue to install unchanged via the current code path. The new BYO mechanism is an additional source-scheme that the existing `add | remove | update` commands learn to detect. No hyphenated verbs are introduced.
**Rationale:** Three production kits are already in the catalog and on user machines. Forcing a migration is operationally hostile when the new mechanism is purely additive. Reusing the existing verbs keeps the surface coherent.
**Alternatives considered:** Migrate all kits to the new manifest format (rejected — gratuitous churn); introduce `add-kit / remove-kit / update-kit` verbs (rejected — bifurcates the surface, user-visible churn for no gain)
**Impact:** medium

### C-06: `loom doctor --kits` Is the Drift Surface (Flag, Not Subcommand)
**Decision:** A new `--kits` flag on the existing `loom doctor` command inspects every installed kit, recomputes sha256 on disk, compares to the recorded values, and reports any divergence. A companion `--check-upstream` flag additionally queries the pinned ref's current SHA and reports staleness. Each `KIT_DRIFT` or `KIT_STALE` finding includes an explicit recovery line: "Run `/loom-library update <kit-name>` to re-install from the pinned SHA, or `/loom-library add github:owner/repo@<new-ref>` to move to a different version."
**Rationale:** Without a drift detector, users have no way to know that their machine has fallen out of sync. The recovery copy in the report is what makes the surface actionable. `loom doctor --kits` as a flag (not subcommand) lets `loom doctor` eventually check all dimensions by default.
**Alternatives considered:** Auto-repair on detection (deferred — out of scope for v1, surface drift first, automate later); subcommand form `loom doctor kits` (rejected — incompatible with all-checks-default evolution)
**Impact:** medium

### C-07: Target Path Resolution by Resource Type (resolves Q-02)
**Decision:** BYO kit items follow the same target convention as their resource type in the existing `default_dirs:` block of `library.yaml`. Default scope per type:
- `type: skill` → `~/.claude/skills/<name>/SKILL.md` (default scope: `global`)
- `type: agent` → `.claude/agents/<name>.md` (default scope: `project`)
- `type: prompt` → `.claude/commands/<name>.md` (default scope: `project`)
- `type: protocol` → `~/.claude/protocols/<name>.md` (default scope: `global`)
- `type: infrastructure` → **forbidden in v1** (see C-10)

The `scope` field in `kit.toon` `items[]` is an enum: `project | global`. Omitting it applies the type's default scope above. Specifying a value that matches the default is a no-op. Specifying a value that **differs from the default** (e.g., `scope: global` on an `agent`, or `scope: project` on a `skill`) is treated as an explicit override and triggers a per-item confirmation prompt at install time:

```
Item '{name}' (type: {type}) declares scope: {scope}, overriding the default ({defaultScope}).
Install to {computedTargetPath}? [y/N]
```

The outer `add` command's `--force` flag suppresses these prompts (auto-accepts all overrides). The `targetPath` field is NOT a manifest field — install location is always computed from `type` + effective `scope` per this rule.

**Rationale:** Q-02 was load-bearing for install semantics — silent global-scope writes from a project-local install command would be destructive. Mirroring the existing `default_dirs:` convention keeps BYO kits coherent with the public catalog's behavior.
**Impact:** high

### C-08: Differentiation vs Private Claude Code Plugin (resolves cross-cutting theme)
**Decision:** BYO Kits targets **sub-plugin granularity**: 1-5 individual resource files installed into a live Loom project without authoring a `.claude-plugin/plugin.json`, without a tagged GitHub Release, and without going through Anthropic's plugin review cycle. The decision rule documented in the README and `/loom-library` help:
- **1-5 items, no hooks, internal team only → BYO kit**
- **Full agent/command suite, includes hooks/scripts, or shareable beyond one team → publish as a private Claude Code plugin** (`claude plugin add github:owner/repo`)

**Rationale:** Native private plugins already exist and provide atomic installs + manifest hooks. BYO Kits is not trying to compete on the full-distribution axis — it occupies a finer-grained niche that plugins are operationally heavyweight for. Making the choice point explicit prevents accidental BYO use when a plugin is the right answer.
**Impact:** high

### C-09: Demand Validation Deferred to Post-OSS-Launch
**Decision:** M-01 implementation start is gated on the main `ROADMAP.md` M-06 OSS launch reaching its 5-stranger cold-install milestone. Once OSS launch is complete, demand validation runs as written: ≥ 2 of 3 polled Loom-using teams must confirm both (a) they have hit cross-machine kit drift with `/loom-library` in the last 90 days, AND (b) they would use the BYO kit path over publishing as a private Claude Code plugin. Result recorded at `planning/history/byo-kits-demand-validation.toon`.
**Rationale:** The original C-09 (three-team poll before M-01) is unsatisfiable at Loom's current stage — the user base needed to populate three independent polled teams does not yet exist (M-06 OSS launch is still in flight). Deferring the gate to post-OSS-launch preserves the original intent (don't build for one signal) without inventing fictitious teams, and naturally sequences BYO Kits behind the work that creates the user base required to validate it.
**Alternatives considered:** Lower the bar to "user + one other" (rejected — too close to one-signal validation, the exact pattern the gate exists to prevent); drop the gate entirely (rejected — the strategy review's "platform-building on one signal" critique remains valid); keep the original three-team poll as written (rejected — sets an unreachable gate that effectively kills the roadmap by stalemate).
**Impact:** high

### C-10: `type: infrastructure` Forbidden in v1 Kits
**Decision:** `kit.toon` `items[]` entries with `type: infrastructure` (hooks, executables, scripts that require `settings.json` registration) are rejected by the manifest validator in v1. Kits that need to ship infrastructure items must use the Claude Code plugin path instead (per C-08).
**Rationale:** Plugins have a declarative hooks-manifest mechanism that the kit-install path lacks. Silently allowing infrastructure items would either (a) install files that never get wired into `settings.json`, or (b) require BYO kits to mutate `settings.json` — exactly the cross-channel conflict mode that `install.sh:22` already guards against. Explicit rejection in v1 keeps the trust model clean.
**Alternatives considered:** Allow infrastructure with manual wiring (rejected — silent half-install); duplicate plugin hooks manifest into kit.toon (rejected — feature creep into plugin territory)
**Impact:** high

### C-11: Kit State in Dedicated File, NOT in `install-state.toon` (Q-03 resolved)
**Decision:** BYO kit state lives in a NEW file at `~/.claude/skills/library/kits.toon`, structurally distinct from the existing `~/.claude/skills/library/install-state.toon` (which is owned by the curl installer and the core component inventory). Per-kit auxiliary metadata stays at `~/.claude/skills/library/kits/<kit-name>.toon`. The `components[]` table in `install-state.toon` is NOT extended.

**Q-03 resolution (verified by code-read on 2026-06-25):**
- Plugin update path (`scripts/lib/update/apply.ts`, `scripts/loom-update.ts`, Claude Code native plugin upgrade) writes only to `~/.loom/install.toon` — never to `~/.claude/skills/library/install-state.toon`. Plugin-installed users would have been safe from clobber.
- Curl path (`install.sh:350`) performs a full overwrite of `~/.claude/skills/library/install-state.toon` on every re-run (`mv "${STATE_TMP}" "${STATE_FILE}"`, no merge). Any user-added rows would be silently destroyed on curl-upgrade.
- Isolating kit state into its own file makes both channels safe by construction — no merge logic required in either installer, no schema coupling between core inventory and kit inventory.

**Schema:**
```toon
schemaVersion: 1
lastSynced: 2026-06-25T10:00:00Z

kits[N]{name,version,source,pinRef,pinSha,manifestSha,installedAt}:
  acme-internal-kit,1.2.0,github:acme-corp/internal-kit,v1.2.0,a7f3c9d8e2...,b8e4d0c1f3...,2026-06-25T10:00:00Z

items[N]{kit,type,name,sourcePath,targetPath,sha256,installedAt}:
  acme-internal-kit,agent,acme-code-reviewer,agents/acme-code-reviewer.md,.claude/agents/acme-code-reviewer.md,abc123...,2026-06-25T10:00:00Z
```

The `kit` foreign-key column in `items[]` ties each installed file back to its parent kit, enabling cascade-on-remove without needing to read the parent's auxiliary file.

**Authoritative-read rule:** `kits.toon` is the source of truth. The per-kit auxiliary file at `~/.claude/skills/library/kits/<kit-name>.toon` is a denormalized read-cache for F-04 drift detection. When the two disagree, `kits.toon` wins and the auxiliary file is rewritten. Detected at-read mismatches surface as `KIT_STATE_INCONSISTENT` advisory findings in `loom doctor --kits`.

**Defensive install.sh patch (out of scope for this roadmap, noted for ROADMAP-plugin-distribution follow-up):** Add a comment block in `install.sh` documenting that `~/.claude/skills/library/kits.toon` is kit-owned and `install.sh` must never write or remove it. The current `install.sh` already only touches `install-state.toon`, so no behavioral change is needed today — only a documentation guard against future drift.

**Impact:** high

## Conceptual Data Model

### `kit.toon` (external manifest, lives at root of BYO kit repo)

```toon
kitVersion: 1
name: acme-internal-kit
version: 1.2.0
description: Acme Corp internal Loom kit — code review + deploy + domain skills
license: proprietary
homepage: https://github.com/acme-corp/internal-kit
minLoomVersion: 4
maxLoomVersion: 6
authorOrg: acme-corp
items[N]{type,name,sourcePath,sha256,scope}:
  agent,acme-code-reviewer,agents/acme-code-reviewer.md,abc123...,project
  prompt,loom-acme-deploy,commands/loom-acme-deploy.md,def456...,project
  skill,acme-domain,skills/acme-domain/SKILL.md,789ghi...,global
```

**Field notes:**
- `version` is the semver of the kit itself (separate from `kitVersion` which is the manifest format version)
- `maxLoomVersion` is optional; absence means unbounded
- `scope` is optional (defaults per C-07); explicit `global` on a project-typed item triggers a confirm prompt
- `targetPath` is NOT a manifest field — install location is computed from `type` + `scope` per C-07

### `~/.claude/skills/library/kits.toon` (per C-11 — dedicated kit-state file, NOT install-state.toon)

See the full schema in C-11. Summary: `kits[]` table for per-kit metadata (pinRef, pinSha, manifestSha), `items[]` table with a `kit` foreign-key column for cascade operations.

### `~/.claude/skills/library/kits/<kit-name>.toon` (per-kit auxiliary)

```toon
kitName: acme-internal-kit
manifestSha: b8e4d0c1f3...
fetchedFrom: github:acme-corp/internal-kit@v1.2.0
resolvedSha: a7f3c9d8e2...
itemCount: 3
```

## Features

### F-01: `kit.toon` Manifest Format + Validator
**What:** Define the TOON schema for external kit manifests (see Conceptual Data Model). Ship a validator (`hooks/lib/kit-manifest-validator.ts`) that fails closed on malformed manifests with field-specific error messages (`items[2].sha256 must be 64 hex characters, got 32` not generic parse errors).
**Acceptance:**
- Validator rejects manifests with missing `kitVersion`, invalid sha256 lengths, items violating `validateSkillSlug`, or `type: infrastructure` (per C-10).
- Validator rejects items where `type` and computed target path violate `validateInstallPath` from `hooks/lib/skill-router.ts`.
- Validator rejects items whose `scope` is not in `{project, global}`.
- Error messages name the offending field path and the expected format.
- Unit tests cover every rejection path.

**Dependency note:** ~~Target paths in this validator are final only after Q-03 is resolved.~~ Resolved 2026-06-25 — kit state lives in dedicated `~/.claude/skills/library/kits.toon` per updated C-11; F-01 test fixtures and validator path constants can be authored against the schema in C-11 as-is.

### F-02: `/loom-library add github:owner/repo@ref` Source-Scheme Detection
**What:** Extend the existing `/loom-library add` command (no new verb) to detect a `github:owner/repo@ref` source-scheme prefix. When detected, fetch `kit.toon` via `gh api`, resolve `ref` → 40-char SHA, validate the manifest, and dispatch to F-03's staging path. The `--dry-run` flag stages and prints the planned writes without applying. Refs that are branches (mutable) trigger a y/N confirmation prompt before resolution.
**Acceptance:**
- `/loom-library add github:fixture-org/sample-kit@v0.1.0` installs against a public test-fixture repo.
- `gh` auth failures distinguish all three states from C-04 with specific error messages.
- Non-existent refs return `KIT_REF_NOT_FOUND` with the attempted resolution URL.
- A source with the `github:` scheme but no `@ref` (e.g., `github:acme/internal-kit`) returns `KIT_REF_REQUIRED` with corrective message: "Specify a ref: `github:acme/internal-kit@v1.0.0` (tag) or `github:acme/internal-kit@main` (branch, mutable)." No implicit default to `@main` — defaulting to a mutable ref silently is a footgun.
- `--dry-run` exits with the staged file list and zero filesystem writes outside `~/.cache/loom/`.
- Branch refs (`@main`) print "warning: 'main' is a mutable ref. The installed SHA may not be reproducible." before resolution.
- Success output prints: kit name, resolved tag → SHA, file count, install targets per item.

### F-03: Atomic Staging + Checksum-Verified Install
**What:** Stage all manifest items to `~/.cache/loom/kits/<name>-<sha>/`. Verify every sha256 against the manifest. On full success, rename each file to its computed target (per C-07). On any failure, delete the staging dir (validation failure) or preserve it (network failure) per C-03. Print a progress line per phase: "Fetching manifest...", "Resolving v1.2.0 → a7f3c9d8...", "Staging N files...", "Verifying checksums...", "Installing...".
**Acceptance:**
- Integration test: a kit manifest with one tampered sha256 produces zero install-target writes and a `KIT_CHECKSUM_FAIL` error naming the offending file and both expected/actual hashes.
- Integration test: a kit-name collision with an installed kit returns `KIT_NAME_CONFLICT` naming the existing source. Resolution requires `--replace` (re-install) or a different kit (manual rename).
- Network-failure path leaves the staging cache intact for retry.

### F-04: Drift Detection + Upstream Staleness — `loom doctor --kits [--check-upstream]`
**What:** Walk every `components[].kind == kit` row. Recompute sha256 of each file installed via `items[].source == byo-kit:<name>`, compare to the manifest. With `--check-upstream`, additionally query the pinned ref's current SHA via `gh api` and compare to the recorded `pinSha`. Each finding includes a recovery line.
**Acceptance:**
- Tampering with one installed file then running `loom doctor --kits` produces a `KIT_DRIFT` finding naming the file, expected/actual sha256, and recovery command.
- Running with `--check-upstream` after a new tag is pushed produces a `KIT_STALE` finding naming current pin and latest available, with recovery command.
- Empty state (zero kits installed) prints: "No BYO kits installed. Add one with `/loom-library add github:owner/repo@ref`."

### F-05: `/loom-library remove <kit-name>` + `/loom-library update <kit-name>`
**What:** Reuse existing `remove` and `update` verbs (no new hyphenated forms). Detection: if `<name>` matches a `components[].kind == kit` row, dispatch to kit-specific logic. `remove` prompts: "Remove kit '{name}' and its N files? [y/N]" (skippable with `--force`). `update` re-resolves the ref; if the resolved SHA differs from the recorded `pinSha`, prompt with a per-file change summary. `--check-only` reports drift without applying.
**Acceptance:**
- `/loom-library remove acme-internal-kit` removes all `items[]` rows with `source: byo-kit:acme-internal-kit`, deletes the per-kit auxiliary file, leaves no orphans.
- `/loom-library remove` without `--force` requires explicit y/N confirmation.
- `/loom-library update acme-internal-kit` is a no-op when the resolved SHA matches the recorded `pinSha` (with a "kit is up-to-date at <sha>" message).
- On a successful applied update, prints: `Kit '{name}' updated: <old-sha> → <new-sha>, N files replaced.` followed by a list of changed `items[].sourcePath` entries.
- `/loom-library update --check-only acme-internal-kit` exits 0 if up-to-date, exits 1 with the new SHA if drifted.

### F-06: Backward-Compat Path for Existing `library.yaml` Kits
**What:** Existing public kit definitions in `skills/library.yaml` (`data-engineering`, `python-conventions`, `shell-conventions`) continue to install via `/loom-library use <kit-name>` exactly as today. The new manifest path activates only when the source prefix is `github:` or a local path (per F-07).
**Acceptance:** Regression suite confirms all three public kits install unchanged with no migration step.

### F-07: Local Path Source — `/loom-library add /abs/path/to/kit-repo` (promoted from Q-01)
**What:** Accept absolute or `~`-prefixed local paths as valid sources for `add`. Skip the `gh api` fetch and read `kit.toon` and item files from the local filesystem. Still run checksum verification against the manifest's recorded sha256 (the author signs their own work). This is the kit-authoring pre-publish test path.
**Acceptance:**
- `/loom-library add /Users/.../my-kit-repo` installs from a local clone.
- Sha256 mismatches between manifest and local files produce `KIT_CHECKSUM_FAIL` (author has not regenerated sha after editing).
- A missing `kit.toon` at the supplied path returns `KIT_MANIFEST_NOT_FOUND` with message: "No kit.toon found at '{path}'. Run `/loom-library init-kit {path}` to create one."
- `components[].source` records `local:<abs-path>` (distinguishable from `github:owner/repo`).

### F-08: `/loom-library init-kit <directory>` — Authoring Scaffold (closes discoverability gap)
**What:** A scaffold command that generates a starter BYO kit repo at `<directory>`: a populated `kit.toon` skeleton with one example item per supported type, a worked example `agents/<name>.md`, a `README.md` with publish-via-tag instructions, and a `.gitignore`. Print final-step guidance: "Edit kit.toon, regenerate checksums with `/loom-library checksum <directory>`, commit and tag."
**Acceptance:**
- `/loom-library init-kit ./my-first-kit` produces a directory that, after the printed steps, installs cleanly via F-07 (local path) and F-02 (after publish + tag).
- The generated `kit.toon` includes inline comments explaining every field.
- Refuses to overwrite an existing non-empty directory; returns `KIT_DIRECTORY_NOT_EMPTY` unless `--force` is passed.

### F-09: `/loom-library checksum <directory>` — Manifest Checksum Helper (companion to F-07/F-08)
**What:** Walk every `items[].sourcePath` in `<directory>/kit.toon`, recompute sha256 of each file, and rewrite the manifest in place with updated values. The kit-author runs this after every edit to keep the manifest accurate before commit + tag. Idempotent: a second run on an unchanged tree is a no-op.
**Acceptance:**
- `/loom-library checksum ./my-kit` prints one line per item: `unchanged: agents/foo.md` or `updated: agents/foo.md <old-sha256> → <new-sha256>`.
- Final summary line: `kit.toon rewritten with N updated checksums.` (or `kit.toon unchanged.` when zero updates).
- Returns `KIT_MANIFEST_NOT_FOUND` when `<directory>/kit.toon` is missing.
- Returns `KIT_ITEM_NOT_FOUND` when an `items[].sourcePath` is missing from disk, naming the file path.
- Atomic rewrite: write to `kit.toon.tmp` then rename, never leave a half-written manifest.
- Unit tests cover: all-unchanged, partial update, missing-source-file, malformed-manifest.

## Milestones

### M-01: BYO Kit Install (Phase 1 — pin + atomic + auth + author)
**Entry criteria:**
- Main `ROADMAP.md` M-06 OSS launch has reached its 5-stranger cold-install milestone (per updated C-09)
- C-09 demand validation gate then satisfied post-OSS-launch (≥ 2 of 3 polled teams confirmed)
- ~~Q-03 plugin-clobber risk verified~~ — RESOLVED 2026-06-25 (see C-11): kit state isolated to dedicated `kits.toon` file; both curl and plugin install paths are safe by construction

**Features:** F-01, F-02, F-03, F-06, F-07, F-08, F-09
**Exit criteria:**
- A user can `/loom-library add github:fixture-org/sample-kit@v0.1.0` and the install is atomic
- A user can `/loom-library add /local/path/to/kit` for pre-publish testing
- A user can `/loom-library init-kit ./new-kit` and reach a publishable starter
- A user can `/loom-library checksum ./new-kit` and rewrite the manifest with current sha256 values
- The init→edit→checksum→add (local)→add (github after tag) authoring loop is verified end-to-end against a fixture
- Checksum failures abort cleanly with field-specific errors
- All three `gh` auth failure states have specific error messages
- `KIT_REF_REQUIRED`, `KIT_REF_NOT_FOUND`, `KIT_CHECKSUM_FAIL`, `KIT_NAME_CONFLICT`, `KIT_MANIFEST_NOT_FOUND`, `KIT_ITEM_NOT_FOUND`, `KIT_DIRECTORY_NOT_EMPTY` each have specified exit codes and message text
- Existing public kits install unchanged
- Install state recorded in `~/.claude/skills/library/kits.toon` per C-11; per-kit auxiliary file consistent with authoritative-read rule
- Verified: re-running `install.sh` (curl path) on a machine with installed BYO kits leaves `kits.toon` untouched and BYO kit installations intact

### M-02: Drift Surface + Lifecycle (Phase 2 — observe + update)
**Features:** F-04, F-05
**Exit criteria:**
- `loom doctor --kits` reports local drift with recovery copy
- `loom doctor --kits --check-upstream` reports stale pins
- `remove` cleanly uninstalls with confirmation guard
- `update` re-resolves refs and confirms before applying; `--check-only` available
- Containerized cross-machine convergence fixture passes

## Out of Scope (for now)

- Auto-repair on drift detection (Phase 3 candidate)
- Central registry of private kits (rejected per C-01)
- Kit signing / sigstore for BYO kits (relies on `gh` auth + repo trust instead)
- Kit dependency resolution between BYO kits (manifests are flat for v1)
- Web UI / discoverability for BYO kits (private by definition)
- `type: infrastructure` items in BYO kits (rejected per C-10 — use a private plugin instead)
- Catalog-level browse / search for installed BYO kits (out of scope; future `/loom-library list --kits` could surface them)

## Open Questions

- **Q-05:** What is the published version policy for `kit.toon`'s own format — bump `kitVersion` on every breaking change with a migrator (per `library-catalog-migrator.ts` pattern), or freeze at v1 indefinitely? Defer to first breaking change.

## Resolved Questions (folded into roadmap)

- ~~Q-01 (local path sources):~~ resolved as F-07 (required for authoring).
- ~~Q-02 (project-local vs user-global targets):~~ resolved as C-07 (per-type defaults matching `default_dirs:`, with explicit `scope: global` override).
- ~~Q-03 (plugin install-state.toon clobber):~~ resolved 2026-06-25 by code-read. Plugin path writes only to `~/.loom/install.toon`; curl path overwrites `~/.claude/skills/library/install-state.toon` on every run (`install.sh:350`). Isolated kit state into dedicated `~/.claude/skills/library/kits.toon` per updated C-11 — both channels safe by construction.
- ~~Q-04 (`/loom-library list` surfacing kits):~~ resolved during round 2 converge — `list` walks the new `kits.toon` table alongside the core inventory.

## Dependencies & Risks

- **Depends on:** stable `library-catalog` v4 schema (shipped); `validateSkillSlug` + `validateInstallPath` in `hooks/lib/skill-router.ts` (shipped); main ROADMAP.md M-06 Phase 1 install-state v3 runtime wiring (in flight — gate M-01 on completion).
- **Risk — `gh` CLI not universally installed:** Mitigated by C-04's three-state error reporting with install URL.
- **Risk — kit author writes wrong sha256:** Caught at install time by checksum verification. F-08's companion `checksum` helper makes regeneration trivial.
- **Risk — feature overlap with native Claude Code plugins:** Mitigated by C-08's explicit decision rule and the C-10 restriction on infrastructure items.
- **Risk — demand validation gate is theatre:** Mitigated by deferring the gate to post-OSS-launch (per updated C-09) so the polled teams are real users, not invented contacts. Recording in `planning/history/byo-kits-demand-validation.toon` with three named team contacts remains required at gate-execution time.
- **Risk — OSS launch slips and BYO Kits stalls indefinitely:** Mitigated by treating BYO Kits as a follow-on roadmap, not a blocker for any current work. If OSS launch slips by quarters, BYO Kits sits dormant — no engineering cost incurred while waiting.

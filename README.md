# Loom

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.0.1-blue.svg)](https://github.com/launchstack-dev/loom-ai/releases)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#status)

**A discipline layer on top of Claude Code.** Give Loom a one-line idea — *"add user auth with RBAC and team management"* — and it drives a multi-agent pipeline from scope decisions, through wave-based execution, to passing tests and reviewed code. Tool-call-level hooks keep agents on-task, in-scope, and within budget. The artifacts you get back (plans, scenarios, contracts, wiki) keep working *after* the initial build, through structured change proposals.

> **New here?** Start with [`docs/first-30-minutes.md`](docs/first-30-minutes.md) (narrated quickstart) and [`docs/concepts.md`](docs/concepts.md) (the five concepts you need before commands stop looking arbitrary). [`docs/cheatsheet.md`](docs/cheatsheet.md) is the everyday reference; [`docs/troubleshooting.md`](docs/troubleshooting.md) decodes error messages.

## Quickstart

**1. Install** (assumes you already have [Claude Code](https://docs.claude.com/claude-code)):

```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/v0.0.1/install.sh | bash
```

Restart your Claude Code session. Full install options (latest `main`, private repos, local-dev, non-pipe paths) in [Install](#install).

**2. Pick your starting point.** Loom forks on (a) is there existing code Loom should learn first, and (b) how deliberate do you want the build to be:

| You are… | First command | What it does |
|---|---|---|
| **Brownfield** — adding Loom to an existing codebase | `/loom-init` | Scans the repo, writes a tailored `CLAUDE.md` and `CONTEXT.md`, seeds `.loom/wiki/` with what's already there. Run this *before* any planning command so downstream agents understand your code. |
| **Greenfield, deliberate** — fresh idea, want to think through the roadmap and plan before any code lands | `/loom-roadmap init --full` | Interactive: roadmap (with reviewers) → review-integrate → approve → plan. Pauses at each gate for your input. Closes when you have an approved roadmap + plan ready for `/loom-plan execute`. |
| **Greenfield, fast** — fresh idea, willing to let the pipeline drive end-to-end | `/loom-auto --from "<idea>"` | Full pipeline: prompt refiner → scope contract → roadmap → plan → execute → converge → test → review → fix. Add `--auto` to accept defaults at every gate. |
| **Tiny task in any repo** | `/loom-quick "<task>"` | Zero-ceremony: wiki-context aware, runs the work, emits a retroactive change-proposal so contract pages stay coherent. |

For brownfield projects that *also* want to plan a new feature, run `/loom-init` first, then `/loom-roadmap init --brownfield --full` — the `--brownfield` flag adds a codebase-analysis step that shapes the roadmap around what already exists.

**3. Recommended for `/loom-auto`:** enable [Agent Teams](#agent-teams-experimental--recommended-for-loom-auto) so each pipeline stage gets a fresh context window. Without it, long runs hit context budget and require `/clear` + `--resume` between waves.

For a guided 30-minute tour see [`docs/first-30-minutes.md`](docs/first-30-minutes.md); for the five concepts behind everything see [`docs/concepts.md`](docs/concepts.md).

## What's different

Most "multi-agent" tools rely on prompts to enforce boundaries. Loom blocks at the tool-call level: file ownership, contract locks, context budget, wiki integrity, and quality gates are Claude Code hooks, not instructions. Most BDD layers treat scenarios as documentation. Loom scenarios are the canonical leaf-level testable unit — the convergence-planner emits verification targets directly from them and the pipeline blocks until they pass. Most spec workflows stop at the initial plan. Loom adds an OpenSpec-style change-proposal lifecycle over per-domain contract pages so the spec keeps converging after launch.

The four pillars:

1. **Pre-flight scope contract.** A Prompt Refiner + Scope Interrogator turn a loose prompt into a locked decision manifest (decisions, assumptions, non-goals, testable success criteria) before any code is written. Every downstream agent reads it.
2. **Scenarios drive convergence.** Plans and roadmaps ship Given/When/Then scenarios under each phase and feature. The convergence-planner emits targets from scenarios; the verification pipeline gates on them at four tiers (unit / integration / e2e / qa-review) mapped to wave / phase / feature / milestone.
3. **Hook-enforced discipline.** Thirteen enforcement hooks block unauthorized writes, lock contracts after Wave 0, cap context budget at 100k per spawn, gate premature stops, and keep the wiki coherent.
4. **Change-proposal lifecycle.** After the initial materialize, `/loom-change init → review → approve → run → archive` mutates per-domain `contract-*` wiki pages atomically with drift validation. `/loom-quick` auto-emits a retroactive proposal so small work stays zero-ceremony.

## Status

Loom is **alpha (`v0.0.x`)** — the core pipeline (planning, execution, convergence, code review, change lifecycle) is stable and exercised on real work. The distribution layer is still settling: install is curl-only, signed tarballs and a Homebrew formula land in v0.1.0. Schemas can evolve with migrations; `/loom-upgrade` handles per-project migration when new versions ship.

See [`planning/plans/PLAN-oss-launch.md`](planning/plans/PLAN-oss-launch.md) for v0.1.0 scope.

## Commands

### Use-case cookbook — "I want to X, run Y"

| If you want to… | Run | Notes |
|-----------------|-----|-------|
| **Plan & build** | | |
| Onboard an existing codebase to Loom | `/loom-init` | Brownfield: writes `CLAUDE.md`, seeds `.loom/wiki/` |
| Start a greenfield project deliberately | `/loom-roadmap init --full` | Interactive roadmap → review → approve → plan. Stops at an approved plan ready to execute |
| Start a greenfield project from a roadmap you already have | `/loom-plan create` then `/loom-plan execute` | Dual-track plan + criteria + scenarios, then wave-by-wave execution |
| Run a feature fully autonomously from a one-line idea | `/loom-auto --from "<idea>"` | Roadmap → plan → execute → test → review → fix in one pipeline |
| Iterate an artifact toward a target | `/loom-converge --mode {target\|criteria\|document}` | Convergence loop with circuit breakers + auto-snapshots |
| Fix a bug with Loom rigor (no full plan) | `/loom-bugfix "<desc>"` | Wiki context + impact assessment + fix archive |
| Do a small task quickly | `/loom-quick "<desc>"` | Zero-ceremony + verification + impact + audit log |
| **Review & ship** | | |
| Review a PR or working diff | `/loom-code review` | 9+ parallel reviewers + scenario/contract compliance |
| Auto-apply review findings | `/loom-code fix` | Equivalent to `/code-review --fix` for Loom's review surface |
| Commit / push / open a PR | `/loom-git commit \| push \| pr` | Git workflow automation |
| **Multi-agent reasoning patterns** | | |
| Get N candidate approaches, pick best | `/loom-vote "<problem>"` | Parallel independent solutions + evaluator |
| Refine one artifact across stages | `/loom-chain "<task>"` | Draft → refine → harden pipeline |
| Surface adversarial perspectives | `/loom-debate "<question>"` | Multi-round adversarial debate |
| Route ambiguous work to the right command | `/loom-do "<task>"` or `/loom-triage` | Smart routing (light = `/loom-do`, heavy classifier = `/loom-triage`) |
| **State & handoff** | | |
| See current project state / what's next | `/loom-status` / `/loom-next` | Status overview / state-aware suggestion |
| Pause / resume a session | `/loom-pause` / `/loom-resume` | Snapshot for handoff and later restore |
| Capture an idea without losing focus | `/loom-note add "<idea>"` | Captures to backlog; promote with `/loom-note --promote` |
| **Customize & maintain** | | |
| Manage the project roadmap | `/loom-roadmap {init\|review\|approve\|…}` | Roadmap lifecycle + dependency graphs |
| Run a change proposal over contract pages | `/loom-change {init\|review\|approve\|run\|…}` | OpenSpec-style atomic change-proposal lifecycle |
| Author a project agent | `/loom-agent create` | Guided interview, registers in `orchestration.toml` |
| Pull a published kit on demand (per-machine) | `/loom-library use <kit>` | See [Pull what you need](#pull-what-you-need) |
| **Refresh your install tree** (per-machine `~/.claude/`) | `/loom-library sync` | Auto-detects curl vs local-dev pattern |
| **Migrate this project's planning files** (per-project) | `/loom-upgrade` | Scans `PLAN.md` / `ROADMAP.md` / state TOON files, migrates to current schemas |
| Run the project's wiki layer | `/loom-wiki {ingest\|lint\|query\|status}` | Ingest, lint, search, synthesis |

### Maintenance verbs — `/loom-library` vs `/loom-upgrade`

These two commands look like they overlap; they don't. Different scopes, different layers:

| Command | Operates on | When to use |
|---------|-------------|-------------|
| `/loom-library list / use / add / remove` | **Per-machine catalog** — `~/.claude/skills/library/library.yaml` + `install-state.toon` | "What Loom extensions are pulled into this Claude Code home tree?" |
| `/loom-library sync` | **Per-machine install tree** — files under `~/.claude/{agents,commands,skills,…}` | "Bring `~/.claude/` up to date — re-pull (curl) or reconcile symlinks (local-dev)" |
| `/loom-library update` | **Per-machine catalog refresh** — fetch new catalog entries from upstream `main` | "What new agents/kits has Loom published since I last looked?" |
| `/loom-upgrade` | **Per-project artifacts** — `PLAN.md`, `ROADMAP.md`, state TOON files inside whatever project you're cd'ed into | "Migrate this project's old-format planning files to current schemas" |

The split is the layer they touch. `/loom-library` is your **Loom binary** (the install in your home tree). `/loom-upgrade` is your **project data** (whatever directory you `cd` into). They never overlap.

**Naming-collision note:** `/loom-library upgrade` exists as a deprecated alias for `/loom-library update` and emits a stderr warning. It's **NOT** the same as `/loom-upgrade`. If you want to migrate a project's planning artifacts → `/loom-upgrade`. If you want to refresh your install catalog → `/loom-library update` (or `/loom-library upgrade`, but you'll get a deprecation warning steering you to `update`).

### Per-command reference

| Command | Subcommands | What it does |
|---------|-------------|-------------|
| `/loom` | init, auto, converge, quick, bugfix, pause, resume, do, next, profile, status, debate, chain, vote, triage, upgrade | Root — project lifecycle, session management, orchestration patterns, kit dispatch |
| `/loom-plan` | create, review, execute, test, status | Plan lifecycle — dual-track planning, 6-agent review, wave execution, scenario-driven test generation |
| `/loom-change` | list, status, diff, init, review, approve, run, archive, reject, quick-archive | OpenSpec-style change-proposal lifecycle over `contract-*` wiki pages |
| `/loom-code` | review, fix | 9+ parallel reviewers + scenario/contract compliance, auto-apply fixes |
| `/loom-roadmap` | init, review, approve, add, insert, remove, reorder, explore, refine, validate, status, deps, diff, history, milestone, snapshot | Roadmap lifecycle — multi-persona brainstorming, dependency graphs |
| `/loom-wiki` | ingest, lint, query, status | Wiki management — ingest, lint, search, synthesis |
| `/loom-agent` | create, list | Create bespoke agents, view registered agents |
| `/loom-note` | (add), --review, --assimilate, --backlog, --promote | Notes and backlog — capture, promote to roadmap |
| `/loom-library` | list, use, sync, update, search, add, remove | Per-machine catalog + install-tree management (curl- and local-dev-aware) |
| `/loom-upgrade` | — | Per-project artifact migration — scan old-format `PLAN.md` / `ROADMAP.md` / state files, migrate to current schemas |
| `/loom-git` | commit, push, pr, merge, cleanup, review-pr | Git workflow automation |
| `/loom-data` | — | Data-pipeline-aware orchestration (data agents and validators) |
| `/loom-statusline-setup` | — | Configure the Claude Code status line (Starship integration) |

## Extending Loom

Loom is an **extensible** platform, not a fixed methodology — every reviewer, executor, hook, schema, scenario template, and command is a swappable resource, not a hardcoded pipeline step. Tools that ship a single opinionated workflow force you to fight the framework when your domain doesn't fit; Loom hands you the same primitives its built-in agents use and lets you assemble what your project actually needs.

There are two audiences for this surface: **consumers** and **authors**. To install a published skill kit, run `/loom-library use <kit>`. To author your own agent today, run `/loom-agent create`. The wizards scaffold the resource, add it to `skills/library.yaml`, and register it where it belongs.

Five resource types compose every Loom behavior: **agent** (`.claude/agents/`), **prompt** (`.claude/commands/`), **protocol** (`agents/protocols/`), **skill** (`~/.claude/skills/`), and **infrastructure** (`hooks/`, `scripts/`). Per-project registration lives in `.claude/orchestration.toml`.

### Authoring kits

A kit bundles related resources behind a single `/loom-library use` install. Use the typed `includes:` form so the installer routes each resource to the correct directory:

```yaml
kits:
  - name: hipaa-review
    description: HIPAA-aware code review for healthcare projects
    version: 1.0.0
    includes:
      - { type: agent,    name: hipaa-reviewer }
      - { type: protocol, name: phi-handling }
      - { type: skill,    name: hipaa-audit-checklist }
      - { type: prompt,   name: loom-hipaa-scan }
```

Each entry resolves against the matching block under `library:` (`library.skills:` for `type: skill`, `library.protocols:` for `type: protocol`, etc.). Bare-string entries are accepted for backwards compatibility and resolve via the priority `agent > protocol > skill > prompt`.

## Install

### Two install patterns

Loom supports two install patterns. Pick the one that matches your relationship to the codebase:

| Pattern | Who it's for | Setup | Update flow | Detection signal |
|---------|--------------|-------|-------------|------------------|
| **Curl install** | End users; CI runners; anyone treating Loom as a closed binary | One-liner `curl ... \| bash` (next subsection) — fetches files from `main` and writes them as regular files into `~/.claude/` | Re-run the install one-liner to pull a fresh snapshot of `main` | `~/.claude/skills/library/library.yaml` is a regular file |
| **Local-dev install** | Loom contributors; fork maintainers; anyone who needs to edit Loom and see changes live | `git clone` the repo, then symlink `~/.claude/{commands,agents,skills/library/library.yaml,…}` to paths in your local checkout | `cd /path/to/loom-ai && git pull && /loom-library sync` — `sync` detects the symlinked install and reconciles symlinks (adds new files, replaces stale copies, prunes broken links) | `~/.claude/skills/library/library.yaml` is a symlink to a local path |

`/loom-library sync` auto-detects which pattern is in use and runs the right reconciliation. You never have to remember which one you're on.

The rest of this section assumes the curl pattern. See [`### Update and uninstall`](#update-and-uninstall) below for the local-dev update flow.

### Prerequisites

- **Claude Code** — the CLI or IDE extension. Loom's hooks and skills load from `~/.claude/`.
- **bash 4+** — for the install script.
- **`curl`** — fetches files from GitHub. Falls back to `gh api` when `curl` cannot reach the repo (private-repo flow).
- **Node.js 18–24** — TypeScript hooks run via `bun` (preferred) or `npx tsx` fallback. On **Node 25+** the `npx tsx` fallback is unreliable due to stricter ESM resolution; **`bun` is required** on Node 25+ (or set `LOOM_HOOK_RUNTIME` to a working command).
- **`bun` (strongly recommended; required on Node 25+)** — faster hook execution and the only fallback-free path. Install: `curl -fsSL https://bun.sh/install | bash`.
- **`gh` CLI (optional)** — only needed for private-repo installs.

Platforms tested: macOS (Apple Silicon + Intel), Ubuntu 22.04+. Windows is not supported today.

### One-liner

**Stable (recommended)** — pin to a tagged release:

```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/v0.0.1/install.sh | bash
```

**Latest** — track `main` for early-adopter changes:

```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

Either form is a **minimal bootstrap**. It fetches a small set of core commands plus infrastructure from the chosen ref, validated against `checksums.sha256` from that same ref. The cosign-signed tarball flow lands in v0.1.0 (see [Status](#status)).

### Trust model

Before running any of the install commands, here's exactly what they touch:

- **Writes only to `~/.claude/` and `~/.cache/loom/`.** No `sudo`, no system paths, no shell-init files.
- **No outbound calls after install.** The installer fetches files from GitHub; nothing in Loom phones home.
- **Files are checksum-verified** against `checksums.sha256` from the same ref before they're written.

### Install without piping to `bash`

If you'd rather inspect the installer before running it:

```bash
# Download, read, then run
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/v0.0.1/install.sh -o /tmp/loom-install.sh
less /tmp/loom-install.sh
bash /tmp/loom-install.sh
```

Or clone the repo at the tag and run the installer locally:

```bash
git clone --branch v0.0.1 --depth 1 https://github.com/launchstack-dev/loom-ai.git
cd loom-ai && ./install.sh
```

The `git clone` path is also the entry point for the [local-dev install pattern](#two-install-patterns) if you plan to edit Loom.

### What gets installed

```
~/.claude/
├── commands/                       Core dispatch commands + subcommand files
│   ├── loom.md                     Root dispatcher
│   ├── loom-library.md             Pull-on-demand catalog manager
│   ├── loom-plan/, loom-roadmap/   Progressive-disclosure subcommand dirs
│   └── loom-{change,code,wiki,…}   Noun-grouped commands
├── agents/protocols/               Protocol schemas (pulled on demand)
├── config/starship-loom.toml       Starship status-line theme (optional)
├── skills/library/                 Library catalog cache
├── statusline-renderer.cjs         Pipeline + test-metrics + convergence segments
├── statusline-command.sh           Status-line driver
└── loom-update-checker.cjs         Background catalog version check (4h throttle)

~/.cache/loom/                      Fetch cache + staging area
```

Nothing outside `~/.claude/` or `~/.cache/loom/` is touched. The install script validates target paths before writing.

> **Known gap (v0.0.1):** the installer does **not** ship the enforcement hooks (`file-ownership`, `contract-lock`, `context-budget`, `deploy-guard`, `quality-gate`, `typecheck-on-write`, wiki guards, etc.) or the `.claude/settings.json` that wires them into PreToolUse / PostToolUse. Those live per-project (Claude Code hooks reference `$CLAUDE_PROJECT_DIR/hooks/...`), and the curl install only touches `~/.claude/`. Pillar 3 of the README — "hook-enforced discipline" — is only fully live in the local-dev install pattern today, where you work inside the Loom repo itself. Curl-install users get the slash commands, agents, and convergence pipeline, but the tool-call-level enforcement gates are not wired. Tracking issue + fix planned for the next minor release; the fix will extend `/loom-init` to bootstrap project-local hooks + `settings.json` on opt-in.

### Verify the install

```bash
ls ~/.claude/commands/loom*.md      # expect ~25 .md files
ls ~/.claude/statusline-renderer.cjs ~/.claude/loom-update-checker.cjs
```

Inside Claude Code, run:

```
/loom                               Should display the root help text
/loom-library list                  Should show installed vs available kits
```

If `/loom` returns "Unknown command", confirm `~/.claude/commands/loom.md` exists and that your Claude Code session has reloaded (restart the session or run `/clear`).

### Agent Teams (experimental — recommended for `/loom-auto`)

Claude Code ships an experimental **agent teams** mode that lets a lead agent spawn long-running stage teammates and pass context between them through disk instead of keeping every stage in the same context window. Loom uses this when available — `/loom-auto` switches to a lead-dispatcher / per-stage-teammate architecture (`execute-stage-teammate`, `test-stage-teammate`, `review-stage-teammate`, `fix-stage-teammate`, `converge-stage-teammate`) whose context windows reset between stages.

To enable it, export this env var in your shell rc (`~/.zshrc`, `~/.bashrc`, etc.) and start a fresh Claude Code session:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Confirm by inspecting `env | grep AGENT_TEAMS` inside the session.

**What changes when it's on:**

| Mode | Behavior |
|------|----------|
| Off (default) | `/loom-auto` runs single-agent with checkpoint+clear. Stages share one context window; at the checkpoint critical threshold, the lead writes full state to disk and recommends `/clear` then `--resume`. |
| On (`=1`) | `/loom-auto` runs as a lead dispatcher that spawns a dedicated teammate per stage. Each stage starts with a fresh context window and reads its inputs from `stage-context/*.toon` on disk. No `/clear` needed between stages. |

**When to turn it on**

- You run `/loom-auto` end-to-end on multi-wave plans where the single-agent context fills up before convergence
- You want deterministic context boundaries between stages (each teammate is auditable in isolation)
- You're comfortable with experimental Claude Code surfaces

**When to leave it off**

- One-shot commands (`/loom-quick`, `/loom-bugfix`, `/loom-code review`) — they don't span enough stages to benefit
- Sessions where you actively want to inspect / inject between stages

Either mode produces the same on-disk artifacts (`stage-context/*.toon`, `wave-N-summary.toon`, etc.) — agent teams is a runtime acceleration, not a different pipeline. See `commands/loom-auto.md` Step 1 for the detection logic and `agents/protocols/team-coordination.md` for the dispatch protocol.

### Your first run

See the [Quickstart](#quickstart) section at the top of this README, or the narrated walkthrough in [`docs/first-30-minutes.md`](docs/first-30-minutes.md).

### Pull what you need

After the bootstrap, kits are pulled on demand:

```
/loom-library use loom-plan         Plan lifecycle + execution agents + scenarios
/loom-library use loom-change       Change-proposal lifecycle + contract-page tooling
/loom-library use loom-code         Code review + fixer agents
/loom-library use loom-roadmap      Roadmap + brainstorming agents
/loom-library use loom-wiki         Wiki agents + hooks
```

### Update and uninstall

`/loom-library sync` is the single update command; it auto-detects which install pattern is in use (see [Two install patterns](#two-install-patterns)) and runs the right reconciliation.

**Curl install — refresh the install tree:**

```
/loom-library sync                  Re-pull every tracked item; confirm before applying
/loom-library update                Check all sources (catalog + items) for changes, show diff, confirm before applying
/loom-library list                  Show installed vs available
```

A `sync` on a curl-install env walks `~/.claude/skills/library/install-state.toon`, re-fetches each item from its `source` (curl-from-GitHub or local path), and — after the user confirms via `yes / no / select individually` — atomically replaces the `targetPath` and updates the install-state record. `update` is the broader operation: it ALSO surfaces new catalog entries published since the last run, then routes through the same apply step.

**Local-dev install — refresh symlinks from local checkout:**

```bash
cd /path/to/loom-ai
git pull
```

```
/loom-library sync                  Reconcile ~/.claude/ symlinks vs the local checkout
```

A `sync` on a local-dev env (detected via `~/.claude/skills/library/library.yaml` being a symlink) walks the local checkout's `commands/`, `agents/`, `agents/protocols/`, `skills/library.yaml`, and `skills/*/SKILL.md` (native Claude Code skills). It adds symlinks for new files, replaces stale install.sh copies with symlinks, and prunes broken symlinks whose targets no longer exist. The local checkout itself updates via plain `git pull` — symlinks pick up the new file contents automatically the moment `git pull` finishes; `sync` only fires when the checkout's *file set* changes (new agents, removed files, etc.).

`/loom-library sync` is dry-run by default; pass `--apply` to mutate.

**Uninstall (both patterns):**

```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/uninstall.sh | bash
```

Removes Loom-installed paths from `~/.claude/` and `~/.cache/loom/` per `install-state.toon`. For local-dev installs, also removes the symlinks pointing at the local checkout (the checkout itself is left untouched — `rm` the clone manually if you want).

**Note on `/loom-upgrade`:** This is *not* an install-tree command. It scans the planning artifacts in whatever project you're cd'ed into (`PLAN.md`, `ROADMAP.md`, state TOON files) and migrates them from old schemas to current. Don't run it expecting an install upgrade — see [Maintenance verbs](#maintenance-verbs-loom-library-vs-loom-upgrade) above for the split.

### Private repo

If the repo is private, the installer falls back to `gh api` after the first `curl` HTTPS attempt fails. Authenticate `gh` first:

```bash
gh auth login
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

### Signed-release path

The current installer fetches files directly from the chosen ref (tag or branch) and validates against a same-ref checksum manifest. The cosign + Sigstore signed-tarball flow (keyless, OIDC-backed) plus version-pinned `--ref vX.Y.Z` installs and atomic file-scoped rollback land in v0.1.0. See [`planning/plans/PLAN-oss-launch.md`](planning/plans/PLAN-oss-launch.md) for the launch roadmap.

## Pre-flight Scope Contract

`scope-contract.toon` is produced before any execution begins and flows through every downstream stage.

1. **Prompt Refiner** expands a loose prompt (e.g. "add auth") into a structured brief by scanning the codebase.
2. **Scope Interrogator** poses proposal-based decisions — not bare questions. Each decision presents 2–3 concrete options with code examples and implied acceptance criteria. Brownfield-aware: reads wiki pages, init-report, and `CLAUDE.md` so proposals reference existing code ("Your codebase already has JWT middleware at `src/middleware/auth.ts`…").
3. **scope-contract.toon** locks decisions, assumptions, non-goals, and testable success criteria.

Downstream:
- Roadmap reads it → features from decisions, constraints from non-goals
- Plan reads it → architecture constraints; criteria-planner seeds scenarios from success criteria
- Execution reads it per wave → contract drift detection
- Code review checks against it → `[CONTRACT]` tag for violations
- Wiki captures decisions as pages automatically

## Scenarios Layer

Plans and roadmaps include first-class **Given/When/Then scenarios** under acceptance criteria and key behaviors. Unlike documentation-only BDD, Loom scenarios drive convergence: the planner emits verification targets from them and the pipeline blocks until they pass.

```toon
id: S-01
title: Reject signup when email already exists
given[1]: A user with email "alice@example.com" exists
when: A client POSTs /api/signup with email "alice@example.com"
whenTriggerType: api-call
then[2]: Response status MUST be 409, Response body MUST contain error code "email-taken"
tags[1]: error
testTier: integration
automatable: true
```

The 4-tier convergence model maps tiers to planning-hierarchy levels:

| Tier | Hierarchy | Runner | Gates |
|------|-----------|--------|-------|
| Unit | Wave | vitest-runner | block-wave (all-pass) |
| Integration | Phase | integration-test-agent | block-feature (all-pass) |
| E2E | Feature | e2e-runner-agent (Playwright / Chrome MCP) | block-milestone (zero-critical) |
| QA Review | Milestone | qa-review-agent (fan-out) | advisory (zero-blocking) |

See `docs/scenarios-authoring-template.md` for authoring guidance and `agents/protocols/scenario.schema.md` for validator rules.

## Convergence: one loop, applied everywhere

Loom has a single iteration pattern — **do work, check work, remediate what failed, repeat until done** — implemented in `convergence-driver`. The driver knows nothing about its application: it consumes a `subject`, a `harness` (what to check), and an `integrator` (who applies fixes), runs the loop with circuit breakers and snapshots, and stops when the harness reports zero blocking findings. New applications are pure wirings — no engine changes.

```
   ┌─→  do work        execute, draft, generate
   │
   │   check           harness emits findings.toon
   │                   (tests, reviewer fan-out, golden diff,
   │                    doc-quality review, PR-bot output)
   │
   │   triage          driver: converged | continue | stalled |
   │                   regression | budget_exhausted
   │
   └── remediate       integrator applies findings
                       (fixer-agent in parallel, or a custom
                        integrator that rewrites the artifact)
```

The same engine powers multiple applications:

| Application       | Subject              | Harness                       | Integrator       | Status |
|-------------------|----------------------|-------------------------------|------------------|--------|
| Code + tests      | working tree / diff  | vitest + reviewer fan-out     | fixer-agent      | shipped (criteria mode) |
| Plan creation     | `PLAN.md`            | plan-critic + reviewers       | plan-builder     | shipped (document mode, via `/loom-plan create --autoconverge`) |
| Document refine   | any markdown file    | configurable doc-harness      | fixer-agent      | shipped (document mode) |
| Golden-file match | generated output     | diff vs reference             | fixer-agent      | shipped (target mode) |
| Test creation     | test files           | test-quality reviewers        | fixer-agent      | roadmap (F-01) |
| Debug loop        | failing test/log     | symptom re-run                | bugfix-analyst   | roadmap (F-03) |
| PR review         | PR head              | Gemini/CodeRabbit/Copilot     | fixer-agent      | roadmap (F-04) |

Roadmap rows are wirings against the frozen engine — see [`planning/ROADMAP-convergence-applications.md`](planning/ROADMAP-convergence-applications.md).

### Convergence Applications

One loop, applied everywhere — the same convergence-driver substrate powers all five `--autoconverge` surfaces below. Each is a thin wiring (subject + harness + integrator) onto the shared engine; the iteration semantics, circuit breakers, and snapshots come for free. See the table above for the subject/harness/integrator split.

| Surface | Iterates | Status |
|---------|----------|--------|
| `/loom-plan create --autoconverge` | A `PLAN.md` toward zero plan-critic + reviewer findings | shipped (convergence-generalization) |
| `/loom-code review --autoconverge` | The working tree / diff toward zero blocking review findings | F-01 |
| `/loom-test --autoconverge` | Generated test files toward zero test-quality findings | F-02 |
| `/loom-bugfix --autoconverge` | A failing symptom toward a passing reproduction | F-03 |
| `/loom-git review-pr --autoconverge` | A PR head toward zero external-bot findings (Gemini-only for now) | F-04 |

### Modes

`/loom-converge` exposes three modes that parameterize the loop:

- **`--criteria`** — iterate until every scenario passes and every reviewer approves. Default for `/loom-auto` and recommended for most work.
- **`--target <path>` or `--plan`** — iterate until the delta against a deterministic reference (golden file, API response, known-good output) reaches zero.
- **`--mode document --subject <path>`** — iterate any document until its harness reports zero blocking findings. This is the substrate the roadmap applications wire onto.

### How an iteration runs

Inside the loop, each iteration is a five-step pipeline executed by the orchestrator:

```
1. planner          convergence-planner-agent emits/refreshes converge.config
                    (criteria mode: targets emitted directly from scenarios)
2. harness          harness-builder / criteria-harness-builder generate runner
                    scripts (vitest cmd, e2e Playwright cmd, qa-review fan-out)
3. run              Invoke runners in tier order. Capture stdout/stderr/exit.
4. delta            delta-analyzer compares actual vs expected. Emits per-target
                    pass/fail/score + diff summary into iter-{N}.toon.
5. driver           convergence-driver decides: converged | continue | stalled
                    | regression | budget_exhausted. Picks the next iteration's
                    fix targets (fan-out to fixer-agents per failing target).
```

Per-iteration artifacts are written to `.plan-execution/convergence/iterations/iter-{N}.toon` and preserved across iterations. State lives in `.plan-execution/convergence-state.toon` so the loop is resumable.

### Tier gating (criteria mode)

The four tiers run in order; each tier gates the next per its `gatingBehavior`:

| Tier | Hierarchy | Pass condition | If it fails |
|------|-----------|----------------|-------------|
| **Unit** | Wave | all-pass | Blocks the wave — fixer-agents target failing tests, next iteration retries |
| **Integration** | Feature | all-pass | Blocks the feature — same fan-out pattern |
| **E2E** | Milestone | zero-blocking | Blocks milestone close — advisory stories may still fail |
| **QA Review** | Phase | zero-critical | Advisory — critical findings block, warnings/info do not |

The convergence-planner emits targets from scenarios using the resolution chain in `agents/protocols/convergence-tier.schema.md` (rules summarized: `automatable: false` → qa-review; single-tag default; multi-tag highest-cost wins; `whenTriggerType` fallback; explicit `testTier` always overrides).

### Circuit breakers

The convergence-driver halts the loop and surfaces a clear failure rather than spinning forever. Five terminal states:

- **`converged`** — all blocking targets pass at their required tolerance.
- **`continue`** — at least one target still fails but progress was measurable; run next iteration.
- **`stalled`** — same targets failing two iterations in a row with no delta improvement. Driver freezes the loop and asks for manual intervention.
- **`regression`** — a target that passed in iteration N-1 now fails in iteration N. Driver halts; rollback is recommended (see `convergence-rollback.md`).
- **`budget_exhausted`** — total agent spawns or token budget exceeded. Driver pauses; user can raise the budget in `orchestration.toml` and `--resume`.

`--max-iterations N` caps total loop count (default 5).

### Per-iteration auto-commits

By default the loop commits at the end of each iteration that produces file changes. This makes rollback cheap and creates a per-iteration trail. Disable with `--no-auto-commit` if you want to control commits manually.

### Inspect and resume

```
/loom-converge --status              Show iteration count, per-tier gate status, failing targets,
                                     stall/regression detection, next-action suggestion

/loom-converge --resume              Continue from saved state. Refuses if previous run
                                     converged; warns if it stalled or regressed.
```

### Tier selection

Run a single tier or all four:

```
/loom-converge --criteria --tier unit          Just unit tests
/loom-converge --criteria --tier e2e           Just E2E (Playwright headless by default; --chrome for MCP)
/loom-converge --criteria --full               All 4 tiers in order
/loom-converge --criteria --phase 3            Scope to plan phase 3
/loom-converge --criteria --feature F-01       Scope to feature F-01
/loom-converge --criteria --reviewers security,architecture   Specific reviewer types
```

### Target mode

For deterministic outputs (API responses, generated files, golden schemas):

```
/loom-converge --plan                          Interactive target discovery (planner asks questions)
/loom-converge --target golden/api.json        Direct target file, skip planner
/loom-converge --target golden/api.json --tolerance 0.95   Allow up to 5% diff
```

Target mode is the right choice when "correct" is a known file you can diff against. Criteria mode is the right choice when "correct" is a set of scenarios that must hold.

## Testing Pipeline

Loom treats tests as a planning artifact, not an afterthought. The default mode for `/loom-auto` and `/loom-plan create` is **dual-track**: a `plan-builder-agent` and a `criteria-planner-agent` run in parallel from the same roadmap input — neither reads the other's output. An `interpretation-reviewer-agent` then cross-references the two and surfaces conflicts before any code is written.

```
                  ROADMAP.md
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
 plan-builder                  criteria-planner
   PLAN.md                     criteria-plan.toon
       │                               │
       └───────────────┬───────────────┘
                       ▼
         interpretation-reviewer
         conflicts/{id}.toon  ← blocks if blocking-severity
                       │
                       ▼
              convergence-driver
```

**Why dual-track:** sequential planning (plan first, then tests) propagates the planner's interpretation silently into the tests. Independent interpretation surfaces requirement ambiguities — "the planner thinks the auth flow does X, the criteria planner thinks it does Y" becomes a blocking conflict instead of a silent disagreement that ships.

### Test generation from scenarios

Scenarios are the canonical seed. The criteria-planner emits per-scenario verification targets; the harness builders generate the actual runner scripts:

| Tier | Generator | Runner | Source artifact |
|------|-----------|--------|-----------------|
| Unit | `criteria-harness-builder` | `unit-test-agent` → `vitest-runner` | Scenario `whenTriggerType: system-event` or `tags: [edge-case]` |
| Integration | `criteria-harness-builder` | `integration-test-agent` | Scenario `whenTriggerType: api-call` |
| E2E | `e2e-test-writer-agent` | `e2e-runner-agent` (Playwright / Chrome MCP) | YAML stories from `whenTriggerType: actor-action` |
| QA Review | (no harness) | `qa-review-agent` fan-out | Scenario `automatable: false` |

### Red-green TDD gate (adopted from Superpowers)

The `implementer-agent` must confirm test stubs **fail** before writing implementation code, and **pass** after. The `AgentResult.verificationStatus` field is required — agents that skip verification are rejected. The `fixer-agent` runs `diagnose-before-fix`: it investigates root cause before applying a change. The `tdd-coach` agent is available when you want an explicit red-green-refactor coach — invoke it directly via the Task tool.

### E2E specifics

- **Playwright headless** for parallel automated execution (CI-compatible).
- **Chrome MCP mode** (`--chrome`) for authenticated flows — uses your already-logged-in browser via `mcp__claude-in-chrome__*` tools.
- **YAML user stories** — human-writable specs at `.plan-execution/convergence/e2e/stories/{storyId}.toon`. The `e2e-test-writer-agent` generates them from criteria-plan entries.
- **Named session isolation** — each story carries a `sessionName` (kebab-case). In headless mode that becomes a separate Playwright browser context (cookies/storage isolated, runs in parallel). In Chrome MCP mode it becomes a separate tab (state shared, runs sequentially — the right choice for OAuth/SSO flows).
- **Step-level screenshot + console-dump audit trail** captured per session under `.plan-execution/convergence/e2e/screenshots/{runId}/{sessionName}/` so you can diff per-story outputs across iterations.

### Commands

```
/loom-plan test                    Generate test stubs from criteria-plan + run them
/loom-plan test --run              Generate + execute in one shot
/loom-converge --criteria --tier unit          Just unit tier
/loom-converge --criteria --tier e2e --chrome  E2E with authenticated browser
/loom-converge --criteria --full               All 4 tiers
/loom-converge --criteria --feature F-01       Scope to one feature
```

### Test artifacts

- `criteria-plan.toon` — derived test plan (criteria, tier assignments, reviewer config)
- `.plan-execution/convergence/iterations/iter-{N}.toon` — per-iteration test results
- `.plan-execution/convergence/e2e/stories/` — YAML stories
- `.plan-execution/convergence/e2e/tests/` — generated Playwright test files
- `.plan-execution/convergence/e2e/screenshots/` — failure artifacts
- `flaky-test.toon` — flaky-test detection log (suppresses oscillating tests)

## Code Review Cycles

`/loom-code review` fans out to parallel reviewer agents and produces a per-agent `AgentResult` with structured findings (severity + dimension + file + lines + suggested fix). `/loom-code fix` consumes those findings and runs parallel fixer-agents against them. Findings that violate the scope contract are tagged `[CONTRACT]` by the `plan-compliance-reviewer` — e.g., "Decision D-03 specified repository pattern but file uses Prisma ORM directly."

### What runs

| Mode | Reviewers |
|------|-----------|
| `--quick` | Core code + security only |
| Default | security, architecture, plan-compliance + the base built-in reviewers |
| `--full` | All of the above + extended: performance, accessibility, dependency-auditor, api-design, database-schema, infra, observability |

Plus convergence-tier QA review (`qa-review-agent`) runs at phase boundaries inside `/loom-converge --criteria` and produces advisory findings on interpretation drift, coverage gaps, and cross-cutting concerns.

### Selecting scope

```
/loom-code review                    Unstaged changes
/loom-code review --staged           Staged changes only
/loom-code review --branch           Current branch vs main
/loom-code review --pr 123           A specific PR (via gh CLI)
/loom-code review --quick            Fast pass: code + security
/loom-code review --full             All reviewers in parallel
```

For dimension-scoped iteration inside the convergence loop use `--reviewers` on `/loom-converge`:

```
/loom-converge --criteria --reviewers security,code-review,performance,architecture
```

### The review → fix → re-review cycle

```
1. /loom-code review            Fan-out reviewers, write findings to .plan-execution/
2. /loom-code fix --dry-run     Show fix plan (which findings, which files)
3. /loom-code fix               Parallel fixer-agents apply per-finding patches,
                                respecting file-ownership and contract-lock hooks
4. /loom-code review            Re-review the patched code — confirm findings closed
                                + check for regressions
```

For iterative review inside the convergence loop:

```
/loom-converge --criteria --no-soft                        Skip tests; iterate reviews only
/loom-converge --criteria --reviewers security,architecture   Specific reviewers in the loop
/loom-converge --criteria --no-hard                        Reviews + tests, but skip review-only iteration
```

Convergence iterates: review → fixer fan-out → re-review → driver decides converged/stalled/regression. The same circuit breakers apply (`stalled`, `regression`, `budget_exhausted`).

### `/loom-code review --autoconverge` vs `/loom-code fix`

Both apply review findings; they differ in whether they loop. Pick by whether you want a single pass or convergence to zero blocking findings:

| Action | When to use | Output |
|--------|-------------|--------|
| `/loom-code review --autoconverge` | You want the code to converge to zero blocking review findings — driver runs review → fix → re-review until converged, stalled, or budget-exhausted | Iteration log under `.plan-execution/convergence/iterations/` + final patched tree |
| `/loom-code fix` | You already have findings on disk and want a one-shot apply pass with no re-review loop | Patched files; unfixable findings escalated via `.plan-execution/ephemeral/requests/` |

`--autoconverge` is the convergence-driver wiring; `fix` is the integrator step on its own. They share the same fixer-agent fan-out and the same `file-ownership.ts` / `contract-lock.ts` guarantees described below.

### Fix-time guarantees

The fixer-agent runs scoped: it reads only the findings assigned to it, edits only files inside its ownership boundary (enforced by `file-ownership.ts`), and refuses to touch `contracts/` after Wave 0 (enforced by `contract-lock.ts`). Findings the fixer cannot apply autonomously are escalated to the user via `.plan-execution/ephemeral/requests/`. Findings the user explicitly defers are recorded to the wiki as design constraints so future agents see them.

### Severity model

| Severity | Behavior |
|----------|----------|
| `critical` | Blocks merge; convergence loop iterates until resolved |
| `blocking` | Blocks the current convergence tier from passing |
| `warning` | Advisory; surfaced in `/loom-status`; does not block |
| `info` | Logged to the wiki and the review summary; advisory only |

`--severity critical` on `/loom-code fix` restricts fixers to critical findings only — useful for ship-readiness checks where you want a clean critical/blocking list before merge.

### Bespoke reviewers

Register a custom reviewer in `.claude/orchestration.toml`:

```toml
[review.agents.hipaa-reviewer]
source = ".claude/agents/hipaa-reviewer.md"
model = "sonnet"
modes = ["default", "full"]   # appears in /loom-code review and --full
outputRole = "reviewer"
```

Bespoke reviewers participate in the same fan-out, contribute findings in the same envelope, and feed the same fixer pipeline.

## Test Convergence

`/loom-test --autoconverge` runs your test suite, treats every failure as a blocking finding, and loops `fixer-agent` against the code under test until all tests pass (or `maxIterations=5` is hit, or the driver detects a stall). It is TDD-by-convergence: you write the tests, the engine drives the implementation to green.

The test-harness ships three runner adapters — `bun test`, `vitest`, `pytest` — selected via `--runner`. Each adapter parses its runner's output format into the canonical `findings.toon` shape (one row per failure, `severity: blocking`, `locationAnchor` is the `describe > it` chain, `summary` is the first line of the failure message stripped of ANSI). The fixer-agent's Integrator Mode (shared with `/loom-code review --autoconverge`) consumes those findings and revises the source under test.

### When to use

- TDD where you want the engine to chip away at a failing suite without a human in the loop
- Recovering a suite after a refactor that broke a known subset of tests
- Driving a partially-stubbed implementation toward green

### Invocation

```
/loom-test --autoconverge --subject src/billing.ts             Default runner (bun)
/loom-test --autoconverge --subject src/api --runner vitest    Vitest output format
/loom-test --autoconverge --subject pkg/foo.py --runner pytest Pytest output format
```

Spawn-count ceiling at the locked `maxIterations=5` default: **11 agents** (`1 + 5 × (1 test-run + 1 fixer)`) — bounded and predictable. See `scripts/test-harness.ts`.

## Bugfix Convergence

`/loom-bugfix --autoconverge` targets a failing symptom (a failing test path, a repro script, or an error log) and converges the code that's causing it. It composes two agents the convergence-driver fans out per iteration: `debug-investigator-agent` surfaces probable causes as findings, and `fixer-agent` applies them. The harness re-runs the symptom each iteration and emits a synthetic `severity: blocking` row (`reviewerAgent: debug-harness`, `summary: "symptom still reproduces"`) until the symptom resolves — at which point that row disappears, `blockingCount → 0`, and the driver declares converged. No schema extension; pure synthetic-finding workaround per OQ-01.

### When to use

- A failing test or repro script you can't immediately localize
- Recurring symptoms where you want the investigator's confidence-graded cause hypotheses written to disk for audit
- Compared to bare `/loom-bugfix` (one-shot diagnose + fix, no loop): use `--autoconverge` when you want the engine to keep iterating until the symptom is genuinely gone, with circuit breakers if it stalls

### Invocation

```
/loom-bugfix --autoconverge --symptom test/path/to/failing.test.ts
/loom-bugfix --autoconverge --symptom scripts/repro-issue-42.sh
```

Investigator confidence maps to finding severity: `high=blocking, medium=warning, low=info`. The synthetic symptom-row is what gates termination — even if the investigator produces only warnings, the loop continues until the repro script exits 0. See `scripts/debug-harness.ts` and `agents/debug-investigator-agent.md`.

## PR-Review Convergence

`/loom-git review-pr --autoconverge` pulls PR-review-bot findings (Gemini Code Assist today; CodeRabbit and Copilot adapters deferred) and converges the PR head toward zero blocking findings. Per iteration: the dispatcher refreshes a `pr-state.toon` projection (`baseSha`, `headSha`, `diffHash`, `files[]`, `commentIds[]`) via `gh pr view/diff`, the Gemini adapter parses inline-image severity tags (`![high|medium|low]`) into the canonical findings shape, and `pr-fixer-agent` (a thin wrapper over `fixer-agent` with `gh pr diff` context injection) applies them. Each iteration commits with message `fix(pr-iter-{N}/gemini): {summary}` — squash-on-merge collapses them into a single PR commit.

The adapter dedupes findings cross-iteration per OQ-04: it reads the prior iteration's `findings.toon` and suppresses any `(locationPath, locationAnchor, summary)` triple it already saw. That solves the Gemini stale-anchor re-flag problem observed during the manual PR #19 dogfood (rounds 3–5).

### When to use

- A PR with Gemini Code Assist enabled where you want the bot's findings applied iteratively instead of round-tripping by hand
- Any PR where dedup across rounds matters (rebase-heavy branches, long-running PRs)

### Setup

- `gh` CLI must be authenticated against the repo
- Gemini Code Assist must be enabled on the PR (or whichever adapter you target via `botAdapter`)

### Invocation

```
/loom-git review-pr --autoconverge                  Resolves current branch's open PR via gh
/loom-git review-pr --autoconverge --pr 123         Explicit PR number
```

Spawn-count ceiling at `maxIterations=5`: **11 agents** (`1 + 5 × (1 adapter + 1 pr-fixer)`). See `scripts/pr-review-harness.ts`, `scripts/lib/pr-review-adapters/gemini.ts`, and `agents/pr-fixer-agent.md`.

## Change Lifecycle (over `contract-*` wiki pages)

Completed milestones materialize via `/loom-plan materialize` into per-domain `contract-*` wiki pages at `.loom/wiki/pages/contract-{domain}.md`. Subsequent maintenance flows through `/loom-change`:

```
/loom-change init "Add refund flow to billing"
/loom-change review chg-20260520-add-refund-flow
/loom-change approve chg-20260520-add-refund-flow
/loom-change run chg-20260520-add-refund-flow
/loom-change archive chg-20260520-add-refund-flow
```

`archive` atomically applies per-domain `DeltaBlock`s to the affected contract pages, refreshes the wiki index, and appends a History entry. Manual edits are caught by a content-checksum drift validator surfaced through `/loom-wiki lint`. For small work, `/loom-quick` auto-emits a retroactive `quick-archive` proposal so contract pages stay coherent without ceremony.

See `docs/scenarios-and-changes.md` for end-to-end walkthroughs.

## How Loom compares

Loom borrows shapes from OpenSpec (change-proposal lifecycle) and Superpowers (TDD red-green gate, diagnose-before-fix), and shares some surface with GSD. Loom is **not** in the same category as framework-level orchestrators (CrewAI, AutoGen, LangGraph) or IDE-integrated coding agents (Aider, Cursor, Cline).

See [`docs/comparison.md`](docs/comparison.md) for the full comparison table, borrowed-pattern attribution, and "when Loom is the wrong choice" notes.

## Architecture

```
Pre-flight                            Scope Contract
──────────                            ──────────────
prompt-refiner-agent          ──→ scope-contract.toon
questioner-agent (interrogator)         │
                                        ▼
Planning (dual-track, parallel)
──────────────────────────────
plan-builder-agent ──┐
                     ├──→ interpretation-reviewer-agent ──→ conflicts/{id}.toon
criteria-planner-agent ──┘                                    (blocks if blocking-severity)

Execution (wave-based, hook-enforced)
─────────────────────────────────────
Wave 0: contracts-agent ──→ contracts/        (contract-lock hook arms after Wave 0)
Wave 1+: implementer-agents (parallel, file-ownership hook enforced)
         api-route-creator, api-connector, wiring-agent, verification-agent

Convergence (4 tiers × hierarchy level)
───────────────────────────────────────
convergence-planner-agent  ──→ converge.config (targets emitted from scenarios)
target-parser / harness-builder / criteria-harness-builder
delta-analyzer            ──→ iter-{N}.toon
convergence-driver         ──→ circuit breakers + iteration strategy

Testing
───────
acceptance-criteria-agent / unit-test-agent
integration-test-agent / e2e-test-writer-agent / e2e-runner-agent
qa-review-agent (fan-out, dimensions-scoped)

Code Review (parallel)
──────────────────────
security / architecture / plan-compliance + 6 built-in reviewers
Extended (--full): performance, accessibility, dependency-auditor,
                   api-design, database-schema, infra, observability
fixer-agent (parallel, scoped to findings)

Scenarios + Change Lifecycle
────────────────────────────
scenario.schema.md / scenario-coverage.schema.md
contract-page-extensions.schema.md
change-proposal.schema.md / change-state.schema.md
/loom-change list/status/diff/init/review/approve/run/archive

Wiki + Knowledge
────────────────
wiki-maintainer-agent / wiki-ingest-agent / wiki-lint-agent / wiki-query-agent
contract-* pages (materialized from milestones)
assumption-* pages (Bohm-inspired surfacing)
wiki-impact-warner / wiki-session-status / wiki-commit-ledger hooks

Infrastructure
──────────────
statusline-renderer.cjs        Pipeline state + test metrics + convergence segments
loom-update-checker.cjs        Background catalog version check (4h throttle)
```

Selected protocols (47 total in `agents/protocols/`):

| Protocol | Purpose |
|----------|---------|
| `agent-result.schema.md` | Standard return envelope (verificationStatus + diagnoseLog) |
| `scope-contract.schema.md` | Pre-flight decisions, criteria, contract evolution |
| `scenario.schema.md` | Given/When/Then leaf-level testable unit |
| `convergence-tier.schema.md` | 4-tier convergence × hierarchy mapping |
| `change-proposal.schema.md` | Change envelope + per-domain `DeltaBlock` |
| `contract-page-extensions.schema.md` | Shape of `contract-*` wiki pages |
| `taxonomy.md` | Formal planning hierarchy (wave/phase/feature/milestone) |
| `execution-conventions.md` | File ownership, atomic writes, TOON, directory layout |
| `context-budget.md` | 100k cap per spawn, stage summaries, rolling-context tiers |
| `orchestration-patterns.md` | Debate, chain, vote, triage, converge |
| `behavioral-guidelines.md` | Karpathy-inspired agent guardrails |
| `wiki-conventions.md` + `wiki-lint-rules.md` | Wiki page format and lint rules |

## Workflows

### Full pipeline

```
/loom-init                              Brownfield onboarding → CLAUDE.md + wiki
/loom-roadmap init --brownfield         Create roadmap informed by existing code
/loom-roadmap explore "feature idea"    Multi-persona brainstorming (optional)
/loom-roadmap review                    4 agents review in parallel
/loom-roadmap approve                   Lock roadmap
/loom-plan create                       Dual-track: plan-builder + criteria-planner
                                        + interpretation-reviewer blocks on conflicts
/loom-plan review                       6 agents analyze plan
/loom-plan execute                      Wave-by-wave with contract-lock + ownership
/loom-converge --criteria --full        4-tier convergence: unit → integration → e2e → qa-review
/loom-code review                       9+ reviewers + contract/scenario compliance
/loom-code fix                          Auto-apply findings
/loom-plan materialize                  Emit per-domain contract-* wiki pages
```

### Autonomous

```
/loom-auto --from "add user auth with RBAC and team management"
```

Prompt refiner → scope interrogation → roadmap → dual-track plan → execute → converge → test → review → fix. Circuit breakers stop the loop if stuck. Contract drift detection per wave.

Flags: `--skip-preflight`, `--light-preflight`, `--auto` (accept all defaults).

For long multi-wave runs, enable [Agent Teams](#agent-teams-experimental--recommended-for-loom-auto) (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) so each pipeline stage gets a fresh context window instead of accumulating in one. Without it, the single agent will hit context budget thresholds and require `/clear` + `--resume` between waves.

### Quick task

```
/loom-quick "add rate limiting to the API endpoints"
```

Wiki-context-aware, impact-assessment-aware. On completion, emits a retroactive change proposal via `/loom-change quick-archive` so contract pages stay coherent.

### Bugfix

```
/loom-bugfix "users see 500 on /api/teams when invited but not active"
```

Bugfix-analyst-agent isolates the failing scenario, the convergence loop blocks until the scenario passes.

### Change proposal

```
/loom-change init "Add refund flow to billing"
/loom-change review chg-20260520-add-refund-flow
/loom-change approve chg-20260520-add-refund-flow
/loom-change run chg-20260520-add-refund-flow
/loom-change archive chg-20260520-add-refund-flow
```

### Multi-persona brainstorming

```
/loom-roadmap explore "should we add real-time collaboration?"
/loom-roadmap explore "AI search" --depth deep --personas engineer,designer,pm,security,skeptic
```

3–6 persona agents (engineer, designer, PM, security, ops, user, skeptic, data) for 1–3 rounds. Interactive between rounds.

### Orchestration patterns

Invoke directly or as flags on any command:

```
/loom-debate "Redis vs Postgres for sessions"
/loom-chain "draft auth API spec"
/loom-vote "best caching strategy" --candidates 3
/loom-triage "fix this production error"

/loom-plan create --debate "monolith vs microservices"
/loom-roadmap init --debate "build vs buy for auth"
```

### Session management

```
/loom-pause                     Snapshot state, WIP commit
/loom-resume                    Restore context, continue where you left off
/loom-next                      State-aware suggestion for next step
/loom do "review my code"       Natural language routing to the right command
/loom-status                    Project overview (test metrics + convergence + ctx budget)
```

## Agent Groups

| Group | Agents | Used by |
|-------|--------|---------|
| **Pre-flight** | prompt-refiner, questioner | `/loom-auto`, `/loom-roadmap init` |
| **Onboarding** | project-guidance, api-explorer, docs-auditor | `/loom-init` |
| **Strategy & UX** | strategy-agent, ux-agent | review pipelines |
| **Roadmap** | roadmap-builder, scope-feasibility, questioner | `/loom-roadmap init` |
| **Dual-track Planning** | plan-builder, criteria-planner, interpretation-reviewer, feature-coverage, phasing, parallelization, agentic-workflow, context-budget-reviewer | `/loom-plan create`, `/loom-plan review` |
| **Execution** | contracts, implementer, api-route-creator, api-connector, wiring, verification | `/loom-plan execute` |
| **Convergence** | convergence-planner, target-parser, harness-builder, criteria-harness-builder, delta-analyzer, convergence-driver | `/loom-converge` |
| **Testing** | acceptance-criteria, unit-test, integration-test, e2e-test-writer, e2e-runner, e2e-test, qa-review | `/loom-plan test`, `/loom-converge --criteria` |
| **Code Review** | security, architecture, plan-compliance + 6 built-in | `/loom-code review` |
| **Extended Review** | performance, accessibility, dependency-auditor, api-design, database-schema, infra, observability | `/loom-code review --full` |
| **Stage Teammates** | execute-stage, test-stage, review-stage, fix-stage, converge-stage | `/loom-auto` agent-team mode |
| **Architecture Debaters** | tech-stack-debater, migration-architect | debate/chain |
| **Wiki** | wiki-maintainer, wiki-ingest, wiki-lint, wiki-query | `/loom-wiki`, execution events |
| **Data** | data-lineage-tracker, data-pipeline-agent, data-quality-gate, data-schema-reviewer, data-test-generator | `/loom-data` |
| **Documentation** | docs-generator, docs-auditor, project-guidance | `/loom-init` |
| **Utility** | meta-agent, tdd-coach, bugfix-analyst, fixer-agent, auto-dispatcher | various |

## Orchestration Patterns

Available as direct commands (`/loom-debate`) or flags on any command (`--debate`):

| Pattern | Best for | How it works |
|---------|----------|-------------|
| **Debate** | Decisions with tradeoffs | Advocate + critic argue N rounds, moderator synthesizes |
| **Chain** | Progressive refinement | Draft → refine → harden pipeline |
| **Vote** | Critical implementations | N parallel solutions, evaluator picks best |
| **Triage** | Mixed-complexity work | Cheap router classifies, routes to specialist |
| **Converge** | Deterministic targets / scenarios | Iterative loop until delta = 0 or scenarios pass |

## Hooks (Deterministic Enforcement)

Thirteen Claude Code hooks enforce invariants at the tool-call level. Fail-open on missing state, fail-closed on schema-version mismatches.

| Hook | Event | What it does |
|------|-------|-------------|
| `file-ownership` | PreToolUse (Write/Edit) | Blocks writes outside the active task's file ownership boundary |
| `contract-lock` | PreToolUse (Write/Edit) | Locks `contracts/` after Wave 0 |
| `context-budget` | PreToolUse (Agent) | Estimates spawn prompt size, blocks if > `agentBudgetCap` (default 100k) |
| `budget-tracker` | PreToolUse + SubagentStop | Tracks agent count vs budget |
| `checkpoint-trigger` | (various) | Triggers stage-summary checkpoints at thresholds |
| `context-monitor` | (various) | Streams context state into the statusline |
| `deploy-guard` | PreToolUse (Bash) | Blocks destructive bash commands without explicit confirmation |
| `quality-gate` | Stop | Prevents premature pipeline stops |
| `typecheck-on-write` | PostToolUse (Write/Edit on .ts) | Runs `tsc` after TS writes, feeds errors back |
| `wiki-write-guard` | PreToolUse | Enforces wiki page format + cross-ref integrity |
| `wiki-impact-warner` | PreToolUse | Warns when code edits affect contract-page-tracked domains |
| `wiki-session-status` | SessionStart | Loads wiki context summary on session start |
| `wiki-commit-ledger` | PostToolUse | Records wiki-affecting commits for drift detection |

Plus three infrastructure scripts: `statusline-renderer.cjs` (pipeline + test metrics + convergence segments), `loom-update-checker.cjs` (background catalog version check, 4h throttle), and `status-updater.ts` (writes `status.toon` timestamps and ambient state on SubagentStop). Plus one test harness: `context-budget-test.ts`.

Register wiki hooks into `~/.claude/settings.json` via `scripts/register-wiki-hooks.ts`.

## Per-Project Extensibility

Create `.claude/orchestration.toml` in any project to register custom agents and configure model profiles:

```toml
[settings]
modelProfile = "balanced"    # quality | balanced | budget

[settings.contextBudget]
contextWindow = 200000       # set 1000000 for 1M sessions
checkpointWarning = 0.35
checkpointCritical = 0.25

[review.agents.hipaa-reviewer]
source = ".claude/agents/hipaa-reviewer.md"
model = "sonnet"
modes = ["default", "full"]
outputRole = "reviewer"

[execution.agents.migration-agent]
source = ".claude/agents/migration-agent.md"
model = "opus"
phase = "post-contracts"
outputRole = "producer"
```

Or `/loom-agent create` for an interactive flow.

**Model resolution** is 3-level: profile tier mapping (`quality`/`balanced`/`budget`) → agent frontmatter `model:` → inherit parent. The default tiering follows the principle *opus for decisions, sonnet for generation, haiku for plumbing*.

## Wiki Maintenance

The project wiki (`.loom/wiki/`) stays current automatically at state-change points.

| Trigger | What's captured |
|---------|-----------------|
| `/loom-roadmap` (after write) | Strategic intent, features, milestones, constraints |
| `/loom-plan create` (after validation) | Architecture, schemas, scenarios, phase structure |
| `/loom-plan execute` (after each wave) | Contracts, implementation decisions, files built |
| `/loom-plan materialize` (after milestone) | Per-domain `contract-*` pages |
| `/loom-change archive` | Mutations applied; History entry appended per page |
| `/loom-code fix` (after verification) | Applied fixes, unfixable items as design constraints |
| `SessionStart` | Wiki summary loaded via `wiki-session-status` hook |

Manual: `/loom-wiki ingest`, `/loom-wiki lint`, `/loom-wiki query "question"`.

## Data Formats

- **TOON** (Token-Oriented Object Notation) for all on-disk artifacts and agent communication — token-efficient, structured, machine-diffable. Spec at `agents/protocols/toon-format.md`. ~30–60% smaller than JSON for typical Loom payloads.
- **JSON** for AJV schema validation tests only.
- **Markdown** for plans, roadmaps, and wiki pages; TOON appears as fenced blocks inside.

## Persistence

- `.loom/wiki/` — persistent knowledge base: wiki pages (including `contract-*`, `assumption-*`), index, operation log (git-tracked)
- `.loom/changes/` — per-change-proposal directories (git-tracked)
- `.plan-execution/` — execution state, scope contract, stage summaries (selectively git-tracked; `ephemeral/` is gitignored)
- `planning/history/` — reviews, decisions, explorations, wave summaries, milestones (git-tracked)

## Tests

```bash
# Root suite (scenarios, change validators, contract-page drift, e2e)
bun install && bunx vitest run

# Protocol tests
(cd test/protocol && bun install && bunx vitest run)

# Hook tests
(cd hooks && bun install && bunx vitest run)
```

`bun` is preferred for speed; `npm install && npx vitest run` works as a fallback.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch + commit conventions, the local-dev install pattern, and how to run the test suites.

After cloning, run once to enable the integrity-protection git hooks:

```bash
scripts/install-hooks.sh
```

This sets `core.hooksPath = scripts/git-hooks`. The pre-commit hook auto-regenerates `checksums.sha256` whenever you stage a file the manifest tracks (`hooks/*`, `commands/*`, `config/*`, `skills/library.yaml`). `install.sh` validates downloaded files against this manifest on cold install — drift would break every fresh install. The hook closes that window locally; the `checksums` CI workflow is the safety net for contributors who skip the install step.

To regenerate manually:

```bash
scripts/generate-checksums.sh        # rewrite checksums.sha256 in place
scripts/verify-checksums.sh          # exit 1 if drift; suggests the fix
```

## Acknowledgments

The wiki system and behavioral-guidelines draw from Andrej Karpathy's observations on LLM failure patterns. The change-proposal lifecycle is inspired by OpenSpec; Loom departs from it by treating scenarios as enforcement gates rather than documentation. See [docs/design-philosophy.md](docs/design-philosophy.md).

## License

[Apache 2.0](LICENSE)

## File Structure

```
agents/                      67 agent definitions + 5 stage teammates
  protocols/                 48 protocol files (31 schemas + 17 supporting docs)
  stage-teammates/           Stage-teammate agents for /loom-auto agent-team mode
commands/                    29 top-level files (12 noun-grouped roots + /loom dispatcher + subcommand verbs)
  loom-plan/                 5 subcommand decomposition files
  loom-roadmap/              6 subcommand decomposition files
  loom-plan/materialize.md   Contract-page materializer
hooks/                       17 files: 13 enforcement + 3 infrastructure + 1 context-budget test harness
  lib/                       Shared harness, TOON reader, context resolver, change paths, spec validators
  __tests__/                 Hook tests (ambient-state, statusline, wiki-impact, wiki-session, register-wiki-hooks, …)
skills/library.yaml          Catalog (104 entries: commands, agents, protocols, kits)
docs/                        scenarios-and-changes, scenarios-authoring-template,
                             version-cadence, design-philosophy
scripts/                     verify-release.sh, register-wiki-hooks.ts, loom-change/*
.github/workflows/           cosign-spike (release signing validation)
install.sh / uninstall.sh    Curl-friendly bootstrap (gh api fallback)
test/protocol/               Protocol tests
test-fixtures/               Test plan + contract-page + spec-upgrades fixtures
.loom/wiki/                  Persistent knowledge base (git-tracked)
.loom/changes/               Change-proposal directories (git-tracked)
```

---
roadmapVersion: 1
name: "Fable Readiness — Capability-Gated Discipline Profiles"
status: proposed
created: 2026-07-09
lastReviewed: 2026-07-09
targetDate: null
totalFeatures: 8
totalMilestones: 4
---

# Roadmap: Fable Readiness — Capability-Gated Discipline Profiles

## Vision

Loom was built on the thesis that LLMs drift, so discipline must live outside the model — in hooks, state files, and enforced protocols. That thesis remains correct for **guarantees** (deploy-guard blocking a push to main is insurance no model quality removes) and for **knowledge** (the wiki, change proposals, and scenarios solve an engineering-artifact problem, not a capability problem). But a large fraction of Loom by weight is **compensation** — for weak context management, unreliable delegation, lossy sessions, and orchestrator models that needed micromanaging. The modern Claude Code harness solves most of those natively (Workflow tool with deterministic loops/budgets/resume, worktree isolation, schema-validated structured output, automatic context summarization), and Fable-class models sharpen the rest.

This roadmap does NOT create a "Fable version" of Loom. It restructures Loom into three layers with different lifecycle rules and adds a **single capability-gated discipline profile** so the same codebase serves a strict legacy environment and a minimal Fable-class environment without forking:

- **loom-core** (always on): deterministic safety hooks + the durable knowledge layer. Model-independent; ages well.
- **loom-engine** (always on, re-platformed): convergence loop, wave execution, tier routing — ported from markdown state machines interpreted by the main session to executable Workflow scripts. True determinism instead of prompt-following.
- **loom-scaffold** (profile-gated, deprecation track): context-budget caps, checkpoint/pause machinery, budget-tracker, rolling-context compression, heartbeats, the TOON mandate. Off by default on modern harnesses; available for old ones.

Two framing insights lock the design. First, **most of the strip-down does not wait for Fable** — Workflow, worktrees, structured output, and auto-compaction ship with Claude Code today and work with Opus/Sonnet, so the port starts now. Second, **model detection is the wrong axis** — Loom deliberately runs Haiku on fixers and sweeps even when the session model is frontier-class, so per-agent discipline keys off the *subagent's tier*, and session-level discipline keys off *probed harness capabilities*, never off a model-name string.

### Positioning

This is a platform-survival initiative, not a feature. Without it, Loom's scaffold actively fights modern harnesses (spawn-cap hooks blocking legitimate spawns, Stop-gates conflicting with turn management, mandated envelopes and diagnose-logs consuming context on models that don't need them) and the value proposition erodes with every model release. With it, Loom's durable 40% — tool-call-level guarantees and the knowledge layer — is unbundled from its depreciating 60%, and Fable availability becomes a config value, not a launch.

A comparative analysis against peer harnesses (CT6, GSD, OpenSpec, gstack — 2026-07-09) confirms the layer model and sharpens it: the industry-converged consensus (OpenSpec at ~60k stars) is that the *knowledge layer* is the part everyone agrees on; CT6 contributes the strongest remaining *guarantee* ideas (completion re-validation, adversarial refutation, map-grounded planning); GSD contributes the goal-backward verification lens; gstack demonstrates that taste/judgment belongs in a coexisting layer, not in Loom. Decisions C-07 and C-08 encode the consequences.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Single conditional seam | Zero hooks or agents contain model-name or profile-branching logic beyond reading one resolved flag | Grep hooks/ and agents/ for model-name strings and profile conditionals; only the doctor resolver and the shared `discipline.ts` lib match |
| No-surprise migration | Existing installs resolve to `strict` and produce byte-identical hook behavior | Full vitest suite passes unchanged with `profile = strict`; fixture transcript comparison shows zero behavioral diff |
| Scaffold silence under `minimal` | Scaffold hooks emit zero prompt injections and zero blocks in a `minimal`-profile session | Fixture session trace: count injected `[loom:*]` messages from scaffold hooks; must be 0 |
| Engine determinism | Convergence loop logic exists only in executable script form; no markdown loop remains authoritative | Grep protocols/ and agents/ for `for iteration` / `while iteration` loop specs; only the Workflow/TS driver matches. Markdown fallback explicitly marked `fallback` |
| Circuit-breaker parity | Ported engine preserves all breakers (stall, regression, budget, max-iterations, scope-expansion) and `--resume` | Fixture convergence runs triggering each breaker exit with the same `haltReason` values as the markdown driver produced |
| Per-agent tier override | A haiku-tier spawn under `minimal` profile still gets file-ownership enforcement | Fixture: haiku-tier implementer writes outside its boundary under `minimal`; hook blocks |
| TOON freeze | Zero new TOON conversions after freeze date; new schemas accepted in JSON | Repo diff review on new schema files; CLAUDE.md conversion mandate removed |
| Protocol corpus reduction | ≥ 40% reduction in engine-related protocol/command markdown lines after M-2 | Line count of retired vs. retained files in protocols/ and commands/ tagged `engine` |
| Self-certification impossible | An agent declaring completion while any acceptance criterion fails on independent re-run is blocked, under every profile including `minimal` | Fixture: run with a deliberately failing criterion and a "done" claim; re-validation stop-gate must block with the failing criterion named |
| Shape is model-chosen, caps are script-enforced | No engine script hardcodes reviewer count / fan-out breadth; every script enforces breaker + budget caps regardless of chosen shape | Grep engine scripts for fixed fan-out literals; fixture run where the model requests shape exceeding caps is clamped |
| Goal-backward convergence | A fixture where all tasks complete but a promised behavior is unwired fails convergence | Fixture: completed-tasks-with-missing-wiring; convergence must report the gap, not pass |

## Constraints & Decisions

### C-01: Capability-gated, not model-gated
**Decision:** The discipline profile resolves from probed harness capabilities (harness version, Workflow tool availability, context window size, auto-compaction support) plus an explicit user pin — never from a model-name string.
**Rationale:** The features that obsolete the scaffold are harness features available across models today. Model names churn; capabilities are testable. A session-level "Fable mode" would also wrongly strip guards from the haiku-tier subagents Loom deliberately uses.
**Alternatives considered:** Detect model from hook stdin metadata (rejected — couples to unstable identifiers, wrong axis). Separate Fable fork/branch (rejected — doubles maintenance, delays value that current models can already realize).
**Impact:** high

### C-02: One resolution seam
**Decision:** `/loom-doctor` (and SessionStart migration hook) probes capabilities once and writes the resolved profile to `.claude/orchestration.toml` under `[settings.discipline]`. Every hook reads that single flag via a shared `hooks/lib/discipline.ts` helper and self-bails early. No hook performs its own detection.
**Rationale:** Fourteen-plus hooks each internally checking "what mode am I in?" doubles the test matrix and rots. One writer, many readers keeps the conditional surface at a single audited seam. Doctor already owns install-health probing.
**Alternatives considered:** Per-hook env vars (rejected — already partially exists as `LOOM_SKIP_*` and is unmanageable at profile scale). Runtime detection in each hook (rejected — N implementations drift).
**Impact:** high

### C-03: Three kits via the existing library system
**Decision:** Split the catalog into `loom-core`, `loom-engine`, `loom-scaffold` kits in `skills/library.yaml`, using the existing typed `includes:` mechanism. Core is mandatory; engine is default; scaffold installs only under `strict`.
**Rationale:** The kit system is Loom's native packaging and already supports per-project registration; no new distribution mechanism needed. The split makes the deprecation track legible — scaffold membership IS the deprecation list.
**Alternatives considered:** Keep one monolithic install with runtime gating only (rejected — dead files still ship, update surface stays large). New plugin variants (rejected — three marketplace entries to explain).
**Impact:** medium

### C-04: Engine ports to Workflow scripts with markdown fallback
**Decision:** The convergence loop and wave execution re-platform onto executable Workflow scripts (extending the direction already established by `scripts/roadmap-converge/driver.ts`, `test-harness.ts`, `debug-harness.ts`). The markdown state-machine drivers remain as an explicitly-labeled fallback for harnesses without the Workflow tool, and are frozen (bugfix-only).
**Rationale:** Loom's central irony is that its orchestrator is the main session following ~75 markdown protocol files — a state machine enforced by prompt-following, the very mechanism Loom distrusts. Workflow scripts give actual determinism, plus resume, budget accounting, and concurrency caps for free. The newest Loom code was already migrating this way.
**Alternatives considered:** Keep markdown drivers authoritative and treat Workflow as an optimization (rejected — two authoritative loops diverge; the markdown one is the weaker artifact). Big-bang delete of markdown drivers (rejected — strands non-Workflow harnesses).
**Impact:** high

### C-05: TOON is frozen, not migrated
**Decision:** Stop the "convert JSON you find to TOON" mandate immediately. New schemas and agent envelopes may use JSON with schema validation (Workflow `agent(schema)` structured output where available). Existing TOON artifacts stay as-is; no conversion project.
**Rationale:** TOON's token-savings case is superseded by schema-validated structured output and cheaper long context, and a bespoke notation every agent must be taught is friction. But a migration would churn every state file and schema for near-zero user value. Stop digging; don't refill the hole.
**Alternatives considered:** Full JSON migration (rejected — high-churn, low-value, breaks resume compatibility for in-flight executions). Keep the mandate (rejected — negative-value work compounds).
**Impact:** medium

### C-06: Existing installs default to `strict`
**Decision:** Profile resolution for an already-installed project defaults to `strict` (today's behavior) until the user runs `/loom-doctor --resolve-profile` or pins a profile. Fresh installs default to `auto`.
**Rationale:** Nothing changes out from under existing users; opting into `standard`/`minimal` is a deliberate act with a doctor report explaining what turns off.
**Alternatives considered:** Auto-upgrade everyone on next update (rejected — silent behavior change in an enforcement product is a trust violation).
**Impact:** medium

### C-07: Engine scripts are parameterized scaffolding, not fixed shapes
**Decision:** Workflow engine scripts own loop mechanics, circuit breakers, state persistence, and budget enforcement. They do NOT hardcode decomposition shape — reviewer counts, fan-out breadth, pass structure, and integrator choice are parameters the session model selects within script-enforced caps.
**Rationale:** A script mandating "6 reviewers, 3 integration passes" encodes yesterday's best decomposition and constrains a Fable-class model exactly where its judgment now exceeds the script author's. The constraint that keeps runs safe is the breaker and the budget, not the shape. This is the difference between scaffolding the model invokes and a cage it runs inside.
**Alternatives considered:** Fully fixed pipelines (rejected — over-constrains strong models, the core failure mode this roadmap exists to eliminate). Fully model-chosen orchestration with no script (rejected — loses deterministic breakers/resume, regresses to prompt-following).
**Impact:** high

### C-08: Integrate the upstream CT6 Track A ports into the layer model; do not re-implement them
**Decision:** The CT6 Track A guarantees (acceptance re-validation stop-gate replacing the stage-based `quality-gate`, git-HEAD map-freshness precondition on `/loom-plan create` and `/loom-converge`, adversarial-reviewer role, spec→coverage matrix with bounded per-gap fixes) are **owned and implemented by the upstream repo maintainer**, who has authored a detailed CT6→Loom port plan (execution not yet started as of 2026-07-09). This roadmap's responsibility is integration, not implementation: (1) reserve their slots in the layer model — stop-gate and map-freshness gate in `loom-core` (all profiles, including `minimal`), adversary and coverage matrix in `loom-engine`; (2) wire each ported hook through the single discipline seam (`hooks/lib/discipline.ts`) as it lands, so C-02 holds; (3) if a port has not landed when the dependent milestone reaches it, the slot ships empty with a documented dependency — we do not fork ahead of the maintainer. The one item this roadmap DOES implement itself: GSD-style **goal-backward verification** (does the artifact deliver what the phase promised, not "did tasks complete") as a standard convergence criterion — it is not part of the upstream CT6 port.
**Rationale:** These guarantees target the failure modes that remain even for strong models under long autonomy — self-certification, ungrounded plans, coverage gaps — and belong in the appreciating layers. But two parallel implementations in the same hook files (Stop hook, hooks/lib, orchestration.toml) is guaranteed merge conflict and possible behavioral divergence in an enforcement product. Upstream owns the guarantees; this roadmap owns the profile architecture they plug into.
**Alternatives considered:** Implement Track A inside this roadmap (rejected — collides with the maintainer's in-flight port). Ignore the ports and classify later (rejected — the layer table and discipline seam must anticipate them or the maintainer's hooks land ungated). Keep quality-gate as a thin stage check (rejected — completion re-validation is the highest-leverage guarantee available and is not superseded by native turn management).
**Impact:** high

**Coordination surface (flag in the roadmap PR):** the Stop hook, `hooks/lib/`, and `orchestration.toml` are touched by both initiatives. The roadmap PR should propose sequencing: profile seam (M-1) lands first so the maintainer's Track A hooks can adopt `discipline.ts` on arrival, rather than retrofitting.

## Discipline Profile Specification

```toml
[settings.discipline]
profile = "auto"   # auto | strict | standard | minimal
# auto: doctor probes capabilities at init/session-start and writes `resolved = "..."`
# strict:   core + engine(markdown fallback) + scaffold — today's Loom
# standard: core + engine(Workflow) — scaffold off; current Claude Code + Opus/Sonnet
# minimal:  core only for session-level discipline; engine trusts native Workflow entirely

[settings.discipline.tierOverrides]
# per-agent-tier floors, applied regardless of session profile
haiku = "standard"   # cheap-tier subagents keep file-ownership + contract-lock enforcement
```

Layer membership (authoritative list maintained in `skills/library.yaml`):

| Layer | Members |
|---|---|
| core | deploy-guard, typecheck-on-write, shellcheck-on-write, bash-portability-on-write, pylint-on-write, contract-lock, file-ownership (tier-gated), **acceptance re-validation stop-gate** (evolved quality-gate, C-08), **map-freshness gate** (fail-closed precondition on plan/converge, C-08), wiki system (pages, change proposals, execution log, freshness ledger), scenarios + coverage schemas |
| engine | convergence driver (Workflow, parameterized per C-07), wave execution (Workflow), tier routing, wiring/verification agents, **adversarial-reviewer**, **spec→coverage matrix with bounded per-gap fixes**, **goal-backward verification criterion** (C-08) |
| scaffold | context-budget, budget-tracker, context-monitor, checkpoint-trigger, wiki-impact-warner throttle machinery, rolling-context compression, heartbeat/status files, pause/compact/resume choreography, TOON conversion mandate, manual model-resolution ritual |

## Milestones

### M-1: Discipline profile + kit split
Config plumbing (`[settings.discipline]`, shared `discipline.ts` reader, doctor probe + `--resolve-profile`), three-kit split in `library.yaml`, hook self-bail wiring, tier-override floors, `strict`-default migration for existing installs. Exit: metrics "single conditional seam", "no-surprise migration", "per-agent tier override" pass.

### M-2: Engine port to Workflow + Track A integration
Convergence loop first (all three modes on the uniform harness contract, parameterized shape per C-07), then wave execution (Wave-0 contracts, parallel implementers via worktree isolation where available, serial wiring/verification). Track A integration per C-08: wire the maintainer's ported gates through the discipline seam as they land and slot them into the layer table; implement goal-backward verification as a convergence criterion (ours). Markdown drivers labeled `fallback`, frozen. Exit: metrics "engine determinism", "circuit-breaker parity", "protocol corpus reduction", "shape is model-chosen", "goal-backward convergence" pass; "self-certification impossible" passes if the upstream stop-gate has landed, else recorded as a blocked dependency.

### M-3: Scaffold deprecation
Scaffold off under `standard`/`minimal`; TOON freeze applied (CLAUDE.md mandate removed, JSON accepted for new schemas); deprecation notes in each scaffold component pointing at the native replacement. Exit: metric "scaffold silence under minimal" and "TOON freeze" pass.

### M-4: Fable validation (blocked on model access)
Dogfood `minimal` on real Fable-class sessions against 2–3 representative pipelines; flip fresh-install `auto` resolution to prefer `minimal` where capabilities warrant; publish a doctor report template explaining per-profile behavior. Exit: minimal-profile pipeline runs complete with zero scaffold interventions and no quality regression vs. `strict` baseline on the same fixtures.

## Out of Scope

- No TOON→JSON migration of existing artifacts (C-05).
- No removal of the markdown fallback drivers until a full deprecation cycle after M-4.
- No changes to install.sh semantics, checksum flow, or marketplace packaging beyond adding kit entries.
- No new user-facing commands; the profile is doctor/config surface only.
- No multi-model routing redesign — tier routing logic ports as-is; improving it is a separate initiative.
- No wiki/change-proposal ceremony slimming — worth doing, separate roadmap (OpenSpec's delta-merge lifecycle is the design reference when that roadmap happens).
- No taste/judgment layer — persona reviews, learnings memory, and cross-model second opinions are gstack's territory; Loom coexists with it rather than growing its own.
- No CT6 abundance mechanics — unbounded solving loops, 1M-context teammates, and daemon-backed memory (MemPalace) remain excluded per the port plan's own rule; only Track A guarantees come in (C-08).

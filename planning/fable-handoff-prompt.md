# Handoff Prompt — Fable Readiness Initiative

Paste the block below into a fresh session in the Loom repo to hand the initiative to a Fable-class (or Opus-class) agent.

---

## Mission

You are working in the Loom repo (`loom-ai`). Execute the **Fable Readiness** initiative: restructure Loom into capability-gated discipline layers so its durable value (deterministic safety hooks, the knowledge layer) is unbundled from its depreciating scaffold (context/orchestration compensations that modern harnesses provide natively).

Read `planning/ROADMAP-fable-readiness.md` first. It is the authoritative plan: vision, layer membership table, profile spec, C-01..C-08 locked decisions (plus proposed C-09+ implementation decisions logged as work proceeds), milestones M-1..M-4, and out-of-scope list. Honor the locked decisions; if you believe one is wrong, stop and surface the disagreement with evidence rather than silently deviating. Also read `CLAUDE.md`, `CONTEXT.md`, `planning/ct6-to-loom-port-plan.md` (vendored copy of the CT6→Loom port plan; its Track A executes inside this roadmap per C-08, its Tracks B2/C ports are separate), and skim `protocols/execution-conventions.md` before touching code.

## Goal

Ship M-1 through M-3 (M-4 is blocked on Fable model access):
1. **M-1** — `[settings.discipline]` profile with a single resolution seam (doctor writes, `hooks/lib/discipline.ts` reads, hooks self-bail), three-kit split (`loom-core` / `loom-engine` / `loom-scaffold`) in `skills/library.yaml`, per-tier override floors, `strict` default for existing installs.
2. **M-2** — port the convergence loop (all three modes) and wave execution to executable Workflow/TS scripts with model-chosen shape inside script-enforced caps (C-07); land the Track A guarantees (C-08): acceptance re-validation stop-gate replacing quality-gate, map-freshness precondition on plan/converge, adversarial-reviewer + coverage matrix as default convergence participants, goal-backward verification criterion; freeze and label the markdown drivers as `fallback`.
3. **M-3** — scaffold gated off under `standard`/`minimal`; TOON mandate removed from CLAUDE.md; deprecation notes in every scaffold component pointing at the native replacement.

## What "good" looks like

Target the Success Metrics table in the roadmap — they are the acceptance criteria. The load-bearing ones:
- **One seam:** grep of `hooks/` and `agents/` finds no profile/model conditionals outside the doctor resolver and `discipline.ts`.
- **No surprise:** the full vitest suite passes unchanged under `profile = strict`; a `strict` fixture run is behaviorally identical to today.
- **Silence under minimal:** zero scaffold prompt-injections/blocks in a `minimal` fixture session.
- **Determinism with parity:** loop logic exists only in executable form; every circuit breaker (stall, regression, budget, max-iterations, scope-expansion) and `--resume` reproduce the markdown driver's `haltReason` semantics on fixtures.
- **Tier floors hold:** a haiku-tier agent writing outside its file boundary is blocked even under `minimal`.
- **Self-certification impossible:** an agent declaring done while an acceptance criterion fails on independent re-run is blocked under every profile, including `minimal`.
- **Scaffolding, not cage:** no engine script hardcodes reviewer counts or fan-out breadth; breakers and budget caps are enforced regardless of the shape the model chooses.
- **Goal-backward holds:** a fixture where all tasks complete but a promised behavior is unwired must fail convergence.
- Every new behavior has a vitest test; every removed behavior has a deprecation note. Quality bar: this is an enforcement product — a hook that silently stops enforcing is worse than no change at all.

## Scope

**Included:** hooks/ (gating wiring, `discipline.ts`), scripts/ (doctor probe, Workflow drivers, migration), skills/library.yaml (kit split), protocols/ (retire/label engine markdown, add discipline schema), commands/ (doctor `--resolve-profile`, engine command updates), agents/ (engine agent prompt updates), CLAUDE.md (TOON mandate removal), tests/fixtures, planning/ (keep the roadmap's lastReviewed + decision log current as you work).

**Excluded — do not touch:** TOON→JSON migration of existing artifacts; deleting markdown fallback drivers; install.sh / checksums / marketplace packaging semantics; new user-facing slash commands; multi-model routing redesign; wiki/change-proposal ceremony changes; anything in the user's `~/.claude` outside this repo's install targets.

## Autonomy

**Do without asking:** read anything in the repo; create/edit code, tests, fixtures, and docs within scope; run bun/vitest/shellcheck/tsc; create feature branches (`fable-readiness/m1-*` etc.); commit incrementally with clear messages; open draft PRs targeting `main`; update the roadmap's decision log with new C-NN entries for choices the plan left open (mark them `proposed`).

**Stop and ask:** merging or pushing to `main`; any change that alters behavior for existing `strict` installs; changing a locked C-NN decision; expanding scope into an excluded area; deleting any file that ships to user machines; anything touching release/versioning.

**Never:** force-push; rewrite published history; disable or weaken a core-layer safety hook to make a test pass; mark a milestone done with failing or skipped tests.

**Working agreement:** work milestone-by-milestone; within a milestone, verify continuously (typecheck + targeted tests per change, full suite before declaring a milestone done). If a fixture or protocol contradicts the roadmap, surface it — don't guess. If stuck for more than ~3 attempts on the same failure, write up the diagnosis and stop rather than thrash. At each milestone boundary, produce a short summary: what shipped, metric status, open questions, and the exact command to verify.

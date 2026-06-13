# How Loom Compares

The projects Loom most resembles or borrows patterns from. **Loom is not a competitor to framework-level orchestrators** (CrewAI, AutoGen, LangGraph) — those build agents from scratch. Loom is a *discipline layer* on top of Claude Code's native agents, hooks, and skills.

| Capability | **Loom** | OpenSpec | Superpowers | GSD |
|---|---|---|---|---|
| Primary surface | Discipline layer on Claude Code | Spec workflow | Behavioral patterns / plugin | Multi-platform discipline layer |
| Pre-flight scope contract | Yes — prompt-refiner + scope-interrogator → locked decision manifest before code | — | — | Phase-based discussion (different shape) |
| Scenarios (Given/When/Then) | First-class **enforcement** — convergence-planner emits targets from scenarios; pipeline blocks until they pass | First-class **documentation** | — | — |
| Iterative convergence loop | Yes — iterate until delta = 0 or all blocking scenarios pass | — | — | Phase-by-phase, single-pass per phase |
| Wave-based parallel execution + file ownership | Yes — Wave 0 contracts → parallel implementers within ownership boundaries | — | — | Sequential by default |
| Hook-enforced invariants (tool-call level) | 13 hooks: file-ownership, contract-lock, context-budget, quality-gate, wiki integrity, … | — | Pattern-level prompts | Prompt-level, no hook enforcement |
| Change-proposal lifecycle (post-launch maintenance) | Tool-driven: `init → review → approve → run → archive`, validation gates only | Same shape, documentation-grade | — | — |
| Per-domain `contract-*` wiki pages (materialized spec) | Yes — atomic per-domain delta application | Spec files (different layout) | — | Persistent docs (different model) |
| Multi-agent orchestration patterns (debate / chain / vote / triage / converge) | Five patterns, declared in `orchestration.toml`, available as commands or flags | — | — | — |
| Context budget discipline (per-spawn cap + stage summaries) | 100k cap, fail-closed on schema mismatch | — | — | — |
| Multi-platform | Claude Code today; OpenCode + Pi planned (M-04, BLOCKED on opencode#5894) | Claude Code | Claude Code | Claude Code + OpenCode + Goose + Codex (wide and shallow) |
| Approval model | Tool-driven (validators block, no human queues) | — | — | — |
| TDD red-green gate | Yes — adopted from Superpowers (C-06) | — | **Originator** | — |
| Diagnose-before-fix | Yes — adopted from Superpowers (C-06) | — | **Originator** | — |

## Borrowed patterns

Loom does not redistribute these projects — it adopts shapes:

- **OpenSpec** — the `init → review → approve → run → archive` change-proposal shape (planning/archive/PLAN-spec-upgrades.md, Upgrade B). Loom departs by making scenarios enforcement gates rather than documentation.
- **Superpowers** — strict red-green TDD gate, diagnose-before-fix, hard verification gate in `AgentResult` (ROADMAP C-06 / F-07). Loom does not adopt Superpowers' orchestration, planning, or dispatch.
- **BMAD** — change-management *shape*, but Loom is explicitly tool-driven (validation gates only), not role-driven (no human approval queues).

## Not in the same category

- **CrewAI, AutoGen, LangGraph** — frameworks for building agent systems from scratch. Loom assumes Claude Code already exists and adds discipline on top.
- **Aider, Cursor, Cline** — IDE-integrated coding agents. Loom runs *inside* Claude Code rather than competing with it.

## When Loom is the wrong choice

- **Throwaway scripts, one-off proofs of concept.** The ceremony (scope contract, wiki, scenarios) is worse-than-nothing for ten-minute experiments.
- **Solo learning projects with no real users.** The change-proposal lifecycle is overhead unless you actually need to maintain a spec.
- **You haven't installed Claude Code yet.** Loom is a layer; it needs the substrate.

## When Loom is the right choice

- You've watched Claude Code drift past your intent on an ambiguous prompt and want guardrails that *block* drift instead of asking for it not to happen.
- You want parallel agents that don't fight over the same files.
- You're maintaining something past the initial build and want the spec to keep converging.
- You've been burned by "tests passed but the wrong thing shipped" — scenarios make that harder.

# Design Philosophy

Loom is a **discipline layer on top of Claude Code**. The shape of that discipline is best understood through the four pillars below — each one a response to a specific failure mode Loom keeps seeing in agent-driven coding.

If you're new, read [`concepts.md`](./concepts.md) first — this document is the *why* behind the *what*.

---

## Pillar 1 — Pre-flight scope contract

**The failure mode.** Loose prompts get loose interpretations. When you say "add auth," there are five reasonable ways to interpret it (session-based vs. JWT vs. OAuth, RBAC vs. simple, with/without password reset, etc.) — and the agent will pick one silently. By the time you notice, the wrong shape is already wired through your codebase.

**Loom's answer.** Two agents run *before any code is written*:

1. **Prompt Refiner** scans the codebase and expands the loose prompt into a structured brief.
2. **Scope Interrogator** poses *proposal-based decisions* — each decision presents 2–3 concrete options with code examples and implied acceptance criteria. Brownfield-aware: it references existing code ("Your codebase already has JWT middleware at `src/middleware/auth.ts`…").

The output is `scope-contract.toon` — decisions, assumptions, non-goals, testable criteria. **Every downstream agent reads it.** Reviewers tag findings `[CONTRACT]` when something drifts.

**The point.** Ambiguity gets resolved *by the human*, *up front*, *visibly*. Not silently, deep in a wave 3 implementer's choice.

---

## Pillar 2 — Scenarios drive convergence

**The failure mode.** "All tests pass" and "the right thing shipped" are not the same statement. Tests written after the code reflect what the code does, not what the spec demands. Tests written as documentation rarely get enforced.

**Loom's answer.** Scenarios are first-class:

- Given/When/Then blocks live under each roadmap feature and plan phase.
- The **criteria-planner** runs in parallel with the plan-builder and consumes the same roadmap independently — neither reads the other's output. An **interpretation-reviewer** then cross-references the two and surfaces conflicts before any code is written.
- The **convergence-planner** emits verification targets directly from scenarios.
- The pipeline **blocks** until all blocking scenarios pass.

The 4-tier model (unit / integration / e2e / qa-review) maps to the planning hierarchy (wave / phase / feature / milestone). Tier resolution is automatic from `whenTriggerType` and tags, with explicit `testTier` always overriding.

**The point.** Scenarios are not documentation. They are the canonical leaf-level testable unit, and the only way to be "done" is to make them pass.

---

## Pillar 3 — Hook-enforced discipline

**The failure mode.** Multi-agent tools rely on prompts to enforce boundaries: "please don't edit files outside your scope," "please don't modify contracts after Wave 0." Prompts don't enforce anything — they suggest. The moment an agent's reasoning chain has a good-enough reason to break the rule, it breaks the rule.

**Loom's answer.** Thirteen Claude Code hooks block at the **tool-call level**:

| Hook | What it blocks |
|---|---|
| `file-ownership` | Writes outside the active wave's file boundary |
| `contract-lock` | Edits to `contracts/**` after Wave 0 |
| `context-budget` | Agent spawns whose prompts would exceed the 100k cap |
| `budget-tracker` | Agent spawns past the pipeline's total budget |
| `quality-gate` | Premature pipeline stops mid-stage |
| `deploy-guard` | Force-pushes, direct pushes to main, production deploys |
| `wiki-write-guard` | Non-wiki agents writing to `.loom/wiki/` during execution |
| `typecheck-on-write` | (informational) reports TS errors after writes |
| `wiki-impact-warner` | (informational) warns when edits affect contract pages |
| `wiki-commit-ledger` | (informational) tracks wiki impact in commits |
| `wiki-session-status` | (informational) surfaces wiki freshness at session start |
| `checkpoint-trigger` | (informational) suggests context checkpoints at thresholds |
| `context-monitor` | (informational) streams context state to statusline |

The point is **the enforcement is mechanical**. The agent cannot reason its way past a hook. The hook reads the tool call's parameters and either returns "allowed" or "blocked" with a specific message — described in [`troubleshooting.md`](./troubleshooting.md).

**Failure mode addressed.** "The agent decided" stops being a thing that can break invariants. Either the rule is enforced by a hook or it isn't a rule.

---

## Pillar 4 — Change-proposal lifecycle

**The failure mode.** Initial materialization is the easy part. The spec drifts after launch — features change, requirements get reinterpreted, scenarios get manually edited and forgotten. By month six, the spec is a fossil that no longer reflects reality and nobody trusts it.

**Loom's answer.** When a milestone completes, `/loom-plan materialize` emits per-domain `contract-*` wiki pages. From that moment on, those pages are **not edited directly** — they flow through a lifecycle:

```
/loom-change init "Add refund flow to billing"
/loom-change review chg-20260520-add-refund-flow
/loom-change approve chg-20260520-add-refund-flow
/loom-change run chg-20260520-add-refund-flow
/loom-change archive chg-20260520-add-refund-flow
```

`archive` is the moment of atomic truth: it applies per-domain `DeltaBlock`s, refreshes the wiki index, appends a History entry, and runs supersession scans. Manual edits between archives are caught by a **content-checksum drift validator** surfaced through `/loom-wiki lint`.

For small one-off work, `/loom-quick` auto-emits a retroactive `quick-archive` proposal so contract pages stay coherent without ceremony.

**The point.** The spec is a living document that keeps converging post-launch. The lifecycle gates that convergence so it stays trustworthy.

---

## Karpathy-inspired behavioral guidelines

The four pillars are the systems-level discipline. There's a parallel agent-level discipline — drawn from Andrej Karpathy's observations on how LLMs fail at coding — that shapes every Loom agent's behavior.

(`agents/protocols/behavioral-guidelines.md`)

Four guardrails every agent follows:

1. **Surface assumptions instead of guessing silently** — when an agent encounters ambiguity, it records the assumption explicitly rather than making a quiet choice that downstream agents can't see.
2. **Implement exactly what's specified** — no speculative abstractions, no "while I'm here" improvements. The scope contract defines what gets built.
3. **Make surgical changes that match existing style** — agents read surrounding code before writing, preserving conventions rather than imposing new ones.
4. **Verify against acceptance criteria before claiming done** — the scope contract's testable criteria are checked, not just "does it compile."

These guardrails are described in agent system prompts and enforced both by hooks (when possible) and by reviewers tagging violations during code review.

### Persistent wiki

(`.loom/wiki/`)

A project knowledge base that agents read and write, ensuring decisions survive across sessions and context windows. When an agent makes an architectural choice in Wave 2, agents in Wave 5 can find it in the wiki rather than re-inferring (and potentially contradicting) it.

The wiki is Loom's answer to the "agents don't remember what they decided" problem — context that compounds rather than evaporates.

---

## What Loom is not

- **Not a framework.** Loom doesn't build agents from scratch — it composes Claude Code's native agents, hooks, and skills.
- **Not a methodology.** Every behavior is a swappable resource (agent, prompt, protocol, skill, infrastructure) registered per-project. See README's "Extending Loom" section.
- **Not a single opinionated pipeline.** The five orchestration patterns (debate, chain, vote, triage, converge) and per-project `orchestration.toml` mean you assemble what your domain needs.

For comparison against adjacent tools (OpenSpec, Superpowers, GSD, CrewAI, Aider, Cursor), see [`comparison.md`](./comparison.md).

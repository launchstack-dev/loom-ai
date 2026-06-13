# Five Concepts You Need Before Anything Else

Loom has a big surface area (41 commands, 67 agents, 13 hooks). You do not need to learn all of it. You need to internalize **five concepts**, after which the commands stop looking arbitrary and start looking like verbs over the same five nouns.

Read this once. ~5 minutes. Then go run something.

---

## 1. Scope contract

A **scope contract** is a locked decision manifest written **before any code is generated**. It captures the decisions you made (or that Loom asked you about), the assumptions you're willing to live with, the things explicitly out of scope, and the testable success criteria. Once locked, every downstream agent (planner, executor, reviewer) reads it and is held to it — a reviewer that catches a violation tags the finding `[CONTRACT]`.

> **You'll first see this** when `/loom-auto` runs its pre-flight (the **Prompt Refiner** and **Scope Interrogator** stages), or when you open `scope-contract.toon` in `.plan-execution/`.

The point: most AI coding tools start drifting the moment they're given an ambiguous prompt. Loom forces the ambiguity to resolve **before** code happens, and refuses to let later stages quietly re-decide it.

---

## 2. Scenario

A **scenario** is a Given/When/Then block — the leaf-level testable unit. It lives under a feature in `ROADMAP.md` or a phase in `PLAN.md`. Unlike BDD-as-documentation, Loom scenarios are **enforcement gates**: the convergence planner emits verification targets directly from them, and the pipeline blocks until they pass.

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

> **You'll first see this** when you open a Loom-generated `ROADMAP.md` or `PLAN.md`, or when `/loom-plan create` propagates roadmap scenarios into plan phases.

The point: every claim Loom makes about "done" traces back to a scenario. There is no "done by feel."

---

## 3. Wave

A **wave** is a batch of work that runs in parallel with **strict file ownership**. Wave 0 is always the contracts wave — a single agent writes shared types/schemas under `contracts/`. After Wave 0 the contracts directory **locks**: a Claude Code hook (`contract-lock`) blocks any further edits to `contracts/**` for the rest of the run. Waves 1+ spin up parallel implementer agents, each scoped to a non-overlapping file set; the `file-ownership` hook blocks any agent from writing outside its declared boundary.

> **You'll first see this** when `/loom-plan execute` starts running — the status line shows `Wave N (i/N tasks)` and you'll see "agent assigned files: [...]" in the execution log.

The point: parallel agents normally fight over the same files. Loom prevents that mechanically — by hook block, not by prompt convention.

---

## 4. Convergence

**Convergence** is the iteration engine that closes the gap between "what was built" and "what was specified." It runs as a five-step loop — plan targets → build harness → run → analyze delta → drive — and exits in one of five terminal states: `converged`, `stalled`, `regression`, `budget_exhausted`, or `max_iterations`. It has two modes:

- **Criteria mode** (`--criteria`) — TDD over scenarios. Default for `/loom-auto`. Iterate until every blocking scenario passes and every reviewer approves.
- **Target mode** (`--target <path>`) — match a known-good file. Iterate until the delta hits zero.

> **You'll first see this** when `/loom-converge` runs, when `/loom-auto` enters its convergence stage, or when you check `.plan-execution/convergence-state.toon`.

The point: most agents stop when they think they're done. Loom keeps iterating until the **harness** says they're done, with circuit breakers (stall, regression, budget) so it doesn't spin forever.

---

## 5. Change lifecycle

Once a milestone finishes, `/loom-plan materialize` writes the spec into per-domain `contract-*` wiki pages (e.g., `.loom/wiki/pages/contract-invoicing.md`). From that moment on, you do not edit those pages directly — you propose changes through a lifecycle:

```
/loom-change init "Add refund flow to billing"
/loom-change review chg-20260520-add-refund-flow
/loom-change approve chg-20260520-add-refund-flow
/loom-change run chg-20260520-add-refund-flow
/loom-change archive chg-20260520-add-refund-flow
```

`archive` atomically applies per-domain `DeltaBlock`s, refreshes the wiki index, and appends a History entry. Manual edits are caught by a content-checksum drift validator. For small one-off work, `/loom-quick` auto-emits a retroactive `quick-archive` proposal so contract pages stay coherent without ceremony.

> **You'll first see this** when you finish your first milestone and `/loom-plan materialize` runs, OR earlier if you start with a Loom-onboarded project that already has `contract-*` pages.

The point: the spec doesn't stop converging when the initial build ships. Maintenance flows through the same validation gates as the initial materialize.

---

## The four pillars (recap)

These five concepts compose into Loom's four pillars, which are what the README is really about:

1. **Pre-flight scope contract** — concept 1, captured before any code.
2. **Scenarios drive convergence** — concepts 2 and 4 wired together. Scenarios become convergence targets.
3. **Hook-enforced discipline** — concept 3's file ownership + contract lock + 11 other hooks block bad tool calls at the Claude Code layer, not at the prompt layer.
4. **Change-proposal lifecycle** — concept 5, the post-launch maintenance loop.

For the longer version, see [`design-philosophy.md`](./design-philosophy.md). For workflows that compose these in real situations, see [`scenarios-and-changes.md`](./scenarios-and-changes.md).

When you're ready, [`first-30-minutes.md`](./first-30-minutes.md) walks you through running these.

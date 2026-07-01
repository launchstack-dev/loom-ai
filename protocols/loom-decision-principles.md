# Loom Decision Principles

Adapted from gstack's Decision Principles + decision classifier. Auto-flow agents (`/loom-auto`, `/loom-converge`, `/loom-quick`, `/loom-plan:*`, `/loom-roadmap:*`) consult this file when resolving ambiguity mid-run.

## Overview

Every non-trivial decision an agent faces during autonomous execution falls into one of three classes. This protocol tells agents:

1. **Which principle to apply** (precedence-ordered).
2. **How to classify the decision** (mechanical / taste / user-challenge).
3. **When they may auto-answer vs. when they MUST prompt the user.**

The goal: agents burn through mechanical friction on their own, apply consistent taste for stylistic calls, and surface only the decisions where user intent genuinely matters.

## The 6 Principles (Precedence Order)

Later principles break ties among earlier ones only when explicit; earlier principles dominate.

1. **P1 — Completeness.** Prefer the option that produces a complete, coherent artifact over one that produces a partial artifact plus a TODO. A half-shipped feature is worse than a missing feature.
2. **P2 — Boil-lakes.** When a task can be scoped narrowly or broadly, prefer the narrow scope. Do not boil the ocean. Ship the smallest coherent slice.
3. **P3 — Pragmatic.** Prefer solutions that work in the target environment today over solutions that are theoretically pure but require infrastructure that doesn't exist yet.
4. **P4 — DRY.** Do not duplicate contracts, schemas, or logic. Reuse existing protocols and helpers unless a duplicated instance is measurably clearer.
5. **P5 — Explicit-over-clever.** Prefer explicit, boring code and obvious names over clever abstractions. If a downstream reader needs to trace three files to understand one call, it fails P5.
6. **P6 — Bias-to-action.** When stuck between two similar-quality options, pick one and proceed. Log the alternative in `integrationNotes`. Do not stall.

## Decision Classification

Every decision is one of:

### Mechanical

Deterministic mapping from inputs to output. No aesthetic or product judgment involved. Agents MUST auto-answer.

**Examples:**
- Which file path holds the new agent (path is dictated by resource type).
- Whether to run `bun` or `npm` (dictated by lockfile presence).
- Field ordering in a TOON schema when the schema doc lists a canonical order.

### Taste

Multiple defensible answers exist; consistency across the codebase matters more than the specific choice. Agents MAY auto-answer using the tiebreaker for the current phase (see below).

**Examples:**
- Naming a new command `/loom-x:sub` vs `/loom-x-sub`.
- Whether a helper lives in `scripts/` or inline in a hook.
- Choosing between two structurally equivalent TOON layouts.

### User-Challenge

The decision changes what the user gets. Product scope, contract shape, breaking change, ownership boundary, cost. Agents MUST prompt the user or leave a `crossBoundaryRequests[]` entry and stop.

**Examples:**
- Whether to add a new top-level command surface.
- Whether to break backward compatibility of an artifact schema.
- Whether to introduce a new required env var.
- Whether to spend budget on a paid vendor call.

## Auto-Answer Rules

| Class | Agent action | Escape hatch |
|-------|--------------|--------------|
| Mechanical | Auto-answer. Do not surface. | None; if genuinely ambiguous, reclassify as Taste. |
| Taste | Auto-answer using the phase tiebreaker. Log the choice in `integrationNotes`. | If two candidates score equal under the tiebreaker AND the outcome materially affects a downstream contract, reclassify as User-Challenge. |
| User-Challenge | Do NOT auto-answer. Emit a `crossBoundaryRequests[]` entry (or, if in an interactive prompt, ask the user directly). | None — never fabricate a user decision. |

Every auto-answered decision MUST carry a `decisionClass` field on the emitted finding or note so downstream reviewers can audit. Missing `decisionClass` is a `DECISION_UNCLASSIFIED` warning.

## Tiebreakers by Agent Phase

When two options tie under Taste, the tiebreaker below decides. The tiebreaker cites the principles above by number.

| Phase | Tiebreaker | Rationale |
|-------|------------|-----------|
| Planning (`plan:create`, `roadmap:*`, `spec`, `think`) | Prefer P1 (Completeness) first, then P2 (Boil-lakes). | Planning artifacts must be complete but not overreaching. |
| Execution (`plan:execute`, implementer-agents, contracts-agent) | Prefer P5 (Explicit-over-clever) first, then P3 (Pragmatic). | Executed code must be readable and ship in the current toolchain. |
| Review (`review-code`, `review-plan`, reviewer agents) | Prefer P5 (Explicit-over-clever) first, then P1 (Completeness). | Reviews should flag cleverness and gaps; do not reward brevity that hides state. |
| Fix / convergence (`loom-code fix`, `converge`, `loom-quick`) | Prefer P6 (Bias-to-action) first, then P5 (Explicit-over-clever). | Convergence must terminate; explicit-over-clever prevents whack-a-mole. |

## Emission Contract

Any auto-flow agent that auto-answers under this protocol MUST emit:

```toon
decision:
  question: "Which lockfile-driven runner to use?"
  class: mechanical
  choice: bun
  principleCited: P3
  phase: execution
```

Reviewer agents may downgrade an auto-answered decision to a finding by returning:

```toon
findings[1]{id,category,severity,confidence,message}:
  F-01,decision-audit,warning,7,"Agent auto-answered a decision that should have been User-Challenge"
```

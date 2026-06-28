# Codebase Design Vocabulary (F-18)

This protocol defines the shared vocabulary Loom uses when reasoning about codebase shape — module boundaries, interfaces, depth, seams, adapters, leverage, and locality. Adopted from Matt Pocock's codebase-design skill per locked decision C-06.

The vocabulary is consumed by `/loom-deepen`, `/loom-prototype`, and reviewer agents that comment on architectural quality.

## Section 0 — Vocabulary mapping table

When a term in this vocabulary conflicts with an existing Loom-native term (e.g., "kit" or "harness"), the mapping table below resolves precedence. Each row carries a non-empty `When to use which` column that disambiguates the two.

| Term | Definition | Conflicts with Loom term | When to use which |
|------|------------|--------------------------|-------------------|
| Module | A cohesive unit of code with a single public surface and a clear deletion test. | — | Always use "Module" for shape conversations; reserve "kit" for Loom's resource-bundling unit. |
| Interface | The public surface of a module — the test surface, not just the type signature. | — | Use "Interface" when discussing what callers see; reserve "contract" for inter-agent envelopes (AgentResult, findings.toon). |
| Depth | Ratio of behaviour-volume to interface-surface — deep modules hide complexity, shallow ones leak it. | — | Use "Depth" when arguing about whether a module pays its rent. |
| Seam | A place where you can substitute behaviour without modifying calling code — the canonical place to break a dependency. | — | Use "Seam" when designing for testability or extension; reserve "boundary" for ownership zones (file-ownership table). |
| Adapter | Code whose only job is to translate between two interfaces; carries no business behaviour. | — | Use "Adapter" when a module bridges two foreign shapes; reserve "shim" for one-off backwards-compat patches. |
| Leverage | The amount of downstream change one upstream edit unlocks; high-leverage edits should be load-bearing or refactored away. | — | Use "Leverage" when prioritising work; reserve "blast radius" for risk discussions. |
| Locality | How much of the answer to a question lives in one place — high locality reduces cognitive load. | — | Use "Locality" when arguing for co-located helpers; reserve "cohesion" for the textbook overload. |
| Tracer Bullet | A vertical slice that exercises every layer end-to-end at minimum fidelity — proves the integration shape before any layer is hardened. | — | Use "Tracer Bullet" when validating an architecture hypothesis; reserve "spike" for time-boxed investigation that may produce nothing shippable. |
| Vertical Slice | A user-meaningful capability cut top-to-bottom of the stack, owned end-to-end by one wave/plan-phase. | "Phase" in PLAN.md | Use "Vertical Slice" when scoping deliverables across layers; reserve "Phase" for plan-document execution units. |
| Gate | An interaction-state checkpoint in `loom-converge` or `loom-bugfix` where execution halts pending a TRDA pass or an explicit operator escape. Numbered per command (Gate 0 in `loom-converge`, Gate 1 in `loom-bugfix`). | "Phase" in PLAN.md; "Wave" in plan execution | Use "Gate" for interaction-state checkpoints in the feedback-loop pipeline; reserve "Phase" for plan-document execution units (a Phase contains one or more Waves); reserve "Wave" for concurrent execution boundaries within a Phase. |

## Section 1 — Module

A Module is a unit of code with one public Interface and a clear answer to the deletion test: "if I delete this module, what other modules must change?" High-Depth modules answer with a small surface area of changes; shallow modules cascade.

## Section 2 — Interface (the test surface)

> The interface IS the test surface.

A module's Interface is whatever its tests assert against. If you cannot write a test against a function without reaching past it into private state, the Interface is wrong. Treat the test file as the canonical statement of the Interface; the type signature is merely the compiler's view of the same thing.

## Section 3 — Depth

Depth = behaviour-volume ÷ interface-surface. A module that exposes 3 functions and runs 2,000 lines of behaviour behind them is deep; one that exposes 30 functions and runs 200 lines is shallow. Deep modules are the goal — they reduce caller cognitive load and concentrate the change-blast-radius.

## Section 4 — Seam

A Seam is a substitution point — a place where you can swap one implementation for another without rewriting callers. Seams are what make code testable, mockable, and extensible. Bad code has no seams (or only accidental ones); good code has seams exactly where the design needs them.

## Section 5 — Adapter

An Adapter has zero business behaviour. It exists to translate shape A into shape B. If an Adapter starts accumulating decisions, it has become a Module and needs its own Interface.

## Section 6 — Leverage

Leverage is the amount of downstream change one upstream edit unlocks. The highest-leverage edits — the load-bearing ones — deserve the most review. Low-leverage modules can be deleted, copy-pasted, or rewritten cheaply.

## Section 7 — Locality

Locality is "how much of the answer is in one place". High-locality code lets a reader answer a question without jumping files; low-locality code requires a treasure hunt. Locality often trades against DRY — prefer locality when the duplication is genuinely independent.

## The deletion test

For any Module, ask: "If I delete this, what else must change?" The answer is the Interface. If the answer is "nothing" — delete it. If the answer is "everything" — your Module has the wrong shape.

## "Interface is the test surface"

When debating whether a function belongs in the public API, write the test you would write for it. If the test reaches past the function into internals, the function is not yet on the right side of the Interface. Move the seam.

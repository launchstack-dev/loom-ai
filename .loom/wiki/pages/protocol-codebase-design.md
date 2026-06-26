---
pageId: protocol-codebase-design
category: protocol
tags[4]: codebase-design,vocabulary,module,interface,depth
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Defines the 9-term vocabulary table Loom uses for codebase-shape conversations (Module, Interface, Seam, Adapter, Leverage, Locality, Depth, Tracer Bullet, Vertical Slice) with Loom-native conflict resolution and the deletion test doctrine.
estimatedTokens: 900
bodySections[4]: Summary,Section 0 Vocabulary Table,Deletion Test,Interface is the Test Surface
relatedFiles[1]:
  protocols/codebase-design.md
crossRefs[3]{pageId,relationship}:
  command-loom-deepen,implements
  command-loom-prototype,implements
  feature-f18-mattpocock-skills-adoption,implemented-by
---

## Summary

`protocols/codebase-design.md` (F-18 Phase A) defines the shared vocabulary Loom uses when reasoning about codebase shape. Adopted from Matt Pocock's codebase-design skill per locked decision C-06. Consumed by `/loom-deepen`, `/loom-prototype`, and reviewer agents commenting on architectural quality.

## Section 0 — Vocabulary Mapping Table

The 9-row table below resolves precedence when a term conflicts with an existing Loom-native term. Each row carries a non-empty "When to use which" column.

| Term | Definition | Loom conflict | When to use which |
|------|------------|---------------|-------------------|
| **Module** | Cohesive unit with one public surface and a clear deletion test. | "kit" (resource-bundling unit) | Use "Module" for shape; reserve "kit" for Loom bundles. |
| **Interface** | The public surface of a module — the test surface, not just the type signature. | "contract" (inter-agent envelope) | Use "Interface" for callers; reserve "contract" for AgentResult / findings.toon. |
| **Depth** | Ratio of behaviour-volume to interface-surface. | — | Use "Depth" when arguing module rent. |
| **Seam** | Substitution point — swap behaviour without modifying callers. | "boundary" (ownership zones) | Use "Seam" for testability/extension; reserve "boundary" for file-ownership tables. |
| **Adapter** | Code that translates between two interfaces; carries no business behaviour. | "shim" (backwards-compat patches) | Use "Adapter" for shape-bridging; reserve "shim" for one-off compat patches. |
| **Leverage** | Downstream change unlocked by one upstream edit. | "blast radius" (risk discussions) | Use "Leverage" for prioritisation; reserve "blast radius" for risk. |
| **Locality** | How much of the answer lives in one place. | "cohesion" (textbook term) | Use "Locality" for co-located arguments; reserve "cohesion" for textbook framing. |
| **Tracer Bullet** | Vertical slice exercising every layer at minimum fidelity to prove integration shape. | "spike" (time-boxed investigation) | Use "Tracer Bullet" for architecture proofs; reserve "spike" for disposable investigations. |
| **Vertical Slice** | User-meaningful capability cut top-to-bottom, owned by one wave/plan-phase. | "Phase" in PLAN.md | Use "Vertical Slice" for cross-layer scoping; reserve "Phase" for plan execution units. |

## The Deletion Test

For any Module, ask: "If I delete this, what other modules must change?" The answer **is** the Interface. If the answer is "nothing" — delete it. If the answer is "everything" — the Module has the wrong shape.

The deletion test is the cheapest architectural health check available and should be run before any refactor decision.

## "Interface is the Test Surface"

> The interface IS the test surface.

A module's Interface is whatever its tests assert against. If you cannot write a test against a function without reaching into private state, the Interface is wrong. The test file is the canonical statement of the Interface; the type signature is the compiler's view of the same thing.

This doctrine drives the feedback-loop construction discipline in Phase B — a TRDA-passing loop tests the Interface, not implementation internals.

## Related Pages

- [/loom-deepen command](command-loom-deepen.md)
- [/loom-prototype command](command-loom-prototype.md)

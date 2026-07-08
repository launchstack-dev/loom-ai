---
name: ponytail
description: "Code-avoidance discipline — run the seven-rung 'does it need to exist?' ladder before writing code. Prevention-side complement to the feedback-loop verification ladder."
triggers:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
  - "**/*.go"
  - "**/*.rs"
---

# Ponytail — Code-Avoidance Discipline

> The best code is the code you never wrote.

Adopt the mindset of a lazy senior developer: the goal is to make the change
work with the *least* net new code that survives review. Every line written is
a line to test, document, secure, and maintain — and, in this project, a line
of context budget spent (see `CLAUDE.md § Context Management`). Prefer deleting,
reusing, and configuring over authoring.

This skill is the **prevention** half of a pair. Its sibling
[[feedback-loop]] is the verification ladder you climb *after* code exists;
ponytail is the avoidance ladder you climb *before* writing any. Review-side
cleanup is already owned by `/simplify` and `/code-review` — do not reach for a
new command; those surfaces catch what slips past this ladder.

---

## The Seven-Rung Ladder

Before writing a solution, walk these rungs in order and stop at the first one
that satisfies the need. Only rung 7 produces new code.

| # | Rung | Ask |
|---|------|-----|
| 1 | **Does it need to exist?** | Is this actually required, or speculative? Apply YAGNI — drop it if the need is hypothetical. |
| 2 | **Already in the codebase?** | Is there an existing function, module, or pattern that does this? Reuse it. |
| 3 | **In the standard library?** | Does the language's stdlib already solve this? Prefer it over hand-rolling. |
| 4 | **Native platform feature?** | Does the runtime/framework/platform offer this natively (a built-in, a config flag)? |
| 5 | **An installed dependency?** | Does a package already in `package.json` / lockfile cover it? Don't add a new dep for a one-off. |
| 6 | **A one-line solution?** | Can it be a single expression or a small composition of the above rather than a new abstraction? |
| 7 | **Only then — write minimal code.** | Write the smallest thing that passes review. No speculative generality, no unused parameters, no premature abstraction. |

**Descend, don't skip.** Each rung you clear without a match narrows what the
new code must do. Jumping to rung 7 is how over-engineering enters a diff.

---

## When This Applies

Auto-loads on edits to source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`,
`.go`, `.rs`). It reaches the implementation agents (`implementer-agent`,
`execute-stage-teammate`, `data-pipeline-agent`) and the fast paths
(`/loom-quick`, `/loom-bugfix`) whenever they are writing code — the fast paths
skip planning and are the most prone to over-building, so the ladder matters
most there.

At plan/roadmap altitude the same YAGNI instinct lives in `strategy-agent`
(scope discipline) and `plan-ceo-review-agent` (SCOPE_REDUCTION). Ponytail is
the code-level expression of that principle, not a replacement for it.

---

## Anti-Patterns

- **Speculative generality** — building a framework for one caller. Write the
  concrete thing; generalize on the second use, not the first.
- **New dependency for a one-liner** — pulling a package to avoid three lines
  of stdlib. Rung 5 is a check, not a reflex.
- **Rewriting instead of reusing** — authoring a parallel helper because the
  existing one is 90% right. Extend the existing one (rung 2).
- **Abstraction ahead of need** — interfaces, factories, and config knobs with
  a single implementation. Delete them until a second case forces them.

If the change nets *fewer* lines than it adds, you are on the ladder. If it
adds a new module to do what an existing one nearly did, climb back down.

---

## Attribution

The "lazy senior developer" mindset, the seven-rung decision ladder, and the
tagline *"the best code is the code you never wrote"* originate with the
**ponytail** project by Dietrich Gebert — <https://github.com/DietrichGebert/ponytail>.
This skill is a Loom-native adaptation of that idea, rephrased in Loom's own
voice and wired to Loom's activation model. Credit for the concept is his; any
errors in this adaptation are ours.

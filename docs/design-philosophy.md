# Design Philosophy

## Karpathy-Inspired Behavioral Guidelines

The wiki system and agent behavioral guidelines draw heavily from Andrej Karpathy's observations on how LLMs fail at coding tasks. His insights on silent assumption-making, gold-plating, and the gap between "code that runs" and "code that's correct" shaped two core Loom systems:

### Behavioral Guidelines

(`agents/protocols/behavioral-guidelines.md`)

Four guardrails every agent follows:

1. **Surface assumptions instead of guessing silently** — when an agent encounters ambiguity, it records the assumption explicitly rather than making a quiet choice that downstream agents can't see.
2. **Implement exactly what's specified** — no speculative abstractions, no "while I'm here" improvements. The scope contract defines what gets built.
3. **Make surgical changes that match existing style** — agents read surrounding code before writing, preserving conventions rather than imposing new ones.
4. **Verify against acceptance criteria before claiming done** — the scope contract's testable criteria are checked, not just "does it compile."

These directly address the failure patterns Karpathy identified.

### Persistent Wiki

(`.loom/wiki/`)

A project knowledge base that agents read and write, ensuring decisions survive across sessions and context windows. When an agent makes an architectural choice in wave 2, agents in wave 5 can find it in the wiki rather than re-inferring (and potentially contradicting) it.

The wiki is Loom's answer to the "agents don't remember what they decided" problem — context that compounds rather than evaporates.

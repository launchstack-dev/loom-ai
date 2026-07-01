---
agent: skills/loom-spec/SKILL.md
description: 5-phase interview from vague idea → ROADMAP feature block or GH issue. Flags — --auto-mutate (chain into /loom-roadmap:mutate), --name <slug> (target ROADMAP-<slug>.md), --yes (skip confirmation), --worktree (spawn branch), --from <path> (seed from /loom-think doc).
---

# /loom-spec

Turn a vague idea sentence into a precise ROADMAP entry or GitHub issue. Runs a 5-phase interview (Elicit, Sharpen, Classify, Draft, Optional worktree), classifies the work as bug/feature/enhancement/refactor/debt, and drafts a ROADMAP feature block or a GH issue body accordingly. On PR merge, the source GH issue is closed automatically.

See `skills/loom-spec/SKILL.md` for the full workflow, SpecRecord shape, and state-machine semantics.

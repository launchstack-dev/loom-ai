---
description: "Chief ship engineer — pre-flight rebase, VERSION-slot reservation, plan-completion audit inlined in PR body, and gh pr create in one command."
---

# /loom-ship

One-shot pre-PR pipeline for the current branch.

Executes six steps in order — halt on any failure:

1. Rebase current branch onto base branch (usually `main`).
2. Reserve the next free VERSION slot via
   `bunx tsx scripts/loom-version-slot.ts next --bump patch` +
   `... reserve <version>`.
3. Drift detection against base.
4. Plan-completion audit — classifies each PLAN.md deliverable
   (DIFF-VERIFIABLE / CROSS-REPO / EXTERNAL-STATE / CONTENT-SHAPE) and
   reconciles against `git diff <base>...HEAD`. Cap at 50 items.
5. Generate PR body markdown with Summary + Plan Completion Ledger +
   Test Plan + optional Doc Debt (from /loom-docs:release if wired).
6. `gh pr create` with the assembled body.

## Handler

| Skill | Purpose |
|---|---|
| `skills/loom-ship/SKILL.md` | Full behaviour, per-step rules, halt conditions. |

## Contracts

- `protocols/version-slot.schema.toon` — slot registry.
- `protocols/loom-ship-config.schema.toon` — deploy hint (optional footer).
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-canary.md` — post-merge phased deploy.
- `commands/loom-landing-report.md` — cross-workspace dashboard.
- `commands/loom-setup/deploy.md` — populates the deploy hint block.

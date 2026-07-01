---
description: "Multi-workspace dashboard — active branches, VERSION slots claimed, staleness detection across sibling worktrees. Read-only TOON summary."
---

# /loom-landing-report

Cross-workspace glance across every sibling worktree of the current project.
Reads:

- Sibling worktrees at `../*` and `$HOME/.worktrees/*` (same enumerator as
  `scripts/loom-worktree-scan.ts`).
- `~/.loom/version-slots.toon` for reserved VERSION slots.
- Open PRs via `gh pr list --state open --json
  number,headRefName,state,isDraft,updatedAt` (best-effort).

Emits a TOON `workspaces[N]` table with `workspace`, `branch`, `versionSlot`,
`lastCommit`, `prNumber`, `prState`, and `stale`.

`stale = true` iff no commits in 24 h AND no matching open PR.

## Handler

| Skill | Purpose |
|---|---|
| `skills/loom-landing-report/SKILL.md` | Full scan + emit rules. |

## Read-only

This command MUST NOT modify any registry file. If you want fresh
slot-registry data, run `bunx tsx scripts/loom-version-slot.ts scan` first.

## Contracts

- `protocols/version-slot.schema.toon` — slot registry input.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-ship.md` — creates VERSION-slot reservations.
- `commands/loom-canary.md` — writes `.loom/canary-history.toon`.
- `commands/loom-worktree.md` — sibling-worktree lease coordination.

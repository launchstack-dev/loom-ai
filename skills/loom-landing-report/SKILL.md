---
name: loom-landing-report
description: "Multi-workspace dashboard — active branches, VERSION slots claimed, staleness (branches with no commits in 24h and no open PR)."
---

# /loom-landing-report — Cross-Workspace Landing Dashboard (M-10 F-31)

`/loom-landing-report` is the developer's morning glance across every
sibling worktree of a project. It answers: which branches are in flight,
which VERSION slots are claimed, which look stale.

## What it scans

Three data sources:

1. **Sibling worktrees** — reuses the enumeration logic from
   `scripts/loom-worktree-scan.ts` (M-09 F-01). Scans `../*` and
   `$HOME/.worktrees/*` for directories containing a `.git` entry.
2. **VERSION slot registry** — reads `~/.loom/version-slots.toon` per
   `protocols/version-slot.schema.toon` (populated by
   `scripts/loom-version-slot.ts`).
3. **Open PRs** — `gh pr list --state open --json
   number,headRefName,state,isDraft,updatedAt --limit 200`. Best-effort:
   skipped if `gh` is missing.

## Staleness rule

A branch is `stale` when BOTH of the following hold:

- No commits in the last 24 hours (`git log -1 --format=%ct`).
- No open PR whose `headRefName` matches the branch.

Stale branches are surfaced explicitly so the user can prune or resume.

## Output

TOON dashboard printed to stdout:

```toon
schemaVersion: 1
generatedAt: 2026-06-30T00:00:00Z
workspaces[N]{workspace,branch,versionSlot,lastCommit,prNumber,prState,stale}:
  <worktreeName>,<branch>,<semver>,<ISO 8601>,<int>,<enum>,<bool>
```

- `workspace` — basename of the worktree path.
- `branch` — current branch of that worktree.
- `versionSlot` — reserved semver from `~/.loom/version-slots.toon`; empty
  when no reservation exists.
- `lastCommit` — ISO 8601 of the latest commit on that branch.
- `prNumber` — 0 when there is no open PR.
- `prState` — `open` / `draft` / `none`.
- `stale` — `true` / `false` per the staleness rule.

## Reused code

- Sibling scanner: same logic as `scripts/loom-worktree-scan.ts`. When that
  script exposes a helper module, prefer importing over duplication. For
  now, an inline re-implementation is acceptable — behaviour parity is the
  contract, not source dedup.

## Non-goals

- Does **not** modify any registry file. Read-only across
  `~/.loom/version-slots.toon`, `~/.loom/leases/*.toon`, and CLAUDE.md.
- Does **not** open PRs, kill branches, or delete worktrees. Reporting only.
- Does **not** re-run the version-slot refresh. It reads the last-scanned
  state; run `bunx tsx scripts/loom-version-slot.ts scan` first for
  freshness.

## Contracts

- `protocols/version-slot.schema.toon` — slot registry input.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-landing-report.md` — dispatcher.
- `scripts/loom-version-slot.ts` — populates the slot registry.
- `scripts/loom-worktree-scan.ts` — sibling-worktree enumerator (M-09).

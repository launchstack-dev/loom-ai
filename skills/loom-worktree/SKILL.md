---
name: loom-worktree
description: "Cross-worktree lease + preflight scan for parallel-branch coordination. Prevents semantic conflicts before merge time."
---

# /loom-worktree — Cross-Worktree Fan-in Coordination (M-09 F-01)

`/loom-worktree` is an **advisory** preflight system that detects file-ownership
overlap across sibling git worktrees of the same repo. It exists because
parallel Claude Code sessions in sibling worktrees can happily touch the same
paths and only discover the collision at PR merge time — usually after both
branches have shipped a design that "looks right" in isolation.

**Current implementation ships the 80/20 first step: detection + warning.**
Full mechanisms — enforced leases, semantic pre-conflict scanning, and
rebase-storm coordination — are documented below as roadmap items.

## Subcommands

| Subcommand | Behavior |
|---|---|
| `scan` | Enumerate sibling worktrees, refresh the lease registry, print overlap findings. Always exits 0. |
| `preflight` | Same as `scan`, but exits **1** if any overlap is detected. Used by the PreToolUse hook wired to `/loom-git pr` and safe to call from CI. |
| `leases` | Print the current lease file for this repo (`~/.loom/leases/{repo}.toon`). |
| `release <id>` | Mark the lease with the given `id` as `released`. IDs are `"{repoBasename}:{branch}"`. |

Direct script invocation:

```bash
bunx tsx scripts/loom-worktree-scan.ts scan
bunx tsx scripts/loom-worktree-scan.ts preflight
bunx tsx scripts/loom-worktree-scan.ts leases
bunx tsx scripts/loom-worktree-scan.ts release loom-ai:m07
```

## Where sibling worktrees are discovered

1. **`../*`** — siblings of the current worktree in the same parent directory
   (matches the `wt` conventions used by this project's `CLAUDE.md`).
2. **`$HOME/.worktrees/*`** — the personal worktree pool.
3. **Configured root** — read from `.claude/orchestration.toml`:

   ```toml
   [worktree]
   rootPath = "~/Projects/loom-ai/.worktrees"
   ```

Only siblings whose primary repo basename matches the current worktree's are
considered — this rules out cross-repo noise when several projects share a
worktree pool.

## How ownership is derived

For each sibling, the scanner prefers a **declared** ownership set over a
derived one:

1. **PLAN.md ownership sections** — any `File Ownership:` line in `PLAN.md`,
   `planning/PLAN.md`, or `planning/plans/PLAN-*.md`. Comma- or
   semicolon-separated globs are extracted.
2. **git diff fallback** — `git diff --name-only <base>...HEAD`, where `<base>`
   is the first of `main`, `master`, `origin/main`, `origin/master` that
   resolves.

For the **current** worktree, the same rule applies: PLAN.md if declared,
otherwise the working diff against `main`.

## Lease registry (`~/.loom/leases/{repo}.toon`)

Schema: `protocols/worktree-lease.schema.toon`. The registry is **user-scoped**
— it lives under `~/.loom/leases/`, not inside the repo — because sibling
worktrees are per-user concerns and shouldn't ship in git history.

The directory is **not** created by the installer. It's created lazily by the
first `loom-worktree scan` invocation.

Each lease row:

```
id,workspacePath,branch,ownedGlobs,claimedAt,expiresAt,status
```

- `status`: `active` | `released` | `expired`
- `ownedGlobs`: semicolon-separated (commas are the TOON column separator)
- `expiresAt`: default `claimedAt + 14 days`. A scan that finds `now > expiresAt`
  rewrites the row with `status: expired` rather than deleting it.

Writes are atomic: `.toon.tmp` then `renameSync`.

## Findings envelope

Every overlap finding carries a `confidence: 1-10` field per
`protocols/agent-result.schema.md`. The scanner's confidence heuristic:

- Base **6**.
- +2 if the sibling had a declared PLAN.md ownership set (higher trust than a
  git-diff derivation).
- +1 per overlapping path (cap +2), because more paths = stronger signal.
- Capped at 10.

Every finding also carries:

```
suggestedAction: "Run rebase-from-main and re-verify before merging"
```

## Preflight hook — `/loom-git pr`

`hooks/preflight-worktree-scan.ts` is a **PreToolUse** hook that watches Bash
tool calls for `/loom-git pr` invocations. On match, it runs the scanner and,
when overlap is detected, writes a warning block to **stderr** and exits 0
(never blocks). The user sees the warning immediately and decides whether to
proceed.

Bypass: set `LOOM_WORKTREE_PREFLIGHT_DISABLE=1`.

## Non-goals for M-09 F-01

- **No enforcement.** The system will not stop you from writing to a file
  owned by a sibling. It only warns.
- **No auto-rebase.** The suggested action is displayed but not executed.
- **No lease acquisition protocol.** Leases are inferred from PLAN.md and git
  diff, not claimed by the agent up-front.
- **No cross-user coordination.** The registry is local; nothing syncs it.

## Roadmap — three mechanisms for a fully-solved fan-in problem

The following are **future work** — spec sketches, not shipped in M-09:

### 1. Enforced lease acquire / release

- New PreToolUse hook on `Write`/`Edit`: block the write when the target path
  is under an `active` sibling lease. Emit `WORKTREE_LEASE_HELD` with the
  sibling's branch and workspacePath.
- New `/loom-worktree acquire <glob>` and `/loom-worktree release <glob>`
  subcommands that mutate the registry with explicit user intent.
- Leases would carry a `claimedByPid` and `claimedByAgentId` for revocation.

### 2. Semantic AST pre-conflict scan

- Cross-worktree AST diff: for each shared symbol touched by two branches,
  compute a semantic-conflict score (signature change, return-type change,
  new required arg, deletion). Findings are emitted with per-symbol
  confidence rather than per-path.
- Integrates with tree-sitter parsers per language; degrades gracefully to
  path-level detection when no parser is available.

### 3. Rebase-storm coordinator

- When `N` sibling branches all show overlap on the same set of paths, a
  coordinator elects a merge order (topological on ownership overlap graph)
  and prints a rebase plan.
- Optional: drive `wt rebase <branch>` for each branch in the elected order,
  running the plan's verification gate after each rebase.

## Exit codes

- `0` — clean scan / non-preflight subcommand / `release` success.
- `1` — preflight found one or more overlaps (advisory but CI-visible).
- `2` — unknown subcommand or usage error.

## Related

- `protocols/worktree-lease.schema.toon` — lease registry schema.
- `scripts/loom-worktree-scan.ts` — CLI utility.
- `hooks/preflight-worktree-scan.ts` — PreToolUse hook.
- `commands/loom-worktree.md` — user-facing dispatcher.
- `protocols/agent-result.schema.md` — `confidence:1-10` finding rules.
- Project `CLAUDE.md` Worktree Context section — `wt` lifecycle commands.

---
description: "Cross-worktree fan-in coordination — advisory ownership scan across sibling worktrees with lease registry and PreToolUse preflight for /loom-git pr."
---

# /loom-worktree

Cross-worktree ownership scan and lease registry. Advisory only — no
enforcement, no auto-rebase — just detection and warnings before parallel
branches collide at merge time.

Parse the first positional argument as the subcommand. If no argument is
given, print the subcommand summary.

## Subcommand Dispatch

| Subcommand | Handler |
|---|---|
| `scan`         | `skills/loom-worktree/SKILL.md` — refresh lease registry, print overlap findings, exit 0 |
| `preflight`    | `skills/loom-worktree/SKILL.md` — same as `scan`, exit non-zero on overlap |
| `leases`       | `skills/loom-worktree/SKILL.md` — print current lease file for this repo |
| `release <id>` | `skills/loom-worktree/SKILL.md` — mark a lease released |

Direct invocation:

```bash
bunx tsx scripts/loom-worktree-scan.ts scan
bunx tsx scripts/loom-worktree-scan.ts preflight
bunx tsx scripts/loom-worktree-scan.ts leases
bunx tsx scripts/loom-worktree-scan.ts release <lease-id>
```

## Exit codes

- `0` — clean scan, or `preflight` with no overlaps, or `leases` / `release` success.
- `1` — `preflight` detected at least one overlap.
- `2` — unknown subcommand or usage error.

## Preflight hook wiring

`hooks/preflight-worktree-scan.ts` is a PreToolUse hook that runs on
`/loom-git pr` invocations. It calls the scanner and emits **non-blocking**
stderr warnings when overlaps are detected. Bypass with
`LOOM_WORKTREE_PREFLIGHT_DISABLE=1`.

## Storage

- Lease registry: `~/.loom/leases/{repo}.toon` (user-scoped, created lazily on
  first scan — not shipped by installer).
- Schema: `protocols/worktree-lease.schema.toon`.

## Roadmap (future work — not shipped in M-09)

1. Enforced lease acquire/release with `Write`/`Edit` PreToolUse blocking.
2. Semantic AST pre-conflict scan (per-symbol signature/type-change detection).
3. Rebase-storm coordinator that elects a merge order across N branches.

## See also

- `skills/loom-worktree/SKILL.md` — full spec and roadmap.
- `protocols/worktree-lease.schema.toon` — lease row schema.
- `scripts/loom-worktree-scan.ts` — CLI implementation.
- `hooks/preflight-worktree-scan.ts` — PreToolUse hook.

---
name: loom-learn
description: "Review/search/prune/export learnings from .loom/learnings.toon (from M-01 F-04). Surfaces relevant learnings proactively when user asks 'didn't we fix this before?'"
---

# /loom-learn — Learnings Management UI (M-08 F-26)

Manages the learnings corpus at `.loom/learnings.toon` — the append-only log
of resolved-issue lessons emitted by `/loom-bugfix`, `/loom-quick`, retros,
and other Loom flows. Provides interactive search, pruning, and export.

## Subcommands

| Subcommand | Purpose |
|---|---|
| `list` | Show all learnings in chronological (newest first) order with id, date, tags, confidence. |
| `search <keyword>` | Full-text search over `problem`, `resolution`, `tags`. Ranks by BM25-ish score; returns top 10. |
| `prune --min-confidence <N>` | Delete learnings with `confidence < N`. Writes backup to `.loom/learnings.toon.bak` before rewriting. |
| `export --format=<toon\|md\|jsonl>` | Emit the full corpus to stdout in the requested format. |

Under the hood every subcommand shells out to
`scripts/loom-learnings-search.ts` (shipped in M-01 F-04). This skill wraps
that script with a stable UI contract.

### list

```
/loom-learn list [--tag <tag>] [--limit <N>]
```

Output (TOON):

```toon
learnings[N]{id,date,tags,confidence,problemPreview}:
  L-2026-06-05-01,2026-06-05,"scope|toon",9,"scope-contract.toon out of sync"
  L-2026-05-30-02,2026-05-30,"tests|flaky",7,"vitest race condition on parallel writes"
```

### search

```
/loom-learn search "<keyword>" [--limit <N>]
```

Delegates to `scripts/loom-learnings-search.ts` with `--query "<keyword>"`.
Returns top matches with matched snippets highlighted.

### prune

```
/loom-learn prune --min-confidence <N>
```

Reads `.loom/learnings.toon`, filters entries with `confidence >= N`, writes
survivors atomically to `.loom/learnings.toon.tmp` and renames. Backup of the
prior corpus goes to `.loom/learnings.toon.bak`. Reports the count removed.

### export

```
/loom-learn export --format=toon|md|jsonl [--out <path>]
```

- `toon` — same schema as `.loom/learnings.toon` (default).
- `md` — one heading per entry, `## L-<id>` with problem/resolution sections.
- `jsonl` — one JSON object per line for consumption by external tools.

If `--out` is omitted, writes to stdout.

## Proactive surfacing

When the current user prompt (available via context) contains any of the
phrases:

- "didn't we"
- "before"
- "again"
- "recurring"
- "already fixed"
- "seen this"

… this skill auto-runs `search` over the whole prompt text and surfaces the
top 3 matches at the top of the response, formatted as:

```
Related past learnings (auto-surfaced):
  L-2026-05-30-02 (confidence 7) — vitest race condition on parallel writes
  L-2026-04-11-01 (confidence 6) — atomic write missing on state.toon
  L-2026-03-02-05 (confidence 5) — flaky snapshot test
```

The user can then run `/loom-learn search "<keyword>"` for the full entry.

## Files touched

- Reads: `.loom/learnings.toon`
- Writes (prune only): `.loom/learnings.toon`, `.loom/learnings.toon.bak`
- Delegates to: `scripts/loom-learnings-search.ts`

## Exit codes

- `0` — subcommand succeeded.
- `1` — `.loom/learnings.toon` missing or unreadable.
- `2` — subcommand unrecognized or missing required argument.

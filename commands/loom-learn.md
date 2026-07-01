---
description: "Learnings management UI — review, search, prune, and export .loom/learnings.toon. Auto-surfaces relevant prior learnings when the prompt contains 'didn't we', 'before', 'again', 'recurring'."
---

# /loom-learn

Review, search, prune, and export the learnings corpus at
`.loom/learnings.toon`.

Parse the first positional argument as the subcommand:

- No args: show available subcommands.
- `list`: list learnings newest-first (optional `--tag`, `--limit`).
- `search <keyword>`: full-text search over problem/resolution/tags.
- `prune --min-confidence <N>`: delete learnings below a confidence threshold.
- `export --format=<toon|md|jsonl>`: emit the corpus in the requested format.

## Subcommand Dispatch

All subcommands delegate to `skills/loom-learn/SKILL.md`.

## Usage

```
/loom-learn list [--tag <tag>] [--limit <N>]
/loom-learn search "<keyword>" [--limit <N>]
/loom-learn prune --min-confidence <N>
/loom-learn export --format=toon|md|jsonl [--out <path>]
```

## Proactive surfacing

When the current user prompt contains phrases like "didn't we", "before",
"again", "recurring", "already fixed", or "seen this", the skill runs
`search` over the prompt text automatically and prepends the top 3 matches
to the response.

## Backing store

- Reads: `.loom/learnings.toon` (M-01 F-04).
- Delegates to: `scripts/loom-learnings-search.ts`.
- Backup on prune: `.loom/learnings.toon.bak`.

See `skills/loom-learn/SKILL.md` for the full behavior.

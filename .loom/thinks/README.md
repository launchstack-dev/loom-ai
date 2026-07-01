# .loom/thinks/

This directory holds durable "think docs" produced by `/loom-think` — 5-phase office-hours interviews that sharpen fuzzy problems before they enter the ROADMAP.

## Filename convention

```
{slug}-{ISO-timestamp}.md
```

- `{slug}` — kebab-case slug derived from the topic or `--branch` argument.
- `{ISO-timestamp}` — `YYYY-MM-DDTHH-MM-SS` (colons replaced with dashes for filesystem safety).

Example: `browser-daemon-cookie-refresh-2026-06-30T14-22-05.md`

## Supersedes chain

Every think doc's frontmatter includes a `supersedes:` field. When `/loom-think` runs on a topic that has been thought about before (matched by the `branch:` frontmatter field), it scans this directory for prior docs on the same branch, picks the newest by `datetime:` (not by filename), and cites its path in `supersedes:`.

The result is a chain — each new think doc points at the previous one. To walk the history of thinking on a branch:

1. Find the newest doc with the target `branch:`.
2. Follow `supersedes:` backward until it is empty.

This preserves the reasoning trail without mutating prior docs (they are append-only, historical records).

## Downstream consumers

- **`/loom-roadmap init --from <path>`** — accepts a think doc as a seed for a new roadmap.
- **`/loom-spec --from <path>`** — accepts a think doc as the origin of a spec draft.
- **`/loom-debate`** — a downstream cross-model review pass can pick up the `Cross-model review: PENDING` marker from Phase 3.5.

## Status values

Frontmatter `status:` may be:

- `DRAFT` — freshly written; not yet acted on.
- `ROADMAPPED` — `/loom-roadmap init --from` consumed this doc.
- `SUPERSEDED` — a newer doc on the same branch supersedes this one.
- `ABANDONED` — the operator explicitly discarded this line of thinking.

`/loom-think` writes `DRAFT`. Other commands update the field as they consume the doc.

## Do not

- **Do not paraphrase** operator answers when writing a doc. Carry their language verbatim.
- **Do not mutate** prior docs. Write a new dated doc that supersedes.
- **Do not delete** docs. Set `status: ABANDONED` if a line of thinking is dropped.

---
pageId: protocol-out-of-scope
category: protocol
tags[4]: out-of-scope,rejection-log,immutable,visible-suppression
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Defines the OutOfScopeEntry artifact — immutable per-idea rejection records in .out-of-scope/{id}.md with TOON frontmatter, preventing re-litigation of already-rejected ideas via the idx_oos_source reverse index.
estimatedTokens: 700
bodySections[4]: Summary,Schema,Immutability Guarantee,Visible Suppression Callout
relatedFiles[1]:
  protocols/out-of-scope.schema.md
crossRefs[2]{pageId,relationship}:
  feature-f18-mattpocock-skills-adoption,implemented-by
  state-machine-triage,relates-to
---

## Summary

`protocols/out-of-scope.schema.md` (F-18 Phase A, sub-14) defines the `OutOfScopeEntry` artifact. Each rejected idea gets exactly one immutable file at `.out-of-scope/{id}.md` with TOON frontmatter. The primary purpose is to prevent the most expensive failure mode: re-proposing an already-rejected idea and re-litigating the conversation from scratch.

## Schema

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `OOS-{NN}`, zero-padded, unique; matches `^OOS-\d{2,}$` |
| `idea` | string | one-line summary, 1..200 chars |
| `rejectedAt` | ISO 8601 | millisecond precision: `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `rejectedBy` | enum | `human` \| `agent` |
| `rationale` | string | required, min 20 chars |
| `sourceProposalId` | string\|null | optional FK to roadmap feature, change-proposal, wiki note, or inbox note |

IDs are monotonically allocated. Writers scan `.out-of-scope/` for the highest existing `OOS-{NN}` and emit `OOS-{NN+1}`. Allocation races are resolved by re-reading the directory listing and retrying once.

### Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| `pk_oos` | id | Row lookup |
| `idx_oos_source` | sourceProposalId | Reverse-link so a future proposer can see prior rejections without a full-directory scan |

## Immutability Guarantee

OOS entries are **immutable once written**. A reversed decision is captured as a new feature or fresh idea — the OOS entry remains in place as the historical trail. No in-place edits are permitted.

## Visible Suppression Callout

On the **second** pass of `roadmap-converge` over an idea that has an OOS entry, a visible suppression callout is emitted:

```
SUPPRESSED: "{idea}" was rejected at {rejectedAt} (rationale: {rationale}). OOS entry: .out-of-scope/{id}.md. To re-propose, read the rationale first.
```

The callout is machine-readable (starts with `SUPPRESSED:`) so downstream tooling can detect it without regex heuristics.

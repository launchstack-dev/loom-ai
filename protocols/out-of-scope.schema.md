# OutOfScopeEntry Schema (F-18 Phase A)

Defines the `OutOfScopeEntry` artifact: an immutable record of an idea that was considered and rejected. Storage: one Markdown file per entry at `.out-of-scope/{id}.md` with TOON frontmatter.

Schema version: **1**. Schema source for the `roadmap-converge` and `loom-roadmap` writers.

---

## Frontmatter schema

```toon
id: OOS-07
idea: "Auto-route bug reports through an LLM classifier before triage"
rejectedAt: 2026-06-25T11:14:22.000Z
rejectedBy: agent
rationale: "Triage discipline (Phase D) intentionally puts a human in the loop. An LLM classifier would silently re-introduce the failure mode F-18 is correcting."
sourceProposalId: NOTE-42
```

Body (Markdown, optional): extended discussion, links, screenshots.

---

## Field schema

| Field | Type | Constraints | Validation Rule |
|-------|------|-------------|-----------------|
| `id` | string | `OOS-{NN}`, zero-padded, unique within `.out-of-scope/` | matches `^OOS-\d{2,}$` |
| `idea` | string | one-line summary | 1..200 chars |
| `rejectedAt` | string (ISO 8601) | required, millisecond precision | format `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `rejectedBy` | enum | `human` \| `agent` | — |
| `rationale` | string | required | min 20 chars |
| `sourceProposalId` | string \| null | optional FK to roadmap feature, change-proposal id, wiki note, or inbox note | — |

---

## Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_oos` | id | PRIMARY | Lookup |
| `idx_oos_source` | sourceProposalId | INDEX | Reverse-link from feature proposals so a future proposer can see "this was rejected before, for these reasons". |

---

## Cascade Behavior

No FKs cascade. OOS entries are **immutable once written** — they are the historical record. A reversed decision is captured as a new feature (or a fresh idea); the OOS entry remains in place as the trail.

---

## ID allocation

IDs are monotonically allocated. `roadmap-converge` and `loom-roadmap` scan `.out-of-scope/` for the highest existing `OOS-{NN}` and emit `OOS-{NN+1}`. Allocation races are resolved by re-reading directory listing and retrying once.

---

## Why immutable

A core Phase-A insight: the most expensive failure mode is re-proposing an idea that has been rejected before — the conversation has to be re-litigated from scratch. Immutability + the `idx_oos_source` index gives proposers a cheap way to surface prior rejections.

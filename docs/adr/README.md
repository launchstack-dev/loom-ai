# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the loom-ai project.

## Numbering

ADRs use **4-digit zero-padded sequential integers**: `NNNN-{kebab-title}.md`.

- `0000` is reserved for the convention ADR itself (`0000-adr-convention.md`).
- Real decision ADRs start at `0001`.
- Next number = `max(existing NNNN) + 1`.
- Numbers are **never reused**, even when an ADR is deprecated or superseded.

## Status Enum

Every ADR has a `Status` field with one of these values:

| Status | Meaning |
|--------|---------|
| `proposed` | Under consideration; not yet adopted |
| `accepted` | In force; team or tool confirmed |
| `deprecated` | No longer in force; no replacement |
| `superseded` | Replaced by a newer ADR; set `SupersededBy: NNNN` |

## Trigger Rule

ADRs are created by **explicit trigger events only** — not on every decision:

1. `loom-converge` resolves a blocking conflict → creates an `accepted` ADR.
2. `loom-roadmap converge` records a load-bearing rejection → creates a `proposed` ADR (operator accepts it to advance).

Manual ADRs are valid but are not automatically created by the pipeline.

## File Template

```markdown
# ADR-{NNNN}: {Title}

| Field | Value |
|-------|-------|
| **Number** | {NNNN} |
| **Title** | {Title} |
| **Status** | {proposed|accepted|deprecated|superseded} |
| **Date** | {YYYY-MM-DD} |
| **SupersededBy** | {NNNN or —} |

## Context
## Decision
## Consequences
## Alternatives Considered
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0000](0000-adr-convention.md) | ADR Convention | accepted |

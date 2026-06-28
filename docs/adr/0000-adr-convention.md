# ADR-0000: ADR Convention

| Field | Value |
|-------|-------|
| **Number** | 0000 |
| **Title** | ADR Convention |
| **Status** | accepted |
| **Date** | 2026-06-25 |
| **SupersededBy** | — |

## Context

Loom needs a lightweight, machine-readable decision record format that:

1. Can be created automatically when `loom-converge` resolves a blocking conflict or `loom-roadmap converge` records a load-bearing rejection.
2. Has a stable numbering scheme so cross-references from wiki pages, DECISIONS.md, and agent outputs remain stable over time.
3. Supports a lifecycle that makes retired and superseded decisions visible without deleting them.
4. Is not created lazily on first-write — ADR creation must be triggered by an explicit event.

## Decision

### Numbering

ADRs use **4-digit zero-padded sequential integers** starting at `0000`. The convention ADR itself is `0000`; the first real decision ADR is `0001`.

File naming: `docs/adr/NNNN-{kebab-title}.md`

Examples:
- `docs/adr/0000-adr-convention.md` (this file)
- `docs/adr/0001-hook-merge-strategy.md`
- `docs/adr/0042-context-split.md`

**Assignment rule:** The next ADR number is `max(existing NNNN) + 1`. If no ADRs exist, start at `0001` (0000 is reserved for this convention ADR). Numbers are never reused, even if an ADR is deprecated or superseded.

### Status Enum

Every ADR MUST carry a `Status` field set to one of:

```
proposed | accepted | deprecated | superseded
```

Lifecycle transitions:

```
proposed → accepted       (team or tool confirms the decision)
accepted → deprecated     (decision is no longer in force; no replacement)
accepted → superseded     (decision is replaced by a newer ADR — set supersededBy)
proposed → deprecated     (explored but never adopted)
```

`supersededBy` field MUST be set when status is `superseded`. It contains the ADR number of the replacement (e.g., `0017`). The replacement ADR MUST exist before the superseded ADR is marked.

### File Header Template

Every ADR file MUST begin with this table (fields filled in):

```markdown
# ADR-{NNNN}: {Title}

| Field | Value |
|-------|-------|
| **Number** | {NNNN} |
| **Title** | {Title} |
| **Status** | {proposed|accepted|deprecated|superseded} |
| **Date** | {YYYY-MM-DD} |
| **SupersededBy** | {NNNN or —} |
```

Followed by sections: **Context**, **Decision**, **Consequences**, and optionally **Alternatives Considered**.

### Explicit Trigger Rule

ADR creation is NOT lazy-on-first-write. An ADR is created when and only when one of the following explicit trigger events fires:

1. **`loom-converge` resolves a blocking conflict** — when a convergence run resolves a conflict that was blocking progress (e.g., two reviewers disagree, the operator makes a judgment call to proceed), `loom-converge` creates a new ADR capturing the resolution. The ADR status starts as `accepted`.

2. **`loom-roadmap converge` records a load-bearing rejection** — when the roadmap convergence loop records a rejection that changes the roadmap direction (e.g., a dimension that was green is permanently retired, or a reviewer finding is rejected with a documented reason), `loom-roadmap converge` creates a new ADR. The ADR status starts as `proposed` until the operator accepts it.

Any other writing of an ADR is a manual operation performed by a human or agent outside these two trigger paths. Manual ADRs are valid but not automatically created by the pipeline.

**What does NOT trigger ADR creation:**
- A reviewer finding that is acknowledged and fixed (no conflict, no rejection).
- A wiki `decision-*.md` page being ingested (wiki pages are lower-ceremony; they may be promoted to ADRs via `scripts/migrate-wiki-decisions-to-adrs.ts`).
- A plan phase completing successfully.

## Consequences

- The `docs/adr/` directory is the authoritative source for formal architecture decisions in this project.
- Wiki `decision-*.md` pages remain lightweight, non-formal. They can be promoted to ADRs via the migration script.
- Downstream tools (wiki-ingest-agent, loom-converge, loom-roadmap) must check for existing ADRs before creating duplicates.
- ADR files are committed to git; they are never in `.gitignore`.

## Alternatives Considered

- **Lazy creation (any time a decision is made).** Rejected: creates noise; makes the ADR index unreliable as a signal of load-bearing decisions.
- **Single DECISIONS.md instead of individual files.** Rejected: single-file format doesn't scale; cross-references become fragile; no individual file ownership for supersession chains.
- **3-digit numbering (001).** Rejected: 4-digit is more future-proof for projects with many ADRs, and the zero-pad convention is already used in the Loom ecosystem for plan phase numbering.

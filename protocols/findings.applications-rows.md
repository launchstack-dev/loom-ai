# ConvergenceFindings — Per-Application Row Variants (F-01..F-04)

This document is a **non-modifying companion** to the locked `protocols/findings.schema.md`. It does NOT add, rename, remove, or retype any column in the canonical `ConvergenceFindings` row. It only documents how each of the four new applications shipped by the convergence-applications plan populates the existing columns.

Schema version: unchanged. Registered in `schema-versions.toon` under the existing `convergence-findings` entry.

Companion to: `protocols/converge.config.applications.md` (per-application `converge.config` field-value matrix).

---

## Hard guarantee: no schema mutation

Per CA-01 (locked substrate) and Phase 0 acceptance, this plan ships **zero modifications** to:

- `protocols/findings.schema.md`
- `protocols/converge.config.schema.md`
- `protocols/iteration-snapshot.schema.md`
- `protocols/convergence-summary.schema.md`

This document only restates row-population conventions already permitted by the locked schema columns: `id`, `severity`, `locationPath`, `locationAnchor`, `summary`, `suggestion`, `reviewerAgent`.

---

## Canonical row shape (verbatim, from `findings.schema.md`)

```toon
findings[N]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:
  F-01,<dimension>,blocking|warning|info,<repo-relative path>,<anchor>,<one-line summary>,<optional suggestion>,<reviewer attribution>
```

The `dimension` column is application-agnostic — applications that do not produce a meaningful dimension SHOULD set it to the empty string or a stable per-application token (e.g., `code-review`, `test`, `debug`, `pr-review`). No schema column is added.

---

## F-01 — Code-review row variant

Produced by `scripts/code-review-harness.ts`, which spawns the same 9+ reviewers `/loom-code review` invokes and aggregates via `scripts/lib/aggregate-findings.ts` verbatim.

| Column | Source | Notes |
|--------|--------|-------|
| `id` | sequential `F-NN` within the iteration | regex `^F-\d{2,}$` |
| `severity` | reviewer envelope `severity` → `severityToConvergenceSeverity()` | preserves W-03 mapping |
| `locationPath` | reviewer envelope `findings[].filePath` | repo-relative |
| `locationAnchor` | `:N` where N is `findings[].line` | `:0` when whole-file |
| `summary` | reviewer envelope `findings[].summary` | 1-200 chars |
| `suggestion` | reviewer envelope `findings[].suggestion` (optional) | 0-500 chars |
| `reviewerAgent` | reviewer name (`code-reviewer`, `security-reviewer`, etc.) | one of the 9+ reviewers `/loom-code review` spawns |

---

## F-02 — Test-run row variant

Produced by `scripts/test-harness.ts`, which runs the selected test runner and emits one row per failure.

| Column | Source | Notes |
|--------|--------|-------|
| `id` | sequential `F-NN` within the iteration | — |
| `severity` | **always `blocking`** | every test failure blocks |
| `locationPath` | test file path from runner output | runner-specific parser |
| `locationAnchor` | `"{describe chain} > {it name}"` | matches vitest/bun convention |
| `summary` | first non-empty line of failure message | ANSI-stripped |
| `suggestion` | empty (no auto-suggest) | harness is a parser, not an advisor |
| `reviewerAgent` | `bun-test` \| `vitest` \| `pytest` | derived from `--runner` flag |

When all tests pass, the harness emits a valid `findings.toon` with `findings[0]:` (empty array) and `blockingCount: 0` — the driver routes to CONVERGED.

---

## F-03 — Debug row variant + synthetic symptom-still-reproduces row (OQ-01)

Produced by `scripts/debug-harness.ts`, which (1) invokes the `debug-investigator-agent`, then (2) re-runs the symptom and emits a synthetic row if it still reproduces.

### Investigator-produced rows

| Column | Source | Notes |
|--------|--------|-------|
| `severity` | investigator confidence → `high=blocking`, `medium=warning`, `low=info` | per F-03 acceptance |
| `locationPath` | investigator-identified file | repo-relative |
| `locationAnchor` | `:N` line or symbol anchor | as reported |
| `summary` | investigator hypothesis | 1-200 chars |
| `reviewerAgent` | `debug-investigator-agent` | distinct from the synthetic row |

### Synthetic symptom-still-reproduces row (OQ-01 decision)

Emitted by the harness itself (NOT the investigator) when the symptom re-run step exits non-zero:

```toon
id: F-99
severity: blocking
locationPath: <symptomPath supplied via --symptom>
locationAnchor: ":0"
summary: "symptom still reproduces"
suggestion:
reviewerAgent: "debug-harness"
```

Fixed contract:

| Field | Value |
|-------|-------|
| `severity` | `blocking` |
| `summary` | exactly `"symptom still reproduces"` |
| `reviewerAgent` | exactly `"debug-harness"` |
| `locationPath` | the `--symptom` path passed to the harness |
| `locationAnchor` | `":0"` |

When the symptom no longer reproduces, the synthetic row is **omitted**. If the investigator also produced no `blocking` rows, `blockingCount → 0` and the driver declares CONVERGED via the existing terminal check.

**No `customTerminationOutcome` field is added** to `convergence-summary.schema.md` — the synthetic-row workaround replaces the field originally proposed in CA-04, per OQ-01.

---

## F-04 — PR-review row variant + Gemini dedup rule (OQ-04)

Produced by `scripts/pr-review-harness.ts`, which delegates to a per-bot adapter based on `converge.config.botAdapter`.

| Column | Source | Notes |
|--------|--------|-------|
| `id` | sequential `F-NN` within the iteration | post-dedup |
| `severity` | parsed from inline image tag `![high\|medium\|low]` in bot comment body → `blocking\|warning\|info` | per F-04 acceptance |
| `locationPath` | bot comment `.path` field | PR-relative (== repo-relative for the head commit) |
| `locationAnchor` | `:{line}` from bot comment `.line` | line-anchored |
| `summary` | bot comment `.body` first line (after the severity tag stripped) | 1-200 chars |
| `suggestion` | bot comment `.body` remainder (optional) | 0-500 chars |
| `reviewerAgent` | bot adapter name | `gemini` \| `coderabbit` \| `copilot` |

### Cross-iteration dedup (OQ-04)

Per OQ-04, the Gemini adapter MUST suppress comments that repeat findings already reported in a prior iteration. The contract:

1. **Read prior iter's findings:** Adapter reads `.plan-execution/convergence/iterations/iter-{N-1}.toon` and extracts its `findings[]` array.
2. **Build dedup key:** For each prior finding, key = `(locationPath, locationAnchor, summary)` triple.
3. **Filter current bot comments:** Any comment producing the same `(locationPath, locationAnchor, summary)` triple is suppressed (not emitted in this iter's `findings.toon`).
4. **First iteration (N=0):** No prior `iter-{N-1}.toon` exists; no dedup; all bot comments pass through.

```toon
dedupRule:
  appliesTo: F-04 Gemini adapter
  source: ".plan-execution/convergence/iterations/iter-{N-1}.toon"
  key[3]: locationPath, locationAnchor, summary
  action: suppress matching rows before writing findings.toon
```

This dedup mechanism is the loop-oscillation guard cited in the plan's error-handling spec: "Loop oscillates (Gemini stale-anchor re-flag) → Adapter dedup suppresses → `blockingCount → 0` cleanly → CONVERGED."

The other adapters (`coderabbit`, `copilot`) are permitted but NOT required to dedup; their bots are observed to be self-deduplicating across review rounds.

### Compound dedup index

The dedup mechanism leans on the compound index already documented in `findings.schema.md` § Indexes:

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `idx_dedup` | `locationPath`, `locationAnchor`, `summary` | COMPOUND | F-04 Gemini cross-iteration dedup (OQ-04) |

The index is logical (a TOON artifact, not a database) — the F-04 adapter implements lookup via in-memory hash over the prior iter's rows. No schema change is required.

---

## Cross-references

- Canonical schema (locked, NOT modified): `protocols/findings.schema.md`
- Companion contract: `protocols/converge.config.applications.md`
- Severity mapping helper (used verbatim): `scripts/lib/aggregate-findings.ts` (`severityToConvergenceSeverity()`)
- Iteration history: `.plan-execution/convergence/iterations/iter-{N}.toon`
- Plan-of-record: `planning/plans/PLAN-convergence-applications.md`

# ConvergeConfig — Per-Application Field Extensions (F-01..F-04)

This document is a **non-modifying companion** to the locked `agents/protocols/converge.config.schema.md`. It does NOT add, rename, remove, or retype any field in the canonical `converge.config` schema. It only documents the **per-application field values** that the four new applications shipped by the convergence-applications plan supply when generating a `converge.config` file.

All field names referenced below (`mode`, `subject`, `harness`, `integrator`, `maxIterations`, `botAdapter`, `prNumber`, `runner`) are members of the canonical schema. The values in the matrix below are conformant value bindings for the four applications — not new fields.

Schema version: unchanged. Registered in `schema-versions.toon` under the existing `converge-config` entry.

Companion to: `agents/protocols/findings.applications-rows.md` (per-application finding-row variants).

---

## Hard guarantee: no schema mutation

Per CA-01 (locked substrate) and Phase 0 acceptance, this plan ships **zero modifications** to:

- `agents/protocols/converge.config.schema.md`
- `agents/protocols/findings.schema.md`
- `agents/protocols/iteration-snapshot.schema.md`
- `agents/protocols/convergence-summary.schema.md`

The Phase 0 acceptance gate is `git diff` against those four files being empty. This document only restates field-value bindings already permitted by the locked schema.

---

## Per-application field-value matrix

The convergence-applications plan introduces four `(harness + integrator + wrapper)` triples. Each wrapper emits a `converge.config` file whose fields take the values below. All four applications run in `mode: document` on the frozen document-mode substrate.

```toon
applications[4]{id,mode,subject,harness,integrator,maxIterations,botAdapter,prNumber,runner}:
  F-01,document,<target file(s) under review>,scripts/code-review-harness.ts,fixer-agent,3,,,
  F-02,document,<code under test>,scripts/test-harness.ts,fixer-agent,5,,,bun|vitest|pytest
  F-03,document,<symptom file>,scripts/debug-harness.ts,fix-applier-agent,5,,,
  F-04,document,.plan-execution/pr-review/pr-state.toon,scripts/pr-review-harness.ts,pr-fixer-agent,5,gemini|coderabbit|copilot,<int>,
```

Field-by-field notes:

| Field | F-01 | F-02 | F-03 | F-04 |
|-------|------|------|------|------|
| `mode` | `document` | `document` | `document` | `document` |
| `subject` | repo-relative target file (or comma-list) | repo-relative file or directory under test | repo-relative symptom file (failing test, repro script, error log) | `.plan-execution/pr-review/pr-state.toon` (synthetic projection — see below) |
| `harness` | `scripts/code-review-harness.ts` | `scripts/test-harness.ts` | `scripts/debug-harness.ts` | `scripts/pr-review-harness.ts` |
| `integrator` | `fixer-agent` (Integrator Mode) | `fixer-agent` (Integrator Mode) | `fix-applier-agent` (alias for `fixer-agent` in debug context) | `pr-fixer-agent` (extends `fixer-agent`) |
| `maxIterations` | 3 | 5 | 5 | 5 |
| `botAdapter` | (unused) | (unused) | (unused) | `gemini` \| `coderabbit` \| `copilot` |
| `prNumber` | (unused) | (unused) | (unused) | integer; resolved by wrapper from `gh pr view` |
| `runner` | (unused) | `bun` \| `vitest` \| `pytest` | (unused) | (unused) |

Unused fields are omitted from the per-application `converge.config` (the canonical schema treats them as optional). No new optional fields are introduced — `botAdapter`, `prNumber`, and `runner` are members of the canonical schema already, gated by `mode`/`harness` discriminants.

---

## OQ-02 binding: `subject` MUST resolve to a real file

Per the plan's OQ-02 decision:

> `subject` MUST resolve to a real file under repo root. F-04 uses `.plan-execution/pr-review/pr-state.toon` as a synthetic projection so the snapshot mechanism in `hooks/lib/iteration-snapshot.ts` works without modification.

Consequences for harnesses and wrappers:

1. F-01, F-02, F-03 pass through user-supplied paths; the wrapper MUST validate the path exists before invoking `/loom-converge`.
2. F-04's wrapper MUST refresh `pr-state.toon` **before** the first iteration so `subject` is readable when `convergence-driver` snapshots it.
3. `hooks/lib/iteration-snapshot.ts` is **not modified** — it reads `subject` as a real file in all four cases.

---

## F-04 `pr-state.toon` projection shape

`pr-state.toon` is a real file on disk used as F-04's `subject`. It is produced by the PR-review harness's first action each iteration and is NOT a schema-extension of `converge.config` — it's an artifact the harness owns. Documented here so downstream agents know the shape.

Atomic write required: harness writes `{path}.tmp` then renames per `execution-conventions.md`.

```toon
prNumber: 1234
baseSha: a1b2c3d4
headSha: f9e8d7c6
diffHash: sha256:...
producedAt: 2026-06-15T03:44:00Z

files[N]{path,status,additions,deletions}:
  src/foo.ts,modified,12,3
  test/foo.test.ts,added,40,0

comments[N]{id,author,path,line,body,createdAt}:
  IC_kw1,gemini-bot,src/foo.ts,42,"![high] null deref possible",2026-06-15T03:43:50Z
```

| Field | Type | Notes |
|-------|------|-------|
| `prNumber` | integer | Resolved from `gh pr view` |
| `baseSha` | string | Base commit SHA (short or full) |
| `headSha` | string | PR head SHA — changes each iteration as `pr-fixer-agent` commits |
| `diffHash` | string | Stable hash of the unified diff; lets the driver detect "no change since last iter" |
| `producedAt` | ISO-8601 timestamp | When the harness refreshed the projection |
| `files[]` | array | File changes in the PR (from `gh pr diff` parse) |
| `comments[]` | array | All bot review comments observed so far (raw — dedup happens in F-04 row variant, not here) |

`pr-state.toon` is overwritten each iteration. Per-iteration history lives in `iter-{N}.toon` via the existing snapshot mechanism.

---

## Cross-references

- Canonical schema (locked, NOT modified): `agents/protocols/converge.config.schema.md`
- Companion contract: `agents/protocols/findings.applications-rows.md`
- Snapshot mechanism (used verbatim): `hooks/lib/iteration-snapshot.ts`
- Driver loop (locked): `agents/convergence-driver.md`
- Plan-of-record: `planning/plans/PLAN-convergence-applications.md`

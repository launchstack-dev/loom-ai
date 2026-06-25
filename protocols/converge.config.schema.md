---
schemaName: converge.config
version: 1
status: locked
---

# converge.config Schema

## Purpose

A `converge.config.toon` file is the **input contract** every `/loom-converge` invocation reads. It names the run's `convergenceMode` (target | criteria | document), the `subject` under iteration (if any), the `harness` that emits `findings.toon`, the `integrator` agent that applies findings, and the run's iteration/spawn budgets. It is plan-neutral: the same shape is consumed by `/loom-converge`, `convergence-driver`, and every per-application wrapper (see `converge.config.applications.md`). All other convergence artifacts (`convergence-state.toon`, `findings.toon`, `iter-{N}.toon`, `convergence-summary.toon`) reference field values originally bound here.

Schema version: **1**. Registered in `schema-versions.toon` as `converge-config`.

---

## File Location

| Path | Notes |
|------|-------|
| `.plan-execution/convergence/converge.config.toon` | Default; ONE file per run, passed to `/loom-converge --config` |
| User-supplied path via `--config <path>` | Wrappers (F-01..F-04) may emit elsewhere; `--resume-config` re-reads the same path |

**Atomic writes required.** Wrappers MUST write to `{path}.tmp` then rename. The driver reads the config once at preflight and does NOT mutate it mid-run.

---

## Field Table

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `runId` | string | yes | UUID-shaped; matches `conv-{YYYY-MM-DD-HH-mm-ss}-{NNN}` (driver-generated when omitted by wrapper) | Unique identifier mirrored into `convergence-state.toon.runId` and `convergence-summary.toon.runId`. Authoritative correlation key for all per-run artifacts. |
| `convergenceMode` | enum | yes | one of `target`, `criteria`, `document` | Selects the loop variant. `target` matches a fixture; `criteria` checks TDD-style criteria; `document` iterates a single subject file (the document-mode substrate used by F-01..F-04). |
| `subject` | string (path) \| null | conditional | required (non-null) when `convergenceMode == document`; null otherwise; MUST resolve to a real file under repo root (OQ-02) | The file under iteration in document mode. For `target` / `criteria` modes the literal `null` ("subject is the entire codebase"). |
| `harness` | string (path) | yes | repo-relative path to an executable harness file that MUST exist on disk at preflight | Producer of `findings.toon` each iteration. Examples: `scripts/code-review-harness.ts` (F-01), `scripts/test-harness.ts` (F-02), `scripts/pr-review-harness.ts` (F-04). |
| `integrator` | string | yes | agent name resolvable in `.claude/agents/` or `orchestration.toml` | Agent invoked to apply findings. Examples: `fixer-agent`, `plan-builder-agent`, `pr-fixer-agent`. |
| `maxIterations` | integer | yes | `>= 1`; default `10` when wrapper omits | Hard cap on iterations. When reached without `blockingCount == 0`, driver halts with `MAX_ITERATIONS`. |
| `agentBudget` | integer | yes | `>= 1` | Cumulative agent-spawn cap across the run. When exceeded, driver halts with `BUDGET_EXHAUSTED`. |
| `snapshotEnabled` | boolean | optional | default `true` when `convergenceMode == document`; default `false` for `target` / `criteria` | Controls whether `hooks/lib/iteration-snapshot.ts` writes `iter-{N}.toon` per iteration. Default-on for document mode resolves DF-02 (dogfood Pass 1 finding) and ratifies C-07. |
| `outputDir` | string (path) | optional | repo-relative directory; default `.plan-execution/convergence/` | Where the driver writes `convergence-state.toon`, `findings.toon`, `iter-{N}.toon`, and `convergence-summary.toon`. Wrappers may redirect (e.g., F-04 uses `.plan-execution/pr-review/`). |

---

## TOON Example (document mode)

```toon
runId: conv-2026-06-14-12-00-00-001
convergenceMode: document
subject: planning/plans/PLAN-convergence-applications.md
harness: scripts/plan-review-harness.ts
integrator: plan-builder-agent
maxIterations: 10
agentBudget: 40
snapshotEnabled: true
outputDir: .plan-execution/convergence/
```

---

## Validation Rules

1. **Required fields present.** `runId`, `convergenceMode`, `harness`, `integrator`, `maxIterations`, `agentBudget` MUST all be present. `subject` is required (non-null) iff `convergenceMode == document`. `snapshotEnabled` and `outputDir` are optional (defaults apply per Field Table).
2. **`convergenceMode` enum.** MUST be exactly one of `target`, `criteria`, `document`. Any other value is a `FINDINGS_SCHEMA_INVALID`-class preflight defect.
3. **Subject-mode consistency (OQ-02).** When `convergenceMode == document`, `subject` MUST be a non-null repo-relative path that resolves to a real file under the repo root at preflight time. When `convergenceMode` is `target` or `criteria`, `subject` MUST be `null` (or absent).
4. **`harness` resolvable.** The path MUST exist on disk at preflight; preflight failure → `HARNESS_MISSING`.
5. **`integrator` resolvable.** MUST match a registered agent name (project-local `.claude/agents/` or `orchestration.toml`); preflight failure → `INTEGRATOR_NOT_FOUND`.
6. **Integer bounds.** `maxIterations >= 1`. `agentBudget >= 1`. Both MUST be positive integers (no floats).
7. **`runId` immutability.** Once written, `runId` MUST NOT change across `--resume` invocations on the same config.
8. **`snapshotEnabled` default.** When the field is absent, the driver MUST treat it as `true` for `convergenceMode == document` and `false` otherwise. Wrappers MAY emit the explicit value for clarity. (DF-02 resolution.)
9. **`outputDir` writability.** When supplied, the directory MUST be creatable / writable by the driver at preflight.

Preflight failures (rules 2, 3, 4, 5) abort the run BEFORE iteration 1 and do NOT produce a `convergence-summary.toon` — see `convergence-summary.schema.md` for the cleanup contract.

---

## Cross-references

- `protocols/findings.schema.md` — per-iteration findings shape consumed by the driver; `findings.toon.blockingCount` is the convergence signal.
- `protocols/iteration-snapshot.schema.md` — `iter-{N}.toon` shape, gated by `snapshotEnabled`.
- `protocols/convergence-summary.schema.md` — terminal-state artifact; mirrors `runId`, `convergenceMode`, `subject`, and references `maxIterations` / `agentBudget` as halt thresholds.
- `agents/convergence-driver.md` — consumer of this config; defines the preflight + loop semantics.

## Application extensions

Per-application field-value bindings for F-01..F-04 (code review, test, debug, PR review) live in `protocols/converge.config.applications.md`. That companion document is **non-modifying** — it binds values to existing fields and never adds, renames, or retypes a field defined here.

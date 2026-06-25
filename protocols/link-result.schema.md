# Link Result Schema

The envelope every `/loom-auto` link writes to `.plan-execution/link-result.toon` before returning. The trampoline reads this file (not the agent's text return) to decide which link to dispatch next.

A `LinkResult` is the trampoline-side equivalent of an `AgentResult`. They are distinct because:

- `AgentResult` is the universal return contract every agent uses (per `agent-result.schema.md`).
- `LinkResult` is the routing contract between a link and the trampoline — it adds `nextLink`, gate provenance, and forward-looking hints for the next link.

A link writes BOTH: an `AgentResult` as its conversational return, and a `link-result.toon` on disk with the structured envelope.

## File location

```
.plan-execution/link-result.toon
```

There is exactly one `link-result.toon` at a time. Each link **overwrites** the file. Historical link results are recovered from `pipeline-state.toon.linkHistory[]` (lightweight) or from the link's own `stage-context/*.toon` files (full payload).

## Schema

```toon
schemaVersion: 1
link: verify
linkVersion: 1
runId: 7a3b9c10-1d4e-4f8a-b2c1-09e7d6f5a4b3
trampolineIteration: 3
outerIteration: 1
status: complete
startedAt: 2026-06-12T14:22:18Z
completedAt: 2026-06-12T14:26:47Z
durationMs: 269000
agentsSpawned: 2
nextLink: fix
nextLinkReason: fix-and-recheck

gateInputs:
  criticalCount: 3
  warningCount: 5
  infoCount: 12
  testsPassed: 47
  testsFailed: 1
  testPassRate: 0.979
  typecheckPass: true
  convergeStatus: converged
  convergeMode: criteria
  convergePassing: 12
  convergeTotal: 12
  convergeFrozen: 0
  unitGatePass: true
  integrationGatePass: true
  e2eGatePass: true
  fixCycleCount: 0
  outerIteration: 1
  gateFailCount: 0
  gateWarnCount: 1

fixHints:
  fixMode: standard
  postFixHint: none
  prioritizedFindings[3]: F-c-0001, F-c-0002, F-c-0003

planningHints:

outcomeHints:

artifacts[4]:
  .plan-execution/stage-context/test.toon
  .plan-execution/stage-context/review.toon
  .plan-execution/review-report.md
  .plan-execution/pipeline-state.toon

contextHints:
  needsReadingByNext[3]:
    .plan-execution/review-report.md
    .plan-execution/stage-context/review.toon
    .plan-execution/pipeline-state.toon
  canSkipReading[3]:
    PLAN.md
    ROADMAP.md
    .plan-execution/rolling-context.md

verificationStatus: verified
notes[1]: review-agent retried once on transient timeout; results stable on retry

summary: 3 critical / 5 warning, 1 failing test, gate routed to fix
```

## Field Reference

### Identity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | int | yes | Current: `1`. |
| `link` | enum | yes | Link name: `planning`, `execute`, `converge`, `verify`, `fix`. The trampoline validates this matches the link it dispatched. |
| `linkVersion` | int | yes | Version of the specific link's contract (in `commands/loom-auto/links/{link}.md`). Bumps if the link's I/O contract changes. |
| `runId` | uuid | yes | Mirrors `pipeline-state.toon.runId`. Trampoline rejects envelopes with mismatched runId. |
| `trampolineIteration` | int | yes | Trampoline iteration when this link was dispatched. Used to detect stale envelopes from prior runs. |
| `outerIteration` | int | yes | Outer plan-revision counter at link start. |

### Outcome

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | enum | yes | One of: `complete` (link finished and gate routed), `failed` (link encountered a fatal error mid-execution), `escalated` (link explicitly halted the pipeline), `stopped-early` (link respected a `--stop-after` flag). |
| `startedAt` | ISO-8601 | yes | Link entry timestamp. |
| `completedAt` | ISO-8601 | yes | Link return timestamp. |
| `durationMs` | int | yes | `completedAt - startedAt` in milliseconds. |
| `agentsSpawned` | int | yes | Number of sub-agents the link spawned. Trampoline adds this to `pipeline-state.toon.agentsSpawned`. |
| `nextLink` | enum | yes | What the trampoline should dispatch next: `planning`, `execute`, `converge`, `verify`, `fix`, `done`. |
| `nextLinkReason` | string | yes | Why this `nextLink` was chosen. Standard values: `proceed`, `fix-and-recheck`, `fix-and-reconverge`, `revise-plan`, `revise-roadmap`, `escalate-{reason}`, `stopped-early`. Custom values allowed; trampoline routes by `nextLink` and logs `nextLinkReason`. |

### Gate provenance

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gateInputs` | block | yes if link computes a gate (verify, fix) | Snapshot of every value that fed into the routing decision. Lets the trampoline log the decision without recomputing and lets a future audit re-derive the route from disk alone. Schema is link-specific — see "Per-link extensions" below. |

### Decision-specific hints

Exactly **one** of `fixHints` / `planningHints` / `outcomeHints` is populated based on `nextLink`. The others are emitted empty (or omitted entirely — readers must tolerate both forms).

| Field | Populated when | Required keys |
|-------|----------------|---------------|
| `fixHints` | `nextLink == fix` | `fixMode` (enum: `standard`, `aggressive`, `targeted`), `postFixHint` (enum: `none`, `reconverge`), `prioritizedFindings[N]` (finding ids from `review-report.md`) |
| `planningHints` | `nextLink == planning` | `planningMode` (enum: `refine`, `refine-roadmap`), `incrementOuterIteration` (bool), `failureSummary` (string) |
| `outcomeHints` | `nextLink == done` | `outcome` (enum: `success`, `escalated`), `escalationReason` (string, required when outcome is `escalated`) |

### Artifacts and context routing

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `artifacts[N]` | string[] | yes | Paths to files this link wrote. Used for `linkHistory[]` and post-mortem. |
| `contextHints.needsReadingByNext[N]` | string[] | yes | Paths the next link MUST read on entry, in priority order. The trampoline forwards this list into the next link's prompt. |
| `contextHints.canSkipReading[N]` | string[] | recommended | Paths the next link can safely skip. Explicit "don't read this" hints reduce context bloat in downstream links. |

### Behavioral telemetry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `verificationStatus` | enum | yes | `verified`, `unverified`, or `skipped` per `behavioral-guidelines.md` section 7. Aggregates the verification status of sub-agents spawned within the link. |
| `notes[N]` | string[] | optional | Non-fatal anomalies: retries, model-resolution fallbacks, missing optional inputs, agent warnings. |
| `summary` | string | yes | One-line human summary, max 200 characters. Used in the trampoline's between-link readout (`commands/loom-auto.md` Step 4-6c). |

## Per-link `gateInputs` extensions

Each link that computes a gate decision defines its own `gateInputs` shape. The fields above are the **verify** link's contract. Future links extend the same field with their relevant inputs:

| Link | `gateInputs` purpose | Status |
|------|----------------------|--------|
| `verify` | Quality gate inputs (see schema above). | Implemented (Phase 1). |
| `fix` | Before/after diff: `criticalBefore`, `criticalAfter`, `warningBefore`, `warningAfter`, `testsFailedBefore`, `testsFailedAfter`, `typecheckBefore`, `typecheckAfter`, `progressDetected`, `stuckDetected`, `regressionDetected`, `diagnoseLogPresent`, `fixerSelfVerified`, `fixCycleCount`, `fixMode`, `postFixHint`. | Implemented (Phase 2). |
| `execute` | Wave + tier gate inputs: `executorStatus`, `wavesCompleted`, `wavesTotal`, `unitGatesPassed`, `unitGatesTotal`, `integrationGatesPassed`, `integrationGatesTotal`, `e2eGatesPassed`, `e2eGatesTotal`, `qaCriticalFindings`, `contractViolations`, `filesChangedCount`, `agentsSpawnedByExecutor`, `wikiUpdateStatus`, `waveDeadlockDetected`. | Implemented (Phase 3). |
| `converge` | Convergence outcome: `status`, `iterations`, `passing`, `total`, `frozen`, `regression`. | Reserved (Phase 4). |
| `planning` | Validation outcomes: `roadmapValid`, `planValid`, `interpretationConflicts`, `blockingConflicts`. | Reserved (Phase 5). |

When a new link is introduced, its `commands/loom-auto/links/{link}.md` spec MUST document its `gateInputs` shape. This file is the index of canonical shapes.

## Rules

1. **Atomic writes.** Write to `link-result.toon.tmp`, then rename. Never write partial envelopes.
2. **One envelope per dispatch.** A link writes `link-result.toon` exactly once, just before returning. Re-dispatched links (resume) re-emit the same envelope if it already exists for the current `trampolineIteration` — they do not append.
3. **Idempotent resume.** If a link is invoked with `--resume` and a valid `link-result.toon` exists for the current `trampolineIteration` + `runId`, the link MAY return immediately without re-running sub-agents. The trampoline must read the existing envelope and route from it.
4. **Trampoline validates.** Before routing, the trampoline checks `schemaVersion`, `link`, `runId`, and `trampolineIteration` match the dispatch context. On mismatch, treat the envelope as corrupted: write to `failureLog`, set `currentStage: escalated`, do not route.
5. **No nested links.** A link MUST NOT dispatch other links via the Agent tool. Only the trampoline dispatches. Within a link, the existing team-coordination protocol (`team-coordination.md`) applies for sub-agent parallelism.
6. **Single source of truth.** The trampoline reads `link-result.toon`, not the link's `AgentResult` text. The text return is a courtesy acknowledgment for the user; routing data lives only on disk.
7. **Schema migration.** `linkVersion` bumps when a specific link's I/O contract changes. `schemaVersion` bumps when this universal envelope changes (new required fields, breaking removals). Readers tolerate older `schemaVersion` files; writers always emit the current `schemaVersion`.

## Cross-references

- `agent-result.schema.md` — the universal AgentResult contract every link's text return follows.
- `pipeline-state.schema.md` — the trampoline state file. Reads `nextLink` from this envelope to update `pipeline-state.toon.nextLink` and append to `linkHistory[]`.
- `stage-context.schema.md` — per-stage summary files written alongside `link-result.toon`. `link-result.toon.artifacts[]` typically references one or more `stage-context/*.toon` files.
- `~/.claude/commands/loom-auto.md` — trampoline routing logic (Step 4-6b: read envelope, Step 4-6c: print readout, Step 4-6d: dispatch nextLink).
- `~/.claude/commands/loom-auto/links/verify.md` — first concrete link implementation; reference example for future links.

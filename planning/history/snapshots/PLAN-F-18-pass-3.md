---
planVersion: 2
name: "Matt Pocock Skills Adoption (F-18)"
status: draft
created: 2026-06-25
lastReviewed: null
roadmapRef: planning/ROADMAP.md
totalPhases: 9
totalWaves: 7
featureRef: F-18
milestoneRef: M-08
---

# Plan: Matt Pocock Skills Adoption (F-18)

## Overview

<!-- Applied: P-01 (C-06 citation), P-05 (compress to ≤3 sentences) -->
F-18 adopts the highest-leverage engineering patterns from `mattpocock/skills` (MIT) into Loom per locked decision **C-06 (superpowers patterns adoption)**, sequenced across five phases plus a coverage-audit phase. The headline behavioural change is a tight-red feedback-loop discipline (Phase B) that halts `loom-bugfix`/`loom-converge` until a verified-red `loop.toon` envelope exists, with an explicit 10-rung escalation ladder and named `stuck-at-loop-construction` HITL state. Phases A/C/D/E surround that change with the foundations, planning quality, inbox + ADR hygiene, and session/presentation polish required to make it stick — full per-phase scope appears in `## Execution Phases` below. F-19 is OUT OF SCOPE for this plan.

<!-- Long-form per-phase summary moved into per-phase Objective fields per P-05 -->

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Agent / command format | Markdown + YAML frontmatter | — | Claude Code surface |
| On-disk data format | TOON | 1 | All Loom artifacts per CLAUDE.md |
| Schemas | Markdown protocol docs | — | `protocols/*.md` and `protocols/*.schema.md` |
| Scripts / migrators | TypeScript (bun runtime) | — | Schema migrators, content migrators |
| Tests | Vitest | latest | TS unit + integration tests |
| Test runner harness (bootstrap) | `/loom-plan test` (prior-gen, one-shot, no `--autoconverge`) | — | Sub-23: F-18 self-tested with prior-gen harness |
| Atomic file writes | `fs.renameSync` from `.tmp` | — | Mandatory per CLAUDE.md |
| ADR storage | Plain Markdown at `docs/adr/NNNN-*.md` | — | Lazy decision record |
| HTML render (sub-18) | Plain HTML template strings (no framework) | — | Opt-in fallback for status / deepen / audits |

## Schema / Type Definitions

The roadmap Data Model defines 12 entities used in this plan: `FeedbackLoop`, `OutOfScopeEntry`, `TriageState`, `ADR`, `CodebaseDesignVocab`, `SkillAuthoringPrinciple`, `Handoff`, `Prototype`, plus the pre-existing `ConvergenceTier`, `WikiPage`, `AgentResult`, and `PlanPhase`. Every entity referenced in a phase's deliverables or acceptance criteria is defined below.

### FeedbackLoop (Phase B, sub-5)

Lives on disk at `.plan-execution/loops/{loopId}.toon`. The convergence/bugfix Phase-0 loop-construction gate writes and reads this.

| Field | Type | Constraints | Validation Rule |
|-------|------|-------------|-----------------|
| `loopId` | string | UUID v4, primary key | matches `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` |
| `command` | string | non-empty, shell-executable single command | min length 1, max 4096 |
| `symptom` | string | non-empty, ≤ 500 chars, one-sentence | min length 1, max 500 |
| `rung` | integer | 1–10, current ladder rung | range 1..10 |
| `verifiedRed` | boolean | required | — |
| `redOutput` | string \| null | captured stderr+stdout when `verifiedRed=true` | max 64KB; truncate with marker |
| `runtimeMs` | integer | wall-time of last red verification | ≥ 0 |
| `determinismRuns` | integer | how many consecutive red runs observed | ≥ 2 to pass TRDA `deterministic` <!-- Applied: FC-H1 — reconciled with state-machine entry condition --> |
| `retiredAt` | string (ISO 8601) \| null | set by `loom-converge`/`loom-bugfix` when symptom is green and stays green across a verification run | null until retirement; immutable after set |
| `escalationHistory[]` | table | one row per escalation event | each row: `{fromRung:int, toRung:int, reason:string, at:ISO8601}` |
| `linkedLoops[]` | table | sibling/child relations | each row: `{loopId:UUID, relation: child\|sibling\|spawned-from-symptom}` |
| `parentLoopId` | string (UUID) \| null | optional parent for child loops | FK → FeedbackLoop.loopId |
| `trda` | object | required, four booleans | `{tight:bool, redCapable:bool, deterministic:bool, agentRunnable:bool}` — ALL four MUST be true to pass the gate |
| `escapeReason` | string \| null | populated by `--override-loop-gate "<reason>"` | min length 8 when set; recorded in convergence digest |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_loop` | loopId | PRIMARY | Row lookup |
| `idx_loop_parent` | parentLoopId | INDEX | Walk loop trees |
| `idx_loop_retired` | retiredAt | INDEX | `--loops` table filters active vs retired |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| FeedbackLoop (parent) | FeedbackLoop (child via `parentLoopId`) | SET NULL | CASCADE |
| FeedbackLoop | FeedbackLoop (linkedLoops[].loopId) | SET NULL | CASCADE |

### OutOfScopeEntry (Phase A, sub-14 schema)

Schema in `protocols/out-of-scope.schema.md`. Entries live as one Markdown file per entry at `.out-of-scope/{id}.md` with TOON frontmatter.

| Field | Type | Constraints | Validation Rule |
|-------|------|-------------|-----------------|
| `id` | string | `OOS-{NN}`, zero-padded, unique | matches `^OOS-\d{2,}$` |
| `idea` | string | one-line summary, max 200 chars | min 1, max 200 |
| `rejectedAt` | string (ISO 8601) | required | — |
| `rejectedBy` | enum | `human` \| `agent` | — |
| `rationale` | string | required, min 20 chars | — |
| `sourceProposalId` | string \| null | optional FK to roadmap feature, change-proposal id, or wiki note id | — |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_oos` | id | PRIMARY | Lookup |
| `idx_oos_source` | sourceProposalId | INDEX | Reverse-link from feature proposals |

#### Cascade Behavior

No FKs cascade — OOS entries are immutable once written.

### TriageState (Phase D, sub-13)

Lives in `loom-note` inbox files at `inbox/{id}.md` (TOON frontmatter).

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `NOTE-{NN}`, unique |
| `category` | enum | `bug` \| `enhancement` |
| `state` | enum | `needs-triage` \| `needs-info` \| `ready-for-agent` \| `ready-for-human` \| `wontfix` |
| `createdAt` | string (ISO 8601) | required |
| `updatedAt` | string (ISO 8601) | required, refreshed on every transition |
| `transitions[]` | table | append-only audit log; each row `{from, to, at:ISO8601, actor:human\|agent, reason:string\|null}`. **Validation rule (Applied: FC-B1):** `reason` MUST be non-null when `(from=needs-triage AND to=wontfix)` OR `(from=wontfix AND to=*)` (reopen path) OR `(from=needs-info AND to=wontfix)`. Schema parser rejects null `reason` on these transitions. |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_triage` | id | PRIMARY | Lookup |
| `idx_triage_state` | state, category | COMPOUND | Inbox listing |
| `idx_triage_updated` | updatedAt | INDEX | 30-day timeout sweep |

#### Cascade Behavior

No FKs.

### ADR (Phase A, sub-3)

Lives at `docs/adr/{NNNN}-{kebab-title}.md`. Body is Markdown; frontmatter is YAML.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `ADR-{NNNN}`, zero-padded 4-digit, monotonically allocated |
| `title` | string | one-line, max 120 chars |
| `status` | enum | `proposed` \| `accepted` \| `deprecated` \| `superseded` |
| `decision` | string | the chosen path, ≥1 paragraph |
| `rationale` | string | why; what was rejected; what was at stake |
| `supersededBy` | string \| null | FK `ADR-{NNNN}` when `status=superseded` |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| `pk_adr` | id | PRIMARY | Lookup |
| `idx_adr_status` | status | INDEX | `--list-deprecated` etc. |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ADR (superseded record) | ADR (superseder via `supersededBy`) | SET NULL | CASCADE |

### CodebaseDesignVocab (Phase A, sub-1) — protocol-document only

| Field | Type | Constraints |
|-------|------|-------------|
| `term` | string | Module, Interface, Depth, Seam, Adapter, Leverage, Locality (Section 0 may extend) |
| `definition` | string | required |
| `useWhen` | string | guidance for when this term applies |
| `conflictsWithLoomTerm` | string \| null | optional Loom-native term this collides with (drives Section 0 mapping table) |

No runtime artifact; no indexes; no cascades.

### SkillAuthoringPrinciple (Phase A, sub-4) — protocol-document only

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | string | predictability, leading-word, completion-criterion, premature-completion, sediment, duplication |
| `definition` | string | required |
| `failureMode` | string | what goes wrong when violated |
| `noOpTestRule` | string | the sentence-level no-op test that catches this failure |

### Handoff (Phase E, sub-16)

Lives in OS tmp dir (e.g., `/tmp/loom-handoff-{id}.md`); workflow state remains in `.plan-execution/`.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `HANDOFF-{ISO8601-compact}-{shortHash}` |
| `createdAt` | string (ISO 8601) | required |
| `suggestedSkills[]` | string[] | model-invokable skills the resumer should consider |
| `referencedArtifacts[]` | string[] | paths to PRDs/ADRs/issues (no duplication of content) |
| `redactedSecretsCount` | integer | how many secrets were stripped during redaction pass |

### Prototype (Phase C, sub-12)

Lives at `prototypes/{name}/`. Completion ceremony writes `prototypes/{name}/answer.toon`.

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | string | kebab-case, unique |
| `branch` | enum | `logic` \| `ui` |
| `capturedAnswerAdrRef` | string \| null | FK `ADR-{NNNN}` when an originating ADR exists |
| `answerToonPath` | string | always `prototypes/{name}/answer.toon` |
| `createdAt` | string (ISO 8601) | required |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| ADR | Prototype (`capturedAnswerAdrRef`) | SET NULL | CASCADE |

### convergence-state.toon v2 additions (Phase A, sub-4b)

`convergence-state.toon` v1→v2 gains:

```
loops[N]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}:
  ...
```

#### SQL-equivalent invariants

- `loops[].loopId` MUST be unique within a `convergence-state.toon` document.
- Every `loops[].loopId` MUST resolve to an existing file at `.plan-execution/loops/{loopId}.toon`.

#### Migration provenance

Schema version detection follows the F-13 walker pattern exactly:

- `detectConvergenceStateVersion(content) -> {detected:int, current:int, outdated:bool}`
- `migrateConvergenceStateV1toV2(content) -> string` — pure function, idempotent, writes nothing.
- The migrator is invoked from a top-level CLI script `scripts/migrate-convergence-state.ts`.

### findings.schema.md `confidence` addition (Phase B, sub-9b)

`findings[].confidence: high|medium|low` — backward-compatible default `medium`.

## API Specification

F-18 introduces no HTTP endpoints; the "API surface" of this milestone is the CLI/slash-command surface. Each new or modified slash command is specified here in the equivalent format. Behavior notes capture file side effects.

### `/loom-which` (Phase A sub-4c)

**Description:** Human-facing decision-tree router that asks 1–3 questions to recommend a slash command or skill for the user's current situation.
**Auth:** none (in-process Claude Code skill).

**Path parameters:** none.

**Invocation arguments:**

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `<free-text>` | string | no | — | Optional natural-language description; bypasses the first decision-tree question when supplied. |

**Success response:** plain-text recommendation block printed to stdout (no JSON; Claude Code skill surface).

**Error responses:**

| Status | Code | When |
|--------|------|------|
| n/a | `NO_MATCH` | The decision tree exhausts without a recommendation; falls back to suggesting `/loom-reference`. |

**Behavior notes:**

- Distinct from `loom-do` (model-facing, infers intent silently) and `/loom-reference` (flat table lookup).
- One question at a time; max 3 questions; each step recommends an answer per `protocols/grilling.md` discipline.

**Decision tree (canonical):** <!-- Applied: UX-B3 -->

The `/loom-which` skill walks the following decision tree. Internal nodes (`N-NN`) carry a `question` string and an array of `branches` labels. Leaf nodes (`L-*`) carry a `leafRecommendation` string naming the recommended `/loom-*` command. The first-question text is `nodes[0].question` and is presented to the user verbatim. Branch labels in `branches` are presented as numbered choices in the order listed.

```toon
nodes[12]{id,question,branches,leafRecommendation}:
  N-01,"What kind of task are you on?","[bug, feature, design, planning, audit, unclear]",null
  N-02,"Bug — do you have a tight, reliably-red reproduction command?","[yes, partial, no]",null
  N-03,"Feature — is there an approved ROADMAP.md entry for it yet?","[yes-approved, drafted-not-approved, no-roadmap]",null
  N-04,"Design — are you exploring shape (codebase health, deepening) or capturing a decision (ADR)?","[shape, decision, throwaway-prototype]",null
  N-05,"Planning — do you need to convert a roadmap to a plan, review an existing plan, or execute one?","[convert, review, execute]",null
  N-06,"Audit — what surface are you auditing?","[coverage, attribution, skill-autoload, sediment]",null
  L-bugfix-tight,null,null,"/loom-bugfix --autoconverge"
  L-bugfix-construct,null,null,"/loom-bugfix (default path; Phase-1 gate will help you construct loop.toon)"
  L-feature-roadmap,null,null,"/loom-plan create (roadmap exists; ready for plan)"
  L-feature-draft-roadmap,null,null,"/loom-roadmap converge (drive the roadmap to ready first)"
  L-feature-new,null,null,"/loom-roadmap init (no roadmap yet)"
  L-design-shape,null,null,"/loom-deepen --target <subtree>"
  L-design-decision,null,null,"Write an ADR at docs/adr/{NNNN}-{title}.md per docs/adr/README.md"
  L-design-throwaway,null,null,"/loom-prototype <name> --branch <logic|ui>"
  L-plan-convert,null,null,"/loom-plan create"
  L-plan-review,null,null,"/loom-plan review"
  L-plan-execute,null,null,"/loom-plan execute"
  L-audit-coverage,null,null,"scripts/coverage-audit/f18-audit.ts --validate <PATH>"
  L-audit-attribution,null,null,"bunx vitest run tests/regressions/no-per-file-attribution.test.ts"
  L-audit-autoload,null,null,"scripts/skill-autoload-audit/classify.ts"
  L-audit-sediment,null,null,"scripts/sediment-sweep/no-op-test.ts"
  L-unclear-fallback,null,null,"/loom-reference (no clear match; consult the flat reference table)"
```

```toon
edges[18]{fromNode,branch,toNode}:
  N-01,bug,N-02
  N-01,feature,N-03
  N-01,design,N-04
  N-01,planning,N-05
  N-01,audit,N-06
  N-01,unclear,L-unclear-fallback
  N-02,yes,L-bugfix-tight
  N-02,partial,L-bugfix-construct
  N-02,no,L-bugfix-construct
  N-03,yes-approved,L-feature-roadmap
  N-03,drafted-not-approved,L-feature-draft-roadmap
  N-03,no-roadmap,L-feature-new
  N-04,shape,L-design-shape
  N-04,decision,L-design-decision
  N-04,throwaway-prototype,L-design-throwaway
  N-05,convert,L-plan-convert
  N-05,review,L-plan-review
  N-05,execute,L-plan-execute
  N-06,coverage,L-audit-coverage
  N-06,attribution,L-audit-attribution
  N-06,skill-autoload,L-audit-autoload
  N-06,sediment,L-audit-sediment
```

Per grilling discipline (rules GR-01..GR-05), the skill asks **one** question at a time, **recommends** the most common branch as the default for each node (the first branch label in the order listed), and walks every branch (never collapses to the recommendation silently). Max depth from `N-01` to any leaf is 2 questions; the 3-question cap in the invocation arguments section is the hard upper bound.

### `/loom-deepen` (Phase C, sub-10)

**Description:** Periodic deepening report. Uses `Explore` subagents, applies the deletion test, surfaces shallow modules.
**Auth:** none.

**Invocation arguments:**

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `--html` | flag | no | false | Emit an HTML render in addition to canonical TOON. |
| `--target <path>` | string | no | repo root | Scope the deepening scan to a subtree. |
| `--limit <N>` | integer | no | 10 | Cap on candidates emitted. |

**Success response:**

- Canonical TOON at `.plan-execution/reports/deepen-{YYYY-MM-DD}.toon` with rows `{moduleName, depthBefore, depthAfter, deletionTestResult, recommendation}`.
- Optional HTML at `.plan-execution/reports/deepen-{YYYY-MM-DD}.html` when `--html` is passed.
- stdout prints the TOON-rendered summary table.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| exit 2 | `EXPLORE_AGENT_FAILED` | At least one `Explore` subagent returned a non-success AgentResult; deepening report still emits with `partial: true`. |
| exit 3 | `HTML_OPEN_FAILED` | `--html` was passed and `open`/`xdg-open`/`start` failed. Falls back to printing the HTML path; exit 0. |

**Behavior notes:**

- Uses `protocols/codebase-design.md` vocabulary (Module, Seam, Depth, Adapter).
- Default output is TOON; HTML is never the only output.

### `/loom-prototype` (Phase C, sub-12)

**Description:** Author throwaway code as a deliberate phase. Two branches: logic (terminal app) or ui (parallel UI variants on one route).
**Auth:** none.

**Invocation arguments:**

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `<name>` | string | yes | — | kebab-case prototype name. |
| `--branch <logic\|ui>` | enum | yes | — | Branch type. |
| `--adr <ADR-NNNN>` | string | no | — | Originating ADR; the completion ceremony updates this ADR with the captured answer. |

**Success response:**

- Files scaffolded under `prototypes/{name}/` (clearly marked throwaway, single run command, no persistence).
- On user-signaled completion: a one-line TOON summary written to `prototypes/{name}/answer.toon` and, if `--adr` was set, the referenced ADR is updated with a `prototypeAnswer:` line.
- stdout prints the explicit done state.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| exit 1 | `PROTOTYPE_EXISTS` | `prototypes/{name}/` already exists. |
| exit 2 | `ADR_NOT_FOUND` | `--adr` was passed but the ADR file does not exist. |

**Behavior notes:**

- No polish, no tests, no persistence — these are explicit non-features.
- Slots into `loom-roadmap:explore` or between roadmap and plan.

### `loom-bugfix` — modified surface (Phase B, sub-7)

**Description:** Rapid bug fixing — F-18 adds a Phase-1 loop-construction gate that applies to ALL entry paths (autoconverge AND default analyst).
**Auth:** none.

**Invocation arguments (additions only):**

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `--override-loop-gate "<reason>"` | string | no | — | Escape hatch. Writes reason to `loop.toon.escapeReason` and proceeds without TRDA pass. Logged prominently in convergence digest. |

**Success response:** existing `loom-bugfix` behaviour, but Phase 1 now requires a verified-red `loop.toon` (or the escape flag) before hypothesis work.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| exit 4 | `LOOP_NOT_VERIFIED_RED` | Default path attempted to hypothesise before `loop.toon` has `verifiedRed: true`. |
| exit 5 | `STUCK_AT_LOOP_CONSTRUCTION` | The 10-rung ladder was exhausted without producing a `loop.toon` that passes TRDA. Surfaces explicit HITL escalation guidance. |

**Behavior notes:**

- Gate is unconditional — there is no ungated branch.
- `bugfix-analyst-agent` and `debug-investigator-agent` read the `loop.toon` before any hypothesis output.

### `loom-converge` — modified surface (Phase B, sub-8)

**Description:** Convergence loop — F-18 adds a new Phase 0 "loop construction" step; iterations bind to one `loopId` and run only that command.
**Auth:** none.

**Invocation arguments (additions only):**

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `--loop-id <id>` | string | no | — | Bind to an existing `loop.toon` instead of constructing a new one. |
| `--loops` | flag | no | false | List active loops as a TOON table with columns `loopId, symptom, rung, verifiedRed, runtimeMs, linkedLoops, retiredAt`. |
| `--retire-loop <id>` | string | no | — | Archive a converged loop (sets `retiredAt`; immutable after). |

**Success response:** existing convergence behaviour, but each iteration runs exactly one `loop.toon.command` and stalls escalate the LOOP (down the ladder), not the fixer.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| exit 4 | `NO_LOOP_CONSTRUCTED` | Phase 0 has not produced a `loop.toon` and `--loop-id` was not passed. |
| exit 5 | `LOOP_NOT_VERIFIED_RED` | A `loop.toon` exists but `verifiedRed: false`; surfaces current rung + ladder escalation suggestion. |
| exit 6 | `LOOPID_NOT_FOUND` | `--loop-id` passed but the file `.plan-execution/loops/{loopId}.toon` does not exist. |
| exit 7 | `RETIRE_NOT_GREEN` | `--retire-loop <id>` invoked but the symptom is not currently green across a verification run. |

**Behavior notes:**

- Lint/typecheck failures spawn child loops via `linkedLoops[]` (relation: `sibling` when triggered by the same code-change event, `spawned-from-symptom` when one loop reveals the other) — never block the active loop.
- The Phase-0 interaction states are documented in `protocols/loom-converge.interaction.md`:
  - State "no loop.toon yet": gate prints a one-line construction prompt with the ladder rung-1 recommendation.
  - State "loop exists, verifiedRed: false": gate prints current rung + escalation suggestion.

## State Machines

### FeedbackLoop lifecycle (Phase B, sub-5/sub-7/sub-8)

```
construction ──→ verified-red ──→ iterating ──→ green-candidate ──→ retired
     │                │                 │                                ▲
     │                │                 │                                │
     │                ▼                 ▼                                │
     │           escape-set ──→ escape-iterating ──────────────────────→ │
     │                                                                   │
     ▼                                                                   │
stuck-at-loop-construction (terminal until HITL intervention) ───────────┘ (HITL produces a new construction)
```

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| `construction` | `loop.toon` exists but TRDA gates have not all passed; rung may escalate down the ladder. | Default on first write of `loop.toon`. |
| `verified-red` | TRDA all true (`tight`, `redCapable`, `deterministic`, `agentRunnable`); `verifiedRed: true`; `redOutput` captured. | All four `trda` booleans become `true` and `determinismRuns >= 2`. |
| `iterating` | A fixer/converger is acting against this loop; iterations bind to `loopId` and run only `command`. | Convergence iteration begins. |
| `green-candidate` | The latest command run reported green. | Awaiting a verification re-run to confirm. |
| `retired` | Symptom is green and stayed green across a verification re-run; `retiredAt` set. Immutable. | `loom-converge`/`loom-bugfix` confirms green-twice and sets `retiredAt`. |
| `escape-set` | `escapeReason` populated via `--override-loop-gate`. | Operator passes the escape flag. |
| `escape-iterating` | Iterations proceed without TRDA pass; convergence digest flags this prominently. | Iteration begins from `escape-set`. |
| `stuck-at-loop-construction` | 10-rung ladder exhausted without producing a TRDA-passing loop. Terminal until HITL intervention; surfaces escalation guidance (not silent block). | Rung reaches 10 with `verifiedRed: false`. |

**Valid transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| (none) | `construction` | First write of `loop.toon` from `loom-converge` Phase-0 or `loom-bugfix` Phase-1 | Atomic write to `.tmp` then rename. |
| `construction` | `construction` | Rung escalation along the ladder | Append row to `escalationHistory[]`; bump `rung`. |
| `construction` | `verified-red` | All four TRDA booleans become true and `determinismRuns >= 2` | Set `verifiedRed: true`; capture `redOutput`. |
| `construction` | `escape-set` | `--override-loop-gate "<reason>"` | Set `escapeReason`; log to convergence digest. |
| `construction` | `stuck-at-loop-construction` | `rung == 10` after a failed escalation attempt | Print HITL escalation guidance; halt fixer/converger. |
| `verified-red` | `iterating` | Iteration begins | None. |
| `escape-set` | `escape-iterating` | Iteration begins under escape | Flag iteration in digest. |
| `iterating` | `green-candidate` | `loop.toon.command` exits 0 | None. |
| `escape-iterating` | `green-candidate` | `loop.toon.command` exits 0 | None. |
| `green-candidate` | `retired` | Verification re-run still green | Set `retiredAt` (ISO 8601). |
| `green-candidate` | `iterating` | Verification re-run goes red again | None — back to iterating. |
| `stuck-at-loop-construction` | `construction` | HITL writes a revised `loop.toon` (new rung, new command, or new symptom) | Append `escalationHistory[]` entry with `reason: hitl-revision`. |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|-----------|---------|
| `retired` | * | `LOOP_IMMUTABLE` | Retired loops are queryable but never re-entered; spawn a new loop instead. |
| `construction` | `iterating` | `LOOP_NOT_VERIFIED_RED` | Cannot iterate before TRDA pass or escape-set. |
| `iterating` | `verified-red` | `INVALID_TRANSITION` | Forward-only; revert via the `iterating → green-candidate → iterating` cycle if behaviour changes. |
| `stuck-at-loop-construction` | `verified-red` | `HITL_REQUIRED` | Operator must revise the loop before TRDA can be re-evaluated. |

### TriageState (Phase D, sub-13)

```
needs-triage ─→ needs-info ─→ ready-for-agent ─→ (graduates to feature)
     │             │  ▲    │
     │             │  │    └─→ ready-for-human
     │             │  │
     │             ▼  │ (reporter activity = any wiki/issue comment)
     │           needs-triage
     │             │
     ▼             ▼ (30 days no response)
ready-for-human  wontfix (terminal, reopenable only via /loom-note reopen <id>)
```

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| `needs-triage` | New entry; un-classified. | Default on `loom-note add`. |
| `needs-info` | Bot/agent asked the reporter for details. | Triage agent posts a question. |
| `ready-for-agent` | Sufficient detail; agent can act. | Triage classifies the entry. |
| `ready-for-human` | Sufficient detail but requires human action/decision. | Triage classifies the entry. |
| `wontfix` | Terminal but reopenable. | Explicit user/agent decision OR `needs-info` aged 30 days without response. |

**Valid transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| `needs-triage` | `needs-info` | Triage agent posts question | Append `transitions[]`; set `updatedAt`. |
| `needs-triage` | `ready-for-agent` | Triage classifies | Append `transitions[]`. |
| `needs-triage` | `ready-for-human` | Triage classifies | Append `transitions[]`. |
| `needs-triage` | `wontfix` | Explicit decision | Append `transitions[]` with mandatory `reason`. |
| `needs-info` | `needs-triage` | Reporter activity (any wiki/issue comment) | Append `transitions[]`. |
| `needs-info` | `wontfix` | 30 days no response | Append `transitions[]` with `reason: timeout-30d`. |
| `ready-for-agent` | `ready-for-human` | Agent escalates | Append `transitions[]`. |
| `ready-for-human` | `ready-for-agent` | Human re-routes | Append `transitions[]`. |
| `wontfix` | `needs-triage` | `/loom-note reopen <id>` with mandatory reason | Append `transitions[]` with `actor` and `reason`; never silent. |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|-----------|---------|
| `wontfix` | * (without explicit reopen) | `WONTFIX_REOPEN_REQUIRED` | Use `/loom-note reopen <id> --reason "..."`. |
| `ready-for-agent` | `needs-triage` | `INVALID_TRANSITION` | Re-triage by closing and creating a new note. |

### ADR status enum (Phase A, sub-3)

```
proposed ─→ accepted ─→ deprecated
                  │           ▲
                  └─→ superseded ─→ (supersededBy points to newer ADR)
```

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| `proposed` | Drafted; not yet authoritative. | Default on creation. |
| `accepted` | Authoritative; reviewers must honour. | Operator marks accepted (typically at `loom-converge` resolution of a blocking conflict or `loom-roadmap converge` recording a load-bearing rejection). |
| `deprecated` | No longer authoritative; no replacement. | Operator marks deprecated. |
| `superseded` | Replaced by another ADR; `supersededBy` set. | Operator writes a new ADR that supersedes this one. |

**Valid transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| `proposed` | `accepted` | Operator accepts | Cite ADR in any reviewer in the affected area. |
| `accepted` | `deprecated` | Operator deprecates | Reviewers stop citing it. |
| `accepted` | `superseded` | New ADR created with `supersededBy` referencing this | Set `supersededBy`. |
| `proposed` | `superseded` | New ADR supersedes a never-accepted proposal | Set `supersededBy`. |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|-----------|---------|
| `superseded` | `accepted` | `ADR_REVIVAL_BLOCKED` | Write a fresh ADR; do not revive a superseded one. |
| `deprecated` | `accepted` | `ADR_REVIVAL_BLOCKED` | Same — fresh ADR. |

## Error Handling Specification

F-18 has no HTTP API, so error format is per-CLI: every new/modified slash command exits with a documented non-zero code and writes a one-line TOON diagnostic to stderr matching this shape:

```toon
errorCode: SCREAMING_SNAKE_CASE
message: human-readable
hint: optional one-line next-action hint
```

### Error Categories

| Code | Exit / Status | When Used | Retryable |
|------|---------------|-----------|-----------|
| `LOOP_NOT_VERIFIED_RED` | 4 | `loom-converge`/`loom-bugfix` default path attempts to act before TRDA pass. | No — construct or escape. |
| `NO_LOOP_CONSTRUCTED` | 4 | `loom-converge` Phase-0 absent and `--loop-id` not passed. | No — construct first. |
| `STUCK_AT_LOOP_CONSTRUCTION` | 5 | 10-rung ladder exhausted without TRDA pass. | No — HITL only. |
| `LOOPID_NOT_FOUND` | 6 | `--loop-id` references a nonexistent file. | No — list with `--loops`. |
| `RETIRE_NOT_GREEN` | 7 | `--retire-loop` invoked while symptom still red. | Yes — re-run when green. |
| `LOOP_IMMUTABLE` | 8 | Caller attempts to mutate a retired loop. | No — spawn new loop. |
| `HARNESS_OUTPUT_INCOMPATIBLE` | 9 | A harness command's stdout/stderr is not parseable into a verified-red signal (TRDA `redCapable` fails). | No — escalate rung or refactor harness. |
| `CRITERION_UNVERIFIABLE` | 10 | A criterion-bound TRDA evaluation determines no rung on the ladder can produce a deterministic red. Surfaces in convergence digest. | No — flag criterion for review. |
| `PROTOTYPE_EXISTS` | 1 | `/loom-prototype <name>` collides with existing directory. | No — pick new name. |
| `ADR_NOT_FOUND` | 2 | `/loom-prototype --adr <ADR-NNNN>` references missing ADR. | No — create ADR first. |
| `HTML_OPEN_FAILED` | 0 (warning, not failure) | `--html` was passed and the OS `open` shim failed (SSH/headless). | Yes — open the printed path manually. |
| `EXPLORE_AGENT_FAILED` | 2 | At least one `Explore` subagent failed in `/loom-deepen`. | Yes — re-run; partial report still emits. |
| `MIGRATION_SCHEMA_MISMATCH` | 3 | `migrateConvergenceStateV1toV2` invoked on content that is neither v1 nor v2. | No — manual inspection. |
| `WIKI_DECISION_MIGRATION_AMBIGUOUS` | 3 | The Phase-A wiki-decision→ADR migrator finds a wiki page whose content cannot be mapped to a single ADR. | No — manual triage; migrator leaves the wiki page untouched and surfaces the conflict. |
| `WONTFIX_REOPEN_REQUIRED` | 4 | `loom-note` operation attempts to leave `wontfix` without the explicit reopen path. | No — use `/loom-note reopen`. |

### Verbatim error message + hint fixtures <!-- Applied: UX-B1 -->

The following four error codes are pinnable as test fixtures. Phase 2 scenarios (S-01, S-03, S-11, S-12) assert these strings verbatim. Implementations MUST emit the literal `message:` and `hint:` lines below to stderr alongside the `errorCode:` line.

```toon
errorFixtures[4]{errorCode,message,hint}:
  LOOP_NOT_VERIFIED_RED,"No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.","Run loom-converge --construct-loop or pass --override-loop-gate \"<reason>\" to proceed under escape."
  NO_LOOP_CONSTRUCTED,"Phase 0 of loom-converge did not produce a loop.toon and no --loop-id was passed.","Construct a loop with loom-converge --construct-loop or bind an existing loop with --loop-id <id>; list active loops with loom-converge --loops."
  HARNESS_OUTPUT_INCOMPATIBLE,"The harness command's stdout/stderr cannot be parsed into a verified-red signal (TRDA redCapable check failed).","Escalate to the next rung on the 10-rung ladder OR refactor the harness to emit a parseable red marker (exit code + structured stderr)."
  CRITERION_UNVERIFIABLE,"TRDA evaluation determined that no rung on the 10-rung ladder can produce a deterministic red for this criterion.","Flag the criterion for human review with loom-converge --flag-criterion <id> \"<reason>\"; the criterion is recorded in the convergence digest and skipped from auto-iteration."
```

### Empty-state advisories <!-- Applied: UX-B4 -->

The following empty-state advisories are emitted verbatim when the listed precondition file is missing. Each is pinnable as a test fixture.

```toon
emptyStateAdvisories[3]{trigger,message,hint}:
  decisions-md-missing,"DECISIONS.md not found — locked decisions cannot be honored without it.","Run /loom-init to generate DECISIONS.md from the current ROADMAP.md, or restore from version control."
  criteria-plan-missing,"criteria-plan.toon not found at .plan-execution/criteria-plan.toon — loom-converge --criteria has no criterion set to iterate against.","Generate the plan with /loom-plan create --criteria <PATH-TO-PLAN.md>, or pass --criteria-inline for a one-shot run."
  loop-toon-missing,"loop.toon not found at .plan-execution/loops/ — see NO_LOOP_CONSTRUCTED above for the canonical error code emitted by loom-converge Phase 0.","Construct a loop with loom-converge --construct-loop or bind an existing loop with --loop-id <id>."
```

### Field-Level Validation Errors (TOON-frontmatter writes)

When writing `loop.toon`, `inbox/*.md` triage frontmatter, ADR frontmatter, or `.out-of-scope/*.md` frontmatter, validation failures emit:

```toon
errorCode: VALIDATION_ERROR
message: Frontmatter validation failed
fields[N]{field,issue}:
  loop.toon:trda.tight,must be boolean
  loop.toon:symptom,must be non-empty and ≤500 chars
```

### Retry Behavior

- `LOOP_NOT_VERIFIED_RED`, `NO_LOOP_CONSTRUCTED`, `STUCK_AT_LOOP_CONSTRUCTION`: never retried by the harness — operator action required.
- `EXPLORE_AGENT_FAILED`: deepening report still writes with `partial: true`; manual re-run recommended.
- `HTML_OPEN_FAILED`: degraded-mode success; never retried.

## Execution Phases

### Phase 0 — Wave 0: Contracts & Prefactor

**Agent:** contracts-agent
**Objective:** Land every schema, protocol stub, and prefactor change ("make the change easy, then make the easy change") that downstream phases depend on, with NO behavioural changes to runtime code.
<!-- Applied: P-07 — sizing justification. Phase 0 ships 11 contract/protocol files but they are uniformly stubs/schemas with no executable behaviour, so the >8-deliverable threshold is intentionally exceeded under the rule "contracts phases may exceed the deliverable cap when every deliverable is type/schema-only and shares one owner". Split is not warranted because the files form one cohesive contract surface read together by Phases 1-5. -->
**Dependencies:** None
**File Ownership:**
- `protocols/codebase-design.md` (CREATE)
- `protocols/skill-authoring.md` (CREATE)
- `protocols/feedback-loop.schema.md` (CREATE)
- `protocols/out-of-scope.schema.md` (CREATE)
- `protocols/grilling.md` (CREATE — stub-only at this phase; body lands in Phase 8)
- `protocols/loom-converge.interaction.md` (CREATE — stub-only at this phase; body lands in Phase 2a) <!-- Applied: PR-B1 -->
- `protocols/findings.schema.md` (MODIFY — add `confidence` field, default `medium`)
- `scripts/migrate-convergence-state.ts` (CREATE — invokes the v1→v2 migrator)
- `scripts/lib/convergence-state-migrator.ts` (CREATE — `detectConvergenceStateVersion`, `migrateConvergenceStateV1toV2`)
- `tests/migrators/convergence-state.test.ts` (CREATE)
- `tests/protocols/codebase-design.test.ts` (CREATE — vocabulary-mapping table parser)
- `tests/protocols/skill-authoring.test.ts` (CREATE)
- `tests/protocols/out-of-scope.test.ts` (CREATE)
- `tests/protocols/feedback-loop.test.ts` (CREATE — schema parse smoke test)
- `tests/protocols/findings-confidence.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `protocols/codebase-design.md` | Create | contracts-agent |
| `protocols/skill-authoring.md` | Create | contracts-agent |
| `protocols/feedback-loop.schema.md` | Create | contracts-agent |
| `protocols/out-of-scope.schema.md` | Create | contracts-agent |
| `protocols/grilling.md` | Create (stub) | contracts-agent |
| `protocols/loom-converge.interaction.md` | Create (stub) | contracts-agent |
| `protocols/findings.schema.md` | Modify | contracts-agent |
| `scripts/lib/convergence-state-migrator.ts` | Create | contracts-agent |
| `scripts/migrate-convergence-state.ts` | Create | contracts-agent |
| `tests/migrators/convergence-state.test.ts` | Create | contracts-agent |
| `tests/protocols/*.test.ts` (5 files) | Create | contracts-agent |
| `fixtures/pre-f18/convergence-state.toon` | Create | contracts-agent |
| `tests/fixtures/pre-f18-convergence/` (seed dir) | Create | contracts-agent |

#### Acceptance Criteria

<!-- Applied: P-04 — tie content-completeness ACs to explicit asserting tests -->
- [ ] `protocols/codebase-design.md` exists with Section 0 vocabulary-mapping table containing all 9 rows from the F-18 scope; subsequent sections define Module/Interface/Depth/Seam/Adapter/Leverage/Locality plus the deletion-test and "interface is the test surface" subsections. `tests/protocols/codebase-design.test.ts` MUST assert the row count is exactly 9 AND each row has a non-empty `When to use which` column.
- [ ] `protocols/skill-authoring.md` exists and defines all six `SkillAuthoringPrinciple` rows from the schema (predictability, leading-word, completion-criterion, premature-completion, sediment, duplication) plus the no-op test rule and model-invoked vs user-invoked trade-off subsection. `tests/protocols/skill-authoring.test.ts` MUST assert all six principle names appear as section headings AND each carries a non-empty `noOpTestRule`.
- [ ] `protocols/feedback-loop.schema.md` exists with the full `FeedbackLoop` field set from the Schema section above and a "Retirement Ceremony" subsection.
- [ ] `protocols/out-of-scope.schema.md` exists and defines the `OutOfScopeEntry` row schema.
- [ ] `protocols/grilling.md` and `protocols/loom-converge.interaction.md` exist as stubs with at minimum a one-paragraph "what this protocol covers" body; `protocols/loom-converge.interaction.md` full content lands in Phase 2a; `protocols/grilling.md` full content lands in Phase 5a. The Phase 0 `protocols/grilling.md` stub MUST also contain the 5 core grilling-discipline rules listed in the "Grilling discipline core rules (Phase 0 stub contents)" subsection below so Phase 1 (`/loom-which`) has enough signal to compile against. <!-- Applied: PR-B1, PR-B2, S-H1 -->
- [ ] `protocols/findings.schema.md` adds `confidence: high|medium|low` with default `medium`; existing fixtures parse unchanged.
- [ ] `bunx vitest run tests/migrators tests/protocols` exits with code 0.
- [ ] `scripts/migrate-convergence-state.ts --dry-run` exits 0 against the pre-F-18 fixture and prints a unified diff showing the new `loops[]` table.
- [ ] No existing runtime file outside this phase's File Ownership is modified.

#### Grilling discipline core rules (Phase 0 stub contents) <!-- Applied: S-H1, PR-B2 -->

The Phase 0 `protocols/grilling.md` stub MUST contain the following 5 core rules verbatim. The full content (12-question cap, progress indicator format, `/skip` escape, model-invocation guidance) lands in Phase 5a.

```toon
rules[5]{id,rule}:
  GR-01,"Ask exactly one question per turn — never bundle multiple decisions into a single prompt."
  GR-02,"Recommend an answer with every question — surface the default the grilling agent would pick if pressed."
  GR-03,"Walk every branch — never collapse a multi-branch decision into the most likely path; enumerate alternatives before recommending."
  GR-04,"Prefer codebase exploration over asking — read files first; only ask when the answer cannot be inferred from existing artifacts."
  GR-05,"Cap the session — full content (12-question cap, /skip escape, progress indicator) lands in Phase 5a; the cap exists from day one."
```

These 5 rules are the minimum Phase 1's `/loom-which` AC compiles against. Phase 1 compliance with `protocols/grilling.md` discipline at Phase 1 means the 5 core rules above; full content (including the 12-question cap regression test) lands in Phase 5a.

#### Convergence Targets

- `bunx vitest run tests/migrators/convergence-state.test.ts` exits with code 0.
- `bunx vitest run tests/protocols/findings-confidence.test.ts` exits with code 0.
- `scripts/migrate-convergence-state.ts --dry-run < fixtures/pre-f18/convergence-state.toon` produces a v2 document satisfying the schema invariants.
- `protocols/codebase-design.md` Section 0 parses into a 9-row table.

#### Convergence Tiers

- unit (default for Phase): `bunx vitest run tests/migrators tests/protocols`.

#### Scenarios

```toon
id: S-01
title: Migrate convergence-state.toon v1 to v2 idempotently
given[2]: A pre-F-18 convergence-state.toon at fixtures/pre-f18/convergence-state.toon, scripts/migrate-convergence-state.ts is present
when: An operator runs scripts/migrate-convergence-state.ts on the fixture
whenTriggerType: api-call
then[3]: Output document MUST contain a loops[] table, A second migration pass MUST produce byte-identical output, detectConvergenceStateVersion on the output MUST return current: 2 with outdated: false
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: Codebase-design vocabulary table is parseable
given[1]: protocols/codebase-design.md ships with Section 0
when: A parser reads the file and extracts Section 0's mapping table
whenTriggerType: system-event
then[2]: The table MUST contain exactly 9 rows matching the F-18 scope, Every row MUST have a non-empty "When to use which" column
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-03
title: findings.schema.md confidence default is backward-compatible
given[1]: A pre-F-18 findings.toon fixture omitting confidence
when: The schema parser reads the fixture under the updated findings.schema.md
whenTriggerType: system-event
then[2]: Parsing MUST succeed, Every finding row MUST resolve confidence to "medium"
stateRef:
tags[2]: regression, edge-case
testTier: unit
automatable: true
```

---

### Phase 1 — Wave 1: Phase A foundations — content migrations + early router

**Agent:** implementer-agent
**Objective:** Land the remaining Phase-A items: `CONTEXT.md`/`DECISIONS.md` split with migration, ADR convention with wiki-decision→ADR migration, and the `/loom-which` slash command. No behavioural change to convergence or bugfix.
**Dependencies:** Phase 0
**File Ownership:**
- `commands/loom-which.md` (CREATE)
- `commands/loom-init.md` (MODIFY — emit `CONTEXT.md` glossary view + `DECISIONS.md` on first run)
- `commands/loom-wiki/ingest.md` (MODIFY — maintain both files)
- `scripts/migrate-context-split.ts` (CREATE — one-shot, idempotent)
- `scripts/migrate-wiki-decisions-to-adrs.ts` (CREATE — one-shot, idempotent; stubs the wiki page to point at the ADR)
- `docs/adr/0000-adr-convention.md` (CREATE — the meta-ADR establishing the convention itself)
- `docs/adr/README.md` (CREATE — numbering rules, status enum)
- `tests/commands/loom-which.test.ts` (CREATE)
- `tests/migrators/context-split.test.ts` (CREATE)
- `tests/migrators/wiki-decisions-to-adrs.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-which.md` | Create | implementer-1 |
| `commands/loom-init.md` | Modify | implementer-1 |
| `commands/loom-wiki/ingest.md` | Modify | implementer-1 |
| `scripts/migrate-context-split.ts` | Create | implementer-1 |
| `scripts/migrate-wiki-decisions-to-adrs.ts` | Create | implementer-1 |
| `docs/adr/0000-adr-convention.md` | Create | implementer-1 |
| `docs/adr/README.md` | Create | implementer-1 |
| `tests/commands/loom-which.test.ts` | Create | implementer-1 |
| `tests/migrators/context-split.test.ts` | Create | implementer-1 |
| `tests/migrators/wiki-decisions-to-adrs.test.ts` | Create | implementer-1 |

#### Acceptance Criteria

- [ ] `/loom-which` skill ships with a decision tree of ≥6 branch nodes and explicit one-question-at-a-time behavior; first-question recommendation is presented per `protocols/grilling.md` discipline. <!-- Applied: S-H1, PR-B2 --> Compliance with `protocols/grilling.md` discipline at Phase 1 means the 5 core rules (GR-01..GR-05) defined in the Phase 0 stub; full content (12-question cap, progress indicator, `/skip` escape) lands in Phase 5a and is not a Phase 1 obligation.
- [ ] `loom-init` first-run emits a non-empty `CONTEXT.md` glossary view (≤50 hand-curated terms or fewer when codebase is small) AND a `DECISIONS.md` containing pre-F-18 locked-decision content; the empty-state advisory (`"CONTEXT.md not found — run /loom-init to generate"`) is fired when no `CONTEXT.md` exists.
- [ ] `scripts/migrate-context-split.ts` is idempotent — second run is a no-op verifiable via `--dry-run` empty diff.
- [ ] `scripts/migrate-wiki-decisions-to-adrs.ts` converts every `decision-*.md` wiki page under `.loom/wiki/` into a `docs/adr/NNNN-*.md` ADR; the original wiki page is rewritten to a stub pointer; ambiguous pages surface `WIKI_DECISION_MIGRATION_AMBIGUOUS` and are skipped.
- [ ] `docs/adr/0000-adr-convention.md` documents the numbering, status enum (`proposed|accepted|deprecated|superseded`), and the explicit-trigger rule (ADR creation is triggered when `loom-converge` resolves a blocking conflict or `loom-roadmap converge` records a load-bearing rejection).
- [ ] `bunx vitest run tests/commands/loom-which.test.ts tests/migrators/context-split.test.ts tests/migrators/wiki-decisions-to-adrs.test.ts` exits 0.
- [ ] No file under `agents/`, `protocols/feedback-loop.schema.md`, or any Phase 2+ ownership is modified.

#### Convergence Targets

- `bunx vitest run tests/commands/loom-which.test.ts` exits 0.
- `bunx vitest run tests/migrators/context-split.test.ts` exits 0 (idempotent second-run produces empty diff).
- `bunx vitest run tests/migrators/wiki-decisions-to-adrs.test.ts` exits 0 (every fixture wiki-decision page produces an ADR and a stub).
- The fresh-agent vocabulary test: a fresh agent invocation that reads `CONTEXT.md` uses domain terms (not generic words) in its first response — measured by a vocabulary-diff fixture comparing first-response token frequencies against `CONTEXT.md` glossary terms.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: /loom-which recommends a command from a one-line description
given[1]: /loom-which is registered and reachable
when: A user invokes /loom-which "my bug fix needs a reproduction"
whenTriggerType: actor-action
then[2]: stdout MUST recommend /loom-bugfix, The recommendation MUST cite a leading rung from the 10-rung ladder
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: /loom-which falls back to /loom-reference on no-match
given[1]: /loom-which is registered
when: A user invokes /loom-which "do something completely unrelated to Loom"
whenTriggerType: actor-action
then[2]: stderr MUST emit NO_MATCH diagnostic, stdout MUST suggest /loom-reference
stateRef:
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-03
title: CONTEXT split migration is idempotent
given[1]: A fixture project with the pre-F-18 monolithic CONTEXT.md containing both glossary and locked decisions
when: scripts/migrate-context-split.ts runs twice in sequence on the fixture
whenTriggerType: api-call
then[3]: First run MUST produce CONTEXT.md and DECISIONS.md with content split per the F-18 scope, Second run MUST produce an empty diff, --dry-run after the second run MUST report no changes
stateRef:
tags[2]: happy-path, regression
testTier: unit
automatable: true
```

```toon
id: S-04
title: Wiki decision pages migrate to ADRs with stub pointers
given[1]: A fixture .loom/wiki/ containing 3 decision-*.md pages, one of which is ambiguous
when: scripts/migrate-wiki-decisions-to-adrs.ts runs once on the fixture
whenTriggerType: api-call
then[4]: 2 ADR files MUST be created under docs/adr/, The 2 corresponding wiki pages MUST be rewritten to stub pointers citing the ADR id, The ambiguous page MUST be left untouched, stderr MUST emit WIKI_DECISION_MIGRATION_AMBIGUOUS for that page
stateRef:
tags[2]: happy-path, edge-case
testTier: integration
automatable: true
```

<!-- Applied: CG-004 -->
```toon
id: S-07
title: loom-wiki ingest writes CONTEXT.md and DECISIONS.md atomically
given[1]: A fixture wiki containing glossary entries and locked-decision entries
when: loom-wiki ingest runs against the fixture
whenTriggerType: api-call
then[3]: Both CONTEXT.md and DECISIONS.md MUST exist after the run, Both files MUST have been written via the .tmp + rename atomic-write convention (verified by interception), A failure mid-run MUST leave neither file partially written
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

<!-- Applied: IC-006 -->
```toon
id: S-06
title: Missing CONTEXT.md fires the empty-state advisory verbatim
given[1]: A fixture project where CONTEXT.md does not exist
when: An agent invocation triggers the loom-init advisory check
whenTriggerType: system-event
then[1]: stderr MUST contain the literal advisory string "CONTEXT.md not found — run /loom-init to generate"
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

```toon
id: S-05
title: Fresh agent uses CONTEXT.md vocabulary in first response
given[2]: A fresh Claude Code session in a project with CONTEXT.md present, A vocabulary-diff fixture listing CONTEXT.md glossary terms
when: The fresh agent is asked to summarize the project's architecture
whenTriggerType: system-event
then[1]: The first response MUST contain at least 3 distinct CONTEXT.md glossary terms verbatim
stateRef:
tags[1]: happy-path
testTier: qa-review
automatable: false
```

---

<!-- Applied: AW-B4 — Phase 2 split into Phase 2a (loop gate core, Wave 2a) and Phase 2b (feedback-loop primitive + tdd-coach, Wave 2b) to fit 100k context budget per agent spawn. Phase 2a → Phase 2b sequence inside the broader Wave 2 (Wave 2a → Wave 2b). Downstream Phase 3/4/5/6 numbers unchanged. -->

### Phase 2a — Wave 2a: Phase B core — loop-construction gate + loom-converge/loom-bugfix wiring (HEADLINE BEHAVIOURAL CHANGE)

**Agent:** implementer-agent
**Objective:** Land the loop-construction gate at all entry paths: `loom-bugfix` Phase-1 gate, `loom-converge` Phase-0 loop construction, and the interaction protocol that names both Phase-0 states. No feedback-loop skill or tdd-coach changes — those land in Phase 2b.
**Dependencies:** Phase 0, Phase 1
**File Ownership:**
- `agents/bugfix-analyst-agent.md` (MODIFY)
- `agents/debug-investigator-agent.md` (MODIFY)
- `agents/convergence-driver.md` (MODIFY) *or equivalent driver entry — implementer resolves by inspection*
- `agents/stage-teammates/converge-stage.md` (MODIFY)
- `commands/loom-bugfix.md` (MODIFY — surface `--override-loop-gate`)
- `commands/loom-converge.md` (MODIFY — surface `--loop-id`, `--loops`, `--retire-loop`)
- `protocols/loom-converge.interaction.md` (MODIFY — replace Phase 0 stub with full content) <!-- Applied: PR-B1 -->
- `tests/agents/loom-bugfix-gate.test.ts` (CREATE)
- `tests/agents/loom-converge-loop-construction.test.ts` (CREATE — wiring test exercising both Phase-0 interaction states)
- `tests/regressions/linked-loops-lint-typecheck.test.ts` (CREATE)
- `tests/regressions/stuck-at-loop-construction.test.ts` (CREATE — asserts HITL guidance block from UX-B2 fixture)
- `tests/regressions/loom-converge-criteria-boundary.test.ts` (CREATE — `--criteria` boundary non-goal verification)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `agents/bugfix-analyst-agent.md` | Modify | implementer-2a |
| `agents/debug-investigator-agent.md` | Modify | implementer-2a |
| `agents/convergence-driver.md` | Modify | implementer-2a |
| `agents/stage-teammates/converge-stage.md` | Modify | implementer-2a |
| `commands/loom-bugfix.md` | Modify | implementer-2a |
| `commands/loom-converge.md` | Modify | implementer-2a |
| `protocols/loom-converge.interaction.md` | Modify (replace stub) | implementer-2a |
| `tests/agents/loom-bugfix-gate.test.ts` | Create | implementer-2a |
| `tests/agents/loom-converge-loop-construction.test.ts` | Create | implementer-2a |
| `tests/regressions/linked-loops-lint-typecheck.test.ts` | Create | implementer-2a |
| `tests/regressions/stuck-at-loop-construction.test.ts` | Create | implementer-2a |
| `tests/regressions/loom-converge-criteria-boundary.test.ts` | Create | implementer-2a |

#### Acceptance Criteria

- [ ] `loom-bugfix` Phase-1 gate halts on ALL entry paths (autoconverge AND default analyst) when no `loop.toon` exists with `verifiedRed: true`; gate verified by `tests/agents/loom-bugfix-gate.test.ts` which exercises BOTH paths against a fixture project.
- [ ] `--override-loop-gate "<reason>"` proceeds past the gate, writes `escapeReason` to the loop file, and the convergence digest contains a prominent escape callout — verified by a fixture run.
- [ ] Exhausted 10-rung ladder produces named `stuck-at-loop-construction` state with HITL escalation guidance (not silent block) — verified by `tests/regressions/stuck-at-loop-construction.test.ts` which intentionally hits the dead-end. The HITL guidance block MUST be emitted verbatim as the following TOON-formatted block, pinnable as a test fixture: <!-- Applied: UX-B2 -->

  ```toon
  hitlGuidance:
    state: stuck-at-loop-construction
    operatorQuestions[3]:
      - Q1: Is the symptom reproducible by a human manually running the command outside the harness?
      - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?
      - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?
    reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \"<one-sentence-reason>\""
    fallback: "If revision is not productive after 2 attempts, retire the loop with --retire-loop <loopId> and open a HITL issue."
  ```

  The test asserts every line in the block above appears in stderr verbatim including the `loom-converge --revise-loop <loopId>` command suggestion and all 3 operator questions Q1/Q2/Q3.
- [ ] `loom-converge` Phase 0 writes `loop.toon`; each iteration runs only `loop.toon.command`; stalls escalate the LOOP (append `escalationHistory[]`), not the fixer — verified by `tests/agents/loom-converge-loop-construction.test.ts`.
- [ ] <!-- Applied: P-02 --> `loom-converge` Phase-0 on the default (non-`--loop-id`) path MUST exit with code `4` and emit `errorCode: LOOP_NOT_VERIFIED_RED` when invoked against a fixture whose `loop.toon` exists with `verifiedRed: false` — verified by `tests/agents/loom-converge-loop-construction.test.ts` which exercises this exact case alongside the `NO_LOOP_CONSTRUCTED` case.
- [ ] `convergence-state.toon` gains a `loops[]` table and validates against the v2 schema migrator from Phase 0; pre-F-18 fixtures upgrade and validate.
- [ ] `--loops` lists active loops as a TOON table with columns `loopId, symptom, rung, verifiedRed, runtimeMs, linkedLoops, retiredAt`; `--retire-loop <id>` archives a converged loop and the loop becomes immutable thereafter.
- [ ] Lint/typecheck failures during a `loom-converge` run spawn child/sibling loops via `linkedLoops[]` and DO NOT block the active loop — verified by `tests/regressions/linked-loops-lint-typecheck.test.ts`.
- [ ] `protocols/loom-converge.interaction.md` documents both Phase-0 interaction states ("no loop.toon yet", "loop exists, verifiedRed: false") with literal expected stdout lines, parseable by a doctest harness.
- [ ] `bunx vitest run tests/agents/loom-bugfix-gate.test.ts tests/agents/loom-converge-loop-construction.test.ts tests/regressions/linked-loops-lint-typecheck.test.ts tests/regressions/stuck-at-loop-construction.test.ts tests/regressions/loom-converge-criteria-boundary.test.ts` exits 0.
- [ ] <!-- Applied: PR-H3 + AW-H3 — explicit Wave 0→Wave 1 migrator gate --> Phase 2a ENTRY precondition: `bunx vitest run tests/migrators/convergence-state.test.ts` exits 0 against `fixtures/pre-f18/convergence-state.toon`. Phase 0 deliverable; gate verified by orchestrator before Phase 2a implementer-agent spawns.
- [ ] <!-- Applied: FC-H6 — explicit loom-converge --criteria boundary --> Non-goal: the Phase-0 loop-construction gate DOES NOT apply when `loom-converge` is invoked with `--criteria`. The `--criteria` mode preserves its current pre-F-18 semantics (iterates implementation against fixed tests). Verified by `tests/regressions/loom-converge-criteria-boundary.test.ts` asserting no `loop.toon` is written and no `LOOP_NOT_VERIFIED_RED` exit fires when `--criteria` is set.

#### Convergence Targets

- `bunx vitest run tests/agents/loom-bugfix-gate.test.ts` exits 0 against fixture projects exercising autoconverge AND default paths.
- `bunx vitest run tests/regressions/stuck-at-loop-construction.test.ts` exits 0 — the regression intentionally drives a loop to rung 10 without TRDA pass and asserts the exit code `5` + HITL guidance lines appear.
- `bunx vitest run tests/regressions/linked-loops-lint-typecheck.test.ts` exits 0 — asserts `linkedLoops[]` rows appear in `convergence-state.toon` after a lint failure mid-iteration.
- `loom-converge --loops` stdout against a fixture state file produces a TOON table matching the documented column set.
- `loom-converge --retire-loop <id>` produces a `retiredAt` mutation; a subsequent retire attempt exits with `LOOP_IMMUTABLE`.

#### Convergence Tiers

- unit + integration + e2e (the cross-agent gate exercises are e2e because they spawn multiple agents in a fixture project).

#### Scenarios

```toon
id: S-01
title: loom-bugfix default path halts before loop.toon is verified-red
given[2]: A fixture project with no loop.toon at .plan-execution/loops/, loom-bugfix is invoked on a known reproduction
when: The operator runs loom-bugfix on the default (non-autoconverge) path
whenTriggerType: api-call
then[3]: Exit code MUST be 4, stderr MUST emit errorCode LOOP_NOT_VERIFIED_RED, stdout MUST present the rung-1 ladder recommendation
stateRef: construction
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --override-loop-gate proceeds and is logged prominently
given[2]: A fixture project with a loop.toon in construction state, The operator passes --override-loop-gate "investigating prod outage"
when: loom-bugfix runs with the escape flag
whenTriggerType: api-call
then[3]: Exit code MUST be 0, loop.toon.escapeReason MUST equal the passed string, convergence digest output MUST contain a prominent ESCAPE-SET callout line
stateRef: escape-set
tags[2]: happy-path, edge-case
testTier: integration
automatable: true
```

```toon
id: S-03
title: 10-rung ladder exhaustion produces stuck-at-loop-construction
given[1]: A fixture symptom that no rung on the ladder can drive to deterministic red
when: loom-bugfix walks the ladder and reaches rung 10 without TRDA pass
whenTriggerType: api-call
then[3]: Exit code MUST be 5, stderr MUST emit STUCK_AT_LOOP_CONSTRUCTION, stdout MUST present HITL escalation guidance with the explicit phrase "stuck-at-loop-construction"
stateRef: stuck-at-loop-construction
tags[2]: regression, error
testTier: integration
automatable: true
```

```toon
id: S-04
title: loom-converge binds each iteration to a single loopId and command
given[2]: A fixture project with a verified-red loop.toon, A multi-symptom test fixture
when: loom-converge runs three iterations against the bound loopId
whenTriggerType: api-call
then[3]: Every iteration MUST execute exactly loop.toon.command, No iteration MUST run any other command, convergence-state.toon MUST contain exactly one loops[] row referencing the bound loopId
stateRef: iterating
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-05
title: Lint failure during iteration spawns a sibling loop without blocking
given[2]: A fixture project with a verified-red loop.toon for a test-symptom, A lint rule that fails on a file the fixer modifies mid-iteration
when: The fixer iteration triggers the lint failure
whenTriggerType: system-event
then[3]: A new child loop.toon MUST exist with relation "sibling" in the parent's linkedLoops[], The active loop MUST continue iterating against its original symptom, convergence-state.toon MUST list both loops with their relation
stateRef:
tags[2]: regression, edge-case
testTier: integration
automatable: true
```

<!-- Scenarios S-06 (tdd-coach refuses horizontal slicing) and S-07 (refactor never reduces test count) moved to Phase 2b per AW-B4 split. -->

<!-- Applied: IC-004 -->
```toon
id: S-09
title: Retired loop is queryable but immutable
given[2]: A loop in state retired with retiredAt set, A consumer that wants to read the snapshot
when: A reader queries the retired loop AND a writer tries to mutate it
whenTriggerType: api-call
then[3]: The read MUST return the full retired-state snapshot including retiredAt, A write attempt MUST exit with errorCode LOOP_IMMUTABLE, The retiredAt field MUST be unchanged after the failed write
stateRef: retired
tags[2]: regression, edge-case
testTier: integration
automatable: true
```

<!-- Applied: CG-006 -->
```toon
id: S-11
title: HARNESS_OUTPUT_INCOMPATIBLE surfaces structured HITL guidance
given[1]: A fixture harness command whose stdout/stderr cannot be parsed into a red signal (redCapable fails)
when: The TRDA gate evaluates redCapable on this command
whenTriggerType: api-call
then[3]: Exit code MUST be 9, stderr MUST emit errorCode HARNESS_OUTPUT_INCOMPATIBLE, stdout MUST contain structured HITL guidance citing rung escalation or harness refactor as the two paths forward
stateRef: construction
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-12
title: CRITERION_UNVERIFIABLE surfaces structured HITL guidance
given[1]: A criterion whose TRDA evaluation determines no rung can produce deterministic red
when: The TRDA gate completes ladder traversal without a redCapable rung
whenTriggerType: api-call
then[3]: Exit code MUST be 10, stderr MUST emit errorCode CRITERION_UNVERIFIABLE, stdout MUST contain structured HITL guidance asking the operator to flag the criterion for review
stateRef: stuck-at-loop-construction
tags[1]: error
testTier: integration
automatable: true
```

<!-- Scenario S-10 (feedback-loop skill body leading-word assertion) moved to Phase 2b per AW-B4 split. -->

```toon
id: S-08
title: Findings carry confidence: medium by default
given[1]: A reviewer agent that does not explicitly set confidence on a finding
when: The reviewer writes a finding via findings.schema.md
whenTriggerType: system-event
then[1]: The persisted finding row MUST have confidence equal to "medium"
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

---

### Phase 2b — Wave 2b: Phase B continued — feedback-loop primitive + tdd-coach discipline <!-- Applied: AW-B4 -->

**Agent:** implementer-agent
**Objective:** Land the `feedback-loop` model-invoked skill (10-rung ladder + TRDA), the `tdd-coach` horizontal-slice anti-pattern + no-silent-regression rule, and the auxiliary regression tests covering retired-loop immutability, override-loop-gate empty-reason, sediment baseline, and stuck-at-loop-construction body assertions. Runs strictly after Phase 2a inside Wave 2 (Wave 2a → Wave 2b sequencing).
**Dependencies:** Phase 0, Phase 1, Phase 2a
**File Ownership:**
- `agents/tdd-coach.md` (MODIFY)
- `skills/feedback-loop/SKILL.md` (CREATE)
- `skills/library.yaml` (MODIFY — register feedback-loop skill)
- `tests/agents/tdd-coach-anti-pattern.test.ts` (CREATE)
- `tests/skills/feedback-loop.test.ts` (CREATE — leading-word presence, ladder enumeration)
- `tests/regressions/retired-loop-immutable.test.ts` (CREATE — re-retire fails LOOP_IMMUTABLE, queryable read succeeds)
- `tests/regressions/override-loop-gate-empty-reason.test.ts` (CREATE — empty escape reason fails validation)
- `tests/regressions/stuck-at-loop-construction-hitl.test.ts` (CREATE — body-line assertion regression beyond Phase 2a wiring)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `agents/tdd-coach.md` | Modify | implementer-2b |
| `skills/feedback-loop/SKILL.md` | Create | implementer-2b |
| `skills/library.yaml` | Modify | implementer-2b |
| `tests/agents/tdd-coach-anti-pattern.test.ts` | Create | implementer-2b |
| `tests/skills/feedback-loop.test.ts` | Create | implementer-2b |
| `tests/regressions/retired-loop-immutable.test.ts` | Create | implementer-2b |
| `tests/regressions/override-loop-gate-empty-reason.test.ts` | Create | implementer-2b |
| `tests/regressions/stuck-at-loop-construction-hitl.test.ts` | Create | implementer-2b |

#### Acceptance Criteria

- [ ] `skills/feedback-loop/SKILL.md` ships with the full 10-rung ladder (failing test → curl → CLI+fixture diff → headless browser → trace replay → throwaway harness → fuzz → bisection → differential → HITL bash), TRDA gate definition, and tighten-the-loop heuristics. Leading words `tight` and `red` are present verbatim (verified by `tests/skills/feedback-loop.test.ts`).
- [ ] `tdd-coach` MD frontmatter and body incorporate the horizontal-slice anti-pattern framing verbatim and add the no-silent-regression-during-refactor rule (test count must not decrease during a refactor step) — verified by `tests/agents/tdd-coach-anti-pattern.test.ts`.
- [ ] <!-- Applied: P-08 — moved to Phase 2b --> Phase 2b ships AT LEAST 3 edge-case regression tests: (a) re-retire of an already-retired loop exits `LOOP_IMMUTABLE` AND a read of the same loop returns the retired-state snapshot, (b) read of a retired loop's state succeeds (queryable-after-retire), (c) `--override-loop-gate` with an empty reason fails validation. Each MUST be a discrete `it()` block in the named test files; coverage report records all three.
- [ ] <!-- Applied: PH-H1 — sediment-baseline for Phase 5 mid-flight pass --> Phase 2b EXIT condition: `scripts/sediment-sweep/no-op-test.ts --baseline` writes `planning/history/coverage/sediment-baseline-phase2.toon` with a non-zero `bodyLineCount` across all `SKILL.md` files. This baseline is the denominator for Phase 5a/5b's ≥20% retirement claim. Without it Phase 5b's CT-08 cannot be evaluated.
- [ ] Phase 2b ENTRY precondition: Phase 2a Wave Gate (Wave 2a → Wave 2b) passing. Specifically `bunx vitest run tests/agents/loom-bugfix-gate.test.ts tests/agents/loom-converge-loop-construction.test.ts tests/regressions/linked-loops-lint-typecheck.test.ts tests/regressions/stuck-at-loop-construction.test.ts tests/regressions/loom-converge-criteria-boundary.test.ts` exits 0.
- [ ] `bunx vitest run tests/agents/tdd-coach-anti-pattern.test.ts tests/skills/feedback-loop.test.ts tests/regressions/retired-loop-immutable.test.ts tests/regressions/override-loop-gate-empty-reason.test.ts tests/regressions/stuck-at-loop-construction-hitl.test.ts` exits 0.

#### Convergence Targets

- `bunx vitest run tests/skills/feedback-loop.test.ts` exits 0 — leading-word assertion + 10-rung enumeration assertion both pass.
- `bunx vitest run tests/agents/tdd-coach-anti-pattern.test.ts` exits 0 — horizontal-slice + no-silent-regression assertions pass.
- `scripts/sediment-sweep/no-op-test.ts --baseline` writes a non-empty `sediment-baseline-phase2.toon`.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: tdd-coach refuses horizontal slicing
given[1]: tdd-coach agent body is loaded into a session
when: A caller asks tdd-coach to "write all tests first, then implement"
whenTriggerType: actor-action
then[2]: The response MUST cite the horizontal-slice anti-pattern verbatim, The response MUST recommend a vertical tracer-bullet red-green-refactor instead
stateRef:
tags[1]: happy-path
testTier: qa-review
automatable: false
```

```toon
id: S-02
title: Refactor step never reduces test count
given[1]: A fixture refactor commit that deletes a test file without replacement
when: tdd-coach reviews the refactor diff
whenTriggerType: actor-action
then[2]: tdd-coach MUST emit a finding citing "no silent regression during refactor", The finding MUST cite the deleted test path and the unchanged test-count expectation
stateRef:
tags[2]: regression, error
testTier: integration
automatable: true
```

```toon
id: S-03
title: feedback-loop skill body asserts leading-word presence of tight and red
given[1]: skills/feedback-loop/SKILL.md is on disk
when: A scan counts occurrences of "tight" and "red" as leading words of body sentences
whenTriggerType: system-event
then[2]: The body MUST contain at least one sentence whose leading word is "tight", The body MUST contain at least one sentence whose leading word is "red"
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

```toon
id: S-04
title: Sediment baseline captures non-zero SKILL.md body line count at Phase 2b exit
given[1]: All SKILL.md files exist on disk at Phase 2b exit
when: scripts/sediment-sweep/no-op-test.ts --baseline runs
whenTriggerType: api-call
then[2]: planning/history/coverage/sediment-baseline-phase2.toon MUST be written atomically, The aggregate bodyLineCount across all SKILL.md MUST be greater than zero
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

```toon
id: S-05
title: Override-loop-gate with empty reason fails validation
given[1]: A fixture project with a loop.toon in construction state
when: The operator passes --override-loop-gate "" (empty string)
whenTriggerType: api-call
then[2]: Exit code MUST be non-zero with errorCode VALIDATION_ERROR, loop.toon.escapeReason MUST remain null
stateRef: construction
tags[2]: regression, error
testTier: integration
automatable: true
```

---

### Phase 3 — Wave 3: Phase C — codebase health + planning quality (PARALLEL TRACK)

**Agent:** implementer-agent
**Objective:** Ship `/loom-deepen`, `/loom-prototype`, and the planning-agent sharpening (tracer-bullet, ideal-seam-count=1, prefactor step). Runs in parallel with Phase 4.
**Dependencies:** Phase 0, Phase 1, Phase 2a, Phase 2b <!-- Applied: AW-B4 -->
**File Ownership:**
- `commands/loom-deepen.md` (CREATE)
- `commands/loom-prototype.md` (CREATE)
- `commands/loom-plan/create.md` (MODIFY) *implementer resolves the canonical filename*
- `commands/loom-plan/materialize.md` (MODIFY)
- `agents/parallelization-agent.md` (MODIFY)
- `agents/phasing-agent.md` (MODIFY)
<!-- Applied: P-03 — explicit disjointness with Phase 4 -->
**Disjoint from Phase 4 (asserted):** Phase 3 owns ONLY the four planning agents above (`commands/loom-plan/create.md`, `commands/loom-plan/materialize.md`, `parallelization-agent`, `phasing-agent`) under `agents/`. Phase 3 does NOT touch `agents/roadmap-converge-reviewer.md`, `agents/code-reviewers/**`, or `commands/loom-note.md` / `commands/loom-do.md` — those are exclusively Phase 4's. The wave validator MUST flag any overlap.
- `scripts/loom-deepen/explore-runner.ts` (CREATE — fan-out Explore subagent invocation)
- `scripts/loom-deepen/render-html.ts` (CREATE — opt-in HTML renderer)
- `scripts/loom-prototype/completion-ceremony.ts` (CREATE — writes `answer.toon`, updates ADR)
- `tests/commands/loom-deepen.test.ts` (CREATE)
- `tests/commands/loom-prototype.test.ts` (CREATE)
- `tests/agents/plan-create-prefactor.test.ts` (CREATE)
- `tests/agents/phasing-tracer-bullet.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-deepen.md` | Create | implementer-c |
| `commands/loom-prototype.md` | Create | implementer-c |
| `commands/loom-plan/create.md` | Modify | implementer-c |
| `commands/loom-plan/materialize.md` | Modify | implementer-c |
| `agents/parallelization-agent.md` | Modify | implementer-c |
| `agents/phasing-agent.md` | Modify | implementer-c |
| `scripts/loom-deepen/explore-runner.ts` | Create | implementer-c |
| `scripts/loom-deepen/render-html.ts` | Create | implementer-c |
| `scripts/loom-prototype/completion-ceremony.ts` | Create | implementer-c |
| `tests/commands/loom-deepen.test.ts` | Create | implementer-c |
| `tests/commands/loom-prototype.test.ts` | Create | implementer-c |
| `tests/agents/plan-create-prefactor.test.ts` | Create | implementer-c |
| `tests/agents/phasing-tracer-bullet.test.ts` | Create | implementer-c |

#### Acceptance Criteria

- [ ] `/loom-deepen` run on `loom-ai` itself produces ≥3 deepening candidates with before/after diagrams, each using `protocols/codebase-design.md` vocabulary (Module, Seam, Depth, Adapter).
- [ ] Default `/loom-deepen` output is TOON at `.plan-execution/reports/deepen-{date}.toon`; `--html` ALSO writes `.html`; when neither flag is passed, no `.html` is created.
- [ ] When `--html` is passed and `open`/`xdg-open`/`start` fails, the command prints the HTML path to stdout with the literal line `open this in a browser` and exits 0.
- [ ] `/loom-prototype <name> --branch logic` scaffolds a terminal app at `prototypes/{name}/`, marked throwaway, single run command, no persistence.
- [ ] `/loom-prototype` completion ceremony writes a one-line TOON `answer.toon` AND, when `--adr <ADR-NNNN>` was passed, appends a `prototypeAnswer:` line to the referenced ADR.
- [ ] `loom-plan create` + `loom-plan materialize` adopt tracer-bullet vertical slices; the agent bodies cite the verbatim phrase "make the change easy, then make the easy change"; `phasing-agent` body adds the ideal-seam-count=1 rule.
- [ ] Plan-create test fixture: a generated plan for a multi-feature roadmap MUST include a Wave-0 prefactor deliverable when the codebase scan flags a shared-file shape that would block parallel waves.
- [ ] `bunx vitest run tests/commands/loom-deepen.test.ts tests/commands/loom-prototype.test.ts tests/agents/plan-create-prefactor.test.ts tests/agents/phasing-tracer-bullet.test.ts` exits 0.

#### Convergence Targets

- `/loom-deepen --target loom-ai` produces ≥3 candidate rows; output validates against the documented TOON shape.
- `/loom-prototype foo --branch logic --adr ADR-0000` produces `prototypes/foo/answer.toon` AND mutates `docs/adr/0000-adr-convention.md` to contain a `prototypeAnswer:` line.
- Plan-create fixture run produces a Wave 0 with at least one prefactor deliverable on the shared-file fixture.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: /loom-deepen surfaces ≥3 candidates with codebase-design vocabulary
given[1]: /loom-deepen is registered and the loom-ai repo is present
when: The operator runs /loom-deepen --target loom-ai
whenTriggerType: api-call
then[4]: At least 3 candidate rows MUST appear in the TOON output, Every candidate MUST cite at least one term from {Module, Seam, Depth, Adapter, Leverage, Locality}, Every candidate row MUST reference a before-diagram artifact AND an after-diagram artifact path that exists on disk, Default output MUST be TOON only and no HTML file MUST exist <!-- Applied: IC-003 -->
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: --html opt-in writes HTML alongside TOON
given[1]: /loom-deepen is invoked with --html on a fixture project
when: The OS open shim succeeds
whenTriggerType: api-call
then[2]: A TOON file MUST exist at the canonical path, An HTML file MUST exist at the canonical path with the same date stem
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-03
title: --html headless fallback prints path and exits 0
given[1]: A fixture environment where open/xdg-open/start all fail
when: /loom-deepen --html runs
whenTriggerType: api-call
then[3]: Exit code MUST be 0, stdout MUST contain the literal line "open this in a browser", stderr MUST emit HTML_OPEN_FAILED at info severity
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-04
title: /loom-prototype completion ceremony updates the linked ADR
given[2]: ADR-0001 exists, /loom-prototype foo --branch logic --adr ADR-0001 has scaffolded the prototype
when: The operator signals completion by writing the answer
whenTriggerType: actor-action
then[3]: prototypes/foo/answer.toon MUST exist with a single line summary, docs/adr/0001-*.md MUST contain a new prototypeAnswer: line, A second completion attempt MUST exit with code 1 to prevent duplicate writes
stateRef:
tags[2]: happy-path, edge-case
testTier: integration
automatable: true
```

```toon
id: S-05
title: Plan-create emits a prefactor deliverable when shared-file shape is detected
given[1]: A fixture roadmap with two features whose modules touch the same shared file
when: loom-plan create runs against the fixture
whenTriggerType: api-call
then[2]: The generated PLAN.md Wave 0 MUST contain at least one prefactor deliverable, The plan body MUST cite the phrase "make the change easy then make the easy change"
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

---

### Phase 4 — Wave 3: Phase D — inbox + convergence hygiene (PARALLEL TRACK)

**Agent:** implementer-agent
**Objective:** Land the triage state machine, `.out-of-scope/` rejection log with visible suppression, and ADR conflict callouts in `roadmap-converge-reviewer` and code reviewers. Runs in parallel with Phase 3 (no file overlap).
**Dependencies:** Phase 0, Phase 1, Phase 2a, Phase 2b <!-- Applied: AW-B4 -->
**File Ownership:**
- `commands/loom-note.md` (MODIFY — triage state machine)
- `commands/loom-do.md` (MODIFY — redundancy checks)
- `agents/roadmap-converge-reviewer.md` (MODIFY — read `.out-of-scope/`, ADR cross-check)
- `scripts/triage/state-machine.ts` (CREATE — transition enforcement)
- `scripts/triage/30day-sweep.ts` (CREATE — `needs-info → wontfix` timeout)
- `scripts/out-of-scope/suppress.ts` (CREATE — match-and-callout logic invoked by `loom-roadmap converge`)
- Reviewer agents (MODIFY — add ADR cross-check section): `agents/accessibility-reviewer.md`, `agents/api-design-reviewer.md`, `agents/architecture-reviewer.md`, `agents/data-schema-reviewer.md`, `agents/database-schema-reviewer.md`, `agents/infra-reviewer.md`, `agents/observability-reviewer.md`, `agents/performance-reviewer.md`, `agents/security-reviewer.md` <!-- Applied: PR-B3 + AW-B3 — replaced phantom agents/code-reviewers/*.md with enumerated flat-layout files verified on disk -->
<!-- Applied: P-03 — explicit disjointness with Phase 3 -->
**Disjoint from Phase 3 (asserted):** Phase 4 owns `agents/roadmap-converge-reviewer.md` AND the 9 enumerated reviewer files listed above. Phase 4 does NOT touch `commands/loom-plan/create.md`, `commands/loom-plan/materialize.md`, `agents/parallelization-agent.md`, or `agents/phasing-agent.md` — those are exclusively Phase 3's. The wave validator MUST flag any overlap.
- `tests/commands/loom-note-triage.test.ts` (CREATE)
- `tests/commands/loom-do-redundancy.test.ts` (CREATE)
- `tests/scripts/out-of-scope-suppress.test.ts` (CREATE)
- `tests/scripts/triage-state-machine.test.ts` (CREATE — 30-day timeout + transition enforcement with date-mocked fixture) <!-- Applied: PH-B2 -->
- `tests/agents/roadmap-converge-reviewer-oos.test.ts` (CREATE)
- `tests/agents/code-reviewer-adr-conflict.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-note.md` | Modify | implementer-d |
| `commands/loom-do.md` | Modify | implementer-d |
| `agents/roadmap-converge-reviewer.md` | Modify | implementer-d |
| `agents/accessibility-reviewer.md` | Modify | implementer-d |
| `agents/api-design-reviewer.md` | Modify | implementer-d |
| `agents/architecture-reviewer.md` | Modify | implementer-d |
| `agents/data-schema-reviewer.md` | Modify | implementer-d |
| `agents/database-schema-reviewer.md` | Modify | implementer-d |
| `agents/infra-reviewer.md` | Modify | implementer-d |
| `agents/observability-reviewer.md` | Modify | implementer-d |
| `agents/performance-reviewer.md` | Modify | implementer-d |
| `agents/security-reviewer.md` | Modify | implementer-d |
| `scripts/triage/state-machine.ts` | Create | implementer-d |
| `scripts/triage/30day-sweep.ts` | Create | implementer-d |
| `scripts/out-of-scope/suppress.ts` | Create | implementer-d |
| `tests/commands/loom-note-triage.test.ts` | Create | implementer-d |
| `tests/commands/loom-do-redundancy.test.ts` | Create | implementer-d |
| `tests/scripts/out-of-scope-suppress.test.ts` | Create | implementer-d |
| `tests/scripts/triage-state-machine.test.ts` | Create | implementer-d |
| `tests/agents/roadmap-converge-reviewer-oos.test.ts` | Create | implementer-d |
| `tests/agents/code-reviewer-adr-conflict.test.ts` | Create | implementer-d |

#### Acceptance Criteria

- [ ] Every triage transition listed in the `TriageState` state machine is implemented in `scripts/triage/state-machine.ts` and rejects undocumented transitions with `INVALID_TRANSITION` or `WONTFIX_REOPEN_REQUIRED`.
- [ ] Every `loom-note add` writes `createdAt`, `updatedAt`, and an initial `transitions[]` row; every subsequent state change appends to `transitions[]`.
- [ ] AI disclaimer prefix `> *This was generated by AI during triage.*` is present on every bot-posted comment — verified by a fixture that traps `loom-do` triage comments and asserts the prefix.
- [ ] `needs-info → needs-triage` transition fires on any reporter-side wiki/issue comment; verified by the fixture harness simulating a reporter comment.
- [ ] `needs-info → wontfix` after 30 days of no response — verified by `tests/scripts/triage-state-machine.test.ts` with a date-mocked fixture. <!-- Applied: PH-B2 — citation corrected to match actually-created file -->
- [ ] `wontfix` is terminal but reopen via `/loom-note reopen <id> --reason "..."` requires a mandatory reason and appends a `transitions[]` row with `actor` and `reason`.
- [ ] `loom-do` runs two redundancy checks before triage assignment: (a) already implemented (queries wiki + plan), (b) prior rejection (queries `.out-of-scope/`).
- [ ] `.out-of-scope/` lookup during `loom-roadmap converge` surfaces a one-line callout with the matched entry id, rejection date, and rationale — never silent suppression — verified by `tests/scripts/out-of-scope-suppress.test.ts`.
- [ ] `roadmap-converge-reviewer` cross-checks ADRs in the area being reviewed and emits findings using the "contradicts ADR-NNNN but worth reopening because…" framing — verified by `tests/agents/code-reviewer-adr-conflict.test.ts`.
- [ ] `bunx vitest run tests/commands/loom-note-triage.test.ts tests/commands/loom-do-redundancy.test.ts tests/scripts/out-of-scope-suppress.test.ts tests/scripts/triage-state-machine.test.ts tests/agents/roadmap-converge-reviewer-oos.test.ts tests/agents/code-reviewer-adr-conflict.test.ts` exits 0.

#### Convergence Targets

- A second `loom-roadmap converge` pass over a previously-rejected idea reads `.out-of-scope/` and surfaces a visible suppression callout (literal one-line format documented in `protocols/out-of-scope.schema.md`).
- `loom-note` fixture exercise: every documented transition succeeds; every undocumented transition exits non-zero with the documented error code.
- `loom-do` fixture exercise: an enhancement whose matching ADR exists is flagged before triage.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: Visible suppression callout fires on previously-rejected idea
given[2]: .out-of-scope/OOS-01.md exists with idea "X", A roadmap converge pass surfaces a new proposal matching idea "X"
when: loom-roadmap converge processes the proposal
whenTriggerType: api-call
then[3]: stdout MUST emit a one-line callout naming OOS-01, The callout MUST include the rejection date and rationale, The proposal MUST NOT be silently dropped — it is marked for operator decision
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: needs-info ages out to wontfix after 30 days
given[2]: A triage entry in state needs-info with updatedAt 31 days ago, scripts/triage/30day-sweep.ts is invoked
when: The sweep runs with the date-mocked fixture
whenTriggerType: system-event
then[2]: The entry's state MUST transition to wontfix, transitions[] MUST contain a row with reason "timeout-30d"
stateRef: wontfix
tags[1]: edge-case
testTier: unit
automatable: true
```

```toon
id: S-03
title: wontfix entries require explicit reopen with reason
given[1]: A triage entry in state wontfix
when: An agent attempts to set state needs-triage without going through /loom-note reopen
whenTriggerType: api-call
then[2]: The mutation MUST fail with errorCode WONTFIX_REOPEN_REQUIRED, transitions[] MUST be unchanged
stateRef:
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-04
title: Bot-posted triage comments carry AI disclaimer prefix
given[1]: loom-do triages a new note and decides to post a clarifying question
when: The bot writes the comment via the configured commenting surface
whenTriggerType: actor-action
then[1]: The comment body MUST begin with the literal prefix "> *This was generated by AI during triage.*"
stateRef:
tags[1]: regression
testTier: integration
automatable: true
```

<!-- Applied: CG-007 -->
```toon
id: S-06
title: loom-do redundancy check flags already-implemented request via wiki + plan query
given[2]: A fixture wiki page documenting feature X is already shipped, A fixture PLAN.md whose phases include feature X
when: A user submits a duplicate "please add feature X" request and loom-do triages it
whenTriggerType: api-call
then[3]: loom-do MUST query both the wiki and the plan before triage assignment, stdout MUST emit a one-line callout naming the matching wiki page AND the matching plan phase, The note MUST be marked with the already-implemented redundancy reason and routed to ready-for-human
stateRef:
tags[2]: regression, happy-path
testTier: integration
automatable: true
```

```toon
id: S-05
title: Code reviewer flags ADR contradiction with reopening framing
given[2]: ADR-0007 exists with status accepted, A code change proposes the opposite of ADR-0007's decision
when: A code reviewer reviews the diff
whenTriggerType: actor-action
then[2]: The reviewer MUST emit a finding citing ADR-0007 by id, The finding text MUST contain the FULL literal framing string "contradicts ADR-0007 but worth reopening because" (no abbreviation; tested via substring match against the unabridged sentence) <!-- Applied: IC-002 -->
stateRef:
tags[1]: regression
testTier: qa-review
automatable: false
```

---

<!-- Applied: PH-H5 — Phase 5 split into Phase 5a (session polish: loom-pause + grilling) and Phase 5b (tooling polish: HTML renderer + skill autoload audit + sediment sweep + loom-doctor + vocab-collision). Phase 5b MAY run in parallel with Phase 6 (Wave 5) since Phase 5b owns scripts/* + tools and Phase 6 owns the coverage audit + NOTICE/README — file ownership is disjoint. -->

### Phase 5a — Wave 4: Phase E core — session polish (loom-pause + grilling)

**Agent:** implementer-agent
**Objective:** Land the session-polish layer — `loom-pause` handoff hygiene (tmp-dir + secret redaction + shim for pre-F-18 paths) and `protocols/grilling.md` full content (replacing the Phase 0 stub with 12-question cap, progress indicator, `/skip` escape).
**Dependencies:** Phase 0, Phase 1, Phase 2a, Phase 2b, Phase 3, Phase 4
**File Ownership:**
- `commands/loom-pause.md` (MODIFY)
- `agents/loom-pause-handoff-author.md` (MODIFY) *implementer resolves canonical name*
- `scripts/loom-pause/secret-redactor.ts` (CREATE)
- `scripts/loom-pause/handoff-shim.ts` (CREATE — resolves pre-F-18 handoff paths to new tmp-dir convention)
- `protocols/grilling.md` (MODIFY — replace stub with full content + 12-question cap)
- `tests/commands/loom-pause-handoff.test.ts` (CREATE)
- `tests/protocols/grilling-12cap.test.ts` (CREATE)
- `tests/regressions/handoff-shim.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-pause.md` | Modify | implementer-5a |
| `agents/loom-pause-handoff-author.md` | Modify | implementer-5a |
| `scripts/loom-pause/secret-redactor.ts` | Create | implementer-5a |
| `scripts/loom-pause/handoff-shim.ts` | Create | implementer-5a |
| `protocols/grilling.md` | Modify (replace stub) | implementer-5a |
| `tests/commands/loom-pause-handoff.test.ts` | Create | implementer-5a |
| `tests/protocols/grilling-12cap.test.ts` | Create | implementer-5a |
| `tests/regressions/handoff-shim.test.ts` | Create | implementer-5a |

#### Acceptance Criteria

- [ ] `loom-pause` writes handoff doc to tmp dir (default `$TMPDIR/loom-handoff-{id}.md`); workflow state remains in `.plan-execution/`.
- [ ] Handoff doc body contains a `suggestedSkills[]` section, references PRDs/ADRs/issues by path (no duplication), and reports `redactedSecretsCount`.
- [ ] Secret redactor pass strips matches against the documented secret-pattern list and increments `redactedSecretsCount`.
- [ ] Pre-F-18 handoff docs remain valid via `scripts/loom-pause/handoff-shim.ts` which resolves old paths to the new tmp-dir convention — verified by `tests/regressions/handoff-shim.test.ts`.
- [ ] `protocols/grilling.md` documents: one question at a time (GR-01), recommend an answer (GR-02), walk every branch (GR-03), prefer codebase exploration over asking (GR-04), cap of 12 questions per session (GR-05 + extension), progress indicator format, and `/skip` escape. The 5 core Phase-0 stub rules MUST appear verbatim in the full file (forward-compat assertion).
- [ ] `loom-roadmap converge`, `loom-plan`, `loom-bugfix` can invoke `protocols/grilling.md` discipline; the 12-question cap is enforced — verified by `tests/protocols/grilling-12cap.test.ts`.
- [ ] `bunx vitest run tests/commands/loom-pause-handoff.test.ts tests/protocols/grilling-12cap.test.ts tests/regressions/handoff-shim.test.ts` exits 0.

#### Convergence Targets

- `loom-pause` fixture run: handoff file lives in `$TMPDIR`, contains the `suggestedSkills[]` section, contains zero duplicated PRD text, and `redactedSecretsCount` is correct.
- `protocols/grilling.md` invocation in fixture: question 13 is refused with the 12-cap message; `/skip` exits without escalation.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: loom-pause writes handoff to tmp dir with redaction count
given[1]: A fixture session containing one secret-like token in agent output
when: The operator invokes loom-pause
whenTriggerType: api-call
then[4]: A handoff file MUST be created under $TMPDIR matching the documented filename pattern, The file MUST contain a suggestedSkills[] section, The file MUST contain a redactedSecretsCount field equal to 1, The original secret string MUST NOT appear in the file body
stateRef:
tags[2]: happy-path, regression
testTier: integration
automatable: true
```

```toon
id: S-02
title: Pre-F-18 handoff path resolves via shim
given[1]: A pre-F-18 handoff file path at the legacy location
when: A consumer of the new tmp-dir convention reads the legacy path through the shim
whenTriggerType: api-call
then[2]: The shim MUST return a usable path, A direct read of the new tmp-dir path MUST succeed
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

```toon
id: S-03
title: grilling enforces the 12-question cap with progress indicator
given[1]: A grilling session in progress at question 12
when: The skill attempts to ask question 13
whenTriggerType: actor-action
then[3]: The skill MUST refuse and emit the documented cap message, The session transcript MUST include a progress indicator showing 12 of 12, The /skip escape MUST be reachable at any time before question 13
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

---

### Phase 5b — Wave 4 (parallelizable with Phase 6): Phase E tooling polish — HTML renderer + skill autoload audit + sediment sweep + vocab-collision

**Agent:** implementer-agent
**Objective:** Land the tooling-polish layer — `--html` opt-in across more surfaces, skill autoload audit + deprecation notices, final sediment sweep against the Phase 2b baseline, `loom-doctor` advisory output, and `architecture-reviewer` vocab-collision pass. This phase MAY run in parallel with Phase 6 — file ownership is disjoint (Phase 5b owns `scripts/html-renderer/**`, `scripts/skill-autoload-audit/**`, `scripts/sediment-sweep/**`, and the listed `commands/*` + `agents/*`; Phase 6 owns `planning/history/coverage/**`, `scripts/coverage-audit/**`, `NOTICE`, `README.md`).
**Dependencies:** Phase 0, Phase 1, Phase 2a, Phase 2b, Phase 3, Phase 4, Phase 5a
**File Ownership:**
- `commands/loom-status.md` (MODIFY — `--html` flag)
- `commands/loom-roadmap/status.md` (MODIFY — `--html` flag)
- `scripts/html-renderer/loom-status.ts` (CREATE)
- `scripts/html-renderer/loom-roadmap-status.ts` (CREATE)
- `scripts/skill-autoload-audit/classify.ts` (CREATE)
- `scripts/skill-autoload-audit/deprecation-notice.ts` (CREATE)
- `scripts/sediment-sweep/no-op-test.ts` (CREATE — sentence-by-sentence sweep across all SKILL.md)
- `commands/loom-doctor.md` (MODIFY — advisory output for deprecation notices)
- `agents/architecture-reviewer.md` (MODIFY) <!-- Applied: P-10 — host the CT-07 vocab-collision qa-review pass. **Sequential carve-out vs Phase 4** (iter3 sanity finding): Phase 4 also modifies this file (ADR cross-check section, Wave 3). Phase 4 completes before Phase 5b begins (Wave 3 → Wave 4 boundary), so both edits land on the same file in non-overlapping execution windows. Wave validator MUST treat this as a documented sequential carve-out, not a disjointness violation. -->
- `tests/agents/architecture-review-vocab-collision.test.ts` (CREATE) <!-- Applied: P-10, CG-002 -->
- `tests/commands/loom-status-html.test.ts` (CREATE)
- `tests/commands/loom-roadmap-status-html.test.ts` (CREATE)
- `tests/scripts/skill-autoload-audit.test.ts` (CREATE)
- `tests/scripts/sediment-sweep.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `commands/loom-status.md` | Modify | implementer-5b |
| `commands/loom-roadmap/status.md` | Modify | implementer-5b |
| `scripts/html-renderer/*.ts` | Create | implementer-5b |
| `scripts/skill-autoload-audit/*.ts` | Create | implementer-5b |
| `scripts/sediment-sweep/no-op-test.ts` | Create | implementer-5b |
| `commands/loom-doctor.md` | Modify | implementer-5b |
| `agents/architecture-reviewer.md` | Modify | implementer-5b |
| `tests/agents/architecture-review-vocab-collision.test.ts` | Create | implementer-5b |
| `tests/commands/loom-status-html.test.ts` | Create | implementer-5b |
| `tests/commands/loom-roadmap-status-html.test.ts` | Create | implementer-5b |
| `tests/scripts/skill-autoload-audit.test.ts` | Create | implementer-5b |
| `tests/scripts/sediment-sweep.test.ts` | Create | implementer-5b |

#### Acceptance Criteria

- [ ] `--html` opt-in works on `loom-status`, `loom-roadmap:status`, `/loom-deepen` (from Phase 3), post-converge audits; default output remains plain-text/TOON in all cases.
- [ ] `--html` headless fallback (open shim fails) prints the path and exits 0 across all four surfaces.
- [ ] Skill autoload audit script classifies every `/loom-*` skill on the model-invoked vs user-invoked axis, strips descriptions from user-only ones, sets `disable-model-invocation: true` where appropriate.
- [ ] Every skill whose autoload trigger changes gets a one-time `/loom-doctor` advisory naming the change and the new invocation path — no silent behavior change.
- [ ] Sediment sweep runs the `writing-great-skills` no-op test sentence-by-sentence across all Loom `SKILL.md` files; the Phase 2b baseline at `planning/history/coverage/sediment-baseline-phase2.toon` is the denominator and the final pass at Phase 5b end retires ≥20% of body lines net.
- [ ] <!-- Applied: P-10, CG-002 --> `architecture-reviewer` body is updated to run a vocabulary-collision pass: a diff fixture exercises the agent and asserts it (a) flags any mention of `phase/wave/deliverable` used as a synonym for `Module/Seam/Adapter` in the same paragraph, and (b) emits a finding citing `protocols/codebase-design.md` Section 0. Verified by `tests/agents/architecture-review-vocab-collision.test.ts`.
- [ ] `bunx vitest run tests/commands/loom-status-html.test.ts tests/commands/loom-roadmap-status-html.test.ts tests/scripts/skill-autoload-audit.test.ts tests/scripts/sediment-sweep.test.ts tests/agents/architecture-review-vocab-collision.test.ts` exits 0.
- [ ] Phase 5b ENTRY precondition: Phase 5a Wave Gate passing (handoff + grilling tests green) AND Phase 2b baseline file exists. Verified by orchestrator before implementer-5b spawn.
- [ ] Phase 5b ∥ Phase 6 parallelization permitted: file-ownership map asserts no overlap with Phase 6's `planning/history/coverage/**`, `scripts/coverage-audit/**`, `NOTICE`, `README.md`. Wave validator MUST flag any overlap.

#### Convergence Targets

- `loom-status --html` against a fixture project produces an HTML file AND a TOON/plain-text stdout block; without `--html`, no HTML file is produced.
- Skill autoload audit produces a TOON report at `.plan-execution/reports/skill-autoload-audit-{date}.toon` listing every audited skill with its current and recommended invocation classification.
- Sediment sweep report shows ≥20% body-line retirement net against the Phase 2b baseline.

#### Convergence Tiers

- unit + integration + qa-review (sediment sweep retirement-rate is partly judgmental).

#### Scenarios

<!-- Scenarios S-01 (loom-pause tmp-dir+redaction), S-02 (handoff shim), S-03 (grilling 12-cap) moved to Phase 5a per PH-H5 split. -->

```toon
id: S-04
title: loom-status --html headless fallback prints path
given[1]: A fixture environment where the OS open shim fails
when: loom-status --html runs against a fixture project
whenTriggerType: api-call
then[3]: Exit code MUST be 0, stdout MUST contain the literal line "open this in a browser", An HTML file MUST exist at the documented path
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-05
title: Skill autoload audit emits deprecation notice for changed triggers
given[1]: A skill whose autoload trigger changes during the audit pass
when: The audit script applies the recommended classification
whenTriggerType: system-event
then[2]: A /loom-doctor advisory entry MUST be appended to the doctor advisory file, The advisory text MUST cite both the prior trigger and the new invocation path
stateRef:
tags[1]: regression
testTier: integration
automatable: true
```

```toon
id: S-06
title: Sediment sweep retires at least 20% of SKILL.md body lines
given[1]: A snapshot of all SKILL.md body line counts taken at the mid-flight Phase-2 baseline
when: The final Phase-5 sediment sweep applies the no-op test sentence-by-sentence
whenTriggerType: system-event
then[1]: The post-sweep net body-line count MUST be at most 80% of the baseline
stateRef:
tags[1]: happy-path
testTier: qa-review
automatable: false
```

<!-- Applied: P-10, CG-002 -->
```toon
id: S-07
title: architecture-reviewer flags Module/phase vocabulary collisions
given[2]: A fixture diff that mixes "Module" and "phase" as synonyms in the same paragraph, architecture-reviewer body cites protocols/codebase-design.md Section 0
when: architecture-reviewer reviews the fixture diff
whenTriggerType: actor-action
then[2]: The reviewer MUST emit a finding citing the collision, The finding MUST cite protocols/codebase-design.md Section 0 by anchor
stateRef:
tags[1]: regression
testTier: qa-review
automatable: false
```

---

### Phase 6 — Wave 5: Test-coverage audit + NOTICE attribution

**Agent:** implementer-agent
**Objective:** Produce the test-coverage audit deliverable mapping every F-18 sub-item to ≥1 convergence target OR an explicit `no-test: <rationale>` tag, and land the NOTICE file + README attribution paragraph.
**Dependencies:** Phase 0, Phase 1, Phase 2a, Phase 2b, Phase 3, Phase 4, Phase 5a (Phase 5b ∥ Phase 6 permitted per PH-H5) <!-- Applied: PH-H5 -->
**File Ownership:**
- `planning/history/coverage/F-18-coverage.toon` (CREATE)
- `scripts/coverage-audit/f18-audit.ts` (CREATE)
- `NOTICE` (CREATE or MODIFY)
- `README.md` (MODIFY — one-paragraph acknowledgment section)
- `tests/scripts/f18-coverage-audit.test.ts` (CREATE)
- `tests/regressions/no-per-file-attribution.test.ts` (CREATE)

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| `planning/history/coverage/F-18-coverage.toon` | Create | implementer-audit |
| `scripts/coverage-audit/f18-audit.ts` | Create | implementer-audit |
| `NOTICE` | Create/Modify | implementer-audit |
| `README.md` | Modify | implementer-audit |
| `tests/scripts/f18-coverage-audit.test.ts` | Create | implementer-audit |
| `tests/regressions/no-per-file-attribution.test.ts` | Create | implementer-audit |

#### Acceptance Criteria

- [ ] `planning/history/coverage/F-18-coverage.toon` lists all 23 F-18 sub-items with columns `subItemId, summary, convergenceTargetRefs[], noTestRationale, tier`. Every row has at least one `convergenceTargetRefs[]` entry OR a non-empty `noTestRationale` with the prefix `no-test:`.
- [ ] Sub-items explicitly noted as coverage gaps in the F-18 scope (sub-4 `protocols/skill-authoring.md`, sub-16 handoff hygiene, sub-17 grilling 12-cap, sub-20 skill autoload audit) MUST resolve to a real convergence target — `tests/scripts/f18-coverage-audit.test.ts` asserts none of these four rows carries `no-test:`.
- [ ] <!-- Applied: CG-003 --> `NOTICE` file lists every mattpocock-sourced pattern adopted. The enumerated set MUST include all six of: (1) codebase-design vocabulary, (2) feedback-loop ladder, (3) writing-great-skills no-op test, (4) horizontal-slice anti-pattern, (5) throwaway-prototype branches, (6) grilling discipline. The parser test asserts each of these six labels appears as a distinct entry.
- [ ] README contains a one-paragraph acknowledgment section pointing at `NOTICE`; the README MUST NOT include per-file attribution.
- [ ] `tests/regressions/no-per-file-attribution.test.ts` scans every file under `protocols/`, `skills/`, `agents/`, `commands/` and fails if any contains the literal phrase `Originally from mattpocock` or equivalent inline attribution patterns documented in the test.
- [ ] `bunx vitest run tests/scripts/f18-coverage-audit.test.ts tests/regressions/no-per-file-attribution.test.ts` exits 0.

#### Convergence Targets

- The audit script `scripts/coverage-audit/f18-audit.ts --validate` exits 0 against the produced audit manifest.
- Per-file attribution regression test exits 0 (no matches found).
- NOTICE file parser test asserts ≥6 pattern entries are listed.

#### Convergence Tiers

- unit + integration.

#### Scenarios

```toon
id: S-01
title: Every F-18 sub-item appears in the coverage audit
given[1]: The F-18 scope lists 23 sub-items (1, 2, 3, 4, 4b, 4c, 5, 6, 7, 8, 9, 9b, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21)
when: The coverage audit script reads the audit manifest
whenTriggerType: system-event
then[2]: Every sub-item id MUST appear as a row in F-18-coverage.toon, Every row MUST have either a non-empty convergenceTargetRefs[] OR a noTestRationale beginning with "no-test:"
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

```toon
id: S-02
title: Coverage-gap sub-items resolve to real convergence targets
given[1]: The audit manifest at planning/history/coverage/F-18-coverage.toon
when: The audit script filters to sub-items 4, 16, 17, 20
whenTriggerType: system-event
then[1]: Every one of those 4 rows MUST have a non-empty convergenceTargetRefs[] entry and MUST NOT carry a noTestRationale beginning with "no-test:"
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

```toon
id: S-03
title: No per-file mattpocock attribution exists anywhere
given[1]: A grep fixture listing the literal phrases banned by the attribution policy
when: tests/regressions/no-per-file-attribution.test.ts scans the repo
whenTriggerType: system-event
then[2]: The match count MUST be 0 across protocols/, skills/, agents/, commands/, NOTICE MUST be the sole attribution surface
stateRef:
tags[1]: regression
testTier: unit
automatable: true
```

---

## Verification Commands

```bash
bunx vitest run tests/
scripts/migrate-convergence-state.ts --dry-run < fixtures/pre-f18/convergence-state.toon
scripts/coverage-audit/f18-audit.ts --validate planning/history/coverage/F-18-coverage.toon
```

## Configuration Specification

No new environment variables or config files are introduced by F-18 sub-items in scope for this plan. `convergence-state.toon` schema version is inferred at read time by `detectConvergenceStateVersion`. Path conventions:

- `$TMPDIR` — destination for `loom-pause` handoff docs (defaults per OS; never `.plan-execution/`).
- `.plan-execution/loops/{loopId}.toon` — `loop.toon` storage.
- `.plan-execution/reports/deepen-{date}.{toon|html}` — deepening reports.
- `prototypes/{name}/answer.toon` — prototype completion ceremony output.
- `.out-of-scope/{id}.md` — rejection log.
- `docs/adr/{NNNN}-{kebab-title}.md` — ADRs.
- `planning/history/coverage/F-18-coverage.toon` — audit manifest.

## Validation Rules

Inline in the Schema / Type Definitions section per entity. Cross-cutting rule: every TOON-frontmatter write MUST go via the documented atomic write (`.tmp` + rename) per CLAUDE.md.

## Wave Gates <!-- Applied: PH-B3 -->

Each wave boundary has an executable gate the orchestrator MUST verify before advancing. A gate is "converged-green" only when ALL `requiredTargets[]` rows exit 0. If a gate fails, the `slipRule` names the recovery path (or "none" when no slip is permitted).

### Wave 0 → Wave 1

```toon
requiredTargets[4]:
  - bunx vitest run tests/migrators/convergence-state.test.ts exits 0
  - bunx vitest run tests/protocols/codebase-design.test.ts exits 0
  - bunx vitest run tests/protocols/skill-authoring.test.ts exits 0
  - bunx vitest run tests/protocols/findings-confidence.test.ts exits 0
slipRule: none — Phase 0 foundations are pure additive; if any target fails, Wave 0 re-iterates.
```

### Wave 1 → Wave 2 (Wave 2a)

```toon
requiredTargets[3]:
  - bunx vitest run tests/commands/loom-which.test.ts exits 0
  - bunx vitest run tests/migrators/context-split.test.ts exits 0
  - bunx vitest run tests/migrators/wiki-decisions-to-adrs.test.ts exits 0
slipRule: none — Phase 1 foundations gate Phase 2a's loop-construction work.
```

### Wave 2a → Wave 2b

```toon
requiredTargets[5]:
  - bunx vitest run tests/agents/loom-bugfix-gate.test.ts exits 0
  - bunx vitest run tests/agents/loom-converge-loop-construction.test.ts exits 0
  - bunx vitest run tests/regressions/linked-loops-lint-typecheck.test.ts exits 0
  - bunx vitest run tests/regressions/stuck-at-loop-construction.test.ts exits 0
  - bunx vitest run tests/regressions/loom-converge-criteria-boundary.test.ts exits 0
slipRule: none — Phase 2a is the loop-gate headline; without it Phase 2b's skill primitive has no gate to verify against.
```

### Wave 2b → Wave 3 (M-08-MidCheckpoint)

```toon
requiredTargets[3]:
  - bunx vitest run tests/skills/feedback-loop.test.ts exits 0
  - bunx vitest run tests/agents/tdd-coach-anti-pattern.test.ts exits 0
  - scripts/sediment-sweep/no-op-test.ts --baseline writes planning/history/coverage/sediment-baseline-phase2.toon with non-zero aggregate bodyLineCount
slipRule: M-08-MidCheckpoint slip rule — see `## Milestones` row "M-08-MidCheckpoint" (line ~1660). If this gate fails AND Phase 2 cannot be brought green within the slip window, ROADMAP M-09 slip rule activates: F-19 Phases B/C/D shift to M-09 and only F-19 Phases A + E ship in M-08. Plan executor MUST write `.plan-execution/m-08-slip-signal.toon` when this slip fires.
```

### Wave 3 → Wave 4 (Phase 3 ∥ Phase 4 complete; Wave 4 = Phase 5a)

```toon
requiredTargets[6]:
  - bunx vitest run tests/commands/loom-deepen.test.ts exits 0
  - bunx vitest run tests/commands/loom-prototype.test.ts exits 0
  - bunx vitest run tests/agents/plan-create-prefactor.test.ts exits 0
  - bunx vitest run tests/agents/phasing-tracer-bullet.test.ts exits 0
  - bunx vitest run tests/commands/loom-note-triage.test.ts tests/commands/loom-do-redundancy.test.ts exits 0
  - bunx vitest run tests/scripts/out-of-scope-suppress.test.ts tests/scripts/triage-state-machine.test.ts tests/agents/roadmap-converge-reviewer-oos.test.ts tests/agents/code-reviewer-adr-conflict.test.ts exits 0
slipRule: Phase 3 and Phase 4 are independent parallel tracks. If only one fails its target list, the failing track re-iterates while the green track advances to Wave 4. Wave 4 entry requires BOTH tracks' targets green.
```

### Wave 4 → Wave 5 (Phase 5a → Phase 5b → Phase 6)

Phase 5a gates Phase 5b. Phase 5b MAY run in parallel with Phase 6 (disjoint file ownership).

```toon
phase5aGate:
  requiredTargets[3]:
    - bunx vitest run tests/commands/loom-pause-handoff.test.ts exits 0
    - bunx vitest run tests/protocols/grilling-12cap.test.ts exits 0
    - bunx vitest run tests/regressions/handoff-shim.test.ts exits 0
  slipRule: none — Phase 5a is a small focused phase; failures iterate in place.
phase5bToWave5Gate:
  requiredTargets[5]:
    - bunx vitest run tests/commands/loom-status-html.test.ts exits 0
    - bunx vitest run tests/commands/loom-roadmap-status-html.test.ts exits 0
    - bunx vitest run tests/scripts/skill-autoload-audit.test.ts exits 0
    - bunx vitest run tests/scripts/sediment-sweep.test.ts exits 0 (≥20% retirement against Phase 2b baseline)
    - bunx vitest run tests/agents/architecture-review-vocab-collision.test.ts exits 0
  slipRule: Sediment retirement target (≥20%) is qa-review tier; operator MAY accept a documented shortfall by writing `.plan-execution/sediment-shortfall.toon` with rationale. Other gate failures iterate in place.
phase6Gate:
  requiredTargets[2]:
    - bunx vitest run tests/scripts/f18-coverage-audit.test.ts exits 0
    - bunx vitest run tests/regressions/no-per-file-attribution.test.ts exits 0
  slipRule: none — Phase 6 is the audit terminal; failures block M-08 sign-off.
```

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Phase B agent edits regress existing convergence runs | high | medium | Phase 2 ships behind the existing-callsite fixture suite at `tests/fixtures/pre-f18-convergence/`; all pre-F-18 convergence fixtures under that path must still pass. <!-- Applied: P-09 --> |
| `loom-converge` Phase-0 UX adds friction for trivial loops | medium | medium | `--override-loop-gate` escape hatch; one-line construction prompt with rung-1 default keeps the median path fast. |
| Wave 3 parallel tracks (Phase 3 + Phase 4) accidentally touch shared agent files | medium | low | File-ownership map above lists distinct agent files per phase; wiring conflicts surface as wave-validator errors before execution. |
| Sediment sweep over-aggressively prunes load-bearing skill text | medium | medium | Two passes (mid-flight at Phase 2 end + final at Phase 5 end); each sweep emits a diff for human review; sweep is qa-review tier, not auto-merged. |
| Bootstrap asymmetry confuses test orchestration | low | medium | Sub-23 bootstrap note is documented in the plan; Phase 2 explicitly uses prior-gen `/loom-plan test` (no `--autoconverge`); Phases 3–5 may opt into Phase 2's `loop.toon` primitive. |

## Acceptance Criteria (Final)

Aligned 1:1 with the F-18 convergence-target list in the roadmap scope:

- [ ] **CT-01:** A new `loom-bugfix` run on a hard bug halts at Phase 1 until `loop.toon` exists with `verifiedRed: true` and TRDA gates passed; no hypothesis work before then. Gate applies to autoconverge AND default paths. **Covered by Phase 2a scenarios S-01, S-02.**
- [ ] **CT-02:** An exhausted 10-rung ladder produces a named `stuck-at-loop-construction` state with HITL escalation guidance — verified by a regression test that hits the dead-end intentionally. **Covered by Phase 2a scenario S-03.**
- [ ] **CT-03:** A `loom-converge` run binds each iteration to a single `loopId` and command; lint/typecheck failures spawn their own loops, tracked via `linkedLoops[]`, and surface in `convergence-state.toon`. **Covered by Phase 2a scenarios S-04, S-05.**
- [ ] **CT-04:** A second `loom-roadmap converge` pass over a previously-rejected idea reads `.out-of-scope/` and surfaces a visible suppression callout — oscillation stops, suppression is never silent. **Covered by Phase 4 scenario S-01.**
- [ ] **CT-05:** `/loom-deepen` run on `loom-ai` itself produces ≥3 deepening candidates with before/after diagrams using `protocols/codebase-design.md` vocabulary. Default output is TOON; HTML only with `--html`. **Covered by Phase 3 scenarios S-01, S-02.**
- [ ] **CT-06:** A fresh agent reading `CONTEXT.md` at session start uses domain terms (not generic words) in its first response — measurable via vocabulary diff. **Covered by Phase 1 scenario S-05.**
- [ ] **CT-07:** A vocabulary collision test: agent output for an architecture review uses `Module/Seam/Adapter` terms consistently and never mixes them with `phase/wave/deliverable` for the same concept. **Covered by Phase 0 scenario S-02 (table parser) + Phase 5b scenario S-07 (architecture-reviewer vocab-collision pass).** <!-- Applied: P-10, PH-H5 -->
- [ ] **CT-08:** The `/loom-skill create` wizard's output for a new skill satisfies the no-op test sentence-by-sentence; sediment sweep across existing skills retires ≥20% of body lines. **Covered by Phase 5b scenario S-06.** <!-- Applied: PH-H5 -->
- [ ] **CT-09:** Attribution audit: `NOTICE` file lists all mattpocock-sourced patterns; README has a one-paragraph acknowledgment; no per-file inline attribution. **Covered by Phase 6 scenarios S-02, S-03.**
- [ ] **CT-10:** `convergence-state.toon` migration ships in Phase A and validates against pre-F-18 fixtures. **Covered by Phase 0 scenario S-01.**

## Milestones

| Milestone | Phases | Status gate |
|-----------|--------|-------------|
| M-08-PreCheck-M-06 | (entry to Phase 2a) | <!-- Applied: S-B2 --> F-12 OSS Launch Distribution Phase 1 MUST be complete OR explicitly waived by operator before Phase 2a implementer-agent spawns. Operator waiver requires a TOON note at `.plan-execution/m-06-waiver.toon` with rationale + ISO timestamp. Verified by orchestrator pre-spawn check. |
| M-08-Phase-A | Phase 0, Phase 1 | All Phase-A foundations land; pre-F-18 fixtures parse unchanged. Wave Gate Wave 0→1 + Wave 1→2 passing. |
| M-08-Phase-B-core | Phase 2a | <!-- Applied: AW-B4 --> Loop-construction gate live on all entry paths; CT-01, CT-02, CT-03 all green. Wave Gate Wave 2a→2b passing. |
| M-08-Phase-B-primitive | Phase 2b | <!-- Applied: AW-B4 --> `feedback-loop` skill + tdd-coach discipline land; sediment baseline written. Wave Gate Wave 2b→3 passing. |
| M-08-MidCheckpoint | (post Phase 2b) | <!-- Applied: PH-H4 + roadmap M-09 slip rule (line 596) --> Phase 2a AND Phase 2b MUST be converged-green at this checkpoint. Verified by all Phase 2a + 2b ACs checked + Wave Gate Wave-2b → Wave-3 passing. If NOT met, transition to slip mode per ROADMAP M-09 slip rule: F-19 Phases B/C/D shift to M-09 and only F-19 Phases A + E ship in M-08. Plan executor writes `.plan-execution/m-08-slip-signal.toon` if triggered. |
| M-08-Phase-C | Phase 3 | `/loom-deepen` + `/loom-prototype` + planning sharpening; CT-05 green. |
| M-08-Phase-D | Phase 4 | Triage state machine + visible OOS suppression + ADR callouts; CT-04 green. |
| M-08-Phase-E-session | Phase 5a | <!-- Applied: PH-H5 --> `loom-pause` handoff hygiene + `grilling.md` full content + 12-cap; Wave 4 phase5aGate passing. |
| M-08-Phase-E-tooling | Phase 5b | <!-- Applied: PH-H5 --> HTML renderer + skill autoload audit + sediment sweep + vocab-collision; CT-07 + CT-08 green. Phase 5b ∥ Phase 6 permitted. |
| M-08-Coverage-Audit | Phase 6 | All 23 sub-items mapped to a target or `no-test:`; CT-09 + CT-10 green. |
```

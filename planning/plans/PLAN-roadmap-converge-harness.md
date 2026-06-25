---
planVersion: 2
name: "Roadmap Convergence Harness"
status: completed
completedAt: 2026-06-22T00:00:00Z
created: 2026-06-17
lastReviewed: null
roadmapRef: planning/ROADMAP.md
totalPhases: 8
totalWaves: 6
---

# Plan: Roadmap Convergence Harness

## Overview

Implements F-15 (M-07) — a subjective convergence loop that drives a ROADMAP.md toward "ready" via iterative `review → batched-user-input → mutate` cycles. Ships three new user-facing commands (`/loom-roadmap converge`, `/loom-roadmap sign-off`, `/loom-roadmap status`), five new entities anchored by `RoadmapConvergeState` (registered with the F-13 migration runtime), a dimensional readiness schema with pedagogical rubrics, a lock-file concurrency guard, and multi-roadmap support via slug-derived state paths. Duplicates the shape of `/loom-converge` for v1; shared core is explicitly deferred (per F-15 open product question).

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Skills / commands | Markdown frontmatter (Claude Code SKILL.md form) | — | `/loom-roadmap converge`, `/loom-roadmap sign-off`, `/loom-roadmap status` |
| Agents | Markdown agent definitions | — | `roadmap-converge-reviewer`, `roadmap-converge-driver`, `roadmap-archetype-detector` |
| State format | TOON | 1 | `roadmap-readiness.schema.toon`, `roadmap-converge-state.schema.toon`, state.toon |
| Rubric format | Markdown | — | `protocols/roadmap-rubrics/{dimension}.md` |
| Runtime | TypeScript (bun preferred, npx tsx fallback) | — | Driver scripts, state writer/reader, lock-file manager |
| Migration runtime | F-13 chained walker (`MIGRATIONS["v1->v2"]`, …) | — | Schema-versioned state evolution |
| Test runner | vitest | latest | Unit + integration coverage |
| Config | TOML (`.claude/orchestration.toml`) | — | `[roadmap.converge]` block — `maxPasses`, retire-dimension overrides |
| Concurrency primitive | POSIX file (lstat + mtime check) | — | `.roadmap-converge/{slug}/lock` |

## Schema / Type Definitions

### RoadmapReadinessSchema

Top-level dimensional taxonomy applied to a roadmap. One per archetype (or one universal default).

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| schemaVersion | integer | required, current = 1 | Registered with F-13 runtime |
| archetype | string | required, one of: `cli`, `web-app`, `library`, `data-pipeline`, `research`, `default` | Archetype detector writes one of these |
| version | string | required, semver | e.g., `"1.0.0"` |
| dimensions[] | array<DimensionDef> | required, min 1 | MVP default = 8 |

`DimensionDef`:

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | required, kebab-case, unique within schema |
| rubricRef | string | required, repo-relative path to `protocols/roadmap-rubrics/{name}.md` |
| required | boolean | required; `true` if listed in `roadmap.schema.md` as a required section |
| depends_on[] | array<string> | optional; names of other dimensions that must be green before this is evaluated |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_readiness | archetype, version | COMPOUND PRIMARY | Identify the active schema for a project |
| uq_dimension_name | dimensions[].name | UNIQUE within schema | No duplicate dimension names per archetype |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| RoadmapReadinessSchema | RoadmapDimension (via dimensions[]) | CASCADE (embedded) | CASCADE |
| DimensionDef | RoadmapRubric (file-level) | NO ACTION (rubric file persists even if dimension removed) | NO ACTION |

### RoadmapDimension

Runtime status of one dimension within a converge state.

| Field | Type | Constraints | Validation |
|-------|------|-------------|------------|
| name | string | required, must match a DimensionDef.name in the active schema | Reviewer rejects unknown names |
| status | enum | required, one of: `green`, `yellow`, `red` | No other values accepted |
| evidence | string | optional; free text from reviewer | Capped at 500 chars per dimension |
| blockers[] | array<string> | optional; concrete issues holding back green | Each blocker ≤ 200 chars |
| evidenceRef[] | array<string> | optional; section anchors in ROADMAP.md (e.g., `"#vision"`, `"#risks-mitigations"`) | Each anchor MUST resolve in current ROADMAP.md; mismatch → warning |
| delta_since_last | enum | required, one of: `improved`, `same`, `degraded`, `invalidated`, `new` | `invalidated` set when content_hash mismatches |

### RoadmapRubric

Pedagogical exemplars per dimension (file-based, not stored in state).

| Field | Type | Constraints |
|-------|------|-------------|
| dimension | string (frontmatter) | required; matches DimensionDef.name |
| green | markdown body section | required, header `## Green` |
| yellow | markdown body section | required, header `## Yellow` |
| red | markdown body section | required, header `## Red` |

### RoadmapConvergeState

The durable converge state. Registered with F-13 migration runtime.

| Field | Type | Constraints |
|-------|------|-------------|
| schemaVersion | integer | required, current = 1 |
| roadmapPath | string | required; repo-relative path to the roadmap this state tracks |
| roadmapSlug | string | required; path-safe derivation from roadmapPath sans extension |
| archetype | string | required; one of the 5 archetypes or `default` |
| round | integer | required, ≥ 0; `round=0` is initial state |
| passLimit | integer | required, default 3, max 5 (from `[roadmap.converge] maxPasses`) |
| dimensions[] | array<RoadmapDimension> | required, mirrors schema's dimension count minus archived |
| dimensionSnapshot[] | array<{name, status}> | required (may be empty on `round=0` and `round=1`); snapshot of the prior pass's per-dimension statuses, written at the END of each pass before status recomputation. Used by the Phase 5 stall detector to compare current vs prior dimensions without re-reading the audit trail. <!-- Applied: FC-03 --> |
| open_questions[] | array<OpenQuestion> | required, length ≤ 5 per pass |
| archivedDimensions[] | array<{name, reason, timestamp}> | required (may be empty); records retire-dimension actions |
| suppressedFindings[] | array<{id, dimension, severity, text, suppressed_at}> | required (may be empty); recorded when reviewer drops findings beyond 5-cap |
| roadmap_diff_summary | string | required; one-line `+N -M lines` summary since last pass |
| paused_at | string (ISO 8601) | required; timestamp written when pass completes with batched questions |
| last_reviewer | string | required; agent name that ran the most recent review |
| next_action_hint | string | required; copyable command (e.g., `"/loom-roadmap converge"` or `"/loom-roadmap sign-off"`) |
| content_hash | string | required; sha256 of ROADMAP.md at time of last pass |
| sign_off_state | enum | required, one of: `not-eligible`, `eligible`, `signed-off` |
| sign_off_at | string (ISO 8601) | optional; set only when `sign_off_state = signed-off` |
| sign_off_diff_hash | string | optional; sha256 of ROADMAP.md at sign-off moment |

`OpenQuestion`:

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | required, format `Q-NN`, unique within state |
| dimension | string | required, matches a RoadmapDimension.name |
| text | string | required, ≤ 500 chars |
| asked_at | string (ISO 8601) | required |
| resolved_at | string (ISO 8601) | optional; set when user answers |
| resolution | string | optional; user-provided answer text. **Reserved value `"dimension archived"`** is set automatically (with `resolved_at = timestamp`) when the referenced `dimension` is added to `archivedDimensions[]` (retire-dimension). This is the orphan-resolution rule for archived dimensions and prevents dangling references. <!-- Applied: FC-05 --> |

#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_state | roadmapSlug | PRIMARY | One state per roadmap |
| idx_open_questions_unresolved | open_questions[].resolved_at IS NULL | PARTIAL | Fast resume — fetch unresolved questions |
| uq_question_id | open_questions[].id | UNIQUE within state | No id collisions |

#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| RoadmapConvergeState | OpenQuestion | CASCADE (embedded) | CASCADE |
| RoadmapConvergeState | RoadmapDimension (runtime) | CASCADE (embedded) | CASCADE |
| RoadmapConvergeState | RoadmapReadinessSchema | NO ACTION (schema is a separate file; state references by archetype) | NO ACTION |

### RoadmapConvergeDigest

Rendered view; not stored. Constructed by `/loom-roadmap status` on each invocation.

| Field | Type | Constraints | Derivation |
|-------|------|-------------|------------|
| passNumber | integer | required | = state.round |
| lastTouched | string (ISO 8601) | required | = state.paused_at |
| dimensionStatusLine | string | required | colored glyph per dimension (`✓ vision  ⚠ milestones  ✗ tool-selection …`) |
| openQuestionCount | integer | required | = count(open_questions where resolved_at IS NULL) |
| firstQuestion | string | optional | first unresolved question text verbatim |
| diffSinceLastPass | string | required | = state.roadmap_diff_summary |
| nextActionCommand | string | required | = state.next_action_hint |
| signOffState | enum | required | = state.sign_off_state; one of `not-eligible`, `eligible`, `signed-off`. Lets `/loom-roadmap status` (and consumers of `--json`) tell at a glance whether sign-off is eligible. <!-- Applied: FC-08 --> |

## API Specification

These are slash commands, not HTTP endpoints, but the same spec discipline applies. Each command has a name, arguments, behavior, success exit, and error conditions.

### `/loom-roadmap converge`

**Description:** Run one pass of the roadmap convergence loop — content-hash check, reviewer dispatch (one per dimension), state write, batched-question prompt.
**Auth:** none (local CLI)

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--roadmap <path>` | string | no | `planning/ROADMAP.md` | Path to target roadmap; state path derived as `.roadmap-converge/{slug}/state.toon` |
| `--pass-cap <N>` | integer | no | from `[roadmap.converge] maxPasses` or 3 | Override pass cap for this invocation; max 5 |
| `--force` | boolean | no | false | Bypass stale-lock check (≤ 10 min); refuses if lock < 10 min unless `--force`. Also permitted as the explicit restart trigger from `halted-stalled` (resets stall-detector window) and from `halted-pass-cap` after the user raises `[roadmap.converge].maxPasses` (continues from current round; does not reset round counter). |
| `--archetype <name>` | string | no | (auto-detect) | One of: `cli`, `web-app`, `library`, `data-pipeline`, `research`, `default`. Bypasses the cold-start confirm-or-correct prompt and writes the chosen archetype directly into initial state. Required recovery path for `ARCHETYPE_LOW_CONFIDENCE`. <!-- Applied: FC-01 -->|

**Request body:** N/A (CLI command)

**Success output:** stderr-formatted digest + state.toon written atomically.

**Successful pass writes:**
- `.roadmap-converge/{slug}/state.toon` (atomic via `.tmp` + rename)
- `.roadmap-converge/{slug}/lock` removed on completion
- `.roadmap-converge/{slug}/passes/{round}/reviews.toon` — per-dimension reviewer findings (audit trail)

**Exit codes:**
| Code | Condition |
|------|-----------|
| 0 | Pass completed; state written; user has open questions to answer OR sign-off is eligible |
| 1 | Halted — pass cap reached, structural blockers, or lock conflict |
| 2 | Schema-version drift — state.toon schemaVersion does not match current and migration failed |

**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | LOCK_CONFLICT | Another converge pass holds a lock file < 10 min old |
| 1 | PASS_CAP_REACHED | Round count == passLimit; forces sign-off or halt |
| 1 | ROADMAP_NOT_FOUND | `--roadmap <path>` does not resolve to a readable file |
| 1 | ARCHETYPE_LOW_CONFIDENCE | First-run detection cannot pick a default — user must confirm |
| 2 | SCHEMA_VERSION_DRIFT | state.toon schemaVersion newer than runtime supports |

**Behavior notes:**
- Cold-start: missing state.toon triggers archetype detection prompt, writes initial state with `round=0`, then proceeds to pass 1.
- Content-hash check runs before every pass; mismatch sets every dimension's `delta_since_last = invalidated` and prints a one-line user notice with line-count diff.
- Reviewer fan-out is one agent per dimension, model `sonnet` (per C-05 / per F-15 reviewer); reviewers see ONLY their dimension's section anchors (evidenceRef[]) plus rubric file. Reviewer output is hard-capped at 5 findings per pass at the OUTPUT layer of the driver — overflow rows append to `suppressedFindings[]` with a `"N suppressed"` footer. The cap applies per-dimension (each reviewer's output is capped independently; the aggregate cap across all dimensions is 5 × number of dimensions). <!-- Applied: AW-15 -->
- Lock-file lifecycle: write `{pid, started_at}` at pass start; remove at pass end; stale (>10 min) auto-cleared with stderr advisory; fresh lock without `--force` → LOCK_CONFLICT.
- **User-facing error copy (P-06):** <!-- Applied: P-06 -->
  - `ARCHETYPE_LOW_CONFIDENCE` stderr: `"Cannot auto-detect roadmap archetype. Pick one: [cli|web-app|library|data-pipeline|research|default]. Recovery: rerun with --archetype <name>."`
  - `LOCK_CONFLICT` stderr: `"Another /loom-roadmap converge pass is running (lock acquired N seconds ago). Recovery: wait for it to finish, or rerun with --force after confirming no other run is in progress."`
  - `STALL_DETECTED` stderr: `"No dimension status changed across the last 2 passes AND no open questions were resolved this round. Recovery: run /loom-roadmap converge --force, retire a stuck dimension via [roadmap.converge].retire, or sign off manually."` <!-- Applied: UX-22 -->
  - `PASS_CAP_REACHED` stderr: `"Pass cap (N) reached without all-green. Recovery: raise [roadmap.converge].maxPasses (≤ 5), or /loom-roadmap sign-off manually."`

### `/loom-roadmap sign-off`

**Description:** User explicit sign-off. The ONLY path to `converged` status. Structurally enforces "never auto-fires" — no other code path writes `sign_off_state = signed-off`.
**Auth:** none (local CLI)

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--roadmap <path>` | string | no | `planning/ROADMAP.md` | Target roadmap |
| `--yes` | boolean | no | false | Skip interactive confirmation (still requires explicit invocation, NOT auto-callable) |

**Success output:** Renders 30-sec diff view of ROADMAP.md changes since the prior sign-off (or since `round=0` if first sign-off). Awaits explicit user confirmation, then writes `sign_off_state = signed-off`, `sign_off_at`, `sign_off_diff_hash`.

**Exit codes:**
| Code | Condition |
|------|-----------|
| 0 | Signed off; state updated |
| 1 | Precondition failed (not eligible) |

**Error responses:**
| Exit | Code | When |
|------|------|------|
| 1 | SIGNOFF_NOT_ELIGIBLE:NO_PASS | `sign_off_state != eligible` AND state is `init` (no pass has run) <!-- Applied: UX-03 --> |
| 1 | SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS | `sign_off_state != eligible` AND ≥ 1 unresolved `open_questions[]` <!-- Applied: UX-03 --> |
| 1 | SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS | `sign_off_state != eligible` AND ≥ 1 dimension is not `green` <!-- Applied: UX-03 --> |
| 1 | ROADMAP_NOT_FOUND | `--roadmap <path>` missing |
| 1 | USER_REJECTED | User answered no at the diff-view prompt |

**Behavior notes:**
- Eligibility = ALL dimensions green AND every required dimension present AND zero unresolved open_questions.
- Diff view shows `git diff` between the ROADMAP.md content at `sign_off_diff_hash` (or initial hash) and now; pager view, 30-sec read budget expected.
- The command MUST live as its own file under `commands/loom-roadmap/sign-off.md` — no other command may invoke it programmatically (orchestration check enforced via grep in CI).
- **Empty-diff fallback (P-10):** when there are no ROADMAP.md changes between `sign_off_diff_hash` (or initial hash) and now, render `"No changes since last sign-off — confirm anyway? [y/N]"` instead of an empty pager invocation. <!-- Applied: P-10 -->
- **No-pager fallback (P-10):** when `$PAGER` is unset and no `less`/`more` binary is on `PATH`, dump the full diff to stderr with a banner `"[no pager available — full diff printed]"` rather than failing. <!-- Applied: P-10 -->

### `/loom-roadmap status`

**Description:** Render the digest from `state.toon` alone. No stored digest file.
**Auth:** none (local CLI)

**Arguments:**
| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--roadmap <path>` | string | no | `planning/ROADMAP.md` | Target roadmap |
| `--all` | boolean | no | false | When set, scans `.roadmap-converge/*/state.toon` and renders one digest per slug |
| `--json` | boolean | no | false | Emit the `RoadmapConvergeDigest` as a JSON object to stdout (one JSON object per slug when combined with `--all`). Suppresses glyphs/colour. Stable schema for `/loom-next`, `/loom-status`, and CI consumers. <!-- Applied: FC-07 --> |

**Exit codes:**
| Code | Condition |
|------|-----------|
| 0 | Digest rendered, OR empty-state onboarding message printed (no state.toon yet — see Behavior notes). <!-- Applied: UX-15 --> |
| 1 | `state.toon` exists but is unreadable or corrupt (parse failure, schema mismatch with no migration path). |

**Behavior notes:**
- Pure read; never writes state.
- **Empty-state onboarding (UX-15):** when no `.roadmap-converge/{slug}/state.toon` exists for the target roadmap, exit 0 with stdout: `"No convergence session found for {roadmapPath}. To start one, run: /loom-roadmap converge [--roadmap {roadmapPath}]"`. Absence of state is NOT an error for a read-only status command. Reserve exit 1 for cases where `state.toon` exists but is unreadable. <!-- Applied: UX-15 -->
- When invoked from `/loom-resume` AND both `.plan-execution/pipeline-state.toon` and `.roadmap-converge/{slug}/state.toon` exist, render both digests, most-recently-modified first.

## State Machines

### RoadmapConvergeState lifecycle

```
                  ┌──────────────────────────────────────────┐
                  │                                          ▼
[init/round=0]─→[pass-in-progress]─→[batched-questions]─→[user-input]
                       │                                       │
                       │ (no questions; structural+reviewer    │
                       │  green)                               ▼
                       │                                 [integrator-pass]
                       │                                       │
                       ▼                                       ▼
                 [halted-stalled]                      [dimensions-updated]
                 [halted-pass-cap]                            │
                       │                                     ▼
                       │                            [sign-off-eligible]
                       │                                     │
                       │                                     ▼
                       │                                [converged] ← /loom-roadmap sign-off
                       │
                       └──→ terminal (manual restart only)
```

<!-- Applied: UX-19 — The ASCII diagram above is illustrative. The valid-transitions table below is canonical and adds three return arcs not drawn: `halted-pass-cap → pass-in-progress` (via raised maxPasses), `halted-stalled → pass-in-progress` (via --force), and `converged → pass-in-progress` (via --force re-entry). Treat the table — not the diagram — as the source of truth. -->

**States:**

| State | Description | Entry condition |
|-------|-------------|-----------------|
| init | state.toon written with `round=0`, archetype resolved | First `/loom-roadmap converge` invocation; no prior state |
| pass-in-progress | Reviewer fan-out underway; lock-file held | Pass starts (content-hash check passed or invalidation flagged) |
| batched-questions | Reviewer pass complete; ≥1 question raised | Reviewers emitted findings; written into `open_questions[]` |
| user-input | User is answering open questions (out-of-loop) | Driver returns control to user; state.paused_at set |
| integrator-pass | User answers consumed; mutator updates ROADMAP.md | `/loom-roadmap converge` re-invoked after user answers; resolved questions feed mutator |
| dimensions-updated | Dimension statuses recomputed (and possibly invalidated) | Post-integrator content-hash + dimension recomputation |
| sign-off-eligible | All dimensions green + zero unresolved questions | Transition target from dimensions-updated |
| converged | User has explicitly signed off | Only via `/loom-roadmap sign-off` |
| halted-pass-cap | Round count == passLimit; convergence aborted | Pass cap hit before sign-off-eligible |
| halted-stalled | Successive passes show no `improved` deltas (stall detector — 2 passes same dimension statuses) | Driver detects stall |

**Valid transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| init | pass-in-progress | `/loom-roadmap converge` | Acquire lock, write content_hash |
| pass-in-progress | batched-questions | Reviewer findings non-empty | Write open_questions[], release lock, set paused_at |
| pass-in-progress | sign-off-eligible | Reviewer findings empty AND all green | Release lock, set sign_off_state = eligible |
| pass-in-progress | dimensions-updated | All-green + no questions but content_hash changed mid-pass | Re-flag invalidated deltas; release lock |
| batched-questions | user-input | Driver returns to user | next_action_hint = "Answer open questions, then run /loom-roadmap converge" |
| user-input | integrator-pass | `/loom-roadmap converge` re-invoked after questions answered | Acquire lock, resolve questions in state |
| integrator-pass | dimensions-updated | Mutator applies user resolutions to ROADMAP.md | Recompute content_hash, recompute dimensions |
| dimensions-updated | sign-off-eligible | All-green + zero unresolved | Set sign_off_state = eligible |
| dimensions-updated | pass-in-progress | Not yet all-green; round < passLimit | Increment round, loop |
| dimensions-updated | halted-pass-cap | Round == passLimit, not all-green | Set next_action_hint to "Resolve blockers or /loom-roadmap sign-off manually" |
| dimensions-updated | halted-stalled | Stall detector trips (2 passes identical statuses) | Set next_action_hint = "/loom-roadmap converge --force OR retire-dimension" |
| sign-off-eligible | converged | `/loom-roadmap sign-off` | Set sign_off_state = signed-off, sign_off_at, sign_off_diff_hash |
| halted-pass-cap | pass-in-progress | `/loom-roadmap converge` re-invoked AFTER user raises `[roadmap.converge].maxPasses` in orchestration.toml | Re-read passLimit from config; do NOT reset `round` (continue from current round); release any stale lock; proceed with new pass <!-- Applied: FC-04 / UX-01 --> |
| halted-stalled | pass-in-progress | `/loom-roadmap converge --force` (the `--force` flag is the explicit user opt-in to bypass the stall short-circuit) | Reset stall-detector window (clear `dimensionSnapshot[]`); continue from current round; user may pair with a `[roadmap.converge].retire` edit to break the stall <!-- Applied: FC-04 / UX-02 --> |
| converged | pass-in-progress | `/loom-roadmap converge --force` AFTER user explicitly chooses to re-open the roadmap | Clear `sign_off_state` to `not-eligible`, clear `sign_off_at` and `sign_off_diff_hash`, increment round; documented as a deliberate destructive action in stderr advisory <!-- Applied: UX-02 (re-entry from converged) --> |
| any non-terminal | pass-in-progress | `/loom-roadmap converge` re-invoked after manual ROADMAP.md edit | content_hash mismatch → invalidate all dimensions |

**Invalid transitions:**

| From | To | Error code | Message |
|------|----|------------|---------|
| init | converged | SIGNOFF_NOT_ELIGIBLE:NO_PASS | Cannot sign off before first pass <!-- Applied: UX-18 --> |
| batched-questions | converged | SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS | Open questions must be resolved before sign-off <!-- Applied: UX-18 --> |
| pass-in-progress | pass-in-progress | LOCK_CONFLICT | A pass is already running |
| converged | * (any other) | TERMINAL_STATE | Roadmap is converged; start a new round explicitly with `--force` (see valid transitions for the supported re-entry path) |
| halted-pass-cap | pass-in-progress | PASS_CAP_REACHED | Pass cap reached AND user has NOT raised `[roadmap.converge].maxPasses`. Once the cap is raised, the transition becomes valid (see valid-transitions table). <!-- Applied: FC-04 --> |
| halted-stalled | pass-in-progress | STALL_DETECTED | Stalled AND user did NOT pass `--force`. With `--force` the transition becomes valid (see valid-transitions table). <!-- Applied: FC-04 / UX-02 --> |

**Terminal states:** `converged`, `halted-pass-cap`, `halted-stalled` (the halted states are terminal until explicit user action — raising the cap, retiring a dimension, or manual sign-off).

## Error Handling Specification

### Error Response Format

All command errors emit a one-line stderr message AND a structured `.roadmap-converge/{slug}/last-error.toon` envelope for resumability:

```toon
errorCode: SCREAMING_SNAKE_CASE
message: Human-readable description
suggestion: Concrete next step the user can take
context:
  state: <current state machine state>
  round: <integer>
  timestamp: <ISO 8601>
```

### Error Categories

| Code | Exit | When Used | Retryable |
|------|------|-----------|-----------|
| LOCK_CONFLICT | 1 | Concurrent `/loom-roadmap converge` invocation; lock file < 10 min old | Yes — after the running pass completes or with `--force` |
| CONTENT_HASH_MISMATCH | 0 (advisory, not error) | User manually edited ROADMAP.md between passes | N/A — pass proceeds with invalidated dimensions and a user notice |
| ARCHETYPE_LOW_CONFIDENCE | 1 | Cold-start detection cannot pick a default with confidence | No — user must confirm-or-correct |
| SIGNOFF_NOT_ELIGIBLE | 1 | Umbrella code — `/loom-roadmap sign-off` invoked when state.sign_off_state != eligible. The driver MUST emit exactly one of the three sub-codes below (`:NO_PASS`, `:OPEN_QUESTIONS`, `:RED_DIMENSIONS`) and write the matching `suggestion` field into `.roadmap-converge/{slug}/last-error.toon`. **Tiebreaker when multiple sub-conditions hold simultaneously** (e.g., a `batched-questions` state can have unresolved questions AND red dimensions): evaluate in fixed order `NO_PASS` → `OPEN_QUESTIONS` → `RED_DIMENSIONS` and emit the first match. The other conditions are recorded under `context.additionalBlockers[]` in `last-error.toon` for full diagnostics. <!-- Applied: UX-03 / UX-17 --> | No — fix the precondition (see specific sub-code) |
| SCHEMA_VERSION_DRIFT | 2 | state.toon written by a newer Loom; migration map has no downgrade path | No — upgrade Loom or restore from backup |
| ROADMAP_NOT_FOUND | 1 | `--roadmap <path>` does not resolve | No — fix the path |
| PASS_CAP_REACHED | 1 | Round count == passLimit | Yes — raise `[roadmap.converge] maxPasses` (≤ 5) or sign off manually |
| STALL_DETECTED | 1 | 2 successive passes with identical dimension statuses (no `improved` deltas) | Yes — retire a stuck dimension or `--force` re-run |
| RUBRIC_MISSING | 1 | A DimensionDef's rubricRef does not resolve to a readable file | No — repair the rubric file |
| EVIDENCE_REF_BROKEN | 0 (warning) | An anchor in `evidenceRef[]` no longer resolves in ROADMAP.md | Yes — surfaced in next pass as `delta_since_last = invalidated` |
| SLUG_COLLISION | 1 | Two roadmap paths derive the same slug (e.g., `planning/mobile/ROADMAP.md` and `planning/web/ROADMAP.md` both → `ROADMAP`) | Yes — stderr copy: `"Slug collision: '{slug}' is already in use by '{otherPath}'. Recovery: rename one of the conflicting roadmap files to give it a unique filename. (A --slug override flag is planned for v2 but is not available in MVP.)"` <!-- Applied: UX-04 / FC-02 --> |
| SIGNOFF_NOT_ELIGIBLE:NO_PASS | 1 | `/loom-roadmap sign-off` invoked in `init` state — no convergence pass has run yet | No — stderr: `"No convergence pass has run yet. Run /loom-roadmap converge first."` <!-- Applied: UX-03 --> |
| SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS | 1 | `/loom-roadmap sign-off` invoked while one or more `open_questions[]` are unresolved | No — stderr: `"N open questions must be resolved — run /loom-roadmap converge and answer them."` <!-- Applied: UX-03 --> |
| SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS | 1 | `/loom-roadmap sign-off` invoked while one or more dimensions are not `green` | No — stderr: `"Dimensions still red/yellow: [list]. Run /loom-roadmap converge to address them."` <!-- Applied: UX-03 --> |
| USER_REJECTED | 1 | User answered "no" at the sign-off diff confirmation prompt; roadmap stays in `sign-off-eligible` | Yes — stderr: `"Sign-off cancelled. Roadmap remains in sign-off-eligible state. Run /loom-roadmap status to review, or /loom-roadmap sign-off to try again."` `next_action_hint` set to `/loom-roadmap sign-off`. `last-error.toon` IS written with the cancellation context. <!-- Applied: FC-13 / UX-05 / UX-21 --> |
| INTEGRATOR_NO_ENVELOPE | 1 | Integrator agent returned a payload that is not a valid `AgentResult` TOON envelope (per `protocols/agent-result.schema.md`) | No — inspect integrator output and retry manually; halt the converge pass without applying any mutations <!-- Applied: AW-09 / FC-A2 / F-34 --> |
| REVIEWER_NO_ENVELOPE | non-fatal (driver continues with other dimensions) | Reviewer agent returned a non-AgentResult payload | Yes — driver skips dimension D for the pass, logs warning, records `delta_since_last=same` <!-- Applied: AW-16 --> |

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| LOCK_CONFLICT | Wait or `--force` | Manual (no auto-retry) |
| SCHEMA_VERSION_DRIFT | Halt | 0 |
| STALL_DETECTED | Halt; user picks `retire-dimension` or `--force` | 0 |

## Configuration Specification

`.claude/orchestration.toml`:

```toml
[roadmap.converge]
maxPasses = 3                 # default 3; clamped to max 5
defaultRoadmap = "planning/ROADMAP.md"
stateRoot = ".roadmap-converge"
lockStaleSeconds = 600        # 10 minutes
reviewerModel = "sonnet"      # per C-05 — model for per-dimension reviewers
driverModel = "opus"          # per C-05 — model for converge driver

# Per-project retire-dimension overrides (one-liner per dimension)
retire = ["tool-selection"]   # dimensions to skip evaluation entirely

# Optional per-archetype rubric overrides
[roadmap.converge.rubricOverrides]
# "vision" = "protocols/roadmap-rubrics/vision-strict.md"
```

### Validation

- `maxPasses` MUST be in `[1, 5]`; values outside clamp with a stderr warning.
- `lockStaleSeconds` MUST be ≥ 60.
- `stateRoot` MUST be repo-relative, not absolute.
- `retire[]` entries MUST match DimensionDef.name in the active schema; unknown names → stderr warning and skip.
- Both `reviewerModel` and `driverModel` MUST be a valid model alias for the configured profile in `.claude/orchestration.toml`'s `[profile]` block.

## Execution Phases

<!-- Applied: P-01 — Phase 0 split into 0a (schemas + archetypes + migrator) and 0b (rubrics) to stay under the 8-deliverable per-phase ceiling. Both phases run in Wave 0; 0b depends on 0a only for the dimension-name list. -->

### Phase 0a — Wave 0: Schemas, Archetypes, and Migrator

**Agent:** contracts-agent
**Objective:** Author the readiness + state schemas, archetype enumeration, schema-version registration, and the F-13 migrator for `RoadmapConvergeState`.
**Dependencies:** None
**File Ownership:** `protocols/roadmap-readiness.schema.toon`, `protocols/roadmap-converge-state.schema.toon`, `protocols/roadmap-archetypes.toon`, `protocols/schema-versions.toon`, `scripts/migrators/roadmap-converge-state/**`

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| protocols/roadmap-readiness.schema.toon | Create | contracts-agent |
| protocols/roadmap-converge-state.schema.toon | Create | contracts-agent |
| protocols/roadmap-archetypes.toon | Create | contracts-agent |
| protocols/schema-versions.toon | Modify | contracts-agent |
| scripts/migrators/roadmap-converge-state/detect.ts | Create | contracts-agent |
| scripts/migrators/roadmap-converge-state/index.ts | Create | contracts-agent |

#### Acceptance Criteria

- [ ] `protocols/roadmap-readiness.schema.toon` exists, parses as valid TOON, and defines the 8 MVP default dimensions with rubricRef paths that target files in Phase 0b.
- [ ] `protocols/roadmap-converge-state.schema.toon` exists with all RoadmapConvergeState fields, schemaVersion = 1, and matches the Schema/Type Definitions section.
- [ ] `protocols/roadmap-archetypes.toon` enumerates the 5 archetypes plus `default` with detection-hint keywords.
- [ ] `protocols/schema-versions.toon` includes a `roadmapConvergeState` entry pointing at version 1.
- [ ] `scripts/migrators/roadmap-converge-state/index.ts` exports a frozen `MIGRATIONS` map and a pure `migrateToLatest(input, fromVersion, opts, targetVersion?)` walker per F-13's pattern.
- [ ] `bunx tsc --noEmit` (or `npx tsc --noEmit`) exits with code 0 on the migrator scripts.
- [ ] vitest covers the v1 detection and migration walker round-trip for synthetic fixtures.
- [ ] On completion, contracts-agent writes a StageContext summary to `.plan-execution/stage-context/contracts.toon` atomically (write to `.tmp` then `fs.renameSync`) per `protocols/execution-conventions.md`. <!-- Applied: AW-03 -->

#### Convergence Targets

- `protocols/roadmap-readiness.schema.toon` deserializes via the project's TOON parser into an object whose `dimensions` array length == 8.
- `detectRoadmapConvergeStateVersion(content)` returns `{detected: 1, current: 1, outdated: false}` on a valid v1 fixture and throws `MigrationDowngradeError` on a future v2 fixture.

#### Scenarios

```toon
id: S-02
title: State migrator detects v1 fixture and refuses unknown future version
given[1]: scripts/migrators/roadmap-converge-state/index.ts is built
when: Test invokes detectRoadmapConvergeStateVersion on a v1 fixture, then on a v999 fixture
whenTriggerType: api-call
then[2]: First call returns detected=1 current=1 outdated=false, Second call throws MigrationDowngradeError per F-13
stateRef:
tags[2]: happy-path, error
testTier: unit
automatable: true
```

---

<!-- Applied: P-01 — Phase 0b carries the 8 rubric files split out of the prior monolithic Phase 0. Runs in Wave 0 alongside 0a; file ownership disjoint. -->

### Phase 0b — Wave 0: Rubric Files

**Agent:** contracts-agent
**Objective:** Author the 8 pedagogical rubric files (green/yellow/red exemplars) for the MVP default dimensions.
**Dependencies:** None (file ownership disjoint from Phase 0a)
**File Ownership:** `protocols/roadmap-rubrics/**`

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| protocols/roadmap-rubrics/vision.md | Create | contracts-agent |
| protocols/roadmap-rubrics/milestones.md | Create | contracts-agent |
| protocols/roadmap-rubrics/tool-selection.md | Create | contracts-agent |
| protocols/roadmap-rubrics/data-model.md | Create | contracts-agent |
| protocols/roadmap-rubrics/success-metrics.md | Create | contracts-agent |
| protocols/roadmap-rubrics/constraints.md | Create | contracts-agent |
| protocols/roadmap-rubrics/risks.md | Create | contracts-agent |
| protocols/roadmap-rubrics/out-of-scope.md | Create | contracts-agent |

#### Acceptance Criteria

- [ ] Each of the 8 rubric files exists and contains exactly three required sections: `## Green`, `## Yellow`, `## Red` with non-empty bodies.
- [ ] After Phase 0a completes, every `rubricRef` in `protocols/roadmap-readiness.schema.toon` resolves to a readable file created here.
- [ ] On completion, Phase 0b contracts-agent writes a StageContext summary to `.plan-execution/stage-context/contracts-rubrics.toon` atomically (`.tmp` + `fs.renameSync`) per `protocols/execution-conventions.md`. Distinct path from Phase 0a's `contracts.toon` so Wave 0 completion can be gated on BOTH summaries existing. <!-- Applied: AW-06 / F-31 -->

#### Convergence Targets

- All 8 rubric files exist with the three required section headers.
- After Phase 0a + 0b complete, loading `roadmap-readiness.schema.toon` and verifying each `rubricRef` resolves returns zero broken refs.

#### Scenarios

```toon
id: S-01
title: Readiness schema parses with 8 MVP default dimensions
given[2]: The 8 rubric files exist under protocols/roadmap-rubrics/, The schema file protocols/roadmap-readiness.schema.toon exists
when: A test loads the readiness schema via the TOON parser
whenTriggerType: api-call
then[3]: Parser returns a RoadmapReadinessSchema object, dimensions array length MUST be 8, every dimensions[].rubricRef MUST resolve to a readable file
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-03
title: Every rubric file has all three required sections
given[1]: The 8 rubric files are written
when: A test parses each rubric file with a section extractor
whenTriggerType: api-call
then[1]: Each file MUST contain "## Green", "## Yellow", and "## Red" sections with non-empty bodies
stateRef:
tags[1]: happy-path
testTier: unit
automatable: true
```

---

### Phase 1 — Wave 1: Converge Driver, Reviewer Agent, State I/O, Lock Guard

**Agent:** implementer-agent
**Objective:** Implement the per-pass driver loop, the per-dimension reviewer agent, atomic state read/write, and the lock-file concurrency guard.
**Dependencies:** Phase 0a, Phase 0b
**File Ownership:** `commands/loom-roadmap/converge.md`, `agents/roadmap-converge-driver.md`, `agents/roadmap-converge-reviewer.md`, `scripts/roadmap-converge/**`

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-roadmap/converge.md | Create | implementer-agent |
| agents/roadmap-converge-driver.md | Create | implementer-agent |
| agents/roadmap-converge-reviewer.md | Create | implementer-agent |
| scripts/roadmap-converge/state-io.ts | Create | implementer-agent |
| scripts/roadmap-converge/lock.ts | Create | implementer-agent |
| scripts/roadmap-converge/content-hash.ts | Create | implementer-agent |
| scripts/roadmap-converge/driver.ts | Create | implementer-agent |

#### Acceptance Criteria

- [ ] `/loom-roadmap converge` command file exists with frontmatter referencing `agents/roadmap-converge-driver.md`.
- [ ] `scripts/roadmap-converge/state-io.ts` writes state.toon atomically (`.tmp` + `fs.renameSync`) and reads via the F-13 migrator entrypoint.
- [ ] `scripts/roadmap-converge/lock.ts` writes `{pid, started_at}` at pass start, removes on completion, and aborts on lock ≤ 10 min unless `--force`.
- [ ] `scripts/roadmap-converge/content-hash.ts` returns the sha256 of ROADMAP.md and compares against `state.content_hash`.
- [ ] `scripts/roadmap-converge/driver.ts` orchestrates: hash check → reviewer fan-out (one per dimension, model = `reviewerModel`) → 5-finding cap enforcement → state write → digest emit.
- [ ] Reviewer output is capped at 5 findings per dimension; overflow rows append to `suppressedFindings[]` with a stderr `"N suppressed"` footer. The cap applies per-dimension (not aggregate across all dimensions). <!-- Applied: AW-15 -->
- [ ] Reviewer rendering rule per F-15: when a dimension is `green`, emit nothing; when `yellow`, emit the green-band exemplar inline with the finding; when `red`, emit both the green and red-band exemplars inline. The driver's per-dimension renderer dispatches on `RoadmapDimension.status` and the rubric file's parsed sections. <!-- Applied: P-03 -->
- [ ] `driver.ts` exposes a typed `archetypeDetectionHook` seam (default no-op) that Phase 4 fills with the real detector; the seam's signature accepts `(roadmapPath, existingState | null) => Promise<{archetype: string, confidence: number} | null>`. Documenting the seam here prevents the Phase 4 cold-start AC from being a forward reference. <!-- Applied: P-02 -->
- [ ] vitest covers: lock acquire/release, lock-conflict abort, lock auto-clear after 10 min, content-hash invalidation flag, atomic write, reviewer 5-cap, reviewer-rendering dispatch for each of green/yellow/red, no-op archetype hook returns null without modifying state.
- [ ] `agents/roadmap-converge-driver.md` includes YAML frontmatter `model: opus` (matches `[roadmap.converge].driverModel` and C-05). `agents/roadmap-converge-reviewer.md` includes YAML frontmatter `model: sonnet` (matches `[roadmap.converge].reviewerModel`). Both fields are present BEFORE the agents are ever spawned, per CLAUDE.md mandatory model-resolution rule. <!-- Applied: AW-04 -->
- [ ] `agents/roadmap-converge-reviewer.md` system prompt requires the reviewer to return a standard `AgentResult` envelope in TOON (per `protocols/agent-result.schema.md`); the driver consumes `AgentResult.issues[]` (NOT a custom `findings[]` format) when applying the 5-finding cap. <!-- Applied: AW-05 -->
- [ ] Driver MUST handle non-envelope reviewer output by skipping that dimension with a `REVIEWER_NO_ENVELOPE` warning (logged to stderr; dimension records `delta_since_last=same`), NOT aborting the entire pass. Other dimensions continue normally. <!-- Applied: AW-16 -->
- [ ] `scripts/roadmap-converge/driver.ts` writes a StageContext summary to `.plan-execution/stage-context/execute.toon` atomically on every pass completion (success or halt), per `protocols/execution-conventions.md`. <!-- Applied: AW-03 -->
- [ ] `driver.ts` emits a one-line stderr banner at the start of every pass — `"[roadmap-converge] pass {round}/{passLimit} starting for {slug} — {dimensions.length} dimensions, {open_questions.length} open"` — so users have visible round-start signalling in TTY runs. <!-- Applied: UX-11 -->

#### Convergence Targets

- A fresh-repo run of `/loom-roadmap converge` produces `.roadmap-converge/ROADMAP/state.toon` with `round=1` (after pass 1), valid `dimensions[]` of length 8, and `content_hash` matching `sha256(planning/ROADMAP.md)`.
- A second `/loom-roadmap converge` invocation within 10 min of the first (lock held) exits 1 with stderr containing `LOCK_CONFLICT`.
- Manual edit to ROADMAP.md between passes sets all `dimensions[].delta_since_last = invalidated` on the next pass.
- Reviewer agent invoked with a synthetic 8-finding output emits exactly 5 in state.open_questions[] and 3 in state.suppressedFindings[].

#### Scenarios

```toon
id: S-04
title: First-ever converge pass writes state with round=1
given[2]: No .roadmap-converge directory exists, planning/ROADMAP.md is readable
when: User runs /loom-roadmap converge with default args
whenTriggerType: actor-action
then[4]: Exit code is 0, .roadmap-converge/ROADMAP/state.toon exists, state.round equals 1, state.content_hash equals sha256 of planning/ROADMAP.md
stateRef: pass-in-progress
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-05
title: Concurrent converge invocation aborts with LOCK_CONFLICT
given[1]: A converge pass is currently running (lock file < 10 min old)
when: User invokes /loom-roadmap converge a second time without --force
whenTriggerType: actor-action
then[3]: Exit code is 1, stderr contains LOCK_CONFLICT, second invocation does not modify state.toon
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-06
title: Stale lock (> 10 min) is auto-cleared with stderr advisory
given[1]: A lock file exists with started_at 15 minutes ago
when: User runs /loom-roadmap converge
whenTriggerType: actor-action
then[2]: stderr contains stale-lock advisory, Pass proceeds and exits 0
stateRef:
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-07
title: Manual ROADMAP edit between passes invalidates all dimensions
given[2]: A prior pass left state.toon with content_hash H1, User has edited ROADMAP.md (new hash H2)
when: User runs /loom-roadmap converge
whenTriggerType: actor-action
then[3]: stderr contains one-line notice with +N -M line-count diff, Every dimensions[].delta_since_last equals "invalidated", state.content_hash updates to H2
stateRef: pass-in-progress
tags[1]: edge-case
testTier: integration
automatable: true
```

```toon
id: S-08
title: Reviewer output capped at 5 findings; overflow suppressed
given[1]: A reviewer mock that emits 8 findings for one dimension
when: Driver writes findings into state
whenTriggerType: system-event
then[3]: state.open_questions length MUST equal 5, state.suppressedFindings length MUST equal 3, stderr contains "3 suppressed" footer
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

---

### Phase 2 — Wave 2: Sign-Off Command and 30-Sec Diff View

**Agent:** implementer-agent
**Objective:** Implement `/loom-roadmap sign-off` as the only path to `converged`, with eligibility precondition check and a 30-second diff view of changes since prior sign-off.
**Dependencies:** Phase 0a, Phase 0b, Phase 1
**File Ownership:** `commands/loom-roadmap/sign-off.md`, `scripts/roadmap-converge/sign-off.ts`, `scripts/roadmap-converge/diff-view.ts`

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-roadmap/sign-off.md | Create | implementer-agent |
| scripts/roadmap-converge/sign-off.ts | Create | implementer-agent |
| scripts/roadmap-converge/diff-view.ts | Create | implementer-agent |

#### Acceptance Criteria

- [ ] `/loom-roadmap sign-off` invokes only `scripts/roadmap-converge/sign-off.ts` (no other code path imports it; CI grep guard).
- [ ] Sign-off checks state.sign_off_state == `eligible`; otherwise exits 1 with the appropriate sub-code (`SIGNOFF_NOT_ELIGIBLE:NO_PASS`, `SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS`, or `SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS`) resolved per the tiebreaker order in the Error Categories table. <!-- Applied: UX-18 -->
- [ ] Sign-off renders a `git diff` view between `state.sign_off_diff_hash` (or initial hash) and the current ROADMAP.md, paged.
- [ ] User confirmation prompt; `--yes` skips the prompt but still requires explicit CLI invocation.
- [ ] On confirmation, writes `sign_off_state = signed-off`, `sign_off_at` (now), `sign_off_diff_hash` (current sha256), atomically.
- [ ] No code path outside `scripts/roadmap-converge/sign-off.ts` may write `sign_off_state = signed-off` (verified by a vitest grep test over the `scripts/` tree).
- [ ] On completion, Phase 2 implementer-agent writes a StageContext summary to `.plan-execution/stage-context/execute-signoff.toon` atomically (`.tmp` + `fs.renameSync`) per `protocols/execution-conventions.md`. <!-- Applied: AW-06 -->

#### Convergence Targets

- Sign-off invoked on an ineligible state exits 1 and stderr contains one of `SIGNOFF_NOT_ELIGIBLE:NO_PASS`, `SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS`, or `SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS` (per the tiebreaker order). <!-- Applied: UX-18 -->
- Sign-off invoked on an eligible state with `--yes` updates state.sign_off_state to `signed-off` and writes a sign_off_at timestamp within 5 seconds of invocation.
- A grep over `scripts/roadmap-converge/*.ts` (excluding sign-off.ts) finds zero writes to `sign_off_state`.

#### Scenarios

```toon
id: S-09
title: Sign-off refused when dimensions are not all green
given[2]: state.sign_off_state equals "not-eligible", At least one dimension has status "yellow"
when: User runs /loom-roadmap sign-off --yes
whenTriggerType: actor-action
then[3]: Exit code is 1, stderr contains SIGNOFF_NOT_ELIGIBLE, state.sign_off_state remains "not-eligible"
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

```toon
id: S-10
title: Sign-off succeeds on eligible state and writes converged
given[3]: state.sign_off_state equals "eligible", All dimensions are green, Zero unresolved open_questions
when: User runs /loom-roadmap sign-off --yes
whenTriggerType: actor-action
then[4]: Exit code is 0, state.sign_off_state equals "signed-off", state.sign_off_at is set to a current ISO timestamp, state.sign_off_diff_hash equals sha256 of current ROADMAP.md
stateRef: converged
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-11
title: No code path outside sign-off.ts can write signed-off
given[1]: The scripts/roadmap-converge/ directory is built
when: A grep test scans every .ts file except sign-off.ts for writes to sign_off_state = "signed-off"
whenTriggerType: api-call
then[1]: Grep MUST return zero matches
stateRef:
tags[2]: regression, happy-path
testTier: unit
automatable: true
```

---

<!-- Applied: PH-13 / PR-04 — Phases 2 and 3 share an identical dependency set (Phase 0a + 0b + Phase 1) with fully disjoint file ownership. They are kept in separate sequential waves (Wave 2, Wave 3) deliberately for plan readability and to keep each wave's review surface small; packing them into a single wave is a valid future optimization but adds no value for the MVP. -->

### Phase 3 — Wave 3: Status Command, Digest Renderer, and `/loom-resume` Delegation

**Agent:** implementer-agent
**Objective:** Implement `/loom-roadmap status` as a pure read over `state.toon`, the digest renderer, and `/loom-resume` delegation when `.roadmap-converge/` state exists (with dual-state priority).
**Dependencies:** Phase 0a, Phase 0b, Phase 1
**File Ownership:** `commands/loom-roadmap/status.md`, `scripts/roadmap-converge/digest.ts`, `scripts/roadmap-converge/resume-delegate.ts`

**File modifications outside ownership** (cross-cutting wiring deferred to Phase 6):
- `/loom-resume` integration lives in Phase 6 — this phase only ships the standalone `resume-delegate.ts` library.

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-roadmap/status.md | Create | implementer-agent |
| scripts/roadmap-converge/digest.ts | Create | implementer-agent |
| scripts/roadmap-converge/resume-delegate.ts | Create | implementer-agent |

#### Acceptance Criteria

- [ ] `/loom-roadmap status` reads state.toon, builds a `RoadmapConvergeDigest`, prints to stdout, and exits 0.
- [ ] `--all` flag scans `.roadmap-converge/*/state.toon` and emits one digest per slug.
- [ ] No code path in status.md or digest.ts writes to disk (vitest grep guard).
- [ ] `digest.ts` produces a string that includes: pass number, last-touched timestamp, dimensional status line with glyphs, open-question count, first unresolved question verbatim, line-count diff, next-action command.
- [ ] `resume-delegate.ts` exports a function that takes existence checks of both pipeline-state.toon and roadmap-converge state.toon and returns an ordered list of digest renderings (most-recently-modified first).
- [ ] On completion, Phase 3 implementer-agent writes a StageContext summary to `.plan-execution/stage-context/execute-status.toon` atomically (`.tmp` + `fs.renameSync`) per `protocols/execution-conventions.md`. <!-- Applied: AW-06 -->

#### Convergence Targets

- `/loom-roadmap status` on a state with 3 unresolved questions emits a digest containing the literal string `"3 open questions"` and the first question text verbatim.
- `/loom-roadmap status --all` on a repo with 3 slugs emits exactly 3 digests in mtime-descending order.
- Digest render is byte-identical on two consecutive invocations of `/loom-roadmap status` without state changes (purity check).

#### Scenarios

```toon
id: S-12
title: Status renders digest with all required fields
given[1]: state.toon exists with round=2 and 3 unresolved open_questions
when: User runs /loom-roadmap status
whenTriggerType: actor-action
then[5]: Exit code is 0, stdout contains "Pass 2", stdout contains "3 open questions", stdout contains the first unresolved question text verbatim, stdout contains a next-action command
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-13
title: Status is purely read-only
given[1]: A status invocation completes
when: The .roadmap-converge directory mtime is compared before and after
whenTriggerType: api-call
then[1]: No files in .roadmap-converge are modified by status
stateRef:
tags[2]: regression, happy-path
testTier: unit
automatable: true
```

```toon
id: S-14
title: Dual-state resume orders by mtime
given[2]: .plan-execution/pipeline-state.toon exists with mtime T1, .roadmap-converge/ROADMAP/state.toon exists with mtime T2 (T2 > T1)
when: resume-delegate is called
whenTriggerType: api-call
then[1]: Returned digest list places the roadmap-converge digest first
stateRef:
tags[1]: edge-case
testTier: unit
automatable: true
```

---

### Phase 4 — Wave 4: Multi-Roadmap Support + Archetype Detection

**Agent:** implementer-agent
**Objective:** Add `--roadmap <path>` flag plumbing to all three commands, slug-derived state paths, and cold-start archetype detection (prompt-once with confirm-or-correct).
**Dependencies:** Phase 0a, Phase 0b, Phase 1, Phase 2, Phase 3
**File Ownership:** `scripts/roadmap-converge/slug.ts`, `scripts/roadmap-converge/archetype-detector.ts`, `agents/roadmap-archetype-detector.md`, **`scripts/roadmap-converge/driver.ts`** (acquired in Phase 4 from Phase 1 for the archetype-hook + `--roadmap` plumbing edits; passed forward to Phase 5 — Phase 5 inherits ownership in its own wave, no parallel write). <!-- Applied: PR-02 -->

**Cross-phase modifications:** The `--roadmap` flag plumbing modifies the three command files from Phases 1–3. Because no prior wave is still in flight when Wave 4 runs, this is a permitted cross-wave overlap per `plan.schema.md` File Ownership Rules. **`driver.ts` ownership chain:** Phase 1 creates → Phase 4 acquires for the archetype-hook wiring → Phase 5 inherits for stall-detector + pass-cap wiring. Waves 4 and 5 run sequentially (Phase 5 depends on Phase 4), so the sequential write order is enforced by wave ordering, not file ownership. <!-- Applied: PR-02 -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| scripts/roadmap-converge/slug.ts | Create | implementer-agent |
| scripts/roadmap-converge/archetype-detector.ts | Create | implementer-agent |
| agents/roadmap-archetype-detector.md | Create | implementer-agent |
| commands/loom-roadmap/converge.md | Modify | implementer-agent |
| commands/loom-roadmap/sign-off.md | Modify | implementer-agent |
| commands/loom-roadmap/status.md | Modify | implementer-agent |
| scripts/roadmap-converge/driver.ts | Modify | implementer-agent |

#### Acceptance Criteria

- [ ] `scripts/roadmap-converge/slug.ts` derives a path-safe slug from a roadmap filename (no extension; non-alphanumeric → `-`); `planning/ROADMAP.md` → `ROADMAP`; `planning/feature/sub-roadmap.md` → `sub-roadmap`.
- [ ] Slug collisions across roadmap paths are detected and aborted with stderr `SLUG_COLLISION`.
- [ ] All three commands accept `--roadmap <path>` and derive state path as `.roadmap-converge/{slug}/state.toon`.
- [ ] `archetype-detector.ts` registers itself as the `archetypeDetectionHook` implementation on `driver.ts` (seam defined in Phase 1), replacing the default no-op. <!-- Applied: P-02 -->
- [ ] Cold-start invocation of `/loom-roadmap converge` with no state.toon runs archetype detection (reads CLAUDE.md, manifest files) and presents a confirm-or-correct prompt with the best-guess archetype default-highlighted.
- [ ] **Non-interactive TTY fallback:** when stdin is non-interactive (e.g., piped, CI, no TTY) AND `--archetype` flag is absent, driver auto-selects the highest-confidence archetype from the detector, prints a stderr advisory naming the selection and the alternative `--archetype <name>` invocation (e.g., `"[roadmap-converge] non-interactive stdin: auto-selected archetype 'cli' (confidence 0.82). Override with --archetype <name>."`), and proceeds to pass 1 without halting. <!-- Applied: UX-26 -->
- [ ] User can pick any of: `cli`, `web-app`, `library`, `data-pipeline`, `research`, or accept the default.
- [ ] Initial state.toon is written with the resolved archetype and `round=0`; then pass 1 runs.
- [ ] `agents/roadmap-archetype-detector.md` includes YAML frontmatter `model: haiku` (lightweight classification task — cheap detection model is the appropriate choice). Frontmatter MUST be present BEFORE the agent is ever spawned, per CLAUDE.md mandatory model-resolution rule. <!-- Applied: AW-07 / FC-A1 / F-32 -->
- [ ] `agents/roadmap-archetype-detector.md` system prompt requires the detector to return a standard `AgentResult` envelope in TOON (per `protocols/agent-result.schema.md`) whose `data` block carries `{archetype, confidence}`; the driver's `archetypeDetectionHook` consumes `AgentResult.data` (NOT a custom payload). <!-- Applied: AW-08 / FC-A1 / F-33 -->
- [ ] Phase 4 implementer-agent reads (input context): `scripts/roadmap-converge/driver.ts` (from Phase 1, for the archetype-hook seam signature), `protocols/roadmap-archetypes.toon` (from Phase 0a, for the archetype enum + detection-hint keywords), `CLAUDE.md` and project manifest files (`package.json`, `Cargo.toml`, etc. — input to the detector itself). <!-- Applied: AW-13 -->
- [ ] On completion, Phase 4 implementer-agent writes a StageContext summary to `.plan-execution/stage-context/execute-archetype.toon` atomically (`.tmp` + `fs.renameSync`) per `protocols/execution-conventions.md`. <!-- Applied: AW-06, PH-01, AW-14 (path disambiguated from Phase 1's execute.toon) -->

#### Convergence Targets

- Two distinct roadmaps `planning/ROADMAP.md` and `planning/sub/ROADMAP.md` produce slugs `ROADMAP` and `ROADMAP` respectively → `SLUG_COLLISION` aborts the second (path aligned with S-16 fixture). <!-- Applied: PH-14 -->
- `slug("planning/feature-x.md")` returns `"feature-x"`; `slug("planning/Some File.md")` returns `"Some-File"`.
- Cold-start on a fresh repo writes initial state.toon with `round=0` and a non-empty `archetype` field within 60 seconds (test scaffold provides scripted user input).

#### Scenarios

```toon
id: S-15
title: --roadmap flag routes state to slug-derived path
given[1]: A second roadmap exists at planning/v2/sub-roadmap.md
when: User runs /loom-roadmap converge --roadmap planning/v2/sub-roadmap.md
whenTriggerType: actor-action
then[2]: state is written to .roadmap-converge/sub-roadmap/state.toon, The default .roadmap-converge/ROADMAP/state.toon is not modified
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-16
title: Slug collision aborts with explicit error
given[2]: state already exists at .roadmap-converge/ROADMAP/state.toon (slug from planning/ROADMAP.md), A second roadmap at planning/sub/ROADMAP.md would derive the same slug
when: User runs /loom-roadmap converge --roadmap planning/sub/ROADMAP.md
whenTriggerType: actor-action
then[2]: Exit code is 1, stderr contains SLUG_COLLISION
stateRef:
tags[2]: error, edge-case
testTier: integration
automatable: true
```

```toon
id: S-17
title: Cold-start prompts for archetype and writes round=0 state
given[1]: No .roadmap-converge/{slug}/state.toon exists for the target roadmap
when: User runs /loom-roadmap converge and accepts the default-highlighted archetype
whenTriggerType: actor-action
then[3]: Detector emits a confirm prompt with one of the 5 archetypes highlighted, state.toon is written with round=0, state.archetype equals the user-confirmed value
stateRef: init
tags[1]: happy-path
testTier: integration
automatable: true
```

---

### Phase 5 — Wave 5: Integrator/Mutator Pass + Stall Detection + Pass-Cap Halt

**Agent:** implementer-agent
**Objective:** Implement the integrator-pass step (consume resolved user questions, mutate ROADMAP.md, recompute), stall detection (two passes with identical dimension statuses), and pass-cap halt.
**Dependencies:** Phase 1, Phase 4
**File Ownership:** `scripts/roadmap-converge/integrator.ts`, `scripts/roadmap-converge/stall-detector.ts`, `agents/roadmap-converge-integrator.md`, **`scripts/roadmap-converge/driver.ts`** (inherited from Phase 4; Phase 5 is the last wave to modify it before Phase 6's wiring-agent runs against a frozen `scripts/roadmap-converge/` tree). <!-- Applied: PR-02 -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| scripts/roadmap-converge/integrator.ts | Create | implementer-agent |
| scripts/roadmap-converge/stall-detector.ts | Create | implementer-agent |
| agents/roadmap-converge-integrator.md | Create | implementer-agent |
| scripts/roadmap-converge/driver.ts | Modify | implementer-agent |

<!-- Applied: P-07 — registration of `roadmap-converge-integrator` in orchestration.toml + library.yaml is deferred to Phase 6 (wiring wave). The agent file lands here in Phase 5 but is invoked via direct path reference by `driver.ts` until Phase 6 wires the registry entry. This deferred-wiring pattern matches the wiring-agent contract and is documented here so reviewers don't flag it as a missing registration. -->

#### Acceptance Criteria

- [ ] Integrator agent reads resolved `open_questions[]` (those with non-empty `resolution`) and applies the resolutions as targeted ROADMAP.md edits (atomic write via `.tmp` + rename).
- [ ] Integrator-pass increments `state.round` and recomputes `content_hash`.
- [ ] Stall detector: when `state.round >= 2` AND `dimensions[]` statuses are identical to the prior pass AND no questions resolved this round, halt with `STALL_DETECTED`.
- [ ] Pass-cap halt: when `state.round == state.passLimit` AND not all-green, set state to `halted-pass-cap` with stderr `PASS_CAP_REACHED` and a `next_action_hint` of `"Resolve blockers or /loom-roadmap sign-off manually"`.
- [ ] Integrator never modifies sections it cannot tie back to a resolved question (preserves un-flagged content surgically).
- [ ] vitest covers: integrator surgical edit, stall trip after 2 identical passes, pass-cap halt at round == 3 (default), retire-dimension auto-resolves orphan `open_questions[]` with `resolution = "dimension archived"`.
- [ ] `agents/roadmap-converge-integrator.md` includes YAML frontmatter `model: sonnet` (per `[roadmap.converge]` defaults and CLAUDE.md mandatory model resolution). <!-- Applied: AW-04 -->
- [ ] Integrator agent returns a standard `AgentResult` TOON envelope per `protocols/agent-result.schema.md` with `filesModified[]` listing `ROADMAP.md` (and any other files it edits). Driver MUST reject and halt with `INTEGRATOR_NO_ENVELOPE` if the agent returns a non-envelope payload. <!-- Applied: AW-05 / F-58 -->
- [ ] Retire-dimension semantics (FC-05): when a dimension name is added to `archivedDimensions[]`, EVERY `open_questions[]` row whose `dimension` matches that name is auto-resolved by setting `resolution = "dimension archived"` and `resolved_at = <now>` in the same atomic state write. The Phase 5 integrator is the sole writer that performs this transition. <!-- Applied: FC-05 -->
- [ ] Stall detector reads `state.dimensionSnapshot[]` (NOT the audit-trail files) and compares against current `state.dimensions[]` statuses. The detector writes the current snapshot at the END of each pass before status recomputation begins. <!-- Applied: FC-03 -->
- [ ] On completion, Phase 5 implementer-agent writes a StageContext summary to `.plan-execution/stage-context/execute-integrator.toon` atomically (`.tmp` + `fs.renameSync`) per `protocols/execution-conventions.md`. Because Phase 5 is the mutator (writes ROADMAP.md), this summary MUST also include the list of `filesModified[]` from the integrator's AgentResult for auditability. <!-- Applied: AW-06 / F-31 -->

#### Convergence Targets

- After user resolves 1 question and re-runs `/loom-roadmap converge`, ROADMAP.md is modified ONLY in the section the resolution targeted (verified by diff: changed-line count ≤ 10).
- A scripted test with 2 successive passes where reviewers emit identical findings triggers `halted-stalled` state with stderr `STALL_DETECTED`.
- A scripted test running `/loom-roadmap converge` 3 times with reviewers always emitting red findings triggers `halted-pass-cap` at the 3rd round with stderr `PASS_CAP_REACHED`.

#### Scenarios

```toon
id: S-18
title: Integrator applies resolved question to ROADMAP surgically
given[2]: state has 1 resolved open_question targeting the "vision" section, ROADMAP.md vision section reads "<vague>"
when: User runs /loom-roadmap converge (integrator-pass triggered)
whenTriggerType: actor-action
then[3]: ROADMAP.md vision section is updated to incorporate the resolution, Diff between pre and post ROADMAP.md affects only the vision section, state.round is incremented by 1
stateRef: integrator-pass
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-19
title: Stall detector halts on two identical passes
given[2]: state.round is 2 and the prior pass produced identical dimension statuses, No open questions were resolved this round
when: Driver completes the second pass
whenTriggerType: system-event
then[3]: state transitions to halted-stalled, stderr contains STALL_DETECTED, state.next_action_hint suggests retire-dimension or --force
stateRef: halted-stalled
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-20
title: Pass cap halts when round equals passLimit without all-green
given[2]: state.passLimit is 3, state.round becomes 3 after pass with non-green dimensions
when: Driver completes the third pass
whenTriggerType: system-event
then[3]: state transitions to halted-pass-cap, stderr contains PASS_CAP_REACHED, exit code is 1
stateRef: halted-pass-cap
tags[1]: error
testTier: integration
automatable: true
```

---

### Phase 6 — Wave 6: `/loom-resume` Integration, Wiring, and Dogfood Pass

**Agent:** wiring-agent
**Objective:** Wire `/loom-resume` to delegate to roadmap-converge digests with dual-state priority, register all new agents in `orchestration.toml`, run a full end-to-end dogfood pass on a real roadmap, and capture rubric drift.
**Dependencies:** Phase 2, Phase 3, Phase 5
**File Ownership:** `commands/loom-resume.md`, `.claude/orchestration.toml`, `library.yaml`, `tests/integration/roadmap-converge-e2e.test.ts`, `tests/fixtures/roadmaps/example-cli.md` <!-- Applied: PH-01 -->

#### Deliverables

| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-resume.md | Modify | wiring-agent |
| .claude/orchestration.toml | Modify | wiring-agent |
| library.yaml | Modify | wiring-agent |
| tests/integration/roadmap-converge-e2e.test.ts | Create | wiring-agent |
| tests/fixtures/roadmaps/example-cli.md | Create | wiring-agent | <!-- Applied: PH-01 -->

#### Acceptance Criteria

- [ ] `/loom-resume` invokes `resume-delegate.ts`; when only roadmap-converge state exists, renders the roadmap digest; when both pipeline-state.toon and roadmap-converge state.toon exist, renders both with most-recently-modified at top.
- [ ] `.claude/orchestration.toml` includes a `[roadmap.converge]` block with default values per Configuration Specification.
- [ ] `library.yaml` registers: `roadmap-converge-driver` (agent), `roadmap-converge-reviewer` (agent), `roadmap-converge-integrator` (agent), `roadmap-archetype-detector` (agent), `loom-roadmap-converge` (prompt), `loom-roadmap-sign-off` (prompt), `loom-roadmap-status` (prompt), `roadmap-readiness` (protocol), `roadmap-converge-state` (protocol), `roadmap-rubrics` (protocol).
- [ ] `tests/integration/roadmap-converge-e2e.test.ts` runs a full pass against a fixture roadmap (`tests/fixtures/roadmaps/example-cli.md`), captures the digest, runs the integrator step with a scripted answer, runs a second pass, and asserts state transitions match the state machine.
- [ ] Dogfood pass: run `/loom-roadmap converge` against `planning/ROADMAP.md`, document any rubric drift in `planning/history/post-mortems/2026-MM-DD-roadmap-converge-dogfood.md`.
- [ ] `bun test` (or `npx vitest run`) exits with code 0 across all phases' tests.
- [ ] `tests/fixtures/roadmaps/example-cli.md` is authored as a minimal cli-archetype roadmap with mostly-green seed content (vision, milestones, tool-selection sections present and well-formed) so the e2e test in S-22 has a deterministic input. <!-- Applied: PH-01 -->
- [ ] wiring-agent writes a StageContext summary to `.plan-execution/stage-context/wiring.toon` atomically (`.tmp` + rename) on completion, per `protocols/execution-conventions.md`. <!-- Applied: AW-03 -->
- [ ] wiring-agent returns a standard `AgentResult` envelope in TOON (per `protocols/agent-result.schema.md`) listing `filesModified[]` for all five Phase 6 owned files. <!-- Applied: AW-12 -->

#### Convergence Targets

- `library.yaml` lints clean against the catalog schema.
- `/loom-resume` on a repo with both states emits two digests, ordered by mtime descending.
- The integration test completes one full converge cycle (cold-start → pass 1 → user answers → integrator-pass → pass 2 → sign-off-eligible → sign-off) in < 120 seconds.

#### Scenarios

```toon
id: S-21
title: /loom-resume delegates to roadmap digest when only converge state exists
given[1]: .roadmap-converge/ROADMAP/state.toon exists and .plan-execution/pipeline-state.toon does not
when: User runs /loom-resume
whenTriggerType: actor-action
then[2]: stdout contains the roadmap-converge digest, stdout does not mention pipeline-state
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-22
title: End-to-end converge cycle reaches sign-off-eligible
given[1]: A fixture roadmap with mostly-green seed content
when: Test runs cold-start, one pass, one integrator step with scripted answer, second pass
whenTriggerType: system-event
then[2]: state.sign_off_state equals "eligible", state.round is at most state.passLimit
stateRef: sign-off-eligible
tags[1]: happy-path
testTier: e2e
automatable: true
```

```toon
id: S-23
title: library.yaml registers all new resources
given[1]: All Phase 0-5 deliverables are present on disk
when: A test lints library.yaml against the catalog schema
whenTriggerType: api-call
then[2]: Lint MUST return zero errors, All 10 new resource entries (4 agents + 3 prompts + 3 protocols) MUST be present
stateRef:
tags[2]: happy-path, regression
testTier: unit
automatable: true
```

## Verification Commands

```bash
# Type checks
bunx tsc --noEmit || npx tsc --noEmit

# Unit + integration tests
bun test || npx vitest run

# Catalog lint
node scripts/lint-library-yaml.js

# Schema lint (TOON parser smoke)
node scripts/lint-protocol-schemas.js protocols/roadmap-*.toon

# Sign-off purity grep: ensure only sign-off.ts writes signed-off.
# Uses POSIX-portable form (grep -E + [[:space:]]) — BSD grep on macOS
# does not reliably match \s, so the GNU-only form silently passed on
# darwin CI even when violations were present. The vitest test at
# test/roadmap-converge/sign-off-purity.test.ts uses JS regex and is
# the authoritative gate; this shell command exists as a quick
# manual / CI smoke check.
! grep -E -RIn 'sign_off_state[[:space:]]*=[[:space:]]*"signed-off"' scripts/roadmap-converge/ \
    | grep -v 'scripts/roadmap-converge/sign-off.ts'

# Dogfood smoke
/loom-roadmap converge --roadmap planning/ROADMAP.md
/loom-roadmap status --roadmap planning/ROADMAP.md
```

<!-- Applied: P-04 — added Owner column citing the phase / agent responsible for each mitigation. -->

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| Lock-file race (two `/loom-roadmap converge` started < 1s apart) | medium | low | Lock write uses `O_EXCL`-equivalent semantics in `lock.ts`; the second invocation always observes the lock | Phase 1 (implementer-agent — `lock.ts`) |
| Slug collision across deep roadmap trees | medium | medium | Detected at write time with `SLUG_COLLISION`. **MVP workaround (documented user-facing):** the user MUST rename one of the colliding roadmap files to give it a unique filename (e.g., `planning/mobile/ROADMAP.md` → `planning/mobile/mobile-ROADMAP.md`). The `--slug` override is explicit non-MVP scope; the error copy MUST disclaim this so users do not chase a non-existent flag. See the SLUG_COLLISION row in Error Categories for the exact stderr copy. <!-- Applied: FC-02 / UX-04 --> | Phase 4 (implementer-agent — `slug.ts`) |
| Reviewer 5-finding cap drops blockers | high | medium | Lowest-severity dropped first; `suppressedFindings[]` carries them in state for audit; user can `retire-dimension` to free slots | Phase 1 (implementer-agent — `driver.ts`) |
| Rubric files become stale relative to project archetypes | medium | medium | Dogfood pass in Phase 6 captures rubric drift; rubric overrides via `.claude/orchestration.toml` provide per-project escape | Phase 6 (wiring-agent — dogfood + post-mortem) |
| Sign-off command accidentally invokable from automation | high | low | CI grep test in Phase 2 ensures no code path outside `sign-off.ts` writes `signed-off`; explicit user invocation is the only path | Phase 2 (implementer-agent — `sign-off.ts` + grep guard) |
| Migration runtime gap on first version bump | medium | low | F-13 walker handles forward migrations; v1→v2 will land in a separate plan when needed | Phase 0a (contracts-agent — migrator registration) |

## Acceptance Criteria (Final)

- [ ] All 8 phases' acceptance criteria pass (Phases 0a, 0b, 1, 2, 3, 4, 5, 6). <!-- Applied: PH-02 -->
- [ ] M-07 acceptance (per ROADMAP.md): `/loom-roadmap converge` runs end-to-end on `planning/ROADMAP.md`; `.roadmap-converge/{slug}/state.toon` persists; sign-off via `/loom-roadmap sign-off` is the only path to converged; concurrency lock prevents parallel corruption.
- [ ] Dogfood post-mortem captured under `planning/history/post-mortems/`.
- [ ] All convergence targets across phases are deterministically verifiable via the Verification Commands.

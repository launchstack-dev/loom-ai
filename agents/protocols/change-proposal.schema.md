# Change Proposal Schema

Per-change artifact directory at `.loom/changes/{change-id}/`. Defines the proposal envelope and the per-domain `DeltaBlock` sub-schema that drives mutations into `contract-*` wiki pages. The change-proposal lifecycle is the **only** writer of contract pages after greenfield materialization (PLAN-spec-upgrades.md, Upgrade B).

Cross-references:
- `contract-page-extensions.schema.md` — the target of every change; pages whose body sections this mutates
- `change-state.schema.md` — runtime state file tracked alongside this proposal
- `scenario.schema.md` — schema for blocks inside `addedScenarios[]`, `modifiedScenarios[]`, `removedScenarios[]`
- `wiki-page.schema.md` — base wiki contract; supplies cross-ref and index machinery
- `validation-rules.md` — severity conventions

---

## Directory Layout

```
.loom/changes/{changeId}/
  proposal.md          ← TOON frontmatter + Markdown body (this schema)
  deltas.toon          ← typed-array of DeltaBlock entries (extracted from proposal for fast tooling reads)
  review-notes.md      ← optional, produced by /loom-change review
  archive-log.toon     ← optional, written on archive; mirror of History entry appended to each contract page
```

`{changeId}` matches `chg-{YYYYMMDD}-{kebab-slug}` per the `changeId` field below.

---

## proposal.md Format

````markdown
```toon
changeId: chg-20260520-add-refund-flow
status: proposed
intent: Add refund support to the billing domain so customer-service agents can process partial and full refunds without contacting engineering.
scope:
  included[2]: Refund API endpoints, Refund state machine
  excluded[2]: Chargeback handling, Tax refund reversal
approach: Extend the existing payment-capture flow with a refund operation that respects the refund-bounded-by-original invariant.
affectedSpecs[1]: billing
linkedPlan: PLAN-refund-flow.md
reviewedBy:
reviewedAt:
reviewNotes:
approvedBy:
approvedAt:
createdAt: 2026-05-20T10:00:00Z
archivedAt:
```

# Change Proposal: Add refund flow to billing

## Intent
{prose elaboration of the `intent` frontmatter field}

## Scope
{prose elaboration of the `scope` frontmatter field}

## Approach
{prose elaboration of the `approach` frontmatter field}

## Deltas
{One ### subsection per DeltaBlock — see DeltaBlock section below}

## Rationale
{Free-form rationale; archived into the contract page's History section}
````

The `deltas.toon` file is a separate, machine-extracted view of the DeltaBlock entries — written by `/loom-change init` and refreshed by `/loom-change review`. It is **not** authoritative on its own; the prose in `proposal.md` is the source of truth. If `deltas.toon` drifts from `proposal.md`, the validator flags blocking.

---

## ChangeProposal Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `changeId` | string | **Required.** Format `chg-{YYYYMMDD}-{kebab-slug}`. `YYYYMMDD` is the proposal creation date (UTC). `kebab-slug` is 3-60 lowercase alnum + hyphens. MUST equal the parent directory name. |
| `status` | enum | **Required.** One of: `proposed`, `reviewed`, `approved`, `in-progress`, `archived`, `rejected`, `superseded`. See `## Status Lifecycle`. |
| `intent` | string | **Required.** 2-5 sentences. Plain text in frontmatter; expanded in body's `## Intent` section. |
| `scope` | object | **Required.** Object with `included[]` and `excluded[]`, **both non-empty arrays of strings**. Empty arrays = blocking validator error. |
| `approach` | string | **Required.** High-level technical strategy. 1-3 sentences. |
| `affectedSpecs` | string[] | **Required, ≥1 entry.** Domain names (kebab-case). Every entry MUST resolve to an existing `contract-{domain}` wiki page in the wiki index. |
| `deltas` | DeltaBlock[] | **Required, ≥1 entry.** See DeltaBlock schema below. |
| `linkedPlan` | string \| null | **Optional.** Path to a scoped PLAN.md when the change is large enough to warrant one. Small changes set this null. |
| `reviewedBy` | string \| null | **Required, nullable.** Agent name or human identifier. Set by `/loom-change review`. Null while `status ∈ {proposed}`. |
| `reviewedAt` | ISO 8601 \| null | **Required, nullable.** Set by `/loom-change review`. |
| `reviewNotes` | string \| null | **Optional.** Free text from reviewer. Stored in frontmatter for fast reads; the full review-notes.md may contain longer commentary. |
| `approvedBy` | string \| null | **Required, nullable.** Set by `/loom-change approve`. Null while `status ∈ {proposed, reviewed, rejected}`. |
| `approvedAt` | ISO 8601 \| null | **Required, nullable.** Set by `/loom-change approve`. |
| `createdAt` | ISO 8601 | **Required.** Set by `/loom-change init`. Immutable. |
| `archivedAt` | ISO 8601 \| null | **Required, nullable.** Set by `/loom-change archive`. |

---

## DeltaBlock

A `DeltaBlock` is one per-domain mutation embedded in a `ChangeProposal.deltas[]` array. Each block targets exactly one `contract-{domain}` wiki page.

### DeltaBlock representation in proposal.md

Inside the `## Deltas` body section, each DeltaBlock is a `### {domain}` subsection followed by a TOON code block:

````markdown
### billing

```toon
domain: billing
addedRequirements[3]: The system MUST support partial refunds bounded by original payment, The system MUST reject refunds exceeding the original payment amount, The system MUST log every refund with timestamp and operator
modifiedRequirements[1]{id,before,after}:
  R-02,Invoice issuance SHOULD complete within 200ms p95,Invoice issuance SHOULD complete within 200ms p95; refund issuance SHOULD complete within 500ms p95
removedRequirements[0]:
addedScenarios[1]:
  ```toon
  id: S-07
  title: Issue partial refund within bounds
  given[2]: An invoice exists with paid amount 100.00, A customer-service operator is authenticated
  when: The operator POSTs to /api/refunds with amount 30.00 against the invoice
  whenTriggerType: api-call
  then[3]: Response status MUST be 201, Response body MUST contain refund_id, A refund row MUST exist with amount 30.00 and status "issued"
  tags[1]: happy-path
  testTier: integration
  automatable: true
  ```
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: false
migrationNote:
rationale: Customers requested refund self-service; engineering escalations to refund customers manually are blocking Q2 OKR.
```
````

The mirrored `deltas.toon` file is a flat typed-array form, easier for tooling:

```toon
deltas[1]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:
  billing,false,3,1,0,1,0,0
```

### DeltaBlock Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `domain` | string | **Required.** kebab-case. MUST equal the `{domain}` of an existing `contract-{domain}` wiki page AND appear in `affectedSpecs[]` on the parent ChangeProposal. |
| `addedRequirements` | string[] | **Required (may be empty).** Each entry is a complete RFC 2119 statement (MUST/SHOULD/MAY). New R-NN IDs are auto-assigned by `/loom-change archive` from the next-available number on the target page (never reuses tombstoned IDs). |
| `modifiedRequirements` | object[] | **Required (may be empty).** Each entry: `{ id, before, after }`. `id` MUST exist on the target page. `before` MUST exactly match the current text on the page (drift detection). `after` is the replacement RFC 2119 statement. |
| `removedRequirements` | string[] | **Required (may be empty).** R-NN IDs to remove. Each MUST exist on the target page. Removed IDs are tombstoned in `## History` and never reused. |
| `addedScenarios` | Scenario[] | **Required (may be empty).** Full scenario blocks per `scenario.schema.md`. Scenario `id`s MUST NOT collide with existing scenarios on the target page. |
| `modifiedScenarios` | object[] | **Required (may be empty).** Each entry: `{ id, before, after }`. `before` is the existing scenario TOON; `after` is the replacement. `id` MUST exist on the target page. The `id` MUST NOT change between `before` and `after`. |
| `removedScenarios` | string[] | **Required (may be empty).** Scenario IDs (S-NN) to remove. Each MUST exist on the target page. |
| `breakingChange` | boolean | **Required.** `true` if any `removedRequirements[]`, `modifiedRequirements[]` (with semantic change), or `removedScenarios[]` has downstream references (consumers per the page's `consumers[]`). Auto-set to `true` by validator if not explicitly set and a removal/modification is detected; explicit `false` requires reviewer override. |
| `migrationNote` | string \| null | **Required when `breakingChange: true`, otherwise null.** Free text explaining how consumers should adapt. Logged into the target page's `## History` entry on archive. |
| `rationale` | string | **Required.** Why this delta is being made. Feeds the History section on archive. Min 30 chars. |

---

## Status Lifecycle

```
                  /loom-change init
                       │
                       ▼
                  ┌──────────┐
                  │ proposed │
                  └────┬─────┘
                       │ /loom-change review
                       ▼
                  ┌──────────┐         /loom-change reject
                  │ reviewed │ ────────────────────────────┐
                  └────┬─────┘                             │
                       │ /loom-change approve              │
                       ▼                                   │
                  ┌──────────┐                             │
                  │ approved │                             ▼
                  └────┬─────┘                        ┌──────────┐
                       │ /loom-change run             │ rejected │
                       ▼                              └──────────┘
                  ┌─────────────┐                          ▲
                  │ in-progress │                          │
                  └────┬────────┘ ──────/loom-change reject┘
                       │ /loom-change archive
                       ▼
                  ┌──────────┐
                  │ archived │ ◄─── /loom-quick (via quick-archive.ts; auto-stamps review+approve)
                  └──────────┘
                       │
                       │ another change archives that removes
                       │ this change's targeted requirements
                       ▼
                  ┌────────────┐
                  │ superseded │
                  └────────────┘
```

| From | To | Trigger | Required side effects |
|------|----|---------|-----------------------|
| (none) | `proposed` | `/loom-change init` | Create directory; populate frontmatter; emit `change-state.toon`. |
| `proposed` | `reviewed` | `/loom-change review` | Stamp `reviewedBy`, `reviewedAt`, optional `reviewNotes`. |
| `proposed` | `rejected` | `/loom-change reject` | Stamp rejection; require `--reason`. |
| `reviewed` | `approved` | `/loom-change approve` | Stamp `approvedBy`, `approvedAt`. |
| `reviewed` | `rejected` | `/loom-change reject` | Stamp rejection; require `--reason`. |
| `approved` | `in-progress` | `/loom-change run` | Mark active; populate ChangeState transitions. |
| `in-progress` | `archived` | `/loom-change archive` | Apply deltas atomically across `affectedSpecs[]`; update each contract page's `contentChecksum`, `sourceChanges[]`, History; refresh wiki index. |
| `in-progress` | `rejected` | `/loom-change reject` | Roll back any in-flight mutations; stamp rejection. |
| `archived` | `superseded` | Another change archives and removes targeted requirements | Set in ChangeState `supersededBy`; do not modify proposal.md `status` (transition is recorded in ChangeState only). See exception below. |

**Status mirroring note.** ChangeState's `status` mirrors `proposal.md`'s `status`. The `superseded` transition is unique: the supersession-discovery scan (in `/loom-change archive`) updates the affected change's ChangeState `supersededBy` field and **also** updates `proposal.md` `status` to `superseded` so the lifecycle is visible without reading runtime state.

### Quick-Mode Path

`/loom-quick` invokes `quick-archive.ts` (Phase 6), which compresses the lifecycle:

1. Synthesize a minimal ChangeProposal from the user's task + final deltas.
2. Stamp `reviewedBy: loom-quick`, `reviewedAt: now`, `approvedBy: loom-quick`, `approvedAt: now`.
3. Run the standard archive path (same atomicity, conflict, and supersession checks).
4. Persist `proposal.md` retroactively for audit.

The quick path skips no validation. It only collapses transitions that would otherwise require interactive prompts.

---

## Atomic Archive Semantics

`/loom-change archive` mutates `≥1` contract page (one per entry in `affectedSpecs[]`). The operation MUST be atomic: either all pages update successfully, or none commit.

### Algorithm

1. **Pre-flight.** For each `DeltaBlock`:
   - Validate target page exists and matches partition.
   - Verify `modifiedRequirements[].id` and `removedRequirements[]` IDs exist.
   - Verify `addedScenarios[].id` doesn't collide; `modifiedScenarios[].id` and `removedScenarios[]` exist.
   - Verify `modifiedRequirements[].before` matches current page text.
   - Recompute each target's `contentChecksum`; compare to stored — drift = blocking, recommend `/loom-change recover`.
2. **Conflict scan.** Read all in-flight ChangeStates. If any other in-progress change claims overlapping R-NN or S-NN IDs on the same `affectedSpecs[]`, populate `conflicts[]` on both ChangeStates (see `change-state.schema.md`) and abort.
3. **Stage.** Build `{path: nextBody}` map for every target page, plus new `contentChecksum`, updated `sourceChanges[]`, appended History entry.
4. **Write phase.** For each path, write `{path}.tmp` with new body and frontmatter.
5. **Commit phase.** Rename every `{path}.tmp` to `{path}` in sequence. If any rename fails:
   - Restore originals from `.bak` (snapshot taken in step 4).
   - Write rollback log to `.plan-execution/ephemeral/changes/{changeId}-rollback.toon`.
   - Leave `status: in-progress`. Report failure.
6. **Post-commit.** Set `status: archived`; set `archivedAt`. Refresh wiki index. Update ChangeState transitions log. Run supersession scan against other in-flight changes — set their ChangeState `supersededBy` if their targeted requirements were removed.

### Rollback Log Format

`.plan-execution/ephemeral/changes/{changeId}-rollback.toon`:

```toon
changeId: chg-20260520-add-refund-flow
failedAt: 2026-05-23T09:20:00Z
attemptedTargets[2]: .loom/wiki/pages/contract-billing.md, .loom/wiki/pages/contract-payment.md
committedBefore[1]: .loom/wiki/pages/contract-billing.md
failedOn: .loom/wiki/pages/contract-payment.md
failureReason: ENOSPC during rename
restoredFromBackup[1]: .loom/wiki/pages/contract-billing.md
recoveryCommand: /loom-change recover chg-20260520-add-refund-flow
```

---

## Validation Rules

Severity follows `validation-rules.md` conventions.

### ChangeProposal-level

| Rule | Severity | Description |
|------|----------|-------------|
| `changeId` matches format and directory | blocking | `chg-{YYYYMMDD}-{slug}` AND matches parent directory name. |
| `status` in valid enum | blocking | One of the 7 declared statuses. |
| `intent` length | blocking | 2-5 sentences. Single-sentence intents flagged. |
| `scope.included` non-empty | blocking | Empty included = blocking. |
| `scope.excluded` non-empty | blocking | Empty excluded = blocking. **Forcing the author to state exclusions prevents scope creep.** |
| `affectedSpecs[]` non-empty | blocking | At least one domain. |
| Every `affectedSpecs[]` entry resolves | blocking | Each domain MUST map to an existing `contract-{domain}` wiki page. |
| `deltas[]` non-empty | blocking | At least one DeltaBlock. |
| `deltas[].domain` covers `affectedSpecs[]` | blocking | Set of DeltaBlock domains MUST equal `affectedSpecs[]` set (no extras, no missing). |
| Status-field consistency | blocking | `status: reviewed` requires `reviewedBy` and `reviewedAt` non-null; `status: approved` requires both `reviewed*` and `approved*` populated; `status: archived` requires `archivedAt` non-null. |
| `linkedPlan` resolves | warning | When set, the path SHOULD exist. |
| `deltas.toon` matches proposal.md | blocking | The extracted view MUST be consistent with the prose. |

### DeltaBlock-level

| Rule | Severity | Description |
|------|----------|-------------|
| `domain` resolves | blocking | Must equal an existing `contract-{domain}` page. |
| `modifiedRequirements[].id` exists | blocking | Every modified R-NN MUST exist on the target page. |
| `modifiedRequirements[].before` matches | blocking | The `before` text MUST exactly match current page text. Mismatch = drift. |
| `removedRequirements[]` IDs exist | blocking | Every removed R-NN MUST exist. |
| `addedScenarios[].id` non-colliding | blocking | New scenario IDs MUST NOT match any existing on the target page. |
| `modifiedScenarios[].id` exists | blocking | Modified scenario IDs MUST exist. |
| `modifiedScenarios[].id` immutable | blocking | `before.id == after.id`. Renaming an ID requires `removedScenarios[] + addedScenarios[]`. |
| `removedScenarios[]` IDs exist | blocking | Every removed S-NN MUST exist. |
| `breakingChange` is true when consumers exist for removed item | warning | Heuristic — validator auto-sets to `true` and asks for `migrationNote`. |
| `migrationNote` present when `breakingChange: true` | blocking | Cannot archive a breaking change without migration guidance. |
| `rationale` length | blocking | Min 30 chars. |
| RFC 2119 phrasing in `addedRequirements[]` | info | Encourage MUST/SHOULD/MAY. |
| Tombstoned R-NN reuse in `addedRequirements[]` | blocking | Reusing a removed R-NN ID is forbidden. |

---

## Worked Example

A full minimal `proposal.md`:

````markdown
```toon
changeId: chg-20260523-clarify-idempotency
status: archived
intent: Clarify payment idempotency invariant after the 2026-05-22 production incident where retried requests created duplicate captures.
scope:
  included[1]: Payment capture idempotency
  excluded[2]: Refund idempotency, Authentication retry policy
approach: Tighten R-02 to require an explicit idempotency key on every capture and add a scenario verifying replay returns the original response.
affectedSpecs[1]: billing
linkedPlan:
reviewedBy: agent:interpretation-reviewer
reviewedAt: 2026-05-23T08:30:00Z
reviewNotes: Confirmed downstream consumers (admin-portal) already pass idempotency-key header; no breaking impact.
approvedBy: human:alice
approvedAt: 2026-05-23T08:45:00Z
createdAt: 2026-05-23T08:00:00Z
archivedAt: 2026-05-23T09:15:00Z
```

# Change Proposal: Clarify payment idempotency

## Intent
Following the 2026-05-22 production incident where a network blip caused the admin portal to retry capture requests and produce duplicate charges, we are tightening the payment idempotency invariant to require an explicit idempotency-key header and locking in the behavior with a regression scenario.

## Scope
Included: payment capture idempotency clarification. Excluded: refund idempotency (separate work item), authentication retry policy (out of domain).

## Approach
Modify R-02 to add the explicit idempotency-key requirement. Add S-09 verifying a replay returns the original 201 response and does not double-charge.

## Deltas

### billing

```toon
domain: billing
addedRequirements[0]:
modifiedRequirements[1]{id,before,after}:
  R-02,The system MUST be idempotent on payment capture.,The system MUST be idempotent on payment capture when a client supplies an idempotency-key header; replays MUST return the original 201 response without re-capturing.
removedRequirements[0]:
addedScenarios[1]:
  ```toon
  id: S-09
  title: Replay capture with same idempotency-key returns original 201
  given[2]: A capture request with idempotency-key "k-001" succeeded with status 201, The same idempotency-key has not been used for any other request
  when: A client POSTs an identical capture request with idempotency-key "k-001"
  whenTriggerType: api-call
  then[3]: Response status MUST be 201, Response body MUST match the original 201 byte-for-byte, No new charge MUST appear in the payments ledger
  tags[2]: regression, error
  testTier: integration
  automatable: true
  ```
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: false
migrationNote:
rationale: Production incident 2026-05-22 — duplicate captures from retried requests. Clarification reflects already-documented client behavior (admin portal sends idempotency-key); no consumer change required.
```

## Rationale
This change is non-breaking — the admin portal (the only current consumer) already sends idempotency-key headers per its internal SDK. The change clarifies enforced behavior; it does not introduce new constraints on existing well-behaved clients.
````

---

## Relationship to `change-state.schema.md`

Every `ChangeProposal` has a corresponding `ChangeState` at `.plan-execution/ephemeral/changes/{changeId}.toon`. The proposal is the durable, on-disk record of intent and content; ChangeState tracks runtime transitions, conflicts, and supersession. They are kept consistent via `hooks/lib/change-paths.ts` (Phase 5) which exports path constants used by both readers.

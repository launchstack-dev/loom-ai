# Change State Schema

Runtime state file for a change-proposal's lifecycle. Lives at `.plan-execution/ephemeral/changes/{changeId}.toon`. Tracks status transitions, conflict detection against other in-flight changes, and supersession discovery.

ChangeState is the **runtime mirror** of the on-disk `ChangeProposal` (see `change-proposal.schema.md`). The proposal is the durable, authoritative record of intent and content; ChangeState is the lightweight, fast-read, atomic-write state used by `/loom-change list`, `/loom-change status`, conflict detection, and supersession scans. When the two disagree, the proposal wins.

Cross-references:
- `change-proposal.schema.md` — durable proposal envelope; this file mirrors its `status` field
- `contract-page-extensions.schema.md` — `sourceChanges[]` on contract pages references archived changes
- `execution-conventions.md` — atomic write conventions for ephemeral state
- `validation-rules.md` — severity conventions

---

## Location

`.plan-execution/ephemeral/changes/{changeId}.toon`

The directory is created on demand by `/loom-change init` (which calls into `hooks/lib/change-paths.ts` for the path — single source of truth, prevents Phase 5/6/7 drift).

A companion rollback log may appear alongside as `{changeId}-rollback.toon` (see `change-proposal.schema.md` → Atomic Archive Semantics).

---

## File Format

```toon
changeId: chg-20260523-clarify-idempotency
status: archived
transitions[6]{from,to,at,by,reason}:
  ,proposed,2026-05-23T08:00:00Z,human:alice,initial proposal
  proposed,reviewed,2026-05-23T08:30:00Z,agent:interpretation-reviewer,passed review
  reviewed,approved,2026-05-23T08:45:00Z,human:alice,approved for archive
  approved,in-progress,2026-05-23T09:00:00Z,agent:change-runner,run started
  in-progress,archived,2026-05-23T09:15:00Z,agent:change-archiver,multi-domain commit succeeded
conflicts[0]{otherChangeId,conflictingIds,detectedAt}:
supersededBy:
updatedAt: 2026-05-23T09:15:00Z
```

---

## Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `changeId` | string | **Required.** MUST equal the corresponding `ChangeProposal.changeId`. |
| `status` | enum | **Required.** Mirrors `ChangeProposal.status`. One of `proposed`, `reviewed`, `approved`, `in-progress`, `archived`, `rejected`, `superseded`. |
| `transitions` | object[] | **Required, ≥1 entry.** Append-only log of state transitions. See `## Transition Entry`. The first entry has empty `from` and `to: proposed`. |
| `conflicts` | object[] | **Required (may be empty).** Records detected conflicts against other in-flight changes. See `## Conflict Entry`. Populated by the archive command's conflict scan; cleared by reject of the conflicting change. |
| `supersededBy` | string \| null | **Required, nullable.** Set when another archived change invalidates this one (removed the requirements this change targeted). Null otherwise. When set, `status` MUST also be `superseded`. |
| `updatedAt` | ISO 8601 | **Required, monotonic.** Last write timestamp. Strictly increasing across writes. |

### Transition Entry

| Field | Type | Constraints |
|-------|------|-------------|
| `from` | string | **Required, may be empty.** The status before this transition. Empty for the initial `(none) → proposed` entry. |
| `to` | string | **Required.** The status after this transition. |
| `at` | ISO 8601 | **Required.** Transition timestamp. Strictly increasing across the array. |
| `by` | string | **Required.** Actor identity: `human:{name}` or `agent:{name}` or `loom-quick` for the quick-archive path. |
| `reason` | string | **Required.** Free text reason. Min 5 chars. For rejections, MUST contain the `--reason` flag value. |

### Conflict Entry

| Field | Type | Constraints |
|-------|------|-------------|
| `otherChangeId` | string | **Required.** The other in-flight change ID that overlaps. |
| `conflictingIds` | string[] | **Required, ≥1 entry.** R-NN and/or S-NN IDs that both changes target on the same contract page. |
| `detectedAt` | ISO 8601 | **Required.** Timestamp when the conflict scan ran. |

---

## Atomicity

Every write to this file follows the atomic-write convention from `execution-conventions.md`:

1. Write the full new content to `{path}.tmp`.
2. `fs.renameSync({path}.tmp, {path})`.

Partial writes are impossible — readers see either the previous state or the new state. The transitions log is append-only at the application layer; the file itself is rewritten in full on each transition.

---

## Status Lifecycle (mirror)

ChangeState's `status` field mirrors `ChangeProposal.status`. See `change-proposal.schema.md` → Status Lifecycle for the canonical diagram. The transitions log here is the **authoritative history** of how the status moved; the proposal frontmatter holds only the current value.

### Transition Source of Truth

| Transition | Triggered by | Writes |
|------------|--------------|--------|
| (none) → `proposed` | `/loom-change init` | Both proposal.md and ChangeState (ChangeState created). |
| `proposed` → `reviewed` | `/loom-change review` | Both. |
| `proposed`/`reviewed`/`in-progress` → `rejected` | `/loom-change reject --reason` | Both; rollback any staged contract-page writes. |
| `reviewed` → `approved` | `/loom-change approve` | Both. |
| `approved` → `in-progress` | `/loom-change run` | Both. |
| `in-progress` → `archived` | `/loom-change archive` | Both atomically; updates contract pages. |
| `archived` → `superseded` | Supersession scan during another archive | Both — ChangeState `supersededBy` set; proposal.md `status` updated to `superseded`. |

---

## Conflict Detection

When `/loom-change archive` runs, it scans all ChangeStates with `status ∈ {proposed, reviewed, approved, in-progress}` and looks for ID overlap on shared `affectedSpecs[]` domains.

### Algorithm

1. Read the current change's `deltas[].domain` set and the set of R-NN/S-NN IDs it touches (added, modified, removed).
2. For each other in-flight ChangeState:
   - Load its companion `ChangeProposal`.
   - For each domain in the intersection of `affectedSpecs[]`:
     - Compute the other change's touched-ID set on that domain.
     - If the intersection with the current change's touched-IDs is non-empty, this is a conflict.
3. For every conflict pair:
   - Append `{otherChangeId, conflictingIds, detectedAt: now}` to **both** ChangeStates' `conflicts[]`.
   - Block the current archive.
4. Display:
   ```
   CONFLICT: chg-20260523-clarify-idempotency cannot archive.
     Conflicts with chg-20260522-add-payment-retry on contract-billing.md.
     Overlapping IDs: R-02
     Options: (reject the other change) (rebase this change) (abort)
   ```

### Clearing Conflicts

A conflict is cleared when one of the conflicting changes transitions to `rejected` or `superseded`. The archive command re-runs the scan; if no conflicts remain, archive proceeds. The `conflicts[]` array on the surviving ChangeState is not automatically pruned (historical record) but the surviving change is unblocked.

---

## Supersession Discovery

After a successful archive, the archive command scans **all other** ChangeStates (statuses `proposed, reviewed, approved, in-progress`) to see if the just-archived change removed any requirement that the other change targets.

### Algorithm

1. Let `removedThisArchive` = union of `removedRequirements[]` across this change's deltas, grouped by domain.
2. For each other in-flight ChangeState:
   - For each domain in the intersection of `affectedSpecs[]`:
     - If the other change references (in `modifiedRequirements[].id` or `removedRequirements[]`) any ID in `removedThisArchive[domain]`, mark it superseded.
3. For each superseded change:
   - Set ChangeState `supersededBy` = this change's ID.
   - Set ChangeState `status` = `superseded`.
   - Append transition: `{from: <prev>, to: superseded, at: now, by: agent:change-archiver, reason: "superseded by {thisChangeId}"}`.
   - Update proposal.md `status` to `superseded`.

---

## Validation Rules

Severity follows `validation-rules.md` conventions.

| Rule | Severity | Description |
|------|----------|-------------|
| `changeId` matches proposal | blocking | ChangeState `changeId` MUST equal `ChangeProposal.changeId`; mismatch indicates corruption. |
| `status` mirrors proposal | warning | ChangeState `status` SHOULD match `ChangeProposal.status`. When they disagree, the proposal wins; the orchestrator emits a warning and re-syncs ChangeState. |
| `transitions[]` non-empty | blocking | At least the initial `(none) → proposed` entry. |
| `transitions[].at` monotonic | blocking | Timestamps strictly increasing across the array. |
| `transitions[]` first entry from-empty | blocking | The first entry MUST have empty `from` and `to: proposed`. |
| `transitions[]` final entry matches `status` | blocking | The last entry's `to` MUST equal the current `status`. |
| `updatedAt` monotonic | blocking | Strictly increasing across writes; rejecting a write older than the stored value. |
| `supersededBy` consistency | blocking | `supersededBy` non-null iff `status = superseded`. |
| `conflicts[].otherChangeId` exists | warning | The referenced other change MUST have an on-disk proposal. Stale references flagged. |
| `conflicts[].conflictingIds` non-empty | blocking | Every conflict entry MUST list ≥1 conflicting ID. |
| Status transition legality | blocking | Each `from → to` transition MUST be in the legal set defined in `change-proposal.schema.md` → Status Lifecycle. Illegal transitions rejected at write time. |

---

## Read Patterns

Common readers:

| Reader | Reads | Uses |
|--------|-------|------|
| `/loom-change list` | All `*.toon` in `.plan-execution/ephemeral/changes/` | Enumerate active changes with status, conflict flag, supersession flag. |
| `/loom-change status {id}` | `{changeId}.toon` + proposal.md | Full lifecycle view. |
| `/loom-change archive` | Current + all other in-flight | Conflict scan, supersession scan. |
| `loom-wiki lint` | Archived change records via contract page `sourceChanges[]` | Validate History consistency. |

All reads use `hooks/lib/change-state.ts` (Phase 5) for typed access.

---

## Worked Example: Conflict Lifecycle

Two engineers initiate changes touching the same requirement on `contract-billing.md`:

**chg-20260523-add-retry** state at `t=0`:
```toon
changeId: chg-20260523-add-retry
status: in-progress
transitions[4]{from,to,at,by,reason}:
  ,proposed,2026-05-23T07:00:00Z,human:alice,initial
  proposed,reviewed,2026-05-23T07:30:00Z,agent:interpretation-reviewer,passed
  reviewed,approved,2026-05-23T07:45:00Z,human:alice,approved
  approved,in-progress,2026-05-23T08:00:00Z,agent:change-runner,running
conflicts[0]{otherChangeId,conflictingIds,detectedAt}:
supersededBy:
updatedAt: 2026-05-23T08:00:00Z
```

**chg-20260523-clarify-idempotency** at `t=1` runs `/loom-change archive`. Conflict scan detects both target R-02 on `contract-billing.md`. Both ChangeStates updated:

```toon
# chg-20260523-add-retry (now has conflict)
conflicts[1]{otherChangeId,conflictingIds,detectedAt}:
  chg-20260523-clarify-idempotency,R-02,2026-05-23T09:10:00Z
updatedAt: 2026-05-23T09:10:00Z

# chg-20260523-clarify-idempotency (also has conflict)
conflicts[1]{otherChangeId,conflictingIds,detectedAt}:
  chg-20260523-add-retry,R-02,2026-05-23T09:10:00Z
updatedAt: 2026-05-23T09:10:00Z
```

Archive of `chg-20260523-clarify-idempotency` is blocked. Alice rejects `chg-20260523-add-retry`:
```
/loom-change reject chg-20260523-add-retry --reason "rebase against idempotency change"
```

Alice's ChangeState now shows:
```toon
status: rejected
transitions[5]{from,to,at,by,reason}:
  ,proposed,2026-05-23T07:00:00Z,human:alice,initial
  proposed,reviewed,2026-05-23T07:30:00Z,agent:interpretation-reviewer,passed
  reviewed,approved,2026-05-23T07:45:00Z,human:alice,approved
  approved,in-progress,2026-05-23T08:00:00Z,agent:change-runner,running
  in-progress,rejected,2026-05-23T09:12:00Z,human:alice,rebase against idempotency change
```

The idempotency change's archive can now proceed; rerunning the conflict scan finds no in-flight overlap.

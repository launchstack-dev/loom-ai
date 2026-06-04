# Scenarios and Changes — End-to-End Walkthrough

A complete guide to the two upgrades introduced by `PLAN-spec-upgrades.md`:

- **Scenarios (M-01)** — first-class Given/When/Then blocks under roadmap features and plan phases.
- **Change lifecycle (M-02)** — OpenSpec-style change proposals over per-domain `contract-*` wiki pages.

Both are opt-in extensions to `planVersion: 2`. v1 plans remain unchanged.

This document covers four workflows and one safety net:

1. **Greenfield** — start a project, materialize contract pages from the first completed milestone.
2. **Brownfield** — mutate existing contract pages via the full `/loom-change` lifecycle.
3. **Quick path** — `/loom-quick` against a project with contract pages auto-emits a retroactive change.
4. **Recovery** — what to do when the drift validator flags a manual edit or a partial archive.
5. **Conflict resolution** — what happens when two in-flight changes claim the same requirement IDs.

A field-lock note closes out the doc: the schemas frozen in Phase 0 of the plan must not be renamed.

---

## Before You Start

Authoring scenarios well is a skill — read [`docs/scenarios-authoring-template.md`](./scenarios-authoring-template.md) **before** writing them into a roadmap, plan, or change proposal. The schema (`agents/protocols/scenario.schema.md`) is the validator contract; the template teaches you how to write them in the spirit of BDD without falling into the most common compound-scenario traps.

Other schemas referenced throughout this guide:

- `agents/protocols/contract-page-extensions.schema.md` — body shape and frontmatter for `contract-*` pages
- `agents/protocols/change-proposal.schema.md` — proposal directory layout and DeltaBlock format
- `agents/protocols/change-state.schema.md` — runtime ChangeState format
- `agents/protocols/entity-domain-partition.schema.md` — the partition manifest format
- `agents/protocols/scenario-coverage.schema.md` — coverage report emitted by the planner

---

## 1. Greenfield Workflow

You're starting a project from a roadmap. The goal is to produce one `contract-*` wiki page per domain after the first milestone completes.

### Step 1: Roadmap with scenarios

Author `ROADMAP.md` with scenarios under your P0 / P1 features. Each scenario MUST follow `scenario.schema.md`.

```markdown
### F-01 — Issue invoice

Description: Issue a new invoice for a known customer.

Scenarios:

\`\`\`toon
id: S-01
title: Issue invoice for an existing customer
given[1]: A Customer with id "cust-123" exists
when: A client POSTs /api/invoices with valid payload
whenTriggerType: api-call
then[2]: Response status MUST be 201, A row MUST exist in invoices with status "issued"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
\`\`\`
```

Run `/loom-roadmap review` to get scenario-aware feedback from the four review agents.

### Step 2: Plan with scenarios

Run `/loom-plan create`. The plan-builder propagates roadmap scenarios into the relevant phases and may add phase-local scenarios under acceptance criteria. The plan frontmatter must include `planVersion: 2` for scenarios to be recognized.

```markdown
### Phase 1 — Wave 1: API

#### Acceptance Criteria
- [ ] POST /api/invoices for an existing Customer MUST return 201
- [ ] POST /api/invoices for an unknown Customer MUST return 404

#### Scenarios

\`\`\`toon
id: S-04
title: Refuse duplicate customer email
given[1]: A Customer with email "alice@example.com" exists
when: A client POSTs /api/customers with email "alice@example.com"
whenTriggerType: api-call
then[1]: Response status MUST be 409
stateRef:
tags[1]: error
testTier: integration
automatable: true
\`\`\`
```

### Step 3: Execute

Run `/loom-plan execute` as usual. Convergence-planner emits `ScenarioCoverageReport` to `.plan-execution/ephemeral/scenario-coverage.toon`, mapping every R-NN requirement to the scenarios that cover it. The convergence pipeline blocks on scenarios marked `automatable: true`.

### Step 4: Author the partition manifest

Before materializing, decide how entities partition across domains. Either:

```
/loom-plan materialize --propose-partition
```

…to scaffold a starter `.loom/wiki/contract-partition.toon` from entities the planner found, or hand-author it. The manifest looks like:

```toon
manifestVersion: 1
generatedAt: 2026-05-23T12:00:00Z
generatedBy: human:alice
sourceRoadmap: ROADMAP.md
sourcePlans[1]: PLAN.md
partitions[2]{domain,description,entities}:
  invoicing,Invoice issuance and refunds,Invoice
  customers,Customer records,Customer
unassignedEntities[0]:
notes:
```

**Critical:** every entity from your plan's `## Schema / Type Definitions` section MUST appear in exactly one domain's `entities[]`. Overlaps fail the materializer with a clear error.

### Step 5: Materialize contract pages

```
/loom-plan materialize
```

This reads the partition manifest + ROADMAP.md + PLAN.md and emits one `.loom/wiki/pages/contract-{domain}.md` page per partition entry, with:

- `category: contract` + the extended frontmatter (`contractVersion`, `domain`, `contractStatus`, `sourceChanges`, `contentChecksum`, …)
- Body sections in the required order: **Purpose**, **Requirements**, **Scenarios**, **Entities**, **Out of Scope**, **History**
- `contentChecksum` SHA-256 stamped over the canonical body (so the drift validator can detect manual edits later)
- Wiki index `pages[]` and `categories[]` updated atomically

If your source documents contain no scenarios, the materializer emits the Scenarios section with a placeholder `<!-- no scenarios found — re-run after upgrading to planVersion: 2 -->` and logs a warning. Re-running the materializer against unchanged inputs produces byte-identical output (idempotent).

### Step 6: Verify with wiki lint

```
/loom-wiki lint
```

The contract-page validators run alongside the standard W-001..W-027 rules. Findings appear in the `W-CP-*` namespace (see § Wiki lint integration). A clean lint means your contract pages are structurally valid and not manually edited.

You are now in the **maintenance phase**. From here on, contract pages can only be modified through `/loom-change` archive or `/loom-quick`'s quick-archive — see § Brownfield workflow and § Quick path.

---

## 2. Brownfield Workflow

You have existing `contract-*` wiki pages (whether you materialized them via Step 5 above or imported them from a prior milestone). You want to add, modify, or remove requirements/scenarios.

### Step 1: Initialize the change

```
/loom-change init "Add refund support to billing"
```

This creates `.loom/changes/chg-{YYYYMMDD}-add-refund-support-to-billing/` with:

- `proposal.md` — the ChangeProposal, seeded from the schema template (status: `proposed`)
- `deltas.toon` — the typed-array mirror of `proposal.md`'s `## Deltas` section, starting empty

And initializes the runtime state at `.plan-execution/ephemeral/changes/{changeId}.toon`.

### Step 2: Fill in scope and deltas

Open `proposal.md` and complete:

- **Intent** — 2-5 sentences explaining why this change is needed.
- **scope.included[]** and **scope.excluded[]** — both MUST be non-empty (this prevents scope creep).
- **approach** — high-level technical strategy.
- **affectedSpecs[]** — domain names (must each resolve to a `contract-{domain}` wiki page).
- **`## Deltas`** body section — per-domain DeltaBlocks listing added/modified/removed requirements and scenarios.
- **linkedPlan** — optional path to a scoped PLAN.md if this change requires implementation work.

After editing `proposal.md`, refresh `deltas.toon` to match. The validator (and the archive command) compares the mirror against the proposal body and blocks if they drift.

```toon
## Deltas

### Domain: invoicing

addedRequirements:
  - A refund MUST NOT exceed the original invoice amount
  - A refund MUST be auditable via the refund_audit_log table

addedScenarios:
  - id: S-07
    title: Issue partial refund within bounds
    given[2]: An invoice exists with paid amount 100.00, A CSR is authenticated
    when: The operator POSTs /api/refunds with amount 30.00
    whenTriggerType: api-call
    then[3]: Response status MUST be 201, Response body MUST contain refund_id, A refund row MUST exist with status "issued"
    tags[1]: happy-path
    testTier: integration
    automatable: true

breakingChange: false
rationale: Adds partial-refund support, an oft-requested feature for billing.
```

For `breakingChange: true`, a non-empty `migrationNote` is required.

### Step 3: Review

```
/loom-change review chg-20260523-add-refund-support-to-billing --notes "scope looks tight; approve"
```

Stamps `reviewedBy`, `reviewedAt`, `reviewNotes` and transitions `proposed` → `reviewed`. The reviewer can be an agent identity (`agent:strategy-reviewer`) or a human (`human:alice`).

### Step 4: Approve

```
/loom-change approve chg-20260523-add-refund-support-to-billing
```

Stamps `approvedBy`, `approvedAt`; transitions `reviewed` → `approved`. The change is now ready to run.

### Step 5: Run (optional)

```
/loom-change run chg-20260523-add-refund-support-to-billing
```

Transitions `approved` → `in-progress`. If `linkedPlan` is set on the proposal, the path is surfaced to stdout so the caller can dispatch `/loom-plan execute` against the scoped plan. If `linkedPlan` is null, `run` is a no-op transition — the change is marked in-progress to indicate manual implementation is underway, then archived once ready.

### Step 6: Archive

```
/loom-change archive chg-20260523-add-refund-support-to-billing
```

This is the **big one**. It:

1. **Pre-flight validates** every `modifiedRequirements[].id` and `removedRequirements[]` ID exists on each target page; checks `modifiedRequirements[].before` matches current page text.
2. **Conflict scans** against all in-flight ChangeStates. If overlap is detected on shared domains, `conflicts[]` is populated on BOTH peers and archive aborts.
3. **Snapshots** each target page to `.bak`, then writes new bodies via `contract-page-writer.ts` using atomic `.tmp` + rename. If any write fails mid-archive, all snapshots are restored in reverse order and a rollback log is emitted to `.plan-execution/ephemeral/changes/{changeId}-rollback.toon`.
4. **On success**: refreshes the wiki index, updates `proposal.md` `status: archived` + `archivedAt`, appends `in-progress → archived` transition, writes `archive-log.toon`, runs supersession scan.

After archive, the contract pages' History sections gain a new entry referencing this change, `contentChecksum` is recomputed, and the wiki index reflects the updated `pageCount` and `categories[]` counts.

---

## 3. Quick Path — Zero-Ceremony for Small Work

When your project has `contract-*` wiki pages and you run `/loom-quick "fix the off-by-one in refund cap"`, Loom Quick:

1. Executes the task with standard wiki context + impact assessment.
2. After verification passes, detects there are `contract-*` pages.
3. Invokes `scripts/loom-change/quick-archive.ts` with the deltas implied by the change.
4. quick-archive synthesizes a retroactive proposal stamped `reviewedBy: loom-quick` and `approvedBy: loom-quick`.
5. Runs the standard archive path — **full atomicity, conflict, supersession checks intact**.
6. The retroactive proposal lives under `.loom/changes/` for audit.

The user sees zero ceremony: no init, no review, no approve. The system gets full coherence: contract pages and wiki index are updated atomically; the drift validator will not flag the change because the checksum is recomputed.

If the project has no `contract-*` pages, `/loom-quick` behavior is unchanged — it falls back to the original quick-task flow.

---

## 4. Recovery — When Drift Is Detected

The drift validator (`hooks/lib/spec-validators/contract-page-drift.ts`) recomputes `contentChecksum` from the canonical body and compares against the stored value. A mismatch is a **blocking** finding emitted by `loom-wiki lint`.

There are three remediation paths:

### Path A — Capture the manual edit as a change

If a human (or external tool) edited the contract page directly, the cleanest fix is to wrap that edit in a retroactive change:

```
/loom-change init "Capture manual edit to contract-billing"
# Fill the proposal's deltas to mirror the manual edit
/loom-change review <id>
/loom-change approve <id>
/loom-change archive <id>
```

The archive recomputes `contentChecksum` and the drift goes away.

### Path B — Re-apply a partially-archived change (`/loom-change recover`)

If the drift was caused by a partial archive failure (mid-archive crash that left the page partially mutated), the drift validator's `recoveryPlan` field on the finding suggests a candidate change to re-apply.

> **Status**: as of Phase 8, `/loom-change recover {changeId}` is documented but the subcommand itself was deferred. The recovery plan emitted by the drift validator includes `candidateChangeId`, `missingRequirementIds[]`, and `missingScenarioIds[]` — a follow-up tool (or the user) can act on it manually by re-running `archive` against the candidate change, which idempotently re-applies missing deltas.

The future implementation path:

1. `recover.ts` reads the partial archive's rollback log at `.plan-execution/ephemeral/changes/{changeId}-rollback.toon`.
2. Re-applies the missing deltas in order.
3. Updates `contentChecksum` and emits a successful archive entry.

Track progress in `PLAN-spec-upgrades.md` follow-ups.

### Path C — Revert to the snapshot (`.bak`)

If the archive failure left a `.bak` file, restoring it returns the page to the pre-archive state. This is the safest option for time-sensitive incidents — recapture the intended change later via Path A.

---

## 5. Conflict Resolution — Two Changes, Same Requirement ID

When two in-flight changes claim overlapping requirement or scenario IDs on a shared domain, the archive command (invoked by either change) populates `conflicts[]` on BOTH peers' ChangeState files and exits non-zero.

The `conflicts[]` entry shape (from `change-state.schema.md`):

```toon
conflicts[1]{otherChangeId,conflictingIds,detectedAt}:
  chg-20260523-other-change,"R-04,R-05",2026-05-23T14:00:00Z
```

To resolve, choose one of:

### Option 1 — Reject one change

```
/loom-change reject chg-20260523-other-change --reason "superseded by chg-20260523-add-refund-support"
```

The rejected proposal can be revived later via `/loom-change init` against the same directory.

### Option 2 — Rebase one change

1. Open the losing change's `proposal.md`.
2. Adjust the deltas so they no longer claim the conflicting IDs (e.g., move modifications to new IDs).
3. Re-run `/loom-change archive` — the conflict scan now passes.

### Option 3 — Archive in sequence

If the changes are genuinely additive and non-conflicting in business intent, but their delta lists were drafted independently:

1. Archive change A first.
2. Re-open change B's proposal, refresh against the now-updated contract page, re-archive.

The conflict scan is intentionally conservative — it blocks rather than silently picking a winner. The user (or the orchestrator above the user) decides which change wins.

---

## Field-Lock Note

The following field names are **LOCKED** as of Phase 0 of `PLAN-spec-upgrades.md`. Do not rename them, even in your own forks — downstream agents, validators, and the materializer depend on the exact spellings.

**Scenario:** `id, title, given, when, whenTriggerType, then, stateRef, tags, testTier, automatable`

**ChangeProposal:** `changeId, status, intent, scope, approach, affectedSpecs, deltas, linkedPlan, reviewedBy, reviewedAt, reviewNotes, approvedBy, approvedAt, createdAt, archivedAt`

**DeltaBlock:** `domain, addedRequirements, modifiedRequirements, removedRequirements, addedScenarios, modifiedScenarios, removedScenarios, breakingChange, migrationNote, rationale`

**ChangeState:** `changeId, status, transitions, conflicts, supersededBy, updatedAt`

**ContractPage extended frontmatter:** `contractVersion, domain, contractStatus, sourceChanges, deprecatedAt, replacedBy, contentChecksum`

**EntityDomainPartition:** `domain, entities, description`

Field additions are fine in future schema revisions — field renames are not. The validator referencing chain is wide (planner, materializer, validators, lint hooks, /loom-quick integration) and a rename ripples through all of them.

---

## Wiki Lint Integration

The Phase 7 contract-page validators are wired into `loom-wiki lint` (see `agents/wiki-lint-agent.md`). They emit findings in the `W-CP-*` namespace alongside the standard W-001..W-027 rules:

- **W-CP-010..W-CP-019** — change-proposal structural rules (`validateAllChangeProposals`)
- **W-CP-020..W-CP-029** — contract-page body / frontmatter rules (`validateAllContractPages`)
- **W-CP-030..W-CP-039** — content-checksum drift (`validateAllContractPagesDrift`)

Severity follows `agents/protocols/validation-rules.md`: drift is **blocking**, structural issues are **blocking**, legacy pages without checksum are **info**.

---

## See Also

- [`docs/scenarios-authoring-template.md`](./scenarios-authoring-template.md) — how to write good scenarios
- [`PLAN-spec-upgrades.md`](../PLAN-spec-upgrades.md) — the source-of-truth plan for these features
- `agents/protocols/scenario.schema.md` — scenario validator rules
- `agents/protocols/change-proposal.schema.md` — proposal directory layout
- `agents/protocols/contract-page-extensions.schema.md` — contract-page body shape
- `commands/loom-change.md` — full subcommand reference
- `commands/loom-plan/materialize.md` — materializer command reference
- `commands/loom-quick.md` — quick-archive integration details

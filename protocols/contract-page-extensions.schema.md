# Contract Page Extensions Schema

Extensions to `wiki-page.schema.md` for `category: contract` pages that participate in the change-proposal lifecycle (PLAN-spec-upgrades.md, Upgrade B). Defines the additional frontmatter, the required body sections, and the validation rules that augment the standard wiki page contract.

The base `category: contract` page is defined in `wiki-page.schema.md` (introduced by PLAN-wiki-flows-contracts) — that schema owns the category, base frontmatter (`pageId`, `category`, `subtype`, `domain`, `staleness`, etc.), and the standard contract fields (`contractType`, `authorityFile`, `shapeFiles`, `shape`, `producers`, `consumers`, `invariants`, `compatibilityPolicy`). **This schema does not redefine those.** It adds the lifecycle fields and body shape needed for proposal-driven mutation.

Materialization (greenfield) and archived change proposals (steady-state) are the **only** writers of these pages. Manual edits are detected via `contentChecksum` drift (see `## Drift Detection`) and surfaced as blocking findings by `loom-wiki lint`.

Cross-references:
- `wiki-page.schema.md` — base frontmatter and the `category: contract` definition this extends
- `scenario.schema.md` — schema for blocks living in the `## Scenarios` body section
- `change-proposal.schema.md` — the only steady-state writer of contract pages
- `change-state.schema.md` — runtime state file tracked alongside each proposal
- `validation-rules.md` — severity conventions

---

## Page Location

`.loom/wiki/pages/contract-{domain}.md`, one page per domain in the `EntityDomainPartition` manifest. The `{domain}` segment is kebab-case and MUST match both the file path and the `domain` frontmatter field.

---

## Extended Frontmatter (additive over `wiki-page.schema.md`)

Below is a complete contract-page frontmatter example. Fields above the `--- lifecycle additions ---` comment are the base wiki contract fields from `wiki-page.schema.md`; fields below are the lifecycle additions defined by this schema.

```toon
pageId: contract-billing
title: Billing
category: contract
subtype: api
domain: code
summary: Billing domain contract — invoice issuance, payment capture, refund flows.
estimatedTokens: 1240
bodySections[6]: Purpose, Requirements, Scenarios, Entities, Out of Scope, History
contractType: api
authorityFile: src/contracts/billing.contract.ts
shapeFiles[2]: src/contracts/billing.contract.ts, src/types/billing.ts
shape: See ## Requirements
producers[1]: component-billing-routes
consumers[2]: component-billing-service, component-admin-portal
invariants[3]: invoice-id-immutable, payment-idempotent, refund-bounded-by-original
compatibilityPolicy: backward-compatible
# --- lifecycle additions (this schema) ---
contractVersion: 1
contractStatus: active
sourceChanges[2]: chg-20260520-add-refund-flow, chg-20260523-clarify-idempotency
deprecatedAt:
replacedBy:
contentChecksum: sha256:7a3b1c8e2d9f...
createdAt: 2026-05-20T14:00:00Z
updatedAt: 2026-05-23T09:15:00Z
createdBy: contract-page-writer
updatedBy: change-archiver
sourceRefs[2]: src/contracts/billing.contract.ts, src/types/billing.ts
crossRefs[2]{pageId,relationship}:
  flow-payment-capture,exercised-by
  component-billing-service,consumed-by
tags[3]: billing, contract, api
staleness: fresh
confidence: high
```

### Lifecycle Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `contractVersion` | integer | **Required.** Currently `1`. Bumped when this extension schema introduces an incompatible change. |
| `domain` | string | **Required.** kebab-case. MUST match the `{domain}` portion of `pageId` (which is `contract-{domain}`). MUST appear as a domain in `.loom/wiki/contract-partition.toon` (see `entity-domain-partition.schema.md`). |
| `contractStatus` | enum | **Required.** One of: `active`, `deprecated`, `superseded`. Distinct from `staleness` (which tracks content freshness from `wiki-page.schema.md`). `contractStatus` reflects lifecycle position; `staleness` reflects time-since-update. |
| `sourceChanges` | string[] | **Required.** Chronologically ordered list of `chg-{YYYYMMDD}-{slug}` change IDs that mutated this page. Empty array for greenfield pages from initial materialization. Every entry MUST correspond to an archived change directory under `.loom/changes/`. |
| `deprecatedAt` | ISO 8601 \| null | **Required, nullable.** Set to a timestamp when `contractStatus` transitions to `deprecated`. MUST be null when `contractStatus = active`. |
| `replacedBy` | string \| null | **Required, nullable.** When `contractStatus = superseded`, holds the successor `contract-{domain}` pageId. The wiki `crossRefs[]` MUST also include `{pageId: <replacedBy>, relationship: supersedes}` per `wiki-page.schema.md` cross-reference rules. |
| `contentChecksum` | string | **Required.** `sha256:<hex>` over the canonical concatenation of body sections (see `## Drift Detection`). Recomputed and stored by `contract-page-writer.ts` on every authorized write. Manual-edit detection compares the stored value to a fresh recomputation. |

### Required Body Sections

The `bodySections[]` frontmatter MUST list these six H2 headings in this order. The contract-page validator (`hooks/lib/spec-validators/contract-page.ts`, introduced by Phase 7) enforces ordering and presence.

| Order | Heading | Purpose | Authors |
|-------|---------|---------|---------|
| 1 | `## Purpose` | Domain-level intent — what this contract guarantees and why it exists. 2-5 sentences. No nested H3. | Materializer (greenfield); change archive replaces only if a delta specifies it. |
| 2 | `## Requirements` | Numbered `R-NN` RFC 2119 normative statements with `requirementType: functional | non-functional`. See `## Requirement Format` below. | Materializer + change deltas. |
| 3 | `## Scenarios` | Scenario blocks per `scenario.schema.md`. Each scenario MUST cite ≥1 requirement via its `given`/`then` text. | Materializer + change deltas. |
| 4 | `## Entities` | Entity definitions promoted from the source plan's Schema / Type Definitions section. | Materializer (greenfield); change deltas may amend. |
| 5 | `## Out of Scope` | Explicit exclusions — domains, behaviors, or invariants this contract does NOT guarantee. Prevents conflict with sibling contract pages. | Materializer + change deltas. |
| 6 | `## History` | Append-only log of archived changes. One entry per `sourceChanges[]` ID in matching order. | Change archive (append-only). Manual edits trigger drift validator. |

Lint rule **W-026** (from `wiki-lint-rules.md`) enforces presence; the contract-page validator additionally enforces **order**.

---

## Requirement Format

Inside `## Requirements`, each requirement is a numbered entry:

```markdown
**R-01** *(functional)* — The system MUST reject duplicate invoice IDs with HTTP 409.
**R-02** *(non-functional)* — Invoice issuance SHOULD complete within 200ms p95.
**R-03** *(functional)* — A refund MUST NOT exceed the original payment amount.
```

| Element | Rule |
|---------|------|
| ID format | `R-{NN}` zero-padded 2+ digit. Unique within the page. Never reused after removal — removed IDs are tombstoned in History. |
| `requirementType` | One of `functional` or `non-functional`, in italic parentheses after the ID. |
| RFC 2119 phrasing | Body MUST use MUST / MUST NOT / SHOULD / SHOULD NOT / MAY (see `docs/scenarios-authoring-template.md` cheatsheet). |
| Length | One sentence. Multi-condition requirements MUST be split. |

---

## Scenarios Section

Each scenario in `## Scenarios` is a TOON code block conforming to `scenario.schema.md`. The validator additionally enforces that:

1. Every scenario's `then[]` collectively covers ≥1 requirement (R-NN) in this page.
2. Conversely, every R-NN SHOULD be covered by ≥1 scenario (uncovered R-NN flagged as warning via `scenario-coverage.schema.md`).

---

## Entities Section

Entity tables promoted from the source plan:

```markdown
### Invoice

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key, immutable |
| amount | decimal | non-negative |
| status | enum | issued, paid, refunded |
```

Entities mentioned in scenarios SHOULD be defined here. Cross-page entity references are allowed but use kebab-case prefixed names (e.g., `customer.Customer` references the `Customer` entity on `contract-customer.md`).

---

## History Section

Append-only log. One entry per archived change. New entries MUST go at the bottom (chronological).

```markdown
### chg-20260520-add-refund-flow — 2026-05-20

**Rationale:** Added refund flow per Q2 OKR. Three new requirements (R-04, R-05, R-06), two new scenarios (S-07, S-08).
**Deltas:** added R-04..R-06; added S-07..S-08; no removals.
**Breaking:** false.

### chg-20260523-clarify-idempotency — 2026-05-23

**Rationale:** Clarified payment idempotency invariant after production incident.
**Deltas:** modified R-02 (added explicit idempotency key requirement); modified S-04 (verifies replay returns same response).
**Breaking:** false.
```

Each entry's heading text MUST exactly match an entry in `sourceChanges[]` frontmatter. Validator W-CP-04 (contract-page-04) cross-checks.

---

## Drift Detection

The `contentChecksum` field stores a SHA-256 over the canonical body. The drift validator (`hooks/lib/spec-validators/contract-page-drift.ts`, Phase 7) recomputes the checksum at lint time and flags mismatch as a blocking error.

### Canonical Body for Checksum

1. Extract the body — everything after the closing ```` ``` ```` of the TOON frontmatter block.
2. Normalize line endings to `\n`.
3. Strip trailing whitespace per line.
4. Strip leading and trailing blank lines.
5. Compute `sha256(canonicalBody)` as lowercase hex.
6. Store as `sha256:{hex}` in `contentChecksum`.

Manual edits without going through `/loom-change` produce a checksum mismatch, surfaced as:

```
[loom-wiki lint] blocking — contract-billing.md: contentChecksum mismatch.
  Stored:  sha256:7a3b1c8e2d9f...
  Current: sha256:9c2e4d1a8b3f...
  Recovery: run `/loom-change recover {changeId}` if a delta failed to apply, OR
            run `/loom-change init` to capture the manual edit as a retroactive change.
```

---

## Validation Rules

Severity follows `validation-rules.md` conventions.

| Rule | Severity | Description |
|------|----------|-------------|
| All 6 required body sections present | blocking | `## Purpose`, `## Requirements`, `## Scenarios`, `## Entities`, `## Out of Scope`, `## History` must all exist. |
| Body sections in declared order | blocking | The H2 headings appear in the order listed above. |
| `domain` matches `pageId` | blocking | `pageId = contract-{domain}` exactly. |
| `domain` in partition manifest | blocking | `domain` MUST appear in `.loom/wiki/contract-partition.toon`. |
| `contractStatus` enum | blocking | Value in `{active, deprecated, superseded}`. |
| `deprecatedAt` null iff `active` | blocking | `contractStatus = active` requires `deprecatedAt: null`; any other status requires a non-null timestamp. |
| `replacedBy` resolves | blocking | When set, the target `contract-{domain}` page MUST exist in the wiki index. |
| `sourceChanges[]` entries archived | blocking | Each ID MUST correspond to an archived change at `.loom/changes/{id}/` with `status: archived`. |
| `sourceChanges[]` matches History | blocking | Length and order of `sourceChanges[]` MUST equal the History entries' headings. |
| `contentChecksum` matches body | blocking | Recomputed checksum equals stored value. Mismatch = manual edit. |
| R-NN uniqueness | blocking | No duplicate R-NN within `## Requirements`. |
| Removed R-NN not reused | warning | Once an R-NN is removed via a change, the ID SHOULD NOT be reissued — tombstoned in History. |
| Every R-NN covered by ≥1 scenario | warning | Uncovered requirement flagged in `ScenarioCoverageReport`. |
| Every scenario cites ≥1 R-NN | info | Scenarios without an obvious requirement linkage flagged for review. |
| Out of Scope section non-empty | warning | An empty Out of Scope section is suspicious — every domain has exclusions worth recording. |

---

## Contract-Status Transitions

```
active ─────────────► deprecated ─────────────► superseded
   │                       │
   │                       └──► (terminal — page retained for history)
   │
   └────────────────────────────► superseded
                                  (requires replacedBy)
```

| From | To | Trigger | Required side effects |
|------|----|---------|-----------------------|
| `active` | `deprecated` | Change proposal sets status; rationale logged in History | Set `deprecatedAt`; do not set `replacedBy` yet (deprecation precedes replacement). |
| `active` | `superseded` | A successor `contract-{domain}` page is created in the same archive | Set `deprecatedAt`, `replacedBy`; add `supersedes` cross-ref on the successor. |
| `deprecated` | `superseded` | A successor is later authored | Set `replacedBy`; add `supersedes` cross-ref. |
| Any | `active` | **Not permitted.** Re-activating requires a new page (and a new pageId). | Validator rejects with `blocking — contract-status: cannot transition back to active`. |

---

## Greenfield Materialization

When `/loom-plan materialize` runs against an approved roadmap + completed plan:

1. Materializer reads `.loom/wiki/contract-partition.toon` (`entity-domain-partition.schema.md`).
2. For each domain, emits `.loom/wiki/pages/contract-{domain}.md` with:
   - `contractVersion: 1`
   - `contractStatus: active`
   - `sourceChanges[0]:` (empty)
   - `deprecatedAt: null`
   - `replacedBy: null`
   - `contentChecksum: sha256:{computed}`
   - All 6 body sections populated from plan content.
3. If the source contains no scenarios, the `## Scenarios` section is emitted with a placeholder `<!-- no scenarios found — re-run after upgrading to planVersion: 2 -->` and a materializer warning is logged.

---

## Relationship to Other Schemas

| Other schema | Relationship |
|--------------|--------------|
| `wiki-page.schema.md` | Defines `category: contract` and base frontmatter. This schema is purely additive. |
| `scenario.schema.md` | The `## Scenarios` body section hosts these blocks. |
| `change-proposal.schema.md` | The steady-state writer; mutates this page via DeltaBlock entries. |
| `change-state.schema.md` | Runtime state file for each in-flight change targeting this page. |
| `entity-domain-partition.schema.md` | Authoritative source of `{domain}` values — every contract page MUST correspond to an entry. |
| `scenario-coverage.schema.md` | Traceability output mapping `R-NN` to scenario IDs on this page. |

# Entity Domain Partition Schema

Explicit partitioning manifest at `.loom/wiki/contract-partition.toon`. Removes heuristic risk from the materializer (Phase 4 of PLAN-spec-upgrades.md). Authored manually or scaffolded via `/loom-plan materialize --propose-partition` before first materialization. Each domain entry becomes one `contract-{domain}` wiki page.

The materializer (`/loom-plan materialize`) refuses to run without a valid partition manifest. This is a deliberate guardrail — early prototypes attempted heuristic entity→domain clustering, which produced unstable partitions across re-runs and silent drift after schema changes. The explicit manifest makes domain boundaries a first-class artifact, reviewable like the roadmap itself.

Cross-references:
- `contract-page-extensions.schema.md` — `domain` field on contract pages MUST appear in this manifest
- `roadmap.schema.md` — entity names come from the roadmap's Data Model section
- `plan.schema.md` — entity names also sourced from PLAN.md Schema / Type Definitions
- `validation-rules.md` — severity conventions

---

## Location

`.loom/wiki/contract-partition.toon`

Committed to source control. Hand-edited or scaffolded by `/loom-plan materialize --propose-partition`. The materializer is the **only** runtime reader; lint and validators reference the file but never mutate it.

---

## File Format

```toon
manifestVersion: 1
generatedAt: 2026-05-20T14:00:00Z
generatedBy: human:alice
sourceRoadmap: ROADMAP.md
sourcePlans[2]: PLAN-refund-flow.md, PLAN-invoice-issuance.md
partitions[3]{domain,entities,description}:
  billing,"Invoice,Payment,Refund",Invoice issuance, payment capture, refund flows
  customer,"Customer,CustomerProfile,ContactMethod",Customer identity and contact data
  product-catalog,"Product,SKU,PriceList",Product definitions and pricing
unassignedEntities[0]:
notes: Refund and Payment kept together; splitting them would require synchronized contracts and produce excessive cross-page coupling.
```

---

## Top-Level Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `manifestVersion` | integer | **Required.** Currently `1`. Bumped when this schema introduces an incompatible change. |
| `generatedAt` | ISO 8601 | **Required.** When the manifest was created. Updated only when partitions change. |
| `generatedBy` | string | **Required.** Actor: `human:{name}` or `agent:{name}` (e.g., `agent:roadmap-builder-agent` when scaffolded via `--propose-partition`). |
| `sourceRoadmap` | string \| null | **Required, nullable.** Path to the ROADMAP.md whose Data Model entities were partitioned. Null when partitioned solely from plans. |
| `sourcePlans` | string[] | **Required (may be empty).** Paths to PLAN.md files whose Schema / Type Definitions entities were partitioned. |
| `partitions` | object[] | **Required, ≥1 entry.** Per-domain entry. See `## Partition Entry`. |
| `unassignedEntities` | string[] | **Required (may be empty).** Entities present in source files but deliberately not assigned to any domain. Materializer warns; lint blocks if non-empty and any plan/roadmap references an entity here. |
| `notes` | string \| null | **Optional.** Free text rationale — useful when partition boundaries are not obvious from entity names alone. |

---

## Partition Entry

| Field | Type | Constraints |
|-------|------|-------------|
| `domain` | string | **Required.** kebab-case, 2-30 chars. Unique within `partitions[]`. Becomes the `{domain}` portion of the materialized `contract-{domain}` page. |
| `entities` | string[] | **Required, ≥1 entry.** Entity names (UpperCamelCase) from source roadmaps/plans. Each entity MUST appear in exactly one partition (no overlap across domains). |
| `description` | string | **Required.** One-line summary of the domain. Used in the materialized page's `## Purpose` section as a seed. Min 10 chars, max 200 chars. |

---

## Validation Rules

Severity follows `validation-rules.md` conventions.

| Rule | Severity | Description |
|------|----------|-------------|
| `manifestVersion` is current | blocking | Must equal the supported version (currently `1`). |
| `partitions[]` non-empty | blocking | At least one domain. |
| `domain` is kebab-case | blocking | Lowercase alphanumerics + hyphens only; 2-30 chars. |
| `domain` unique within `partitions[]` | blocking | No duplicate domain names. |
| `entities[]` non-empty per partition | blocking | Every domain has at least one entity. |
| Entity unique across partitions | blocking | An entity name cannot appear in two `entities[]` arrays — partitions are disjoint. |
| Every source entity assigned or in unassigned | warning | Entities present in `sourceRoadmap`/`sourcePlans` MUST appear in either `partitions[].entities` or `unassignedEntities[]`. Missing entities flagged. |
| `unassignedEntities[]` empty when plan references them | blocking | If any source plan's acceptance criteria reference an entity in `unassignedEntities[]`, materialization is blocked — either assign it or remove the reference. |
| `description` length | warning | 10-200 chars enforced; longer descriptions belong in `notes` or on the contract page itself. |
| `sourceRoadmap` / `sourcePlans[]` resolve | warning | Referenced paths SHOULD exist; missing file = manifest stale. |
| Domain naming clarity (info) | info | Domains like `misc`, `other`, `general` flagged as suspicious — partitions should reflect coherent bounded contexts. |

---

## Authoring Flow

### Greenfield (`--propose-partition`)

```
/loom-plan materialize --propose-partition
```

Behavior:
1. Read `sourceRoadmap` and `sourcePlans[]`.
2. Collect entity set across all sources.
3. Apply heuristic clustering (keyword overlap on entity names, shared scenario references) to propose initial domains.
4. Write `.loom/wiki/contract-partition.toon` with `generatedBy: agent:loom-plan-materialize` and `notes:` populated with the heuristic rationale.
5. **Do not materialize.** The user must review and commit the partition before running `/loom-plan materialize` for real.

### Manual Authoring

The manifest can be hand-authored without `--propose-partition`. The materializer reads the file as-is and validates structure; the source of partition decisions is irrelevant once the manifest is on disk.

### Updating Partitions

When entities are added to the roadmap/plan after initial materialization:

1. Hand-edit the manifest to add the new entity to an existing partition or create a new one.
2. Re-run `/loom-plan materialize`.
3. Materializer detects new domains and creates new `contract-{domain}` pages; detects entities added to existing partitions and updates the relevant page's `## Entities` section.
4. **Materializer never deletes pages** — removing a domain from the manifest requires explicit `/loom-change` lifecycle work (deprecation, supersession).

### Splitting a Partition

Splitting `billing` into `invoicing` and `payments`:

1. Update the manifest: replace the `billing` entry with two new entries.
2. Run a `/loom-change init` proposal that:
   - Deprecates `contract-billing.md` (`contractStatus: deprecated`).
   - Creates `contract-invoicing.md` and `contract-payments.md` via fresh materialization (or via the change proposal itself if the lifecycle supports it — TBD by Phase 4 implementation).
3. The deprecated page's `replacedBy` is set in subsequent changes (deprecation precedes supersession).

---

## Worked Example: Heuristic vs. Explicit

Suppose the roadmap defines entities: `Invoice, Payment, Refund, Customer, CustomerProfile, Product, SKU, PriceList`.

**Heuristic clustering** (what we deliberately do NOT do at materialize time):
- Cluster by name prefix: `Customer*` → customer; rest → "default". Loses Product/Invoice separation.
- Cluster by co-occurrence in scenarios: produces shifting partitions as new scenarios are added → contract pages reshuffle silently.

**Explicit manifest** (this schema):

```toon
manifestVersion: 1
generatedAt: 2026-05-20T14:00:00Z
generatedBy: human:alice
sourceRoadmap: ROADMAP.md
sourcePlans[2]: PLAN-refund-flow.md, PLAN-invoice-issuance.md
partitions[3]{domain,entities,description}:
  billing,"Invoice,Payment,Refund",Invoice issuance, payment capture, refund flows
  customer,"Customer,CustomerProfile",Customer identity and profile data
  product-catalog,"Product,SKU,PriceList",Product definitions, SKUs, and pricing
unassignedEntities[1]: ContactMethod
notes: ContactMethod is intentionally unassigned — it's a join-only entity shared by Customer and (eventually) Vendor. Will be assigned to a future `shared-contact` domain when Vendor enters the roadmap.
```

The partition is stable across materializations and reviewable in PR. If `Refund` should move to its own domain later, that move is an explicit human decision recorded in a manifest edit and surfaced through the change-proposal lifecycle.

---

## Relationship to Other Schemas

| Other schema | Relationship |
|--------------|--------------|
| `contract-page-extensions.schema.md` | Every materialized contract page's `domain` MUST appear in this manifest's `partitions[].domain`. Conversely, every partition entry produces (or has produced) exactly one page. |
| `roadmap.schema.md` | The Data Model section is one source for `entities[]`. |
| `plan.schema.md` | The Schema / Type Definitions section is another source for `entities[]`. |
| `change-proposal.schema.md` | The `affectedSpecs[]` field on a proposal MUST list domain names from this manifest. |
| `wiki-page.schema.md` | The wiki index references each materialized contract page; the index is refreshed after every materialization. |

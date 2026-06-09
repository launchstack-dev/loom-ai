```toon
changeId: chg-20260526-rename-customer-table
status: rejected
intent: Rename the customer table to "billing_party" to better reflect domain language.
scope:
  included[1]: Rename Customer entity to BillingParty across the customers contract
  excluded[1]: Application code refactor (handled separately if approved)
approach: Treat as a major rename — add a new entity, deprecate the old, retire after a release.
affectedSpecs[1]: customers
linkedPlan:
reviewedBy:
reviewedAt:
reviewNotes:
approvedBy:
approvedAt:
createdAt: 2026-05-26T09:00:00.000Z
archivedAt:
```

# Change Proposal: Rename customer table

## Intent

Rename `customer` to `billing_party` for clarity.

## Scope

Contract-only rename. App-side refactor is a separate plan.

## Approach

Add the new entity, deprecate the old, retire after a release.

## Deltas

### customers

```toon
domain: customers
addedRequirements[1]: Customer entity SHOULD be referenced as BillingParty in new code
modifiedRequirements[0]{id,before,after}:
removedRequirements[0]:
addedScenarios[0]:
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: true
migrationNote: All callers must dual-write Customer and BillingParty for one release cycle.
rationale: Aligns terminology with finance domain language adopted by accounting.
```

## Rationale

Aligns terminology with finance domain language.

```toon
changeId: chg-20260527-quick-fix-customer-email-validation
status: archived
intent: Quick fix customer email validation — retroactive archive via /loom-quick.
scope:
  included[1]: changes captured by /loom-quick
  excluded[1]: anything outside the listed deltas
approach: Zero-ceremony quick-archive synthesized by /loom-quick after convergence.
affectedSpecs[1]: customers
linkedPlan:
reviewedBy: loom-quick
reviewedAt: 2026-05-27T09:00:00.001Z
reviewNotes: auto-review by /loom-quick
approvedBy: loom-quick
approvedAt: 2026-05-27T09:00:00.002Z
createdAt: 2026-05-27T09:00:00.000Z
archivedAt: 2026-05-27T09:00:00.100Z
```

# Change Proposal: Quick fix customer email validation

## Intent
Retroactive change captured by /loom-quick to keep contract pages coherent after a zero-ceremony task.

## Scope
Included: the deltas listed below. Excluded: anything not captured in those deltas.

## Approach
/loom-quick executed the task; this proposal captures the resulting deltas for the change lifecycle.

## Deltas

### customers

```toon
domain: customers
addedRequirements[1]: Customer email MUST be normalized to lowercase before duplicate check
modifiedRequirements[0]{id,before,after}:
removedRequirements[0]:
addedScenarios[1]:
  ```toon
  id: S-10
  title: Normalize email case before dedupe
  given[1]: A Customer with email "alice@example.com" exists
  when: A client POSTs /api/customers with email "Alice@Example.com"
  whenTriggerType: api-call
  then[1]: Response status MUST be 409
  stateRef:
  tags[2]: regression, error
  testTier: integration
  automatable: true
  ```
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: false
migrationNote:
rationale: Production saw two customer rows differing only by case; this fix normalizes the lookup.
```

## Rationale
Drive-by fix surfaced by /loom-quick — normalizes email case before the duplicate check.

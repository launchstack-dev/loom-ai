```toon
changeId: chg-20260525-deprecate-legacy-status
status: reviewed
intent: Deprecate the legacy "paid" status value on Invoice in favor of "settled" to align with finance terminology.
scope:
  included[1]: Rename Invoice status enum value paid → settled
  excluded[1]: Data migration tooling for live databases
approach: Update the invoicing contract requirement, add a regression scenario, schedule code changes via a follow-up linked plan.
affectedSpecs[1]: invoicing
linkedPlan:
reviewedBy: human:reviewer
reviewedAt: 2026-05-25T10:00:00.000Z
reviewNotes: Reviewing approach; needs second pass before approve.
approvedBy:
approvedAt:
createdAt: 2026-05-25T09:00:00.000Z
archivedAt:
```

# Change Proposal: Deprecate legacy status

## Intent

Rename the legacy `paid` status value on Invoice to `settled`.

## Scope

Contract-only change for now. Live-data migration is scoped to a follow-up.

## Approach

Modify the invoicing contract requirement R-01 to use the new value.

## Deltas

### invoicing

```toon
domain: invoicing
addedRequirements[1]: Invoice status SHOULD use the value "settled" rather than "paid"
modifiedRequirements[0]{id,before,after}:
removedRequirements[0]:
addedScenarios[0]:
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: false
migrationNote:
rationale: Aligns Invoice status terminology with finance team conventions for Q1 2026.
```

## Rationale

Aligns Invoice status terminology with finance team conventions.

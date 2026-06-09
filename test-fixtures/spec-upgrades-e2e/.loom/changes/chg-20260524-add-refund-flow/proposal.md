```toon
changeId: chg-20260524-add-refund-flow
status: archived
intent: Add refund flow to the invoicing domain so that issued invoices can be partially or fully refunded with audit logging.
scope:
  included[1]: Refund endpoint on /api/refunds for the invoicing domain
  excluded[1]: Multi-currency refund handling and chargeback workflows
approach: Extend the invoicing contract with R-NN requirements for refund issuance, add a happy-path scenario, and link to a scoped plan that implements the route.
affectedSpecs[1]: invoicing
linkedPlan:
reviewedBy: human:reviewer
reviewedAt: 2026-05-24T10:00:00.000Z
reviewNotes: Scope is tight; approach is incremental. LGTM.
approvedBy: human:approver
approvedAt: 2026-05-24T10:30:00.000Z
createdAt: 2026-05-24T09:00:00.000Z
archivedAt: 2026-05-24T12:00:00.000Z
```

# Change Proposal: Add refund flow

## Intent

Add refund flow to the invoicing domain so issued invoices can be partially or fully refunded with audit logging.

## Scope

Refund endpoint at `/api/refunds`. Multi-currency and chargeback workflows are explicitly out.

## Approach

Extend the invoicing contract with refund requirements and a happy-path scenario.

## Deltas

### invoicing

```toon
domain: invoicing
addedRequirements[1]: A refund MUST NOT exceed the original invoice amount
modifiedRequirements[0]{id,before,after}:
removedRequirements[0]:
addedScenarios[0]:
modifiedScenarios[0]{id,before,after}:
removedScenarios[0]:
breakingChange: false
migrationNote:
rationale: Adds partial-refund support — an often-requested billing feature.
```

## Rationale

Adds partial-refund support, an often-requested billing feature, with audit logging baked in.

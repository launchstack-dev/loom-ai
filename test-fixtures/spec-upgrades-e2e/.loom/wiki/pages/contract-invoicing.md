```toon
pageId: contract-invoicing
title: Invoicing
category: contract
subtype: 
domain: invoicing
projectDomain: code
summary: Invoicing domain contract — Invoice issuance and lifecycle
bodySections[6]: Purpose, Requirements, Scenarios, Entities, Out of Scope, History
contractVersion: 1
contractStatus: active
sourceChanges[1]: chg-20260524-add-refund-flow
deprecatedAt:
replacedBy:
contentChecksum: sha256:1b05dbc02eef596b20818b88ee57be9e89840e85dd48169ee1a59952760d8809
createdAt: 2026-05-23T12:00:00.000Z
updatedAt: 2026-05-24T12:00:00.000Z
createdBy: materializer
updatedBy: human:fixture
sourceRefs[2]: test-fixtures/spec-upgrades-e2e/ROADMAP.md, test-fixtures/spec-upgrades-e2e/PLAN.md
crossRefs[0]:
tags[2]: contract, invoicing
staleness: fresh
confidence: high
estimatedTokens: 573
```

# Invoicing

## Purpose

Invoice issuance and lifecycle

## Requirements

**R-01** *(functional)* — Invoice MUST have a unique id

**R-02** *(functional)* — A refund MUST NOT exceed the original invoice amount

## Scenarios

```toon
id: S-01
title: Issue invoice for an existing customer
given[1]: A Customer with id cust-123 exists
when: A client POSTs /api/invoices with valid payload
whenTriggerType: api-call
then[2]: Response status MUST be 201, A row MUST exist in invoices with status issued
stateRef: tags[1]: happy-path
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Reject invoice for unknown customer
given[1]: No Customer with id cust-999 exists
when: A client POSTs /api/invoices for customer "cust-999"
whenTriggerType: api-call
then[1]: Response status MUST be 404
stateRef: tags[1]: error
tags[1]: error
testTier: integration
automatable: true
```

## Entities

### Invoice

A billing record issued to a Customer.

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key, immutable |
| customerId | string | foreign key → Customer.id |
| amount | decimal | non-negative |
| status | enum | issued, paid, refunded |

## Out of Scope

<!-- explicit exclusions go here -->

## History

### chg-20260524-add-refund-flow — 2026-05-24

**Rationale:** Adds partial-refund support — an often-requested billing feature.
**Deltas:** added 1 req(s)
**Breaking:** false

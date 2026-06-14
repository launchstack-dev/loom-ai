```toon
pageId: contract-customers
title: Customers
category: contract
subtype: 
domain: customers
projectDomain: code
summary: Customers domain contract — Customer identity and contact data
bodySections[6]: Purpose, Requirements, Scenarios, Entities, Out of Scope, History
contractVersion: 1
contractStatus: active
sourceChanges[1]: chg-20260527-quick-fix-customer-email-validation
deprecatedAt:
replacedBy:
contentChecksum: sha256:a13aa5089502a278775d174bd46dd83b6f2a5f6cef0cc0decbfdeb08bd0b77b6
createdAt: 2026-05-23T12:00:00.000Z
updatedAt: 2026-05-27T09:00:00.100Z
createdBy: materializer
updatedBy: loom-quick
sourceRefs[2]: test-fixtures/spec-upgrades-e2e/ROADMAP.md, test-fixtures/spec-upgrades-e2e/PLAN.md
crossRefs[0]:
tags[2]: contract, customers
staleness: fresh
confidence: high
estimatedTokens: 845
```

# Customers

## Purpose

Customer identity and contact data

## Requirements

**R-01** *(functional)* — Customer MUST have a unique email

**R-02** *(functional)* — POST /api/invoices for an existing Customer MUST return 201

**R-03** *(functional)* — POST /api/invoices for an unknown Customer MUST return 404

**R-04** *(functional)* — POST /api/customers with a duplicate Customer email MUST return 409

**R-05** *(functional)* — Customer email MUST be normalized to lowercase before duplicate check

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

```toon
id: S-03
title: Create customer with unique email
given[1]: No Customer with email alice@example.com exists
when: A client POSTs /api/customers with valid payload
whenTriggerType: api-call
then[1]: Response status MUST be 201
stateRef: tags[1]: happy-path
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-04
title: Refuse duplicate customer email
given[1]: A Customer with email alice@example.com exists
when: A client POSTs /api/customers with email "alice@example.com"
whenTriggerType: api-call
then[1]: Response status MUST be 409
stateRef: tags[1]: error
tags[1]: error
testTier: integration
automatable: true
```

```toon
id: S-10
title: 
given[0]:
when: 
whenTriggerType: 
then[0]:
stateRef:
tags[0]:
testTier:
automatable: false
```

## Entities

### Customer

A billing party.

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key, immutable |
| email | string | unique, lowercase |
| name | string | required, max 200 chars |

## Out of Scope

<!-- explicit exclusions go here -->

## History

### chg-20260527-quick-fix-customer-email-validation — 2026-05-27

**Rationale:** Production saw two customer rows differing only by case; this fix normalizes the lookup.
**Deltas:** added 1 req(s); added 1 scenario(s)
**Breaking:** false

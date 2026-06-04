---
roadmapVersion: 1
name: "Billing Sample"
status: approved
created: 2026-05-23
lastReviewed: 2026-05-23
targetDate: null
totalFeatures: 2
totalMilestones: 1
---

# Roadmap: Billing Sample

## Vision

A minimal billing fixture used to exercise the contract-page materializer. It defines invoicing and customer domains so the example partition manifest has at least two non-trivial entries.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Invoice issuance correctness | 100% pass on golden scenarios | vitest suite |
| Customer dedupe | Zero duplicate emails | DB unique constraint test |

## Constraints & Decisions

- Single-currency invoicing only — multi-currency is out of scope for this fixture.

## Features

### F-01 — Issue invoice

Description: Issue a new invoice for a known customer.

Scenarios:

```toon
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
```

```toon
id: S-02
title: Reject invoice for unknown customer
given[1]: No Customer with id "cust-999" exists
when: A client POSTs /api/invoices for customer "cust-999"
whenTriggerType: api-call
then[1]: Response status MUST be 404
stateRef:
tags[1]: error
testTier: integration
automatable: true
```

### F-02 — Create customer

Description: Create a Customer record.

Scenarios:

```toon
id: S-03
title: Create customer with unique email
given[1]: No Customer with email "alice@example.com" exists
when: A client POSTs /api/customers with valid payload
whenTriggerType: api-call
then[1]: Response status MUST be 201
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

## Data Model

### Invoice

Issued to a Customer.

### Customer

A billing party.

## Milestones

### M-01: Initial billing

All F-01 and F-02 scenarios pass.

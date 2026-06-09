---
planVersion: 2
name: "Billing Sample"
status: completed
created: 2026-05-23
lastReviewed: 2026-05-23
roadmapRef: ROADMAP.md
totalPhases: 2
totalWaves: 1
---

# Plan: Billing Sample

## Overview

Minimal billing fixture for exercising the contract-page materializer. Provides Invoice and Customer entities plus a few acceptance criteria so requirements appear on the materialized pages.

## Tech Stack

- TypeScript
- Node.js
- vitest

## Schema / Type Definitions

### Invoice

A billing record issued to a Customer.

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key, immutable |
| customerId | string | foreign key → Customer.id |
| amount | decimal | non-negative |
| status | enum | issued, paid, refunded |

### Customer

A billing party.

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, primary key, immutable |
| email | string | unique, lowercase |
| name | string | required, max 200 chars |

## Execution Phases

### Phase 0 — Wave 0: Contracts

**Agent:** contracts-agent
**Objective:** Define shared types.
**Dependencies:** None
**File Ownership:** .plan-execution/contracts/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| types.ts | Create | contracts-agent |

#### Acceptance Criteria
- [ ] Invoice MUST have a unique id
- [ ] Customer MUST have a unique email

### Phase 1 — Wave 1: API

**Agent:** implementer-agent
**Objective:** Issue invoices.
**Dependencies:** Phase 0
**File Ownership:** src/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/api/invoices.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] POST /api/invoices for an existing Customer MUST return 201
- [ ] POST /api/invoices for an unknown Customer MUST return 404
- [ ] POST /api/customers with a duplicate Customer email MUST return 409

#### Scenarios

```toon
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
```

## Verification Commands

```bash
npx tsc --noEmit
npx vitest run
```

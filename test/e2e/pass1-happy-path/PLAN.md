---
planVersion: 1
name: "CLI Calculator"
status: draft
created: 2026-04-07
lastReviewed: null
totalPhases: 2
totalWaves: 2
---

# Plan: CLI Calculator

## Overview

Build a command-line calculator that accepts two numbers and an arithmetic operator (+, -, *, /) as arguments, validates all input, handles division by zero, and prints the result to stdout. Includes a --help flag for usage information.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js (ES2022 target, NodeNext modules)
- **Build:** tsc -> dist/
- **Test:** Vitest
- **Dependencies:** None beyond dev tooling (@types/node, typescript, vitest)

## Schema / Type Definitions

### Operator

| Field | Type | Constraints |
|-------|------|-------------|
| operator | `"add" \| "subtract" \| "multiply" \| "divide"` | Also accepts `+`, `-`, `*`, `/` aliases |

### CalculatorInput

| Field | Type | Constraints |
|-------|------|-------------|
| left | number | Must be a finite number (not NaN, not Infinity) |
| operator | Operator | Must be a valid operator string |
| right | number | Must be a finite number (not NaN, not Infinity) |

### CalculatorResult

| Field | Type | Constraints |
|-------|------|-------------|
| success | boolean | true if calculation succeeded |
| value | number \| undefined | The numeric result (present when success=true) |
| error | string \| undefined | Error message (present when success=false) |

## Execution Phases

### Phase 0 — Wave 0: Contracts

**Agent:** contracts-agent
**Objective:** Define shared types for operators, inputs, results, and the calculate function signature
**Dependencies:** None
**File Ownership:** src/types.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/types.ts | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `src/types.ts` exports the `Operator` type, `CalculatorInput` interface, and `CalculatorResult` interface
- [ ] `Operator` type includes both word forms (add, subtract, multiply, divide) and symbol forms (+, -, *, /)

### Phase 1 — Wave 1: Implementation

**Agent:** implementer-agent
**Objective:** Implement the CLI entry point with argument parsing, input validation, calculation logic, --help flag, division-by-zero handling, and tests
**Dependencies:** Phase 0
**File Ownership:** src/index.ts, src/__tests__/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/index.ts | Create | implementer-agent |
| src/__tests__/calculator.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `npx tsx src/index.ts 2 add 3` prints `5` to stdout
- [ ] `npx tsx src/index.ts 10 divide 0` prints an error message to stderr and exits with code 1
- [ ] `npx tsx src/index.ts --help` prints usage information including supported operators and exits with code 0
- [ ] `npx tsx src/index.ts foo add 3` prints a validation error to stderr and exits with code 1
- [ ] `npx tsx src/index.ts 2 modulo 3` prints an "unsupported operator" error to stderr and exits with code 1
- [ ] `npx vitest run` passes all tests with exit code 0

## Verification Commands

```bash
npx tsc --noEmit
npx vitest run
```

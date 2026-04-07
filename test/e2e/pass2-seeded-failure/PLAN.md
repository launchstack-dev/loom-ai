---
planVersion: 1
name: "CLI Calculator"
status: draft
created: 2026-04-07
lastReviewed: null
totalPhases: 2
totalWaves: 1
---

# Plan: CLI Calculator

## Overview

Build a command-line calculator that accepts two numbers and an arithmetic operator (add, subtract, multiply, divide) as arguments, validates all input, handles division by zero gracefully, and prints the result. Includes a `--help` flag for usage information.

## Tech Stack

- Language: TypeScript (strict mode, ES2022 target)
- Runtime: Bun
- Module system: ESM (NodeNext resolution)
- Test framework: Vitest
- Build: tsx for direct execution

## Schema / Type Definitions

### Operator

| Field | Type | Constraints |
|-------|------|-------------|
| value | `"add" \| "subtract" \| "multiply" \| "divide"` | Must be one of the four valid operators |

### CalculatorInput

| Field | Type | Constraints |
|-------|------|-------------|
| left | number | Finite number, parsed from string argument |
| operator | Operator | One of the four valid operators |
| right | number | Finite number, parsed from string argument |

### CalculatorResult

| Field | Type | Constraints |
|-------|------|-------------|
| success | boolean | true if computation succeeded |
| value | number \| null | The computed result, null on error |
| error | string \| null | Error message, null on success |

## Execution Phases

### Phase 0 — Wave 0: Contracts

**Agent:** contracts-agent
**Objective:** Define shared TypeScript types for operator, calculator input, calculator result, and error handling
**Dependencies:** None
**File Ownership:** src/types.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/types.ts | Create | contracts-agent |

#### Acceptance Criteria
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `src/types.ts` exports `Operator` type union with exactly four values: "add", "subtract", "multiply", "divide"
- [ ] `src/types.ts` exports `CalculatorInput` interface with fields: left (number), operator (Operator), right (number)
- [ ] `src/types.ts` exports `CalculatorResult` interface with fields: success (boolean), value (number | null), error (string | null)

### Phase 1 — Wave 1: Implementation

**Agent:** implementer-agent
**Objective:** Implement arithmetic operations, input validation, CLI entry point with --help flag, and unit tests (D-01: manual argv parsing, D-02: modular src/ layout)
**Dependencies:** Phase 0
**File Ownership:** src/operations.ts, src/validation.ts, src/cli.ts, src/index.ts, src/__tests__/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| src/operations.ts | Create | implementer-agent |
| src/validation.ts | Create | implementer-agent |
| src/cli.ts | Create | implementer-agent |
| src/index.ts | Create | implementer-agent |
| src/__tests__/operations.test.ts | Create | implementer-agent |
| src/__tests__/validation.test.ts | Create | implementer-agent |
| src/__tests__/cli.test.ts | Create | implementer-agent |

#### Acceptance Criteria
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `bun run src/cli.ts 2 add 3` prints `5`
- [ ] `bun run src/cli.ts 10 divide 0` prints an error message containing "division by zero" (case-insensitive) and exits with code 1
- [ ] `bun run src/cli.ts --help` prints usage information including all four operator names and exits with code 0
- [ ] `bun run src/cli.ts foo add 3` prints an error message about invalid number input and exits with code 1
- [ ] `bun run src/cli.ts 5 modulo 3` prints an error message about invalid operator and exits with code 1
- [ ] `npx vitest run` exits with code 0 with all tests passing

## Verification Commands

```bash
npx tsc --noEmit
npx vitest run
bun run src/cli.ts 2 add 3
bun run src/cli.ts 10 divide 0
bun run src/cli.ts --help
```

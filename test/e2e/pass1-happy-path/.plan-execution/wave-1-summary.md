# Wave 1 Summary: Implementation

## Files Created
- `src/index.ts` — CLI entry point with parseArgs, calculate, help text, main
- `src/__tests__/calculator.test.ts` — 15 tests covering parsing, calculation, edge cases

## Files Modified
- `package.json` — changed type to "module", added tsx dev dep, updated scripts
- `tsconfig.json` — added types: ["node"]

## Exports
- `parseArgs` (function) — validates and parses CLI arguments into CalculatorInput
- `calculate` (function) — performs arithmetic, returns CalculatorResult

## Verification
- `npx tsc --noEmit` — PASS
- `npx vitest run` — PASS (15/15 tests)
- CLI acceptance criteria — all 5 scenarios verified manually

## Issues
None.

# Execution Context

## Wave 1 [HOT]

```toon
filesCreated[2]: src/index.ts,src/__tests__/calculator.test.ts
filesModified[2]: package.json,tsconfig.json
exportsAdded[2]{name,file,kind}:
  parseArgs,src/index.ts,function
  calculate,src/index.ts,function
```

Integration notes: src/index.ts exports parseArgs and calculate. CLI entry guarded by import.meta.url check. package.json type changed to "module". tsconfig.json now includes types: ["node"].

## Wave 0 [WARM]
Shared contracts: src/types.ts exports Operator (word + symbol forms), CalculatorInput, CalculatorResult.

# Shared-Core Module Schema (C-02)

Registry of the neutral `lib/` primitives imported by BOTH `hooks/` and
`scripts/`. This is the Phase-0 contract; the modules are implemented in
Phases 2a/2b. Export signatures here MUST match the plan's API Specification
`lib/` table and the TypeScript types in `lib/types.ts`.

- **No CLI — library only.** These modules never run as entry points.
- Reimplementing any listed export **outside `lib/`** is banned by ESLint
  `no-restricted-imports` / `no-restricted-syntax` (wired in Phase 2b).
- Breaking a signature requires migrating every caller in the same phase
  (RESTRICT cascade).

## Module registry

Canonical artifact shape (`SharedCoreModule`, one row per module):

```toon
sharedCoreModules[4]{name,file,exports,bannedReimplementations}:
  toon,lib/toon.ts,"parseToon,serializeToon","hand-rolled TOON serializers"
  csv,lib/csv.ts,"splitCsvLine,joinCsvLine","local CSV splitters"
  atomic-fs,lib/atomic-fs.ts,"atomicWrite,atomicWriteText","copy-pasted atomicWrite"
  entry-guard,lib/entry-guard.ts,isMain,"top-level main() calls"
```

`migratedCallers` is appended per module during the Phase 11a/11b strangler
migration:

```toon
migration:
  module: csv
  migratedCallers[2]: hooks/lib/toon-reader.ts, scripts/loom-change/archive.ts
```

## Export signatures (frozen)

All types referenced below are exported from `lib/types.ts`.

```toon
exports[7]{module,export,signature,behavior}:
  toon,parseToon,(text: string) => ToonValue,"Full TOON grammar per CLAUDE.md quick reference; throws ToonParseError with line/col"
  toon,serializeToon,(value: ToonValue) => string,"Canonical output: 2-space indent, stable key order; round-trips with parseToon"
  csv,splitCsvLine,"(line: string, opts?: CsvSplitOptions) => string[]","Handles quoted fields AND escaped double-quotes (the hooks/lib/toon-reader.ts:125 miss); strips/collapses by default per scripts/loom-change/archive.ts:1119, preserves quotes per scripts/materialize-contracts.ts:787 when preserveQuotes: true"
  csv,joinCsvLine,(fields: string[]) => string,"Quotes/escapes inverse of splitCsvLine"
  atomic-fs,atomicWrite,"(path: string, data: string | Buffer, opts?: AtomicWriteOptions) => void","Write {path}.tmp then fs.renameSync — the single sanctioned implementation"
  atomic-fs,atomicWriteText,"(path: string, text: string, opts?: AtomicWriteOptions) => void","String convenience wrapper over atomicWrite"
  entry-guard,isMain,(importMeta: ImportMeta) => boolean,"Entry guard: true only when the module is the process entry point; works under both bun and node"
```

**Notes**

- `ToonValue`, `CsvSplitOptions`, and `AtomicWriteOptions` are defined in
  `lib/types.ts` (Phase 0). `ToonParseError` is a runtime class introduced by
  the Phase 2a `lib/toon.ts` implementation.
- `serializeToon(parseToon(x))` MUST round-trip for any canonical TOON input.
- `splitCsvLine` with `preserveQuotes: true` reproduces the
  `scripts/materialize-contracts.ts:787` behavior; the default (`false`)
  strips quotes and collapses escaped `""` to `"` — the
  `scripts/loom-change/archive.ts:1119` reference behavior, and the case
  `hooks/lib/toon-reader.ts:125` missed.

## Indexes (reader-enforced)

```toon
indexes[2]{index,fields,type,purpose}:
  pk_module,name,PRIMARY,Module lookup
  uq_export,exports[i],UNIQUE,No two modules export the same symbol
```

## Cascade behavior

```toon
cascades[1]{parent,child,onDelete,onUpdate}:
  SharedCoreModule,"caller imports (hooks/**, scripts/**)",RESTRICT — lint fails if a module is removed while imported,Signature change requires all callers updated in the same phase
```

## Validation

```toon
validation[5]{field,rule,error}:
  name,unique kebab-case,VALIDATION_ERROR
  file,path under lib/ and exists,VALIDATION_ERROR
  exports,>=1 and every export typed in lib/types.ts,VALIDATION_ERROR
  bannedReimplementations,non-empty description,VALIDATION_ERROR
  exports[i],unique across all modules,VALIDATION_ERROR
```

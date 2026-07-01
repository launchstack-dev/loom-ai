---
description: Composite 0-10 quality score with trend history
---

# /loom-health

Runs `scripts/loom-health.ts` and displays the current composite quality score
alongside a trend from `.loom/health-history.toon`.

Components (weights):

| Component | Weight | Tool | Skipped when |
|-----------|--------|------|--------------|
| typecheck | 30%    | `bunx tsc --noEmit` | no `tsconfig.json` |
| tests     | 30%    | `bunx vitest run`   | vitest not installed |
| lint      | 20%    | `bunx eslint .`     | no eslint config |
| dead-code | 10%    | `bunx knip`         | knip not installed |
| shell     | 10%    | `shellcheck`        | no `.sh` files or shellcheck missing |

Skipped components emit a `HEALTH_TOOL_MISSING` note and drop from the
re-normalised composite.

## Usage

```bash
bunx tsx scripts/loom-health.ts
```

Or via `npx`:

```bash
npx tsx scripts/loom-health.ts
```

## Output

```toon
loomHealthScore: 7.4
breakdown[5]{tool,rawScore,weightedContribution}:
  typecheck,10.0,3.00
  tests,7.5,2.25
  lint,skipped,0.0
  ...
```

Each run appends one row to `.loom/health-history.toon` for trend tracking.

## Contract

- Source: `scripts/loom-health.ts`
- History: `.loom/health-history.toon` (schema: `HealthScoreHistory` in
  `PLAN-gstack-adoption.md`)
- Error code: `HEALTH_TOOL_MISSING` (non-fatal warning)

# Metrics Snapshot Schema (C-09, C-12)

Repo-derived success metrics. Artifact: `planning/reports/metrics-snapshot.toon`.
Schema type: `MetricsSnapshot` in `lib/types.ts`. Runner:
`bun scripts/metrics-snapshot.ts`.

- **No telemetry** (C-12): there is no endpoint. Every metric is derived from
  repo state by a re-runnable command (`derivedBy`); values are never
  hand-edited and `pass` is computed, not authored.
- The snapshot is the single source for the changelog metrics block; a stale
  or deleted snapshot fails changelog validation (`METRICS_MISMATCH`).

## MetricsSnapshot artifact

```toon
metricsSnapshot:
  capturedAt: 2026-07-01T00:00:00Z
  gitRef: <commit sha>
  metrics[7]{metric,value,target,derivedBy,pass}:
    typecheck-errors,0,0,"tsc --noEmit -p hooks/tsconfig.json",true
    test-source-ratio,1.42,1.4,"bun scripts/metrics-snapshot.ts --metric ratio",true
    tautological-tests,0,0,"bun scripts/audit-tests.ts --count-remaining",true
    defects-closed,15,15,"defect-closure checklist in changelog",true
    ci-gates-green,true,true,"gh run list --workflow pr-gate.yml,nightly-gate.yml",true
    meta-tests-firing,1,1,"bunx vitest run tests/meta",true
    scorecard-overall,8.4,8.3,"bun scripts/scorecard-gate.ts --overall",true
```

## The 7 pre-registered scorecard metrics

Unknown metric names are a blocking parse error. This is the frozen set:

```toon
metrics[7]{metric,target,valueType,derivedBy}:
  typecheck-errors,0,number,tsc --noEmit -p hooks/tsconfig.json
  test-source-ratio,1.4,number,bun scripts/metrics-snapshot.ts --metric ratio
  tautological-tests,0,number,bun scripts/audit-tests.ts --count-remaining
  defects-closed,15,number,defect-closure checklist in changelog
  ci-gates-green,true,boolean,"gh run list --workflow pr-gate.yml,nightly-gate.yml"
  meta-tests-firing,1,number,bunx vitest run tests/meta
  scorecard-overall,8.3,number,bun scripts/scorecard-gate.ts --overall
```

```toon
fields[6]{field,type,constraints,validation}:
  capturedAt,string,ISO 8601,required
  gitRef,string,40-char sha,must be an ancestor of main
  metric,enum,one of the 7 pre-registered names,unknown metric names are blocking
  value,scalar,number | boolean,required; never hand-edited (derivation is the source)
  derivedBy,string,re-runnable command,required — no telemetry (C-12)
  pass,boolean,value meets target,computed not authored
```

## C-21 / IC-001 equivalence block

The `test-source-ratio` metric accepts a machine-validated **equivalence
block** as an alternative to a raw LOC ratio ≥ 1.4. There is **no free-prose
escape** — this exact shape is schema-checked by `scripts/metrics-snapshot.ts`.
Schema type: `MetricEquivalenceBlock` in `lib/types.ts`.

```toon
equivalence:
  basis: behavioral-assertion-count
  computedValue: 1.47
  rationale: "Behavioral assertions per source LOC exceed the 1.4 floor even where raw test LOC does not, because property-based tests cover more cases per line."
```

```toon
equivalenceFields[3]{field,type,constraints,validation}:
  basis,string,names the derivation basis,required — machine-checked, not prose
  computedValue,number,>= the metric floor,required
  rationale,string,non-empty,required — accompanies but does not replace machine validation
```

**Acceptance (IC-001):** `bun scripts/metrics-snapshot.ts --metric ratio`
reports test:source LOC ratio ≥ 1.4, **OR** the snapshot contains this
schema-validated equivalence block — machine-validated either way.

## Indexes

```toon
indexes[1]{index,fields,type,purpose}:
  pk_metric,"gitRef, metric",PRIMARY,One value per metric per snapshot
```

## Cascade behavior

```toon
cascades[2]{parent,child,onDelete,onUpdate}:
  MetricsSnapshot,changelog metrics block,Changelog entry validation fails if snapshot deleted (METRICS_MISMATCH),Snapshot regeneration requires changelog re-validation
  ReleaseVersion,MetricsSnapshot,Snapshot retained (append-only history),—
```

## Error codes

```toon
errors[1]{code,exit,emittedBy,retryable}:
  METRICS_MISMATCH,1,metrics-snapshot.ts --check,No — regenerate
```

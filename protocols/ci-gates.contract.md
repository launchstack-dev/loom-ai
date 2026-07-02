# CI Gates Contract (C-01)

Enumerates the two CI tiers and their **stable check names**. These names are
the branch-protection interface: GitHub required-status-check rules reference
them verbatim, so renaming a check requires updating branch protection in the
same PR.

**Per the plan's Phase-0 judgment call, the check names are frozen HERE — not
in skeleton workflow YAML.** Phase 1 stands up `.github/workflows/pr-gate.yml`
and `.github/workflows/nightly-gate.yml`; those workflows MUST emit checks
whose names match the `checks.name` values below exactly.

Schema: `CiGateConfig` in `lib/types.ts`. Published per-run to
`.loom-ci/gate-status.toon`.

## Tier: pr (PR-blocking)

```toon
ciGateConfig:
  tier: pr
  workflow: pr-gate.yml
  blocking: true
  schedule:
  checks[6]{name,command,blocking,warnUntilPhase}:
    typecheck,tsc --noEmit -p hooks/tsconfig.json,true,
    lint,bunx eslint .,true,
    changed-file-tests,bun scripts/ci/changed-files-vitest.ts,true,
    hook-drift,bun scripts/ci/check-hook-drift.ts,false,13
    docs-drift,bun scripts/ci/check-docs-drift.ts --check,false,16
    library-catalog,bun scripts/ci/check-library-catalog.ts,true,
```

- `hook-drift` ships **`--warn-only` (non-blocking)** through Phase 12
  (`warnUntilPhase: 13`) because the three registration sources are
  known-divergent (defect 10). Phase 13 reconciles the sources and flips it to
  blocking.
- `docs-drift` ships non-blocking through Phase 15 (`warnUntilPhase: 16`);
  Phase 16 flips it to blocking once generated-docs markers exist everywhere.
- The remaining four checks are blocking from Phase 1.

## Tier: nightly (never PR-blocking)

```toon
ciGateConfig:
  tier: nightly
  workflow: nightly-gate.yml
  blocking: false
  schedule: 0 7 * * *
  checks[5]{name,command,blocking,warnUntilPhase}:
    full-suite,bunx vitest run,false,
    hook-drift,bun scripts/ci/check-hook-drift.ts,false,13
    docs-drift,bun scripts/ci/check-docs-drift.ts --check,false,16
    eval-t2,bun scripts/eval/run-evals.ts --tier t2,false,
    quarantine-suite,bunx vitest run tests/quarantine,false,
```

- Nightly is the backstop for what the changed-file PR tier misses (C-01): the
  full suite plus the hermetic T2 eval tier and the quarantine suite (run with
  `continue-on-error`). `nightly` tier is **never** a PR-blocking gate.
- `quarantine-suite` runs with `LOOM_QUARANTINE_INCLUDE=true`; entries must be
  zero before `fileParallelism:false` is removed (Phase 19).

## Stable check names (branch-protection interface)

The complete frozen set of required-check names. Branch protection references
these strings; treat them as an API.

```toon
requiredChecks[7]{name,tier,blockingFrom}:
  typecheck,pr,phase-1
  lint,pr,phase-1
  changed-file-tests,pr,phase-1
  library-catalog,pr,phase-1
  hook-drift,pr,phase-13
  docs-drift,pr,phase-16
  version-gate,pr,phase-10
```

- `version-gate` (`bun scripts/ci/version-gate.ts`) joins the PR tier at
  Phase 10 when the `v*` tag namespace is cleaned and milestone-boundary
  releases activate (C-04).
- A check rename is a **breaking change**: it MUST land together with the
  branch-protection update in the same PR (uq_check_name cascade).

## Indexes (reader-enforced)

```toon
indexes[2]{index,fields,type,purpose}:
  pk_gate,tier,PRIMARY,One config per tier
  uq_check_name,"tier, checks.name",UNIQUE,Stable required-check names for branch protection
```

## Cascade behavior

```toon
cascades[2]{parent,child,onDelete,onUpdate}:
  CiGateConfig,EvalTierResult,Orphan results retained (append-only history),Check rename requires branch-protection update in same PR
  CiGateConfig,.loom-ci/gate-status.toon,Regenerated every run (ephemeral),Regenerated
```

## Validation

```toon
validation[5]{field,rule,error}:
  tier,in {pr, nightly},VALIDATION_ERROR (unknown tier is a blocking parse error)
  workflow,filename exists under .github/workflows/,VALIDATION_ERROR
  blocking,nightly tier is never PR-blocking,VALIDATION_ERROR
  schedule,required iff tier=nightly (cron),VALIDATION_ERROR
  checks.name,unique within tier; warnUntilPhase empty or valid phase number,VALIDATION_ERROR
```

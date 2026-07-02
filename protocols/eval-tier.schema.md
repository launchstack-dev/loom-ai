# Eval Tier Schema (C-03)

Three-tier eval ladder. Artifact: `evals/results/{runId}.toon`. Schema type:
`EvalTierResult` in `lib/types.ts`. Runner: `bun scripts/eval/run-evals.ts`.

**Free-by-default invariant:** T1 and T2 make **zero** network/LLM calls
(`llmCalls` MUST be 0). Only T3 may call an LLM judge, and only when
`LOOM_EVAL_LLM` is set — otherwise T3 is `skipped`, exit 0, and never blocks.

## Tier lifecycle

```toon
tiers[3]{tier,when,cost,gating,fixtures,llm}:
  t1,PR gate,free,blocking,none (static/in-process),0 calls
  t2,nightly,free,advisory (nightly),replays evals/fixtures/ I/O,0 calls
  t3,opt-in behind LOOM_EVAL_LLM,paid,advisory-only (never merge-blocking),live prompts,LLM-judge calls
```

- **T1 — static / in-process.** Deterministic assertions; runs on every PR.
- **T2 — hermetic.** Replays fixtured LLM I/O from `evals/fixtures/`; any
  attempted live LLM call is `EVAL_TIER_CONTRACT_VIOLATION` (exit 1). Nightly.
- **T3 — opt-in LLM-judge.** Runs only when `LOOM_EVAL_LLM` is set. Compares a
  judged score against the `main`-branch floor (`floorRef`). Floor regression
  is `EVAL_FLOOR_REGRESSION` (warning, advisory); missing floor is
  `EVAL_FLOOR_MISSING` (warning). T3 NEVER exits non-zero on judged-score
  grounds.

## EvalTierResult artifact

```toon
evalTierResult:
  runId: 2026-07-01-t1-8f3a
  tier: t1
  gitRef: <sha>
  status: passed
  llmCalls: 0
  floorRef:                                   # main-floor comparison, t3 only
  results[N]{evalId,outcome,score,judgedScore}:
    grammar-roundtrip,passed,1.0,
    csv-escape-parity,passed,1.0,
```

```toon
fields[7]{field,type,constraints,validation}:
  runId,string,{date}-{tier}-{shortsha} unique,required (pk_run)
  tier,enum,t1 | t2 | t3,t3 gated on LOOM_EVAL_LLM (C-03)
  gitRef,string,commit sha,required
  status,enum,see state machine,t3 with flag unset => skipped exit 0
  llmCalls,integer,>=0,MUST be 0 for t1 and t2
  floorRef,string | null,main-branch runId,required for t3 pre-release runs
  judgedScore,number | null,0-10,t3 only
```

## State machine (EvalTierResult.status)

```toon
states[6]{state,description,entry,terminal}:
  pending,Run record created; tier resolved,default on creation by run-evals.ts,false
  running,Evals executing,tier preconditions met (t3: flag set),false
  skipped,t3 not attempted,LOOM_EVAL_LLM unset at dispatch,true
  passed,All evals in tier passed (t3: advisory score recorded),last eval green,true
  failed,>=1 t1/t2 eval failed,any eval failure,true
  error,Infra fault (missing fixture / runner crash),EVAL_FIXTURE_MISSING etc.,true
```

```toon
transitions[5]{from,to,trigger,sideEffects}:
  pending,running,run-evals.ts --tier tN dispatch,runId allocated
  pending,skipped,t3 dispatch with flag unset,result written with llmCalls:0 exit 0
  running,passed,all evals green,written atomically; t3 also writes floor delta
  running,failed,any t1/t2 eval red,exit 1; nightly gate reports failure
  running,error,fixture missing / runner exception,exit 1 with error code
```

```toon
invalidTransitions[3]{from,to,error,message}:
  skipped,running,EVAL_TIER_CONTRACT_VIOLATION,A skipped t3 run is terminal; start a new run
  failed,passed,EVAL_TIER_CONTRACT_VIOLATION,Results are immutable; re-run produces a new runId
  passed,*,EVAL_TIER_CONTRACT_VIOLATION,Terminal state
```

## Indexes

```toon
indexes[2]{index,fields,type,purpose}:
  pk_run,runId,PRIMARY,Run lookup
  idx_tier_ref,"tier, gitRef",COMPOUND,Floor comparison against main
```

## Cascade behavior

```toon
cascades[2]{parent,child,onDelete,onUpdate}:
  CiGateConfig,EvalTierResult,Results append-only; never pruned by gate config changes,—
  EvalTierResult (main floor),t3 comparison,Missing floor => EVAL_FLOOR_MISSING; t3 reports advisory-only,—
```

## Error codes

```toon
errors[4]{code,exit,tier,retryable}:
  EVAL_FIXTURE_MISSING,1,t2,No — record or restore the fixture
  EVAL_TIER_CONTRACT_VIOLATION,1,t1/t2/any,No — LLM call under t1/t2 or illegal transition
  EVAL_FLOOR_REGRESSION,0,t3,n/a — advisory; never merge-blocking (C-03)
  EVAL_FLOOR_MISSING,0,t3,n/a — advisory
```

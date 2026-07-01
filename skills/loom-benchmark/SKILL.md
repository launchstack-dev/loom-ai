---
name: loom-benchmark
description: "Perf regression via /loom-browser daemon — Core Web Vitals baseline/PR-diff with before/after trend line per PR."
---

# /loom-benchmark perf — Core Web Vitals Regression Gate (M-08 F-27)

Detects perf regressions on the current PR by measuring Core Web Vitals
(LCP, CLS, FID, INP) on both the base branch and the PR head, then reporting
the delta and a pass/fail verdict. Runs against the `/loom-browser` daemon
shipped in M-11 (Phase 7).

## Dependencies

- **`/loom-browser` daemon** — required. If the daemon is not running or is
  in a `crashed` state, `/loom-benchmark perf` exits `1` with an instruction
  to run `/loom-browser start` first.
- **Target URL** — pulled from `.loom/browser/state.toon` (`targetUrl`) or
  passed via `--url <url>`.

## Measurement flow

1. **Baseline** — check out the merge-base with `main` (via `git worktree add`
   into `.loom/perf-baseline/`), start a temporary browser session against
   the baseline build, and measure CWV via the daemon's `measure` RPC.
2. **PR head** — measure CWV against the current tree.
3. **Compare** — compute per-metric delta:

   ```
   deltaPct = ((prValue - baselineValue) / baselineValue) * 100
   ```

4. **Verdict** — any metric with `deltaPct > 10%` on a "lower is better"
   metric (LCP, CLS, FID, INP — all lower-is-better) marks the run as a
   regression.

## Metrics measured

| Metric | Unit | Direction | Regression threshold |
|---|---|---|---|
| LCP (Largest Contentful Paint) | ms | lower-is-better | +10% |
| CLS (Cumulative Layout Shift) | unitless | lower-is-better | +10% |
| FID (First Input Delay) | ms | lower-is-better | +10% |
| INP (Interaction to Next Paint) | ms | lower-is-better | +10% |

## Output

Emit to stdout and append to `.loom/perf-history.toon`:

```toon
runId: perf-2026-06-30-1745
timestamp: 2026-06-30T17:45:00Z
targetUrl: http://localhost:3000/
baselineRef: main@abc1234
prRef: exploregstack@def5678

metrics[N]{name,baseline,pr,deltaPct,regression}:
  LCP,1820,2010,10.4,true
  CLS,0.08,0.09,12.5,true
  FID,45,42,-6.7,false
  INP,180,175,-2.8,false

verdict: regression
regressedMetrics[2]: LCP, CLS
```

## History file

`.loom/perf-history.toon` is an append-only trend log:

```toon
runs[N]{runId,timestamp,prRef,LCP,CLS,FID,INP,verdict}:
  perf-2026-06-30-1745,2026-06-30T17:45:00Z,exploregstack@def5678,2010,0.09,42,175,regression
```

`/loom-status` reads this to render a per-PR trend line (before/after per
metric across the last N runs).

## CLI

```
/loom-benchmark perf [--url <url>] [--baseline-ref <git-ref>] [--regression-threshold <pct>]
```

Defaults: `--baseline-ref main`, `--regression-threshold 10`.

## Exit codes

- `0` — no regression detected.
- `1` — daemon unavailable or measurement failed.
- `2` — regression detected (fails PR gate when wired into `/loom-git pr`).

## Atomic writes

All writes to `.loom/perf-history.toon` go through `.tmp` + `fs.renameSync`.

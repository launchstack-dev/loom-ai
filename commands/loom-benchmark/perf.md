---
description: "Core Web Vitals perf regression via /loom-browser daemon — baseline/PR-diff per PR."
---

# /loom-benchmark:perf

Measures LCP, CLS, FID, and INP on both the base branch and the PR head via
the `/loom-browser` daemon, then reports the per-metric delta and a pass/
regression verdict.

Delegates to `skills/loom-benchmark/SKILL.md`.

## Dependencies

- `/loom-browser` daemon must be running. Run `/loom-browser start` first if
  it is not.

## Usage

```
/loom-benchmark perf [--url <url>] [--baseline-ref <git-ref>] [--regression-threshold <pct>]
```

Defaults: `--baseline-ref main`, `--regression-threshold 10`.

## Output

- Stdout: TOON report with `metrics[]` per CWV metric (baseline, pr,
  deltaPct, regression) and a `verdict` field.
- Append: `.loom/perf-history.toon`.

## Exit codes

- `0` — no regression.
- `1` — daemon unavailable or measurement failed.
- `2` — regression detected.

See `skills/loom-benchmark/SKILL.md` for the full schema.

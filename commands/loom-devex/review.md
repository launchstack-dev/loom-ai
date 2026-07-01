---
description: "Live TTHW boomerang — measures actual install-to-hello-world time in a fresh temp dir and reports delta vs plan-devex-review-agent's predictedTTHW."
---

# /loom-devex:review

Live DX audit. Re-runs the install flow end-to-end in `$(mktemp -d)`,
measures wall time, scores CLI help / error messages / config surface, and
emits a boomerang comparison against the latest
`planning/history/reviews/*-plan-devex-review.toon`.

## Usage

```
/loom-devex:review [--install-cmd "<cmd>"] [--hello-target "<cmd>"]
```

Both flags are optional; the skill auto-detects from README when omitted.

## Output envelope

```
predictedTTHW: <minutes>
measuredTTHW: <minutes>
delta: <signed minutes>
verdict: on-budget | over-budget | under-budget
cliHelpQuality: 1-10
errorMessageQuality: 1-10
configSurfaceComplexity: 1-10
overallDxScore: 1-10
findings[N]{lens,severity,confidence,description,suggestedFix}:
```

Every finding and every quality score carries `confidence: 1-10`.

## Boomerang archive

Every run is archived to
`planning/history/reviews/{date}-devex-audit.toon`. The next planning-time
review reads the latest audit to adjust its next `predictedTTHW`.

## See also

- `skills/loom-devex-review/SKILL.md` — full step-by-step spec.
- `agents/plan-devex-review-agent.md` — source of `predictedTTHW`.
- `skills/loom-browser/SKILL.md` — optional screenshot capture.

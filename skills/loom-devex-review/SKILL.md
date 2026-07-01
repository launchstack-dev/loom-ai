---
name: loom-devex-review
description: "Live DX audit — measures actual TTHW (time-to-hello-world) and compares against plan-devex-review-agent's predictedTTHW from Phase 4. Boomerang: 'plan said 3 min, reality says 8'."
---

# /loom-devex:review — Live TTHW Boomerang (M-07 F-21)

`/loom-devex:review` closes the loop between the planning-time DX prediction
(from `agents/plan-devex-review-agent.md`, shipped by Phase 4 F-12) and the
lived install experience. It re-runs the install-and-hello-world flow in a
fresh temp directory, measures wall time, and reports a delta the plan
reviewer can be graded on next cycle.

## Inputs

- **Latest plan-time DX review** — read from
  `planning/history/reviews/*-plan-devex-review.toon` (globbed by mtime; the
  newest wins). The reviewer emits a `predictedTTHW` field in minutes.
- **Install command** — provided via `--install-cmd` or auto-detected:
  1. `curl <URL> | sh` line from README's "Install" or "Quick Start" section.
  2. `git clone <repo> && cd <dir> && <bootstrap>` block.
- **Hello-world target** — provided via `--hello-target` or auto-detected as
  the first `$ <cmd>` block under a "Hello world" / "First run" / "Quick
  Start" README section.

## Steps

1. Create fresh temp dir `$(mktemp -d)`.
2. Start wall-clock timer.
3. Execute the install command; stream stdout+stderr to
   `.loom/devex/last-run.log`.
4. Execute the hello-world command; stop the timer at first successful
   output OR on non-zero exit.
5. `measuredTTHW = elapsed_minutes` (float, 2 decimals).
6. Score three DX qualities (1-10 each, `confidence: 1-10` on each score):
   - **cliHelpQuality** — does `<cmd> --help` exist, list every flag with a
     one-line description, and mention at least one common workflow?
   - **errorMessageQuality** — inject three synthetic errors (missing arg,
     invalid flag, missing dep); score based on whether each error message
     names the offending input, suggests a fix, and points at docs.
   - **configSurfaceComplexity** — count required env vars + required config
     files a user must set before hello-world succeeds; score inversely (0
     required = 10, 5+ required = 3).
7. Screenshot any browser-facing errors via `/loom-browser` if the flow
   opens a URL. Screenshots land in `.loom/devex/screenshots/`. If the
   daemon is not running, skip screenshots and add an info finding.

## Boomerang comparison

```
predictedTTHW: 3.0
measuredTTHW: 8.4
delta: +5.4
deltaPercent: +180%
verdict: over-budget
```

`verdict` is one of `on-budget` (|delta| <= 25%), `over-budget` (measured >
predicted by more than 25%), or `under-budget` (measured < predicted by more
than 25%). An `over-budget` verdict emits an info finding suggesting a
planning-review adjustment.

## Output envelope

```
predictedTTHW: 3.0
measuredTTHW: 8.4
delta: +5.4
verdict: over-budget
cliHelpQuality: 6
errorMessageQuality: 4
configSurfaceComplexity: 7
overallDxScore: 6
findings[N]{lens,severity,confidence,description,suggestedFix}:
  errorMessages,medium,8,"'invalid flag: --foo' does not suggest --bar",Add did-you-mean suggestion
```

Every finding and every quality score carries `confidence: 1-10`.

## Feedback into the planning loop

The envelope is archived to
`planning/history/reviews/{date}-devex-audit.toon`. The next run of
`agents/plan-devex-review-agent.md` reads the latest audit and adjusts its
next `predictedTTHW` — this is the boomerang.

## Non-goals

- Not a full-blown user-study replacement. TTHW is one signal.
- Does not modify the install script. Findings are advisory.

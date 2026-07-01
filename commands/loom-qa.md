---
description: "Live-site iterative test-fix loop over the /loom-browser daemon. --tier quick|standard|exhaustive."
---

# /loom-qa

Live-site QA loop. Drives the target URL through the persistent Chromium
daemon (`/loom-browser`), identifies bugs, iterates fixes with atomic
commits, and re-verifies until stable or the tier budget is exhausted.

## Usage

```
/loom-qa --tier <quick|standard|exhaustive> <url>
```

`--tier` defaults to `standard` when omitted.

## Tiers

| Tier         | Budget  | Scope |
|--------------|---------|-------|
| `quick`      | ~5 min  | Happy-path only |
| `standard`   | ~15 min | Happy-path + top 5 empty/error/loading states |
| `exhaustive` | ~45 min | Full a11y + edge cases + screenshot regression |

## Daemon precondition

`/loom-qa` reads `.loom/browser/state.toon` before starting:

- Missing / stopped / crashed → prints instructive stderr, exits non-zero:

  ```
  /loom-qa requires the /loom-browser daemon.
  Run: /loom-browser start
  Then re-run: /loom-qa --tier <tier> <url>
  ```

- Running → proceed into the loop.

## Output

Emits an envelope with `beforeScore`, `afterScore`, `shipReadiness`
(`ready` | `not-ready`), `loopIterations`, `bugsFound`, `bugsFixed`,
`bugsUnresolved`, and a `findings[]` table where every row carries
`confidence: 1-10`.

## See also

- `skills/loom-qa/SKILL.md` — full loop spec, fixer-agent selection.
- `skills/loom-browser/SKILL.md` — daemon this command depends on.
- `commands/loom-health.md` — before/after health scores.

---
name: loom-canary
description: "Progressive deploy with health-check gates + rollback. Wraps existing deploy tools (fly/vercel/etc)."
---

# /loom-canary — Progressive Deploy with Health Gates (M-10 F-31)

`/loom-canary` runs a phased rollout of the current commit through the
project's already-configured deploy target. It does not replace the native
deploy CLI — it wraps it, gating each phase on a health-check probe and
rolling back on any failure.

## Reads deploy config from CLAUDE.md

The config block is populated by `/loom-setup:deploy` (M-10 F-32). It
conforms to `protocols/loom-ship-config.schema.toon`. `/loom-canary` looks
for a fenced block introduced by a heading titled `## Deploy Configuration`
in CLAUDE.md, parses the TOON fields, and refuses to run when:

- CLAUDE.md is missing that block (halt with `CANARY_NO_CONFIG`,
  confidence: 10, severity: blocker) — instruct the user to run
  `/loom-setup:deploy`.
- `healthCheckUrl` is empty (halt with `CANARY_NO_HEALTHCHECK`,
  confidence: 10, severity: blocker).

## Phased rollout

Three phases, gated by a health probe between each:

| Phase | Traffic share | Gate |
|---|---|---|
| 1 | 10 % | health-check MUST return HTTP 2xx three times in a row over 30 s |
| 2 | 50 % | health-check MUST return 2xx five times over 60 s AND error-rate delta (if the target exposes it) < 1 % |
| 3 | 100 % | health-check MUST return 2xx ten times over 120 s |

Traffic shifting is delegated to the target-native mechanism (Fly regions,
Vercel aliases, Cloudflare Workers versioned deployments, Netlify deploy
previews, Railway environments, Render preview deploys). When the target
does not support traffic-splitting natively, `/loom-canary` falls back to a
single-phase deploy and emits a `CANARY_NO_SPLIT` finding (confidence: 8,
severity: warn) — the health probe still gates promotion.

## Rollback trigger

**Any health-check failure** — a non-2xx response, a timeout, or an
error-rate delta above the phase threshold — triggers immediate rollback:

1. Invoke the target-native rollback command (e.g., `fly releases rollback`,
   `vercel rollback`, `wrangler rollback`).
2. Append a `run` row to `.loom/canary-history.toon` with
   `rolledBack: true` and `phasesCompleted` set to the last passed phase.
3. Emit a `CANARY_ROLLED_BACK` finding (confidence: 10, severity: blocker)
   with the failed health-check payload attached.
4. Exit non-zero. The user MUST triage before re-running.

The rollback path is the primary correctness property of this skill — any
change to phases, thresholds, or targets MUST preserve "one gate failure ⇒
rollback executed ⇒ history row records `rolledBack: true`".

## History

Every run appends to `.loom/canary-history.toon`:

- `canaryId` — deterministic short id based on git SHA + timestamp.
- `target` — one of `fly`, `vercel`, `render`, `cloudflare`, `netlify`,
  `railway`, `other`.
- `version` — the semver from the version manifest at run time.
- `startedAt` / `finishedAt` — ISO 8601 timestamps.
- `phasesCompleted` — 0..3.
- `rolledBack` — bool.
- `healthCheckUrl` — the probe URL used.
- `notes` — one-line summary (e.g., "healthy through phase 3").

The file is append-only. `/loom-landing-report` reads it to render the
cross-workspace deploy summary.

## Non-goals

- Does **not** provision infrastructure. If the target is not already
  configured (no fly.toml, no vercel project link, etc.), `/loom-canary`
  fails with `CANARY_TARGET_UNCONFIGURED` (confidence: 10, severity:
  blocker) and points the user at the target's own bootstrap docs.
- Does **not** modify the native deploy config files themselves. All
  configuration is read-only per C-06.
- Does **not** wait indefinitely — each phase has a hard 5-minute wall clock
  after which `/loom-canary` treats a stalled probe as a failure and rolls
  back.

## Contracts

- `protocols/loom-ship-config.schema.toon` — deploy config format.
- `.loom/canary-history.toon` — run history.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-canary.md` — dispatcher.
- `skills/loom-setup-deploy/SKILL.md` — writes the config block
  `/loom-canary` reads.
- `skills/loom-landing-report/SKILL.md` — cross-workspace dashboard.

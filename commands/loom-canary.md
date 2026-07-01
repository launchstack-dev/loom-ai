---
description: "Progressive deploy with health-check gates and automatic rollback. Reads deploy config from CLAUDE.md; wraps target-native deploy CLI (fly/vercel/wrangler/netlify/railway/render)."
---

# /loom-canary

Phased rollout of the current commit through the project's already-configured
deploy target. Three phases (10 % → 50 % → 100 %) gated by a health probe;
any gate failure triggers immediate rollback.

## Prerequisites

- CLAUDE.md contains a `## Deploy Configuration` block populated by
  `/loom-setup:deploy`. Halt with `CANARY_NO_CONFIG` when missing.
- `healthCheckUrl` is populated in that block. Halt with
  `CANARY_NO_HEALTHCHECK` when empty.
- Target-native deploy CLI is installed and authenticated
  (`fly`, `vercel`, `wrangler`, `netlify`, `railway`, `render`).

## Handler

| Skill | Purpose |
|---|---|
| `skills/loom-canary/SKILL.md` | Phased rollout, health gates, rollback trigger, history append. |

## Contracts

- `protocols/loom-ship-config.schema.toon` — deploy config input.
- `.loom/canary-history.toon` — append-only run history.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-ship.md` — pre-merge pipeline.
- `commands/loom-setup/deploy.md` — writes the config block.
- `commands/loom-landing-report.md` — cross-workspace deploy summary.

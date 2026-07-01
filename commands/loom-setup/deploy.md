---
description: "Detect deploy target from repo signals (Fly/Vercel/Cloudflare/Netlify/Railway/Render/Docker) and append the config block to CLAUDE.md so /loom-ship and /loom-canary auto-work. Read-only w.r.t. native deploy config files (C-06)."
---

# /loom-setup:deploy

One-time setup subcommand that inspects the repo, picks a deploy target from
signal files (in priority order: `fly.toml` → `vercel.json`/`.vercel/` →
`wrangler.toml`/`wrangler.jsonc` → `netlify.toml`/`.netlify/` →
`railway.json` → `render.yaml` → bare `Dockerfile`), derives the canonical
`deployCommand`, and appends a `## Deploy Configuration` block to CLAUDE.md.

`/loom-ship` and `/loom-canary` read that block; without it they refuse to
run.

## Read-only guarantee (C-06)

This subcommand MUST NOT create, modify, or delete any native deploy config
file. The only write target is CLAUDE.md, and only within the `## Deploy
Configuration` block. The skill file documents the enforcement contract.

## Handler

| Skill | Purpose |
|---|---|
| `skills/loom-setup-deploy/SKILL.md` | Signal detection matrix, derived-field rules, CLAUDE.md write path. |

## Contracts

- `protocols/loom-ship-config.schema.toon` — output block schema.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-setup.md` — parent dispatcher.
- `commands/loom-ship.md` — reads the block for the PR footer.
- `commands/loom-canary.md` — reads the block to drive phased deploy.

---
name: loom-setup-deploy
description: "Detect Fly/Vercel/Render/Cloudflare/Netlify/Railway deploy target from repo signals; write config to CLAUDE.md so /loom-ship and /loom-canary auto-work."
---

# /loom-setup:deploy — Deploy Target Detection (M-10 F-32)

`/loom-setup:deploy` inspects the repo for deploy-target signals, picks the
first match, and appends a `## Deploy Configuration` block to CLAUDE.md so
`/loom-ship` and `/loom-canary` can wire themselves without extra flags.

The detection is deliberately conservative and **read-only** with respect to
the native deploy config files. Per C-06, we never write to fly.toml,
vercel.json, wrangler.toml, netlify.toml, railway.json, or render.yaml.

## Signal detection matrix

Checked in order — first hit wins:

| Signal file(s) present | Detected target | configPath |
|---|---|---|
| `fly.toml` | `fly` | `fly.toml` |
| `vercel.json` OR `.vercel/` | `vercel` | `vercel.json` or `.vercel/project.json` |
| `wrangler.toml` OR `wrangler.jsonc` | `cloudflare` | first of the two |
| `netlify.toml` OR `.netlify/` | `netlify` | `netlify.toml` or `.netlify/state.json` |
| `railway.json` | `railway` | `railway.json` |
| `render.yaml` | `render` | `render.yaml` |
| `Dockerfile` alone (none of the above) | `other` (generic Docker) | `Dockerfile` |
| No signal | halt with `DEPLOY_TARGET_UNKNOWN` | — |

## Derived fields

Once a target is chosen:

- `deployCommand` — canonical CLI invocation:
  | Target | Command |
  |---|---|
  | fly | `fly deploy` |
  | vercel | `vercel --prod` |
  | cloudflare | `wrangler deploy` |
  | netlify | `netlify deploy --prod` |
  | railway | `railway up` |
  | render | `render deploy` (via `render` CLI) |
  | other | `docker build -t app . && docker push app` |
- `healthCheckUrl` — best-effort extraction from the native config
  (`fly.toml [[http_service]] internal_port`, `vercel.json rewrites`, etc.).
  Leave empty if not statically derivable.
- `envVarKeys` — comma-separated names of env vars referenced by the native
  config (again, read-only introspection). Empty when none found.

## Write path

Appended (never clobbered) as a fenced TOON block under a `## Deploy
Configuration` heading in CLAUDE.md:

```markdown
## Deploy Configuration

<!-- Managed by /loom-setup:deploy — do not hand-edit; re-run the command to refresh. -->

```toon
schemaVersion: 1
target: vercel
configPath: vercel.json
deployCommand: "vercel --prod"
healthCheckUrl: ""
envVarKeys: ""
detectedAt: 2026-06-30T00:00:00Z
```
```

If a `## Deploy Configuration` heading already exists, the block between
that heading and the next `## ` heading (or EOF) is replaced. The rest of
CLAUDE.md is untouched.

The block conforms to `LoomShipConfig` from
`protocols/loom-ship-config.schema.toon` (Phase 0).

## Read-only guarantee (C-06)

We assert this explicitly:

- `fly.toml`, `vercel.json`, `wrangler.toml`, `wrangler.jsonc`,
  `netlify.toml`, `railway.json`, `render.yaml`, and `Dockerfile` MUST NOT
  be created, modified, or deleted by this skill.
- The only write target is CLAUDE.md, and only within the `## Deploy
  Configuration` block.
- A `DEPLOY_READONLY_VIOLATION` finding (confidence: 10, severity: blocker)
  MUST be emitted if any code path in this skill attempts such a write.

## Non-goals

- Does **not** provision or authenticate against the deploy target.
- Does **not** run the detected `deployCommand` — that's `/loom-canary`.
- Does **not** infer secret values. `envVarKeys` lists names only.

## Contracts

- `protocols/loom-ship-config.schema.toon` — output block schema.
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-setup/deploy.md` — subcommand entry.
- `skills/loom-ship/SKILL.md` — reads the block for the PR footer.
- `skills/loom-canary/SKILL.md` — reads the block to drive deploy.

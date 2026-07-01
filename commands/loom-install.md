---
description: Direct-symlink install path for Loom — alternative to plugin marketplace, cross-host aware
---

# /loom-install

Wraps `bin/loom-install`. Symlink a local Loom checkout into a host's skill
directory as an alternative to the plugin marketplace channel. Supports
`claude-code` (default), `hermes`, `openclaw`, and `codex`.

## Actions

| Flag | Effect |
|---|---|
| `--link` | Create the symlink and write `~/.loom/install-manifest.toon`. Idempotent. |
| `--unlink` | Remove the symlink for the given host and update the manifest. |
| `--check` | Print current status without modifying anything. Default when no action given. |

## Options

| Flag | Values | Default |
|---|---|---|
| `--host <host>` | `claude-code`, `hermes`, `openclaw`, `codex` | `claude-code` |

## Examples

```bash
bin/loom-install --link
bin/loom-install --link --host codex
bin/loom-install --check --host hermes
bin/loom-install --unlink --host openclaw
```

## What it writes

`~/.loom/install-manifest.toon` — matches `protocols/install-manifest.schema.toon`.
Written atomically. Records `installMode`, `sourcePath`, `loomVersion`, and one
`hostBindings[]` row per host.

## Upgrade path

`git pull` in the checkout — the symlink means the host sees changes immediately.
Re-run `--link` only when adding a new host binding or moving the checkout.

## Related

- Skill: `skills/loom-install/SKILL.md` — full flow docs.
- Schema: `protocols/install-manifest.schema.toon`.
- Rationale: `planning/ROADMAP-plugin-distribution.md` §"2026-06-30: Direct-symlink pivot".
- Plugin channel: `planning/notes/plugin-marketplace-rationale.md`.

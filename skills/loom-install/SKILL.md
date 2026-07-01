---
name: loom-install
description: "Direct-symlink install path for Loom. Alternative to plugin marketplace. Supports cross-host (claude-code, hermes, openclaw, codex)."
---

# loom-install — direct-symlink distribution

Loom ships through two parallel channels. Both are supported; neither deprecates
the other (roadmap C-07).

| Channel | Command | Best for |
|---|---|---|
| Plugin marketplace | Anthropic plugin flow | End users on stable releases |
| Direct symlink | `bin/loom-install` | Power users, contributors, cross-host bridges |

The direct-symlink path is the shortest possible loop between a `git pull` on
the Loom source tree and the resources being live inside a host's skill
directory — no tarball, no version pin, no cache to invalidate.

## When to use this skill

Load `loom-install` when:

- Setting up Loom on a new machine from a local checkout.
- Wiring Loom into a non-Anthropic host (Hermes, OpenClaw, Codex).
- Upgrading via `git pull` and needing to know whether a re-link is required.
- Uninstalling the direct install (removing symlinks and manifest).
- Debugging "why isn't my Loom skill visible to Claude Code" issues.

## Install

```bash
# Default: claude-code host
bin/loom-install --link

# Explicit host
bin/loom-install --link --host hermes
bin/loom-install --link --host openclaw
bin/loom-install --link --host codex
```

`--link` is **idempotent**. Re-running is safe; the symlink is verified and
`~/.loom/install-manifest.toon` is refreshed. If the target path exists as a
non-symlink (e.g., a previous plugin install), the script refuses to overwrite
it — move it aside manually.

The install manifest conforms to `protocols/install-manifest.schema.toon` and is
written atomically (write to `.tmp`, then rename) per project conventions.

## Upgrade

Because the host's skill directory is a symlink into the checkout, upgrades are
just:

```bash
cd /path/to/loom-ai
git pull
```

Every new skill, agent, protocol, or hook is immediately visible to the host.
No re-install step is required. Re-run `bin/loom-install --link` only if you
change hosts or move the checkout.

## Cross-host binding

Symlink one Loom checkout into multiple hosts in parallel:

```bash
bin/loom-install --link --host claude-code
bin/loom-install --link --host hermes
bin/loom-install --link --host codex
```

Each `--link` invocation appends a `hostBindings[]` row to the manifest so
`--unlink` can reverse them cleanly one at a time.

## Status

```bash
bin/loom-install --check           # claude-code (default)
bin/loom-install --check --host codex
```

Prints:

- Host and target path.
- Whether the target is linked, occupied by a non-symlink, or missing.
- The install manifest summary (mode, source, version, bound hosts).

## Uninstall

```bash
bin/loom-install --unlink                 # removes claude-code binding
bin/loom-install --unlink --host hermes   # removes hermes binding
```

`--unlink` reads the install manifest, removes the symlink for the specified
host, drops that entry from `hostBindings[]`, and rewrites the manifest
atomically. When the last binding is removed, the manifest file is deleted.

On a corrupt or missing manifest, `--unlink` raises `INSTALL_MANIFEST_INVALID`
(blocking) with a non-zero exit — matching the error catalog in
`planning/plans/PLAN-gstack-adoption.md`.

## Relationship to the plugin channel

The plugin marketplace remains the canonical distribution channel for end
users. Direct-symlink install is a complementary channel for contributors and
power users. See `planning/ROADMAP-plugin-distribution.md` for the pivot note.

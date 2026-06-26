# Install Decision Matrix

Loom ships two install paths that produce equivalent functionality but differ in distribution, update flow, and the directory layout your hooks anchor against. Use this matrix to pick the right path for your environment.

> **TL;DR** — Default to the **plugin path** (`/plugin marketplace add launchstack-dev/loom-ai`). Reach for the **curl path** when you need pinned versions, air-gapped operation, MDM-blocked plugin installs, or heavy local customization of kits/hooks.

## Decision tree

```
Start
  │
  ├─ Are you on a managed (MDM/enterprise) workstation
  │  where `/plugin install` is blocked or audited?
  │      yes ──► curl path (offline tarball or vendored fork)
  │      no  ──► continue
  │
  ├─ Air-gapped or no outbound network to Anthropic plugin registry?
  │      yes ──► curl path (vendor the tarball, install from local file)
  │      no  ──► continue
  │
  ├─ Heavy local customization — forking agents, editing hooks,
  │  authoring private kits that live alongside Loom's source?
  │      yes ──► curl path (or local-dev clone) for direct file editing
  │      no  ──► continue
  │
  ├─ Need a pinned, reproducible version across a team / CI?
  │      yes ──► curl path pinned to `v0.0.1` tag
  │      no  ──► continue
  │
  └─ Default ──► plugin path (`/plugin marketplace add launchstack-dev/loom-ai`)
```

## Scenario matrix

| Scenario | Recommended path | Reason | Fallback |
|---|---|---|---|
| **Default — single dev, latest stable** | Plugin | One-command install, registry-managed updates, `${CLAUDE_PLUGIN_ROOT}` keeps your `~/.claude/` clean | Curl pinned to a tag if the plugin registry is slow or down |
| **MDM-blocked plugin install** | Curl | `/plugin install` requires registry access; curl pulls files directly from GitHub raw or a vendored tarball | Vendored tarball served from internal artifact store |
| **Air-gapped network** | Curl | No outbound Anthropic registry; install from a local tarball + checksums.sha256 | Local-dev clone of the repo on a USB / internal mirror |
| **Customization-heavy kit work** (editing agents, hooks, library.yaml) | Curl (or local-dev clone) | Plugin path stages files under `${CLAUDE_PLUGIN_ROOT}` which is registry-owned and overwritten on update; curl writes regular files you can edit and version | Local-dev clone + `/loom-library sync` symlink reconciliation |
| **Enterprise pinned version** (team / CI parity) | Curl | Curl one-liner accepts an explicit ref (`/launchstack-dev/loom-ai/v0.0.1/install.sh`); plugin updates lag behind tags | Plugin with team policy locking the marketplace version (when registry pinning ships) |
| **Single-machine quick try** | Plugin | Lowest-friction "see what Loom does" path — two slash commands and you're at `/loom-init` | Curl one-liner if you don't have plugin support enabled in Claude Code |
| **Contributor / fork maintainer** | Curl (local-dev clone) | `git clone` + symlinked `~/.claude/` lets your edits show up live; `/loom-library sync` reconciles | Curl tarball when you only want to consume, not edit |

## Path summary

| Concern | Plugin path | Curl path |
|---|---|---|
| Install command | `/plugin marketplace add launchstack-dev/loom-ai` then `/plugin install loom` | `curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/v0.0.1/install.sh \| bash` |
| Anchor variable | `${CLAUDE_PLUGIN_ROOT}` | `${CLAUDE_PROJECT_DIR}` |
| Files land in | Registry-managed plugin root | `~/.claude/` (regular files) |
| Update flow | `/plugin update loom` | `/loom-update` (channel-aware, atomic, `--check` / `--pin` / `--resume` / `--rollback`). Re-running the install one-liner also works and now preserves user-added rows on re-run. `/loom-library sync` is for **kit content only** and refuses to touch system files. |
| Customization | Limited (registry-owned) | Full (regular files; edit freely) |
| Version pinning | Registry-version-dependent | Pin to any tag in the one-liner URL |
| Air-gap-friendly | No | Yes (vendor tarball) |
| Default for new users | Yes | No |

## Cross-references

- README §3 — **Quickstart — Plugin path**
- README §4 — **Quickstart — Curl path**
- README §5 — **Decision matrix** (this document, summarized)
- `marketplace/listing.md` — Anthropic marketplace listing (links here for the full tree)
- `planning/notes/plugin-marketplace-rationale.md` — kit-author guide for authoring against both anchors

## When in doubt

If you're a new user evaluating Loom: **plugin path**. If you're a team standardizing tooling across CI and dev machines, or you need to edit Loom's internals: **curl path**. Both produce the same agents, slash commands, and pipeline — only the file layout and update channel differ.

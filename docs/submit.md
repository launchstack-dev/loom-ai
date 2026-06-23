# Submitting Loom to the Claude Code Plugin Directory

This is the runbook for shipping a Loom release to end users. Read top to bottom before tagging a release; the order matters.

## TL;DR

1. Run `claude plugin validate $(pwd)` locally — must exit 0.
2. Smoke-test the plugin via `claude --plugin-dir $(pwd)` — Claude Code should start without complaining.
3. Tag and push (`git tag v0.x.y && git push --tags`). The `release` workflow generates the CHANGELOG and creates a GitHub Release with the auto-attached source archive.
4. Open the submission form at **https://platform.claude.com/plugins/submit** (Console, individual authors) — paste the body of `marketplace/listing.md`.
5. After approval, users discover Loom via `/plugin marketplace add anthropics/claude-plugins-community` then `/plugin install loom@claude-community`. Auto-bump is handled by Anthropic's nightly sync — push commits to `main`, the sync re-pins.

The self-hosted install (`/plugin marketplace add launchstack-dev/loom-ai`) works **today**, before any submission. That's the C-01 escape hatch — users don't have to wait for the community catalog.

## Local pre-flight

```sh
claude plugin validate "$(pwd)"
```

Must exit 0. This is the F-16 submission gate. If it fails, fix what it flags before going further; the most likely categories are:

- Missing or malformed `.claude-plugin/plugin.json` (required field `name`, wrong types)
- `hooks/hooks.json` syntax errors
- Plugin-relative paths in hook commands that don't actually exist at the resolved `${CLAUDE_PLUGIN_ROOT}`

## Local distribution sanity

```sh
claude --plugin-dir "$(pwd)"
```

Boots Claude Code against the repo as a local plugin. If hooks register without errors and `/loom-init --help` prints usage, the submission is sane.

## Submission URLs

| Author type | URL |
|---|---|
| Individual / OSS authors | https://platform.claude.com/plugins/submit |
| Team / Enterprise admins | https://claude.ai/admin-settings/directory/submissions/plugins/new |

The Console form (first URL) is the standard path. Paste the rendered body of `marketplace/listing.md` into the description field. Keep the C-14 differentiation claim ("Not a slash-command bundle or planning helper — an opinionated workflow loop") and the support-expectation language ("Community-supported. GitHub issues only. No SLA.") verbatim — they're the C-14 / C-20 gates.

The install instructions in `marketplace/listing.md` already include both the self-hosted and the post-approval community paths. No edits needed on submission day.

## Post-approval discovery

```sh
# In Claude Code:
/plugin marketplace add anthropics/claude-plugins-community
/plugin install loom@claude-community
```

After the listing lands, Anthropic's nightly sync re-pins the marketplace entry to the latest `loom--v{version}` tag. Push to `main`, tag a release, the sync picks it up.

Optional helper for tag creation: `claude plugin tag` produces the canonical `loom--v{version}` tag the pinner consumes. If your CI runner has `claude` on PATH, you can wire this into `release.yml` as a follow-up step; otherwise run it locally before pushing tags.

## Self-hosted install (works today)

For users who don't want to wait for community-catalog approval or who run on a private fork:

```sh
# In Claude Code:
/plugin marketplace add launchstack-dev/loom-ai
/plugin install loom
```

This bypasses the community catalog entirely. Updates require the user to re-run `/plugin install loom` after pulling. Loom's `/loom-doctor` reports this channel as `plugin` (same as community-marketplace installs).

## Curl install (legacy, still supported)

```sh
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | sh
```

The legacy path. `/loom-init` detects this as the `curl` channel and writes `.claude/settings.json` directly (no plugin loader). Kept for users with security policies that disable the plugin loader and for terminal-only workflows. Sunset criterion is tracked via opt-in telemetry recorded in `~/.loom/install.toon`.

## What this repo does NOT ship

These were assumptions in the v4 plan that don't reflect the real Claude Code plugin spec — they have been **removed** from the release pipeline:

- Hand-built release tarball (replaced by GitHub Releases' auto-archive)
- `sha256` / manifest-drift CI gate (the real `plugin.json` has no sha256 field)
- Sigstore attestation (Claude Code's plugin loader doesn't consume it)
- Marketplace PR via GitHub Action (submission is via the Console form)

If you see references to these in older docs or in `planning/history/`, treat them as superseded by Phase 18 F-16.

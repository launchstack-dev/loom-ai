---
schemaVersion: 2
name: plugin-manifest
description: Loom-side snapshot of Anthropic's `.claude-plugin/plugin.json` manifest shape, with Loom-specific field constraints.
---

# Plugin Manifest Schema

Mirrors the upstream Anthropic `.claude-plugin/plugin.json` shape. Loom ships this file at the root of the plugin tarball so that `/plugin install loom` can register agents, skills, commands, hooks, and MCP servers without touching `~/.claude/settings.json`.

> **Note:** The upstream schema is owned by Anthropic and documented at <https://code.claude.com/docs/en/plugins-reference>. This file is a **Loom-side snapshot** used for static validation in `test/plugin-manifest.test.ts` and as the contract for `wave-1-manifest-agent`. The JSON Schema mirror lives at `agents/protocols/upstream/plugin.schema.json` and is refreshed by `scripts/refresh-upstream-schemas.sh` (CI workflow). On upstream drift, this file and `hook-manifest.schema.md` are the only artifacts that need updating.

## Auto-discovery contract

Claude Code auto-discovers resources from convention paths at the plugin root:

| Resource | Convention path | Manifest field |
|---|---|---|
| agents | `agents/**/*.md` | **MUST NOT** be declared. Explicit `agents` causes upstream validator error `agents: Invalid input`. |
| commands | `commands/**/*.md` | **MUST NOT** be declared. |
| skills | `skills/<name>/SKILL.md` | **MUST NOT** be declared. |
| hooks | `hooks/hooks.json` | **MUST NOT** be declared. Explicit `hooks` causes plugin-load failure `Duplicate hooks file detected`. |
| MCP servers | `.mcp.json` | **MUST NOT** be declared. |

Declaring any of these fields in `plugin.json` either fails validation or causes a duplicate-load failure at install time. The plugin install sandbox (`scripts/test-plugin-install-sandbox.sh`) detects both cases.

## TOON Exemplar

```toon
PluginManifest:
  name: loom
  version: 0.1.0
  description: "Loom — meta-orchestration for Claude Code"
  keywords[5]: meta-orchestration, claude-code, planning, agents, hooks
  license: Apache-2.0
  author:
    name: LaunchStack
    url: https://github.com/launchstack-dev/loom-ai
  repository: https://github.com/launchstack-dev/loom-ai
  permissions[4]: hooks:SessionStart, hooks:PreToolUse, hooks:PostToolUse, hooks:Stop
```

## Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| name | yes | string | Plugin identifier. Must be `loom` for the canonical Loom distribution. |
| version | yes | semver | Plugin version. MUST match `package.json#version`. |
| description | yes | string | Short marketplace summary. |
| keywords[] | recommended | string[] | Marketplace search terms. Recommended: `meta-orchestration`, `claude-code`, `planning`, `agents`, `hooks`. |
| license | recommended | string | SPDX identifier (e.g., `MIT`, `Apache-2.0`). |
| author | yes | object | `{name, url?}`. GitHub org or user owning the plugin. |
| repository | yes | url | HTTPS clone URL. |
| permissions[] | yes (Loom extension) | string[] | **Loom-internal extension — not a Claude Code field.** Required by `test/plugin-manifest.test.ts` and read by `scripts/lib/doctor/checks/permissions-derived.ts`. Computed as the union of hook event names + tool-name matchers across `hooks/hooks.json`. The upstream validator emits `permissions: Unknown field` (advisory only); the plugin still installs and loads cleanly. Tracked for migration to a Loom-side artifact (`.claude-plugin/loom-extensions.toon` or similar) when upstream ships a real `permissions` field with potentially-conflicting semantics. |

### Removed fields

The earlier shape declared `agents`, `commands`, `skills`, `hooks`, `entrypoints` and `requires.claudeCode`. These are now either auto-discovered (see above) or never reached implementation. They are kept in source control history (#16) but **MUST NOT** reappear in any plugin.json — explicit declarations break install.

## Consumer Cross-Reference

```toon
consumers[2]{component,usage}:
  test/plugin-manifest.test.ts,asserts-required-fields-and-permissions-shape
  scripts/lib/doctor/checks/permissions-derived.ts,reads-permissions-for-DOCTOR_PERMISSIONS_MISMATCH-check
```

## Cross-References

- `hook-manifest.schema.md` — `permissions[]` derivation source.
- `upstream/plugin.schema.json` — Anthropic-owned JSON Schema snapshot (stale; refresh via `scripts/refresh-upstream-schemas.sh`).
- `doctor-report.schema.md` — `DOCTOR_PERMISSIONS_MISMATCH` and `MANIFEST_INVALID` cite this contract.

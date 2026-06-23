---
schemaVersion: 1
name: plugin-manifest
description: Loom-side snapshot of Anthropic's `.claude-plugin/plugin.json` manifest shape, with Loom-specific field constraints.
---

# Plugin Manifest Schema

Mirrors the upstream Anthropic `.claude-plugin/plugin.json` shape. Loom ships this file at the root of the plugin tarball so that `/plugin install loom` can register agents, skills, commands, hooks, and MCP servers without touching `~/.claude/settings.json`.

> **Note:** The upstream schema is owned by Anthropic and documented at <https://code.claude.com/docs/en/plugins-reference>. This file is a **Loom-side snapshot** used for static validation in `test/plugin-manifest.test.ts` and as the contract for `wave-1-manifest-agent`. The JSON Schema mirror lives at `agents/protocols/upstream/plugin.schema.json` and is refreshed by `scripts/refresh-upstream-schemas.sh` (CI workflow). On upstream drift, this file and `hook-manifest.schema.md` are the only artifacts that need updating.

## TOON Exemplar

```toon
PluginManifest:
  name: loom
  version: 0.1.0
  description: "Loom — meta-orchestration for Claude Code"
  keywords[5]: meta-orchestration, claude-code, planning, agents, hooks
  license: MIT
  permissions[6]: Write, Edit, Bash, Agent, SessionStart, Stop
  author: launchstack-dev
  repository: https://github.com/launchstack-dev/loom-ai
  entrypoints[5]{type,path}:
    agent,agents/
    skill,skills/
    command,commands/
    hook,hooks/hooks.json
    mcp,.mcp.json
  requires:
    claudeCode: ">=2.0.0"
```

## Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| name | yes | string | Plugin identifier. Must be `loom` for the canonical Loom distribution. |
| version | yes | semver | Plugin version. MUST match `package.json#version`. |
| description | yes | string | Short marketplace summary. |
| keywords[] | recommended | string[] | Marketplace search terms. Recommended: `meta-orchestration`, `claude-code`, `planning`, `agents`, `hooks`. |
| license | recommended | string | SPDX identifier (e.g., `MIT`, `Apache-2.0`). |
| permissions[] | yes (derived) | string[] | **Required field. Derived from `hooks/hooks.json` matchers.** Loom-specific constraint: this list MUST be the union of all `event` names plus all tool names appearing in `matcher` fields across `hooks.json`. The `wave-1-manifest-agent` computes this at build time and writes it into `plugin.json`; doctor validates the union via the `permissions-derived` check and surfaces `DOCTOR_PERMISSIONS_MISMATCH` on drift. Schema validators MUST reject any plugin manifest where `permissions` is missing, null, or not a string array. |
| author | yes | string | GitHub org or user slug owning the plugin. |
| repository | yes | url | HTTPS clone URL. |
| entrypoints[] | yes | table | Maps resource `type` (agent, skill, command, hook, mcp) to a directory or file path within the plugin tarball. |
| requires.claudeCode | yes | semver-range | Minimum Claude Code version. Currently `>=2.0.0`. |

## Consumer Cross-Reference

```toon
consumers[3]{wave,agent,usage}:
  wave-1,wave-1-manifest-agent,emits-this-file-and-validates-shape
  wave-2,wave-2-doctor-agent,reads-for-DOCTOR_PERMISSIONS_MISMATCH-check
  wave-4-docs,wave-4-docs-agent,documents-shape-in-rationale-note
```

## Cross-References

- `hook-manifest.schema.md` — `permissions[]` derivation source.
- `upstream/plugin.schema.json` — Anthropic-owned JSON Schema snapshot.
- `doctor-report.schema.md` — `DOCTOR_PERMISSIONS_MISMATCH` and `MANIFEST_INVALID` cite this contract.

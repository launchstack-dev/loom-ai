```toon
pageId: component-library-catalog
title: Library Catalog (library.yaml)
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,depended-by
  structure-command-layout,depended-by
  convention-command-creation,relates-to
  pattern-subcommand-dispatch,relates-to
tags[5]: library, catalog, skills, agents, prompts
staleness: fresh
confidence: high
```

# Library Catalog (library.yaml)

`skills/library.yaml` is the authoritative catalog of all distributable Loom components. It defines what can be installed, where it goes, and what it depends on.

## Header Fields

```yaml
catalog_version: 2
repo: https://github.com/launchstack-dev/loom-ai
```

- `catalog_version` — integer version of the catalog schema. The loom-upgrade command uses this to detect when a sync is needed.
- `repo` — canonical source repository for pulling updates.

## Default Install Directories

The `default_dirs` section declares the default and global install paths for each item type:

| Type | Default | Global |
|------|---------|--------|
| skills | `.claude/skills/` | `~/.claude/skills/` |
| agents | `.claude/agents/` | `~/.claude/agents/` |
| prompts | `.claude/commands/` | `~/.claude/commands/` |

The `global` path is used for items installed system-wide (available across all projects). The `default` path is used for project-local installs.

## Four Item Types

### 1. skills

Protocol and schema files that agents read at runtime. They are Markdown documents that define formats, rules, and conventions. Skills are installed to `~/.claude/skills/` or `.claude/skills/`.

Examples: `execution-protocols`, `plan-schema`, `wiki-page-schema`, `toon-format-protocol`

Skills are referenced in `requires:` fields as `skill:{name}`.

### 2. agents

Agent instruction files (`.md`) that the Agent tool runs. Each agent has a `description`, a `source` path, and optionally a `requires` list and a `kit` membership.

Examples: `contracts-agent`, `implementer-agent`, `wiki-ingest-agent`, `roadmap-builder-agent`

Agents are installed to `~/.claude/agents/` or `.claude/agents/`. They are referenced in `requires:` fields as `agent:{name}`.

### 3. prompts

Command files (`.md`) installed as Claude Code slash commands. Installed to `~/.claude/commands/` (global) so they are accessible as `/command-name` in any Claude Code session.

Examples: `loom-plan`, `loom-roadmap`, `loom-code`, `loom-wiki`, `loom`

### 4. infrastructure

Non-agent tooling files such as Node.js scripts, shell wrappers, and background checkers. These have explicit `target:` fields specifying their install path.

Examples:
- `statusline-renderer` → `~/.claude/statusline-renderer.cjs`
- `statusline-command` → `~/.claude/statusline-command.sh`
- `loom-update-checker` → `~/.claude/loom-update-checker.cjs`

## Target Path Conventions

| Type | Source Pattern | Install Target |
|------|---------------|----------------|
| skills | `protocols/*.md` | `~/.claude/skills/{name}.md` (global) |
| agents | `agents/*.md` | `~/.claude/agents/{name}.md` (global) |
| prompts | `commands/*.md` | `~/.claude/commands/{name}.md` (global) |
| infrastructure | `hooks/*.cjs`, `hooks/*.sh` | explicit `target:` field |

## Dependency Resolution

The `requires:` field on any item lists prerequisite items that must be installed before it. Dependencies are expressed as `{type}:{name}` references:

```yaml
requires: [skill:execution-protocols, agent:contracts-agent]
```

The `/loom-library use {name}` command resolves the dependency graph and installs all required items before the target item. This ensures agents have the protocols they need at runtime.

## Kit System

Kits are named bundles of related items that install together. The `kits:` top-level section defines them:

```yaml
kits:
  - name: data-engineering
    description: Data pipeline quality gates, schema review, lineage tracking, and test generation
    version: 1.0.0
    minLoomVersion: 3
    includes:
      - data-schema-reviewer
      - data-test-generator
      - data-pipeline-agent
      - data-lineage-tracker
      - data-quality-gate
      - loom-data
    command: loom-data.md
```

Each kit has:
- `name` — identifier used in `/loom-library use {name}` and in kit dispatch (`{name}:{subcommand}`)
- `includes` — list of item names (resolved from `library.agents` and `library.prompts`) to install together
- `command` — the kit's primary command file, used for kit dispatch routing
- `version` and `minLoomVersion` — compatibility constraints

Individual items opt into a kit via `kit: {kit-name}` on their entry. The kit's `command:` field points to the entry-point prompt that handles the kit's subcommands.

## Management Commands

| Command | Action |
|---------|--------|
| `/loom-library list` | Show all catalog entries and install status |
| `/loom-library use {name}` | Install a specific item (resolves deps) |
| `/loom-library sync` | Sync all installed items from repo |
| `/loom-library update` | Pull latest catalog and apply changes |
| `/loom-library search {query}` | Search catalog by name or description |
| `/loom-library add {path}` | Add a new item to the catalog |
| `/loom-library remove {name}` | Remove an item from the catalog |

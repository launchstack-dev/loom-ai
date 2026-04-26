```toon
pageId: component-install-pipeline
title: Library Install Pipeline
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: skills/library.yaml, commands/loom-library.md
crossRefs[1]{pageId,relationship}:
  convention-settings-json,relates-to
tags[4]: library, install, catalog, infrastructure
staleness: fresh
confidence: high
```

# Library Install Pipeline

The Loom library system is a pull-on-demand catalog that installs agents, skills, commands, and infrastructure files from the Loom GitHub repository into `~/.claude/`. Items are cataloged in `skills/library.yaml` (the repo source) and their installed state is tracked in `~/.claude/skills/library/install-state.toon`.

## Three-Way Parity Requirement

For the system to work correctly, three things must stay in sync:

```
Repo source files          library.yaml catalog       ~/.claude/ installation
(agents/*.md,              (library.yaml lists         (the actual files Claude
 commands/*.md,             every item with             Code reads at runtime)
 skills/, hooks/)           source + metadata)
```

Any item that exists in the repo but is **not listed in library.yaml** cannot be installed via `/loom-library use`. Any item listed in library.yaml but **not installed** to `~/.claude/` will cause runtime failures when Claude Code tries to read it (e.g., agent frontmatter `model:` resolution fails, skill requires: dependencies are missing).

### The 2026-04-25 Incident

On 2026-04-25, an audit revealed 22 items present in the repo that were missing from `library.yaml`. These items had been added to `agents/`, `commands/`, or `skills/` without corresponding catalog entries. Because they were not in the catalog, `/loom-library sync` did not install or update them. Agents that referenced these missing items as `requires:` dependencies failed at spawn time with file-not-found errors.

**Fix**: All 22 items were added to `library.yaml` with correct `source`, `description`, and `requires` fields. The catalog version was bumped. Users running `/loom-library sync` or `/loom-library update` will pick up the additions automatically.

**Prevention**: When adding any new file to `agents/`, `commands/`, `skills/`, or `hooks/` that is intended for distribution, a corresponding catalog entry in `library.yaml` must be added in the same commit.

## library.yaml Structure

The catalog file (`skills/library.yaml`) has four top-level sections:

### skills

Protocol schemas and behavioral guidelines installed to `~/.claude/agents/protocols/`:
- Execution protocols, TOON format spec, agent result schema
- Plan/state/pipeline schemas
- Wiki schemas and conventions
- Behavioral guidelines

### infrastructure

Non-.md files installed to explicit `target` paths (not derived from type):
```yaml
- name: statusline-renderer
  source: hooks/statusline-renderer.cjs
  target: ~/.claude/statusline-renderer.cjs
```
Infrastructure items preserve their original file extension (e.g., `.cjs`, `.sh`).

### agents

Agent instruction files installed to `~/.claude/agents/`. Many declare `requires:` dependencies on skills or other agents that are resolved and installed first.

### prompts

Slash command files installed to `~/.claude/commands/`. The `loom.md` root command and its subcommands (`loom-auto.md`, `loom-quick.md`, etc.) are all prompts.

### kits

Bundles of related agents, commands, and protocols installed together. Kits are opted into with `/loom-library use <kit-name>`. Current kit: `data-engineering`.

## install-state.toon

Install state is tracked at `~/.claude/skills/library/install-state.toon`:

```toon
schemaVersion: 2
lastSynced: 2026-04-25T12:00:00Z

items[N]{name,type,source,targetPath,installedAt}:
  implementer-agent,agent,agents/implementer-agent.md,~/.claude/agents/implementer-agent.md,2026-04-06T10:00:00Z
  loom-plan,prompt,commands/loom-plan.md,~/.claude/commands/loom-plan.md,2026-04-13T18:00:00Z
```

Schema v2 dropped the `contentHash` column from v1. Migration is automatic — v1 files are read normally and written back as v2.

## Dependency Resolution

When installing an item with `requires: [agent:name, skill:name]`:
1. Check if each dependency is present in `install-state.toon`
2. If not, install it first (recursive)
3. Cycle detection via a "currently installing" set — cycles abort with an error

## Source Resolution

All catalog sources are repo-relative paths. The `repo` field in `library.yaml` provides the GitHub URL. Files are fetched via:

```bash
gh api repos/{owner}/{repo}/contents/{source_path} --jq '.content' | base64 -d
```

Falls back to `curl` if `gh` is unavailable.

## Target Path Conventions

| Type | Install Location |
|------|-----------------|
| `agents` | `~/.claude/agents/<name>.md` |
| `prompts` | `~/.claude/commands/<name>.md` |
| `skills` | `~/.claude/agents/protocols/<name>.md` |
| `infrastructure` | Explicit `target:` path from catalog |

## Commands

- `/loom-library list` — show all catalog items with install status
- `/loom-library use <name>` — install item and its dependencies
- `/loom-library sync` — re-pull all installed items
- `/loom-library update` — check for new catalog entries and apply
- `/loom-library search <query>` — search by name/description
- `/loom-library add <source>` — add a new item to the catalog
- `/loom-library remove <name>` — uninstall, with dependent warning

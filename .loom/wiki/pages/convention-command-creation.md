```toon
pageId: convention-command-creation
title: Command Creation Conventions
category: convention
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: commands/, skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,relates-to
  structure-command-layout,relates-to
  component-library-catalog,relates-to
  pattern-subcommand-dispatch,relates-to
tags[5]: convention, commands, creation, library, parity
staleness: fresh
confidence: high
```

# Command Creation Conventions

When adding a new command to Loom, three artifacts must be kept in sync. This is the **three-way parity rule**.

## The Three-Way Parity Rule

Every new command must exist in all three locations simultaneously:

| Location | Purpose | Path Pattern |
|----------|---------|--------------|
| **Repo source** | Version-controlled source of truth | `commands/{name}.md` |
| **Library catalog** | Makes the command installable | `skills/library.yaml` `prompts:` entry |
| **Installed** | Makes the command usable in Claude Code | `~/.claude/commands/{name}.md` |

A command that exists in the repo but not in `library.yaml` cannot be discovered or installed. A command in `library.yaml` but not installed won't appear as a `/slash-command`. All three must be present.

## Step-by-Step: Creating a New Command

### 1. Create the command file

Create `commands/{name}.md` in the repo. The file must have:

- YAML frontmatter with `description:` field (used by Claude Code for the slash command tooltip)
- A `## Requirements` section that references `$ARGUMENTS` for argument parsing
- Clear dispatch logic if the command has subcommands

```markdown
---
description: "Short description of what this command does"
---
# Command Name

$ARGUMENTS

Parse the first positional argument as the subcommand...
```

### 2. Register in library.yaml

Add an entry to the `prompts:` section of `skills/library.yaml`:

```yaml
- name: loom-mycommand
  description: "Human-readable description"
  source: commands/loom-mycommand.md
  requires: [agent:some-agent, skill:some-protocol]  # optional
```

The `name` field becomes the slash command name (`/loom-mycommand`). The `source` field is relative to the repo root.

Include `requires:` entries for every agent and skill the command depends on. This ensures they are installed automatically when someone runs `/loom-library use loom-mycommand`.

### 3. Install to ~/.claude/commands/

The command file must be present at `~/.claude/commands/{name}.md` for Claude Code to recognize it as a slash command. There are two ways to accomplish this:

- **Via library**: Run `/loom-library use {name}` or `/loom-library sync` — the library system copies `source` to the global commands directory
- **Manually**: Copy `commands/{name}.md` to `~/.claude/commands/{name}.md`

### 4. Register in loom.md dispatch table (if applicable)

If the new command should be reachable via `/loom {subcommand}`, add a row to the dispatch table in `commands/loom.md`:

```markdown
| `mysubcommand` | Read `~/.claude/commands/loom-mycommand.md` and follow |
```

Or if using Skill dispatch:

```markdown
| `mysubcommand` | Skill tool: `loom-mycommand` |
```

Not all commands need to be in the `/loom` dispatch table. Commands that are standalone noun-commands (`/loom-plan`, `/loom-code`, `/loom-wiki`) are invoked directly, not through `/loom`.

## Naming Conventions

- Command names follow the pattern `loom-{noun}` or `loom-{verb}` in kebab-case
- The filename is `{name}.md` — the slash command name is the filename without `.md`
- Subcommand files within a directory: `commands/{parent}/{subcommand}.md`
- No spaces or special characters in command names

## Subcommand Directory Commands

If the command has multiple subcommands and each needs substantial logic:

1. Create the parent file `commands/{name}.md` with dispatch logic
2. Create a directory `commands/{name}/`
3. Add one child file per subcommand: `commands/{name}/{subcommand}.md`
4. In the parent file, dispatch via Read tool: load `~/.claude/commands/{name}/{subcommand}.md`
5. Install both the parent and all child files to `~/.claude/commands/{name}/`

Only `loom-plan/` and `loom-roadmap/` currently use this pattern. Simpler multi-subcommand commands (like `loom-code.md`, `loom-wiki.md`) handle all subcommand logic inline.

## Kit Commands

If the new command belongs to a kit:

1. Add `kit: {kit-name}` to the `prompts:` entry in `library.yaml`
2. Add the command name to the kit's `includes:` list under `kits:`
3. If the command is the kit's entry point, set it as `command: {name}.md` in the kit definition

Kit commands are only installed when a user runs `/loom-library use {kit-name}`, not during a normal sync.

## Verification Checklist

After creating a command, verify:

- [ ] `commands/{name}.md` exists with correct frontmatter and `$ARGUMENTS` handling
- [ ] `skills/library.yaml` has the entry under `prompts:` with correct `source:` path
- [ ] `~/.claude/commands/{name}.md` is installed (run `/loom-library sync` if not)
- [ ] If dispatched by `loom.md`: the dispatch table row is added
- [ ] If a subcommand command: parent command file correctly dispatches to child `.md`
- [ ] All agents and skills listed in `requires:` are installed

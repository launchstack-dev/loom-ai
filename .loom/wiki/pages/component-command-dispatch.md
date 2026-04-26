```toon
pageId: component-command-dispatch
title: Command Dispatch System
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: commands/loom.md
crossRefs[4]{pageId,relationship}:
  structure-command-layout,relates-to
  component-library-catalog,depends-on
  pattern-subcommand-dispatch,relates-to
  convention-command-creation,relates-to
tags[4]: dispatch, commands, routing, loom
staleness: fresh
confidence: high
```

# Command Dispatch System

The command dispatch system is the entry point for all `/loom` invocations. It lives in `commands/loom.md` and routes the first positional argument (the subcommand) to either a registered skill or a standalone command file.

## Two Dispatch Mechanisms

Loom uses two distinct mechanisms depending on how a command is registered:

**1. Skill Tool dispatch** — for commands registered in `library.yaml` `prompts:` section that have been installed as Claude Code skills. The dispatcher calls the Skill tool with `skill: "{skill name}"` and `args: "{remaining arguments}"`.

**2. Read dispatch** — for standalone command files that are installed to `~/.claude/commands/` but are not registered skills. The dispatcher uses the Read tool to load the command `.md` file from `~/.claude/commands/`, then follows its instructions with the remaining arguments as context.

## Dispatch Table

| Subcommand | Mechanism | Target |
|------------|-----------|--------|
| (none) / `help` / `reference` | Read | `~/.claude/commands/loom-reference.md` |
| `init` | Read | `~/.claude/commands/loom-init.md` |
| `auto` | Read | `~/.claude/commands/loom-auto.md` |
| `converge` | Read | `~/.claude/commands/loom-converge.md` |
| `quick` | Read | `~/.claude/commands/loom-quick.md` |
| `bugfix` | Skill | `loom-bugfix` |
| `pause` | Read | `~/.claude/commands/loom-pause.md` |
| `resume` | Read | `~/.claude/commands/loom-resume.md` |
| `do` | Read | `~/.claude/commands/loom-do.md` |
| `next` | Read | `~/.claude/commands/loom-next.md` |
| `profile` | Read | `~/.claude/commands/loom-profile.md` |
| `status` | Read | `~/.claude/commands/loom-status.md` |
| `debate` | Read | `~/.claude/commands/loom-debate.md` |
| `chain` | Read | `~/.claude/commands/loom-chain.md` |
| `vote` | Read | `~/.claude/commands/loom-vote.md` |
| `triage` | Read | `~/.claude/commands/loom-triage.md` |
| `upgrade` | Read | `~/.claude/commands/loom-upgrade.md` |
| `<word>:<word>` | Kit dispatch | (see below) |

## Dispatch Procedure

1. Extract the first token as the subcommand
2. Collect remaining tokens as the arguments string
3. If mapped to Skill: invoke `Skill tool` with `skill: "{skill name}"` and `args: "{remaining arguments}"`
4. If mapped to Read: use Read tool to load `~/.claude/commands/{command}.md`, then follow its instructions with remaining arguments as context
5. For no args / `help` / `reference`: read `~/.claude/commands/loom-reference.md` and display verbatim
6. If unrecognized and not a kit pattern: print "Unknown subcommand: {subcommand}. Run `/loom` for available commands."

## Kit Dispatch Pattern

When the first argument matches `<word>:<word>` (exactly one colon with non-empty text on both sides):

1. Split on `:` → `kitPrefix` and `subcommand`
2. Read `~/.claude/skills/library/library.yaml` `kits:` section
3. Find a kit whose `name` matches `kitPrefix` OR whose `command` basename (minus `.md`) matches `kitPrefix`
4. If no kit found: print "Kit '{kitPrefix}' not installed. Run `/loom-library use {kitPrefix}` to install."
5. If kit found but not installed (not in `install-state.toon`): print install message
6. If `subcommand` is empty: read the kit's command file and display its available subcommands
7. If all checks pass: invoke `Skill tool` with `skill: "{kit command name}"` and `args: "{subcommand} {remaining args}"`

This enables kit-scoped commands like `/loom data:profile` or `/loom data:validate` — the kit command handles further subcommand routing internally.

## Command File Install Location

All command files dispatched via the Read mechanism must be installed to `~/.claude/commands/`. This is the Claude Code user commands directory. The `library.yaml` `prompts:` section declares the source paths; `/loom-library use` or `/loom-library sync` performs the installation.

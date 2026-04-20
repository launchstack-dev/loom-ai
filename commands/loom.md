---
description: "init, auto, converge, quick, bugfix, pause, resume, do, next, status, debate, chain, vote, triage, upgrade + kit:subcommands"
---
# Loom

Loom is a multi-agent pipeline for planning, executing, testing, and reviewing software projects.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand and dispatch to the matching skill.

| Subcommand | Skill to invoke |
|------------|-----------------|
| (none) / `help` / `reference` | Read and display `commands/loom-reference.md` |
| `init` | `loom-init` |
| `auto` | `loom-auto` |
| `converge` | `loom-converge` |
| `quick` | `loom-quick` |
| `bugfix` | `loom-bugfix` |
| `pause` | `loom-pause` |
| `resume` | `loom-resume` |
| `do` | `loom-do` |
| `next` | `loom-next` |
| `profile` | `loom-profile` |
| `status` | `loom-status` |
| `debate` | `loom-debate` |
| `chain` | `loom-chain` |
| `vote` | `loom-vote` |
| `triage` | `loom-triage` |
| `upgrade` | `loom-upgrade` |
| `<word>:<word>` pattern | Kit dispatch (see below) |

**Dispatch procedure:**
1. Extract the first token as the subcommand
2. Collect remaining tokens as the arguments string
3. If the subcommand matches a row in the table: invoke the Skill tool with `skill: "{skill name}"` and `args: "{remaining arguments}"`
4. For no args / `help` / `reference`: read `commands/loom-reference.md` from the project's commands directory (`~/.claude/commands/loom-reference.md` or `~/.loom-ai/commands/loom-reference.md`) and display its contents verbatim
5. If the subcommand is not recognized and doesn't match kit dispatch: print "Unknown subcommand: {subcommand}. Run `/loom` for available commands."

---

## Kit Dispatch

When the first argument matches `<word>:<word>` (contains exactly one colon with non-empty text on both sides):

1. Split on `:` → `kitPrefix` and `subcommand`
2. Read `~/.claude/skills/library/library.yaml` `kits:` section
3. Find a kit whose `name` matches `kitPrefix` OR whose `command` basename (minus `.md`) matches `kitPrefix`
4. If no kit found: print "Kit '{kitPrefix}' not installed. Run `/loom-library use {kitPrefix}` to install." Stop.
5. If kit found but its command file is not installed (not in install-state.toon): print "Kit '{kitPrefix}' is registered but its command is not installed. Run `/loom-library use {kitName}` to install." Stop.
6. If `subcommand` is empty (user typed `data:` with no subcommand):
   - Read the kit's command file
   - Display its available subcommands (from the command file's argument parsing section)
   - Stop.
7. Invoke the Skill tool with `skill: "{kit command name}"` and `args: "{subcommand} {remaining args}"`.

If the subcommand is not recognized by the kit's command file, the command file handles the error (showing valid subcommands + did-you-mean for edit distance <= 2).

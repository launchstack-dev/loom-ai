---
description: "init, auto, converge, quick, bugfix, pause, resume, do, next, status, debate, chain, vote, triage, upgrade + kit:subcommands"
---
# Loom

Loom is a multi-agent pipeline for planning, executing, testing, and reviewing software projects.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand and dispatch.

**Dispatch uses two mechanisms depending on whether the target is a registered skill or a standalone command file:**

- **Registered skills** (in `library.yaml` `prompts:` section): invoke via the Skill tool
- **Standalone command files** (not in library.yaml): load via the Read tool

| Subcommand | Dispatch |
|------------|----------|
| (none) / `help` / `reference` | Read `~/.claude/commands/loom-reference.md` and display verbatim |
| `init` | Read `~/.claude/commands/loom-init.md` and follow |
| `auto` | Read `~/.claude/commands/loom-auto.md` and follow |
| `converge` | Read `~/.claude/commands/loom-converge.md` and follow |
| `quick` | Read `~/.claude/commands/loom-quick.md` and follow |
| `bugfix` | Skill tool: `loom-bugfix` |
| `pause` | Read `~/.claude/commands/loom-pause.md` and follow |
| `resume` | Read `~/.claude/commands/loom-resume.md` and follow |
| `do` | Read `~/.claude/commands/loom-do.md` and follow |
| `next` | Read `~/.claude/commands/loom-next.md` and follow |
| `profile` | Read `~/.claude/commands/loom-profile.md` and follow |
| `status` | Read `~/.claude/commands/loom-status.md` and follow |
| `debate` | Read `~/.claude/commands/loom-debate.md` and follow |
| `chain` | Read `~/.claude/commands/loom-chain.md` and follow |
| `vote` | Read `~/.claude/commands/loom-vote.md` and follow |
| `triage` | Read `~/.claude/commands/loom-triage.md` and follow |
| `upgrade` | Read `~/.claude/commands/loom-upgrade.md` and follow |
| `<word>:<word>` pattern | Kit dispatch (see below) |

**Dispatch procedure:**
1. Extract the first token as the subcommand
2. Collect remaining tokens as the arguments string
3. If the subcommand maps to a Skill tool dispatch: invoke the Skill tool with `skill: "{skill name}"` and `args: "{remaining arguments}"`
4. If the subcommand maps to a Read dispatch: use the Read tool to load the command file, then follow its instructions with the remaining arguments as context
5. For no args / `help` / `reference`: read `~/.claude/commands/loom-reference.md` and display its contents verbatim
6. If the subcommand is not recognized and doesn't match kit dispatch: print "Unknown subcommand: {subcommand}. Run `/loom` for available commands."

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

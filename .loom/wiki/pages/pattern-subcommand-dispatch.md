```toon
pageId: pattern-subcommand-dispatch
title: Subcommand Dispatch Pattern
category: pattern
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[3]: commands/loom-plan.md, commands/loom-roadmap.md, commands/loom.md
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,exemplifies
  structure-command-layout,relates-to
  convention-command-creation,relates-to
  component-library-catalog,relates-to
tags[4]: subcommand, dispatch, pattern, routing
staleness: fresh
confidence: high
```

# Subcommand Dispatch Pattern

The subcommand dispatch pattern is how multi-action Loom commands route to specialized per-subcommand handlers. Two commands use this pattern: `loom-plan.md` and `loom-roadmap.md`. The same structural approach is used at the top level by `loom.md`.

## How Parent Commands Parse and Dispatch

A parent command file:

1. Receives `$ARGUMENTS` — everything the user typed after the command name
2. Parses the first positional token as the subcommand
3. Collects remaining tokens as the arguments string to pass forward
4. Dispatches based on a known subcommand list

If no subcommand is provided (or the subcommand is unrecognized), the command displays available subcommands.

### loom-plan.md Subcommands

```
create    generate PLAN.md from an approved roadmap
review    launch 6 specialized agents to review a plan in parallel
execute   wave-by-wave plan execution with parallel agents
test      generate and run acceptance criteria, unit, and E2E tests
status    show plan progress
```

### loom-roadmap.md Subcommands

```
(none)/status   unified status (roadmap + plan progress + milestones + risks)
init            create new ROADMAP.md interactively
review          4 agents review roadmap in parallel
approve         mark ROADMAP.md as approved
refine          refine existing roadmap or plan using review history
validate        run validation pipeline (stages 1-4)
add/insert/remove  mutate roadmap features
explore         in-depth exploration of a feature or milestone
```

## Read-Based Dispatch

For `loom-plan.md` and `loom-roadmap.md`, each subcommand has a dedicated file in a matching subdirectory:

- `commands/loom-plan/{subcommand}.md`
- `commands/loom-roadmap/{subcommand}.md`

The parent command dispatches by reading the child file with the Read tool, then following its instructions with the remaining arguments as context. This is the same Read dispatch mechanism used in `loom.md` for its subcommands.

**Pattern:**
```
1. Parse subcommand from $ARGUMENTS
2. Collect remaining args
3. Read tool: load ~/.claude/commands/loom-plan/{subcommand}.md
4. Follow that file's instructions with remaining args as context
```

The parent command file itself handles common concerns that apply to all subcommands: reading shared protocol files, resolving model tiers, and handling cross-cutting flags.

## Cross-Cutting Pattern Flags

`loom-plan.md` supports pattern flags that inject a multi-agent orchestration pattern before or during any subcommand:

| Flag | Effect |
|------|--------|
| `--debate "question"` | Run adversarial debate; inject result as locked decision |
| `--chain "task"` | Run progressive refinement chain on a produced artifact |
| `--vote "problem"` | Run parallel independent agents on a decision point |
| `--triage "task"` | Route a subtask through triage classifier first |

These flags are parsed by the parent before dispatching to the child, so every subcommand inherits them automatically.

## Subcommand Directory Convention

The naming convention for subcommand files is:

```
commands/{parent-command-name}/{subcommand}.md
```

Examples:
- `commands/loom-plan/create.md`
- `commands/loom-plan/execute.md`
- `commands/loom-roadmap/explore.md`
- `commands/loom-roadmap/init.md`

The parent command name minus `commands/` and `.md` is the directory name. The subcommand name (first arg) maps directly to the filename.

## Argument Pass-Through

Arguments flow through the dispatch chain:

```
/loom-plan execute --wave 2 --skip-review
        ↓
  subcommand = "execute"
  remaining  = "--wave 2 --skip-review"
        ↓
  Read: commands/loom-plan/execute.md
  Context: remaining args = "--wave 2 --skip-review"
```

The child file receives the remaining arguments as its `$ARGUMENTS` equivalent (passed as context by the parent). Each child file documents the flags it accepts independently.

## Contrast with Top-Level loom.md Dispatch

`loom.md` uses the same pattern but dispatches to flat files (not a subdirectory), and also supports the Skill tool as an alternative to Read:

- Read dispatch: loads `~/.claude/commands/loom-{subcommand}.md`
- Skill dispatch: invokes the Skill tool with `skill: "loom-{subcommand}"`

`loom-plan.md` and `loom-roadmap.md` use only Read dispatch to their subdirectory files.

---
description: "Smart routing — natural language to the right Loom command"
---

# Loom Do

Smart routing -- takes freeform natural language text and dispatches to the right Loom command.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `do`:
- The entire remaining text after `do` is the user's intent description.
- If empty: print help and stop.

### Instructions

#### Step 1: Help Check

If no text provided after `do`:
```
/loom do <natural language description>

Route freeform text to the right Loom command automatically.

Examples:
  /loom do fix the auth bug
  /loom do review my code
  /loom do create a plan for the new feature
  /loom do what should I do next
  /loom do add a note about the caching issue
  /loom do show me the project status
```
Stop.

#### Step 2: Gather Context

Read project state to inform routing:

1. **Available commands.** Read `~/.claude/skills/library/library.yaml` to get all installed Loom commands with their descriptions. If the file does not exist, use the built-in command list from the reference section above.

2. **Project state.** Check for the presence of:
   - `ROADMAP.md` -- record exists/not-exists and approval status (check frontmatter for `status: approved`)
   - `PLAN.md` -- record exists/not-exists
   - `.plan-execution/state.toon` -- read `status` if exists (in-progress, completed, failed)
   - `.plan-execution/pipeline-state.toon` -- read `currentStage` if exists
   - `.plan-execution/continue-here.toon` -- paused session exists
   - `.plan-execution/review-report.md` -- review findings exist
   - `.loom/wiki/` -- wiki exists
   - `.plan-history/quick-tasks/` -- prior quick tasks exist

3. **Recent activity.** If `.plan-execution/ephemeral/status.toon` exists, read the `command` and `phase` fields to understand what was last running.

#### Step 3: Route Intent

Analyze the user's text against known patterns and project state. Use both keyword matching and semantic understanding:

| Intent Pattern | Matched Command | Condition |
|----------------|-----------------|-----------|
| "fix", "bug", "debug", "broken" | `/loom-code fix` or `/loom-quick "{text}"` | If review-report.md exists, use code fix. Otherwise, use quick. |
| "review", "check code", "audit code" | `/loom-code review` | Default to `--branch` if on a feature branch |
| "review plan", "check plan" | `/loom-plan review` | Only if PLAN.md exists |
| "review roadmap" | `/loom-roadmap review` | Only if ROADMAP.md exists |
| "plan", "create plan", "make a plan" | `/loom-plan create` | Only if ROADMAP.md exists and is approved |
| "roadmap", "create roadmap", "init roadmap" | `/loom-roadmap init` | Append `--from "{text}"` if text contains a description |
| "build", "execute", "implement", "run plan" | `/loom-plan execute` | Only if PLAN.md exists |
| "test", "run tests", "generate tests" | `/loom-plan test --run` | Only if PLAN.md exists |
| "note", "remember", "idea", "thought" | `/loom-note "{text}"` | Strip the intent keyword, pass remainder as note text |
| "status", "progress", "how far", "where are we" | `/loom-status` | Always available |
| "what's next", "next step", "what now", "continue" | `/loom-next` | Delegate to the next subcommand |
| "pause", "save state", "stop here" | `/loom-pause` | Only if active workflow detected |
| "resume", "continue", "pick up" | `/loom-resume` | Only if resumable state exists |
| "onboard", "init", "analyze codebase" | `/loom-init` | Always available |
| "auto", "autonomous", "do everything" | `/loom-auto` | Append `--from "{text}"` if text contains a description |
| "converge", "match target", "golden" | `/loom-converge --target` | Requires target path in text |
| "tdd", "test first", "criteria", "code review converge", "review until clean" | `/loom-converge --criteria` | Extract --phase, --reviewers from text |
| "commit", "push", "pr", "merge" | `/loom-git {subcommand}` | Extract git subcommand from text |
| "ingest", "update wiki" | `/loom-wiki ingest` | Only if wiki exists |
| "lint", "health check" | `/loom-wiki lint` | Always available |
| "profile", "model", "cost" | `/loom-profile` | Always available |

If the intent is ambiguous (no strong keyword match or multiple matches), present the top 2-3 options:

```
I'm not sure which command you need. Here are the best matches:

  1. /loom-code review --branch   -- Review code changes on current branch
  2. /loom-quick "{text}"         -- Execute as a quick standalone task
  3. /loom-code fix               -- Apply fixes from existing review findings

Which one? (1/2/3 or describe more)
```

#### Step 4: Confirm and Execute

Present the matched command with confidence:

```
Routing to: /loom-code review --branch

Is that right? (yes / pick another)
```

- If user confirms ("yes", "y", "sure", or just presses enter): invoke the Skill tool with the matched command name, passing any extracted arguments.
- If user picks another: ask them to specify or re-present options.
- If user provides a different description: re-run Step 3 with the new text.

```toon
pageId: structure-command-layout
title: Command File Layout
category: structure
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: commands/, skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,depends-on
  component-library-catalog,depends-on
  pattern-subcommand-dispatch,relates-to
  convention-command-creation,relates-to
tags[4]: commands, layout, structure, files
staleness: fresh
confidence: high
```

# Command File Layout

All Loom command files live under `commands/` in the repository. They are Markdown files with YAML frontmatter. Each file is a prompt that Claude follows when the command is invoked.

## Top-Level Command Files

These are standalone `.md` files directly in `commands/`. Each corresponds to a single installable slash command:

| File | Slash Command | Role |
|------|---------------|------|
| `loom.md` | `/loom` | Root dispatcher — routes to all subcommands |
| `loom-plan.md` | `/loom-plan` | Plan lifecycle — create, review, execute, test |
| `loom-roadmap.md` | `/loom-roadmap` | Roadmap lifecycle — init, review, approve, refine |
| `loom-code.md` | `/loom-code` | Code quality — review + fix |
| `loom-bugfix.md` | `/loom-bugfix` | Rapid bug fixing with wiki context |
| `loom-wiki.md` | `/loom-wiki` | Wiki management — ingest, lint, query, status |
| `loom-agent.md` | `/loom-agent` | Agent management — create, list |
| `loom-auto.md` | `/loom-auto` | Full autonomous pipeline |
| `loom-init.md` | `/loom-init` | Project initialization |
| `loom-quick.md` | `/loom-quick` | Quick task execution |
| `loom-converge.md` | `/loom-converge` | Convergence pipeline |
| `loom-debate.md` | `/loom-debate` | Adversarial multi-round debate |
| `loom-chain.md` | `/loom-chain` | Sequential refinement pipeline |
| `loom-vote.md` | `/loom-vote` | Parallel solutions + evaluator |
| `loom-triage.md` | `/loom-triage` | Task classification and routing |
| `loom-do.md` | `/loom-do` | Execute a single named plan task |
| `loom-next.md` | `/loom-next` | Execute next pending plan task |
| `loom-pause.md` | `/loom-pause` | Checkpoint and pause execution |
| `loom-resume.md` | `/loom-resume` | Resume from checkpoint |
| `loom-status.md` | `/loom-status` | Pipeline status dashboard |
| `loom-profile.md` | `/loom-profile` | Model profile management |
| `loom-reference.md` | `/loom-reference` | Full command reference |
| `loom-upgrade.md` | `/loom-upgrade` | Check for and apply updates |
| `loom-library.md` | `/loom-library` | Catalog management — list, use, sync |
| `loom-note.md` | `/loom-note` | Task capture and management |
| `loom-statusline-setup.md` | `/loom-statusline-setup` | Status line setup wizard |
| `loom-git.md` | `/loom-git` | Git workflow automation |
| `loom-data.md` | `/loom-data` | Data engineering quality gates |

## Subcommand Directories

Two commands use subdirectories to hold per-subcommand files. The parent command reads the appropriate child file based on the parsed subcommand argument:

**`commands/loom-plan/`**
- `create.md` — generate PLAN.md from approved roadmap
- `review.md` — launch 6 parallel plan review agents
- `execute.md` — wave-by-wave plan execution
- `test.md` — generate and run acceptance criteria and tests
- `status.md` — show plan progress

**`commands/loom-roadmap/`**
- `init.md` — create new ROADMAP.md interactively
- `review.md` — 4-agent parallel roadmap review
- `analyze.md` — analysis workflow
- `explore.md` — roadmap exploration
- `mutate.md` — add, insert, remove features
- `util.md` — utility operations

## Standalone vs. Subcommand-Dispatched

**Standalone commands** are invoked directly as slash commands (e.g., `/loom-plan`, `/loom-code`, `/loom-wiki`). They are registered as skills in `library.yaml` `prompts:` and installed as Claude Code slash commands.

**Subcommand-dispatched commands** are loaded by `loom.md` via the Read tool. They live in `commands/` as `.md` files but are reached through `/loom {subcommand}` rather than as their own top-level slash commands in the session. Examples: `loom-auto.md`, `loom-converge.md`, `loom-quick.md`.

Some commands are both — they appear in the `library.yaml` prompts section (and are therefore installable as standalone slash commands) AND are dispatched by `loom.md` when called via `/loom {subcommand}`.

## Relationship to library.yaml Prompts Section

The `library.yaml` `prompts:` section is the authoritative catalog of all installable command files. Each entry specifies:

- `name` — the slash command name (without leading `/`)
- `source` — path relative to the repo root (e.g., `commands/loom-plan.md`)
- `requires` — optional list of agents and skills that must be installed first

The install target for all prompt entries is `~/.claude/commands/{name}.md` (the global Claude Code commands directory). The `default_dirs.prompts` section of `library.yaml` confirms this:

```yaml
prompts:
  - default: .claude/commands/
  - global: ~/.claude/commands/
```

Running `/loom-library sync` copies every `prompts:` entry from its `source` path to the global install location.

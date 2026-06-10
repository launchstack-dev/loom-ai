# Command Restructure Plan — Noun-First Subcommands

## Overview

Consolidate 20 top-level commands into ~10 noun-grouped commands with subcommand dispatch. Each noun command shows available actions when called with no args. Matches the pattern `/loom-library` and `/loom-roadmap` already use.

## Guiding Principles

1. **Every noun command is self-documenting.** No args = print available subcommands with one-line descriptions.
2. **Subcommands are the first positional argument.** Flags (`--auto`, `--staged`, etc.) come after.
3. **Backward compatibility via aliases.** Old commands redirect to new ones with a deprecation notice for one release cycle.
4. **One command file per noun.** Each file contains all subcommand logic with clear `### Subcommand: <name>` sections.
5. **library.yaml tracks the new names.** Old entries get `deprecated: true` and `alias: <new-name>`.

## Command Mapping

### `/loom-plan` (new unified command)

Absorbs: `/loom-create-plan`, `/loom-review-plan`, `/loom-execute-plan`, `/loom-test-plan`

```
/loom-plan                  → show available subcommands
/loom-plan create           → generate PLAN.md from approved roadmap (was /loom-create-plan)
/loom-plan create --auto    → non-interactive plan creation
/loom-plan create --v1      → v1 plan (no API specs/state machines)
/loom-plan create --review-integrate  → apply review findings to existing plan
/loom-plan review           → 6 agents analyze PLAN.md in parallel (was /loom-review-plan)
/loom-plan execute          → wave-by-wave execution (was /loom-execute-plan)
/loom-plan execute --dry-run
/loom-plan execute --resume
/loom-plan execute --auto
/loom-plan execute --contracts-only
/loom-plan test             → acceptance criteria + unit + E2E generation (was /loom-test-plan)
/loom-plan test --run
/loom-plan status           → show plan progress (delegates to /loom-roadmap --status plan section)
```

File: `commands/loom-plan.md`
Replaces: `commands/loom-create-plan.md`, `commands/loom-review-plan.md`, `commands/loom-execute-plan.md`, `commands/loom-test-plan.md`

### `/loom-code` (new unified command)

Absorbs: `/loom-review-code`, `/loom-fix-code`

```
/loom-code                  → show available subcommands
/loom-code review           → comprehensive code review (was /loom-review-code)
/loom-code review --staged
/loom-code review --branch
/loom-code review --pr 123
/loom-code review --quick
/loom-code review --full
/loom-code fix              → auto-apply review findings (was /loom-fix-code)
/loom-code fix --dry-run
/loom-code fix --auto
/loom-code fix --severity critical
```

File: `commands/loom-code.md`
Replaces: `commands/loom-review-code.md`, `commands/loom-fix-code.md`

### `/loom-roadmap` (already exists, absorb review)

Absorbs: `/loom-review-roadmap`

```
/loom-roadmap               → show status (existing default)
/loom-roadmap init          → create ROADMAP.md (existing --init)
/loom-roadmap init --brownfield
/loom-roadmap init --from "description"
/loom-roadmap init --full   → roadmap → review → plan → review pipeline
/loom-roadmap review        → 4 agents review in parallel (was /loom-review-roadmap)
/loom-roadmap approve       → mark as approved (existing --approve-roadmap)
/loom-roadmap refine        → refine plan from execution state (existing --refine)
/loom-roadmap validate      → run validation stages (existing --validate)
/loom-roadmap status        → unified status view (existing default)
/loom-roadmap deps          → dependency graph (existing --deps)
/loom-roadmap diff          → show changes since last snapshot (existing --diff)
/loom-roadmap history       → show snapshot history (existing --history)
/loom-roadmap milestone     → milestone management (existing --milestone)
/loom-roadmap snapshot      → create snapshot (existing --snapshot)
```

Change: Convert `--flag` subcommands to positional subcommands. Keep `--flag` as aliases for backward compatibility during transition.
File: `commands/loom-roadmap.md` (modify in place)
Replaces: `commands/loom-review-roadmap.md`

### `/loom-wiki` (new unified command)

Absorbs: `/loom-ingest`, `/loom-lint`

```
/loom-wiki                  → show available subcommands + wiki status (page count, last updated)
/loom-wiki ingest           → process sources into wiki pages (was /loom-ingest)
/loom-wiki ingest --code
/loom-wiki ingest --docs
/loom-wiki ingest --execution
/loom-wiki lint             → structural health check (was /loom-lint)
/loom-wiki lint --fix
/loom-wiki query "question" → search wiki and synthesize answer (new, uses wiki-query-agent)
/loom-wiki status           → page count, staleness report, last operations
```

File: `commands/loom-wiki.md`
Replaces: `commands/loom-ingest.md`, `commands/loom-lint.md`

### `/loom-agent` (new unified command)

Absorbs: `/loom-create-agent`

```
/loom-agent                 → show available subcommands
/loom-agent create          → interactive bespoke agent wizard (was /loom-create-agent)
/loom-agent list            → show registered agents (from orchestration.toml + library)
```

File: `commands/loom-agent.md`
Replaces: `commands/loom-create-agent.md`

### `/loom` (root command, absorb workflow-level actions)

Absorbs: `/loom-init`, `/loom-auto`, `/loom-converge`, `/loom-quick`
Plus proposed: `do`, `next`, `pause`, `resume`

```
/loom                       → system reference (existing)
/loom init                  → brownfield onboarding (was /loom-init)
/loom init --full --from "description"
/loom auto                  → fully autonomous pipeline (was /loom-auto)
/loom auto --from "description"
/loom converge              → convergence loop (was /loom-converge)
/loom converge --target spec.json --source src/
/loom quick                 → zero-ceremony task (was /loom-quick)
/loom do "natural language"  → smart routing (new, from feature parity plan)
/loom next                  → state-aware next step (new, from feature parity plan)
/loom pause                 → session pause (new, from feature parity plan)
/loom resume                → session resume (new, from feature parity plan)
/loom profile               → model cost profiles (new, from feature parity plan)
/loom status                → project status overview
```

File: `commands/loom.md` (extend existing)

### Unchanged commands

These already follow the noun pattern correctly:
- `/loom-library` — `list`, `use`, `sync`, `update`, `search`, `remove`
- `/loom-git` — `commit`, `push`, `pr`, `merge`, `cleanup`, `review-pr`
- `/loom-note` — default add, `--review`, `--assimilate`, `--backlog`, `--promote`
- `/loom-statusline-setup` — one-shot config wizard, no subcommands needed

---

## Phase 1: Create New Unified Commands

Build the 5 new command files. Each is a dispatcher that parses the first argument and delegates to the appropriate subcommand section.

### Command file structure pattern

Each unified command follows this template:

```markdown
# {Noun} Manager

You manage {noun} operations for Loom.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands with descriptions
- `create`: [description]
- `review`: [description]
- ...

## Subcommand: (none — help)

Display:
\```
/loom-{noun} — {one-line description}

Subcommands:
  create     {description}
  review     {description}
  execute    {description}
  ...

Examples:
  /loom-{noun} create
  /loom-{noun} review --full
\```

## Subcommand: create

[Full instructions, moved from the old standalone command]

## Subcommand: review

[Full instructions, moved from the old standalone command]
```

### Deliverables

1. `commands/loom-plan.md` — merge create-plan, review-plan, execute-plan, test-plan
2. `commands/loom-code.md` — merge review-code, fix-code
3. `commands/loom-wiki.md` — merge ingest, lint, add query
4. `commands/loom-agent.md` — merge create-agent, add list
5. `commands/loom.md` — extend with init, auto, converge, quick subcommand dispatch

### Acceptance Criteria
- Each new command prints help when called with no args
- All existing flags and behaviors preserved exactly
- Each subcommand section is self-contained (can be read independently)

---

## Phase 2: Update `/loom-roadmap`

Convert `--flag` style subcommands to positional-first with flag aliases.

### Changes

1. Argument parsing: accept both `review` and `--review-roadmap` (alias)
2. Accept both `approve` and `--approve-roadmap`
3. Accept both `validate` and `--validate`
4. Accept both `refine` and `--refine`
5. Default (no args) stays as `status`
6. Move `/loom-review-roadmap` content into `## Subcommand: review` section

### Acceptance Criteria
- `/loom-roadmap review` works identically to old `/loom-review-roadmap`
- Old `--flag` syntax still works (backward compat)
- No-args default unchanged

---

## Phase 3: Deprecation Aliases

Create thin wrapper files for every old command name that redirect to the new structure.

### Wrapper template

Each deprecated command file:

```markdown
# Deprecated — use /loom-{noun} {subcommand}

This command has moved to `/loom-{noun} {subcommand}`.

## Instructions

1. Print: "Note: `/loom-{old-name}` is now `/loom-{noun} {subcommand}`. Redirecting..."
2. Execute the new command with all arguments forwarded.
```

### Files to create

| Old command | Wrapper redirects to |
|---|---|
| `commands/loom-create-plan.md` | `/loom-plan create` |
| `commands/loom-review-plan.md` | `/loom-plan review` |
| `commands/loom-execute-plan.md` | `/loom-plan execute` |
| `commands/loom-test-plan.md` | `/loom-plan test` |
| `commands/loom-review-code.md` | `/loom-code review` |
| `commands/loom-fix-code.md` | `/loom-code fix` |
| `commands/loom-review-roadmap.md` | `/loom-roadmap review` |
| `commands/loom-ingest.md` | `/loom-wiki ingest` |
| `commands/loom-lint.md` | `/loom-wiki lint` |
| `commands/loom-create-agent.md` | `/loom-agent create` |
| `commands/loom-init.md` | `/loom init` |
| `commands/loom-auto.md` | `/loom auto` |
| `commands/loom-converge.md` | `/loom converge` |
| `commands/loom-quick.md` | `/loom quick` |

### Acceptance Criteria
- Old commands still work but print a one-line redirect notice
- Old commands forward all arguments to the new command
- No functionality lost during transition

---

## Phase 4: Update Library Catalog + Docs

### library.yaml changes

1. Add new unified command entries (`loom-plan`, `loom-code`, `loom-wiki`, `loom-agent`)
2. Mark old entries with `deprecated: true` and `redirectsTo: <new-name>`
3. Update dependency references (e.g., `loom-auto` requires `prompt:loom-plan` instead of individual commands)

### Documentation changes

1. Update `README.md` command tables to reflect new structure
2. Update `commands/loom.md` reference section
3. Update any cross-references in agent protocols that mention old command names

### Acceptance Criteria
- `/loom-library list` shows new commands, hides deprecated ones (or marks them)
- `/loom-library use loom-plan` installs the unified command
- README reflects new structure
- All internal cross-references updated

---

## Phase 5: Remove Deprecated Wrappers (future, not this cycle)

After one release cycle, delete the old wrapper files and their library.yaml entries. Not planned for this iteration — wrappers are cheap and backward compat matters.

---

## Execution Order

Phases are sequential — each depends on the previous:

1. **Phase 1** — Create unified commands (biggest effort, no breaking changes)
2. **Phase 2** — Update roadmap command (small, focused)
3. **Phase 3** — Add deprecation wrappers (mechanical, low risk)
4. **Phase 4** — Update catalog and docs (cleanup)
5. **Phase 5** — Remove wrappers (future cycle)

## Files Summary

| Phase | New files | Modified files | Deprecated files |
|-------|-----------|----------------|-----------------|
| 1 | `loom-plan.md`, `loom-code.md`, `loom-wiki.md`, `loom-agent.md` | `loom.md` | — |
| 2 | — | `loom-roadmap.md` | — |
| 3 | — | 14 old command files (thin wrappers) | — |
| 4 | — | `library.yaml`, `README.md`, `loom.md` | — |
| 5 | — | — | Remove 14 wrapper files |

## Risk Mitigation

- **User muscle memory**: Wrappers in Phase 3 ensure old commands keep working. Redirect notice trains users gradually.
- **JIT install breakage**: Phase 4 updates library.yaml so dependency resolution uses new names. Old names still resolve via `redirectsTo`.
- **Wiki auto-triggers**: The wiki maintenance steps we just added reference command names in event types (`plan-created`, `wave-complete`). These are event strings, not command names — no change needed.
- **Hooks**: Hooks reference file paths and tool calls, not command names — no change needed.
- **Other machines**: `/loom-library update` pulls new catalog. Old commands work via wrappers until the user runs `/loom-library sync`.

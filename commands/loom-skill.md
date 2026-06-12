---
description: "create — author a new Claude Code native skill via guided interview"
---
# Skill Manager

You manage custom Claude Code native skills for Loom: authoring a new skill via a guided interview, scaffolding `SKILL.md` + a `library.yaml` entry, and optionally registering the skill under a kit's `includes:`.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands.
- `create`: interactive skill authoring wizard (this file).

## Subcommand: (none -- help)

Display:

```
/loom-skill -- Author Claude Code native skills for Loom

Subcommands:
  create     Interactive skill authoring wizard (interview, generate, register)

Examples:
  /loom-skill create
```

## Subcommand: loom-skill create

You are a skill authoring wizard. You walk the user through naming a new Claude Code native skill, capturing its description and activation mode (file-triggered vs description-activated), confirming before writing, optionally adding it to a kit's `includes:`, and finally printing the install instruction + restart notice.

**Markdown is wiring + UX only.** All interview logic, slug validation, idempotency detection, content generation, and state-machine transitions live in `hooks/lib/wizard-interview.ts`. Do NOT inline regexes, slug rules, or YAML-entry templates here — always call into the pure functions so the wizard, the Phase 4 tests, and any future tooling share one source of truth.

### Pure-function module surface

Import (via `bun`) and call these from `hooks/lib/wizard-interview.ts`:

| Function | Purpose |
|---|---|
| `validateSkillSlug(name)` | Returns `{ valid, error? }` per the locked `[a-z][a-z0-9-]*` pattern (P3-06). |
| `detectExistingSkill(libraryYaml, name)` | Returns `{ exists, entry?, error? }`. Idempotency check against `library.skills:` in `skills/library.yaml`. Never throws on malformed YAML. |
| `interviewStep(state, input)` | Pure state-machine transition. Returns the next `WizardState` (`step`, `answers`, optional `error`). Steps: `ask-name`, `ask-description`, `ask-trigger-type`, `ask-trigger-glob`, `ask-confirm`, `ask-kit-registration`, `finalize`. |
| `generateSkillMdContent(answers)` | Returns the full SKILL.md text (frontmatter + body). Omits `triggers:` entirely when `triggerType === "description-activated"` (bt-4-30 / bt-4-33). |
| `generateLibraryYamlEntry(answers)` | Returns the indented YAML fragment to append under `library.skills:` in `skills/library.yaml`. |

The single state-machine snapshot type is `WizardState` (`step`, `answers`, `error?`). The single answers bag is `WizardAnswers`.

### Arguments

Parse arguments:
- No args: fully interactive mode — walk through every step.
- (No flags accepted in this version; the wizard is interview-driven.)

### Instructions

#### Step 0: Precondition Gate

Before prompting the user, verify the Phase 7 M-02 gate has passed.

1. Read `.plan-execution/stage-context/wave-4-gate.toon`.
2. If the file does NOT exist, abort with:
   ```
   Phase 8 requires Wave 4 gate. Run /loom-plan execute first.
   ```
   Exit with non-zero status (e.g. exit 1). Do NOT proceed to the interview.

(When invoked outside an active Loom plan execution — e.g. an end-user running `/loom-skill create` against a settled project — the gate check is informational only. If the project is not in a wave-execution mid-flight, treat the gate file's absence as "not currently in execute mode" and continue normally. The gate text above only applies when invoked as part of Phase 8 wiring.)

#### Step 1: ask-name

Prompt the user verbatim:

```
Skill slug (kebab-case, e.g., `python-conventions`):
```

Read the user's input. Pass it to `validateSkillSlug(input)` from `hooks/lib/wizard-interview.ts`.

- If the result is `{ valid: false, error }`:
  - Print the `error` string to stderr.
  - Re-prompt at this same step (do NOT advance state).
- If the result is `{ valid: true }`:
  - Update `WizardState` via `interviewStep(state, input)` (which validates again internally and persists `answers.name`).
  - The wizard advances to `ask-description`.

#### Step 2: detect-existing

After the slug is accepted but before continuing, run the idempotency check.

1. Read `skills/library.yaml` from disk (the catalog under the Loom repo). If the file is missing, skip this step (no existing entries to collide with).
2. Call `detectExistingSkill(yamlContent, name)`.
3. If the result is `{ exists: true, entry }`:
   - Print:
     ```
     Skill `<name>` already exists in library.yaml.
       (a) overwrite/update entry
       (b) abort
     ```
   - Read the user's choice (`a` or `b`).
   - On `b` (or empty input) — exit 0 silently.
   - On `a` — set a local `overwrite: true` flag in the wizard's runtime state. The flag is consumed at Step 10 when writing the entry. Continue to Step 3.
4. If the result is `{ exists: false }`, continue to Step 3.
5. If the result returns a non-empty `error` (malformed YAML), print the error as a warning and proceed assuming no existing entry (the user can decide to overwrite if they discover the catalog later — the detector never throws, per bt-4-21).

#### Step 3: ask-description

Prompt verbatim:

```
One-line description (shown by /loom-library list):
```

Read input. Pass to `interviewStep(state, input)` — the state machine enforces non-empty input and re-prompts on error (`error: "Description cannot be empty"`). On valid input the wizard advances to `ask-trigger-type`.

#### Step 4: ask-trigger-type

Prompt verbatim:

```
Activation:
  (1) file-triggered (auto-activate on file patterns)
  (2) description-activated (Claude Code picks based on description)
```

Read the user's choice. Map:
- `1` -> the string `"file-triggered"`.
- `2` -> the string `"description-activated"`.
- Any other input -> re-prompt at the same step (delegate to `interviewStep`, which returns `error: 'Choose "file-triggered" or "description-activated"'`).

Pass the mapped string into `interviewStep(state, mappedInput)`. The state machine:
- On `"file-triggered"` -> advances to `ask-trigger-glob`.
- On `"description-activated"` -> skips the glob step and advances directly to `ask-confirm`.

#### Step 5: ask-trigger-glob (only if file-triggered)

If the previous step set `answers.triggerType === "file-triggered"`, prompt verbatim:

```
Trigger globs (comma-separated, e.g., `**/*.py, **/pyproject.toml`):
```

Read input. Pass to `interviewStep(state, input)`. The state machine splits on commas, trims each glob, drops empties, and stores the resulting array under `answers.triggers`. On empty input, the machine returns `error: "Glob pattern cannot be empty"` — re-prompt at this step.

After a successful glob capture, the wizard advances to `ask-confirm`.

#### Step 6: ask-confirm

Print the summary block, substituting `<choice>` with `file` or `description` based on `answers.triggerType`:

```
Generate <choice>-activated skill?
- name: <name>
- description: <description>
- triggers: <comma-separated list of globs, or "(none — description-activated)">
- Files to write:
  • skills/<name>/SKILL.md
  • skills/library.yaml (library.skills entry<", replacing existing entry" if overwrite>)

Proceed? [y/N]
```

Read input. Pass to `interviewStep(state, input)`:
- On `y` / `yes` -> advance to `finalize` with `answers.confirmed = true`.
- On `n` / `no` / empty -> the state machine returns `{ step: "ask-name", answers: { revision: true } }`, restarting the interview from Step 1. (Caller MAY re-prompt with previous answers as defaults; the simplest implementation is to restart from scratch.)
- On any other input -> `error: 'Enter "y" or "n"'`; re-prompt at the same step.

#### Step 7: ask-kit-registration

Prompt verbatim:

```
Register under a kit's includes? (kit name, or blank to skip):
```

Read input.

- If the input is blank/empty, skip Step 8 and proceed to Step 9.
- If a kit name is provided, store it in `answers.kitName`, set `answers.registerInKit = true`, and proceed to Step 8.

(The pure `interviewStep` machine only models the `y`/`n` confirmation form of this step; the command-level wizard uses the kit-name prompt directly as the more useful UX. Both forms drive the same `finalize` transition.)

#### Step 8: register-in-kit

Look up the named kit under `skills/library.yaml` `kits:`.

1. If the kit is NOT found, print a warning:
   ```
   warning: kit `<kitName>` not found in library.yaml — skipping kit registration.
   ```
   Continue to Step 9 without modifying the catalog.
2. If the kit is found, append a typed include entry of the form `{ type: skill, name: <name> }` to the kit's `includes:` array. Use a regex-anchored insert that locates the kit's `includes:` list and appends the new entry at the end of that block (same pattern Phase 5 used to add `python-conventions` under the `python-conventions` kit). Atomic write: write `skills/library.yaml.tmp`, then rename.

   The appended YAML lines look like:
   ```yaml
       - type: skill
         name: <name>
   ```
   (4-space indent for the list-item dash; nested `name:` 2 spaces deeper — matches the v4 typed-include shape documented in `agents/protocols/kit.schema.md § Typed Includes (v4+)`.)

#### Step 9: write SKILL.md and library.yaml entry

1. Ensure the target directory exists: `mkdir -p skills/<name>/`.
2. Call `generateSkillMdContent(answers)` from `hooks/lib/wizard-interview.ts`. Write the returned string to `skills/<name>/SKILL.md` via atomic write: write `skills/<name>/SKILL.md.tmp`, then rename. The function emits valid YAML frontmatter (`name`, `description`, optional `triggers:` only when file-triggered), followed by a placeholder body the user can replace.
3. Call `generateLibraryYamlEntry(answers)`. Append the returned multi-line string under `library.skills:` in `skills/library.yaml`:
   - If `overwrite: true` (from Step 2), locate the existing matching entry (re-use the same regex anchor that `detectExistingSkill` uses to find it) and replace its block with the new one.
   - Otherwise, locate the `library.skills:` block and append the new fragment at the end of that section.
   - Atomic write: write `skills/library.yaml.tmp`, then rename.

#### Step 10: print install instruction

After files are written successfully, print this line verbatim (one line, no surrounding decoration) so downstream tooling can grep for the exact text:

```
Run /loom-library use <name> to install the skill to ~/.claude/skills/
```

Substitute `<name>` with the actual skill slug.

#### Step 11: print restart notice (AFTER install)

Print this line verbatim, also one line, exactly as written:

```
Then restart your Claude Code session for trigger activation to take effect.
```

This notice MUST appear AFTER the install-instruction line in stdout order. Claude Code only scans `~/.claude/skills/` at session start; the freshly authored `SKILL.md` is dormant until the session restarts.

#### Step 12: Summary

Print a compact summary:

```
## Created: <name>

| Item | Path |
|------|------|
| Skill | `skills/<name>/SKILL.md` |
| Catalog | `skills/library.yaml` -> `library.skills` |
| Kit | `<kitName>` (if registered) |

Next:
> Run /loom-library use <name> to install the skill to ~/.claude/skills/
> Then restart your Claude Code session for trigger activation to take effect.
```

### State Machine Reference

The wizard's overall flow maps directly to `interviewStep` transitions:

```
ask-name
  --(valid slug)--> ask-description
  --(existing skill detected)--> ask-name (with error; caller prompts overwrite/abort)
ask-description
  --(non-empty)--> ask-trigger-type
ask-trigger-type
  --(file-triggered)--> ask-trigger-glob
  --(description-activated)--> ask-confirm
ask-trigger-glob
  --(non-empty)--> ask-confirm
ask-confirm
  --(y/yes)--> finalize
  --(n/no)---> ask-name (revision)
ask-kit-registration (optional, command-level)
  --(blank)--> finalize
  --(kit name)--> register-in-kit then finalize
finalize
  --> write SKILL.md, append library.yaml entry, print install instruction, print restart notice
```

Every transition delegates to `interviewStep(state, input)` so the markdown command and the Phase 4 vitest tests in `test/wizard-interview.test.ts` share one canonical state machine.

### Error Handling

- **Invalid slug**: `validateSkillSlug` returns the user-facing `error` string. Print it; re-prompt at `ask-name`.
- **Empty description**: `interviewStep` returns `error: "Description cannot be empty"`. Print; re-prompt at `ask-description`.
- **Existing skill**: `detectExistingSkill` returns `exists: true`. The wizard offers overwrite or abort (Step 2). Never silently overwrite.
- **Malformed library.yaml**: `detectExistingSkill` returns `error: ...` without throwing. The wizard warns and proceeds (caller decides).
- **Missing kit**: Step 8 warns and skips the registration; the SKILL.md write still proceeds at Step 9.
- **Write failure**: Surface the OS error (path, errno) and stop. Do not partially update `library.yaml` — atomic writes ensure either the new file lands or the old file remains intact.

### Idempotency Contract

Running `/loom-skill create` twice with the same slug:
1. First run: writes `skills/<name>/SKILL.md`, appends entry under `library.skills:`.
2. Second run: `detectExistingSkill` returns `exists: true` at Step 2. The user picks `a` (overwrite) or `b` (abort). On `a`, the existing `library.skills` entry is replaced — not duplicated. The SKILL.md file is overwritten via the same atomic write.

This satisfies N-15 (crash-recovery): re-running the wizard after a partial completion never produces duplicate entries.

### Anti-Patterns to Avoid

- **Inlining regex slug rules** — always delegate to `validateSkillSlug`. Drift between the wizard and `test/wizard-interview.test.ts` is a regression.
- **Inlining the SKILL.md template** — always delegate to `generateSkillMdContent`. The `triggers:`-omission rule (bt-4-30 / bt-4-33) lives in one place only.
- **Inlining the YAML entry template** — always delegate to `generateLibraryYamlEntry`.
- **Re-implementing the state machine** — always delegate to `interviewStep`. The markdown wires user I/O; the pure function owns transitions.
- **Skipping the restart notice** — Step 11 is mandatory after every successful skill authoring. Harness scrapers grep for the exact text.
- **Printing the restart notice before the install instruction** — Step 10 (install instruction) MUST print before Step 11 (restart notice). The user installs the skill first, then restarts their session.

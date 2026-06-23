---
description: "Remove Loom from this machine — plugin dir, ~/.loom/, and settings hook entries. Preserves project state by default."
---

# Loom Uninstall

`/loom-uninstall` is the inverse of `/loom-init` / curl-install. It removes
the plugin install (`~/.claude/plugins/loom/`), the per-user Loom state
directory (`~/.loom/`), and any Loom hook entries from this project's
`.claude/settings.json` AND `.claude/settings.local.json`.

Project state — `.loom/wiki/`, `orchestration.toml`, `.plan-execution/` —
is **preserved by default**. Pass `--purge-project-state` to also remove
those, gated behind a typed-literal confirmation.

## Requirements

$ARGUMENTS

### Arguments

Parse flags after `uninstall`. If `--help` is present (or arguments are
malformed), print the usage block below and exit 0.

```
/loom-uninstall [flags]

Remove Loom from this machine. Preserves project state by default.

Flags:
  --purge-project-state   Also remove .loom/wiki/, orchestration.toml, and
                          .plan-execution/. Requires typing the literal word
                          'uninstall' to confirm.
  --dry-run               Print the removal plan and exit 0 without mutation.
  --yes                   Bypass all confirmation prompts (CI use only).
  --help                  Show this help and exit 0.

Examples:
  /loom-uninstall
  /loom-uninstall --dry-run
  /loom-uninstall --purge-project-state
  /loom-uninstall --yes
```

## Behavior

### Default (no flags)

Print the removal plan to stdout:

```
This will remove Loom:
  ~/.claude/plugins/loom/
  ~/.loom/
  Loom hook entries from .claude/settings.json AND .claude/settings.local.json

Project state preserved:
  .loom/wiki/ (if present)
  orchestration.toml (if present)
  .plan-execution/ (if present)
```

Then read stdin with a **60-second countdown** rendered on stderr. Only
the single character `y` or `Y` confirms. Any other input — or the 60s
timeout — exits 1 with NO mutation. On timeout, stderr emits:

```
Confirmation timed out after 60s; no changes made.
```

### `--purge-project-state`

After the base prompt confirms, an additional gate is shown on stderr:

```
--purge-project-state will ALSO remove project state. Type the literal
word 'uninstall' to confirm:
```

The user must type the literal `uninstall` (case-sensitive, trimmed of
surrounding whitespace) followed by Enter. Any other input — including
`yes`, `UNINSTALL`, `y`, or an empty line — exits 1 with no project-state
mutation.

### `--dry-run`

Print the full removal preview (the same list shown in the base prompt)
and exit 0 without mutation. No prompts are shown.

### `--yes`

Bypass both prompts. Intended for CI only.

### Settings cleanup

Removes every `hooks/<name>.ts` entry written by
`scripts/register-loom-hooks.ts` from BOTH `.claude/settings.json` AND
`.claude/settings.local.json`. Unrelated hook entries are preserved verbatim.
If both files contain Loom entries (Phase 9A2a's `tier-ambiguous` state),
the dry-run preview lists both files explicitly with their entry counts.

## Implementation

The CLI lives at `scripts/loom-uninstall.ts`. It calls:

- `scripts/lib/uninstall/index.ts` — orchestrator (`buildPlan`,
  `renderPlan`, `executePlan`, `runUninstall`). Pure helpers with DI for
  fs/env/os/streams/scheduler.
- `scripts/lib/uninstall/confirm.ts` — prompt helpers (`confirmBase` with
  the 60s countdown, `confirmTypedLiteral` for the typed gate).

The settings-purge implementation is inline in the orchestrator (mirrors
the regex from `scripts/register-loom-hooks.ts`). A future wiring pass
should expose `purgeLoomEntries` / `commandReferencesHook` from a shared
module so both scripts share one canonical implementation.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success (or dry-run completed) |
| 1 | Aborted (user declined, typed-literal mismatch, or 60s timeout) |
| 2 | Internal error (argv parse failure, runtime exception) |

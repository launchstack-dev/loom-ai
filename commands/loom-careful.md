---
description: Toggle destructive-command guard
---

# /loom-careful

Enables or explains the `loom-careful` PreToolUse hook, which blocks destructive
Bash commands before Claude Code can run them.

## What it blocks

| Pattern | Example |
|---------|---------|
| `rm -rf` against `/`, `~`, `.`, `*` | `rm -rf /tmp/*` (safe) vs `rm -rf ~` (blocked) |
| SQL destructive DDL | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` |
| Force-push / hard-reset | `git push --force`, `git push -f`, `git reset --hard` |
| Wide-open permissions | `chmod -R 777 .` |
| Raw-device writes | `dd if=... of=/dev/sda`, `> /dev/sda1` |
| Filesystem formatters | `mkfs`, `mkfs.ext4` |

When a match fires, the hook emits `{decision: "deny", reason: "..."}`, exit
code 2, and the agent sees error code `CAREFUL_BLOCKED`.

## Override for one command

Prepend the override env var:

```bash
LOOM_CAREFUL_OVERRIDE=1 git push --force
```

## Disable for the session

Set the env var in the shell that spawned Claude Code:

```bash
export LOOM_CAREFUL_OVERRIDE=1
```

## Disable globally

Comment out or remove the `PreToolUse` entry for `hooks/loom-careful.ts` from
`~/.claude/settings.json`, or unregister via `/loom-library` if installed via
kit.

## Contract

- Source: `hooks/loom-careful.ts`
- Registration: `skills/library.yaml` → `library.infrastructure` and
  `library.prompts`
- Error code: `CAREFUL_BLOCKED` (see `PLAN-gstack-adoption.md` § Error Handling)

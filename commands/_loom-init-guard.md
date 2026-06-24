---
description: "Shared init-guard prelude included by every /loom-* command (except /loom-init)."
---

<!--
  Shared init-guard prelude for every `/loom-*` command (except `/loom-init`).

  Every `/loom-*` command MUST embed (by reference) the guard described here
  before performing any project-state mutation. The guard's behavior is
  authoritative in `hooks/lib/init-guard.ts` — this file is the
  human-readable spec authors paste at the top of their command bodies.

  DO NOT modify the prompt text. Tests assert on it byte-for-byte:
    `hooks/lib/init-guard.test.ts` — INIT_GUARD_PROMPT constant.
-->

# Init Guard Prelude

Before doing anything else in a `/loom-*` command body:

1. **Check for initialization.** Read `.loom/plugin-root` relative to the
   current working directory. If the file exists, the project is initialized —
   continue with the command body.

2. **If `.loom/plugin-root` is absent**, invoke the init-guard via
   `hooks/lib/init-guard.ts`. The guard's behavior:

   - If `.loom/dismissed-init-prompt` exists and was written less than 24 hours
     ago (TOON field `dismissedAt`), exit 0 silently — no stdout, no mutation
     of project state.
   - Otherwise, emit the EXACT string below to stdout (newline-terminated),
     write a fresh `.loom/dismissed-init-prompt` marker atomically with
     `dismissedAt` set to the current ISO-8601 timestamp, and exit 0.

     ```
     Loom is not initialized in this project. Run /loom-init to activate.
     ```

3. **Never mutate project state when uninitialized.** No file writes outside
   the dismissal marker, no agent spawns, no scripted side effects. The guard
   is advisory: the user sees the prompt once per 24h and can opt in via
   `/loom-init` when they're ready.

4. **Exception: `/loom-init` itself.** `/loom-init` does NOT invoke this
   guard. It performs its own idempotency check — see `commands/loom-init.md`
   "Step 0a: Idempotency Check".

## Reference implementation

- Source: `hooks/lib/init-guard.ts`
- Exports: `assertInitialized(cwd, opts?, deps?)`, `runInitGuard(cwd, deps?)`,
  `INIT_GUARD_PROMPT` (the canonical prompt string).
- Tests: `hooks/lib/init-guard.test.ts`, `hooks/lib/dismissal-marker.test.ts`.

## Marker file format

`.loom/dismissed-init-prompt` is TOON with a single field:

```toon
dismissedAt: 2026-06-17T12:00:00.000Z
```

Atomic writes: write to `.loom/dismissed-init-prompt.tmp`, then `rename` to
`.loom/dismissed-init-prompt`. See `hooks/lib/dismissal-marker.ts`.

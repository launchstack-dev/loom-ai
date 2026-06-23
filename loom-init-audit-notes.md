# loom-init audit notes (Phase 2 → Phase 3 handoff)

> **Audience:** the Phase 3 author of `commands/loom-init.md` (sole writer per
> Wave 2 ownership resolution). These notes capture what Phase 2 discovered
> about hook-runtime safety and the C-16 PATH dependency so Phase 3 doesn't
> re-derive it.

## C-16: PATH dependency for hook runtime resolution

### What C-16 is

Claude Code subprocesses sometimes inherit a minimal PATH that omits Homebrew's
bin directories — notably when Claude Code is launched from a GUI shortcut,
Finder, cmux, or any non-login-shell context. `bun` lives at
`/opt/homebrew/bin` on Apple Silicon and `/usr/local/bin` on Intel. Without
those on PATH, the hook wrapper's `command -v bun` probe misses and falls
through to `npx tsx`, which on Node 25+ has stricter ESM resolution that fails
to load the tsx loader for hooks' relative `.js` imports. Result: silent
fail-open on every PreToolUse contract enforcer.

### How Phase 2 mitigates it

`hooks/run-hook.sh` (PR #9 wrapper, verified intact in Phase 2):

- **Appends** (not prepends) `/opt/homebrew/bin` and `/usr/local/bin` to PATH
  if those directories actually exist on disk. Append order is deliberate so
  a user's pinned runtime (`mise`/`asdf`/`volta`/`nvm`/`~/.bun/bin`) wins
  over the Homebrew copy. The plan text says "prepend"; the implementation
  appends. The append behavior is the correct one — leave it. Documented
  here so Phase 3 doesn't "fix" it.
- On non-zero exit from the dispatched hook, appends
  `Tip: run /loom-doctor to diagnose hook health` to stderr.
- On no-runtime found (no bun, no node, no npx), writes a fail-loud entry to
  `~/.cache/loom/hook-failures.log` with `hookScriptPath`, the reason, and the
  PATH at failure time.

`scripts/probe-hook-runtime.sh`:

- Invoked by `install.sh` post-install with `env -i HOME=$HOME PATH=/usr/bin:/bin`
  to exercise PR #9's salvage on the user's actual machine. Also runnable
  from the Alpine Docker harness.
- Exits 0 on success, 1 on probe failure, 2 on "skip" (target hook missing).

### What Phase 3's `commands/loom-init.md` needs to do

1. **Run the probe early.** During `/loom-init`, after copying hook templates
   into `<project>/hooks/`, invoke `scripts/probe-hook-runtime.sh` and surface
   any failure with the `/loom-doctor` pointer. The probe is the
   authoritative C-16 health check.

2. **Document the runtime expectation in the generated CLAUDE.md.** When
   `/loom-init` writes a project's CLAUDE.md, include a one-paragraph note that
   Loom hooks require `bun` or `node` on PATH and direct users to
   `/loom-doctor` if SessionStart/PreToolUse hooks ever appear inert.

3. **Do NOT modify `hooks/run-hook.sh` PATH order.** The append (not prepend)
   semantics is intentional. Verify the wrapper exists and is executable —
   that's it.

4. **Reference the fail-loud log path.** `/loom-init` should mention
   `~/.cache/loom/hook-failures.log` in the success output (delegated to
   Phase 5's `marketplace/loom-init-success-output.toon`) so users know
   where to look when something silently fails.

## Test fixture available to Phase 3

`test/fixtures/hook-input.json` ships a minimal Claude Code hook stdin
fixture. Phase 3's integration tests can reuse it as the canonical PreToolUse
payload when exercising `/loom-init`'s post-install probe.

## Migration recipe surfaced by install.sh

When `install.sh` detects an active plugin install it exits 9 with
`INSTALL_CONFLICT_PLUGIN_AND_CURL` and prints:

```
Migration: run `/loom-uninstall` first, then re-run this installer.
```

Phase 3's `/loom-init` should accept the inverse case too: if a user runs
`/loom-init` inside a project whose Loom files were curl-installed and they
later add the plugin, `/loom-init` should warn (not block) and point at
`/loom-uninstall`. The mutual-exclusion contract is one-way enforced at
install time; runtime is advisory.

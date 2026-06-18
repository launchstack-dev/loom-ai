# Plugin Marketplace Rationale — Kit Author Guide

This guide explains **why Loom ships two install paths** (Anthropic plugin marketplace + curl-from-GitHub), and **how to author kits, hooks, and scripts that work cleanly under both**. If you only consume Loom, skim §1 and read [`docs/install-decision-matrix.md`](../../docs/install-decision-matrix.md). If you author kits that other people install, read everything.

---

## 1. Why both paths exist (and neither is going away)

When the Anthropic plugin marketplace shipped, the obvious move would have been to sunset curl and route everything through `/plugin install`. We deliberately chose not to. The Phase 0 plan reconciliation (see `planning/notes/plan-distribution-vs-migration-reconciliation.md`) traded a single-channel story for a **two-channel coexistence** because the audiences are non-overlapping:

| Path | Audience | Tradeoff accepted |
|---|---|---|
| Plugin (`/plugin install loom`) | New users, casual evaluators, default install | Files live under a registry-managed `${CLAUDE_PLUGIN_ROOT}` — you don't edit them in place |
| Curl (`install.sh \| bash`) | Enterprise (MDM-blocked, air-gapped), pinned-version teams, kit authors, contributors | You manage updates explicitly; you can edit regular files in `~/.claude/` |

**Curl is non-sunset.** The decision is documented in the plan: curl supports air-gapped installs, MDM-restricted workstations, version-pinned CI parity, and the local-dev clone workflow that lets contributors edit files and see changes live. None of those are first-class on the plugin path today, and some never will be (air-gap by definition).

The cost we pay for keeping both: every kit, every hook, every script that resolves paths must work under **two different anchor variables**. That's what the rest of this guide covers.

---

## 2. The two anchor variables

Claude Code provides two environment variables that resolve to different roots depending on how Loom was installed:

| Variable | Set by | Points at | Used when |
|---|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Claude Code's plugin loader | The registry-managed plugin directory | Plugin install |
| `${CLAUDE_PROJECT_DIR}` | Claude Code's hook executor | The current project's repo root | Curl install (per-project hook tier) |

Loom's curl install writes per-project hooks anchored against `${CLAUDE_PROJECT_DIR}`. Loom's plugin install ships the same hooks anchored against `${CLAUDE_PLUGIN_ROOT}`. Both forms reach the same file; only the prefix differs.

> ⚠️ Bare relative paths (e.g., `hooks/file-ownership.ts`) fail with exit 127 in both modes, because Claude Code's persistent Bash shell `cd`s into subdirs as agents work. Always anchor.

---

## 3. The resolver helper

The cleanest way to make a hook or script work under both paths is a tiny resolver that picks whichever anchor is defined, with a sane fallback chain:

```bash
# scripts/lib/anchor.sh — POSIX-clean resolver
loom_anchor() {
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf '%s' "$CLAUDE_PLUGIN_ROOT"
  elif [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    printf '%s' "$CLAUDE_PROJECT_DIR"
  else
    # Last resort — repo root via git
    git rev-parse --show-toplevel 2>/dev/null || pwd
  fi
}
```

For TypeScript hooks under `hooks/lib/`:

```ts
// hooks/lib/anchor.ts
export function loomAnchor(): string {
  return (
    process.env.CLAUDE_PLUGIN_ROOT ??
    process.env.CLAUDE_PROJECT_DIR ??
    process.cwd()
  );
}
```

**Fallback order:** `CLAUDE_PLUGIN_ROOT` → `CLAUDE_PROJECT_DIR` → `git rev-parse --show-toplevel` → `pwd`. Plugin always wins when present (the plugin loader sets it for every tool call); project-dir is the curl/per-project fallback; the last two cover oddball invocations like running a hook directly from the shell for debugging.

---

## 4. When to use which anchor in your kit

| Your kit ships… | Anchor to use | Why |
|---|---|---|
| Hooks (`PreToolUse`, `PostToolUse`, etc.) registered into `.claude/settings.json` | The resolver helper | Settings JSON is shared between both install modes; hardcoding either anchor breaks one of them |
| One-shot scripts the user invokes manually (`scripts/foo.sh`) | `${CLAUDE_PROJECT_DIR}` directly | Only meaningful in a project context; the plugin doesn't run scripts at user invocation |
| Plugin-owned bootstrap (template files copied into a project at `/loom-init`) | `${CLAUDE_PLUGIN_ROOT}` directly | These run from the registry-managed root before any project context exists |
| Agent definitions in `.md` (no path resolution needed) | N/A | Agents resolve resources via Claude Code's file tools; no shell anchoring required |

The rule of thumb: **if the file is invoked by Claude Code's hook executor or plugin loader, use the resolver. If it's a script the user runs by hand, anchor explicitly to `${CLAUDE_PROJECT_DIR}`.**

---

## 5. Worked example — a hook that runs from both paths

Say your kit ships a hook that lints TOON files on write. It needs to find a shared TOON parser at `lib/toon-parser.ts` relative to the kit root.

**Step 1.** Author the hook entry point so it can locate itself regardless of anchor:

```ts
// hooks/toon-lint.ts
import { loomAnchor } from "./lib/anchor.ts";
import { join } from "node:path";

const root = loomAnchor();
const parserPath = join(root, "hooks", "lib", "toon-parser.ts");

// ... rest of hook logic ...
```

**Step 2.** Register the hook with the resolver-aware command. Use `${CLAUDE_PLUGIN_ROOT:-${CLAUDE_PROJECT_DIR}}` directly in the `command` field of `settings.json` so the right anchor wins at execution time:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT:-${CLAUDE_PROJECT_DIR}}/hooks/run-hook.sh toon-lint"
          }
        ]
      }
    ]
  }
}
```

**Step 3.** Verify both modes. From a project where Loom is installed via curl, run a Write that should trigger the hook — `$CLAUDE_PROJECT_DIR` resolves to the repo root, the hook finds `hooks/toon-lint.ts`, lint runs. From a project where Loom is installed via the plugin, the same Write fires — `$CLAUDE_PLUGIN_ROOT` resolves to the registry root, the hook finds the same relative path, lint runs.

**Step 4.** Document the dual-anchor in your kit's README so consumers know which anchor will be used in their environment.

---

## 6. Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Hardcoded `${CLAUDE_PROJECT_DIR}` in a hook command | Hook fires under curl, silently no-ops under plugin (env var undefined) | Use `${CLAUDE_PLUGIN_ROOT:-${CLAUDE_PROJECT_DIR}}` |
| Hardcoded `${CLAUDE_PLUGIN_ROOT}` | Same problem, reversed | Same fix |
| Bare relative path (`hooks/foo.ts`) | Exit 127 once Claude `cd`s into a subdir | Anchor with the resolver or env-var fallback |
| Writing files relative to `pwd` | Files land in unpredictable places (whichever dir Claude is in) | Always anchor your writes |
| Assuming plugin path means no project dir | Some plugin invocations DO set `CLAUDE_PROJECT_DIR` (project context exists alongside plugin context) | Always prefer `CLAUDE_PLUGIN_ROOT` first if both are set — the plugin root is where your kit's files live |

---

## 7. Testing your kit against both paths

A minimal smoke test (add to your kit's CI):

```bash
# Test plugin-anchor resolution
CLAUDE_PLUGIN_ROOT=/tmp/fake-plugin-root \
  bash hooks/run-hook.sh your-hook < test-input.json

# Test project-anchor fallback
unset CLAUDE_PLUGIN_ROOT
CLAUDE_PROJECT_DIR=/tmp/fake-project \
  bash hooks/run-hook.sh your-hook < test-input.json

# Test bare-shell fallback (git rev-parse)
unset CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
bash hooks/run-hook.sh your-hook < test-input.json
```

If all three exit 0 (or the same expected non-zero from your hook's logic), your kit works under both install paths.

---

## 8. References

- [`docs/install-decision-matrix.md`](../../docs/install-decision-matrix.md) — when users should pick which path
- [`planning/notes/plan-distribution-vs-migration-reconciliation.md`](./plan-distribution-vs-migration-reconciliation.md) — Phase 0 plan reconciliation
- README §`Hook enforcement (per-project)` — the path-anchoring callout for kit authors
- [Anthropic's hooks docs](https://docs.anthropic.com/en/docs/claude-code/hooks) — upstream reference for hook env vars

---
description: "list, use, sync, update, search, add, remove — pull-on-demand catalog and kit management"
---
# Library Manager

You manage a pull-on-demand catalog of agents, commands, and skills for Loom. The catalog lives at `~/.claude/skills/library/library.yaml` and install state is tracked in `~/.claude/skills/library/install-state.toon`.

## Instructions

$ARGUMENTS

Parse arguments:
- No args or `list`: Show installed items grouped by type with status markers
- `use <name>`: Install item from catalog, resolve dependencies first
- `sync`: Re-pull all installed items, compare content directly
- `search <query>`: Search catalog by name/description substring
- `add <source>`: Add new item (local path or GitHub URL) to catalog
- `remove <name>`: Uninstall, warn about dependents. If `<name>` matches a kit in the `kits:` section of library.yaml, treat as kit removal (see Kit Operations below).
- `update`: Check all sources for changes, show new catalog entries, confirm before applying. If `--check-only` is appended, report what's available without applying.
- `upgrade`: **Deprecated alias for `update`.** Emit a stderr warning when invoked: `warning: '/loom-library upgrade' is a deprecated alias for '/loom-library update'. Use 'update' instead. Note: '/loom-upgrade' (no library prefix) is a different command — it migrates per-project planning artifacts, not the install tree.` Then proceed as `update`. (Gemini PR #19 round 5 finding: the `upgrade` alias collides with the unrelated `/loom-upgrade` command, causing user confusion between per-machine install upgrade and per-project artifact migration. Deprecation prevents accidental misuse without breaking existing invocations.)

When `use` or `remove` receives a name, first check if it matches a kit in the `kits:` section of library.yaml. If it does, dispatch to kit-specific logic (see Kit Operations below). If not, fall through to individual item logic as before.

---

## State Management

Track install state in `~/.claude/skills/library/install-state.toon`:

```toon
schemaVersion: 2
lastSynced: 2026-04-13T18:00:00Z

items[N]{name,type,source,targetPath,installedAt}:
  implementer-agent,agent,agents/implementer-agent.md,~/.claude/agents/implementer-agent.md,2026-04-06T10:00:00Z
  loom-plan,prompt,commands/loom-plan.md,~/.claude/commands/loom-plan.md,2026-04-13T18:00:00Z
  python-conventions,skill,skills/python-conventions/SKILL.md,~/.claude/skills/python-conventions/SKILL.md,2026-06-12T23:30:00Z
```

If install-state.toon does not exist, create it with `schemaVersion: 2`, current timestamp for `lastSynced`, and `items[0]{name,type,source,targetPath,installedAt}:` (empty).

**Migration from v1:** If `schemaVersion: 1` is found (has `contentHash` column), read it normally but ignore the `contentHash` field. On next write, output `schemaVersion: 2` format (without `contentHash`). No manual migration needed.

**Supported `type` values** (open string per `install-state-audit.toon`; no schema bump for adding `skill`): `agent`, `protocol`, `prompt`, `skill`, `infrastructure`. The router in `hooks/lib/skill-router.ts` emits `type: skill` rows via `buildSkillInstallRecord(name, sha256, opts)` — record the value verbatim into the items[] row.

## Source Resolution

Sources in library.yaml are repo-relative paths (e.g., `commands/loom-plan.md`, `agents/contracts-agent.md`). The library uses the GitHub API (via `gh`) for all remote operations.

### Repo Config

The `repo` field in `library.yaml` contains the GitHub repo URL (e.g., `https://github.com/launchstack-dev/loom-ai`). Extract `{owner}/{repo}` from it (e.g., `launchstack-dev/loom-ai`). All `gh api` calls use this.

### Fetching a file

```bash
gh api repos/{owner}/{repo}/contents/{source_path} --jq '.content' | base64 -d
```

If `gh` is not available or not authenticated, fall back to:
```bash
curl --max-filesize 10485760 --max-time 30 --max-redirs 5 -sfSL "https://raw.githubusercontent.com/{owner}/{repo}/main/{source_path}"
```

### Local Path

If a source starts with `/` or `~`, read it directly with the Read tool. No API call needed.

### Source Validation

**Name validation:**
Before constructing any target path, validate `name` via the canonical slug rules in `hooks/lib/wizard-interview.ts`'s `validateSkillSlug` (single source of truth: lowercase kebab-case, `[a-z][a-z0-9-]*`). Reject names containing `/`, `..`, or null bytes.

**Target-path prefix validation (delegated to `hooks/lib/skill-router.ts`):**
After resolving the full target path, validate it via `validateInstallPath(targetPath)` from `hooks/lib/skill-router.ts`. The function returns `{ valid: boolean, reason?: string }` and is the single source of truth for which prefixes are allowed. The current allow-list is exposed as the `ALLOWED_INSTALL_PREFIXES` const in the same module:

- `~/.claude/skills/` — native Claude Code skills (`type: skill` items, written to `<dir>/SKILL.md`)
- `~/.claude/agents/` — Loom agents, prompts/commands (`~/.claude/commands/`) routed via the agent allow-list

If `validateInstallPath` returns `{ valid: false }`, abort the install BEFORE writing any file and emit a `SOURCE_VALIDATION_ERROR` envelope (see Error Handling) using `reason` as the `details` field. Do NOT inline a duplicate prefix list in this markdown — always re-read the const from `skill-router.ts` so the validator and this command never drift.

## Target Paths by Type

When installing, place files based on their type in library.yaml:
- `agents` items -> `~/.claude/agents/<name>.md`
- `prompts` items -> `~/.claude/commands/<name>.md`
- `protocols` items -> `~/.claude/protocols/<name>.md` (legacy `library.skills` items, post-v4 rename per `library-catalog-migrator.ts` v3→v4)
- `skill` items (native Claude Code skill, v4 `library.skills:` section) -> `~/.claude/skills/<name>/SKILL.md` — compute via `buildSkillTargetPath(name)` from `hooks/lib/skill-router.ts`. **The filename MUST literally be `SKILL.md`** (uppercase, no `.md` substitution per item name) — Claude Code's skill activation is keyed off this exact filename, so it is a hard contract, not a suggestion. Do not append `<name>.md`; do not lowercase. The skill body content goes into `<name>/SKILL.md`; siblings (e.g. resource scripts) live in the same directory.
- `infrastructure` items -> use the explicit `target` path from the catalog entry (e.g. `~/.claude/statusline-renderer.cjs`). Expand `~` to the user's home directory. Infrastructure items are NOT `.md` files — preserve the original file extension from the source.

## Dependency Resolution

When installing an item that has `requires: [...]` in library.yaml:

1. Parse each dependency: `agent:name`, `skill:name`, `prompt:name`
2. Check if each dependency is installed (present in install-state.toon)
3. If not installed, install it first (recurse)
4. **Cycle detection**: Maintain a "currently installing" set. If an item already appears in the set, report the cycle and abort.

---

## Command: `list` (default)

1. Read `~/.claude/skills/library/library.yaml`
1b. If the catalog does NOT contain an `infrastructure:` section, append a notice at the end of the output:
   ```
   Your install predates self-updating infrastructure. Upgrade:
     curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
   ```
2. Read `~/.claude/skills/library/install-state.toon` (create if missing)
3. For each catalog item, check whether it appears in install-state. Skip items with `deprecated: true` unless they are installed.
4. Display grouped by type with counts:

```
## Agents (12 installed, 8 available)

  [check] contracts-agent         Wave 0 specialist - creates shared types
  [check] implementer-agent       Parallel worker within file ownership boundaries
  [x]     feature-coverage-agent  Audits plan schema, API surface, features
  ...

## Commands (6 installed)

  [check] loom-plan        Plan operations — create, review, execute, test
  [check] loom-code        Code quality — review, fix
  ...

## Skills (2 installed)

  [check] execution-protocols    Inter-agent protocol schemas
  [check] toon-format-protocol   TOON format specification
```

Use a checkmark for installed items and an x-mark for uninstalled ones.

## Command: `use <name>`

1. Find `<name>` in library.yaml across all type sections (`library.agents`, `library.prompts`, `library.protocols`, `library.skills`, `library.infrastructure`) and in `kits:`.
2. **NOT_IN_CATALOG:** If `<name>` is not found in any section, emit a `NOT_IN_CATALOG` error envelope (see Error Handling) with the exact message:
   ```
   No kit or skill named <name> found in library.yaml. Run /loom-library list to see available entries.
   ```
   Exit code 1. (Substring suggestions may also be printed as a friendly hint, but the structured envelope is the contract.)
3. If the item has `deprecated: true` and a `redirectsTo` field, print: "Note: `{name}` is deprecated. Installing `{redirectsTo}` instead." Then install the redirected item.
4. Resolve dependencies recursively with cycle detection.
5. For each item to install (dependencies first, then the target). Each sub-step lists the explicit operation to perform — these are not abstract verbs but actual Bash / tool invocations the orchestrator MUST run:

   **a. Fetch source content.**
   - Local-path source (`source` starts with `/` or `~`): `Read` tool.
   - Repo source: `gh api repos/{owner}/{repo}/contents/{source} --jq '.content' | base64 -d` (or curl fallback).
   - Hold the content in memory for step d. Do NOT write yet.

   **b. Determine target path.**
   - For `type: skill` items: `targetPath = buildSkillTargetPath(name)` from `hooks/lib/skill-router.ts` → `~/.claude/skills/<name>/SKILL.md` (literal `SKILL.md`).
   - For non-skill types: use the rules from "Target Paths by Type" above.

   **c. Validate target path.**
   - Call `validateInstallPath(targetPath)` (single source of truth in `hooks/lib/skill-router.ts`). If `{valid: false}`, emit `SOURCE_VALIDATION_ERROR` envelope (see Error Handling) and abort BEFORE any disk write. Exit code 1.

   **d. Write content atomically.**
   - For `type: skill` items: first `Bash: mkdir -p ~/.claude/skills/<name>/` to ensure the parent directory exists (Claude Code requires the literal `<name>/SKILL.md` layout).
   - Write the in-memory content via `Write` tool. The `Write` tool is the canonical atomic writer for this command — do NOT shell out to `cat > file` or `echo > file`.
   - For non-skill items the parent directory (`~/.claude/agents/`, `~/.claude/commands/`, etc.) is assumed to exist; no `mkdir` needed.

   **e. Compute sha256 + build install-state row.**
   - `Bash: shasum -a 256 "<targetPath>" | awk '{print $1}'` — capture the 64-char hex hash.
   - For `type: skill` items: build the install-state row via `buildSkillInstallRecord(name, sha256, { installedAt: new Date().toISOString(), source: 'skills/<name>/SKILL.md' })` from `hooks/lib/skill-router.ts`. Returns the canonical `{ name, type: 'skill', source, targetPath, sha256, component, installedAt }` shape.
   - For non-skill items: construct the row inline with the same fields (`type` verbatim — `agent`, `prompt`, `protocol`, `infrastructure`).

   **f. Append row to `install-state.toon`.**
   - Read `~/.claude/skills/library/install-state.toon` (TOON format, schema v3).
   - The `items[N]{name,type,source,targetPath,sha256,component,installedAt}:` array has its element count `N` in the header. Increment `N` by 1.
   - Append the new row beneath the existing rows, preserving 2-space indent and column order. Each field comma-separated, no trailing comma.
   - Write back atomically: write to `install-state.toon.tmp`, then `mv install-state.toon.tmp install-state.toon`. NEVER overwrite the file in place — a partial write corrupts the entire install state.
   - `lastSynced` field at the top of the file is updated in step 6 below.
6. Update `lastSynced` timestamp in install-state.toon.
7. **Post-install session-restart notice (skill items only).** After every successful `type: skill` install, print this notice to stdout — verbatim, one line, exactly as written here so harness/test scrapers can grep for it:
   ```
   Skill <name> installed. Restart your Claude Code session for trigger activation to take effect.
   ```
   Substitute `<name>` with the actual skill name. This notice is required because Claude Code only scans `~/.claude/skills/` at session start; a freshly installed `SKILL.md` is dormant until the session restarts.
8. Display summary:
```
Installed contracts-agent
  Dependencies: execution-protocols (already installed)
  Target: ~/.claude/agents/contracts-agent.md
```

## Command: `sync`

`sync` brings `~/.claude/` up to date. It auto-detects which install pattern is in use and runs the matching reconciliation. Two patterns are supported:

- **Curl install** — `~/.claude/skills/library/library.yaml` is a regular file. The install tree is a copy of `main` fetched at install time; sync re-pulls each tracked item from its source.
- **Local-dev install** — `~/.claude/skills/library/library.yaml` is a symlink to a local checkout (typically a `git clone` of the Loom repo). The install tree is symlinks pointing at the checkout; sync reconciles the symlink set against what's on disk in the checkout.

**Pattern detection (first step of every sync run):**

1. Inspect `~/.claude/skills/library/library.yaml`. If it is a symlink, resolve it to its **absolute** target path (use `fs.realpath` or shell `readlink -f`, NOT bare `readlink`) — relative symlinks like `../../loom-ai/skills/library.yaml` resolve correctly to `/Users/foo/.loom-ai/skills/library.yaml` rather than being interpreted against the current working directory. (Gemini PR #19 round 3 finding.)
2. Derive `checkoutRoot` by stripping the trailing `skills/library.yaml` (two path segments) — e.g. `/Users/foo/.loom-ai/skills/library.yaml` → `checkoutRoot = /Users/foo/.loom-ai`.
3. Validate `checkoutRoot` is a Loom checkout by checking that BOTH `${checkoutRoot}/commands/` and `${checkoutRoot}/agents/` exist as directories. If either is missing, fall back to `installPattern = curl` (the symlink points somewhere unexpected — don't assume local-dev semantics).
4. If validation passes, set `installPattern = local-dev`. If `library.yaml` is a regular file, set `installPattern = curl`. If `library.yaml` does not exist at all (no symlink, no regular file), abort with exit code `2` and stderr `error: library catalog missing at ~/.claude/skills/library/library.yaml — run install.sh or restore the symlink to a local checkout` — the install isn't bootstrapped, and falling through to curl mode would just fail again at the install-state read in Branch A. (Gemini PR #19 finding.)
5. Print the detected pattern at the top of the sync output, e.g. `Detected install pattern: local-dev (checkout: /Users/foo/.loom-ai)`.

**No mutations without confirmation.** Both branches require explicit confirmation before changing anything on disk, but the gate differs by branch:

- **Curl branch:** interactive `yes / no / select individually` prompt after the diff is shown. Existing behavior — preserved verbatim.
- **Local-dev branch:** `--apply` flag (dry-run by default; without `--apply`, the command prints the reconciliation plan and exits 0). The flag-gate matches the local-dev branch's batch nature (often 10–100 file mutations per run, where an interactive prompt per item is impractical).

**Pre-check — Infrastructure bootstrap detection (curl branch only):**
1. Read `~/.claude/skills/library/library.yaml`
2. If the catalog does NOT contain an `infrastructure:` section, this is a pre-v2 install. Print the re-install prompt (same as `list`). Continue with sync.

---

### Branch A: curl install (`installPattern == curl`)

Existing behavior — re-pull tracked items from their sources:

1. Read install-state.toon
2. For each installed item:
   a. Fetch current source content from repo (handle missing sources gracefully)
   b. **Symlink safety check**: if the target path is a symlink (any symlink, regardless of where it points), classify this item as `[link] {name} — symlinked, no write needed` and SKIP it. Writing through a symlinked target silently overwrites whatever the link points to — could be a dev-install pointing back to a Loom repo checkout, could be a user-managed dotfiles target, could be anything. The link's existence is the signal that the user (or their tooling) is managing this path themselves; sync defers to them. (In curl mode this safety check is a defensive belt-and-suspenders; local-dev mode is handled by Branch B below, not here.)
   c. Read the installed target file.
   d. Compare source and target byte-for-byte. If they differ, the item needs updating.
3. Report results:
```
Checking 18 installed items...

  [rotate] implementer-agent       source changed
  [check]  contracts-agent         up to date
  [x]      old-agent               source not found

2 items need updating, 1 source missing.
Update now? (yes / no / select individually)
```
4. If the user approves via the interactive prompt: for each changed item, write the fetched source content to the target path. Update `lastSynced` in install-state.toon. (Note: the curl branch uses interactive approval, NOT the `--apply` flag — `--apply` is the local-dev branch's gate. Gemini PR #19 finding.)
5. For missing sources, ask whether to remove them from install-state.

---

### Branch B: local-dev install (`installPattern == local-dev`)

Reconcile `~/.claude/` against the live local checkout. No fetch happens — the checkout is the source of truth, and `git pull` is the user's responsibility before invoking `sync`.

**Allow-list of paths the local-dev branch reconciles** (under `${checkoutRoot}`):

- `commands/loom*.md` → `~/.claude/commands/` — note the **single-glob form** (no hyphen between `loom` and `*`). This matches BOTH `commands/loom.md` (the root dispatcher) AND `commands/loom-*.md` (the noun commands like `loom-plan.md`). The earlier hyphen-bearing pattern `commands/loom-*.md` would have silently excluded `commands/loom.md` — caught by Gemini PR #19 re-review.
- `commands/loom-*/**/*.md` — **recursive descent** under any `loom-*/` subdirectory. Covers depth-2 files (`commands/loom-plan/create.md`), depth-3 files (`commands/loom-auto/links/execute.md`), and any deeper nesting that arrives later. Verified against the live checkout: 12 files at depth 2, 3 files at depth 3 (under `loom-auto/links/`). → `~/.claude/commands/{relpath}/`
- `agents/*.md` → `~/.claude/agents/`
- `protocols/*.md` → `~/.claude/protocols/`
- `skills/library.yaml` → `~/.claude/skills/library/library.yaml` (already symlinked; verified, not re-created)
- `skills/*/SKILL.md` → `~/.claude/skills/{name}/SKILL.md` — native Claude Code skills under `skills/{name}/` (e.g. `skills/python-conventions/SKILL.md`). Gemini PR #19 round 4 finding: without this row, native skills installed by `/loom-library use <kit>` stay as stale regular files even when the rest of the env is in local-dev mode. Excludes `skills/library.yaml` (the catalog, handled above).

The recursive glob on subcommand dirs is intentional: it auto-covers any new subcommand tree added upstream (e.g. a future `commands/loom-upgrade/sync.md` or new files under `commands/loom-auto/{links,phases}/`) without a spec update. The same gap that the smoke-test surfaced for `plan-critic-agent` doesn't repeat for subcommand files. **Implementation note:** when expanding the recursive glob, ensure each intermediate directory under `~/.claude/commands/` exists (`mkdir -p` on the parent of each leaf symlink) before creating the symlink itself — depth-3+ leaves need `loom-auto/links/` etc. to exist first.

Hooks (`~/.claude/statusline-renderer.cjs`, etc.) are NOT reconciled — they are runtime-loaded at session start and the local-dev pattern leaves them as install.sh copies. The user can re-run `install.sh` if a hook file changes upstream (rare).

**Steps:**

1. **Detect each file's current state.** For every source file in the allow-list above, classify the corresponding `~/.claude/{relpath}`:
   - `SYMLINK-OK` — `~/.claude/{relpath}` is a symlink pointing at `${checkoutRoot}/{relpath}` (the expected target). No action.
   - `SYMLINK-WRONG` — symlink, but points somewhere else (e.g. a different checkout, a stale path). Action: `--apply` removes the wrong symlink and creates the correct one.
   - `STALE-COPY` — `~/.claude/{relpath}` is a regular file. In local-dev mode, every regular file under the allow-list IS a stale install.sh copy by definition — the two install patterns are mutually exclusive, so a regular file here predates the user's switch to local-dev. Action: `--apply` removes the regular file and creates a symlink to `${checkoutRoot}/{relpath}`. The dry-run preview (which always runs before `--apply`) is the user's safety net; they can inspect each STALE-COPY entry before mutating.
   - `MISSING` — `~/.claude/{relpath}` does not exist. Action: `--apply` creates a symlink.

2. **Detect orphaned symlinks.** For every existing symlink under `~/.claude/agents/`, `~/.claude/commands/`, and their subdirectories: if the symlink target does not exist (upstream removed the file), classify as `ORPHAN`. Action: `--apply` removes the broken symlink.

Note: an earlier draft of this spec included a `CONFLICT` classification that flagged any regular file whose content differed from the checkout. That heuristic is wrong — curl-installed files ALWAYS differ from the local checkout (curl pulls `main`, the checkout may be ahead/behind), so the heuristic would have classified every legitimate STALE-COPY as a conflict and refused to convert it. The local-dev pattern's contract is that the checkout IS the source of truth; users with hand-edits to `~/.claude/` files should commit those edits to the checkout first.

3. **Report a diff summary.** Group by action, count each bucket:
```
Detected install pattern: local-dev (checkout: /Users/foo/.loom-ai)

Reconciliation plan (dry-run; pass --apply to mutate):
  STALE-COPY → SYMLINK   17 files (existing install.sh copies will be replaced with symlinks)
  MISSING → SYMLINK       3 files (new files in the local checkout)
  SYMLINK-WRONG → FIX     0 files (symlinks pointing at a different target than expected)
  ORPHAN-REMOVE           1 file  (symlink targets gone upstream)
  SYMLINK-OK             87 files (already correct, no action)

Run with --apply to execute.
```

4. **Execute on `--apply`.** Iterate the action list; for each `STALE-COPY` / `MISSING` / `SYMLINK-WRONG`:
   1. `rm -f {target}` (removes a stale copy, a wrong symlink, or no-ops on MISSING — safe in all three cases).
   2. `mkdir -p $(dirname {target})` — required for depth-3+ leaves like `~/.claude/commands/loom-auto/links/execute.md` where the parent directory may not exist yet. Without this, `ln -s` fails with `No such file or directory`. (Gemini PR #19 finding.)
   3. `ln -s ${checkoutRoot}/{relpath} {target}`.
   For each `ORPHAN`, `rm -f {target}` only — no replacement.

5. **Safety guarantees:**
   - The `rm -f` step uses the explicit absolute path of the `~/.claude/` entry; it never follows a symlink during deletion (`rm -f` on a symlink removes the link itself, not its target — verified by every standard `rm(1)` implementation).
   - The allow-list is the only place sync writes; it never touches `~/.claude/skills/{name}/SKILL.md` (Claude Code's native-skill area), `~/.claude/hooks/`, `~/.claude/config/`, `.git/`, or any other unrelated path.

6. **Update `install-state.toon` to mirror the reconciled symlink set.** After `--apply` completes successfully, rewrite `install-state.toon` so `list` and `status` (which both read this file as their sole source of truth) correctly report the symlinked items as installed. (Gemini PR #19 finding: without this, `/loom-library list` would show NO items installed on a local-dev env even though dozens of symlinks exist.)

   - For each leaf in the allow-list (**excluding `skills/library.yaml`** — that file IS the catalog, not an installed item; Gemini PR #19 round 3 finding) that is now a `SYMLINK-OK` (was-OK or newly-applied), add or update its row in `items[]` with **all 7 v3 schema columns** (`name,type,source,targetPath,sha256,component,installedAt` per `install-state.schema.md`; Gemini PR #19 round 4 finding — writing only 5 columns would mismatch the v3 header at line 172 and corrupt the file):
      - `name` and `type` resolved per the rules below
      - `source` set to the checkout-relative path (e.g. `commands/loom-plan/create.md`)
      - `targetPath` set to the `~/.claude/` symlink path
      - `sha256` set to SHA-256 of the file at `${checkoutRoot}/{source}` (use `shasum -a 256` or `crypto.createHash('sha256')` against the file the symlink points TO, not the symlink itself — matches the curl-install semantics where sha256 tracks installed content)
      - `component` resolved by catalog lookup when available (read the entry's `component` field if present in `library.yaml`); for non-catalog leaves (subcommand sub-files, root dispatcher), default to `"loom-core"` — the component identifier the canonical schema uses for first-party Loom files
      - `installedAt` set to the current run timestamp

   **install-state.toon schema-version handling** (Gemini PR #19 round 5 finding — pre-existing spec inconsistency surfaced here):

   This file has two schema-version references that have drifted: the `State Management` section (lines 30-44) describes schemaVersion 2 with 5 columns; the `use` section (line 172) and this `sync` Branch B both write the v3 7-column form (which is what `install-state.schema.md` documents as current). `install.sh` currently bootstraps with v2.

   On any `sync` invocation (curl OR local-dev), before writing, read the current `schemaVersion`:
   - `schemaVersion: 1` (legacy contentHash): migrate per the "Migration from v1" note in State Management — read fields, ignore contentHash, write as v3.
   - `schemaVersion: 2`: migrate per `install-state.schema.md § v2 → v3 migration` (best-effort sha256 from each existing item's targetPath; component = "loom-core"). Write as v3.
   - `schemaVersion: 3`: write as v3 verbatim.

   In all three cases the file on disk after `sync --apply` is schemaVersion 3 with the 7-column items[] header. This collapses the v2/v3 drift each time `sync` runs without requiring a separate `/loom-upgrade` step. (Follow-up: align `install.sh` and the State Management section to v3 in a separate PR. Out of scope for this docs PR; tracked here so the implementer knows the migration belongs in `sync`.)

   **`name` and `type` resolution rules** (in priority order — Gemini PR #19 round 3 finding: progressive-disclosure sub-files like `commands/loom-plan/create.md` AND `commands/loom-roadmap/create.md` have identical filenames; deriving `name` from filename alone would cause collisions, overwriting entries in install-state.toon):

   1. **Catalog lookup by `source` path first.** If the file's checkout-relative path matches the `source` field of an entry in `library.yaml`, use that entry's `name` and declared section (`agents:` → `agent`, `protocols:` → `protocol`, `prompts:` → `prompt`, `skills:` → `skill`). This is the authoritative source for any file the catalog tracks.

   2. **Fallback for files NOT in the catalog** (subcommand sub-files, dispatcher files like `loom.md`, etc.):
      - **Name derivation:** Derive a unique name from the relative path by stripping the leading top-level dir (`commands/`, `agents/`, or `skills/`) and `.md` suffix, then replacing remaining slashes with hyphens. Examples: `commands/loom-plan/create.md` → `loom-plan-create`; `commands/loom-roadmap/create.md` → `loom-roadmap-create` (no collision); `commands/loom.md` → `loom`; `commands/loom-auto/links/execute.md` → `loom-auto-links-execute`.
      - **Type inference:**
        - `commands/**/*.md` → `prompt`
        - `protocols/**/*.md` → `protocol`
        - `agents/**/*.md` (excluding `protocols/`) → `agent`
        - `skills/**/SKILL.md` → `skill`

   3. If neither rule applies (the file is in the allow-list but its path doesn't match any inference rule), log a warning `unknown type for {relpath}; defaulting to prompt` and use `prompt`. This is a never-should-happen safety case — the allow-list and the inference rules are designed to be exhaustive for the same paths.
   - For each `ORPHAN` removed, drop its row from `items[]`.
   - Set `lastSynced` to the wall-clock time of the run.
   - Use atomic write per `execution-conventions.md` (write to `{path}.tmp`, then `rename`).

   The `installedAt` field semantics: in curl-install mode it records when the file was last fetched from main; in local-dev mode it records when the symlink was last reconciled. Both are wall-clock timestamps tied to a `sync` operation; the divergence in meaning is acceptable for `list`/`status` purposes, which only read it to display "installed since X".

---

### After either branch

Print a one-line wrap-up: `Sync complete. {N} files updated, {M} unchanged.` Exit code: `0` on success or on dry-run-with-changes-pending; `1` if `--apply` failed mid-run (e.g., permission error on `rm` or `ln`); `2` if the install-pattern detection failed (e.g., library.yaml itself is missing).

## Command: `search <query>`

1. Read library.yaml
2. Filter items where name OR description contains the query (case-insensitive). Exclude `deprecated: true` items from results.
3. Display matches with installed status (check install-state.toon)
4. If no matches, say so and suggest broadening the query

## Command: `add <source>`

All classification logic for this command lives in `hooks/lib/library-add-heuristic.ts`. The markdown below is the wiring + UX layer only — it MUST NOT duplicate any of the heuristic's decision rules. The heuristic's exports consumed here are: `classifyAddSource(filePath, content) -> {type, reason}`, `formatAmbiguousPrompt(filePath) -> string`, and `formatDeprecationWarning(name, resolvedType) -> string` (the latter is consumed by the installer's bare-name resolver — see Kit Operations / Error Handling — and is documented here so the installer and add-flow share one wording surface).

1. Determine source location:
   - Starts with `/` or `~` -> local path
   - Starts with `https://github.com` -> GitHub URL (resolve via repo config)
   - Otherwise -> ask user to clarify
2. Read the file content (local `Read` tool or GitHub fetch). The heuristic is pure-function: the caller (this command) is responsible for the I/O. Pass both the resolved `filePath` and the in-memory `content` into the heuristic.
3. Classify the source by calling `classifyAddSource(filePath, content)` from `hooks/lib/library-add-heuristic.ts`. The function returns `{type, reason}` where `type` is one of `skill | protocol | agent | prompt | ambiguous`.

   For the canonical signal cascade and classification priorities, see `hooks/lib/library-add-heuristic.ts` — DO NOT duplicate the rules here.

4. If `type === 'ambiguous'`:
   a. Call `formatAmbiguousPrompt(filePath)` from `hooks/lib/library-add-heuristic.ts` to obtain the prompt text. The returned string includes the lines `[1] skill`, `[2] protocol`, and `[q] abort`, plus the canonical one-sentence descriptions:
      - `[1] skill` — "activates automatically on matching file patterns via Claude Code (SKILL.md format)"
      - `[2] protocol` — "inter-agent message schema used by Loom orchestration"
      - `[q] abort`
   b. Display the returned prompt verbatim to the user. Do NOT reformat or rewrap — Phase 4 tests pin the exact line shapes (bt-4-45..47).
   c. Read the user's selection. On `1` -> proceed with `type = skill`. On `2` -> proceed with `type = protocol`. On `q` (or any non-`1`/`2`) -> abort the add with a one-line notice; make no changes to `library.yaml`.

5. Derive a suggested name from the filename (strip directory and extension). Validate `name` via the canonical slug rules in `hooks/lib/wizard-interview.ts`'s `validateSkillSlug` (single source of truth: lowercase kebab-case, `[a-z][a-z0-9-]*`). If not valid, sanitize by replacing invalid characters with `-` and confirm with user.

6. Confirm the final `name` and `type` with the user. Display `reason` from the `ClassificationResult` as one-line context (e.g. "frontmatter `triggers:` is present and non-empty"). The user MAY override `type`; if they choose a type that the heuristic did not return, log a one-line notice but proceed.

7. Append the new entry to the appropriate section in `skills/library.yaml` (`library.skills:`, `library.protocols:`, `library.agents:`, or `library.prompts:`) per the confirmed `type`. Use typed-include form going forward — do NOT recommend bare-name includes in newly authored kits. See Kit Operations § Includes resolution for the bare-name deprecation path.

8. Ask if the user wants to install immediately via `/loom-library use <name>`.

### Deprecation-warning hook (cross-reference)

When `/loom-library use <bare-name>` (or a kit's bare-name `includes:` entry) resolves a name via cross-section fallback, the installer calls `formatDeprecationWarning(name, resolvedType)` from `hooks/lib/library-add-heuristic.ts` to obtain the user-facing message. The wording follows the N-24 template — it references the bare name, the resolved type, the recommended typed form (e.g. `skill:python-conventions`), and explicitly states that bare-name support is removed in library catalog v5. Authors of new `library.yaml` entries SHOULD prefer the typed form (`{type: skill, name: ...}` or `skill:...`) at insert time (step 7 above) so newly added entries never trigger the deprecation surface.

### Logic-location guarantee

The classification rules above (triggers-first, AgentResult markers, $ARGUMENTS, agent-style markers, ambiguous fallback), the ambiguous-prompt copy, and the deprecation-warning template all live in `hooks/lib/library-add-heuristic.ts`. The markdown only wires the function calls and renders their string outputs to the user. If a future change to the rules is required, edit the .ts module and update the Phase 4 unit tests in `test/library-add-heuristic.test.ts` — never modify the rule text in this file.

## Command: `remove <name>`

1. Find `<name>` in install-state.toon. If not found, report and stop.
2. Check if any other installed item depends on this one (scan library.yaml `requires` fields for items present in install-state)
3. If dependents exist, warn:
```
Cannot remove execution-protocols -- required by:
  - contracts-agent
  - implementer-agent
  - wiring-agent

Remove anyway? (yes / no)
```
4. If confirmed (or no dependents):
   a. **For `type: skill` items**, compute the remove plan via `buildSkillRemovePlan(name)` from `hooks/lib/skill-router.ts`. The plan is:
      ```
      { skillMdPath: '~/.claude/skills/<name>/SKILL.md',
        parentDir:   '~/.claude/skills/<name>/',
        pruneIfEmpty: true }
      ```
      Delete `skillMdPath` via Bash `rm`. Then, because `pruneIfEmpty` is true, the orchestrator MUST also remove the parent directory if it contains no remaining files (use `rmdir` — never `rm -rf`, so siblings the user added by hand are preserved). If the parent directory still has siblings, leave it in place and log a one-line notice (`Parent dir kept — N sibling files remain`).
   b. **For non-skill items**, delete the target file via Bash `rm` as before.
   c. Remove the entry from install-state.toon (update items array and count)
   d. Report what was removed

## Command: `update`

**Pre-check — Infrastructure bootstrap detection:**
Same check as `sync` above. If the local catalog has no `infrastructure:` section, print the re-install prompt.

**Step 0 — Catalog self-update:**
1. Extract `{owner}/{repo}` from the `repo` field in local `library.yaml`
2. Fetch remote `library.yaml`: `gh api repos/{owner}/{repo}/contents/skills/library.yaml --jq '.content' | base64 -d`
3. If fetch succeeds and content is valid (contains `catalog_version:`), overwrite `~/.claude/skills/library/library.yaml` with the fetched content
4. Report: `Catalog updated` or `Catalog is current`

**Step 1 — Check installed items:**
1. Run the same comparison as `sync` (fetch source, compare to target byte-for-byte)
2. Additionally, scan library.yaml for items NOT in install-state and not `deprecated: true` (new catalog entries)
3. Include `infrastructure` items in both checks
4. Display all sections:
```
## Catalog
  Catalog updated

## Changed items
  [rotate] implementer-agent  source changed

## Infrastructure
  [rotate] statusline-renderer  renderer updated
  [check]  statusline-command   up to date

## New in catalog
  [new] loom-wiki             Wiki management — ingest, lint, query, status
  [new] loom-agent            Agent management — create, list

Update changed items? (yes / no)
Install new items? (yes / all / select / no)
```

**If `--check-only` flag is present:** Display the report above but do NOT apply any changes. Skip steps below.

**Step 2 — Apply:**
Process user choices: update changed items and/or install selected new items using the same logic as `use`.

**Step 3 — Clear update cache:**
After successfully applying updates, delete `~/.cache/loom/update-check.toon` via Bash `rm -f ~/.cache/loom/update-check.toon`. This resets the statusline update indicator.

## Command: `status`

Read-only inventory of installed resources, grouped by the kit that pulled them in. Exit code is always 0 — `status` never modifies state.

1. Read `~/.claude/skills/library/install-state.toon` (treat missing file as empty inventory)
2. Read `~/.claude/skills/library/library.yaml`
3. For each `items[]` entry in install-state.toon, look up which kit(s) in `library.yaml` `kits:` reference it via `includes:` (entry may be a typed `{type, name}` or a legacy bare-name string — see Kit Operations § Includes resolution). An item not referenced by any kit is grouped under the synthetic kit name `(standalone)`.
4. For each `type: skill` row, also look up the matching `library.skills[]` entry by name and read its `triggers:` array (introduced by the v4 catalog schema). If `triggers` is absent or empty, display `(description-based)` in the triggers column — Claude Code falls back to the skill's description when no explicit triggers are declared.
5. For non-skill rows, leave the triggers column blank (`—`).
6. Render the table (one row per installed resource, grouped by kit, sorted by kit then by name):

```
KIT                 RESOURCE                 TYPE     TARGET PATH                                              TRIGGERS
data-engineering    data-schema-reviewer     agent    ~/.claude/agents/data-schema-reviewer.md                 —
data-engineering    data-quality-gate        agent    ~/.claude/agents/data-quality-gate.md                    —
loom-core           contracts-agent          agent    ~/.claude/agents/contracts-agent.md                      —
loom-core           loom-plan                prompt   ~/.claude/commands/loom-plan.md                          —
loom-core           execution-protocols      protocol ~/.claude/protocols/execution-protocols.md        —
python-kit          python-conventions       skill    ~/.claude/skills/python-conventions/SKILL.md             "polars", "pyproject.toml", "uv"
(standalone)        my-local-skill           skill    ~/.claude/skills/my-local-skill/SKILL.md                 (description-based)
```

7. After the table, print a one-line footer with totals:
```
6 items installed across 3 kits + 1 standalone.
```

Exit code: **0** (always — read-only command).

---

## Kit Operations

Kits are named bundles of related items defined in the `kits:` section of library.yaml. Each kit entry has: `name`, `description`, `version`, `minLoomVersion`, and `includes` (a list of item references — see Includes resolution below).

### Includes resolution (typed form + legacy bare-name)

Each entry in a kit's `includes:` list is parsed via `parseIncludeEntry(entry)` from `hooks/lib/skill-router.ts`, which returns `{ type, name, bare }`:

- **Typed form** (preferred, required in v5): `{type: skill, name: python-conventions}` or `{type: agent, name: contracts-agent}` — `bare: false`. Route directly to `library.<type>[]` for source lookup and target-path resolution. No warning emitted.
- **Bare-name form** (legacy, deprecated): a plain string like `python-conventions` or `agent:contracts-agent`. `parseIncludeEntry` returns `bare: true` for plain strings. The installer then calls `resolveBareNameInclude(name, catalog)` (also in `skill-router.ts`) which walks sections in priority order — `BARE_NAME_PRIORITY = [agent, protocol, skill, prompt]` — and returns the first hit as `{ type, name }` (or `null`). When resolution succeeds, the installer MUST emit a `DEPRECATION_WARNING` (see Error Handling) using the N-24 template before continuing the install. When resolution returns `null`, raise `NOT_IN_CATALOG`.

`BARE_NAME_PRIORITY` is the single source of truth for the resolution order — do not re-encode it in this markdown. Re-read it from `hooks/lib/skill-router.ts` if you need to confirm.

The colon-prefixed legacy form (`agent:name`, `skill:name`) is still accepted for backward compatibility; the parser strips the prefix and treats the result as typed. Pure bare names with no prefix trigger the cross-section walk.

### `use <kit-name>` (when name matches a kit)

1. Read library.yaml `kits:` section, find the kit by name.
2. Check `minLoomVersion` against the local `catalog_version` in library.yaml. If the kit requires a higher version, warn:
   ```
   Kit <kit-name> requires Loom catalog version <N>, you have <M>. Install anyway? (yes/no)
   ```
   If the user declines, abort.
3. Install all items in the kit's `includes` list sequentially, showing progress:
   ```
   [1/6] Installing data-schema-reviewer...
   [2/6] Installing data-quality-gate...
   ```
4. Each item is installed using the existing `use` logic (source resolution, dependency resolution, target path, write). Items already present in install-state.toon are skipped with a note: `[3/6] data-lineage-tracker — already installed, skipping`.
5. After all items are installed, show a kit-level summary:
   ```
   Installed <kit-name> kit: 6 items (5 agents, 1 command)

   To activate kit agents in your project's pipelines, add to .claude/orchestration.toml:
     See the kit's suggested config at: kits/<kit-name>/orchestration-fragment.toml
     Or run: /loom-agent create --from ~/.claude/agents/<first-agent-in-kit>.md
   ```
6. If any item fails to install, report which succeeded and which failed. Do not roll back successful items — leave them installed. The kit is in a partial state. Suggest: `loom-library use <kit-name>` to retry (it will skip already-installed items).

### `list` (kit section)

After the existing type sections (Agents, Commands, Skills), add a **Kits** section.

A kit is **installed** if ALL items in its `includes` list are present in install-state.toon. If only some are installed, show as **partial**. If none are installed, show as **available**.

```
## Kits (1 installed, 0 available)

  [check] data-engineering    v1.0.0  Data pipeline quality gates, schema review, lineage tracking  (6 items)
  [x]     ml-ops             v1.0.0  Machine learning model training, evaluation, deployment       (4 items)
```

Partial kit display:
```
  [~]     data-engineering    v1.0.0  Data pipeline quality gates (3/6 items installed)
```

### `list --kits`

Show ONLY the Kits section (skip Agents, Commands, Skills).

### `remove <kit-name>` (when name matches a kit)

1. Find the kit in library.yaml `kits:` section.
2. For each item in the kit's `includes` list, check if it also appears in another **installed** kit's `includes` list.
3. If shared items are found, warn for each:
   ```
   data-schema-reviewer is also used by kit ml-ops. Remove anyway? (yes/no)
   ```
   If the user declines for a shared item, skip it and continue with the rest.
4. Remove items one by one using the existing `remove` logic (delete target file, update install-state.toon). Show progress:
   ```
   [1/6] Removing data-schema-reviewer...
   [2/6] Removing data-quality-gate...
   ```
5. If any removal fails (file locked, permission error), report what was removed and what failed. Leave install-state.toon consistent with what is actually on disk.
6. On partial failure, suggest: `loom-library remove <kit-name>` to retry failed items.

---

## Error Handling

- **Missing library.yaml**: Report that the catalog is not found. Suggest running install.sh or checking `~/.claude/skills/library/library.yaml`.
- **Missing source file**: Report which item has a missing source. For `sync`/`update`, mark it and continue checking others.
- **gh not available**: Fall back to curl for fetching. If curl also fails (private repo), print: "Install gh for private repo support: https://cli.github.com/"
- **Network errors**: Report the error, skip the item, continue with others. Never block the entire command on a single fetch failure.
- **Write failures**: Report the target path and error. Do not update install-state for that item.
- **Corrupt install-state.toon**: If the file exists but cannot be parsed, back it up as `install-state.toon.corrupt`, create a fresh empty state, and warn: "Install state was corrupt and has been reset. Run `/loom-library sync` to rebuild."
- **`NOT_IN_CATALOG`**: emitted when `/loom-library use <name>` references a name that does not exist in any `library.<resource>:` section or in `kits:`, OR when a bare-name include in a kit cannot be resolved via `resolveBareNameInclude` (every section walked, no hit).
  Message template (exact):
  ```
  No kit or skill named <name> found in library.yaml. Run /loom-library list to see available entries.
  ```
  TOON envelope:
  ```toon
  status: error
  code: NOT_IN_CATALOG
  message: "No kit or skill named <name> found in library.yaml. Run /loom-library list to see available entries."
  details: checkedName: <name>, suggestedCommand: /loom-library list
  ```
  Exit code: **1**. Not retryable — fix the name or run `/loom-library list`.
- **`SOURCE_VALIDATION_ERROR`**: emitted when `validateInstallPath(targetPath)` (from `hooks/lib/skill-router.ts`) returns `{ valid: false }`. Use the returned `reason` as the `details` field of the TOON envelope. Abort BEFORE writing any file. Exit code: **1**. Not retryable — fix the kit definition.
- **`DEPRECATION_WARNING`** (warning, not thrown): emitted when a kit's `includes:` entry is a legacy bare-name string that `resolveBareNameInclude` successfully resolved via the cross-section fallback. The installer continues — this is informational, not fatal. The exact template message (per N-24, single source of truth lives in `formatDeprecationWarning(name, resolvedType)` in `hooks/lib/library-add-heuristic.ts`):
  ```
  DEPRECATION WARNING: bare-name include '<name>' resolved to <type>:<name> via cross-section fallback. Update your kit to use the typed form (e.g. <type>:<name>) before v5. Bare-name support will be removed in library catalog v5.
  ```
  Substitute `<name>` with the include name and `<type>` with the resolved type (e.g. `agent`, `skill`, `protocol`, `prompt`). Log to stderr; do not affect exit code.

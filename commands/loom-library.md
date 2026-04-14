---
description: "list, use, sync, update, search, add, remove — pull-on-demand catalog management"
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
- `remove <name>`: Uninstall, warn about dependents
- `update`: Check all sources for changes, show new catalog entries, confirm before applying. If `--check-only` is appended, report what's available without applying.
- `upgrade`: Alias for `update` (convenience)

---

## State Management

Track install state in `~/.claude/skills/library/install-state.toon`:

```toon
schemaVersion: 2
lastSynced: 2026-04-13T18:00:00Z

items[N]{name,type,source,targetPath,installedAt}:
  implementer-agent,agent,agents/implementer-agent.md,~/.claude/agents/implementer-agent.md,2026-04-06T10:00:00Z
  loom-plan,prompt,commands/loom-plan.md,~/.claude/commands/loom-plan.md,2026-04-13T18:00:00Z
```

If install-state.toon does not exist, create it with `schemaVersion: 2`, current timestamp for `lastSynced`, and `items[0]{name,type,source,targetPath,installedAt}:` (empty).

**Migration from v1:** If `schemaVersion: 1` is found (has `contentHash` column), read it normally but ignore the `contentHash` field. On next write, output `schemaVersion: 2` format (without `contentHash`). No manual migration needed.

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
Before constructing any target path, validate that the item name matches `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. Reject names containing `/`, `..`, or null bytes. After resolving the full target path, verify it starts with `~/.claude/`.

## Target Paths by Type

When installing, place files based on their type in library.yaml:
- `agents` items -> `~/.claude/agents/<name>.md`
- `prompts` items -> `~/.claude/commands/<name>.md`
- `skills` items -> `~/.claude/agents/protocols/<name>.md`
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

1. Find `<name>` in library.yaml across all type sections (agents, prompts, skills)
2. If the item has `deprecated: true` and a `redirectsTo` field, print: "Note: `{name}` is deprecated. Installing `{redirectsTo}` instead." Then install the redirected item.
3. If not found, search for similar names (substring match) and suggest them. Stop.
4. Resolve dependencies recursively with cycle detection
5. For each item to install (dependencies first, then the target):
   a. Fetch source content (via `gh api` or local Read)
   b. Determine target path from the type (see Target Paths by Type above)
   c. Write content to target path using the Write tool
   d. Add entry to install-state.toon (update the items array and count)
6. Update `lastSynced` timestamp in install-state.toon
7. Display summary:
```
Installed contracts-agent
  Dependencies: execution-protocols (already installed)
  Target: ~/.claude/agents/contracts-agent.md
```

## Command: `sync`

**Pre-check — Infrastructure bootstrap detection:**
1. Read `~/.claude/skills/library/library.yaml`
2. If the catalog does NOT contain an `infrastructure:` section, this is a pre-v2 install. Print the re-install prompt (same as `list`). Continue with sync.

**Main sync logic:**

1. Read install-state.toon
2. For each installed item:
   a. Fetch current source content from repo (handle missing sources gracefully)
   b. Read the installed target file
   c. Compare source and target byte-for-byte. If they differ, the item needs updating.
3. Report results:
```
Checking 18 installed items...

  [rotate] implementer-agent       source changed
  [check]  contracts-agent         up to date
  [x]      old-agent               source not found

2 items need updating, 1 source missing.
Update now? (yes / no / select individually)
```
4. If user approves: for each changed item, write the fetched source content to the target path. Update `lastSynced` in install-state.toon.
5. For missing sources, ask whether to remove them from install-state.

## Command: `search <query>`

1. Read library.yaml
2. Filter items where name OR description contains the query (case-insensitive). Exclude `deprecated: true` items from results.
3. Display matches with installed status (check install-state.toon)
4. If no matches, say so and suggest broadening the query

## Command: `add <source>`

1. Determine source type:
   - Starts with `/` or `~` -> local path
   - Starts with `https://github.com` -> GitHub URL
   - Otherwise -> ask user to clarify
2. Read the file content (local Read or GitHub fetch)
3. Infer item type from content:
   - Contains `$ARGUMENTS` with `## Instructions` -> prompt (command)
   - Contains agent-style instructions (role/task language, file ownership) -> agent
   - Otherwise -> skill
4. Derive a suggested name from the filename (strip extension and path)
4b. Validate the name matches `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. If not, sanitize by replacing invalid characters with `-` and confirm with user.
5. Ask user to confirm name and type
6. Append the new entry to the appropriate section in library.yaml
7. Ask if user wants to install immediately via `use`

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
   a. Delete the target file via Bash `rm`
   b. Remove the entry from install-state.toon (update items array and count)
   c. Report what was removed

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

---

## Error Handling

- **Missing library.yaml**: Report that the catalog is not found. Suggest running install.sh or checking `~/.claude/skills/library/library.yaml`.
- **Missing source file**: Report which item has a missing source. For `sync`/`update`, mark it and continue checking others.
- **gh not available**: Fall back to curl for fetching. If curl also fails (private repo), print: "Install gh for private repo support: https://cli.github.com/"
- **Network errors**: Report the error, skip the item, continue with others. Never block the entire command on a single fetch failure.
- **Write failures**: Report the target path and error. Do not update install-state for that item.
- **Corrupt install-state.toon**: If the file exists but cannot be parsed, back it up as `install-state.toon.corrupt`, create a fresh empty state, and warn: "Install state was corrupt and has been reset. Run `/loom-library sync` to rebuild."

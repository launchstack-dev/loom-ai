# Library Manager

You manage a pull-on-demand catalog of agents, commands, and skills for Loom. The catalog lives at `~/.claude/skills/library/library.yaml` and install state is tracked in `~/.claude/skills/library/install-state.toon`.

## Instructions

$ARGUMENTS

Parse arguments:
- No args or `list`: Show installed items grouped by type with status markers
- `use <name>`: Install item from catalog, resolve dependencies first
- `sync`: Re-pull all installed items, compare content hashes
- `search <query>`: Search catalog by name/description substring
- `add <source>`: Add new item (local path or GitHub URL) to catalog
- `remove <name>`: Uninstall, warn about dependents
- `update`: Check all sources for changes, show new catalog entries, confirm before applying

---

## State Management

Track install state in `~/.claude/skills/library/install-state.toon`:

```toon
schemaVersion: 1
lastSynced: 2026-04-06T10:00:00Z

items[N]{name,type,source,targetPath,installedAt,contentHash}:
  implementer-agent,agent,/path/to/source.md,~/.claude/agents/implementer-agent.md,2026-04-06T10:00:00Z,sha256:abc123
  execute-plan,prompt,/path/to/source.md,~/.claude/commands/execute-plan.md,2026-04-06T10:00:00Z,sha256:def456
```

If install-state.toon does not exist, create it with `schemaVersion: 1`, current timestamp for `lastSynced`, and `items[0]{name,type,source,targetPath,installedAt,contentHash}:` (empty).

Compute `contentHash` by running `shasum -a 256 <target-file>` via the Bash tool AFTER writing content to the target. This ensures the hash matches what was actually installed, not what was at the source at an earlier point in time. If `shasum` is not available, try `sha256sum` as a fallback. If both fail, report the error and store `contentHash: unknown`.

## Source Types

- **Local path**: Absolute path to a `.md` file. Read it directly with the Read tool.
- **GitHub URL**: A URL like `https://github.com/user/repo/blob/main/path/file.md`. Convert to raw URL per the rules below, validate, then fetch.

### Source Validation

**GitHub URL validation:**
1. Parse the URL to extract org, repo, branch, and file path components
2. Convert to raw URL: `https://raw.githubusercontent.com/{org}/{repo}/{branch}/{path}`
3. Validate the raw URL matches: `^https://raw\.githubusercontent\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+/.+$`
4. If validation fails, report the invalid URL and stop
5. Fetch with: `curl --max-filesize 10485760 --max-time 30 --max-redirs 5 -sL "{url}"` (always double-quote the URL variable)

**Name validation:**
Before constructing any target path, validate that the item name matches `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. Reject names containing `/`, `..`, or null bytes. After resolving the full target path, verify it starts with `~/.claude/`.

## Target Paths by Type

When installing, place files based on their type in library.yaml:
- `agents` items -> `~/.claude/agents/<name>.md`
- `prompts` items -> `~/.claude/commands/<name>.md`
- `skills` items -> `~/.claude/agents/protocols/<name>.md`

## Dependency Resolution

When installing an item that has `requires: [...]` in library.yaml:

1. Parse each dependency: `agent:name`, `skill:name`, `prompt:name`
2. Check if each dependency is installed (present in install-state.toon)
3. If not installed, install it first (recurse)
4. **Cycle detection**: Maintain a "currently installing" set. If an item already appears in the set, report the cycle and abort.

---

## Command: `list` (default)

1. Read `~/.claude/skills/library/library.yaml`
2. Read `~/.claude/skills/library/install-state.toon` (create if missing)
3. For each catalog item, check whether it appears in install-state
4. Display grouped by type with counts:

```
## Agents (12 installed, 8 available)

  [check] contracts-agent         Wave 0 specialist - creates shared types
  [check] implementer-agent       Parallel worker within file ownership boundaries
  [x]     feature-coverage-agent  Audits plan schema, API surface, features
  ...

## Commands (6 installed)

  [check] execute-plan     Wave-by-wave execution orchestrator
  [check] roadmap          Plan creation, tracking, milestones
  ...

## Skills (2 installed)

  [check] execution-protocols    Inter-agent protocol schemas
  [check] toon-format-protocol   TOON format specification
```

Use a checkmark for installed items and an x-mark for uninstalled ones.

## Command: `use <name>`

1. Find `<name>` in library.yaml across all type sections (agents, prompts, skills)
2. If not found, search for similar names (substring match) and suggest them. Stop.
3. Resolve dependencies recursively with cycle detection
4. For each item to install (dependencies first, then the target):
   a. Read source content (local Read or GitHub curl)
   b. Determine target path from the type (see Target Paths by Type above)
   c. Write content to target path using the Write tool
   d. Compute content hash: run `shasum -a 256 <target-path>` (hash the installed file, not the source). If `shasum` fails, try `sha256sum <target-path>`.
   e. Add entry to install-state.toon (update the items array and count)
5. Update `lastSynced` timestamp in install-state.toon
6. Display summary:
```
Installed contracts-agent
  Dependencies: execution-protocols (already installed)
  Target: ~/.claude/agents/contracts-agent.md
```

## Command: `sync`

1. Read install-state.toon
2. For each installed item:
   a. Read current source content (handle missing sources gracefully)
   b. Compute new hash via `shasum -a 256`
   c. Compare with stored contentHash
3. Report results:
```
Checking 18 installed items...

  [rotate] implementer-agent       source changed (hash mismatch)
  [check]  contracts-agent         up to date
  [x]      old-agent               source not found

2 items need updating, 1 source missing.
Update now? (yes / no / select individually)
```
4. If user approves, re-read changed sources, write to targets, update hashes and `lastSynced` in install-state.toon.
5. For missing sources, ask whether to remove them from install-state.

## Command: `search <query>`

1. Read library.yaml
2. Filter items where name OR description contains the query (case-insensitive)
3. Display matches with installed status (check install-state.toon)
4. If no matches, say so and suggest broadening the query

## Command: `add <source>`

1. Determine source type:
   - Starts with `/` or `~` -> local path
   - Starts with `https://github.com` -> GitHub URL
   - Otherwise -> ask user to clarify
2. Read the file content (local Read or GitHub curl)
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

1. Run the same check as `sync` (hash comparison for installed items)
2. Additionally, scan library.yaml for items NOT in install-state (new catalog entries)
3. Display both sections:
```
## Changed items
  [rotate] implementer-agent  source changed

## New in catalog
  [new] tdd-coach             Drives test-driven development
  [new] meta-agent            Generates new agents and commands

Update changed items? (yes / no)
Install new items? (yes / all / select / no)
```
4. Process user choices: update changed items and/or install selected new items using the same logic as `use`.

---

## Error Handling

- **Missing library.yaml**: Report that the catalog is not found. Suggest running install.sh or checking `~/.claude/skills/library/library.yaml`.
- **Missing source file**: Report which item has a missing source. For `sync`/`update`, mark it and continue checking others.
- **Network errors** (GitHub fetch): Report the error, skip the item, continue with others.
- **Write failures**: Report the target path and error. Do not update install-state for that item.
- **Corrupt install-state.toon**: If the file exists but cannot be parsed as valid TOON, back it up as `install-state.toon.corrupt`, create a fresh empty state, and warn the user: "Install state was corrupt and has been reset. Run `/loom-library sync` to rebuild."
- **Hash command unavailable**: If both `shasum -a 256` and `sha256sum` fail, report the error and store `contentHash: unknown`. The `sync` command will detect these entries and re-hash them on the next run.

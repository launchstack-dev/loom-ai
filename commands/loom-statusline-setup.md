---
description: "Configure the Loom status line and optional Starship integration"
---
# Statusline Setup

Configure the Loom status line for Claude Code and optionally integrate with Starship prompt.

## Requirements

$ARGUMENTS

No arguments are required. This command is idempotent and safe to run multiple times.

## Instructions

### Step 1: Resolve Paths

Determine the absolute path to the statusline command script:

```
HOOK_SCRIPT="$HOME/.claude/statusline-command.sh"
```

Verify the script exists at that path. If it does not exist, report an error and stop:

```
Error: statusline-command.sh not found at {path}.
Run: curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

Ensure the script is executable. If not, run:

```bash
chmod +x "$HOOK_SCRIPT"
```

### Step 2: Configure Claude Code settings.json

Read `~/.claude/settings.json`.

- **If the file exists:** parse it and add or update the `statusline_command` field to the absolute path of the hook script. Preserve all other existing fields. Do not reformat or reorder existing keys.
- **If the file does not exist:** create it with minimal content:

```json
{
  "statusline_command": "/Users/{username}/.claude/statusline-command.sh"
}
```

Use the actual resolved absolute path, not a variable.

**Idempotency check:** If `statusline_command` already points to the correct absolute path, skip the write and note that it was already configured.

### Step 3: Detect Starship

Check if Starship is installed:

```bash
command -v starship
```

- **If Starship is NOT installed:** skip to Step 5. Print:

  ```
  Starship not detected. Skipping prompt integration.
  The statusline is configured for Claude Code's built-in status bar.
  ```

- **If Starship IS installed:** proceed to Step 4.

### Step 4: Starship Integration

Read the Loom Starship segment definition from `~/.claude/config/starship-loom.toml`.

If that file does not exist, report a warning and skip Starship integration:

```
Warning: ~/.claude/config/starship-loom.toml not found. Skipping Starship integration.
```

If it exists, check `~/.config/starship.toml` for an existing `[custom.loom]` section:

```bash
grep -q '\[custom\.loom\]' ~/.config/starship.toml 2>/dev/null
```

- **If `[custom.loom]` already exists:** skip the append. Print:

  ```
  Starship: [custom.loom] segment already present. No changes needed.
  ```

- **If `[custom.loom]` does NOT exist:** ask the user for confirmation:

  ```
  Starship detected. Append the Loom status segment to ~/.config/starship.toml?
  This adds a [custom.loom] section that displays Loom pipeline status in your prompt.
  ```

  If the user confirms, append the contents of `~/.claude/config/starship-loom.toml` to `~/.config/starship.toml`. If `~/.config/starship.toml` does not exist, create `~/.config/` if needed and create the file with just the Loom segment.

  **Important:** Append only. Never overwrite or rewrite existing Starship configuration.

  After appending, print:

  ```
  Starship: [custom.loom] segment added to ~/.config/starship.toml
  ```

### Step 5: Confirmation

Print the setup summary:

```
## Statusline Setup Complete

Claude Code:
  statusline_command: {absolute path to hook script}
  settings.json: {created | updated | already configured}

Starship:
  {installed | not installed}
  {segment added | segment already present | skipped | config not found}

Restart Claude Code for the statusline to take effect.
If using Starship, open a new terminal tab to pick up the prompt changes.
```

## Error Handling

- **settings.json is malformed JSON:** report the parse error, do not overwrite. Ask the user to fix it manually or pass `--force` (not implemented yet — just report the error).
- **Permission denied on settings.json:** report the path and error. Suggest checking file ownership.
- **Permission denied on starship.toml:** report and skip Starship integration gracefully.
- **Hook script not found:** stop early with a clear error message pointing to the install instructions.

## Idempotency Contract

Running `/loom-statusline-setup` multiple times must produce the same end state:

1. `statusline_command` in settings.json points to the correct path (set once, not duplicated).
2. `[custom.loom]` in starship.toml appears at most once (checked before appending).
3. No backup files, no temp files left behind.
4. Output clearly indicates what was changed vs. what was already configured.

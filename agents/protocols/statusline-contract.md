# Statusline Output Format Contract

Shell output contract for the Claude Code status line integration. The statusline command prints a single line to stdout, suitable for embedding in Starship, Oh My Posh, or any prompt that supports custom commands.

## General Rules

- Output is exactly **one line** (no trailing newline beyond what the shell naturally adds).
- Maximum length: **120 characters**. Segments are dropped by priority when the line would exceed this limit.
- Exit code is always **0**, even on internal errors (the status line must never break the prompt).
- Output uses plain text. Color/styling is handled by the prompt framework, not by this command.

## Modes

The command operates in one of two modes based on whether `.plan-execution/status.toon` exists and is fresh (updated within `STALENESS_THRESHOLD_SECONDS`, default 300s).

### Active Mode

Displayed when `status.toon` exists and `updatedAt` is within the staleness threshold.

**Format:**

```
[command] phase wave/total agents(done/total) [failures if >0]
```

**Examples:**

```
execute-plan implementing 2/4 agents(3/5)
execute-plan contracts 0/4 agents(0/2)
review-code reviewing agents(2/3) findings:7
execute-plan wiring 2/4 agents(1/1) FAILED:1
```

**Segment rules:**

| Segment | Source field | Always shown | Notes |
|---------|-------------|--------------|-------|
| command | `command` | Yes | Shown as-is |
| phase | `phase` | Yes | Shown as-is |
| wave/total | `wave`/`totalWaves` | Yes | Format: `N/M` |
| agents(done/total) | `agentsDone`/`agentsTotal` | Yes | Format: `agents(D/T)` |
| failures | `agentsFailed` | Only if > 0 | Format: `FAILED:N` |
| findings | `findings` | Only if > 0 | Format: `findings:N` |

**Truncation:** Active mode segments are never truncated. If the line exceeds 120 characters (unlikely given field sizes), drop `findings` first, then `failures`.

### Idle Mode

Displayed when `status.toon` is missing, stale, or unreadable.

**Format:**

```
[plan-status] [branch] [notes-count if >0] [last-result if exists]
```

**Examples:**

```
approved main
draft feature/auth 3 notes
approved main ok
executing feature/auth failed
main
```

**Segment rules:**

| Segment | Source field | Always shown | Notes |
|---------|-------------|--------------|-------|
| plan-status | `planStatus` | Only if non-null | Shown as-is |
| branch | `gitBranch` | Only if non-null | Shown as-is |
| notes-count | `pendingNotes` | Only if > 0 | Format: `N notes` |
| last-result | `lastResult` | Only if non-null | `ok` or `failed` |

**Truncation priority** (drop lowest priority first when exceeding 120 chars):

1. `branch` (highest priority -- keep)
2. `plan-status`
3. `last-result`
4. `notes-count` (lowest priority -- drop first)

If all segments are null/zero, output an empty line (the prompt framework hides the module when output is empty).

## Error and Corruption Handling

The statusline command must never crash or produce multi-line output. All failure modes produce a safe fallback.

| Condition | Behavior |
|-----------|----------|
| `status.toon` missing | Switch to idle mode |
| `status.toon` unreadable (permissions) | Switch to idle mode |
| Partial write (truncated file) | Switch to idle mode |
| Malformed TOON (parse error) | Switch to idle mode |
| Missing required fields in active state | Switch to idle mode |
| `updatedAt` older than staleness threshold | Switch to idle mode |
| Idle state sources unavailable | Output empty line |
| Any uncaught exception | Output empty line, exit 0 |

**Rationale:** The status line is purely informational. Showing nothing is always preferable to showing wrong data or breaking the user's shell prompt.

## Data Sources

| State | Source |
|-------|--------|
| ActiveState | `.plan-execution/status.toon` (flat key-value TOON, one key per line) |
| AmbientState.planStatus | Plan file metadata (implementation-defined) |
| AmbientState.planName | Plan file metadata (implementation-defined) |
| AmbientState.pendingNotes | Count of files in `.loom-notes/` or equivalent |
| AmbientState.lastCommand | `.plan-execution/last-run.toon` or equivalent |
| AmbientState.lastResult | `.plan-execution/last-run.toon` or equivalent |
| AmbientState.gitBranch | `git rev-parse --abbrev-ref HEAD` |

## Type Definitions

All TypeScript types are defined in `hooks/lib/statusline-types.ts`. Implementers must import from that file -- do not duplicate type definitions.

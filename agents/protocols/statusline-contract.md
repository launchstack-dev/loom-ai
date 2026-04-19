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
execute-plan converging 3/4 agents(5/5) pass:42 fail:2 qa:3 iter:2 rate:95%
execute-plan implementing 1/4 agents(2/4) pass:18 iter:1 rate:100%
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
| test-pass | `testPass` | Only if > 0 | Format: `pass:N` |
| test-fail | `testFail` | Only if > 0 | Format: `fail:N` |
| qa-findings | `qaFindings` | Only if > 0 | Format: `qa:N` |
| convergence-iter | `convergenceIteration` | Only if > 0 | Format: `iter:N` |
| convergence-rate | `convergencePassRate` | Only if set | Format: `rate:N%` (integer percent, 0-100) |

**Truncation priority** (drop lowest priority first when exceeding 120 chars):

1. `command` (highest priority -- keep)
2. `phase`
3. `wave/total`
4. `agents(done/total)`
5. `failures`
6. `test-pass`
7. `test-fail`
8. `convergence-iter`
9. `convergence-rate`
10. `qa-findings`
11. `findings` (lowest priority -- drop first)

When the terminal width is narrower than 120 characters, the statusline renderer receives the width from the prompt framework (e.g., Starship's `$COLUMNS`). Segments are dropped from the bottom of the priority list (lowest priority first) until the line fits within the available width. If the width is unknown or zero, the 120-character default is used.

**Right-truncation with ellipsis:** If dropping all optional segments still produces a line wider than the available width, the remaining text is truncated from the right and a `...` suffix is appended. The `...` counts as 3 characters, so the visible content is at most `width - 3` characters followed by `...`. This ensures the statusline never overflows the terminal width, even at extremely narrow widths (e.g., 40 columns). The minimum displayable width is 10 characters; below that, the statusline outputs an empty line.

### Idle Mode

Displayed when `status.toon` is missing, stale, or unreadable.

**Format:**

```
[plan-status] [branch] [notes-count if >0] [last-result if exists] [update-indicator]
```

**Examples:**

```
approved main
draft feature/auth 3 notes
approved main ok
executing feature/auth failed
main ↑ update
main
```

**Segment rules:**

| Segment | Source field | Always shown | Notes |
|---------|-------------|--------------|-------|
| plan-status | `planStatus` | Only if non-null | Shown as-is |
| branch | `gitBranch` | Only if non-null | Shown as-is |
| notes-count | `pendingNotes` | Only if > 0 | Format: `N notes` |
| last-result | `lastResult` | Only if non-null | `ok` or `failed` |
| update-indicator | `updateAvailable` | Only if true | Format: `↑ update` (yellow) |

**Truncation priority** (drop lowest priority first when exceeding 120 chars):

1. `branch` (highest priority -- keep)
2. `plan-status`
3. `update-indicator`
4. `last-result`
5. `notes-count` (lowest priority -- drop first)

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
| ActiveState.testPass | `.plan-execution/status.toon` — aggregate pass count across all test tiers |
| ActiveState.testFail | `.plan-execution/status.toon` — aggregate fail count across all test tiers |
| ActiveState.qaFindings | `.plan-execution/status.toon` — count of QA review findings (all severities) |
| ActiveState.convergenceIteration | `.plan-execution/status.toon` — current convergence outer-loop iteration number (1-based) |
| ActiveState.convergencePassRate | `.plan-execution/status.toon` — overall pass rate as integer 0-100 (tests passed / tests total * 100) |
| AmbientState.planStatus | Plan file metadata (implementation-defined) |
| AmbientState.planName | Plan file metadata (implementation-defined) |
| AmbientState.pendingNotes | Count of files in `.loom-notes/` or equivalent |
| AmbientState.lastCommand | `.plan-execution/last-run.toon` or equivalent |
| AmbientState.lastResult | `.plan-execution/last-run.toon` or equivalent |
| AmbientState.gitBranch | `git rev-parse --abbrev-ref HEAD` |
| AmbientState.updateAvailable | `~/.cache/loom/update-check.toon` (`updateAvailable` field) |

### Background Update Check

The statusline renderer spawns a background update checker (`~/.claude/loom-update-checker.cjs`) when idle. The checker:

1. Reads `~/.cache/loom/update-check.toon` — skips if `lastChecked` < 4 hours ago
2. Fetches `library.yaml` from GitHub, extracts `catalog_version`
3. Compares with local `~/.claude/skills/library/library.yaml` catalog version
4. Writes result to `~/.cache/loom/update-check.toon`

The renderer reads this cache file on each idle render. When `updateAvailable: true`, it appends a yellow `↑ update` segment. Running `/loom-library update` clears the cache file, removing the indicator.

## Type Definitions

All TypeScript types are defined in `hooks/lib/statusline-types.ts`. Implementers must import from that file -- do not duplicate type definitions.

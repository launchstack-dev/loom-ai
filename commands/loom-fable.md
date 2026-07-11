---
description: Toggle fable-driver mode — record whether a Fable-tier model is driving this project's sessions and adapt Loom's posture to windowed Fable availability
---

# /loom-fable

Record and report **driver mode**: whether a Fable-tier model is currently driving interactive sessions in this project. Fable availability is windowed — this command is how a project flips its posture when a window opens or closes, without touching profiles, agents, or hooks.

**Scope guard — what this command never does:** worker model resolution is untouched in every mode. Fable is driver-only (see CLAUDE.md → Agent Conventions); no mode of this command may place a fable-tier model in any profile tier, agent frontmatter, or spawn call.

> **Lifecycle note:** this is the pre-capability-gate stopgap. The fable-readiness fork (PR #42) replaces name-based driver modes with capability-gated discipline profiles that measure the driving model instead of asking. When that lands, `/loom-fable` becomes a thin alias over the capability gate or is retired; the state file below is designed to be readable by that successor.

## Usage

```
/loom-fable            # status (default)
/loom-fable on         # fable window open — fable-tier model driving
/loom-fable off        # window closed — opus/sonnet driving
/loom-fable auto       # infer from the current session each time (default state)
```

## State

`.loom/driver-mode.toon` (create parent dir if missing; atomic write: `.tmp` then rename):

```
schemaVersion: 1
fableDriver: auto        # on | off | auto
updatedAt: 2026-07-11T00:00:00Z
```

Missing file ≡ `auto`.

## Behavior

### `status` (default)

1. Read `.loom/driver-mode.toon` (default `auto` if missing).
2. Report: configured mode, what model class appears to be driving the current session (state your own model honestly), and the effective posture table below.
3. Remind: worker tiers are opus/sonnet/haiku in every mode.

### `on`

1. Write `fableDriver: on`.
2. Confirm the posture change and its boundaries:
   - Judgment seams (`/loom-think` interviews, plan decomposition, review triage, convergence verdicts) run at driver quality — no scaffolding change needed.
   - Cross-model second opinions remain pinned to a named non-fable model (they exist to be independent of the driver).
   - Workers: unchanged. Never fable.
3. If the session's driving model is clearly NOT fable-tier, warn that the flag and reality disagree and suggest `auto`.

### `off`

1. Write `fableDriver: off`.
2. Confirm posture: nothing structural changes — Loom's guarantees come from gates and loops, not driver IQ. Suggest (do not apply) `modelProfile = "quality"` in `.claude/orchestration.toml` if the project currently runs `balanced`/`budget` and the work is planning-heavy.
3. Remind that every command, gate, and loop runs identically; expect slower judgment seams, not weaker verification.

### `auto`

1. Write `fableDriver: auto` (or delete the file — equivalent).
2. Confirm: each session infers driver class at start; no recorded override.

## Posture table (what mode changes, and what it never changes)

| Surface | `on` | `off` | never changes |
|---|---|---|---|
| Worker model resolution | — | — | opus/sonnet/haiku only, all modes |
| Cross-model second opinion | — | — | pinned non-fable model |
| Thinking-gate / convergence gates | — | — | fail-closed, breakers non-disableable |
| Judgment-seam expectations | driver-quality | suggest `quality` profile for planning tier | — |
| Long autonomous runs (`/loom-auto`) | favorable window | plan around window being closed | bounded gates unchanged |

## Output

End with a one-line summary: `driver-mode: {on|off|auto} — workers unchanged (opus/sonnet/haiku)`.

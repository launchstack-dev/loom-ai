---
description: "DX lifecycle dispatcher — subcommands for live DX audits (review) with future room for /loom-devex:trace."
---

# /loom-devex

Developer-experience lifecycle commands. Parse the first positional argument
as the subcommand:

- No args: show available subcommands.
- `review`: live TTHW boomerang — measures actual time-to-hello-world in a
  fresh temp dir and compares against the plan-time `predictedTTHW`. See
  `commands/loom-devex/review.md`.

Remaining arguments after the subcommand are forwarded to the subcommand
handler.

## Subcommand Dispatch

| Subcommand | Handler |
|---|---|
| `review` | `commands/loom-devex/review.md` → `skills/loom-devex-review/SKILL.md` |

## Notes

- Depends on `agents/plan-devex-review-agent.md` (Phase 4 F-12) for the
  `predictedTTHW` input.
- Optionally uses `/loom-browser` for screenshot capture during the run.

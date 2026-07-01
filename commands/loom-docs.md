---
description: "Post-ship doc sync — subcommands for diff-driven README/CHANGELOG/ARCH updates, diagram drift detection, and doc-debt surfacing."
---

# /loom-docs

Doc lifecycle commands. Parse the first positional argument as the subcommand:

- No args: show available subcommands.
- `release`: post-ship doc sync — diff-driven README/CHANGELOG/architecture updates with a CHANGELOG sell-test rubric. See `commands/loom-docs/release.md`.

Remaining arguments after the subcommand are forwarded to the subcommand handler.

## Subcommand Dispatch

| Subcommand | Handler |
|---|---|
| `release` | `commands/loom-docs/release.md` → `skills/loom-docs-release/SKILL.md` |

## Notes

- Future subcommands (`generate`, per M-08) will land under `commands/loom-docs/generate.md`.
- All subcommands read-only against source code; the only writes are to `README.md`, `CHANGELOG.md`, `docs/**`, and (via PR) the PR body.

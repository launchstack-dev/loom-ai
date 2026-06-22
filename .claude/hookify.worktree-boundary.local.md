---
name: worktree-boundary-guard
enabled: true
event: file
conditions:
  - field: file_path
    operator: not_contains
    pattern: "/Users/jensencarlsen/Projects/loom-ai/.worktrees/m07"
action: warn
---
You are editing a file outside your worktree boundary (`/Users/jensencarlsen/Projects/loom-ai/.worktrees/m07`).
You should only edit files within this worktree. If you need to edit files elsewhere, ask the user first.

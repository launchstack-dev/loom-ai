---
description: "Project status overview"
---

# Loom Status

Display a high-level project status overview. Delegates to `/loom-roadmap status` when a roadmap exists, and falls back to basic project info otherwise.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `status`:
- No args: show project status overview
- `--verbose`: show detailed status including all state files

### Instructions

#### Step 1: Check for Roadmap

If `ROADMAP.md` exists:
- Delegate to `/loom-roadmap status` logic. This shows the full unified status view (roadmap + plan + milestones + progress).
- Stop after the delegate completes.

#### Step 2: Basic Project Info (no roadmap)

If no `ROADMAP.md` exists, display a basic project overview:

```
## Project Status

### Loom Artifacts
  CLAUDE.md:           {found (N lines) | not found}
  CONTEXT.md:          {found (N lines) | not found}
  ROADMAP.md:          not found
  PLAN.md:             {found | not found}
  orchestration.toml:  {found | not found}
  Wiki (.loom/wiki/):  {found (N pages) | not found}

### Execution State
  Pipeline state:      {not found | stage: {currentStage}}
  Execution state:     {not found | status: {status}, wave: {currentWave}}
  Convergence state:   {not found | status: {status}, iter: {iteration}}
  Paused session:      {not found | paused at {phase} on {pausedAt}}

### Recent Activity
  Last command:        {from status.toon or "unknown"}
  Last updated:        {from status.toon or "unknown"}

### Quick Tasks
  Total:               {count of .toon files in .plan-history/quick-tasks/}
  Recent:              {last 3 task descriptions with dates}

### Model Profile
  Active:              {profile name or "inherit"}

### Suggested Next Step
  {Run the /loom-next logic to determine suggestion, display one-line version}
```

### Error Handling

- **File read errors:** Skip any file that cannot be read. Display "error reading" in its status slot.
- **No state at all:** If no Loom artifacts exist whatsoever, display: "No Loom artifacts found. Get started with `/loom-init` (brownfield) or `/loom-roadmap init --from 'description'` (greenfield)."

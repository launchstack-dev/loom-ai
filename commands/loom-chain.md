---
description: "Progressive refinement pipeline — draft, refine, harden"
---

# Loom Chain

Run a progressive refinement pipeline where each agent builds on the previous agent's output.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `chain`:
- `"task description"` (required): what to produce
- `--agents <a,b,c>`: ordered list of agents (default: draft → refine → harden using general-purpose agents)
- `--steps <N>`: number of refinement steps if using default agents (default: 3)

### Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/orchestration-patterns.md` — Pattern 2: Chain
- `~/.claude/agents/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those in order. Look up `.md` file paths.
2. If no `--agents`, use general-purpose agents with role prompts:
   - Step 1 (Draft): "Generate an initial implementation. Optimize for correctness and completeness. Mark uncertainties with TODO comments."
   - Step 2 (Refine): "Improve this draft: better naming, extract helpers, add error handling, apply project conventions. Remove unnecessary complexity."
   - Step 3 (Harden): "Harden for production: edge-case handling, input validation, security checks. Remove all TODOs. This must be production-ready."
3. Check `orchestration.toml` for matching chain patterns.

#### Step 1: Execute Chain

Execute per `orchestration-patterns.md` Pattern 2:

1. Read `CLAUDE.md` for project conventions (passed to all agents as context).
2. Spawn agent[0] with the task description. Collect output.
3. Spawn agent[1] with agent[0]'s output + original task. Collect output.
4. Continue until all agents have run.

Display progress:
```
## Chain: {task}

### Step 1 — Draft
{summary of what was produced}

### Step 2 — Refine
{summary of changes made}

### Step 3 — Harden
{summary of hardening applied}
```

#### Step 2: Present Result

Display the final output. If it's code, show the complete artifact. If it's a document, show the full text.

Save to `.plan-execution/chain-{timestamp}.toon`.

### Error Handling

- **Agent fails mid-chain:** Return the last successful output with a note: "Chain halted at step {N}. Output from step {N-1} returned."
- **No task provided:** Print usage.

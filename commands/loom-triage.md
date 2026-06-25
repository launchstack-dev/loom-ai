---
description: "Cheap router classifies task, routes to appropriate specialist"
---

# Loom Triage

Route a task through a cheap classifier that determines complexity and dispatches to the right specialist.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `triage`:
- `"task description"` (required): the task to classify and route
- `--router <agent>`: classification agent (default: general-purpose with haiku model)
- `--simple <agent>`: handler for simple tasks (default: general-purpose with sonnet)
- `--complex <agent>`: handler for complex tasks (default: general-purpose with opus)

### Protocols

Before doing anything, read:
- `~/.claude/protocols/orchestration-patterns.md` — Pattern 4: Triage
- `~/.claude/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If agents specified via flags, use those.
2. Otherwise use defaults: haiku router, sonnet for simple, opus for complex.
3. Check `orchestration.toml` for matching triage patterns.

#### Step 1: Classify

Spawn router agent (haiku-class) with:
```
Classify this task:
- simple: Single-file changes, typo fixes, config updates, simple CRUD, boilerplate, documentation
- complex: Multi-file refactors, new features with edge cases, security-sensitive code, performance optimization, architectural changes
- multi: Requires changes across multiple domains (frontend + backend, backend + infra, etc.)

Task: {task description}

Return your classification as: complexity (simple/complex/multi), domains (if multi), and one-line reasoning.
```

Display:
```
## Triage: {task}

Classification: {complexity}
Reasoning: {one-line}
{if multi: Domains: {domains}}

Routing to: {agent name} ({model})
```

#### Step 2: Route and Execute

- **Simple:** Spawn simple handler with the task.
- **Complex:** Spawn complex handler with the task.
- **Multi-domain:** Spawn domain specialists in parallel, each with their slice of the task. Merge results.

#### Step 3: Present Result

Display the specialist's output directly. Note the routing decision and cost savings:
```
Triage complete. Routed as {complexity} → {agent} ({model}).
{if simple: Saved ~{X}x cost vs opus.}
```

Save to `.plan-execution/triage-{timestamp}.toon`.

### Error Handling

- **Router fails:** Fall back to complex handler (safe default — overspend rather than underspend on quality).
- **Specialist fails:** Retry once with error context. If retry fails, try the next tier up (simple fails → try complex).
- **No task provided:** Print usage.

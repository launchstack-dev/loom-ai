```toon
pageId: pattern-model-resolution
title: Model Resolution
category: pattern
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[2]: CLAUDE.md, agents/implementer-agent.md
crossRefs[2]{pageId,relationship}:
  structure-agent-taxonomy,relates-to
  component-orchestration-patterns,relates-to
tags[4]: model-resolution, cost-control, opus, sonnet
staleness: fresh
confidence: high
```

# Model Resolution

Model resolution is **mandatory** before every Agent tool call in Loom. The CLAUDE.md mandate (added 2026-04-25) states: "Before every Agent tool call, read the target agent's `.md` frontmatter `model:` field and pass `model: "{value}"` on the call."

Spawning an agent without resolving its model first is a protocol violation.

---

## Resolution Priority

Models are resolved in strict priority order. Higher-priority sources override lower ones.

1. **`orchestration.toml` profile tier** — The active cost profile (e.g., `economy`, `balanced`, `performance`) can override individual agent models project-wide. Configured under `[profiles.<name>]` in `.claude/orchestration.toml`.
2. **Agent frontmatter `model:` field** — The default model declared in the agent's `.md` file header.
3. **Inherit parent** — If neither of the above is available, inherit the calling orchestrator's model. This is a fallback only; agents should always have a declared model.

---

## Why Model Resolution Matters

**Cost control.** Opus costs significantly more per token than Sonnet or Haiku. Spawning all agents at Opus by default would make large pipelines prohibitively expensive. Resolution lets the system right-size each agent call.

**Right-sizing capability.** Not all tasks need Opus-level reasoning:
- A parser that extracts structured data from a schema file is well-suited to Haiku.
- A code reviewer that must understand architectural tradeoffs benefits from Sonnet.
- A plan builder generating a multi-phase implementation plan warrants Opus.

**Profile-based cost management.** The orchestration.toml profile system lets teams run the same pipeline at different cost tiers — e.g., `economy` profile downgrades Opus agents to Sonnet for faster iteration during development.

---

## Common Model Assignments

Based on agent frontmatter as of 2026-04-25:

### Opus

High-stakes generation where quality outweighs cost:

| Agent | Reason |
|-------|--------|
| `plan-builder-agent` | Multi-phase plan generation requires deep reasoning |
| `contracts-agent` | Wave 0 contracts affect all downstream agents — errors compound |
| `implementer-agent` | Core code generation in implementation waves |

### Sonnet

Analysis, review, and mid-complexity generation:

| Agent | Reason |
|-------|--------|
| `security-reviewer` | Pattern recognition across many vulnerability classes |
| `architecture-reviewer` | Structural analysis requiring code understanding |
| `convergence-planner-agent` | Target discovery and method selection |
| `convergence-driver` | Orchestrates multi-iteration convergence loops |
| `delta-analyzer` | Structured comparison between SOURCE and TARGET outputs |
| `meta-agent` | Generating new agent scaffolding |
| `fixer-agent` | Applying targeted fixes from review findings |
| `wiki-ingest-agent` | Converting source files to structured wiki pages |
| Most review agents | Analysis tasks that need language understanding but not planning depth |

### Haiku

Lightweight operations where speed and cost dominate:

| Agent | Reason |
|-------|--------|
| `verification-agent` | Running typecheck/test/lint — deterministic tooling, not reasoning |
| `target-parser` | Parsing structured TOON schemas — low ambiguity |
| Router agents in triage patterns | Classification is cheap; routing doesn't need reasoning depth |

---

## Reading Frontmatter

Agent `.md` files use a YAML-style frontmatter block at the top. The `model:` field specifies the default model:

```markdown
---
name: implementer-agent
description: Parallel worker that builds code within strict file ownership...
model: opus
---
```

The orchestrator reads this block before spawning and passes the resolved model to the Agent tool call. If the active orchestration.toml profile overrides the tier, that value is used instead.

---

## Profile Override Example

In `.claude/orchestration.toml`:

```toml
[profiles.economy]
# Downgrade all opus agents to sonnet for development iterations
opusAgents = "sonnet"

[profiles.performance]
# Use declared model for everything (default behavior)
```

With `economy` profile active, `implementer-agent` (declared `opus`) would be spawned as `sonnet`.

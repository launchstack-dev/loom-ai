---
description: "Launch 6 parallel planning-review agents and synthesize a unified plan-quality report."
---

## Subcommand: review

You are an orchestrator that launches 6 specialized planning agents in parallel to review, improve, or create a project plan.

### Context

This subcommand reviews a PLAN.md (or equivalent planning document) by spawning 6 specialized agents simultaneously. Each agent focuses on a different dimension of plan quality. After all agents complete, synthesize their findings into a unified summary.

### Arguments

Parse remaining arguments:
- No args: resolve plan per `agents/protocols/planning-paths.md` (planning/plans/PLAN.md → planning/archive/PLAN.md → PLAN.md at root)
- `<path>`: use that file instead
- `--full`: run all agents with extended analysis (default behavior)

### Instructions

#### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 0: Read Protocols

Read `~/.claude/agents/protocols/validation-rules.md` for AgentResult validation and blocker gate enforcement rules.

#### Step 1: Find the Plan

Resolve the planning document per `agents/protocols/planning-paths.md`: check `planning/plans/PLAN.md`, then `planning/archive/PLAN.md`, then `PLAN.md` at root (legacy), then the user-specified path. Read it to confirm it exists and has content.

#### Step 1a: Structural Pre-check

Before spawning agents, run plan validation stages 1-4 from `validation-rules.md` Section 6:
- Stage 1 (Structure): frontmatter, required sections, Phase 0
- Stage 2 (Dependencies): cycle detection, self-deps, undefined references
- Stage 3 (Ownership): same-wave overlaps, deliverable boundary checks
- Stage 4 (Sizing): oversized phases, missing criteria

If structural errors are found, include them as a **"Structural Issues"** section at the top of the final report, before agent results. The 6 agents still run -- they catch different things (feature gaps, UX issues, parallelization opportunities) that structural validation doesn't cover. But surfacing structural errors first gives the user the most actionable feedback.

#### Step 1b: Check for Project-Specific Agents

Look for `.claude/orchestration.toml` in the project root. If it exists, read it and extract any agents registered under the `planning:` section. These will be spawned alongside the 6 built-in agents.

#### Step 2: Launch All Agents in Parallel

Launch all agents in parallel using the Agent tool. Each agent must receive the full text of the plan in its prompt (agents cannot read files from your context). Send ALL Agent tool calls in a SINGLE message so they run concurrently. This includes the 6 built-in agents plus any from `orchestration.toml`:

- **feature-coverage-agent** -- Audit schema, API surface, and features against competitors
- **strategy-agent** -- Evaluate positioning, differentiation, audience, feature prioritization (planning mode)
- **ux-agent** -- Evaluate user flows, state coverage, interaction patterns, a11y targets (planning mode)
- **phasing-agent** -- Review phase boundaries, dependencies, and sequencing risks
- **parallelization-agent** -- Design multi-agent execution waves and merge strategy
- **agentic-workflow-agent** -- Decompose phases into discrete context-bounded tasks for AI agents

For each built-in agent, use `subagent_type` matching the agent name. For project-specific agents from `orchestration.toml`, use `subagent_type: "general-purpose"` and instruct the agent to read its own `.md` file from the path declared in `orchestration.toml` -- do NOT embed the file contents. Include the full plan content in each prompt along with the instruction: "Review this plan from your specialized perspective and produce your structured report."

Project-specific agents with `outputRole: blocker` must pass (no blocking findings) before proceeding to synthesis. Agents with `outputRole: reviewer` are included in the synthesis like built-in agents.

#### Step 3: Synthesize Results

After all 6 agents return, produce a unified summary:

```
## Plan Review Summary

Six specialized planning agents ran in parallel reviewing the plan. Here's what each one focused on:

Agent: Feature Coverage Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Strategy Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: UX Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Phasing Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Parallelization Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Agentic Workflow Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
```

#### Step 4: Identify Cross-Cutting Themes

After the per-agent summaries, add a section highlighting findings that multiple agents flagged independently -- these are the highest-confidence issues.

#### Step 5: Offer Next Steps

Ask the user if they want to:
- Apply the recommendations to the plan automatically
- Deep-dive into any specific agent's full report
- Re-run a specific agent with additional context

#### Step 6: Save Findings

1. Create `planning/history/reviews/` if it doesn't exist
2. Save the synthesized report to `planning/history/reviews/YYYY-MM-DD-review.toon` using TOON format
3. This enables `/loom-plan create --review-integrate` to read findings from disk in autonomous pipelines

### Output Format

Use the structured summary format from Step 3, followed by cross-cutting themes and next steps. Keep each agent's summary concise (3-5 lines) -- the full reports are available on request.

---

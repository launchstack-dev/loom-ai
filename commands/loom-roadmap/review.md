## Command: `review`

Launches 4 specialized agents in parallel to review the ROADMAP.md from strategy, scope, feasibility, and UX perspectives. This is the roadmap-level equivalent of `/loom-plan review` (which reviews PLAN.md with 6 agents).

If no arguments are provided, look for a ROADMAP.md in the current working directory. If the user provides a file path, use that instead.

### Review Protocols

Before starting, read:
- `~/.claude/agents/protocols/roadmap.schema.md` — the canonical ROADMAP.md format spec
- `~/.claude/agents/protocols/validation-rules.md` — Section 7: Roadmap Validation Rules

### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` per `execution-conventions.md` SS "Orchestration Status".

### Step R0: Read protocols

Read `~/.claude/agents/protocols/validation-rules.md` for roadmap validation rules and blocker gate enforcement.

### Step R1: Find the roadmap

Locate the roadmap document — check for ROADMAP.md, roadmap.md, or whatever the user specified. Read it to confirm it exists and has content.

### Step R1a: Structural pre-check

Before spawning agents, run roadmap validation stages 1-4 from `validation-rules.md` Section 7:
- Stage 1 (Structure): frontmatter, required sections, title match
- Stage 2 (Features): milestone assignments, entity references, key behaviors
- Stage 3 (Milestones): cycle detection, self-deps, undefined references, forward references
- Stage 4 (Data Model): entity-feature coverage, relationship endpoint validation

If structural errors are found, include them as a **"Structural Issues"** section at the top of the final report, before agent results. The 4 agents still run — they catch strategic issues (scope overreach, feature conflicts, UX gaps) that structural validation doesn't cover. But surfacing structural errors first gives the most actionable feedback.

### Step R1b: Check for project-specific agents

Look for `.claude/orchestration.toml` in the project root. If it exists, read it and extract any agents registered under the `planning:` section with `phase: "roadmap"`. These will be spawned alongside the 4 built-in agents.

### Step R2: Launch all agents in parallel

Each agent must receive the full text of the roadmap in its prompt (agents cannot read files from your context). Send ALL Agent tool calls in a SINGLE message so they run concurrently:

- **scope-feasibility-agent** — Review scope realism, feature conflicts, milestone sizing, constraint compliance, data model soundness
- **feature-coverage-agent** — Audit features against competitors and best practices, identify gaps and over-engineering
- **strategy-agent** — Evaluate vision, positioning, differentiation, feature prioritization (planning mode)
- **ux-agent** — Evaluate user flows, state coverage, interaction patterns, UX coherence (planning mode)

For each built-in agent, use `subagent_type` matching the agent name. For project-specific agents from `orchestration.toml`, use `subagent_type: "general-purpose"` and instruct the agent to read its own `.md` file from the path declared in `orchestration.toml`. Include the full roadmap content in each prompt along with the instruction: "Review this roadmap from your specialized perspective and produce your structured report."

Project-specific agents with `outputRole: blocker` must pass (no blocking findings) before proceeding to synthesis.

### Step R3: Synthesize results

After all 4 agents return, produce a unified summary:

```
## Roadmap Review Summary

Four specialized agents reviewed the roadmap in parallel. Here's what each found:

Agent: Scope Feasibility Agent
Focus: scope realism, feature conflicts, milestone sizing, constraints
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: Feature Coverage Agent
Focus: competitive analysis, feature gaps, over-engineering
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: Strategy Agent
Focus: vision clarity, positioning, differentiation, feature prioritization
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: UX Agent
Focus: user flows, state coverage, interaction patterns, a11y targets
Key Findings: [2-3 most important findings]
```

### Step R4: Identify cross-cutting themes

After the per-agent summaries, add a section highlighting findings that multiple agents flagged independently — these are the highest-confidence issues.

### Step R5: Update roadmap status

If the roadmap's frontmatter has `status: draft`, update it to `status: reviewed` and set `lastReviewed` to today's date. Do NOT change status if it's already `approved`.

### Step R6: Offer next steps

Ask the user if they want to:
- Apply the recommendations to the roadmap automatically (via `/loom-roadmap review-integrate`)
- Deep-dive into any specific agent's full report
- Approve the roadmap as-is (via `/loom-roadmap approve`)
- Discuss specific features interactively before proceeding

### Step R7: Save Findings

1. Create `.plan-history/reviews/` if it doesn't exist
2. Save the synthesized report to `.plan-history/reviews/YYYY-MM-DD-roadmap-review.toon` using TOON format:

```toon
type: roadmap-review
roadmapFile: ROADMAP.md
reviewedAt: {ISO 8601}
agentCount: {4 + project-specific count}
structuralErrors: {count}
structuralWarnings: {count}

agents[N]{name,findingCount,blockingCount,warningCount,infoCount}:
  scope-feasibility-agent,{N},{N},{N},{N}
  feature-coverage-agent,{N},{N},{N},{N}
  strategy-agent,{N},{N},{N},{N}
  ux-agent,{N},{N},{N},{N}

findings[N]{id,agent,severity,dimension,title,description,recommendation}:
  {all findings from all agents, merged and deduped}

crossCuttingThemes[N]{theme,findingIds,confidence}:
  {themes flagged by multiple agents}
```

3. This enables `/loom-roadmap review-integrate` to read findings from disk in autonomous pipelines.

### Review Output Format

Use the structured summary format from Step R3, followed by cross-cutting themes and next steps. Keep each agent's summary concise (3-5 lines) — the full reports are available on request.

---

## Command: `review-integrate`

1. Read the most recent roadmap review file in `.plan-history/reviews/` (files matching `*-roadmap-review.toon`)
2. Parse findings by severity (blocking → warning → info)
3. Filter to actionable findings
4. Spawn `roadmap-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/roadmap-builder-agent.md` first."
   - Current roadmap
   - Filtered review findings
   - Instruction: "Apply these review recommendations. Use refinement mode. Annotate each change."
5. Run roadmap validation on the result
6. Show proposed changes for user approval (or auto-apply if `--auto`)
7. On approval: write roadmap, snapshot old version, update changelog

---


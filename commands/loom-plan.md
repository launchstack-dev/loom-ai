---
description: "create, review, execute, test, status — plan lifecycle from roadmap to wave execution"
---
# Plan Manager

You manage plan operations for Loom: creating plans from roadmaps, reviewing them with parallel agents, executing them wave-by-wave, and generating tests.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands
- `create`: generate PLAN.md from an approved roadmap
- `review`: launch 6 specialized agents to review a plan in parallel
- `execute`: wave-by-wave plan execution with parallel agents
- `test`: generate and run acceptance criteria, unit, and E2E tests
- `status`: show plan progress

Remaining arguments after the subcommand are passed to the subcommand handler.

### Pattern Flags (available on any subcommand)

These flags invoke a multi-agent pattern before or during the subcommand's main work:

- `--debate "question"`: Run an adversarial debate before proceeding. The debate result is injected as a constraint for the subcommand. E.g., `/loom-plan create --debate "monolith vs microservices"` debates the architecture before generating the plan.
- `--chain "task"`: Run a progressive refinement chain on a specific artifact produced by the subcommand.
- `--vote "problem"`: Run parallel independent agents on a specific decision point. E.g., `/loom-plan execute --vote task-3` produces 3 independent implementations of task-3 and picks the best.
- `--triage "task"`: Route a subtask through the triage classifier before execution.

When a pattern flag is present:
1. Read `~/.claude/agents/protocols/orchestration-patterns.md` and `~/.claude/agents/protocols/pattern-executor.md`
2. Execute the pattern first using the same logic as `/loom debate`, `/loom chain`, `/loom vote`, or `/loom triage`
3. Inject the pattern's result into the subcommand's context (e.g., debate recommendation becomes a locked decision for plan creation, vote winner replaces the single-agent implementation for a task)
4. Continue with the subcommand's normal flow

## Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/plan.schema.md` — the canonical PLAN.md format spec (v1 and v2)
- `~/.claude/agents/protocols/spec.schema.md` — v2 spec section formats (API specs, state machines, error handling)
- `~/.claude/agents/protocols/validation-rules.md` — plan validation stages, AgentResult validation, blocker gates, config validation
- `~/.claude/agents/protocols/execution-conventions.md` — shared rules, directory structure, context compression
- `~/.claude/agents/protocols/agent-result.schema.md` — the return format every agent must use
- `~/.claude/agents/protocols/state.schema.md` — execution state structure
- `~/.claude/agents/protocols/agent-monitoring.schema.md` — progress reporting, polling, stale detection, escalation

---

## Subcommand: (none -- help)

Display:
```
/loom-plan -- Manage plan lifecycle: create, review, execute, test

Subcommands:
  create     Generate PLAN.md from an approved roadmap
  review     Launch 6 specialized agents to review a plan in parallel
  execute    Wave-by-wave plan execution with parallel agents
  test       Generate and run acceptance criteria, unit, and E2E tests
  status     Show plan progress

Examples:
  /loom-plan create                    Generate plan from ROADMAP.md
  /loom-plan create --auto             Non-interactive plan creation
  /loom-plan create --v1               Simpler plan without API specs
  /loom-plan create --review-integrate Apply review findings to PLAN.md
  /loom-plan review                    6-agent parallel plan review
  /loom-plan execute                   Execute PLAN.md wave-by-wave
  /loom-plan execute --dry-run         Preview wave structure
  /loom-plan execute --resume          Resume from saved state
  /loom-plan execute --auto            Skip human approval gates
  /loom-plan execute --contracts-only  Run only Wave 0 contracts
  /loom-plan test                      Generate test suite from plan
  /loom-plan test --run                Generate AND run tests
  /loom-plan status                    Show plan progress
```

---

## Subcommand: create

You create a PLAN.md (v2, spec-driven) from an approved ROADMAP.md. The roadmap defines the strategy (features, milestones, vision); this subcommand generates the detailed execution spec (phases, waves, API specs, state machines, schemas, acceptance criteria, file ownership).

### Arguments

Parse remaining arguments:
- No args: create PLAN.md from ROADMAP.md in current directory
- `<path>`: use a specific roadmap file as source
- `--auto`: accept defaults without interactive prompting
- `--v1`: generate a v1 plan (simpler, no API specs or state machines)
- `--output <path>`: write plan to a custom path (default: `PLAN.md`)
- `--review-integrate`: apply plan review findings to PLAN.md (skips generation, goes directly to Step R)

### Instructions

#### Step 0: Gather Context

1. **Find the roadmap.** Read ROADMAP.md (or user-specified path).
   - If it doesn't exist: "No roadmap found. Run `/loom-roadmap init` to create one first." Stop.
   - If frontmatter `status` is not `approved`: "Roadmap status is '{status}'. Approve it first with `/loom-roadmap approve`, or pass `--force` to proceed anyway."

2. **Scan the codebase** for context (same scan as `/loom-roadmap init` Step 1):
   - `ls` project root -> top-level structure
   - Read package.json / pyproject.toml / go.mod / Cargo.toml -> tech stack
   - Glob source files -> file inventory by directory
   - Check for existing schemas, migrations, type definitions
   - Read `CLAUDE.md` and `CONTEXT.md` if they exist

3. **Read existing plan** if PLAN.md already exists:
   - Warn: "PLAN.md already exists ({N} phases, {M} waves). Overwrite? (yes / merge / cancel)"
   - `merge` = pass existing plan to the builder agent as context to preserve manual additions
   - `cancel` = stop

4. **Check for pending notes.** Read `.plan-execution/notes.toon` if it exists. Filter for pending notes tagged `architecture`, `decision`, `security`, `perf`. Include them as advisory context for the plan builder.

5. **Read scope contract** if `scope-contract.toon` exists:
   - Contract decisions → architecture constraints for the plan builder
   - Contract success criteria → acceptance criteria seeds
   - Contract tech context → file ownership hints and tech stack confirmation
   - Contract non-goals → explicit out-of-scope annotations
   - Pass the full contract to the plan-builder-agent prompt

#### Step 1: Plan Generation

Spawn `plan-builder-agent` (general-purpose):
```
"Read your instructions from `~/.claude/agents/plan-builder-agent.md` first,
 then read `~/.claude/agents/protocols/plan.schema.md` and
 `~/.claude/agents/protocols/spec.schema.md`.

 Generate a planVersion: {2 unless --v1} spec-driven plan from this approved roadmap.
 Map features to phases, milestones to wave boundaries, conceptual data model to
 fully typed schema with indexes and cascades.
 {If v2: Include API Specification, State Machines, and Error Handling sections per spec.schema.md.}

 Roadmap content:
 {full ROADMAP.md text}

 Codebase context:
 {context summary from Step 0}

 {If pending notes exist: Advisory notes from development:
 {filtered notes}}

 {If merging existing plan: Existing plan to preserve where applicable:
 {existing PLAN.md text}}"
```

#### Step 2: Validation Loop (max 2 retries)

1. **Run plan validation stages 1-4** (from `validation-rules.md`):
   - Stage 1 (Structure): frontmatter, required sections, Phase 0
   - Stage 2 (Dependencies): cycle detection, self-deps, undefined references
   - Stage 3 (Ownership): same-wave overlaps, deliverable boundary checks
   - Stage 4 (Sizing): oversized phases, missing criteria

2. **If v2**, also run **Stage 7** (spec completeness):
   - API coverage: every user-facing feature has at least one API endpoint
   - State machine coverage: entities with lifecycle transitions have state machines
   - Error code consistency: error codes referenced in API specs exist in error catalog
   - Index coverage: foreign keys and query patterns have corresponding indexes

3. **If validation passes** (0 blocking errors): proceed to Step 3.

4. **If validation fails**:
   - Compile errors into a structured report
   - Re-spawn plan-builder-agent with: the plan + the validation report + "Fix these validation errors. Do not change unrelated sections."
   - Re-validate. If still fails after 2 retries: present plan + errors to user for manual decision.

#### Step 3: Interactive Review

**If `--auto`:** skip to Step 4.

Present the plan summary and enter the interactive review loop:

```
## Plan Generated

planVersion: {1 or 2}
Phases: {N} across {M} waves
Deliverables: {N} files
Acceptance criteria: {N} total
{If v2:
API endpoints: {N}
State machines: {N} entities
Error categories: {N} codes}

Validation: {passed | N warnings}

What would you like to do?
1. [approve]          Write plan to {output path}
2. [discuss phase N]  Discuss a specific phase
3. [api]              Review API specification detail
4. [states]           Review state machine definitions
5. [errors]           Review error handling specification
6. [schema]           Review expanded schema/type definitions
7. [regenerate]       Regenerate with different constraints
8. [edit]             Make manual edits directly

>
```

Continue looping until the user approves.

#### Step 4: Write and Initialize

1. Write the validated plan to `PLAN.md` (or `--output` path).

2. Append to `.plan-history/changelog.md`:
   ```markdown
   ## YYYY-MM-DD -- Plan created from roadmap
   - Generated via /loom-plan create
   - Source: ROADMAP.md (approved)
   - planVersion: {1 or 2}
   - Phases: {N}, Waves: {N}, Deliverables: {N}
   {If v2:
   - API endpoints: {N}, State machines: {N}
   - Validation: passed (0 errors, {N} warnings)}
   ```

3. Create `.plan-history/roadmap.toon` with milestones mapped from ROADMAP.md (if it doesn't exist).

4. If pending notes were included, mark them as `assimilated` in `notes.toon` with `assimilatedTo: PLAN.md`.

5. Display next steps:
   ```
   Plan written to {path}.

   Next steps:
     /loom-plan review                    -- 6 agents analyze the plan in parallel
     /loom-plan create --review-integrate -- apply review findings to PLAN.md
     /loom-plan execute --dry-run         -- preview the wave structure
     /loom-roadmap status                 -- see unified roadmap + plan progress
   ```

#### Step 4.5: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to capture the plan's architecture and specs:

```
subagent_type: "general-purpose"
run_in_background: true
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `plan-created`
- Event data: PLAN.md path, phase structure, schema definitions, API contracts (v2), acceptance criteria
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails, log a warning and continue. Wiki maintenance never gates the workflow.

#### Step R: Review Integrate (`--review-integrate` only)

Skips Steps 0-4. Applies plan review findings directly to an existing PLAN.md.

1. Read the most recent plan review file in `.plan-history/reviews/` (files matching `*-review.toon`, excluding `*-roadmap-review.toon`). If none found: "No plan review found. Run `/loom-plan review` first." Stop.
2. Parse findings by severity (blocking -> warning -> info)
3. Filter to actionable findings (skip pure observations)
4. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Current PLAN.md contents
   - Filtered review findings
   - Instruction: "Apply these approved review recommendations. Do not change unrelated sections. Annotate each change with the finding that motivated it."
5. Run validation on the result (stages 1-4, plus Stage 7 for v2 plans)
6. Show proposed changes for user approval (or auto-apply if `--auto`)
7. On approval: write plan, snapshot old version to `.plan-history/snapshots/`, update changelog

### Error Handling

- **No roadmap**: direct user to `/loom-roadmap init`
- **Unapproved roadmap**: direct user to `/loom-roadmap approve`
- **plan-builder-agent fails**: retry once with error context. If retry fails, save partial output to `.plan-execution/plan-draft.md` and tell user.
- **Validation fails after retries**: present plan with errors, let user decide (accept with warnings / edit manually / abort)

### Status Line Updates

Write `.plan-execution/status.toon` at every phase transition:
```toon
command: plan-create
phase: {context-gathering | generating | validating | reviewing | writing | complete}
wave: 0
totalWaves: 1
agentsRunning: {N}
agentsDone: {N}
agentsTotal: 1
agentsFailed: 0
findings: 0
updatedAt: {ISO timestamp}
```

---

## Subcommand: review

You are an orchestrator that launches 6 specialized planning agents in parallel to review, improve, or create a project plan.

### Context

This subcommand reviews a PLAN.md (or equivalent planning document) by spawning 6 specialized agents simultaneously. Each agent focuses on a different dimension of plan quality. After all agents complete, synthesize their findings into a unified summary.

### Arguments

Parse remaining arguments:
- No args: look for a PLAN.md in the current working directory
- `<path>`: use that file instead
- `--full`: run all agents with extended analysis (default behavior)

### Instructions

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 0: Read Protocols

Read `~/.claude/agents/protocols/validation-rules.md` for AgentResult validation and blocker gate enforcement rules.

#### Step 1: Find the Plan

Locate the planning document -- check for PLAN.md, plan.md, or whatever the user specified. Read it to confirm it exists and has content.

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

1. Create `.plan-history/reviews/` if it doesn't exist
2. Save the synthesized report to `.plan-history/reviews/YYYY-MM-DD-review.toon` using TOON format
3. This enables `/loom-plan create --review-integrate` to read findings from disk in autonomous pipelines

### Output Format

Use the structured summary format from Step 3, followed by cross-cutting themes and next steps. Keep each agent's summary concise (3-5 lines) -- the full reports are available on request.

---

## Subcommand: execute

You are an orchestrator that executes a project plan wave-by-wave using specialized agents. You drive the full lifecycle: initialize state, run contracts, spawn parallel implementers, wire outputs together, verify quality, and manage human approval gates.

### Arguments

Parse remaining arguments:
- No args: execute `PLAN.md` in the current working directory
- `path/to/plan`: execute that specific plan file
- `--init`: scaffold a PLAN.md template interactively, then stop
- `--dry-run`: show the wave structure without executing
- `--resume`: resume from `.plan-execution/state.toon`
- `--wave N`: re-run only wave N using existing contracts and prior outputs
- `--contracts-only`: run only Wave 0 (contracts agent), then stop
- `--rollback-wave N`: revert to the git state before wave N
- `--auto`: skip human approval gates, use automated quality gates instead
- `--no-auto-commit`: disable per-wave auto-commits (code accumulates in working tree)

### Project-Specific Agents

Check for `.claude/orchestration.toml` in the project root. If it exists, read the `execution:` section to discover app-specific agents. Each declares a `phase` indicating when it runs in the wave lifecycle:

- `pre-contracts` -- before contracts-agent (rare, e.g., schema generators)
- `post-contracts` -- after contracts-agent, before implementers (e.g., migration generators)
- `post-implementer` -- after implementer-agents, before wiring (e.g., seed data, API docs)
- `post-wiring` -- after wiring-agent, before verification (e.g., integration setup)

Spawn project-specific agents at their declared phase using `subagent_type: "general-purpose"`. In the prompt, tell the agent to read its instructions from the `.md` file path declared in `orchestration.toml` -- do NOT embed the file contents. Agents with `outputRole: producer` return standard `AgentResult` and create files tracked in state.toon.

If `orchestration.toml` declares `settings.maxParallelAgents`, respect that limit when spawning.

### Kit Agents (Insertion Points)

In addition to project-specific agents (which use the `phase` field), check `orchestration.toml` for kit agents registered under `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]`. Kit agents use the `insertionPoint` field instead of `phase`. See `agents/protocols/kit.schema.md` for the full specification.

**6 insertion points** (kit agents fire at these pipeline boundaries):

- `pre-scope` -- before scope contract generation (only in `/loom auto`)
- `post-scope` -- after scope contract locked, before roadmap
- `pre-execute` -- before each execution wave starts (before contracts-agent or implementers)
- `post-execute` -- after each execution wave completes (after wiring-agent finishes)
- `pre-verify` -- before verification agent runs (typecheck, test, lint)
- `post-verify` -- after verification agent completes

**Important:** Kit insertion points and project-specific phases are separate systems. `insertionPoint` is for kit agents (`[[kit.*.agents]]`). `phase` is for project agents (`[[execution.agents]]`). Both can coexist in the same orchestration.toml without conflict.

**Discovery and execution at each insertion point:**

1. Read all `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]` entries from orchestration.toml
2. Filter to entries whose `insertionPoint` matches the current pipeline boundary
3. **Conditional activation:** If an entry has a `condition` field (file ownership glob, e.g., `**/*.sql OR **/dbt_project.yml`), check whether any files in the current wave's ownership match the glob. If no match, skip that agent.
4. **Topological sort:** If entries declare `after` or `before` fields, sort them accordingly. If a cycle is detected, log: "Kit agent ordering cycle detected: {agent A} → {agent B} → {agent A}. Halting." and set wave status to failed.
5. **Gates first:** At each insertion point, run gate agents (`[[kit.<name>.gates]]`) before non-gate agents. This ensures quality gates can block before reviewers/producers run.
6. Spawn each agent using `subagent_type: "general-purpose"`, instructing it to read its `.md` file from the `source` path in orchestration.toml.

**Gate evaluation (for `[[kit.<name>.gates]]` agents):**

After a gate agent returns its AgentResult, inspect the `gate` field:

- `gate: pass` or gate field absent → continue normally
- `gate: warn` → log inline warning: "⚠ Gate {agent name} at {insertionPoint}: {gateReason}". Increment `gateWarnCount` in wave summary. Continue.
- `gate: fail` with `failAction: halt` → stop the wave. Display:
  ```
  ## Gate Failed: {agent name}
  
  Insertion point: {insertionPoint}
  Reason: {gateReason}
  
  Actions:
    1. retry   — re-run the gate agent
    2. skip    — ignore this gate and continue
    3. abort   — stop execution
  ```
  Wait for user input (or ESCALATE if `--auto`).
- `gate: fail` with `failAction: retry` → re-run the gate agent up to `retryMax` times (default 3). Display: "Retrying gate {agent name} (attempt {N}/{retryMax})...". On exhaustion, fall through to halt behavior with note: "Gate retries exhausted."
- `gate: fail` with `failAction: warn` → same as `gate: warn` above
- **Malformed gate response** (gate field present but not valid TOON) → treat as `gate: warn` with gateReason: "malformed gate response from {agent}". Never halt on bad data.
- **Agent timeout** → treat as `gate: warn` with gateReason: "gate agent timed out". Continue.

**Zero-overhead path:** If `orchestration.toml` does not exist, or exists but has no `[[kit.*]]` sections, skip all kit agent logic entirely. Do not read or parse orchestration.toml for kit sections unless `[[kit.` appears in the file.

**Wave summary integration:** After all kit agents at an insertion point complete, record in `wave-N-summary.toon`:
```toon
kitGates[N]{agent,insertionPoint,gate,gateReason}:
  data-quality-gate,pre-execute,pass,"All 12 schema checks passed"
kitWarnings: 0
kitHalts: 0
```

**Status line:** When kit agents are running, update `.plan-execution/status.toon` with `kitAgentsRunning: {N}` and `kitInsertionPoint: {current point}`.

### Instructions

#### Step 0: Handle Special Flags

**If `--init`:**
1. Ask the user about their project: What are you building? What's the tech stack? What are the major features?
2. Scaffold a PLAN.md with sections: Overview, Tech Stack, Schema/Types, Phases (with wave hints), Acceptance Criteria
3. Include inline comments explaining what each section controls
4. Write the file and stop

**If `--dry-run`:**
1. Read the plan file
2. Analyze it and propose a wave structure:
   - Wave 0: What contracts to create
   - Wave 1-N: What implementation tasks, with file ownership assignments
   - Wiring passes and verification gates
3. Display the proposed structure and stop

**If `--rollback-wave N`:**
1. Read `.plan-execution/state.toon`
2. Find the git tag/stash for wave N: `plan-exec-wave-N-pre`
3. Confirm with user, then restore

**If `--resume`:**
1. Read `.plan-execution/state.toon`
2. **Reconstruct context from stage summaries.** Read all files in `.plan-execution/stage-context/` to rebuild pipeline position:
   - For each `stage-context/*.toon` file, parse `stage`, `wave`, `summary`, `keyDecisions`, `nextStageHints`
   - Determine last completed wave from state.toon `currentWave` and wave statuses
   - Regenerate `rolling-context.md` from stage summaries using tiered compression (hot/warm/cold)
   - This ensures fresh context after a `/clear` + `--resume` cycle
3. Check for drift: compare current file hashes against `fileHashes` from last completed wave
4. If drift detected, warn user and ask whether to proceed
5. Display resume summary:
   ```
   Resuming execution from wave {N+1}/{total}
   Completed waves: {list}
   Context reconstructed from {count} stage summaries
   ```
6. Jump to the appropriate step in the main loop below

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 1: Initialize

1. Read the plan file. Confirm it exists and has content.

2. **Validation gate.** Before creating `.plan-execution/`, run plan validation stages 1-4 from `validation-rules.md` Section 6:
   - **Stage 1 (Structure):** Verify frontmatter, required sections, Phase 0 existence and contracts-agent assignment
   - **Stage 2 (Dependencies):** Build dependency graph, run cycle detection (Kahn's algorithm), check for self-deps and undefined references
   - **Stage 3 (Ownership):** Check for same-wave file ownership overlaps, verify deliverables fall within ownership boundaries
   - **Stage 4 (Sizing):** Flag phases with >12 deliverables (blocking), 0 acceptance criteria (blocking), >8 deliverables (warning)

   **If blocking errors found:** Display the full validation report and abort. Suggest the user run `/loom-roadmap refine` or `/loom-roadmap validate --deep` to fix issues before retrying.

   **If warnings only:** Display the validation report and ask the user whether to proceed or fix first. Warnings do not block execution but may indicate plan quality issues.

   **If clean:** Proceed to step 3.

3. Analyze the plan to extract or infer:
   - Schema/type definitions (for contracts-agent)
   - Implementation tasks grouped into waves
   - File ownership per task
   - Verification commands (typecheck, test, lint)
   - Acceptance criteria per task
4. Create `.plan-execution/` directory structure:
   - `.plan-execution/.gitignore` containing `*`
   - `.plan-execution/state.toon` (initialized per schema)
   - `.plan-execution/rolling-context.md` (empty)
   - `.plan-execution/contracts/` directory
   - `.plan-execution/requests/` directory
   - `.plan-execution/progress/` directory (for agent monitoring)
5. Create a git tag `plan-exec-start` for rollback safety

#### Step 1.5: Scope Coverage Check

1. For each phase in the plan, collect all `acceptanceCriteria` entries
2. For each criterion, identify task(s) that cover it by matching:
   - File ownership overlap (task owns files in the criterion's domain)
   - Objective keyword matching (task objective addresses the criterion)
3. Write `.plan-execution/scope-coverage.toon`:
   ```toon
   criteria[N]{phaseId,criterion,coveringTasks,status}:
     0,All types compile with npx tsc --noEmit,w0-contracts,pending
     1,All repository functions use parameterized queries,w1-data-layer,pending
     2,Routes access repositories through req.app.locals,w1-api-routes,pending
   ```
   If writing `scope-coverage.toon` fails (disk error, missing directory), warn the user:
   ```
   Warning: Scope tracking unavailable: could not write scope-coverage.toon.
     Scope drift detection will be skipped for this run. Continuing execution.
   ```
   Continue to Step 2 without scope tracking.

4. If any criterion has 0 covering tasks (orphaned):
   ```
   Warning: SCOPE REDUCTION: N acceptance criteria have no covering tasks:

   Phase 2, Criterion: "Dashboard renders user list"
     -> No task owns UI files or has matching objective

   Options: proceed anyway / abort / assign manually
   ```
5. If `--auto`: log orphaned criteria as a warning in state.toon, then proceed. Do not wait for user input. Otherwise, wait for user decision before proceeding.

#### Step 2: Wave 0 -- Contracts

1. Update state.toon: wave 0 = in_progress
2. Create a git tag `plan-exec-wave-0-pre`
3. Spawn a single Agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/contracts-agent.md` first."
   - The schema/type specifications extracted from the plan
   - The output directory: `.plan-execution/contracts/`
   - Instruction to return an AgentResult as the last block of output

5. Parse the AgentResult from the agent's return value
6. Write `wave-0-summary.toon` and `wave-0-summary.md` to `.plan-execution/`. Also copy `wave-0-summary.toon` to `.plan-history/executions/wave-0-summary.toon` for persistence (see `execution-conventions.md` § Persistence).
7. Update `rolling-context.md` with Wave 0 as HOT entry
8. Update state.toon: wave 0 tasks complete

**If `--contracts-only`:** Display results and stop here.

#### Step 3: Verify Wave 0

1. Spawn verification-agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/verification-agent.md` first."
   - Verification commands from the plan (or auto-detect: try `npm run typecheck`, `npm test`, etc.)
   - File ownership: `{"contracts-agent": [list of files from AgentResult]}`
   - Wave index: 0
3. Parse verification AgentResult
4. Update state.toon with verification result

5. **Write stage context.** Write `.plan-execution/stage-context/contracts.toon` following the `StageContext` schema from `stage-context.schema.md`. Populate fields from the Wave 0 agent results and verification outcome:
   ```toon
   stage: contracts
   wave: 0
   iteration: 0
   startedAt: {wave 0 start timestamp}
   completedAt: {verification completion timestamp}
   durationMs: {wall-clock duration}
   inputTokensEstimate: {estimated from prompt sizes}
   outputTokensEstimate: {estimated from agent output sizes}
   filesChanged[N]: {files from wave-0-summary.toon filesCreated + filesModified}
   exportsAdded[N]: {exports from wave-0-summary.toon}
   findingsResolved: 0
   findingsRemaining: {count from verification result}
   summary: {1-3 sentence summary of contracts generated}
   keyDecisions[N]: {architectural decisions from contracts-agent}
   nextStageHints[N]: {context for the next wave}
   ```
   Use atomic write: write to `stage-context/contracts.toon.tmp`, then rename to `stage-context/contracts.toon`.

#### Step 3.5: Auto-Commit Wave 0

**Skip if `--no-auto-commit` is set.**

If verification passed (Step 3):
1. Read `wave-0-summary.toon` to get `filesCreated` and `filesModified`.
2. Stage those files: `git add {filesCreated} {filesModified}`.
3. Also stage `.plan-history/executions/wave-0-summary.toon` if it was written.
4. Create commit:
   ```
   git commit -m "feat(wave-0): contracts — {entity list from wave summary}"
   ```
5. If commit fails (nothing to stage, hook rejection), log warning and continue.

#### Step 4: Human Approval Gate

If `--auto` is specified, run the Automated Quality Gate (see section below) instead of displaying the approval prompt.

Display to the user:
```
## Wave 0 Complete: Contracts

Files created: [count]
[list of files]

Verification: [pass/fail]
[details if failed]

Next wave: Wave 1 -- [description]
Tasks: [count] parallel implementers
Files affected: [count]

Proceed? (yes / re-run wave 0 / abort)
```

Wait for user approval before continuing.

#### Step 5: Wave N -- Implementation (repeat for each wave)

For each implementation wave (1, 2, ...):

1. Update state.toon: wave N = in_progress
2. Create git tag `plan-exec-wave-N-pre`
3. Read `rolling-context.md`
4. **Pattern check:** If `.claude/orchestration.toml` exists and has `[patterns.*]` entries, check each task's description against pattern triggers. If a task matches a pattern trigger (per `~/.claude/agents/protocols/pattern-executor.md`), execute the pattern instead of spawning a single implementer. The pattern's output replaces the implementer's AgentResult.
5. For each task in this wave, prepare the implementer prompt:
   - Instruction: "Read your instructions from `~/.claude/agents/implementer-agent.md` first."
   - Task objective and acceptance criteria
   - File ownership list for this specific task
   - **Specific** contract file paths relevant to this task (from manifest.toon)
   - Rolling context content
   - Technology stack and conventions
   - If `scope-contract.toon` exists, include relevant contract decisions in the prompt (filter to decisions that affect this task's domain — e.g., data access decisions for data layer tasks, auth decisions for auth tasks)
6. **Clear progress directory:** Remove all `*.toon` files from `.plan-execution/progress/` (fresh wave).

7. **Launch all implementer agents in parallel** using the Agent tool -- send ALL agent calls in a SINGLE message:
   - Each agent is `general-purpose` -- it reads its own instructions from disk
   - Each agent gets its own scoped prompt (different file ownership, different task)
   - Include the agent's `taskId` in the prompt so it can write progress to `.plan-execution/progress/{taskId}.toon`
   - Use `run_in_background: true` for all agents

8. **Monitor agents via polling loop** (per `agent-monitoring.schema.md`):

   While any agent has not completed:
   1. Wait 15 seconds (`pollIntervalSeconds`)
   2. Read `.plan-execution/progress/{taskId}.toon` for each running agent
   3. Classify each agent:
      - **reporting** -- progress file exists, `heartbeatAt` within 90s
      - **silent** -- no progress file (agent may not support protocol or just started)
      - **stale** -- progress file exists but `heartbeatAt` older than 90s
      - **completed** -- agent returned its AgentResult
      - **timed-out** -- wall clock exceeded agent's timeout
   4. **Render dashboard:**
     ```
     === Wave N Progress (K agents) ===  [elapsed: Xm Ys]

       task-id  agent-type  ..........      65%  implementing   "Current activity"  heartbeat 8s ago
       ...

       Completed: X/K  |  Stale: Y  |  Timed out: Z
     ```
   5. **Escalate as needed:**
      - Silent > 120s after spawn -> warn in dashboard
      - Stale > 90s -> warn in dashboard
      - Stale > 180s -> send `MONITORING: heartbeat nudge` via SendMessage to that agent
      - Stale > 270s -> present options to user: wait longer / send custom message / mark failed
      - Wall clock > agent timeout -> present timeout options to user
   6. On agent completion notification -> mark done, proceed to collect AgentResult

   If an agent ignores progress reporting entirely, the loop classifies it as `silent` and continues waiting -- monitoring is additive, never gating.

9. Collect all AgentResults

#### Step 6: Reconciliation Check (after Step 5 completes)

Before wiring, check for problems:
1. **File ownership violations**: Did any agent modify files outside its declared boundary?
2. **Conflicting exports**: Did two agents export the same symbol name?
3. **Cross-boundary requests**: Are there files in `.plan-execution/requests/`?
4. **Contract amendments**: Did any agent flag contract issues?

If `--auto` and blocking conflicts found: attempt auto-resolution by assigning conflicting files to the wiring-agent. If still conflicting after wiring: escalate (set wave status to failed).

If not `--auto` and blocking conflicts found, report to user and ask how to proceed.

#### Step 7: Wiring Pass

1. Spawn wiring-agent (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/wiring-agent.md` first."
   - All implementer AgentResults in the prompt
   - Contract manifest path
   - Wave index
   - Project conventions
3. Parse wiring AgentResult
4. Write `wave-N-summary.toon` and `wave-N-summary.md` to `.plan-execution/`. Also copy `wave-N-summary.toon` to `.plan-history/executions/wave-N-summary.toon` for persistence.

#### Step 8: Verify Wave N

Same as Step 3 but for wave N:
- Include all file ownership from all implementers + wiring agent
- Run typecheck, tests, lint, ownership drift

After verification completes, **write stage context.** Write `.plan-execution/stage-context/execute.toon` following the `StageContext` schema from `stage-context.schema.md`. Populate fields from the Wave N agent results and verification outcome:
   ```toon
   stage: execute
   wave: {N}
   iteration: 0
   startedAt: {wave N start timestamp}
   completedAt: {verification completion timestamp}
   durationMs: {wall-clock duration}
   inputTokensEstimate: {estimated from all agent prompt sizes}
   outputTokensEstimate: {estimated from all agent output sizes}
   filesChanged[N]: {deduplicated files from all implementer + wiring AgentResults}
   exportsAdded[N]: {deduplicated exports from all AgentResults}
   findingsResolved: {count from verification improvements vs prior wave}
   findingsRemaining: {count from verification result}
   summary: {1-3 sentence summary of what was implemented}
   keyDecisions[N]: {decisions from implementer agents}
   nextStageHints[N]: {context for the next wave or stage}
   ```
   Use atomic write: write to `stage-context/execute.toon.tmp`, then rename to `stage-context/execute.toon`.

#### Step 8.5: Auto-Commit Wave N

**Skip if `--no-auto-commit` is set.**

If verification passed (Step 8):
1. Read `wave-N-summary.toon` to get `filesCreated` and `filesModified`.
2. Stage those files: `git add {filesCreated} {filesModified}`.
3. Also stage `.plan-history/executions/wave-N-summary.toon` if it was written.
4. Determine commit prefix:
   - If `filesCreated` is non-empty → `feat`
   - If `filesCreated` is empty (all modifications) → `refactor`
5. Create commit:
   ```
   git commit -m "{prefix}(wave-{N}): {phase description from plan}"
   ```
6. If commit fails, log warning and continue.

#### Step 9: Update Context + Gate

1. **Compress rolling-context.md:**
   - Current wave becomes HOT (full summary)
   - Previous HOT becomes WARM (compress to key decisions + interface changes)
   - Oldest WARM becomes COLD (compress to one-line)
   - Target: keep under 10k tokens total

2. Update state.toon: wave N complete, store file hashes

3. **Scope drift check:**
   - If `.plan-execution/scope-coverage.toon` does not exist, skip drift check and note "Scope tracking unavailable" in the human gate summary
   - Otherwise, read `.plan-execution/scope-coverage.toon`
   - For each task that succeeded in this wave, mark its criteria as `covered`
   - For each task that failed and won't be retried (`retryCount >= 2`):
     - Remove the failed task from each criterion's `coveringTasks`
     - Mark a criterion as `orphaned` ONLY if its `coveringTasks` becomes empty AND its status is not already `covered` or `dropped`
   - If new orphans detected, display SCOPE DRIFT warning before the human gate

4. **Human approval gate** -- If `--auto`: run the Automated Quality Gate instead of asking the user. Otherwise, same format as Step 4:
   - Show files changed, verification results
   - Show next wave preview
   - Ask: proceed / re-run wave / abort

#### Step 9.1: Context Checkpoint (every 2 waves)

After updating context and before the contract drift check, evaluate whether a context checkpoint is appropriate:

1. **Check wave count.** If `N % 2 == 0` and `N > 0` (i.e., after waves 2, 4, 6, ...):

2. **Write all state to disk atomically:**
   - Ensure `state.toon` is current (already done in Step 9.2)
   - Ensure `rolling-context.md` is current (already done in Step 9.1)
   - Ensure all `stage-context/*.toon` files are current
   - Write a checkpoint marker to `.plan-execution/checkpoint.toon`:
     ```toon
     checkpointAt: {ISO timestamp}
     wave: {N}
     totalWaves: {total}
     completedWaves[N]: {list of completed wave indices}
     resumeCommand: /loom-plan execute --resume
     stateFiles[N]: state.toon,rolling-context.md,scope-coverage.toon
     ```
     Use atomic write (`.tmp` then rename).

3. **Present checkpoint prompt:**
   ```
   ## Context Checkpoint (Wave {N}/{total})

   State saved to disk:
   - Execution state: .plan-execution/state.toon (wave {N} complete)
   - Rolling context: .plan-execution/rolling-context.md
   - Stage summaries: .plan-execution/stage-context/
   - Scope coverage: .plan-execution/scope-coverage.toon

   Waves completed: {N}/{total}
   Next wave: Wave {N+1} -- {description}

   Run `/clear` for fresh context, then:
     /loom-plan execute --resume
   ```

4. **If `--auto`:** log the checkpoint message but do NOT pause. Continue to the next step. The checkpoint data is on disk if the context monitor hook triggers a forced clear later.

5. **If not `--auto`:** display the checkpoint prompt and wait for user input:
   - `continue` -- proceed without clearing (default)
   - `clear` -- user will manually run `/clear` then `--resume`

#### Step 9.3: Contract Drift Check

If `scope-contract.toon` exists:
1. Read the contract decisions
2. For each file modified in this wave, check if the implementation contradicts any contract decision (e.g., contract says "repository + raw SQL" but agent introduced an ORM import)
3. If violations found, log them in the wave summary: "Contract drift: {decision ID} {decision} — {violation description}"
4. Do NOT block execution for drift — just warn. The review stage will catch and flag these.

#### Step 9.5: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to capture what was built in this wave:

```
subagent_type: "general-purpose"
run_in_background: true
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `wave-complete`
- Event data: wave summary from `.plan-execution/wave-N-summary.toon`, files created/modified, contracts established (wave 0), implementation decisions
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails: (1) Log a warning in state.toon under `wikiUpdateStatus: failed` with the error summary, (2) Increment a `wikiConsecutiveFailures` counter in state.toon, (3) If `wikiConsecutiveFailures >= 2`, add a visible note to the human approval gate: "Wiki updates have failed for {N} consecutive waves. Run `/loom-wiki lint` to diagnose." (4) Continue to the next step. Wiki maintenance never gates the pipeline.

Do NOT count wiki maintenance against circuit breaker thresholds or agent budgets.

#### Step 10: Repeat or Complete

- If more waves remain, go to Step 5
- If all waves complete:

```
## Execution Complete

Run ID: [uuid]
Waves completed: [N]
Total files created: [count]
Total files modified: [count]
Verification: All passing

Rolling context and state preserved in .plan-execution/
Use --resume if you need to re-run any wave.
```

### Error Handling

#### Agent failure (timeout or error)
- Mark the task as failed in state.toon (increment retryCount)
- If retryCount < 2: retry with error context added to prompt
- If retryCount >= 2: report failure, ask user: skip task / abort wave / abort run
- Other tasks in the wave that succeeded are preserved

#### Verification failure
- Display failing checks with file context
- Ask user: fix manually and re-verify / re-run wave / abort

#### Unexpected state
- If `.plan-execution/.lock` exists with a live PID, abort with warning
- If state.toon is missing or corrupt, offer to reinitialize

### Automated Quality Gate (--auto mode)

When `--auto` is active, replace all human approval gates (Steps 4 and 9) with this automated decision logic:

**PROCEED** if:
- `verification.status == "pass"` (all checks green)
- Zero blocking issues in any AgentResult
- Zero file ownership violations
- Zero gate halts from kit agents (`kitHalts == 0` in wave summary)

**RETRY** (re-run failed agents, max 2 retries per wave) if:
- Verification failed
- AND all failures are in files owned by this wave's agents
- AND `wave.retryCount < 2`

On retry:
1. Increment `retryCount` in state.toon
2. Re-spawn ONLY the failed agents with error context added to prompt:
   "Your previous attempt failed verification. Errors: [exact typecheck/test output for files you own]. Fix these issues."
3. Re-run wiring-agent with mix of preserved + new results
4. Re-run verification-agent
5. Re-evaluate this gate

**ESCALATE** (set status=paused) if:
- Verification failures are in files NOT owned by this wave
- OR `wave.retryCount >= 2`
- OR reconciliation found blocking conflicts that auto-resolve failed
- OR any kit gate returned `gate: fail` with `failAction: halt` (gate halt — display gate agent name, insertion point, and gateReason in escalation)

On escalate:
1. Set wave status to "failed" in state.toon
2. Set run status to "paused"
3. The calling orchestrator (`/loom auto`) reads state.toon and decides: revise plan or give up

**GATE-WARN** (proceed with logged warnings) if:
- Kit gates returned `gate: warn` (or `gate: fail` with `failAction: warn`)
- AND all other conditions would PROCEED
- Log all gate warnings in the wave summary. Do not block.

### Runtime Feedback

Throughout execution, keep the user informed:
- "Starting Wave N: [description] -- [count] agents in parallel"
- As each agent completes: "Agent [name] completed: [success/failure] -- [file count] files"
- "Running verification..."
- "Wiring pass complete: [changes summary]"

Never go silent for more than 30 seconds without a status update.

---

## Subcommand: test

You are an orchestrator that generates and runs a comprehensive test suite for a project plan. You drive the full testing pipeline: extract acceptance criteria, generate unit tests, generate E2E tests, run everything, and report coverage.

### Arguments

Parse remaining arguments:
- No args: test against `PLAN.md` in the current working directory
- `path/to/plan`: test against that specific plan file
- `--criteria-only`: extract acceptance criteria and stop (no test generation)
- `--unit-only`: generate and run unit tests only (skip E2E)
- `--e2e-only`: generate and run E2E tests only (skip unit)
- `--chrome`: use interactive Chrome mode for E2E tests (requires `claude --chrome`)
- `--spec path/to/spec.toon`: skip criteria extraction, use existing test spec
- `--phase N`: only test phase N (default: all phases)
- `--run`: generate AND run tests (default: generate only)
- `--parallel`: run unit and E2E test generation in parallel
- `--auto`: skip interactive approval prompts, proceed automatically through all stages

### Instructions

#### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 0: Gather Context

1. Read the plan file
1b. Check for `.claude/orchestration.toml` in the project root. If it exists, read the `testing:` section to discover app-specific testing agents. These declare a `phase` (post-criteria, post-unit, post-e2e) and are spawned at the appropriate step alongside the built-in agents. Use `subagent_type: "general-purpose"` -- instruct each agent to read its own `.md` file from the path declared in `orchestration.toml`.
2. Check for existing test infrastructure:
   - Is vitest/jest installed? Check `package.json`
   - Is Playwright installed? Check for `playwright.config.ts` or `@playwright/test` in deps
   - Are there existing test files? Glob for `**/*.test.ts`, `**/*.spec.ts`, `e2e/**`
3. Check for `.plan-execution/` directory -- if it exists, read `contracts/manifest.toon` for type information
4. Check for existing test spec -- if `--spec` was provided or `.plan-execution/test-spec.toon` exists

#### Step 1: Extract Acceptance Criteria

Skip if `--spec` was provided.

Spawn the `acceptance-criteria-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/acceptance-criteria-agent.md` first.

## Your Task

Analyze the following plan and generate structured test specs.

### Plan:
{contents of the plan file}

### Existing Source Files:
{glob results for src/**/*.ts or equivalent}

### Phase Filter:
{--phase N if specified, otherwise "all phases"}
```

Save the output to `.plan-execution/test-spec.toon`.

Display a summary to the user:
- Total test specs by category (contract/behavior/e2e)
- By priority (P0/P1/P2)
- Coverage gaps identified

**If `--criteria-only`, stop here.**

If `--auto`: proceed without asking. Otherwise, ask the user: "Test specs generated. Proceed with test generation?" Wait for approval.

#### Step 2: Generate Unit Tests

Skip if `--e2e-only`.

Determine file ownership for the unit-test-agent:
- All `**/*.test.ts` and `**/__tests__/**` patterns
- Any test helper files: `test/helpers/**`, `test/fixtures/**`

Spawn the `unit-test-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/unit-test-agent.md` first.

## Your Task

Generate unit tests based on the following test spec.

### Test Spec:
{contents of test-spec.toon, filtered to contractTests and behaviorTests}

### Contract Files:
{list contract file paths from .plan-execution/contracts/manifest.toon, or "no contracts available"}

### Source Files to Test:
{list of source files from the plan's deliverables}

### Test Framework: {vitest|jest -- detected from package.json}

### File Ownership:
{list of test file patterns this agent may write}
```

Collect the `AgentResult`.

#### Step 3: Generate E2E Tests

Skip if `--unit-only`.

Determine file ownership for the e2e-test-agent:
- `e2e/**`
- `playwright.config.ts`
- `stories/**` (if bowser is in use)

Detect mode:
- If `--chrome` flag: mode = "chrome"
- Otherwise: mode = "playwright"

Spawn the `e2e-test-agent` (use Agent tool with `subagent_type: "general-purpose"`):

**Prompt template:**
```
Read your instructions from `~/.claude/agents/e2e-test-agent.md` first.

## Your Task

Generate E2E tests based on the following test spec.

### Test Spec:
{contents of test-spec.toon, filtered to e2eTests}

### Source Files (routes/pages):
{list route and page files from plan deliverables}

### Base URL: {detected from package.json scripts or default http://localhost:3000}

### Mode: {playwright|chrome}

### File Ownership:
{list of e2e file patterns this agent may write}
```

Collect the `AgentResult`.

#### Step 2+3 Parallel Mode

If `--parallel` is specified and neither `--unit-only` nor `--e2e-only`, spawn both agents simultaneously using parallel Agent tool calls. Collect both `AgentResult`s when done.

#### Step 4: Run Tests (if --run)

Skip if `--run` was NOT specified.

##### Unit Tests
```bash
npx vitest run --reporter=json --outputFile=unit-results.json
```
Or for Jest:
```bash
npx jest --json --outputFile=unit-results.json
```

##### E2E Tests (playwright mode)
```bash
npx playwright test --reporter=json
```

##### E2E Tests (chrome mode)
Tests were already executed interactively during Step 3. No additional run needed.

Parse results and report:
- Tests passed / failed / skipped
- Failed test details with file:line references
- Coverage percentage if available

#### Step 5: Report

Display a unified report:

```
## Test Generation Report

### Acceptance Criteria
- Total specs: {N} (P0: {n}, P1: {n}, P2: {n})
- Coverage gaps: {list}

### Unit Tests
- Files created: {list}
- Tests generated: {N} (contract: {n}, behavior: {n}, code-inspection: {n})
- {if --run} Results: {passed}/{total} passed

### E2E Tests
- Files created: {list}
- Tests generated: {N} (browser: {n}, API: {n})
- {if --run} Results: {passed}/{total} passed

### Issues
- {list any issues from both agents}

### Next Steps
- {suggested actions: install missing deps, fix failing tests, fill coverage gaps}
```

Save the report to `.plan-execution/test-report.md`.

### Error Handling

- **No plan file found**: Tell the user and suggest `--init` on `/loom-plan execute` or provide a path.
- **No source code yet**: Run criteria extraction only. Tell the user to generate tests after implementation.
- **Test framework not installed**: Suggest installation command and stop.
- **Playwright not installed for E2E**: Suggest `npm init playwright@latest` and stop.
- **Agent failure**: Report which agent failed, show the error, continue with the other agent's results.
- **Test failures (with --run)**: Show failures but don't treat as orchestrator failure. Failing tests are expected output.

### State Integration

If `.plan-execution/state.toon` exists:
- Read current wave to know which phases are implemented
- Only generate tests for implemented phases (unless `--phase` overrides)
- Update state with test results if running as part of execution pipeline

---

## Subcommand: status

Show plan progress by reading execution state.

### Instructions

1. Check for `PLAN.md` -- if missing, report "No plan found."
2. Check for `.plan-execution/state.toon` -- if missing, report "Plan exists but execution has not started."
3. If state exists, display:
   - Current wave and total waves
   - Per-wave status (pending / in_progress / complete / failed)
   - Agent counts (running / done / failed)
   - Last activity timestamp
   - Scope coverage summary (if `scope-coverage.toon` exists)
4. If `.plan-history/reviews/` has review files, show last review date and finding count.
5. If `.plan-execution/test-report.md` exists, show test summary.

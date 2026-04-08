# Roadmap Manager

You are a two-tier planning orchestrator that manages the full lifecycle from idea to execution-ready spec. The two tiers are:

1. **ROADMAP.md** (strategy) — vision, features, milestones, constraints, conceptual data model
2. **PLAN.md** (execution spec) — phases, waves, deliverables, API specs, state machines, acceptance criteria

You create, track, validate, refine, and visualize both documents.

## Protocols

Before doing anything, read these protocol files:
- `~/.claude/agents/protocols/roadmap.schema.md` — the canonical ROADMAP.md format spec
- `~/.claude/agents/protocols/plan.schema.md` — the canonical PLAN.md format spec (v1 and v2)
- `~/.claude/agents/protocols/spec.schema.md` — v2 spec section formats (API specs, state machines, etc.)
- `~/.claude/agents/protocols/validation-rules.md` — validation stages and enforcement rules
- `~/.claude/agents/protocols/execution-conventions.md` — .plan-history/ and .plan-execution/ structure
- `~/.claude/agents/protocols/agent-monitoring.schema.md` — progress reporting and stale detection

## Requirements

$ARGUMENTS

Parse arguments:
- No args or `--status`: show unified status (roadmap + plan progress + milestones + risk indicators)
- `--init`: create a new ROADMAP.md interactively using the roadmap-builder-agent
- `--init --plan`: alias for `/loom-create-plan` — create PLAN.md from approved ROADMAP.md
- `--init --full`: run full pipeline: roadmap → roadmap review → plan → plan review (interactive at each gate)
- `--init --from "description"`: create from a one-line description
- `--init --brownfield`: run codebase analysis (API surface, tech debt, existing patterns) before discussion phase
- `--discuss`: run the discussion phase to surface architectural decisions (default with `--init`)
- `--no-discuss`: skip the discussion phase entirely
- `--auto`: accept all recommended defaults without interactive prompting
- `--approve-roadmap`: mark ROADMAP.md as approved, unlocking plan generation
- `--review-roadmap`: trigger roadmap review (delegates to /loom-review-roadmap)
- `--validate [path]`: run validation pipeline on a plan (stages 1-4)
- `--validate --roadmap [path]`: run roadmap validation pipeline (stages 1-4)
- `--validate --deep [path]`: run all validation stages including agent checks
- `--refine [path]`: refine an existing plan using review history + plan-builder-agent
- `--refine --roadmap [path]`: refine an existing roadmap using review history + roadmap-builder-agent
- `--review-integrate`: apply plan review findings to PLAN.md automatically
- `--review-integrate --roadmap`: apply roadmap review findings to ROADMAP.md automatically
- `--split [path]`: split a large plan into smaller sub-plans
- `--deps [path]`: show dependency graph, critical path, bottleneck analysis
- `--diff`: compare current plan vs last snapshot
- `--history`: show plan revision history from .plan-history/changelog.md
- `--milestone add "name"`: add a milestone
- `--milestone complete "name"`: mark milestone complete
- `--milestone list`: show all milestones with status
- `--snapshot`: save current plan state for versioning

## Step 0: Gather Context (all commands)

Before any subcommand, gather available state:

1. **Find the roadmap file**: check for `ROADMAP.md`, `roadmap.md`, or user-specified path. Note if it exists and its status (draft/reviewed/approved).
2. **Find the plan file**: check for `PLAN.md`, `plan.md`, or user-specified path. Note if it exists and its planVersion (1 or 2).
3. **Check execution state**: read `.plan-execution/state.toon` if it exists → extract wave statuses, task completions.
4. **Check plan history**: read `.plan-history/roadmap.toon`, `.plan-history/changelog.md` if they exist.
5. **Check project config**: read `.claude/orchestration.toml` if it exists for custom agents.
6. **Check for legacy CONTEXT.md**: if it exists and no ROADMAP.md exists, note that decisions should be migrated.

---

## Command: `--init`

Creates a new ROADMAP.md with codebase awareness, validation, and optional agent review. To create a PLAN.md from an approved roadmap, use `/loom-create-plan`.

### Step 1: Codebase Context Gathering

Scan the project before generating the plan. The orchestrator does this directly (no agent):

```
1. ls the project root → understand top-level structure
2. Read package.json / Cargo.toml / pyproject.toml / go.mod → tech stack + dependencies
3. Read tsconfig.json / similar config → language settings
4. Glob for source files: **/*.ts, **/*.tsx, **/*.py, etc. → file inventory by directory
5. Read barrel/index files if they exist → understand module structure
6. Check for existing database schemas, migration files, type definitions
7. Count files per directory to understand architecture shape
```

Compile this into a context summary. Use TOON format for token efficiency:

```toon
projectRoot: /path/to/project
techStack: typescript,express,sqlite
packageManager: npm
existingFiles[12]: src/index.ts,src/routes/health.ts,...
existingDependencies[8]: express@4.18,better-sqlite3@11,...
testFramework: vitest
existingTests[3]: src/__tests__/health.test.ts,...
hasExistingTypes: true
existingTypeFiles[2]: src/types/index.ts,src/types/api.ts
```

### Step 1.5: Brownfield Analysis

**Only if `--brownfield` was passed.**

This step produces a deep analysis of the existing codebase so the roadmap accounts for what's already built. It goes beyond Step 1's basic scan.

1. **Check for cached analysis.** Read `.plan-execution/init-report.toon` if it exists (produced by `/loom-init`).
   - If the file exists and `completedAt` is less than 7 days old: use cached results. Display: "Using cached analysis from `/loom-init` ({date}). Run `/loom-init` to refresh."
   - If the file is stale or missing: run fresh analysis (steps 2-3 below).

2. **If no cached analysis**, spawn 2 agents in parallel (single message):

   **api-explorer** (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/api-explorer.md` first.
    Discover the API surface of this codebase: internal endpoints, external integrations, undocumented routes, database access patterns.
    Project structure: {codebase context from Step 1}"
   ```

   **docs-auditor** (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/docs-auditor.md` first.
    Audit existing documentation for staleness, gaps, contradictions. Assess Loom readiness.
    Existing docs found: {list from Step 1}"
   ```

   Also read `CLAUDE.md` and `CONTEXT.md` if they exist (produced by `/loom-init` or manually).

3. **Compile brownfield context** into a structured summary for the discussion and roadmap phases:

   ```toon
   brownfieldAnalysis:
     apiEndpoints: {count}
     externalIntegrations: {count}
     existingPatterns[N]: {list of detected architectural patterns}
     technicalDebt[N]: {list of debt items from docs-auditor}
     documentationGaps[N]: {list of missing docs}
     loomReadiness: {score}/10

   existingApis[N]{method,path,file,line}:
     GET,/api/users,src/routes/users.ts,12
     POST,/api/users,src/routes/users.ts,45

   existingIntegrations[N]{name,file,purpose}:
     Stripe,src/services/stripe.ts,payment processing
     SendGrid,src/services/email.ts,transactional email
   ```

   This context is passed to:
   - The questioner-agent in Step 1.6 (so discussion questions account for existing infrastructure)
   - The roadmap-builder-agent in Step 2 (so the roadmap builds on what exists, not from scratch)

4. **Display brownfield summary** before proceeding to discussion:

   ```
   ## Brownfield Analysis

   API Surface: {N} internal endpoints, {M} external integrations
   Architecture: {detected pattern}
   Technical Debt: {N} items flagged
   Documentation: {gaps summary}
   Loom Readiness: {score}/10

   This analysis will inform the roadmap — features won't duplicate existing endpoints,
   and the plan will account for current architecture and tech debt.
   ```

### Step 1.6: Discussion Phase

**Skip if `--no-discuss` was passed.**

1. Spawn `questioner-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/questioner-agent.md` first."
   - The codebase context summary from Step 1
   - The brownfield analysis from Step 1.5 (if `--brownfield` was used)
   - The user's project description (from `--from` or interview answers)

2. Parse the agent's decision points from its TOON output.

   **Error handling:** If the questioner-agent fails, times out, or returns unparseable output:
   - Warn user: "Discussion phase skipped due to agent failure. Proceeding to plan generation without locked decisions. Use `--discuss` to retry."
   - Skip to Step 2 without writing CONTEXT.md

3. **If `--auto`:** Accept all recommended defaults. Display them for awareness:
   ```
   ## Locked Decisions (auto-selected defaults)

   D-01: Authentication Strategy → JWT with refresh tokens
     Rationale: API-first architecture needs stateless auth
   D-02: Database Engine → SQLite via better-sqlite3
     Rationale: Zero-config for MVP scope

   Proceeding with these defaults. Use --discuss to choose interactively.
   ```

4. **Otherwise (interactive):** Present each decision to the user:
   ```
   ## D-01: Authentication Strategy [HIGH impact]

   Options:
   1. JWT with refresh tokens (recommended)
      + Stateless scaling; API-first
      - Token management complexity
   2. Session-based auth
      + Simpler implementation; built-in CSRF
      - Stateful; harder to scale
   3. OAuth2 only
      + Delegated auth; industry standard
      - Overkill for MVP; external dependency

   Choose (1-3, or describe custom approach):
   ```

   Record the user's choice for each decision.

5. **Collect decisions as structured data** for embedding into the roadmap. Format each decision as:
   ```
   C-01: Authentication Strategy
   Decision: JWT with refresh tokens
   Rationale: API-first architecture, stateless scaling
   Alternatives considered: session-based (simpler but stateful), OAuth2 (overkill for MVP)
   Impact: high

   C-02: Database Engine
   Decision: SQLite via better-sqlite3
   Rationale: Zero-config, sufficient for <10K users
   Alternatives considered: PostgreSQL (concurrent writes but requires server)
   Impact: high
   ```

   These decisions will be embedded inline in the ROADMAP.md `## Constraints & Decisions` section during Step 2 (Roadmap Generation). No standalone CONTEXT.md is written.

   **Legacy compatibility:** If a CONTEXT.md already exists in the project root (from a prior run), read it and merge any decisions not already captured.

6. Pass the collected decisions to Step 2 (Roadmap Generation).

### Step 2: Roadmap Generation

1. If `--from` provided, use the description directly. Otherwise, ask the user:
   - What are you building? (end-user experience: UI, API, CLI?)
   - Who is it for? (target users)
   - What data does this manage? (entities → conceptual model)
   - What's the tech stack? (or auto-detect from Step 1)
   - Any constraints? (existing code, timeline, team size)
2. Spawn `roadmap-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/roadmap-builder-agent.md` first, then read the format spec from `~/.claude/agents/protocols/roadmap.schema.md`."
   - The codebase context summary from Step 1
   - The user's answers/description
   - The discussion phase decisions (from Step 1.6) to embed as Constraints & Decisions
   - The brownfield analysis (from Step 1.5) if `--brownfield` was used — include as "Existing Codebase" context so the roadmap builds on what exists
   - Instruction: "Follow the Reasoning Framework. Output must conform to roadmap.schema.md."

### Step 3: Validation Loop (max 2 retries)

After receiving the generated roadmap, validate it:

1. **Parse the roadmap**: extract frontmatter, features, milestones, data model, constraints
2. **Run roadmap validation stages 1-4** (from `validation-rules.md` Section 7):
   - Stage 1: Structure — required sections, frontmatter present, title match
   - Stage 2: Features — milestone assignments, entity references, key behaviors
   - Stage 3: Milestones — cycle detection, undefined references, forward references
   - Stage 4: Data Model — entity-feature coverage, relationship validation
3. **If validation passes** (0 blocking errors): proceed to Step 4
4. **If validation fails**:
   - Compile errors into a structured report
   - Re-spawn roadmap-builder-agent with: the roadmap + the validation report + instruction "Fix these validation errors. Do not change unrelated sections."
   - Re-validate. If still fails after 2 retries: present roadmap + errors to user for manual decision.

### Step 4: Interactive Review (or auto-proceed)

**If `--auto`:** Skip interactive review. Write the roadmap and proceed.

**Otherwise:** Present the roadmap summary and enter the interactive discussion loop:

```
Roadmap generated with {N} features across {M} milestones.

## Quick Summary
Vision: {1 sentence}
Features: F-01 {name}, F-02 {name}, ...
Milestones: M-01 {name} (F-01,F-02), M-02 {name} (F-03,F-04), ...

What would you like to do?
1. [approve] Approve roadmap and write to ROADMAP.md
2. [discuss F-XX] Discuss a specific feature in detail
3. [add] Add a new feature
4. [remove F-XX] Remove a feature
5. [reprioritize] Change feature priorities
6. [constraints] Review or modify constraints/decisions
7. [scope] Review out-of-scope items
8. [regenerate] Regenerate with different parameters
9. [edit] Make manual edits directly

>
```

When the user chooses option 2 (discuss), present the full feature definition and engage in back-and-forth discussion. Incorporate their feedback into the feature. Return to the main menu when done.

Continue looping until the user approves (option 1).

### Step 5: Write and Initialize

1. Write the validated roadmap to `ROADMAP.md`
2. Initialize `.plan-history/` if it doesn't exist:
   - Create `.plan-history/changelog.md`:
     ```markdown
     # Plan Changelog

     ## YYYY-MM-DD — Initial roadmap created
     - Generated via /loom-roadmap --init
     - Features: N, Milestones: N
     - Validation: passed (0 errors, N warnings)
     ```
   - Create `.plan-history/snapshots/` directory
3. Display roadmap summary + suggest next steps:
   - `/loom-review-roadmap` for 3-agent roadmap review
   - `/loom-roadmap --approve-roadmap` to mark as approved
   - `/loom-create-plan` to generate PLAN.md from the approved roadmap

---

## Command: `--init --plan`

**Alias for `/loom-create-plan`.** Delegates directly to the standalone plan creation command.

Run `/loom-create-plan` with the same arguments. If `--auto` was passed, forward it.

---

## Command: `--init --full`

Runs the complete two-tier pipeline interactively: roadmap → roadmap review → plan → plan review.

1. Run `--init` (creates ROADMAP.md)
2. Run `--review-roadmap` (3-agent review)
3. Run `--review-integrate --roadmap` (apply findings)
4. Run `--approve-roadmap` (mark approved)
5. Run `/loom-create-plan` (creates PLAN.md v2 from roadmap)
6. Suggest `/loom-review-plan` for plan review

Each step pauses for user input unless `--auto` is also set.

---

## Command: `--approve-roadmap`

1. Read ROADMAP.md frontmatter
2. If status is already `approved`: "Roadmap is already approved."
3. Update frontmatter: `status: approved`
4. Append to changelog: "YYYY-MM-DD — Roadmap approved"
5. Display: "Roadmap approved. Ready for plan generation via `/loom-create-plan`."

---

## Command: `--review-roadmap`

Delegates to `/loom-review-roadmap`. Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-review-roadmap.md first.
 Review the roadmap at ROADMAP.md."
```

---

## Command: `--review-integrate --roadmap`

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

## Command: `--status` (default)

Pure data synthesis — no agents spawned. Read all sources and render a unified view.

### Step 1: Read All Sources

```
1. ROADMAP.md → parse features, milestones, status (draft/reviewed/approved)
2. PLAN.md → parse phases, dependencies, deliverables, acceptance criteria, planVersion
3. .plan-execution/state.toon → wave statuses, task completions, verification results
4. .plan-history/roadmap.toon → milestone tracking
5. .plan-history/changelog.md → recent entries
```

### Step 2: Reconcile Plan vs Execution

Map phases to waves using the `Wave W` in each phase header:

- For each phase, check if its wave exists in state.toon:
  - Wave `succeeded` → phase completed. Count `filesCreated` from wave summary vs planned deliverables.
  - Wave `in_progress` → phase in progress. Count completed tasks vs total.
  - Wave `pending` or missing → phase pending.
- Check criteria: cross-reference verification results in state.toon against plan's acceptance criteria.
- **Detect drift**: if PLAN.md file modification time > state.toon `startedAt`, plan was changed during execution → warn.
- **Detect stale**: if state.toon `updatedAt` > 24 hours ago → warn.
- **Detect orphans**: if state.toon has waves that don't correspond to any phase in the current plan → warn.

### Step 3: Compute Analytics

Build the dependency graph from the plan and compute:

1. **Critical path**: longest chain of sequential phases (using topological sort + longest path)
2. **Parallelization factor**: for each wave, count phases that run in parallel
3. **Bottleneck phases**: phases with the most transitive dependents
4. **Auto-update milestones**: if a phase's wave is `succeeded`, mark its milestone complete in roadmap.toon

### Step 4: Identify Risks

Flag these conditions:
- Oversized phases: deliverables > 8
- Failed waves: any wave with status `failed`
- Stale execution: updatedAt > 24h ago
- Plan/execution drift: plan modified after execution started
- Missing verification: completed waves with no verification result
- Blocked phases: phases whose dependencies include a failed wave

### Step 5: Render Status

```markdown
## Project Status

**Roadmap**: {ROADMAP.md exists ? "ROADMAP.md ({status})" : "No roadmap"}
**Plan**: {PLAN.md exists ? "PLAN.md (v{planVersion}, {status})" : "No plan"}
**Last modified**: {date}
**Execution**: {not started | wave N of M in progress | completed}

### Critical Path
Phase 0 → Phase 1 → Phase 2 (3 sequential waves, minimum execution time)
Parallelization: Wave 1 runs 2 tracks in parallel

### Phases
| Phase | Wave | Status | Deliverables | Criteria | Risk |
|-------|------|--------|-------------|----------|------|
| 0: Contracts | 0 | ✓ completed | 3/3 | 4/4 | — |
| 1a: Data Layer | 1 | ▶ in_progress | 2/8 | 0/4 | — |
| 1b: API Routes | 1 | ▶ in_progress | 3/8 | 1/4 | — |
| 2: Integration | 2 | ○ pending | 0/2 | 0/3 | — |

### Milestones
| Milestone | Target | Status | Effort |
|-----------|--------|--------|--------|
| Contracts Ready | Phase 0 | ✓ completed | S |
| MVP Backend | Phase 2 | ○ pending | L |

### Risk Indicators
- ⚠ {risk description}

### Recent Activity
- {last 5 entries from changelog}

### Suggested Next Steps
- {contextual: continue execution / run tests / refine plan / etc.}
```

---

## Command: `--validate [path]`

Run validation standalone. Validates a PLAN.md by default. Use `--roadmap` to validate a ROADMAP.md instead.

### Roadmap mode (`--validate --roadmap`)

Run roadmap validation stages 1-4 from `validation-rules.md` Section 7. Output follows the same format as plan validation but checks features, milestones, and data model coverage instead of phases, dependencies, and file ownership.

### Plan mode (default)

Useful before `/loom-review-plan` or `/loom-execute-plan`.

### Default mode (stages 1-4)

1. Read the plan file
2. Parse: extract frontmatter, phases, dependencies, ownership, deliverables, criteria
3. **Stage 1 — Structure**: check all required sections present, Phase 0 exists, frontmatter valid
4. **Stage 2 — Dependencies**: build adjacency list, run cycle detection, compute critical path
   - **Cycle detection (Kahn's algorithm)**:
     a. Compute in-degree for each phase (count incoming dependency edges)
     b. Queue all phases with in-degree 0
     c. While queue non-empty: dequeue a phase, for each phase that depends on it, decrement its in-degree. If in-degree reaches 0, enqueue it.
     d. If processed count < total phases → remaining phases form a cycle. Report which phases.
   - **Critical path (longest path in DAG)**:
     a. Build forward edges: for each phase, which phases depend on it
     b. Initialize dist[phase] = 0 for all phases
     c. For each phase in topological order: for each dependent, dist[dependent] = max(dist[dependent], dist[phase] + 1)
     d. Maximum dist value + 1 = critical path length. Backtrack for path.
5. **Stage 3 — Ownership**: build file-to-phase map, check same-wave overlaps, check deliverables within ownership
6. **Stage 4 — Sizing**: count deliverables per phase (>12 blocking, >8 warning), count criteria (0 = blocking), check criteria text quality

### Deep mode (`--deep`, stages 5-6)

7. **Stage 5 — Agent Feasibility**: for each phase, estimate context window: count files listed in "Reads" section + deliverables. If >15 → warning. Optionally spawn `agentic-workflow-agent` for deep analysis.
8. **Stage 6 — Schema Completeness**: scan all phase deliverables and criteria for entity/type references. Check each resolves to a definition in the Schema section. Optionally spawn `feature-coverage-agent` for competitive gap analysis.

### Output

```markdown
## Plan Validation Report

### Structure {✓|✗}
- [✓] Frontmatter present (v1)
- [✓] All required sections found
- [✗] Phase 1 missing Acceptance Criteria

### Dependencies {✓|✗}
- [✓] No cycles detected
- [ℹ] Critical path: Phase 0 → 1 → 2 (3 waves)
- [ℹ] Bottleneck: Phase 0 (4 transitive dependents)

### File Ownership {✓|✗}
- [✓] No same-wave conflicts
- [⚠] Deliverable src/utils/foo.ts outside Phase 2 ownership

### Sizing {✓|✗}
- [✗] Phase 3 has 16 deliverables (max 12 blocking, max 8 recommended)
- [⚠] Phase 0 has 2 deliverables (at minimum)

### Criteria Quality {✓|✗}
- [⚠] Phase 3: "loads in under 200ms" — no test mechanism

### Result: {N} errors, {N} warnings
{If errors: "Plan has blocking issues. Run /loom-roadmap --refine to fix."}
{If clean: "Plan is valid. Ready for /loom-review-plan or /loom-execute-plan."}
```

---

## Command: `--refine [path]`

Execution-aware refinement with structured analysis and change tracking. Refines a PLAN.md by default. Use `--refine --roadmap` to refine a ROADMAP.md instead (delegates to `roadmap-builder-agent` in refinement mode, using the same review findings from `.plan-history/reviews/*-roadmap-review.toon`).

### Step 1: Execution State Check

If `.plan-execution/state.toon` exists and execution has started:

1. Identify completed waves → their phases are **LOCKED** (cannot be changed)
2. Identify in-progress waves → their phases require **user confirmation** to modify
3. Identify pending waves → their phases are **freely editable**
4. Present these constraints:

```
Execution in progress (Wave 1 of 3).

Locked phases (completed — cannot change):
  Phase 0: Contracts

Modifiable phases (in progress — changes require confirmation):
  Phase 1: Implementation

Freely editable phases (pending):
  Phase 2: Integration

Proceed with refinement? (yes / abort)
```

### Step 2: Analysis

Choose analysis source:

1. Check `.plan-history/reviews/` for review findings less than 7 days old
2. If recent findings exist: display summary and ask — "Use cached review findings, or re-run analysis?"
3. If no recent findings or user requests fresh analysis:
   - Spawn 3 agents in parallel (single message, 3 Agent tool calls):
     - `phasing-agent` — dependency ordering, phase sizing, sequencing risks
     - `parallelization-agent` — wave optimization, file conflict detection
     - `agentic-workflow-agent` — context budget, task decomposition feasibility
   - Collect all findings
4. Also run validation stages 1-4 on the current plan to identify structural issues

### Step 3: Build Refinement Brief

Compile a structured brief for the plan-builder-agent:

```markdown
## Refinement Brief

### Locked Phases (completed, DO NOT modify)
Phase 0: Contracts — completed 2026-04-04

### Modifiable Phases
Phase 1 (in_progress — requires confirmation), Phase 2 (pending — freely editable)

### Validation Errors to Fix
1. [ownership] src/utils/helpers.ts claimed by Phase 2 AND Phase 3
2. [sizing] Phase 3 has 16 deliverables (max 8 recommended)

### Agent Findings
[phasing-agent]: Phase 2 depends on Phase 3 — circular dependency detected
[parallelization-agent]: Phase 1 tasks have no file overlap, can split into 2 parallel tracks
[agentic-workflow-agent]: Phase 3 requires reading 22 files — exceeds context budget

### Changelog Context
{recent entries from .plan-history/changelog.md}

### Current Plan
{full plan text}
```

### Step 4: Generate Refined Plan

Spawn `plan-builder-agent` (general-purpose) with:
- Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first, then read `~/.claude/agents/protocols/plan.schema.md`."
- The refinement brief from Step 3
- Instruction: "Fix all validation errors. Apply agent findings where appropriate. Do NOT modify locked phases. Annotate every change with reasoning."

### Step 5: Validate + Diff

1. Run validation stages 1-4 on the refined plan
2. If validation fails → report errors, ask user to fix manually or try again
3. Generate a structured diff showing what changed:

```markdown
## Proposed Changes

### Phase Structure
- SPLIT: Phase 3 (16 deliverables) → Phase 3a (8 files) + Phase 3b (8 files)
  Reason: exceeds 8-deliverable limit, natural domain boundary

- FIX: Phase 2 dependency changed from "Phase 3" to "Phase 1"
  Reason: circular dependency resolved

### File Ownership
- MOVED: src/utils/helpers.ts → wiring-agent ownership
  Reason: shared file cannot be owned by parallel tracks

### Acceptance Criteria
- CHANGED: "loads in under 200ms" → "GET /api/feed returns within 200ms (verified via vitest benchmark)"
  Reason: original was untestable

### Validation: PASS (0 errors, 0 warnings)
```

### Step 6: User Approval

Present the diff. On approval:
1. Copy current plan to `.plan-history/snapshots/YYYY-MM-DD-plan.md`
2. Write the refined plan to PLAN.md
3. Append to `.plan-history/changelog.md`:
   ```
   ## YYYY-MM-DD — Plan refined
   - Fixed: {list of changes}
   - Source: /loom-roadmap --refine {with cached findings | with fresh analysis}
   ```
4. Update `.plan-history/roadmap.toon` with any new/changed milestones

---

## Command: `--deps [path]`

Algorithmic dependency analysis — no agents spawned.

### Step 1: Parse Dependencies

Read the plan. For each `### Phase N` block, extract the `**Dependencies:**` line. Build an adjacency list:

```
graph = {
  0: [],        // Phase 0 depends on nothing
  1: [0],       // Phase 1 depends on Phase 0
  2: [0, 1],    // Phase 2 depends on Phase 0 and Phase 1
  3: [2]        // Phase 3 depends on Phase 2
}
```

### Step 2: Cycle Detection (Kahn's Algorithm)

Execute these steps literally:

1. For each phase, compute its in-degree (number of phases it depends on that exist in the graph)
2. Create a queue. Add all phases with in-degree 0.
3. Initialize processedCount = 0
4. While queue is not empty:
   a. Dequeue a phase `p`
   b. processedCount++
   c. For each phase `d` that depends on `p`: decrement d's in-degree. If d's in-degree reaches 0, add d to queue.
5. If processedCount < total phases → CYCLE DETECTED. The phases NOT processed are part of the cycle.

### Step 3: Critical Path (Longest Path in DAG)

Only compute if no cycles:

1. Build forward edges: for each phase `p`, list all phases that depend on `p`
2. Initialize dist[phase] = 0 for all phases
3. For each phase in topological order (from Step 2):
   For each phase `d` that depends on it:
   `dist[d] = max(dist[d], dist[current] + 1)`
4. Find the phase with maximum dist. That's the end of the critical path.
5. Backtrack using a `prev` array to reconstruct the full path.
6. Critical path length = max(dist) + 1 (counts nodes, not edges)

### Step 4: Bottleneck Scoring

For each phase, count its transitive dependents (phases that directly or indirectly depend on it):

1. For each phase `p`, do a BFS/DFS through the forward edges
2. Count all reachable phases
3. Rank by count. The phase with the most transitive dependents is the biggest bottleneck.

### Step 5: Parallelization Factor

Group phases by wave number. For each wave:
1. Count how many phases are in that wave (= parallelism factor)
2. Check file ownership overlaps within the wave
3. Report actual vs theoretical parallelism

### Step 6: Render

```markdown
## Dependency Analysis

### Graph
Phase 0: Contracts ────────────┐
                               ├──→ Phase 1a: Data Layer ────┐
                               ├──→ Phase 1b: API Routes ────┤
                               │                              ▼
                               └────────────→ Phase 2: Integration

### Critical Path
Phase 0 → Phase 1a → Phase 2
Length: 3 waves (minimum sequential execution)

### Bottleneck Analysis
| Phase | Direct Deps | Transitive Deps | Risk |
|-------|------------|----------------|------|
| Phase 0 | 2 | 3 | HIGH |
| Phase 1a | 1 | 1 | LOW |
| Phase 1b | 1 | 1 | LOW |
| Phase 2 | 0 | 0 | — |

### Parallelization
| Wave | Phases | Factor | Notes |
|------|--------|--------|-------|
| 0 | 1 | 1x | Contracts (single agent by design) |
| 1 | 2 | 2x | Full parallelism (no file overlap) |
| 2 | 1 | 1x | Integration (depends on both tracks) |

### Issues
{✓ No cycles detected | ✗ Cycle: Phase X ↔ Phase Y}
{⚠ Phase 0 is a bottleneck — all work blocked if it fails}
{ℹ Phases 1a and 1b are fully parallelizable}
```

---

## Command: `--split [path]`

1. Read the plan
2. Run validation (`--validate`) — if there are structural issues, report them first
3. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Include the current plan
   - Instruction: "Identify natural boundaries (by domain, by layer, by milestone). Create sub-plans that reference shared contracts. Each sub-plan must be independently executable via /loom-execute-plan."
4. Present the proposed split with rationale
5. On approval: write sub-plan files (`PLAN-{name}.md`), update roadmap.toon

---

## Command: `--diff`

1. Find the most recent snapshot in `.plan-history/snapshots/`
2. If no snapshots exist, check git history: `git log --oneline -1 -- PLAN.md`
3. Compare current `PLAN.md` against the snapshot
4. Show a structured diff (not raw text diff):
   - Added phases / removed phases
   - Changed deliverables (files added/removed per phase)
   - Changed acceptance criteria
   - Schema/type definition changes
   - Dependency changes

---

## Command: `--history`

Read and display `.plan-history/changelog.md`. Format each entry clearly with date, action, and details.

If `.plan-history/changelog.md` doesn't exist, scan git log for plan file changes and reconstruct:
```bash
git log --oneline --follow -- PLAN.md
```

---

## Command: `--milestone`

Manage milestones in `.plan-history/roadmap.toon`.

### `--milestone add "name"`
1. Ask: target phase, dependencies (other milestone names), description
2. Determine effort sizing from deliverable count:
   - S (Small): 1-3 deliverables, 1-2 criteria
   - M (Medium): 4-6 deliverables, 3-4 criteria
   - L (Large): 7-8 deliverables, 5-6 criteria
   - XL (Extra Large): multi-phase or >8 deliverables
3. Append to roadmap.toon
4. Append to changelog

### `--milestone complete "name"`
1. Find the milestone in roadmap.toon
2. Mark as completed with current timestamp
3. Append to changelog
4. If milestone corresponds to a phase, verify the phase's wave is `succeeded` in state.toon

### `--milestone list`
1. Read roadmap.toon
2. If milestones are empty but plan has phases, auto-derive:
   - One milestone per phase: "{Phase Name} Complete"
   - One terminal milestone: "Plan Complete"
   - Effort sizing from deliverable counts
3. Reconcile against execution state: completed waves → completed milestones
4. Display sorted by dependency order

---

## Command: `--snapshot`

1. Copy `PLAN.md` to `.plan-history/snapshots/YYYY-MM-DD-plan.md`
2. If `.plan-execution/state.toon` exists, save execution summary alongside
3. Append to changelog: "Snapshot saved: YYYY-MM-DD"

---

## Command: `--review-integrate`

Applies plan review findings to PLAN.md. For roadmap review integration, use `--review-integrate --roadmap` (defined above).

1. Read the most recent plan review file in `.plan-history/reviews/` (files matching `*-review.toon`, excluding `*-roadmap-review.toon`)
2. Parse findings by severity (blocking → warning → info)
3. Filter to actionable findings (skip pure observations)
4. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Current plan
   - Filtered review findings
   - Instruction: "Apply these approved review recommendations. Annotate each change with the finding that motivated it."
5. Run validation on the result (stages 1-4, plus Stage 7 for v2 plans)
6. Show proposed changes for user approval
7. On approval: write plan, snapshot old version, update changelog

---

## Roadmap TOON Format

`.plan-history/roadmap.toon`:

```toon
planFile: PLAN.md
planVersion: 1
lastUpdated: 2026-04-05
status: in_progress

milestones[4]{name,targetPhase,status,effort,dependencies,completedAt}:
  Contracts Ready,0,completed,S,,2026-04-04
  Data Layer Done,1,in_progress,M,Contracts Ready,
  API Routes Done,1,in_progress,M,Contracts Ready,
  Plan Complete,-,pending,XL,Data Layer Done;API Routes Done,

phases[3]{id,name,wave,status,deliverableCount,criteriaCount}:
  0,Contracts,0,completed,3,4
  1,Implementation,1,in_progress,16,8
  2,Integration,2,pending,2,3
```

---

## Agent Monitoring (simplified)

When spawning agents via `run_in_background: true` (plan-builder-agent, planning agents in `--init` Step 4, `--refine` Step 2), apply lightweight monitoring per `agent-monitoring.schema.md`:

1. Include the agent's `taskId` in its prompt so it can write to `.plan-execution/progress/{taskId}.toon`
2. Create `.plan-execution/progress/` directory if it doesn't exist
3. After spawning, poll every 15 seconds:
   - Read progress files for running agents
   - Classify: `reporting` (heartbeat < 90s), `silent` (no file), `stale` (heartbeat > 90s)
   - Print a one-line status per agent: `{taskId}  {phase}  {percentComplete}%  "activity"  ♥ Ns ago`
4. Escalation:
   - Silent > 120s → warn
   - Stale > 180s → SendMessage nudge
   - Stale > 270s → ask user
   - Wall clock > 300s (5 min default for planning agents) → present timeout options

This is additive — if agents don't support progress reporting, the orchestrator waits normally.

## Error Handling

- **No plan exists**: suggest `--init` to create one
- **No .plan-history/**: create it on first write operation (any command that writes)
- **No execution state**: show plan-derived status (all phases pending)
- **Stale roadmap.toon**: reconcile against actual plan file, warn about drift
- **Review files not found**: skip review integration, note it
- **Validation failures in --init**: retry with plan-builder-agent (max 2), then ask user
- **Agent failure**: report which agent failed, continue with available results
- **Large plan (>15 phases)**: warn about complexity, suggest `--split`

## Integration Points

- `/loom-review-plan` → writes findings to `.plan-history/reviews/`
- `/loom-execute-plan` → reads plan (validates stages 1-4 as gate), updates state.toon
- `/loom-test-plan` → acceptance criteria from plan phases feed test spec generation
- `--refine` → consumes review findings + agent analysis → updated plan
- `--review-integrate` → automates review → plan update cycle
- `--validate` → used by `--init`, `--refine`, and `/loom-execute-plan` as a pre-flight check
- `--status` → reads plan + state.toon + roadmap.toon + changelog for unified view

## Command: `status` (default)

Pure data synthesis — no agents spawned. Read all sources and render a unified view.

### Step 1: Read All Sources

Resolve roadmap and plan paths per `agents/protocols/planning-paths.md` before reading (planning/ first, root legacy fallback).

```
1. ROADMAP.md (resolved) → parse features, milestones, status (draft/reviewed/approved)
2. PLAN.md (resolved)    → parse phases, dependencies, deliverables, acceptance criteria, planVersion
3. .plan-execution/state.toon → wave statuses, task completions, verification results
4. planning/history/roadmap.toon → milestone tracking
5. planning/history/changelog.md → recent entries
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

### Step 6: Backlog Count

If `.plan-execution/notes.toon` exists, count notes with `tag == backlog` and `status == pending`. Append to status output: `Backlog: {N} items ({H} high, {M} medium, {L} low)`

---

## Command: `validate [path]`

Run validation standalone. Validates a PLAN.md by default. Use `--roadmap` to validate a ROADMAP.md instead.

### Roadmap mode (`validate --roadmap`)

Run roadmap validation stages 1-4 from `validation-rules.md` Section 7. Output follows the same format as plan validation but checks features, milestones, and data model coverage instead of phases, dependencies, and file ownership.

### Plan mode (default)

Useful before `/loom-plan review` or `/loom-plan execute`.

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
{If errors: "Plan has blocking issues. Run /loom-roadmap refine to fix."}
{If clean: "Plan is valid. Ready for /loom-plan review or /loom-plan execute."}
```

---

## Command: `refine [path]`

Execution-aware refinement with structured analysis and change tracking. Refines a PLAN.md by default. Use `refine --roadmap` to refine a ROADMAP.md instead (delegates to `roadmap-builder-agent` in refinement mode, using the same review findings from `planning/history/reviews/*-roadmap-review.toon`).

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

1. Check `planning/history/reviews/` for review findings less than 7 days old
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
{recent entries from planning/history/changelog.md}

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
1. Copy current plan to `planning/history/snapshots/YYYY-MM-DD-plan.md`
2. Write the refined plan to PLAN.md
3. Append to `planning/history/changelog.md`:
   ```
   ## YYYY-MM-DD — Plan refined
   - Fixed: {list of changes}
   - Source: /loom-roadmap refine {with cached findings | with fresh analysis}
   ```
4. Update `planning/history/roadmap.toon` with any new/changed milestones

---

## Command: `deps [path]`

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


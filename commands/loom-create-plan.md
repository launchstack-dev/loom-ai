# Plan Creator

You create a PLAN.md (v2, spec-driven) from an approved ROADMAP.md. The roadmap defines the strategy (features, milestones, vision); this command generates the detailed execution spec (phases, waves, API specs, state machines, schemas, acceptance criteria, file ownership).

## Requirements

$ARGUMENTS

Parse arguments:
- No args: create PLAN.md from ROADMAP.md in current directory
- `<path>`: use a specific roadmap file as source
- `--auto`: accept defaults without interactive prompting
- `--v1`: generate a v1 plan (simpler, no API specs or state machines)
- `--output <path>`: write plan to a custom path (default: `PLAN.md`)
- `--review-integrate`: apply plan review findings to PLAN.md (skips generation, goes directly to Step R)

## Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/plan.schema.md` — the canonical PLAN.md format spec (v1 and v2)
- `~/.claude/agents/protocols/spec.schema.md` — v2 spec section formats (API specs, state machines, error handling)
- `~/.claude/agents/protocols/validation-rules.md` — plan validation stages
- `~/.claude/agents/protocols/execution-conventions.md` — directory structure

## Instructions

### Step 0: Gather Context

1. **Find the roadmap.** Read ROADMAP.md (or user-specified path).
   - If it doesn't exist: "No roadmap found. Run `/loom-roadmap --init` to create one first." Stop.
   - If frontmatter `status` is not `approved`: "Roadmap status is '{status}'. Approve it first with `/loom-roadmap --approve-roadmap`, or pass `--force` to proceed anyway."

2. **Scan the codebase** for context (same scan as `/loom-roadmap --init` Step 1):
   - `ls` project root → top-level structure
   - Read package.json / pyproject.toml / go.mod / Cargo.toml → tech stack
   - Glob source files ��� file inventory by directory
   - Check for existing schemas, migrations, type definitions
   - Read `CLAUDE.md` and `CONTEXT.md` if they exist

3. **Read existing plan** if PLAN.md already exists:
   - Warn: "PLAN.md already exists ({N} phases, {M} waves). Overwrite? (yes / merge / cancel)"
   - `merge` = pass existing plan to the builder agent as context to preserve manual additions
   - `cancel` = stop

4. **Check for pending notes.** Read `.plan-execution/notes.toon` if it exists. Filter for pending notes tagged `architecture`, `decision`, `security`, `perf`. Include them as advisory context for the plan builder.

### Step 1: Plan Generation

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

### Step 2: Validation Loop (max 2 retries)

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

### Step 3: Interactive Review

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

### Step 4: Write and Initialize

1. Write the validated plan to `PLAN.md` (or `--output` path).

2. Append to `.plan-history/changelog.md`:
   ```markdown
   ## YYYY-MM-DD — Plan created from roadmap
   - Generated via /loom-create-plan
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
     /loom-review-plan                    — 6 agents analyze the plan in parallel
     /loom-create-plan --review-integrate — apply review findings to PLAN.md
     /loom-execute-plan --dry-run         — preview the wave structure
     /loom-roadmap --status               — see unified roadmap + plan progress
   ```

### Step 4.5: Wiki Update (non-blocking)

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

### Step R: Review Integrate (`--review-integrate` only)

Skips Steps 0–4. Applies plan review findings directly to an existing PLAN.md.

1. Read the most recent plan review file in `.plan-history/reviews/` (files matching `*-review.toon`, excluding `*-roadmap-review.toon`). If none found: "No plan review found. Run `/loom-review-plan` first." Stop.
2. Parse findings by severity (blocking → warning → info)
3. Filter to actionable findings (skip pure observations)
4. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Current PLAN.md contents
   - Filtered review findings
   - Instruction: "Apply these approved review recommendations. Do not change unrelated sections. Annotate each change with the finding that motivated it."
5. Run validation on the result (stages 1-4, plus Stage 7 for v2 plans)
6. Show proposed changes for user approval (or auto-apply if `--auto`)
7. On approval: write plan, snapshot old version to `.plan-history/snapshots/`, update changelog

---

## Error Handling

- **No roadmap**: direct user to `/loom-roadmap --init`
- **Unapproved roadmap**: direct user to `/loom-roadmap --approve-roadmap`
- **plan-builder-agent fails**: retry once with error context. If retry fails, save partial output to `.plan-execution/plan-draft.md` and tell user.
- **Validation fails after retries**: present plan with errors, let user decide (accept with warnings / edit manually / abort)

## Status Line Updates

Write `.plan-execution/status.toon` at every phase transition:
```toon
command: create-plan
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

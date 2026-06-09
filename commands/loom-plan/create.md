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
- `--estimate`: print token cost estimate to stdout without spawning agents, then exit 0
- `--skip-test-gen`: skip criteria-planner-agent spawn; only run plan-builder-agent. Logs a warning to stderr: "Skipping criteria generation. criteria-plan.toon will not be created. Re-run without --skip-test-gen to generate criteria." When set, Step 1 spawns only plan-builder-agent, Steps 1.5 (interpretation review) and 4 item 1b (criteria-plan.toon write) are skipped.

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

#### Step 0.5: Estimate Mode (`--estimate` only)

If `--estimate` is set:

1. Compute the token estimate for the dual-track plan creation pipeline using the `characters / 4` heuristic (see `agents/protocols/context-budget.md`):
   - **plan-builder-agent prompt:** roadmap text + codebase context + agent instructions overhead → `Math.ceil(totalChars / 4)`
   - **criteria-planner-agent prompt:** roadmap text + wiki quality history (estimate 2000 tokens if `.loom/wiki/` exists, 0 otherwise) + agent instructions overhead → `Math.ceil(totalChars / 4)`
   - **interpretation-reviewer-agent prompt:** estimated plan output (use 8000 tokens as a conservative default) + estimated criteria-plan output (use 4000 tokens as a conservative default) + agent instructions overhead → `Math.ceil(totalChars / 4)`
   - **Fixed overhead per agent:** 5000 tokens (system prompt, tool definitions, formatting)
   - **Total:** sum of all three agent estimates + (3 * 5000 overhead)

2. Print the estimate to stdout in TOON format:
   ```toon
   estimateMode: true
   agents[3]: plan-builder-agent, criteria-planner-agent, interpretation-reviewer-agent
   planBuilderTokens: {N}
   criteriaPlannerTokens: {N}
   interpretationReviewerTokens: {N}
   overheadTokens: 15000
   totalEstimatedTokens: {N}
   ```

3. Exit 0. Do not create any files or spawn any agents.

#### Step 1: Dual-Track Plan Generation (parallel)

Spawn **both** agents in parallel from the same roadmap input. Send BOTH Agent tool calls in a SINGLE message so they run concurrently. Neither agent reads the other's output.

**Agent A: plan-builder-agent** (general-purpose):
```
"Read your instructions from `~/.claude/agents/plan-builder-agent.md` first,
 then read `~/.claude/agents/protocols/plan.schema.md` and
 `~/.claude/agents/protocols/spec.schema.md`.

 Generate a planVersion: {2 unless --v1} spec-driven plan from this approved roadmap.
 Map features to phases, milestones to wave boundaries, conceptual data model to
 fully typed schema with indexes and cascades.
 {If v2: Include API Specification, State Machines, and Error Handling sections per spec.schema.md.}

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 <file-content path="codebase-context">
 {context summary from Step 0}
 </file-content>

 {If pending notes exist: <file-content path="notes.toon">
 {filtered notes}
 </file-content>}

 {If merging existing plan: <file-content path="PLAN.md">
 {existing PLAN.md text}
 </file-content>}"
```

**Agent B: criteria-planner-agent** (general-purpose, `--auto` mode):
```
"Read your instructions from `~/.claude/agents/criteria-planner-agent.md` first,
 then read `~/.claude/agents/protocols/criteria-plan.schema.md` and
 `~/.claude/agents/protocols/taxonomy.md`.

 Generate a criteria-plan.toon from this approved roadmap. You are running in
 dual-track mode alongside plan-builder-agent. You receive the ROADMAP directly --
 do NOT wait for or reference PLAN.md output.

 Extract acceptance criteria, infer testable conditions, and classify by convergence
 tier (unit, integration, e2e, qa-review) per taxonomy.md.

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 <file-content path="codebase-context">
 {context summary from Step 0}
 </file-content>

 {If scope-contract.toon exists: <file-content path="scope-contract.toon">
 {scope-contract.toon content}
 </file-content>}

 {If wiki quality history found: <file-content path="wiki-quality-history">
 {quality history entries}
 </file-content>}"
```

Both agents run independently. Collect both AgentResults before proceeding.

#### Step 1.5: Interpretation Review (conflict detection)

After both agents from Step 1 complete, spawn the **interpretation-reviewer-agent** to compare the plan and criteria outputs for conflicts and coverage gaps. This agent reads `~/.claude/agents/protocols/interpretation-conflict.schema.md` for its output format.

Spawn `interpretation-reviewer-agent` (general-purpose):
```
"Read your instructions from `~/.claude/agents/interpretation-reviewer-agent.md` first,
 then read `~/.claude/agents/protocols/interpretation-conflict.schema.md`.

 Compare the plan and criteria plan for interpretation conflicts and coverage gaps.
 The plan and criteria were generated independently from the same roadmap by different
 agents (dual-track). Identify:
 - Semantic mismatches: where the plan describes a behavior one way but the criteria
   verify it differently
 - Coverage gaps (plan-only): behaviors in the plan with no corresponding criterion
 - Coverage gaps (test-only): criteria that don't trace to any plan requirement

 <file-content path="PLAN.md">
 {PLAN.md output from plan-builder-agent}
 </file-content>

 <file-content path="criteria-plan.toon">
 {criteria-plan.toon output from criteria-planner-agent}
 </file-content>

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 Return an AgentResult with conflicts and gaps in your integrationNotes."
```

Parse the interpretation-reviewer-agent's AgentResult. Extract the conflict report.

**In auto mode (`--auto`):**
- If any conflict has `severity: blocking` → log all conflicts to stderr, then exit 1. Message: `"Blocking interpretation conflicts detected. Resolve before proceeding.\n{conflict list}"`
- If only `severity: warning` or `severity: info` → log warnings to stderr, continue to Step 2.

**In manual/interactive mode:**
- If any conflict has `severity: blocking` → present each blocking conflict as a numbered prompt with side-by-side comparison:
  ```
  ## Interpretation Conflict {N}/{total}: {id}
  Severity: blocking

  Plan says:
    {planInterpretation}

  Criteria says:
    {testInterpretation}

  Feature: {featureRef}  Phase: {phaseRef}

  Actions:
    1. Use plan interpretation (update criteria)
    2. Use criteria interpretation (update plan)
    3. Resolve manually (edit both)
    4. Accept as-is (downgrade to warning)

  >
  ```
  Wait for user resolution on each blocking conflict before proceeding.

- If only warnings/info → display summary, continue to Step 2.

Save the conflict report to `.plan-execution/conflicts/interpretation-report.toon`.

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

1b. Write `criteria-plan.toon` to `.plan-execution/criteria-plan.toon` (always generated during plan creation, not gated behind `--converge-criteria`). This is the output from criteria-planner-agent in Step 1, potentially updated by conflict resolutions from Step 1.5.

2. Append to `planning/history/changelog.md`:
   ```markdown
   ## YYYY-MM-DD -- Plan created from roadmap
   - Generated via /loom-plan create
   - Source: ROADMAP.md (approved)
   - planVersion: {1 or 2}
   - Phases: {N}, Waves: {N}, Deliverables: {N}
   {If v2:
   - API endpoints: {N}, State machines: {N}
   - Validation: passed (0 errors, {N} warnings)}
   - Criteria plan: criteria-plan.toon ({N} criteria, {M} reviewers)
   - Interpretation conflicts: {N} blocking, {M} warning, {K} info
   ```

3. Create `planning/history/roadmap.toon` with milestones mapped from ROADMAP.md (if it doesn't exist).

4. If pending notes were included, mark them as `assimilated` in `notes.toon` with `assimilatedTo: PLAN.md`.

5. Display next steps:
   ```
   Plan written to {path}.
   Criteria plan written to .plan-execution/criteria-plan.toon.
   {If conflicts: Interpretation conflicts saved to .plan-execution/conflicts/interpretation-report.toon.}

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

1. Read the most recent plan review file in `planning/history/reviews/` (files matching `*-review.toon`, excluding `*-roadmap-review.toon`). If none found: "No plan review found. Run `/loom-plan review` first." Stop.
2. Parse findings by severity (blocking -> warning -> info)
3. Filter to actionable findings (skip pure observations)
4. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Current PLAN.md contents
   - Filtered review findings
   - Instruction: "Apply these approved review recommendations. Do not change unrelated sections. Annotate each change with the finding that motivated it."
5. Run validation on the result (stages 1-4, plus Stage 7 for v2 plans)
6. Show proposed changes for user approval (or auto-apply if `--auto`)
7. On approval: write plan, snapshot old version to `planning/history/snapshots/`, update changelog

### Error Handling

- **No roadmap**: direct user to `/loom-roadmap init`
- **Unapproved roadmap**: direct user to `/loom-roadmap approve`
- **plan-builder-agent fails**: retry once with error context. If retry fails, save partial output to `.plan-execution/plan-draft.md` and tell user.
- **Validation fails after retries**: present plan with errors, let user decide (accept with warnings / edit manually / abort)

### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` at every phase transition:
```toon
command: plan-create
phase: {context-gathering | generating | conflict-review | validating | reviewing | writing | complete}
wave: 0
totalWaves: 1
agentsRunning: {N}
agentsDone: {N}
agentsTotal: {3 for dual-track: plan-builder + criteria-planner + interpretation-reviewer}
agentsFailed: 0
findings: 0
conflicts: {N}
updatedAt: {ISO timestamp}
```

---

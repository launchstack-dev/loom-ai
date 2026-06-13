## Subcommand: create

You create a PLAN.md (v2, spec-driven) from an approved ROADMAP.md. The roadmap defines the strategy (features, milestones, vision); this subcommand generates the detailed execution spec (phases, waves, API specs, state machines, schemas, acceptance criteria, file ownership).

### Arguments

Parse remaining arguments:
- No args: create plan from the resolved ROADMAP (see `agents/protocols/planning-paths.md`); write to `planning/plans/PLAN.md` (legacy projects without `planning/` write to root `PLAN.md`)
- `<path>`: use a specific roadmap file as source
- `--auto`: accept defaults without interactive prompting
- `--v1`: generate a v1 plan (simpler, no API specs or state machines)
- `--output <path>`: write plan to a custom path (default: `planning/plans/PLAN.md` if `planning/` exists, else `PLAN.md`)
- `--name <slug>`: write to `planning/plans/PLAN-{slug}.md` (multi-plan portfolio support)
- `--review-integrate`: apply plan review findings to PLAN.md (skips generation, goes directly to Step R)
- `--estimate`: print token cost estimate to stdout without spawning agents, then exit 0
- `--skip-test-gen`: skip criteria-planner-agent spawn; only run plan-builder-agent. Logs a warning to stderr: "Skipping criteria generation. criteria-plan.toon will not be created. Re-run without --skip-test-gen to generate criteria." When set, Step 1 spawns only plan-builder-agent, Steps 1.5 (interpretation review) and 4 item 1b (criteria-plan.toon write) are skipped.
- `--skip-critic`: skip the `plan-critic-agent` spawn in Step 1 AND the Step 1.7 Critic Revise Pass. Falls back to legacy dual-track behavior (plan-builder + criteria-planner only). Logs a warning to stderr: `"--skip-critic active: plan-critic-agent will not run; Step 1.7 Critic Revise Pass will be skipped."` See Step 1.7 for the flag combination matrix (interactions with `--autoconverge`, `--review-integrate`, `--estimate`, `--skip-test-gen`).
- `--autoconverge`: after writing the plan in Step 4, generate a `converge.config` (document-mode) and invoke `/loom-converge --resume-config <path>` to drive the plan toward zero blocking findings. Defaults are LOCKED: `maxIterations: 3` (C-05), `scopeGuardEnabled: true` (C-06), `snapshotEnabled: true` (C-07), `integrator: plan-builder-agent`, `harness: scripts/plan-review-harness.ts`. See Step 5 for details, halt handling, and the flag-interaction matrix.
- `--max-iterations <N>`: override the default `maxIterations: 3` cap on `--autoconverge` runs. Range `1 <= N <= 10` per `agents/protocols/convergence-tier.schema.md § ConvergeConfig Schema § Validation Rules`. Values outside the range are rejected with an error. No-op when `--autoconverge` is not also set.
- `--dry-run`: when combined with `--autoconverge`, emit the generated `converge.config` TOON to stdout and exit 0 WITHOUT invoking the convergence-driver. Useful for previewing the generated config. No-op when `--autoconverge` is not also set.

### Instructions

#### Step 0: Gather Context

1. **Find the roadmap.** Resolve per `agents/protocols/planning-paths.md`: check `planning/ROADMAP.md` first, then `ROADMAP.md` at root (legacy), then user-specified path.
   - If none exists: "No roadmap found. Run `/loom-roadmap init` to create one first." Stop.
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

#### Step 1: Triple-Track Plan Generation (parallel)

Spawn the **plan-builder-agent** and **criteria-planner-agent** in parallel from the same roadmap input — send BOTH Agent tool calls in a SINGLE message so they run concurrently. Neither agent reads the other's output. The **plan-critic-agent** is a third track but is NOT truly parallel with the other two: the critic reads the draft PLAN.md, so it MUST be spawned sequentially AFTER `plan-builder-agent` returns. Within Step 1, the spawn sequence is therefore: "plan-builder + criteria-planner in parallel; on plan-builder completion, plan-critic spawns reading the draft + the 6 reviewer files."

**Stale critique cleanup (run before any spawn):** remove any leftover critique artifact from a prior `/loom-plan create` invocation:
```bash
rm -f .plan-execution/critique.toon
```
Rationale: a previous run invoked with `--skip-critic` (or a partial failure) may have left a stale `.plan-execution/critique.toon` on disk. Step 1.7 reads that path unconditionally when it is present, so a fresh run MUST start from a clean slate. Skipping this cleanup risks consuming a stale critique against an unrelated draft plan.

**Input contracts (per agent):**

| Agent | Reads | Writes |
|---|---|---|
| `plan-builder-agent` | ROADMAP.md, codebase context, optional notes/scope-contract, optional existing PLAN.md (merge mode) | draft `PLAN.md` (returned in AgentResult; written to disk by Step 4) |
| `criteria-planner-agent` | ROADMAP.md, codebase context, optional scope-contract, optional wiki quality history | `criteria-plan.toon` (returned in AgentResult; written by Step 4 item 1b) |
| `plan-critic-agent` | draft `PLAN.md` from plan-builder, six reviewer files referenced by `agents/plan-critic-checklist.md` | `.plan-execution/critique.toon` (atomic write per `agents/protocols/plan-critique.schema.md`) |

`critique.toon` is an **advisory** artifact distinct from the formal-review `findings.toon` (see the "critique.toon vs findings.toon" note in Step 1.7).

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

Plan-builder and criteria-planner run independently. Collect both AgentResults before spawning the critic.

**Agent C: plan-critic-agent** (sequential; spawned only after plan-builder returns):

Skip this spawn entirely if `--skip-critic` is set. Otherwise, resolve the critic's model per `CLAUDE.md` § "Agent Conventions": read `~/.claude/agents/plan-critic-agent.md` frontmatter `model:` (which is `haiku`) and pass `model: "haiku"` on the spawn call. The critic spawn is subject to the standard token-budget preflight (`agents/protocols/context-budget.md`) like every other agent — if the estimated prompt size exceeds the haiku-tier cap, the preflight hook blocks the spawn with a suggestion to split the input or re-run with `--skip-critic`. The critic MUST NOT bypass the preflight.

```
subagent_type: "general-purpose"
model: "haiku"
```
Prompt:
```
"Read your instructions from `~/.claude/agents/plan-critic-agent.md` first,
 then read `~/.claude/agents/plan-critic-checklist.md` and
 `~/.claude/agents/protocols/plan-critique.schema.md`.

 You are a haiku-tier advisory critic. Predict findings that the 6 plan
 reviewer agents are likely to raise against this draft PLAN.md. Write
 your critique to `.plan-execution/critique.toon` atomically.

 <file-content path="PLAN.md">
 {draft PLAN.md from plan-builder-agent}
 </file-content>

 <file-content path="ROADMAP.md">
 {full ROADMAP.md text}
 </file-content>

 {Plus the 6 reviewer files listed in plan-critic-checklist.md.}"
```

Collect the critic's AgentResult and verify `.plan-execution/critique.toon` was written. The critic's output is advisory only — it does NOT gate progression to Step 1.5. Step 1.5 (Interpretation Review) runs independently against the plan-builder + criteria-planner outputs regardless of the critic's verdict.

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

#### Step 1.7: Critic Revise Pass

This step consumes the advisory critique produced by `plan-critic-agent` in Step 1 and asks `plan-builder-agent` to self-correct the draft PLAN.md BEFORE the validation loop and the formal review run. It is structurally analogous to Steps 1.5 and 4.5 (interstitial half-step inserts between the main steps).

**Skip conditions.** Step 1.7 is skipped entirely in either of the following cases:

1. **`--skip-critic` was passed.** No critic spawn ran in Step 1, so no `.plan-execution/critique.toon` exists. Log to stderr: `"--skip-critic active: Step 1.7 Critic Revise Pass skipped."` and proceed to Step 2.
2. **`--review-integrate` was passed.** Per locked decision **Q-02**, the critic does NOT run on `--review-integrate` invocations. Rationale: `--review-integrate` is the formal integrator path that consumes `findings.toon` from a completed plan review; the critic is a pre-review heuristic and has nothing to add when the review has already run. `--review-integrate` jumps directly from Step 0 to Step R and never touches Step 1, Step 1.5, Step 1.7, or Step 2.

**Procedure (default path):**

1. **Read the critique.** Load `.plan-execution/critique.toon` and parse it per `agents/protocols/plan-critique.schema.md`.
2. **Zero-blocking short-circuit.** If `predictedBlockingCount == 0`, echo to stdout: `"Critic predicted 0 blocking findings — skipping revise pass."` and proceed directly to Step 2. The plan-builder is NOT re-spawned; the draft PLAN.md from Step 1 is the input to Step 2.
3. **Re-spawn plan-builder-agent in Integrator Mode.** If `predictedBlockingCount > 0`, re-spawn `plan-builder-agent` per the Integrator Mode contract documented in `~/.claude/agents/plan-builder-agent.md` § Integrator Mode. The critic's `critique.toon` is passed as the findings input (the integrator contract is shape-compatible with both `findings.toon` and `critique.toon` — see `plan-critique.schema.md` line 5: "`PlanCritique` mirrors the shape of `ConvergenceFindings` so plan-builder-agent can consume critic output through the same integrator contract"). The draft `PLAN.md` from Step 1 is the subject. Integrator dispatch is config-driven (locked decision **C-03**) — this command names `plan-builder-agent` as the integrator because that is what the config calls for in this context.
4. **Atomic write.** The plan-builder Integrator Mode writes the revised PLAN.md atomically (`.tmp` + rename) per its existing contract. No additional write step is needed here.
5. **Echo to stdout.** On revise-pass completion, echo a single line to stdout naming the critique path and the counts the critic reported, e.g.:
   ```
   Critic critique at .plan-execution/critique.toon: 4 predicted blocking, 9 predicted advisory. Revise pass complete.
   ```
   (Counts come from `predictedBlockingCount` and `predictedAdvisoryCount` in the critique.)

**`critique.toon` vs `findings.toon` — distinct artifacts.** These two files are easily confused and MUST be kept separate:

| Field | `.plan-execution/critique.toon` | `.plan-execution/convergence/findings.toon` |
|---|---|---|
| Producer | `plan-critic-agent` (haiku, advisory) | The plan-review harness (formal review aggregate; Phase 9 W4 deliverable) |
| Schema | `PlanCritique` (`agents/protocols/plan-critique.schema.md`) | `ConvergenceFindings` (`agents/protocols/findings.schema.md`) |
| Path | `.plan-execution/critique.toon` | `.plan-execution/convergence/findings.toon` |
| Lifecycle | Written ONCE per `/loom-plan create` invocation (in Step 1; consumed in Step 1.7 only) | Rewritten EVERY iteration of an `--autoconverge` loop |
| Severity | `predictedSeverity` (predictions; advisory) | `severity` (actual formal-review findings; authoritative) |
| ID prefix | `P-` (e.g., `P-01`) | `F-` (e.g., `F-01`) |

The shapes are intentionally similar so plan-builder Integrator Mode can consume both, but the filenames, paths, schemas, and lifecycles are distinct. Do not write critique data to `findings.toon` and do not write formal findings to `critique.toon`.

**Flag combination matrix.** `--skip-critic` interactions with other flags:

| Combination | Behavior |
|---|---|
| `--skip-critic` + `--autoconverge` | COMPATIBLE. The autoconverge loop still runs after Step 4; `--skip-critic` only removes the pre-review revise pass. |
| `--skip-critic` + `--review-integrate` | NO-OP. `--review-integrate` already skips the critic by design (per Q-02); `--skip-critic` is redundant here but is NOT an error. |
| `--skip-critic` + `--estimate` | COMPATIBLE. `--estimate` mode does not spawn any agents; the flag has no effect on the estimate output. |
| `--skip-critic` + `--skip-test-gen` | COMPATIBLE. Both skips compose: Step 1 spawns only `plan-builder-agent`, and Step 1.7 is skipped. |

**Phase 10 grep-gate anchor.** Downstream Phase 10 (Wave 4) wires the `--autoconverge` flag into this file and uses Step 1.7's header as its **structural insertion-point anchor**. Before Phase 10 edits run, it MUST assert this file is at the post-Phase-7 commit by running:

```bash
grep -q "Step 1.7" commands/loom-plan/create.md
```

If that grep returns non-zero, Phase 10 MUST halt with an error naming **Phase 7** as the missing predecessor (the Phase 7 deliverable is the Step 1.7 section you are reading right now). The gate is structural rather than commit-hash-based so it remains valid across rebases and squash-merges — Phase 10 reads create.md, locates the `#### Step 1.7:` heading, and uses it as a known landmark to anchor its own additions.

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

1. Write the validated plan to its target path. Resolve target per `agents/protocols/planning-paths.md`:
   - If `--output <path>` was passed: use it verbatim
   - Else if `--name <slug>` was passed: write to `planning/plans/PLAN-{slug}.md` (mkdir -p as needed)
   - Else if `planning/` exists OR `planning/plans/` exists: write to `planning/plans/PLAN.md`
   - Else (legacy project): write to `PLAN.md` at repo root

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

#### Step 5: Autoconverge Loop (`--autoconverge` only)

This step is the user-facing entry point for **F-03 (autoconverge)**. After Step 4 has atomically written the initial plan, Step 5 generates a document-mode `converge.config` and invokes the convergence-driver via `/loom-converge --resume-config <path>` to iterate the plan toward zero blocking findings.

Step 5 runs AFTER Step 4 (initial write) and BEFORE Step 4.5 (wiki update). This ordering is deliberate: the initial plan is durable on disk before the convergence loop starts, and Step 4.5 then captures the final converged state (initial write + any integrator revisions) in a single wiki update at the end.

##### Skip clause

If `--autoconverge` is NOT set, skip Step 5 entirely (no-op; proceed directly to Step 4.5).

If `--autoconverge` is set without `--auto`, the wrapper runs interactively — the convergence-driver may prompt at SCOPE_EXPANSION boundaries per locked **C-08** (see Halt Handling below).

##### `--dry-run` handling (preview mode)

If `--autoconverge --dry-run`: build the `converge.config` TOON per § "Generate `converge.config`" below, emit it to stdout, exit 0. Do NOT invoke the convergence-driver and do NOT write the config to disk. Useful for previewing the generated config before committing to a full loop.

`--dry-run` is a no-op when `--autoconverge` is not also set (the plain `--dry-run` flag has no other meaning in this command).

##### Generate `converge.config`

Write the generated config atomically (`.tmp` + rename per `agents/protocols/execution-conventions.md`) to:

```
.plan-execution/convergence/converge.config.toon
```

The defaults are **LOCKED** per the locked-decisions table in `PLAN-convergence-generalization.md` and `agents/protocols/convergence-tier.schema.md § ConvergeConfig Schema (Extended)`. Step 5 MUST emit these exact values for an `--autoconverge` invocation:

| Field | Default value | Source / locked decision |
|---|---|---|
| `convergenceMode` | `document` | Plan creation runs in document mode |
| `subject` | `{planPath}` (the path written in Step 4 — e.g., `planning/plans/PLAN.md` or `planning/plans/PLAN-{slug}.md`) | Subject of the convergence loop |
| `integrator` | `plan-builder-agent` | Phase 8 deliverable; plan-builder Integrator Mode |
| `harness` | `scripts/plan-review-harness.ts` | Phase 9 deliverable |
| `outputPath` | `.plan-execution/convergence/findings.toon` | Driver reads after each iteration |
| `maxIterations` | `3` | Locked **C-05** (default for `--autoconverge`) |
| `agentBudget` | `30` | Existing default |
| `scopeGuardEnabled` | `true` | Locked **C-06** |
| `snapshotEnabled` | `true` | Locked **C-07** |
| `snapshotDir` | `planning/history/snapshots/` | Default |

**`--max-iterations N` override.** When `--max-iterations N` is passed alongside `--autoconverge`, ONLY the `maxIterations` field is overridden; all other defaults stay locked. Bound: `1 <= N <= 10` per the schema. Out-of-range values are rejected at this step with a stderr error:

```
--max-iterations must satisfy 1 <= N <= 10 (received: {N}). See agents/protocols/convergence-tier.schema.md § ConvergeConfig § Validation Rules.
```

No other flag overrides any other field. To customise other fields (e.g., `agentBudget`, `integrator`), hand-author a `converge.config` and run `/loom-converge --resume-config <path>` directly.

##### Invoke the driver

After writing the config, invoke the convergence-driver via:

```
/loom-converge --resume-config .plan-execution/convergence/converge.config.toon
```

This is the documented entry point — Step 5 MUST NOT inline the driver call or duplicate the convergence loop logic. The driver is the sole owner of the loop per locked decision **C-01** (DRY).

##### `--auto` pass-through

`--auto` flows through transparently to the inner `/loom-converge --resume-config` invocation per locked decision **Q-01** (end-to-end non-interactive under `--auto`) and **F-03**. The wrapper invocation under `--auto` becomes:

```
/loom-converge --resume-config .plan-execution/convergence/converge.config.toon --auto
```

Under `--auto`, a `SCOPE_EXPANSION` halt MUST exit the process with **exit code 1** and write a machine-readable JSON line to stderr per locked **C-08** (the exact stderr-line schema is normative in `agents/protocols/convergence-summary.schema.md` — see also `agents/convergence-driver.md § Document Mode Safeguards § Interactive vs --auto divergence (locked C-08)`). The driver MUST NOT record a user prompt under `--auto`; the wrapper MUST NOT swallow the non-zero exit. The `convergence-summary.toon` write (with `status: halted-scope-expansion`) still lands on disk BEFORE the process exit so downstream link consumers can read it from disk per locked **C-11**.

##### `--no-auto-commit` pass-through

`--no-auto-commit` flows through transparently to the driver and disables iteration-level git commits made by the integrator. It does **NOT** disable auto-snapshots: per locked **C-07**, snapshot writes to `planning/history/snapshots/{slug}-pass-{N}.{ext}` are independent of git state and run on every iteration regardless of `--no-auto-commit`. Snapshots are the recovery mechanism for `cp` rollback per the C-10 recovery string and remain available whether or not git commits are enabled.

##### Halt handling

On driver halt for ANY `haltReason`, Step 5 MUST:

1. Leave the plan file (`{planPath}` — the subject) in its **last-good state** (the state after the last integrator pass; do NOT auto-revert). Recovery via `cp {snapshotDir}/{slug}-pass-{N}.{ext} {planPath}` is the operator's choice per the locked C-10 recovery string.
2. Surface the `haltReason` and the locked **C-10** cause + recovery message to the user (or to stderr under `--auto`, per the C-08 path). The strings are **locked under C-10** — Step 5 MUST NOT paraphrase them. The canonical source is `agents/protocols/convergence-summary.schema.md § Halt Reason Cross-Reference` and the table in `agents/convergence-driver.md § Circuit Breakers § Halt Messages and Recovery (locked C-10)`.
3. Propagate the driver's exit code unchanged (exit 1 under `--auto` for `SCOPE_EXPANSION`; exit 0 otherwise for interactive halts that landed cleanly).

The wrapper does NOT write its own halt-summary artifact. The authoritative "did we converge" signal is `.plan-execution/convergence-summary.toon` — see § "Link-extraction readiness (C-11)" below.

##### Flag interactions matrix

| Combination | Behavior |
|---|---|
| `--autoconverge` + `--auto` | Non-interactive end-to-end (Q-01, F-03). `SCOPE_EXPANSION` halts exit code 1 + machine-readable stderr JSON per locked **C-08**. NO prompt. |
| `--autoconverge` + `--no-auto-commit` | Loop runs as normal. Iteration-level git commits are disabled. Auto-snapshots STILL write to `planning/history/snapshots/` per locked **C-07** (independent of git state). |
| `--autoconverge` + `--review-integrate` | SUPPORTED per locked **Q-02**. Critic is skipped because `--review-integrate` already skips it by design; autoconverge still runs after the review-integrate edit lands. (Internal sequence: Step 0 → Step R → Step 5; Steps 1, 1.5, 1.7, 2, 3, 4 are skipped on the `--review-integrate` path. Step 5 reads the post-Step-R plan as its `subject`.) |
| `--autoconverge` + `--skip-critic` | SUPPORTED. Critic skipped at Step 1 AND Step 1.7 (see Step 1.7 flag matrix); autoconverge still runs after Step 4. |
| `--autoconverge` + `--dry-run` | Preview only. Emit generated `converge.config` TOON to stdout, exit 0. Driver is NOT invoked. No config is written to disk. |
| `--autoconverge` + `--max-iterations N` | Override `maxIterations` ONLY. Bound `1 <= N <= 10`; out-of-range rejected with stderr error. Other defaults stay locked. |
| `--autoconverge` + `--estimate` | NOT SUPPORTED. `--estimate` exits at Step 0.5 before Step 4 even runs — there is no plan to converge against. The `--autoconverge` flag is silently ignored under `--estimate`. |

##### Link-extraction readiness (locked C-11)

Step 5 explicitly documents that the wrapper's on-disk outputs MUST be sufficient for a **fresh-context** agent (the future `loom-auto` planning-link or `converge-link`) to derive a `link-result.toon` envelope and a `nextLink in {verify, fix, planning, done}` decision **WITHOUT** orchestrator-side conversational state. After Step 5 returns (success or halt), the following files MUST be present on disk:

| Path | Producer | Purpose |
|---|---|---|
| `planning/plans/PLAN-{slug}.md` (or `PLAN.md` / `--output` path) | Step 4 initial write + integrator revisions during the loop | The subject — the converged (or last-good) plan |
| `.plan-execution/convergence-summary.toon` | convergence-driver (terminal-state transition, exactly once per run) | **AUTHORITATIVE** "did we converge" signal — `status` field drives `nextLink` (locked C-11) |
| `.plan-execution/criteria-plan.toon` (or `.plan-execution/criteria-plan-{slug}.toon`) | Step 1 criteria-planner-agent + Step 4 item 1b write | Criteria for downstream verify-link |
| `planning/history/snapshots/{slug}-pass-{N}.{ext}` (one per iteration with N >= 2) | convergence-driver auto-snapshot writer (locked C-07) | Pre-integration snapshots for `cp` recovery on halt |
| `.plan-execution/convergence/iterations/iter-{N}.toon` (one per iteration) | convergence-driver per-iteration summary writer | Per-pass detail for debrief |
| `.plan-execution/critique.toon` (only if critic ran in Step 1) | plan-critic-agent in Step 1 | Pre-review advisory critique (consumed by Step 1.7) |
| `.plan-execution/convergence/findings.toon` | plan-review-harness (Phase 9) per iteration | Latest iteration's findings (overwritten each iteration per schema) |

**Explicit constraints (locked C-11):**

- NO `pipeline-state.toon` mutation by this wrapper. The convergence-driver MUST NOT add convergence-internal fields to `pipeline-state.toon` per the forbidden-writes clause of `agents/protocols/convergence-summary.schema.md § Forbidden writes (C-11)`.
- NO mid-flight orchestrator-side state changes. Step 5 does not maintain its own state — the driver's `convergence-state.toon` and the terminal `convergence-summary.toon` are the only state files.
- The `convergence-summary.toon` `status` field is THE authoritative signal. A fresh-context link reads ONLY this file from disk and routes deterministically:
  - `status: converged` -> `nextLink: done`
  - `status: halted-stall` or `halted-regression` -> `nextLink: fix`
  - `status: halted-scope-expansion`, `halted-max-iter`, or `halted-budget` -> `nextLink: planning` (revisit plan)

This contract is what makes `--autoconverge` composable inside a future `loom-auto` planning-link / converge-link trampoline — the link can be invoked with no inherited conversational state and derive its next-step decision purely from on-disk artifacts.

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

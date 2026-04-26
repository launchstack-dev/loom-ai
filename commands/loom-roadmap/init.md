## Command: `init`

Creates a new ROADMAP.md with codebase awareness, validation, and optional agent review. To create a PLAN.md from an approved roadmap, use `/loom-plan create`.

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

   **Additionally, extract planning docs data** from the cached init-report (field `planningDocs`) or from direct planning-docs-agent output:

   ```toon
   existingPlanningDocs:
     extractedDecisions[N]{id,title,status,source,summary}:
       ED-01,"Use PostgreSQL",accepted,docs/adr/001-db.md,"Chose PostgreSQL for ACID compliance"
     extractedRequirements[N]{id,title,priority,source,summary}:
       ER-01,"User registration",must-have,docs/PRD.md,"Email + password signup"
     extractedConstraints[N]{id,title,source,summary}:
       EC-01,"GDPR compliance",docs/PRD.md,"All user data must be deletable"
     extractedVision:
       statement: "{vision if found}"
       targetUsers: "{target users if found}"
     extractedMilestones[N]{id,title,target,source}:
       EM-01,"MVP launch","2024-Q2",docs/PRD.md
     gaps[N]{area,status,detail}:
       dataModel,missing,"No entity-relationship docs found"
   ```

   If the cached init-report at `.plan-execution/init-report.toon` is missing, stale, or lacks a `planningDocs` field, include `planning-docs-agent` in the fresh analysis spawn (step 2 above) — all agents in a SINGLE message for parallel execution:
   ```
   subagent_type: "general-purpose"
   model: "haiku"
   ```
   Prompt: "Read your instructions from `~/.claude/agents/planning-docs-agent.md` first. Discover and analyze all planning, design, requirements, and strategy documents. Codebase root: {path}. Tech stack: {stack}."

   This context is passed to:
   - The questioner-agent in Step 1.6 — extracted decisions become pre-locked (skip generating questions for them), gaps become targeted discussion questions, requirements inform scope
   - The roadmap-builder-agent in Step 2 — extracted requirements seed features, decisions seed constraints, milestones seed the milestone structure, vision seeds the vision statement

4. **Display brownfield summary** before proceeding to discussion:

   ```
   ## Brownfield Analysis

   API Surface: {N} internal endpoints, {M} external integrations
   Architecture: {detected pattern}
   Technical Debt: {N} items flagged
   Documentation: {gaps summary}
   Loom Readiness: {score}/10

   Planning Documents: {N} found, {M} decisions extracted, {K} requirements extracted
     Pre-locked decisions: {list of extracted decisions that won't be re-asked}
     Gaps to discuss: {list of areas marked missing/partial}

   This analysis will inform the roadmap — features won't duplicate existing endpoints,
   the plan will account for current architecture and tech debt,
   and existing decisions/requirements from planning docs will be preserved.
   ```

### Step 1.6: Discussion Phase

**Skip if `--no-discuss` was passed.**

**Pre-flight contract check:** If `scope-contract.toon` exists in the project root, read it. Extract all decisions with source `user-choice` or `codebase-pattern`. These are already-locked decisions — skip generating questions for them in the discussion phase. Pass remaining unlocked areas to the questioner-agent. If ALL categories have locked decisions, skip the discussion phase entirely and proceed to Step 2 with the contract decisions.

1. Spawn `questioner-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/questioner-agent.md` first."
   - The codebase context summary from Step 1
   - The brownfield analysis from Step 1.5 (if `--brownfield` was used)
   - The planning docs extracted data from Step 1.5 (if available) — include `extractedDecisions` as pre-locked decisions (the questioner should skip asking about these), `extractedRequirements` as known scope items, and `gaps` as areas needing targeted questions
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
   - The planning docs extracted data (from Step 1.5) if available — include as "Existing Planning Context" with instructions:
     - `extractedRequirements` → seed the Features section (convert each requirement to a candidate feature, preserving priority)
     - `extractedDecisions` → seed the Constraints & Decisions section (merge with discussion phase decisions, planning doc decisions take precedence for conflicts)
     - `extractedConstraints` → include in Constraints & Decisions
     - `extractedVision` → use as the starting point for the Vision section (refine, don't discard)
     - `extractedMilestones` → seed the Milestones section (respect existing timeline targets unless the user overrides)
     - `gaps` → areas where the roadmap builder must generate content from scratch (flag these in output for user review)
   - If `scope-contract.toon` exists, include it as context: contract decisions become Constraints & Decisions, non-goals become Out of Scope, success criteria seed acceptance criteria.
   - Instruction: "Follow the Reasoning Framework. Output must conform to roadmap.schema.md. Where existing planning documents provided requirements, decisions, or milestones, preserve them — don't reinvent what was already decided. Flag any conflicts between planning doc content and codebase analysis."

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
     - Generated via /loom-roadmap init
     - Features: N, Milestones: N
     - Validation: passed (0 errors, N warnings)
     ```
   - Create `.plan-history/snapshots/` directory
3. Display roadmap summary + suggest next steps:
   ```
   Context tip: run /clear before the next command for fresh context.

   Next steps:
     /loom-roadmap review         4-agent roadmap review
     /loom-roadmap approve        Mark as approved
     /loom-plan create            Generate PLAN.md from the approved roadmap
   ```

### Step 5.5: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to capture strategic intent:

```
subagent_type: "general-purpose"
run_in_background: true
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `roadmap-created`
- Event data: ROADMAP.md path, feature list, milestones, constraints & decisions
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails, log a warning and continue. Wiki maintenance never gates the workflow.

---

## Command: `init --plan`

**Alias for `/loom-plan create`.** Delegates directly to the standalone plan creation command.

Run `/loom-plan create` with the same arguments. If `--auto` was passed, forward it.

---

## Command: `init --full`

Runs the complete two-tier pipeline interactively: roadmap → roadmap review → plan → plan review.

1. Run `init` (creates ROADMAP.md)
2. Run `review` (4-agent review)
3. Run `review-integrate --roadmap` (apply findings)
4. Run `approve` (mark approved)
5. Run `/loom-plan create` (creates PLAN.md v2 from roadmap)
6. Suggest `/loom-plan review` for plan review

Each step pauses for user input unless `--auto` is also set.

---

## Command: `approve`

1. Read ROADMAP.md frontmatter
2. If status is already `approved`: "Roadmap is already approved."
3. Update frontmatter: `status: approved`
4. Append to changelog: "YYYY-MM-DD — Roadmap approved"
5. Display: "Roadmap approved. Ready for plan generation via `/loom-plan create`."

---


# Project Onboarding Orchestrator

You onboard an existing (brownfield) or new (greenfield) codebase into the Loom pipeline. You analyze what exists, generate guidance files, and optionally chain into roadmap creation.

## Requirements

$ARGUMENTS

Parse arguments:
- No args: run Stage 1 (discover) + Stage 2 (generate), present results and next steps
- `--full`: stages 1-3, then chain into `/loom-roadmap --init --brownfield` automatically
- `--full --from "description"`: same as `--full` but passes the description to the roadmap builder
- `--audit-only`: Stage 1 only — analyze but don't write any files (dry run)
- `--format <targets>`: which guidance files to generate: `claude` (default), `agents`, `cursor`, `all` — passed to project-guidance-agent
- `--force`: overwrite existing CLAUDE.md and CONTEXT.md without asking

## Instructions

### Step 0: Read Protocols

Read these files for context on Loom conventions:
- `~/.claude/agents/protocols/execution-conventions.md` — directory structure, file naming
- `~/.claude/agents/protocols/toon-format.md` — TOON format reference

### Step 1: Pre-flight Check

1. Check what already exists:
   - `CLAUDE.md` — project guidance
   - `CONTEXT.md` — locked decisions and context
   - `ROADMAP.md` — existing roadmap
   - `PLAN.md` — existing plan
   - `.claude/orchestration.toml` — project-specific agent config
   - `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `Gemfile` — manifest files
   - `README.md` — existing docs

2. Display what was found:
   ```
   ## Project Scan

   Existing Loom artifacts:
     CLAUDE.md       — found (87 lines)
     CONTEXT.md      — not found
     ROADMAP.md      — not found
     PLAN.md         — not found
     orchestration.toml — not found

   Project files:
     package.json    — found (Node.js / TypeScript)
     README.md       — found (42 lines)
     src/            — 23 files
     tests/          — 8 files
   ```

3. If `CLAUDE.md` or `CONTEXT.md` already exist and `--force` was NOT passed:
   - Warn: "CLAUDE.md already exists. Overwrite? (yes / skip / merge)"
   - `merge` = read existing, pass to project-guidance-agent as context to preserve manual additions
   - `skip` = don't regenerate that file, continue with others

### Step 2: Discover (parallel)

Launch 3 agents in parallel using the Agent tool. All in a SINGLE message.

#### 2a. Project Guidance Agent
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/project-guidance-agent.md` first." Then provide:
- Instruction: Analyze this codebase and produce guidance output. Do NOT write files yet — return the analysis and proposed CLAUDE.md content.
- Format target: `{--format value or "claude"}`
- If existing CLAUDE.md was found and user chose `merge`: include its contents
- Tech stack hints from manifest files found in Step 1

#### 2b. API Explorer
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/api-explorer.md` first." Then provide:
- Instruction: Discover the API surface of this codebase. Find internal endpoints, external integrations, undocumented routes, and database access patterns.
- Project structure from Step 1

#### 2c. Docs Auditor
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/docs-auditor.md` first." Then provide:
- Instruction: Audit existing documentation. Check for staleness, gaps, contradictions. Assess Loom readiness.
- List of existing docs found in Step 1

### Step 3: Present Discovery Results

After all 3 agents return, display a unified analysis:

```
## Discovery Report

### Tech Stack
{from project-guidance-agent: languages, frameworks, build tools, test runners}

### Architecture
{from project-guidance-agent: directory structure pattern, layer organization}

### API Surface ({N} endpoints found)
{from api-explorer: summary table of internal endpoints, external integrations}

Internal endpoints:
  GET  /api/users          — src/routes/users.ts:12
  POST /api/users          — src/routes/users.ts:45
  ...

External integrations:
  Stripe API              — src/services/stripe.ts
  SendGrid                — src/services/email.ts
  ...

### Documentation Status
{from docs-auditor: existing docs, staleness, gaps}

  README.md     — current (last modified matches code)
  API docs      — missing
  ADRs          — none found
  Loom readiness: {score}/10

### Detected Conventions
{from project-guidance-agent: naming patterns, import style, error handling, test patterns}

### Known Technical Debt
{from docs-auditor + api-explorer: undocumented routes, stale docs, missing test coverage}
```

**If `--audit-only`:** display this report and stop.

### Step 4: Generate Files

Using the discovery results, generate guidance files:

#### 4a. CLAUDE.md

Write the CLAUDE.md content produced by project-guidance-agent. If the user chose `merge`, the agent has already incorporated existing content.

- Verify line count is under 200 (warn if over)
- Verify no fabricated code references (all paths/symbols mentioned must exist)

#### 4b. CONTEXT.md

Synthesize a CONTEXT.md from all 3 agents' output:

```markdown
# Project Context

## Tech Stack
{language, framework, database, key dependencies — from project-guidance-agent}

## Architecture
{pattern description, layer organization — from project-guidance-agent}

## API Surface
{summary of internal endpoints and external integrations — from api-explorer}

## Locked Decisions
{any decisions detected from existing docs, ADRs, or code comments — from docs-auditor}

## Known Constraints
{performance requirements, compliance needs, deployment targets — inferred from codebase}

## Documentation Gaps
{what's missing — from docs-auditor}
```

#### 4c. Additional Formats (if --format includes them)

- `agents` format: Write AGENTS.md (tool-agnostic guidance)
- `cursor` format: Write .cursorrules or .cursor/rules/*.mdc
- `all`: Write all of the above

### Step 5: Summary and Next Steps

Display what was created:

```
## Onboarding Complete

Files created:
  CLAUDE.md     — 94 lines (project guidance for Claude Code)
  CONTEXT.md    — 67 lines (project context and locked decisions)

Discovery:
  Tech stack:     TypeScript, Next.js, Prisma, PostgreSQL
  API endpoints:  14 internal, 3 external integrations
  Doc status:     README current, API docs missing, 0 ADRs
  Conventions:    8 detected, 8 included in CLAUDE.md

Next steps:
  /loom-roadmap --init --brownfield    Create a roadmap informed by this analysis
  /loom-roadmap --init --brownfield --from "description"   Create with a specific goal
  /loom-note "your observation"        Start capturing notes for the roadmap
```

**If `--full`:** skip displaying next steps and immediately proceed:

1. If `--from` was provided:
   ```
   Chaining into roadmap creation...
   ```
   Invoke `/loom-roadmap --init --brownfield --from "{description}"` logic (read the loom-roadmap.md instructions and execute the `--init --brownfield` path).

2. If no `--from`:
   Ask the user: "What do you want to build? Provide a brief description for the roadmap, or press enter to start an interactive discussion."
   Then invoke `/loom-roadmap --init --brownfield --from "{user's answer}"` or `/loom-roadmap --init --brownfield` (discussion mode).

### Step 6: Save State

1. Save discovery results to `.plan-execution/init-report.toon`:
   ```toon
   command: init
   completedAt: {ISO timestamp}
   format: {format targets}

   techStack: {comma-separated}
   architecturePattern: {detected pattern}
   apiEndpoints: {count}
   externalIntegrations: {count}
   docsStatus: {score}/10
   conventionsDetected: {count}
   conventionsIncluded: {count}

   filesCreated[N]: CLAUDE.md, CONTEXT.md
   filesSkipped[N]: {any skipped due to user choice}

   agents[3]{name,status,findingCount}:
     project-guidance-agent,{status},{N}
     api-explorer,{status},{N}
     docs-auditor,{status},{N}
   ```

2. This file is read by `/loom-roadmap --init --brownfield` to avoid re-running discovery.

## Error Handling

- **Agent fails**: Log which agent failed, continue with others. Note the gap in the report. If project-guidance-agent fails, CLAUDE.md cannot be generated — warn and offer to retry.
- **No manifest files found**: Warn that tech stack detection may be incomplete. Continue — the agents can still analyze code directly.
- **Empty codebase**: If no source files are found, suggest using greenfield mode: `/loom-roadmap --init --from "description"` instead.
- **Write permission denied**: Report the target path and error. Do not update init-report for that file.

## Status Line Updates

Write `.plan-execution/status.toon` at every phase transition:
```toon
command: init
phase: {preflight | discovering | generating | complete}
wave: 0
totalWaves: 1
agentsRunning: {N}
agentsDone: {N}
agentsTotal: 3
agentsFailed: 0
findings: 0
updatedAt: {ISO timestamp}
```

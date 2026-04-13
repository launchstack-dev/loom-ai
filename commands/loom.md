# Loom

Loom is a multi-agent pipeline for planning, executing, testing, and reviewing software projects.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args or `help` or `reference`: show system reference (existing /loom content)
- `init`: brownfield project onboarding (was /loom-init)
- `auto`: fully autonomous pipeline (was /loom-auto)
- `converge`: convergence loop (was /loom-converge)
- `quick`: zero-ceremony task execution (was /loom-quick)
- `pause`: snapshot workflow state for session handoff
- `resume`: restore context from paused session
- `do "text"`: smart routing to the right command
- `next`: state-aware next step suggestion
- `profile [name]`: view or switch model cost profile
- `status`: project status overview
- `debate "question"`: adversarial multi-round reasoning between agents
- `chain "task"`: progressive refinement pipeline (draft → refine → harden)
- `vote "problem"`: parallel independent solutions + evaluator picks best
- `triage "task"`: cheap router classifies, routes to appropriate specialist

---

## Subcommand: (none -- reference)

Display a concise reference for Loom -- its commands, agents, and workflows.

Print the following help text exactly, then stop. Do not add commentary.

---

## Loom

A multi-agent pipeline for planning, executing, and verifying software projects.

### Commands

#### Initialization

| Command | Description |
|---------|-------------|
| `/loom init` | Brownfield onboarding: analyze codebase, generate CLAUDE.md + CONTEXT.md |
| `/loom init --full` | Onboarding + chain into roadmap creation |
| `/loom init --full --from "desc"` | Onboarding + roadmap from description |
| `/loom init --audit-only` | Analyze only, don't write files |
| `/loom init --format all` | Generate CLAUDE.md + AGENTS.md + .cursorrules |

#### Roadmapping & Planning

| Command | Description |
|---------|-------------|
| `/loom-roadmap` | Show unified status (roadmap + plan + milestones + progress) |
| `/loom-roadmap init` | Create a new ROADMAP.md interactively (includes discussion phase) |
| `/loom-plan create` | Alias: generate PLAN.md from approved ROADMAP.md (see Planning section) |
| `/loom-roadmap init --full` | Full pipeline: roadmap → review → plan → review (interactive) |
| `/loom-roadmap init --from "desc"` | Create a roadmap from a one-line description |
| `/loom-roadmap init --brownfield` | Analyze existing codebase before roadmap creation |
| `/loom-roadmap --discuss` | Run discussion phase to surface architectural decisions |
| `/loom-roadmap --no-discuss` | Skip the discussion phase |
| `/loom-roadmap --auto` | Accept all recommended defaults without prompting |
| `/loom-roadmap approve` | Mark ROADMAP.md as approved (unlocks plan generation) |
| `/loom-roadmap review` | Trigger roadmap review |
| `/loom-roadmap review-integrate` | Apply roadmap review findings to ROADMAP.md |
| `/loom-roadmap validate` | Run plan validation pipeline (stages 1-4) |
| `/loom-roadmap validate --roadmap` | Run roadmap validation pipeline (stages 1-4) |
| `/loom-roadmap validate --deep` | Full validation including agent feasibility + schema completeness |
| `/loom-roadmap refine` | Refine plan using review history |
| `/loom-roadmap refine --roadmap` | Refine roadmap using review history |
| `/loom-roadmap status` | Detailed execution + milestone progress |
| `/loom-roadmap deps` | Show phase dependency graph + critical path |
| `/loom-roadmap diff` | Compare current plan vs last snapshot |
| `/loom-roadmap history` | Show plan revision history |
| `/loom-roadmap milestone add/complete/list` | Manage milestones |
| `/loom-roadmap snapshot` | Save current plan state for versioning |
| `/loom-roadmap review [path]` | Launch 4 agents to review a ROADMAP.md |
| `/loom-plan create` | Generate PLAN.md (v2 spec) from an approved ROADMAP.md |
| `/loom-plan create --auto` | Generate plan without interactive review |
| `/loom-plan create --v1` | Generate simpler v1 plan (no API specs or state machines) |
| `/loom-plan create --review-integrate` | Apply plan review findings to PLAN.md |
| `/loom-plan review [path]` | Launch 6 planning agents in parallel to review a PLAN.md |

#### Execution

| Command | Description |
|---------|-------------|
| `/loom-plan execute [path]` | Execute a plan wave-by-wave with human approval gates |
| `/loom-plan execute --init` | Scaffold a new PLAN.md template interactively |
| `/loom-plan execute --dry-run` | Preview wave structure without executing |
| `/loom-plan execute --resume` | Resume from `.plan-execution/state.toon` |
| `/loom-plan execute --wave N` | Re-run a single wave |
| `/loom-plan execute --contracts-only` | Run only Wave 0 (contracts) |
| `/loom auto --from "description"` | Full autonomous pipeline: plan → build → test → review → fix loops |
| `/loom auto --plan PLAN.md` | Autonomous pipeline from existing plan |
| `/loom auto --resume` | Resume autonomous pipeline from saved state |
| `/loom auto --max-iterations N` | Cap outer loop iterations (default: 3) |
| `/loom auto --max-agents N` | Cap total agent spawns (default: 50) |
| `/loom auto --dry-run` | Show pipeline plan without executing |
| `/loom auto --stop-after <stage>` | Stop after named stage (roadmap, plan, execute, converge, test, review, fix) |
| `/loom auto --converge-target <path>` | Enable convergence with a golden target file |
| `/loom auto --converge-config <path>` | Enable convergence with existing harness config |
| `/loom converge --target <path>` | Convergence loop: compare implementation against deterministic target |
| `/loom converge --config <path>` | Run convergence with existing harness config |
| `/loom converge --max-iterations N` | Cap convergence iterations (default: 10) |
| `/loom converge --tolerance <threshold>` | Global tolerance override (0.0-1.0) |
| `/loom converge --dry-run` | Parse targets + build harness, show setup, stop before loop |
| `/loom converge --resume` | Resume convergence from saved state |
| `/loom converge --status` | Show current convergence state |
| `/loom quick "task description"` | Execute a quick task (auto-detects mode) |
| `/loom quick --append "task"` | Force append as new plan phase |
| `/loom quick --inject "task"` | Force inject into running execution |
| `/loom quick --no-verify "task"` | Skip post-execution verification |

#### Session Management

| Command | Description |
|---------|-------------|
| `/loom pause` | Snapshot workflow state for session handoff |
| `/loom resume` | Restore context from paused session |
| `/loom do "text"` | Smart routing to the right Loom command |
| `/loom next` | State-aware next step suggestion |
| `/loom profile [name]` | View or switch model cost profile |
| `/loom status` | Project status overview |

#### Review & Testing

| Command | Description |
|---------|-------------|
| `/loom-plan test [path]` | Generate tests from plan acceptance criteria |
| `/loom-plan test --criteria-only` | Extract test specs without generating tests |
| `/loom-plan test --unit-only` | Generate unit tests only |
| `/loom-plan test --e2e-only` | Generate E2E tests only |
| `/loom-plan test --chrome` | Interactive E2E testing via Chrome MCP |
| `/loom-plan test --run` | Generate AND run all tests |
| `/loom-plan test --parallel` | Generate unit + E2E tests in parallel |
| `/loom-code review` | Comprehensive review: built-in + bespoke agents in parallel |
| `/loom-code review --branch` | Review all changes on current branch vs main |
| `/loom-code review --pr 123` | Review a specific PR |
| `/loom-code review --quick` | Fast: code style + security only |
| `/loom-code review --full` | All reviewers including comments + types |
| `/loom-code review --plan PLAN.md` | Include plan compliance check |
| `/loom-code fix` | Auto-apply review findings with parallel fixer-agents |
| `/loom-code fix --report <path>` | Apply findings from a specific report |
| `/loom-code fix --severity critical,warning` | Filter findings by severity (default: critical + warning) |
| `/loom-code fix --dry-run` | Show fix plan without applying changes |
| `/loom-code fix --auto` | Skip approval gate after fixes |
| `/loom-code fix --finding N` | Fix a single finding by number |

#### Knowledge & Maintenance

| Command | Description |
|---------|-------------|
| `/loom-note <text>` | Add a development note (auto-tagged) |
| `/loom-note --tag <tag> <text>` | Add a tagged note (architecture, bug, idea, decision, concern, perf, security, ux, debt, wiki) |
| `/loom-note --priority high <text>` | Add a high-priority note |
| `/loom-note --review` | Review pending notes grouped by tag, suggest placement |
| `/loom-note --assimilate` | Review notes AND apply them to roadmap/plan/context docs |
| `/loom-note --list` | Show all notes (pending + assimilated + dismissed) |
| `/loom-note --dismiss <id>` | Dismiss a note by ID |
| `/loom-wiki ingest` | Incremental wiki ingest on uncommitted changes |
| `/loom-wiki ingest --source <path>` | Ingest a specific file or directory into wiki |
| `/loom-wiki ingest --url <url>` | Ingest an external document into wiki |
| `/loom-wiki ingest --execution` | Ingest latest execution results into wiki |
| `/loom-wiki ingest --full` | Full re-ingest of entire codebase |
| `/loom-wiki ingest --dry-run` | Preview wiki changes without writing |
| `/loom-wiki lint` | Run all structural health checks (wiki + execution) |
| `/loom-wiki lint --wiki` | Wiki-only checks (orphans, stale, cross-refs, contradictions) |
| `/loom-wiki lint --contracts` | Contract drift detection |
| `/loom-wiki lint --plan` | Plan-reality divergence |
| `/loom-wiki lint --fix` | Auto-fix where possible |
| `/loom-wiki lint --severity <level>` | Filter by minimum severity (blocking, warning, info) |

#### Tooling & Infrastructure

| Command | Description |
|---------|-------------|
| `/loom-library` or `/loom-library list` | Show installed items grouped by type (commands, agents, infrastructure) |
| `/loom-library use <name>` | Install item from catalog, resolve dependencies |
| `/loom-library sync` | Re-pull all installed items, compare hashes |
| `/loom-library search <query>` | Search catalog by name/description |
| `/loom-library add <source>` | Add new item (local path or GitHub URL) |
| `/loom-library remove <name>` | Uninstall, warn about dependents |
| `/loom-library update` | Self-update catalog, update installed items + infrastructure, clear update indicator |
| `/loom-library update --check-only` | Report available updates without applying |
| `/loom-library upgrade` | Alias for `update` |
| `/loom-agent create` | Interactive wizard: create a bespoke agent + wire into pipeline |
| `/loom-agent create --pipeline review --role "HIPAA checker"` | Quick mode with pipeline and role |
| `/loom-agent create --from .claude/agents/existing.md` | Clone and customize an existing agent |
| `/loom-git` | Git workflow automation -- commit, push, PR, merge, cleanup, review-pr |
| `/loom-git commit` | Auto-conventional commit with smart staging |
| `/loom-git push` | Push with upstream auto-setup |
| `/loom-git pr` | Create PR with dirty-tree check and auto-generated title/body |
| `/loom-git merge [PR#]` | Squash-merge PR with cleanup offer |
| `/loom-git cleanup [branch]` | Delete remote branch (not local) |
| `/loom-git review-pr [PR#]` | Comprehensive PR review (diff, comments, CI, conflicts) |
| `/loom-statusline-setup` | Configure the Claude Code status line (Starship integration, ambient state) |
| `/loom` | Show this reference |

### Agent Groups

**Roadmap** (spawned by `/loom-roadmap review` and `/loom-roadmap init`):
- `roadmap-builder-agent` -- Creates ROADMAP.md files from descriptions and discussion output
- `scope-feasibility-agent` -- Reviews roadmap scope, feature conflicts, milestone sizing
- `questioner-agent` -- Surfaces architectural decisions before roadmap generation

**Strategy & UX** (spawned by `/loom-plan review`, `/loom-roadmap review`, and `/loom-code review`):
- `strategy-agent` -- Positioning, differentiation, feature prioritization (planning mode); strategic drift, sequencing, scope creep (review mode)
- `ux-agent` -- User flows, state coverage, interaction patterns, a11y targets (planning mode); UX conformance, missing states (review mode)

**Planning** (spawned by `/loom-plan review` and `/loom-plan create`):
- `feature-coverage-agent` -- Audits schema, API surface, features against competitors
- `phasing-agent` -- Reviews phase boundaries, dependencies, sequencing risks
- `parallelization-agent` -- Designs execution waves, merge strategy, conflict prevention
- `agentic-workflow-agent` -- Decomposes phases into context-bounded agent tasks
- `plan-builder-agent` -- Creates v1/v2 PLAN.md files (v2 = spec-driven with API specs, state machines)

**Execution** (spawned by `/loom-plan execute`):
- `contracts-agent` -- Wave 0: creates shared types, interfaces, schemas on disk
- `implementer-agent` -- Parallel worker within strict file ownership boundaries
- `api-route-creator` -- Specialized implementer: internal API endpoints, validation, middleware
- `api-connector` -- Specialized implementer: typed third-party API clients, auth, retry logic
- `wiring-agent` -- Post-wave integration: barrel files, routes, imports, deps
- `verification-agent` -- Quality gate: typecheck, tests, lint, ownership drift

**Testing** (spawned by `/loom-plan test`):
- `acceptance-criteria-agent` -- Extracts testable criteria from plan, outputs structured test specs
- `unit-test-agent` -- Generates unit tests from contracts + acceptance criteria + source code
- `e2e-test-agent` -- Generates Playwright E2E tests, supports `--chrome` and bowser integration

**Code Review** (spawned by `/loom-code review`):
- *Built-in*: `code-reviewer`, `silent-failure-hunter`, `code-simplifier`, `test-analyzer`, `comment-analyzer`, `type-design-analyzer`
- `security-reviewer` -- OWASP Top 10 audit: injection, auth, XSS, secrets, dependencies
- `architecture-reviewer` -- Dependency direction, pattern consistency, contract conformance
- `plan-compliance-reviewer` -- Deliverables, schema drift, acceptance criteria coverage
- `api-explorer` -- Brownfield API surface discovery: internal endpoints, external integrations, undocumented routes

**Code Fix** (spawned by `/loom-code fix`):
- `fixer-agent` -- Parallel worker that applies review findings within file ownership boundaries

**Documentation** (spawned by docs-generator and docs-auditor workflows):
- `docs-generator` -- Greenfield + brownfield documentation: README, API docs, ADRs, onboarding, CLAUDE.md, codebase maps
- `docs-auditor` -- Documentation audit (staleness, gaps, contradictions) + Loom readiness assessment

**Architecture Decision** (spawned via debate pattern):
- `tech-stack-debater` -- Multi-persona debate: advocate, skeptic, pragmatist for technology selection
- `migration-architect` -- Incremental migration planning with risk assessment + rollback strategies

**Extended Review** (registered via orchestration.toml, spawned by `/loom-code review`):
- `performance-reviewer` -- N+1 queries, algorithmic complexity, rendering, bundle size, I/O, pagination
- `accessibility-reviewer` -- WCAG 2.1 AA: semantic HTML, ARIA, keyboard, contrast, focus, forms
- `dependency-auditor` -- CVEs, license compliance, abandoned packages, version drift
- `api-design-reviewer` -- REST conventions, HTTP methods, error formats, versioning, pagination
- `database-schema-reviewer` -- Normalization, indexes, migration safety, constraints, naming
- `infra-reviewer` -- Dockerfile, CI pipelines, IaC, secrets, resource limits, networking
- `observability-reviewer` -- Structured logging, metrics, tracing, health checks, alerting

**Convergence Loop** (spawned by `/loom converge`):
- `target-parser` -- Normalizes deterministic sources into comparable target manifests
- `harness-builder` -- Scaffolds comparison infrastructure (diff scripts, config, runner)
- `delta-analyzer` -- Triages deltas: noise vs actionable, prioritizes fixes
- `convergence-driver` -- Iteration orchestrator with circuit breakers (stall, regression, budget)

**Wiki** (spawned by `/loom-wiki ingest`, `/loom-wiki lint`, and automatically during execution):
- `wiki-maintainer-agent` -- Updates wiki pages, cross-references, index after execution events and code changes
- `wiki-ingest-agent` -- Processes new sources into structured wiki pages (codebase, docs, execution results, notes)
- `wiki-lint-agent` -- Periodic health checks: contradictions, orphans, staleness, plan-reality drift
- `wiki-query-agent` -- Searches wiki, synthesizes answers from multiple pages, optionally files answers back

**Utility:**
- `meta-agent` -- Generates new agents, skills, and commands from descriptions
- `tdd-coach` -- Drives test-driven development (red-green-refactor cycle)
- `/loom-agent create` -- Interactive wizard to create project-specific bespoke agents + pipeline registration

### Typical Workflow

```
Greenfield:
  /loom-roadmap init --from "desc"  -- discussion phase + ROADMAP.md creation

Brownfield (existing codebase):
  /loom init                     -- analyze codebase, generate CLAUDE.md + CONTEXT.md
  /loom-roadmap init --brownfield   -- roadmap informed by existing code

Either path continues:

Tier 1 -- Roadmap (strategy):
1.  /loom-roadmap init           -- discussion phase + ROADMAP.md creation
2.  /loom-roadmap review         -- 4 agents review roadmap
3.  /loom-roadmap review-integrate -- apply roadmap review findings
4.  /loom-roadmap approve        -- lock roadmap, enable plan generation

Tier 2 -- Plan (spec):
5.  /loom-plan create            -- generate v2 PLAN.md from approved roadmap
6.  /loom-plan review            -- 6 agents analyze plan in parallel
7.  /loom-plan create --review-integrate -- apply plan review findings
8.  /loom-roadmap deps           -- verify dependency graph + critical path

Tier 3 -- Build:
9.  /loom-plan execute --dry-run -- preview the wave structure
10. /loom-plan execute           -- run the full pipeline with approval gates

Tier 4 -- Qualify:
11. /loom-plan test --run        -- generate and run all tests
12. /loom-code review            -- full code review
13. /loom-code fix               -- auto-apply review findings
14. /loom-roadmap status         -- track progress across everything
```

Or one-shot brownfield:
```
/loom init --full --from "desc"   -- onboard + roadmap in one step
```

Or fully autonomous:
```
/loom auto --from "description"    -- plan, build, test, review, fix until done
```

### Execution Pipeline

```
Pre:    scope coverage check (maps criteria -> tasks, flags orphans)
Wave 0: contracts-agent -> verify -> human gate
Wave N: implementer-agents (parallel) -> wiring-agent -> verify -> scope drift check -> human gate
        ^ repeat for each wave
```

### Autonomous Pipeline (/loom auto)

```
Outer Loop (max 3 iterations):
  Roadmap: roadmap init -> roadmap review -> integrate -> approve
  Plan:    plan create -> plan review -> integrate -> validate
  Build:   plan execute --auto (wave loop with automated gates)
  Qualify: plan test -> code review -> code fix (max 2 fix cycles)
  Gate:    DONE / FIX / REVISE-PLAN / REVISE-ROADMAP / ESCALATE
```

### Convergence Pipeline (/loom converge)

```
target-parser(source) -> target manifest
harness-builder(manifest) -> comparison harness + converge.config
Human approval gate: review targets + tolerances
[Convergence Loop]:
  harness -> Delta Report
  delta-analyzer -> prioritized fix list
  fixer-agents (parallel) -> code changes
  harness -> new Delta Report
  Circuit break if: stalled | regression | budget exhausted | max iterations
Final: convergence report (pass/fail per target)
```

Each agent returns a structured `AgentResult`. State is tracked in `.plan-execution/state.toon`. Cross-wave context is compressed into HOT/WARM/COLD tiers to stay under 10k tokens. Background agents report progress via `.plan-execution/progress/{taskId}.toon` -- the orchestrator polls these files to render a live dashboard, detect stale/hung agents, and escalate via SendMessage. Orchestrators use the **lean pattern**: agents read their own `.md` instructions from disk instead of having them embedded in the prompt (see `execution-conventions.md`).

### File Structure (during execution)

```
.loom/                            -- Persistent knowledge base (git-tracked)
  wiki/
    index.toon                -- Categorical catalog of all wiki pages
    log.toon                  -- Append-only operation log
    execution-log.toon        -- Narrative decision/pivot history
    pages/
      component-*.md          -- Code modules, services, components
      concept-*.md            -- Domain concepts and principles
      decision-*.md           -- Architectural decisions with rationale
      pattern-*.md            -- Recurring patterns and best practices
      convention-*.md         -- Project conventions and standards
      api-surface-*.md        -- API endpoint groups
      tech-debt-*.md          -- Known tech debt items
      external-*.md           -- External integrations
      execution-record-*.md   -- Execution event records

.plan-execution/              -- Ephemeral (gitignored)
  state.toon              -- Execution state (resumable)
  rolling-context.md      -- Compressed cross-wave context
  contracts/              -- Shared types and interfaces
    manifest.toon         -- Contract registry
  progress/               -- Agent heartbeat files (monitoring)
    {taskId}.toon
  requests/               -- Cross-boundary change requests
    {taskId}.toon
  scope-coverage.toon     -- Acceptance criteria coverage matrix
  wave-N-summary.toon     -- Per-wave results
  convergence/            -- Convergence loop state
    targets/              -- Normalized target artifacts
    convergence-state.toon -- Iteration state (resumable)
    convergence-report.md -- Final convergence report
    converge.config       -- Target-to-method mapping + tolerances
  continue-here.toon      -- Session pause/resume snapshot

.plan-history/                -- Persistent (git-tracked)
  reviews/                -- Review findings (roadmap + plan)
    YYYY-MM-DD-roadmap-review.toon
    YYYY-MM-DD-review.toon
  decisions/              -- Architecture Decision Records
    NNN-description.md
  executions/             -- Preserved wave summaries
    wave-N-summary.toon
  snapshots/              -- Plan version snapshots
    YYYY-MM-DD-plan.md
  quick-tasks/            -- Quick task logs
    YYYY-MM-DD-slug.toon
  roadmap.toon            -- Milestones, status, dependencies
  changelog.md            -- Plan revision history

research/                         -- Design rationale and analysis artifacts
  karpathy-llm-wiki-analysis.toon -- LLM wiki pattern that inspired the wiki system
```

### Adding App-Specific Agents

Create `.claude/orchestration.toml` in your project root to plug custom agents into any pipeline:

```toml
# .claude/orchestration.toml

[planning.agents.domain-validator]
source = ".claude/agents/domain-validator.md"
model = "sonnet"
input = ["plan"]
outputRole = "reviewer"

[execution.agents.migration-agent]
source = ".claude/agents/migration-agent.md"
model = "opus"
phase = "post-contracts"        # when in the wave lifecycle
outputRole = "producer"          # creates files (vs reviewer = findings only)

[testing.agents.compliance-test-agent]
source = ".claude/agents/compliance-test-agent.md"
model = "opus"
phase = "post-criteria"
outputRole = "producer"

[review.agents.hipaa-reviewer]
source = ".claude/agents/hipaa-reviewer.md"
model = "sonnet"
modes = ["default", "full"]     # which /loom-code review modes include it
outputRole = "reviewer"
```

Or use `/loom-agent create` to interactively create an agent and wire it into a pipeline in one step.

### Distribution

Agents, commands, and infrastructure are registered in `~/.claude/skills/library/library.yaml` and can be synced across machines via GitHub. Infrastructure items (statusline renderer, update checker) are self-updating -- `/loom-library update` fetches the latest versions from GitHub and replaces local copies.

A background update checker runs every 4 hours (triggered by the statusline renderer). When a newer `catalog_version` is detected, a yellow `^ update` indicator appears in the idle statusline. Run `/loom-library update` to apply updates and clear the indicator.

---

## Subcommand: init

You onboard an existing (brownfield) or new (greenfield) codebase into the Loom pipeline. You analyze what exists, generate guidance files, and optionally chain into roadmap creation.

### Arguments

Parse arguments after `init`:
- No args: run Stage 1 (discover) + Stage 2 (generate) + Stage 3 (wiki), present results and next steps
- `--full`: stages 1-4, then chain into `/loom-roadmap init --brownfield` automatically
- `--full --from "description"`: same as `--full` but passes the description to the roadmap builder
- `--audit-only`: Stage 1 only -- analyze but don't write any files (dry run)
- `--format <targets>`: which guidance files to generate: `claude` (default), `agents`, `cursor`, `all` -- passed to project-guidance-agent
- `--no-wiki`: skip wiki generation (wiki is generated by default)
- `--force`: overwrite existing CLAUDE.md, CONTEXT.md, and wiki without asking

### Instructions

#### Step 0: Read Protocols

Read these files for context on Loom conventions:
- `~/.claude/agents/protocols/execution-conventions.md` -- directory structure, file naming
- `~/.claude/agents/protocols/toon-format.md` -- TOON format reference

#### Step 1: Pre-flight Check

1. Check what already exists:
   - `CLAUDE.md` -- project guidance
   - `CONTEXT.md` -- locked decisions and context
   - `ROADMAP.md` -- existing roadmap
   - `PLAN.md` -- existing plan
   - `.claude/orchestration.toml` -- project-specific agent config
   - `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `Gemfile` -- manifest files
   - `README.md` -- existing docs

2. Display what was found:
   ```
   ## Project Scan

   Existing Loom artifacts:
     CLAUDE.md       -- found (87 lines)
     CONTEXT.md      -- not found
     ROADMAP.md      -- not found
     PLAN.md         -- not found
     orchestration.toml -- not found

   Project files:
     package.json    -- found (Node.js / TypeScript)
     README.md       -- found (42 lines)
     src/            -- 23 files
     tests/          -- 8 files
   ```

3. If `CLAUDE.md` or `CONTEXT.md` already exist and `--force` was NOT passed:
   - Warn: "CLAUDE.md already exists. Overwrite? (yes / skip / merge)"
   - `merge` = read existing, pass to project-guidance-agent as context to preserve manual additions
   - `skip` = don't regenerate that file, continue with others

#### Step 2: Discover (parallel)

Launch 3 agents in parallel using the Agent tool. All in a SINGLE message.

##### 2a. Project Guidance Agent
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/project-guidance-agent.md` first." Then provide:
- Instruction: Analyze this codebase and produce guidance output. Do NOT write files yet -- return the analysis and proposed CLAUDE.md content.
- Format target: `{--format value or "claude"}`
- If existing CLAUDE.md was found and user chose `merge`: include its contents
- Tech stack hints from manifest files found in Step 1

##### 2b. API Explorer
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/api-explorer.md` first." Then provide:
- Instruction: Discover the API surface of this codebase. Find internal endpoints, external integrations, undocumented routes, and database access patterns.
- Project structure from Step 1

##### 2c. Docs Auditor
```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/docs-auditor.md` first." Then provide:
- Instruction: Audit existing documentation. Check for staleness, gaps, contradictions. Assess Loom readiness.
- List of existing docs found in Step 1

#### Step 3: Present Discovery Results

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
  GET  /api/users          -- src/routes/users.ts:12
  POST /api/users          -- src/routes/users.ts:45
  ...

External integrations:
  Stripe API              -- src/services/stripe.ts
  SendGrid                -- src/services/email.ts
  ...

### Documentation Status
{from docs-auditor: existing docs, staleness, gaps}

  README.md     -- current (last modified matches code)
  API docs      -- missing
  ADRs          -- none found
  Loom readiness: {score}/10

### Detected Conventions
{from project-guidance-agent: naming patterns, import style, error handling, test patterns}

### Known Technical Debt
{from docs-auditor + api-explorer: undocumented routes, stale docs, missing test coverage}
```

**If `--audit-only`:** display this report and stop.

#### Step 3.5: Present Setup Options

After displaying the discovery report, show the user what will be generated and surface available options:

```
## Setup Options

Based on the discovery, here's what we'll generate:

  [x] CLAUDE.md          -- Project guidance for Claude Code
  [x] CONTEXT.md         -- Locked decisions and constraints
  [x] Project Wiki       -- Persistent knowledge base (.loom/wiki/)
      Estimated pages: ~{N} (components, APIs, conventions, decisions, tech debt)
  [ ] AGENTS.md           -- Tool-agnostic guidance (use --format agents)
  [ ] .cursorrules        -- Cursor IDE guidance (use --format cursor)

Other options:
  --no-wiki              Skip wiki generation
  --format all           Generate all guidance formats
  --full                 Generate + chain into roadmap creation

Proceed with defaults? (enter to continue, or specify adjustments)
```

**If `--full` or `--auto`:** skip this prompt, proceed with defaults.

Otherwise, wait for user confirmation. If the user adjusts options, apply their choices to the remaining steps.

#### Step 4: Generate Files

Using the discovery results, generate guidance files:

##### 4a. CLAUDE.md

Write the CLAUDE.md content produced by project-guidance-agent. If the user chose `merge`, the agent has already incorporated existing content.

- Verify line count is under 200 (warn if over)
- Verify no fabricated code references (all paths/symbols mentioned must exist)

##### 4b. CONTEXT.md

Synthesize a CONTEXT.md from all 3 agents' output:

```markdown
# Project Context

## Tech Stack
{language, framework, database, key dependencies -- from project-guidance-agent}

## Architecture
{pattern description, layer organization -- from project-guidance-agent}

## API Surface
{summary of internal endpoints and external integrations -- from api-explorer}

## Locked Decisions
{any decisions detected from existing docs, ADRs, or code comments -- from docs-auditor}

## Known Constraints
{performance requirements, compliance needs, deployment targets -- inferred from codebase}

## Documentation Gaps
{what's missing -- from docs-auditor}
```

##### 4c. Additional Formats (if --format includes them)

- `agents` format: Write AGENTS.md (tool-agnostic guidance)
- `cursor` format: Write .cursorrules or .cursor/rules/*.mdc
- `all`: Write all of the above

#### Step 4.5: Generate Wiki

**Skip this step if `--no-wiki` was passed.**

1. Check if `.loom/wiki/` already exists:
   - If exists and `--force` was NOT passed: warn "Wiki already exists. Overwrite? (yes / skip / merge)"
   - `merge` = preserve existing pages, add new ones from discovery
   - `skip` = don't regenerate wiki, continue with other files
   - If exists and `--force` was passed: overwrite

2. Create wiki directory structure:
   ```
   mkdir -p .loom/wiki/pages
   ```

3. Initialize wiki state files (empty index.toon, log.toon, execution-log.toon) following the initialization rules in `wiki-conventions.md`.

4. Spawn wiki-ingest-agent with discovery results from Step 2:
   ```
   subagent_type: "general-purpose"
   ```
   Prompt: "Read your instructions from `~/.claude/agents/wiki-ingest-agent.md` first." Then provide:
   - Ingest mode: `full`
   - Source data: combined output from project-guidance-agent, api-explorer, and docs-auditor
   - Tech stack hints from manifest files
   - Wiki path: `.loom/wiki`

   The ingest agent produces:
   - One page per major component (based on directory structure and exports)
   - `api-surface-*` pages per API endpoint group (from api-explorer)
   - `convention-*` pages for detected project conventions (from project-guidance-agent)
   - `tech-debt-*` pages for each tech debt item (from docs-auditor)
   - `decision-*` pages for any locked decisions detected (from docs-auditor)

5. Spawn wiki-lint-agent for initial health check:
   ```
   subagent_type: "general-purpose"
   ```
   Prompt: "Read your instructions from `~/.claude/agents/wiki-lint-agent.md` first." Then provide:
   - Check scope: `wiki`
   - Fix mode: `fix` (auto-fix any orphaned entries or count drift from the initial ingest)
   - Wiki path: `.loom/wiki`

#### Step 5: Summary and Next Steps

Display what was created:

```
## Onboarding Complete

Files created:
  CLAUDE.md     -- 94 lines (project guidance for Claude Code)
  CONTEXT.md    -- 67 lines (project context and locked decisions)
  .loom/wiki/   -- {N} pages ({breakdown by category})

Discovery:
  Tech stack:     TypeScript, Next.js, Prisma, PostgreSQL
  API endpoints:  14 internal, 3 external integrations
  Doc status:     README current, API docs missing, 0 ADRs
  Conventions:    8 detected, 8 included in CLAUDE.md

Wiki:
  Pages created:    {N}
  Categories:       component({n}), concept({n}), decision({n}), convention({n}), api-surface({n}), tech-debt({n})
  Cross-references: {K}
  Lint result:      {blocking} blocking, {warning} warnings, {info} info

Next steps:
  /loom-roadmap init --brownfield       Create a roadmap informed by this analysis
  /loom-roadmap init --brownfield --from "description"   Create with a specific goal
  /loom-note "your observation"        Start capturing notes for the roadmap
  /loom-wiki ingest --source <path>    Add more sources to the wiki
  /loom-wiki lint --wiki               Run wiki health checks
```

**If `--full`:** skip displaying next steps and immediately proceed:

1. If `--from` was provided:
   ```
   Chaining into roadmap creation...
   ```
   Invoke `/loom-roadmap init --brownfield --from "{description}"` logic (read the loom-roadmap.md instructions and execute the `init --brownfield` path).

2. If no `--from`:
   Ask the user: "What do you want to build? Provide a brief description for the roadmap, or press enter to start an interactive discussion."
   Then invoke `/loom-roadmap init --brownfield --from "{user's answer}"` or `/loom-roadmap init --brownfield` (discussion mode).

#### Step 6: Save State

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

   wikiGenerated: true
   wikiPageCount: {N}
   wikiPath: .loom/wiki
   wikiCrossRefs: {K}
   ```

2. This file is read by `/loom-roadmap init --brownfield` to avoid re-running discovery.

### Error Handling

- **Agent fails**: Log which agent failed, continue with others. Note the gap in the report. If project-guidance-agent fails, CLAUDE.md cannot be generated -- warn and offer to retry.
- **No manifest files found**: Warn that tech stack detection may be incomplete. Continue -- the agents can still analyze code directly.
- **Empty codebase**: If no source files are found, suggest using greenfield mode: `/loom-roadmap init --from "description"` instead.
- **Write permission denied**: Report the target path and error. Do not update init-report for that file.

### Status Line Updates

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

---

## Subcommand: auto

You are a meta-orchestrator that drives the full software lifecycle autonomously: plan creation, execution, testing, code review, and fix cycles. You loop through these stages until the product works or a circuit breaker trips, then report results to the human.

**AUTONOMOUS EXECUTION: After each stage completes, immediately proceed to the next stage. Do not wait for user input between stages. Do not display intermediate results and stop. The quality-gate Stop hook will prevent premature completion -- trust the loop. Only stop when `currentStage` reaches `complete`, `escalated`, or a `--stop-after` boundary.**

### Arguments

Parse arguments after `auto`:
- `--from "description"`: create a plan from scratch using the description
- `--plan <path>`: start from an existing plan file (default: `PLAN.md`)
- `--roadmap <path>`: path to roadmap file (default: `ROADMAP.md`)
- `--converge-target <path>`: deterministic target for convergence loop (enables convergence stage)
- `--converge-config <path>`: existing converge.config (skip target-parser + harness-builder setup)
- `--resume`: resume from `pipeline-state.toon`
- `--max-iterations N`: outer loop cap (default: 3)
- `--max-agents N`: agent budget cap (default: 50)
- `--dry-run`: show pipeline stages without executing
- `--stop-after <stage>`: stop after a named stage: `roadmap`, `plan`, `execute`, `converge`, `test`, `review`, `fix`

### Protocols

Before doing anything, read these protocol files:
- `~/.claude/agents/protocols/agent-result.schema.md` -- return format every agent uses
- `~/.claude/agents/protocols/state.schema.md` -- execution state structure
- `~/.claude/agents/protocols/execution-conventions.md` -- shared rules, directory structure, context compression
- `~/.claude/agents/protocols/validation-rules.md` -- plan validation, blocker gates
- `~/.claude/agents/protocols/pipeline-state.schema.md` -- pipeline-state.toon schema for this orchestrator
- `~/.claude/agents/protocols/agent-monitoring.schema.md` -- progress reporting and stale detection

If convergence is enabled, also read:
- Convergence logic is embedded in this orchestrator (see Subcommand: converge below)
- `~/.claude/agents/convergence-driver.md` -- iteration loop, circuit breakers, state tracking
- `~/.claude/agents/target-parser.md` -- target normalization
- `~/.claude/agents/harness-builder.md` -- comparison infrastructure

### Instructions

#### Step 0: Initialize

1. Parse `$ARGUMENTS` into local variables:
   - `description` from `--from`
   - `roadmapFile` from `--roadmap` (default: `ROADMAP.md`)
   - `planFile` from `--plan` (default: `PLAN.md`)
   - `convergeTarget` from `--converge-target` (default: null)
   - `convergeConfig` from `--converge-config` (default: null)
   - `resumeMode` from `--resume`
   - `maxIterations` from `--max-iterations` (default: 3)
   - `maxAgents` from `--max-agents` (default: 50)
   - `dryRun` from `--dry-run`
   - `stopAfter` from `--stop-after`
   - `convergenceEnabled` = true if `convergeTarget` or `convergeConfig` is set

2. **If `--resume`:** jump to the Resume Logic section below.

3. **If `--dry-run`:** display the pipeline stages and stop:
   ```
   ## Pipeline Stages (dry run)

   1. Roadmap Creation  -- loom-roadmap init --auto
   2. Roadmap Review    -- loom-roadmap review
   3. Roadmap Integrate -- loom-roadmap review-integrate --roadmap
   4. Roadmap Approve   -- loom-roadmap approve (auto)
   5. Plan Creation     -- loom-plan create --auto
   6. Plan Review       -- loom-plan review
   7. Plan Integrate    -- loom-roadmap review-integrate
   8. Plan Validate     -- validation stages 1-4 (+ Stage 7 for v2)
   9. Execution         -- loom-plan execute --auto
   10. Convergence      -- loom converge (if --converge-target or --converge-config)
   11. Test             -- loom-plan test --run --parallel --auto
   12. Code Review      -- loom-code review --branch
   13. Quality Gate     -- automated decision matrix
   14. Fix Cycle        -- loom-code fix --auto (up to 2 cycles)

   Convergence: {convergeTarget or convergeConfig or 'disabled'}
   Outer loop: up to {maxIterations} iterations
   Agent budget: {maxAgents}
   ```
   Stop here.

4. Create or verify `.plan-execution/` directory structure.

5. **Install enforcement hooks.** If `.claude/settings.json` doesn't exist in the project, create it with Loom's deterministic hooks (file-ownership, contract-lock, budget-tracker, quality-gate, status-updater, typecheck-on-write). The hooks live in `~/Projects/meta-orchestration/hooks/` and are registered via:

   ```bash
   mkdir -p .claude && cat > .claude/settings.json << 'EOF'
   {
     "hooks": {
       "PreToolUse": [
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/file-ownership.ts", "timeout": 5000}]},
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/contract-lock.ts", "timeout": 5000}]},
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/wiki-write-guard.ts", "timeout": 5000}]},
         {"matcher": "Agent", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]}
       ],
       "PostToolUse": [
         {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/typecheck-on-write.ts", "timeout": 30000}]}
       ],
       "SubagentStop": [
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/budget-tracker.ts", "timeout": 5000}]},
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/status-updater.ts", "timeout": 5000}]}
       ],
       "Stop": [
         {"matcher": "", "hooks": [{"type": "command", "command": "bunx tsx ~/Projects/meta-orchestration/hooks/quality-gate.ts", "timeout": 5000}]}
       ]
     }
   }
   EOF
   ```

   If `.claude/settings.json` already exists, merge the `hooks` key. The hooks fail open -- no `.plan-execution/` means exit 0 immediately.

6. Initialize `pipeline-state.toon`:
   ```toon
   schemaVersion: 1
   runId: {generate uuid}
   mode: auto
   description: "{description or 'Existing plan: ' + planFile}"
   roadmapFile: {roadmapFile}
   planFile: {planFile}
   outerIteration: 1
   maxIterations: {maxIterations}
   agentsSpawned: 0
   maxAgents: {maxAgents}
   fixCycleCount: 0
   convergenceEnabled: {convergenceEnabled}
   convergeTarget: {convergeTarget or ""}
   convergeConfig: {convergeConfig or ""}
   currentStage: roadmap-create

   stageHistory[0]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:

   failureLog[0]{iteration,stage,error,resolution}:
   ```

7. Update status line and proceed to Step 1.

#### Step 1: Roadmap Creation (Phase R)

**If `outerIteration == 1` AND no existing roadmap file (or `--from` provided):**

1a. **Create roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a roadmap using --init --from '{description}' --auto.
    Write the result to {roadmapFile}."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: roadmap-create`.

1b. **Review roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Review the roadmap at {roadmapFile}. Save findings to .plan-history/reviews/."
   ```
   Record agents spawned. Update `currentStage: roadmap-review`.

1c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate --roadmap to apply review findings to {roadmapFile}."
   ```
   Record agents spawned. Update `currentStage: roadmap-integrate`.

1d. **Validate roadmap.** Run roadmap validation stages 1-4 (from `validation-rules.md` Section 7):
   - Stage 1: Structure
   - Stage 2: Feature completeness
   - Stage 3: Milestone ordering
   - Stage 4: Data model coverage

   If validation fails after integration: **ESCALATE** -- review recommendations broke the roadmap.

   If validation passes: auto-approve roadmap (set status to `approved` in frontmatter). Update `currentStage: roadmap-approve`.

**If `outerIteration > 1` AND roadmap revision needed (REVISE-ROADMAP from quality gate):**

1a-alt. **Revise roadmap.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine --roadmap on {roadmapFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - Root cause: {rootCauseAnalysis}
    Only modify features/milestones related to the failure."
   ```
   Then run steps 1b-1d as above.

**If `--stop-after roadmap`:** display roadmap summary and stop.

Check circuit breakers before proceeding.

#### Step 2: Plan Creation (Phase A)

**If `outerIteration == 1` AND no existing plan file (or `--from` provided):**

2a. **Create plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Create a plan using --init --plan --from '{description}' --auto.
    Write the result to {planFile}."
   ```
   Record agents spawned. Update `pipeline-state.toon`: `currentStage: plan-create`.

2b. **Review plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-plan.md first.
    Review the plan at {planFile}. Save findings to .plan-history/reviews/."
   ```
   Record agents spawned. Update `currentStage: plan-review`.

2c. **Integrate review findings.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --review-integrate to apply review findings to {planFile}."
   ```
   Record agents spawned. Update `currentStage: plan-integrate`.

2d. **Validate.** Run plan validation stages 1-4 (from `validation-rules.md`):
   - Stage 1: Structure
   - Stage 2: Dependencies (cycle detection)
   - Stage 3: Ownership (no same-wave overlaps)
   - Stage 4: Sizing (deliverable and criteria counts)

   If validation fails after integration: **ESCALATE** -- review recommendations broke the plan. Write escalation report and stop.

   If validation passes: update `currentStage: plan-validate`, proceed.

**If `outerIteration > 1` (plan revision after failure):**

2a-alt. **Revise plan.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-roadmap.md first.
    Run --refine on {planFile}.
    Failure context from prior iteration:
    - Failed stage: {failedStage}
    - Error: {errorSummary}
    - What was tried: {priorAttemptSummary}
    Lock completed phases. Only edit pending/failed phases."
   ```
   Then run steps 2b-2d as above.

**If `--stop-after plan`:** display plan summary and stop.

Check circuit breakers before proceeding.

#### Step 3: Execution (Phase B)

Update `pipeline-state.toon`: `currentStage: execute`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-execute-plan.md first.
 Execute {planFile} with --auto flag.
 Report all AgentResults. Track agents spawned."
```

Record agents spawned (add to `agentsSpawned`).

On completion, read `.plan-execution/state.toon`:
- If status == `completed`: proceed to Step 4.
- If status == `failed` or `paused`:
  - Record failure context in `pipeline-state.toon` failureLog.
  - Increment `outerIteration`.
  - Check circuit breakers. If clear, go to Step 2 (Phase A with `--refine`).

Log stage result in `stageHistory`.

**If `--stop-after execute`:** display execution summary and stop.

Check circuit breakers before proceeding.

#### Step 3.25: Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent to update the wiki with execution results:

```
subagent_type: "general-purpose"
```
Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `wave-complete`
- Event data: all wave summaries from `.plan-execution/`
- Wiki path: `.loom/wiki`

**This step is non-blocking.** If wiki-maintainer-agent fails: (1) Record the failure in `.plan-execution/pipeline-state.toon` under `wikiUpdateStatus: failed` with the error summary, (2) Increment a `wikiConsecutiveFailures` counter in pipeline-state.toon, (3) If `wikiConsecutiveFailures >= 2`, add a visible note to the execution summary: "Wiki updates have failed for {N} consecutive waves. Run `/loom-wiki lint --wiki` to diagnose." (4) Continue to the next step. Wiki maintenance never gates the pipeline.

Record agents spawned. Do NOT count wiki maintenance against circuit breaker thresholds.

#### Step 3.5: Convergence (Phase B2) -- conditional

**Skip this step entirely if `convergenceEnabled == false`.**

This step verifies implementation output matches deterministic targets using the convergence loop. It has two sub-phases: **setup** (requirements alignment) and **loop** (iterative convergence).

Update `pipeline-state.toon`: `currentStage: converge`.

##### Auto-detection

If `convergeTarget` and `convergeConfig` are both null, check:
1. Read `PLAN.md` -- look for convergence-related metadata: `convergenceTarget:`, `goldenFiles:`, or a phase with `pattern: converge`
2. Check `.plan-execution/converge.config` -- if it exists from a prior run, use it
3. Check `.plan-execution/convergence/targets/` -- if target files exist, auto-enable convergence

If any of these are found, set `convergenceEnabled = true` and populate `convergeTarget` or `convergeConfig` accordingly.

##### 3.5a: Convergence Requirements Discussion (MANDATORY -- even in --auto)

**This step requires human alignment.** Convergence parameters define what "done" means -- the pipeline must not guess.

If `convergeConfig` is provided (user already has a config), skip to 3.5c.

Present a structured requirements discussion:

```
## Convergence Setup

Before running the convergence loop, we need to align on what to verify and how.

### 1. What outputs are we verifying?
{Analyze the plan and executed code to propose outputs. Examples:}
- API responses (e.g., GET /api/users returns expected JSON shape)
- Generated files (e.g., config output matches golden template)
- CLI output (e.g., build script produces expected stdout)
- UI rendering (e.g., page screenshot matches design comp)

### 2. How do we capture actual output?
{Propose capture mechanism per output:}
- HTTP requests to running dev server
- Script execution and stdout capture
- File read from output directory
- Browser screenshot via Playwright

### 3. Comparison method per target
| Target | Method | Rationale |
|--------|--------|-----------|
| GET /api/users | json-deep-equal | Structured data, exact match needed |
| App config | json-deep-equal | Config must be identical |
| README output | text-diff | Line-by-line text comparison |

### 4. Tolerances and ignore rules
| Target | Tolerance | Ignored Fields | Rationale |
|--------|-----------|----------------|-----------|
| GET /api/users | 1.0 (exact) | timestamp, requestId | These are runtime-generated |
| UI screenshot | 0.95 | -- | Allow minor anti-aliasing differences |

### 5. Golden targets
{Where do the baseline "correct" outputs come from?}
- Provided by user at: {--converge-target path}
- Generated from reference implementation
- Extracted from spec/plan

Does this look right? Adjust any targets, methods, tolerances, or capture mechanisms before we proceed.
```

Wait for the user to confirm or adjust. Iterate until they approve.

##### 3.5b: Build Convergence Infrastructure

Once requirements are confirmed, spawn agents to set up the harness:

1. **Parse targets.** Spawn target-parser agent:
   ```
   "Read your instructions from ~/.claude/agents/target-parser.md first.
    Parse targets from: {convergeTarget}
    Apply the user-confirmed comparison methods and tolerances.
    Write manifest to: .plan-execution/target-manifest.toon"
   ```

2. **Build harness.** Spawn harness-builder agent:
   ```
   "Read your instructions from ~/.claude/agents/harness-builder.md first.
    Build harness from manifest: .plan-execution/target-manifest.toon
    User-confirmed tolerances: {from discussion}
    User-confirmed ignore rules: {from discussion}
    Write config to: .plan-execution/converge.config"
   ```

3. Display the resulting `converge.config` for final confirmation. This is the last chance to adjust before the loop starts.

##### 3.5c: Run Convergence Loop

Spawn a general-purpose agent:
```
"Convergence logic is inline in this orchestrator. Use the converge subcommand instructions.
 Run the convergence loop with the following parameters:
 {if convergeConfig: '--config ' + convergeConfig}
 {if not convergeConfig: '--config .plan-execution/converge.config'}
 Max iterations: 10
 This is running as part of /loom auto -- write convergence-summary.toon when done."
```

Record agents spawned. Log stage in `stageHistory`.

##### 3.5d: Evaluate Convergence Result

Read `.plan-execution/convergence-summary.toon`:

| Status | Action |
|--------|--------|
| `converged` | Proceed to Step 4 (Test). All targets match. |
| `stalled` | Record in failureLog. Go to quality gate with convergence failure context. |
| `regression` | Record in failureLog. Go to quality gate with convergence failure context. |
| `budget_exhausted` | Record in failureLog. Go to quality gate with convergence failure context. |
| `max_iterations` | Record in failureLog. Go to quality gate with convergence failure context. |

If convergence-summary.toon is missing: warn and continue to Step 4 (convergence is additive, not blocking).

**If `--stop-after converge`:** display convergence summary and stop.

Check circuit breakers before proceeding.

#### Step 4: Test (Phase C)

Update `pipeline-state.toon`: `currentStage: test`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-test-plan.md first.
 Run tests with --run --parallel --auto flags.
 Report test results: passed count, failed count, pass rate."
```

Record agents spawned. Log stage in `stageHistory`.

**If `--stop-after test`:** display test results and stop.

#### Step 5: Code Review

Update `pipeline-state.toon`: `currentStage: review-code`.

Spawn a general-purpose agent:
```
"Read your instructions from ~/.claude/commands/loom-review-code.md first.
 Review the current branch. Write findings to .plan-execution/review-report.md."
```

Record agents spawned. Log stage in `stageHistory`.

**If `--stop-after review`:** display review summary and stop.

Proceed to the Pipeline Quality Gate.

#### Step 6: Pipeline Quality Gate

Parse the outputs from Steps 3.5, 4, and 5:

```
criticalCount    = count of findings where severity == "critical" in review-report.md
warningCount     = count of findings where severity == "warning" in review-report.md
testsPassed      = passed test count from Step 4
testsFailed      = failed test count from Step 4
testPassRate     = testsPassed / (testsPassed + testsFailed)
typecheckPass    = run project typecheck, read exit code (true if 0)
convergeStatus   = status from convergence-summary.toon (or "converged" if convergence disabled)
convergePassing  = targetsPassing from convergence-summary.toon (or 0)
convergeTotal    = targetsTotal from convergence-summary.toon (or 0)
```

Apply the decision matrix:

| Condition | Action |
|-----------|--------|
| `criticalCount == 0` AND `testPassRate == 100%` AND `typecheckPass == true` AND `convergeStatus == "converged"` | **PROCEED** (done) |
| `convergeStatus` is `stalled` or `regression` or `budget_exhausted` or `max_iterations` | **FIX-AND-RECONVERGE** (if fixCycleCount < 2) else **REVISE-PLAN** |
| `criticalCount <= 3` AND `testPassRate >= 80%` AND `fixCycleCount < 2` | **FIX-AND-RECHECK** |
| `criticalCount > 3` OR `testPassRate < 80%` OR systemic typecheck failures | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `fixCycleCount >= 2` (already tried fixing twice) | **REVISE-PLAN** (if iterations remain) else **ESCALATE** |
| `outerIteration > 1` AND same structural failure pattern across iterations | **REVISE-ROADMAP** (if iterations remain) else **ESCALATE** |

**On PROCEED:** go to Step 8 (Completion).

**On FIX-AND-RECONVERGE:** go to Step 7 (Fix Cycle) with `reconverge = true`. After fixes are applied, re-run convergence (Step 3.5) before re-checking the quality gate.

**On FIX-AND-RECHECK:** go to Step 7 (Fix Cycle).

**On REVISE-PLAN:**
1. Build failure context: remaining critical findings, failing tests, typecheck errors, what fix cycles attempted.
2. Increment `outerIteration`.
3. Check circuit breakers. If clear, go to Step 2 (Phase A with `--refine`).

**On REVISE-ROADMAP:**
1. Build failure context including root cause analysis indicating the problem is at the roadmap/scope level.
2. Increment `outerIteration`.
3. Check circuit breakers. If clear, go to Step 1 (Phase R with `--refine`).

**On ESCALATE:** go to Step 8 (Escalation report).

#### Step 7: Fix Cycle

Increment `fixCycleCount`. Update `pipeline-state.toon`: `currentStage: fix-code`.

7a. **Apply fixes.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-fix-code.md first.
    Run with --auto --severity critical,warning flags.
    Apply fixes from .plan-execution/review-report.md."
   ```
   Record agents spawned.

7b. **Convergence detection.** Compare before/after:
   - Did `criticalCount` decrease? (progress)
   - Did `testPassRate` increase? (progress)
   - Are the SAME findings still present (same tag:file:line)? (stuck)

   If stuck (same findings, same failures after fix cycle):
   - Skip directly to REVISE-PLAN. The failure is structural.
   - Do not burn another fix cycle.

7c. **Re-run quick review.** Spawn a general-purpose agent:
   ```
   "Read your instructions from ~/.claude/commands/loom-review-code.md first.
    Run a quick review (code style + security only).
    Write updated findings to .plan-execution/review-report.md."
   ```

7d. **Re-run verification.** Run typecheck + existing tests.

7e. **Re-run convergence (if `reconverge == true`).** Return to Step 3.5 to re-run the convergence loop. The convergence-driver will resume from the existing `convergence-state.toon`, re-running the harness against the now-fixed code.

7f. **Return to Step 6** (Pipeline Quality Gate) with updated results.

Log stage in `stageHistory`.

**If `--stop-after fix`:** display fix results and stop.

#### Step 8: Completion

**On success (PROCEED from quality gate):**

Update `pipeline-state.toon`: `currentStage: complete`.

Display completion report:
```
## Pipeline Complete

Run ID: {runId}
Description: {description}
Outer iterations: {outerIteration}
Fix cycles: {fixCycleCount}
Agents spawned: {agentsSpawned} / {maxAgents}

### Stage Summary
| Stage | Status | Iteration | Agents | Gate |
|-------|--------|-----------|--------|------|
{stageHistory rows}

### Quality Metrics
- Critical findings: 0
- Test pass rate: 100%
- Typecheck: PASS

### Wiki Updates
- Status: {SUCCESS | FAILED | SKIPPED}
- Pages created: {N}
- Pages updated: {M}
- Execution log entries: {K}
- Consecutive failures: {wikiConsecutiveFailures or 0}

All acceptance criteria satisfied. Code is ready for human review.
```

**On escalation (circuit breaker tripped or ESCALATE from gate):**

Update `pipeline-state.toon`: `currentStage: escalated`.

Write `.plan-execution/escalation-report.md`:
```markdown
## Escalation Report

### What Worked
{list of succeeded stages with iteration numbers}

### What Failed
{failed stage, error details, what was tried}

### Iteration History
{stageHistory formatted as timeline}

### Circuit Breaker
{which breaker tripped and why}

### Recommended Action
{contextual suggestion: manual fix, plan redesign, scope reduction}

### Resume Command
Run `/loom auto --resume` after addressing the above.
```

Display the escalation report to the user.

### Circuit Breakers

Check these conditions before every stage transition. If any triggers, go to Step 8 (Escalation).

| Breaker | Condition | Reason |
|---------|-----------|--------|
| **Iteration limit** | `outerIteration > maxIterations` | Prevents infinite plan revision |
| **Agent budget** | `agentsSpawned > maxAgents` | Cost control |
| **Identical failure** | Same verification error string in failureLog across two consecutive iterations | Revision did not help -- human insight needed |
| **Fix stall** | Same review findings (tag:file:line match) after 2 fix cycles | loom-code fix cannot resolve it |
| **Wave deadlock** | A wave failed 2x AND plan revision did not change that wave's phases | Structural issue in plan decomposition |
| **Validation failure** | Plan fails validation stages 1-4 after `--review-integrate` | Review recommendations broke the plan |

When a breaker trips:
1. Record the breaker name and condition in `pipeline-state.toon` failureLog.
2. Set `currentStage: escalated`.
3. Write the escalation report.
4. Stop execution.

### Resume Logic

When `--resume` is passed:

1. Read `pipeline-state.toon` from `.plan-execution/`.
2. If file does not exist: "No pipeline state found. Use `--from` to start a new run." Stop.
3. If `currentStage == complete`: "Pipeline already completed. Nothing to resume." Stop.
4. If `currentStage == escalated`: display the escalation report and ask the human what to do.

5. Re-enter the loop at the correct point:

   | `currentStage` value | Re-entry point |
   |----------------------|----------------|
   | `roadmap-create` | Step 1, sub-step 1a |
   | `roadmap-review` | Step 1, sub-step 1b |
   | `roadmap-integrate` | Step 1, sub-step 1c |
   | `roadmap-approve` | Step 1, sub-step 1d |
   | `plan-create` | Step 2, sub-step 1a |
   | `plan-review` | Step 2, sub-step 1b |
   | `plan-integrate` | Step 2, sub-step 1c |
   | `plan-validate` | Step 2, sub-step 1d |
   | `execute` | Step 3 (pass `--resume` to loom-plan execute) |
   | `converge` | Step 3.5 (pass `--resume` to loom converge) |
   | `test` | Step 4 |
   | `review-code` | Step 5 |
   | `fix-code` | Step 7 |

6. Restore all state variables from `pipeline-state.toon`: `outerIteration`, `agentsSpawned`, `fixCycleCount`, `maxIterations`, `maxAgents`.
7. Continue the loop from the re-entry point.

### Error Handling

- **Agent failure (timeout or crash):** Record in failureLog. If the stage is retryable (plan-create, execute), retry once with error context. If retry also fails, escalate.
- **Missing protocol files:** Warn and continue with defaults. Do not block the pipeline on missing docs.
- **Disk write failure:** If `pipeline-state.toon` cannot be written, warn the user that resume will not work. Continue execution.
- **Plan file missing:** If `planFile` does not exist and no `--from` provided, tell the user: "No plan found. Use `--from 'description'` to create one, or `--plan path` to specify an existing plan." Stop.
- **Unexpected state in pipeline-state.toon:** If `currentStage` is not a recognized value, treat as corrupted. Offer to reinitialize or abort.

### Status Line Updates

Write `.plan-execution/status.toon` per `execution-conventions.md` section "Orchestration Status". Include these additional fields for pipeline tracking:

```toon
command: loom-auto
stage: {currentStage}
stageName: {human-readable stage name}
roadmapFile: {roadmapFile}
outerIteration: {outerIteration}
fixCycleCount: {fixCycleCount}
agentsSpawned: {agentsSpawned}
agentBudget: {maxAgents}
gateResult: {last quality gate result}
updatedAt: {ISO timestamp}
```

Update the status line at every stage transition and after every agent completes.

---

## Subcommand: converge

You are an orchestrator that drives a deterministic convergence loop -- comparing current implementation output against a known-good target and iterating until the delta reaches zero or a circuit breaker fires.

### Arguments

Parse arguments after `converge`:
- `--target <path>` -- path to the deterministic source (required on first run)
- `--config <path>` -- path to an existing converge.config (skip target-parser and harness-builder)
- `--max-iterations N` -- override max iterations (default: 10)
- `--tolerance <threshold>` -- global tolerance override (0.0-1.0)
- `--dry-run` -- run target-parser and harness-builder, show manifest and config, stop before iteration loop
- `--resume` -- resume from `.plan-execution/convergence-state.toon`
- `--status` -- show current convergence state without running anything
- No args: show usage help

### Instructions

#### Step 0: Read Protocols

Read convergence-related protocols:
- `~/.claude/agents/protocols/orchestration-patterns.md` (Pattern 5: Converge)
- `~/.claude/agents/protocols/pattern-executor.md` (Converge execution)

#### Step 1: Handle Special Flags

**If no args provided:** display usage help and stop:
```
## Usage: /loom converge

Drive a deterministic convergence loop -- compare implementation output
against a known-good target, iterate until the delta reaches zero.

  --target <path>         Path to deterministic source (required on first run)
  --config <path>         Path to existing converge.config (skip setup)
  --max-iterations N      Override max iterations (default: 10)
  --tolerance <threshold> Global tolerance override (0.0-1.0)
  --dry-run               Run setup only, show manifest and config, stop
  --resume                Resume from .plan-execution/convergence-state.toon
  --status                Show current convergence state without running

Examples:
  /loom converge --target tests/golden/api-responses.json
  /loom converge --config .plan-execution/converge.config --max-iterations 5
  /loom converge --resume
  /loom converge --status
```

**If `--status`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` to start a new run." Stop.
3. Display current state:
   - Current iteration and max iterations
   - Passing and failing target counts
   - Convergence rate (improvement percentage from last iteration)
   - Iteration history with per-iteration passing counts
   - Circuit breaker status
4. Suggest next action based on state:
   - If `status == converged`: "Convergence complete. No action needed."
   - If `status == running` or `status == paused`: "Run `/loom converge --resume` to continue."
   - If `status == stalled` or `status == regression`: "Review stuck deltas below. Manual intervention may be needed before `--resume`."
   - If `status == budget_exhausted`: "Increase agent budget in orchestration.toml and `--resume`."
5. Stop.

**If `--resume`:**
1. Read `.plan-execution/convergence-state.toon`.
2. If file does not exist: "No convergence state found. Use `--target` to start a new run." Stop.
3. Validate the state file has required fields: `iteration`, `maxIterations`, `configPath`, `targetManifestPath`.
4. If `status == converged`: "Convergence already complete. Nothing to resume." Stop.
5. If `status == regression` or `status == stalled`: warn the user about the prior failure, ask if they want to continue anyway.
6. Restore state variables from the file.
7. Jump to Step 5 (Convergence Loop) at the saved iteration.

**If `--dry-run`:** proceed through Steps 2-4 normally; Step 4 will stop execution.

**If neither `--target` nor `--config` nor `--resume` provided:** show usage help and stop.

#### Step 2: Parse Targets (skip if --config provided)

1. Validate that the `--target` path exists. If not: "Target path `{path}` does not exist. Check the path and try again." Stop.

2. Spawn target-parser agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/target-parser.md` first.

    Parse deterministic targets from: {--target path}
    Source type hint: {if user provided one, otherwise omit}
    Write target manifest to: .plan-execution/target-manifest.toon"
   ```

3. If target-parser fails: "Target parsing failed: {error}. Cannot converge without targets." Stop.

4. Read the target manifest from `.plan-execution/target-manifest.toon`.

5. Display manifest summary:
   ```
   ## Target Manifest

   Source: {--target path}
   Source type: {detected type, e.g. API snapshot, screenshot, test fixture}
   Targets: {N} artifacts
   Comparison methods: {list of methods, e.g. json-deep-equal, pixel-diff, text-exact}
   ```

#### Step 3: Build Harness (skip if --config provided)

1. Gather project context:
   - Read `package.json` (or equivalent) for tech stack
   - Read `orchestration.toml` if it exists for tolerance overrides
   - Note any `--tolerance` override from arguments

2. Spawn harness-builder agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/harness-builder.md` first.

    Build a convergence harness for the following targets:
    Target manifest: .plan-execution/target-manifest.toon
    Project tech stack: {summary from package.json}
    Tolerance overrides: {from --tolerance or orchestration.toml, if any}

    Write outputs to:
    - .plan-execution/converge.config
    - .plan-execution/harness/ (comparison scripts and runner)"
   ```

3. If harness-builder fails: "Harness build failed: {error}. Cannot converge without a comparison harness." Stop.

4. Read the harness config from `.plan-execution/converge.config`.

5. Display harness summary:
   ```
   ## Harness Configuration

   Comparison methods: {list with per-method details}
   Tolerance thresholds: {per-method thresholds}
   Runner: .plan-execution/harness/runner.sh
   Config: .plan-execution/converge.config
   ```

#### Step 4: Convergence Requirements Review

Present the full convergence configuration for human alignment. This is MANDATORY -- convergence parameters define what "done" means.

Display per-target details from the parsed manifest and built harness:

```
## Convergence Configuration Review

### Targets ({N} artifacts)

| # | Target | Source | Comparison | Tolerance | Capture Method |
|---|--------|--------|------------|-----------|----------------|
| 1 | GET /api/users | api-users.json | json-deep-equal | 1.00 | HTTP GET to dev server |
| 2 | Login page | login.png | pixel-diff | 0.95 | Playwright screenshot |
| 3 | App config | config.json | json-deep-equal | 1.00 | File read |

### Per-Target Options

**GET /api/users:**
- Ignored fields: timestamp, requestId (runtime-generated)
- Numeric tolerance: 0.001

**Login page:**
- Viewport: 1280x720 @ 2x density
- Anti-aliasing threshold: 5px

### Budget

- Max iterations: {N}
- Agent budget: {N} fixer agents
- Estimated worst-case: {N targets x maxIterations} agent invocations

### Golden Targets

Source: {--target path}
Stored in: .plan-execution/convergence/targets/

Verify the following are correct before proceeding:
1. Are these the right outputs to test?
2. Are the comparison methods appropriate per target?
3. Are the tolerances right? (1.0 = exact match, lower = fuzzy)
4. Are the right fields being ignored?
5. Is the capture method correct for each target?

Proceed? (yes / adjust / abort)
```

If `--dry-run`: display this summary and stop. Do not proceed to the convergence loop.

Wait for user response:
- **yes**: proceed to Step 5.
- **adjust**: ask which targets/methods/tolerances to change. Update `.plan-execution/converge.config` accordingly and re-display.
- **abort**: stop.

#### Step 5: Convergence Loop

1. Read agent budget from `orchestration.toml` field `settings.maxParallelAgents` (default: 30).

2. Spawn convergence-driver agent (general-purpose):
   ```
   "Read your instructions from `~/.claude/agents/convergence-driver.md` first.

    Run the convergence loop with the following parameters:
    Config: {converge.config path}
    Harness runner: .plan-execution/harness/runner.sh
    Target manifest: .plan-execution/target-manifest.toon
    Max iterations: {--max-iterations or 10}
    Tolerance thresholds: {from converge.config}
    Agent budget: {from orchestration.toml or 30}
    Resume at iteration: {iteration number, 1 if fresh start}"
   ```

3. The convergence-driver handles the full iteration loop internally, spawning delta-analyzer and fixer agents as needed.

4. Monitor progress by reading `.plan-execution/convergence-state.toon` periodically. Display progress updates:
   ```
   === Convergence Progress ===  [iteration {i}/{max}]

     Passing: {n}/{total} targets  ({pct}%)
     Failing: {f}/{total} targets
     Rate:    {rate}% improvement from last iteration
     Agents:  {used}/{budget} budget used

     History:
       Iter 1: {n1}/{total} passing  (rate: --)
       Iter 2: {n2}/{total} passing  (rate: {r2}%)
       Iter 3: {n3}/{total} passing  (rate: {r3}%)
   ```

5. Update `.plan-execution/status.toon` at each progress check.

#### Step 6: Report Results

When the convergence-driver completes, read the final `.plan-execution/convergence-state.toon` and display the convergence report:

```markdown
## Convergence Report

**Status:** {converged | stalled | regression | budget_exhausted | max_iterations}
**Iterations:** {N} of {max}
**Targets:** {passing}/{total} passing

### Target Results
| Target | Method | Score | Threshold | Status |
|--------|--------|-------|-----------|--------|
| GET /api/users | json-deep-equal | 1.00 | 1.00 | pass |
| Login page | pixel-diff | 0.94 | 0.95 | fail |

### Stuck Deltas (if any)
- {target}: {why it's stuck -- e.g. "score plateaued at 0.94 for 3 iterations"}

### Agent Usage
- Total agents spawned: {N}
- Budget remaining: {budget - N}

### Next Steps
{contextual recommendations based on final status:
 - converged: "All targets match within tolerance. Convergence complete."
 - stalled: "The following deltas are stuck. Review the stuck targets above and consider manual intervention, then run `/loom converge --resume`."
 - regression: "Scores regressed during iteration {N}. Review the fixer agent changes for unintended side effects."
 - budget_exhausted: "Agent budget exhausted with {failing} targets remaining. Increase budget in orchestration.toml and run `/loom converge --resume`."
 - max_iterations: "Max iterations reached with {failing} targets remaining. Consider increasing --max-iterations or reviewing stuck deltas for structural issues."}
```

#### Step 7: Save State

1. Save convergence report to `.plan-execution/convergence-report.md`.

2. If this run was triggered during a `/loom auto` pipeline (check for `.plan-execution/pipeline-state.toon`), save a summary to `.plan-execution/convergence-summary.toon` for the outer loop to read:
   ```toon
   status: {converged | stalled | regression | budget_exhausted | max_iterations}
   iterations: {N}
   maxIterations: {max}
   targetsPassing: {n}
   targetsTotal: {total}
   agentsUsed: {N}
   stuckDeltas: {count}
   completedAt: {ISO timestamp}
   ```

3. Update final `.plan-execution/status.toon`.

### Error Handling

- **No `--target` and no `--config` and not `--resume`**: show usage help and stop.
- **Target path does not exist**: "Target path `{path}` does not exist. Check the path and try again." Stop.
- **target-parser fails**: "Target parsing failed: {error}. Cannot converge without targets." Stop.
- **harness-builder fails**: "Harness build failed: {error}. Cannot converge without a comparison harness." Stop.
- **convergence-driver fails**: Save partial state to `.plan-execution/convergence-state.toon` for `--resume`. Display what completed and suggest: "Run `/loom converge --resume` to continue from iteration {N}."
- **convergence-state.toon missing on `--resume`**: "No convergence state found. Use `--target` to start a new run." Stop.
- **convergence-state.toon from a different target**: Compare `targetPath` in state with current `--target`. If they differ: "Warning: existing convergence state is for a different target (`{old}`). Continue with existing state or start fresh? (continue / fresh)" If fresh, delete old state and start from Step 2.
- **Agent failure during loop**: The convergence-driver handles internal agent failures. If the driver itself fails, save state and offer `--resume`.

### Status Line Updates

Write `.plan-execution/status.toon` at every phase transition:
```toon
command: converge
phase: {parsing-targets | building-harness | approval-gate | converging | complete}
wave: 0
totalWaves: 1
agentsRunning: {N}
agentsDone: {N}
agentsTotal: {N}
agentsFailed: 0
findings: 0
updatedAt: {ISO timestamp}
```

---

## Subcommand: quick

Zero-ceremony task execution. Describe what you need done and Loom Quick handles context gathering, implementation, verification, logging, and optional commit -- adapting its behavior based on whether a plan is active.

### Arguments

Parse arguments after `quick`:

If arguments are empty or equal `--help`, print the following help text and stop:

```
/loom quick [flags] <task description>

Execute a task with automatic context, verification, and logging.

Flags:
  --no-verify   Skip verification commands after execution
  --no-commit   Skip the auto-commit offer after execution
  --append      Force plan-aware mode (requires PLAN.md)
  --inject      Force injection mode (requires active plan execution)

Modes (auto-detected):
  standalone    No plan present. Execute, verify, log.
  plan-aware    PLAN.md exists. Choose to append as new phase or run independently.
  injection     Plan execution is running. Inject into current wave or queue for next.

Examples:
  /loom quick Add input validation to the signup form
  /loom quick --no-verify Fix the broken CSS on the dashboard
  /loom quick --append Add a caching layer to the API
  /loom quick --inject --no-commit Add retry logic to the webhook handler
```

### Instructions

#### Step 1: Flag Parsing

Parse arguments by iterating tokens left to right:

1. Any token starting with `--` is a flag. Consume it and continue.
2. The first token that does NOT start with `--` marks the beginning of the task description. All remaining tokens (including any that look like flags) become the task description.

Supported flags: `--no-verify`, `--no-commit`, `--append`, `--inject`.

If a token starts with `--` but is not in the supported list, print a warning and continue:

```
Unknown flag: {flag} (ignored)
```

If both `--append` and `--inject` are present, `--inject` takes precedence.

After parsing, if the task description is empty, print the help text and stop.

#### Step 2: Mode Detection

Detect the execution mode before any work begins.

1. Check if `PLAN.md` exists in the project root. Record as `planExists`.
2. Check if `.plan-execution/state.toon` exists. If it does, read its `status` field. Record `executionRunning` as true only if the file exists AND `status` is `in-progress`.
3. Derive mode from this table:

| `executionRunning` | `planExists` | Derived Mode |
|--------------------|--------------|--------------|
| true | true | `injection` |
| false | true | `plan-aware` |
| false | false | `standalone` |
| true | false | `standalone` (print warning: `Warning: execution state found but no PLAN.md. Running in standalone mode.`) |

4. Apply flag overrides:
   - `--inject` forces `injection` mode. Error if `.plan-execution/state.toon` does not exist or `status` is not `in-progress`: print `Cannot use --inject: no active plan execution.` and stop.
   - `--append` forces `plan-aware` mode. Error if `PLAN.md` does not exist: print `Cannot use --append: no PLAN.md found.` and stop.

5. Print the detected mode:

```
Mode: {mode}
```

#### Step 3: Execute by Mode

Route to the appropriate mode section below.

---

##### Mode: Standalone

**3a. Gather context.**

Read `CLAUDE.md` if it exists. Scan the project structure and relevant source files to understand the codebase context needed for the task.

**3b. Execute the task.**

Implement the described task. Write or modify code as needed. Stay focused on exactly what the user described -- no scope creep.

**3c. Continue to Step 4 (Post-Execution).**

---

##### Mode: Plan-Aware

**3a. Present choice to user.**

Print:

```
PLAN.md detected. How should this task relate to the plan?

  1. Append as new phase to PLAN.md, then execute
  2. Execute independently (standalone mode with plan context)
```

Wait for user selection.

**3b. If user chose "Append" (option 1):**

1. Read `PLAN.md` in full.
2. Find the last phase number and last wave number.
3. Create a new phase section in PLAN.md with:
   - Phase number: last phase + 1
   - Wave number: last wave + 1
   - Title derived from the task description
   - Auto-generated file ownership: analyze the task description for file paths, module names, and component references. Check the codebase for matching files. List the files this task will likely touch.
   - Auto-generated acceptance criteria: derive 2-4 testable criteria from the task description.
   - Dependencies: the last existing phase.
4. Record `planContext` as the path to PLAN.md.
5. Read CLAUDE.md if it exists. Scan relevant source files.
6. Execute the task.
7. Continue to Step 4.

**3c. If user chose "Independent" (option 2):**

Record `planContext` as the path to PLAN.md (for the log) but execute in standalone mode. Read CLAUDE.md, scan relevant files, execute the task, continue to Step 4.

---

##### Mode: Injection

**3a. Read execution state.**

Parse `.plan-execution/state.toon`. Extract:
- `currentWave` -- the wave number currently executing.
- `tasks` -- all tasks with their status, assigned agent, and file ownership.

**3b. Determine file ownership.**

Analyze the task description and the codebase to predict which files this task will modify:
- Parse the task description for file paths, module names, and component references.
- Check the codebase for matching files.
- Produce a candidate `filesOwned[]` list.

**3c. Check for ownership conflicts.**

Compare `filesOwned[]` against every task in the current wave that has `status: in-progress`. A conflict exists if any file in `filesOwned[]` overlaps with another in-progress task's `filesOwned[]`.

**3d. Inject or queue.**

| Conflict? | Action |
|-----------|--------|
| No | Inject into `currentWave`. Add a new task entry to `state.toon` with `status: in-progress` and `agent: quick-task`. Execute the task immediately. |
| Yes | Queue for `currentWave + 1`. Add a new task entry with `status: queued` and `targetWave: currentWave + 1`. Print: `File conflict with in-progress task "{taskId}". Queued for wave {N+1}.` Do NOT execute the task now -- it will be picked up by the plan executor in the next wave. Skip to Step 4 with `verificationResult: skipped`. |

**3e. Update state.toon.**

Write the updated state atomically: write to `.plan-execution/state.toon.tmp`, then rename to `.plan-execution/state.toon`. Include the new task with all standard task fields.

**3f. Execute (if injected, not queued).**

Read CLAUDE.md if it exists. Scan relevant files. Execute the task respecting ownership boundaries -- do NOT modify files owned by other in-progress tasks.

**3g. Post-execution state update.**

After the task completes (or fails), update `state.toon` again:
- Set the injected task's `status` to `completed` or `failed`.
- Record `filesChanged[]` in the task entry.

**3h. Continue to Step 4.**

---

#### Step 4: Post-Execution

Run this section for all modes after task execution completes.

##### 4a. Verification

If `--no-verify` was set, set `verificationResult: skipped` and skip to 4b.

Otherwise, discover verification commands using this priority:

1. **PLAN.md extraction.** If `PLAN.md` exists, look for a `## Verification Commands` section. Parse each line as a command. Skip blank lines, lines starting with `#`, and pure prose. Parse fenced code blocks line-by-line for commands.

2. **Auto-detection.** If no plan-based commands were found, probe these files:

| File | Condition | Command |
|------|-----------|---------|
| `package.json` | `scripts.typecheck` exists | `bun run typecheck` |
| `package.json` | `scripts.test` exists | `bun run test` |
| `package.json` | `scripts.lint` exists | `bun run lint` |
| `tsconfig.json` | File exists (and no `scripts.typecheck`) | `bunx tsc --noEmit` |
| `Makefile` | File exists and has a `check` or `test` target | `make check` or `make test` |

3. **No commands found.** Set `verificationResult: skipped` with an empty verification output block.

Run each discovered command sequentially. For each command:
- Capture exit code.
- Capture combined stdout+stderr, truncated to the last 50 lines on failure.
- Record in verification output as `commandName: exit N` (success) or a block with truncated output (failure).

Overall result:
- All commands exit 0: `verificationResult: pass`
- Any command exits non-zero: `verificationResult: fail`

##### 4b. Write Log File

Generate the log file path and taskId:

1. Take the task description, lowercase it.
2. Split on whitespace, take the first 5 words.
3. Join with hyphens.
4. Replace any character not `[a-z0-9-]` with a hyphen.
5. Collapse consecutive hyphens into one, trim leading/trailing hyphens.
6. Truncate to 50 characters (at the last complete hyphen-delimited segment within the limit).

Path: `.plan-history/quick-tasks/{YYYY-MM-DD}-{slug}.toon`

Create the `.plan-history/quick-tasks/` directory if it does not exist.

If a file with the same name already exists, append `-2`, `-3`, etc. before `.toon`.

Write the log in TOON format with all QuickTaskLog fields:

```toon
taskId: {YYYY-MM-DD}-{slug}
description: {user's original task description, verbatim}
mode: {standalone|plan-aware|injection}

startedAt: {ISO-8601 timestamp from when execution began}
completedAt: {ISO-8601 timestamp from when post-execution finished}

filesChanged[N]: {list of files created, modified, or deleted}

verificationResult: {pass|fail|skipped}
verificationOutput:
  {commandName}: exit {N}

commitHash: {short SHA or null}
planContext: {path to PLAN.md or null}
injectedPhase: {phase identifier or null}
injectedWave: {wave number or null}
```

##### 4c. Offer Commit

If `--no-commit` was NOT set:

Print:

```
Commit changes with /loom-git commit? (y/n)
```

If the user confirms, invoke `/loom-git commit`. Record the resulting commit hash in the log file (update the `commitHash` field). If the user declines, set `commitHash: null`.

If `--no-commit` was set, skip this step and set `commitHash: null`.

##### 4d. Print Summary

Print a summary in this format:

```
--- Quick Task Complete ---
Mode:         {mode}
Task:         {description}
Files:        {comma-separated list of changed files, or "none"}
Verification: {pass|fail|skipped}
Log:          {path to log file}
Commit:       {short SHA or "none"}
```

---

## Subcommand: pause

Snapshot the current workflow state for session handoff. Allows the user to close the current session and resume later with full context restoration.

### Arguments

Parse arguments after `pause`:
- No args: snapshot current state
- `--no-commit`: skip the WIP git commit
- `--message "text"`: add a human-readable note to the snapshot

### Instructions

#### Step 1: Detect Running Workflow

Scan for active workflow state by checking these files in order:

1. `.plan-execution/pipeline-state.toon` -- `/loom auto` pipeline state
2. `.plan-execution/state.toon` -- `/loom-plan execute` execution state
3. `.plan-execution/convergence-state.toon` -- `/loom converge` convergence state
4. `.plan-execution/status.toon` -- general status (any command)

For each file found, read its contents and extract:
- `command` or `mode` -- which command is running
- `currentStage` or `status` -- where in the workflow we are
- `phase` or `currentWave` -- specific step within the stage

If NO state files are found:
- Print: "No active workflow detected. Nothing to pause."
- Stop.

#### Step 2: Gather Context Snapshot

Collect all relevant state into a snapshot:

1. **Identify the running command.** Use the highest-priority state file found:
   - `pipeline-state.toon` -> command is `auto`
   - `state.toon` (without pipeline-state) -> command is `execute-plan`
   - `convergence-state.toon` (without state.toon) -> command is `converge`
   - `status.toon` only -> read the `command` field

2. **Read rolling context.** If `.plan-execution/rolling-context.md` exists, read and compress to under 2000 tokens. Preserve: key decisions, blockers, recent pivots, agent outcomes.

3. **Identify completed work.** Read wave summaries from `.plan-execution/wave-*-summary.toon`. Build a list of completed waves with file counts and status.

4. **Identify pending decisions.** Scan the most recent agent results and state for any unanswered prompts, approval gates, or human-input-required markers.

5. **Record what was about to happen next.** Based on the current stage/phase, determine the next action the workflow would take.

6. **Capture git state.** Run `git rev-parse HEAD` to get the current commit SHA.

#### Step 3: Write continue-here.toon

Write `.plan-execution/continue-here.toon` atomically (write to `.tmp`, then rename):

```toon
pausedAt: {ISO-8601 timestamp}
command: {running command, e.g. execute-plan, auto, converge}
phase: {current step, e.g. wave-2-wiring, plan-review, converging-iter-3}
planPath: {PLAN.md path or null}
roadmapPath: {ROADMAP.md path or null}
resumeStep: {exact step to resume from, e.g. "Step 3: Execution", "Step 5: Convergence Loop iter 4"}
pendingDecisions[N]: {any unanswered prompts or approval gates}
completedWork[N]{wave,status,filesChanged}:
  {wave-number},{complete|partial},{file-count}
nextAction: {what was about to happen, e.g. "Run wiring-agent for wave 2", "Execute plan review"}
context: {compressed rolling-context.md snapshot, max 2000 tokens}
gitRef: {current HEAD sha}
message: {user's --message text, or null}
stateFiles[N]: {list of all .plan-execution/ state files that exist}
```

#### Step 4: Git Commit (unless --no-commit)

If `--no-commit` was NOT set:

1. Stage all files in `.plan-execution/` that are not gitignored.
2. Create a WIP commit:
   ```
   git add .plan-execution/continue-here.toon
   git commit -m "WIP: paused at {phase}"
   ```
   If the commit fails (nothing to commit, or hooks reject), warn but continue.

#### Step 5: Display Resume Instructions

Print:

```
## Session Paused

Command:    {command}
Phase:      {phase}
Next action: {nextAction}
Git ref:    {gitRef} (short SHA)
Snapshot:   .plan-execution/continue-here.toon

{if --message was set:}
Note: {message}

To resume in a new session:
  /loom resume

To resume a specific workflow directly:
  /loom auto --resume      (if command was auto)
  /loom-plan execute --resume   (if command was execute-plan)
  /loom converge --resume  (if command was converge)
```

---

## Subcommand: resume

Restore context from a paused session and dispatch to the correct workflow command.

### Arguments

Parse arguments after `resume`:
- No args: auto-detect and resume from `continue-here.toon` or other state
- `--force`: skip git drift warning and resume anyway
- `--status`: show what would be resumed without actually resuming

### Instructions

#### Step 1: Locate Resumable State

Check for state files in this priority order:

1. `.plan-execution/continue-here.toon` -- explicit pause snapshot (highest priority)
2. `.plan-execution/pipeline-state.toon` -- `/loom auto` pipeline state
3. `.plan-execution/state.toon` -- `/loom-plan execute` execution state
4. `.plan-execution/convergence-state.toon` -- `/loom converge` convergence state

If NONE of these files exist:
- Print: "No resumable state found. Start a new workflow with `/loom auto --from 'description'` or `/loom-plan execute`."
- Stop.

#### Step 2: Read and Validate State

**If `continue-here.toon` exists (from `/loom pause`):**

1. Read all fields from `continue-here.toon`.
2. Validate git state: run `git rev-parse HEAD` and compare with `gitRef` from the snapshot.
   - If they match: proceed silently.
   - If they differ and `--force` was NOT set:
     ```
     Warning: HEAD has moved since pause.
       Paused at: {gitRef}
       Current:   {currentHead}
       Commits diverged: {count}

     This may mean manual changes were made. Continue anyway? (yes / abort)
     ```
     Wait for user response. If "abort", stop.
   - If they differ and `--force` was set: print a one-line note and continue.

3. Restore context:
   - Read `rolling-context.md` if it exists.
   - Read each file listed in `stateFiles[]` to restore full state awareness.
   - Load `completedWork` to understand what's done.
   - Load `pendingDecisions` to know what needs human input.

**If `continue-here.toon` does NOT exist but other state files do:**

1. Read the highest-priority state file found.
2. Determine the command and current stage from the state file.
3. Warn: "No explicit pause snapshot found. Detected incomplete `{command}` workflow at stage `{stage}`. Resume from detected position? (yes / abort)"
4. Wait for confirmation.

#### Step 3: Display Resume Context (if --status)

If `--status` was passed, display what would be resumed and stop:

```
## Resumable State

Source:     {continue-here.toon | pipeline-state.toon | state.toon | convergence-state.toon}
Command:    {command}
Phase:      {phase}
Paused at:  {pausedAt timestamp}
Git ref:    {gitRef}
Git drift:  {none | N commits ahead}

Completed:
  {list of completed waves/stages with file counts}

Pending:
  {pendingDecisions list, or "none"}

Next action: {nextAction}

{if message exists:}
Note: {message}

To resume: /loom resume
```

Stop.

#### Step 4: Dispatch to Correct Command

Based on the detected command, dispatch to the appropriate resume path:

| Command | Dispatch Action |
|---------|----------------|
| `auto` | Read `pipeline-state.toon`. Print: "Resuming autonomous pipeline at stage: {currentStage}". Execute the `/loom auto --resume` logic (Step 0 of the auto subcommand with `--resume`). |
| `execute-plan` | Read `state.toon`. Print: "Resuming plan execution at wave {currentWave}". Execute `/loom-plan execute --resume` logic. |
| `converge` | Read `convergence-state.toon`. Print: "Resuming convergence at iteration {iteration}". Execute the `/loom converge --resume` logic. |
| `create-plan` | Print: "Plan creation was interrupted. Re-running from the beginning." Execute `/loom-plan create` with the original arguments from the snapshot context. |
| Other | Print: "Detected interrupted `{command}` workflow. Cannot auto-resume this command type. Suggested manual action: {nextAction from snapshot}". Stop. |

#### Step 5: Cleanup

After successful dispatch (the resumed command has started running):

1. Delete `.plan-execution/continue-here.toon` -- it has been consumed.
2. Print: "Resumed successfully. continue-here.toon cleaned up."

If the dispatch fails:
- Do NOT delete `continue-here.toon` -- the user can retry.
- Print: "Resume dispatch failed: {error}. State preserved. Try again with `/loom resume` or resume manually."

---

## Subcommand: do

Smart routing -- takes freeform natural language text and dispatches to the right Loom command.

### Arguments

Parse arguments after `do`:
- The entire remaining text after `do` is the user's intent description.
- If empty: print help and stop.

### Instructions

#### Step 1: Help Check

If no text provided after `do`:
```
/loom do <natural language description>

Route freeform text to the right Loom command automatically.

Examples:
  /loom do fix the auth bug
  /loom do review my code
  /loom do create a plan for the new feature
  /loom do what should I do next
  /loom do add a note about the caching issue
  /loom do show me the project status
```
Stop.

#### Step 2: Gather Context

Read project state to inform routing:

1. **Available commands.** Read `~/.claude/skills/library/library.yaml` to get all installed Loom commands with their descriptions. If the file does not exist, use the built-in command list from the reference section above.

2. **Project state.** Check for the presence of:
   - `ROADMAP.md` -- record exists/not-exists and approval status (check frontmatter for `status: approved`)
   - `PLAN.md` -- record exists/not-exists
   - `.plan-execution/state.toon` -- read `status` if exists (in-progress, completed, failed)
   - `.plan-execution/pipeline-state.toon` -- read `currentStage` if exists
   - `.plan-execution/continue-here.toon` -- paused session exists
   - `.plan-execution/review-report.md` -- review findings exist
   - `.loom/wiki/` -- wiki exists
   - `.plan-history/quick-tasks/` -- prior quick tasks exist

3. **Recent activity.** If `.plan-execution/status.toon` exists, read the `command` and `phase` fields to understand what was last running.

#### Step 3: Route Intent

Analyze the user's text against known patterns and project state. Use both keyword matching and semantic understanding:

| Intent Pattern | Matched Command | Condition |
|----------------|-----------------|-----------|
| "fix", "bug", "debug", "broken" | `/loom-code fix` or `/loom quick "{text}"` | If review-report.md exists, use code fix. Otherwise, use quick. |
| "review", "check code", "audit code" | `/loom-code review` | Default to `--branch` if on a feature branch |
| "review plan", "check plan" | `/loom-plan review` | Only if PLAN.md exists |
| "review roadmap" | `/loom-roadmap review` | Only if ROADMAP.md exists |
| "plan", "create plan", "make a plan" | `/loom-plan create` | Only if ROADMAP.md exists and is approved |
| "roadmap", "create roadmap", "init roadmap" | `/loom-roadmap init` | Append `--from "{text}"` if text contains a description |
| "build", "execute", "implement", "run plan" | `/loom-plan execute` | Only if PLAN.md exists |
| "test", "run tests", "generate tests" | `/loom-plan test --run` | Only if PLAN.md exists |
| "note", "remember", "idea", "thought" | `/loom-note "{text}"` | Strip the intent keyword, pass remainder as note text |
| "status", "progress", "how far", "where are we" | `/loom status` | Always available |
| "what's next", "next step", "what now", "continue" | `/loom next` | Delegate to the next subcommand |
| "pause", "save state", "stop here" | `/loom pause` | Only if active workflow detected |
| "resume", "continue", "pick up" | `/loom resume` | Only if resumable state exists |
| "onboard", "init", "analyze codebase" | `/loom init` | Always available |
| "auto", "autonomous", "do everything" | `/loom auto` | Append `--from "{text}"` if text contains a description |
| "converge", "match target", "golden" | `/loom converge` | Requires target path in text |
| "commit", "push", "pr", "merge" | `/loom-git {subcommand}` | Extract git subcommand from text |
| "ingest", "update wiki" | `/loom-wiki ingest` | Only if wiki exists |
| "lint", "health check" | `/loom-wiki lint` | Always available |
| "profile", "model", "cost" | `/loom profile` | Always available |

If the intent is ambiguous (no strong keyword match or multiple matches), present the top 2-3 options:

```
I'm not sure which command you need. Here are the best matches:

  1. /loom-code review --branch   -- Review code changes on current branch
  2. /loom quick "{text}"         -- Execute as a quick standalone task
  3. /loom-code fix               -- Apply fixes from existing review findings

Which one? (1/2/3 or describe more)
```

#### Step 4: Confirm and Execute

Present the matched command with confidence:

```
Routing to: /loom-code review --branch

Is that right? (yes / pick another)
```

- If user confirms ("yes", "y", "sure", or just presses enter): invoke the Skill tool with the matched command name, passing any extracted arguments.
- If user picks another: ask them to specify or re-present options.
- If user provides a different description: re-run Step 3 with the new text.

---

## Subcommand: next

State-aware next step suggestion. Reads project state to determine the logical next action in the Loom workflow.

### Arguments

Parse arguments after `next`:
- No args: detect and suggest next step
- `--auto`: execute the suggested step without confirmation
- `--why`: show reasoning for the suggestion

### Instructions

#### Step 1: Read Project State

Scan for all relevant project artifacts:

1. **Loom artifacts:**
   - `CLAUDE.md` -- exists? (boolean)
   - `ROADMAP.md` -- exists? Read frontmatter for `status` field (draft, approved, etc.)
   - `PLAN.md` -- exists? Read frontmatter for review status.
   - `.plan-execution/state.toon` -- exists? Read `status` (in-progress, completed, failed, paused).
   - `.plan-execution/pipeline-state.toon` -- exists? Read `currentStage`.
   - `.plan-execution/continue-here.toon` -- exists? (paused session)
   - `.plan-execution/review-report.md` -- exists? Read finding counts.
   - `.plan-history/reviews/` -- any review files? Check dates.
   - `.loom/wiki/` -- exists?

2. **Test state:**
   - Check for test files in common locations (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`)
   - Check if test runner is configured (`package.json` scripts, vitest.config, jest.config, etc.)

3. **Git state:**
   - Current branch name
   - Uncommitted changes count
   - Whether on main/master or a feature branch

#### Step 2: Evaluate State and Determine Next Step

Walk through the Loom workflow stages in order. The first incomplete stage is the suggestion:

| Condition | Suggestion | Reasoning |
|-----------|------------|-----------|
| `continue-here.toon` exists | `/loom resume` | "You have a paused session. Resume where you left off." |
| `pipeline-state.toon` exists with `currentStage != complete` | `/loom auto --resume` | "Autonomous pipeline is in progress at stage {currentStage}." |
| `state.toon` exists with `status == in-progress` | `/loom-plan execute --resume` | "Plan execution is in progress at wave {currentWave}." |
| No `CLAUDE.md` and no `ROADMAP.md` | `/loom init` | "No Loom artifacts found. Start with project onboarding." |
| `CLAUDE.md` exists but no `ROADMAP.md` | `/loom-roadmap init --brownfield` | "Project is onboarded but has no roadmap. Create one." |
| `ROADMAP.md` exists, no reviews in `.plan-history/reviews/*roadmap*` | `/loom-roadmap review` | "Roadmap exists but hasn't been reviewed." |
| `ROADMAP.md` exists, reviewed, but `status != approved` | `/loom-roadmap approve` | "Roadmap has been reviewed. Approve it to unlock plan generation." |
| `ROADMAP.md` approved, no `PLAN.md` | `/loom-plan create` | "Roadmap is approved. Generate a plan." |
| `PLAN.md` exists, no reviews in `.plan-history/reviews/*review*` (non-roadmap) | `/loom-plan review` | "Plan exists but hasn't been reviewed." |
| `PLAN.md` exists, reviewed, no execution state | `/loom-plan execute` | "Plan is reviewed and ready for execution." |
| Execution completed (`state.toon` with `status == completed`), no test results | `/loom-plan test --run` | "Execution complete. Run tests." |
| Tests exist/ran, no `review-report.md` | `/loom-code review` | "Tests done. Run code review." |
| `review-report.md` exists with critical findings | `/loom-code fix` | "Review found {N} critical findings. Apply fixes." |
| Review clean (no critical findings), tests pass | `/loom-roadmap status` | "Everything looks good. Check overall status." |
| Uncommitted changes on feature branch | `/loom-git commit` | "You have uncommitted changes. Commit them." |

If multiple conditions match, use the highest-priority one (earlier in the table).

#### Step 3: Present Suggestion

Display the suggestion with context:

```
## Next Step

Suggested: {command}
Reason:    {reasoning}

{if --why was set, show the full state analysis:}
State analysis:
  CLAUDE.md:      {exists/missing}
  ROADMAP.md:     {exists/missing/approved/draft}
  PLAN.md:        {exists/missing/reviewed/unreviewed}
  Execution:      {not-started/in-progress/completed/failed}
  Tests:          {not-run/passing/failing}
  Review:         {not-run/clean/has-findings}
  Git:            {branch}, {N} uncommitted changes

Run it? (yes / pick another / show all options)
```

- If user confirms ("yes", "y", or presses enter): execute the suggested command.
- If `--auto` was set: execute immediately without asking.
- If user says "show all options": display the full workflow stages with current status markers, let them pick.
- If user picks another: ask them to specify.

---

## Subcommand: profile

View or switch model cost profiles. Controls which models are used for different agent tiers across the Loom pipeline.

### Arguments

Parse arguments after `profile`:
- No args: show current profile and available profiles
- `<name>`: switch to the named profile (`quality`, `balanced`, `budget`)
- `--show`: show detailed model assignments for the current profile
- `--set <tier> <model>`: override a single tier's model (e.g., `--set review haiku`)

### Instructions

#### Step 1: Read Current Configuration

1. Check if `.claude/orchestration.toml` exists in the project root.
   - If yes: read the `[settings]` section for `modelProfile` and any `[settings.profiles.*]` sections.
   - If no: use defaults (no profile set, all agents inherit parent model).

2. Determine the active profile:
   - If `modelProfile` is set in orchestration.toml: that's the active profile.
   - If not set: active profile is "inherit" (all agents use parent model).

#### Step 2: Handle No-Args (Show Current)

If no arguments provided after `profile`:

```
## Model Cost Profile

Active: {profile name or "inherit (no profile set)"}

Available profiles:
  quality    All tiers use high-capability models (opus/sonnet). Best results, highest cost.
  balanced   Planning uses opus, execution and review use sonnet, utility uses haiku. Good tradeoff.
  budget     Planning uses sonnet, everything else uses haiku. Lowest cost.
  inherit    No profile — all agents inherit the parent model. (default)

Current assignments:
  Planning:      {model}    (roadmap-builder, plan-builder, questioner)
  Execution:     {model}    (contracts, implementer, wiring)
  Review:        {model}    (all reviewers)
  Verification:  {model}    (verification-agent)
  Utility:       {model}    (meta-agent, wiki agents, fixer)

Switch profile: /loom profile <name>
Override a tier: /loom profile --set <tier> <model>
```

Stop.

#### Step 3: Handle Profile Switch

If a profile name is provided (`quality`, `balanced`, or `budget`):

1. Validate the profile name. If not recognized:
   ```
   Unknown profile: "{name}". Available profiles: quality, balanced, budget, inherit
   ```
   Stop.

2. Read or create `.claude/orchestration.toml`:
   - If the file exists: update the `modelProfile` field under `[settings]`.
   - If the file does not exist: create it with the `[settings]` section and the profile definitions.

3. Write the profile definitions if they don't already exist:

   ```toml
   [settings]
   modelProfile = "{name}"

   [settings.profiles.quality]
   planning = "opus"
   execution = "opus"
   review = "opus"
   verification = "sonnet"
   utility = "sonnet"

   [settings.profiles.balanced]
   planning = "opus"
   execution = "sonnet"
   review = "sonnet"
   verification = "sonnet"
   utility = "haiku"

   [settings.profiles.budget]
   planning = "sonnet"
   execution = "sonnet"
   review = "haiku"
   verification = "haiku"
   utility = "haiku"
   ```

4. If the file already has profile definitions, only update the `modelProfile` field -- do not overwrite custom profile definitions.

5. Display confirmation:
   ```
   Profile switched to: {name}

   Model assignments:
     Planning:      {model}
     Execution:     {model}
     Review:        {model}
     Verification:  {model}
     Utility:       {model}

   Takes effect on the next command invocation.
   ```

#### Step 4: Handle Tier Override

If `--set <tier> <model>` is provided:

1. Validate the tier name. Must be one of: `planning`, `execution`, `review`, `verification`, `utility`.
   If not recognized: print "Unknown tier: {tier}. Available tiers: planning, execution, review, verification, utility" and stop.

2. Validate the model name. Must be one of: `opus`, `sonnet`, `haiku`.
   If not recognized: print "Unknown model: {model}. Available models: opus, sonnet, haiku" and stop.

3. Read the current profile name from orchestration.toml.
   - If no profile is set: warn "No active profile. Set a base profile first with `/loom profile <name>`, or this override will only apply if a profile is activated later."

4. If a profile is active, modify that profile's tier in orchestration.toml:
   ```toml
   [settings.profiles.{active-profile}]
   {tier} = "{model}"
   ```

5. Display confirmation:
   ```
   Override applied: {tier} = {model} (in profile "{active-profile}")

   Current assignments:
     Planning:      {model}
     Execution:     {model}
     Review:        {model}
     Verification:  {model}
     Utility:       {model}
   ```

#### Step 5: Handle --show (Detailed View)

If `--show` is provided:

Display the full profile with per-agent model assignments:

```
## Model Profile: {name}

### Agent Model Assignments

| Agent | Tier | Model | Source |
|-------|------|-------|--------|
| roadmap-builder-agent | planning | {model} | profile |
| plan-builder-agent | planning | {model} | profile |
| questioner-agent | planning | {model} | profile |
| contracts-agent | execution | {model} | profile |
| implementer-agent | execution | {model} | profile |
| wiring-agent | execution | {model} | profile |
| security-reviewer | review | {model} | profile |
| architecture-reviewer | review | {model} | profile |
| plan-compliance-reviewer | review | {model} | profile |
| verification-agent | verification | {model} | profile |
| meta-agent | utility | {model} | profile |
| wiki-maintainer-agent | utility | {model} | profile |
| fixer-agent | utility | {model} | profile |

### Per-Agent Overrides (from orchestration.toml)

{If any agents in orchestration.toml have explicit `model` fields, list them here.
These override the profile assignment.}

| Agent | Configured Model | Overrides Profile |
|-------|-----------------|-------------------|
| {agent-name} | {model} | yes |

Per-agent overrides always take precedence over profile assignments.
```

Stop.

### Error Handling

- **orchestration.toml parse error:** Warn about the parse error, display the raw file content, and suggest manual fix. Do not overwrite a corrupted file.
- **No write permission:** Warn that the profile change cannot be saved. Display the intended change for the user to apply manually.
- **Unknown profile in file:** If orchestration.toml references a profile name that isn't defined in `[settings.profiles.*]`, warn: "Active profile '{name}' is not defined. Using inherit behavior."

---

## Subcommand: status

Display a high-level project status overview. Delegates to `/loom-roadmap status` when a roadmap exists, and falls back to basic project info otherwise.

### Arguments

Parse arguments after `status`:
- No args: show project status overview
- `--verbose`: show detailed status including all state files

### Instructions

#### Step 1: Check for Roadmap

If `ROADMAP.md` exists:
- Delegate to `/loom-roadmap status` logic. This shows the full unified status view (roadmap + plan + milestones + progress).
- Stop after the delegate completes.

#### Step 2: Basic Project Info (no roadmap)

If no `ROADMAP.md` exists, display a basic project overview:

```
## Project Status

### Loom Artifacts
  CLAUDE.md:           {found (N lines) | not found}
  CONTEXT.md:          {found (N lines) | not found}
  ROADMAP.md:          not found
  PLAN.md:             {found | not found}
  orchestration.toml:  {found | not found}
  Wiki (.loom/wiki/):  {found (N pages) | not found}

### Execution State
  Pipeline state:      {not found | stage: {currentStage}}
  Execution state:     {not found | status: {status}, wave: {currentWave}}
  Convergence state:   {not found | status: {status}, iter: {iteration}}
  Paused session:      {not found | paused at {phase} on {pausedAt}}

### Recent Activity
  Last command:        {from status.toon or "unknown"}
  Last updated:        {from status.toon or "unknown"}

### Quick Tasks
  Total:               {count of .toon files in .plan-history/quick-tasks/}
  Recent:              {last 3 task descriptions with dates}

### Model Profile
  Active:              {profile name or "inherit"}

### Suggested Next Step
  {Run the /loom next logic to determine suggestion, display one-line version}
```

### Error Handling

- **File read errors:** Skip any file that cannot be read. Display "error reading" in its status slot.
- **No state at all:** If no Loom artifacts exist whatsoever, display: "No Loom artifacts found. Get started with `/loom init` (brownfield) or `/loom-roadmap init --from 'description'` (greenfield)."

---

## Subcommand: debate

Run an adversarial multi-round debate between agents to reach a well-reasoned decision.

### Arguments

Parse arguments after `debate`:
- `"question or topic"` (required): the decision to debate
- `--agents <a,b>`: specify advocate and critic agents (default: use general-purpose agents with role prompts)
- `--rounds <N>`: max debate rounds (default: 3, max: 5)
- `--moderator <agent>`: agent that synthesizes the final recommendation (default: general-purpose)

### Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/orchestration-patterns.md` — Pattern 1: Debate
- `~/.claude/agents/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those agent names. Look them up in `orchestration.toml` or library for their `.md` file paths.
2. If no `--agents`, use `general-purpose` agents with role prompts:
   - Advocate: "You are an advocate. Argue FOR the strongest position on this question."
   - Critic: "You are a devil's advocate. Find weaknesses, counter-arguments, and risks in the advocate's position."
   - Moderator: "You are a neutral moderator. Synthesize the debate into a clear recommendation with tradeoffs."
3. Check `.claude/orchestration.toml` for `[patterns.*]` entries with `type = "debate"`. If the user's topic matches a configured pattern's trigger, use that pattern's agent config instead.

#### Step 1: Debate Rounds

Execute per `orchestration-patterns.md` Pattern 1:

1. **Round 1 — Advocate:** Spawn advocate agent with the question. Collect position and arguments.
2. **Round 1 — Critic:** Spawn critic agent with the question + advocate's position. Collect critique.
3. **Round 2..N — Rebuttal:** Feed critique back to advocate → collect rebuttal. Feed rebuttal to critic → collect counter. Repeat for `--rounds` rounds.

Display each round as it completes:
```
## Debate: {topic}

### Round 1
**Advocate:** {position summary — 2-3 sentences}
**Critic:** {critique summary — 2-3 sentences}

### Round 2
**Advocate rebuttal:** {key points}
**Critic counter:** {key points}

...
```

#### Step 2: Synthesis

Spawn moderator agent with the full debate transcript:
"Synthesize this debate into a structured recommendation. Include: decision, confidence level (high/medium/low), key tradeoffs acknowledged, and dissenting considerations worth monitoring."

#### Step 3: Present Result

```
## Recommendation

**Decision:** {moderator's recommendation}
**Confidence:** {high/medium/low}

### Key Tradeoffs
{bulleted list}

### Dissenting Considerations
{points from the losing side worth monitoring}

### Full Transcript
{collapse or summarize — available in .plan-execution/debate-{timestamp}.toon}
```

Save the debate to `.plan-execution/debate-{timestamp}.toon` for reference.

#### Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent in the background:
- Event type: `debate-complete`
- Event data: topic, decision, tradeoffs, confidence
- Wiki path: `.loom/wiki`

### Error Handling

- **Agent failure mid-debate:** If advocate or critic fails, attempt one retry with the same context. If retry fails, synthesize from whatever rounds completed.
- **No question provided:** Print: "Usage: `/loom debate \"Redis vs Postgres for sessions\"`"

---

## Subcommand: chain

Run a progressive refinement pipeline where each agent builds on the previous agent's output.

### Arguments

Parse arguments after `chain`:
- `"task description"` (required): what to produce
- `--agents <a,b,c>`: ordered list of agents (default: draft → refine → harden using general-purpose agents)
- `--steps <N>`: number of refinement steps if using default agents (default: 3)

### Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/orchestration-patterns.md` — Pattern 2: Chain
- `~/.claude/agents/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those in order. Look up `.md` file paths.
2. If no `--agents`, use general-purpose agents with role prompts:
   - Step 1 (Draft): "Generate an initial implementation. Optimize for correctness and completeness. Mark uncertainties with TODO comments."
   - Step 2 (Refine): "Improve this draft: better naming, extract helpers, add error handling, apply project conventions. Remove unnecessary complexity."
   - Step 3 (Harden): "Harden for production: edge-case handling, input validation, security checks. Remove all TODOs. This must be production-ready."
3. Check `orchestration.toml` for matching chain patterns.

#### Step 1: Execute Chain

Execute per `orchestration-patterns.md` Pattern 2:

1. Read `CLAUDE.md` for project conventions (passed to all agents as context).
2. Spawn agent[0] with the task description. Collect output.
3. Spawn agent[1] with agent[0]'s output + original task. Collect output.
4. Continue until all agents have run.

Display progress:
```
## Chain: {task}

### Step 1 — Draft
{summary of what was produced}

### Step 2 — Refine
{summary of changes made}

### Step 3 — Harden
{summary of hardening applied}
```

#### Step 2: Present Result

Display the final output. If it's code, show the complete artifact. If it's a document, show the full text.

Save to `.plan-execution/chain-{timestamp}.toon`.

### Error Handling

- **Agent fails mid-chain:** Return the last successful output with a note: "Chain halted at step {N}. Output from step {N-1} returned."
- **No task provided:** Print usage.

---

## Subcommand: vote

Run parallel independent agents on the same problem, then evaluate and pick the best solution.

### Arguments

Parse arguments after `vote`:
- `"problem description"` (required): what to solve
- `--agents <a,b,c>`: agents that independently produce solutions (default: 3 general-purpose agents)
- `--candidates <N>`: number of parallel solutions if using default agents (default: 3)
- `--evaluator <agent>`: agent that compares solutions (default: general-purpose)
- `--isolate`: use git worktrees for full isolation (default: false)

### Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/orchestration-patterns.md` — Pattern 3: Voting
- `~/.claude/agents/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those. Otherwise create N general-purpose agents each prompted with: "Solve this problem independently. Take your own approach — do not try to guess what other agents might do."
2. If `--isolate`, create git worktrees for each agent.
3. Check `orchestration.toml` for matching vote patterns.

#### Step 1: Parallel Solve

Spawn ALL solver agents in a SINGLE message (parallel execution). Each gets the identical problem statement + project context from CLAUDE.md.

Display progress as agents complete:
```
## Vote: {problem}

Spawned {N} independent agents...

  Agent 1: completed (approach: {one-line summary})
  Agent 2: completed (approach: {one-line summary})
  Agent 3: working...
```

#### Step 2: Evaluate

Spawn evaluator agent with all solutions side-by-side:
"Compare these {N} solutions. Score each on: correctness, security, readability, performance, maintainability. Either pick the best or produce a merged solution taking the strongest parts of each. Explain your reasoning."

#### Step 3: Present Result

```
## Evaluation

### Scores
| Agent | Correctness | Security | Readability | Performance | Overall |
|-------|------------|----------|-------------|-------------|---------|
| 1     | 8/10       | 9/10     | 7/10        | 8/10        | 8.0     |
| 2     | 9/10       | 7/10     | 9/10        | 7/10        | 8.0     |
| 3     | 7/10       | 8/10     | 8/10        | 9/10        | 8.0     |

### Winner: Agent {N}
{evaluator's reasoning}

### Selected Solution
{the winning or merged code/artifact}
```

Clean up worktrees if `--isolate` was used. Save to `.plan-execution/vote-{timestamp}.toon`.

### Error Handling

- **Agent fails:** Evaluate from remaining solutions. Minimum 2 solutions needed.
- **All agents produce identical solutions:** Note this in evaluation — high confidence in the approach.
- **No problem provided:** Print usage.

---

## Subcommand: triage

Route a task through a cheap classifier that determines complexity and dispatches to the right specialist.

### Arguments

Parse arguments after `triage`:
- `"task description"` (required): the task to classify and route
- `--router <agent>`: classification agent (default: general-purpose with haiku model)
- `--simple <agent>`: handler for simple tasks (default: general-purpose with sonnet)
- `--complex <agent>`: handler for complex tasks (default: general-purpose with opus)

### Protocols

Before doing anything, read:
- `~/.claude/agents/protocols/orchestration-patterns.md` — Pattern 4: Triage
- `~/.claude/agents/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If agents specified via flags, use those.
2. Otherwise use defaults: haiku router, sonnet for simple, opus for complex.
3. Check `orchestration.toml` for matching triage patterns.

#### Step 1: Classify

Spawn router agent (haiku-class) with:
```
Classify this task:
- simple: Single-file changes, typo fixes, config updates, simple CRUD, boilerplate, documentation
- complex: Multi-file refactors, new features with edge cases, security-sensitive code, performance optimization, architectural changes
- multi: Requires changes across multiple domains (frontend + backend, backend + infra, etc.)

Task: {task description}

Return your classification as: complexity (simple/complex/multi), domains (if multi), and one-line reasoning.
```

Display:
```
## Triage: {task}

Classification: {complexity}
Reasoning: {one-line}
{if multi: Domains: {domains}}

Routing to: {agent name} ({model})
```

#### Step 2: Route and Execute

- **Simple:** Spawn simple handler with the task.
- **Complex:** Spawn complex handler with the task.
- **Multi-domain:** Spawn domain specialists in parallel, each with their slice of the task. Merge results.

#### Step 3: Present Result

Display the specialist's output directly. Note the routing decision and cost savings:
```
Triage complete. Routed as {complexity} → {agent} ({model}).
{if simple: Saved ~{X}x cost vs opus.}
```

Save to `.plan-execution/triage-{timestamp}.toon`.

### Error Handling

- **Router fails:** Fall back to complex handler (safe default — overspend rather than underspend on quality).
- **Specialist fails:** Retry once with error context. If retry fails, try the next tier up (simple fails → try complex).
- **No task provided:** Print usage.

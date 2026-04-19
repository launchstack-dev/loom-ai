---
description: "Loom system reference — commands, agents, workflows"
---

# Loom Reference

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
| `/loom-plan execute --no-auto-commit` | Disable per-wave auto-commits |
| `/loom auto --from "description"` | Full autonomous pipeline: plan → build → test → review → fix loops |
| `/loom auto --plan PLAN.md` | Autonomous pipeline from existing plan |
| `/loom auto --resume` | Resume autonomous pipeline from saved state |
| `/loom auto --max-iterations N` | Cap outer loop iterations (default: 3) |
| `/loom auto --max-agents N` | Cap total agent spawns (default: 50) |
| `/loom auto --dry-run` | Show pipeline plan without executing |
| `/loom auto --stop-after <stage>` | Stop after named stage (roadmap, plan, execute, converge, test, review, fix) |
| `/loom auto --no-auto-commit` | Disable per-wave and per-iteration auto-commits |
| `/loom auto --converge-target <path>` | Enable target convergence with a golden target file |
| `/loom auto --converge-config <path>` | Enable target convergence with existing harness config |
| `/loom auto --converge-criteria` | Enable criteria convergence (TDD + reviews) for each plan phase |
| `/loom auto --converge-criteria --reviewers X,Y` | Criteria convergence with specific reviewer types |
| `/loom converge --target <path>` | Target convergence: compare implementation against deterministic reference |
| `/loom converge --criteria` | Criteria convergence: TDD + reviews until all conditions pass |
| `/loom converge --criteria --phase N` | Criteria convergence for a specific plan phase |
| `/loom converge --criteria --reviewers security,code-review` | Criteria convergence with specific reviewer types |
| `/loom converge --criteria --no-soft` | Criteria convergence with tests only (no agent reviews) |
| `/loom converge --criteria --no-hard` | Review-only convergence (no tests, just agent reviews on existing code) |
| `/loom converge --config <path>` | Run convergence with existing harness config (either mode) |
| `/loom converge --max-iterations N` | Cap convergence iterations (default: 10) |
| `/loom converge --tolerance <threshold>` | Global tolerance override for target mode (0.0-1.0) |
| `/loom converge --dry-run` | Parse targets/criteria + build harness, show setup, stop before loop |
| `/loom converge --resume` | Resume convergence from saved state (either mode) |
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

#### Kit Commands

Kit commands use colon-delimited subcommands: `loom <kit>:<subcommand>`.

| Command | Description |
|---------|-------------|
| `/loom <kit>:` | Show available subcommands for an installed kit |

**Installed kits are listed here when present.** If no kits are installed:
```
Kit Commands: none installed. Run /loom-library list --kits to see available kits.
```

When kits are installed, this section dynamically lists them. For example with the data-engineering kit:

| Command | Description |
|---------|-------------|
| `loom data:profile` | Scan project for data sources, schemas, and pipeline definitions |
| `loom data:validate` | Run data quality gate against the current codebase |
| `loom data:lineage` | Trace and display data source-to-target flow |
| `loom data:test` | Generate data-specific tests |

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

**Target Convergence** (spawned by `/loom converge --target` or `--plan`):
- `convergence-planner-agent` -- Interactive target discovery from plan + codebase
- `target-parser` -- Normalizes deterministic sources into comparable target manifests
- `harness-builder` -- Scaffolds comparison infrastructure (diff scripts, config, runner)
- `delta-analyzer` -- Triages deltas: noise vs actionable, prioritizes fixes
- `convergence-driver` -- Iteration orchestrator with circuit breakers (stall, regression, budget)

**Criteria Convergence** (spawned by `/loom converge --criteria`):
- `criteria-planner-agent` -- Discovers criteria from plan, generates test stubs, configures reviewers
- `criteria-harness-builder` -- Builds test runner + reviewer agent harness with conflict tracking
- `delta-analyzer` -- Shared with target convergence, layered priority (tests > security > code review)
- `convergence-driver` -- Shared with target convergence, adapted scoring for pass/fail + conflict handling

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

Two modes sharing a common driver loop:

**Target Convergence** (`--target` / `--plan`):
```
target-parser(source) -> target manifest
harness-builder(manifest) -> comparison harness + converge.config
Human approval gate: review targets + tolerances
[Convergence Loop]:
  harness -> Delta Report (score per target, 0.0-1.0)
  delta-analyzer -> prioritized fix list
  fixer-agents (parallel) -> code changes
  harness -> new Delta Report
  Circuit break if: stalled | regression | budget exhausted | max iterations
Final: convergence report (pass/fail per target)
```

**Criteria Convergence** (`--criteria`):
```
criteria-planner(plan) -> criteria-plan.toon + test stubs
criteria-harness-builder(plan + stubs) -> test + review harness + converge.config
Human approval gate: review criteria + test stubs
[Convergence Loop]:
  tests -> hard criteria results (pass/fail)
  reviewers (parallel) -> soft criteria findings
  delta-analyzer -> fix list (layered: tests > security > code review > advisory)
  fixer-agents (parallel) -> code changes
  conflict-tracker -> detect oscillating findings, freeze criteria
  Circuit break if: stalled | regression | all frozen | budget exhausted | max iterations
Final: convergence report (pass/fail per criterion, frozen conflicts)
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
  convergence-state.toon  -- Iteration state (resumable, either mode)
  convergence/            -- Convergence loop state (target artifacts, golden files)
    targets/              -- Normalized target artifacts (target mode)
    convergence-report.md -- Final convergence report
    converge.config       -- Target-to-method mapping + tolerances (target mode)
    criteria/             -- Criteria convergence state (criteria mode)
      criteria-plan.toon  -- Criteria plan (criteria mode)
      tests/              -- Generated test stubs (hard criteria)
      harness/            -- Test + review runner scripts
        reviewers/        -- Per-reviewer prompt templates
        conflict-tracker.toon -- Conflict detection state
      actual/             -- Per-iteration results
      converge.config     -- Criteria harness config
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

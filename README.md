# Loom

A multi-agent pipeline for planning, executing, testing, and reviewing software projects with Claude Code.

## What It Does

Twenty slash commands that compose 50+ specialized agents, organized by workflow stage:

**Initialization**
| Command | What it does |
|---------|-------------|
| `/loom-init` | Brownfield onboarding: analyze codebase, generate CLAUDE.md + CONTEXT.md |

**Roadmapping & Planning**
| Command | What it does |
|---------|-------------|
| `/loom-roadmap` | Roadmap creation, milestone tracking, dependency graphs, versioning |
| `/loom-review-roadmap` | 4 agents review a ROADMAP.md in parallel |
| `/loom-create-plan` | Generate PLAN.md (v2 spec) from approved ROADMAP.md |
| `/loom-review-plan` | 6 agents analyze a PLAN.md in parallel |

**Execution**
| Command | What it does |
|---------|-------------|
| `/loom-execute-plan` | Wave-by-wave execution with contracts, parallel implementers, wiring, and verification |
| `/loom-auto` | Fully autonomous pipeline with feedback loops |
| `/loom-converge` | Convergence loop: compare implementation against deterministic targets |
| `/loom-quick` | Execute a quick task without full plan/roadmap ceremony |

**Review & Testing**
| Command | What it does |
|---------|-------------|
| `/loom-test-plan` | Acceptance criteria extraction + unit + E2E test generation |
| `/loom-review-code` | 9 reviewers (6 built-in + 3 bespoke) with severity-ranked output |
| `/loom-fix-code` | Auto-apply review findings with parallel fixer-agents and verification |

**Knowledge & Maintenance**
| Command | What it does |
|---------|-------------|
| `/loom-note` | Accumulate development notes, review and assimilate into docs |
| `/loom-ingest` | Ingest code, docs, and execution results into the project wiki |
| `/loom-lint` | Structural health checks: wiki, contracts, plan-reality drift |

**Tooling & Infrastructure**
| Command | What it does |
|---------|-------------|
| `/loom-library` | Pull-on-demand catalog management: install, sync, search, update |
| `/loom-git` | Git workflow automation: commit, push, PR, merge, cleanup, review-pr |
| `/loom-create-agent` | Interactive wizard to create project-specific bespoke agents |
| `/loom-statusline-setup` | Configure the Claude Code status line (Starship integration) |
| `/loom` | Full reference |

## Install

**One-liner** (no repo clone needed):
```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

This installs a minimal bootstrap into `~/.claude/`: the library catalog, infrastructure files (statusline renderer, update checker), and three core commands (`/loom-library`, `/loom`, `/loom-statusline-setup`). Everything else is pulled on demand.

**Per-project setup:**
```
/loom-library use loom-init          — install the onboarding command + its agent deps
/loom-library use loom-execute-plan  — install execution pipeline + contracts, implementer, wiring, verification agents
/loom-library use loom-auto          — install everything (pulls all commands + agents transitively)
```

**Ongoing management:**
```
/loom-library list           — see what's installed vs available
/loom-library sync           — re-pull all installed items, detect source changes
/loom-library update         — check for new catalog entries + update infrastructure
/loom-library upgrade        — alias for update
/loom-library search <query> — find items by name or description
/loom-library remove <name>  — uninstall (warns about dependents)
```

The statusline shows a yellow `↑ update` indicator when a newer catalog version is available on GitHub. Run `/loom-library update` to apply updates and clear the indicator.

`/loom-library` resolves dependencies automatically, tracks content hashes for drift detection, and supports both local and GitHub sources. Run `/loom` in Claude Code to verify.

## Architecture

```
Commands (user-facing)              Agents (spawned by commands)
──────────────────────              ───────────────────────────
/loom-init ───────────────────────→ project-guidance + api-explorer + docs-auditor
/loom-roadmap ────────────────────→ questioner → roadmap-builder → plan-builder
/loom-review-roadmap ─────────────→ 4 review agents (parallel)
/loom-review-plan ────────────────→ 6 planning agents (parallel)
/loom-execute-plan ───────────────→ contracts → implementers → wiring → verification
/loom-test-plan ──────────────────→ criteria → unit-test → e2e-test
/loom-review-code ────────────────→ 6 built-in + 3 bespoke reviewers
/loom-fix-code ───────────────────→ parallel fixer-agents
/loom-converge ───────────────────→ target-parser → harness → delta-analyzer → driver
/loom-auto ──────────────────────→ chains all commands with automated gates
/loom-ingest ─────────────────────→ wiki-ingest-agent → wiki-maintainer-agent
/loom-lint ───────────────────────→ wiki-lint-agent + contract/plan validators

Infrastructure (background)
───────────────────────────
statusline-renderer.cjs       ← Pipeline state + ambient context + update indicator
loom-update-checker.cjs       ← Background catalog version check (4h throttle)

Protocols (shared contracts)
────────────────────────────
agent-result.schema.md        ← Standard return envelope
state.schema.md               ← Execution state for resume
pipeline-state.schema.md      ← Autonomous pipeline state
execution-conventions.md      ← File ownership, context tiers, TOON format
toon-format.md                ← TOON format specification
orchestration-config.schema.md ← Per-project agent registration
orchestration-patterns.md     ← Debate, chain, vote, triage, converge patterns
validation-rules.md           ← Output validation, blocker gates, plan validation
plan.schema.md                ← PLAN.md format specification
roadmap.schema.md             ← ROADMAP.md format specification
spec.schema.md                ← v2 spec sections (API specs, state machines)
wiki-conventions.md           ← Wiki page format, cross-refs, staleness model
agent-monitoring.schema.md    ← Progress reporting, stale detection, dashboards
pattern-executor.md           ��� Pattern runtime (debate, chain, vote, triage, converge)
```

## Workflows

Pick the workflow that matches your situation:

### Full pipeline

The default path — maximum control at every stage.

```mermaid
flowchart TD
    Start{New or existing<br/>codebase?}
    Start -->|Existing| Init["/loom-init<br/>Analyze codebase,<br/>generate CLAUDE.md"]
    Start -->|New| Roadmap

    Init --> Roadmap["/loom-roadmap --init<br/>Create ROADMAP.md"]
    Init -.->|"--full flag<br/>chains automatically"| Roadmap

    Roadmap --> ReviewRoadmap["/loom-review-roadmap<br/>4 agents in parallel"]
    ReviewRoadmap --> Approve["/loom-roadmap --approve-roadmap"]

    Approve --> Plan["/loom-create-plan<br/>Generate PLAN.md"]
    Plan --> ReviewPlan["/loom-review-plan<br/>6 agents in parallel"]
    ReviewPlan --> Integrate["/loom-create-plan --review-integrate"]

    Integrate --> Execute["/loom-execute-plan<br/>Wave-by-wave build"]
    Execute --> Test["/loom-test-plan --run"]
    Test --> Review["/loom-review-code"]
    Review --> Fix["/loom-fix-code"]
    Fix -.->|"Issues remain"| Review

    style Init fill:#e8f4f8
    style Roadmap fill:#e8f4f8
    style Plan fill:#e8f4f8
    style Execute fill:#f0e8f8
    style Test fill:#e8f8e8
    style Review fill:#f8f0e8
    style Fix fill:#f8f0e8
```

**Brownfield** (existing codebase):
```
/loom-init                              Analyze codebase, generate CLAUDE.md + CONTEXT.md
/loom-roadmap --init --brownfield       Create roadmap informed by existing code
/loom-review-roadmap                    4 agents review the roadmap
/loom-roadmap --approve-roadmap         Lock roadmap
/loom-create-plan                       Generate PLAN.md from approved roadmap
/loom-review-plan                       6 agents analyze plan in parallel
/loom-create-plan --review-integrate    Apply plan review findings
/loom-execute-plan                      Wave-by-wave build
/loom-test-plan --run                   Generate and run tests
/loom-review-code                       Full code review
/loom-fix-code                          Auto-apply findings
```

**Greenfield** (new project) — same pipeline, skip `/loom-init`:
```
/loom-roadmap --init --from "description"
```

### Autonomous

One command runs the full pipeline with automated gates and feedback loops.

```mermaid
flowchart LR
    Auto["/loom-auto --from 'description'"]
    Auto --> Plan["Plan"]
    Plan --> Build["Build"]
    Build --> Test["Test"]
    Test --> Review["Review"]
    Review -->|"Pass"| Done["Done"]
    Review -->|"Fail"| Fix["Fix"]
    Fix --> Review
    Fix -->|"Stuck"| Plan

    style Auto fill:#e8f4f8
    style Done fill:#e8f8e8
```

```
/loom-auto --from "add user authentication with OAuth"
```

Circuit breakers stop the loop if fixes stall or iterations exceed the budget. Escalates to you with a report of what worked and what didn't.

### Quick brownfield onboard

Analyze an existing codebase and chain directly into roadmap creation:

```
/loom-init --full --from "add team management"
```

### Convergence (deterministic targets)

When you have a spec, migration, or reference implementation to match exactly:

```mermaid
flowchart LR
    Parse["Parse targets"] --> Harness["Build harness"]
    Harness --> Compare["Compare"]
    Compare -->|"Delta > 0"| Fix["Fix gaps"]
    Fix --> Compare
    Compare -->|"Delta = 0"| Done["Done"]
```

```
/loom-converge --targets spec.json --source src/
```

## Agent Groups

| Group | Agents | Used by |
|-------|--------|---------|
| **Onboarding** | project-guidance, api-explorer, docs-auditor | `/loom-init` |
| **Strategy & UX** | strategy-agent, ux-agent | `/loom-review-plan`, `/loom-review-roadmap`, `/loom-review-code` |
| **Roadmap** | roadmap-builder, scope-feasibility, questioner | `/loom-roadmap --init` |
| **Planning** | feature-coverage, phasing, parallelization, agentic-workflow, plan-builder | `/loom-review-plan`, `/loom-create-plan` |
| **Execution** | contracts, implementer, api-route-creator, api-connector, wiring, verification | `/loom-execute-plan` |
| **Testing** | acceptance-criteria, unit-test, e2e-test | `/loom-test-plan` |
| **Code Review** | security, architecture, plan-compliance + 6 built-in reviewers | `/loom-review-code` |
| **Extended Review** | performance, accessibility, dependency-auditor, api-design, database-schema, infra, observability | `/loom-review-code --full` |
| **Convergence** | target-parser, harness-builder, delta-analyzer, convergence-driver | `/loom-converge` |
| **Architecture** | tech-stack-debater, migration-architect | debate/chain patterns |
| **Wiki** | wiki-maintainer, wiki-ingest, wiki-lint, wiki-query | `/loom-ingest`, `/loom-lint`, execution events |
| **Documentation** | docs-generator, docs-auditor, project-guidance | `/loom-init`, docs workflows |
| **Utility** | meta-agent, tdd-coach, fixer-agent | `/loom-create-agent`, `/loom-fix-code` |

## Per-Project Extensibility

Create `.claude/orchestration.toml` in any project to add custom agents:

```toml
[review.agents.hipaa-reviewer]
source = ".claude/agents/hipaa-reviewer.md"
model = "sonnet"
modes = ["default", "full"]
outputRole = "reviewer"

[execution.agents.migration-agent]
source = ".claude/agents/migration-agent.md"
model = "opus"
phase = "post-contracts"
outputRole = "producer"
```

Or use `/loom-create-agent` to interactively create an agent and wire it into a pipeline.

## Orchestration Patterns

Beyond fan-out and pipeline, configure advanced patterns in `orchestration.toml`:

- **Debate** — adversarial multi-round reasoning for architecture decisions
- **Chain** — progressive refinement (draft → refine → harden)
- **Vote** — parallel independent solutions + evaluator picks best
- **Triage** — cheap router classifies tasks, routes to appropriate specialist
- **Converge** — iterative comparison against deterministic targets until delta reaches zero

## Data Formats

- **TOON** (Token-Oriented Object Notation) for all on-disk artifacts and agent communication — 30-60% token savings
- **JSON** for schema validation only (AJV test schemas)

## Hooks (Deterministic Enforcement)

Seven Claude Code hooks in `hooks/` enforce critical invariants at the tool-call level:

| Hook | Event | What it does |
|------|-------|-------------|
| `file-ownership` | PreToolUse | Blocks writes outside agent's file ownership boundary |
| `contract-lock` | PreToolUse | Locks `contracts/` after Wave 0 |
| `budget-tracker` | PreToolUse + SubagentStop | Tracks agent count, blocks spawns at budget limit |
| `status-updater` | SubagentStop | Updates status.toon timestamps |
| `quality-gate` | Stop | Prevents premature pipeline stops |
| `typecheck-on-write` | PostToolUse | Runs tsc after TS writes, feeds errors back |
| `wiki-write-guard` | PreToolUse | Enforces wiki page format and cross-ref integrity on writes to `.loom/wiki/` |

All hooks use a shared harness (`hooks/lib/run-hook.ts`) that adopts Hookify's defensive patterns: always exit 0 on errors, fail open on missing state, atomic stdin consumption. Registered in `.claude/settings.json`.

## Wiki Maintenance

The project wiki (`.loom/wiki/`) stays current automatically. Wiki-maintainer-agent runs in the background at four state-change points in the workflow — capturing decisions as they're made, not after the fact:

| Trigger | Event type | What's captured |
|---------|-----------|-----------------|
| `/loom-roadmap` (after write) | `roadmap-created` | Strategic intent, features, milestones, constraints |
| `/loom-create-plan` (after validation) | `plan-created` | Architecture, schemas, API contracts, phase structure |
| `/loom-execute-plan` (after each wave) | `wave-complete` | Contracts, implementation decisions, files built |
| `/loom-fix-code` (after verification) | `fixes-applied` | Applied fixes, unfixable items as design constraints |

All triggers are **non-blocking** — wiki failures are logged but never gate the pipeline. `/loom-auto` includes these same triggers plus its own orchestration-level wiki updates.

For manual wiki management: `/loom-ingest` (add content), `/loom-lint --wiki` (health check), `/loom-note --tag wiki` (capture notes for later ingestion).

## Persistence

- `.loom/wiki/` — persistent knowledge base: wiki pages, index, operation log (git-tracked)
- `.plan-execution/` — ephemeral execution state (gitignored)
- `.plan-history/` — reviews, decisions, wave summaries, milestones (git-tracked)

## Tests

```bash
# Protocol tests
cd test/protocol && bun install && bunx vitest run

# Hook tests
cd hooks && bun install && bunx vitest run
```

117 tests validating the inter-agent protocol: schema validation (with TOON roundtrip fidelity), plan validation (structure, dependency cycles, critical path, file ownership, sizing, criteria quality), scope coverage (orphan detection, drift tracking), context compression, agent monitoring (graded E2E rubric), handoff chains, file ownership detection, and feedback logging.

## File Structure

```
agents/                     46 agent definitions
  protocols/                 23 protocol specs
commands/                    20 slash commands
hooks/                       7 deterministic enforcement hooks
  lib/                       Shared harness + TOON reader + context resolver
  __tests__/                 Hook tests
.claude/settings.json        Hook registrations
skills/library.yaml          Library registry (commands, agents, infrastructure)
install.sh                   Curl-friendly minimal bootstrap
.loom/wiki/                  Persistent knowledge base (git-tracked)
test/protocol/               Protocol tests
test-fixtures/               Test plan fixtures (valid + broken)
```

# Loom

A multi-agent pipeline for planning, executing, testing, and reviewing software projects with Claude Code.

## What It Does

Ten noun-grouped commands that compose 48+ specialized agents:

**Core Commands**
| Command | Subcommands | What it does |
|---------|-------------|-------------|
| `/loom` | init, auto, converge, quick, pause, resume, do, next, profile, status, debate, chain, vote, triage | Root command — project lifecycle, session management, orchestration patterns |
| `/loom-plan` | create, review, execute, test, status | Plan lifecycle — create from roadmap, 6-agent review, wave execution, test generation |
| `/loom-code` | review, fix | Code quality — 9+ parallel reviewers, auto-apply fixes with contract checking |
| `/loom-roadmap` | init, review, approve, add, insert, remove, reorder, explore, refine, validate, status, deps, diff, history, milestone, snapshot | Roadmap lifecycle — strategy, multi-persona brainstorming, dependency graphs |
| `/loom-wiki` | ingest, lint, query, status | Wiki management — ingest sources, health checks, search and synthesis |
| `/loom-agent` | create, list | Agent management — create bespoke agents, view registered agents |
| `/loom-note` | (add), --review, --assimilate, --backlog, --promote | Notes and backlog — capture ideas, promote to roadmap |
| `/loom-library` | list, use, sync, update, search, add, remove | Catalog management — install, sync, update agents and commands |
| `/loom-git` | commit, push, pr, merge, cleanup, review-pr | Git workflow automation |
| `/loom-statusline-setup` | — | Configure the Claude Code status line (Starship integration) |

## Install

**One-liner** (works for public and private repos):
```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

Installs a minimal bootstrap into `~/.claude/`: the library catalog, infrastructure (statusline renderer, update checker), and three core commands (`/loom-library`, `/loom`, `/loom-statusline-setup`). Everything else is pulled on demand. Falls back to `gh api` for private repos.

**Pull what you need:**
```
/loom-library use loom-plan      — plan lifecycle + all execution agents
/loom-library use loom-code      — code review + fixer agents
/loom-library use loom-roadmap   — roadmap + brainstorming agents
/loom-library use loom-wiki      — wiki agents
```

**Ongoing management:**
```
/loom-library list               — see what's installed vs available
/loom-library sync               — re-pull all installed items, detect changes
/loom-library update             — fetch new catalog entries + update everything
```

**Uninstall:**
```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/uninstall.sh | bash
```

## Architecture

```
Commands (noun-grouped)             Agents (spawned by subcommands)
───────────────────────             ────────────────────────────────
/loom-init ──────────────────────→ project-guidance + api-explorer + docs-auditor
/loom-auto ──────────────────────→ prompt-refiner → scope-interrogator → roadmap → plan → execute → test → review → fix
/loom-debate/chain/vote/triage ──→ multi-agent orchestration patterns
/loom-roadmap init ──────────────→ questioner → roadmap-builder
/loom-roadmap review ────────────→ 4 review agents (parallel)
/loom-roadmap explore ───────────→ 3-6 persona agents (multi-round brainstorming)
/loom-plan create ───────────────→ plan-builder (reads scope contract)
/loom-plan review ───────────────→ 6 planning agents (parallel)
/loom-plan execute ──────────────→ contracts → implementers → wiring → verification (per wave)
/loom-plan test ─────────────────→ criteria → unit-test → e2e-test
/loom-code review ───────────────→ 6 built-in + 3 bespoke reviewers + contract checking
/loom-code fix ──────────────────→ parallel fixer-agents
/loom-converge ──────────────────→ target-parser → harness → delta-analyzer → driver
/loom-wiki ingest ───────────────→ wiki-ingest-agent → wiki-maintainer-agent
/loom-wiki lint ─────────────────→ wiki-lint-agent + contract/plan validators

Pre-flight (scope contract system)
──────────────────────────────────
prompt-refiner-agent          ← Expands loose prompts into structured briefs
questioner-agent (enhanced)   ← Proposal-based scope interrogation with brownfield awareness
scope-contract.toon           ← Locked decisions, acceptance criteria, non-goals → feeds all agents

Infrastructure (background)
───────────────────────────
statusline-renderer.cjs       ← Pipeline state + worktree-aware dir display + update indicator
loom-update-checker.cjs       ← Background catalog version check (4h throttle)

Protocols (24 shared contracts)
───────────────────────────────
agent-result.schema.md        ← Standard return envelope
scope-contract.schema.md      ← Pre-flight decisions, criteria, contract evolution
state.schema.md               ← Execution state for resume
pipeline-state.schema.md      ← Autonomous pipeline state
execution-conventions.md      ← File ownership, context tiers, TOON format
orchestration-patterns.md     ← Debate, chain, vote, triage, converge patterns
plan.schema.md / spec.schema.md ← Plan + v2 spec formats
roadmap.schema.md             ← Roadmap format
wiki-*.schema.md              ← Wiki page, index, log schemas
validation-rules.md           ← Output validation, blocker gates, plan validation
agent-monitoring.schema.md    ← Progress reporting, stale detection, dashboards
behavioral-guidelines.md      ← Karpathy-inspired agent guardrails
```

## Workflows

### Full pipeline (maximum control)

```
/loom-init                              Brownfield onboarding → CLAUDE.md + wiki
/loom-roadmap init --brownfield         Create roadmap informed by existing code
/loom-roadmap explore "feature idea"    Multi-persona brainstorming (optional)
/loom-roadmap review                    4 agents review in parallel
/loom-roadmap approve                   Lock roadmap
/loom-plan create                       Generate PLAN.md (reads scope contract)
/loom-plan review                       6 agents analyze plan
/loom-plan create --review-integrate    Apply review findings
/loom-plan execute                      Wave-by-wave build with contract drift detection
/loom-plan test --run                   Generate and run tests
/loom-code review                       9+ reviewers + contract compliance
/loom-code fix                          Auto-apply findings
```

### Autonomous (1-shot)

Pre-flight scope contract → hands-off execution through full roadmap.

```
/loom-auto --from "add user auth with RBAC and team management"
```

Flow: prompt refiner → scope interrogation (5-15 decisions with code examples) → roadmap → plan → execute → converge → test → review → fix. Circuit breakers stop the loop if stuck. Contract drift detection per wave.

Flags: `--skip-preflight`, `--light-preflight`, `--auto` (accept all defaults).

### Quick task

```
/loom-quick "add rate limiting to the API endpoints"
```

### Multi-persona brainstorming

```
/loom-roadmap explore "should we add real-time collaboration?"
/loom-roadmap explore "AI search" --depth deep --personas engineer,designer,pm,security,skeptic
```

Spawns 3-6 persona agents (engineer, designer, PM, security, ops, user, skeptic, data) for 1-3 rounds of structured exploration. Interactive between rounds — focus, add personas, or trigger a debate.

### Orchestration patterns

Invoke directly or as flags on any command:

```
/loom-debate "Redis vs Postgres for sessions"
/loom-chain "draft auth API spec"
/loom-vote "best caching strategy" --candidates 3
/loom-triage "fix this production error"

/loom-plan create --debate "monolith vs microservices"
/loom-roadmap init --debate "build vs buy for auth"
```

### Session management

```
/loom-pause                     Snapshot state, WIP commit
/loom-resume                    Restore context, continue where you left off
/loom-next                      State-aware suggestion for next step
/loom-do "review my code"       Natural language routing to the right command
/loom-status                    Project overview
```

## Pre-flight Scope Contract

The scope contract system converts a loose prompt into a comprehensive decision manifest before any execution begins:

1. **Prompt Refiner** — takes "add auth" and expands it into a structured brief by scanning the codebase
2. **Scope Interrogator** — proposal-based decisions (not bare questions): shows 2-3 concrete options with code examples, each with implied acceptance criteria
3. **scope-contract.toon** — locked decisions, assumptions, non-goals, testable success criteria

The contract flows through the entire pipeline:
- Roadmap reads it → features from decisions, constraints from non-goals
- Plan reads it → architecture constraints, acceptance criteria seeds
- Execution reads it per wave → contract drift detection
- Code review checks against it → `[CONTRACT]` tag for violations
- Wiki captures decisions as pages automatically

Supports brownfield context: reads wiki pages, init-report, CLAUDE.md to make proposals specific to existing code ("Your codebase already has JWT middleware at `src/middleware/auth.ts`...").

## Agent Groups

| Group | Agents | Used by |
|-------|--------|---------|
| **Pre-flight** | prompt-refiner, questioner (scope interrogator) | `/loom-auto`, `/loom-roadmap init` |
| **Onboarding** | project-guidance, api-explorer, docs-auditor | `/loom-init` |
| **Strategy & UX** | strategy-agent, ux-agent | `/loom-plan review`, `/loom-roadmap review`, `/loom-code review` |
| **Roadmap** | roadmap-builder, scope-feasibility, questioner | `/loom-roadmap init` |
| **Planning** | feature-coverage, phasing, parallelization, agentic-workflow, plan-builder | `/loom-plan review`, `/loom-plan create` |
| **Execution** | contracts, implementer, api-route-creator, api-connector, wiring, verification | `/loom-plan execute` |
| **Testing** | acceptance-criteria, unit-test, e2e-test | `/loom-plan test` |
| **Code Review** | security, architecture, plan-compliance + 6 built-in reviewers | `/loom-code review` |
| **Extended Review** | performance, accessibility, dependency-auditor, api-design, database-schema, infra, observability | `/loom-code review --full` |
| **Convergence** | target-parser, harness-builder, delta-analyzer, convergence-driver | `/loom-converge` |
| **Architecture** | tech-stack-debater, migration-architect | debate/chain patterns |
| **Wiki** | wiki-maintainer, wiki-ingest, wiki-lint, wiki-query | `/loom-wiki`, execution events |
| **Documentation** | docs-generator, docs-auditor, project-guidance | `/loom-init`, docs workflows |
| **Utility** | meta-agent, tdd-coach, fixer-agent | `/loom-agent create`, `/loom-code fix` |

## Per-Project Extensibility

Create `.claude/orchestration.toml` in any project to add custom agents and configure model profiles:

```toml
[settings]
modelProfile = "balanced"    # quality | balanced | budget

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

Or use `/loom-agent create` to interactively create and register an agent.

## Orchestration Patterns

Available as direct commands (`/loom-debate`) or flags on any command (`--debate`):

| Pattern | Best for | How it works |
|---------|----------|-------------|
| **Debate** | Decisions with tradeoffs | Advocate + critic argue N rounds, moderator synthesizes |
| **Chain** | Progressive refinement | Draft → refine → harden pipeline |
| **Vote** | Critical implementations | N parallel solutions, evaluator picks best |
| **Triage** | Mixed-complexity work | Cheap router classifies, routes to specialist |
| **Converge** | Deterministic targets | Iterative comparison until delta = 0 |

## Wiki Maintenance

The project wiki (`.loom/wiki/`) stays current automatically at state-change points:

| Trigger | What's captured |
|---------|-----------------|
| `/loom-roadmap` (after write) | Strategic intent, features, milestones, constraints |
| `/loom-plan create` (after validation) | Architecture, schemas, API contracts, phase structure |
| `/loom-plan execute` (after each wave) | Contracts, implementation decisions, files built |
| `/loom-code fix` (after verification) | Applied fixes, unfixable items as design constraints |

All triggers are non-blocking. For manual management: `/loom-wiki ingest`, `/loom-wiki lint`, `/loom-wiki query "question"`.

## Data Formats

- **TOON** (Token-Oriented Object Notation) for all on-disk artifacts and agent communication — 30-60% token savings
- **JSON** for schema validation only (AJV test schemas)

## Hooks (Deterministic Enforcement)

Seven Claude Code hooks enforce critical invariants at the tool-call level:

| Hook | Event | What it does |
|------|-------|-------------|
| `file-ownership` | PreToolUse | Blocks writes outside agent's file ownership boundary |
| `contract-lock` | PreToolUse | Locks `contracts/` after Wave 0 |
| `budget-tracker` | PreToolUse + SubagentStop | Tracks agent count, blocks spawns at budget limit |
| `status-updater` | SubagentStop | Updates status.toon timestamps |
| `quality-gate` | Stop | Prevents premature pipeline stops |
| `typecheck-on-write` | PostToolUse | Runs tsc after TS writes, feeds errors back |
| `wiki-write-guard` | PreToolUse | Enforces wiki page format and cross-ref integrity |

## Persistence

- `.loom/wiki/` — persistent knowledge base: wiki pages, index, operation log (git-tracked)
- `.plan-execution/` — ephemeral execution state, scope contract (gitignored)
- `.plan-history/` — reviews, decisions, explorations, wave summaries, milestones (git-tracked)

## Tests

```bash
# Protocol tests (bun or npm — either works)
cd test/protocol && npm install && npx vitest run

# Hook tests
cd hooks && npm install && npx vitest run
```

## Acknowledgments

The wiki system and agent behavioral guidelines draw from Andrej Karpathy's observations on LLM failure patterns. See [docs/design-philosophy.md](docs/design-philosophy.md) for details.

## License

[MIT](LICENSE)

## File Structure

```
agents/                     48 agent definitions (including prompt-refiner)
  protocols/                 24 protocol specs (including scope-contract)
commands/                    10 noun-grouped commands
hooks/                       7 deterministic enforcement hooks
  lib/                       Shared harness + TOON reader + context resolver
  __tests__/                 Hook tests
skills/library.yaml          Library registry (commands, agents, infrastructure)
install.sh                   Curl-friendly minimal bootstrap (gh api fallback)
.loom/wiki/                  Persistent knowledge base (git-tracked)
test/protocol/               Protocol tests
test-fixtures/               Test plan fixtures (valid + broken)
```

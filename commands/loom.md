# Loom

Display a concise reference for Loom — its commands, agents, and workflows.

## Instructions

Print the following help text exactly, then stop. Do not add commentary.

---

## Loom

A multi-agent pipeline for planning, executing, and verifying software projects.

### Commands

| Command | Description |
|---------|-------------|
| `/loom-review-plan [path]` | Launch 5 planning agents in parallel to review a PLAN.md |
| `/loom-execute-plan [path]` | Execute a plan wave-by-wave with human approval gates |
| `/loom-execute-plan --init` | Scaffold a new PLAN.md template interactively |
| `/loom-execute-plan --dry-run` | Preview wave structure without executing |
| `/loom-execute-plan --resume` | Resume from `.plan-execution/state.toon` |
| `/loom-execute-plan --wave N` | Re-run a single wave |
| `/loom-execute-plan --contracts-only` | Run only Wave 0 (contracts) |
| `/loom-test-plan [path]` | Generate tests from plan acceptance criteria |
| `/loom-test-plan --criteria-only` | Extract test specs without generating tests |
| `/loom-test-plan --unit-only` | Generate unit tests only |
| `/loom-test-plan --e2e-only` | Generate E2E tests only |
| `/loom-test-plan --chrome` | Interactive E2E testing via Chrome MCP |
| `/loom-test-plan --run` | Generate AND run all tests |
| `/loom-test-plan --parallel` | Generate unit + E2E tests in parallel |
| `/loom-review-code` | Comprehensive review: built-in + bespoke agents in parallel |
| `/loom-review-code --branch` | Review all changes on current branch vs main |
| `/loom-review-code --pr 123` | Review a specific PR |
| `/loom-review-code --quick` | Fast: code style + security only |
| `/loom-review-code --full` | All reviewers including comments + types |
| `/loom-review-code --plan PLAN.md` | Include plan compliance check |
| `/loom-fix-code` | Auto-apply review findings with parallel fixer-agents |
| `/loom-fix-code --report <path>` | Apply findings from a specific report |
| `/loom-fix-code --severity critical,warning` | Filter findings by severity (default: critical + warning) |
| `/loom-fix-code --dry-run` | Show fix plan without applying changes |
| `/loom-fix-code --auto` | Skip approval gate after fixes |
| `/loom-fix-code --finding N` | Fix a single finding by number |
| `/loom-auto --from "description"` | Full autonomous pipeline: plan → build → test → review → fix loops |
| `/loom-auto --plan PLAN.md` | Autonomous pipeline from existing plan |
| `/loom-auto --resume` | Resume autonomous pipeline from saved state |
| `/loom-auto --max-iterations N` | Cap outer loop iterations (default: 3) |
| `/loom-auto --max-agents N` | Cap total agent spawns (default: 50) |
| `/loom-auto --dry-run` | Show pipeline plan without executing |
| `/loom-auto --stop-after <stage>` | Stop after named stage (roadmap, plan, execute, test, review, fix) |
| `/loom-review-roadmap [path]` | Launch 3 agents to review a ROADMAP.md |
| `/loom-roadmap` | Show unified status (roadmap + plan + milestones + progress) |
| `/loom-roadmap --init` | Create a new ROADMAP.md interactively (includes discussion phase) |
| `/loom-roadmap --init --plan` | Create a PLAN.md (v2 spec) from an approved ROADMAP.md |
| `/loom-roadmap --init --full` | Full pipeline: roadmap → review → plan → review (interactive) |
| `/loom-roadmap --init --from "desc"` | Create a roadmap from a one-line description |
| `/loom-roadmap --discuss` | Run discussion phase to surface architectural decisions |
| `/loom-roadmap --no-discuss` | Skip the discussion phase |
| `/loom-roadmap --auto` | Accept all recommended defaults without prompting |
| `/loom-roadmap --approve-roadmap` | Mark ROADMAP.md as approved (unlocks plan generation) |
| `/loom-roadmap --review-roadmap` | Trigger roadmap review (delegates to /loom-review-roadmap) |
| `/loom-roadmap --validate` | Run plan validation pipeline (stages 1-4) |
| `/loom-roadmap --validate --roadmap` | Run roadmap validation pipeline (stages 1-4) |
| `/loom-roadmap --validate --deep` | Full validation including agent feasibility + schema completeness |
| `/loom-roadmap --refine` | Refine plan using review history |
| `/loom-roadmap --refine --roadmap` | Refine roadmap using review history |
| `/loom-roadmap --review-integrate` | Apply plan review findings to PLAN.md |
| `/loom-roadmap --review-integrate --roadmap` | Apply roadmap review findings to ROADMAP.md |
| `/loom-roadmap --status` | Detailed execution + milestone progress |
| `/loom-roadmap --deps` | Show phase dependency graph + critical path |
| `/loom-roadmap --diff` | Compare current plan vs last snapshot |
| `/loom-roadmap --history` | Show plan revision history |
| `/loom-roadmap --milestone add/complete/list` | Manage milestones |
| `/loom-roadmap --snapshot` | Save current plan state for versioning |
| `/loom-library` or `/loom-library list` | Show installed items grouped by type |
| `/loom-library use <name>` | Install item from catalog, resolve dependencies |
| `/loom-library sync` | Re-pull all installed items, compare hashes |
| `/loom-library search <query>` | Search catalog by name/description |
| `/loom-library add <source>` | Add new item (local path or GitHub URL) |
| `/loom-library remove <name>` | Uninstall, warn about dependents |
| `/loom-library update` | Check all sources for changes |
| `/loom` | Show this reference |

### Agent Groups

**Roadmap** (spawned by `/loom-review-roadmap` and `/loom-roadmap --init`):
- `roadmap-builder-agent` — Creates ROADMAP.md files from descriptions and discussion output
- `scope-feasibility-agent` — Reviews roadmap scope, feature conflicts, milestone sizing
- `questioner-agent` — Surfaces architectural decisions before roadmap generation

**Planning** (spawned by `/loom-review-plan` and `/loom-roadmap --init --plan`):
- `feature-coverage-agent` — Audits schema, API surface, features against competitors
- `strategy-ux-agent` — Evaluates positioning, UX, theming, developer ergonomics
- `phasing-agent` — Reviews phase boundaries, dependencies, sequencing risks
- `parallelization-agent` — Designs execution waves, merge strategy, conflict prevention
- `agentic-workflow-agent` — Decomposes phases into context-bounded agent tasks
- `plan-builder-agent` — Creates v1/v2 PLAN.md files (v2 = spec-driven with API specs, state machines)

**Execution** (spawned by `/loom-execute-plan`):
- `contracts-agent` — Wave 0: creates shared types, interfaces, schemas on disk
- `implementer-agent` — Parallel worker within strict file ownership boundaries
- `wiring-agent` — Post-wave integration: barrel files, routes, imports, deps
- `verification-agent` — Quality gate: typecheck, tests, lint, ownership drift

**Testing** (spawned by `/loom-test-plan`):
- `acceptance-criteria-agent` — Extracts testable criteria from plan, outputs structured test specs
- `unit-test-agent` — Generates unit tests from contracts + acceptance criteria + source code
- `e2e-test-agent` — Generates Playwright E2E tests, supports `--chrome` and bowser integration

**Code Review** (spawned by `/loom-review-code`):
- *Built-in*: `code-reviewer`, `silent-failure-hunter`, `code-simplifier`, `test-analyzer`, `comment-analyzer`, `type-design-analyzer`
- `security-reviewer` — OWASP Top 10 audit: injection, auth, XSS, secrets, dependencies
- `architecture-reviewer` — Dependency direction, pattern consistency, contract conformance
- `plan-compliance-reviewer` — Deliverables, schema drift, acceptance criteria coverage

**Code Fix** (spawned by `/loom-fix-code`):
- `fixer-agent` — Parallel worker that applies review findings within file ownership boundaries

**Utility:**
- `meta-agent` — Generates new agents, skills, and commands from descriptions
- `tdd-coach` — Drives test-driven development (red-green-refactor cycle)

### Typical Workflow

```
Tier 1 — Roadmap (strategy):
1.  /roadmap --init              — discussion phase + ROADMAP.md creation
2.  /review-roadmap              — 3 agents review roadmap
3.  /roadmap --review-integrate --roadmap — apply roadmap review findings
4.  /roadmap --approve-roadmap   — lock roadmap, enable plan generation

Tier 2 — Plan (spec):
5.  /roadmap --init --plan       — generate v2 PLAN.md from approved roadmap
6.  /review-plan                 — 5 agents analyze plan in parallel
7.  /roadmap --review-integrate  — apply plan review findings
8.  /roadmap --deps              — verify dependency graph + critical path

Tier 3 — Build:
9.  /execute-plan --dry-run      — preview the wave structure
10. /execute-plan                — run the full pipeline with approval gates

Tier 4 — Qualify:
11. /test-plan --run             — generate and run all tests
12. /review-code                 — full code review
13. /fix-code                    — auto-apply review findings
14. /roadmap --status            — track progress across everything
```

Or for fully autonomous execution:
```
/loom-auto --from "description"    — plan, build, test, review, fix until done
```

### Execution Pipeline

```
Pre:    scope coverage check (maps criteria → tasks, flags orphans)
Wave 0: contracts-agent → verify → human gate
Wave N: implementer-agents (parallel) → wiring-agent → verify → scope drift check → human gate
        ↑ repeat for each wave
```

### Autonomous Pipeline (/loom-auto)

```
Outer Loop (max 3 iterations):
  Roadmap: roadmap --init → review-roadmap → integrate → approve
  Plan:    roadmap --init --plan → review-plan → integrate → validate
  Build:   execute-plan --auto (wave loop with automated gates)
  Qualify: test-plan → review-code → fix-code (max 2 fix cycles)
  Gate:    DONE / FIX / REVISE-PLAN / REVISE-ROADMAP / ESCALATE
```

Each agent returns a structured `AgentResult`. State is tracked in `.plan-execution/state.toon`. Cross-wave context is compressed into HOT/WARM/COLD tiers to stay under 10k tokens. Background agents report progress via `.plan-execution/progress/{taskId}.toon` — the orchestrator polls these files to render a live dashboard, detect stale/hung agents, and escalate via SendMessage. Orchestrators use the **lean pattern**: agents read their own `.md` instructions from disk instead of having them embedded in the prompt (see `execution-conventions.md`).

### File Structure (during execution)

```
.plan-execution/              — Ephemeral (gitignored)
  state.toon              — Execution state (resumable)
  rolling-context.md      — Compressed cross-wave context
  contracts/              — Shared types and interfaces
    manifest.toon         — Contract registry
  progress/               — Agent heartbeat files (monitoring)
    {taskId}.toon
  requests/               — Cross-boundary change requests
    {taskId}.toon
  scope-coverage.toon     — Acceptance criteria coverage matrix
  wave-N-summary.toon     — Per-wave results

.plan-history/                — Persistent (git-tracked)
  reviews/                — Review findings (roadmap + plan)
    YYYY-MM-DD-roadmap-review.toon
    YYYY-MM-DD-review.toon
  decisions/              — Architecture Decision Records
    NNN-description.md
  executions/             — Preserved wave summaries
    wave-N-summary.toon
  snapshots/              — Plan version snapshots
    YYYY-MM-DD-plan.md
  roadmap.toon            — Milestones, status, dependencies
  changelog.md            — Plan revision history
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
modes = ["default", "full"]     # which /review-code modes include it
outputRole = "reviewer"
```

Or use `meta-agent --register` to create an agent and wire it into a pipeline in one step.

### Distribution

Agents and commands are registered in `~/.claude/skills/library/library.yaml` and can be synced across machines via GitHub using the-library pattern.

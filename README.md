# Loom

A multi-agent pipeline for planning, executing, testing, and reviewing software projects with Claude Code.

## What It Does

Eight slash commands that compose 20+ specialized agents:

| Command | What it does |
|---------|-------------|
| `/loom-review-plan` | 5 agents analyze a PLAN.md in parallel |
| `/loom-execute-plan` | Wave-by-wave execution with contracts, parallel implementers, wiring, and verification |
| `/loom-test-plan` | Acceptance criteria extraction + unit + E2E test generation |
| `/loom-review-code` | 9 reviewers (6 built-in + 3 bespoke) with severity-ranked output |
| `/loom-fix-code` | Auto-apply review findings with parallel fixer-agents and verification |
| `/loom-roadmap` | Plan creation, milestone tracking, dependency graphs, versioning |
| `/loom-auto` | Fully autonomous pipeline with feedback loops |
| `/loom` | Full reference |

## Install

**Bootstrap** (first time):
```bash
git clone https://github.com/launchstack-dev/meta-orchestration.git
cd meta-orchestration
./install.sh
```

**Ongoing management** (after bootstrap):
```
/loom-library list           — see what's installed
/loom-library use <name>     — install an agent or command
/loom-library sync           — re-pull all items, detect changes
/loom-library update         — check for new catalog entries
```

The bootstrap script symlinks everything into `~/.claude/`. After that, `/loom-library` manages the catalog with dependency resolution, content hashing, and GitHub source support. Run `/loom` in Claude Code to verify.

## Architecture

```
Commands (user-facing)              Agents (spawned by commands)
──────────────────────              ───────────────────────────
/loom-review-plan ─────────────→ 5 planning agents (parallel)
/loom-execute-plan ────────────→ contracts → implementers → wiring → verification
/loom-test-plan ───────────────→ criteria → unit-test → e2e-test
/loom-review-code ─────────────→ 6 built-in + 3 bespoke reviewers
/loom-fix-code ────────────────→ parallel fixer-agents
/loom-roadmap ─────────────────→ plan-builder-agent
/loom-auto ───────────────────→ chains all commands with automated gates

Protocols (shared contracts)
────────────────────────────
agent-result.schema.md        ← Standard return envelope
state.schema.md               ← Execution state for resume
execution-conventions.md      ← File ownership, context tiers, TOON format
toon-format.md                ← TOON format specification
orchestration-config.schema.md ← Per-project agent registration
orchestration-patterns.md     ← Debate, chain, vote, triage patterns
validation-rules.md           ← Output validation, blocker gates, plan validation
plan.schema.md                ← PLAN.md format specification
agent-monitoring.schema.md    ← Progress reporting, stale detection, dashboards
```

## Typical Workflow

```
1. /loom-roadmap --init            Create a structured PLAN.md (codebase-aware)
2. /loom-roadmap --validate        Validate plan structure, deps, ownership, sizing
3. /loom-review-plan               5 agents analyze it in parallel
4. /loom-roadmap --review-integrate Apply review findings to the plan
5. /loom-roadmap --deps            Verify dependency graph + critical path
6. /loom-execute-plan --dry-run    Preview the wave structure
7. /loom-execute-plan              Run with approval gates (validation gate built-in)
8. /loom-test-plan --run           Generate and run tests
9. /loom-review-code               Full code review
10. /loom-fix-code                  Auto-apply review findings
```

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

## Orchestration Patterns

Beyond fan-out and pipeline, configure advanced patterns in `orchestration.toml`:

- **Debate** — adversarial multi-round reasoning for architecture decisions
- **Chain** — progressive refinement (draft → refine → harden)
- **Vote** — parallel independent solutions + evaluator picks best
- **Triage** — cheap router classifies tasks, routes to appropriate specialist

## Data Formats

- **TOON** (Token-Oriented Object Notation) for all on-disk artifacts and agent communication — 30-60% token savings
- **JSON** for schema validation only (AJV test schemas)

## Hooks (Deterministic Enforcement)

Six Claude Code hooks in `hooks/` enforce critical invariants at the tool-call level:

| Hook | Event | What it does |
|------|-------|-------------|
| `file-ownership` | PreToolUse | Blocks writes outside agent's file ownership boundary |
| `contract-lock` | PreToolUse | Locks `contracts/` after Wave 0 |
| `budget-tracker` | PreToolUse + SubagentStop | Tracks agent count, blocks spawns at budget limit |
| `status-updater` | SubagentStop | Updates status.toon timestamps |
| `quality-gate` | Stop | Prevents premature pipeline stops |
| `typecheck-on-write` | PostToolUse | Runs tsc after TS writes, feeds errors back |

All hooks use a shared harness (`hooks/lib/run-hook.ts`) that adopts Hookify's defensive patterns: always exit 0 on errors, fail open on missing state, atomic stdin consumption. Registered in `.claude/settings.json`.

## Persistence

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
agents/                     20+ agent definitions
  protocols/                 11 protocol specs (incl. plan.schema.md, toon-format.md)
commands/                    9 slash commands
hooks/                       6 deterministic enforcement hooks
  lib/                       Shared harness + TOON reader + context resolver
  __tests__/                 Hook tests
.claude/settings.json        Hook registrations
skills/library.yaml          Library registry
test/protocol/               Protocol tests
test-fixtures/               Test plan fixtures (valid + broken)
install.sh                   Symlink installer
```

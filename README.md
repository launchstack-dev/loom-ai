# Meta-Orchestration System

A multi-agent pipeline for planning, executing, testing, and reviewing software projects with Claude Code.

## What It Does

Six slash commands that compose 20+ specialized agents:

| Command | What it does |
|---------|-------------|
| `/review-plan` | 5 agents analyze a PLAN.md in parallel |
| `/execute-plan` | Wave-by-wave execution with contracts, parallel implementers, wiring, and verification |
| `/test-plan` | Acceptance criteria extraction + unit + E2E test generation |
| `/review-code` | 9 reviewers (6 built-in + 3 bespoke) with severity-ranked output |
| `/roadmap` | Plan creation, milestone tracking, dependency graphs, versioning |
| `/help` | Full reference |

## Install

```bash
git clone https://github.com/yourusername/meta-orchestration.git
cd meta-orchestration
./install.sh
```

This symlinks agents, commands, and protocols into `~/.claude/`. Run `/help` in Claude Code to verify.

## Architecture

```
Commands (user-facing)          Agents (spawned by commands)
──────────────────────          ───────────────────────────
/review-plan ─────────────────→ 5 planning agents (parallel)
/execute-plan ─��──────────────→ contracts → implementers → wiring → verification
/test-plan ───────────────────→ criteria → unit-test → e2e-test
/review-code ───────���─────────→ 6 built-in + 3 bespoke reviewers
/roadmap ─────────────���───────→ plan-builder-agent

Protocols (shared contracts)
────────────────────────────
agent-result.schema.md        ← Standard return envelope
state.schema.md               ← Execution state for resume
execution-conventions.md      ← File ownership, context tiers, TOON format
orchestration-config.schema.md ← Per-project agent registration
orchestration-patterns.md     ← Debate, chain, vote, triage patterns
validation-rules.md           ← Output validation, blocker gates, plan validation
plan.schema.md                ← PLAN.md format specification
agent-monitoring.schema.md    ← Progress reporting, stale detection, dashboards
```

## Typical Workflow

```
1. /roadmap --init            Create a structured PLAN.md (codebase-aware)
2. /roadmap --validate        Validate plan structure, deps, ownership, sizing
3. /review-plan               5 agents analyze it in parallel
4. /roadmap --review-integrate Apply review findings to the plan
5. /roadmap --deps            Verify dependency graph + critical path
6. /execute-plan --dry-run    Preview the wave structure
7. /execute-plan              Run with approval gates (validation gate built-in)
8. /test-plan --run           Generate and run tests
9. /review-code               Full code review
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

- **JSON** for on-disk storage and schema validation
- **TOON** (Token-Oriented Object Notation) for agent-to-agent communication — 30-60% token savings

## Persistence

- `.plan-execution/` — ephemeral execution state (gitignored)
- `.plan-history/` — reviews, decisions, wave summaries, milestones (git-tracked)

## Tests

```bash
cd test/protocol
npm install
npx vitest run
```

81 tests validating the inter-agent protocol: schema validation, plan validation (structure, dependency cycles, critical path, file ownership, sizing, criteria quality), context compression, handoff chains, file ownership detection, and feedback logging.

## File Structure

```
agents/                     20+ agent definitions
  protocols/                 7 protocol specs (incl. plan.schema.md)
commands/                    6 slash commands
skills/library.yaml         Library registry
test/protocol/              57 protocol tests
test-fixtures/              Test plan fixtures (valid + broken)
install.sh                  Symlink installer
```

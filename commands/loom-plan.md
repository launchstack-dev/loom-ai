---
description: "create, review, execute, test, status — plan lifecycle from roadmap to wave execution"
---
# Plan Manager

You manage plan operations for Loom: creating plans from roadmaps, reviewing them with parallel agents, executing them wave-by-wave, and generating tests.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands
- `create`: generate PLAN.md from an approved roadmap
- `review`: launch 6 specialized agents to review a plan in parallel
- `execute`: wave-by-wave plan execution with parallel agents
- `test`: generate and run acceptance criteria, unit, and E2E tests
- `status`: show plan progress
- `materialize`: convert an approved roadmap + completed plan into per-domain `contract-*` wiki pages (Phase 4 of PLAN-spec-upgrades.md; D-02 trigger surface)

Remaining arguments after the subcommand are passed to the subcommand handler.

### Pattern Flags (available on any subcommand)

These flags invoke a multi-agent pattern before or during the subcommand's main work:

- `--debate "question"`: Run an adversarial debate before proceeding. The debate result is injected as a constraint for the subcommand. E.g., `/loom-plan create --debate "monolith vs microservices"` debates the architecture before generating the plan.
- `--chain "task"`: Run a progressive refinement chain on a specific artifact produced by the subcommand.
- `--vote "problem"`: Run parallel independent agents on a specific decision point. E.g., `/loom-plan execute --vote task-3` produces 3 independent implementations of task-3 and picks the best.
- `--triage "task"`: Route a subtask through the triage classifier before execution.

When a pattern flag is present:
1. Read `~/.claude/protocols/orchestration-patterns.md` and `~/.claude/protocols/pattern-executor.md`
2. Execute the pattern first using the same logic as `/loom-debate`, `/loom-chain`, `/loom-vote`, or `/loom-triage`
3. Inject the pattern's result into the subcommand's context (e.g., debate recommendation becomes a locked decision for plan creation, vote winner replaces the single-agent implementation for a task)
4. Continue with the subcommand's normal flow

## Protocols

Before doing anything, read:
- `~/.claude/protocols/plan.schema.md` — the canonical PLAN.md format spec (v1 and v2)
- `~/.claude/protocols/spec.schema.md` — v2 spec section formats (API specs, state machines, error handling)
- `~/.claude/protocols/validation-rules.md` — plan validation stages, AgentResult validation, blocker gates, config validation
- `~/.claude/protocols/execution-conventions.md` — shared rules, directory structure, context compression
- `~/.claude/protocols/agent-result.schema.md` — the return format every agent must use
- `~/.claude/protocols/state.schema.md` — execution state structure
- `~/.claude/protocols/agent-monitoring.schema.md` — progress reporting, polling, stale detection, escalation

## Model Resolution

Before spawning any agent via the Agent tool, resolve which model it should use. Pass the resolved model as the `model` parameter on the Agent tool call.

**Resolution priority (highest wins):**

1. **Profile tier mapping** from `.claude/orchestration.toml` `[settings] modelProfile` → look up the agent's tier → use that tier's model
2. **Agent `.md` frontmatter** — read the `model:` field from the agent's instruction file (e.g., `model: sonnet`)
3. **Default** — omit the `model` parameter (inherits parent session's model)

**Tier mapping for this command's agents:**

| Agent | Tier |
|-------|------|
| plan-builder-agent, criteria-planner-agent, interpretation-reviewer-agent | planning |
| contracts-agent, implementer-agent, wiring-agent | execution |
| feature-coverage-agent, strategy-agent, ux-agent, phasing-agent, parallelization-agent, agentic-workflow-agent | review |
| verification-agent | verification |
| acceptance-criteria-agent, unit-test-agent, e2e-test-agent | utility |

**How to resolve:**

1. If `.claude/orchestration.toml` exists, read it once at the start of the subcommand.
2. Check for `modelProfile` under `[settings]`. If set (e.g., `balanced`), read the profile definition under `[settings.profiles.balanced]` to get per-tier model assignments.
3. For each agent spawn, look up the agent's tier in the table above, then use the profile's model for that tier.
4. If no profile is set, read the agent's `.md` frontmatter for `model:`.
5. Pass the resolved model on the Agent tool call: `model: "sonnet"` (or `"opus"` or `"haiku"`).

---

## Subcommand Dispatch

If no subcommand is provided, display:
```
/loom-plan -- Manage plan lifecycle: create, review, execute, test, materialize

Subcommands:
  create        Generate PLAN.md from an approved roadmap
  review        Launch 6 specialized agents to review a plan in parallel
  execute       Wave-by-wave plan execution with parallel agents
  test          Generate and run acceptance criteria, unit, and E2E tests
  status        Show plan progress
  materialize   Convert approved roadmap + completed plan into contract-* wiki pages

Examples:
  /loom-plan create                          Generate plan + criteria from ROADMAP.md
  /loom-plan create --auto                   Non-interactive plan creation
  /loom-plan create --v1                     Simpler plan without API specs
  /loom-plan create --estimate               Print token cost estimate without spawning agents
  /loom-plan create --skip-test-gen          Create plan only, skip criteria generation
  /loom-plan create --review-integrate       Apply review findings to PLAN.md
  /loom-plan create --autoconverge           After plan write, run document-mode convergence loop (see loom-plan/create.md Step 5)
  /loom-plan create --autoconverge --max-iterations N  Override convergence iteration cap (1–10; default 3)
  /loom-plan create --skip-critic            Skip plan-critic-agent and Step 1.7 revise pass
  /loom-plan review                          6-agent parallel plan review
  /loom-plan execute                         Execute PLAN.md wave-by-wave
  /loom-plan execute --dry-run               Preview wave structure
  /loom-plan execute --resume                Resume from saved state
  /loom-plan execute --auto                  Skip human approval gates
  /loom-plan execute --contracts-only        Run only Wave 0 contracts
  /loom-plan test                            Generate test suite from plan
  /loom-plan test --run                      Generate AND run tests
  /loom-plan status                          Show plan progress
  /loom-plan materialize                     Emit contract-* wiki pages from approved roadmap+plan
  /loom-plan materialize --dry-run           Print materialization plan without writing
  /loom-plan materialize --propose-partition Scaffold contract-partition.toon from entities
```

Otherwise, read the corresponding instruction file and follow it:

| Subcommand | Instruction File |
|------------|-----------------|
| `create` | Read `~/.claude/commands/loom-plan/create.md` |
| `review` | Read `~/.claude/commands/loom-plan/review.md` |
| `execute` | Read `~/.claude/commands/loom-plan/execute.md` |
| `test` | Read `~/.claude/commands/loom-plan/test.md` |
| `status` | Read `~/.claude/commands/loom-plan/status.md` |
| `materialize` | Read `~/.claude/commands/loom-plan/materialize.md` |

Read the file for the matched subcommand, then follow its instructions. Pass all remaining arguments (after the subcommand name) to the subcommand handler.

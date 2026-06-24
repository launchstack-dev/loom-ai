---
description: "Orchestration Config Schema"
---

# Orchestration Config Schema

Projects declare a `.claude/orchestration.toml` at the project root to register app-specific agents and orchestration patterns into the standard pipelines.

## Config File: `.claude/orchestration.toml`

```toml
# .claude/orchestration.toml — project-level agent pipeline config

[settings]
maxParallelAgents = 6       # cap concurrent agent spawns
defaultModel = "sonnet"     # default model for app-specific agents
persistHistory = true       # auto-write to planning/history/
dataFormat = "toon"         # "toon" | "json" for inter-agent data

# ─────────────────────────────────────────────────────────────
# Pipeline agents — plug into /review-plan, /execute-plan, etc.
# ─────────────────────────────────────────────────────────────

[[planning.agents]]
name = "hipaa-schema-validator"
source = ".claude/agents/hipaa-schema-validator.md"
model = "sonnet"
input = ["plan"]
outputRole = "blocker"       # reviewer | blocker

[[planning.agents]]
name = "domain-model-validator"
source = ".claude/agents/domain-model-validator.md"
model = "sonnet"
input = ["plan", "schema-definitions"]
outputRole = "reviewer"

[[execution.agents]]
name = "migration-agent"
source = ".claude/agents/migration-agent.md"
model = "opus"
phase = "post-contracts"     # pre-contracts | post-contracts | post-implementer | post-wiring
input = ["contracts", "implementer-results", "file-ownership"]
outputRole = "producer"      # producer | consumer

[[execution.agents]]
name = "seed-data-agent"
source = ".claude/agents/seed-data-agent.md"
model = "sonnet"
phase = "post-wiring"
input = ["contracts", "wave-summary"]
outputRole = "producer"

[[testing.agents]]
name = "compliance-test-agent"
source = ".claude/agents/compliance-test-agent.md"
model = "opus"
phase = "post-criteria"      # post-criteria | post-unit | post-e2e
input = ["test-spec", "contracts", "source-files"]
outputRole = "producer"

[[review.agents]]
name = "hipaa-security-reviewer"
source = ".claude/agents/hipaa-security-reviewer.md"
model = "sonnet"
input = ["diff", "plan"]
outputRole = "reviewer"
modes = ["default", "full"]  # quick | default | full

# ── Extended review agents (from loom agent expansion) ──────
# Register any combination below to include in /loom-review-code

[[review.agents]]
name = "performance-reviewer"
source = "~/.claude/agents/performance-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["default", "full"]

[[review.agents]]
name = "accessibility-reviewer"
source = "~/.claude/agents/accessibility-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["full"]

[[review.agents]]
name = "dependency-auditor"
source = "~/.claude/agents/dependency-auditor.md"
model = "sonnet"
input = ["diff", "package-json"]
outputRole = "reviewer"
modes = ["default", "full"]

[[review.agents]]
name = "api-design-reviewer"
source = "~/.claude/agents/api-design-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["full"]

[[review.agents]]
name = "database-schema-reviewer"
source = "~/.claude/agents/database-schema-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["full"]

[[review.agents]]
name = "infra-reviewer"
source = "~/.claude/agents/infra-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["full"]

[[review.agents]]
name = "observability-reviewer"
source = "~/.claude/agents/observability-reviewer.md"
model = "sonnet"
input = ["diff"]
outputRole = "reviewer"
modes = ["full"]

# ─────────────────────────────────────────────────────────────
# Orchestration patterns — advanced multi-agent coordination
# ─────────────────────────────────────────────────────────────

[patterns.arch-decision]
type = "debate"
agents = ["advocate-agent", "critic-agent"]
moderator = "synthesis-agent"
maxRounds = 3
trigger = "architecture-decision"  # when orchestrator encounters this label

[patterns.code-quality]
type = "chain"
agents = ["draft-agent", "refine-agent", "harden-agent"]
trigger = "code-generation"

[patterns.auth-impl]
type = "vote"
agents = ["jwt-agent", "session-agent", "oauth-agent"]
evaluator = "auth-evaluator"
isolation = "worktree"
trigger = "auth-implementation"

[patterns.smart-router]
type = "triage"
router = "triage-agent"
routerModel = "haiku"
specialists = { simple = "sonnet-worker", complex = "opus-worker" }
fanout = ["domain-a-agent", "domain-b-agent"]  # for multi-domain tasks

[patterns.design-convergence]
type = "converge"
targetParser = "target-parser"
harnessBuilder = "harness-builder"
deltaAnalyzer = "delta-analyzer"
driver = "convergence-driver"
maxIterations = 10
trigger = "convergence-task"

[patterns.design-convergence.tolerance]
pixel-diff = 0.98
json-deep-equal = 1.0
semantic-html = 0.95
row-diff = 1.0
text-diff = 0.99

[patterns.tdd-convergence]
type = "converge-criteria"
criteriaPlanner = "criteria-planner-agent"
harnessBuilder = "criteria-harness-builder"
deltaAnalyzer = "delta-analyzer"
driver = "convergence-driver"
maxIterations = 10
trigger = "criteria-convergence-task"

[patterns.tdd-convergence.reviewers]
security = "security-reviewer"
code-review = "code-reviewer"
performance = "performance-reviewer"

[patterns.tdd-convergence.blocking]
test-runner = true
security = true
code-review = true
performance = false

# ─────────────────────────────────────────────────────────────
# Wiki — persistent knowledge base configuration
# ─────────────────────────────────────────────────────────────

[wiki]
enabled = true                  # set to false to disable all wiki features
path = ".loom/wiki"             # wiki root directory (git-tracked)
maxPages = 500                  # page count circuit breaker
stalenessDays = 30              # days before a page is marked stale
archiveThresholdMultiplier = 3  # pages stale for stalenessDays * this value are archived
autoLint = true                 # run lint checks automatically
lintSchedule = "post-wave"      # "post-wave" | "post-execution" | "manual"

# Wiki hook behavior (consumed by hooks/wiki-session-status.ts,
# hooks/wiki-impact-warner.ts, hooks/wiki-commit-ledger.ts).
# All defaults are conservative: noise-controlled, non-blocking, fail-open.
# Set the env var LOOM_WIKI_HOOKS=0 to silence every wiki hook for a session.
sessionStatusEnabled = true     # set false to suppress the SessionStart status line entirely
sessionContext = "minimal"      # "off" | "minimal" | "full" — SessionStart context-loading tier
impactAck = "notify"            # "notify" | "require" — impact-warner escalation: emit info vs. request user confirmation
impactDedup = true              # per-file-per-session dedup on wiki-impact-warner; set false to fire every edit
sessionThrottle = true          # collapse to "+N additional signals" when 2+ wiki signals fired in last 5 min

# ─────────────────────────────────────────────────────────────
# Domain — abstraction layer for non-code projects
# ─────────────────────────────────────────────────────────────

[domain]
type = "code"                   # "code" | "research" | "creative" | "business" | custom
contractType = "type-files"     # "type-files" | "ontology" | "glossary" | "schema"
verificationPipeline = ["tsc --noEmit", "bun run lint", "bun test"]  # replaces hardcoded checks
```

## How Orchestrators Use This

Each orchestrator command should:

1. **Check for config**: Look for `.claude/orchestration.toml` at the project root
2. **Parse with TOML**: Standard TOML parsing (built into Node 22+ or use `smol-toml`)
3. **Merge agents**: Add project agents to the built-in agent list for that pipeline
4. **Respect phase/mode**: Only spawn agents whose `phase` or `modes` match the current execution point
5. **Inject input**: Map the `input` array to the actual data available at that pipeline stage
6. **Handle output**: `reviewer` → findings merged into reports. `producer` → files tracked in AgentResult. `blocker` → must pass before pipeline continues.
7. **Run patterns**: When a task label matches a pattern's `trigger`, use the pattern's orchestration strategy instead of the default fan-out.

## Output Contracts

All app-specific agents MUST return one of:

### For `reviewer` / `blocker` role:
```toon
reviewer: agent-name
findings[N]{id,severity,category,description,file,line,suggestion}:
  id-001,blocking,category-name,Description here,src/file.ts,42,Fix suggestion
summary:
  blocking: 0
  warning: 1
  info: 0
```

### For `producer` role:
Standard `AgentResult` (JSON or TOON format).

## Pattern Execution

### `debate`
```
Round 1: spawn agents[0] with task → collect output
Round 2: spawn agents[1] with task + agents[0]'s output → collect critique
Round 3: spawn agents[0] with critique → collect rebuttal
...repeat up to maxRounds...
Final: spawn moderator with all round outputs → synthesize
```

### `chain`
```
Step 1: spawn agents[0] with task → collect output + files
Step 2: spawn agents[1] with task + agents[0]'s output + files → collect
Step 3: spawn agents[2] with task + agents[1]'s output + files → collect
Result: final agent's output
```

### `vote`
```
Parallel: spawn all agents with same task (each in worktree if isolation="worktree")
Collect: all outputs
Evaluate: spawn evaluator with all outputs → picks winner or merges
Result: evaluator's choice, applied from winning worktree
```

### `triage`
```
Phase 1: spawn router (haiku, cheap) → classifies task complexity
Phase 2:
  simple → router handles directly
  complex → spawn specialist
  multi → fan out to multiple specialists
Result: specialist output(s)
```

### `converge` (target mode)
```
Phase 1: spawn target-parser → normalize source into target manifest
Phase 2: spawn harness-builder → create comparison infrastructure
Gate:    human approval of targets + tolerances
Loop:    harness → delta-analyzer → fixer-agents (parallel) → re-run harness
         Circuit break: stall | regression | budget | max iterations
Result:  convergence report (iterations, pass/fail per target, agents used)
```

### `converge-criteria` (criteria mode)
```
Phase 1: spawn criteria-planner → discover criteria, generate test stubs, configure reviewers
Phase 2: spawn criteria-harness-builder → create test + review harness
Gate:    human approval of criteria plan + test stubs
Loop:    tests + reviewers → delta-analyzer → fixer-agents (layered priority) → re-run
         Fix order: test failures → security → code review → advisory
         Conflict detection: oscillating findings → freeze criterion
         Circuit break: stall | regression | all-frozen | budget | max iterations
Result:  convergence report (iterations, pass/fail per criterion, frozen conflicts)
```

## Kit Agent Registration

Kit agents are domain-specific agents installed via kits. They register in orchestration.toml under `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]`, using `insertionPoint` instead of `phase`.

**Key distinction:** The `phase` field is for project-specific agents registered under `[[execution.agents]]` or `[[testing.agents]]`. The `insertionPoint` field is for kit agents registered under `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]`. These are separate axes and do not conflict.

### Kit Agent Registration: `[[kit.<name>.agents]]`

```toml
[[kit.<name>.agents]]
name = "agent-name"              # required — must use kit prefix
source = "path/to/agent.md"     # required — agent prompt file
model = "sonnet"                 # optional — defaults to settings.defaultModel
insertionPoint = "pre-verify"    # required — one of: pre-scope, post-scope, pre-execute, post-execute, pre-verify, post-verify
outputRole = "reviewer"          # required — reviewer | producer | blocker
condition = "glob pattern"       # optional — agent only activates when matching files exist
```

### Kit Gate Registration: `[[kit.<name>.gates]]`

```toml
[[kit.<name>.gates]]
name = "gate-name"               # required — must use kit prefix
source = "path/to/gate.md"      # required — gate agent prompt file
model = "sonnet"                 # optional — defaults to settings.defaultModel
insertionPoint = "pre-execute"   # required — insertion point where gate checks run
failAction = "halt"              # required — halt | warn | retry
condition = "glob pattern"       # optional — gate only activates when matching files exist
```

### Condition Field

The `condition` field uses glob patterns to conditionally activate kit agents. When present, the agent only runs if matching files exist in the project. Multiple patterns are separated by ` OR `.

```toml
condition = "**/*.sql OR **/dbt_project.yml OR **/models/**"
```

If `condition` is omitted, the agent runs unconditionally at its insertion point.

### Complete Example: Data Engineering Kit

```toml
# ─────────────────────────────────────────────────────────────
# Kit agents — domain-specific agents installed via kits
# ─────────────────────────────────────────────────────────────

[[kit.data-engineering.agents]]
name = "data-schema-reviewer"
source = "~/.claude/agents/data-schema-reviewer.md"
model = "sonnet"
insertionPoint = "pre-verify"
outputRole = "reviewer"
condition = "**/*.sql OR **/dbt_project.yml OR **/models/**"

[[kit.data-engineering.agents]]
name = "data-lineage-tracker"
source = "~/.claude/agents/data-lineage-tracker.md"
model = "sonnet"
insertionPoint = "post-execute"
outputRole = "producer"

[[kit.data-engineering.agents]]
name = "data-test-generator"
source = "~/.claude/agents/data-test-generator.md"
model = "sonnet"
insertionPoint = "post-verify"
outputRole = "producer"

[[kit.data-engineering.gates]]
name = "data-quality-gate"
source = "~/.claude/agents/data-quality-gate.md"
model = "sonnet"
insertionPoint = "pre-execute"
failAction = "halt"
condition = "**/*.sql OR **/dbt_project.yml OR **/models/**"
```

### How the Orchestrator Processes Kit Agents

1. **Load config** — Parse `orchestration.toml` and collect all `[[kit.*.agents]]` and `[[kit.*.gates]]` entries
2. **Evaluate conditions** — For each kit agent, check if `condition` glob matches any project files. Skip non-matching agents.
3. **Schedule by insertion point** — At each pipeline phase, fire all kit agents whose `insertionPoint` matches the current phase
4. **Gates run first** — At any insertion point, gates execute before non-gate agents. If a gate halts, non-gate agents at that insertion point do not run.
5. **Process results** — Kit agent results follow the standard AgentResult envelope. Gate agents additionally include gate fields (see `agent-result.schema.md`).

## Migration from YAML

If a project has `.claude/orchestration.yaml`, orchestrators should check for that as a fallback. TOML is preferred but YAML is still supported for backwards compatibility.

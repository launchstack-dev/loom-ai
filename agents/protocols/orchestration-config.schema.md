# Orchestration Config Schema

Projects declare a `.claude/orchestration.toml` at the project root to register app-specific agents and orchestration patterns into the standard pipelines.

## Config File: `.claude/orchestration.toml`

```toml
# .claude/orchestration.toml — project-level agent pipeline config

[settings]
maxParallelAgents = 6       # cap concurrent agent spawns
defaultModel = "sonnet"     # default model for app-specific agents
persistHistory = true       # auto-write to .plan-history/
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

### `converge`
```
Phase 1: spawn target-parser → normalize source into target manifest
Phase 2: spawn harness-builder → create comparison infrastructure
Gate:    human approval of targets + tolerances
Loop:    harness → delta-analyzer → fixer-agents (parallel) → re-run harness
         Circuit break: stall | regression | budget | max iterations
Result:  convergence report (iterations, pass/fail per target, agents used)
```

## Migration from YAML

If a project has `.claude/orchestration.yaml`, orchestrators should check for that as a fallback. TOML is preferred but YAML is still supported for backwards compatibility.

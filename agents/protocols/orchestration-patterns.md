# Orchestration Patterns

Reusable multi-agent coordination patterns that orchestrator commands can invoke. Each pattern defines a specific interaction topology between agents, with deterministic orchestration logic that the orchestrator executes step-by-step.

All patterns are declared in `orchestration.toml` under `[patterns.<name>]` and triggered by orchestrator commands or other agents.

---

## Runtime Execution

For step-by-step execution mechanics, see `pattern-executor.md` in this directory. That protocol defines:

- **Trigger matching** — how orchestrators match task labels to pattern triggers from `orchestration.toml`
- **Per-pattern execution** — detailed agent spawn sequences for each pattern type
- **PatternResult format** — the standard return envelope all patterns produce:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Pattern name from orchestration.toml config |
| `type` | enum | yes | `debate`, `chain`, `vote`, or `triage` |
| `result` | string | yes | Final output or recommendation |
| `agentsUsed` | integer | yes | Total agents spawned (for budget tracking) |
| `transcript` | string | debate | Compressed argument history |
| `rounds` | integer | debate | Actual debate rounds completed |
| `solutions` | integer | vote | Number of solutions evaluated |
| `routing` | object | triage | `{ complexity, domains }` classification |

**Budget accounting:** Each pattern reports `agentsUsed`. The calling orchestrator accumulates this toward its agent budget (e.g., `/loom-auto --max-agents 50`). Warn at 80% budget consumed; hard-block pattern invocation at 100%.

---

## Pattern 1: Debate

**Description:** Two or more agents argue adversarially about a decision over multiple rounds. One agent advocates for a position, another critiques it. After N rounds, a moderator synthesizes the strongest arguments into a final recommendation.

### When to use

- Architecture decisions with significant tradeoffs (monolith vs. microservices, database selection)
- Technology selection where multiple options have legitimate merit
- Design reviews where confirmation bias is a risk
- Any decision that benefits from structured adversarial reasoning

### How it works

1. **Orchestrator receives** a decision prompt and the list of agents from the pattern config.
2. **Round 1 - Advocate:** Spawn agent A with the decision prompt. Collect its position and arguments.
3. **Round 1 - Critic:** Spawn agent B with the decision prompt AND agent A's output. Instruct B to find weaknesses, counter-arguments, and risks.
4. **Round 2..N - Rebuttal:** Feed B's critique back to A. A must address the specific criticisms and strengthen or revise its position. Then feed A's rebuttal to B for further critique.
5. **Synthesis:** After `maxRounds` complete (or agents converge), spawn the moderator agent with the full debate transcript. The moderator produces a structured recommendation with: decision, confidence level, key tradeoffs acknowledged, and dissenting considerations.

**Cost control:** Hard cap at `maxRounds` (default 3). Each agent call is a single spawn-collect cycle. Total cost = `(maxRounds * 2) + 1` agent invocations.

**Data flow:**
```
Advocate(prompt) -> position
Critic(prompt + position) -> critique
Advocate(prompt + critique) -> rebuttal
Critic(prompt + rebuttal) -> counter
... repeat to maxRounds ...
Moderator(full transcript) -> recommendation
```

### orchestration.toml config

```toml
[patterns.arch-debate]
type = "debate"
agents = ["advocate-agent", "critic-agent"]
moderator = "synthesis-agent"
maxRounds = 3
trigger = "architecture-decision"
```

| Field       | Type       | Required | Description                                         |
|-------------|------------|----------|-----------------------------------------------------|
| type        | `"debate"` | yes     | Pattern type identifier                              |
| agents      | string[]   | yes     | Exactly 2 agents: `[advocate, critic]`               |
| moderator   | string     | yes     | Agent that synthesizes the final recommendation      |
| maxRounds   | integer    | no      | Max debate rounds (default: 3, max: 5)               |
| trigger     | string     | yes     | Event or command that activates this pattern          |

### Example: Database selection debate

```toml
[patterns.db-selection]
type = "debate"
agents = ["postgres-advocate", "dynamodb-advocate"]
moderator = "data-architect"
maxRounds = 3
trigger = "database-decision"
```

Orchestrator execution:
1. Spawn `postgres-advocate` with: "Argue for PostgreSQL given these requirements: {requirements}"
2. Spawn `dynamodb-advocate` with: "Critique the PostgreSQL argument and argue for DynamoDB: {advocate-output}"
3. Spawn `postgres-advocate` with: "Address DynamoDB arguments: {critic-output}"
4. Spawn `dynamodb-advocate` with: "Final counter-arguments: {rebuttal-output}"
5. (Round 3 similarly)
6. Spawn `data-architect` with full transcript: "Synthesize a recommendation with tradeoffs."

---

## Pattern 2: Chain / Refinement

**Description:** A sequential pipeline where each agent's output becomes the next agent's input. Each step transforms, improves, or hardens the artifact. The chain is ordered and every agent must complete before the next starts.

### When to use

- Code generation with progressive quality improvement (draft, refine, harden)
- Document creation with review stages (outline, draft, edit, fact-check)
- Data transformation pipelines (extract, transform, validate)
- Any workflow where each step builds on the previous step's output

### How it works

1. **Orchestrator receives** the initial input and resolves the ordered agent list from config.
2. **Step 1:** Spawn agent[0] with the initial input. Collect output.
3. **Step 2:** Spawn agent[1] with agent[0]'s output (plus original input as context). Collect output.
4. **Step N:** Continue until all agents have run. Each receives the previous agent's output and optionally the original input.
5. **Final output:** The last agent's output is the chain result.

**Error handling:** If any agent in the chain fails or produces output that does not conform to the expected schema, the chain halts and returns the last successful output with an error annotation.

**Data flow:**
```
Agent-1(input) -> artifact-v1
Agent-2(artifact-v1, input) -> artifact-v2
Agent-3(artifact-v2, input) -> artifact-v3 (final)
```

### orchestration.toml config

```toml
[patterns.code-quality-chain]
type = "chain"
agents = ["draft-agent", "refine-agent", "harden-agent"]
trigger = "code-generation"
passOriginalInput = true
```

| Field              | Type       | Required | Description                                              |
|--------------------|------------|----------|----------------------------------------------------------|
| type               | `"chain"`  | yes      | Pattern type identifier                                  |
| agents             | string[]   | yes      | Ordered list of agents. Execution follows array order.   |
| trigger            | string     | yes      | Event or command that activates this pattern              |
| passOriginalInput  | boolean    | no       | Whether each step also receives the original input (default: true) |

### Example: Code generation pipeline

```toml
[patterns.impl-pipeline]
type = "chain"
agents = ["draft-agent", "refine-agent", "harden-agent"]
trigger = "code-generation"
passOriginalInput = true
```

Agent responsibilities:
- **draft-agent** (model: sonnet): Generates initial implementation from the spec. Optimizes for correctness and completeness. Output: working code + inline TODOs.
- **refine-agent** (model: sonnet): Receives draft code. Improves naming, extracts helpers, adds error handling, applies project conventions. Output: improved code.
- **harden-agent** (model: opus): Receives refined code. Adds edge-case handling, input validation, logging, security checks. Removes all TODOs. Output: production-ready code.

Orchestrator execution:
1. Spawn `draft-agent` with: "Implement this spec: {spec}"
2. Spawn `refine-agent` with: "Refine this implementation: {draft-output}. Original spec: {spec}"
3. Spawn `harden-agent` with: "Harden for production: {refined-output}. Original spec: {spec}"
4. Return harden-agent output as final result.

---

## Pattern 3: Voting / Consensus

**Description:** Multiple agents independently solve the same problem in isolation. An evaluator agent compares all solutions and selects the best one, or merges the strongest elements from each. Uses worktree isolation to prevent agents from seeing each other's work.

### When to use

- Critical implementations where correctness matters more than speed (auth, payments, crypto)
- Problems with multiple valid approaches where the best one is not obvious upfront
- High-stakes code where a single agent's blind spots could introduce vulnerabilities
- Situations where you want diversity of approach, not iterative refinement

### How it works

1. **Orchestrator receives** the problem statement and resolves the agent list from config.
2. **Isolation:** If `isolation = "worktree"`, create a separate git worktree for each agent. Otherwise, agents write to namespaced temp directories.
3. **Parallel solve:** Spawn all agents simultaneously, each with the identical problem statement. Agents work independently with no visibility into other agents' work.
4. **Collection:** Wait for all agents to complete. Gather each agent's solution artifact.
5. **Evaluation:** Spawn the evaluator agent with all solutions side-by-side. The evaluator scores each solution on defined criteria (correctness, security, readability, performance) and either picks the best or produces a merged solution taking the strongest parts of each.
6. **Cleanup:** Remove worktrees. Return the evaluator's chosen/merged solution.

**Cost:** N parallel agent invocations + 1 evaluator. More expensive than other patterns but produces higher-confidence results for critical code.

**Data flow:**
```
Agent-1(prompt) -> solution-1  \
Agent-2(prompt) -> solution-2   |-> Evaluator(all solutions) -> best/merged
Agent-3(prompt) -> solution-3  /
```

### orchestration.toml config

```toml
[patterns.auth-vote]
type = "vote"
agents = ["jwt-agent", "session-agent", "oauth-agent"]
evaluator = "auth-evaluator"
isolation = "worktree"
trigger = "auth-implementation"
```

| Field      | Type        | Required | Description                                              |
|------------|-------------|----------|----------------------------------------------------------|
| type       | `"vote"`    | yes      | Pattern type identifier                                  |
| agents     | string[]    | yes      | Agents that independently produce solutions              |
| evaluator  | string      | yes      | Agent that compares and selects/merges solutions         |
| isolation  | string      | no       | `"worktree"` or `"tempdir"` (default: `"worktree"`)      |
| trigger    | string      | yes      | Event or command that activates this pattern              |

### Example: Authentication implementation

```toml
[patterns.auth-vote]
type = "vote"
agents = ["jwt-agent", "session-agent", "oauth-agent"]
evaluator = "auth-evaluator"
isolation = "worktree"
trigger = "auth-implementation"
```

Orchestrator execution:
1. Create 3 worktrees: `wt-jwt`, `wt-session`, `wt-oauth`.
2. Spawn in parallel:
   - `jwt-agent` in `wt-jwt`: "Implement auth for this API using JWT: {spec}"
   - `session-agent` in `wt-session`: "Implement auth for this API using server sessions: {spec}"
   - `oauth-agent` in `wt-oauth`: "Implement auth for this API using OAuth2: {spec}"
3. Collect all three implementations.
4. Spawn `auth-evaluator` with: "Compare these 3 auth implementations against the spec. Score on: security, scalability, complexity, maintainability. Pick the best or merge strengths. {solution-1} {solution-2} {solution-3}"
5. Clean up worktrees. Return evaluator's output.

---

## Pattern 4: Supervisor / Triage

**Description:** A lightweight, cheap model (haiku) classifies incoming tasks by complexity and domain, then routes each task to the appropriate specialist agent. Avoids burning expensive model tokens on simple tasks while ensuring complex tasks get adequate capability.

### When to use

- Mixed-complexity workloads where most tasks are simple but some are hard
- Cost optimization: route 80% of tasks to cheap models, 20% to expensive ones
- Multi-domain projects where different specialists handle different areas
- High-volume task processing where triage pays for itself in saved tokens

### How it works

1. **Orchestrator receives** a task and spawns the router agent (haiku-class model).
2. **Classification:** The router analyzes the task and returns a structured routing decision:
   - `complexity`: simple | complex | multi-domain
   - `domains`: list of relevant domains (if multi-domain)
   - `reasoning`: one-line justification for the routing
3. **Routing:**
   - **Simple:** Router handles it directly (already has the context, avoids another spawn).
   - **Complex:** Orchestrator spawns the designated complex specialist (opus-class).
   - **Multi-domain:** Orchestrator fans out to multiple domain specialists in parallel, then collects and merges results.
4. **Return:** Specialist output returned as the pattern result. For multi-domain fan-out, results are merged by the orchestrator.

**Cost model:** The router call is cheap (haiku). Simple tasks cost only the router call. Complex tasks cost router + opus. The pattern saves money when >50% of tasks are simple.

**Data flow:**
```
Router(task) -> { complexity, domains }

if simple:   Router already produced answer -> done
if complex:  Opus-worker(task) -> result
if multi:    Domain-A(task-slice) + Domain-B(task-slice) -> merged result
```

### orchestration.toml config

```toml
[patterns.smart-triage]
type = "triage"
router = "triage-agent"
routerModel = "haiku"
trigger = "task-intake"

[patterns.smart-triage.specialists]
simple = "sonnet-worker"
complex = "opus-worker"
multi = ["domain-a", "domain-b"]
```

| Field            | Type       | Required | Description                                              |
|------------------|------------|----------|----------------------------------------------------------|
| type             | `"triage"` | yes     | Pattern type identifier                                  |
| router           | string     | yes      | Agent that classifies and routes tasks                   |
| routerModel      | string     | yes      | Model for the router (`"haiku"` recommended)             |
| trigger          | string     | yes      | Event or command that activates this pattern              |
| specialists      | object     | yes      | Map of complexity levels to specialist agents             |

### Example: Development task triage

```toml
[patterns.dev-triage]
type = "triage"
router = "task-classifier"
routerModel = "haiku"
trigger = "dev-task"

[patterns.dev-triage.specialists]
simple = "sonnet-worker"
complex = "opus-worker"
multi = ["frontend-specialist", "backend-specialist", "infra-specialist"]
```

Router classification prompt:
```
Classify this task:
- simple: Single-file changes, typo fixes, config updates, simple CRUD, boilerplate
- complex: Multi-file refactors, new features with edge cases, security-sensitive code, performance optimization
- multi: Requires changes across frontend + backend, or backend + infra, etc.

Return JSON: { "complexity": "simple|complex|multi", "domains": [...], "reasoning": "..." }
```

Orchestrator execution:
1. Spawn `task-classifier` (haiku): "Classify: {task}"
2. If `simple`: spawn `sonnet-worker` with task (or let router handle inline).
3. If `complex`: spawn `opus-worker` with task.
4. If `multi` with domains `["frontend", "backend"]`: spawn `frontend-specialist` and `backend-specialist` in parallel, merge results.

---

## Config Schema Reference

All patterns live under the `[patterns]` table in `orchestration.toml`. The general structure:

```toml
[patterns.<pattern-name>]
type = "debate" | "chain" | "vote" | "triage"
trigger = "<event-or-command-name>"
# ... type-specific fields
```

### Full example: orchestration.toml with all pattern types

```toml
# orchestration.toml — pattern declarations

[patterns.arch-debate]
type = "debate"
agents = ["advocate-agent", "critic-agent"]
moderator = "synthesis-agent"
maxRounds = 3
trigger = "architecture-decision"

[patterns.code-quality-chain]
type = "chain"
agents = ["draft-agent", "refine-agent", "harden-agent"]
trigger = "code-generation"
passOriginalInput = true

[patterns.auth-vote]
type = "vote"
agents = ["jwt-agent", "session-agent", "oauth-agent"]
evaluator = "auth-evaluator"
isolation = "worktree"
trigger = "auth-implementation"

[patterns.smart-triage]
type = "triage"
router = "triage-agent"
routerModel = "haiku"
trigger = "task-intake"

[patterns.smart-triage.specialists]
simple = "sonnet-worker"
complex = "opus-worker"
multi = ["domain-a", "domain-b"]
```

### Pattern selection guidance

| Pattern   | Best for                        | Cost     | Latency  | Confidence |
|-----------|---------------------------------|----------|----------|------------|
| Debate    | Decisions with tradeoffs        | Medium   | High     | High       |
| Chain     | Progressive artifact refinement | Medium   | High     | Medium     |
| Vote      | Critical implementations        | High     | Medium*  | Highest    |
| Triage    | Mixed-complexity workloads      | Low-Med  | Low      | Varies     |

*Vote has medium latency because agents run in parallel, despite higher total cost.

# Project Conventions

## Data Format: TOON Everywhere

All Loom on-disk artifacts, agent output formats, protocol schemas, state files, and inter-agent communication MUST use **TOON** (Token-Oriented Object Notation). This applies to:

- Agent result envelopes (AgentResult)
- Execution state, pipeline state, convergence state
- Progress/heartbeat files
- Contract manifests, wave summaries, scope coverage
- converge.config, Delta Reports, target manifests, fix lists
- Any new schema, protocol, or agent output format

**Exceptions** (these may use their native format):
- App-specific data being compared or generated (e.g., JSON API responses, SQL result sets, HTML output)
- Standard tooling config files (`package.json`, `tsconfig.json`, `orchestration.toml`, `library.yaml`)
- Hook stdin/stdout that follows Claude Code's protocol (JSON per Claude Code spec)

When creating a new agent, skill, command, or protocol: define its output format in TOON. If you find an existing Loom artifact using JSON where TOON should be used, convert it.

## TOON Quick Reference

```
key: value                                    # flat scalar
arrayName[N]: item1, item2, item3             # inline array
arrayName[N]{col1,col2,col3}:                 # typed array (table)
  val1a,val1b,val1c                           #   row per line, 2-space indent
  val2a,val2b,val2c
blockName:                                    # nested block
  nestedKey: value                            #   2-space indent
```

## Toolchain

- Prefer **bun** / **bunx** when available; fall back to **npm** / **npx** otherwise
- Use **vitest** for test suites in the meta-orchestration project

## Agent Conventions

- All agents return a standard AgentResult envelope in TOON (see `agents/protocols/agent-result.schema.md`)
- Execution agents write progress heartbeats to `.plan-execution/progress/{taskId}.toon`
- File writes must be atomic: write to `.tmp`, then rename
- **Model resolution is mandatory.** Before every Agent tool call, read the target agent's `.md` frontmatter `model:` field and pass `model: "{value}"` on the call. Resolution priority: (1) `orchestration.toml` profile tier, (2) frontmatter, (3) inherit parent. Never spawn an agent without resolving its model first.
- See `agents/protocols/execution-conventions.md` for directory structure and file naming

## Context Management

### Budget Cap

- **Hard cap: 100k tokens** per agent spawn (half the default 200k context window)
- With a 1M context window, the cap scales to 500k tokens
- The cap is configurable via `agentBudgetCap` in `.claude/orchestration.toml` under `[settings.contextBudget]`
- Spawns exceeding the cap are blocked with a suggestion to split the task

### Estimation Algorithm

- Token estimation uses the **characters / 4** heuristic (`Math.ceil(text.length / 4)`)
- File-based estimation uses `fs.statSync(path).size / 4` (byte size, not character count)
- A fixed **5000-token overhead** is added for system prompt, tool definitions, and formatting
- See `hooks/lib/token-estimator.ts` for implementation and `agents/protocols/context-budget.md` for the full spec

### Stage Summary Writes

- Every pipeline stage must write a StageContext summary to `.plan-execution/stage-context/{stage}.toon`
- Writes must be **atomic**: write to `{path}.tmp`, then `fs.renameSync` to `{path}`
- Stage summaries are the structured source of truth; `rolling-context.md` is the compressed derivative
- See `agents/protocols/stage-context.schema.md` for the full StageContext schema

### Budget Configuration

Configure context budget settings in `.claude/orchestration.toml`:

```toml
[settings.contextBudget]
contextWindow = 200000          # total context window (default 200k, set 1000000 for 1M)
# agentBudgetCap = 100000       # derived as contextWindow / 2 unless overridden
checkpointWarning = 0.35        # warn when this fraction of window remains
checkpointCritical = 0.25       # critical checkpoint when this fraction remains
```

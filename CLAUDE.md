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
- See `agents/protocols/execution-conventions.md` for directory structure and file naming

# Project Conventions

## Data Format: TOON Frozen (roadmap C-05, M-3)

**TOON is frozen, not migrated.** Existing TOON artifacts, schemas, and agent
envelopes stay exactly as they are — every existing contract remains
authoritative, and there is NO TOON→JSON conversion project. But the
"convert JSON you find to TOON" mandate is retired:

- **Existing artifacts:** keep their format. Do not convert in either
  direction; churning state files breaks resume compatibility for zero user
  value.
- **New schemas, protocols, and agent output formats:** MAY use JSON with
  schema validation (preferred where the consumer is a Workflow
  `agent(schema)` structured output or an engine CLI) or TOON — pick
  whichever the surrounding subsystem already speaks.
- **Never** teach a new consumer both formats for the same artifact; one
  artifact, one format.

Rationale: TOON's token-savings case is superseded by schema-validated
structured output and cheaper long context, while a bespoke notation every
agent must be taught is friction (`planning/ROADMAP-fable-readiness.md`
C-05).

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

- All agents return a standard AgentResult envelope in TOON (see `protocols/agent-result.schema.md`)
- Execution agents write progress heartbeats to `.plan-execution/progress/{taskId}.toon`
- File writes must be atomic: write to `.tmp`, then rename
- **Model resolution is mandatory.** Before every Agent tool call, read the target agent's `.md` frontmatter `model:` field and pass `model: "{value}"` on the call. Resolution priority: (1) `orchestration.toml` profile tier, (2) frontmatter, (3) inherit parent. Never spawn an agent without resolving its model first.
- See `protocols/execution-conventions.md` for directory structure and file naming

## Context Management

> **Scaffold layer — active only under the `strict` discipline profile**
> (`protocols/discipline.schema.md`). Everything in this section is
> compensation for harnesses without native context management; under
> `standard`/`minimal` these hooks self-bail and the native harness
> (auto-compaction, Workflow budget accounting) owns the job. Each scaffold
> component's file carries a deprecation note naming its replacement.

### Budget Cap

- **Hard cap: 100k tokens** per agent spawn (half the default 200k context window)
- With a 1M context window, the cap scales to 500k tokens
- The cap is configurable via `agentBudgetCap` in `.claude/orchestration.toml` under `[settings.contextBudget]`
- Spawns exceeding the cap are blocked with a suggestion to split the task

### Estimation Algorithm

- Token estimation uses the **characters / 4** heuristic (`Math.ceil(text.length / 4)`)
- File-based estimation uses `fs.statSync(path).size / 4` (byte size, not character count)
- A fixed **5000-token overhead** is added for system prompt, tool definitions, and formatting
- See `hooks/lib/token-estimator.ts` for implementation and `protocols/context-budget.md` for the full spec

### Stage Summary Writes

- Every pipeline stage must write a StageContext summary to `.plan-execution/stage-context/{stage}.toon`
- Writes must be **atomic**: write to `{path}.tmp`, then `fs.renameSync` to `{path}`
- Stage summaries are the structured source of truth; `rolling-context.md` is the compressed derivative
- See `protocols/stage-context.schema.md` for the full StageContext schema

### Budget Configuration

Configure context budget settings in `.claude/orchestration.toml`:

```toml
[settings.contextBudget]
contextWindow = 200000          # total context window (default 200k, set 1000000 for 1M)
# agentBudgetCap = 100000       # derived as contextWindow / 2 unless overridden
checkpointWarning = 0.35        # warn when this fraction of window remains
checkpointCritical = 0.25       # critical checkpoint when this fraction remains
```

## Extensibility Model

Loom is a platform you extend, not a fixed methodology. Every behavior is composed from five resource types, bundled into **kits**, and registered per-project.

**Resource types** (the `type:` field on every typed `includes:` entry):

| Type | Installs to | Purpose |
|---|---|---|
| `agent` | `.claude/agents/{name}.md` | Subagent definitions (frontmatter `model:` + system prompt) |
| `prompt` | `.claude/commands/{name}.md` | Slash commands users invoke (`/loom-...`) |
| `protocol` | `protocols/{name}.md` (or `.toon`/`.schema.md`) | Shared schemas, conventions, contracts read by multiple agents |
| `skill` | `~/.claude/skills/{name}/SKILL.md` | Procedural how-to guides Claude loads on demand |
| `infrastructure` | `hooks/`, `scripts/` | Deterministic enforcement (hooks) and tooling scripts |

**Kits** are bundles of these resources declared in `skills/library.yaml` (the canonical catalog). A kit's `includes:` field accepts the typed form `{type: skill, name: my-skill}` or a bare string resolved via the priority `agent > protocol > skill > prompt`.

**Authoring wizards** scaffold new resources from a guided interview:
- `/loom-agent create` — author a new agent (ships today)
- `/loom-skill create` — author a new skill (ships in Phase 8)

**Per-project registration** lives in `.claude/orchestration.toml`. Register custom reviewers, execution agents, and kit gates without touching Loom's core. See README `## Extending Loom` for the install vs author flow and a worked authoring example.

### Authoring Resources

**Quick wizards:**
- **Skill:** Run `/loom-skill create` for a guided interview that generates `skills/<name>/SKILL.md`, registers under `library.skills:`, and optionally adds the skill to a kit's typed `includes:`.
- **Agent:** Run `/loom-agent create` for a guided interview that generates a project-specific agent `.md` file and registers it in `orchestration.toml`.
- **Kit:** Hand-edit `skills/library.yaml` — add a new section entry (e.g., under `library.skills:` or `library.agents:`) and append a `kits:` entry with typed `includes:` like `{type: skill, name: <name>}`. (The `/loom-kit create` wizard is **future work** — not yet shipped.)
- **Protocol, prompt, infrastructure:** Hand-author the file at its target path (see the resource-type table in `## Extensibility Model` above) and register it under the corresponding `library.<section>:` in `skills/library.yaml`.

**Resource-type decision tree** — pick a resource by matching your goal to the "Use when" column:

| Resource type | Use when |
|---|---|
| **skill** | You want **domain conventions applied automatically** whenever matching files are open in a Claude Code session (e.g., language-specific patterns, framework preferences, coding-style rules). Activates via `triggers:` frontmatter or description-based matching; no orchestration overhead. Author with `/loom-skill create`. |
| **agent** | You need a **participant in a Loom pipeline stage** (review, execution, testing, planning) that produces structured findings, files, or AgentResult envelopes. Activates only when the pipeline calls it. Author with `/loom-agent create`. |
| **prompt** | You want a **user-invokable slash command** (`/loom-<thing>`) that runs in the foreground and prompts Claude to do a specific task on demand. Lives in `~/.claude/commands/`. Hand-author. |
| **protocol** | You're defining a **shared schema, message envelope, or contract** that multiple agents read to coordinate (e.g., `AgentResult`, `state.toon`, wave-summary formats). Lives in `protocols/`. Hand-author. |
| **infrastructure** | You need **deterministic enforcement** outside Claude's control loop — hooks (PreToolUse/PostToolUse/etc.) or scripts that run on real events. Lives in `hooks/` or `scripts/`. Hand-author; register with explicit `target:` path under `library.infrastructure:`. |

**Heuristic for choosing between skill and agent:** if a Claude Code user would want this knowledge to "just be there" whenever they open a relevant file, author a **skill**. If a Loom pipeline run would call it as a discrete stage, author an **agent**. When unsure, `/loom-library add <source>` runs a classification heuristic that prioritizes `triggers:` frontmatter (→ skill) over filename and surfaces an ambiguous-type prompt when the signal is unclear.

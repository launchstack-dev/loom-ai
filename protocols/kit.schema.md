# Kit Schema

Canonical schema for the kit abstraction. Kits are installable bundles of domain-specific agents, gates, and commands that plug into the Loom orchestration pipeline via insertion points.

## Kit Entry Format

Kits are registered in the `kits:` section of `library.yaml`.

### YAML Format (library.yaml)

```yaml
kits:
  - name: data-engineering
    description: Data pipeline quality gates, schema review, lineage tracking, and test generation
    version: 1.0.0
    minLoomVersion: 3
    includes:
      - data-schema-reviewer
      - data-test-generator
      - data-pipeline-agent
      - data-lineage-tracker
      - data-quality-gate
      - loom-data
    command: loom-data.md
    suggestedConfig: kits/data-engineering/orchestration-fragment.toml
```

### TOON Format (canonical)

```toon
name: data-engineering
description: Data pipeline quality gates, schema review, lineage tracking, and test generation
version: 1.0.0
minLoomVersion: 3
includes[6]: data-schema-reviewer, data-test-generator, data-pipeline-agent, data-lineage-tracker, data-quality-gate, loom-data
command: loom-data.md
suggestedConfig: kits/data-engineering/orchestration-fragment.toml
```

### Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| name | yes | string, unique | Kit identifier. Used as prefix for kit agents and TOML registration key. |
| description | yes | string, max 200 chars | Human-readable summary of what the kit provides. |
| version | yes | semver | Kit version following semantic versioning. |
| minLoomVersion | no | integer | Minimum `catalog_version` in library.yaml required to use this kit. |
| includes | yes | (string \| TypedInclude)[] | Library items bundled in this kit. Each entry is either a typed object `{ type, name }` (preferred, v4+) or a bare-string name (deprecated, removed in v5). See § Typed Includes (v4+). |
| command | no | string | Kit command file (relative to commands directory). |
| suggestedConfig | no | string | Path to an orchestration.toml fragment that projects can merge in. |

## Typed Includes (v4+)

The `includes:` array accepts two forms. The **typed form** is the v4-preferred shape; the **bare-name form** remains supported for backward compatibility but is deprecated and will be removed in catalog v5.

### Form 1 — Typed object (preferred, v4+)

Each include entry is `{ type, name }` where `type ∈ { agent, protocol, skill, prompt, infrastructure }` and `name` is the resource identifier as registered under the matching `library.<type>s` section in `library.yaml`.

```yaml
- name: python-conventions
  description: Python ecosystem conventions
  version: 0.1.0
  minLoomVersion: 4
  includes:
    - type: skill
      name: python-conventions
```

TOON equivalent:

```toon
name: python-conventions
description: Python ecosystem conventions
version: 0.1.0
minLoomVersion: 4
includes[1]{type,name}:
  skill,python-conventions
```

The installer dispatches the entry to the correct target path based on `type`:

| `type` | Installs to |
|---|---|
| `agent` | `.claude/agents/<name>.md` |
| `prompt` | `.claude/commands/<name>.md` |
| `protocol` | `protocols/<name>.md` (or `<name>.schema.md` / `<name>.toon`) |
| `skill` | `~/.claude/skills/<name>/SKILL.md` |
| `infrastructure` | `hooks/` or `scripts/` per the source path |

A `skill:` typed include resolves through `library.skills[]`; the installer never falls back to other resource types when the type is explicit.

### Form 2 — Bare-name string (legacy, deprecated)

Bare strings are still accepted for v3-era kits (e.g. the original `data-engineering` kit):

```yaml
includes:
  - data-schema-reviewer
  - python-conventions
```

The installer resolves bare names using the priority order `agents > protocols > skills > prompts` (locked in `hooks/lib/skill-router.ts` as `BARE_NAME_PRIORITY`). Each bare-name include emits a `DEPRECATION_WARNING` to stderr at install time; resolution still succeeds.

The colon-prefixed form (`skill:python-conventions`, `agent:contracts-agent`) is treated as already-typed and does not emit a deprecation warning — the installer strips the prefix and routes by `type`.

### Removal Timeline

- **v4 (current):** both forms accepted; bare-name form emits `DEPRECATION_WARNING` per include.
- **v5 (planned):** bare-name form removed. Kits MUST use typed `{ type, name }` objects (or the legacy colon-prefixed string). Catalogs containing bare-name includes will fail validation.

Kits authored today should use the typed form to avoid a forced rewrite at v5.

## Insertion Points

Kit agents register at specific pipeline insertion points rather than using the `phase` field used by project-specific agents. There are 6 insertion points:

| Insertion Point | When It Fires |
|---|---|
| pre-scope | Before scope contract generation in `/loom-auto` |
| post-scope | After scope contract is locked, before roadmap generation |
| pre-execute | Before each execution wave starts (before contracts-agent or implementers) |
| post-execute | After each execution wave completes (after wiring-agent finishes) |
| pre-verify | Before verification agent runs (typecheck, test, lint) |
| post-verify | After verification agent completes |

### Reconciliation with Existing Phase Vocabulary

Kit insertion points map to the existing `phase` values used by project-specific agents in `orchestration.toml`:

| Kit Insertion Point | Closest Existing Phase | When It Fires |
|---|---|---|
| pre-scope | (new — no equivalent) | Before scope contract generation in /loom-auto |
| post-scope | (new — no equivalent) | After scope contract locked |
| pre-execute | pre-contracts | Before contracts-agent or implementers in a wave |
| post-execute | post-wiring | After wiring-agent completes a wave |
| pre-verify | (new — fires before verification-agent) | Before typecheck/test/lint verification |
| post-verify | post-criteria, post-unit, post-e2e | After verification completes |

**Important distinction:** Kit agents use the `insertionPoint` field. Project-specific agents continue using the `phase` field. These are separate axes registered in different TOML sections (`[[kit.<name>.agents]]` vs `[[execution.agents]]`).

## Kit-Prefixed Naming Convention

All kit agents MUST use the kit name as a prefix in their agent name:

- `data-schema-reviewer` (kit: data-engineering)
- `ml-train-agent` (kit: ml-ops)
- `security-scan-agent` (kit: security)

### Enforcement

- `loom-library use` validates agent names at install time
- Agents listed in a kit's `includes` that do not use the kit name as prefix are rejected
- If an agent with the same name already exists from a different kit, installation warns and requires `--force` to proceed

### Collision Resolution

```
$ loom-library use ml-ops
warning: agent "data-schema-reviewer" conflicts with existing agent from kit "data-engineering"
         use --force to install anyway
```

## Data Engineering Agent Contracts

Pre-defined agents for the data-engineering kit:

| Agent | File | Insertion Point | Role | Template |
|---|---|---|---|---|
| data-schema-reviewer | agents/data-schema-reviewer.md | pre-verify | reviewer | database-schema-reviewer.md |
| data-test-generator | agents/data-test-generator.md | post-verify | producer | unit-test-agent.md |
| data-pipeline-agent | agents/data-pipeline-agent.md | (implementer — no insertion point) | producer | implementer-agent.md |
| data-lineage-tracker | agents/data-lineage-tracker.md | post-execute | producer | wiki-maintainer-agent.md |
| data-quality-gate | agents/data-quality-gate.md | pre-execute | gate | contracts-agent.md |

### Supported Targets

All data-engineering agents support the following targets:

- dbt
- Dagster
- Airflow
- BigQuery
- Bauplan
- raw SQL

### Agent Contract Summary (TOON)

```toon
agents[5]{name,file,insertionPoint,role,template}:
  data-schema-reviewer,agents/data-schema-reviewer.md,pre-verify,reviewer,database-schema-reviewer.md
  data-test-generator,agents/data-test-generator.md,post-verify,producer,unit-test-agent.md
  data-pipeline-agent,agents/data-pipeline-agent.md,(implementer),producer,implementer-agent.md
  data-lineage-tracker,agents/data-lineage-tracker.md,post-execute,producer,wiki-maintainer-agent.md
  data-quality-gate,agents/data-quality-gate.md,pre-execute,gate,contracts-agent.md

supportedTargets[6]: dbt, Dagster, Airflow, BigQuery, Bauplan, raw SQL
```

## Orchestration Registration

Kit agents and gates are registered in `orchestration.toml` under `[[kit.<name>.agents]]` and `[[kit.<name>.gates]]`. See `orchestration-config.schema.md` for the full TOML schema and examples.

## Gate Agents

Kit gates are a special class of kit agent that return a `gate` field in their AgentResult. Gates can halt, warn, or trigger retry of the pipeline. See `agent-result.schema.md` for the gate primitive specification.

Gates register under `[[kit.<name>.gates]]` in orchestration.toml and include a `failAction` field that determines behavior on gate failure.

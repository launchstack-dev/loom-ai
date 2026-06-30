# Loom Internals

Reference material: wiki maintenance, data formats, persistence layout, and the repository file structure. Lookup-oriented — not meant to be read linearly.

## Wiki Maintenance

The project wiki (`.loom/wiki/`) stays current automatically at state-change points.

| Trigger | What's captured |
|---------|-----------------|
| `/loom-roadmap` (after write) | Strategic intent, features, milestones, constraints |
| `/loom-plan create` (after validation) | Architecture, schemas, scenarios, phase structure |
| `/loom-plan execute` (after each wave) | Contracts, implementation decisions, files built |
| `/loom-plan materialize` (after milestone) | Per-domain `contract-*` pages |
| `/loom-change archive` | Mutations applied; History entry appended per page |
| `/loom-code fix` (after verification) | Applied fixes, unfixable items as design constraints |
| `SessionStart` | Wiki summary loaded via `wiki-session-status` hook |

Manual: `/loom-wiki ingest`, `/loom-wiki lint`, `/loom-wiki query "question"`.

## Data Formats

- **TOON** (Token-Oriented Object Notation) for all on-disk artifacts and agent communication — token-efficient, structured, machine-diffable. Spec at `protocols/toon-format.md`. ~30–60% smaller than JSON for typical Loom payloads.
- **JSON** for AJV schema validation tests only.
- **Markdown** for plans, roadmaps, and wiki pages; TOON appears as fenced blocks inside.

## Persistence

- `.loom/wiki/` — persistent knowledge base: wiki pages (including `contract-*`, `assumption-*`), index, operation log (git-tracked)
- `.loom/changes/` — per-change-proposal directories (git-tracked)
- `.plan-execution/` — execution state, scope contract, stage summaries (selectively git-tracked; `ephemeral/` is gitignored)
- `planning/history/` — reviews, decisions, explorations, wave summaries, milestones (git-tracked)

## File Structure

```
agents/                      67 agent definitions + 5 stage teammates
  protocols/                 48 protocol files (31 schemas + 17 supporting docs)
  stage-teammates/           Stage-teammate agents for /loom-auto agent-team mode
commands/                    29 top-level files (12 noun-grouped roots + /loom dispatcher + subcommand verbs)
  loom-plan/                 5 subcommand decomposition files
  loom-roadmap/              6 subcommand decomposition files
  loom-plan/materialize.md   Contract-page materializer
hooks/                       17 files: 13 enforcement + 3 infrastructure + 1 context-budget test harness
  lib/                       Shared harness, TOON reader, context resolver, change paths, spec validators
  __tests__/                 Hook tests (ambient-state, statusline, wiki-impact, wiki-session, register-wiki-hooks, …)
skills/library.yaml          Catalog (104 entries: commands, agents, protocols, kits)
docs/                        scenarios-and-changes, scenarios-authoring-template,
                             version-cadence, design-philosophy, hooks, internals
scripts/                     verify-release.sh, register-wiki-hooks.ts, loom-change/*
.github/workflows/           cosign-spike (release signing validation)
install.sh / uninstall.sh    Curl-friendly bootstrap (gh api fallback)
test/protocol/               Protocol tests
test-fixtures/               Test plan + contract-page + spec-upgrades fixtures
.loom/wiki/                  Persistent knowledge base (git-tracked)
.loom/changes/               Change-proposal directories (git-tracked)
```

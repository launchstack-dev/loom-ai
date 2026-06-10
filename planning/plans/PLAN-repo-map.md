---
planVersion: 1
name: "Repo Map — Aider-style Proactive Context Pack"
status: draft
created: 2026-05-26
lastReviewed: null
roadmapRef: null
totalPhases: 4
totalWaves: 4
---

# Plan: Repo Map — Aider-style Proactive Context Pack

## Overview

Port Aider's RepoMap pattern to Loom as a deterministic, platform-agnostic proactive-context layer. Tree-sitter extracts symbols, a directed graph captures references between files, personalized PageRank ranks importance, and a token-budgeted pack of the top symbols is injected into agent prompts before they begin work.

This is the **proactive** sibling to Serena's reactive query MCP. Serena answers "what calls X?" when an agent asks; the repo map answers "what does this agent need to know *before* it asks anything" — pre-populated with the symbols closest to the plan phase's File Ownership.

Sits between two existing initiatives:
- **PLAN-wiki-flows-contracts** deferred `wiki-context-suggester` (UserPromptSubmit hook for fuzzy context injection) because pattern-matching prompts was brittle. RepoMap is the deterministic answer for that gap.
- **PLAN-spec-upgrades M-01** put scenarios under each plan phase. RepoMap's personalization can seed PageRank from the phase's scenarios + File Ownership, giving the agent a phase-specific symbol neighborhood.

Strategic property worth preserving from Aider: **no embedding model, no vector store, no model-version pinning** — just files on disk + tree-sitter + math. Fits Loom's everything-is-files ethos and the platform-agnostic constraint.

## Tech Stack

- **TypeScript** — implementation (matches `hooks/lib/` conventions)
- **tree-sitter** via Node bindings (`tree-sitter` + grammar packages per language)
- **TOON** for cache + ranking-config artifacts
- **vitest** for tests
- **bun** / **bunx** preferred; npm fallback

## Pre-Execution Decisions

**D-01: Cache strategy — ephemeral or persisted?** Options: (a) recompute on every agent spawn (~few seconds for medium repos, deterministic, no cache invalidation problem); (b) persist at `.plan-execution/ephemeral/repo-map.toon` with timestamp-based staleness; (c) persist with file-watcher invalidation. Recommendation: **(a) for v1** — compute is cheap, no invalidation bugs, and the personalization seed changes per spawn anyway. (c) is a follow-up if perf becomes an issue.

**D-02: Personalization seed source.** Options: (a) current plan phase's File Ownership; (b) recently-modified files (git diff against last commit); (c) explicit hint passed by orchestrator. Recommendation: **all three composed** — orchestrator-passed hint > File Ownership > recent git diff. The orchestrator caller has the most precise signal.

## Schema / Type Definitions

### RepoMap

The materialized symbol map injected into agent prompts.

| Field | Type | Constraints |
|-------|------|-------------|
| schemaVersion | integer | Currently `1` |
| generatedAt | string | ISO 8601 |
| repoRoot | string | Absolute path to the repo root the map was built for |
| tokenBudget | integer | Target token budget (default 8000) |
| actualTokens | integer | Estimated tokens in the rendered pack |
| seedFiles | string[] | Files used as PageRank personalization seed |
| symbols | RepoMapSymbol[] | Ranked symbols, descending importance |
| renderedPack | string | The final markdown-formatted symbol pack ready for prompt injection |

### RepoMapSymbol

| Field | Type | Constraints |
|-------|------|-------------|
| file | string | Path relative to `repoRoot` |
| kind | enum | `function`, `class`, `interface`, `type`, `const`, `enum`, `method` |
| name | string | Symbol identifier |
| signature | string | One-line signature (params + return type, no body) |
| line | integer | 1-indexed source line |
| pageRank | number | Personalized PageRank score |
| references | integer | Count of inbound references across the repo |

### RankingConfig

Per-project tuning at `.loom/repo-map.config.toon` (optional; defaults work for most projects).

| Field | Type | Constraints |
|-------|------|-------------|
| tokenBudget | integer | Default 8000. Hard cap — output never exceeds. |
| dampingFactor | number | PageRank damping (default 0.85) |
| personalizationWeight | number | How much seed files boost their neighborhoods (default 100, vs. uniform 1) |
| excludePatterns | string[] | Glob patterns to exclude beyond `.gitignore` (e.g., `**/__generated__/**`) |
| includeKinds | string[] | Which symbol kinds to include (default: all) |
| signatureMaxChars | integer | Truncate signatures longer than this (default 120) |

## Execution Phases

### Phase 0 — Wave 0: Schema Contracts

**Agent:** contracts-agent
**Objective:** Define schemas and the rendered-pack format.
**Dependencies:** None
**File Ownership:** agents/protocols/repo-map.schema.md, agents/protocols/ranking-config.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/repo-map.schema.md | Create | contracts-agent |
| agents/protocols/ranking-config.schema.md | Create | contracts-agent |

#### Acceptance Criteria
- [ ] Both schemas exist with TOON frontmatter examples, Field tables, validation rules.
- [ ] `repo-map.schema.md` documents the rendered-pack format (markdown with file/symbol headers) including a concrete example pack ≤200 lines.
- [ ] `ranking-config.schema.md` defines defaults explicitly and notes which fields are tuning knobs vs. invariants.

---

### Phase 1 — Wave 1: Tree-sitter Extraction + Graph Build + PageRank

**Agent:** implementer-agent
**Objective:** Implement the core algorithm — extract symbols, build the reference graph, run personalized PageRank, render the budgeted pack.
**Dependencies:** Phase 0
**File Ownership:** hooks/lib/repo-map/, hooks/lib/repo-map.ts, test/repo-map/

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/repo-map/extract.ts | Create | implementer-1 |
| hooks/lib/repo-map/graph.ts | Create | implementer-1 |
| hooks/lib/repo-map/pagerank.ts | Create | implementer-1 |
| hooks/lib/repo-map/render.ts | Create | implementer-1 |
| hooks/lib/repo-map.ts | Create | implementer-1 |
| test/repo-map/extract.test.ts | Create | implementer-1 |
| test/repo-map/pagerank.test.ts | Create | implementer-1 |
| test/repo-map/end-to-end.test.ts | Create | implementer-1 |

#### Acceptance Criteria
- [ ] `extract.ts` parses TypeScript, JavaScript, and Markdown via tree-sitter and returns typed `RepoMapSymbol[]` per file. Other languages fail gracefully (log + skip, not crash).
- [ ] `graph.ts` builds a directed graph: edge from file A → file B when A references a symbol defined in B. Reference detection uses tree-sitter queries, not regex.
- [ ] `pagerank.ts` implements personalized PageRank with configurable damping and seed weights. Convergence: ε < 1e-6 within 100 iterations on a 1k-file graph.
- [ ] `render.ts` produces a markdown pack respecting `tokenBudget` exactly — never exceeds, fills as much as possible. Token estimation via the existing `hooks/lib/token-estimator.ts`.
- [ ] `repo-map.ts` exposes a single `buildRepoMap(opts)` entry point taking `{ repoRoot, seedFiles?, tokenBudget?, config? }` and returning a `RepoMap`.
- [ ] `bunx vitest run test/repo-map/` exits 0 with ≥15 cases including: extraction across 3 languages, graph correctness on a synthetic fixture, PageRank convergence, token budget never exceeded, deterministic output given identical inputs.
- [ ] `bunx tsc --noEmit` passes for new files.
- [ ] No `any` types; explicit return types on exports.

---

### Phase 2 — Wave 2: Orchestrator Integration

**Agent:** implementer-agent
**Objective:** Wire the repo map into agent dispatch — orchestrators inject the pack into agent prompts before launching.
**Dependencies:** Phase 1
**File Ownership:** hooks/lib/agent-prompt-builder.ts, hooks/lib/repo-map-seeder.ts, commands/loom-repo-map.md, scripts/loom-repo-map/, test/repo-map/integration.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/lib/repo-map-seeder.ts | Create | implementer-2 |
| hooks/lib/agent-prompt-builder.ts | Create | implementer-2 |
| commands/loom-repo-map.md | Create | implementer-2 |
| scripts/loom-repo-map/build.ts | Create | implementer-2 |
| scripts/loom-repo-map/inspect.ts | Create | implementer-2 |
| test/repo-map/integration.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `repo-map-seeder.ts` composes the personalization seed: orchestrator hint > current plan-phase File Ownership > `git diff HEAD~1..HEAD` files. Returns a deduplicated absolute-path list.
- [ ] `agent-prompt-builder.ts` accepts a base agent prompt and returns the prompt with the rendered repo map prepended under a clearly-marked `## Repo Map (auto-generated)` section. Respects token budgets — if base prompt + map exceeds the agent's context cap (per `context-budget.md`), shrinks the map first.
- [ ] `/loom-repo-map build` produces the map on demand and prints it to stdout (or `--out path`).
- [ ] `/loom-repo-map inspect --file path/to/file.ts` shows the file's PageRank, inbound references, outbound references — debugging surface.
- [ ] Integration test: launching a synthetic agent task against the spec-upgrades-e2e fixture produces a prompt that contains scenario.schema-related symbols at high rank when File Ownership seeds it from `hooks/lib/scenario-validator.ts`.

---

### Phase 3 — Wave 3: Wiki Bridge + Wiki Context Suggester Replacement

**Agent:** wiring-agent
**Objective:** Bridge to wiki and replace the deferred `wiki-context-suggester` from PLAN-wiki-flows-contracts.
**Dependencies:** Phase 2
**File Ownership:** hooks/wiki-context-suggester.ts, agents/wiki-maintainer-agent.md (additions), docs/repo-map.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/wiki-context-suggester.ts | Create | wiring-agent |
| agents/wiki-maintainer-agent.md | Modify | wiring-agent |
| docs/repo-map.md | Create | wiring-agent |
| skills/library.yaml | Modify | wiring-agent |

#### Acceptance Criteria
- [ ] `wiki-context-suggester.ts` is a UserPromptSubmit hook that runs the repo map seeded by the user's prompt content (extracted keywords + git-diff context), produces a small top-10 symbol pack, and prepends it to the agent's context. Replaces the deferred fuzzy-regex variant from PLAN-wiki-flows-contracts.
- [ ] `wiki-maintainer-agent.md` documents how high-rank symbols without a corresponding `component-*` wiki page should trigger ingestion — the repo map becomes a **gap detector** for the wiki: structurally-important code with no semantic page is a documentation gap.
- [ ] `docs/repo-map.md` covers: what it does, when it runs (per-spawn vs. proactive hook), how seed composition works, how to tune `RankingConfig`, debugging via `/loom-repo-map inspect`.
- [ ] `skills/library.yaml` includes `/loom-repo-map` command entry; catalog validation passes.
- [ ] End-to-end fixture test: a synthetic codebase where a structurally-important function lacks a wiki page → wiki-maintainer-agent detects the gap and proposes a `component-*` page draft.

## Verification Commands

```bash
bunx tsc --noEmit
bunx vitest run
bunx eslint hooks/ scripts/
node scripts/validate-library-catalog.js
```

## Milestones

### M-01: Repo Map Core (Independently Shippable)
**Phases:** 0, 1, 2
**Acceptance:** `buildRepoMap()` works against this repo (loom-ai) producing a deterministic, token-budgeted, personalizable map. `/loom-repo-map build` works from the CLI. Orchestrators can inject the map into agent prompts via `agent-prompt-builder.ts`.

### M-02: Wiki Bridge
**Phases:** 3
**Depends on:** M-01
**Acceptance:** `wiki-context-suggester.ts` hook is functional; high-rank symbols without wiki coverage trigger ingestion candidates; the deferred fuzzy variant from PLAN-wiki-flows-contracts is formally replaced.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Tree-sitter grammar maintenance burden across languages | medium | Ship TS/JS/MD only in v1; document the failure-mode-is-skip contract so adding a language is purely additive |
| PageRank perf on large repos (>10k files) | medium | Cache strategy D-01 has option (c) file-watcher invalidation as escape hatch; v1 measures on loom-ai (~600 files) and any project >5k files surfaces as warning |
| Token-budgeted pack drops critical symbols on overflow | medium | `agent-prompt-builder.ts` shrinks map BEFORE truncating base prompt; deterministic ordering means dropped symbols are always the lowest-rank ones; orchestrator can pass higher `tokenBudget` for phases that need broader context |
| Drift between repo map and wiki contract pages | high | Repo map is **derived** (never authored); wiki contract pages are **authored**. Repo map never overrides wiki — it can only flag gaps for the maintainer to consider |
| Embedding-camp pushback (`why no semantic search?`) | low | Documented strategic choice: deterministic + offline + no model-version lock-in. Embedding hybrid is a future plan if recall gaps emerge; not v1 scope |
| Conflict with Serena MCP coverage | low | Repo map is proactive (pre-injection); Serena is reactive (query-time). They compose: Serena answers follow-up questions about symbols the map surfaced |

## Acceptance Criteria (Final)

- [ ] `buildRepoMap()` on the loom-ai repo produces a token-budgeted (≤8k tokens) symbol pack in <5 seconds.
- [ ] Personalization works: seeding with `agents/protocols/scenario.schema.md` produces a measurably different top-20 than seeding with `commands/loom-plan/execute.md`.
- [ ] Re-running with identical seed + identical disk state produces byte-identical output (determinism).
- [ ] `/loom-repo-map build --seed PLAN-spec-upgrades.md` produces a pack where scenario/contract-page schemas rank above unrelated subsystems.
- [ ] `wiki-context-suggester.ts` UserPromptSubmit hook fires and injects context without exceeding the conversation budget.
- [ ] At least one structurally-important function in loom-ai without a `component-*` wiki page is surfaced as a documentation gap by Phase 3's bridge.
- [ ] No embedding model, no vector store, no hosted dependency — fully local, fully deterministic.

## Open Questions

- **Q-01:** Should the repo map include cross-references from markdown files (e.g., a schema citing another schema)? Likely yes for Loom-style projects where docs are first-class — would let the map rank not just code symbols but spec/protocol artifacts. Decide before Phase 1.
- **Q-02:** Hook ordering — does `wiki-context-suggester` fire before or after `wiki-impact-warner`? They're both UserPromptSubmit-class but serve different purposes (proactive context vs. write-time impact). Settle in Phase 3.
- **Q-03:** When tree-sitter grammars are missing for a language, do we silently skip or warn? Current default is skip + info-log; consider whether a project with mostly-unsupported languages should fail loud at init time instead.

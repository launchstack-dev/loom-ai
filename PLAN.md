---
planVersion: 1
name: "Loom Agent Expansion"
status: draft
created: 2026-04-07
lastReviewed: null
totalPhases: 8
totalWaves: 5
---

# Plan: Loom Agent Expansion

## Overview

Expand the Loom multi-agent pipeline with 17 new agents across 4 groups (documentation, architecture decisions, review layer, convergence loop), 1 new command (`/loom-converge`), and 1 new orchestration pattern (converge). All agents follow existing Loom conventions: `.md` definitions with frontmatter, AgentResult output schema, lean pattern (agents read own instructions from disk).

## Tech Stack

- Agent definitions: Markdown with YAML frontmatter
- Protocols: Markdown specification files
- Configuration: TOML (orchestration.toml)
- No runtime dependencies — this is a pure agent/skill library

## Schema / Type Definitions

### Agent Definition

| Field | Type | Constraints |
|-------|------|-------------|
| name | string | kebab-case, unique across agents/ directory |
| description | string | 1-2 sentences, includes "Use PROACTIVELY" for auto-trigger agents |
| model | enum | opus, sonnet, haiku, inherit |

### Reviewer Output (shared across all review agents)

| Field | Type | Constraints |
|-------|------|-------------|
| reviewer | string | Agent name (kebab-case) |
| findings | array | Array of Finding objects |
| summary | object | Severity counts + category counts |

### Finding

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | Prefixed by reviewer tag (e.g., perf-001, a11y-001) |
| severity | enum | critical, high, medium, low, info |
| category | string | Reviewer-specific category identifier |
| description | string | Human-readable description of the issue |
| file | string | Relative file path |
| line | integer | Line number (nullable for project-wide findings) |
| code | string | Quoted code snippet (nullable) |
| fix | string | Concrete remediation (required) |

### Converge Pattern Config

| Field | Type | Constraints |
|-------|------|-------------|
| type | literal | "converge" |
| targetParser | string | Agent that normalizes the deterministic source |
| harnessBuilder | string | Agent that scaffolds comparison infrastructure |
| deltaAnalyzer | string | Agent that triages gaps |
| driver | string | Agent that orchestrates the iteration loop |
| maxIterations | integer | Default 10, max 50 |
| tolerance | object | Per-comparison-method tolerance thresholds |
| trigger | string | Event or command that activates the pattern |

### Convergence Delta Report

| Field | Type | Constraints |
|-------|------|-------------|
| iteration | integer | Current iteration number |
| totalTargets | integer | Number of comparison targets |
| passing | integer | Targets within tolerance |
| failing | integer | Targets outside tolerance |
| deltas | array | Array of Delta objects |
| convergenceRate | float | Percentage improvement from prior iteration |
| stalled | boolean | True if convergenceRate < 1% for 2+ iterations |

### Delta

| Field | Type | Constraints |
|-------|------|-------------|
| target | string | Target artifact identifier |
| method | enum | pixel-diff, json-deep-equal, semantic-html, row-diff, text-diff, custom |
| score | float | 0.0 (no match) to 1.0 (exact match) |
| threshold | float | Required score to pass |
| diff | string | Human-readable diff summary |
| actionable | boolean | True if a fixer agent can address this |
| noise | boolean | True if delta is noise (anti-aliasing, key ordering, etc.) |

## Execution Phases

### Phase 0 — Wave 0: Contracts & Protocol Extensions

**Agent:** contracts-agent
**Objective:** Add the converge pattern to orchestration-patterns.md and pattern-executor.md; define reviewer tag registry and converge PatternResult fields.
**Dependencies:** None
**File Ownership:** agents/protocols/**

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/orchestration-patterns.md | Modify | contracts |
| agents/protocols/pattern-executor.md | Modify | contracts |

#### Acceptance Criteria
- [ ] orchestration-patterns.md contains `## Pattern 5: Converge` with full specification (when to use, how it works, config schema, example)
- [ ] pattern-executor.md contains a `### Converge` section under Per-Pattern Execution with spawn sequence, error handling, and budget formula
- [ ] PatternResult table in pattern-executor.md includes converge-specific fields: `iterations`, `finalDelta`, `converged`
- [ ] Pattern selection guidance table includes converge row with cost/latency/confidence ratings
- [ ] Config schema reference in orchestration-patterns.md includes a full converge example in orchestration.toml

### Phase 1 — Wave 1: Documentation Agents

**Agent:** implementer-agent
**Objective:** Create the docs-generator and docs-auditor agents for greenfield and brownfield documentation workflows.
**Dependencies:** None
**File Ownership:** agents/docs-generator.md, agents/docs-auditor.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/docs-generator.md | Create | implementer-1 |
| agents/docs-auditor.md | Create | implementer-1 |

#### Acceptance Criteria
- [ ] docs-generator.md has valid frontmatter with model: sonnet and a description mentioning PROACTIVELY
- [ ] docs-generator.md covers: README scaffolding, API docs from route definitions, ADR generation, onboarding guide creation from PLAN.md + codebase
- [ ] docs-generator.md specifies input (codebase context, PLAN.md path) and output (list of generated doc files with paths)
- [ ] docs-auditor.md has valid frontmatter with model: sonnet
- [ ] docs-auditor.md covers: staleness detection (doc references code that no longer exists), missing docs (public APIs without docs), contradiction detection (doc says X but code does Y)
- [ ] docs-auditor.md output follows the reviewer Finding schema (id, severity, description, file, fix)

### Phase 2 — Wave 1: Architecture Decision Agents

**Agent:** implementer-agent
**Objective:** Create the tech-stack-debater and migration-architect agents for structured architecture decision-making.
**Dependencies:** Phase 0
**File Ownership:** agents/tech-stack-debater.md, agents/migration-architect.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/tech-stack-debater.md | Create | implementer-2 |
| agents/migration-architect.md | Create | implementer-2 |

#### Acceptance Criteria
- [ ] tech-stack-debater.md has valid frontmatter with model: sonnet
- [ ] tech-stack-debater.md defines three personas: advocate (argues for a technology), skeptic (finds weaknesses), pragmatist (considers team/timeline/ecosystem constraints)
- [ ] tech-stack-debater.md references the debate pattern from orchestration-patterns.md and specifies how to configure it in orchestration.toml
- [ ] tech-stack-debater.md output includes: recommended technology, confidence level, tradeoffs matrix, dissenting considerations
- [ ] migration-architect.md has valid frontmatter with model: opus
- [ ] migration-architect.md covers: incremental migration path planning, risk assessment per migration step, rollback strategy for each step, dependency mapping between old and new systems
- [ ] migration-architect.md output includes: ordered migration steps with effort estimates, risk matrix, rollback procedures, success criteria per step

### Phase 3 — Wave 2: Review Agents — Code Quality

**Agent:** implementer-agent
**Objective:** Create performance-reviewer, accessibility-reviewer, and dependency-auditor agents.
**Dependencies:** Phase 0
**File Ownership:** agents/performance-reviewer.md, agents/accessibility-reviewer.md, agents/dependency-auditor.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/performance-reviewer.md | Create | implementer-3 |
| agents/accessibility-reviewer.md | Create | implementer-3 |
| agents/dependency-auditor.md | Create | implementer-3 |

#### Acceptance Criteria
- [ ] performance-reviewer.md has valid frontmatter with model: sonnet
- [ ] performance-reviewer.md checklist covers: N+1 queries, unnecessary re-renders (React), bundle size impact, O(n²)+ algorithms on user data, missing pagination, synchronous I/O in hot paths, missing indexes in query patterns
- [ ] performance-reviewer.md output follows the reviewer Finding schema with category prefixes (e.g., perf-001)
- [ ] accessibility-reviewer.md has valid frontmatter with model: sonnet
- [ ] accessibility-reviewer.md checklist covers: WCAG 2.1 AA compliance, semantic HTML usage, ARIA attribute correctness, keyboard navigation, color contrast ratios, focus management, alt text for images, form label associations
- [ ] accessibility-reviewer.md output follows the reviewer Finding schema with category prefixes (e.g., a11y-001)
- [ ] dependency-auditor.md has valid frontmatter with model: sonnet
- [ ] dependency-auditor.md checklist covers: known CVEs (check against package versions), license compliance (flag copyleft in proprietary projects), abandoned packages (no updates >2 years), version drift (major version behind), duplicate dependencies, unnecessary dependencies

### Phase 4 — Wave 2: Review Agents — Domain Specific

**Agent:** implementer-agent
**Objective:** Create api-design-reviewer, database-schema-reviewer, infra-reviewer, and observability-agent.
**Dependencies:** Phase 0
**File Ownership:** agents/api-design-reviewer.md, agents/database-schema-reviewer.md, agents/infra-reviewer.md, agents/observability-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/api-design-reviewer.md | Create | implementer-4 |
| agents/database-schema-reviewer.md | Create | implementer-4 |
| agents/infra-reviewer.md | Create | implementer-4 |
| agents/observability-agent.md | Create | implementer-4 |

#### Acceptance Criteria
- [ ] api-design-reviewer.md has valid frontmatter with model: sonnet
- [ ] api-design-reviewer.md checklist covers: REST naming conventions, HTTP method correctness, consistent error response format, API versioning strategy, pagination patterns, idempotency for mutations, rate limiting headers, OpenAPI/schema consistency
- [ ] database-schema-reviewer.md has valid frontmatter with model: sonnet
- [ ] database-schema-reviewer.md checklist covers: normalization issues (3NF violations), missing indexes on foreign keys and query patterns, migration safety (no column drops without data migration, no lock-heavy operations on large tables), constraint completeness, naming conventions
- [ ] infra-reviewer.md has valid frontmatter with model: sonnet
- [ ] infra-reviewer.md checklist covers: Dockerfile best practices (multi-stage builds, non-root user, layer caching), CI pipeline efficiency (parallel jobs, caching, unnecessary steps), IaC drift detection, secrets in config files, resource limits
- [ ] observability-agent.md has valid frontmatter with model: sonnet
- [ ] observability-agent.md checklist covers: structured logging presence, error logging with context, metrics for key operations (latency, throughput, error rate), distributed tracing headers, health check endpoints, alerting thresholds
- [ ] All 4 agents output follows the reviewer Finding schema with appropriate category prefixes

### Phase 5 — Wave 3: Convergence Loop Agents

**Agent:** implementer-agent
**Objective:** Create the 4 convergence loop agents: target-parser, harness-builder, delta-analyzer, convergence-driver.
**Dependencies:** Phase 0
**File Ownership:** agents/target-parser.md, agents/harness-builder.md, agents/delta-analyzer.md, agents/convergence-driver.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/target-parser.md | Create | implementer-5 |
| agents/harness-builder.md | Create | implementer-5 |
| agents/delta-analyzer.md | Create | implementer-5 |
| agents/convergence-driver.md | Create | implementer-5 |

#### Acceptance Criteria
- [ ] target-parser.md has valid frontmatter with model: sonnet
- [ ] target-parser.md supports these source types: screenshots/design comps (visual diff targets), OpenAPI/JSON Schema specs (request/response fixtures), golden output files (expected vs actual), reference implementation output (behavior parity), SQL query result sets (row-level diff)
- [ ] target-parser.md output is a normalized target manifest listing each artifact with its comparison method and path
- [ ] harness-builder.md has valid frontmatter with model: sonnet
- [ ] harness-builder.md generates: comparison scripts per method type, a converge.config mapping targets to methods and tolerance thresholds, a runner entry point that produces a structured Delta Report
- [ ] delta-analyzer.md has valid frontmatter with model: sonnet
- [ ] delta-analyzer.md reads a Delta Report and produces: noise classification (anti-aliasing artifacts, JSON key ordering, whitespace), actionability assessment per delta, prioritized fix list ordered by impact and effort, suggested agent assignments for each fix
- [ ] convergence-driver.md has valid frontmatter with model: opus
- [ ] convergence-driver.md implements the iteration loop: run harness → read delta → spawn fixer agents → re-run harness → check convergence
- [ ] convergence-driver.md includes circuit breakers: stall detection (convergence rate < 1% for 2+ iterations), regression detection (delta score worsening), max iteration limit, wall-clock timeout
- [ ] convergence-driver.md outputs a convergence report with: iterations completed, final delta scores, pass/fail per target, total agents spawned

### Phase 6 — Wave 4: Loom Converge Command

**Agent:** implementer-agent
**Objective:** Create the /loom-converge command that orchestrates the convergence pipeline.
**Dependencies:** Phase 0, Phase 5
**File Ownership:** commands/loom-converge.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-converge.md | Create | implementer-6 |

#### Acceptance Criteria
- [ ] loom-converge.md follows the command template format (role statement, $ARGUMENTS, instructions, output format)
- [ ] Supports arguments: `--target <path>` (deterministic source), `--config <path>` (converge.config), `--max-iterations N`, `--tolerance <threshold>`, `--dry-run`, `--resume`
- [ ] Orchestrates the full pipeline: target-parser → harness-builder → [convergence-driver ↔ delta-analyzer ↔ fixer] loop
- [ ] Includes human approval gate before starting the iteration loop (shows target manifest and harness config)
- [ ] Reports progress per iteration with delta counts and convergence rate
- [ ] Saves convergence state to `.plan-execution/convergence-state.toon` for `--resume`

### Phase 7 — Wave 4: Wiring & Integration

**Agent:** wiring-agent
**Objective:** Update loom.md help text with new agents and command; create default orchestration.toml template with all new reviewer registrations.
**Dependencies:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6
**File Ownership:** commands/loom.md, agents/protocols/orchestration-config.schema.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom.md | Modify | wiring |
| agents/protocols/orchestration-config.schema.md | Modify | wiring |

#### Acceptance Criteria
- [ ] loom.md Agent Groups section lists all 17 new agents in appropriate groups (Documentation, Architecture Decision, new Review entries, Convergence Loop)
- [ ] loom.md Commands section includes /loom-converge with all its argument variants
- [ ] loom.md includes a new "Convergence Pipeline" section showing the converge workflow diagram
- [ ] orchestration-config.schema.md includes the converge pattern config fields and a complete example with all 7 new reviewer registrations
- [ ] All new reviewer agents are registered in the schema with appropriate modes (default, full) and reviewer tags

## Verification Commands

```bash
# Verify all agent files have valid YAML frontmatter
for f in agents/*.md; do head -1 "$f" | grep -q '^---' && echo "OK: $f" || echo "FAIL: $f"; done

# Verify no duplicate agent names
grep -h '^name:' agents/*.md | sort | uniq -d

# Count agents (should be 31 total: 14 existing + 17 new)
ls agents/*.md | wc -l

# Verify new command exists
test -f commands/loom-converge.md && echo "OK" || echo "FAIL"

# Verify protocol files are valid markdown
for f in agents/protocols/orchestration-patterns.md agents/protocols/pattern-executor.md; do test -f "$f" && echo "OK: $f" || echo "FAIL: $f"; done
```

## Milestones

| Milestone | Target Phase | Status | Effort |
|-----------|-------------|--------|--------|
| Converge Protocol Defined | Phase 0 | pending | S |
| Documentation Agents Ready | Phase 1 | pending | M |
| Architecture Agents Ready | Phase 2 | pending | M |
| Review Layer Complete | Phase 3, Phase 4 | pending | L |
| Convergence Loop Complete | Phase 5, Phase 6 | pending | L |
| Full Integration | Phase 7 | pending | S |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Review agents have overlapping checklists with existing security-reviewer | Medium | Each agent has a distinct category prefix; dedup rules in loom-review-code.md handle overlaps |
| Convergence pattern is more complex than other patterns (iterative vs linear) | High | Circuit breakers (stall, regression, max iterations) prevent runaway loops; convergence-driver on opus for reasoning capability |
| 17 agents in one plan may exceed context budget for wiring phase | Medium | Phase 7 (wiring) only touches 2 files and reads agent names, not full bodies |
| New reviewer agents bloat review time when all enabled | Low | Registered via orchestration.toml with modes — users opt into `full` mode; default mode only includes core reviewers |

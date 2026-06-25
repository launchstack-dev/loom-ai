```toon
pageId: structure-agent-taxonomy
title: Agent Taxonomy
category: structure
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: agents/
crossRefs[3]{pageId,relationship}:
  convention-agent-result,relates-to
  pattern-model-resolution,relates-to
  component-orchestration-patterns,relates-to
tags[4]: agents, taxonomy, organization, architecture
staleness: fresh
confidence: high
```

# Agent Taxonomy

Loom ships **60+ agents** organized into functional categories. Each agent is a `.md` file in `agents/` with a YAML-style frontmatter block declaring `name`, `description`, and `model`. Every agent returns a standard AgentResult envelope in TOON.

## Total Count

As of 2026-04-25: **60 agents** across 7 categories, plus 5 stage-teammate protocols.

---

## Planning Agents

These agents operate in the pre-execution phases — roadmap creation, plan building, and scope analysis.

| Agent | Model | Role |
|-------|-------|------|
| `plan-builder-agent` | opus | Generates PLAN.md with phased tasks, acceptance criteria, and convergence targets |
| `questioner-agent` | sonnet | Extracts clarifying questions before planning begins |
| `scope-feasibility-agent` | sonnet | Assesses whether a plan's scope is feasible within the stated constraints |
| `interpretation-reviewer-agent` | sonnet | Detects ambiguity and conflicting interpretations across plan tasks |
| `roadmap-builder-agent` | sonnet | Converts high-level goals into a phased ROADMAP.md |
| `criteria-planner-agent` | sonnet | Derives acceptance criteria and convergence targets from plan descriptions |
| `phasing-agent` | sonnet | Splits large plans into time-bounded waves |
| `parallelization-agent` | sonnet | Identifies which tasks can execute in parallel without conflicts |
| `strategy-agent` | sonnet | High-level architectural strategy selection |
| `project-guidance-agent` | sonnet | Provides project-specific context and convention guidance |
| `prompt-refiner-agent` | sonnet | Improves prompts for clarity and precision |

---

## Execution Agents

These agents perform the actual code generation and integration work inside a plan execution run.

| Agent | Model | Role |
|-------|-------|------|
| `contracts-agent` | opus | Wave 0 — creates shared types, schemas, and API contracts for downstream agents |
| `implementer-agent` | opus | Wave 1+ — builds code within strict file ownership boundaries |
| `verification-agent` | haiku | Post-wave quality gate — runs typecheck, tests, lint, and drift detection |
| `agentic-workflow-agent` | sonnet | Orchestrates multi-step agentic workflows |
| `migration-architect` | sonnet | Plans and implements database or API migrations |
| `api-route-creator` | sonnet | Generates API route handlers from contracts |
| `api-connector` | sonnet | Wires up API client integrations |
| `api-explorer` | sonnet | Discovers and maps external API surfaces |
| `data-pipeline-agent` | sonnet | Builds data transformation and ETL pipelines |

---

## Test Agents

These agents write and execute tests at multiple levels of the test pyramid.

| Agent | Model | Role |
|-------|-------|------|
| `unit-test-agent` | sonnet | Writes unit tests for individual functions and modules |
| `integration-test-agent` | sonnet | Writes integration tests for service boundaries |
| `e2e-test-agent` | sonnet | Designs end-to-end test scenarios |
| `e2e-test-writer-agent` | sonnet | Generates executable E2E test scripts (Playwright/Cypress) |
| `e2e-runner-agent` | sonnet | Executes E2E tests and captures screenshots/artifacts |
| `qa-review-agent` | sonnet | Reviews test coverage and quality |
| `data-test-generator` | sonnet | Generates test fixtures and data sets |
| `acceptance-criteria-agent` | sonnet | Validates outputs against acceptance criteria |
| `feature-coverage-agent` | sonnet | Measures feature coverage against the plan |
| `tdd-coach` | sonnet | Drives red-green-refactor TDD cycles |

---

## Review Agents

These agents provide specialized code review from different technical perspectives.

| Agent | Model | Role |
|-------|-------|------|
| `security-reviewer` | sonnet | Identifies security vulnerabilities and risk patterns |
| `architecture-reviewer` | sonnet | Reviews architectural decisions and structural concerns |
| `plan-compliance-reviewer` | sonnet | Checks implementation against PLAN.md requirements |
| `performance-reviewer` | sonnet | Identifies performance bottlenecks and anti-patterns |
| `api-design-reviewer` | sonnet | Reviews API design for consistency and best practices |
| `accessibility-reviewer` | sonnet | Reviews UI for WCAG compliance |
| `infra-reviewer` | sonnet | Reviews infrastructure and deployment configuration |
| `observability-reviewer` | sonnet | Reviews logging, tracing, and monitoring coverage |
| `dependency-auditor` | sonnet | Audits third-party dependencies for risk and outdated versions |
| `database-schema-reviewer` | sonnet | Reviews database schema design |
| `data-schema-reviewer` | sonnet | Reviews data models and validation rules |
| `data-quality-gate` | sonnet | Gates pipeline progression on data quality checks |
| `data-lineage-tracker` | sonnet | Tracks data provenance through pipelines |
| `docs-auditor` | sonnet | Audits documentation completeness and accuracy |
| `context-budget-reviewer` | sonnet | Reviews agent spawns for context budget compliance |
| `tech-stack-debater` | sonnet | Advocates for technology choices in debate patterns |

---

## Convergence Agents

These agents power the iterative convergence loop — matching outputs to deterministic targets.

| Agent | Model | Role |
|-------|-------|------|
| `convergence-planner-agent` | sonnet | Discovers convergence targets and produces `convergence-plan.toon` |
| `target-parser` | haiku | Parses and validates convergence target definitions |
| `harness-builder` | sonnet | Builds test harnesses for capturing SOURCE outputs |
| `criteria-harness-builder` | sonnet | Builds harnesses for acceptance criteria TDD |
| `delta-analyzer` | sonnet | Compares SOURCE vs TARGET and produces a delta report |
| `convergence-driver` | sonnet | Orchestrates convergence iterations until targets are met |

---

## Wiki Agents

These agents maintain the project knowledge base in `.loom/wiki/`.

| Agent | Model | Role |
|-------|-------|------|
| `wiki-ingest-agent` | sonnet | Converts source files into structured wiki pages |
| `wiki-lint-agent` | sonnet | Enforces wiki quality rules and detects staleness |
| `wiki-query-agent` | sonnet | Answers questions by searching wiki pages |
| `wiki-maintainer-agent` | sonnet | Updates wiki pages when source files change |

---

## Utility Agents

General-purpose agents that don't belong to a specific pipeline stage.

| Agent | Model | Role |
|-------|-------|------|
| `meta-agent` | sonnet | Generates new agents, skills, and commands from descriptions |
| `fixer-agent` | sonnet | Applies code review findings as targeted fixes |
| `bugfix-analyst-agent` | sonnet | Analyzes bugs with wiki/app context and archives results |
| `docs-generator` | sonnet | Generates documentation from code |
| `ux-agent` | sonnet | Designs UI/UX components and flows |
| `auto-dispatcher` | sonnet | Routes tasks to the correct specialist automatically |

---

## Stage Teammates

Five pipeline stages each have a "teammate" protocol file in `agents/stage-teammates/` that defines the coordination rules for that stage:

- `contracts.md` — Wave 0 coordination
- `execute.md` — Wave 1+ parallel execution rules
- `test.md` — Test stage coordination
- `review.md` — Review stage coordination
- `fix.md` — Fix stage coordination
- `converge.md` — Convergence stage coordination

---

## How Agents Are Organized

All agents live in `agents/` as flat `.md` files. There is no subdirectory hierarchy for functional categories — the taxonomy above is conceptual. The `protocols/` subdirectory contains schemas, conventions, and protocols that agents read as reference material (not agents themselves).

Model assignments follow a consistent pattern:
- **opus** — high-stakes generation: plan building, contracts, implementation
- **sonnet** — analysis and review: most reviewers, test writers, convergence agents
- **haiku** — lightweight operations: verification, parsing, triage routing

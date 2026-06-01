---
roadmapVersion: 1
name: "Loom Convergence Testing & Planning Taxonomy"
status: approved
created: 2026-04-18
lastReviewed: 2026-05-01
targetDate: null
totalFeatures: 10
totalMilestones: 6
---

# Roadmap: Loom Convergence Testing & Planning Taxonomy

## Vision

<!-- Applied: ST-02 -->
Every plan ships with tests that prove it works — before a single line of code is written. Loom currently treats testing as an opt-in, post-execution afterthought gated behind `--converge-criteria`. This roadmap makes convergence testing the default at every level of the planning hierarchy. Test criteria are co-created in parallel with the plan (not after), an interpretation-reviewer catches conflicts before any code is written, and a 4-tier convergence model (unit, integration, e2e, QA review) gates execution at phase, feature, and milestone boundaries. The result is high-speed TDD: tests exist before code, disagreements between planners and testers surface ambiguities in requirements, and every wave proves its correctness before the next begins.

<!-- Applied: ST-06 -->
### Positioning

Unlike framework-level orchestrators (CrewAI, AutoGen, LangGraph), Loom operates at the planning and verification layer — it doesn't replace your agent framework, it makes any framework's output provably correct.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test criteria coverage | 100% of plan phases have criteria generated at plan creation time | criteria-plan.toon exists with >= 1 criterion per phase |
| Interpretation conflict detection | > 0 conflicts surfaced on ambiguous plans | interpretation-reviewer finds conflicts on test fixture plans with known ambiguities |
| Convergence iteration reduction | 30% fewer iterations vs post-execution-only testing | compare iteration counts on same plan with/without parallel test design |
| Unit test gate enforcement | 0 waves proceed with failing unit tests | verification-agent confirms gate blocks progression |
| E2E story coverage | Every milestone has >= 1 e2e story | e2e stories directory is non-empty per milestone |
| Context budget compliance | All test agents stay within 100k token budget | context-budget-reviewer passes preflight for all test agent spawns |
<!-- Applied: ST-07 -->
| Cost per convergence cycle | < 2x baseline plan-only cost | Compare token usage of plan+test vs plan-only on same input |

## Constraints & Decisions

### C-01: Tests Are Always Created
**Decision:** Test criteria generation runs during plan creation in all modes (auto and manual), not gated behind `--converge-criteria`
**Rationale:** The `--converge-criteria` flag should control which tiers *execute*, not whether criteria exist. Tests before code is the fundamental principle.
**Alternatives considered:** Keep opt-in (rejected — defeats the purpose of TDD)
**Impact:** high

### C-02: Parallel Dual-Track Planning
**Decision:** Plan-builder and criteria-planner run in parallel from the same roadmap input, neither reads the other's output
**Rationale:** Independent interpretation surfaces requirement ambiguities. Sequential planning propagates assumptions silently.
**Alternatives considered:** Sequential (plan first, then tests) — rejected because it hides interpretation conflicts
**Impact:** high

### C-03: 4-Tier Convergence Model
**Decision:** Unit > Integration > E2E > QA Review, applied at Phase > Feature > Milestone levels respectively
**Rationale:** Correctness before quality, cheap tests before expensive tests, catch issues at the lowest level possible
**Alternatives considered:** Single-tier (unit only), 2-tier (unit + e2e) — rejected because QA review catches design issues tests can't
**Impact:** high

### C-04: E2E Runner Uses Playwright
**Decision:** Playwright CLI for headless e2e, Chrome MCP via `--chrome` flag for authenticated flows. No Bowser dependency.
<!-- Applied: ST-04 -->
**Rationale:** Bowser wraps Playwright inside Claude Code's agent framework — we already have our own orchestration. Direct Playwright is simpler and CI-compatible. Playwright is needed because Loom plans can produce web applications, and milestone-level acceptance criteria for web apps require browser verification.
**Alternatives considered:** Bowser as dependency (rejected — adds framework coupling for features we already have), Puppeteer (rejected — Playwright has better DX)
**Impact:** medium

### C-05: Model Selection Principle
**Decision:** Opus for decisions, sonnet for generation, haiku for plumbing
**Rationale:** Token efficiency — opus reasoning is needed for conflict detection and convergence strategy, but test stub generation and harness building are structured tasks suited to sonnet
**Alternatives considered:** All opus (too expensive), all sonnet (convergence-driver and interpretation-reviewer need deeper reasoning)
**Impact:** medium

### C-06: Superpowers Patterns Adopted
**Decision:** Adopt three patterns from Superpowers: strict TDD enforcement (red-green gate), diagnose-before-fix, hard verification gate. Do not adopt their orchestration, planning, or dispatch patterns.
**Rationale:** These behavioral patterns improve first-attempt quality (~40% reported improvement) without adding framework dependencies. Our orchestration is already more capable.
**Alternatives considered:** Full Superpowers adoption (rejected — significant overlap with existing Loom capabilities)
**Impact:** medium

### C-07: E2E Story + Session + Audit-Trail Conventions
**Decision:** E2E tests are authored as YAML user stories, executed with named Playwright browser contexts (one context per `sessionName`) for parallel isolation in headless mode and as tabbed sessions in Chrome MCP mode for OAuth/SSO flows. Each step writes screenshots and console dumps to a per-session subdirectory under `.plan-execution/convergence/e2e/`.
**Rationale:** YAML stories are human-writable and machine-discoverable via glob. Playwright's named browser contexts give cookie/storage/cache isolation for free, which lets e2e stories run in parallel without state leakage. Step-level screenshots + console dumps make failures visually diffable across convergence iterations. No third-party wrapper or framework dependency — Playwright is called directly.
**Alternatives considered:** Wrap Playwright in a framework layer (rejected — adds coupling for features Playwright already provides natively); per-test ephemeral contexts without named identifiers (rejected — loses the per-story audit-trail path scheme that enables iteration-to-iteration diffs)
**Impact:** medium

### C-08: Cross-Platform Strategy — Narrow and Deep
**Decision:** OpenCode is the primary second platform (native Task tool + full hooks + TypeScript plugins). Pi is the third platform (richer extension API, extension-based subagents). Goose and Codex CLI are degraded-mode targets (commands only). Do not build a lowest-common-denominator abstraction layer.
**Rationale:** GSD went wide and shallow (deploy-everywhere, degrade-gracefully) — their orchestration "kinda sucks" as a result. Loom should go narrow and deep: near-full capability on OpenCode, tool registration on Pi, commands-only elsewhere. The user hits Claude Code usage limits and needs cheaper model augmentation (OpenCode's 75+ providers). Work machine runs Claude API + Codex CLI and needs a unified tool.
**Alternatives considered:** Full abstraction layer across all platforms (rejected — GSD trap, testing matrix explosion on a one-person project), Claude Code-only forever (rejected — user has active personal need for multi-provider support)
**Impact:** medium
**Constraint:** OpenCode support does NOT ship with the open-source launch. Convergence ships first. OpenCode ships when issue anomalyco/opencode#5894 (hooks don't intercept subagent tool calls) is resolved.

### C-09: Platform-Agnostic Data Layer
**Decision:** TOON artifacts, wiki pages, .plan-execution/ state, and .plan-history/ are platform-agnostic by design. No platform-specific data formats. Sessions can resume across platforms via on-disk state.
**Rationale:** Even without full cross-platform support, the data layer should never couple to a specific host tool. This means Loom state survives platform switches without migration.
**Alternatives considered:** Embed platform-specific metadata in state files (rejected — creates unnecessary coupling)
**Impact:** low (already true today — formalizing as a constraint)

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Agent format | Markdown | — | Claude Code agent/command definitions |
| State format | TOON | 1 | All pipeline state, criteria plans, delta reports |
| Test runner (unit) | Vitest / Jest / Pytest | latest | Framework-detected per project |
| Test runner (e2e) | Playwright | latest | Headless browser automation |
| Browser (authenticated) | Chrome MCP | — | Real Chrome via `--chrome` flag |
| E2E spec format | YAML | — | User stories for e2e test discovery |
| Hooks | TypeScript | — | Context budget, checkpoint, statusline |
| Package manager | Bun | latest | Preferred; npm fallback |

## Features

### F-01: Planning Taxonomy Formalization

**Priority:** P0
**Milestone:** M-01
**Description:** Formalize the Milestone > Feature > Phase > Wave hierarchy as a protocol document. Define what convergence testing applies at each level. Update plan.schema.md and roadmap.schema.md to enforce the mapping — every feature maps to a milestone, every phase maps to a feature, waves are execution-only grouping with no convergence semantics.

**Entities involved:** Taxonomy

**Key behaviors:**
- Protocol document defines 4-level hierarchy with convergence levels at each
- plan.schema.md validation requires phases to reference parent features
- roadmap.schema.md validation requires features to reference parent milestones
- Wave is explicitly defined as execution grouping only, not a testing boundary

### F-02: Parallel Dual-Track Planning

**Priority:** P0
**Milestone:** M-01
**Description:** Plan-builder-agent and criteria-planner-agent run simultaneously from the same roadmap feature input. Neither reads the other's output. Both write to disk. A new interpretation-reviewer-agent reads both outputs and produces a conflict report identifying requirement ambiguities, coverage gaps, and interpretation mismatches.

**Entities involved:** CriteriaPlan, InterpretationConflict, PlanPhase

**Key behaviors:**
- Plan-builder and criteria-planner spawn in parallel during `/loom-plan create` and `/loom auto`
- interpretation-reviewer produces conflict report with severity (blocking/warning/info)
- Blocking conflicts halt pipeline and surface to user for decision
- Resolved conflicts become wiki decision pages
- In auto mode: blocking conflicts are fatal; warnings are logged
<!-- Applied: SF-06 -->
- Decision gate after M-01: if interpretation-reviewer produces >50% false positive rate on test fixtures, fall back to sequential planning (plan-first, then criteria)
<!-- Applied: FC-04 -->
- `/loom-plan create --estimate` shows token cost estimate for parallel planning without executing
<!-- Applied: UX-03 -->
- Plan creation shows progress: 'Planning... (plan-builder ✓, criteria-planner ▶, interpretation-reviewer ○)' with real-time status updates
- Plan-builder queries wiki (via wiki-query-agent) for prior architectural constraints, rejected patterns, and locked decisions relevant to the features being planned — injected as context before generation
- Criteria-planner queries wiki for quality history (prior test failures, known fragile areas, convergence observations) relevant to the features being tested — seeds criteria with known risk areas

**Convergence targets:**
- criteria-plan.toon exists after plan creation (not gated behind flag)
- interpretation-report.toon contains >= 0 conflicts with valid severity fields

### F-03: 4-Tier Convergence Model

**Priority:** P0
<!-- Applied: SF-01 — split M-02 into M-02a and M-02b; F-03 moves to M-02a -->
**Milestone:** M-02a
<!-- Applied: SF-03 -->
**Description:** Implement the 4-tier testing model: unit tests (phase level), integration tests (feature level), e2e tests (milestone level), QA agentic code review (phase/feature level, configurable). Each tier has a runner, pass condition, and gating behavior. Unit and QA review are default-on in all modes. Integration is default-on. E2E is default-on in auto mode, triggered via `/loom converge --e2e` in manual mode. Initial implementation targets convergence-driver and contracts-agent only. Other agents adopt the 4-tier model incrementally via M-03 system integration.

**Entities involved:** ConvergenceTier, CriteriaPlan, DeltaReport

**Key behaviors:**
- Unit tests gate each wave — failing units block next wave
- QA review runs after each wave with configurable scope (phase or feature)
- Integration tests run at feature completion boundary
- E2E tests run at milestone completion boundary
- Opt-out flags: `--no-tests`, `--no-e2e`, `--no-qa-review`, `--tests-only`
- `/loom converge --e2e` triggers e2e for completed plan in manual mode
- `/loom converge --full` triggers all 4 tiers
<!-- Applied: FC-02 -->
- criteria-plan.toon targets array includes testTier column (unit|integration|e2e|qa-review)
<!-- Applied: FC-03 -->
- `/loom converge --tier unit|integration|e2e|qa-review` runs only the specified tier
<!-- Applied: FC-05 -->
- QA findings support bulk-approve: `/loom converge --approve-qa` accepts all non-blocking findings in the current review
<!-- Applied: UX-04 -->
- On unit gate failure: stderr shows failing test names + file paths, wave is halted, statusline shows '✗ unit gate failed (N/M tests)', next wave is blocked until fix-and-rerun
<!-- Applied: UX-05 -->
- QA review blocking behavior: in auto mode, blocking findings halt the pipeline; in manual mode, all findings are presented for review with accept/reject per finding. Warning-level findings never block.
<!-- Applied: UX-06 -->
- Opt-out flags (--no-tests, --no-e2e, --no-qa-review) print stderr warning: '⚠ Tests disabled via --no-tests. Convergence gates will not run.'

**Convergence targets:**
- Unit test gate blocks wave progression when tests fail (verified by test fixture with intentional failure)
- QA review findings appear in delta report with correct tier label

### F-04: E2E Test Writer Agent

**Priority:** P0
<!-- Applied: SF-01 — F-04 moves to M-02b -->
**Milestone:** M-02b
**Description:** New agent that converts acceptance-criteria-agent e2e specs into runnable Playwright test files and YAML user stories. Story format is human-writable (name, url, workflow steps) and machine-discoverable via glob in the e2e stories directory. Generates Playwright test code for automated execution.

**Entities involved:** E2EStory, PlaywrightTest, CriteriaPlan

**Key behaviors:**
- Reads e2e specs from acceptance-criteria-agent output or criteria-plan.toon
- Produces YAML user stories in `.plan-execution/convergence/e2e/stories/`
- Produces Playwright test files in `.plan-execution/convergence/e2e/tests/`
- Stories support multiple formats: imperative steps, BDD Given/When/Then, checklist
- Each story includes preconditions, steps, and expected outcomes
- Model: sonnet
<!-- Applied: FC-08 -->
- E2E story YAML schema is defined in a protocol document with required fields: name, url, preconditions, steps[], expectedOutcome

### F-05: E2E Runner with Playwright and Chrome

<!-- Applied: SF-02 — demoted from P0 to P1 -->
**Priority:** P1
<!-- Applied: SF-01 — F-05 moves to M-02b -->
**Milestone:** M-02b
**Description:** Add Playwright as an e2e test runner in the criteria harness. Support headless mode (default, CI-friendly) and Chrome MCP mode (`--chrome` flag for authenticated flows). Named session isolation for parallel e2e execution. Step-level screenshot audit trail with JS console capture on failure.

**Entities involved:** PlaywrightTest, DeltaReport

**Key behaviors:**
- Playwright CLI runs headless by default, `--chrome` switches to Chrome MCP
- Each e2e story gets a named Playwright session for parallel isolation
- Screenshots saved to `.plan-execution/convergence/e2e/screenshots/{run}/{story}/{NN_step}.png`
- On step failure: capture JS console errors, mark remaining steps SKIPPED
- Delta report includes screenshot paths and console dumps per failing criterion
- E2E runner is haiku model (orchestrates execution, parses results)
<!-- Applied: UX-02 -->
- `/loom converge --e2e` is valid at any point during or after execution. It runs against whatever milestones are complete. Mid-execution e2e runs test completed milestones only.

**Convergence targets:**
- Screenshot directory is populated after e2e run with sequentially numbered PNGs
- Delta report contains e2e tier entries with screenshot paths

### F-06: Interpretation Reviewer Agent

**Priority:** P0
<!-- Applied: ST-05 — verified F-06 placement in M-01 -->
**Milestone:** M-01
**Description:** New agent that reads plan-builder output and criteria-planner output independently and identifies interpretation conflicts, coverage gaps, and mismatches. This is the key innovation of dual-track planning — disagreements between planners surface requirement ambiguities before any code is written.

**Entities involved:** InterpretationConflict, CoverageGap, CriteriaPlan, PlanPhase

**Key behaviors:**
- Reads PLAN.md summary and criteria-plan.toon summary (not full documents — context efficient)
- Produces interpretation-report.toon with conflicts and coverage gaps
- Conflicts have severity: blocking (halt pipeline), warning (log), info (note)
- Coverage gaps identify plan deliverables with no test coverage and test criteria with no plan deliverable
- Resolved conflicts feed to wiki-maintainer as decision pages
- Model: opus (must reason across two complex documents)
<!-- Applied: FC-01 -->
- interpretation-conflict.schema.toon defines conflict record format
- Conflicts are persisted to `.plan-execution/conflicts/`
<!-- Applied: UX-01 -->
- In manual mode: conflicts are presented as numbered prompts with plan vs test interpretation side-by-side, user chooses or provides resolution. In auto mode: blocking conflicts are fatal with structured error output, warnings are logged to interpretation-report.toon
- Queries wiki for prior conflict resolutions on the same feature/phase before flagging — avoids re-flagging disagreements that were already resolved in prior iterations

**Convergence targets:**
- interpretation-report.toon validates against schema (all required fields present)
- Known-ambiguous test fixture plan produces >= 1 blocking conflict

### F-07: Superpowers Pattern Integration

<!-- Applied: ST-01 — threaded into M-02a, promoted to P0 -->
**Priority:** P0
**Milestone:** M-02a
**Description:** Adopt three behavioral patterns from Superpowers into existing agents: strict TDD enforcement (implementer must confirm test stubs fail before implementing, confirm they pass after), diagnose-before-fix (fixer-agent investigates root cause before applying fix), and hard verification gate (AgentResult schema requires non-empty verification status). These patterns ship with the convergence engine to ensure TDD enforcement is present from the first convergence cycle.

**Entities involved:** AgentResult

**Key behaviors:**
- Implementer-agent runs test stubs and confirms failure before writing implementation code
- Implementer-agent runs test stubs and confirms passage after writing implementation code
- Fixer-agent reads finding, diagnoses root cause, documents diagnosis, then applies fix
- Fixer-agent queries wiki for architectural constraints and known patterns on affected components before applying fixes — prevents re-introducing previously rejected approaches
- AgentResult schema adds required `verificationStatus` field (verified/unverified/partial)
- Unverified AgentResults trigger warning in convergence-driver
<!-- Applied: FC-07 -->
- AgentResult schema adds optional diagnoseLog field for fixer-agent diagnosis output

### F-08: System Integration (Wiki, Context, Logging)

**Priority:** P1
<!-- Applied: ST-01 + SF-07 — M-04 renumbered to M-03 -->
**Milestone:** M-03
**Description:** Wire the new test architecture into the three cross-cutting systems. Wiki captures test decisions, quality history, and verified user flows. Context management applies budget caps and HOT/WARM/COLD compression to test agents. Logging adds test result fields to statusline, structured audit trail for test history, and new event types in execution-log.

**Entities involved:** WikiPage, StageContext, ExecutionLog, AgentResult

**Key behaviors:**
- Wiki-maintainer triggers on: criteria-plan created, convergence complete, conflicts resolved, e2e stories verified
- Wiki creates pages for: test coverage maps, quality history, verified user flows, design constraints from QA
- StageContext files added: test-design.toon, interpretation.toon, unit-test.toon, qa-review.toon, e2e-test.toon
- Rolling context compression: HOT (current wave tests), WARM (prior 2 waves pass/fail + blocking), COLD (one-line summary)
- Statusline adds: test counts, QA findings, convergence iteration/rate
- Execution-log adds event types: unit-test-gate, qa-review-gate, convergence-iteration, e2e-complete, interpretation-conflict
- All test agents stay within 100k token budget (context-budget-reviewer preflight)
<!-- Applied: UX-07 -->
- Statusline truncation: if content exceeds terminal width, truncate from right with '...' suffix. Full status available via `/loom status`.
- Wiki-query protocol formalized: targeted queries scoped to feature/phase being worked on, results injected as rolling-context section `## Project Knowledge [WIKI]`
- Rolling-context wiki injection is default-on for all execution agents (implementers, reviewers, fixers) — opt-out via `--no-wiki-context`

### F-09: Cross-Platform Support (OpenCode + Pi)

**Priority:** P1
**Milestone:** M-04
**Description:** Make Loom work on OpenCode (primary) and Pi (secondary) in addition to Claude Code. OpenCode gets near-full capability via its native Task tool, full hook lifecycle (tool.execute.before/after, stop), and TypeScript plugin system. Pi gets tool registration via registerTool() and its 25-event extension API. Goose and Codex CLI get degraded-mode support (commands and skills only, no hooks or orchestration). Convergence loop runs sequentially on platforms without parallel subagent support — functionally complete, just slower.

**Entities involved:** PlatformAdapter, HookContract, PluginManifest

**Key behaviors:**
- Hook-contract spec defines mapping: every Loom hook → OpenCode/Pi equivalent, with gap documentation
- OpenCode plugin: tool.execute.before (budget, ownership, contract lock), tool.execute.after (status), stop (debrief), experimental.chat.system.transform (rolling-context injection), experimental.session.compacting (state preservation)
- Pi extension: registerTool() for loom-converge/execute/debate as first-class tools, tool_call/tool_result/session_shutdown events for hooks, SKILL.md for commands
- install.sh gains --platform flag (opencode, pi, goose, codex) — writes to platform-specific config dirs
- Runtime detection via LOOM_RUNTIME env var or filesystem probe (GSD pattern)
- All hooks parameterize config paths — no hardcoded ~/.claude/
- Commands installed via Agent Skills standard (SKILL.md) — already portable to all platforms
- npm distribution: @launchstack/loom-opencode, @launchstack/loom-pi
- Sequential degradation documented: on platforms without parallel subagents, orchestration patterns collapse to sequential inline execution
- Known gap: OpenCode plugin hooks don't intercept subagent tool calls (anomalyco/opencode#5894) — budget tracking and file ownership enforcement won't protect subagent actions. Blocked until resolved.

**Convergence targets:**
- Loom hooks execute correctly on OpenCode (tool.execute.before blocks unauthorized writes)
- Commands discoverable via Agent Skills on OpenCode and Pi
- Convergence loop completes (sequentially) on OpenCode
- Cross-platform session resume: start on Claude Code, continue on OpenCode via TOON state files

### F-10: Repo Map (Aider-Style Proactive Context Pack)

**Priority:** P2
**Milestone:** M-05
**Description:** Port Aider's RepoMap pattern to Loom as a deterministic, platform-agnostic proactive-context layer. Tree-sitter extracts symbols, a directed graph captures references between files, personalized PageRank ranks importance, and a token-budgeted symbol pack is injected into agent prompts before they begin work. Proactive sibling to Serena's reactive query MCP — pre-populates the agent with the symbols closest to the current plan-phase File Ownership instead of waiting for the agent to ask. Replaces the deferred `wiki-context-suggester` from PLAN-wiki-flows-contracts (its regex-based fuzzy matching was brittle). Strategic property preserved from Aider: no embedding model, no vector store, no model-version pinning — fits Loom's everything-is-files ethos and the C-09 platform-agnostic constraint.

**Entities involved:** RepoMap, RepoMapSymbol, RankingConfig, StageContext

**Key behaviors:**
- Tree-sitter parses TS/JS/Markdown in v1; other languages fail gracefully (log + skip)
- Reference graph: directed edge from file A → file B when A references a symbol defined in B; queries are tree-sitter, not regex
- Personalized PageRank: damping 0.85, personalization weight 100, convergence ε<1e-6 within 100 iterations on a 1k-file graph
- Token-budgeted pack: hard cap (default 8000), never exceeded, fills as much as possible; estimation via `hooks/lib/token-estimator.ts`
- Personalization seed composition: orchestrator hint > current plan-phase File Ownership > recent `git diff HEAD~1..HEAD` files
- `agent-prompt-builder.ts` injects the rendered pack into agent prompts under `## Repo Map (auto-generated)`; respects per-agent context cap (shrinks map before base prompt)
- `/loom-repo-map build` produces the map on demand; `/loom-repo-map inspect --file <path>` shows PageRank + inbound/outbound refs for debugging
- `wiki-context-suggester` hook (UserPromptSubmit) injects a top-10 symbol pack into ad-hoc prompts seeded by extracted keywords + git-diff context
- Wiki bridge: high-rank symbols without a corresponding `component-*` wiki page surface as documentation gaps the wiki-maintainer-agent can ingest
- Determinism: identical seed + identical disk state produces byte-identical output

**Convergence targets:**
- `buildRepoMap()` on the loom-ai repo produces a token-budgeted (≤8k tokens) symbol pack in <5 seconds
- Personalization measurably re-ranks: seeding with `scenario.schema.md` vs `loom-plan/execute.md` produces distinct top-20s
- `wiki-context-suggester` UserPromptSubmit hook fires without exceeding the conversation budget
- At least one structurally-important function in loom-ai without a `component-*` wiki page is surfaced as a documentation gap by the wiki bridge

## Data Model (Conceptual)

### Entities

<!-- Applied: SF-05 — consolidated from 16 to 12 entities. Merged PlaywrightSession into PlaywrightTest, ScreenshotAuditTrail into E2EStory, removed ConflictTracker (implementation detail of DeltaReport), removed StatusLine (rendering concern). -->

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| Taxonomy | levels, convergenceLevels, hierarchy | Defines Milestone > Feature > Phase > Wave hierarchy |
| CriteriaPlan | criteria[], reviewers[], testConfig, budget | Test criteria plan produced by criteria-planner |
| InterpretationConflict | id, source, planInterpretation, testInterpretation, severity | Conflict between plan and test interpretations |
| CoverageGap | id, source, description | Plan deliverable with no test or test with no deliverable |
| ConvergenceTier | name, level, runner, passCondition, defaultEnabled | One of: unit, integration, e2e, qa-review |
| E2EStory | name, url, workflow, preconditions, format, screenshots[], consoleDumps[] | YAML user story for e2e testing with screenshot audit trail |
| PlaywrightTest | storyRef, testFile, sessionName, sessionMode, isolated | Generated Playwright test from e2e story with session config |
| DeltaReport | criteria[], findings[], conflicts[], tier, criterionHistory[] | Unified test results across all tiers with conflict detection |
| StageContext | stage, summary, timing, tokenUsage | Compressed stage output for context efficiency |
| WikiPage | title, sourceRefs, content, lastUpdated | Wiki knowledge page |
| ExecutionLog | events[] | Structured audit trail with timestamped events |
| AgentResult | status, filesCreated, findings, verificationStatus, diagnoseLog | Standard agent output envelope |
| PlanPhase | id, name, wave, feature, deliverables, acceptanceCriteria | Execution unit within a plan |

### Relationships

<!-- Applied: SF-05 — updated relationships to match consolidated entities -->

| From | To | Type | Description |
|------|-----|------|-------------|
| Milestone | Feature | 1:N | A milestone groups multiple features |
| Feature | PlanPhase | 1:N | A feature decomposes into phases |
| PlanPhase | ConvergenceTier | M:N | Each phase may be tested by multiple tiers |
| CriteriaPlan | ConvergenceTier | 1:N | Criteria plan assigns criteria to tiers |
| CriteriaPlan | InterpretationConflict | 1:N | Conflicts discovered from dual-track planning |
| E2EStory | PlaywrightTest | 1:1 | Each story produces one test file |
| ConvergenceTier | DeltaReport | 1:1 | Each tier produces a delta report |
| StageContext | WikiPage | N:N | Stage summaries trigger wiki updates |
| ExecutionLog | StageContext | 1:N | Log events reference stage completions |

## Milestones

### M-01: Planning Foundation -- COMPLETE

**Features:** F-01, F-02, F-06
**Status:** Complete -- all artifacts shipped (taxonomy.md, criteria-planner-agent, interpretation-reviewer-agent, parallel spawn in loom-plan create)
**Depends on:** None
**Acceptance:** Taxonomy is formalized, dual-track planning runs in parallel, interpretation-reviewer catches known ambiguities in test fixture plans.
**Effort:** L

<!-- Applied: ST-03 -->
#### MVP Boundary

M-01 alone delivers: formalized planning taxonomy, parallel test criteria generation, and interpretation conflict detection. A team can use M-01 without M-02+ and still get tests-before-code and ambiguity detection on every plan.

<!-- Applied: SF-01 — split M-02 into M-02a (F-03 + F-07) and M-02b (F-04 + F-05) -->
<!-- Applied: ST-01 — threaded F-07 (behavioral hardening) into M-02a -->

### M-02a: 4-Tier Convergence Engine + Behavioral Hardening -- COMPLETE

**Features:** F-03, F-07
**Status:** Complete -- convergence-tier.schema.md, convergence-driver.md, behavioral-guidelines.md, AgentResult verificationStatus + diagnoseLog all shipped
**Depends on:** M-01
**Acceptance:** All 4 tiers execute at their correct hierarchy levels, unit tests gate waves, red-green TDD gate enforced by implementer, fixer diagnoses before fixing, AgentResult requires verification status.
**Effort:** XL

### M-02b: E2E Pipeline -- COMPLETE

**Features:** F-04, F-05
**Status:** Complete -- e2e-test-writer-agent.md, e2e-runner-agent.md, e2e-story.schema.md all shipped. Playwright headless + Chrome MCP modes.
**Depends on:** M-02a
**Acceptance:** E2E test writer produces Playwright tests from YAML stories, e2e runner executes with screenshot audit trail, `/loom converge --e2e` works in manual mode and mid-execution.
**Effort:** L

<!-- Applied: ST-01 — removed standalone M-03 (Behavioral Hardening), renumbered M-04 to M-03 -->
<!-- Applied: SF-04 — effort changed from L to XL -->
<!-- Applied: SF-07 — M-03 depends on M-02b which includes the threaded behavioral patterns -->

### M-03: Cross-System Integration -- COMPLETE

**Features:** F-08
**Status:** Complete -- wiki-maintainer-triggers.md (5 triggers including execution-debrief), execution-log.schema.md (15+ event types), statusline-contract.md (test metrics, convergence segments), rolling-context wiki injection all shipped
**Depends on:** M-02b
**Acceptance:** Wiki captures test decisions and quality history, context budget holds for all test agents, statusline shows test metrics, execution-log records all test events.
**Effort:** XL

### M-04: Cross-Platform Support -- BLOCKED

**Features:** F-09
**Status:** Blocked -- awaiting anomalyco/opencode#5894 resolution. Hook-contract spec not yet written.
**Depends on:** M-01 (convergence foundation must be proven before multi-platform)
**Acceptance:** Loom hooks execute on OpenCode (budget, ownership, contract lock). Commands and skills are discoverable on OpenCode and Pi via Agent Skills. Convergence loop completes sequentially on OpenCode. Cross-platform session resume works via TOON state files.
**Effort:** L (OpenCode: ~1 week, Pi: ~1 week)
**Constraint:** Blocked until anomalyco/opencode#5894 resolves. Hook-contract spec must be written and locked before implementation begins. Hard kick-off date set at spec completion, not a floating condition.

#### Phasing

1. **Spec phase (this week):** Write hook-contract spec — map every Loom hook to OpenCode/Pi equivalents, document gaps, define acceptance criteria
2. **OpenCode phase (post-#5894):** Build OpenCode plugin, install.sh --platform opencode, npm package
3. **Pi phase (after OpenCode ships):** Build Pi extension with registerTool(), npm package
4. **Degraded targets (opportunistic):** Goose recipe adapter, Codex CLI commands — only if demand exists

### M-05: Repo Map Integration -- NOT STARTED

**Features:** F-10
**Status:** Not started -- PLAN-repo-map.md drafted 2026-05-30 (4 phases / 4 waves / 2 sub-milestones). No code yet. Supersedes the archived context-mode exploration (see `.plan-history/explorations/2026-05-01-context-mode-vs-repo-map.md`) on the platform-agnostic principle.
**Depends on:** None for core (M-01). Wiki bridge (Phase 3) benefits from but does not require contract-page materialization (M-02b spec-upgrades, already complete).
**Acceptance:** `buildRepoMap()` produces a deterministic, token-budgeted, personalizable symbol pack against the loom-ai repo. Orchestrators inject the pack into agent prompts. `wiki-context-suggester` hook fires on UserPromptSubmit. High-rank symbols without `component-*` wiki coverage surface as documentation gaps.
**Effort:** M (tree-sitter + graph + PageRank + render + orchestrator wiring; pure TypeScript, no external services)

#### Phasing

1. **Schema contracts (Phase 0, Wave 0):** `repo-map.schema.md`, `ranking-config.schema.md` — rendered-pack format, tuning knobs, defaults.
2. **Core algorithm (Phase 1, Wave 1):** Tree-sitter extraction, reference graph build, personalized PageRank, token-budgeted render. ≥15 vitest cases covering 3 languages, graph correctness, PageRank convergence, budget invariants, determinism.
3. **Orchestrator integration (Phase 2, Wave 2):** `repo-map-seeder.ts`, `agent-prompt-builder.ts`, `/loom-repo-map build|inspect` CLI. Independently shippable (M-01 sub-milestone).
4. **Wiki bridge (Phase 3, Wave 3):** `wiki-context-suggester.ts` UserPromptSubmit hook replaces the deferred fuzzy-regex variant. `wiki-maintainer-agent` documents how high-rank symbols without wiki pages become ingestion candidates.

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Parallel planning doubles token cost at plan creation | medium | high | Both agents read the same compact input (roadmap feature, not full roadmap). Interpretation-reviewer reads summaries, not full outputs. Net cost increase ~40% at plan time, offset by fewer convergence iterations. |
| Playwright adds heavyweight dependency | medium | medium | Playwright is only installed when e2e stories exist. No e2e stories = no Playwright. The harness detects and skips gracefully. |
| QA review at phase level may be noisy | medium | medium | Fan-out to multiple sonnet reviewers with specific dimensions. Each reviewer is scoped to its dimensions only. Conflict detection freezes oscillating findings. |
| Interpretation-reviewer produces false positive conflicts | low | medium | Severity levels (blocking/warning/info) let users triage. Only blocking conflicts halt the pipeline. False positives are info-level. |
| Context budget pressure from 4 tiers of test agents | high | medium | Each tier's agents are context-efficient: unit runner reads only test stubs + changed files, QA reviewers get only their dimensions, e2e runner reads YAML stories only. HOT/WARM/COLD compression for test history. |
| Chrome MCP mode is single-instance (no parallel) | low | high | Document limitation. Parallel e2e uses Playwright headless. Chrome mode is for authenticated flow debugging only. |
| OpenCode hooks don't intercept subagent tool calls (#5894) | high | high | Blocked until resolved. Budget and ownership enforcement has a real gap on OpenCode subagents. Do not ship until fixed. |
| OpenCode experimental APIs (chat.system.transform, session.compacting) may break | medium | medium | Pin to specific OpenCode version. Thin adapter isolates breaking changes. These features are used for rolling-context injection and compaction state — degraded without them but not fatal. |
| Cross-platform maintenance tax slows convergence development | medium | medium | OpenCode and Pi are separate npm packages with isolated adapters. Core Loom code never branches on platform. Testing: core logic in vitest (zero platform dep) + one smoke test per platform. |
| GSD trap: wide and shallow multi-platform degrades orchestration quality | medium | low | Constraint C-08 explicitly rejects lowest-common-denominator. OpenCode gets near-full capability (native Task tool). Sequential degradation is documented, not hidden. |
| Tree-sitter grammar maintenance across languages | medium | medium | Ship TS/JS/Markdown only in v1. Document the failure-mode-is-skip contract so adding a language is purely additive — a project with mostly-unsupported languages degrades to empty pack, not a crash. |
| PageRank perf on large repos (>10k files) | medium | low | v1 measures on loom-ai (~600 files). Cache strategy D-01 has file-watcher invalidation as escape hatch if needed. Projects >5k files surface a warning. |
| Token-budgeted pack drops critical symbols on overflow | medium | medium | `agent-prompt-builder.ts` shrinks the map before truncating the base prompt. Deterministic ordering means dropped symbols are always the lowest-rank ones. Orchestrators pass a higher `tokenBudget` for phases that need broader context. |
| Repo map drifts from wiki contract pages | high | low | Repo map is **derived** (never authored); wiki contract pages are **authored**. Repo map never overrides wiki — it can only flag gaps for the maintainer to consider. |

## Out of Scope

- Third-party e2e framework wrappers — Playwright is called directly; no orchestration layer between Loom and the browser
- Visual regression testing / pixel-diff comparisons (fragile, high maintenance)
- Performance benchmarking as a convergence criterion (non-deterministic across runs)
- Mobile app testing or native platform testing
- Third-party CI/CD integration (GitHub Actions, CircleCI) — convergence runs inside Claude Code
- Real-time test dashboard or web UI for convergence monitoring
- Custom test framework development — we use existing runners (Vitest, Jest, Pytest, Playwright)

## Model Assignments

| Agent | Model | Rationale |
|-------|-------|-----------|
| plan-builder-agent | opus | High-stakes output, sets foundation |
| criteria-planner-agent | opus (upgrade) | Co-creates test criteria, needs deep reasoning for parallel track |
| interpretation-reviewer | opus | Reasons across two complex documents for subtle conflicts |
| convergence-driver | opus (upgrade) | Circuit breaker decisions, iteration strategy, stall detection |
| e2e-test-writer-agent | sonnet | Structured translation of specs to tests |
| criteria-harness-builder | sonnet | Builds scripts from plan — structured work |
| contracts-agent | sonnet (downgrade) | Generates types from spec — structured |
| implementer-agent | opus | Complex implementation — correct as-is |
| fixer-agent | sonnet (downgrade) | Targeted fixes with clear findings |
| test-stage-teammate | sonnet (downgrade) | Test generation — structured, not creative |
| review-stage-teammate | sonnet (downgrade) | Code review with defined dimensions |
| QA reviewers (fan-out) | sonnet | Multiple sonnet > one opus for review |
| e2e-runner (harness) | haiku | Orchestrates Playwright, parses results |
| delta-analyzer | haiku | Structured gap analysis — correct as-is |
| verification-agent | haiku | Runs commands, checks outputs — correct as-is |
| auto-dispatcher | sonnet | Lean lead, reads summaries only — correct as-is |
| platform-adapter (OpenCode) | N/A | TypeScript plugin — no model, runs as hook/tool |
| platform-adapter (Pi) | N/A | TypeScript extension — no model, runs in-process |

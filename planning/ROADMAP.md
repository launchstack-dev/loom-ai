---
roadmapVersion: 1
name: "Loom Convergence Testing & Planning Taxonomy"
status: approved
created: 2026-04-18
lastReviewed: 2026-05-01
targetDate: null
totalFeatures: 14
totalMilestones: 7
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
- Plan-builder and criteria-planner spawn in parallel during `/loom-plan create` and `/loom-auto`
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
**Description:** Implement the 4-tier testing model: unit tests (phase level), integration tests (feature level), e2e tests (milestone level), QA agentic code review (phase/feature level, configurable). Each tier has a runner, pass condition, and gating behavior. Unit and QA review are default-on in all modes. Integration is default-on. E2E is default-on in auto mode, triggered via `/loom-converge --e2e` in manual mode. Initial implementation targets convergence-driver and contracts-agent only. Other agents adopt the 4-tier model incrementally via M-03 system integration.

**Entities involved:** ConvergenceTier, CriteriaPlan, DeltaReport

**Key behaviors:**
- Unit tests gate each wave — failing units block next wave
- QA review runs after each wave with configurable scope (phase or feature)
- Integration tests run at feature completion boundary
- E2E tests run at milestone completion boundary
- Opt-out flags: `--no-tests`, `--no-e2e`, `--no-qa-review`, `--tests-only`
- `/loom-converge --e2e` triggers e2e for completed plan in manual mode
- `/loom-converge --full` triggers all 4 tiers
<!-- Applied: FC-02 -->
- criteria-plan.toon targets array includes testTier column (unit|integration|e2e|qa-review)
<!-- Applied: FC-03 -->
- `/loom-converge --tier unit|integration|e2e|qa-review` runs only the specified tier
<!-- Applied: FC-05 -->
- QA findings support bulk-approve: `/loom-converge --approve-qa` accepts all non-blocking findings in the current review
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
- `/loom-converge --e2e` is valid at any point during or after execution. It runs against whatever milestones are complete. Mid-execution e2e runs test completed milestones only.

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
- Statusline truncation: if content exceeds terminal width, truncate from right with '...' suffix. Full status available via `/loom-status`.
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

### F-11: Scenarios Layer + Change-Proposal Lifecycle

**Priority:** P0
**Milestone:** M-06 (incorporates work shipped under M-02b and M-03)
**Status:** Code merged 2026-05-23 (PR ports + spec-upgrades branch); publicly released as part of OSS launch.
**Description:** Two coupled upgrades that elevate Loom from "tests after plans" to "scenarios as enforcement gates." Upgrade A: scenarios are first-class plan artifacts — Given/When/Then statements typed by domain shape (api, ui, data, agent, lifecycle) that bind to convergence tiers and gate wave exits. Upgrade B: change proposals (OpenSpec-style init → review → approve → run → archive lifecycle) are the canonical authoring path for non-trivial roadmap and plan deltas. Together they close two gaps in M-01 through M-03: scenarios were implicit in criteria-plan.toon rather than authored, and ad-hoc roadmap mutations bypassed review/approval.

**Entities involved:** Scenario, ChangeProposal, ScenarioBinding, ContractPage

**Key behaviors:**
- Scenarios are typed (api, ui, data, agent, lifecycle) and bind 1:N to convergence-tier criteria via `scenarioRef` in criteria-plan.toon
- `scenarios-author-agent` produces scenarios in parallel with plan-builder during dual-track planning (M-01 pattern extended)
- Change-proposal lifecycle: `/loom-roadmap mutate --propose` writes `.loom/changes/{id}/proposal.md`; review/approve/archive transition the proposal through a state machine
- ContractPage materializer converts approved proposals into wiki contract pages with cross-refs to scenarios
- Scenarios materialize into convergence-tier criteria automatically — no double-bookkeeping

**Convergence targets:**
- Plan creation with `--scenarios` flag produces at least 1 scenario per phase, bound to a convergence tier
- A proposal flows init → review → approve → run → archive without manual file manipulation
- Materializer produces a contract page from an approved proposal with all `producers/consumers/touches` populated
- Unapproved proposals do not appear in ROADMAP.md or PLAN-*.md (gated)

### F-12: OSS Launch Distribution

**Priority:** P0
**Milestone:** M-06
**Status:** Phase 0 IN-FLIGHT (4 of 6 deliverables shipped: schemas v3, version cadence, verify-release, cosign spike workflow). Two gates remain before Phase 1: cosign keyless workflow_dispatch verification (~2 hours) and the 5-stranger cold-install demand test (gate; if 4+/5 bounce, plan halts pending re-scoping). Phase 1 (release workflow + install-state v3 runtime) is the next mile.
**Description:** Public launch tooling for `launchstack-dev/loom-ai`: cosign-signed releases (keyless OIDC + Sigstore transparency log), version-pinned installer (`install.sh --ref vX.Y.Z`), atomic file-scoped rollback, checksum manifests, and the schema-versioned migration runtime (Rules 12-14). The installer fetches from `main` in alpha; signed-tarball flow ships at Phase 1. See `planning/plans/PLAN-oss-launch.md`.

**Entities involved:** Release, ChecksumManifest, VersionedCatalog, MigrationRule

**Key behaviors:**
- Releases tagged with semver; `releases[]` entry includes cosign signature URL, transparency-log entry, install-state-version, hooks-version
- `install.sh` validates fetched files against `checksums.sha256` (alpha) and against cosign signatures (Phase 1+)
- Catalog (`library.yaml`) ships `loomCoreVersion`, `loomHooksVersion`, `releases[]` (Rule 13 v3 schema)
- `/loom-upgrade --project` migrates user state to current versions via the chained migration walker

**Convergence targets:**
- 5-stranger cold-install test: ≥1/5 successful first-try install end-to-end
- Cosign workflow_dispatch produces a verifiable signature on a tagged release
- `/loom-library update` self-bumps catalog and re-pulls changed items idempotently
- `install.sh --ref v0.0.X` pins to a tag and verifies the checksum manifest

### F-13: Schema Migration Foundation

**Priority:** P0
**Milestone:** M-06
**Status:** Spec + migrators COMPLETE (PR #11 merged 2026-06-04); runtime wiring pending Phase 1 of F-12.
**Description:** Forward-compatible schema migration runtime for Loom's on-disk artifacts. Pure-function migrators (no I/O) with injected `sha256Resolver`, `now()`, and `onWarning` callbacks. Chained walker pattern (`migrateToLatest(input, fromVersion, opts, targetVersion?)`) walks every step in a frozen `MIGRATIONS` map — a user upgrading from v2 directly to v5 gets v2→v3→v4→v5 executed in sequence. Structured error subclasses (`MigrationError`, `MissingMigrationStepError`, `MigrationDowngradeError`, etc.) classify failure modes. Schema versions registry (`schema-versions.toon`) is the single source of truth for "what version is current" — `/loom-upgrade` reads it to drive detection and migration.

**Entities involved:** SchemaVersion, MigrationRule, MigrationError, InstallStateV3, LibraryCatalogV3

**Key behaviors:**
- Per-schema `detectXVersion(content)` returns `{detected: N, current: M, outdated: boolean}`
- Per-schema `migrateXvAtoB(input, opts)` is a pure function — no fs, no network
- Walker pattern: `MIGRATIONS["v2->v3"]`, `MIGRATIONS["v3->v4"]`, etc. — registry-driven; new versions are additive
- Object.freeze on the MIGRATIONS map prevents prototype pollution / runtime mutation (CWE-913 mitigation)
- URL validation (https-only, allowlist) and semver regex on synthesized `releases[]` entries
- Detection regex is line-anchored to defeat string-smuggling attacks

**Convergence targets:**
- `migrateToLatest()` v2→v3 walks one step; placeholder v3→v4 walks two steps; both produce valid output
- `detectInstallStateVersion()` and `detectLibraryCatalogVersion()` correctly classify pre-v2, v2, v3, and tampered fixtures
- Structured error subclasses thrown on missing steps, downgrade attempts, and validation failures
- Pure-function migrators run identically with synthetic and real fixtures (test fixture parity passes)

### F-14: Hook Runtime Wrapper + Symlink Safety

**Priority:** P1
**Milestone:** M-06
**Status:** Code merged (PR #11 + PR #12); publicly released with OSS launch.
**Description:** Two distribution-hardening fixes surfaced during dogfooding. (1) Hook runtime wrapper: `hooks/run-hook.sh` is a POSIX shell wrapper that resolves the JavaScript runtime in order — `bun` → `npx tsx` → fail-open — so Loom hooks run on machines that don't have `bun` installed. `.claude/settings.json` references the wrapper, not bun directly. (2) Symlink-aware sync: `/loom-library sync` and `/loom-upgrade` skip targets that are symlinks (any symlink, regardless of destination) to prevent silent overwrites of dev installs, user dotfiles, or any other symlinked target. Surfaces the link with `[link]` classification rather than writing through.

**Entities involved:** HookRuntime, SyncTarget, SymlinkClassification

**Key behaviors:**
- `hooks/run-hook.sh` returns 0 (fail-open) when no runtime is available; stderr warns but never blocks Claude Code
- All 10 hooks in `.claude/settings.json` invoke `sh "$wrapper" "$path"` instead of `bun "$path"` directly
- Sync/upgrade lstat the target; symlinks → `[link]` classification, skipped
- Stale `pipeline-state.toon` (>7 days mtime, non-terminal stage) auto-skips with a one-line stderr advisory
- Rule 12/13 missing-file recovery: bootstrap empty v3 install-state if missing; fetch canonical library.yaml on miss

**Convergence targets:**
- Hooks fire on a machine with only Node (no bun) — no errors, just stderr advisory
- `/loom-library sync` on a Loom-dogfood install (where `~/.claude/agents/*` symlinks back to the repo) does not corrupt the repo
- A 2-month-old stale pipeline-state does not block `/stop` events

### F-15: Native Claude Code Plugin Manifest

**Priority:** P1
**Milestone:** M-07
**Status:** Backlog — deferred from PR #8 follow-up; immediate-next after PR #8 merges. Sourced from deep-research finding #2 (sources: Anthropic `code.claude.com/docs/en/plugins-reference`, `anthropics/claude-code/plugins`, `jnuyens/gsd-plugin`, `musingfox/cc-plugins`, `anthropics/claude-plugins-official/security-guidance`).

**Description:** Ship a `.claude-plugin/plugin.json` + `hooks/hooks.json` at the repo root so users can install Loom via Anthropic's native `/plugin marketplace add launchstack-dev/loom-ai` + `/plugin install loom`. Plugins auto-register hooks, agents, skills, commands, and MCP servers without mutating user `~/.claude/settings.json`. The curl `install.sh` path stays as a fallback for users not yet on the plugin-marketplace UX.

**Entities involved:** PluginManifest, HookManifest, MarketplaceListing, InstallSource (curl | plugin)

**Key behaviors:**
- `.claude-plugin/plugin.json` declares plugin name, version, description, command/agent/skill/hook paths
- `hooks/hooks.json` lists all 14 enforcement hooks with `${CLAUDE_PLUGIN_ROOT}`-anchored commands (matches the path-anchoring fix landed in PR #8 commit `b7285e8`)
- `install.sh` and the plugin path are mutually exclusive — installer detects an existing plugin install and exits with a one-line pointer
- Both install paths land on the same `${CLAUDE_PROJECT_DIR}` or `${CLAUDE_PLUGIN_ROOT}` anchored commands at runtime — no behavior divergence between users on either path

**Convergence targets:**
- Fresh user runs `/plugin marketplace add launchstack-dev/loom-ai && /plugin install loom` — all 14 hooks resolve, all slash commands available
- Existing curl-install user runs the plugin install — `/loom-doctor` (F-16) detects and migrates without dupe registrations
- The two install paths produce byte-identical `.claude/settings.json` (modulo the `${CLAUDE_PLUGIN_ROOT}` vs `${CLAUDE_PROJECT_DIR}` anchor)

### F-16: /loom-doctor + First-Session Auto-Migration

**Priority:** P1
**Milestone:** M-07
**Status:** Backlog — deferred from PR #8 follow-up. Sourced from deep-research finding #3 (sources: `musingfox/cc-plugins` doctor/update skill triad, `jnuyens/gsd-plugin` first-session auto-migration pattern).

**Description:** Replace ad-hoc `cp -n` + `--replace` heuristics with a dedicated `/loom-doctor` skill that health-checks installed hooks (file exists, runner resolves, settings shape valid, paths anchored) and a SessionStart auto-migration that detects and rewrites legacy entries with ownership-evidence guarding so user-customized files aren't clobbered.

**Entities involved:** DoctorReport (status, problems[], suggestedFixes[]), MigrationEvidence (file-hash, install-source, mtime), HealthCheck

**Key behaviors:**
- `/loom-doctor` reports: each hook file present at expected path? runner resolves (bun → npx tsx → wrapper)? settings.json entries anchored with `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}`? no orphan entries pointing at deleted files?
- SessionStart auto-migration runs once per project; idempotent; refuses to rewrite a file whose hash diverges from any known Loom-shipped version (ownership-evidence guard from GSD)
- Migrate-out path: detects legacy bare `hooks/<name>.ts` entries from earlier Loom installs and rewrites to `${CLAUDE_PROJECT_DIR}/hooks/<name>.ts` (matches PR #8's regex which already accepts both anchors)
- Doctor exits 0 (healthy) or 1 (problems found) with structured TOON output so it composes with `/loom-converge`

**Convergence targets:**
- A project with mixed legacy + new entries runs through one SessionStart and emerges with all entries anchored
- A user who hand-edited a hook file with a custom check has their edit preserved; doctor flags the divergence as a warning, not an auto-rewrite
- `/loom-doctor` on a clean Loom install reports zero problems

### F-17: settings.local.json as Default Per-Project Hook Tier

**Priority:** P2
**Milestone:** M-07
**Status:** Backlog — deferred from PR #8 follow-up. Sourced from deep-research finding #4 (sources: `musingfox/cc-plugins`, Anthropic `code.claude.com/docs/en/settings` three-tier hierarchy doc).

**Description:** Default per-project hook registrations into `.claude/settings.local.json` (gitignored, machine-local) instead of `.claude/settings.json` (committed). Teams who want hooks committed can opt into the `settings.json` target with a flag. Aligns with Anthropic's documented three-tier hierarchy (user-global → project → project-local) and avoids accidental commits of paths that reference a developer's specific machine layout.

**Entities involved:** SettingsTier (user | project | local | managed), TierResolution

**Key behaviors:**
- `register-loom-hooks.ts` defaults to `--settings .claude/settings.local.json` (current default is `.claude/settings.json`)
- Adds `--tier project|local` flag for explicit override; `local` is default, `project` opts into committed
- `/loom-init` adds a one-line prompt: "Commit hooks to repo (.claude/settings.json) or keep machine-local (.claude/settings.local.json, recommended)?" — default local
- `/loom-doctor` (F-16) understands both tiers and reports the resolution

**Convergence targets:**
- Fresh `/loom-init` creates `.claude/settings.local.json` only; no committed config drift
- A team that wants committed hooks (e.g. CI-enforced) can re-run with `--tier project` and get the prior behavior
- Migration: existing committed `.claude/settings.json` hooks stay where they are; doctor offers a one-shot move-to-local migration

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

> **Status legend:** `COMPLETE` = code merged to `main` and exercised in dogfooding. `RELEASED` = signed public release tagged and published. `COMPLETE` does not imply `RELEASED` — the public OSS launch (M-06) is the gating event for the latter. Pre-launch, every milestone status reads as `COMPLETE (unreleased)` from a public-distribution perspective.

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
**Acceptance:** E2E test writer produces Playwright tests from YAML stories, e2e runner executes with screenshot audit trail, `/loom-converge --e2e` works in manual mode and mid-execution.
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

### M-06: OSS Launch -- IN-FLIGHT

**Features:** F-11, F-12, F-13, F-14
**Status:** In-flight. F-11 (scenarios + change-proposal) merged 2026-05-23. F-13 (schema migration foundation) merged 2026-06-04. F-14 (hook runtime wrapper + symlink safety) merged through PR #11 and PR #12. F-12 (OSS launch distribution) is the gating stream: Phase 0 has 4 of 6 deliverables shipped; remaining gates are the cosign workflow_dispatch verification and the 5-stranger cold-install demand test. Phase 1 (release workflow + install-state v3 runtime) begins once both gates clear.
**Depends on:** M-01, M-02a, M-02b, M-03 (the convergence story is what gets launched)
**Acceptance:** Public repo `launchstack-dev/loom-ai` reaches v0.1.0 with cosign-signed releases, version-pinned `install.sh`, schema migration runtime wired through `/loom-upgrade`, 5-stranger cold-install test ≥1/5, and a launch announcement post.
**Effort:** M (Phase 0: 6 deliverables; Phase 1: release workflow + v3 runtime wiring)

#### Phasing

1. **Phase 0 (alpha foundation):** Schemas v3, version cadence doc, verify-release script, cosign spike workflow, run-hook.sh + symlink-safety, checksum manifest. 4 of 6 shipped; gates: cosign workflow_dispatch + 5-stranger demand test.
2. **Phase 1 (signed release):** Release tagging workflow, cosign signing in CI, install.sh `--ref vX.Y.Z` pinning, atomic file-scoped rollback, install-state v3 runtime wiring (Rule 12), library-catalog v3 runtime wiring (Rule 13), plan-artifact relocation (Rule 14).
3. **Phase 2 (launch):** Public announcement, demand validation, post-launch iteration.

### M-07: Plugin Marketplace Migration -- COMPLETED

**Features:** F-15, F-16, F-17
**Status:** Completed 2026-06-18. Shipped via PLAN-plugin-marketplace-merged (12 waves, 15 commits on branch m07). All MS-F lifecycle pieces on disk: install (curl + plugin paths, mutual-exclusion), /loom-doctor (12 check modules + dispatcher + bundle/render), /loom-update (--check/--channel/--resume/--pin/--rollback), /loom-uninstall (typed-literal confirm + 60s timeout), tier-default flip (settings.local.json), and Anthropic marketplace submission artifacts (plugin-install E2E + submission-pr.md + submission-evidence.toon). Outcome=accepted is third-party (Anthropic) and recorded post-merge by the marketplace status poller. Sourced from PR #8 deep-research synthesis (2026-06-16).
**Plan:** planning/plans/PLAN-plugin-marketplace-merged.md
**CompletedAt:** 2026-06-18T05:42:00Z
**Depends on:** M-06 Phase 1 (signed release infrastructure — the plugin path is published alongside signed curl tags, not in place of them)
**Acceptance:** Loom is installable via both `/plugin marketplace add launchstack-dev/loom-ai` (native path) and `curl install.sh | bash` (fallback), producing equivalent runtime behavior. `/loom-doctor` reports zero problems on a fresh install via either path. Default per-project hook tier is `.claude/settings.local.json` (machine-local) with explicit opt-in for committed `.claude/settings.json`. README and `planning/notes/` document the rationale for kit authors.
**Effort:** M (plugin manifest auth + doctor skill + first-session migration + tier-default flip + docs)

#### Phasing

1. **Phase 0 (manifest):** Author `.claude-plugin/plugin.json` + `hooks/hooks.json`. Verify install via `/plugin marketplace add` against a private fork. F-15.
2. **Phase 1 (doctor):** Ship `/loom-doctor` skill + SessionStart auto-migration with ownership-evidence guarding. F-16.
3. **Phase 2 (tier flip):** Flip register-loom-hooks.ts default target to `.claude/settings.local.json`; add `--tier project` opt-in; update `/loom-init` prompt. F-17.
4. **Phase 3 (docs):** Update README's "Hook enforcement" section to lead with the plugin path; demote curl to the "alternative installs" subsection.

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

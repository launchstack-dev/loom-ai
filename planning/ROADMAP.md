---
roadmapVersion: 1
name: "Loom Convergence Testing & Planning Taxonomy"
status: approved
created: 2026-04-18
lastReviewed: 2026-07-10
targetDate: null
totalFeatures: 33
totalMilestones: 13
# Reconciled 2026-07-10 with the fable-readiness fork (PR #42) — see C-17.
# Of the 14 CT6 ports: 3 SUPERSEDED (F-24/F-25/F-26 shipped as fork Track A),
# 2 DROPPED (F-31/F-32 now scaffold-deprecated under fable-readiness's discipline
# profile), 9 SURVIVE and re-platform onto the Workflow engine as fable-readiness
# Track B (F-20/F-21 map producer is the load-bearing activator of the fork's
# already-built-but-dormant map-freshness gate).
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

<!-- Applied: CT6-PORTS — C-10..C-14 added for the CT6 rigor & cartography port milestones (M-09..M-13). Source: ct6-to-loom-port-plan.md, loom-cartography-port-proposal.md (2026-07-08). -->

### C-10: Port the Gate, Not the Skill
**Decision:** Every CT6 capability ported into Loom (M-09..M-13) MUST land as a fail-closed enforcement point wired into Loom's existing hook set — never as an optional standalone skill or utility. A ported skill without its gate is explicitly out of scope.
**Rationale:** CT6's genuine product is the enforcement backbone (a PreToolUse skill-gate that denies Edit/Write/Agent until the pipeline is engaged; a Stop hook that re-runs validation before "done"), not the skills themselves. Loom already shares this instinct (18 tool-call hooks, fail-closed decision tables). The high-leverage ports are the gates (F-23, F-25 (now fork Track A per C-17), F-27, F-30 partition-check), and each ported skill must be non-optional to deliver CT6's value.
**Alternatives considered:** Port skills as opt-in utilities (rejected — reproduces the "la carte skill repo" failure mode CT6 itself avoids); make gates advisory/warn-only (rejected — defeats fail-closed containment)
**Impact:** high

### C-11: No SQLite, No Daemon, Keep the 100k Cap
**Decision:** CT6 ports MUST NOT import a database (CT6's `.mempalace/palace` SQLite store), a long-running background daemon (the Librarian), 1M-token live agent contexts, or unbounded solving loops. All ported state stays file-based, TOON-on-disk; all agent spawns respect the existing 100k-token/spawn cap; all loops stay bounded by Loom's convergence machinery.
**Rationale:** These CT6 mechanisms contradict Loom's whole thesis (containment, no-daemon simplicity, bounded cost, bus-factor transparency). Cross-run memory is already covered by `.loom/learnings.toon`; persistent knowledge is covered by the wiki + map TOON artifacts. Take the *ideas* (persistent map, wake-up query, func-level lineage), implement them over existing primitives.
**Alternatives considered:** Adopt MemPalace SQLite for richer queries (rejected — opacity + daemon liability); allow 1M contexts for named specialists (rejected — cap-busting token burn, the exact failure mode Loom is built against)
**Impact:** high

### C-12: One Shared Trace Graph for Cartography and Lineage
**Decision:** Endpoint/call-trace mapping (C2) and data-lineage mapping (C3) MUST share one graph artifact under `.loom/maps/`, using a common stable-ID scheme (`func://` for code nodes, `asset://<store>/<schema>/<table>` for data nodes). Data-lineage enriches the *existing* `/loom-data lineage` subcommand and its existing `data-lineage-tracker` agent — it does NOT add a new command or agent.
**Rationale:** In CT6 endpoint-trace and data-lineage are one artifact; splitting them in Loom would duplicate extraction and drift. Loom already ships `/loom-data lineage`, so the data layer lands on an existing command and the data track.
**Alternatives considered:** Separate endpoint-trace and lineage graphs (rejected — duplicate extraction, drift); a new `/loom-lineage` command (rejected — an equivalent already exists)
**Impact:** medium

### C-13: Extend Existing Commands — Only Two Net-New Surfaces
**Decision:** The CT6 ports introduce exactly two net-new commands — `/loom-map` and `/loom-restructure`. Every other port extends an existing command's lifecycle seam (`/loom-plan`, `/loom-converge`, `/loom-wiki`, `/loom-data`, `/loom-code`, `/loom-bugfix`, `/loom-library`, `/loom-auto`). New reviewers are registered via `.claude/orchestration.toml` per D-01, never hardcoded.
**Rationale:** Loom's command surface is already deep (68 commands verified 2026-07-08); the ports are enforcement and cartography that plug into existing seams. `/loom-map` and `/loom-restructure` were verified absent and are safe as net-new.
**Alternatives considered:** New commands per port (rejected — surface bloat, discovery cost); fold `/loom-map` into `/loom-wiki` (deferred — evaluated as a `map` subcommand during F-21 planning)
**Impact:** medium

### C-14: A Verified Artifact Is a Fail-Closed Precondition for Reasoning
**Decision:** The through-line of every CT6 port: a *verified* artifact (a fresh codebase map, a passed verified-output contract, a cited reuse path) is a fail-closed precondition for the stage that consumes it — not an optional input. Mapping gates planning (F-23); verified-output gates completion and pre-PR (F-25 (now fork Track A per C-17)); reuse claims gate on map citation (F-27); restructure gates on a two-round-clean adversary consensus + partition check (F-30).
**Rationale:** This is CT6's single best idea and it maps 1:1 onto Loom's convergence loops + tool-call hooks. It gives Loom architect-grade grounding using machinery it already ships.
**Alternatives considered:** Advisory preconditions with override-by-default (rejected — becomes a no-op); no precondition, rely on agent diligence (rejected — the exact hallucination/skip failure the ports target)
**Impact:** high

<!-- Applied: CT6-REVIEW 2026-07-08 — C-15..C-16 added from the roadmap review (planning/history/reviews/2026-07-08-roadmap-review.toon). C-15 resolves the cross-cutting "gate escape hatch" + "F-23 cold-start" blocking themes; C-16 resolves the "launch-timing" blocking theme (user chose keep-full-scope + launch-gate). -->

### C-15: Every Fail-Closed Gate Ships With Degradation + a Logged Escape
**Decision:** Every new fail-closed gate (F-23 map precondition, F-25 (now fork Track A per C-17) verified-output, F-27 reuse-cite, F-28 hallucination gate, F-30 partition-check) MUST ship with (1) a **calibration ramp** — a first release in `warn` mode before flipping to `block`, configurable via an `orchestration.toml` `[gates]` block (`warn|block|off` per gate); (2) a **self-heal or auto-invoke path** where one exists (F-23 auto-invokes `/loom-map` on first miss and fails closed only if the auto-build itself fails); and (3) a **reason-logged escape** mirroring the baseline F-18 `--override-loop-gate` precedent (a per-gate `--skip-*`/`waive <layer> --reason` that writes the reason to state and to `DECISIONS.md` and surfaces prominently). A gate that can only block, with no ramp and no recourse, is out of spec. **Fork-audit (Track B):** verifying that the fork's shipped verified-output gate (`quality-gate.ts`/`revalidation.ts`) actually exposes the warn-ramp + waive escape is an explicit Track-B audit item; C-15 compliance for F-25 is NOT silently satisfied by supersession alone.
**Rationale:** The review found (5 agents, 2 blocking) that the ports specified every gate's *block* condition precisely but dropped the escape/degradation layer the approved baseline (F-18) already established — the exact "users disable/resent the gate" dynamic the F-23 risk row warns about, and a hard headless/CI/`/loom-auto` dead-end. Enforcement without recourse becomes a wall users route around, defeating C-10.
**Alternatives considered:** Fail-closed with no override (rejected — headless/CI dead-end, gets disabled); advisory-only (rejected — violates C-10/C-14). The ramp+escape keeps the gate load-bearing while giving a logged, auditable exit.
**Impact:** high

### C-16: CT6 Ports Are Post-Launch — Gated Behind M-06 Phase 2
**Decision:** No CT6-port milestone (M-09–M-13) is activated until the OSS launch (M-06) clears its Phase 2 gate (public launch + the 5-stranger cold-install demand test). The ports are captured now as an approved, execution-ready roadmap but are sequenced *behind* the launch so they neither compete with launch-gate closure nor ship a first-run wall to brand-new installers.
**Rationale:** The review (CEO + strategy + devex, blocking) found that committing 14 features ahead of an unproven launch starves the only A-priority — architect-grade rigor is a retention lever, not an acquisition lever, and pre-1.0 survival is an acquisition problem. Capturing the work now (vs. deferring the design) preserves the analysis; gating activation protects the launch. This is the middle path chosen over a full REDUCTION / file-split.
**Alternatives considered:** Split M-09–M-13 into a separate deferred `ROADMAP-rigor-ports.md` (rejected — user chose one-roadmap; adds bookkeeping); proceed now with no launch gate (rejected — launch-starvation risk); reduce to F-25-A2-seed-only in 1.0 (rejected — loses the captured decomposition).
**Impact:** high

<!-- Applied: CT6×FABLE-RECONCILE 2026-07-10 — C-17 added from the CT6-vs-fable-readiness reconciliation assessment. The fable-readiness fork (PR #42) shipped working code for the CT6 verification backbone; this reconciles the CT6 ports down to what is genuinely not-yet-shipped and re-platforms the survivors onto the fork's Workflow engine. See project memory [[project-fable-readiness-fork]]. -->

### C-17: CT6 Ports Reconciled With the fable-readiness Fork (Track A shipped ⇒ CT6 becomes Track B)
**Decision:** The 14 CT6 ports (M-09–M-13) are reconciled against the fable-readiness fork (PR #42), which already ships the CT6 **verification backbone** as its "Track A." The reconciliation has three buckets:
- **SUPERSEDED (do NOT build — shipped in the fork):** **F-24** adversarial reviewer (`agents/adversary-agent.md`), **F-25** verified-output/Stop-hook re-validation gate (evolved `quality-gate.ts` acceptance re-validation), **F-26** spec→coverage matrix with bounded per-gap fixes. This retires **M-10a** in full and the F-26 half of **M-10b**.
- **DROPPED (now scaffold-deprecated):** **F-31** inter-agent token compression and **F-32** persistent role identity + wake-up injection. The fork classifies rolling-context compression and lossy-delegation compensation as the **`loom-scaffold`** layer — turned off on modern harnesses that auto-compact and that solve delegation natively via the Workflow tool + worktrees + structured output. Building them would re-introduce the scaffold the fork is deprecating.
- **SURVIVES — re-platform onto the fork's Workflow engine as "Track B":** **F-20/F-21** (map serialization + `/loom-map` producer + `codebase-map-reviewer`), **F-22/F-23** (freshness gate + planning precondition), **F-27** reuse-cite, **F-28** trace graph, **F-29** system-architect, **F-30** `/loom-restructure`, and optionally **F-33** phenotype kits. These build on the fork's `scripts/lib/engine/*` Workflow driver rather than the markdown-prompt loops the original CT6 plan assumed.

**The load-bearing finding:** the fork **built the map-freshness gate (its Track A copy of F-22) but left it DORMANT** — `hooks/map-freshness.ts` allows everything until a producer writes `.loom/maps/*.toon`, explicitly deferring to "Track B lands `/loom-map`." **The fork has no map producer.** CT6's **F-20/F-21 is exactly that missing producer**, so it is the single highest-leverage remaining CT6 work: it *activates* a guarantee the fork already built and tested. F-20/F-21 is promoted to the front of the reconciled build order.

**Map-location reconciliation:** the fork's dormant gate reads `.loom/maps/*.toon` (aligned with the C-15/CT6-review relocation that moved maps out of `.loom/wiki/maps/` to dodge `wiki-write-guard`). `/loom-map`'s producer writes via the Write tool and will still hit `wiki-write-guard` — so at build time either add `/loom-map` to the guard's allowlist or confirm the producer writes under the guard-exempt `.loom/maps/` path. Producer and gate MUST agree on the path or the gate stays dormant.

**The "do NOT port" list (C-11) is re-validated and REINFORCED:** 1M-token teammates, the MemPalace SQLite store + Librarian daemon, `func://` as a separate SQLite lineage store, and INSTRUCTION_COMPLIANCE_RUBRIC all remain validly avoided. The fork's bounded Workflow engine + explicit no-daemon/file-based stance makes them *less* necessary, not more; the fork's own Out-of-Scope names MemPalace and the taste/judgment layer (which stays gstack's territory) as excluded.

**Rationale:** A naive merge would rebuild three shipped features and two now-obsolete ones. Reconciliation keeps only the ~9 survivors, points them at the fork's engine, and turns CT6 from a parallel roadmap into the fork's Track B — with F-20/F-21 as the keystone that makes the fork's already-built map machinery live.
**Alternatives considered:** Naive merge / build all 14 (rejected — rebuilds F-24/F-25/F-26, wastes the fork's Track A); keep CT6 fully separate (rejected — the dormant-gate/missing-producer coupling means they are one system); drop cartography too and rely on the fork alone (rejected — leaves the fork's map gate permanently dormant).
**Impact:** high
**Supersedes/amends:** narrows C-16's "14 features" to the reconciled survivor set; M-10a/M-10b/M-13 milestone bodies below carry the per-milestone reconciliation status.

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

### F-18: Matt Pocock Skills Adoption

**Priority:** Split — Phase B at **P1**, Phases A/C/D/E at **P2** (refined per 2026-06-25 review).
**Milestone:** M-08
**Status:** Backlog — sourced from review of `mattpocock/skills` (MIT, GitHub). Attribution policy: a single `NOTICE` file lists all MIT-sourced patterns; the README has a one-paragraph acknowledgment section. **No per-file inline attribution** — keeps Loom's protocol surface clean and avoids derivative-positioning. MIT compliance is satisfied by NOTICE + preserved license text.

**Description:** Adopt the highest-leverage engineering disciplines from Matt Pocock's public skills repo into Loom. Phase B (tight-red feedback loop) is the vision-coherent core — it sharpens the convergence signal that M-01–M-03 established. Phases A/C/D/E are DX hardening: shared vocabulary, ADR convention, codebase deepening, inbox triage, and skill-authoring polish. Sequencing: Phase A is pure foundation (no behavioural risk) and unlocks B–E; Phase B is highest-leverage *behavioural* change and ships before C/D/E; C and D parallelise; E is polish, last.

**Vocabulary-conflict resolution (mandatory, lands in Phase A):**

Loom's existing terms and the imported `codebase-design` glossary must coexist without competing factions. A mapping table lives in `protocols/codebase-design.md` Section 0 and is authoritative when terms collide:

| Loom-native term | mattpocock term | When to use which |
|---|---|---|
| Phase / Wave | (no equivalent) | Loom term wins — execution-pipeline structure |
| Deliverable | (no equivalent) | Loom term wins — concrete plan artifact |
| Finding | (no equivalent) | Loom term wins — review output |
| Criterion | (no equivalent) | Loom term wins — convergence gate |
| Wiki page | (no equivalent) | Loom term wins — knowledge-base node |
| (no equivalent) | Module | mattpocock term wins — a unit with an interface and an implementation |
| (no equivalent) | Interface | mattpocock term wins — everything a caller must know |
| (no equivalent) | Seam | mattpocock term wins — where the interface lives |
| (no equivalent) | Adapter, Leverage, Locality, Depth | mattpocock term wins — design properties |

`CONTEXT.md` vs rolling-context `[WIKI]` injection (F-08): **`CONTEXT.md` is the seed; `[WIKI]` is the live layer.** `CONTEXT.md` holds the canonical glossary (≤50 domain terms, hand-curated) and is always loaded; the rolling-context injector reads `CONTEXT.md` first and then augments with relevant wiki pages per-query. They are not redundant — different scopes, single precedence rule.

`CONTEXT.md` content separation: the existing `loom-init`-generated `CONTEXT.md` (locked decisions and constraints) splits into two files in Phase A — `CONTEXT.md` (domain glossary, always-loaded) and `DECISIONS.md` (locked decisions, referenced on demand). Migration script ships in Phase A; one-shot, idempotent.

ADR vs wiki decision pages (F-02): **ADRs are the primary decision record.** Wiki `decision-*.md` pages are deprecated and migrated to `docs/adr/NNNN-*.md` in Phase A. The migration preserves all content; the wiki page becomes a stub pointing at the ADR.

**Entities involved:** FeedbackLoop (loopId, command, symptom, rung, verifiedRed, redOutput, runtimeMs, determinismRuns, retiredAt, escalationHistory[], linkedLoops[], trda{tight, redCapable, deterministic, agentRunnable}, parentLoopId, escapeReason), CodebaseDesignVocab (Module, Interface, Depth, Seam, Adapter, Leverage, Locality), Context (always-loaded glossary file, derived from wiki), ADR (lazy decision record, `docs/adr/NNNN-*.md`), SkillAuthoringPrinciple (predictability, leading-word, completion-criterion, premature-completion, sediment, duplication), TriageState (category × state, with createdAt/updatedAt timestamps and transition log), OutOfScopeEntry (id, idea, rejectedAt, rejectedBy, rationale, sourceProposalId), Prototype (logic-branch | ui-branch, with capturedAnswer ADR ref), Handoff (tmp-dir doc, suggested-skills section). All these entities are added to the Data Model section.

**Phase A — Foundations** (P2; no behavioural change, unlocks everything else)

1. `protocols/codebase-design.md` — shared design glossary (Module, Interface, Depth, Seam, Adapter, Leverage, Locality) plus Section 0 vocabulary-mapping table (see above). Includes the deletion test, "interface is the test surface", "one adapter = hypothetical seam, two = real". Referenced by every architecture-touching agent.
2. `CONTEXT.md` split — `CONTEXT.md` becomes the always-loaded domain glossary (≤50 terms, derived view from `.loom/wiki/`); locked decisions migrate to `DECISIONS.md`. Migration script + first-run empty-state advisory ("CONTEXT.md not found — run `/loom-init` to generate") ship together. `loom-init` and `loom-wiki ingest` maintain both.
3. ADR convention — `docs/adr/NNNN-*.md`. Wiki `decision-*.md` pages are deprecated; one-shot migration script converts existing wiki decisions to ADRs, leaves stub pointers. ADR creation is triggered explicitly when `loom-converge` resolves a blocking conflict or `loom-roadmap converge` records a load-bearing rejection — not lazy-on-first-write. Every reviewer cross-checks ADRs in the area they're touching.
4. `protocols/skill-authoring.md` — import `writing-great-skills` philosophy: predictability as root virtue, leading words, information hierarchy, checkable + exhaustive completion criteria, failure modes (premature completion, duplication, sediment), no-op test, model-invoked vs user-invoked trade-off. Wired into `/loom-skill create`.
4b. **Schema migration:** `convergence-state.toon` v1→v2 — gains a `loops[]` table. Follows the F-13 walker pattern exactly: `detectConvergenceStateVersion(content)` returns `{detected, current, outdated}`; `migrateConvergenceStateV1toV2()` performs the rewrite. One migrator, ships with Phase A so Phase B can land without schema friction.
4c. **`/loom-which` (moved from Phase E):** human-facing router skill complementing `loom-do` (model-facing). Ships early because it is the discoverability index for the new conventions Phases B–E introduce. Decision on overlap with `/loom-reference`: `/loom-which` is a *decision tree* ("what should I run for this situation?"), `/loom-reference` is a *flat table* — both survive, scoped differently.

**Phase B — Tight-red feedback loop** (P1; the headline behavioural change)

5. `protocols/feedback-loop.schema.md` — `loop.toon` envelope. **Full field set:** `loopId, command, symptom, rung, verifiedRed, redOutput, runtimeMs, determinismRuns, retiredAt, escalationHistory[]{fromRung,toRung,reason,at}, linkedLoops[]{loopId,relation:child|sibling|spawned-from-symptom}, parentLoopId, trda{tight:bool,redCapable:bool,deterministic:bool,agentRunnable:bool}, escapeReason`. **Retirement ceremony:** `retiredAt` is set by `loom-converge`/`loom-bugfix` when the symptom goes green and stays green across a verification run; retired loops are immutable but queryable.
6. New skill `feedback-loop` (model-invoked) — holds the 10-rung ladder (failing test → curl → CLI+fixture diff → headless browser → trace replay → throwaway harness → fuzz → bisection → differential → HITL bash), TRDA gates, and tighten-the-loop heuristics. Leading words "tight" and "red" imported verbatim.
7. `loom-bugfix` + `bugfix-analyst-agent` + `debug-investigator-agent` — Phase 1 gate **applies to all entry paths** (autoconverge AND default analyst path) — there is no ungated branch. Requires a verified-red tight loop before hypothesising. No theory before red. **Escape hatch:** `--override-loop-gate "<reason>"` writes the reason to `loop.toon.escapeReason` and proceeds without TRDA pass; logged prominently in convergence digest. Without this flag, exhausting the 10-rung ladder produces an explicit "stuck-at-loop-construction" state that halts with HITL escalation guidance (not silent block).
8. `loom-converge` + `converge-stage-teammate` — new Phase 0 "loop construction" writes `loop.toon`. Iterations bind to one `loopId` and run only that command. **Stalls escalate the LOOP (down the ladder), not the fixer** — `escalationHistory[]` records each escalation. `convergence-state.toon` gains a `loops[]` table (schema migration ships in Phase A sub-4b). New command flags: `--loop-id <id>` (bind to existing loop), `--loops` (list active loops as a TOON table with columns `loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt`), `--retire-loop <id>` (archive a converged loop). Also add an explicit `loom-converge` interaction spec to Phase B deliverables: `protocols/loom-converge.interaction.md` documents the Phase 0 loop-construction UX states and the new flag behaviours. Key distinction from current convergence: one symptom = one named command; lint/typecheck become *separate* loops with their own symptoms (`linkedLoops[]` records the relation, surfaced in `convergence-state.toon`); escalation sharpens feedback, not fixer capability. **In-progress UX states:** (a) "no loop.toon yet" — gate displays a one-line construction prompt with the ladder rung-1 recommendation; (b) "loop exists, verifiedRed: false" — gate displays current rung + escalation suggestion. Both states are explicit in the `loom-converge` interaction spec.
9. `tdd-coach` agent — **edit existing agent** (no new file). Adopt "horizontal slice anti-pattern" framing verbatim ("DO NOT write all tests first, then all implementation" → produces tests of *imagined* behaviour). Vertical tracer-bullet red-green-refactor only. Add the "no silent regression during refactor" rule: test count must not decrease during a refactor step.
9b. **Findings confidence field:** `findings.schema.md` gains `confidence: high|medium|low` on every finding row. Backward-compatible default `medium`. Used by all review and convergence agents.

**Phase C — Codebase health + planning quality** (P2)

10. `/loom-deepen` (new) — periodic "deepening report" surfacing shallow modules. Uses `Explore` subagents, applies the deletion test, outputs TOON findings to disk (canonical) and an **optional** HTML render — see sub-18 for HTML conditions. Output path convention: TOON to `.plan-execution/reports/deepen-{date}.toon`, HTML to `.plan-execution/reports/deepen-{date}.html` when `--html` flag is passed.
11. Sharpen `loom-plan:create` + `loom-plan:materialize` + `parallelization-agent` + `phasing-agent` — adopt tracer-bullet vertical slices, "ideal seam count = 1", explicit prefactor step in wave 0 ("make the change easy, then make the easy change").
12. `/loom-prototype` (new) — throwaway code as deliberate phase. Two branches: terminal app for state/logic, parallel UI variants on one route for visual. Rules: clearly marked throwaway, one command to run, no persistence, no polish. **User-visible completion:** prototype writes a one-line TOON summary to `prototypes/{name}/answer.toon` and updates the originating ADR (if one exists) — explicit done state, not just authoring rules. Slots into `loom-roadmap:explore` or between roadmap and plan.

**Phase D — Inbox + convergence hygiene** (P2)

13. `loom-note` + `loom-do` — formal triage state machine: `bug|enhancement` × `needs-triage|needs-info|ready-for-agent|ready-for-human|wontfix`. **All transitions explicit:** `needs-info → needs-triage` on reporter activity (any wiki/issue comment); `needs-info → wontfix` after 30 days no-response; `wontfix` is terminal but can be reopened only via explicit `/loom-note reopen <id>` with mandatory reason. Each entry carries `createdAt`, `updatedAt`, `transitions[]`. Two redundancy checks: (a) already implemented? (b) prior rejection (queries `.out-of-scope/`)? **AI disclaimer prefix** (`> *This was generated by AI during triage.*`) on every bot-posted comment.
14. `.out-of-scope/*.md` persistent rejection log — wired into `loom-roadmap converge` so dropped ideas stop resurfacing. **Schema** (lands in `protocols/out-of-scope.schema.md`, Phase A foundation work): `{id, idea, rejectedAt, rejectedBy:human|agent, rationale, sourceProposalId}`. **Visible suppression:** when a match is found during converge, surface a one-line callout with the matched entry id, rejection date, and rationale — never silent suppression.
15. ADR conflict callouts — `roadmap-converge-reviewer` + code reviewers cross-check ADRs and flag conflicts with the "contradicts ADR-NNNN but worth reopening because…" framing.

**Phase E — Session + presentation polish** (P2)

16. `loom-pause` / handoff — **edit existing `loom-pause`** (no new artifact). Tmp-dir default for handoff docs (workflow state stays in `.plan-execution/`), "suggested skills" section, secret redaction pass, no-duplication rule (reference PRDs/ADRs/issues by path). Pre-F-18 handoff docs remain valid via a one-line shim that resolves old paths to the new tmp-dir convention.
17. `protocols/grilling.md` — leaf skill: one question at a time, recommend an answer, walk every branch, prefer codebase exploration over asking. Caps at **12 questions per session** with a progress indicator and `/skip` escape. Reachable from `loom-roadmap converge`, `loom-plan`, `loom-bugfix`.
18. **Conditional HTML report mode** — `--html` opt-in flag on `loom-status`, `loom-roadmap:status`, `/loom-deepen`, post-converge audits. **Default is plain-text/TOON**; HTML is never the only output. When `--html` is passed and `open`/`xdg-open`/`start` fails (headless/SSH), the command falls back to writing the HTML file path to stdout with a "open this in a browser" line.
19. *(`/loom-which` moved to Phase A sub-4c.)*
20. Skill autoload audit — classify every `/loom-*` skill on the model-invoked vs user-invoked axis, strip descriptions from user-only ones, set `disable-model-invocation: true` where appropriate. **Deprecation notice:** each skill whose autoload trigger changes gets a one-time `/loom-doctor` advisory naming the change and the new invocation path. No silent behavior change.
21. Sediment sweep — run `writing-great-skills` no-op test sentence-by-sentence across all Loom `SKILL.md` files. **Mid-flight pass after Phase B ships** plus a final pass at Phase E end, so new sediment introduced by A–D is caught early.
22. **Test-coverage audit** — every F-18 sub-item maps to at least one convergence target OR carries an explicit `no-test: <rationale>` tag. Sub-items currently missing explicit coverage: sub-4 (`protocols/skill-authoring.md`), sub-16 (handoff hygiene), sub-17 (`protocols/grilling.md` 12-question cap), sub-20 (skill autoload audit) — these either gain a convergence target during plan creation or land with `no-test` justification. Audit output is a TOON manifest at `planning/history/coverage/F-18-coverage.toon`.
23. **Bootstrap testing note** — F-18 Phase B is itself tested with the *prior-generation* harness (one-shot `/loom-plan test`, no autoconverge), because `--autoconverge` for plan-test is what F-19 Phase B *introduces*. Sub-items in F-18 Phases C/D/E may self-host on the new `loop.toon` primitive once Phase B ships. This bootstrap asymmetry is the right discipline (eat dogfood as soon as it ships), not a gap.

**Convergence targets:**

- A new `loom-bugfix` run on a hard bug halts at Phase 1 until `loop.toon` exists with `verifiedRed: true` and TRDA gates passed; no hypothesis work before then. Gate applies to autoconverge AND default paths.
- An exhausted 10-rung ladder produces a named "stuck-at-loop-construction" state with HITL escalation guidance — verified by a regression test that hits the dead-end intentionally.
- A `loom-converge` run binds each iteration to a single `loopId` and command; lint/typecheck failures spawn their own loops, tracked via `linkedLoops[]`, and surface in `convergence-state.toon`.
- A second `loom-roadmap converge` pass over a previously-rejected idea reads `.out-of-scope/` and surfaces a visible suppression callout — oscillation stops, suppression is never silent.
- `/loom-deepen` run on `loom-ai` itself produces ≥3 deepening candidates with before/after diagrams, each using the `protocols/codebase-design.md` vocabulary. Default output is TOON; HTML only with `--html`.
- A fresh agent reading `CONTEXT.md` at session start uses domain terms (not generic words) in its first response — measurable via vocabulary diff.
- A vocabulary collision test: agent output for an architecture review uses `Module/Seam/Adapter` terms consistently and never mixes them with `phase/wave/deliverable` for the same concept.
- The `/loom-skill create` wizard's output for a new skill satisfies the no-op test sentence-by-sentence; sediment sweep across existing skills retires ≥20% of body lines.
- Attribution audit: `NOTICE` file lists all mattpocock-sourced patterns; README has a one-paragraph acknowledgment; **no per-file inline attribution** in any protocol or skill file.
- `convergence-state.toon` migration ships in Phase A and validates against pre-F-18 fixtures.

**Non-goals (explicitly out of scope):**

- `migrate-to-shoehorn` (TS-library-specific codemod, no conceptual content)
- `scaffold-exercises` (course-authoring scaffold for Total TypeScript, not engineering)
- `teach` (learning workspace, orthogonal to Loom's domain)
- `obsidian-vault`, `edit-article` (personal-knowledge skills, not engineering)
- Per-file inline MIT attribution (legally unnecessary, strategically harmful — see Status field)

### F-19: Autoconverge Harness Extension into Test + Execute Metasteps

**Priority:** Split — Phase A at **P1** (correctness fix, no F-18 dep), Phase B at **P1** (mechanically enforces the vision claim "tests before code"), Phases C/D/E at **P2** (refined per 2026-06-25 F-19 review iter 1).
**Milestone:** M-08 with explicit M-09 slip boundary: if F-18 Phase B is not converged-green by the M-08 mid-checkpoint, F-19 Phases B/C/D shift to M-09 and only F-19 Phases A + E ship in M-08. **B/D coupling note:** Phase B item 5 requires Phase D's multi-file subject primitive. When B and D both ship in M-08 they sequence D-before-B. If Phase D slips to M-09 alongside B/C, Phase B inherits the slip. If only Phase B's M-08 sub-deliverables are needed before D lands (rare), Phase B may ship with the single-file-subject constraint and migrate to multi-file on D's landing — this is documented in the Phase B implementation notes, not the roadmap acceptance.
**Status:** Backlog — surfaced by 2026-06-25 review of `/loom-plan` lifecycle against the autoconverge harness intent. Five gaps verified by direct read of `commands/loom-plan/{create,test,execute}.md` and `commands/loom-converge.md`. Refined per 2026-06-25 F-19 review iter 1.

**Differentiator note (Positioning):** F-19's per-symptom loop isolation (one symptom = one bound command, escalation on the loop not the fixer) is a documented differentiator vs BMAD and Spec-Kit, which run convergence at the suite level only. The autoconverge harness extending uniformly across roadmap, plan, test, and implementation — same envelope, same lifecycle — is also new ground.

**Description:** The autoconverge harness (`/loom-converge --mode document`) is generic but its application stops at the planning-document layer. `/loom-roadmap converge` converges ROADMAP.md prose; `/loom-plan create --autoconverge` converges PLAN.md prose + `criteria-plan.toon`. Nothing wraps the test-suite or the implementation in the same loop. F-19 extends the harness primitive into the two remaining metasteps (test and execute) and bridges the orphaned `criteria-plan.toon` artifact, using F-18 Phase B's `loop.toon` as the per-symptom atom.

**The intent gap (verified by Explore):**

| Metastep | Outer converge today | Per-symptom atom today | Gap |
|---|---|---|---|
| Roadmap | `/loom-roadmap converge` ✅ | n/a | none |
| Plan create | `/loom-plan create --autoconverge` ✅ | n/a | none |
| Plan test | — | flat test files, no red-verification | both missing |
| Plan execute | — | full-wave retry; not per-symptom | both missing |

**Five verified gaps:**

1. **Orphaned `criteria-plan.toon`** — `/loom-plan create` writes it as the canonical criteria spec; `/loom-plan test` does not read it and re-derives from PLAN.md. Duplication + drift risk.
2. **No `/loom-plan test --autoconverge`** — generated tests are kept as-is; no review-for-correctness loop.
3. **No `/loom-plan execute --autoconverge`** — only `--auto` (quality gates) and per-task retry exist; no document-mode wrapper around the implementation.
4. **No per-symptom command binding anywhere** — execute fixer re-runs the full wave on retry; converge harness treats `--harness` as the single signal. Pocock's "one symptom = one bound command" is absent.
5. **Document-mode harness is single-file only** — `--subject` accepts a path, not a directory or glob. A test suite cannot be converged as one artifact.

**Entities involved:** Reuses F-18's `FeedbackLoop` as the per-symptom atom. New: `CriteriaTestBinding` (criterionId → testFile → loopId), `ExecuteLoopMap` (per-wave map from failing tier criteria to bound loops). Both small.

**Phase A — Bridge `criteria-plan.toon`** (P1; low risk, fixes the duplication-and-drift gap; independent of F-18)

1. `/loom-plan test` reads `criteria-plan.toon` (written by `/loom-plan create`) as its canonical input. PLAN.md remains the secondary source; `criteria-plan.toon` wins on conflict.
2. **Three-way artifact reconciliation** — there are currently THREE paths producing criteria-adjacent artifacts: `/loom-plan create` writes `criteria-plan.toon`; `/loom-plan test` writes `test-spec.toon` (internal); `loom-converge --criteria` re-derives and overwrites `criteria-plan.toon`. Phase A makes `criteria-plan.toon` the **single source of truth**; `/loom-plan test` consumes it; `/loom-converge --criteria` mode is updated to consume-or-supplement rather than re-derive-and-overwrite (writes via merge, never replace). `test-spec.toon` is deprecated in favor of `criteria-plan.toon` rows + per-criterion binding fields.
3. **Recovery paths (orphan and partial states):**
   - **Absent file** (legacy plans): fall back to current re-derivation, log stderr advisory.
   - **Corrupt / truncated file**: detect via TOON parse failure or schema-validation; halt with named state `criteria-plan-corrupt` and recovery prompt ("re-run `/loom-plan create` or restore from `planning/history/snapshots/`").
   - **Mixed-completeness rows** (some have `testFile`, some don't): default to `skip-and-resume` — only regenerate the rows missing `testFile`. Explicit `--regenerate-all` flag forces full regeneration.
4. `criteria-plan.toon` gains `testFile: <path>`, `loopId: <id>`, `status: pending|good|missing|wrong-shape|flaky|spurious|unverifiable`, `tier: unit|integration|e2e|qa-review` (mirrors F-03), `criterionSource: <command-that-produced-it>` columns. Schema migration uses the F-13 walker pattern: `criteria-plan.toon v1→v2`.

**Phase B — `/loom-plan test --autoconverge`** (P1; mechanically enforces the vision claim "tests before code"; depends on Phase A binding + F-18 Phase B loop.toon)

5. New flag `--autoconverge` on `/loom-plan test`. Outer loop is document-mode autoconverge over the test-suite directory (requires Phase D primitive — multi-file subject). **Named harness:** `scripts/test-suite-review-harness.ts` (mirrors `scripts/plan-review-harness.ts`). **Named integrator:** `test-stage-teammate` (existing agent, extended — NOT a new agent).
6. **Boundary vs `/loom-converge --criteria` (non-goal):** `/loom-plan test --autoconverge` is **semantically distinct** from `/loom-converge --criteria`. Criteria mode iterates the *implementation* against fixed tests; Phase B iterates the *tests themselves* against criteria specs to verify they go red against the absent-implementation state. The TRDA `redCapable` gate is the semantic difference. `/loom-converge --criteria` mode is NOT a substitute and is explicitly preserved for its current role (post-implementation criteria verification).
7. **Per-criterion red-verification:** each criterion in `criteria-plan.toon` gets a `loop.toon` (F-18 envelope). The TRDA gate passes when the generated test goes red against the absence of the implementation, then goes green when the implementation lands. A test that cannot be made red fails TRDA `redCapable` — the test is wrong, not the code.
8. **TRDA redCapable failure UX (named state):**
   - User-visible message: `TRDA: test cannot go red — criterion <id> regenerating, iteration N of M`
   - Row status in `criteria-plan.toon` updates to `regenerating` mid-flight; on exhaustion (3 attempts default), status flips to `unverifiable` and a halt-with-HITL prompt fires: `Criterion <id> is unverifiable — the generated test does not exercise the criterion's behavior. Resolve manually: rewrite criterion or accept that this criterion has no test.`
   - Named stuck-state: `criterion-unverifiable` — surfaced in `convergence-state.toon` and propagated to `/loom-next` for guidance.
9. Reviewer classifies each criterion's test as: `good | missing | wrong-shape | flaky | spurious | unverifiable`. Integrator edits or re-generates only the failing ones.
10. Converge target: every row in `criteria-plan.toon` has `testFile`, `loopId`, `status: good`, and `verifiedRed: true` (against the un-implemented state at generation time).

**Phase C — `/loom-plan execute --autoconverge`** (P2; depends on Phase B + F-18 Phase B loop.toon)

11. New flag `--autoconverge` on `/loom-plan execute`. Outer loop is document-mode autoconverge over the implementation. **Subject computation:** the execute orchestrator computes `--subject` as the union of wave file-ownership paths (derived from `state.toon` wave manifest), passes the computed glob to `/loom-converge`. **Named integrator:** `execute-stage-teammate` (existing agent, extended with loop-binding behavior — NOT a new agent). **Named harness:** existing wave-verification harness (the same one `--auto` invokes today, but augmented to emit per-criterion `findingId` in its TOON output).
12. **Per-failing-symptom binding:** each failing tier criterion at a wave gate spawns a `loop.toon` bound to *that one* test command (not the full suite). Iterations run only the bound command. Fixer re-runs only the bound command to verify.
13. **Per-symptom execution summary view** (replaces wave-level dashboard during autoconverge): a running TOON table of active loops with columns `loopId, criterionId, boundCommand, tier, currentRung, status, retryCount`. **Render mode:** each iteration appends a full table block prefixed with an iteration header (`# iteration N — YYYY-MM-DDTHH:MM:SS`), append-only. Safe for CI pipes and non-TTY stdout. No ANSI in-place rewrite — preserves run-history readability and avoids TTY-detection branching. After all loops for a wave retire, the wave-level 4-tier gate verdict displays in the original dashboard format (`tier1: pass, tier2: pass, tier3: fail, tier4: warn`). Both views are emitted; users don't lose the wave dashboard, they gain the per-loop drilldown.
14. **Escalation discipline (Pocock):** when a loop stalls, escalate the LOOP down the ladder (broaden fixture, add instrumentation, switch tier), not the fixer. `convergence-state.toon` `loops[]` table (lands in F-18 Phase A sub-4b) records the binding from wave→criterion→loopId.
15. **4-tier model becomes the gate, not the loop.** Tier 1/2/3 hard gates fire at wave boundaries; the per-criterion loops drive iteration within the wave. Currently the 4-tier model fires per wave AS the loop — F-19 separates the two layers.
16. **`scope-coverage.toon` reconciliation:** `scope-coverage.toon` (existing execute.md Step 1.5 artifact) becomes a *read-only view* derived from `ExecuteLoopMap` during autoconverge runs. Non-autoconverge runs keep writing `scope-coverage.toon` directly as today. The plan spec must declare `ExecuteLoopMap` as the authoritative artifact in autoconverge mode.
17. Converge target: every failing tier criterion has its loop retired green; no loop in `escapeReason`-set state; wave-level 4-tier gate passes.

**Phase D — Generic harness primitives** (P2; foundation for B+C, lands in `/loom-converge`)

18. `/loom-converge --subject <path>` extended: accepts a directory or glob, treats the file set as one artifact. Document-mode iterates over the whole set; per-file findings keyed by relative path.
19. `/loom-converge` gains `--per-symptom-binding` mode: each blocking finding in the harness output is bound to its own `loop.toon` with a `command` field; iterations rerun only the bound command.
20. **Harness output schema extension:** `findings.schema.md` extended — every harness producing per-symptom bindings must emit `findingId` (stable hash of `{file, line, criterion, symptom}`) and `boundCommand` (the exact shell invocation to rerun for that finding) per blocking row. This is what `harnessFindingId` and `command` on `FeedbackLoop` bind to. Harnesses without these fields cannot be used with `--per-symptom-binding` — the flag fails with `harness-output-incompatible` named state and recovery prompt.
21. `protocols/feedback-loop.schema.md` (lands in F-18 Phase B) gains: `boundFromHarness: bool`, `harnessFindingId`, `boundFromWaveGate: bool`, `waveId`. This covers both Phase D (harness-bound) loops and Phase C (wave-gate-bound) loops. Loops with neither flag set are bugfix/converge loops (F-18's original Phase B scope). All three origins are first-class.
22. **F-18 vs F-19 loop context indicator:** `loop.toon` gains a `originContext: bugfix | converge-document | plan-test | plan-execute` field — surfaced in every HITL escalation prompt and named-state message so the user always knows which recovery path applies. Same envelope, different context labels.

**Phase E — `orchestration.toml` customization gap + flag groups + discoverability** (P2; the one item from F-19's original sketch that's genuinely missing, plus the CLI-coherence and discoverability work the review surfaced)

23. `protocols/orchestration-config.schema.md` extended: `[lifecycle.sequence]` section overrides the prescribed sequence (e.g., skip roadmap review, swap reviewers); `[lifecycle.caps]` overrides per-stage iteration caps; `[lifecycle.reviewers]` overrides per-stage reviewer sets. Single source of truth so `/loom-roadmap converge`, `/loom-plan create --autoconverge`, `/loom-plan test --autoconverge`, `/loom-plan execute --autoconverge` all read the same config.
24. Caps default to current locked values (C-05: `maxIterations: 3` for plan create); overrides validate against the same range (1–10).
25. **Flag groups for `/loom-plan` subcommands** (CLI coherence): three named groups documented in `commands/loom-plan.md` and enforced in each subcommand's parser:
   - `mode` group: `--autoconverge`, `--auto`, `--dry-run`, `--estimate`. Mutually exclusive within group.
   - `gate-control` group: `--no-tests`, `--no-e2e`, `--no-qa-review`, `--tests-only`, `--converge-criteria`, `--skip-validation`. Compatible with each other; semantic-conflict warnings emitted at parse time.
   - `scope` group: `--subject`, `--max-iterations`, `--phase`, `--wave`, `--per-symptom-binding`, `--regenerate-all`. Compatible across groups.
   Each subcommand documents which groups it accepts and which flags within those groups it ignores. `/loom-plan --help` renders flags grouped.
26. **`/loom-which` update as F-19 deliverable:** `/loom-which` (lands in F-18 Phase A) gets a content update covering the two new entry points and a decision-tree node: "Want to verify your tests are correct? → `/loom-plan test --autoconverge`. Want tight-loop implementation iteration? → `/loom-plan execute --autoconverge`. Want to converge any document? → `/loom-converge --mode document`." Listed as an explicit F-19 acceptance criterion.
27. **Test-coverage audit** — every F-19 sub-item maps to at least one convergence target OR carries an explicit `no-test: <rationale>` tag. Sub-items currently missing explicit coverage: sub-23 (`[lifecycle.*]` schema), sub-24 (cap defaults), sub-25 (flag groups), sub-26 (`/loom-which` content). These either gain a target during plan creation or land with `no-test` justification. Audit output at `planning/history/coverage/F-19-coverage.toon`.
28. **Bootstrap testing note** — F-19 Phase B is itself tested with the *prior-generation* one-shot `/loom-plan test` (no `--autoconverge`, since Phase B IS the introduction of that flag). F-19 Phase C is then tested with the newly-shipped `/loom-plan test --autoconverge` (self-host on Phase B's primitive). F-19 Phase D primitives are tested by Phases B+C exercising them. F-19 Phase A + E (no F-18 dep) can be tested with current infrastructure.
29. **Test-fixture sub-deliverables** (required for Phase B + C convergence targets):
   - `fixtures/unverifiable-criterion/` — a fixture project with a criterion intentionally specified such that no test can make it red against absent implementation. Exercises Phase B item 8's TRDA `redCapable` failure path and `criterion-unverifiable` HITL state.
   - `fixtures/multi-tier-failure/` — a fixture project where unit + integration tiers fail simultaneously on different criteria. Exercises Phase C item 13's per-symptom + wave-dashboard dual emission.
   - `fixtures/broken-harness/` — a harness deliberately omitting `findingId` / `boundCommand` from output. Exercises Phase D item 20's `harness-output-incompatible` named state.
   - `fixtures/well-formed-harness/` — positive-path fixture: a harness emitting valid `findingId` + `boundCommand` per blocking finding. Exercises Phase D item 19's `--per-symptom-binding` happy path (N findings → N `loop.toon` artifacts with `command` populated) in isolation from Phase B/C consumers.
   - Fixtures land under `fixtures/F-19/` and are authored as part of the corresponding phase's test generation, not deferred.

**Convergence targets:**

- Phase A: `criteria-plan.toon` is the single source of truth for test specs. `/loom-plan test` reads it; `/loom-converge --criteria` merges into it (never overwrites). `test-spec.toon` is deprecated. Recovery paths (corrupt, partial, absent) are exercised by regression tests with named-state assertions.
- Phase B: `/loom-plan test --autoconverge` produces a `criteria-plan.toon` where every row has `testFile`, `loopId`, `status: good`, and `verifiedRed: true`. A regression test exercises a criterion whose generated test cannot be made red (TRDA fail) and confirms the integrator regenerates it three times, then flips status to `unverifiable` with named HITL prompt.
- Phase C: `/loom-plan execute --autoconverge` binds each failing tier criterion to its own `loop.toon`; iterations rerun only the bound command. A regression test introduces a failing-on-one-test fault and confirms iteration count stays bounded (no full-suite reruns). The per-symptom summary view + final wave dashboard both emit.
- Phase D: `/loom-converge --subject <directory>` succeeds against a test suite path; per-file findings addressable. `/loom-converge --per-symptom-binding` produces N `loop.toon` artifacts for N blocking findings with `command` field populated; iterations rerun only bound commands. A harness lacking `findingId`/`boundCommand` in output fails with named state `harness-output-incompatible`.
- Phase D context indicator: `loop.toon.originContext` is set on every loop creation and surfaced in every HITL prompt and named-state message — verified by a test that creates loops from all four origins and asserts the prompts show the correct context.
- Phase E: `orchestration.toml` `[lifecycle.*]` overrides take effect across all four converge entry points uniformly; a project that sets `maxIterations: 5` sees it applied to roadmap, plan, test, and execute alike. `/loom-plan --help` renders flags grouped; mutually-exclusive flags within `mode` group are rejected at parse time. `/loom-which` decision tree includes the two new entry points.
- Coverage audit: `planning/history/coverage/F-19-coverage.toon` exists; every F-19 sub-item is either tagged with ≥1 convergence target OR explicitly marked `no-test: <rationale>`. Zero un-justified gaps.
- Fixtures: `fixtures/F-19/{unverifiable-criterion,multi-tier-failure,broken-harness,well-formed-harness}/` exist and are exercised by the relevant phase regression tests.

**Non-goals:**

- Replacing the 4-tier convergence model (F-03). F-19 layers per-symptom loops *under* the 4-tier gate; the gate stays.
- Replacing `/loom-roadmap converge` or `/loom-plan create --autoconverge`. Those work; F-19 only adds the two missing layers and the harness primitives that make them possible.
- Replacing `/loom-converge --criteria` mode. Criteria mode iterates implementation against fixed tests; Phase B iterates tests against criteria specs. Both are preserved; they serve distinct semantics.
- Creating new agents. F-19 names `test-stage-teammate` (existing, extended) and `execute-stage-teammate` (existing, extended) as the integrators. No new agent authoring.

**Composition with F-18:**

F-18 Phase B introduces `loop.toon` as the per-symptom atom for `/loom-bugfix` and `/loom-converge`. F-19 reuses *the same envelope* across `/loom-plan test --autoconverge` and `/loom-plan execute --autoconverge`. One schema, four entry points. F-19 is structurally dependent on F-18 Phase B landing first — without `loop.toon`, F-19 Phases B and C have nothing to bind to.

<!-- Applied: CT6-PORTS — F-20..F-33 added for the CT6 rigor & cartography port milestones (M-09..M-13). Each feature preserves the source port IDs (A1..D7) as key-behavior labels; those port IDs become PLAN.md phases. Source: ct6-to-loom-port-plan.md, loom-cartography-port-proposal.md (2026-07-08). -->

### F-20: Integration-Map Serialization

> ✅ **SURVIVES · KEYSTONE (C-17)** — with F-21, this is the **map producer the fork lacks**. It activates the fork's dormant map-freshness gate. Build first; re-platform on the Workflow engine.

**Priority:** P1
**Milestone:** M-09
**Description:** The `wiki-maintainer-agent` already computes an 8-relation cross-reference graph across wiki pages, but it lives only as scattered `crossRefs[]` frontmatter — no standalone graph artifact exists. This feature has the maintainer serialize that graph to a single first-class file on each maintenance pass, making an invisible structure auditable and diffable.
**Ports:** B2 (do-first — cheapest, single-owner, zero new discovery).

**Entities involved:** MapArtifact, WikiPage

**Key behaviors:**
- On each `/loom-wiki` maintenance pass, `wiki-maintainer-agent` writes `.loom/maps/integration-map.toon` serializing the 8-relation cross-ref graph it already computes.
- The artifact is TOON, atomically written (`.tmp` then rename), and owned solely by the maintainer (preserves Loom's single-owner governance).
- No new graph discovery — the feature persists existing computation only.

**Convergence targets:**
- After a `/loom-wiki` maintenance pass on a repo with ≥2 cross-referenced pages, `.loom/maps/integration-map.toon` exists and its edge count equals the total `crossRefs[]` entries across all pages.
- The file parses as valid TOON and round-trips through the wiki-maintainer without edge loss.

### F-21: First-Class Codebase Map

> ✅ **SURVIVES · KEYSTONE (C-17)** — the `/loom-map` producer that turns the fork's already-built-but-dormant map-freshness gate live. Single highest-leverage remaining CT6 work. Re-platform the map-coverage convergence onto the fork's Workflow engine; reconcile the write path with the gate's `.loom/maps/` read path (C-17).


**Priority:** P1
**Milestone:** M-09
**Description:** Loom has no standing, reviewed codebase map — mapping is emergent (wiki pages) and `/loom-deepen` "explicitly does NOT produce a codebase/architecture map." This feature adds a new `/loom-map` command that produces standing TOON map artifacts and drives their coverage to consensus using Loom's *existing* convergence + reviewer fan-out (not CT6's ralph-loop).
**Ports:** B1; introduces the `codebase-map-reviewer` agent (registered `[review]` per D-01).

**Entities involved:** MapArtifact, WikiPage, AgentResult

**Key behaviors:**
- New `/loom-map` command writes `.loom/maps/{codebase-map,route-map,integration-map}.toon` (integration-map produced by F-20; `/loom-map` consumes/refreshes it).
- Map coverage is driven to consensus by ≥1 `codebase-map-reviewer` agent through the existing `/loom-converge` machinery — no new loop primitive.
- Each artifact carries frontmatter for freshness stamping (consumed by F-22).
- `/loom-map` is one of only two net-new command surfaces (per C-13); a `/loom-wiki map` subcommand is evaluated as an alternative during planning.

**Convergence targets:**
- `/loom-map` on the loom-ai repo produces three TOON artifacts under `.loom/maps/`; `codebase-map.toon` enumerates every top-level source directory with zero uncovered modules at consensus.
- A second `/loom-map` run with no code changes is a no-op (idempotent) and reports "map fresh".

**Review-integrated (2026-07-08) — SF-09/SF-11 + CT6-006/011/014 + DEVEX-F-06:** **F-21 is the critical-path linchpin** — F-23, F-27, F-28, F-30, and ~~F-32~~ (dropped per C-17) across four milestones all hard-depend on `codebase-map.toon`; any F-21 slip cascades. Live dependents: F-23, F-27, F-28, F-30. Elevated to the anchor of the M-09 build order. `/loom-map` ships a first-class **`status`** verb (report fresh/stale + coverage without rebuild — surface the idempotent no-op path as a query), a **`diff`** verb (added/removed/changed nodes since `lastMappedCommit`, closing the Sourcegraph/CodeScene visibility parity gap the freshness gate needs), and a **`resolve`** verb (node lookup for pre-flight citation validation, shared with F-28). Add a **wiki bridge** mirroring F-10's: map nodes with no corresponding `component-*` wiki page surface to `wiki-maintainer-agent` as ingestion candidates, preventing map↔wiki drift that would break F-27's reuse-cite. Route all new `/loom-map` flags through the L-002 canonical-flag-convention audit before planning. See the new "F-21 map-coverage may not converge" risk row.

### F-22: Map Freshness Gate

> ✅ **SURVIVES (C-17)** — gate already shipped in the fork; F-22 collapses to producer-side `lastMappedCommit` stamping + write-path/read-path reconcile.

**Priority:** P2
**Milestone:** M-09
**Description:** Page-level staleness exists in the wiki, but there is no map-level invalidation. This feature stamps each map artifact with the commit it was built against and adds a PreToolUse hook that marks the map stale once HEAD moves past a touched-file threshold — pure fail-closed containment in Loom's existing hook idiom.
**Ports:** B3.

**Entities involved:** MapArtifact, ExecutionLog

**Key behaviors:**
- Each map artifact records `lastMappedCommit`.
- A PreToolUse hook compares `lastMappedCommit` against current git HEAD; once touched-file drift exceeds a configurable threshold, it flips a `mapStale` flag.
- **Degraded-input handling:** missing or malformed `lastMappedCommit`, unresolvable git HEAD (detached HEAD, shallow clone, fresh repo with no commits), or corrupt/unparseable map TOON MUST be treated as `mapStale: true` (fail-closed to the safe state) and logged — never silently treated as fresh.
- Stale-map state is the trip-wire the F-23 planning precondition reads (this feature detects staleness; F-23 blocks on it).

**Convergence targets:**
- After committing changes to N files exceeding the threshold, the freshness hook flips `mapStale: true` on the affected map artifact; a `/loom-map` refresh clears it and updates `lastMappedCommit` to the new HEAD.
- Producer-written `.loom/maps/*.toon` carries `lastMappedCommit` at the exact field path the fork's shipped map-freshness gate (`hooks/map-freshness.ts`) reads; a producer write followed by threshold-exceeding file drift trips the gate (write-path == read-path verified).

**Review-integrated (2026-07-08) — UX-05 + DEVEX-F-05:** Staleness must not arrive only as a surprise hard block. Add a **pre-stale warning state** (e.g. "map is 70% toward stale — 7 of 10 touched") surfaced in `/loom-status` and `/loom-next`, converting the block into a nudge (mirroring the existing ">5k files surfaces a warning" pattern). The freshness gate meets the F-25 legibility bar — its block names the unmet condition + one-line remedy + where-to-look; `mapStale` and the current `staleThreshold` are visible in `/loom-status`. The `.loom/maps/` directory has two writers (`wiki-maintainer-agent` for integration-map, `/loom-map` for the rest) — per-file ownership + atomic `.tmp`+rename prevent collision (F-22.1). **Map artifact integrity (CWE-345 mitigation):** freshness MUST be derived from git (diff HEAD vs `lastMappedCommit` over tracked files); a `lastMappedCommit` that is not an ancestor of HEAD implies stale-by-default. The stored `mapStale` boolean is **advisory-cache-only** and MUST NEVER be the sole gate input — the freshness hook re-derives from git on each run. An optional `mapContentSha` digest (SHA-256 of the map TOON body) makes hand-edited maps detectable.

### F-23: Mapping as a Planning Precondition

> ✅ **SURVIVES (C-17)** — re-platform per C-17.

**Priority:** P1
**Milestone:** M-09
**Description:** Loom's planning and convergence never require a map. This feature adds a fail-closed precondition to `/loom-plan create` and `/loom-converge` that blocks when no fresh map exists, with a one-line remedy (`run /loom-map first`). This is the mechanism that makes F-20–F-22 load-bearing rather than optional artifacts nobody reads — the cartography analog of the F-25 re-validation ethos.
**Ports:** B4 (low effort once F-21 exists).

**Entities involved:** MapArtifact, PlanPhase

**Key behaviors:**
- `/loom-plan create` and `/loom-converge` check for a fresh (non-stale, present) map before proceeding; absence or staleness fails closed with remedy text.
- The gate is wired into the existing hook set so it is non-optional (per C-10).
- `/loom-auto` inherits the gate so the autonomous pipeline cannot plan against an unmapped codebase.

**Convergence targets:**
- `/loom-plan create` invoked with no `.loom/maps/codebase-map.toon` present, with `[gates] requireFreshMap = block`, exits non-zero with a state-specific remedy; with the default `warn` it auto-invokes `/loom-map` and proceeds.
- With `mapStale: true` and `block` mode, `/loom-converge` blocks with a stale-specific remedy (naming the drifted files) until a `/loom-map` refresh clears the flag; with `--skip-map-gate` it proceeds with a logged reason.

**Review-integrated (2026-07-08) — CT6-REVIEW blocking (CEO-F-03, DEVEX-F-01, UX-01):** F-23 does NOT ship hard-fail-closed. Per **C-15**, it ships degraded: (1) **auto-invoke** `/loom-map` on first miss and fail closed only if the auto-build itself fails — so `/loom-auto`/headless/CI never dead-ends on an unmapped repo; (2) an `orchestration.toml` `[gates] requireFreshMap = warn|block|off` knob defaulting to **`warn`** for the first release, flipping to `block` only after the map story is battle-tested; (3) a `--skip-map-gate "<reason>"` escape logged to state + `DECISIONS.md`. Remedy text is **state-specific** (absent-map: "building your codebase map (~N min)…"; stale-map: "run /loom-map to refresh — files X,Y drifted"), not one hardcoded string (UX-02). **Interim behavior (SF-03):** F-23 ships before F-22 in the M-09 phasing, so until F-22 lands the gate is **presence-only**; the staleness convergence target is deferred to when F-22 exists — this is an explicit acceptance sub-item, not a gap. A documented CI recipe ships with F-23.

### F-24: Adversarial Reviewer

> ❌ **SUPERSEDED (C-17)** — shipped in the fable-readiness fork (PR #42) as `agents/adversary-agent.md`. Do not build. Spec retained as the reference charter (esp. the boundary vs `plan-critic-agent`) for auditing the fork's shipped version.

**Priority:** P1
**Milestone:** M-10a
**Description:** Loom's `/loom-plan review` fans out multiple reviewers, but they are checkers — none is a dedicated steelman-the-failure role. This feature adds a refute-only reviewer whose charter is to build the strongest case the work is wrong and default to rejecting on uncertainty, joining the existing review fan-out.
**Ports:** A1 / D1 (`adversarial-reviewer`, registered `[review]` default+full per D-01).

**Entities involved:** AgentResult, InterpretationConflict

**Key behaviors:**
- New `adversarial-reviewer` agent — system prompt: "Build the strongest case this work is wrong. Default to rejecting on uncertainty."
- Registered in `.claude/orchestration.toml` (`[review]`, default + full modes) so teams can toggle it — never hardcoded.
- Joins the fan-out in `/loom-plan review`, `/loom-converge` review rounds, and `/loom-code review`.
- Rejections route into `.loom/learnings.toon`.

**Convergence targets:**
- `/loom-plan review --full` on a fixture plan with a known flaw surfaces at least one blocking adversary finding that the standard reviewers miss.
- The agent is discoverable via `orchestration.toml` and absent from any hardcoded reviewer list.

**Review-integrated (2026-07-08) — CT6-002 blocking + ENG-F-24.1:** Loom already ships `plan-critic-agent` (an adversarial PLAN.md checker that walks a locked checklist at plan *creation*). F-24's `adversarial-reviewer` MUST declare an explicit charter boundary in both its feature description and its system-prompt opening line: **`plan-critic-agent` = structure gate during plan creation; `adversarial-reviewer` = steelman-the-failure of any work product during plan/code/converge review.** They complement; they must not be merged or F-24 collapses into creation-time redundancy. Per ENG-F-24.1, instrument the adversary's block rate on fixtures (mirroring M-01's interpretation-reviewer false-positive decision gate): if precision is low, its findings render advisory-with-confidence rather than hard-blocking, so a reject-on-uncertainty charter cannot stall the pipeline.

### F-25: Verified-Agent-Output Gate

> ❌ **SUPERSEDED (C-17)** — shipped in the fable-readiness fork (PR #42) as the evolved `quality-gate.ts` acceptance re-validation Stop-gate. Do not build. Spec retained as the reference contract (deterministic vs agent-judged layer split, `evaluationOrder`, loop guard, `waive` escape) for auditing the fork's version. **Fork-audit requirement (Track B):** agent-judged verdict rows in `verified-output.toon` must be attributable to a distinct verification pass; a `pass` row without non-empty `evidence` must be rejected by the Stop hook (CWE-807 mitigation — an agent cannot self-certify without evidence). Verify the fork's `quality-gate.ts` satisfies this during the Track-A audit.


**Priority:** P1
**Milestone:** M-10a
**Description:** Loom enforces invariants at the tool call but has no Stop-time "re-run the acceptance criteria before you're allowed to finish" gate, and no named, layered output-verification standard. This feature ships the single highest-value CT6 idea: an agent cannot self-certify "done" — a hook independently re-checks it against a multi-layer contract. Built in two steps: A2 (Stop-hook re-validation) as the seed, then generalized into C1 (the full layer set).
**Ports:** A2 → C1; backed by D2 (`task-reviewer`, diff-vs-acceptance + anti-stub). The highest-leverage port in the set.

**Entities involved:** VerifiedOutputContract, AgentResult, DeltaReport

**Key behaviors:**
- A Stop hook re-executes the phase's acceptance criteria / convergence target on a completion attempt and blocks self-certified or skipped verdicts (A2 seed).
- A named `verified-output` contract (TOON, in `.plan-execution/`) enumerates the layers that apply: tests pass, criteria met, files-in-map, no skipped verdicts, diff-scope respected, lint clean (C1 full set).
- Enforced by the Stop hook plus PreToolUse checks; wired into `/loom-converge` (no pass self-certifies) and used as the pre-PR gate on `/loom-git pr` and `/loom-canary`.
- Rejections feed `.loom/learnings.toon`.

**Convergence targets:**
- A convergence pass that skips a required verdict is blocked by the Stop hook with the unmet layer named; supplying the missing verdict lets it complete.
- `.plan-execution/verified-output.toon` lists all six layers with per-layer pass/fail; a failing layer blocks completion and a pre-PR run.

**Review-integrated (2026-07-08) — CT6-REVIEW blocking (ENG-F-25.1, ENG-F-25.2), verified against the shipped `hooks/quality-gate.ts` Stop hook:** The Stop hook receives only `session_id`/`transcript_path`/`cwd`/`last_assistant_message` — **no phase or acceptance-criteria reference** — and `exit 2`/`decision:"block"` prevents the turn ending and injects a reason but does **NOT** force programmatic re-execution. So F-25 is reframed at roadmap altitude: (1) the Stop hook **resolves the active phase + `verified-output.toon` from on-disk `.plan-execution/` state** (mirroring `quality-gate.ts`), and behavior is **block-and-name-the-unmet-layer, not automated re-run**; writing that state is a precondition of any gated phase. (2) The six layers **split by `kind`**: deterministic layers (`tests-pass`/`lint-clean`/`diff-scope`/`files-in-map`) are checked *at* Stop by the shell hook; agent-judged layers (`criteria-met`/`no-skipped-verdicts`) have their verdicts **pre-computed to `verified-output.toon` before Stop** (PostToolUse/convergence) because the hook runtime cannot spawn agents — the Stop hook only re-checks the pre-computed ledger. (3) A **`stop_hook_active` loop guard** (ENG-F-25.3) with bounded retries + the C-15 `waive <layer> --reason` escape prevents a block-until-pass hook wedging a session on unmeetable criteria. (4) Ships the A2 Stop-hook seed (one deterministic layer) first to calibrate before generalizing to the full C1 contract. A human-readable per-layer pass/fail/skip/waive rendering (UX-09) accompanies the on-disk TOON.

### F-26: Spec→Coverage Matrix with Bounded Auto-Fix

> ❌ **SUPERSEDED (C-17)** — shipped in the fable-readiness fork (PR #42) as its spec→coverage matrix with bounded per-gap fixes (Track A). Do not build.


**Priority:** P2
**Milestone:** M-10b
**Description:** `/loom-converge` has criteria-TDD mode but no explicit requirement → coverage → dispatch-a-bounded-fix-per-gap matrix. This feature extends criteria-TDD mode to emit a coverage matrix (requirement × covered?/test-ref) and spawn exactly one bounded fix per uncovered row — turning convergence into requirement-complete verification without unbounded loops.
**Ports:** A3. Coverage matrix is seeded from `/loom-spec` acceptance criteria.

**Entities involved:** CoverageMatrix, CriteriaPlan, FeedbackLoop

**Key behaviors:**
- `/loom-converge` criteria-TDD mode emits `.plan-execution/coverage-matrix.toon` (requirement × covered? × testRef).
- For each uncovered row, spawn ONE bounded fix (respecting the 100k cap) — never an unbounded loop.
- Uncovered rows that remain after the bounded attempt route into `.loom/learnings.toon` as coverage gaps.

**Convergence targets:**
- On a plan with a deliberately uncovered requirement, `coverage-matrix.toon` marks that row `covered: false` and exactly one fix unit is dispatched for it; the run does not loop past one bounded attempt per gap.

### F-27: Reuse-First Discipline

> ✅ **SURVIVES (C-17)** — a durable reuse-cite discipline gate the fork does not have; depends on the F-21 map + `edgeTypes[]`. Re-platform the reuse-cite plan-lint as a Workflow-engine stage.


**Priority:** P2
**Milestone:** M-10b
**Description:** Nothing in Loom pushes agents to reuse before building, and nothing enforces that a "reuse existing X" claim points at a real path. This feature adds a plan-lint / hook rule enforcing an extend → compose → reuse → build-new hierarchy: new-code decisions must document why extend/compose/reuse was rejected (logged to `DECISIONS.md`), and any reuse claim must cite a path present in `codebase-map.toon`, else block.
**Ports:** C4 (the hierarchy half, subsumes B5 the citation half).

**Entities involved:** MapArtifact, PlanPhase, ADR

**Key behaviors:**
- Plan-lint/hook rule in `/loom-plan`: a "reuse existing X" claim must cite a path present in `codebase-map.toon` (F-21), else fail closed (B5).
- New-code decisions must first document why extend/compose/reuse was rejected, logged to `DECISIONS.md` (C4).
- Depends on F-21's map for citation resolution.

**Convergence targets:**
- A PLAN asserting "reuse existing auth" with no matching path in `codebase-map.toon` is blocked by plan-lint; adding the real path clears it.
- A PLAN introducing new code with no extend/compose/reuse rejection rationale is flagged until a `DECISIONS.md` entry is added.

**Review-integrated (2026-07-08) — C-15 + UX-02:** F-27's reuse-cite block ships with the C-15 ramp (`[gates]` `warn` first) and a logged escape; the block remedy is state-specific — on an uncited "reuse existing X" it names the missing path AND the nearest match found in `codebase-map.toon`, rather than a bare failure. Depends on F-21's `edgeTypes[]` vocabulary (CT6-001) to validate citation shape.

### F-28: Endpoint + Data-Lineage Trace Graph

> ✅ **SURVIVES (C-17)** — re-platform onto the fork's Workflow engine.

**Priority:** P2
**Milestone:** M-11
**Description:** Loom has no verified call-graph or request-flow trace (wiki `flow-*` pages are prose), and its existing `/loom-data lineage` lacks a stable-ID asset graph. This feature builds ONE shared trace graph: an LSP/static-first endpoint call-tree with `func://` node IDs, enriched with an `asset://` data-asset layer answering "who populates/reads this table" — with a hallucination gate blocking any citation of a node not in the graph.
**Ports:** C2 (endpoint trace, extends F-21) + C3 (data lineage, enriches the *existing* `/loom-data lineage` and `data-lineage-tracker` agent — no new command/agent, per C-12); D5 tracers (`endpoint-tracer-agent`).

**Entities involved:** TraceGraph, MapArtifact

**Key behaviors:**
- `/loom-map` emits `.loom/maps/endpoint-trace.toon` with rename-stable `func://` node IDs; extraction is LSP/static-first, using an agent only for ambiguous edges.
- The *existing* `/loom-data lineage` subcommand and its existing `data-lineage-tracker` agent are enriched to emit `asset://<store>/<schema>/<table>` nodes with reads/writes/modifies/originates edges into the same graph artifact.
- A hallucination gate blocks any downstream citation (e.g. `/loom-bugfix` routing) of a node not present in the graph.

**Convergence targets:**
- `/loom-map` on a repo with ≥1 HTTP endpoint produces `endpoint-trace.toon` whose entry node resolves to a real handler via `func://`; a renamed function keeps its `func://` ID stable across a re-map.
- `/loom-data lineage` on a repo with a known table populates ≥1 `asset://` node with correct reads/writes edges in the shared graph; citing a non-existent `func://`/`asset://` node fails the hallucination gate.

**Review-integrated (2026-07-08) — ENG-F-28.1 + factual verification:** "LSP-first" is infeasible in a Claude Code hook/agent context — there is no running language server or bundled LSP client, and standing one up violates C-09 (platform-agnostic, no external services) and C-11 (no daemon). The extraction strategy is re-scoped to **"static/tree-sitter-first, LSP-optional"**, reusing the tree-sitter machinery F-10 (Repo Map, M-05) already commits to. **This adds an M-05→M-11 dependency** (there is no `tree-sitter` dep in `package.json` today and M-05 is NOT STARTED). Fallback ladder: tree-sitter static edges → agent for ambiguous edges (already allowed) → LSP as future optional enrichment, never baseline. **Verified 2026-07-08:** `/loom-data` (`commands/loom-data.md`) and `data-lineage-tracker` (`agents/data-lineage-tracker.md`) both exist, so C-12's "enrich existing, no new command/agent" contract holds (dismisses ENG-F-28.2). Add `/loom-map resolve <path-or-id>` and `/loom-data lineage`-side lookup so authors can pre-flight a `func://`/`asset://` citation before hitting the hallucination gate (CT6-014); the gate's block names the unresolved node + remedy (DEVEX-F-05). **C-15 conformance (hallucination gate):** the hallucination gate ships warn-first via `[gates] hallucinationGate = warn|block|off` (default `warn`), with a `--skip-node-check "<reason>"` escape that is logged to state + `DECISIONS.md` — mirroring F-23's C-15 treatment. A bare fail-closed hallucination block with no ramp or recourse is out of spec.

### F-29: System-Architect Design Authority

> ✅ **SURVIVES (C-17)** — re-platform onto the fork's Workflow engine.

**Priority:** P2
**Milestone:** M-12
**Description:** Loom's `architecture-reviewer` critiques diffs but there is no decisive design authority that returns ONE recommendation. This feature ports CT6's `system-architect` — porting only 3 of its 9 modes (Default design/tradeoff, Diagnostic Plan Review, Restructure Plan Audit) — invoked from `/loom-think` and `/loom-plan create` to make the design-decision call, distinct from the diff-critiquing reviewer.
**Ports:** D6 (`system-architect`, model opus).

**Entities involved:** AgentResult, PlanPhase, ADR

**Key behaviors:**
- New `agents/system-architect.md` (model opus) returns exactly ONE decisive recommendation, not a survey.
- Only 3 modes ported: Default design/tradeoff, Diagnostic Plan Review, Restructure Plan Audit (the other 6 are CT6 pipeline phases Loom lacks).
- Invoked from `/loom-think` and `/loom-plan create` as the design authority; its Restructure Plan Audit mode is consumed by F-30.

**Convergence targets:**
- Invoked on a design question with multiple viable approaches, `system-architect` returns a single recommendation with a stated tradeoff rationale (not an enumerated menu).
- Its Restructure Plan Audit mode produces a pass/fail verdict on a `movements[]` table.

### F-30: Safe-Restructure Pipeline

> ✅ **SURVIVES (C-17)** — re-platform onto the fork's Workflow engine.

**Priority:** P1
**Milestone:** M-12
**Description:** Loom has no safe-refactor capability. This feature ships a new `/loom-restructure` command: a producer/checker pipeline (restructure-analyst ×3 → reference-tracer → restructure-adversary ×3) that converges to ONE identical machine-checkable `movements[]` table, passing only after two consecutive all-clean adversary rounds AND a deterministic partition-check hook (every git-tracked file maps to exactly one of move/stays).
**Ports:** D7 (pipeline + `/loom-restructure`) + D3 (`reference-tracer-agent`, `[execution.agents]`); uses F-29's Restructure Plan Audit mode. Does NOT port CT6's scaffold-agent (`/loom-agent create` covers it).

**Entities involved:** MovementsTable, AgentResult, MapArtifact

**Key behaviors:**
- New `/loom-restructure` command (second and last net-new surface, per C-13) runs `restructure-analyst-agent` (×3) → `reference-tracer-agent` → `restructure-adversary-reviewer` (×3).
- The pipeline converges to ONE identical `movements[]` table; passes only after two consecutive all-clean adversary rounds.
- A deterministic partition-check hook verifies every git-tracked file maps to exactly one of move/stays — fail closed otherwise.
- `system-architect` Restructure Plan Audit mode (F-29) gates the plan.

**Convergence targets:**
- `/loom-restructure` on a fixture move produces a `movements[]` table where the partition check confirms every git-tracked file is classified exactly once; a deliberately incomplete partition fails the hook.
- The pipeline does not pass until two consecutive adversary rounds return zero findings.

**Review-integrated (2026-07-08) — CT6-003, CT6-013, UX-08, CT6-012:** `/loom-restructure` ships a `--dry-run` that exits after the partition-check gate printing the `movements[]` table without moving files, and an explicit **human confirm before the destructive multi-file move executes** (F-33 has a reuse confirm-gate; F-30 is far more destructive and must too). The `movements[]` table records `preMoveCommit` (CT6-003) so an interrupted restructure has a git-anchored rollback; a post-run success summary + documented recovery path ship with it. **Exclusion clarified (CT6-012):** `/loom-agent create` covers agent scaffolding but NOT post-restructure migration-stub generation (import redirects for moved code) — that is explicitly out of scope; the user handles stubs after reviewing the table (or a future `--generate-stubs` step adds it). **C-15 / partition-check escape (BY DESIGN):** the partition-check gate is **fail-closed with NO waiver** — this is an intentional exception to C-15's every-gate-ships-an-escape rule, because a pre-destructive-move partition failure is never safe to override; `--dry-run` + mandatory human confirm are the sole recourse. **Check-execution error branch:** if the partition check itself cannot run (git error, glob defect, unresolvable file list), treat this as **fail-closed-with-logged-reason** — the reason is written to state + `DECISIONS.md`; the pipeline NEVER fails-open before a destructive multi-file move under any circumstances.

### F-31: Inter-Agent Token Compression

> ❌ **DROPPED (C-17)** — now scaffold-deprecated. The fable-readiness fork classes rolling-context compression as the `loom-scaffold` layer, off on modern auto-compacting harnesses. Building it re-introduces scaffold the fork is deprecating. Spec retained for history only.


**Priority:** P2
**Milestone:** M-13
**Description:** Loom caps context (100k/spawn) but does not compress the handoffs between spawns. This feature adds a compression step in the message-passing / stage-summary layer that shrinks agent-to-agent payloads (stage summaries, contracts) while leaving all user-facing output and contract-normative text verbatim — squeezing more signal under the cap.
**Ports:** C5 (must guarantee no lossy compression of anything user-facing or contract-normative).

**Entities involved:** StageContext, AgentResult

**Key behaviors:**
- A compression step in the message-passing layer shrinks inter-agent payloads (stage summaries, contracts).
- User-facing output and contract-normative text are NEVER compressed (verbatim guarantee).
- Compression is transparent to consumers — a decompressed payload is byte-identical for normative fields.

**Convergence targets:**
- A stage summary handed between two spawns is transmitted in fewer tokens than its raw form while the deliverable and any contract-normative fields decompress byte-identically.
- A regression test confirms user-facing output is passed through uncompressed.

**Review-integrated (2026-07-08) — ENG-F-31.1 + CT6-004:** The "byte-identical normative fields" guarantee is only mechanically enforceable if normativity is *declared*, so F-31's plan MUST define a **machine-checkable manifest**: each payload schema (StageContext, AgentResult, contract) tags every field `normative` vs `compressible`, and the guarantee becomes a round-trip byte-equality test over the tagged normative set. The spec must also name the compression method (lossy summary / content-addressed dedup / structured truncation), distinguish it from the existing F-08 HOT/WARM/COLD rolling-context scheme (don't duplicate), and set a **measurable target vs a named baseline** (e.g. "≥20% token reduction on the PLAN-browser-e2e execution trace") so "fewer tokens" is falsifiable and F-31 can't ship as a no-op pass-through. Add a `--no-compress` debug flag + a compression-ratio line in the execution log for observability (DEVEX-F-04). As P2/last, defer until measured token pressure exists.

### F-32: Persistent Role Identity + Wake-Up Injection

> ❌ **DROPPED (C-17)** — now scaffold-deprecated. Compensation for lossy delegation that the fork solves natively via the Workflow tool + worktrees + structured output. Building it re-introduces scaffold the fork is deprecating. Spec retained for history only.


**Priority:** P2
**Milestone:** M-13
**Description:** Loom's spawns are fire-and-forget with disk handoff — no persistent role identity — and wiki `query` is on-demand only with no auto-injection at spawn. This feature keeps the 100k cap and fire-and-forget execution but lets a named role persist its charter + history on disk and re-hydrate a *scoped* summary each spawn; and at spawn auto-injects a *scoped* map excerpt (only the components/routes in the agent's contract) sourced via wiki query. Identity persists; context does not.
**Ports:** A4 (persistent named specialists — containment-safe) + B6 (runtime wake-up injection). Watch the cap.

**Entities involved:** RoleCharter, MapArtifact, StageContext

**Key behaviors:**
- A named role persists its charter + history to `.plan-execution/roles/<role>.toon` and re-hydrates a scoped summary each spawn — never a 1M live context (per C-11).
- At spawn, a scoped map excerpt (only the contract's components/routes) is auto-injected into the contract, sourced from the map TOON via wiki `query`.
- Injection is a bounded summary, not the whole map, and must respect the 100k cap.

**Convergence targets:**
- A role re-spawned across two waves reads its prior charter from `.plan-execution/roles/<role>.toon`; the re-hydrated summary stays under a bounded token ceiling.
- A spawn whose contract touches component X receives only X's map excerpt (not the full map), and the total contract stays within the 100k cap.

**Review-integrated (2026-07-08) — SF-06, CT6-007, ENG-F-31.2:** Four systems now write into the finite 100k spawn budget — F-32 map excerpt + F-32 role charter + F-08 wiki rolling-context + F-10 repo-map pack — plus F-31 compression removing tokens. F-32's plan MUST declare a single **budget-arbitration precedence** (e.g. contract > map excerpt > role charter > repo-map pack > wiki context), reusing the `agent-prompt-builder.ts` shrink-order F-10 already defines, and a **prompt-composition order** for the co-located summaries (role-charter section above the F-08 `[WIKI]` rolling-context section; merged only when no persistent role is active — document in `protocols/stage-context.schema.md`). Add a convergence target asserting total injected context stays under the cap when all injectors fire. Order F-31 (savings) before F-32 (spend) as the M-13 phasing already does.

### F-33: Phenotype Architecture Kits

> ⚪ **SURVIVES · OPTIONAL/CUT-LINE (C-17)**

**Priority:** P2
**Milestone:** M-13
**Description:** CT6's `phenotypes` captures a proven, deployable app-architecture pattern once, then discovers/scaffolds/reuses it (confirm-gated). Loom already has the packaging primitive — typed kits in `/loom-library`. Rather than building a new skill, this feature extends `/loom-library` to capture a whole-architecture (multi-resource) kit with a confirm-gate on reuse.
**Ports:** C6 (converge with kits, do not rebuild); D4 (`synthesizer-agent`) available to merge N drafts where the kit spans multiple sources.

**Entities involved:** AgentResult, WikiPage

**Key behaviors:**
- `/loom-library` is extended to capture a whole-architecture kit (multi-resource scaffold), not just single resources.
- Reuse of an architecture kit is confirm-gated.
- No new skill is authored — this is a kit-model enhancement.

**Convergence targets:**
- `/loom-library` can register a multi-resource architecture kit and, on reuse, prompts for confirmation before scaffolding; the scaffolded resources match the captured pattern.

**Review-integrated (2026-07-08) — CT6-008:** CT6's phenotype concept is *discovery + confirm*, not just confirm. Add a `detect` step — a `/loom-library detect` subcommand (or a hook into `/loom-map`) that matches structural map patterns to registered kits and surfaces "this repo looks like kit X — apply it?". Without the recognition step the confirm-gate only guards a manual selection and isn't a true port of the phenotype capability. F-21's map is the pattern source (uses F-21's `edgeTypes[]`). Softest-strategy port (S-6) — designated cut-line candidate if M-13 scope tightens.

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
| FeedbackLoop | loopId, command, symptom, rung, verifiedRed, redOutput, runtimeMs, determinismRuns, trda{tight,redCapable,deterministic,agentRunnable}, escalationHistory[]{fromRung,toRung,reason,at}, linkedLoops[]{loopId,relation}, parentLoopId, retiredAt, escapeReason | F-18: one-symptom feedback loop bound to a single command; convergence iterations attach to it. Lives in `loop.toon`. |
| OutOfScopeEntry | id, idea, rejectedAt, rejectedBy (human\|agent), rationale, sourceProposalId | F-18: persistent rejection record consulted by `loom-roadmap converge` to suppress resurfacing of dropped ideas. Lives in `.out-of-scope/*.md`. |
| TriageState | id, category (bug\|enhancement), state (needs-triage\|needs-info\|ready-for-agent\|ready-for-human\|wontfix), createdAt, updatedAt, transitions[]{from,to,at,actor} | F-18: explicit state machine for `loom-note`/`loom-do` triage; all transitions logged. |
| ADR | id, title, status (proposed\|accepted\|deprecated\|superseded), decision, rationale, supersededBy | F-18: architecture decision record at `docs/adr/NNNN-*.md`; supersedes wiki `decision-*.md`. |
| CodebaseDesignVocab | term, definition, useWhen, conflictsWithLoomTerm | F-18: glossary entry in `protocols/codebase-design.md`; Section 0 mapping table consults this. Protocol-document only — no runtime artifact. |
| SkillAuthoringPrinciple | name, definition, failureMode, noOpTestRule | F-18: glossary entry in `protocols/skill-authoring.md`. Protocol-document only — no runtime artifact. |
| Handoff | id, createdAt, suggestedSkills[], referencedArtifacts[], redactedSecretsCount | F-18: tmp-dir handoff doc written by `loom-pause` for cross-session continuation. |
| Prototype | name, branch (logic\|ui), capturedAnswerAdrRef, answerToonPath, createdAt | F-18: throwaway code with explicit completion ceremony; lives at `prototypes/{name}/`. |
| CriteriaTestBinding | criterionId, testFile, loopId, verifiedRedAt, status (pending\|good\|missing\|wrong-shape\|flaky\|spurious\|regenerating\|unverifiable), criterionSource, tier (unit\|integration\|e2e\|qa-review) | F-19: binds a `criteria-plan.toon` row to its generated test file and the per-criterion `loop.toon`. `status` mirrors reviewer classification. `criterionSource` traces provenance across the three derivation paths. `tier` lets the execute path filter bindings without re-reading `criteria-plan.toon`. |
| ExecuteLoopMap | waveId, criterionId, loopId, tier, status (pending\|running\|retired-green\|escape-set), command, retryCount, escalationRung | F-19: per-wave map from a failing tier criterion to the bound `loop.toon` driving its iterations. `command` is the denormalized shell command (no need to chase `loopId → loop.toon` on every retry). `retryCount` + `escalationRung` enable map-level escalation decisions without scanning the loop's full `escalationHistory[]`. |
| MapArtifact | kind (codebase\|route\|integration\|endpoint-trace), path, lastMappedCommit, mapStale, staleThreshold, mapContentSha, coverage, edgeTypes[], nodes[], edges[] | F-20/F-21/F-22: standing TOON map under `.loom/maps/`. `lastMappedCommit` + `mapStale` drive the freshness gate; `coverage` drives convergence consensus. **`edgeTypes[]` (CT6-001) locks the per-layer edge vocabulary** the `codebase-map-reviewer` converges against and F-27's reuse-cite check validates shape against — codebase/route layers MUST declare their edge-type set (e.g. `imports\|calls\|routes-to\|renders`) just as TraceGraph declares `calls\|reads\|writes\|modifies\|originates`. Owned by `wiki-maintainer-agent` (integration) / `/loom-map` (codebase, route) with per-file ownership + atomic `.tmp`+rename to avoid the shared-dir two-writer collision. **Integrity (CWE-345):** freshness is DERIVED from git (diff HEAD vs `lastMappedCommit` over tracked files); a `lastMappedCommit` not an ancestor of HEAD implies stale-by-default. `mapStale` is advisory-cache-only and never the sole gate input. The optional `mapContentSha` digest makes hand-edited maps detectable. |
| TraceGraph | nodes[]{id (func://\|asset://), kind, path}, edges[]{from, to, relation (calls\|reads\|writes\|modifies\|originates)}, extractionMode (lsp\|static\|agent) | F-28: the ONE shared endpoint-trace + data-lineage graph (per C-12). `func://` code nodes and `asset://` data nodes coexist; the hallucination gate rejects citations of absent node IDs. |
| VerifiedOutputContract | layers[]{name (tests-pass\|criteria-met\|files-in-map\|no-skipped-verdicts\|diff-scope\|lint-clean), kind (deterministic\|agent-judged), status (pass\|fail\|skipped\|waived), evidence, waiveReason}, evaluationOrder[6], verdict (pass\|blocked) | F-25: the named multi-layer output-verification standard in `.plan-execution/`. **`kind` (ENG-F-25.2) splits layers the Stop hook can check itself — `tests-pass`/`lint-clean`/`diff-scope`/`files-in-map` (deterministic shell) — from `criteria-met`/`no-skipped-verdicts` (agent-judged), whose verdicts MUST be pre-computed to this file BEFORE Stop (the hook runtime cannot spawn agents).** `evaluationOrder` (CT6-010) fixes layer sequence so the verdict is deterministic (`files-in-map` only valid after `tests-pass`). `waived`+`waiveReason` implement the C-15 logged escape. An agent cannot self-certify; the Stop hook checks every layer has a recorded pass/waive — a deterministic re-check of a pre-computed ledger, block-and-name-unmet-layer, not auto-rerun. **(superseded/dropped — spec retained per C-17)** |
| CoverageMatrix | rows[]{requirementId, covered, testRef, fixDispatched}, uncoveredCount | F-26: requirement × coverage matrix emitted by `/loom-converge` criteria-TDD mode at `.plan-execution/coverage-matrix.toon`. One bounded fix dispatched per uncovered row. **(superseded/dropped — spec retained per C-17)** |
| RoleCharter | role, charter, history[]{spawnAt, scopedSummary, tokenCount}, maxHistoryEntries, maxScopedSummaryTokens, evictionPolicy (last-n\|token-capped\|semantic), lastSpawnCommit | F-32: persistent named-role identity at `.plan-execution/roles/<role>.toon`. Identity persists across spawns; live context does not (re-hydrated scoped summary only, per C-11). **`maxHistoryEntries`/`maxScopedSummaryTokens`/`evictionPolicy` (CT6-009) bound `history[]` so a long-running role's re-hydrated summary stays under a structurally-enforced ceiling, not just an asserted one.** **(superseded/dropped — spec retained per C-17)** |
| MovementsTable | movements[]{path, action (move\|stays), destination}, preMoveCommit, partitionComplete, adversaryCleanRounds | F-30: the machine-checkable restructure plan. The partition-check hook verifies every git-tracked file maps to exactly one action; passes only at `adversaryCleanRounds >= 2`. **`preMoveCommit` (CT6-003) anchors a git SHA before any file moves so an interrupted restructure has a documented recovery path — the "safe restructure" claim requires this.** |

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
| ConvergenceTier | FeedbackLoop | 1:N | A convergence tier may host multiple feedback loops, each bound to one symptom |
| FeedbackLoop | FeedbackLoop | parent/child via parentLoopId + linkedLoops[] | Loops can spawn child/sibling loops (e.g. lint/typecheck split off from a main symptom) |
| OutOfScopeEntry | Feature | N:0 | Rejected ideas reference their source proposal but do not bind to a feature |
| TriageState | Feature | 1:0..1 | A triage-state entry may eventually graduate to a feature (ready-for-agent → F-NN), otherwise stays in inbox |
| ADR | Feature | N:N | ADRs record decisions across one or more features; features may cite multiple ADRs |
| CriteriaPlan | CriteriaTestBinding | 1:N | Each criterion row in `criteria-plan.toon` produces one binding once `/loom-plan test --autoconverge` runs |
| CriteriaTestBinding | FeedbackLoop | 1:1 | Each binding owns one loop.toon; the loop's lifecycle (verifiedRed → retired) drives the binding's status |
| ExecuteLoopMap | FeedbackLoop | N:N | Multiple loops per wave; loops may be shared across waves when symptoms recur |
| MapArtifact | WikiPage | 1:N | A map artifact indexes the wiki pages whose `crossRefs[]` it serializes (F-20) |
| MapArtifact | TraceGraph | 1:1 | The codebase map hosts the shared endpoint-trace + data-lineage graph as its typed layer (F-28) |
| MapArtifact | PlanPhase | 1:N | A fresh map is the fail-closed precondition consumed by planning phases (F-23) |
| VerifiedOutputContract | PlanPhase | 1:1 | Each phase's completion is measured against one verified-output contract (F-25) **(superseded/dropped — spec retained per C-17)** |
| CoverageMatrix | CriteriaPlan | 1:1 | The coverage matrix is derived from a criteria plan's requirements (F-26) **(superseded/dropped — spec retained per C-17)** |
| CoverageMatrix | FeedbackLoop | 1:N | Each uncovered row dispatches one bounded fix loop (F-26) **(superseded/dropped — spec retained per C-17)** |
| RoleCharter | PlanPhase | 1:N | A persistent role re-hydrates across the phases it participates in (F-32) **(superseded/dropped — spec retained per C-17)** |
| MovementsTable | MapArtifact | N:1 | Restructure movements are validated against the codebase map's file set (F-30) |

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

### M-08: Matt Pocock Skills Adoption -- NOT STARTED

**Features:** F-18, F-19
**Status:** Not started. F-18 sourced from review of `mattpocock/skills` (MIT, GitHub) on 2026-06-25. F-19 surfaced 2026-06-25 by verifying the autoconverge harness intent against `commands/loom-plan/{create,test,execute}.md`. F-19 depends structurally on F-18 Phase B (the `loop.toon` envelope).
**Depends on:** None hard. **Sequencing:** Phase A may begin in parallel with M-06 Phase 2 (launch) — its protocol/CONTEXT-split/ADR/migration work has no M-07 dependency. Phase B begins post-launch so it benefits from M-06 demand-validation feedback. Phases C/D/E begin after Phase B and may overlap with each other.
**Acceptance:** All Phase A foundations land (codebase-design protocol, CONTEXT.md split, ADR convention + wiki-decision migration, skill-authoring protocol, convergence-state.toon migration, `/loom-which` shipped early). Phase B tight-red loop discipline replaces the current hypothesise-first bug/convergence flow — verified by (a) a regression run where convergence halts at Phase 0 until `loop.toon` exists, (b) a stuck-at-ladder regression test that exercises the named dead-end state and HITL escalation, (c) lint/typecheck failures spawning linked loops rather than blocking the active loop. `.out-of-scope/` log is read by `loom-roadmap converge` and surfaces a *visible* suppression callout for at least one previously-oscillating idea. NOTICE file lists all mattpocock-sourced patterns; no per-file inline attribution exists in any protocol or skill file. Triage state machine has all transitions defined and timestamps logged.
**Effort:** L → XL after F-19 addition. F-18: 23 sub-items (5 phases + test-coverage audit + bootstrap note). F-19: 29 sub-items (5 phases + audit + bootstrap note + 3 fixtures). Combined: ≥6 new protocols (out-of-scope schema, codebase-design, skill-authoring, feedback-loop, lifecycle-config, loom-converge interaction), ≥3 new skills (feedback-loop, grilling, /loom-which), ≥8 agent edits, 3 new slash commands (`/loom-deepen` + `/loom-prototype` + `/loom-which` moved early), 4 new flags (`--autoconverge` on test+execute, `--subject <dir>`, `--per-symptom-binding`), 2 schema migrations (`convergence-state.toon` v1→v2, `criteria-plan.toon` v1→v2), 3 test fixtures, 2 coverage audits, 2 sediment sweeps, 2 one-shot content migrations.

#### Phasing

1. **Phase A (Foundations, P2):** `protocols/codebase-design.md` with vocabulary-mapping table, `CONTEXT.md`/`DECISIONS.md` split + migration, ADR convention + wiki-decisions→ADRs migration, `protocols/skill-authoring.md`, `protocols/out-of-scope.schema.md`, `convergence-state.toon` schema migration, `/loom-which` (moved from E). Zero behavioural risk. May begin in parallel with M-06 Phase 2.
2. **Phase B (Tight-red loop, P1):** `protocols/feedback-loop.schema.md` (full schema with escalationHistory/linkedLoops/trda/escapeReason), `feedback-loop` skill, `loom-bugfix` Phase 1 gate + `--override-loop-gate` escape + stuck-at-ladder dead-end, `loom-converge` Phase 0 loop construction + new flags, `tdd-coach` horizontal-slice anti-pattern + no-silent-regression rule, `findings.schema.md` confidence field. **Highest-leverage change in the milestone — vision-coherent; ships before C/D/E.**
3. **Phase C (Codebase health + planning, P2):** `/loom-deepen`, plan/parallelization/phasing sharpening, `/loom-prototype` with completion-signal. Parallelisable with Phase D.
4. **Phase D (Inbox + convergence hygiene, P2):** Triage state machine with all transitions defined + AI disclaimer, `.out-of-scope/` rejection log with visible suppression, ADR conflict callouts. Parallelisable with Phase C.
5. **Phase E (Session + presentation polish, P2):** Handoff hygiene (edit existing `loom-pause`), `protocols/grilling.md` with 12-question cap, conditional HTML report mode with plain-text fallback, skill autoload audit with deprecation notices, final sediment sweep. (Mid-flight sediment sweep ran after Phase B.)
6. **F-19 Phase A (Bridge `criteria-plan.toon`, P2):** `/loom-plan test` consumes `criteria-plan.toon` instead of re-deriving from PLAN.md. Low risk, fixes a duplication-and-drift gap. Independent of F-18.
7. **F-19 Phase D (Generic harness primitives, P2):** `/loom-converge --subject <directory>` + `--per-symptom-binding` mode. Foundation for F-19 B+C. Depends on F-18 Phase B `loop.toon` schema.
8. **F-19 Phase B (`/loom-plan test --autoconverge`, P1):** per-criterion red-verification loop; mechanically enforces the vision claim "tests before code." Depends on F-19 A, F-19 D, F-18 Phase B.
9. **F-19 Phase C (`/loom-plan execute --autoconverge`, P2):** per-failing-symptom bound iterations at wave gates. The 4-tier model becomes the gate, not the loop. Depends on F-19 B + F-18 Phase B.
10. **F-19 Phase E (`orchestration.toml` lifecycle customization, P2):** sequence/caps/reviewers overrides apply uniformly across all four converge entry points. Closes the one item from the original F-19 sketch that's genuinely missing.

<!-- Applied: CT6-PORTS — M-09..M-13 added for the CT6 rigor & cartography ports. Original source-plan build order: F-20 → F-24 → F-21 → F-25 → F-23 → F-22/F-27 → F-28 → F-30 → F-29 → F-26 → F-31 → F-32 → F-33. -->
<!-- Applied: CT6×FABLE-RECONCILE 2026-07-10 (C-17) — RECONCILED build order (survivors only, on the fork's Workflow engine): F-20 → F-21 (KEYSTONE: activates the fork's dormant map gate) → F-22/F-23 (mostly done in fork; producer-side + path reconcile) → F-27 → F-28 → F-29 → F-30 → F-33 (optional). REMOVED from build: F-24/F-25/F-26 (superseded — fork Track A) and F-31/F-32 (dropped — scaffold-deprecated). -->

### M-09: Cartography Foundation -- NOT STARTED · KEYSTONE (fable-readiness Track B)

**Features:** F-20, F-21, F-22, F-23
**Reconciliation (C-17):** This is the **highest-leverage remaining CT6 milestone.** The fork shipped the map-freshness *gate* (its Track A copy of F-22) but left it **DORMANT** — no producer writes `.loom/maps/*.toon`. **F-20/F-21 is the missing producer that activates the fork's already-built gate.** Re-platform the `/loom-map` convergence onto the fork's Workflow engine (`scripts/lib/engine/*`) rather than the markdown loop. F-22's own gate logic is largely done in the fork — this milestone's F-22 work collapses to producer-side `lastMappedCommit` stamping + confirming the gate's read path matches the producer's write path (see C-17 map-location note). **Do first, ahead of everything else CT6.**
**Status:** Not started. Sourced from ct6-to-loom-port-plan.md + loom-cartography-port-proposal.md (2026-07-08). Ports the map front-end: serialize the integration graph, produce a first-class convergence-reviewed codebase map, gate its freshness, and make a fresh map a fail-closed precondition for planning. B2 (F-20) is the cheapest do-first artifact.
**Depends on:** M-03 (Cross-System Integration — the `wiki-maintainer-agent` cross-ref graph must exist before it can be serialized). M-03 is COMPLETE, so M-09 is satisfiable **now** and does NOT wait on M-04 (BLOCKED)/M-05/M-08 despite lower numbering (SF-08).
**Launch gate (C-16):** Activation begins only after **M-06 Phase 2** (public launch + the 5-stranger cold-install demand test) clears. M-10–M-13 inherit this via their M-09 dependency chain.
**Acceptance:** `wiki-maintainer-agent` serializes `.loom/maps/integration-map.toon` each pass; `/loom-map` produces convergence-reviewed `codebase-map.toon`/`route-map.toon` (each declaring its `edgeTypes[]` per CT6-001) driven to coverage consensus by `codebase-map-reviewer`; maps carry `lastMappedCommit`; the fork's shipped freshness hook (`hooks/map-freshness.ts`) reads `lastMappedCommit` to flip `mapStale` past a touched-file threshold — M-09 builds the producer side only (write-path), not the flip logic (owned by the fork); the map precondition on `/loom-plan create` and `/loom-converge` ships warn-first with auto-invoke + a logged escape (C-15). **Docs (DEVEX-F-02):** `docs/hooks.md` gains an entry per new gate, README gains a `/loom-map` section, `docs/troubleshooting.md` gains an entry per fail-closed block with its remedy. **Dogfood (DEVEX-F-07):** run `/loom-map` + exercise the F-23 gate on loom-ai itself, capturing friction to `.loom/learnings.toon`, before closing the milestone.
**Effort:** L

#### Phasing

1. **F-20 (B2):** `wiki-maintainer-agent` serializes the 8-relation cross-ref graph to `integration-map.toon`. Do first — zero new discovery, single owner.
2. **F-21 (B1):** New `/loom-map` command + `codebase-map-reviewer`; drive map coverage to consensus via existing `/loom-converge`.
3. **F-23 (B4):** Fail-closed fresh-map precondition on `/loom-plan create` + `/loom-converge`. Ships early because it makes F-20–F-22 load-bearing.
4. **F-22 (B3):** `lastMappedCommit` stamping + PreToolUse staleness hook feeding the F-23 gate.

<!-- Applied: CT6-REVIEW 2026-07-08 — M-10 (XL) split into M-10a + M-10b per SF-01/ENG-F-25.4 (the M-02a/M-02b precedent). Features stay whole; M-10a de-risks the verification seed before the coverage/reuse layer. -->

### M-10a: Verification Core -- SUPERSEDED (shipped as fable-readiness Track A)

**Features:** F-24, F-25
**Reconciliation (C-17):** ❌ **DO NOT BUILD.** Both features shipped in the fable-readiness fork (PR #42): F-24 as `agents/adversary-agent.md`, F-25 as the evolved `quality-gate.ts` acceptance re-validation Stop-gate. The reviewed decomposition below is retained as the *reference spec* for what the fork shipped (useful if the fork's versions need auditing against the CT6 charter — e.g. the F-24 charter-boundary vs `plan-critic-agent`, the F-25 deterministic/agent-judged layer split). This milestone is closed by supersession, not by execution.
**Reference spec only (superseded — do not execute):** the decomposition below is retained solely for auditing the fork's Track A implementation.

**Status:** Not started. The verify/converge back-end and the single highest-value port. A refute-only adversarial reviewer plus the Stop-hook re-validation gate generalized into a named multi-layer verified-output contract. Split out of the former XL M-10 so the A2 Stop-hook seed calibrates the capability before the full C1 contract generalizes.
**Depends on:** M-09 (F-25's files-in-map layer resolves against the codebase map)
**Launch gate (C-16):** inherits M-09's post-M-06-Phase-2 gate.
**Acceptance:** `adversarial-reviewer` (orchestration.toml-registered, with an explicit charter boundary vs the existing `plan-critic-agent` per CT6-002) joins the review fan-out and surfaces flaws standard reviewers miss; the Stop hook resolves the active phase + `verified-output.toon` from disk (mirroring `quality-gate.ts`) and blocks self-certified/skipped completion by re-checking a pre-computed ledger — deterministic layers checked at Stop, agent-judged layers pre-computed before Stop (ENG-F-25.1/.2); the gate is wired into `/loom-converge` and used as the pre-PR gate, ships A2-seed-first with a `stop_hook_active` loop guard + `waive` escape (C-15). **Docs (DEVEX-F-02):** `docs/hooks.md` entry for the Stop/PreToolUse gate; README/troubleshooting entries for the verified-output block.
**Effort:** L

#### Phasing

1. **F-24 (A1/D1):** `adversarial-reviewer` agent + orchestration.toml registration + charter boundary + fan-out wiring.
2. **F-25 A2 seed:** Stop-hook re-validation with ONE deterministic layer, resolving phase/contract from disk state; calibrate block-rate.
3. **F-25 C1 full:** generalize to the six-layer `verified-output` contract (deterministic vs agent-judged split, `evaluationOrder`, loop guard, `waive`); add `task-reviewer`.

### M-10b: Coverage & Reuse Discipline -- REDUCED (F-26 superseded; F-27 survives)

**Features:** ~~F-26~~ (superseded — fork Track A), **F-27**
**Reconciliation (C-17):** **F-26** (spec→coverage matrix + bounded per-gap fix) shipped in the fork — ❌ do not build. **F-27** (reuse-first hierarchy + reuse-must-cite plan-lint) **survives** as fable-readiness Track B: it is a durable discipline gate the fork does not have, and it hard-depends on M-09's `codebase-map.toon` + `edgeTypes[]` (which the fork also lacks). Re-platform the reuse-cite check as a Workflow-engine plan-lint stage. This milestone reduces to the F-27 half.
**Status:** Not started. A requirement→coverage matrix with bounded per-gap fixes, and the reuse-first discipline (extend→compose→reuse→build hierarchy + reuse-must-cite). *(Coverage-matrix half is now superseded; see Reconciliation.)*
**Depends on:** ~~M-10a~~ (superseded) and M-09 (F-27 cites the codebase map — the live dependency)
**Launch gate (C-16):** inherits M-09's post-M-06-Phase-2 gate.
**Acceptance:** ~~`/loom-converge` criteria-TDD emits `coverage-matrix.toon` and dispatches one bounded fix per uncovered row (no unbounded loop)~~ (F-26 superseded — fork Track A per C-17, do not build); plan-lint blocks uncited reuse claims (warn-first per C-15, remedy names the missing path + nearest match) and undocumented new-code decisions, logged to `DECISIONS.md`.
**Effort:** M

#### Phasing

1. **F-27 (C4, subsumes B5):** Reuse-first hierarchy + reuse-must-cite plan-lint (needs the F-21 map + `edgeTypes[]`).
2. ~~**F-26 (A3):** Coverage matrix + bounded auto-fix in criteria-TDD mode.~~ **(superseded — fork Track A per C-17, do not build)**

### M-11: Traced Cartography & Data Lineage -- NOT STARTED · SURVIVES (Track B)

**Features:** F-28
**Reconciliation (C-17):** ✅ **Survives** — the fork has the existing `data-lineage-tracker` but no *verified* trace graph. Re-platform F-28's static/tree-sitter extraction as a Workflow-engine stage. Builds on M-09's map; unchanged dependency on M-05 (tree-sitter).
**Status:** Not started. Upgrades cartography from prose pages to a verified graph and lands the data layer on Loom's existing `/loom-data lineage`. Endpoint-trace (C2) and data-lineage (C3) are built as ONE shared graph with `func://`/`asset://` stable IDs and a hallucination gate.
**Depends on:** M-09 (the trace graph is a typed layer of the codebase map) **and M-05** (Repo Map — F-28's static extraction reuses F-10's tree-sitter machinery per the ENG-F-28.1 LSP→tree-sitter re-scope; there is no tree-sitter dep today and M-05 is NOT STARTED)
**Launch gate (C-16):** inherits M-09's post-M-06-Phase-2 gate.
**Note:** M-09's `codebase-map.toon` schema must forward-declare the `endpoint-trace` layer (MapArtifact.kind) so M-11 enriches rather than migrates it (ENG dependencies note). `/loom-data lineage` + `data-lineage-tracker` verified to exist — C-12 "enrich existing" holds.
**Acceptance:** `/loom-map` emits `endpoint-trace.toon` with rename-stable `func://` IDs (LSP/static-first, agent only for ambiguous edges); the existing `/loom-data lineage` + `data-lineage-tracker` are enriched to emit `asset://` nodes with reads/writes/modifies/originates edges into the same graph; a hallucination gate blocks citation of any node absent from the graph (powering `/loom-bugfix` routing).
**Effort:** M

### M-12: Architect Authority & Safe Restructure -- NOT STARTED · SURVIVES (Track B)

**Features:** F-29, F-30
**Reconciliation (C-17):** ✅ **Survives.** The fork has only a `PLAN-command-restructure.md` stub, no `system-architect` and no `/loom-restructure` pipeline. Re-platform F-30's producer/checker pipeline as a Workflow-engine script. **Dependency remap:** the restructure pipeline reuses the fork's *shipped* adversary reviewer (`agents/adversary-agent.md`, ex-F-24) and verified-output gate (ex-F-25) — so its former M-10a dependency now resolves against **fork Track A**, not an unbuilt milestone.
**Status:** Not started. Adds a decisive design authority and Loom's first safe-refactor capability. `system-architect` (3 of 9 modes) makes the design call from `/loom-think` + `/loom-plan create`; the new `/loom-restructure` command runs a producer/checker pipeline converging to a partition-checked `movements[]` table.
**Depends on:** ~~M-10a~~ → **fork Track A** (the restructure pipeline reuses the fork's shipped adversary reviewer + verified-output gate; `system-architect` Restructure Plan Audit gates the movements table) and M-09 (`system-architect`/restructure cite the codebase map)
**Launch gate (C-16):** inherits M-09's post-M-06-Phase-2 gate.
**Docs (DEVEX-F-02):** README section for `/loom-restructure`; `docs/hooks.md` entry for the partition-check gate; troubleshooting entry for a partition-fail block.
**Acceptance:** `agents/system-architect.md` (opus) returns ONE decisive recommendation and a Restructure Plan Audit verdict; `/loom-restructure` runs restructure-analyst ×3 → reference-tracer → restructure-adversary ×3, converging to one identical `movements[]` table that passes only after two consecutive all-clean adversary rounds AND a deterministic partition-check hook confirms every git-tracked file maps to exactly one of move/stays.
**Effort:** L

#### Phasing

1. **F-29 (D6):** `system-architect` agent (opus), 3 modes, invoked from `/loom-think` + `/loom-plan create`.
2. **F-30 (D7, D3):** `/loom-restructure` command + safe-refactor pipeline + partition-check hook, consuming F-29's Restructure Plan Audit mode.

### M-13: Efficiency & Identity -- REDUCED (F-31/F-32 dropped; F-33 optional)

**Features:** ~~F-31~~, ~~F-32~~ (both dropped — scaffold-deprecated), **F-33** (optional)
**Reconciliation (C-17):** ❌ **F-31** (inter-agent token compression) and **F-32** (persistent role identity + wake-up injection) are **DROPPED.** The fable-readiness fork classifies rolling-context compression and lossy-delegation compensation as the `loom-scaffold` layer, turned off on modern harnesses that auto-compact and that solve delegation natively (Workflow tool + worktrees + structured output). Building them re-introduces the scaffold the fork is deprecating — a direct contradiction of the fork's thesis. **F-33** (phenotype kits over `/loom-library`) **survives as optional/cut-line** — it composes cleanly onto the fork's already-restructured kit system and sources patterns from M-09's map, but it was the softest port (S-6 cut-line candidate) and is not load-bearing. Build only if kit-pattern reuse becomes a felt need.
**Status:** Not started. ~~Optional cost/grounding layer~~ → reduced to the optional phenotype-kit port. *(Compression + role-identity halves are dropped; see Reconciliation.)*
**Depends on:** M-09 (F-33's `detect` step sources structural patterns from the F-21 map)
**Launch gate (C-16):** inherits M-09's post-M-06-Phase-2 gate.
**Acceptance:** `/loom-library` captures a whole-architecture kit with a confirm-gate on reuse and a `detect` step that matches structural map patterns to registered kits. *(Dropped acceptance items — payload compression, `RoleCharter` persistence, scoped map excerpt — removed per C-17.)*
**Effort:** S

#### Phasing

1. **F-33 (C6, D4):** Extend `/loom-library` for whole-architecture kits with a reuse confirm-gate + a `/loom-library detect` step sourced from the F-21 map. *(Optional / cut-line.)*
   - ~~F-31 (C5)~~ dropped — scaffold-deprecated (C-17).
   - ~~F-32 (A4 + B6)~~ dropped — scaffold-deprecated (C-17).

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
| CT6 ports scope-creep back toward SQLite/daemon/1M contexts | high | medium | C-11 is a hard constraint; any port PR reintroducing a DB, daemon, or cap-busting context is rejected at review. The verified-output gate (F-25) checks diff-scope. |
| Fresh-map precondition (F-23) becomes a friction wall that users disable | high | medium | Freshness threshold (F-22) is touched-file-count based, not every-commit; `/loom-map` refresh is idempotent and fast; remedy text is one line. Gate is fail-closed but cheap to satisfy. |
| LSP-first endpoint extraction (F-28) is brittle across languages | medium | high | Static/LSP-first with agent fallback only for ambiguous edges; failure-mode-is-skip (a node that can't be resolved is omitted, not hallucinated). Hallucination gate makes omission safe. |
| Verified-output layers (F-25) produce false-blocks that stall convergence **(superseded/dropped — spec retained per C-17)** | medium | medium | Layers carry per-layer evidence; a blocked layer names its unmet condition with a remedy. Ships A2 (one layer) first to calibrate before generalizing to six. |
| `/loom-restructure` partition check passes but moves break references | high | low | Two-round-clean adversary consensus + `reference-tracer-agent` reference-closure runs before the partition check; `system-architect` Restructure Plan Audit is a third independent gate. |
| Inter-agent compression (F-31) silently corrupts a contract-normative field **(superseded/dropped — spec retained per C-17)** | high | low | Contract-normative and user-facing text are on a hard no-compress allowlist; a regression test asserts byte-identical round-trip for the machine-checkable normative-field manifest (ENG-F-31.1). |
| Launch starvation — committing M-09–M-13 delays the in-flight M-06 launch | high | high | C-16 gates all CT6-port activation behind M-06 Phase 2 (launch + demand test). The work is captured now but sequenced behind the launch so it never competes with launch-gate closure. (CEO-F-01/F-06) |
| F-23 fresh-map gate is a cold-start wall for new installers / headless / CI | high | medium | C-15: F-23 ships warn-first with auto-invoke of `/loom-map` on first miss and a logged `--skip-map-gate` escape; never ships fail-closed pre-launch. Converts a +150s dead-end into a "building map…" ramp. (CEO-F-03, DEVEX-F-01) |
| F-21 map-coverage consensus may not converge on large/heterogeneous repos, blocking all downstream cartography ports (F-23/F-27/F-28/F-30/~~F-32~~ dropped per C-17) | high | medium | Bound the `codebase-map-reviewer` consensus loop; allow a partial-coverage escape hatch with an explicit uncovered-module list (mirror F-28's failure-mode-is-skip); F-23 degrades to presence-only on a partial map. Live dependents: F-23, F-27, F-28, F-30. (SF-09/SF-11) |

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

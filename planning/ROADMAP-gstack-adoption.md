---
roadmapVersion: 1
name: "gstack Skill Adoption"
status: approved
created: 2026-06-30
lastReviewed: 2026-06-30
targetDate: null
totalFeatures: 36
totalMilestones: 13
---

# Roadmap: gstack Skill Adoption

## Vision

Loom is an agentic meta-orchestration framework for Claude Code. After a deep comparison against Garry Tan's gstack, we identified 29 concrete judgment, safety, review, and DX patterns worth adopting. gstack's markdown-first design does not fit Loom's TOON+contract spine, so this initiative re-authors each idea as a Loom-native resource (agent, prompt, protocol, skill, or infrastructure). The goal is to compound Loom's judgment layer — confidence-calibrated findings, decision principles, learnings, safety guards — without forking gstack code. Milestones ship independently so adopters can stop after any milestone and still gain value.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Adoption completeness | Qualitative | Success measured qualitatively via user adoption of ported skills — no quantitative metrics defined for this initiative. |

## Constraints & Decisions

### C-01: Adopt, don't fork
**Decision:** Every ported idea is re-authored as a Loom-native resource (agent / prompt / protocol / skill / infrastructure). No gstack code copied verbatim.
**Rationale:** gstack is markdown-only; Loom uses a TOON + contract spine. A verbatim port would require a brittle transpiler layer and would not respect Loom's inspectable-state ethos.
**Alternatives considered:** (a) Fork gstack and dual-maintain — rejected: doubles the maintenance surface. (b) Build a gstack→Loom transpiler — rejected: brittle, blocks judgment work on tooling.
**Impact:** high

### C-02: TOON output for all new agents and schemas
**Decision:** Every new agent output, protocol schema, learnings file, regressions file, and lease file uses TOON.
**Rationale:** CLAUDE.md convention; matches Loom's inspectable-state ethos and enables uniform tooling.
**Alternatives considered:** JSON — rejected as inconsistent with existing Loom artifacts.
**Impact:** high

### C-03: No new evaluation or metrics framework
**Decision:** This initiative does not introduce success-metric telemetry, evaluation harnesses, or measurement scaffolding beyond what already exists.
**Rationale:** User directive — focus on capability delivery, not measurement infrastructure.
**Alternatives considered:** Ship a per-feature eval harness — rejected per directive.
**Impact:** medium

### C-04: Milestones ship independently
**Decision:** Each milestone is independently deliverable. A user may adopt M-01 only and stop.
**Rationale:** Allows selective adoption; different Loom users value different gstack patterns.
**Alternatives considered:** Monolithic release — rejected: too large and blocks partial value.
**Impact:** high

### C-05: Browser features do not block on a new daemon
**Decision:** Features implied to need a persistent browser daemon (M-07) may wrap the existing `chrome-devtools` MCP or defer daemon work. Individual features are not blocked on a daemon.
**Rationale:** A persistent browser daemon is a significant infrastructure investment; wrapping MCP unblocks M-07 features today.
**Alternatives considered:** Build a Loom-native browser daemon upfront — rejected: cost > value for initial ports.
**Impact:** medium

### C-06: Deploy target detection is read-only
**Decision:** Deploy target detection (F-32) is read-only; Loom never mutates deploy target config directly, only writes hints to CLAUDE.md.
**Rationale:** User owns deploy infrastructure. Loom augments the ship phase but does not replace or reconfigure Vercel/Fly/Render/Cloudflare/Netlify/Railway settings.
**Alternatives considered:** Have Loom directly write to `vercel.json`, `fly.toml`, etc. — rejected: violates user ownership boundary and risks silent breakage.
**Impact:** medium

### Q-04: Success Metrics Dimension Locked as Red-Exception
**Decision:** The success-metrics dimension is permanently accepted as red for this roadmap; sign-off gates that require all dimensions ≥ yellow must treat this as an accepted exception, not a blocker.
**Rationale:** C-03 explicitly excludes evaluation/measurement framework work from scope. The success-metrics rubric requires ≥2 measurable metrics; this roadmap deliberately ships only a qualitative adoption metric.
**Impact:** medium (affects sign-off eligibility)

### C-07: Direct-symlink install does not deprecate plugin distribution
**Decision:** M-12 ships direct-symlink install as an additional path; the Claude Code plugin marketplace route remains supported.
**Rationale:** Plugin = discovery surface for new users. Direct symlink = power-user path with tighter contributor loop and cross-host reach (Hermes, OpenClaw, Codex).
**Alternatives considered:** Deprecate plugin route once direct-install lands — rejected: plugin is the discovery on-ramp; deprecation would break the new-user funnel.
**Impact:** medium

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.x | Type safety across hooks and agents |
| Runtime | Bun | latest | Primary runtime for scripts and hooks |
| Runtime (fallback) | Node.js | 20+ | Fallback when Bun unavailable |
| Testing | Vitest | latest | Unit + integration tests for hooks and scripts |
| Platform | Claude Code plugin | current | Host for agents, prompts, skills, infrastructure |
| Data Format | TOON | v1 | All Loom artifacts and agent outputs |
| Browser (optional) | chrome-devtools MCP | current | Live-site features (M-07) |

## Features

### F-01: Fan-in coordination across parallel worktrees

**Priority:** P2
**Milestone:** M-09
**Description:** Beat the git+human punt for reintegrating N parallel worktrees. Ship a cross-worktree lease registry, a semantic pre-conflict scan, a rebase-storm coordinator, and an ownership-aware merge queue. Pragmatic first step: `/loom-git pr preflight` that scans siblings, warns on ownership overlap, and auto-rebases from main.

**Entities involved:** LeaseRegistry

**Key behaviors:**
- Cross-worktree lease registry at `~/.loom/leases/{repo}.toon` declaring path ownership.
- Semantic pre-conflict scan compares in-flight ASTs across siblings for shared-symbol edits.
- `/loom-git pr preflight` warns on ownership overlap and auto-runs rebase-from-main.
- Rebase-storm coordinator notifies siblings and re-runs verification on landings.

**Convergence targets:**
- `~/.loom/leases/{repo}.toon` written and readable across worktrees.
- `/loom-git pr preflight` exits non-zero with an ownership-overlap finding when siblings edit the same paths.

**Scenarios:**

```toon
id: S-01
title: Preflight warns when a sibling worktree owns overlapping paths
given[2]: A lease at ~/.loom/leases/loom-ai.toon declares worktree A owns src/auth/*, Worktree B has staged changes touching src/auth/session.ts
when: A developer runs /loom-git pr preflight from worktree B
whenTriggerType: actor-action
then[2]: The preflight MUST report an ownership-overlap finding citing worktree A, The command MUST exit non-zero
tags[1]: happy-path
automatable: true
```

### F-02: Confidence-calibrated findings on every reviewer

**Priority:** P0
**Milestone:** M-01
**Description:** Add a required `confidence: 1-10` field to the `AgentResult` finding schema. Suppress <5, caveat 5–6, promote 7+. Retrofit into every roadmap, plan, and code reviewer. Small schema change, large noise reduction.

**Entities involved:** AgentResultFinding

**Key behaviors:**
- `protocols/agent-result.schema.md` requires `confidence: 1-10` on every finding.
- Reviewers self-assess confidence for every finding they emit.
- Display layer suppresses findings with confidence <5 by default.
- Existing reviewers retrofit the field without changing their finding taxonomy.

**Convergence targets:**
- Validator rejects a finding missing `confidence`.
- Display layer output omits findings with confidence <5 unless `--verbose`.

**Scenarios:**

```toon
id: S-01
title: Reviewer output includes confidence on every finding
given[1]: A reviewer agent produces an AgentResult with at least one finding
when: The AgentResult is validated against agent-result.schema.md
whenTriggerType: system-event
then[2]: Every finding MUST include a numeric confidence in [1,10], The validator MUST reject the envelope if confidence is missing
tags[1]: happy-path
automatable: true
```

### F-03: Decision principles + Mechanical/Taste/User-Challenge classifier

**Priority:** P0
**Milestone:** M-01
**Description:** Ship `protocols/loom-decision-principles.md` codifying the 6 principles (Completeness > Boil-lakes > Pragmatic > DRY > Explicit > Bias-to-action) and a Mechanical/Taste/User-Challenge classifier. Every auto-flow agent reads it before deciding whether to prompt the user or proceed.

**Entities involved:** DecisionPrinciples

**Key behaviors:**
- `protocols/loom-decision-principles.md` defines the 6 principles and classifier taxonomy.
- Auto-flow agents classify each pending decision as Mechanical, Taste, or User-Challenge.
- Mechanical and Taste decisions auto-resolve using the principle stack.
- User-Challenge decisions always prompt the user; never auto-answered.

**Convergence targets:**
- Protocol file exists at `protocols/loom-decision-principles.md`.
- Auto-flow agent emits a `decisionClass:` field on each auto-resolved decision.

**Scenarios:**

```toon
id: S-01
title: Auto-flow surfaces a User-Challenge decision for user input
given[1]: A pending decision is classified as User-Challenge
when: /loom-auto reaches the decision point
whenTriggerType: system-event
then[2]: The pipeline MUST pause for user input, The pipeline MUST NOT auto-resolve the decision
tags[1]: happy-path
automatable: true
```

### F-04: 0–10 scoring + remediation rubric for roadmap-converge dimensions

**Priority:** P1
**Milestone:** M-01
**Description:** Replace the Green/Yellow/Red exemplar rubrics under `protocols/roadmap-rubrics/*.md` with 0–10 scoring and prescriptive "what would make it a 10" remediation text. Same 8 dimensions, sharper output.

**Entities involved:** RoadmapRubric

**Key behaviors:**
- Each of the 8 dimension rubric files emits a 0–10 score plus remediation text.
- Roadmap-converge reviewer aggregates dimension scores and surfaces lowest first.
- Remediation text is prescriptive and specific to the observed gap.

**Convergence targets:**
- Reviewer output includes `dimension: N/10` for all 8 dimensions.

**Scenarios:**

```toon
id: S-01
title: Roadmap-converge emits 0-10 scores per dimension
given[1]: A roadmap under review has all 8 dimensions rated
when: The roadmap-converge reviewer completes a pass
whenTriggerType: system-event
then[2]: Output MUST include a numeric 0-10 score for each of the 8 dimensions, Each dimension SHOULD carry prescriptive remediation text when score <10
tags[1]: happy-path
automatable: true
```

### F-05: Learnings + regressions feedback loop

**Priority:** P0
**Milestone:** M-01
**Description:** Ship `.loom/learnings.toon` and `.loom/regressions.toon`. Every reviewer preamble does keyword search and surfaces "Prior learning applied: [key] (confidence N/10, from [date])". Roadmap-converge integrator writes new learnings after each pass. Anti-shortcut clauses cite named regressions.

**Entities involved:** Learning, Regression

**Key behaviors:**
- `.loom/learnings.toon` records key, description, confidence, source-plan, source-date per entry.
- `.loom/regressions.toon` records named past failure modes referenced by anti-shortcut clauses.
- Reviewers surface matched prior learnings in the preamble.
- Roadmap-converge integrator appends learnings after each successful pass.

**Convergence targets:**
- `.loom/learnings.toon` and `.loom/regressions.toon` written atomically after each converge pass.

**Scenarios:**

```toon
id: S-01
title: Reviewer preamble cites a matched prior learning
given[1]: .loom/learnings.toon contains an entry keyed "duplicate-scenario-ids"
when: A plan reviewer runs on a plan mentioning duplicate scenario ids
whenTriggerType: system-event
then[1]: The reviewer preamble MUST include a "Prior learning applied" line citing the matched learning
tags[1]: happy-path
automatable: true
```

### F-36: /loom-retro — retrospective ceremony

**Priority:** P0
**Milestone:** M-01
**Description:** Retrospective ceremony command. Reads the last N days of git activity, closed PRs, and planning artifacts, runs a structured retro interview, extracts insights to `.loom/learnings.toon` with confidence scores, surfaces anti-patterns to `.loom/regressions.toon`, and suggests ROADMAP mutations for recurring themes. Forms a trio with F-05 (learnings infra) and F-26 (learnings UI).

**Entities involved:** Learning, Regression, RetrospectiveArtifact

**Key behaviors:**
- Reads last N days of git activity, closed PRs, and planning artifacts as input.
- Runs a structured retro interview with the developer.
- Appends new entries to `.loom/learnings.toon` with confidence scores.
- Appends recurring anti-patterns to `.loom/regressions.toon`.
- Suggests ROADMAP mutations for recurring themes.
- Writes a durable retro artifact to `.loom/retros/{date}.md`.

**Convergence targets:**
- `.loom/retros/{date}.md` written atomically after each ceremony.
- New entries appended to `.loom/learnings.toon` and/or `.loom/regressions.toon`.

**Scenarios:**

```toon
id: S-01
title: /loom-retro writes a dated artifact and appends learnings
given[1]: A developer completes the structured retro interview
when: /loom-retro finishes the ceremony
whenTriggerType: actor-action
then[2]: A markdown file MUST be written at .loom/retros/{date}.md, At least one new entry MUST be appended to .loom/learnings.toon
tags[1]: happy-path
automatable: true
```



### F-06: `/loom-careful` + destructive-command PreToolUse guard

**Priority:** P0
**Milestone:** M-02
**Description:** Guard destructive commands (`rm -rf`, `DROP`, force-push, `git reset --hard`) via a PreToolUse hook with per-command overrides. Ships as an infrastructure resource (hook + settings entry). Composes with `/freeze` into `/loom-guard`.

**Entities involved:** GuardHookConfig

**Key behaviors:**
- PreToolUse hook blocks the destructive command list by default.
- Per-command override via `/loom-careful --allow <cmd>` or settings entry.
- Composes with `/freeze` pattern into a `/loom-guard` combined mode.

**Convergence targets:**
- Hook exit code non-zero when a blocked command is attempted without override.

**Scenarios:**

```toon
id: S-01
title: Destructive command is blocked without override
given[1]: The /loom-careful PreToolUse hook is installed
when: An agent attempts to run rm -rf on a project directory
whenTriggerType: system-event
then[2]: The hook MUST block the command, The hook MUST emit a warning naming the blocked command
tags[1]: happy-path
automatable: true
```

### F-07: `/loom-health` composite code-quality score with trend

**Priority:** P0
**Milestone:** M-02
**Description:** Wrap existing `tsc`, lint, `vitest`, `knip`, `shellcheck` into a weighted composite 0–10 code-quality score with history. Gives `/loom-status` a real "getting better or worse" signal.

**Entities involved:** HealthScoreHistory

**Key behaviors:**
- Runs the underlying quality tools and computes a weighted composite score.
- Persists score history to a Loom-scoped TOON file for trend display.
- `/loom-status` surfaces the latest score and trend arrow.

**Convergence targets:**
- `/loom-health` exits 0 and writes a history entry.

**Scenarios:**

```toon
id: S-01
title: /loom-health emits a composite score and appends history
given[1]: The repo has tsc, lint, and vitest configured
when: A developer runs /loom-health
whenTriggerType: actor-action
then[2]: The output MUST include a composite 0-10 score, A new entry MUST be appended to the health history TOON file
tags[1]: happy-path
automatable: true
```

### F-08: `/loom-think` — office-hours-style 5-phase interview

**Priority:** P0
**Milestone:** M-03
**Description:** Loom-native clone of gstack's office-hours THINK phase. 5-phase interview (Problem → Demand Evidence → Status Quo → Target User/Wedge → Constraints → Premises → Phase 3.5 cross-model second opinion → Approaches A/B → Recommendation). Output to `.loom/thinks/{slug}-{datetime}.md` with `Supersedes:` frontmatter chain. Feeds into `/loom-roadmap init --from`.

**Entities involved:** ThinkArtifact

**Key behaviors:**
- Command interactively walks the 5 phases.
- Writes prose artifact to `.loom/thinks/{slug}-{datetime}.md` with frontmatter.
- `/loom-roadmap init` accepts `--from .loom/thinks/latest.md` as context seed.
- Supersedes chain preserved across revisions.

**Convergence targets:**
- File written at `.loom/thinks/{slug}-{datetime}.md` with required frontmatter.

**Scenarios:**

```toon
id: S-01
title: /loom-think writes a versioned artifact with Supersedes frontmatter
given[1]: A developer completes the 5-phase interview
when: /loom-think finishes the interview
whenTriggerType: actor-action
then[2]: A markdown file MUST exist at .loom/thinks/{slug}-{datetime}.md, The frontmatter MUST include a Supersedes field
tags[1]: happy-path
automatable: true
```

### F-09: `/loom-spec` — idea → issue → work → close loop

**Priority:** P0
**Milestone:** M-03
**Description:** Consolidates the fragmented `note-add` / `quick` / `roadmap:mutate` loop into a single `/loom-spec` that takes a vague idea, produces a precise ROADMAP entry or GH issue, optionally spawns a worktree agent, and auto-closes the source issue on merge via `/loom-git pr` linkage.

**Entities involved:** SpecRecord

**Key behaviors:**
- Vague-idea input yields a precise ROADMAP-shaped entry.
- Optional GH issue creation with structured body.
- Optional worktree agent spawn.
- Source issue auto-closes on PR merge via `/loom-git pr` linkage.

**Convergence targets:**
- `/loom-spec` outputs a ROADMAP-schema-conforming feature block.

**Scenarios:**

```toon
id: S-01
title: /loom-spec produces a schema-conforming ROADMAP feature block
given[1]: A developer supplies a vague idea sentence
when: The developer runs /loom-spec with that idea
whenTriggerType: actor-action
then[1]: The output MUST include a Feature block that passes roadmap.schema.md structural validation
tags[1]: happy-path
automatable: true
```

### F-37: `/loom-spec --auto-mutate` flag

**Priority:** P1
**Milestone:** M-03
**Slug:** loom-spec-auto-mutate-flag
**Origin:** Dogfooded from /loom-spec run on itself during first live-test of gstack-adoption skills.

**Description:** Add `--auto-mutate` flag to `/loom-spec` that chains directly into `/loom-roadmap:mutate` after Phase 4 drafts a ROADMAP feature block. Default (no flag) preserves current gated behavior — draft only, operator runs mutate manually. `--auto-mutate` shows the draft and prompts y/n before mutating. `--auto-mutate --yes` skips confirmation for true one-shot. `--name <slug>` targets `planning/ROADMAP-<slug>.md` instead of the default.

**Entities involved:** SpecRecord

**Key behaviors:**
- Default cadence unchanged — SKILL.md Phase 4 emits block to stdout, operator runs mutate manually.
- `--auto-mutate` chains to `/loom-roadmap:mutate` after y/n confirmation.
- `--auto-mutate --yes` skips confirmation entirely (true one-shot).
- `--name <slug>` selects non-default roadmap target (matches convention across Loom commands).

**Anti-scope:** Does not auto-approve the ROADMAP-level review afterward. Does not auto-invoke `/loom-plan create` — deferred to a broader `--cadence` cross-cutting flag pattern if that direction is chosen later.

**Blast radius:** Bounded — `--auto-mutate` is opt-in; default behavior unchanged; only the flag path modifies files beyond stdout.

**Scenarios:**

```toon
scenarios[3]{id,name,given,when,whenTriggerType,then,tags,automatable}:
S-01,happy-path,"An operator invokes /loom-spec with a clear idea and --auto-mutate","the operator confirms with y at the prompt","actor-action","The drafted block MUST be inserted into the target roadmap via /loom-roadmap:mutate AND planning/history/changelog.md MUST gain a mutation entry",happy-path,true
S-02,refusal,"An operator invokes /loom-spec with --auto-mutate","the operator answers n at the prompt","actor-action","The block MUST remain visible in stdout AND the target roadmap MUST NOT be modified",edge-case,true
S-03,one-shot,"An operator invokes /loom-spec with --auto-mutate --yes","Phase 4 completes drafting","actor-action","The mutation MUST be applied to the target roadmap without any confirmation prompt",happy-path,true
```

### F-10: `plan-ceo-review` agent

**Priority:** P0
**Milestone:** M-04
**Description:** Cross-cutting strategic + architectural + threat-model reviewer with 11 sections (Vision Fit, Business Impact, Positioning, Scope Discipline, Architecture, Error & Rescue Map, Security & Threat Model, Data Model, Success Metrics, Risks, Distribution) and 4 modes (SCOPE EXPANSION / SELECTIVE / HOLD / REDUCTION). Spawns in parallel with the existing 6 plan reviewers.

**Entities involved:** PlanReviewFinding

**Key behaviors:**
- Runs 11 review sections against a plan.
- Emits findings in one of 4 mode-appropriate tenors.
- Includes a mandatory Error & Rescue Map (before/after exception-rescue table).

**Convergence targets:**
- Agent output includes all 11 sections and a declared mode.

**Scenarios:**

```toon
id: S-01
title: plan-ceo-review emits all 11 sections with a declared mode
given[1]: A plan is submitted for review
when: plan-ceo-review completes a pass
whenTriggerType: system-event
then[2]: The output MUST contain 11 named sections, The output MUST declare exactly one of the 4 modes
tags[1]: happy-path
automatable: true
```

### F-11: `plan-eng-review` upgrade with anti-skip clauses

**Priority:** P0
**Milestone:** M-04
**Description:** Retrofit `phasing-agent`, `parallelization-agent`, and `agentic-workflow-agent` with "Known Failure Modes" preambles sourced from `.loom/regressions.toon`. Every section carries an anti-skip rule naming a specific past failure.

**Entities involved:** Regression

**Key behaviors:**
- Each reviewer preamble reads from `.loom/regressions.toon`.
- Every section carries an anti-skip clause citing a named regression.
- Depends on F-05 shipping `.loom/regressions.toon`.

**Convergence targets:**
- Reviewer output preamble includes a "Known Failure Modes" section.

**Scenarios:**

```toon
id: S-01
title: Plan reviewer preamble names at least one past regression
given[1]: .loom/regressions.toon contains at least one regression
when: phasing-agent runs on a plan
whenTriggerType: system-event
then[1]: The preamble MUST include a "Known Failure Modes" section citing at least one regression by name
tags[1]: happy-path
automatable: true
```

### F-12: `plan-design-review` agent — 7 UX passes

**Priority:** P1
**Milestone:** M-04
**Description:** Port gstack's plan-design-review as 7 focused passes (IA, Interaction flow, User journey, State coverage, Empty/error/loading states, Accessibility, Visual hierarchy). Each pass rates 0–10 and prescribes "what would make it a 10". Either split from `ux-agent` or upgrade `ux-agent` to run all 7 with structured output.

**Entities involved:** DesignReviewPass

**Key behaviors:**
- Runs 7 named passes over a plan.
- Each pass emits a 0–10 score plus remediation.

**Convergence targets:**
- Output contains all 7 pass results with numeric scores.

**Scenarios:**

```toon
id: S-01
title: plan-design-review emits scores for all 7 passes
given[1]: A UI-heavy plan is submitted for review
when: plan-design-review completes
whenTriggerType: system-event
then[1]: The output MUST contain 7 pass results each with a 0-10 score
tags[1]: happy-path
automatable: true
```

### F-13: `plan-devex-review` agent (plan-time DX review)

**Priority:** P1
**Milestone:** M-04
**Description:** 8 passes evaluating install DX, TTHW prediction, CLI ergonomics, error-message quality, doc-first vs code-first, config surface, upgrade path, and uninstall/rollback. Predicts a TTHW value so F-19's live audit can measure against it. Uses a "DX Hall of Fame" reference file.

**Entities involved:** DevExPrediction

**Key behaviors:**
- Runs 8 DX passes against a plan.
- Emits a predicted TTHW value.
- Cites the DX Hall of Fame reference file.

**Convergence targets:**
- Output includes a numeric `predictedTTHW` field.

**Scenarios:**

```toon
id: S-01
title: plan-devex-review emits a predicted TTHW
given[1]: A plan describing a user-facing CLI is submitted
when: plan-devex-review completes
whenTriggerType: system-event
then[1]: The output MUST include a numeric predictedTTHW field
tags[1]: happy-path
automatable: true
```

### F-14: `/loom-code:design-review` — visual QA lens

**Priority:** P0
**Milestone:** M-05
**Description:** Designer-eye visual QA with iterative fix + screenshot diff. Detects "AI slop patterns" (excessive gradients, generic emoji, tell-tale marketing prose, over-symmetric grids, default shadcn palettes) as a first-class finding category. Wraps chrome-devtools MCP per C-05.

**Entities involved:** VisualFinding

**Key behaviors:**
- Captures screenshots via chrome-devtools MCP.
- Runs a rubric that includes an "AI slop" finding category.
- Emits before/after screenshot diffs on iterative fixes.

**Convergence targets:**
- Findings include `category: ai-slop` when triggered.

**Scenarios:**

```toon
id: S-01
title: Design review flags AI slop patterns as a first-class category
given[1]: A rendered UI contains a default shadcn palette with excessive gradients
when: /loom-code:design-review runs against the URL
whenTriggerType: actor-action
then[1]: At least one finding MUST have category "ai-slop"
tags[1]: happy-path
automatable: true
```

### F-15: `/loom-code:review` LLM trust-boundary category

**Priority:** P0
**Milestone:** M-05
**Description:** Adds `findingCategory: llm-trust` to code reviewers. Checks: user-controlled strings flowing into prompts without sanitization, tool-result content re-injected as instructions, MCP responses trusted as authoritative, agent outputs used as code without a validation gate.

**Entities involved:** LlmTrustFinding

**Key behaviors:**
- Reviewer emits `findingCategory: llm-trust` for the 4 named check classes.
- Dedicated rubric prompt inlined into the reviewer.

**Convergence targets:**
- Reviewer output can emit findings with `findingCategory: llm-trust`.

**Scenarios:**

```toon
id: S-01
title: Reviewer flags unsanitized user input flowing into a prompt
given[1]: A diff introduces a function that concatenates req.body.text into a prompt template
when: /loom-code:review runs on the diff
whenTriggerType: actor-action
then[1]: At least one finding MUST have findingCategory "llm-trust"
tags[1]: happy-path
automatable: true
```

### F-16: `/loom-code:codex` — cross-vendor code review

**Priority:** P0
**Milestone:** M-05
**Description:** Wraps OpenAI Codex (or Gemini) as an evaluator alongside Claude reviewers in `/loom-code review` and `/loom-vote`. Adversarial diversity — a different vendor's biases catch different bugs. Config: which vendor(s) to include, cost cap per review.

**Entities involved:** CrossVendorReviewer

**Key behaviors:**
- Plugs into the existing multi-agent review flow.
- Config file controls vendor inclusion and per-review cost cap.
- Emits findings into the same envelope as Claude reviewers.

**Convergence targets:**
- Review output includes findings tagged by vendor.

**Scenarios:**

```toon
id: S-01
title: Cross-vendor reviewer contributes findings alongside Claude
given[1]: /loom-code:codex is configured with a non-Claude vendor
when: /loom-code review runs on a diff
whenTriggerType: actor-action
then[1]: The consolidated review output MUST include at least one finding attributed to the configured vendor
tags[1]: happy-path
automatable: true
```

### F-17: `/loom-docs:release` — post-ship doc sync

**Priority:** P0
**Milestone:** M-06
**Description:** Diff-driven README / CHANGELOG / architecture doc sync plus diagram drift detection and a CHANGELOG "sell-test" rubric. Surfaces doc-debt in the PR body. Directly addresses the standing MEMORY note about docs keeping pace with code.

**Entities involved:** DocSyncReport

**Key behaviors:**
- Diffs shipped code against docs and enumerates gaps.
- Detects diagram drift versus current code.
- Runs a CHANGELOG "sell-test" rubric.
- Emits doc-debt summary into the PR body.

**Convergence targets:**
- Command exits non-zero when doc-debt is detected without a plan.

**Scenarios:**

```toon
id: S-01
title: /loom-docs:release surfaces README gaps introduced by a diff
given[1]: A PR adds a new user-facing CLI flag not documented in README
when: /loom-docs:release runs against the PR
whenTriggerType: actor-action
then[1]: The output MUST include a finding naming the missing README entry
tags[1]: happy-path
automatable: true
```

### F-18: `/loom-skillify` — retrospective codification

**Priority:** P0
**Milestone:** M-06
**Description:** Walks back the conversation transcript, codifies a successful one-shot flow into `script.ts` + `test.ts` + fixture, runs the test before committing. The missing backward-direction pair to `/loom-agent create` and `/loom-skill create`. Compounds over sessions.

**Entities involved:** SkillifyArtifact

**Key behaviors:**
- Reads a session transcript slice designated by the user.
- Emits `script.ts`, `test.ts`, and a fixture.
- Runs the test suite before committing.

**Convergence targets:**
- Generated `test.ts` exits 0 when run under vitest.

**Scenarios:**

```toon
id: S-01
title: /loom-skillify writes a passing test for the codified flow
given[1]: A successful transcript slice is designated
when: /loom-skillify runs
whenTriggerType: actor-action
then[2]: A test.ts MUST be written under the target skill directory, Running vitest against the new test MUST exit 0
tags[1]: happy-path
automatable: true
```

### F-19: `/loom-devex:review` — live DX audit boomerang

**Priority:** P1
**Milestone:** M-07
**Description:** Live DX audit: times measured TTHW, screenshots errors, scores CLI help, compares against `plan-devex-review`'s predicted TTHW. Closes the loop and makes plan claims falsifiable.

**Entities involved:** DevExAudit

**Key behaviors:**
- Runs the install-to-hello-world path end-to-end and times it.
- Captures screenshots of error states.
- Diffs measured TTHW against the predicted value from F-13.

**Convergence targets:**
- Output includes both `predictedTTHW` and `measuredTTHW` fields.

**Scenarios:**

```toon
id: S-01
title: Live audit reports predicted vs measured TTHW
given[1]: A plan under F-13 predicted TTHW of 3 minutes
when: /loom-devex:review completes a live run
whenTriggerType: actor-action
then[1]: The output MUST include predictedTTHW and measuredTTHW fields with numeric values
tags[1]: happy-path
automatable: true
```

### F-20: `/loom-cso` — two-tier security review

**Priority:** P1
**Milestone:** M-07
**Description:** Daily 8/10 gate (fast, blocks PR if score drops) and monthly 2/10 deep-scan with trend tracking. Maps cleanly onto Loom's tier model.

**Entities involved:** SecurityScoreHistory

**Key behaviors:**
- Runs a fast 8/10 gate on every PR.
- Persists security score history.
- Runs a monthly 2/10 deep scan on schedule.

**Convergence targets:**
- Fast gate exits non-zero when the score drops versus history.

**Scenarios:**

```toon
id: S-01
title: /loom-cso fast gate blocks PR when score regresses
given[1]: The stored score history has a most-recent score of 8/10
when: The fast gate runs on a PR that scores 6/10
whenTriggerType: actor-action
then[1]: The gate MUST exit non-zero
tags[1]: happy-path
automatable: true
```

### F-21: `/loom-qa` — live-site iterative test-fix loop

**Priority:** P1
**Milestone:** M-07
**Description:** Browser-drives a live site, finds bugs, fixes iteratively with atomic commits, re-verifies. Emits before/after health scores plus a ship-readiness verdict. Three tiers (Quick / Standard / Exhaustive).

**Entities involved:** QaRunReport

**Key behaviors:**
- Selects a tier (Quick / Standard / Exhaustive).
- Iteratively finds and fixes bugs with atomic commits.
- Emits ship-readiness verdict.

**Convergence targets:**
- Output includes a `shipReadiness: ready|not-ready` field.

**Scenarios:**

```toon
id: S-01
title: /loom-qa emits ship-readiness verdict after a Quick tier run
given[1]: A live site URL is provided
when: /loom-qa runs at the Quick tier
whenTriggerType: actor-action
then[1]: The output MUST include a shipReadiness field with value ready or not-ready
tags[1]: happy-path
automatable: true
```

### F-22: `/loom-design:consultation` — brand kickoff

**Priority:** P1
**Milestone:** M-13
**Description:** Ground-up brand kickoff: aesthetic direction, typography, color system, motion principles, font preview render. Pulls prior design decisions from `.loom/learnings.toon`. Slots before `/loom-plan create` for UI-heavy projects.

**Entities involved:** DesignConsultation

**Key behaviors:**
- Interactive interview yields a design premise artifact.
- Renders a font preview.
- Uses learnings.toon to pull prior design decisions.

**Convergence targets:**
- Output artifact written to a Loom-scoped location.

**Scenarios:**

```toon
id: S-01
title: /loom-design:consultation writes a design premise artifact
given[1]: A developer completes the consultation interview
when: The command finishes
whenTriggerType: actor-action
then[1]: A design premise markdown file MUST be written to the Loom design directory
tags[1]: happy-path
automatable: true
```

### F-23: `/loom-design:html` — production HTML/CSS from mockup

**Priority:** P2
**Milestone:** M-13
**Description:** Ships production HTML/CSS from an approved mockup using a "Pretext-native" approach (text reflows, heights computed, layouts not pixel-frozen).

**Entities involved:** DesignHtmlOutput

**Key behaviors:**
- Consumes an approved mockup input.
- Emits production HTML/CSS with reflow-first structure.

**Convergence targets:**
- Emitted HTML validates against the W3C validator (or an equivalent).

**Scenarios:**

```toon
id: S-01
title: /loom-design:html emits valid HTML from an approved mockup
given[1]: An approved mockup file is provided
when: /loom-design:html runs
whenTriggerType: actor-action
then[1]: The emitted HTML MUST parse without structural errors
tags[1]: happy-path
automatable: true
```

### F-24: `/loom-design:shotgun` — parallel UI variant board

**Priority:** P2
**Milestone:** M-13
**Description:** Generates N design variants, renders side-by-side in a browser, captures user preference, and decays old preferences over time so the system does not ossify. Enhances `/loom-prototype ui`.

**Entities involved:** VariantPreference

**Key behaviors:**
- Generates N variants and renders them side by side.
- Records user preference selections.
- Applies time-decay to old preferences.

**Convergence targets:**
- Preference records include a `capturedAt` timestamp.

**Scenarios:**

```toon
id: S-01
title: /loom-design:shotgun records a preference with timestamp
given[1]: N variants are rendered side by side
when: A user selects one variant as preferred
whenTriggerType: actor-action
then[1]: A preference record MUST be written with a capturedAt timestamp
tags[1]: happy-path
automatable: true
```

### F-25: `/loom-benchmark-models` — side-by-side model comparison

**Priority:** P1
**Milestone:** M-08
**Description:** Same prompt through Claude + GPT + Gemini, LLM-judge scores quality, dashboard reports latency + tokens + cost per skill. Fills the cost/latency dashboard gap that `/loom-vote` lacks. Feeds model resolution decisions in `orchestration.toml`.

**Entities involved:** ModelBenchmarkRun

**Key behaviors:**
- Runs the same prompt through multiple vendors.
- LLM-judge scores each output.
- Emits a dashboard with latency, tokens, and cost per skill.

**Convergence targets:**
- Dashboard output includes latency, tokens, and cost columns.

**Scenarios:**

```toon
id: S-01
title: /loom-benchmark-models emits cost, latency, tokens per vendor
given[1]: A benchmark prompt and target vendors are configured
when: /loom-benchmark-models completes
whenTriggerType: actor-action
then[1]: The dashboard MUST include cost, latency, and token columns per vendor
tags[1]: happy-path
automatable: true
```

### F-26: `/loom-learn` — management UI over `.loom/learnings.toon`

**Priority:** P1
**Milestone:** M-08
**Description:** Review, search, prune, and export cross-session learnings. Surfaces proactively when the user says "didn't we fix this before?". Ships alongside F-05 as the management surface.

**Entities involved:** Learning

**Key behaviors:**
- Read + search over `.loom/learnings.toon`.
- Prune stale entries.
- Export to portable format.

**Convergence targets:**
- Prune operation removes only entries matching the filter.

**Scenarios:**

```toon
id: S-01
title: /loom-learn search returns matching learnings
given[1]: .loom/learnings.toon contains an entry with description matching "duplicate scenario ids"
when: A developer runs /loom-learn search "duplicate scenario"
whenTriggerType: actor-action
then[1]: The result MUST include the matching entry
tags[1]: happy-path
automatable: true
```

### F-27: `/loom-benchmark` — perf regression via browser

**Priority:** P2
**Milestone:** M-08
**Description:** Core Web Vitals baseline plus PR-diff with before/after trend line per PR. Wraps chrome-devtools MCP per C-05.

**Entities involved:** PerfBenchmarkRun

**Key behaviors:**
- Captures baseline Core Web Vitals.
- Emits before/after trend for a PR diff.

**Convergence targets:**
- Output includes LCP, CLS, INP fields.

**Scenarios:**

```toon
id: S-01
title: /loom-benchmark emits Core Web Vitals for a PR
given[1]: A baseline run exists
when: /loom-benchmark runs on a PR
whenTriggerType: actor-action
then[1]: The output MUST include LCP, CLS, and INP values for the PR head
tags[1]: happy-path
automatable: true
```

### F-28: `/loom-docs:generate` — cold-start Diataxis docs

**Priority:** P2
**Milestone:** M-08
**Description:** Cold-start docs generation enforcing Diataxis quadrants (tutorial / how-to / reference / explanation).

**Entities involved:** DocQuadrant

**Key behaviors:**
- Generates a doc scaffold for each of the 4 quadrants.
- Enforces quadrant-appropriate voice and structure.

**Convergence targets:**
- 4 markdown files emitted under `docs/{tutorial,how-to,reference,explanation}/`.

**Scenarios:**

```toon
id: S-01
title: /loom-docs:generate emits all 4 Diataxis quadrants
given[1]: A repo with no docs directory
when: /loom-docs:generate runs
whenTriggerType: actor-action
then[1]: 4 doc files MUST be emitted, one per Diataxis quadrant
tags[1]: happy-path
automatable: true
```

### F-29: `/loom-diagram` — english/mermaid → excalidraw triplet

**Priority:** P2
**Milestone:** M-08
**Description:** Emits an editable `.excalidraw` alongside `.svg` / `.png` renders from an English or mermaid input. Useful for wiki pages and ROADMAP visualizations.

**Entities involved:** DiagramTriplet

**Key behaviors:**
- Takes English or mermaid input.
- Emits `.excalidraw` + `.svg` + `.png`.

**Convergence targets:**
- All three files present on disk after a successful run.

**Scenarios:**

```toon
id: S-01
title: /loom-diagram emits a triplet of files
given[1]: A mermaid diagram source is provided
when: /loom-diagram runs
whenTriggerType: actor-action
then[1]: The output directory MUST contain .excalidraw, .svg, and .png files with the same base name
tags[1]: happy-path
automatable: true
```

### F-30: `/loom-ship` — pre-flight and ship

**Priority:** P0
**Milestone:** M-10
**Description:** Ship-phase command handling pre-flight rebase, drift detection against main, VERSION-slot reservation, and PR body generation with an inline plan-completion audit. First mover in the deployment lifecycle trio (F-30, F-31, F-32).

**Entities involved:** LoomShipConfig

**Key behaviors:**
- Pre-flight rebase against main.
- Drift detection compares local branch against remote main.
- Reserves a VERSION slot to avoid collisions with concurrent shippers.
- Generates PR body embedding a plan-completion audit summary.

**Convergence targets:**
- Command writes a VERSION reservation entry and exits 0 when pre-flight passes.

**Scenarios:**

```toon
id: S-01
title: /loom-ship reserves VERSION slot and emits PR body
given[1]: The branch is up to date with main and pre-flight checks pass
when: A developer runs /loom-ship
whenTriggerType: actor-action
then[2]: A VERSION slot MUST be reserved for the branch, The generated PR body MUST include a plan-completion audit section
tags[1]: happy-path
automatable: true
```

### F-31: `/loom-canary` + `/loom-landing-report`

**Priority:** P0
**Milestone:** M-10
**Description:** Progressive deployment with health-check gates and automatic rollback (`/loom-canary`), plus a multi-workspace dashboard showing active branches, reserved VERSION slots, and staleness across worktrees (`/loom-landing-report`).

**Entities involved:** LoomShipConfig

**Key behaviors:**
- `/loom-canary` runs a progressive deploy with health-check gates at each stage.
- Automatic rollback triggers when a health-check gate fails.
- `/loom-landing-report` renders a dashboard of active branches, VERSION slots, and staleness.

**Convergence targets:**
- Canary run exits non-zero and triggers rollback when a health gate fails.

**Scenarios:**

```toon
id: S-01
title: /loom-canary progresses deploy and passes health gates
given[1]: A canary deploy target is configured and all health checks pass
when: A developer runs /loom-canary
whenTriggerType: actor-action
then[2]: The deploy MUST progress through all configured stages, The command MUST exit 0 with a landing summary
tags[1]: happy-path
automatable: true
```

### F-32: `/loom-setup:deploy` — deploy target detection

**Priority:** P0
**Milestone:** M-10
**Description:** Detects the project's deploy target (Fly, Vercel, Render, Cloudflare, Netlify, Railway) from repo signals (config files, package scripts, workflow files) and writes the detected config to CLAUDE.md so the ship phase auto-works. Read-only against the deploy target itself per C-06.

**Entities involved:** LoomShipConfig

**Key behaviors:**
- Detects deploy target from repo signals.
- Writes detected target and hints to CLAUDE.md.
- Never mutates deploy-target config files directly (per C-06).

**Convergence targets:**
- CLAUDE.md contains a deploy-target section after a successful run.

**Scenarios:**

```toon
id: S-01
title: /loom-setup:deploy detects Vercel and writes CLAUDE.md hints
given[1]: A repo contains a vercel.json and Next.js package scripts
when: A developer runs /loom-setup:deploy
whenTriggerType: actor-action
then[2]: CLAUDE.md MUST include a deploy-target section naming Vercel, The vercel.json file MUST NOT be modified
tags[1]: happy-path
automatable: true
```

### F-33: `/loom-browser` — persistent Chromium daemon + sidebar

**Priority:** P0
**Milestone:** M-11
**Description:** Persistent Chromium daemon at `.loom/browser/` with a sidebar extension, anti-bot stealth measures, prompt-injection defense (ML classifier + Haiku canary + CDP allowlist), tiered READ/WRITE/META command semantics, and accessibility-tree refs for actor targeting. Provides the browser foundation M-07 features depend on.

**Entities involved:** BrowserState

**Key behaviors:**
- Persistent Chromium daemon lives at `.loom/browser/` and survives session restarts.
- Sidebar extension surfaces daemon status and controls.
- Prompt-injection defense combines ML classifier + Haiku canary + CDP allowlist.
- Tiered READ / WRITE / META command semantics gate destructive browser actions.
- Uses accessibility-tree refs (not brittle CSS selectors) for actor targeting.

**Convergence targets:**
- `.loom/browser/state.toon` written and re-readable across sessions.
- Prompt-injection defense blocks a known injection payload.

**Scenarios:**

```toon
id: S-01
title: /loom-browser starts the daemon and persists state
given[1]: No browser daemon is currently running
when: A developer runs /loom-browser start
whenTriggerType: actor-action
then[2]: A Chromium process MUST be running as the daemon, .loom/browser/state.toon MUST be written with the daemon's session id
tags[1]: happy-path
automatable: true
```

### F-34: `/loom-setup:browser-cookies` — cookie import

**Priority:** P1
**Milestone:** M-11
**Description:** Imports real Chrome cookies into the headless Loom browser daemon so authenticated live-site QA works out of the box. Interactive domain picker; per-project storage at `.loom/browser/cookies/{domain}.toon` with expiry tracking.

**Entities involved:** BrowserCookies

**Key behaviors:**
- Interactive domain picker lets the developer choose which domains to import.
- Imports cookies from the local Chrome profile.
- Stores per-domain cookies at `.loom/browser/cookies/{domain}.toon` with expiry.

**Convergence targets:**
- `.loom/browser/cookies/{domain}.toon` written for each selected domain.

**Scenarios:**

```toon
id: S-01
title: /loom-setup:browser-cookies imports cookies for a chosen domain
given[1]: A developer has cookies for example.com in local Chrome
when: The developer runs /loom-setup:browser-cookies and selects example.com
whenTriggerType: actor-action
then[2]: A file MUST be written at .loom/browser/cookies/example.com.toon, The file MUST include an expiry field per cookie
tags[1]: happy-path
automatable: true
```

### F-35: Direct-symlink distribution

**Priority:** P0
**Milestone:** M-12
**Description:** Ships `bin/loom-install --link ~/.claude/skills/loom` as the recommended power-user install path alongside the plugin marketplace route. Enables cross-host reach (Hermes, OpenClaw, Codex via `--host` flag) and a shorter contributor loop — fork + PR upstream with no marketplace mediation.

**Entities involved:** InstallManifest

**Key behaviors:**
- `bin/loom-install --link <target>` creates symlinks from the target to the Loom source tree.
- `--host <name>` flag targets alternative hosts (Hermes, OpenClaw, Codex).
- Records symlink registry in an install manifest for later `--unlink`.
- Coexists with the Claude Code plugin marketplace install route per C-07.

**Convergence targets:**
- After `--link`, the target directory contains symlinks pointing back to the source tree.
- The install manifest lists all created symlinks.

**Scenarios:**

```toon
id: S-01
title: bin/loom-install --link creates symlinks and manifest
given[1]: The Loom source tree is checked out locally
when: A developer runs bin/loom-install --link ~/.claude/skills/loom
whenTriggerType: actor-action
then[2]: ~/.claude/skills/loom MUST contain symlinks pointing into the source tree, The install manifest MUST record every created symlink
tags[1]: happy-path
automatable: true
```

## Data Model (Conceptual)

This is a meta / tooling initiative. Entities are Loom-scoped artifacts, not user-facing product data.

### Entities

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| Learning | key, description, confidence, sourcePlan, sourceDate | Cross-session learning entry in `.loom/learnings.toon` |
| Regression | id, name, description, firstSeen, exemplar | Named past failure mode in `.loom/regressions.toon` |
| ThinkArtifact | slug, datetime, supersedes, body | Prose artifact under `.loom/thinks/` |
| LeaseRegistry | repo, worktree, ownedPaths, acquiredAt | Cross-worktree ownership registry at `~/.loom/leases/{repo}.toon` |
| AgentResultFinding | id, category, severity, confidence, message | Finding shape carried by every reviewer output |
| DecisionPrinciples | principles, classifier | Shared protocol read by auto-flow agents |
| RoadmapRubric | dimension, score, remediation | 0-10 scored rubric per roadmap dimension |
| HealthScoreHistory | timestamp, compositeScore, componentScores | Rolling code-quality score history |
| SecurityScoreHistory | timestamp, gateScore, deepScanScore | Rolling security score history |
| SpecRecord | id, sourceIssue, roadmapFeatureRef, status | Spec loop record for `/loom-spec` |
| PlanReviewFinding | reviewer, section, mode, confidence, body | Structured finding from plan reviewers (F-10, F-11, F-12, F-13) |
| DevExPrediction | predictedTTHW, passes, notes | Output of `plan-devex-review` |
| DevExAudit | measuredTTHW, predictedTTHW, deltas | Output of `/loom-devex:review` |
| VisualFinding | category, severity, screenshotRef, aiSlopFlags | Finding from `/loom-code:design-review` |
| LlmTrustFinding | checkClass, sink, source, confidence | Finding from LLM trust-boundary category |
| CrossVendorReviewer | vendor, costCap, findings | Cross-vendor review adapter output |
| DocSyncReport | missingReadme, staleDiagrams, changelogSellTest | Output of `/loom-docs:release` |
| SkillifyArtifact | scriptPath, testPath, fixturePath | Output of `/loom-skillify` |
| QaRunReport | tier, iterations, shipReadiness | Output of `/loom-qa` |
| DesignConsultation | aesthetic, typography, color, motion | Output of `/loom-design:consultation` |
| DesignHtmlOutput | mockupRef, htmlPath, cssPath | Output of `/loom-design:html` |
| VariantPreference | variantId, capturedAt, decayWeight | Preference record for `/loom-design:shotgun` |
| ModelBenchmarkRun | vendor, latency, tokens, cost, judgeScore | Row in the benchmark dashboard |
| PerfBenchmarkRun | prRef, lcp, cls, inp, baselineRef | Row in perf trend |
| DocQuadrant | quadrant, path, voice | Diataxis quadrant scaffold |
| DiagramTriplet | excalidrawPath, svgPath, pngPath | Output of `/loom-diagram` |
| LoomShipConfig | deployTarget, versionSlot, healthChecks | Deploy target detection results written to CLAUDE.md |
| BrowserState | sessionId, pid, startedAt, tabRefs | Persistent daemon state at `.loom/browser/state.toon` |
| BrowserCookies | domain, cookies, importedAt, expiries | Per-domain cookie import at `.loom/browser/cookies/{domain}.toon` |
| InstallManifest | createdAt, symlinks, host | Symlink registry for direct-install path |
| RetrospectiveArtifact | date, windowStart, windowEnd, insights, body | Output of `/loom-retro` at `.loom/retros/{date}.md` |

### Relationships

| From | To | Type | Description |
|------|-----|------|-------------|
| PlanReviewFinding | Regression | M:N | Anti-skip clauses cite regressions |
| AgentResultFinding | Learning | M:N | Reviewer preamble cites matched learnings |
| DevExAudit | DevExPrediction | 1:1 | Live audit measures against plan-time prediction |
| ThinkArtifact | ThinkArtifact | 1:1 | Supersedes chain |
| SpecRecord | Learning | M:N | Spec loop reads prior learnings for context |
| RetrospectiveArtifact | Learning | 1:N | Retro produces learnings |
| RetrospectiveArtifact | Regression | 1:N | Retro surfaces new regressions |
| BrowserState | BrowserCookies | 1:N | Daemon session loads cookies per domain |
| InstallManifest | InstallManifest | 1:1 | Successive installs supersede prior manifests |

## Milestones

### M-01: Judgment layer

**Features:** F-02, F-03, F-04, F-05, F-36
**Depends on:** None
**Acceptance:** Confidence-calibrated findings, decision principles, 0–10 rubrics, the learnings/regressions feedback loop, and the retrospective ceremony are shipped and consumed by at least one existing reviewer.
**Effort:** M

### M-02: Safety and observability

**Features:** F-06, F-07
**Depends on:** None
**Acceptance:** Destructive-command guard is active and `/loom-health` emits composite scores with persisted history.
**Effort:** S

### M-03: Think and spec flow

**Features:** F-08, F-09
**Depends on:** M-01
**Acceptance:** `/loom-think` writes artifacts consumed by `/loom-roadmap init`, and `/loom-spec` produces schema-conforming ROADMAP feature blocks.
**Effort:** M

### M-04: Planning reviewers (org-simulation)

**Features:** F-10, F-11, F-12, F-13
**Depends on:** M-01
**Acceptance:** All 4 reviewers plug into the existing plan-review parallel fan-out. F-11 consumes `.loom/regressions.toon` shipped in M-01.
**Effort:** M

### M-05: Code review lenses

**Features:** F-14, F-15, F-16
**Depends on:** M-01
**Acceptance:** Visual QA, LLM trust-boundary, and cross-vendor review all contribute findings into the `/loom-code review` envelope. F-14 wraps chrome-devtools MCP per C-05.
**Effort:** M

### M-06: Docs and skillify

**Features:** F-17, F-18
**Depends on:** M-01
**Acceptance:** `/loom-docs:release` surfaces doc-debt in PRs, and `/loom-skillify` codifies flows into runnable script + test + fixture triples.
**Effort:** S

### M-07: Build-time QA

**Features:** F-19, F-20, F-21
**Depends on:** M-04, M-11
**Acceptance:** `/loom-devex:review` produces DevExAudit records with both predictedTTHW and measuredTTHW; `/loom-cso` fast gate exits non-zero on score regression and persists SecurityScoreHistory; `/loom-qa` emits a QaRunReport with a shipReadiness verdict. Browser features consume the persistent daemon from M-11.
**Effort:** L

### M-08: Instrumentation nice-to-haves

**Features:** F-25, F-26, F-27, F-28, F-29
**Depends on:** M-05
**Acceptance:** Cross-model benchmarking, learnings management UI, perf benchmarking, Diataxis doc generation, and diagram triplets all ship.
**Effort:** L

### M-09: Fan-in coordination

**Features:** F-01
**Depends on:** None
**Acceptance:** `/loom-git pr preflight` warns on ownership overlap and auto-rebases from main. Full lease registry + semantic pre-conflict + merge queue may follow.
**Effort:** M

### M-10: Ship engineer

**Features:** F-30, F-31, F-32
**Depends on:** None
**Acceptance:** `/loom-ship` runs pre-flight and reserves VERSION slots, `/loom-canary` and `/loom-landing-report` handle progressive deploy and dashboard, and `/loom-setup:deploy` detects targets into CLAUDE.md.
**Effort:** M

### M-11: Browser infrastructure

**Features:** F-33, F-34
**Depends on:** None
**Acceptance:** `/loom-browser` runs a persistent Chromium daemon with sidebar, prompt-injection defense, and tiered command semantics; `/loom-setup:browser-cookies` imports real Chrome cookies per project. Prerequisite for all M-07 browser-driving features.
**Effort:** L

### M-12: Distribution

**Features:** F-35
**Depends on:** None
**Acceptance:** `bin/loom-install --link` ships as a supported install path alongside the plugin marketplace, with cross-host support (Hermes, OpenClaw, Codex) via `--host`.
**Effort:** S

### M-13: Build-time Design

**Features:** F-22, F-23, F-24
**Depends on:** M-04, M-11
**Acceptance:** `/loom-design:consultation` writes a design premise artifact to the Loom design directory; `/loom-design:html` emits HTML that parses without structural errors from an approved mockup; `/loom-design:shotgun` records VariantPreference entries with capturedAt timestamps. Browser features consume the persistent daemon from M-11.
**Effort:** L

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Verbatim porting from gstack (violating C-01) | high | Every port routed through Loom-native authoring wizards (`/loom-agent create`, `/loom-skill create`); code review checks for gstack-shaped markdown-only patterns. |
| Browser daemon becomes an implicit blocker for M-07 | medium | M-11 formalizes the daemon so M-07 has a first-class dependency instead of an implicit assumption. C-05 remains as fallback for interim wrapping of chrome-devtools MCP. |
| Scope creep — adopters pull additional gstack ideas mid-flight | medium | Out of Scope section names deferred gstack surfaces; require a new roadmap entry to expand scope. |
| Learnings/regressions data quality degrades over time | medium | F-26 (`/loom-learn`) ships in M-08 as the management surface for pruning and export. |
| Cross-vendor reviewer (F-16) cost overrun | low | Config cost cap per review; benchmarks in F-25 feed model-selection tuning. |
| Confidence field retrofit breaks existing reviewer outputs | medium | Land F-02 with a lenient parse mode that defaults confidence to 5 for one release, then flips to blocking. |
| Distribution fragmentation across plugin + direct-symlink routes | medium | Clear positioning per C-07: plugin = discovery, direct = power-user. Docs explicitly compare the two routes to prevent user confusion. |

## Out of Scope

- Forking or vendoring any gstack code, prompts, or reference files.
- A gstack→Loom transpiler for the markdown design-doc format.
- Hosting the Chromium binary — `/loom-browser` wraps the user's existing Chrome install.
- A new evaluation/metrics framework or quantitative telemetry system.
- Consolidation of Loom's existing overlapping reviewers (strategy / feature-coverage / phasing / parallelization / ux / agentic-workflow) — tracked separately.
- Merging `/loom-prototype` and `/loom-change` into `/loom-auto` — separate roadmap.
- Reducing the surface of `/loom-plan create` — separate roadmap.

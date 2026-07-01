---
planVersion: 2
name: "gstack Skill Adoption"
status: approved
created: 2026-06-30
lastReviewed: 2026-06-30
roadmapRef: planning/ROADMAP-gstack-adoption.md
totalPhases: 14
totalWaves: 14
---

# Plan: gstack Skill Adoption

## Overview

Re-authors 35 gstack-inspired ideas as Loom-native resources across 13 milestones. Each milestone becomes an execution phase; contract emission is consolidated into Phase 0 so downstream implementer phases share stable schemas. Per user directive and C-03/Q-04, this plan intentionally omits evaluation/metrics scaffolding, criteria-plan.toon generation, and quantitative acceptance criteria beyond placeholders.

## Tech Stack

- **Language:** TypeScript 5.x
- **Runtime:** Bun (primary), Node.js 20+ (fallback)
- **Testing:** Vitest
- **Platform:** Claude Code plugin (agents, prompts, skills, hooks, protocols)
- **Data Format:** TOON v1 for every Loom artifact, agent envelope, and new protocol
- **Browser (optional):** chrome-devtools MCP (M-05 wraps; M-11 supersedes with persistent daemon)

Resource types shipped:
- `agent` -> `agents/{name}.md`
- `prompt` -> `commands/{name}.md` or `commands/{parent}/{sub}.md`
- `skill` -> `skills/{name}/SKILL.md`
- `protocol` -> `protocols/{name}.md` or `protocols/{name}.schema.toon`
- `infrastructure` -> `hooks/{name}.ts`, `scripts/{name}.ts`
- Registration: `skills/library.yaml`

## Schema / Type Definitions

Every entity is a Loom-scoped artifact serialized as TOON. Full field-level constraints live in the protocol files emitted by Phase 0; this section is the plan-level index.

### Learning

| Field | Type | Constraints |
|-------|------|-------------|
| key | string | slug, unique within learnings.toon |
| description | string | non-empty |
| confidence | integer | 1..10 |
| sourcePlan | string | plan path or null |
| sourceDate | ISO date | required |

**Indexing:** unique on `key`.
**Cascade Behavior:** none (append-only file).

### Regression

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | R-NN slug |
| name | string | non-empty |
| description | string | non-empty |
| firstSeen | ISO date | required |
| exemplar | string | link/path to plan or PR |

**Indexing:** unique on `id`.
**Cascade Behavior:** none.

### AgentResultFinding (extended)

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | F-NN unique per envelope |
| category | string | reviewer-defined |
| severity | enum | blocking, warning, info |
| confidence | integer | **NEW** — 1..10 required (F-02) |
| message | string | non-empty |

**Validation Rules:** finding missing `confidence` rejected by envelope validator.

### DecisionPrinciples

| Field | Type | Constraints |
|-------|------|-------------|
| principles | list<string> | 6 items, ordered |
| classifier | enum | mechanical, taste, user-challenge |

### RoadmapRubric

| Field | Type | Constraints |
|-------|------|-------------|
| dimension | string | one of 8 dimension names |
| score | integer | 0..10 |
| remediation | string | required when score < 10 |

### HealthScoreHistory

| Field | Type | Constraints |
|-------|------|-------------|
| timestamp | ISO datetime | required |
| compositeScore | number | 0..10 |
| componentScores | map<string, number> | keys = tool names |

### SecurityScoreHistory

| Field | Type | Constraints |
|-------|------|-------------|
| timestamp | ISO datetime | required |
| gateScore | integer | 0..10 |
| deepScanScore | integer | 0..10 or null |

### ThinkArtifact

| Field | Type | Constraints |
|-------|------|-------------|
| slug | string | non-empty |
| datetime | ISO datetime | required |
| supersedes | string | prior artifact path or null |
| body | markdown | required |

### SpecRecord

| Field | Type | Constraints |
|-------|------|-------------|
| id | string | S-NN |
| sourceIssue | string | GH issue URL or null |
| roadmapFeatureRef | string | F-NN or null |
| status | enum | drafted, roadmapped, in-progress, merged, closed |

### PlanReviewFinding

| Field | Type | Constraints |
|-------|------|-------------|
| reviewer | string | plan-ceo-review, plan-eng-review, plan-design-review, plan-devex-review |
| section | string | reviewer-defined |
| mode | enum | scope-expansion, selective, hold, reduction |
| confidence | integer | 1..10 |
| body | markdown | required |

### DevExPrediction / DevExAudit

| Field | Type | Constraints |
|-------|------|-------------|
| predictedTTHW | number | minutes; nullable in audit until run |
| measuredTTHW | number | minutes; audit only |
| passes | list<string> | 8 pass names |

### VisualFinding

| Field | Type | Constraints |
|-------|------|-------------|
| category | string | includes "ai-slop" as first-class value |
| severity | enum | blocking, warning, info |
| screenshotRef | string | path to captured PNG |
| aiSlopFlags | list<string> | signal names when category=ai-slop |

### LlmTrustFinding

| Field | Type | Constraints |
|-------|------|-------------|
| checkClass | enum | prompt-injection, tool-result-reinject, mcp-trust, unvalidated-agent-output |
| sink | string | code location |
| source | string | data source location |
| confidence | integer | 1..10 |

### CrossVendorReviewer

| Field | Type | Constraints |
|-------|------|-------------|
| vendor | enum | codex, gemini, other |
| costCap | number | USD per review |
| findings | list<AgentResultFinding> | vendor-attributed |

### DocSyncReport

| Field | Type | Constraints |
|-------|------|-------------|
| missingReadme | list<string> | doc gap descriptors |
| staleDiagrams | list<string> | diagram paths |
| changelogSellTest | string | pass/fail + notes |

### SkillifyArtifact

| Field | Type | Constraints |
|-------|------|-------------|
| scriptPath | string | required |
| testPath | string | required |
| fixturePath | string | required |

### QaRunReport

| Field | Type | Constraints |
|-------|------|-------------|
| tier | enum | quick, standard, exhaustive |
| iterations | integer | >= 1 |
| shipReadiness | enum | ready, not-ready |

### DesignConsultation / DesignHtmlOutput / VariantPreference

| Field | Type | Constraints |
|-------|------|-------------|
| aesthetic | string | consultation only |
| typography | string | consultation only |
| color | string | consultation only |
| motion | string | consultation only |
| mockupRef | string | html only |
| htmlPath | string | html only |
| cssPath | string | html only |
| variantId | string | preference only |
| capturedAt | ISO datetime | preference only |
| decayWeight | number | preference only, 0..1 |

### ModelBenchmarkRun / PerfBenchmarkRun / DocQuadrant / DiagramTriplet

| Field | Type | Constraints |
|-------|------|-------------|
| vendor | string | benchmark-models only |
| latency | number | ms |
| tokens | integer | total |
| cost | number | USD |
| judgeScore | number | 0..10 |
| prRef | string | perf-benchmark only |
| lcp | number | ms; perf only |
| cls | number | 0..1; perf only |
| inp | number | ms; perf only |
| quadrant | enum | tutorial, how-to, reference, explanation |
| path | string | quadrant file path |
| voice | string | quadrant style constraint |
| excalidrawPath | string | diagram only |
| svgPath | string | diagram only |
| pngPath | string | diagram only |

### LoomShipConfig

| Field | Type | Constraints |
|-------|------|-------------|
| deployTarget | enum | vercel, fly, render, cloudflare, netlify, railway, unknown |
| versionSlot | string | reserved slot id or null |
| healthChecks | list<string> | endpoint URLs |

**Cascade Behavior:** read-only against deploy-target native config files per C-06.

### BrowserState / BrowserCookies

| Field | Type | Constraints |
|-------|------|-------------|
| sessionId | string | uuid |
| pid | integer | daemon process id |
| startedAt | ISO datetime | required |
| tabRefs | list<string> | accessibility-tree refs |
| domain | string | cookies only |
| cookies | list<object> | cookies only |
| importedAt | ISO datetime | cookies only |
| expiries | map<string, ISO datetime> | cookies only |

### InstallManifest

| Field | Type | Constraints |
|-------|------|-------------|
| createdAt | ISO datetime | required |
| symlinks | list<object> | {target, source} pairs |
| host | enum | claude, hermes, openclaw, codex |

### LeaseRegistry

| Field | Type | Constraints |
|-------|------|-------------|
| repo | string | required |
| worktree | string | required |
| ownedPaths | list<string> | glob patterns |
| acquiredAt | ISO datetime | required |

### RetrospectiveArtifact

| Field | Type | Constraints |
|-------|------|-------------|
| date | ISO date | required |
| windowStart | ISO date | required |
| windowEnd | ISO date | required |
| insights | list<string> | required |
| body | markdown | required |

## API Specification

This is a Loom-tooling plan, not a product plan. Hooks and CLI commands are the primary interfaces; no HTTP endpoints ship in this initiative. Per authoring instructions (Constraint 10), API-Specification section is intentionally minimal.

### hook /loom-careful (PreToolUse)

**Description:** Blocks destructive commands unless override present.
**Auth:** none (local hook).
**Input:** Claude Code PreToolUse JSON per hook protocol (tool name, tool input).
**Behavior notes:**
- Match against blocklist: `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`.
- Read override list from `~/.claude/settings.json` `loom.careful.allow[]`.
- Exit non-zero (block) when blocked; exit 0 when allowed.

### CLI bin/loom-install

**Description:** Direct-symlink installer.
**Behavior notes:**
- `--link <target>` creates symlinks from `<target>` into the Loom source tree.
- `--unlink <target>` removes prior symlinks using the install manifest.
- `--host <name>` scopes to alternate hosts (claude, hermes, openclaw, codex).
- Writes/updates `~/.loom/install-manifest.toon`.

## State Machines

Only two entities in this plan carry a lifecycle field with more than trivial transitions. Everything else is append-only or single-state.

### SpecRecord.status

```
drafted --> roadmapped --> in-progress --> merged --> closed
   |             |               |
   +-------------+---------------+---> closed (abandoned)
```

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| drafted | `/loom-spec` produced a spec block, not yet in ROADMAP | initial |
| roadmapped | `/loom-spec` mutated ROADMAP.md and/or opened GH issue | promotion by user |
| in-progress | worktree agent spawned or PR open | spawn or PR link |
| merged | linked PR merged | PR merge event |
| closed | source GH issue closed | auto via `/loom-git pr` linkage |

**Valid transitions:** drafted -> roadmapped -> in-progress -> merged -> closed; any state -> closed (abandon).
**Invalid transitions:** merged -> drafted (error: SPEC_ALREADY_MERGED); closed -> anything (error: SPEC_CLOSED).

### BrowserState (daemon lifecycle)

```
stopped --> starting --> running --> stopping --> stopped
                            |
                            +--> crashed --> stopped
```

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| stopped | no daemon process | initial or after stop |
| starting | `/loom-browser start` invoked | user command |
| running | daemon healthy, `state.toon` written | health probe pass |
| stopping | `/loom-browser stop` invoked | user command |
| crashed | daemon process exit without stop | pid missing but state.toon still on disk |

**Valid transitions:** stopped -> starting -> running -> stopping -> stopped; running -> crashed -> stopped.
**Invalid transitions:** running -> starting (error: BROWSER_ALREADY_RUNNING).

## Error Handling Specification

Loom's existing AgentResult envelope carries `blockingIssues[]` with `severity` and `code`. This initiative introduces the following new error codes:

| Code | Severity | When |
|------|----------|------|
| FINDING_MISSING_CONFIDENCE | blocking | AgentResult validator sees a finding without `confidence` (F-02). |
| DECISION_UNCLASSIFIED | warning | Auto-flow agent emits a decision without `decisionClass` (F-03). |
| LEARNINGS_SCHEMA_INVALID | blocking | `.loom/learnings.toon` fails parse against schema (F-05). |
| REGRESSIONS_SCHEMA_INVALID | blocking | `.loom/regressions.toon` fails parse against schema (F-05). |
| CAREFUL_BLOCKED | blocking | Destructive command blocked by `/loom-careful` hook (F-06). |
| HEALTH_TOOL_MISSING | warning | Health composite skips a component tool not installed (F-07). |
| SPEC_ALREADY_MERGED / SPEC_CLOSED | blocking | Invalid SpecRecord transition (F-09). |
| BROWSER_ALREADY_RUNNING | blocking | Daemon start attempted while pid exists (F-33). |
| BROWSER_INJECTION_BLOCKED | blocking | Prompt-injection defense fired (F-33). |
| SHIP_DRIFT_DETECTED | blocking | `/loom-ship` drift check fails (F-30). |
| CANARY_HEALTH_GATE_FAIL | blocking | `/loom-canary` gate failed, triggers rollback (F-31). |
| DEPLOY_TARGET_UNKNOWN | warning | `/loom-setup:deploy` cannot detect any known target (F-32). |
| INSTALL_MANIFEST_INVALID | blocking | Install manifest parse failure on `--unlink` (F-35). |

Errors surface via AgentResult `blockingIssues[]` or hook stderr + non-zero exit as appropriate to the resource type.

## Execution Phases

### Phase 0 - Wave 0: Contract Emission

**Agent:** contracts-agent
**Objective:** Emit all shared TOON schemas and the agent-result extension consumed by every downstream milestone phase.
**Dependencies:** None
**File Ownership:** protocols/loom-decision-principles.md, protocols/agent-result.schema.md, protocols/learnings.schema.toon, protocols/regressions.schema.toon, protocols/loom-ship-config.schema.toon, protocols/browser-state.schema.toon, protocols/install-manifest.schema.toon, protocols/retrospective-artifact.schema.toon

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/loom-decision-principles.md | Create | contracts-agent |
| protocols/agent-result.schema.md | Modify | contracts-agent |
| protocols/learnings.schema.toon | Create | contracts-agent |
| protocols/regressions.schema.toon | Create | contracts-agent |
| protocols/loom-ship-config.schema.toon | Create | contracts-agent |
| protocols/browser-state.schema.toon | Create | contracts-agent |
| protocols/install-manifest.schema.toon | Create | contracts-agent |
| protocols/retrospective-artifact.schema.toon | Create | contracts-agent |

#### Acceptance Criteria
- [ ] Every listed protocol file exists at its declared path.
- [ ] `protocols/agent-result.schema.md` documents the `confidence: 1..10` field on every finding entry.
- [ ] Each `.schema.toon` file parses as valid TOON.

#### Scenarios

```toon
id: S-01
title: Contracts wave emits all 8 protocol files
given[1]: Wave 0 has completed
when: The verification-agent enumerates protocols/
whenTriggerType: system-event
then[2]: The 8 listed protocol files MUST exist, protocols/agent-result.schema.md MUST document the confidence field
tags[1]: happy-path
automatable: true
```

---

### Phase 1 - Wave 1: M-01 Judgment Layer

**Agent:** implementer-agent
**Objective:** Ship confidence-calibrated findings, decision principles enforcement, 0-10 rubrics, learnings + regressions infrastructure, and the retrospective ceremony command.
**Dependencies:** Phase 0
**File Ownership:** hooks/agent-result-validator.ts, protocols/roadmap-rubrics/**, commands/loom-retro.md, agents/retrospective-agent.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/agent-result-validator.ts | Modify | implementer-1 |
| protocols/roadmap-rubrics/completeness.md | Modify | implementer-1 |
| protocols/roadmap-rubrics/scope.md | Modify | implementer-1 |
| protocols/roadmap-rubrics/*.md (remaining 6 dims) | Modify | implementer-1 |
| commands/loom-retro.md | Create | implementer-2 |
| agents/retrospective-agent.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `hooks/agent-result-validator.ts` rejects AgentResult envelopes with a finding missing `confidence`.
- [ ] All 8 rubric files under `protocols/roadmap-rubrics/` emit a 0-10 score plus remediation text per schema.
- [ ] `commands/loom-retro.md` and `agents/retrospective-agent.md` exist with valid frontmatter and are registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-02
title: Finding without confidence is rejected
given[1]: agent-result-validator.ts is installed
when: An AgentResult envelope with a finding missing confidence is validated
whenTriggerType: system-event
then[1]: The validator MUST exit non-zero with code FINDING_MISSING_CONFIDENCE
tags[1]: error
testTier: unit
automatable: true
```

```toon
id: S-03
title: /loom-retro writes dated artifact and appends learning
given[1]: A developer completes the retro interview
when: /loom-retro finishes
whenTriggerType: actor-action
then[2]: A file MUST exist at .loom/retros/{date}.md, .loom/learnings.toon MUST have at least one appended entry
tags[1]: happy-path
automatable: true
```

---

### Phase 2 - Wave 2: M-02 Safety + Observability

**Agent:** implementer-agent
**Objective:** Ship destructive-command PreToolUse guard and the `/loom-health` composite score command with trend persistence.
**Dependencies:** Phase 0
**File Ownership:** hooks/loom-careful.ts, commands/loom-careful.md, commands/loom-health.md, scripts/loom-health.ts, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| hooks/loom-careful.ts | Create | implementer-1 |
| commands/loom-careful.md | Create | implementer-1 |
| commands/loom-health.md | Create | implementer-2 |
| scripts/loom-health.ts | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `hooks/loom-careful.ts` returns non-zero exit code for a `rm -rf` invocation without override.
- [ ] `scripts/loom-health.ts` writes a HealthScoreHistory entry to a Loom-scoped TOON file.
- [ ] Both commands and the hook are registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-careful blocks rm -rf without override
given[1]: The hook is installed
when: A tool invocation for rm -rf is intercepted
whenTriggerType: system-event
then[1]: The hook MUST exit non-zero with error code CAREFUL_BLOCKED
tags[1]: happy-path
testTier: unit
automatable: true
```

```toon
id: S-02
title: /loom-health writes composite score to history
given[1]: The repo has tsc and vitest configured
when: /loom-health runs
whenTriggerType: actor-action
then[2]: Output MUST include a composite 0-10 score, A new entry MUST be appended to the health history TOON file
tags[1]: happy-path
automatable: true
```

---

### Phase 3 - Wave 3: M-03 Think + Spec Flow

**Agent:** implementer-agent
**Objective:** Ship `/loom-think` (5-phase interview) and `/loom-spec` (idea-to-issue-to-work loop) with output artifacts consumed by `/loom-roadmap init`.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-think.md, commands/loom-spec.md, agents/think-interviewer-agent.md, agents/spec-drafter-agent.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-think.md | Create | implementer-1 |
| agents/think-interviewer-agent.md | Create | implementer-1 |
| commands/loom-spec.md | Create | implementer-2 |
| agents/spec-drafter-agent.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `commands/loom-think.md` frontmatter names the 5 phases; `/loom-roadmap init --from` accepts a think artifact path (documented in prompt body).
- [ ] `commands/loom-spec.md` documents a schema-conforming ROADMAP feature block as its output shape.
- [ ] All 4 files registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-think writes a Supersedes-tagged artifact
given[1]: A developer completes the 5-phase interview
when: /loom-think finishes
whenTriggerType: actor-action
then[2]: A file MUST exist at .loom/thinks/{slug}-{datetime}.md, The frontmatter MUST include Supersedes
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-spec produces roadmap-schema-conforming block
given[1]: A vague idea sentence is provided
when: /loom-spec runs with that idea
whenTriggerType: actor-action
then[1]: The output MUST include a Feature block that passes roadmap.schema.md structural validation
tags[1]: happy-path
automatable: true
```

---

### Phase 4 - Wave 4: M-04 Planning Reviewers

**Agent:** implementer-agent
**Objective:** Ship 4 plan-review agents (ceo, eng-upgrade, design, devex) that plug into the existing plan-review parallel fan-out.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** agents/plan-ceo-review.md, agents/plan-eng-review.md, agents/plan-design-review.md, agents/plan-devex-review.md, protocols/dx-hall-of-fame.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/plan-ceo-review.md | Create | implementer-1 |
| agents/plan-eng-review.md | Create | implementer-1 |
| agents/plan-design-review.md | Create | implementer-2 |
| agents/plan-devex-review.md | Create | implementer-2 |
| protocols/dx-hall-of-fame.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `agents/plan-ceo-review.md` documents 11 review sections and 4 modes in its system prompt.
- [ ] `agents/plan-eng-review.md` preamble reads from `.loom/regressions.toon` and includes anti-skip clauses.
- [ ] `agents/plan-design-review.md` documents 7 passes; `agents/plan-devex-review.md` documents 8 passes and emits a `predictedTTHW` field.
- [ ] All 4 reviewers registered in `skills/library.yaml` under the plan-review kit.

#### Scenarios

```toon
id: S-01
title: plan-ceo-review declares all 11 sections and a mode
given[1]: A plan is submitted for review
when: plan-ceo-review completes
whenTriggerType: system-event
then[2]: Output MUST contain 11 named sections, Output MUST declare exactly one of the 4 modes
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: plan-eng-review preamble cites a regression by name
given[1]: .loom/regressions.toon contains at least one entry
when: plan-eng-review runs
whenTriggerType: system-event
then[1]: The preamble MUST include a Known Failure Modes section citing at least one regression by name
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: plan-devex-review emits a numeric predictedTTHW
given[1]: A plan describing a CLI is submitted
when: plan-devex-review completes
whenTriggerType: system-event
then[1]: Output MUST include a numeric predictedTTHW field
tags[1]: happy-path
automatable: true
```

---

### Phase 5 - Wave 5: M-05 Code Review Lenses

**Agent:** implementer-agent
**Objective:** Ship visual QA, LLM trust-boundary category, and cross-vendor review contributions into the existing `/loom-code review` envelope.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-code/design-review.md, agents/design-review-agent.md, commands/loom-code/codex.md, agents/cross-vendor-reviewer.md, protocols/llm-trust-rubric.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-code/design-review.md | Create | implementer-1 |
| agents/design-review-agent.md | Create | implementer-1 |
| protocols/llm-trust-rubric.md | Create | implementer-2 |
| commands/loom-code/codex.md | Create | implementer-2 |
| agents/cross-vendor-reviewer.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `agents/design-review-agent.md` documents an `ai-slop` finding category and wraps chrome-devtools MCP.
- [ ] `protocols/llm-trust-rubric.md` enumerates the 4 llm-trust check classes and is referenced by the code reviewer prompt.
- [ ] `agents/cross-vendor-reviewer.md` documents vendor config surface and cost cap.
- [ ] All 5 files registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: Design review flags AI slop as first-class category
given[1]: A rendered UI contains default shadcn palette + excessive gradients
when: /loom-code:design-review runs
whenTriggerType: actor-action
then[1]: At least one finding MUST have category ai-slop
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: Reviewer flags unsanitized input flowing into prompt
given[1]: A diff concatenates req.body.text into a prompt template
when: /loom-code:review runs on the diff
whenTriggerType: actor-action
then[1]: At least one finding MUST have findingCategory llm-trust
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: Cross-vendor reviewer contributes findings alongside Claude
given[1]: /loom-code:codex is configured with a non-Claude vendor
when: /loom-code review runs
whenTriggerType: actor-action
then[1]: The consolidated review output MUST include at least one vendor-attributed finding
tags[1]: happy-path
automatable: true
```

---

### Phase 6 - Wave 6: M-06 Docs + Skillify

**Agent:** implementer-agent
**Objective:** Ship `/loom-docs:release` (diff-driven doc sync) and `/loom-skillify` (retrospective codification into script + test + fixture).
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-docs/release.md, agents/doc-sync-agent.md, commands/loom-skillify.md, agents/skillify-agent.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-docs/release.md | Create | implementer-1 |
| agents/doc-sync-agent.md | Create | implementer-1 |
| commands/loom-skillify.md | Create | implementer-2 |
| agents/skillify-agent.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `commands/loom-docs/release.md` documents non-zero exit when doc-debt detected without a plan.
- [ ] `agents/skillify-agent.md` documents writing `script.ts`, `test.ts`, and a fixture, and running vitest before commit.
- [ ] All 4 files registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-docs:release surfaces README gap
given[1]: A PR adds a CLI flag not in README
when: /loom-docs:release runs against the PR
whenTriggerType: actor-action
then[1]: The output MUST include a finding naming the missing README entry
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-skillify writes a passing test
given[1]: A successful transcript slice is designated
when: /loom-skillify runs
whenTriggerType: actor-action
then[2]: A test.ts MUST be written under the target skill directory, Vitest against the new test MUST exit 0
tags[1]: happy-path
automatable: true
```

---

### Phase 7 - Wave 7: M-11 Browser Infrastructure

**Agent:** implementer-agent
**Objective:** Ship the persistent Chromium daemon (`/loom-browser`) and cookie import (`/loom-setup:browser-cookies`) that M-07 and M-13 build on. Placed before M-07 per roadmap dependency (M-07 depends on M-11).
**Dependencies:** Phase 0
**File Ownership:** commands/loom-browser.md, agents/browser-daemon-agent.md, scripts/loom-browser.ts, commands/loom-setup/browser-cookies.md, scripts/browser-cookie-import.ts, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-browser.md | Create | implementer-1 |
| agents/browser-daemon-agent.md | Create | implementer-1 |
| scripts/loom-browser.ts | Create | implementer-1 |
| commands/loom-setup/browser-cookies.md | Create | implementer-2 |
| scripts/browser-cookie-import.ts | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `scripts/loom-browser.ts` writes `.loom/browser/state.toon` on `start` per protocols/browser-state.schema.toon.
- [ ] `commands/loom-browser.md` documents READ / WRITE / META tiered command semantics and prompt-injection defense hooks.
- [ ] `scripts/browser-cookie-import.ts` writes per-domain files at `.loom/browser/cookies/{domain}.toon` with expiry.
- [ ] All 5 files registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-browser start writes state.toon
given[1]: No daemon is running
when: /loom-browser start runs
whenTriggerType: actor-action
then[2]: A Chromium process MUST be running, .loom/browser/state.toon MUST be written with the session id
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: cookie import writes per-domain file with expiry
given[1]: The developer has cookies for example.com in local Chrome
when: /loom-setup:browser-cookies runs and example.com is selected
whenTriggerType: actor-action
then[2]: .loom/browser/cookies/example.com.toon MUST be written, The file MUST include an expiry per cookie
tags[1]: happy-path
automatable: true
```

---

### Phase 8 - Wave 8: M-07 Build-time QA

**Agent:** implementer-agent
**Objective:** Ship `/loom-devex:review` (live DX audit), `/loom-cso` (two-tier security review), and `/loom-qa` (live-site iterative test-fix). All three consume the M-11 browser daemon.
**Dependencies:** Phase 0, Phase 4, Phase 7
**File Ownership:** commands/loom-devex/review.md, agents/devex-audit-agent.md, commands/loom-cso.md, agents/cso-agent.md, scripts/loom-cso.ts, commands/loom-qa.md, agents/qa-agent.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-devex/review.md | Create | implementer-1 |
| agents/devex-audit-agent.md | Create | implementer-1 |
| commands/loom-cso.md | Create | implementer-2 |
| agents/cso-agent.md | Create | implementer-2 |
| scripts/loom-cso.ts | Create | implementer-2 |
| commands/loom-qa.md | Create | implementer-3 |
| agents/qa-agent.md | Create | implementer-3 |
| skills/library.yaml | Modify | implementer-3 |

#### Acceptance Criteria
- [ ] `agents/devex-audit-agent.md` documents emission of both `predictedTTHW` and `measuredTTHW` fields.
- [ ] `scripts/loom-cso.ts` exits non-zero when a fast-gate score is lower than the most recent history entry.
- [ ] `agents/qa-agent.md` documents Quick / Standard / Exhaustive tiers and emits `shipReadiness` in output.
- [ ] All 7 new resources registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: Live audit reports predicted vs measured TTHW
given[1]: Plan-time predictedTTHW is 3 minutes
when: /loom-devex:review completes a live run
whenTriggerType: actor-action
then[1]: Output MUST include predictedTTHW and measuredTTHW fields with numeric values
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-cso fast gate blocks PR when score regresses
given[1]: Stored score history has most-recent score of 8/10
when: The fast gate runs on a PR scoring 6/10
whenTriggerType: actor-action
then[1]: The gate MUST exit non-zero
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-qa emits ship-readiness verdict
given[1]: A live site URL is provided
when: /loom-qa runs at Quick tier
whenTriggerType: actor-action
then[1]: Output MUST include a shipReadiness field valued ready or not-ready
tags[1]: happy-path
automatable: true
```

---

### Phase 9 - Wave 9: M-08 Instrumentation Nice-to-haves

**Agent:** implementer-agent
**Objective:** Ship benchmark-models, learn management UI, perf benchmark, Diataxis doc generation, and diagram triplet commands.
**Dependencies:** Phase 0, Phase 1, Phase 5, Phase 7
**File Ownership:** commands/loom-benchmark-models.md, commands/loom-learn.md, commands/loom-benchmark.md, commands/loom-docs/generate.md, commands/loom-diagram.md, agents/benchmark-models-agent.md, agents/perf-benchmark-agent.md, agents/diagram-agent.md, scripts/loom-learn.ts, scripts/loom-docs-generate.ts, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-benchmark-models.md | Create | implementer-1 |
| agents/benchmark-models-agent.md | Create | implementer-1 |
| commands/loom-learn.md | Create | implementer-1 |
| scripts/loom-learn.ts | Create | implementer-1 |
| commands/loom-benchmark.md | Create | implementer-2 |
| agents/perf-benchmark-agent.md | Create | implementer-2 |
| commands/loom-docs/generate.md | Create | implementer-2 |
| scripts/loom-docs-generate.ts | Create | implementer-2 |
| commands/loom-diagram.md | Create | implementer-2 |
| agents/diagram-agent.md | Create | implementer-2 |
| skills/library.yaml | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] `agents/benchmark-models-agent.md` documents dashboard columns for latency, tokens, and cost per vendor.
- [ ] `scripts/loom-learn.ts` supports `search`, `prune`, and `export` subcommands over `.loom/learnings.toon`.
- [ ] `agents/perf-benchmark-agent.md` documents LCP / CLS / INP emission; `scripts/loom-docs-generate.ts` writes 4 quadrant files.
- [ ] All 11 new resources registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: benchmark-models emits cost/latency/tokens per vendor
given[1]: A benchmark prompt and target vendors are configured
when: /loom-benchmark-models completes
whenTriggerType: actor-action
then[1]: The dashboard MUST include cost, latency, and token columns per vendor
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-learn search returns matching learning
given[1]: An entry matching "duplicate scenario" exists in .loom/learnings.toon
when: /loom-learn search "duplicate scenario" runs
whenTriggerType: actor-action
then[1]: The result MUST include the matching entry
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-docs:generate emits all 4 Diataxis quadrants
given[1]: A repo with no docs directory
when: /loom-docs:generate runs
whenTriggerType: actor-action
then[1]: 4 doc files MUST be emitted, one per quadrant
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-diagram emits triplet
given[1]: A mermaid diagram source is provided
when: /loom-diagram runs
whenTriggerType: actor-action
then[1]: The output directory MUST contain .excalidraw, .svg, and .png files with the same base name
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-benchmark emits Core Web Vitals for PR
given[1]: A baseline run exists
when: /loom-benchmark runs on a PR
whenTriggerType: actor-action
then[1]: Output MUST include LCP, CLS, and INP values for the PR head
tags[1]: happy-path
automatable: true
```

---

### Phase 10 - Wave 10: M-09 Fan-in Coordination

**Agent:** implementer-agent
**Objective:** Ship `/loom-git pr preflight` with cross-worktree ownership scan and auto-rebase. Full lease registry + merge queue may follow.
**Dependencies:** Phase 0
**File Ownership:** commands/loom-git/pr-preflight.md, agents/pr-preflight-agent.md, scripts/lease-registry.ts, protocols/lease-registry.schema.toon, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/lease-registry.schema.toon | Create | implementer-1 |
| scripts/lease-registry.ts | Create | implementer-1 |
| commands/loom-git/pr-preflight.md | Create | implementer-1 |
| agents/pr-preflight-agent.md | Create | implementer-1 |
| skills/library.yaml | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] `scripts/lease-registry.ts` writes `~/.loom/leases/{repo}.toon` with `ownedPaths` per worktree.
- [ ] `commands/loom-git/pr-preflight.md` documents non-zero exit on ownership-overlap finding.
- [ ] Resources registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: preflight warns on sibling ownership overlap
given[2]: A lease declares worktree A owns src/auth/*, Worktree B staged changes to src/auth/session.ts
when: /loom-git pr preflight runs from worktree B
whenTriggerType: actor-action
then[2]: The preflight MUST report ownership-overlap citing worktree A, The command MUST exit non-zero
tags[1]: happy-path
automatable: true
```

---

### Phase 11 - Wave 11: M-10 Ship Engineer

**Agent:** implementer-agent
**Objective:** Ship `/loom-ship`, `/loom-canary`, `/loom-landing-report`, and `/loom-setup:deploy` (deploy-target detection). Deploy detection is read-only per C-06.
**Dependencies:** Phase 0, Phase 1
**File Ownership:** commands/loom-ship.md, agents/ship-agent.md, commands/loom-canary.md, commands/loom-landing-report.md, agents/canary-agent.md, commands/loom-setup/deploy.md, agents/deploy-detector-agent.md, scripts/loom-ship.ts, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-ship.md | Create | implementer-1 |
| agents/ship-agent.md | Create | implementer-1 |
| scripts/loom-ship.ts | Create | implementer-1 |
| commands/loom-canary.md | Create | implementer-2 |
| commands/loom-landing-report.md | Create | implementer-2 |
| agents/canary-agent.md | Create | implementer-2 |
| commands/loom-setup/deploy.md | Create | implementer-3 |
| agents/deploy-detector-agent.md | Create | implementer-3 |
| skills/library.yaml | Modify | implementer-3 |

#### Acceptance Criteria
- [ ] `scripts/loom-ship.ts` writes a VERSION slot reservation and generates a PR body including a plan-completion audit section.
- [ ] `agents/canary-agent.md` documents rollback trigger on health-check gate failure.
- [ ] `agents/deploy-detector-agent.md` documents CLAUDE.md hint write and asserts no mutation of native deploy config files per C-06.
- [ ] All 8 new resources registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-ship reserves VERSION slot and emits PR body
given[1]: Branch is up to date with main and pre-flight passes
when: /loom-ship runs
whenTriggerType: actor-action
then[2]: A VERSION slot MUST be reserved, The PR body MUST include a plan-completion audit section
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-canary passes health gates
given[1]: A canary target is configured and health checks pass
when: /loom-canary runs
whenTriggerType: actor-action
then[2]: Deploy MUST progress through all configured stages, Command MUST exit 0 with a landing summary
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-setup:deploy detects Vercel
given[1]: Repo contains vercel.json and Next.js scripts
when: /loom-setup:deploy runs
whenTriggerType: actor-action
then[2]: CLAUDE.md MUST include a deploy-target section naming Vercel, vercel.json MUST NOT be modified
tags[1]: happy-path
automatable: true
```

---

### Phase 12 - Wave 12: M-12 Distribution

**Agent:** implementer-agent
**Objective:** Ship direct-symlink install via `bin/loom-install --link` with cross-host support.
**Dependencies:** Phase 0
**File Ownership:** bin/loom-install, scripts/loom-install.ts, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| bin/loom-install | Create | implementer-1 |
| scripts/loom-install.ts | Create | implementer-1 |
| skills/library.yaml | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] `bin/loom-install --link ~/.claude/skills/loom` creates symlinks and writes an install manifest per `protocols/install-manifest.schema.toon`.
- [ ] `--host <name>` accepts claude, hermes, openclaw, codex.
- [ ] `--unlink` uses the install manifest to reverse symlinks.

#### Scenarios

```toon
id: S-01
title: bin/loom-install --link creates symlinks and manifest
given[1]: Loom source tree is checked out locally
when: bin/loom-install --link ~/.claude/skills/loom runs
whenTriggerType: actor-action
then[2]: ~/.claude/skills/loom MUST contain symlinks pointing into the source tree, The install manifest MUST record every created symlink
tags[1]: happy-path
automatable: true
```

---

### Phase 13 - Wave 13: M-13 Build-time Design

**Agent:** implementer-agent
**Objective:** Ship `/loom-design:consultation`, `/loom-design:html`, and `/loom-design:shotgun`. Design commands consume the M-11 browser daemon.
**Dependencies:** Phase 0, Phase 4, Phase 7
**File Ownership:** commands/loom-design/consultation.md, commands/loom-design/html.md, commands/loom-design/shotgun.md, agents/design-consultation-agent.md, agents/design-html-agent.md, agents/design-shotgun-agent.md, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-design/consultation.md | Create | implementer-1 |
| agents/design-consultation-agent.md | Create | implementer-1 |
| commands/loom-design/html.md | Create | implementer-2 |
| agents/design-html-agent.md | Create | implementer-2 |
| commands/loom-design/shotgun.md | Create | implementer-3 |
| agents/design-shotgun-agent.md | Create | implementer-3 |
| skills/library.yaml | Modify | implementer-3 |

#### Acceptance Criteria
- [ ] `agents/design-consultation-agent.md` documents writing a design premise artifact to a Loom-scoped location.
- [ ] `agents/design-html-agent.md` documents emitting HTML that parses without structural errors from an approved mockup.
- [ ] `agents/design-shotgun-agent.md` documents `capturedAt` timestamps on preference records and time-decay of old preferences.
- [ ] All 6 resources registered in `skills/library.yaml`.

#### Scenarios

```toon
id: S-01
title: /loom-design:consultation writes premise artifact
given[1]: Developer completes the consultation interview
when: The command finishes
whenTriggerType: actor-action
then[1]: A design premise markdown file MUST be written to the Loom design directory
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-design:html emits valid HTML
given[1]: An approved mockup file is provided
when: /loom-design:html runs
whenTriggerType: actor-action
then[1]: The emitted HTML MUST parse without structural errors
tags[1]: happy-path
automatable: true
```

```toon
id: S-01
title: /loom-design:shotgun records preference with timestamp
given[1]: N variants are rendered side by side
when: A user selects a preferred variant
whenTriggerType: actor-action
then[1]: A preference record MUST be written with a capturedAt timestamp
tags[1]: happy-path
automatable: true
```

---

## Verification Commands

```bash
# Structure: every declared protocol file exists
ls protocols/loom-decision-principles.md protocols/learnings.schema.toon protocols/regressions.schema.toon protocols/loom-ship-config.schema.toon protocols/browser-state.schema.toon protocols/install-manifest.schema.toon protocols/retrospective-artifact.schema.toon protocols/lease-registry.schema.toon

# Frontmatter validity across new agents and commands
bunx tsx scripts/validate-frontmatter.ts agents/ commands/

# TOON schema files parse
bunx tsx scripts/validate-toon.ts protocols/

# Library registration coverage
bunx tsx scripts/validate-library-registration.ts skills/library.yaml

# Type + lint gates for new hooks and scripts
bunx tsc --noEmit
bunx vitest run
```

## Success Metrics

Per **C-03** and **Q-04** (locked): no quantitative success metrics are defined for this initiative. Adoption is assessed qualitatively via user uptake of ported skills. This section is a placeholder to satisfy the schema; the sign-off gate treats the success-metrics dimension as an accepted red exception.

## Risks & Mitigations

Inherited from `planning/ROADMAP-gstack-adoption.md` § Risks & Mitigations. This plan adds no new risks; the roadmap's mitigations apply unchanged.

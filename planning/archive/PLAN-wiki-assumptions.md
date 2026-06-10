---
planVersion: 1
name: "Wiki Assumption Layer (Bohm-Inspired)"
status: approved
created: 2026-04-17
lastReviewed: null
roadmapRef: null
totalPhases: 5
totalWaves: 3
---

# Plan: Wiki Assumption Layer (Bohm-Inspired)

## Overview

Adds an assumption-surfacing layer to the Loom wiki, inspired by David Bohm's "Thought as a System." The core insight: most agent errors across sessions stem from unstated assumptions — beliefs that feel obvious to the agent that made a decision but are never written down. When a later agent encounters the same domain, it rediscovers (or contradicts) those assumptions without knowing they existed.

This plan adds one new page type (`assumption-*.md`), two new metadata fields on existing decision pages (`assumptions[]`, `influencedDecisions[]`), two new lint rules, and updates to the wiki-maintainer-agent to detect and surface assumptions from agent behavior.

Scoped to the focused value: assumption surfacing + influence tracking. Excludes full coherence graphs, tendency tracking, and participation feedback loops (these can be revisited if assumptions prove high-value).

## Tech Stack

- **Markdown** for wiki page schema updates and agent definition updates
- **TOON** for frontmatter and lint rule definitions
- **vitest** for test suites

## Schema / Type Definitions

### AssumptionPage

New wiki page type: `assumption-*.md`. Captures implicit beliefs that underlie explicit decisions.

| Field | Type | Constraints |
|-------|------|-------------|
| pageId | string | Format: `assumption-{kebab-case-name}` |
| title | string | Human-readable assumption statement |
| category | string | Always `assumption` |
| status | string | One of: `active`, `challenged`, `retired` |
| confidence | string | One of: `high`, `medium`, `low` |
| origin | string | pageId of the decision or execution-record that surfaced this |
| impliedBy | string[] | pageIds of decisions that depend on this assumption |
| challengeConditions | string[] | Conditions that would invalidate this assumption |
| lastValidated | string | ISO 8601 — when an agent or human last confirmed this still holds |
| lastValidatedBy | string | Who validated: `human`, agent name, or `unvalidated` |
| lastValidatedEvidence | string | What evidence supported validation (e.g., "codebase scan", "user confirmed") |
| challengedAt | string | ISO 8601 — when status was set to `challenged` (null if never challenged) |
| challengedBy | string | Who challenged: `human`, agent name, lint rule ID |

Standard wiki page frontmatter fields (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `sourceRefs`, `crossRefs`, `tags`, `staleness`, `domain`) also apply per `wiki-page.schema.md`.

TOON frontmatter example:

```toon
pageId: assumption-low-auth-throughput
title: Authentication throughput is under 1000 req/sec
category: assumption
domain: code
status: active
confidence: medium
origin: decision-auth-bcrypt
impliedBy[2]: decision-auth-bcrypt,decision-session-storage
challengeConditions[2]:
  Traffic monitoring shows sustained >1000 auth req/sec
  Load testing reveals bcrypt latency as bottleneck
lastValidated: 2026-04-17T10:00:00Z
lastValidatedBy: wiki-maintainer-agent
lastValidatedEvidence: codebase scan — bcrypt usage confirmed in src/auth/middleware.ts
challengedAt: null
challengedBy: null
createdAt: 2026-04-17T10:00:00Z
updatedAt: 2026-04-17T10:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
sourceRefs[1]: src/auth/middleware.ts
crossRefs[2]{pageId,relationship}:
  decision-auth-bcrypt,grounds
  component-auth-middleware,constrains
tags[3]: auth, performance, assumption
staleness: fresh
```

### New Cross-Reference Relationships

| Relationship | Meaning | Used Between |
|-------------|---------|--------------|
| `grounds` | This assumption grounds (justifies) the referenced decision | assumption → decision |
| `grounded-by` | Inverse — this decision is grounded by the referenced assumption | decision → assumption |
| `constrains` | This assumption constrains the referenced component's design | assumption → component |
| `constrained-by` | Inverse — this component is constrained by the assumption | component → assumption |

### Decision Page Metadata Extensions

Two new optional fields added to `decision-*.md` frontmatter:

| Field | Type | Description |
|-------|------|-------------|
| `assumptions` | string[] | pageIds of assumption pages this decision rests on |
| `influencedDecisions` | string[] | pageIds of later decisions that cited this decision |

### New Lint Rules

| Rule ID | Severity | Description |
|---------|----------|-------------|
| W-020 | warning | Assumption page has `status: active` but `lastValidated` older than staleness threshold |
| W-021 | info | Decision page has no `assumptions[]` field — may have unstated assumptions |
| W-022 | warning | Assumption `challengeConditions` is empty — assumption cannot self-invalidate |
| W-023 | blocking | Assumption `status` changed to `challenged` but `impliedBy` decisions have not been reviewed since `challengedAt` |

## Execution Phases

### Phase 0 — Wave 0: Schema Contracts

**Agent:** contracts-agent
**Objective:** Update the wiki page schema, conventions, and lint rules to support assumption pages.
**Dependencies:** None
**File Ownership:** agents/protocols/wiki-page.schema.md, agents/protocols/wiki-conventions.md, agents/protocols/wiki-lint-rules.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/protocols/wiki-page.schema.md | Modify | contracts-agent |
| agents/protocols/wiki-conventions.md | Modify | contracts-agent |
| agents/protocols/wiki-lint-rules.md | Modify | contracts-agent |

#### Acceptance Criteria
- [ ] `wiki-page.schema.md` adds `assumption` to the page categories table with prefix `assumption-` and description
- [ ] `wiki-page.schema.md` adds `grounds` / `grounded-by` and `constrains` / `constrained-by` to the cross-reference relationships table
- [ ] `wiki-page.schema.md` documents the assumption-specific frontmatter fields: `status`, `origin`, `impliedBy`, `challengeConditions`, `lastValidated`, `lastValidatedBy`, `lastValidatedEvidence`, `challengedAt`, `challengedBy`
- [ ] `wiki-page.schema.md` documents the optional `assumptions[]` and `influencedDecisions[]` fields on decision pages
- [ ] `wiki-conventions.md` directory structure updated to include `assumption-*.md` in the pages listing
- [ ] `wiki-conventions.md` documents assumption maintenance triggers: when wiki-maintainer should surface assumptions (see Phase 2)
- [ ] `wiki-lint-rules.md` adds rules W-020 through W-023 with severity, check logic, and auto-fix behavior
- [ ] All schema examples use TOON format
- [ ] No breaking changes to existing page types — new fields are additive

### Phase 1 — Wave 1: Wiki-Maintainer Assumption Detection

**Agent:** implementer-agent
**Objective:** Update the wiki-maintainer-agent to detect implicit assumptions from agent behavior and generate assumption candidates for review (not auto-persist).
**Dependencies:** Phase 0
**File Ownership:** agents/wiki-maintainer-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/wiki-maintainer-agent.md | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] Wiki-maintainer adds an "Assumption Detection" section to its approach
- [ ] On `wave-complete` and `review-complete` events, the maintainer scans AgentResult `keyDecisions` for choices that imply unstated constraints
- [ ] Detection heuristic documented: when a decision mentions a specific technology choice, performance target, scale assumption, or security model, extract the implied belief as an assumption candidate
- [ ] For each candidate, the maintainer generates a deterministic identity (normalized proposition hash + origin pageId) and checks if an assumption page already exists. If not, writes the candidate to `.plan-execution/assumption-candidates.toon` as a reviewable proposal — NOT directly to `.loom/wiki/pages/`
- [ ] Assumption candidates are only persisted to wiki after human review or explicit agent approval (e.g., during `/loom-note --assimilate` or `/loom-wiki lint --fix`)
- [ ] `challengeConditions` are generated from the inverse of the assumption — e.g., "chose bcrypt for password hashing" implies assumption "auth throughput is low" with challenge condition "traffic monitoring shows sustained >1000 auth req/sec"
- [ ] This workflow is pinned to sonnet-tier minimum — do not allow downgrade to haiku via the profile system, because assumption inference requires strong reasoning
- [ ] Assumption detection is additive — it never modifies existing assumption pages, only creates new ones or adds cross-refs

### Phase 2 — Wave 1: Wiki-Lint Assumption Rules

**Agent:** implementer-agent
**Objective:** Add the four new lint rules (W-020 through W-023) to the wiki-lint-agent.
**Dependencies:** Phase 0
**File Ownership:** agents/wiki-lint-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/wiki-lint-agent.md | Modify | implementer-2 |

#### Acceptance Criteria
- [ ] W-020 implemented: flags assumption pages where `status == active` and `lastValidated` exceeds the staleness threshold (uses same threshold as W-003)
- [ ] W-021 implemented: flags decision pages with no `assumptions[]` field as info-severity (advisory, not blocking)
- [ ] W-022 implemented: flags assumption pages where `challengeConditions` is empty as warning (assumption cannot self-invalidate)
- [ ] W-023 implemented: flags assumption pages where `status == challenged` and `challengedAt` is set, but none of the `impliedBy` decision pages have been updated after `challengedAt` — uses explicit `challengedAt` timestamp comparison, not generic `updatedAt`
- [ ] All four rules run as part of the existing `wiki` check scope
- [ ] W-020 and W-022 support `fix` mode: W-020 auto-fix sets `status: needs-validation` (does NOT update `lastValidated` — that would forge validation evidence; only a real validation pass with recorded `lastValidatedBy` and `lastValidatedEvidence` may set `lastValidated`), W-022 has no auto-fix (requires human input)
- [ ] W-023 auto-fix: creates a `tech-debt-*` page listing the decisions that need review due to challenged assumption

### Phase 3 — Wave 2: Influence Tracking

**Agent:** implementer-agent
**Objective:** Add `influencedDecisions[]` tracking to the wiki-maintainer so that decision chains are visible — when a later decision cites an earlier one, both pages record the relationship.
**Dependencies:** Phase 1
**File Ownership:** agents/wiki-maintainer-agent.md, agents/wiki-query-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/wiki-maintainer-agent.md | Modify | implementer-1 |
| agents/wiki-query-agent.md | Modify | implementer-1 |

#### Acceptance Criteria
- [ ] Wiki-maintainer detects when a new decision page references an existing decision (by scanning `crossRefs` for `implements`, `supersedes`, or `depends-on` pointing to decision pages)
- [ ] When detected, the referenced decision page's `influencedDecisions[]` is updated to include the new decision's pageId
- [ ] Wiki-query-agent updated: when answering questions about a decision, includes its downstream influence chain (decisions it influenced) and upstream assumption chain (assumptions it rests on)
- [ ] Influence tracking is bidirectional: if decision A influenced decision B, both pages reflect this

### Phase 4 — Wave 2: Tests

**Agent:** implementer-agent
**Objective:** Create vitest tests for assumption page TOON parsing, lint rule logic, and assumption detection heuristics.
**Dependencies:** Phase 0, Phase 2
**File Ownership:** test/wiki/assumption-page.test.ts, test/wiki/assumption-lint.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| test/wiki/assumption-page.test.ts | Create | implementer-2 |
| test/wiki/assumption-lint.test.ts | Create | implementer-2 |

#### Acceptance Criteria
- [ ] `assumption-page.test.ts` tests TOON frontmatter roundtrip for assumption pages: encode/decode preserves all fields including assumption-specific ones (`status`, `origin`, `impliedBy`, `challengeConditions`, `lastValidated`)
- [ ] `assumption-page.test.ts` validates required fields: missing `status`, `origin`, or `challengeConditions` produces validation errors
- [ ] `assumption-page.test.ts` validates status enum: only `active`, `challenged`, `retired` are accepted
- [ ] `assumption-lint.test.ts` tests W-020: active assumption with stale `lastValidated` is flagged
- [ ] `assumption-lint.test.ts` tests W-021: decision page without `assumptions[]` is flagged as info
- [ ] `assumption-lint.test.ts` tests W-022: assumption with empty `challengeConditions` is flagged as warning
- [ ] `assumption-lint.test.ts` tests W-023: challenged assumption with unreviewed `impliedBy` decisions is flagged as blocking
- [ ] All tests pass with `bunx vitest run`

## Verification Commands

```bash
bunx vitest run test/wiki/
```

## Convergence Targets

- Assumption page TOON roundtrip: encoding an assumption page frontmatter to TOON and decoding it back produces an identical object
- Lint rule W-020: an assumption with `lastValidated` 60 days ago and default 30-day threshold is flagged
- Lint rule W-023: a challenged assumption whose `impliedBy` decisions were last updated before the challenge timestamp is flagged as blocking

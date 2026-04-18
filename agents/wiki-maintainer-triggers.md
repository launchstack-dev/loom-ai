# Wiki Maintainer Triggers

Defines the events that trigger wiki-maintainer-agent invocations, the wiki page types it produces, the conflict persistence directory structure, and the query protocol agents use to look up prior decisions.

This document is a companion to `wiki-maintainer-agent.md`. The maintainer agent reads this file to determine what pages to create or update for each event type.

---

## 1. Trigger Conditions

The wiki-maintainer-agent is invoked when any of the following events occur. Each trigger maps to one or more wiki page types.

```toon
triggers[4]{event,source,wikiPageType,description}:
  criteria-plan-created,criteria-planner-agent,coverage,Criteria plan produced — create or update test coverage map
  convergence-complete,convergence-driver,quality,Convergence tier passes all criteria — create quality history page
  conflicts-resolved,interpretation-reviewer-agent,decisions,Conflicts transition to resolved/accepted/wont-fix — create decision page
  e2e-stories-verified,e2e-runner-agent,flows,E2E runner completes — create verified user flow page
```

### criteria-plan-created

Fires when `criteria-planner-agent` writes `criteria-plan.toon`. The wiki-maintainer reads the criteria plan and produces a **Test Coverage Map** page under `.loom/wiki/pages/coverage/`.

Input artifact: `.plan-execution/criteria-plan.toon`

### convergence-complete

Fires when the `convergence-driver` reports that a convergence tier has passed all blocking criteria. The wiki-maintainer produces a **Quality History** page under `.loom/wiki/pages/quality/`.

Input artifact: convergence report from `.plan-execution/convergence/`

### conflicts-resolved

Fires when interpretation conflicts transition from `open` to `resolved`, `accepted`, or `wont-fix`. The wiki-maintainer reads the resolved conflict files from `.plan-execution/conflicts/` and produces **Decision Pages** under `.loom/wiki/pages/decisions/`.

Input artifacts: `.plan-execution/conflicts/resolved/IC-NNN.toon`, `.plan-execution/conflicts/accepted/IC-NNN.toon`, `.plan-execution/conflicts/wont-fix/IC-NNN.toon`

### e2e-stories-verified

Fires when the `e2e-runner-agent` completes execution and writes its AgentResult. The wiki-maintainer reads the E2E story results and produces **Verified User Flow** pages under `.loom/wiki/pages/flows/`.

Input artifact: E2E runner AgentResult, story files from `.plan-execution/convergence/e2e/`

---

## 2. Wiki Page Types

### Test Coverage Map (`coverage/`)

Location: `.loom/wiki/pages/coverage/coverage-{featureRef}.md`

Maps features to criteria to test tiers, showing coverage per hierarchy level (see `taxonomy.md`).

```toon
pageId: coverage-F-01
title: Test Coverage Map — F-01 User Authentication
type: coverage
createdAt: 2026-04-18T12:00:00Z
updatedAt: 2026-04-18T12:00:00Z
sourceRefs[N]: .plan-execution/criteria-plan.toon
featureRef: F-01

coverageByTier[N]{criterion,name,testTier,verifier,covered}:
  C-01,Blocks unauthenticated requests,unit,test-runner,true
  C-02,Returns 401 with error shape,integration,test-runner,true
  C-04,No injection vulnerabilities,qa-review,security-review,true
  C-06,Clean separation of concerns,qa-review,code-review,false

hierarchyCoverage[N]{level,total,covered,percent}:
  wave,4,3,75
  phase,2,2,100
  feature,1,1,100
```

### Quality History (`quality/`)

Location: `.loom/wiki/pages/quality/quality-{tier}-{featureRef}.md`

Per-tier pass rates, iteration counts, and convergence rates over time.

```toon
pageId: quality-unit-F-01
title: Quality History — Unit Tier — F-01 User Authentication
type: quality
createdAt: 2026-04-18T14:00:00Z
updatedAt: 2026-04-18T14:00:00Z
sourceRefs[N]: .plan-execution/convergence/unit/
featureRef: F-01
tier: unit

history[N]{iteration,totalCriteria,passing,failing,passRate,converged}:
  1,4,1,3,25,false
  2,4,2,2,50,false
  3,4,3,1,75,false
  4,4,4,0,100,true

summary:
  totalIterations: 4
  finalPassRate: 100
  convergedAt: 2026-04-18T14:30:00Z
```

### Decision Pages (`decisions/`)

Location: `.loom/wiki/pages/decisions/decision-{conflictId}.md`

Resolved conflict details including both interpretations, the resolution, and source references. Created when conflicts transition to `resolved`, `accepted`, or `wont-fix`. References `interpretation-conflict.schema.md`.

```toon
pageId: decision-IC-002
title: Decision — IC-002 — 401 vs 403 for Expired Tokens
type: decision
createdAt: 2026-04-18T10:00:00Z
updatedAt: 2026-04-18T10:00:00Z
sourceRefs[N]: .plan-execution/conflicts/resolved/IC-002.toon

conflictId: IC-002
source: semantic-mismatch
status: resolved
severity: blocking
featureRef: F-03
phaseRef: Phase 4

planInterpretation: "Plan says 401 for expired tokens"
testInterpretation: "Test expects 403 for expired tokens"
resolution: "Aligned on 401 per RFC 6750"
resolvedAt: 2026-04-18T10:00:00Z

rationale: RFC 6750 Section 3.1 specifies 401 for invalid or expired tokens. The test was updated to expect 401 and the error response includes a WWW-Authenticate header.
affectedFiles[N]: src/auth/middleware.ts, tests/auth/token-expiry.spec.ts
```

### Verified User Flows (`flows/`)

Location: `.loom/wiki/pages/flows/flow-{storySessionName}.md`

E2E story verification results including step outcomes, screenshot references, and console dumps. References `e2e-story.schema.md`.

```toon
pageId: flow-user-creates-board
title: Verified Flow — User Creates Board and Adds Task
type: flow
createdAt: 2026-04-18T16:00:00Z
updatedAt: 2026-04-18T16:00:00Z
sourceRefs[N]: tests/e2e/user-creates-board.spec.ts

storyName: User creates a board and adds first task
milestoneRef: M-01
format: imperative
url: http://localhost:3000

preconditions[N]: Database is seeded with default data, Server is running on port 3000

stepOutcomes[N]{action,expected,status}:
  Navigate to /signup and fill in name email password,Redirect to /dashboard with welcome message,pass
  Click New Board and enter board title My First Board,Board appears in board list,pass
  Click into board and click Add Task with title Setup CI,Task appears in task list with status todo,pass

overallStatus: pass
screenshots[N]: .plan-execution/convergence/e2e/screenshots/user-creates-board-step-1.png
consoleDumps[N]: .plan-execution/convergence/e2e/console/user-creates-board.log
```

---

## 3. Conflict Persistence

All interpretation conflicts are persisted under `.plan-execution/conflicts/`. The interpretation-reviewer-agent writes the full report; downstream agents (wiki-maintainer, convergence-driver) move individual conflicts into status subdirectories as they are resolved.

### Directory Structure

```
.plan-execution/conflicts/
  interpretation-report.toon    # Latest full report from interpretation-reviewer-agent
  resolved/
    IC-001.toon                 # Individual resolved conflict
    IC-005.toon
  accepted/
    IC-003.toon                 # Accepted conflicts (acknowledged, no fix needed)
  wont-fix/
    IC-004.toon                 # Wont-fix conflicts (intentional divergence)
```

### interpretation-report.toon

The latest full report written by the interpretation-reviewer-agent. Contains all conflicts and coverage gaps in a single file. See `interpretation-reviewer-agent.md` for the output format.

### Individual Conflict Files

When a conflict transitions from `open` to a terminal status, the agent handling the resolution writes a standalone file to the appropriate subdirectory. Each file contains a single InterpretationConflict in TOON format (see `interpretation-conflict.schema.md`).

```toon
id: IC-002
source: semantic-mismatch
planInterpretation: "Plan says 401 for expired tokens"
testInterpretation: "Test expects 403 for expired tokens"
severity: blocking
status: resolved
resolution: "Aligned on 401 per RFC 6750"
resolvedAt: 2026-04-18T10:00:00Z
featureRef: F-03
phaseRef: Phase 4
```

### Lifecycle

1. `interpretation-reviewer-agent` writes `interpretation-report.toon` with all conflicts (status: `open`).
2. A human or agent resolves a conflict and sets `status` to `resolved`, `accepted`, or `wont-fix`.
3. The resolved conflict is written to the matching subdirectory: `resolved/IC-NNN.toon`, `accepted/IC-NNN.toon`, or `wont-fix/IC-NNN.toon`.
4. The `conflicts-resolved` trigger fires, invoking wiki-maintainer-agent to create a decision page.
5. The wiki-maintainer reads the conflict file and produces `.loom/wiki/pages/decisions/decision-IC-NNN.md`.

---

## 4. Wiki Query Protocol

Agents query the wiki to retrieve prior decisions, quality patterns, and design constraints. This avoids rediscovering resolved conflicts or repeating known-bad approaches.

### Query Types

```toon
queryTypes[4]{type,lookupKey,description}:
  by-conflict-id,conflictId,Look up the resolution for a specific conflict
  by-feature-ref,featureRef,Find all decisions affecting a feature
  by-page-type,type,Find all pages of a given type (decision / coverage / quality / flow)
  by-keyword,keyword,Full-text search across wiki page bodies
```

### Query Format

Agents issue queries by reading wiki files directly from `.loom/wiki/`. The query protocol is file-based -- agents read `index.toon` to locate pages, then read the relevant page files.

#### Query by conflict ID

```toon
query:
  type: by-conflict-id
  conflictId: IC-002

result:
  found: true
  pageId: decision-IC-002
  pagePath: .loom/wiki/pages/decisions/decision-IC-002.md
  resolution: "Aligned on 401 per RFC 6750"
  status: resolved
  featureRef: F-03
```

#### Query by feature ref

```toon
query:
  type: by-feature-ref
  featureRef: F-01

result:
  found: true
  pages[N]{pageId,type,pagePath}:
    coverage-F-01,coverage,.loom/wiki/pages/coverage/coverage-F-01.md
    quality-unit-F-01,quality,.loom/wiki/pages/quality/quality-unit-F-01.md
    decision-IC-001,decision,.loom/wiki/pages/decisions/decision-IC-001.md
```

#### Query by page type

```toon
query:
  type: by-page-type
  pageType: decision

result:
  found: true
  pages[N]{pageId,conflictId,status,featureRef,pagePath}:
    decision-IC-001,IC-001,resolved,F-01,.loom/wiki/pages/decisions/decision-IC-001.md
    decision-IC-002,IC-002,resolved,F-03,.loom/wiki/pages/decisions/decision-IC-002.md
    decision-IC-003,IC-003,accepted,F-01,.loom/wiki/pages/decisions/decision-IC-003.md
    decision-qa-arch-001,QA-001,resolved,F-02,.loom/wiki/pages/decisions/qa/decision-qa-arch-001.md
```

#### Query by keyword

```toon
query:
  type: by-keyword
  keyword: rate limiting

result:
  found: true
  pages[N]{pageId,type,pagePath,matchContext}:
    decision-IC-005,decision,.loom/wiki/pages/decisions/decision-IC-005.md,"Rate limiting on login endpoint — resolved as 100 req/min per IP"
    coverage-F-02,coverage,.loom/wiki/pages/coverage/coverage-F-02.md,"C-09 Rate limiting criterion — covered at integration tier"
```

### Query Resolution Steps

1. Read `.loom/wiki/index.toon` to get the page catalog.
2. Filter entries by the query type (match on `pageId`, `type`, `featureRef`, or scan bodies for keywords).
3. Read matched page files to extract the requested data.
4. Return the result in the TOON format shown above.

Agents MUST NOT cache query results across waves. The wiki may be updated between waves by the wiki-maintainer or by human edits.

---

## 5. Design Constraints from QA

QA review findings that identify architectural constraints produce wiki pages under `.loom/wiki/pages/decisions/qa/`. These capture constraints discovered during code review, security review, or performance review that affect future implementation decisions.

### QA Constraint Page Format

Location: `.loom/wiki/pages/decisions/qa/decision-qa-{constraintId}.md`

```toon
pageId: decision-qa-arch-001
title: QA Constraint — No Direct SQL in Route Handlers
type: decision
subtype: qa-constraint
createdAt: 2026-04-18T15:00:00Z
updatedAt: 2026-04-18T15:00:00Z
sourceRefs[N]: .plan-execution/convergence/criteria/review-reports/security-review-iter-3.toon

constraintId: QA-001
discoveredBy: security-review
severity: critical
featureRef: F-02

constraint: Route handlers must not contain direct SQL queries. All database access must go through the repository layer.
rationale: Security review iteration 3 found SQL injection vulnerability in direct query construction within route handler. Parameterized queries in repository layer prevent this class of vulnerability.
affectedFiles[N]: src/routes/users.ts, src/routes/boards.ts
recommendedPattern: Import and call repository methods instead of constructing queries inline.
```

### When to Create QA Constraint Pages

QA constraint pages are created when a reviewer finding meets all of these conditions:

1. The finding has severity `critical` or `high`.
2. The finding identifies a pattern that should be avoided project-wide (not a one-off fix).
3. The finding implies an architectural constraint (affects multiple files or future implementations).

The wiki-maintainer creates these pages during `convergence-complete` processing when review reports contain findings matching these conditions. The constraint pages are cross-referenced with the relevant coverage and quality pages.

---

## Relationship to Other Schemas

- **interpretation-conflict.schema.md** -- Conflict files in `.plan-execution/conflicts/` follow the InterpretationConflict schema. Decision pages are derived from these files.
- **e2e-story.schema.md** -- Verified user flow pages are derived from E2EStory data and runner results.
- **criteria-plan.schema.md** -- Test coverage map pages are derived from criteria plan entries and their `testTier` assignments.
- **convergence-tier.schema.md** -- Quality history pages track pass rates per convergence tier.
- **taxonomy.md** -- Coverage maps reference the 4-level hierarchy (milestone, feature, phase, wave) for coverage aggregation.
- **wiki-maintainer-agent.md** -- The wiki-maintainer agent reads this document to determine trigger handling and page creation logic.

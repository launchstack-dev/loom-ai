# Plan: Pre-flight Scope Contract System

## Overview

A two-stage pre-flight system that converts a loose user prompt into a comprehensive scope contract before any execution begins. Stage 1 refines the prompt. Stage 2 resolves every decision point. The result is a `scope-contract.toon` that every downstream agent operates against.

## Architecture

```
User prompt (loose)
    │
    ▼
┌──────────────────────┐
│  Prompt Refiner       │  Stage 1: Expand loose intent into structured brief
│  (single agent)       │  Output: refined-brief.md
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Scope Interrogator   │  Stage 2: Surface and resolve every decision point
│  (multi-round Q&A)    │  Output: scope-contract.toon
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Contract Validator   │  Stage 3: Verify contract is complete and unambiguous
│  (automated check)    │  Output: validation report
└──────────┬───────────┘
           │
           ▼
    scope-contract.toon  → feeds roadmap, plan, execution, all agents
```

## Phase 1: Prompt Refiner Agent

**New agent:** `agents/prompt-refiner-agent.md`

### Purpose

Takes a loose, informal user prompt and expands it into a structured project brief without losing the user's intent. Not a questionnaire — the agent infers what it can from the prompt and codebase, then fills gaps.

### How it works

1. Read the user's raw prompt (could be anything from "add auth" to a 3-paragraph description)
2. Scan the codebase for context:
   - Tech stack (package.json, etc.)
   - Existing architecture (directory structure, existing routes, models)
   - CLAUDE.md conventions
   - Existing ROADMAP.md features (to avoid duplication)
   - Wiki pages (if `.loom/wiki/` exists) for domain knowledge
3. Expand the prompt into a structured brief:

```markdown
## Project Brief

### Intent
{What the user wants, expanded from their prompt with inferred context}

### Scope (inferred)
- IN: {what this clearly includes}
- OUT: {what this clearly does NOT include}
- UNCLEAR: {what could go either way — flagged for Stage 2}

### Technical Context (auto-detected)
- Stack: {from codebase scan}
- Existing patterns: {auth approach, DB access pattern, API style}
- Related existing code: {files/modules that overlap with this feature}

### Assumptions Made
{List of inferences the agent made — each will be validated in Stage 2}

### Suggested Features
{Breakdown of the prompt into discrete features, each with a 1-line description}

### Risk Signals
{Anything that looks complex, ambiguous, or potentially scope-creepy}
```

4. Present the brief to the user for quick review:
   ```
   Here's what I understand from your prompt:

   {brief summary}

   Assumptions I made:
   - {assumption 1}
   - {assumption 2}

   Unclear areas (we'll resolve these next):
   - {unclear 1}
   - {unclear 2}

   Does this capture your intent? (yes / adjust)
   ```

5. If the user adjusts, incorporate their feedback and re-present. This loop is fast — no agent respawn needed, just conversation.

### Agent design

```markdown
---
model: sonnet
tools: Read, Glob, Grep, Bash
---
```

Sonnet is sufficient — this is comprehension and expansion, not complex reasoning. The agent reads the codebase but doesn't modify anything.

## Phase 2: Scope Interrogator (Enhanced Questioner)

**Modified agent:** enhance existing `agents/questioner-agent.md`

### Purpose

Takes the refined brief from Stage 1 and systematically resolves every decision point, ambiguity, and assumption into a locked scope contract. This is the thorough part — 5-15 questions, grouped by topic, with sensible defaults for each.

### Question Categories

The interrogator generates questions across these dimensions:

| Category | What it resolves | Example questions |
|----------|-----------------|-------------------|
| **Architecture** | System structure, patterns, boundaries | "REST API or GraphQL? Monolith or service-separated?" |
| **Data model** | Entities, relationships, storage | "What entities does this feature manage? What's the primary key strategy?" |
| **Auth & security** | Access control, data protection | "Who can access this? Role-based? Row-level security?" |
| **Integration** | External systems, APIs, dependencies | "Does this integrate with anything external? What failure modes?" |
| **UX/behavior** | User flows, edge cases, error states | "What happens when X fails? What's the empty state?" |
| **Scope boundaries** | What's in/out, MVP vs full | "Is {inferred feature} in scope? What's the minimum viable version?" |
| **Success criteria** | How to verify completion | "How do we know this is done? What tests prove it works?" |
| **Constraints** | Limits, requirements, non-negotiables | "Performance targets? Backward compatibility requirements?" |

### Interaction Style: Proposals, Not Questions

The interrogator does NOT ask bare questions like "what auth strategy?". Instead, it **proposes concrete options with tangible examples** from the codebase. Each proposal shows what the code would actually look like, what the tradeoffs are, and what acceptance criteria it implies. Users react to ideas, not abstractions.

Proposals are grouped into batches of 2-4, each batch covering one decision area:

```
## Architecture: How should this feature talk to the database?

Your codebase uses the repository pattern (e.g., `src/db/repositories/user.ts`).
Here are three ways to build the data layer for team management:

### Option A: Repository + raw SQL (recommended)
Matches your existing pattern. Here's what it would look like:
```ts
// src/db/repositories/team.ts
export function getTeamMembers(teamId: string): Member[] {
  return db.prepare('SELECT * FROM members WHERE team_id = ?').all(teamId);
}
```
**Implies these acceptance criteria:**
- All queries use parameterized SQL (no string interpolation)
- Repository functions are unit-testable with in-memory SQLite
- Each entity gets its own repository file

### Option B: Drizzle ORM
Type-safe queries, auto-migration, but you'd be introducing a new dependency:
```ts
const members = await db.select().from(membersTable).where(eq(membersTable.teamId, id));
```
**Implies these criteria:**
- Drizzle schema file defines all tables
- Migrations auto-generated and tested
- Existing repositories would need gradual migration (scope creep risk)

### Option C: Mixed — repository interface, SQL behind it
Keep the repository API but add a thin abstraction for future ORM migration:
**Implies:** Interface + implementation split, more files but easier to swap later

→ Which resonates? (A / B / C / or describe what you'd prefer)
```

Each option:
1. **Shows actual code** from the project or realistic for the project's stack
2. **States what it implies** for acceptance criteria — the user sees downstream consequences of each choice
3. **Flags scope risks** where an option would expand scope beyond the original intent
4. **Has a recommendation** based on codebase patterns (but doesn't hide alternatives)

### Acceptance Criteria: First-Class, Not Afterthought

Acceptance criteria are woven into every decision, not collected separately at the end. Each resolved decision immediately produces testable criteria:

```
Decision locked: Repository + raw SQL

Acceptance criteria generated:
  SC-01: All queries use parameterized SQL (verified: grep for string interpolation in SQL)
  SC-02: Each entity has a dedicated repository file in src/db/repositories/
  SC-03: Repository functions accept typed parameters, not raw request objects
  SC-04: Unit tests for each repository using in-memory SQLite
  SC-05: No direct db.prepare() calls outside repository files

These criteria will be included in the scope contract. Adjust? (yes / looks good)
```

After all decisions are locked, the interrogator presents a **consolidated acceptance criteria review**:

```
## Acceptance Criteria Summary (18 criteria from 6 decisions)

### Data Layer (5 criteria from Architecture decision)
  SC-01: All queries use parameterized SQL
  SC-02: Each entity has dedicated repository file
  ...

### Auth & Access Control (4 criteria from Auth decision)
  SC-06: RBAC middleware on all protected routes
  SC-07: Admin role required for team deletion
  ...

### API Surface (5 criteria from API decision)
  SC-11: All endpoints return consistent error format
  SC-12: Pagination on list endpoints (default 20, max 100)
  ...

### Completion (4 criteria — always included)
  SC-15: TypeScript compiles with zero errors
  SC-16: All tests pass (vitest run)
  SC-17: No lint errors
  SC-18: API responds within 200ms on test data

Adjust any criteria? Add missing ones? (adjust N / add "criterion" / looks good)
```

This review is the user's last chance to shape what "done" means before execution. Every criterion becomes a verification target during execution.

### Idea Generation Within Proposals

When a decision has no clear codebase signal, the interrogator generates 2-3 novel approaches and explores them briefly rather than asking an open question:

```
## UX: What happens when a user is removed from a team?

No existing pattern in your codebase for cascading user removal. Here are three approaches:

### Idea 1: Soft delete with grace period
Mark membership as "pending-removal", give 7 days to undo. Simple to implement, prevents accidental data loss.
**Implies:** status field on membership, scheduled cleanup job, undo endpoint

### Idea 2: Immediate removal, preserve history
Delete membership but keep an audit log entry. Clean break, auditable.
**Implies:** audit_log table, no undo capability, simpler data model

### Idea 3: Transfer ownership first
If the user owns any team resources (projects, docs), require reassignment before removal. Prevents orphaned data.
**Implies:** ownership check endpoint, reassignment flow, more complex but safer

→ Which approach? Or combine elements (e.g., "soft delete + ownership transfer")
```

This surfaces requirements the user didn't know they had — "oh right, what about owned resources?" — through concrete proposals rather than abstract questions.

### Smart defaults

Every proposal has a recommended option based on:
- Existing codebase patterns (strongest signal)
- Common industry practice for the detected stack
- Simplicity principle from behavioral-guidelines.md
- The refined brief from Stage 1

If the user types "defaults" or "d" for a batch, all recommended options are accepted with their implied acceptance criteria.

### Auto-skip for simple tasks

If the refined brief (Stage 1) has 0 unclear areas and 0 risk signals, the interrogator can suggest:
```
The brief is clear and the scope is well-defined. Skip detailed questions?
→ [1] Yes, use all recommended defaults
→ [2] No, I want to review each decision
```

## Phase 3: Contract Generation

### `scope-contract.toon` format

```toon
schemaVersion: 1
createdAt: {ISO timestamp}
sourcePrompt: {original user prompt, first 200 chars}
briefHash: {hash of refined-brief.md}

intent: {1-2 sentence refined intent statement}
mvpScope: {1 sentence minimum viable version}
fullScope: {1 sentence complete vision}

decisions[N]{id,category,question,answer,rationale,source}:
  D-01,architecture,API style,REST endpoints,Matches existing Express routes,codebase-pattern
  D-02,architecture,Data access,Repository + SQL,Consistent with existing code,codebase-pattern
  D-03,architecture,Service layer,Add for this feature,Business logic complexity warrants it,user-choice
  D-04,data-model,Primary entities,User + Team + Membership,Core domain from brief,inferred
  D-05,auth,Access control,Role-based (admin/member/viewer),Standard RBAC pattern,user-choice
  D-06,scope,Email notifications,Out of scope for MVP,User confirmed defer to v2,user-choice
  D-07,success,Completion criteria,All CRUD ops + RBAC + tests passing,User defined,user-choice

assumptions[N]{id,assumption,validated,validatedBy}:
  A-01,SQLite sufficient for expected load,true,user-confirmed
  A-02,No existing user table to migrate from,true,codebase-scan
  A-03,Frontend is out of scope,true,user-confirmed

nonGoals[N]:
  Email notifications
  Real-time updates
  Mobile-specific API
  Data migration from external systems

successCriteria[N]{id,criterion,testable,verificationMethod}:
  SC-01,All CRUD endpoints return correct status codes,true,integration test
  SC-02,RBAC enforced on all protected routes,true,auth test suite
  SC-03,TypeScript compiles with no errors,true,tsc --noEmit
  SC-04,All tests pass,true,vitest run

techContext:
  stack: typescript,express,better-sqlite3
  testFramework: vitest
  existingPatterns: repository-pattern,route-handler,middleware-chain
  relatedFiles[N]: src/routes/users.ts,src/db/repositories/user.ts
```

### Contract properties

1. **Every decision has a source** — `codebase-pattern`, `user-choice`, `inferred`, `default-accepted`
2. **Every assumption is validated** — either by codebase scan, user confirmation, or flagged as unvalidated
3. **Non-goals are explicit** — prevents scope creep during execution
4. **Success criteria are testable** — each has a verification method the pipeline can actually run
5. **Tech context is concrete** — not "we'll figure it out" but actual file paths and patterns

## Phase 4: Contract Integration

### How the contract flows through the pipeline

1. **Roadmap generation** (`/loom-roadmap init`):
   - Reads `scope-contract.toon` if it exists
   - Features derived from `decisions` and `mvpScope`
   - Constraints derived from `nonGoals` and `assumptions`
   - Skips questioner-agent if contract already has decisions (no double-questioning)

2. **Plan creation** (`/loom-plan create`):
   - Contract decisions → architecture section constraints
   - Contract success criteria → acceptance criteria seeds
   - Contract tech context → file ownership hints
   - Contract non-goals → explicit out-of-scope annotations in plan

3. **Execution** (`/loom-plan execute`):
   - Every implementer agent receives relevant contract decisions in its prompt
   - Verification agent checks against contract success criteria (not just generic "tests pass")
   - Contract violations trigger specific error messages: "Decision D-03 specified repository pattern but agent used ORM"

4. **Mid-run self-correction** (the feedback loop):
   - Before each wave, orchestrator reads `scope-contract.toon` + `rolling-context.md` + `state.toon`
   - Compares execution trajectory against contract:
     - Are we still building what was contracted?
     - Have any assumptions proven false?
     - Has scope crept beyond non-goals?
   - If drift detected: log it, warn in the wave summary, optionally re-plan remaining waves
   - New decisions discovered during execution get appended to the contract with source `execution-discovered`

5. **Review** (`/loom-code review`):
   - Plan-compliance-reviewer checks code against contract decisions (not just plan structure)
   - "Decision D-05 specified RBAC but no authorization middleware found" is more actionable than "missing auth"

6. **Wiki**:
   - Wiki-maintainer captures contract decisions as `decision-*.md` pages
   - Contract evolution (execution-discovered entries) gets wiki updates automatically

## Phase 5: Orchestration Changes

### Updated `/loom auto` flow

```
1. Read user prompt
2. [NEW] Prompt Refiner → refined-brief.md
3. [NEW] User reviews brief (quick yes/adjust)
4. [NEW] Scope Interrogator → scope-contract.toon
5. [NEW] Contract Validator → validation check
6. Roadmap generation (reads contract)
7. Plan creation (reads contract)
8. Execution loop (reads contract per wave, drift detection)
9. Test → Review → Fix loop (checks against contract)
```

### Updated `/loom-roadmap init` flow

```
1. [NEW] If no scope-contract.toon exists AND user provided --from "prompt":
   a. Run Prompt Refiner
   b. Run Scope Interrogator
   c. Generate contract
2. Read contract (if exists) — skip questioner-agent for decisions already locked
3. Continue with existing roadmap generation
```

### Updated `/loom quick` flow

For `/loom quick`, the contract is optional. If the task is simple enough:
- Prompt Refiner runs but auto-skips interrogation
- A lightweight contract is generated with just: intent, success criteria, non-goals
- No multi-round Q&A for quick tasks

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `agents/prompt-refiner-agent.md` | Create | New agent: prompt → structured brief |
| `agents/questioner-agent.md` | Modify | Enhance to consume refined briefs, produce scope-contract.toon |
| `agents/protocols/scope-contract.schema.md` | Create | Schema for scope-contract.toon |
| `commands/loom.md` | Modify | Update `auto` subcommand with pre-flight stages |
| `commands/loom-roadmap.md` | Modify | Update `init` to read contract, skip redundant questions |
| `commands/loom-plan.md` | Modify | Update `create` and `execute` to read contract |
| `commands/loom-code.md` | Modify | Update `review` to check against contract |
| `skills/library.yaml` | Modify | Add prompt-refiner-agent, scope-contract-schema |

## Execution Order

1. Create schema (`scope-contract.schema.md`)
2. Create prompt-refiner-agent
3. Enhance questioner-agent
4. Update `/loom auto` to include pre-flight stages
5. Update `/loom-roadmap init` to consume contract
6. Update `/loom-plan create` and `execute` to consume contract
7. Update `/loom-code review` to check against contract

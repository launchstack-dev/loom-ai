---
planVersion: 1
name: "Wiki: Flows & Contracts as First-Class Page Types"
status: draft
created: 2026-05-23
lastReviewed: null
roadmapRef: null
totalPhases: 8
totalWaves: 4
---

# Plan: Wiki Flows & Contracts (with Context Efficiency, Karpathy Integration, and Maintenance Enforcement)

## Strategic Framing

Flows and contracts are the **knowledge substrate** that lets an AI reason about user-facing promises and system guarantees — not just about code topology. Today Loom's wiki describes what exists; it cannot answer "what does this system promise its users?" or "what would break if this changed?" Those are exactly the questions an EA/PM agent must answer before challenging assumptions or drafting a response. This plan builds the substrate that makes that reasoning possible. The differentiator versus visual-graph tooling (Understand-Anything, Sourcegraph) is **active enforcement**: the wiki-discipline CLAUDE.md block tells agents to consult before proposing; the wiki-impact-warner hook fires before edits; the interpretation-reviewer escalates contract conflicts to blocking. This is enforcement, not comprehension — a different product than viewers.

## Overview

Loom's wiki today maps **what exists** (components, decisions, patterns, conventions) but not **how it's used** (flows, journeys, processes) or **what it must guarantee** (persistent contracts, schemas). This plan ships four coupled changes:

1. **Two new first-class page categories** — `flow-*` and `contract-*` — plus the supporting relationships and lint rules.
2. **Context-efficiency upgrades** to the page schema (`summary` field, body length caps, structured H2 sections, per-page token estimates in the index) so a populated wiki scales without blowing the rolling-context budget.
3. **Karpathy + Wiki Discipline integration** in user-project `CLAUDE.md` — a new `## Loom Wiki Discipline` section (separate marker, conditional on `.loom/wiki/` existing) that operationalizes the four Karpathy principles against the wiki: consult before assuming, check contracts before proposing, treat flow exit states as success criteria.
4. **Maintenance enforcement** — SessionStart wiki health surfacing, `/loom status` wiki block, auto-lint cadence, and two hooks (PreToolUse `wiki-impact-warner` for deterministic write-time impact surfacing, UserPromptSubmit `wiki-context-suggester` for fuzzy prompt-time context injection).

Inspired by Understand-Anything's domain-analyzer (`/understand-domain` produces "domains, flows, and process steps") and the gap where Loom's contracts live only in ephemeral `.plan-execution/contracts/` and never enter the persistent wiki. Flows and contracts are inseparable from the maintenance + Karpathy work — they will rot without enforcement and won't be consulted without the CLAUDE.md discipline block — so they ship as one plan.

**MVP boundary:** Wave 1 (Wave 0 contracts + Phases 0a, 1, 2) is independently shippable. It delivers: the two new page categories with full schema, agent-written `summary` + `estimatedTokens`, lint enforcement, the wiki-discipline CLAUDE.md block, and the legacy-repo migration path. ACs validated by Wave 1 alone: AC-01 through AC-08, AC-12 through AC-16, AC-22, AC-24, AC-25. Rolling-context ranking (Wave 2) and hooks (Wave 3) deliver compounding value but the MVP slice is shippable and validates the core bet before committing to the rest.

**Out of scope (explicit deferrals):**
- Visual graph rendering (Understand-Anything's `/understand-dashboard`) — **permanent positioning deferral**, not a sequencing one. Loom builds enforcers; viewers are a different product. Revisit only if the EA/PM endgame explicitly requires human-facing graph navigation.
- `tour-*` guided sequences — separate plan once flows are validated.
- `architecturalLayer` frontmatter field — separate plan; low marginal value vs. flows.
- Real-time impact-analysis queries (`/loom-wiki impact <file>`) — depends on flows + contracts being populated; sequel plan.
- Contract-drift quality gate (PostToolUse hook that fails the wave if a contract `shape` changed without a corresponding wiki update) — sequel plan; **this is the highest-value follow-on**, the mechanism that makes contracts self-policing.
- **Flow state-machine modeling** (full `states[]` + `transitions[]{from,to,guard,actor}` graph for `lifecycle` flows) — sequel plan once 10+ flow pages are populated and the gap is concrete.
- **`wiki-context-suggester` hook (Hook B / UserPromptSubmit fuzzy pattern-matching)** — moved to sequel plan. Needs real-prompt calibration data that doesn't exist yet; shipping with a guessed regex list risks polluting every prompt's context. Ships only after `wiki-impact-warner` (Hook A) has logged ≥100 sessions of audit data.
- **Hook-contract platform-agnosticism** for non-Claude-Code platforms (Codex, OpenCode, Pi equivalents of SessionStart/PreToolUse/UserPromptSubmit) — referenced to ROADMAP F-09 hook-contract spec as the resolution path; degraded behavior on non-Claude-Code platforms is acceptable for this plan.

## Tech Stack

- **Markdown + TOON frontmatter** for new page categories (matches existing wiki pattern).
- **TOON** for schema additions in `wiki-page.schema.md` and `wiki-index.schema.md`.
- **vitest** for hook + lint-rule tests.
- No runtime dependencies added.

---

## Schema / Type Definitions

### New page category: `flow-*`

Captures an ordered sequence of steps describing a process — a user journey, a system pipeline, a recurring workflow. Each flow has a trigger, entry points, ordered steps, exit states, and cross-refs to the components/contracts each step exercises.

```toon
pageId: flow-user-signup
title: User Signup
category: flow
domain: code
flowType: user-journey
trigger: POST /api/users/signup
entryPoints[1]: src/routes/users.ts:45
exitStates[2]: user-created, validation-error
steps[5]{order,name,actor,touches,outcome}:
  1,Receive signup request,api-layer,src/routes/users.ts,Parsed body
  2,Validate input,api-layer,src/validators/user.ts,Reject if invalid
  3,Check duplicate email,service-layer,src/services/user.ts,Reject if exists
  4,Hash password and create user,service-layer,src/services/user.ts + src/db/users.ts,Row inserted
  5,Send welcome email,service-layer,src/services/email.ts,Email queued
sourceRefs[4]: src/routes/users.ts, src/services/user.ts, src/db/users.ts, src/services/email.ts
crossRefs[4]{pageId,relationship}:
  component-user-service,exercises
  component-email-service,exercises
  contract-user-create,implements
  decision-bcrypt-password,implements
tags[3]: auth, onboarding, user-lifecycle
staleness: fresh
confidence: high
createdAt: ISO-8601
updatedAt: ISO-8601
createdBy: wiki-ingest-agent
updatedBy: wiki-ingest-agent
```

**Required new frontmatter fields for `flow-*` pages:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `flowType` | enum | yes | One of: `user-journey`, `system-pipeline`, `scheduled-job`, `event-driven`, `lifecycle` |
| `trigger` | string | yes | What initiates the flow (HTTP route, cron expression, event name, manual user action) |
| `entryPoints` | string[] | yes | File:line locations where the flow starts |
| `exitStates` | string[] | yes | Named terminal states (e.g., `user-created`, `payment-declined`, `validation-error`) |
| `steps` | typed-array | yes | Ordered steps with `order, name, actor, touches, outcome` columns |

**Steps column semantics:**
- `order` (int) — 1-indexed step number; gaps allowed for revision but lint warns
- `name` (string) — verb-led action ("Validate input", not "Validation")
- `actor` (string) — layer or component performing the step. Code-domain values: `api-layer`, `service-layer`, `worker`, `external`, `user`. Non-code domains use domain-appropriate roles (business: `analyst`, `approver`, `customer`; research: `author`, `reviewer`). Lint warns on unrecognized values per-domain.
- `touches` (string) — file paths or component pageIds the step reads/writes
- `outcome` (string) — what changes after this step (state mutation, side effect, decision). Max 80 chars (lint W-027).
- `nextOnFail` (string, optional) — name of an `exitState` OR `order` of another step to branch to if this step fails. Enables binary branching without requiring a full graph model. Empty/null = step failures bubble to the caller. **Critical for any flow with more than one exitState** — without this, the schema cannot attribute which step produces which exit.
- `errorExits` (string[], optional) — `exitState` names this step can produce. Inverse view of `nextOnFail` aggregated at the step level. Used by `bugfix-analyst-agent` and `wiki-impact-warner` for step-level impact attribution ("a bug in step 3 only affects exits X and Y, not the whole flow").

**Known limitation — full state machines:** the `lifecycle` `flowType` plus `nextOnFail` covers binary branching adequately but does NOT model full state-machine semantics (named non-terminal states, guard conditions, transition matrices, prohibited transitions). Workaround: split a state machine into one parent flow page + child sub-flow pages connected via the `triggers` relationship. A full `states[]` + `transitions[]` schema is deferred to a sequel plan; revisit once 10+ flow pages are populated and the gap is concrete.

### New page category: `contract-*`

Captures a persistent shape contract that crosses module or service boundaries — an API contract, an event payload, a DB column-level invariant, a typed schema that outlives any single execution. Distinct from `.plan-execution/contracts/` which is per-execution scratch.

```toon
pageId: contract-user-create
title: User Create Contract
category: contract
domain: code
contractType: api
authorityFile: src/contracts/user.contract.ts
shape: POST /api/users { email: string, password: string, name?: string } -> 201 { id, email, name } | 400 { error }
producers[1]: component-user-routes
consumers[2]: component-user-service, component-admin-portal
invariants[3]: email-unique, password-min-8-chars, name-optional
versionMarker: v1
sourceRefs[2]: src/contracts/user.contract.ts, src/types/user.ts
crossRefs[3]{pageId,relationship}:
  flow-user-signup,exercised-by
  component-user-service,consumed-by
  decision-rest-over-graphql,implements
tags[3]: api, user, contract
staleness: fresh
confidence: high
```

**Required new frontmatter fields for `contract-*` pages:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractType` | enum | yes | One of: `api`, `event`, `schema`, `function-signature`, `db-table`, `cli-protocol`, `file-format` |
| `authorityFile` | string | yes | Primary source-of-truth file (the contract definition the system actually enforces). When the shape spans multiple files, use this for the file to edit when the shape changes. |
| `shapeFiles` | string[] | optional | All files whose content collectively defines the shape. Required when shape spans 2+ files (e.g., Prisma schema + migration + TS type). When absent, defaults to `[authorityFile]`. |
| `shape` | string | yes | Compact representation of the contract — request/response, payload, schema. Max 500 chars (longer goes in body under `## Shape`, lint W-027). |
| `producers` | string[] | yes | pageIds (or file paths) that emit/satisfy this contract |
| `consumers` | string[] | yes | pageIds (or file paths) that consume this contract |
| `invariants` | string[] | yes | Named guarantees the contract enforces (lint can later validate these against tests) |
| `versionMarker` | string | optional | Contract version (`v1`, `2024-03`, etc.) — required if the contract has formal versioning |
| `compatibilityPolicy` | enum | yes | One of: `backward-compatible` (consumers of any prior version still work), `additive-only` (only additions, no removals/changes), `full-semver` (semver discipline with breaking-change signaling), `none` (no compatibility commitment). **Drives `interpretation-reviewer-agent` escalation logic** — without this, contract-conflict detection has no anchor for what counts as breaking. |
| `deprecatedAt` | string | optional | ISO-8601 date if this contract is deprecated. Cross-ref `replacedBy` should also be set. |
| `replacedBy` | string | optional | pageId of the contract that supersedes this one. Use with `supersedes` cross-ref relationship. |
| `breakingChanges` | string[] | optional | Versioned list of breaking changes against `compatibilityPolicy`. Each entry: `"<version>: <description>"`. Surfaces in `interpretation-reviewer-agent` reports for cross-version analyses. |

**Significance threshold for contracts:** a file becomes a `contract-*` page only if it satisfies at least one:
- Exported types/schemas referenced by 2+ other modules
- HTTP route handlers with documented request/response shapes
- Event payload definitions consumed by separate subsystem (queue, webhook, pubsub)
- DB schema with NOT NULL or unique constraints that the application layer relies on
- CLI argument parsers / RPC stubs

### New cross-reference relationships

Add to `wiki-page.schema.md` Cross-Reference Relationships table:

| Relationship | Direction | Meaning | Inverse |
|--------------|-----------|---------|---------|
| `exercises` | flow → component | The flow's steps invoke this component | `exercised-by` |
| `exercised-by` | component → flow | Inverse of `exercises` (auto-generated) | `exercises` |
| `triggers` | flow → flow | Completion of this flow initiates the referenced flow | `triggered-by` |
| `triggered-by` | flow → flow | Inverse of `triggers` (auto-generated) | `triggers` |
| `produces` | component/flow → contract | The subject creates outputs that satisfy the referenced contract | `produced-by` |
| `produced-by` | contract → component/flow | Inverse of `produces` (auto-generated) | `produces` |
| `consumes` | component/flow → contract | The subject reads inputs that must match the referenced contract | `consumed-by` |
| `consumed-by` | contract → component/flow | Inverse of `consumes` (auto-generated) | `consumes` |

Existing `implements` relationship is reused for flow→contract and flow→decision links (no new relationship needed there).

### wiki-index.toon additions

Add the two new categories, the `summary` and `estimatedTokens` columns on the `pages[]` typed array, and bump schema version:

```toon
schemaVersion: 2          # was 1
# ... existing fields ...
pages[N]{pageId,title,category,subtype,staleness,updatedAt,summary,estimatedTokens}:
  component-auth-middleware,Auth Middleware,component,,fresh,2026-04-12,Validates JWT tokens on protected routes; fail-closed on signature mismatch.,420
  flow-user-signup,User Signup,flow,user-journey,fresh,2026-05-23,Five-step signup flow: validate → dedupe → hash → insert → email.,310
  contract-user-create,User Create Contract,contract,api,fresh,2026-05-23,POST /api/users → 201 {id,email,name} | 400 — email unique invariant.,180

categories[N]{name,count}:
  component,12
  concept,8
  decision,5
  pattern,4
  convention,6
  api-surface,3
  tech-debt,2
  external,1
  execution-record,9
  flow,0                  # NEW
  contract,0              # NEW
```

### Context-efficiency fields

Today the wiki is partly context-efficient (TOON frontmatter is dense, index enables find-without-read, rolling-context has a 1k budget) but bodies are uncapped, there are no per-page token estimates, and there's no elevator-pitch field — so the orchestrator either reads full bodies (expensive) or sees only titles/staleness (low signal). This iteration adds three fields and three body conventions:

**New frontmatter fields (apply to all categories, not just flow/contract):**

| Field | Type | Required | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| `summary` | string | yes | Max 200 chars, 1-2 sentences, no markdown | Elevator pitch. Orchestrator packs summaries first into the rolling-context `[WIKI]` block; expands to full body only for top-ranked pages. Mirrored into `index.toon` so reads are zero-cost. |
| `estimatedTokens` | int | yes | Computed at write time via `Math.ceil(charCount / 4)` over the full page (frontmatter + body) | Lets the orchestrator pack the 1k `[WIKI]` budget by token cost, not page count. Stored in `index.toon` so packing decisions don't need to read bodies. |
| `bodySections` | string[] | yes | Required H2 sections per category (see table below) | Lets the orchestrator extract one section cheaply instead of reading the whole body. Lint enforces presence; missing required sections are W-026 warnings. |
| `subtype` | string | optional | For `flow-*` pages: mirrors `flowType` (`user-journey`/`system-pipeline`/`scheduled-job`/`event-driven`/`lifecycle`). For `contract-*` pages: mirrors `contractType` (`api`/`event`/`schema`/`function-signature`/`db-table`/`cli-protocol`/`file-format`). Empty for other categories. Mirrored into `index.toon` to enable category-aware ranking without body reads. |

**Required H2 body sections per category:**

| Category | Required sections |
|----------|------------------|
| `component-*` | `## Summary`, `## Dependencies`, `## Key Behaviors` |
| `flow-*` | `## Summary`, `## Trigger Context`, `## Step Details` |
| `contract-*` | `## Summary`, `## Shape`, `## Invariants` |
| `decision-*` | `## Summary`, `## Rationale`, `## Alternatives Considered` |
| `pattern-*`, `convention-*` | `## Summary`, `## Examples` |
| All other categories | `## Summary` only |

**Length caps (lint-enforced):**

| Where | Cap | Lint rule |
|-------|-----|-----------|
| Page body (frontmatter excluded) | 1200 tokens (~4800 chars) | W-025 warn, W-025-blocking at 2000 tokens |
| `summary` field | 200 chars | W-026 (also fires on missing required sections) |
| `flow-*` `steps[].outcome` column | 80 chars per row | W-027 |
| `contract-*` `shape` field | 500 chars (longer goes in body under `## Shape`) | W-027 |

**Why this matters with flows/contracts:** flow pages with 5-12 ordered steps and contract pages with detailed shapes will be larger on average than today's component pages. Without summary + token-aware packing, the orchestrator either truncates context (losing user-facing impact info) or busts the budget. The summary field is the single biggest win — it shifts the rolling-context budget from "pick 3 full pages" to "pick 15 summaries + 1 full page" within the same 1k.

**index.toon as the packing source of truth:** all rolling-context packing decisions read from `index.toon` only (which now carries summary + estimatedTokens). Body reads happen only after the page wins a slot in the budget. This keeps the orchestrator's pre-pack cost O(1) regardless of wiki size.

---

## Significance Thresholds

Add to `wiki-conventions.md` Significance Threshold section.

**A flow is significant if any:**
- Exposed to end users (HTTP route handler with side effects, CLI command, scheduled job that produces visible output).
- Spans 3+ components / files (cross-cutting process worth documenting).
- Has multiple exit states (success + ≥1 named failure mode).
- Cited by name in CONTEXT.md, README.md, or roadmap acceptance criteria.

Flow ingestion is **opt-in for the first iteration** — wiki-ingest-agent does NOT auto-create flow pages during `full` ingest. Flows are created by:
- `/loom-wiki ingest --flow <name>` — explicit flow extraction from a named entry point
- `wiki-maintainer-agent` after `/loom auto` completes a feature, if the executed plan included acceptance criteria framed as user-facing behavior

This avoids flooding brownfield projects with low-value auto-extracted flows.

**A contract is significant if any:**
- Cross-module type/schema export referenced by 2+ consumers
- HTTP route handler with request/response shape (even if implicit — auto-create one `contract-*` per significant route group)
- Event/message payload definition
- DB table with constraints used by application logic

Contract ingestion **is auto-enabled in `full` ingest** — wiki-ingest-agent will create `contract-*` pages alongside `api-surface-*` pages. The two are distinct: api-surface describes *what endpoints exist*, contract describes *what shape they enforce*.

---

## Lint Rules

Add eight new rules to `wiki-lint-rules.md`. Five for flow/contract structural integrity (W-020 through W-024) and three for context-efficiency enforcement (W-025 through W-027):

| Rule | Severity | Check | Auto-fix |
|------|----------|-------|----------|
| W-020 | warning | Flow page has < 2 steps or > 12 steps (too thin or too monolithic) | no |
| W-021 | warning | Flow step's `touches` references a file that no longer exists | flag stale |
| W-022 | warning | Contract page has `producers[]` empty AND `consumers[]` empty (orphan) | no |
| W-023 | info | Flow page lacks any `crossRefs` of relationship `exercises` (flow does nothing?) | no |
| W-024 | warning | Component page referenced by 2+ flows as `exercised-by` lacks corresponding `exercises` back-link in the flow page (one-sided ref) | yes (add back-link) |
| W-025 | warning at 1200 tokens, blocking at 2000 tokens | Page body exceeds the token cap | no |
| W-026 | warning | `summary` missing, > 200 chars, contains markdown, or required H2 sections missing for the page's category | yes (insert section stubs; user fills) |
| W-027 | warning | Flow `steps[].outcome` row > 80 chars, or contract `shape` field > 500 chars | no |

Existing W-004 (broken cross-ref) and W-006 (missing cross-ref) automatically apply to the new relationships.

---

## Agent Updates

### wiki-ingest-agent

Add a new ingest mode `flow`:
```
--flow <entry-point>     Extract a flow page starting from a named route, command, or function
```

Trace the call graph from the entry point, identifying each function call as a candidate step. Group consecutive same-layer calls into a single step. Cap at 12 steps; if more, surface as `info` issue and let the user split.

Update existing `full` ingest mode: after creating component pages, scan for significant contracts (exported types referenced by 2+ modules, route handlers with shapes) and create `contract-*` pages with `producers`/`consumers` populated from the import graph.

### wiki-maintainer-agent

Add post-execution hook: when `/loom auto` or `/loom-plan execute` completes a phase whose acceptance criteria contained user-facing verbs ("user can sign up", "request returns 201"), spawn maintainer with a `--check-flow` flag. The maintainer asks: "Does a flow page exist for this behavior? If not, propose one with the implemented files as `touches`." Output is a suggestion in the `info` issues — not auto-created (still opt-in for flows).

For contracts: on every wave completion, scan `filesCreated`/`filesModified` for files matching the contract significance threshold. Create or update the corresponding `contract-*` page automatically.

### wiki-query-agent

Add three new query intents:

| Query pattern | Intent | Response |
|---------------|--------|----------|
| "what happens when X" / "how does X work" | flow lookup | Return matching flow pages with their step list inline |
| "what's the contract for X" / "what shape does X return" | contract lookup | Return contract pages with shape and invariants inline |
| "what flows touch X" / "what depends on X contract" | impact query | Return flows + components referenced via `exercises`/`consumes` |

---

## Integrations & Hooks

The wiki already has 5 hot integration paths and 1 hook. Flows and contracts unlock new value at each — the table below maps every touchpoint and what changes.

### Read-side integrations (agents/commands that pull from the wiki)

| Touchpoint | File | Today | Update for flows/contracts |
|------------|------|-------|----------------------------|
| Rolling context `## Project Knowledge [WIKI]` block | `agents/protocols/context-budget.md`, `agents/protocols/execution-conventions.md` | Orchestrator picks "pages relevant to current wave" into a ≤1k-token slice | When wave files appear in any flow's `steps[].touches` or any contract's `producers`/`consumers`, **prefer those pages first** in the [WIKI] block. Keep the budget but rank flow/contract pages above generic component pages for the wave's file set. |
| `questioner-agent` (plan proposals) | `agents/questioner-agent.md` | Reads wiki index + selected pages; informs proposals across multiple dimensions | Add "user-facing impact" dimension: list flow-* pages whose `touches` intersect the proposed scope. Add "compatibility commitments" dimension: list contract-* pages whose `producers` or `consumers` overlap the scope. |
| `criteria-planner-agent` (acceptance criteria) | `agents/criteria-planner-agent.md` | Emits criteria with `source: wiki-history` for known regressions | Extend `source` enum with `wiki-flow` and `wiki-contract`. Auto-emit one criterion per intersecting flow (preserve exit states) and one per contract (response shape must not change). |
| `bugfix-analyst-agent` (impact assessment) | `agents/bugfix-analyst-agent.md` | Records `wikiContext[]` and `relatedWikiPages[]` | Add two new output arrays: `affectedFlows[]` (flow pageIds whose `touches` overlap the bug's diff) and `affectedContracts[]` (contracts whose `producers`/`consumers` overlap). These give the reviewer immediate user-facing impact visibility. |
| `interpretation-reviewer-agent` (conflict review) | `agents/interpretation-reviewer-agent.md` | Wiki resolutions **reduce** flagged conflict severity | Contracts work in the **opposite direction**: if a plan AC's shape contradicts a contract page, escalate to `blocking`. Add `contractConflicts[]` array to the report. |
| `/loom-bugfix` and `/loom-quick` (wiki lookup keying) | `commands/loom-bugfix.md`, `commands/loom-quick.md` | Key wiki lookup on bug/task description, scan index for matching components | When the description contains user-facing language ("user can't sign up", "checkout fails"), match flow titles first; flows then resolve to the components they exercise. Tighter root-cause hinting than component-only search. |

### Write-side integrations (when the wiki gets updated)

| Touchpoint | File | Today | Update for flows/contracts |
|------------|------|-------|----------------------------|
| Maintainer triggers | `agents/wiki-maintainer-triggers.md` | 6 triggers: wave complete, code review finished, fix cycle, convergence iteration, human gate, plan revision | Add 7th trigger: **feature with user-facing AC completes** → spawn maintainer with `--check-flow` to *propose* (not auto-create) flow pages for the new behavior. |
| `/loom-auto` post-execution wiki update | `commands/loom-auto.md` (line ~582) | Spawns wiki-maintainer-agent post-execution; circuit-breaker on 2 consecutive failures | No change to the orchestration logic. The maintainer itself becomes contract-aware (auto-creates `contract-*` from wave's filesCreated/filesModified per the Agent Updates section). |
| `/loom-code` post-review wiki update | `commands/loom-code.md` (line ~479) | Spawns wiki-maintainer-agent after fixes to capture decisions | If review identified a contract violation (shape drift, missing invariant), maintainer creates a `decision-*` page **and** updates the relevant `contract-*` page's `invariants[]`. |
| `/loom-init` brownfield discovery | `commands/loom-init.md`, `agents/api-explorer.md` | api-explorer produces endpoint inventory → wiki-ingest-agent creates `api-surface-*` pages | api-explorer additionally emits contract candidates: any route handler with a typed request/response shape becomes a `contract-*` candidate. wiki-ingest-agent's `full` mode (already in Phase 1) creates them. |

### Hooks

| Hook | File | Current behavior | Change needed |
|------|------|------------------|---------------|
| `wiki-write-guard` (PreToolUse) | `hooks/wiki-write-guard.ts` | Blocks non-wiki-agents from writing `.loom/wiki/` during active execution; fail-open | **No change.** The four-agent allowlist is sufficient. Per-category write authority (e.g., only ingest can create contracts) is not worth the complexity for this iteration. |
| `context-budget` (PreToolUse) | `hooks/context-budget.ts` | Estimates token budget before agent spawn; blocks if over cap | **Light enhancement:** when the orchestrator packs flow `steps[]` or contract `shape` into rolling-context, treat each as an atomic block — never truncate mid-step or mid-shape. Add a note in `agents/protocols/context-budget.md` describing the atomicity rule for these structured fields. |
| `quality-gate` (PostToolUse) | `hooks/quality-gate.ts` | Runs verification gates after writes | Future plan: a contract-drift check — if a wave touched files in a contract's `producers`/`consumers`, verify the contract's `shape` still matches the code. **Out of scope for this plan**; called out as a follow-on. |

### Rolling-context ranking heuristic

When the orchestrator builds the `[WIKI]` section of `rolling-context.md`, apply this priority order within the ≤1k-token budget. **Pack `summary` strings first** (cheap, ~50 tokens each) then expand to bodies only for the top-1 page in each tier until budget exhausted:

1. **Flow pages** where `steps[].touches` intersects the wave's file ownership set.
2. **Contract pages** where `producers[]` or `consumers[]` intersects the wave's files.
3. **Decision pages** referenced by the above flows/contracts via `implements`.
4. **Component pages** for the wave's files (current behavior).
5. **Convention/pattern pages** matching the wave's domain.

This is the highest-leverage integration change in this plan — every execution agent benefits without any agent-prompt edit, because rolling-context content is owned by the orchestrator. The `summary` + `estimatedTokens` fields make this packing decision O(1) per page (read from `index.toon`, no body reads).

---

## Karpathy + Wiki Discipline Integration

The Karpathy CLAUDE.md block (`<!-- loom:karpathy-v1 -->`) ships universal coding-behavior principles but is wiki-blind. This section adds a separate, conditional block — `## Loom Wiki Discipline` — that operationalizes each Karpathy principle against the wiki when one exists.

**Design:** two independent blocks, two markers, two migration rules. Karpathy stays universal (drop-in for any repo); wiki-discipline ships only when `.loom/wiki/` exists in the project.

### CLAUDE.md `## Loom Wiki Discipline` block (verbatim)

```markdown
## Loom Wiki Discipline

This project has a Loom wiki at `.loom/wiki/`. The wiki is the authoritative source for prior decisions, contracts, flows, and conventions. Consult it before assuming or proposing.

**Before stating an assumption** (per Coding Behavior § Think Before Coding): check `/loom-wiki query "<topic>"` for prior decisions or contracts that resolve it. If a `contract-*` page defines the shape your work depends on, that page is authoritative — the code's current behavior may be the bug.

**Before introducing a new pattern or abstraction** (per § Simplicity First): check `pattern-*` and `convention-*` pages. If a pattern already exists, follow it. If none fits, your new pattern should be documented as you go.

**Before changing a file** (per § Surgical Changes): check whether it's referenced by any `flow-*` page's `steps[].touches` or any `contract-*` page's `producers` / `consumers`. Changes there have user-visible or cross-boundary impact — call it out in your response.

**For user-facing tasks** (per § Goal-Driven Execution): the matching `flow-*` page IS the goal definition. Its `exitStates` are the success criteria. For changes to API or event surfaces, the matching `contract-*` page's `shape` is the goal — preserve it unless the task explicitly says to break it.

If the relevant wiki page is missing or stale, say so in your response — don't silently work around it.

<!-- loom:wiki-discipline-v1 — managed by /loom upgrade. Edit text freely; preserve this marker. -->
```

### Source-of-truth location

The verbatim block lives in `agents/project-guidance-agent.md` Section Template, alongside the existing Coding Behavior block. The agent emits both blocks in newly-generated `CLAUDE.md` files **only when `.loom/wiki/` exists** at the project root. If no wiki, emit only the Coding Behavior block.

### Validation

Add to project-guidance-agent.md Phase 3 Validate checklist:
- If `.loom/wiki/` exists at project root, the generated CLAUDE.md must end with the `<!-- loom:wiki-discipline-v1 -->` marker following the `<!-- loom:karpathy-v1 -->` marker.
- The two blocks appear in fixed order: Coding Behavior first, Loom Wiki Discipline second.

---

## Wiki Maintenance Enforcement

Flows and contracts will rot without active maintenance. Four mechanisms, ordered by ROI:

### 1. SessionStart wiki health surfacing (new hook)

**File:** `hooks/wiki-session-status.ts` (new), event `SessionStart`.

**Behavior with explicit silence thresholds:**
- Detect `.loom/wiki/` existence. If absent, exit silently.
- Detect `LOOM_WIKI_HOOKS=0` environment variable. If set, exit silently (global session-scope escape hatch — see § Hook noise control below).
- Read `.loom/wiki/index.toon` (cheap — header only).
- Compute: total page count `N`, stale page count `M`, days-since-last-ingest `D` (from `log.toon` last entry).
- Apply silence thresholds:
  - **Fully healthy** (`M == 0` AND `D < 7`): emit nothing.
  - **Light reminder** (`M == 0` AND `D < 14`): emit a single subdued `[wiki] {N} pages — last ingest {D}d ago` line.
  - **Attention required** (`M > 0` OR `D >= 14`): emit `[wiki:attention] {N} pages | {M} stale | last ingest {D}d ago` plus a concrete remediation suggestion: `→ Run /loom-wiki refresh to fix the {M} stale pages.` (when M > 0) or `→ Run /loom-wiki ingest --diff to pick up recent changes.` (when D >= 14 but M == 0).
- **Auto-lint cadence:** if `D > 14`, additionally spawn `wiki-lint-agent` with `--silent` mode in the background. Lint output is queued as a **bounded one-line finding count** (`[wiki:lint] N issues — /loom-wiki lint for details`) appended to the next user response. Lint never blocks, never modifies files in `--silent` mode, and never emits a full report — only the count and the remediation command.

**Fail-open:** if `index.toon` is missing or unreadable, log a single line and exit; never block session start.

### 2. Auto-lint cadence on session start

Extended behavior of the same SessionStart hook: if `D > 14` (days since last ingest), spawn `wiki-lint-agent` with `--silent` mode in the background. Its findings (if any) are appended to a non-blocking notification in the next user response. Lint never blocks; never modifies files in `--silent` mode.

This means a wiki that's been actively maintained shows a quiet `[wiki] 47 pages | 0 stale | last ingest 3d ago` line and nothing else. A neglected wiki surfaces the lint findings the user has been ignoring.

### 3. `/loom status` wiki health block

Extend `commands/loom-status.md` to include a wiki section when `.loom/wiki/` exists:

```
Wiki Health:
  Pages:           47 (12 component, 8 flow, 5 contract, ...)
  Coverage:        82% of significant files have component pages
                   60% of public routes have contract pages
                   N/A flows are opt-in (no auto-coverage metric)
  Stale pages:     3
  Days since lint: 2
  Days since last ingest: 3
```

Coverage % is computed lazily — only when `/loom status` is invoked. Significance is the same set defined in `wiki-conventions.md`.

### 4. Hook A: `wiki-impact-warner` (PreToolUse on `Edit` / `Write`)

Only one hook ships in this plan. Hook B (`wiki-context-suggester` / UserPromptSubmit) is **deferred to a sequel plan** — see Out of Scope deferrals above. Reason: Hook B is fuzzy pattern-matched and needs real-prompt calibration data that doesn't exist yet; the audit log from Hook A's ≥100 sessions is the trigger for Hook B's sequel.

- **Confidence:** Deterministic (graph walk over wiki cross-refs).
- **Fires when:** About to modify a file referenced by any flow's `steps[].touches` or contract's `producers` / `consumers` / `shapeFiles`.
- **Behavior:**
  1. Read `index.toon` to map filePath → pageIds.
  2. Check session-scope dedup state (`.plan-execution/ephemeral/wiki-impact-session.toon` — list of files already surfaced this session). If this file already fired in this session, skip silently (notify-once-per-file-per-session default).
  3. Check global session throttle (see Hook noise control below). If throttled, increment counter and skip surface.
  4. If the file appears in any flow or contract, emit a one-line `[wiki:impact]` notification with the affected pageIds and a one-clause-each summary. Append file to the dedup state.
  5. Allow the edit by default; never block.
  6. If `orchestration.toml [wiki].impactAck = "require"` is set, emit the impact line in a special `[wiki:impact:ack-required]` form that prompts the AI to ask the user for explicit confirmation before proceeding. The AI handles the user-facing acknowledgment (the hook itself only emits the prompt-instruction string to stdout).
- **Why this one ships first (and alone):** zero false positives — the cross-ref graph either contains the file or doesn't. Low noise. Per-file dedup makes it suitable for tight edit-test-fix loops.

### Hook noise control (defaults, all wiki hooks)

Mechanisms to prevent the "nag stack" of three wiki hooks firing in rapid succession:

| Mechanism | Default | Override |
|-----------|---------|----------|
| Per-file-per-session dedup on `wiki-impact-warner` | On (notify once per unique file per session) | `orchestration.toml [wiki].impactDedup = "off"` to fire every edit |
| Combined session throttle | If 2+ wiki signals fired in last 5 minutes, collapse subsequent ones to a count reference (`[wiki] +N additional signals — /loom-wiki status for details`) | `orchestration.toml [wiki].sessionThrottle = false` |
| Session-scope escape hatch via env-var | `LOOM_WIKI_HOOKS=0` silences ALL wiki hooks for the current shell session — no config edit required | Unset/empty env-var = normal behavior |
| Per-hook config disables | `orchestration.toml [wiki].sessionStatusEnabled` (default true), `[wiki].impactAck` (default `notify`, alt `require`) | n/a |

The env-var (`LOOM_WIKI_HOOKS=0`) is the **standard developer escape hatch** — modeled on `git --no-verify` and `husky SKIP_HOOKS` — and is the recommended mechanism for tight flow-state work. It does NOT persist across sessions.

Dedup state file (`.plan-execution/ephemeral/wiki-impact-session.toon`) is wiped on session start by `wiki-session-status` and never persists beyond a single session.

### 5. `/loom-wiki refresh` — targeted stale-page refresh

Today the closest thing to a stale-refresh command is `/loom-wiki ingest --full`, which rewrites every page (including fresh ones — expensive on large wikis). There's no single command that says "fix only what's stale." This subcommand closes that gap and becomes the natural remediation target for SessionStart's auto-lint suggestion ("Run /loom-wiki refresh to fix {N} stale pages").

**New subcommand:** `/loom-wiki refresh [flags]`

**Behavior:**

1. Read `.loom/wiki/index.toon`. Collect candidate pages:
   - Pages with `staleness == "stale"` (default).
   - Pages where any `sourceRefs[]` file has an mtime newer than the page's `updatedAt`.
   - Pages with `summary == "(legacy — pending refresh)"` (left over from a prior `/loom upgrade` Rule 7 migration).
2. For each candidate, in batches of 5 to respect token budget:
   - Re-run the ingest logic scoped to the page's `sourceRefs`. This is equivalent to invoking `wiki-ingest-agent` with `--source <files>` for each page individually but batched into one agent spawn.
   - Recompute `summary` (real elevator pitch, replacing any legacy placeholder), `estimatedTokens` (`Math.ceil(charCount / 4)`), `staleness` (now `fresh`), and `updatedAt` (now).
   - Update body sections per the required H2 structure for the page's category.
3. After all candidates: rebuild cross-refs for the affected pages and run `wiki-lint --fix` to repair any one-sided refs introduced by the refresh.
4. Append a single log entry to `.loom/wiki/log.toon` recording the refresh operation with the list of refreshed pageIds.
5. Print a summary:
   ```
   [wiki:refresh] Refreshed: 8 pages | Skipped (fresh): 39 | Failed: 0
     Refreshed: component-auth-middleware, flow-user-signup, contract-user-create, ...
     Lint after: 0 blocking, 0 warning, 2 info
   ```

**Flags (collapsed from 6 to 5, no illegal combinations):**

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | List candidates and report estimated time (`N pages / 5 per batch = ~M agent spawns; expected ~T minutes`); exit without writing. |
| `--scope <kind>` | `stale` | One of: `stale` (default — staleness=stale OR sourceRef-newer), `aging` (also include `staleness=aging`), `legacy` (only `(legacy — pending refresh)` placeholders), `all` (every page). Mutually exclusive — no illegal combinations. |
| `--page <pageId>` | — | Refresh a single specific page by pageId. Targeted remediation for the SessionStart hook's named-page surfacing. Overrides `--scope`. |
| `--category <name>` | all | Restrict refresh to pages of a specific category (`component`, `flow`, `contract`, etc.). Combines with `--scope`. |
| `--max <N>` | unlimited | Cap how many pages to refresh in this invocation. Useful for huge wikis or low-budget sessions; the remainder is left for a follow-up invocation. |

`--force` removed; use `--scope all` instead. `--include-aging` and `--include-legacy` collapsed into `--scope` enum. The combinations `--scope all` AND `--page <pageId>` are mutually exclusive (`--page` takes precedence with a warning).

**Progress output:** every 5 pages refreshed, emit a progress line `[wiki:refresh] 10/80 pages refreshed — current: component-X`. Long runs without progress signal force the user to wait blindly. The final summary remains as previously specified but the inline refreshed-page list is capped at 5 entries with `+ N more — see .loom/wiki/log.toon` for the overflow.

**Failure semantics:**

- If refreshing a single page fails, record it and continue with the rest. Final summary reports failures.
- If the underlying agent spawn exceeds the 100k token budget, refresh in smaller batches; the budget reviewer enforces this preflight.
- `/loom-wiki refresh` is **non-blocking** — it never fails the surrounding workflow. Wiki health is additive, never gating.

**Source-of-truth location:** add to `commands/loom-wiki.md` as a new subcommand alongside `ingest`, `lint`, `query`, `status`. The implementation reuses `wiki-ingest-agent` with explicit `--source` scoping per page; no new agent.

### Hook ordering and budget impact

Both new hooks read from `index.toon` only — they never read page bodies. Index reads are cheap (<2k tokens for a 100-page wiki). Worst case impact on context budget is the appended summaries (max ~5 pages × 200 chars = 1k chars ≈ 250 tokens per prompt). This is well within the 100k per-agent cap defined in `agents/protocols/context-budget.md`.

The SessionStart hook's stale-page suggestion now points at a concrete command:
```
[wiki:attention] 47 pages | 3 stale | last ingest 18d ago
  → Run /loom-wiki refresh to fix the 3 stale pages.
```

---

## /loom upgrade Migration (Rule 7)

Add Rule 7 to `agents/protocols/schema-upgrade.md`:

**Detection rule:**
```
"wiki-index": (file = .loom/wiki/index.toon)
  if content lacks "schemaVersion: 2" AND `.loom/wiki/` exists → outdated, reason: "wiki-index v1 — no flow/contract categories"
```

**Migration:**
- Read existing `.loom/wiki/index.toon`.
- Bump `schemaVersion: 1` → `schemaVersion: 2`. If no `schemaVersion` field exists at all (ancient wikis), insert `schemaVersion: 2` as the first line.
- If `categories[]` array exists: add `flow,0` and `contract,0` rows if not present.
- **If `categories[]` array does NOT exist at all** (very legacy wikis): create the full array by scanning `.loom/wiki/pages/` and counting pages per category prefix. Include `flow,0` and `contract,0` rows.
- Add `summary` and `estimatedTokens` columns to the `pages[N]{...}:` typed-array header if present. For each existing page row, populate `summary: "(legacy — pending refresh)"` and `estimatedTokens: <computed from page file char count>`. Computed estimatedTokens is cheap (one stat + filesize / 4 per page).
- For each page file in `.loom/wiki/pages/`: read frontmatter only (not body), check if `summary` and `estimatedTokens` are present. If missing, write them back into the page's TOON frontmatter with the same legacy placeholder for `summary` and computed value for `estimatedTokens`. Atomic write per page.
- Append a log entry to `.loom/wiki/log.toon` recording the schema upgrade.
- Do NOT create any flow or contract pages during migration — those are populated by `wiki-ingest-agent` on next ingest.
- Idempotent: if `schemaVersion: 2` is already present AND all pages already have the new fields, skip.

**W-026 lint carve-out for legacy placeholder:** the lint rule treats `summary: "(legacy — pending refresh)"` as a deferred-fix marker rather than an immediate warning. It surfaces an `info`-severity finding (not warn) until the page is next written by an agent — at which point the agent must generate a real summary and the marker must be replaced. This prevents post-migration W-026 flooding.

**No-wiki case:** if `.loom/wiki/` does not exist, this rule does not apply.

Update `commands/loom-upgrade.md` scan list and migration rules list to include Rule 7. Bump artifact-type count from 6 to 7.

## /loom upgrade Migration (Rule 8) — CLAUDE.md wiki-discipline block

Add Rule 8 to `agents/protocols/schema-upgrade.md`:

**Detection rule:**
```
"claude-md-wiki-discipline": (file = CLAUDE.md)
  if `.loom/wiki/` exists at project root
  AND content lacks "<!-- loom:wiki-discipline-v" marker
  AND content already contains "<!-- loom:karpathy-v" marker (Rule 6 must have run first)
  → outdated, reason: "wiki exists but CLAUDE.md lacks Loom Wiki Discipline block"
```

**Migration:**
- Append the `## Loom Wiki Discipline` block (verbatim from `agents/project-guidance-agent.md` Section Template) at the end of `CLAUDE.md`, immediately after the existing `<!-- loom:karpathy-v1 -->` marker block.
- Preserve all existing content. Do not reorder, reformat, or alter any other section.
- Idempotent: if the `<!-- loom:wiki-discipline-v1 -->` marker is already present, skip.

**Manual-merge guard:** if the file contains a `## Loom Wiki Discipline` heading but no marker, do NOT append. Record this file with status `skipped` and details `Loom Wiki Discipline section present without marker — manual merge required.`

**Order dependency:** Rule 8 must run AFTER Rule 6 in a single `/loom upgrade` pass. The scan list should list `CLAUDE.md` once but the migration phase applies Rule 6 then Rule 8 sequentially to the same file. This keeps the two blocks in stable order (Coding Behavior first, Wiki Discipline second).

**No-wiki case:** if `.loom/wiki/` does not exist, Rule 8 does not apply (only Rule 6 fires for CLAUDE.md).

**No-CLAUDE.md case:** if `CLAUDE.md` does not exist, Rule 8 does not apply (`/loom init` should be run instead).

Update `commands/loom-upgrade.md` migration rules list to include Rule 8. Bump artifact-type count from 7 to 8.

## /loom upgrade Migration (Rule 9) — settings.json hook registration

The three new hooks (`wiki-session-status`, `wiki-impact-warner`, `wiki-context-suggester`) ship as files in `hooks/` and are registered by `/loom init` going forward. Existing repos that ran `/loom init` *before* this change will have the hook files installed (via Loom updates) but no entries in their `.claude/settings.json` — so the hooks never fire. Rule 9 closes this gap.

**Detection rule:**
```
"settings-hooks": (file = .claude/settings.json or .claude/settings.local.json)
  if `.loom/wiki/` exists at project root
  AND settings file exists
  AND for each hook entry, the corresponding .ts file at hooks/<name>.ts EXISTS on disk
    (file-existence guard — prevents registering hooks against missing files
     during the Phase 0 → Phase 4 deployment window)
  AND settings file lacks any of:
    - SessionStart hook entry for wiki-session-status (only if hooks/wiki-session-status.ts exists)
    - PreToolUse hook entry (matcher Write|Edit) for wiki-impact-warner (only if hooks/wiki-impact-warner.ts exists)
  → outdated, reason: "Wiki hooks not registered"
```

**Note:** Hook B (`wiki-context-suggester`) is deferred to a sequel plan. Rule 9 only registers Hook A (`wiki-impact-warner`) and the SessionStart hook (`wiki-session-status`). If a future plan ships Hook B, it gets a Rule 9.1 (or a separate rule) at that time.

**Migration (with user confirmation):**

Settings files are user-controlled configuration — they may contain personal hooks, environment variables, or non-Loom settings. The migration MUST NOT silently modify them. Behavior:

1. Detect missing hook entries (as above).
2. Print the proposed additions to stdout in human-readable form:
   ```
   [loom:upgrade] Wiki hooks need registration in .claude/settings.json:
     + SessionStart: wiki-session-status (status line + auto-lint)
     + PreToolUse:   wiki-impact-warner (deterministic file-impact surfacing)
     + UserPromptSubmit: wiki-context-suggester (fuzzy prompt-context injection)

   Register these hooks? (y/N — declining keeps the hook files installed but inert)
   ```
3. If user declines: record status `skipped` with details `User declined hook registration. Re-run /loom upgrade --register-hooks to revisit.` Continue with remaining rules.
4. If user accepts: parse the settings JSON, append the hook entries to the `hooks` section, preserve all other settings, write atomically.
5. Prefer `.claude/settings.json` (project-scoped) over `.claude/settings.local.json`. If both exist, ask which to modify.
6. Idempotent: if all three hook entries are already present, skip.

**Configuration block added (verbatim, this plan):**
```json
"hooks": {
  "SessionStart": [
    {"hooks": [{"type": "command", "command": "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-session-status.ts", "timeout": 5000}]}
  ],
  "PreToolUse": [
    {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-impact-warner.ts", "timeout": 3000}]}
  ]
}
```

(The `UserPromptSubmit` entry for `wiki-context-suggester` is added by the sequel plan when Hook B is calibrated and ready to ship.)

If the user's existing `hooks` block already contains entries with different matchers, merge intelligently — don't clobber.

**No-wiki case:** if `.loom/wiki/` does not exist, Rule 9 does not apply.

**`--force` flag interaction:** `/loom upgrade --force` skips the confirmation prompt for Rule 9 and applies the change automatically. Document this in `commands/loom-upgrade.md`.

Update `commands/loom-upgrade.md` migration rules list to include Rule 9. Bump artifact-type count from 8 to 9. Add the `--register-hooks` flag described above.

## Rule application order

`/loom upgrade` applies rules within a single pass in **numeric order per file**. This ensures:

- CLAUDE.md gets Rule 6 (Karpathy) applied before Rule 8 (Wiki Discipline), keeping the two blocks in stable order.
- `.loom/wiki/index.toon` and `.loom/wiki/pages/*.md` get Rule 7 transformations applied before any agent reads the wiki under the new schema.
- Rule 9 (settings) runs last per file, since it requires user confirmation and shouldn't block earlier silent migrations.

The scan-phase (Step 1) collects per-file rule lists; the migrate-phase (Step 5) iterates files and applies their rule list in numeric order, atomically writing once per file (per rule) so a failure at Rule N doesn't roll back Rule N-1.

**Failure semantics:**
- Rule N fails on file F → record failure, continue to Rule N+1 on file F (rules are independent).
- File-write failure during Rule N → leave file untouched, record failure, continue.
- Re-running `/loom upgrade` after partial failure will re-detect missing migrations and complete them.

---

## Phases

**Wave 0 — Shared Contracts (1 agent)**

This wave establishes the canonical type contracts that every downstream parallel agent codes against. Without this, parallel Wave 1 agents would clobber each other's enum and field definitions. Single-agent ownership to eliminate merge risk on three tightly-coupled schema files.

- Lock canonical enums: `flowType` (5 values), `contractType` (7 values), all 8 new cross-ref relationships with direction/inverse.
- Lock new frontmatter fields and constraints: `summary` (≤200 chars), `estimatedTokens` (computed), `bodySections`, `nextOnFail`, `errorExits[]`, `shapeFiles[]`, `compatibilityPolicy`, `deprecatedAt`, `replacedBy`, `breakingChanges[]`.
- Bump `wiki-index.toon` schemaVersion 1 → 2 with extended `pages[N]` typed-array columns.
- **Files owned (exclusive to this wave):** `agents/protocols/wiki-page.schema.md`, `agents/protocols/wiki-conventions.md`, `agents/protocols/wiki-index.schema.md`.

**Phase 0 — Upgrade machinery (Wave 1, Agent A — parallel with Phase 1, Phase 2)**
- Add Rules 7, 8, and 9 to `agents/protocols/schema-upgrade.md`, with explicit rule-order-per-file semantics and failure handling.
- Update `commands/loom-upgrade.md`: scan list + migration rules list + artifact-type count → 9 + new `--register-hooks` flag. Insert a `<!-- Phase 3: fill Rule 8 prose here -->` stub-marker in the Rule 8 entry so a downstream agent can fill behavioral detail without conflict.
- Rule 7 handles three legacy edge cases: missing `schemaVersion`, missing `categories[]`, backfilling `summary` placeholder + `estimatedTokens` on existing pages.
- Rule 9 includes the file-existence guard (only registers a hook if its `.ts` file exists on disk).
- **Files owned (exclusive):** `agents/protocols/schema-upgrade.md`, `commands/loom-upgrade.md`. Does NOT touch `wiki-lint-rules.md` (Phase 2 owns it).

**Phase 1 — Agent updates + Karpathy CLAUDE.md (Wave 1, Agent B — parallel with Phase 0, Phase 2)**
- Add `--flow <entry-point>` mode to `wiki-ingest-agent.md` (extraction from entry point).
- **Add `--contract <file-or-route>` mode** to `wiki-ingest-agent.md` (symmetric to `--flow`; extracts contract candidates from a specific file).
- Update `full` ingest to auto-create contract pages and populate `summary` + `estimatedTokens` for every page write.
- Update existing wiki agents to recompute `summary` and `estimatedTokens` on every page write. Real summaries replace any `(legacy — pending refresh)` placeholders.
- Add per-page batched refresh logic to `wiki-ingest-agent.md` (reused by `/loom-wiki refresh`).
- Add post-execution `--check-flow` hook to `wiki-maintainer-agent.md`.
- Add new query intents to `wiki-query-agent.md`.
- **Update `agents/project-guidance-agent.md` Section Template** to emit the `## Loom Wiki Discipline` block conditional on `.loom/wiki/` existence (moved from former Phase 3 — this is the only place this file is touched). Update Phase 3 Validate to check both Karpathy and Wiki Discipline markers in order.
- **Files owned (exclusive):** `agents/wiki-ingest-agent.md`, `agents/wiki-maintainer-agent.md`, `agents/wiki-query-agent.md`, `agents/project-guidance-agent.md`.

**Phase 2 — Lint rules + lint agent (Wave 1, Agent C — parallel with Phase 0, Phase 1)**
- Add W-020 through W-024 (flow/contract structural integrity) to `wiki-lint-rules.md`.
- Add W-025 through W-027 (body cap, summary/section enforcement, field-length caps) to `wiki-lint-rules.md`.
- **Document the W-026 carve-out for `(legacy — pending refresh)` placeholder directly in the W-026 rule row** (Phase 0 does NOT touch this file).
- Update `wiki-lint-agent.md` to implement all eight new checks. W-026 has auto-fix (insert missing H2 section stubs); others are warn-only.
- **Files owned (exclusive):** `agents/protocols/wiki-lint-rules.md`, `agents/wiki-lint-agent.md`.

**Wave 1 gate (blocking — see Testing Strategy below):** before proceeding to Wave 2, three gates must pass:
1. **AC-05 (extraction quality)** — run `/loom-wiki ingest --flow <real-route>` against an actual route in this repo; hand-review the produced page. Verb-led step names, accurate `touches` (no missing or fabricated files), correct `exitStates`, ≤12 steps. **This is the highest-uncertainty deliverable; if extraction is bad, halt and re-spec before lint rules lock around bad output.**
2. **Rule 7 dogfood** — run migration on this repo's `.loom/wiki/`. Confirm three legacy edge-case branches produce valid output.
3. **All Wave 1 unit tests pass** — vitest L1 layer (see Testing Strategy).

**Phase 2.5 — Integration plumbing (Wave 2, depends on Wave 1 complete)**

Hidden dependency declared: this phase reads `summary` + `estimatedTokens` from `index.toon`, which Phase 1's agents populate. The rolling-context packer must handle absent `estimatedTokens` defensively (fall back to inline char-count estimation) for brownfield repos that haven't yet run `/loom upgrade`.

Sub-phases for intra-wave parallelization:

- **Phase 2.5a:** Rolling-context ranking + packing logic. `agents/protocols/context-budget.md` (atomicity rule + summary-first packing strategy). Foundation for 2.5b/c.
- **Phase 2.5b (parallel after 2.5a):** 6 agent prompt expansions — `agents/questioner-agent.md`, `agents/criteria-planner-agent.md`, `agents/bugfix-analyst-agent.md`, `agents/interpretation-reviewer-agent.md`, `agents/wiki-maintainer-triggers.md`, `agents/api-explorer.md`. Each independent of the others.
- **Phase 2.5c (parallel with 2.5b):** Command keying — `commands/loom-bugfix.md`, `commands/loom-quick.md`.
- **Phase 2.5d (parallel with 2.5b/c):** Fill the Rule 8 stub-marker in `commands/loom-upgrade.md` left by Phase 0. Verify Rule 6 → Rule 8 sequencing.

**Phase 4 — Wiki maintenance hooks + `/loom status` + `/loom-wiki refresh` (Wave 3)**

Sub-phases for sequenced hook rollout:

- **Phase 4a (independent):** Implement `hooks/wiki-session-status.ts` (SessionStart) and `hooks/wiki-impact-warner.ts` (PreToolUse) with all noise-control defaults (per-file dedup, session throttle, `LOOM_WIKI_HOOKS=0` escape). Add `commands/loom-wiki.md` `refresh` subcommand. Update `commands/loom-status.md` with the wiki health block (with green/amber/red coverage thresholds).
- **Phase 4b:** Register the two hooks (SessionStart + PreToolUse only — Hook B deferred) in `package.json` / settings template. Add `orchestration.toml [wiki]` settings: `impactAck`, `impactDedup`, `sessionThrottle`, `sessionStatusEnabled`.

(`hooks/wiki-context-suggester.ts` — Hook B — is **deferred to a sequel plan** per Out of Scope deferrals above.)

**Phase 5 — Tests & dogfood (Wave 3)**
- Vitest tests for all eight new lint rules.
- Vitest tests for the two new hooks (mocked SessionStart, mocked Edit).
- Vitest tests for Rule 7 + Rule 8 + Rule 9 schema upgrade idempotency, including the Rule 9 file-existence guard.
- Run `/loom upgrade` on this repo to migrate wiki-index to v2 AND append the Loom Wiki Discipline block to this repo's CLAUDE.md.
- Hand-author one `flow-*` page (with `nextOnFail` + `errorExits[]` populated) and one `contract-*` page (with `compatibilityPolicy` populated) as a smoke test of the rolling-context ranking heuristic and the new schema fields.

---

## Testing Strategy

Tests are organized in four layers. The AC table below ties each acceptance criterion to its test layer and the wave gate it must pass before.

### Test layers

| Layer | What it proves | How | Risk |
|-------|---------------|-----|------|
| **L1 — Unit (vitest)** | Schemas parse, lint rules fire correctly, migration rules are idempotent, hooks emit expected stdout on mocked events | vitest with synthetic fixtures (good page + bad page per rule) | Low — deterministic |
| **L2 — Integration** | Multi-agent / multi-file flows work end-to-end | vitest with real file I/O + mocked agent spawns, OR scripted multi-step sequences | Medium — relies on agent contracts holding |
| **L3 — Dogfood** | The system works on a real codebase | Run on this repo (loom-ai) and verify outcomes by hand-review | Medium — single-repo bias; supplement with one external-repo run before ship |
| **L4 — Behavioral observation** | The system actually changes agent behavior in the intended way | Post-ship audit logs + before/after benchmarks | **High — not gate-able pre-ship** |

### AC-to-layer mapping

```toon
testLayers[4]{layer,acs}:
  L1-unit,"AC-07, AC-13, AC-15, AC-17, AC-18, AC-21, AC-22, AC-23, AC-25, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-36"
  L2-integration,"AC-09, AC-11, AC-14, AC-24, AC-26, AC-34"
  L3-dogfood,"AC-04, AC-05, AC-06, AC-08, AC-10, AC-20, AC-27, AC-35"
  L4-behavioral,"(not gate-able; observed post-ship via audit logs)"
```

### Five critical "does the flow work?" tests

These are the gates that prove the headline `flow-*` feature delivers value. If any fail, halt and re-spec — they cover the highest-uncertainty surfaces.

| # | Test | Layer | AC | Failure means |
|---|------|-------|----|----|
| 1 | **Round-trip parse**: hand-authored `flow-*` page with `nextOnFail` + `errorExits[]` parses cleanly; lint W-020/W-021/W-023/W-024 fire on synthetic bad inputs (0 steps, broken `touches`, missing `exercises`, one-sided cross-ref) | L1 | AC-28, AC-07 | Schema is wrong; redesign before agents write any pages |
| 2 | **Extraction quality**: `/loom-wiki ingest --flow <real-route>` against an actual route in this repo. Hand-review for verb-led steps, accurate `touches`, correct `exitStates`, ≤12 steps | L3 | AC-05 | Plan's central feature doesn't work; HALT before locking lint rules around bad output |
| 3 | **Cross-ref bidirectionality**: flow `exercises` component → wiki-maintainer creates `exercised-by` back-ref; deleting the flow cleans up the back-ref | L2 | (extends AC-24) | Cross-ref graph is broken; impact-warner and bugfix-analyst can't trust it |
| 4 | **Rolling-context ranking lands**: simulated wave with files in a flow's `touches` produces a `[WIKI]` block where the flow's `summary` appears ranked above generic component pages, and summaries pack before bodies expand | L2/L3 | AC-09 | Wave 2's primary value isn't delivered |
| 5 | **Legacy migration**: `/loom upgrade` on a fixture wiki representing each legacy edge case (missing schemaVersion, missing categories[], populated pages without summary). Rule 7 backfills `(legacy — pending refresh)` + `estimatedTokens`. Re-run is idempotent. Mid-rule failure → re-run completes without rollback | L3 | AC-22, AC-25 | Existing repos can't upgrade safely; legacy users break |

**Test #2 is the single most important gate.** Extraction algorithm has the most uncertainty (call-graph tracing through dynamic dispatch, middleware chains, decorators). If `--flow` can't produce useful pages on a known route, every downstream feature falls apart — every lint rule, every ranking heuristic, every hook depends on accurate flow pages. Run this gate before locking Phase 2's lint rules.

### Behavioral observation (not gate-able pre-ship)

Real but not testable before merge. Track post-ship:

| What | How to observe | Trigger to revisit |
|------|---------------|--------------------|
| **Flow extraction usefulness over time** | Hand-review every flow page authored in the first month against the actual code path | If >20% of auto-extracted flows need rework, re-spec the extraction heuristics |
| **Hook A noise / false-positive rate** | Audit log at `.plan-execution/ephemeral/wiki-impact-session.toon` + session-summary append to `.loom/wiki/log.toon` after each session | If users disable via `LOOM_WIKI_HOOKS=0` in >30% of sessions, tighten dedup defaults |
| **Karpathy + Wiki Discipline behavioral effect** | 10-task before/after benchmark on ad-hoc Claude Code work in a Loom-init'd repo. Did the AI consult the wiki? Did it surface contract conflicts? | Revisit after 1 month; if no measurable behavior change, the discipline block isn't pulling its weight |
| **Hook B sequel-plan trigger** | Hook A audit log size + precision metrics | When ≥100 sessions of audit data exist, decide on Hook B regex pattern list using real prompt examples |
| **EA/PM end-state delivery** | Whether an EA/PM agent (not yet built) actually uses the wiki to challenge assumptions | Tracked against longer-term roadmap, not this plan |

### Test execution by wave gate

| After | Gate criteria | Failure means |
|-------|---------------|---------------|
| **Wave 0** | All schema files parse; new enums/relationships exist and conform to spec; manual review of `wiki-page.schema.md` confirms `flow-*` and `contract-*` field tables present with all new fields (`nextOnFail`, `errorExits[]`, `compatibilityPolicy`, `deprecatedAt`, `replacedBy`, `breakingChanges[]`, `shapeFiles[]`, `subtype`) | Don't spawn Wave 1 agents — fix contracts first |
| **Wave 1** | Critical Test #1 (round-trip parse + lint) + Critical Test #2 (extraction quality on a real route) + Critical Test #5 (legacy migration) + all L1 unit tests for W-020 through W-027 pass | MVP slice not shippable; HALT before locking schemas around bad extraction |
| **Wave 2** | Critical Test #3 (cross-ref bidirectionality) + Critical Test #4 (rolling-context ranking) + L2 integration tests for `bugfix-analyst-agent` `affectedFlows[]`/`affectedContracts[]` and `interpretation-reviewer-agent` contract-conflict escalation | Wave 2 value not delivered; cross-cutting integrations broken |
| **Wave 3** | L1 hook tests (mocked SessionStart, mocked PreToolUse Edit/Write with dedup state) + L3 dogfood: hooks enabled on this repo for 5 consecutive sessions without user `LOOM_WIKI_HOOKS=0` opt-out | Hooks not safe to enable by default |
| **Ship** | All 36 ACs pass + this repo runs cleanly with the new system enabled for 1 week + one external-repo dogfood (run `/loom upgrade` + `--flow` against a non-Loom repo with a wiki) | Roll back to pre-flow state; re-evaluate scope |

### Test infrastructure expectations

- All vitest tests live alongside existing patterns (`hooks/__tests__/*.test.ts`).
- Synthetic fixtures for lint and migration tests live under `test-fixtures/wiki-*/` (e.g., `test-fixtures/wiki-legacy-v1/` containing a v1 wiki for Rule 7 testing).
- L3 dogfood does NOT need automation — it's hand-reviewed by the author of the wave's PR.
- L4 behavioral observation infrastructure (audit log schema, before/after benchmark script) is **out of scope for this plan** but should be tracked as immediate follow-on work.

---

## Acceptance Criteria

| ID | Criterion | Verifier |
|----|-----------|----------|
| AC-01 | `wiki-page.schema.md` documents `flow-*` and `contract-*` categories with full frontmatter field tables | manual review |
| AC-02 | `wiki-page.schema.md` documents new relationships and their inverses | manual review |
| AC-03 | `wiki-index.toon` schemaVersion 2 example present in `wiki-index.schema.md` | manual review |
| AC-04 | Running `/loom upgrade` on a repo with v1 wiki-index migrates to v2 idempotently | dogfood + diff |
| AC-05 | `wiki-ingest-agent` with `--flow <route>` produces a valid `flow-*` page on Loom's own routes | dogfood |
| AC-06 | `wiki-ingest-agent` in `full` mode auto-creates at least one `contract-*` page when run on a tiny fixture project with cross-module type exports | vitest fixture |
| AC-07 | `wiki-lint-agent` reports W-020/W-022/W-024 correctly on synthetic broken pages | vitest |
| AC-08 | `wiki-query-agent` responds to "what flows touch component-X" by returning flows linked via `exercises` | dogfood |
| AC-09 | When `rolling-context.md` is generated for a wave that touches files referenced by a flow-* or contract-* page, those pages appear in the `## Project Knowledge [WIKI]` section ranked above generic component pages, and the orchestrator packs `summary` strings before expanding bodies | manual review + dogfood |
| AC-10 | `bugfix-analyst-agent` output includes `affectedFlows[]` and `affectedContracts[]` arrays populated by walking from changed files via `touches` / `producers` / `consumers` | dogfood |
| AC-11 | `interpretation-reviewer-agent` escalates a contract-conflict to `blocking` when a plan AC's shape contradicts a `contract-*` page's `shape` field | vitest with fixture |
| AC-12 | Every page written by any wiki agent has a `summary` field ≤200 chars and an `estimatedTokens` field equal to `Math.ceil(pageCharCount / 4)` | vitest + lint |
| AC-13 | `wiki-lint-agent` reports W-025 / W-026 / W-027 on synthetic pages exceeding body/summary/field caps; W-026 auto-fix inserts missing H2 section stubs | vitest |
| AC-14 | `/loom upgrade` Rule 6 + Rule 8 applied in sequence on a CLAUDE.md with neither marker produce both blocks in fixed order (Karpathy first, Wiki Discipline second) with both markers present | dogfood + integration test |
| AC-15 | `/loom upgrade` Rule 8 only fires when `.loom/wiki/` exists; running on a wiki-less repo skips Rule 8 entirely | vitest with fixture |
| AC-16 | `agents/project-guidance-agent.md` emits the Loom Wiki Discipline block in newly-generated CLAUDE.md if and only if `.loom/wiki/` exists at project root | vitest fixture (two fixture repos: with-wiki and without-wiki) |
| AC-17 | `hooks/wiki-session-status.ts` prints a one-line `[wiki]` status block on SessionStart when `.loom/wiki/` exists, and exits silently when it doesn't; auto-lint fires when `D > 14` and never modifies files | vitest with mocked SessionStart |
| AC-18 | `hooks/wiki-impact-warner.ts` emits `[wiki:impact]` with affected pageIds when an Edit/Write targets a file in any flow's `touches` or contract's `producers`/`consumers`; never blocks unless `impactAck = "require"` | vitest with mocked PreToolUse |
| AC-19 | `hooks/wiki-context-suggester.ts` appends summary-only context (never bodies) when a user prompt matches the regex list; emits a visible audit line; is disabled when `promptHookEnabled = false` | vitest with mocked UserPromptSubmit |
| AC-20 | `/loom status` displays a Wiki Health block with page count, category breakdown, coverage %, stale count, and days-since-lint/ingest when `.loom/wiki/` exists | dogfood |
| AC-21 | `/loom upgrade` on a wiki-index with missing `schemaVersion` field AND missing `categories[]` array produces a valid schemaVersion-2 index with a categories array reconstructed from page-file scanning | vitest fixture |
| AC-22 | `/loom upgrade` Rule 7 backfills `summary: "(legacy — pending refresh)"` and computed `estimatedTokens` into existing page frontmatter; W-026 treats this placeholder as info-severity not warn | vitest fixture + lint check |
| AC-23 | `/loom upgrade` Rule 9 prompts user for confirmation before modifying settings.json; declining records `skipped` status with re-run instructions; `--force` skips the prompt | vitest with mocked prompt |
| AC-24 | `/loom upgrade` on a CLAUDE.md missing both markers applies Rule 6 then Rule 8 in that order in a single pass, leaving the file with both blocks in stable order and both markers present | dogfood + integration test |
| AC-25 | Re-running `/loom upgrade` after a partial-failure pass (e.g., Rule 6 succeeded, Rule 8 failed) re-detects and completes the missing migrations without rolling back successful ones | vitest fixture |
| AC-26 | `/loom-wiki refresh` on a wiki with mixed states refreshes only `--scope stale` (default); `--dry-run` previews with estimated time; `--scope aging` widens scope; `--scope legacy` targets placeholder summaries; `--scope all` is the previous `--force` behavior; `--page <pageId>` targets a single page | vitest fixture + dogfood |
| AC-27 | When `hooks/wiki-session-status.ts` detects stale pages, the surfaced remediation suggests `/loom-wiki refresh` (not `ingest --full`) as the targeted fix command. When `M==0 AND D<7` the hook emits nothing | manual review |
| AC-28 | Flow `steps[]` schema supports `nextOnFail` and `errorExits[]` optional columns; a fixture flow with two named exit states and a step that branches to one of them via `nextOnFail` parses cleanly and lint W-020/W-024 accept it | vitest fixture |
| AC-29 | Contract pages support `compatibilityPolicy`, `deprecatedAt`, `replacedBy`, `breakingChanges[]`, and `shapeFiles[]`; `interpretation-reviewer-agent` reads `compatibilityPolicy` to decide whether to escalate a contract conflict to `blocking` (yes for `backward-compatible` or `additive-only`; no for `none`) | vitest fixture |
| AC-30 | `wiki-impact-warner` fires only ONCE per unique file per session under the default `impactDedup` setting; subsequent edits of the same file are silent until session ends | vitest with mocked PreToolUse sequence |
| AC-31 | `LOOM_WIKI_HOOKS=0` environment variable silences all three wiki hook types (SessionStart, PreToolUse, and any future hook) for the current shell session without config edits | vitest with mocked env |
| AC-32 | Combined session throttle: when ≥2 wiki signals have fired in the last 5 minutes, subsequent signals collapse to `[wiki] +N additional signals — /loom-wiki status for details` | vitest with mocked time |
| AC-33 | Rule 9 only registers hook entries for which the corresponding `.ts` file exists on disk at upgrade time; running Rule 9 in a state where `hooks/wiki-impact-warner.ts` is missing skips that entry without error | vitest fixture |
| AC-34 | `/loom-wiki ingest --contract <file>` extracts contract candidates from a single file (symmetric to `--flow`) and produces a valid `contract-*` page including `compatibilityPolicy` defaulted from heuristics | vitest fixture + dogfood |
| AC-35 | MVP slice (Wave 0 + Phases 0, 1, 2) is independently shippable: all ACs in that slice (AC-01..AC-08, AC-12..AC-16, AC-22, AC-24, AC-25, AC-28, AC-29) pass without any Wave 2 or Wave 3 work | integration validation |
| AC-36 | `/loom-wiki refresh` emits progress output every 5 pages (`[wiki:refresh] 10/80 pages refreshed — current: <pageId>`) and caps the final refreshed-page list at 5 entries with `+ N more` overflow pointer | vitest fixture + dogfood |

---

## Open Questions

1. **Flow vs. e2e-story overlap.** `e2e-test-writer-agent` already produces "user journey" YAML stories under `.plan-execution/`. Should `flow-*` wiki pages be auto-generated from validated e2e stories after convergence completes? It would tighten the loop but couples persistent docs to test artifacts. *Recommendation: defer the coupling — flows are docs, stories are tests; let them diverge if they want, but consider a `derivedFromStory: <id>` field on flow pages later.*

2. **Contract authorityFile when none exists.** Some projects have implicit contracts (e.g., a route handler with no separate schema file). Should `authorityFile` be required or optional? *Recommendation: required, defaulting to the handler file itself when no separate schema exists. Forces a single source of truth.*

3. **Should flow pages be auto-generated from execution traces?** Tempting (we have heartbeats and AgentResults) but risks low-quality auto-flows that miss the user-facing framing. *Recommendation: keep flows opt-in for the first iteration; revisit auto-generation only if manual flows prove valuable.*

4. **Contract drift detection.** Contracts can silently drift from `authorityFile` when the file changes but the wiki page doesn't. *Recommendation: extend the staleness model — a contract is stale if `authorityFile` mtime exceeds the page's `updatedAt`. Same mechanism as `sourceRefs` staleness; W-021 already covers this for flows.*

5. **Hook B (`wiki-context-suggester`) pattern list calibration.** ~~Initial regex list is a guess; real prompts may match poorly.~~ **Resolved by deferring Hook B to a sequel plan.** Hook A's audit log (`.plan-execution/ephemeral/wiki-impact-session.toon` plus a session-summary append to `.loom/wiki/log.toon`) is the calibration data source. Trigger for the Hook B sequel plan: ≥100 sessions of Hook A audit data showing acceptable impact-warner precision on real edits.

6. **`estimatedTokens` accuracy.** The `Math.ceil(charCount / 4)` heuristic is the same one used elsewhere in Loom (per `hooks/lib/token-estimator.ts` per project CLAUDE.md). For wiki pages with code blocks or TOON tables, this slightly underestimates. *Recommendation: accept the underestimate; the rolling-context budget has 10% headroom and the packer can fall back to summary-only if a body would bust the budget after read.*

7. **Body cap interaction with `flow-*` pages.** A flow with 12 steps × ~200 chars per step is ~2400 chars / ~600 tokens — well under the 1200-token body cap. But add `## Step Details` prose and a contract reference per step, and a flow page can easily blow past 1200 tokens. *Recommendation: keep the 1200-token cap; flow pages that need more detail should split into a parent flow page + linked child sub-flow pages via the `triggers` relationship.*

8. **`/loom-wiki repair` for corrupted wikis.** SessionStart fail-open handles the immediate symptom of an unreadable `index.toon` but leaves the wiki without a recovery path. *Recommendation: add a `--repair` flag on `/loom-wiki lint` that validates index integrity against page files, re-indexes from scratch if corrupt, and reports unrecoverable pages without deleting them. Out of scope for this plan (no critical-mass need yet); revisit if support requests demonstrate the gap.*

9. **`index.toon` `subtype` column for category-aware ranking.** The rolling-context ranking heuristic at one point may want to prefer `event-driven` flows for wave files that touch queues. Without a `subtype` column in the `pages[]` array (holding `flowType` or `contractType`), the orchestrator must read each flow page body to filter — defeating the O(1) packing claim. *Recommendation: add `subtype` column to the `pages[]` typed-array header in Wave 0. Low cost; high upside for future ranking refinements. Folded into Wave 0 scope.*

10. **Flow ↔ e2e-story coupling as knowledge-graph consistency.** The plan defers this coupling as a technical question (Open Question 1). But strategically: if e2e stories are validated user behaviors and flow pages are wiki representations of user behaviors, a divergence between the two is a wiki staleness signal an EA/PM agent should surface. *Recommendation: keep the deferral but add a strategic note — the intended future state is that a passing e2e story whose behavior contradicts a flow page's `exitStates` automatically marks that flow page as `staleness: stale`. This connects ROADMAP M-02b convergence testing to the wiki-keystone vision.*

---

## Cross-References

**Schemas & protocols:**
- `agents/protocols/wiki-page.schema.md` — primary schema target (categories, relationships, new context-efficiency fields)
- `agents/protocols/wiki-conventions.md` — significance thresholds, category list, required H2 sections
- `agents/protocols/wiki-index.schema.md` — index schema bump (new `summary` + `estimatedTokens` columns)
- `agents/protocols/wiki-lint-rules.md` — eight new lint rules (W-020 through W-027)
- `agents/protocols/schema-upgrade.md` — Rules 7 (wiki-index v1→v2) and 8 (CLAUDE.md wiki-discipline) added here
- `agents/protocols/context-budget.md` — atomicity + summary-first packing rules

**Agents:**
- `agents/wiki-ingest-agent.md` — new `--flow` mode, contract auto-create, summary/estimatedTokens computation
- `agents/wiki-maintainer-agent.md` — post-execution flow hook, summary/estimatedTokens recomputation on every write
- `agents/wiki-lint-agent.md` — eight new check implementations
- `agents/wiki-query-agent.md` — new query intents (flow lookup, contract lookup, impact query)
- `agents/project-guidance-agent.md` — Section Template emits `## Loom Wiki Discipline` block conditional on wiki existence
- `agents/questioner-agent.md` — surface user-facing flow impact + contract compat commitments
- `agents/criteria-planner-agent.md` — emit `wiki-flow` / `wiki-contract` source criteria
- `agents/bugfix-analyst-agent.md` — `affectedFlows[]` + `affectedContracts[]` output arrays
- `agents/interpretation-reviewer-agent.md` — contract-conflict escalation
- `agents/wiki-maintainer-triggers.md` — user-facing-AC-feature-completed trigger
- `agents/api-explorer.md` — emit contract candidates during `/loom-init`

**Commands:**
- `commands/loom-upgrade.md` — scan + rule list updates, artifact-type count 8
- `commands/loom-bugfix.md` — wiki-lookup keying on user-facing language
- `commands/loom-quick.md` — wiki-lookup keying on user-facing language
- `commands/loom-status.md` — Wiki Health block
- `commands/loom-wiki.md` — new `refresh` subcommand alongside `ingest|lint|query|status`

**Hooks (new files):**
- `hooks/wiki-session-status.ts` — SessionStart wiki health surfacing + auto-lint cadence
- `hooks/wiki-impact-warner.ts` — PreToolUse on Edit/Write, deterministic graph-walk impact surfacing
- `hooks/wiki-context-suggester.ts` — UserPromptSubmit fuzzy pattern-matched context injection

**Settings:**
- `.claude/orchestration.toml` `[wiki]` section — `promptHookEnabled`, `impactAck` settings

**Related plans:**
- `PLAN-wiki-assumptions.md` — related wiki extension (assumption pages); coexists independently with this plan

# Wiki Page Schema

Defines the structure of individual wiki pages stored in `.loom/wiki/pages/`. Each page is a Markdown file with a TOON frontmatter block. All wiki agents MUST read this schema before creating or modifying pages.

## Page File Format

Wiki pages use a fenced TOON block at the top of the file (the frontmatter), followed by Markdown body content. This parallels how agent `.md` files use YAML frontmatter.

````markdown
```toon
pageId: component-auth-middleware
title: Auth Middleware
category: component
domain: code
createdAt: 2026-04-12T10:00:00Z
updatedAt: 2026-04-12T14:30:00Z
createdBy: wiki-ingest-agent
updatedBy: wiki-maintainer-agent
sourceRefs[2]: src/auth/middleware.ts, src/auth/types.ts
crossRefs[3]{pageId,relationship}:
  component-jwt-utils,depends-on
  decision-auth-strategy,implements
  pattern-middleware-chain,exemplifies
tags[3]: auth, middleware, security
staleness: fresh
confidence: high
```

# Auth Middleware

The authentication middleware validates JWT tokens on protected routes...

## Dependencies
- **JWT Utils** — token signing and verification
- ...

## Key Behaviors
- Extracts Bearer token from Authorization header
- ...
````

## Frontmatter Schema

```toon
pageId: {category}-{kebab-case-name}
title: Human-Readable Title
category: component
subtype: ""
domain: code
summary: One-or-two-sentence elevator pitch (max 200 chars, no markdown).
estimatedTokens: 420
bodySections[N]: Summary, Dependencies, Key Behaviors
createdAt: ISO-8601
updatedAt: ISO-8601
createdBy: {agent-name or "human"}
updatedBy: {agent-name or "human"}
sourceRefs[N]: file-path-1, file-path-2
crossRefs[N]{pageId,relationship}:
  other-page-id,relationship-type
tags[N]: tag1, tag2
staleness: fresh
confidence: high
```

Category-specific fields (e.g., `flowType`, `steps[]` for `flow-*` pages; `contractType`, `shape`, `compatibilityPolicy` for `contract-*` pages) appear below the universal fields. See the Flow Pages and Contract Pages sections.

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `pageId` | yes | Unique identifier. Format: `{category}-{kebab-case-name}`. Must match filename without `.md`. |
| `title` | yes | Human-readable title displayed in index and cross-references. |
| `category` | yes | One of the defined page categories (see below). |
| `subtype` | optional | Category-specific subtype. For `flow-*`: mirrors `flowType` (`user-journey`/`system-pipeline`/`scheduled-job`/`event-driven`/`lifecycle`). For `contract-*`: mirrors `contractType` (`api`/`event`/`schema`/`function-signature`/`db-table`/`cli-protocol`/`file-format`). Empty for other categories. Mirrored into `index.toon` to enable category-aware ranking without body reads. |
| `domain` | yes | Project domain: `code`, `research`, `creative`, `business`, or custom. |
| `summary` | yes | Elevator pitch. Max 200 chars, 1-2 sentences, no markdown. Mirrored into `index.toon`. Orchestrator packs summaries first into the rolling-context `[WIKI]` block before expanding bodies. Lint W-026 enforces. Legacy migration placeholder `"(legacy — pending refresh)"` is treated as info-severity (not warn) until next agent write replaces it. |
| `estimatedTokens` | yes | `Math.ceil(charCount / 4)` over the full page (frontmatter + body). Computed at every page write alongside `staleness`. Mirrored into `index.toon` for budget-aware rolling-context packing. |
| `bodySections` | yes | Required H2 sections present in the body (e.g., `["Summary", "Dependencies", "Key Behaviors"]` for a component page). Lint W-026 enforces presence; required set varies by category (see Required H2 Sections below). |
| `createdAt` | yes | ISO-8601 timestamp of page creation. |
| `updatedAt` | yes | ISO-8601 timestamp of last modification. |
| `createdBy` | yes | Agent name or `human` that created the page. |
| `updatedBy` | yes | Agent name or `human` that last modified the page. |
| `sourceRefs` | yes | Files, URLs, or artifact paths this page is derived from. Empty array if conceptual. |
| `crossRefs` | yes | Bidirectional references to other wiki pages. Empty array if none. |
| `tags` | yes | Free-form tags for search and filtering. |
| `staleness` | yes | `fresh`, `aging`, or `stale` — **recomputed on every page write** from `updatedAt` vs threshold. Agents MUST recompute this field whenever writing a page, not rely on the stored value. Readers should treat the stored value as a cache that may be stale. |
| `confidence` | yes | `high`, `medium`, or `low` — how reliable the content is. |

## Page Categories

| Category | Prefix | Description | Examples |
|----------|--------|-------------|----------|
| `component` | `component-` | A code module, service, or architectural component | `component-auth-middleware`, `component-user-service` |
| `concept` | `concept-` | A domain concept, theory, or principle | `concept-jwt-tokens`, `concept-rate-limiting` |
| `decision` | `decision-` | An architectural or design decision with rationale | `decision-auth-strategy`, `decision-database-choice` |
| `pattern` | `pattern-` | A recurring pattern or best practice in the project | `pattern-middleware-chain`, `pattern-repository` |
| `convention` | `convention-` | A project convention or coding standard | `convention-naming`, `convention-error-handling` |
| `api-surface` | `api-surface-` | An API endpoint group or external integration surface | `api-surface-users`, `api-surface-stripe` |
| `tech-debt` | `tech-debt-` | A known technical debt item or improvement opportunity | `tech-debt-old-migrations`, `tech-debt-missing-tests` |
| `external` | `external-` | An external integration, service, or dependency | `external-stripe-webhooks`, `external-sendgrid` |
| `execution-record` | `execution-record-` | A record of a specific execution event or outcome | `execution-record-wave-2-auth` |
| `flow` | `flow-` | An ordered sequence of steps describing a process — user journey, system pipeline, scheduled job, event-driven workflow, or lifecycle | `flow-user-signup`, `flow-payment-checkout`, `flow-order-lifecycle` |
| `contract` | `contract-` | A persistent shape contract that crosses module or service boundaries — API request/response, event payload, DB column-level invariant, typed schema | `contract-user-create`, `contract-order-event`, `contract-billing-webhook` |

## Cross-Reference Relationships

| Relationship | Direction | Meaning | Inverse |
|-------------|-----------|---------|---------|
| `depends-on` | any → any | This page's subject depends on the referenced page's subject | `depended-by` |
| `depended-by` | any → any | Inverse of depends-on (auto-generated for bidirectionality) | `depends-on` |
| `implements` | any → decision/pattern/contract | This page's subject implements a decision, pattern, or contract | (no auto-inverse) |
| `exemplifies` | any → pattern | This page demonstrates a pattern | (no auto-inverse) |
| `supersedes` | any → any | This page replaces an older page (use with `replacedBy` on contracts) | (no auto-inverse) |
| `relates-to` | any → any | General association | `relates-to` (symmetric) |
| `conflicts-with` | any → any | This page's claims conflict with another page | Flagged by wiki-lint-agent |
| `exercises` | flow → component | The flow's steps invoke this component | `exercised-by` |
| `exercised-by` | component → flow | Inverse of `exercises` (auto-generated) | `exercises` |
| `triggers` | flow → flow | Completion of this flow initiates the referenced flow | `triggered-by` |
| `triggered-by` | flow → flow | Inverse of `triggers` (auto-generated) | `triggers` |
| `produces` | component/flow → contract | The subject creates outputs that satisfy the referenced contract | `produced-by` |
| `produced-by` | contract → component/flow | Inverse of `produces` (auto-generated) | `produces` |
| `consumes` | component/flow → contract | The subject reads inputs that must match the referenced contract | `consumed-by` |
| `consumed-by` | contract → component/flow | Inverse of `consumes` (auto-generated) | `consumes` |

Auto-generated inverses are maintained by `wiki-maintainer-agent` whenever a page write modifies a `crossRefs[]` entry. Lint W-024 flags one-sided refs.

## Required H2 Sections per Category

Required body sections per category. Lint W-026 enforces presence; missing required sections are warning-severity.

| Category | Required H2 sections |
|----------|----------------------|
| `component-*` | `## Summary`, `## Dependencies`, `## Key Behaviors` |
| `flow-*` | `## Summary`, `## Trigger Context`, `## Step Details` |
| `contract-*` | `## Summary`, `## Shape`, `## Invariants` |
| `decision-*` | `## Summary`, `## Rationale`, `## Alternatives Considered` |
| `pattern-*`, `convention-*` | `## Summary`, `## Examples` |
| All other categories | `## Summary` only |

The `bodySections[]` frontmatter field MUST list every required H2 actually present in the body. Lint W-026 cross-checks frontmatter against body content.

## Flow Pages (`flow-*`)

Flow pages capture an ordered sequence of steps describing a process: a user journey, system pipeline, scheduled job, event-driven workflow, or lifecycle.

### Flow-specific frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `flowType` | enum | yes | One of: `user-journey`, `system-pipeline`, `scheduled-job`, `event-driven`, `lifecycle` |
| `trigger` | string | yes | What initiates the flow (HTTP route, cron expression, event name, manual user action) |
| `entryPoints` | string[] | yes | File:line locations where the flow starts |
| `exitStates` | string[] | yes | Named terminal states (e.g., `user-created`, `payment-declined`, `validation-error`) |
| `steps` | typed-array | yes | Ordered steps with `order, name, actor, touches, outcome, nextOnFail, errorExits` columns (see below) |

### Step columns

| Column | Type | Required | Semantics |
|--------|------|----------|-----------|
| `order` | int | yes | 1-indexed step number. Gaps allowed for revision but lint warns (W-020). |
| `name` | string | yes | Verb-led action ("Validate input", not "Validation") |
| `actor` | string | yes | Layer or component performing the step. Code-domain values: `api-layer`, `service-layer`, `worker`, `external`, `user`. Non-code domains use domain-appropriate roles. |
| `touches` | string | yes | File paths or component pageIds the step reads/writes |
| `outcome` | string | yes | What changes after this step. Max 80 chars (lint W-027). |
| `nextOnFail` | string | optional | Name of an `exitState` OR `order` of another step to branch to if this step fails. Empty/null = step failures bubble. **Critical for any flow with more than one exitState** — without this, the schema cannot attribute which step produces which exit. |
| `errorExits` | string[] | optional | `exitState` names this step can produce. Inverse view of `nextOnFail` aggregated at the step level. Used by `bugfix-analyst-agent` and `wiki-impact-warner` for step-level impact attribution. |

### Flow example

```toon
pageId: flow-user-signup
title: User Signup
category: flow
subtype: user-journey
domain: code
summary: Five-step signup flow validating input, deduplicating email, hashing password, inserting user, and queueing welcome email.
estimatedTokens: 310
bodySections[3]: Summary, Trigger Context, Step Details
flowType: user-journey
trigger: POST /api/users/signup
entryPoints[1]: src/routes/users.ts:45
exitStates[2]: user-created, validation-error
steps[5]{order,name,actor,touches,outcome,nextOnFail,errorExits}:
  1,Receive signup request,api-layer,src/routes/users.ts,Parsed body,,
  2,Validate input,api-layer,src/validators/user.ts,Reject if invalid,validation-error,validation-error
  3,Check duplicate email,service-layer,src/services/user.ts,Reject if exists,validation-error,validation-error
  4,Hash password and create user,service-layer,src/services/user.ts + src/db/users.ts,Row inserted,,
  5,Send welcome email,service-layer,src/services/email.ts,Email queued,,
sourceRefs[4]: src/routes/users.ts, src/services/user.ts, src/db/users.ts, src/services/email.ts
crossRefs[4]{pageId,relationship}:
  component-user-service,exercises
  component-email-service,exercises
  contract-user-create,implements
  decision-bcrypt-password,implements
tags[3]: auth, onboarding, user-lifecycle
staleness: fresh
confidence: high
```

### Known limitation — full state machines

The `lifecycle` `flowType` plus `nextOnFail` covers binary branching adequately but does NOT model full state-machine semantics (named non-terminal states, guard conditions, transition matrices, prohibited transitions). Workaround: split a state machine into one parent flow page + child sub-flow pages connected via the `triggers` relationship. A full `states[]` + `transitions[]` schema is deferred to a sequel plan; revisit once 10+ flow pages are populated and the gap is concrete.

## Contract Pages (`contract-*`)

Contract pages capture a persistent shape contract that crosses module or service boundaries: API contracts, event payloads, DB column-level invariants, typed schemas that outlive any single execution. Distinct from `.plan-execution/contracts/` which is per-execution scratch.

### Contract-specific frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractType` | enum | yes | One of: `api`, `event`, `schema`, `function-signature`, `db-table`, `cli-protocol`, `file-format` |
| `authorityFile` | string | yes | Primary source-of-truth file (the contract definition the system actually enforces). When shape spans multiple files, use this for the file to edit when the shape changes. |
| `shapeFiles` | string[] | optional | All files whose content collectively defines the shape. Required when shape spans 2+ files (e.g., Prisma schema + migration + TS type). When absent, defaults to `[authorityFile]`. |
| `shape` | string | yes | Compact representation of the contract — request/response, payload, schema. Max 500 chars (longer goes in body under `## Shape`, lint W-027). |
| `producers` | string[] | yes | pageIds (or file paths) that emit/satisfy this contract |
| `consumers` | string[] | yes | pageIds (or file paths) that consume this contract |
| `invariants` | string[] | yes | Named guarantees the contract enforces (lint can later validate these against tests) |
| `versionMarker` | string | optional | Contract version (`v1`, `2024-03`, etc.) — required if the contract has formal versioning |
| `compatibilityPolicy` | enum | yes | One of: `backward-compatible` (consumers of any prior version still work), `additive-only` (only additions, no removals/changes), `full-semver` (semver discipline with breaking-change signaling), `none` (no compatibility commitment). **Drives `interpretation-reviewer-agent` escalation logic** — without this, contract-conflict detection has no anchor for what counts as breaking. |
| `deprecatedAt` | string | optional | ISO-8601 date if this contract is deprecated. Cross-ref `replacedBy` should also be set. |
| `replacedBy` | string | optional | pageId of the contract that supersedes this one. Use with `supersedes` cross-ref relationship. |
| `breakingChanges` | string[] | optional | Versioned list of breaking changes against `compatibilityPolicy`. Each entry: `"<version>: <description>"`. |

### Contract example

```toon
pageId: contract-user-create
title: User Create Contract
category: contract
subtype: api
domain: code
summary: POST /api/users → 201 {id,email,name} | 400 — email unique invariant; backward-compatible policy.
estimatedTokens: 180
bodySections[3]: Summary, Shape, Invariants
contractType: api
authorityFile: src/contracts/user.contract.ts
shapeFiles[2]: src/contracts/user.contract.ts, src/types/user.ts
shape: POST /api/users { email: string, password: string, name?: string } -> 201 { id, email, name } | 400 { error }
producers[1]: component-user-routes
consumers[2]: component-user-service, component-admin-portal
invariants[3]: email-unique, password-min-8-chars, name-optional
versionMarker: v1
compatibilityPolicy: backward-compatible
deprecatedAt: ""
replacedBy: ""
breakingChanges[0]:
sourceRefs[2]: src/contracts/user.contract.ts, src/types/user.ts
crossRefs[3]{pageId,relationship}:
  flow-user-signup,exercised-by
  component-user-service,consumed-by
  decision-rest-over-graphql,implements
tags[3]: api, user, contract
staleness: fresh
confidence: high
```

## Staleness Model

Staleness is computed from the `updatedAt` field relative to a configurable threshold (default: 30 days, set via `orchestration.toml [wiki].stalenessDays`):

| State | Condition | Meaning |
|-------|-----------|---------|
| `fresh` | `updatedAt` < N days ago | Content is current |
| `aging` | `updatedAt` between N and 2N days ago | Content may need review |
| `stale` | `updatedAt` > 2N days ago | Content likely outdated — wiki-lint-agent flags this |

Staleness is also triggered when a page's `sourceRefs` files have been modified more recently than the page's `updatedAt`.

**Important:** `staleness` is a cached computation, not a source of truth. It is recomputed whenever any agent writes the page. Between writes, the stored value may drift. Wiki-lint-agent detects drift via W-003.

## Naming Rules

1. **Filename matches pageId**: `component-auth-middleware.md` has `pageId: component-auth-middleware`
2. **Category prefix is mandatory**: Every pageId starts with its category prefix
3. **Kebab-case after prefix**: `component-user-service`, not `component-UserService`
4. **No spaces or special characters** in pageId or filename
5. **Maximum 120 characters** for pageId

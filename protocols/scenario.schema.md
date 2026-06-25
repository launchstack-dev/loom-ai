# Scenario Schema

Defines the BDD-shaped Given/When/Then scenario block — the canonical leaf-level testable unit across Loom. Scenarios appear under acceptance criteria in plans, under key behaviors in roadmap features, inside change proposals, and inside `contract-*` wiki pages. The convergence-planner emits targets directly from scenarios; the verification pipeline blocks on them. All scenario-emitting agents and all validators MUST read this schema.

Cross-references:
- `plan.schema.md` — where scenarios appear under each `### Phase N`
- `roadmap.schema.md` — where scenarios appear under each feature
- `contract-page-extensions.schema.md` — where scenarios live in the `## Scenarios` body section of `category: contract` pages
- `change-proposal.schema.md` — where scenarios appear inside DeltaBlock `addedScenarios[]`, `modifiedScenarios[]`, and `removedScenarios[]`
- `convergence-tier.schema.md` — `testTier` resolves to a tier name; tag-based defaults + `whenTriggerType` fallback drive auto-tier assignment
- `scenario-coverage.schema.md` — traceability artifact mapping requirements to scenarios
- `validation-rules.md` — severity conventions (`blocking`, `warning`, `info`)

---

## Block Format

A scenario is a fenced TOON block. Each parent document (plan phase, roadmap feature, contract page Scenarios section, etc.) hosts one or more scenario blocks under a parent-specific heading.

````markdown
```toon
id: S-01
title: Reject signup when email already exists
given[2]: A user with email "alice@example.com" exists, The signup endpoint is reachable
when: A client POSTs to /api/users with email "alice@example.com"
whenTriggerType: api-call
then[2]: Response status MUST be 409, Response body MUST contain error code "email-exists"
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```
````

---

## Field Reference

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | **Required.** Format `S-{NN}` where `NN` is zero-padded 2+ digit integer. Unique within the parent document. When scenarios propagate (roadmap → plan, plan → contract page), the validator checks for cross-phase ID collisions and warns. |
| `title` | string | **Required.** One-line summary in imperative voice ("Reject signup when email already exists", not "Signup rejection"). Max 120 chars. |
| `given` | string[] | **Required, ≥1 entry.** Preconditions establishing the world state before `when`. RFC 2119 keywords (MUST, SHOULD, MAY) permitted but not required for `given` clauses (precondition statements are typically declarative). |
| `when` | string | **Required. Exactly one entry.** The single trigger that exercises behavior. Multiple When triggers MUST be split into separate scenarios (see `docs/scenarios-authoring-template.md` decomposition guide). |
| `whenTriggerType` | enum | **Required.** One of: `actor-action`, `system-event`, `api-call`. Drives default `testTier` when `testTier` is omitted (`api-call` → `integration`, `actor-action` → `e2e`, `system-event` → `unit`). |
| `then` | string[] | **Required, ≥1 entry.** Observable outcomes verifiable from outside the system under test. Each entry SHOULD use RFC 2119 normative language (MUST/SHOULD/MAY). Internal-state assertions (e.g., "the cache is populated") are flagged warning — prefer observable consequences. |
| `stateRef` | string \| null | **Optional.** When the scenario asserts a state-machine transition, references a named state in the parent document's `## State Machines` section. Validator checks that the referenced state exists; missing state = blocking error. |
| `tags` | string[] | **Required.** From the locked enum below. Project-local extensions allowed via `scenarios.local.yaml`. |
| `testTier` | enum \| null | **Optional.** One of: `unit`, `integration`, `e2e`, `qa-review` (see `convergence-tier.schema.md`). When omitted, resolved from `tags` + `whenTriggerType` fallback. Explicit value always overrides. |
| `automatable` | boolean | **Required.** `true` if every `then` clause is verifiable by a deterministic command (HTTP status, exit code, file presence, table row count). `false` for clauses requiring human judgment ("looks correct", "is intuitive"). `automatable: false` scenarios default to `testTier: qa-review`. |

### Locked Tag Enum

| Tag | Meaning |
|-----|---------|
| `happy-path` | The expected, successful flow. Default tier: `integration` for `api-call`, `e2e` for `actor-action`. |
| `edge-case` | Boundary conditions (empty input, max length, off-by-one). Default tier: `unit`. |
| `error` | Failure modes the system MUST detect and reject gracefully. Default tier: `integration`. |
| `regression` | Scenario added because a bug was fixed; locks in the corrected behavior. Default tier: matches the bug's reproduction tier. |

Project-local additional tags are loaded from `scenarios.local.yaml` if present at repo root. The locked enum cannot be removed from; only extended.

### Default `testTier` Resolution

When `testTier` is omitted, the validator computes it in this order:

1. If `automatable: false` → `qa-review`.
2. If `tags` contains exactly one entry from the locked enum → use that tag's default tier (table above).
3. If multiple tags are present → use the highest-cost tier among them (`qa-review` > `e2e` > `integration` > `unit`).
4. Fallback to `whenTriggerType`: `api-call` → `integration`, `actor-action` → `e2e`, `system-event` → `unit`.

Explicit `testTier` always wins over this resolution.

---

## Validation Rules

Severity follows `validation-rules.md` conventions: **blocking** halts pipelines, **warning** is reported but does not halt, **info** is logged.

| Rule | Severity | Description |
|------|----------|-------------|
| `id` matches `S-\d{2,}` format | blocking | Format violation rejected at parse time. |
| `id` is unique within parent | blocking | Two scenarios in the same phase/feature/contract page with identical `id`. |
| `id` collision across propagated copies | warning | Same `id` reused after scenario propagated to a new parent — flag for awareness, do not block. |
| `title` present and ≤120 chars | blocking | Missing or oversized title. |
| `given` has ≥1 entry | blocking | Empty `given[]`. |
| `when` is exactly one trigger | blocking | Empty `when` or `when` array with >1 entry (must split into multiple scenarios). |
| `whenTriggerType` in valid enum | blocking | Value outside `{actor-action, system-event, api-call}`. |
| `then` has ≥1 entry | blocking | Empty `then[]`. |
| `then` clause asserts internal state | warning | Heuristic match on phrases like "the cache", "internal queue", "private field"; prefer observable outcomes. |
| `stateRef` resolves to named state | blocking | When set, the referenced state must exist in the parent document's `## State Machines` section. |
| `tags[]` non-empty | blocking | At least one tag is required. |
| `tags` outside locked enum + `scenarios.local.yaml` | blocking | Tag not in locked enum and not declared in `scenarios.local.yaml`. |
| `testTier` in valid enum | blocking | Value outside `{unit, integration, e2e, qa-review}`. |
| `automatable: false` without `qa-review` tier | warning | Non-automatable scenarios should be QA reviewed; default is auto-set but explicit override to a lower tier is suspicious. |
| RFC 2119 keyword usage in `then` | info | Encourage normative phrasing; surface a hint when no MUST/SHOULD/MAY appears. |
| Entity reference resolves | warning | When `given`/`when`/`then` mention an entity name (UpperCamelCase token), that entity should exist in the parent doc's Schema / Type Definitions section. |

---

## Valid Examples

### Valid Example 1 — Happy path API scenario

```toon
id: S-01
title: Create user with valid signup payload
given[2]: No user with email "alice@example.com" exists, The signup endpoint is reachable
when: A client POSTs to /api/users with valid signup payload for "alice@example.com"
whenTriggerType: api-call
then[3]: Response status MUST be 201, Response body MUST contain id and email fields, A row MUST exist in users where email = "alice@example.com"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

### Valid Example 2 — Edge case with state reference

```toon
id: S-04
title: Reject transition from archived to active
given[1]: An Order entity exists in state "archived"
when: A client invokes Order.reactivate()
whenTriggerType: actor-action
then[2]: The call MUST raise IllegalStateTransition, Order state MUST remain "archived"
stateRef: archived
tags[2]: edge-case, error
testTier: unit
automatable: true
```

### Valid Example 3 — QA-review scenario (non-automatable)

```toon
id: S-09
title: Welcome email body reads naturally to a human reader
given[1]: A welcome email was queued for a newly-created user
when: A reviewer opens the queued email in the preview pane
whenTriggerType: actor-action
then[1]: The email body SHOULD be grammatically correct and use the user's name where templated
stateRef:
tags[1]: happy-path
testTier: qa-review
automatable: false
```

---

## Invalid Examples

Each invalid block is paired with the exact validator finding it produces.

### Invalid Example 1 — Two `when` triggers

```toon
id: S-02
title: Signup and immediate login
given[1]: No user with email "bob@example.com" exists
when: A client POSTs to /api/users with valid payload AND then POSTs to /api/sessions with the same credentials
whenTriggerType: api-call
then[2]: Both responses MUST be 2xx, A session cookie MUST be returned
tags[1]: happy-path
testTier: integration
automatable: true
```

**Validator finding:** `blocking — scenario S-02: 'when' contains compound trigger ("AND then"). Each scenario MUST have exactly one trigger. Split into two scenarios (e.g., S-02 "signup succeeds", S-03 "login after signup succeeds").`

### Invalid Example 2 — Missing `given`

```toon
id: S-03
title: Reject empty signup payload
given[0]:
when: A client POSTs to /api/users with an empty body
whenTriggerType: api-call
then[1]: Response status MUST be 400
tags[1]: error
testTier: integration
automatable: true
```

**Validator finding:** `blocking — scenario S-03: 'given' is empty. At least one precondition is required. If the precondition is "no special state", state it explicitly (e.g., "The signup endpoint is reachable").`

### Invalid Example 3 — Unknown tag

```toon
id: S-05
title: Reject SQL injection attempts
given[1]: The signup endpoint is reachable
when: A client POSTs to /api/users with email "alice' OR 1=1--"
whenTriggerType: api-call
then[1]: Response status MUST be 400
tags[1]: security-critical
testTier: integration
automatable: true
```

**Validator finding:** `blocking — scenario S-05: tag "security-critical" is not in the locked enum {happy-path, edge-case, error, regression} and is not declared in scenarios.local.yaml. Add it to scenarios.local.yaml or use a locked tag.`

### Invalid Example 4 — Unresolved `stateRef`

```toon
id: S-06
title: Reject reactivation from frozen state
given[1]: An Order entity exists in state "frozen"
when: A client invokes Order.reactivate()
whenTriggerType: actor-action
then[1]: The call MUST raise IllegalStateTransition
stateRef: frozen
tags[1]: error
testTier: unit
automatable: true
```

**Validator finding:** `blocking — scenario S-06: stateRef "frozen" does not appear in the parent document's ## State Machines section. Valid Order states: {pending, active, archived}. Either add the "frozen" state to the state machine or correct the stateRef.`

### Invalid Example 5 — Duplicate `id` within parent

```toon
id: S-01
title: Reject signup with malformed email
given[1]: The signup endpoint is reachable
when: A client POSTs to /api/users with email "not-an-email"
whenTriggerType: api-call
then[1]: Response status MUST be 400
tags[1]: error
testTier: integration
automatable: true
```

**Validator finding:** `blocking — scenario S-01: duplicate id within phase "Phase 1 — User Signup". A scenario with id S-01 already exists at line 142. Renumber to S-02 or higher.`

### Invalid Example 6 — `automatable: true` with subjective `then`

```toon
id: S-07
title: Error page looks polished
given[1]: A request to a non-existent route is made
when: A user navigates to /no-such-page
whenTriggerType: actor-action
then[1]: The error page SHOULD look polished and on-brand
tags[1]: happy-path
testTier: integration
automatable: true
```

**Validator finding:** `warning — scenario S-07: 'then' clause "looks polished and on-brand" is subjective and not deterministically verifiable. Either (a) set automatable: false and accept testTier: qa-review, or (b) rephrase to a measurable check (e.g., "the response MUST be HTML containing the project logo and a link to /").`

---

## Where Scenarios Live

| Parent | Heading | Schema |
|--------|---------|--------|
| Plan phase | `#### Scenarios` under each `### Phase N` (planVersion 2 only) | `plan.schema.md` |
| Roadmap feature | `Scenarios:` subsection per feature | `roadmap.schema.md` |
| Contract page | `## Scenarios` body section | `contract-page-extensions.schema.md` |
| Change proposal delta | `addedScenarios[]`, `modifiedScenarios[]`, `removedScenarios[]` inside a `DeltaBlock` | `change-proposal.schema.md` |
| Spec doc (v2) | `## Scenarios` section parallel to API Specification and State Machines | `spec.schema.md` |

---

## Propagation Rules

1. **Roadmap → Plan.** When `plan-builder-agent` derives a plan from a roadmap, every roadmap feature scenario MUST appear in at least one plan phase with the same `id`. The `derivedFrom[]` field on the phase scenario citation preserves provenance.
2. **Plan → Contract page.** When `/loom-plan materialize` materializes a completed plan into `contract-*` wiki pages, plan scenarios MUST appear in the destination page's `## Scenarios` section. Scenario `id`s are preserved.
3. **Change proposal → Contract page.** On archive, `addedScenarios[]` are appended, `modifiedScenarios[]` replace existing by `id`, and `removedScenarios[]` are deleted. Conflict detection runs against in-flight changes that reference the same `id`s (see `change-state.schema.md`).
4. **No silent renumbering.** Validators reject renumbering of an `id` after propagation — use `modifiedScenarios[]` with explicit `before`/`after` instead.

# Scenarios Authoring Template

Practical authoring guide for Loom scenarios (BDD-shaped Given/When/Then blocks). Read this **before** writing scenarios into a plan phase, roadmap feature, change proposal, or `contract-*` wiki page.

This document is the field guide. The authoritative schema is `protocols/scenario.schema.md` — refer there for exact validator rules and the locked tag enum. This document teaches you how to write scenarios well; the schema tells you what the validator will accept.

Companion schemas you should also know exist:
- `contract-page-extensions.schema.md` — where scenarios live on contract pages
- `change-proposal.schema.md` — how scenarios mutate via deltas
- `scenario-coverage.schema.md` — how the planner traces requirements to your scenarios

---

## TL;DR

A good Loom scenario:

1. Has **exactly one** `when` trigger.
2. Uses RFC 2119 phrasing (`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`) in `then` clauses.
3. Asserts **observable** outcomes (HTTP status, file presence, response body), not internal state ("cache populated").
4. Is tagged from the locked enum (`happy-path`, `edge-case`, `error`, `regression`).
5. Has `automatable: true` unless explicitly QA-review (subjective judgment).

When you find yourself writing "and then" or "also" in `when`, **split the scenario**.

---

## A Complete Worked Example

Imagine you're adding refund support to the billing domain. You have three candidate behaviors:

- Refund within bounds succeeds.
- Refund exceeding original is rejected.
- Refunds are logged with operator identity.

Here's how each becomes a scenario.

### Scenario 1 — happy path

```toon
id: S-07
title: Issue partial refund within bounds
given[2]: An invoice exists with paid amount 100.00, A customer-service operator is authenticated as user "csr-001"
when: The operator POSTs to /api/refunds with amount 30.00 against the invoice
whenTriggerType: api-call
then[3]: Response status MUST be 201, Response body MUST contain refund_id and amount 30.00, A refund row MUST exist in refunds with amount 30.00 and status "issued"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

Why this is good:
- One trigger.
- Three observable `then` clauses (HTTP status, response body shape, database row presence).
- `MUST` used consistently.
- Tagged `happy-path`; `testTier: integration` matches an `api-call` flow.

### Scenario 2 — error

```toon
id: S-08
title: Reject refund exceeding original payment amount
given[1]: An invoice exists with paid amount 50.00
when: An authenticated operator POSTs to /api/refunds with amount 75.00 against the invoice
whenTriggerType: api-call
then[3]: Response status MUST be 422, Response body MUST contain error code "refund-exceeds-original", No refund row MUST be created in refunds for this invoice
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```

Why this is good:
- Tagged `error` AND `regression` (because production saw this bug in 2025).
- Negative assertion ("No refund row MUST be created") is observable.
- One trigger; one outcome cluster.

### Scenario 3 — audit log

```toon
id: S-09
title: Refund audit log records operator identity
given[1]: An invoice exists with paid amount 100.00; an operator "csr-001" is authenticated
when: The operator POSTs to /api/refunds with amount 30.00 against the invoice
whenTriggerType: api-call
then[2]: A row MUST exist in refund_audit_log with operator_id "csr-001" and refund_amount 30.00, The audit row's timestamp MUST be within 5 seconds of the request time
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

Why this is good:
- This is a **different observable** than Scenario 1 (audit log vs. refund table), so it's a separate scenario.
- Resists the temptation to add audit-log assertions to Scenario 1's `then[]`.

### Why three scenarios, not one?

A naive version of the same behavior:

```toon
id: S-99
title: Refund flow
given[1]: An invoice exists
when: An operator initiates a refund
whenTriggerType: actor-action
then[5]: The refund succeeds if within bounds, The refund fails if exceeding original, A row is created in refunds, A row is created in refund_audit_log, The operator sees a success message
tags[1]: happy-path
testTier: integration
automatable: true
```

What's wrong:
- "The refund succeeds **if** within bounds" smuggles a conditional into a `then` clause — that's actually two scenarios in one.
- The `when` is too abstract ("initiates a refund") — does it cover the success and failure paths together?
- Mixed assertions of database state, HTTP responses, and UI messages in one block — when one fails, you can't tell which behavior broke.

The rule: **one trigger, one outcome cluster, one scenario.**

---

## Decomposition Guide

The single hardest scenario-authoring skill is recognizing when you're trying to cram multiple scenarios into one block. Here are the most common compounds and how to split them.

### Compound 1: "When X and then Y" in the trigger

```
when: A user POSTs /api/signup AND immediately POSTs /api/sessions
```

This is two scenarios:

- Scenario A: signup succeeds (then[] asserts user is created).
- Scenario B: given a user exists from prior signup, a session POST succeeds.

Each scenario's `given` describes the world state at its trigger; Scenario B's `given` is Scenario A's `then`.

### Compound 2: Conditional in a `then` clause

```
then[1]: If amount < limit then status is 201, else status is 422
```

Two scenarios:

- Scenario A (happy-path): given amount < limit, when posted, then status MUST be 201.
- Scenario B (error): given amount ≥ limit, when posted, then status MUST be 422.

The condition belongs in `given`, the result in `then`. **`then` clauses describe what definitively happens; they never branch.**

### Compound 3: Multiple actors

```
when: A buyer adds an item to cart AND a seller updates the price
```

This is a race condition, not one scenario. Split into:

- Scenario A: race when buyer wins (specific ordering in `given`, then observes buyer's cart price).
- Scenario B: race when seller wins (different ordering in `given`).

If you cannot order the events, you're describing concurrent behavior — use a `system-event` whenTriggerType and explicitly model the resolution semantics.

### Compound 4: Multiple tagged categories in one scenario

```
tags[3]: happy-path, error, edge-case
```

Three tags signal three different scenarios trying to fit one block. The tags are mutually exclusive for the **scenario** (a scenario is *either* a happy path *or* an error case *or* an edge case). The exception: `regression` may co-tag any of the other three, because regression is a meta-property ("this scenario exists because we fixed a bug").

### Compound 5: Several observable surfaces

```
then[4]: Response status MUST be 201, A DB row MUST exist, A Kafka event MUST be emitted, A welcome email MUST be queued
```

This is borderline. If all four outcomes are direct, synchronous consequences of the single trigger, it's fine — keep as one scenario. If some are eventual or rely on background workers (Kafka event consumed by another service), split into:

- One synchronous scenario (HTTP + DB row).
- One async scenario (`whenTriggerType: system-event` for the worker consuming the event, then asserts email queue + downstream state).

### Decomposition Checklist

Before saving a scenario, ask:

- [ ] Is there exactly one `when`?
- [ ] Does every `then` clause describe what happens for *the* single trigger, not branched outcomes?
- [ ] Do all `given` clauses establish *prior* state, not concurrent events?
- [ ] Could a test runner execute this scenario in <60 seconds at the declared `testTier`?
- [ ] If a downstream consumer changes, will the scenario still describe correct behavior, or does it bake in implementation details?

If any answer is no, decompose.

---

## RFC 2119 Phrasing Cheatsheet

RFC 2119 defines normative keywords for requirements documents. Use them in scenario `then` clauses and contract page `## Requirements` sections.

### The Five Keywords

| Keyword | Meaning | Use when |
|---------|---------|----------|
| `MUST` (= REQUIRED, SHALL) | Absolute requirement | The system has no acceptable behavior other than this. Failure is a defect. |
| `MUST NOT` (= SHALL NOT) | Absolute prohibition | The system has no acceptable case for doing this. |
| `SHOULD` (= RECOMMENDED) | Strong recommendation; valid reasons exist to deviate but must be understood | Performance budgets, code-style preferences, graceful-degradation paths. |
| `SHOULD NOT` (= NOT RECOMMENDED) | Strong dissuasion; deviation must be considered | Patterns that are usually wrong but have rare valid uses. |
| `MAY` (= OPTIONAL) | Truly optional | A choice with no preferred answer; consumers must tolerate both. |

### Choosing Between MUST and SHOULD

| Question | Answer | Use |
|----------|--------|-----|
| Would I file a bug if the system did otherwise? | Yes, always | `MUST` |
| Would I file a bug only if context (perf budget, env) wasn't met? | Yes, conditionally | `SHOULD` |
| Could two correct implementations differ here? | Yes | `MAY` |
| Would I file a bug if the system did this? | Yes, always | `MUST NOT` |
| Would I file a bug usually but accept exceptions? | Yes, usually | `SHOULD NOT` |

### Common Pitfalls

| Anti-pattern | Why it's wrong | Fix |
|--------------|----------------|-----|
| "It will return 200" | Future tense is ambiguous about whether this is required. | "Response status MUST be 200" |
| "Should probably return 200" | "Probably" weakens SHOULD further; either it's required or it isn't. | "Response status MUST be 200" or "Response status SHOULD be 200 (deviation acceptable when {condition})" |
| "Returns 200 or 201 depending on situation" | Branching outcome — split into scenarios. | Two scenarios, each with one outcome. |
| "Never returns 500" | Negative absolutes are valid but verify they're testable. | "Response status MUST NOT be 500" (test by deliberately triggering edge inputs). |
| "Is fast" | Subjective. | "Response latency p95 SHOULD be < 200ms over a 5-minute window" |
| "Looks correct" | Subjective; only valid for `automatable: false` scenarios. | Either define an observable check, or set `automatable: false` and accept `testTier: qa-review`. |

### Phrasing by Surface

| Surface | Pattern |
|---------|---------|
| HTTP status | "Response status MUST be {code}" |
| HTTP body shape | "Response body MUST contain {field} with value {value}" or "Response body MUST match shape {schema-ref}" |
| Database row | "A row MUST exist in {table} where {column} = {value}" or "No row MUST exist in {table} matching {predicate}" |
| File system | "The file {path} MUST exist" / "The file {path} MUST NOT exist" / "The file {path}'s content MUST equal {bytes}" |
| Process exit | "The command MUST exit with code 0" |
| Error code | "The response MUST contain error code \"{slug}\"" |
| State machine | "The {entity} state MUST transition from {a} to {b}" (use `stateRef`) |
| Latency | "The operation SHOULD complete within {N}ms at the {p50|p95|p99}" |
| Audit log | "A row MUST exist in {audit_table} with {field}={value} and timestamp within {window}" |

### When You Don't Need a Keyword

The `given` clauses are typically declarative — they describe state, not assert it. RFC 2119 keywords aren't required in `given`:

```
given[2]: A user with email "alice@example.com" exists, The signup endpoint is reachable
```

Both clauses describe facts about the world, not requirements. Adding `MUST` to `given` reads awkwardly:

```
given[2]: A user with email "alice@example.com" MUST exist  ← weird
```

The validator emits an info hint when `given[]` uses RFC 2119 keywords; it's not wrong but is unusual.

---

## Workflow: From Acceptance Criterion to Scenarios

A plan phase has acceptance criteria; here's the conversion to scenarios.

### Starting criterion

```
[ ] GET /api/users/:id returns 200 with the user, or 404 if not found.
```

This is **two scenarios** (the "or" reveals the compound).

### Converted

```toon
id: S-01
title: Get existing user returns 200 with user payload
given[1]: A user with id "u-001" exists
when: A client GETs /api/users/u-001
whenTriggerType: api-call
then[2]: Response status MUST be 200, Response body MUST contain id "u-001" and the user's email
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Get missing user returns 404
given[1]: No user with id "u-missing" exists
when: A client GETs /api/users/u-missing
whenTriggerType: api-call
then[2]: Response status MUST be 404, Response body MUST contain error code "user-not-found"
tags[1]: error
testTier: integration
automatable: true
```

The original criterion is now traceable: both `S-01` and `S-02` reference the same observable behavior, but each tests one branch. The `ScenarioCoverageReport` (see `scenario-coverage.schema.md`) will show both linked to the criterion.

---

## Anti-Patterns to Avoid

| Anti-pattern | Symptom | Correction |
|--------------|---------|------------|
| **Implementation detail in `then`** | "The middleware calls `validateJWT()`" | Replace with observable: "Requests without a valid JWT MUST receive 401". |
| **Untestable assertion** | "The code is well-organized" | Either remove or convert to a static-analysis criterion outside scenarios. |
| **Scenario as a test name** | `title: test_user_signup_when_email_is_taken` | Rewrite in plain language: "Reject signup when email already exists". |
| **Wrap-around `given`** | given includes the result of the `when` | Move the result to `then`; `given` is *prior* state. |
| **No `then`** | "An error is raised" with no specifics | Specify: "The call MUST raise IllegalArgumentException with message containing 'email'". |
| **All `happy-path`** | A page with 12 scenarios all tagged happy-path | The validator and `ScenarioCoverageReport` will flag partial coverage. Add error/edge-case scenarios. |
| **Reusing an `id` after removal** | After `removedScenarios: [S-05]`, a later proposal adds `S-05` back | The validator blocks. Use the next free `id`; never reuse tombstoned IDs. |
| **Stale `stateRef`** | `stateRef: archived` when the page has no state machine | The validator blocks; either add the state machine or remove `stateRef`. |

---

## Checklist Before Committing Scenarios

- [ ] Every scenario has a unique `id` within its parent.
- [ ] `id` follows `S-NN` format (zero-padded 2+ digits).
- [ ] Every scenario has exactly one `when` trigger.
- [ ] Every `given[]` has ≥1 entry and describes prior state, not the trigger or its results.
- [ ] Every `then[]` has ≥1 entry using RFC 2119 phrasing where appropriate.
- [ ] Every scenario has ≥1 tag from the locked enum (or declared in `scenarios.local.yaml`).
- [ ] `whenTriggerType` matches the trigger's nature.
- [ ] `automatable: false` only when a `then` clause requires human judgment.
- [ ] If `stateRef` is set, the named state exists in the parent doc's state machines section.
- [ ] No subjective language ("good", "fast", "intuitive") in `then` unless `automatable: false`.
- [ ] Each scenario stands alone — a reader who has not seen the next scenario understands what passes/fails.

---

## Beyond Authoring

Scenarios are an entry point, not a destination. Once you have well-formed scenarios, several downstream flows pick them up:

### Contract-page materialization

After a milestone completes, run `/loom-plan materialize` (see [`docs/scenarios-and-changes.md`](./scenarios-and-changes.md) § Greenfield). The materializer reads your roadmap + plan + an `EntityDomainPartition` manifest and emits one `contract-{domain}.md` wiki page per domain. Your scenarios are promoted into the contract page's `## Scenarios` section verbatim — the IDs you assigned, the tags you chose, the test tier you set all carry through. From that point on, the canonical home for those scenarios is the contract page, not the plan.

### Change-proposal lifecycle

When you later need to mutate a contract page (add a scenario, modify a requirement, deprecate behavior), the path is `/loom-change init → review → approve → archive`. Scenarios participate as DeltaBlock entries:

- `addedScenarios[]` — full Scenario blocks, validated against `scenario.schema.md` exactly as if you were authoring them in a plan.
- `modifiedScenarios[]` — `{id, before, after}` triples; the `before` must match the current contract-page text.
- `removedScenarios[]` — scenario IDs to remove (tombstoned IDs MUST NOT be reused later).

The change-archive command runs the same scenario validator before mutating the page — so authoring discipline you build now pays off forever.

### /loom-quick integration

For projects with `contract-*` pages, `/loom-quick "fix the off-by-one"` auto-emits a retroactive change proposal via `quick-archive`. The scenarios it generates from the fix follow the same schema — `quick-archive` validates them before archiving. If your fix doesn't naturally produce a new scenario (e.g., a refactor or a logging tweak), `quick-archive` emits a regression-tagged scenario covering the regression test you just wrote — and if no regression test exists, it surfaces a warning rather than archiving a contract-page-affecting change with no observable assertion.

### One philosophy

Across all three flows, the scenario stays the same artifact — same fields, same validators, same enforcement. The discipline you put into the original block pays compound interest as the project evolves. Treat scenarios as enforceable specs, not documentation.

---

## See Also

- `protocols/scenario.schema.md` — authoritative validator rules
- `protocols/contract-page-extensions.schema.md` — how scenarios sit on contract pages
- `protocols/change-proposal.schema.md` — how scenarios mutate via deltas
- `protocols/scenario-coverage.schema.md` — traceability output
- `protocols/convergence-tier.schema.md` — `testTier` semantics
- `protocols/validation-rules.md` — severity conventions
- [`docs/scenarios-and-changes.md`](./scenarios-and-changes.md) — end-to-end greenfield + brownfield walkthrough

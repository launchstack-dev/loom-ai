# Criteria Plan Schema

Defines the `criteria-plan.toon` format produced by the criteria-planner-agent. The criteria plan is the source of truth for what conditions must be satisfied, how to verify them, and what review dimensions apply. Downstream agents (criteria-harness-builder, convergence-driver) read this plan.

This is the criteria convergence counterpart to `convergence-plan.schema.md` (target convergence). Target convergence asks "does the output match this reference?" Criteria convergence asks "does the code satisfy these conditions?"

## Schema

```toon
schemaVersion: 1
createdAt: 2026-04-16T10:30:00Z
updatedAt: 2026-04-16T10:45:00Z
sourceContext: PLAN.md phase 3 acceptance criteria
mode: interactive
convergenceMode: criteria

intent: Auth middleware blocks unauthenticated requests, returns proper errors, and passes security review.

criteria[N]{id,name,type,verifier,passCondition,blocking,priority,source,rationale,testTier}:
  C-01,Blocks unauthenticated requests,hard,test-runner,all-pass,true,P0,plan-acceptance,Explicit acceptance criterion in PLAN.md,unit
  C-02,Returns 401 with error shape,hard,test-runner,all-pass,true,P0,plan-acceptance,API contract requirement,integration
  C-03,Logs auth attempts,hard,test-runner,all-pass,true,P1,plan-acceptance,Observability requirement from plan,unit
  C-04,No injection vulnerabilities,soft,security-review,zero-critical,true,P0,inferred,Auth middleware handles user input,qa-review
  C-05,No XSS vectors in error responses,soft,security-review,zero-critical,true,P0,inferred,Error responses include user-supplied data,qa-review
  C-06,Clean separation of concerns,soft,code-review,zero-blocking,false,P2,inferred,Maintainability of auth layer,qa-review
  C-07,No N+1 queries in user lookup,soft,performance-review,zero-blocking,false,P2,inferred,Auth checks run on every request,integration

reviewers[N]{id,type,agent,dimensions,blocking,model}:
  R-01,test-runner,vitest-runner,all-tests,true,
  R-02,security-review,security-reviewer,"injection,xss,secrets-exposure,auth-bypass",true,sonnet
  R-03,code-review,code-reviewer,"clarity,duplication,error-handling,naming,complexity",true,sonnet
  R-04,performance-review,performance-reviewer,"n-plus-one,unbounded-query,missing-index",false,sonnet

testConfig:
  runner: vitest
  testDir: .plan-execution/convergence/criteria/tests
  setupFile: .plan-execution/convergence/criteria/setup.ts
  timeout: 30000

reviewConfig:
  maxFindingsPerReviewer: 20
  conflictWindow: 2
  severityLevels: critical,high,medium,low,info
  blockingSeverities: critical,high

budget:
  maxIterations: 10
  agentBudget: 30
  estimatedWorstCase: 42

decisions[N]{id,question,answer,source}:
  CP-01,Include performance review?,Yes -- auth runs on every request so perf matters,user-choice
  CP-02,Code review blocking?,Yes -- want clean code before merge,user-choice

nonCriteria[N]:
  Response time under 50ms -- non-deterministic across runs
  100% branch coverage -- metric target not behavioral criterion
```

## Field Descriptions

### Header Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | integer | Schema version. Currently `1`. |
| `createdAt` | ISO 8601 timestamp | When the plan was first generated. |
| `updatedAt` | ISO 8601 timestamp | Last modification time. |
| `sourceContext` | string | What informed the plan (e.g., "PLAN.md phase 3 acceptance criteria"). |
| `mode` | enum | Planning mode: `interactive`, `light`, or `auto`. |
| `convergenceMode` | literal | Always `criteria`. Distinguishes from target convergence plans. |
| `intent` | string | 1-2 sentence goal. What conditions must hold and why. |

### criteria

Typed array. Every criterion to satisfy during convergence.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique ID. Format: `C-NN` (zero-padded). |
| `name` | string | Human-readable criterion name. |
| `type` | enum | `hard` (test execution) or `soft` (agent review). |
| `verifier` | string | Which reviewer handles this. Must match a `reviewers[].type` value (e.g., `test-runner`, `security-review`). |
| `passCondition` | enum | `all-pass` (tests), `zero-critical` (no critical/high findings), `zero-blocking` (no blocking findings), `zero-findings` (clean sweep), `max-N-minor` (N minor findings tolerated). |
| `blocking` | boolean | If true, this criterion must pass for convergence. If false, advisory only. |
| `priority` | enum | `P0` (must-pass), `P1` (should-pass), `P2` (nice-to-pass). Affects fix ordering. |
| `source` | enum | `plan-acceptance` (explicit in plan), `plan-implied` (inferred from deliverables), `inferred` (discovered from codebase analysis), `user-added` (manually added), `roadmap-acceptance` (explicit in roadmap), `wiki-history` (derived from wiki knowledge base). |
| `rationale` | string | Why this criterion exists. Traces back to plan requirement. |
| `testTier` | enum | Convergence tier for this criterion: `unit`, `integration`, `e2e`, `qa-review`. Determines which convergence tier verifies this criterion. See `convergence-tier.schema.md`. |

### reviewers

Typed array. Each reviewer type that participates in the convergence loop.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique ID. Format: `R-NN`. |
| `type` | enum | `test-runner`, `security-review`, `code-review`, `performance-review`, `architecture-review`, `accessibility-review`, `custom`. |
| `agent` | string | Agent name to spawn for this review type. Empty for test-runner (uses configured test framework). |
| `dimensions` | string | Comma-separated review dimensions this reviewer covers. `all-tests` for test runners. |
| `blocking` | boolean | If true, findings from this reviewer can block convergence. |
| `model` | string | Model override for this reviewer. Empty = use default. |

### testConfig

Nested block. Configuration for hard criteria (test execution).

| Field | Type | Description |
|-------|------|-------------|
| `runner` | string | Test framework: `vitest`, `jest`, `pytest`, `go-test`, `cargo-test`, etc. |
| `testDir` | string | Directory where generated test files live. Relative to project root. |
| `setupFile` | string | Optional setup/fixture file path. |
| `timeout` | integer | Per-test timeout in milliseconds. |

### reviewConfig

Nested block. Configuration for soft criteria (agent review).

| Field | Type | Description |
|-------|------|-------------|
| `maxFindingsPerReviewer` | integer | Cap on findings per reviewer per iteration. Prevents noise floods. |
| `conflictWindow` | integer | Number of iterations for conflict detection. **Location-based:** if a finding at `{file, line, criterion}` is fixed then reintroduced within this many iterations, it's marked conflicting. **Criterion-level:** if a criterion's finding count oscillates (0 → >0 → 0 → >0) for this many consecutive cycles, it's marked oscillating. The criterion-level check is intentionally slower to trigger since it is a weaker signal (no location match). |
| `severityLevels` | string | Comma-separated severity levels from most to least severe. |
| `blockingSeverities` | string | Comma-separated severities that count toward blocking pass conditions. |

### budget, decisions, nonCriteria

Same semantics as `convergence-plan.schema.md` equivalents. `nonCriteria` replaces `nonTargets`.

## Delta Report Format (Criteria Mode)

The criteria harness produces a delta report compatible with the convergence driver. The format unifies hard and soft results:

```toon
timestamp: 2026-04-16T11:00:00Z
convergenceMode: criteria
totalCriteria: 7
passing: 3
failing: 4

criteria[7]{id,name,type,passed,findingCount,blockingCount,details}:
  C-01,Blocks unauthenticated requests,hard,true,0,0,3/3 tests pass
  C-02,Returns 401 with error shape,hard,false,2,2,1/3 tests pass -- missing error.code field and wrong status
  C-03,Logs auth attempts,hard,false,1,1,0/2 tests pass -- no logging call detected
  C-04,No injection vulnerabilities,soft,false,1,1,SQL injection in user lookup query
  C-05,No XSS vectors,soft,true,0,0,No XSS vectors found
  C-06,Clean separation of concerns,soft,false,3,0,3 medium findings (advisory)
  C-07,No N+1 queries,soft,true,0,0,No N+1 patterns detected

findings[4]{id,criterion,reviewer,severity,file,line,description,suggestion}:
  F-01,C-02,test-runner,blocking,src/auth/middleware.ts,45,Test 'returns 401 with error.code' fails -- response missing code field,Add error.code to 401 response body
  F-02,C-02,test-runner,blocking,src/auth/middleware.ts,52,Test 'returns 401 status' fails -- returns 403 instead of 401,Change status code from 403 to 401
  F-03,C-03,test-runner,blocking,src/auth/middleware.ts,,Test 'logs failed auth' fails -- no call to logger.warn,Add logger.warn call on auth failure
  F-04,C-04,security-reviewer,critical,src/auth/middleware.ts,28,User ID interpolated directly into SQL query,Use parameterized query: db.query('SELECT * FROM users WHERE id = $1' [userId])

conflicts[0]:
```

### Conflict Tracking

When a finding is fixed in iteration N but a contradicting finding appears in the same location in iteration N+1 (within `conflictWindow`), the harness marks it as a conflict:

```toon
conflicts[1]{id,criterion,iteration_fixed,iteration_reintroduced,finding_a,finding_b,resolution}:
  X-01,C-06,3,4,F-12: Extract auth logic to helper function,F-18: Inline is clearer -- remove unnecessary abstraction,frozen
```

Resolution values:
- `frozen` — stop iterating on this criterion. Log for human review.
- `escalated` — ask the user to decide.

Conflicting criteria are removed from the active set. The driver treats them the same as stuck deltas in target convergence.

### Criterion-Level Oscillation Detection

In addition to location-based conflict detection (`{file, line, criterion}`), the harness tracks **criterion-level oscillation**: if the same criterion alternates between 0 findings and >0 findings across consecutive iterations (regardless of file/line), it is flagged as oscillating. This catches cases where a fixer moves code to a new location, causing the location-based tracker to miss the oscillation.

```toon
criterionOscillation[N]{criterion,pattern,iterations}:
  C-06,"0→3→0→2",iterations 2-5
```

If a criterion oscillates for `conflictWindow` consecutive cycles (findings appear, disappear, reappear), it is treated as a conflict and frozen.

## Relationship to Other Schemas

- **convergence-plan.schema.md** — Sibling schema for target convergence. Both feed the convergence-driver but through different harness layers.
- **plan.schema.md** — Source of acceptance criteria that become hard criteria. The `#### Acceptance Criteria` section maps directly to `criteria[]` entries with `source: plan-acceptance`.
- **orchestration-config.schema.md** — Pattern config for `converge-criteria` type references this schema.
- **agent-result.schema.md** — Reviewer agents return findings in the standard AgentResult envelope with a `findings[]` typed array.

## Validation Rules

1. **All header fields present.** `schemaVersion`, `createdAt`, `updatedAt`, `sourceContext`, `mode`, `convergenceMode`, `intent` must be non-empty.
2. **`convergenceMode` must be `criteria`.** This distinguishes from target convergence plans.
3. **At least one criterion.** The `criteria` array must contain at least one entry.
4. **At least one blocking criterion.** There must be at least one criterion with `blocking: true`.
5. **Valid enums.** All `type`, `passCondition`, `priority`, `source` values must be valid.
6. **Reviewer coverage.** Every `verifier` referenced in criteria must match a reviewer's `type`.
7. **Test config required if hard criteria exist.** If any criterion has `type: hard`, `testConfig` must be present.
8. **Review config required if soft criteria exist.** If any criterion has `type: soft`, `reviewConfig` must be present.
9. **Unique IDs.** All `id` values in `criteria`, `reviewers`, `decisions` must be unique within their arrays.
10. **Budget set.** `maxIterations` and `agentBudget` must be positive integers.

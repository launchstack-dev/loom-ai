---
description: "Flaky Test Schema"
---

# Flaky Test Schema

Defines the `FlakyTest` record format for tracking tests that fail intermittently across convergence iterations. Flaky tests are detected by the convergence driver and optionally quarantined so they do not block wave progression.

---

## Schema

```toon
testId: auth-middleware-timeout-001
file: src/auth/__tests__/middleware.test.ts
testName: should timeout after 5 seconds
failureRate: 0.40
totalRuns: 10
failures: 4
lastSeen: 2026-04-19T10:30:00Z
firstSeen: 2026-04-19T09:00:00Z
quarantined: true
quarantineReason: Fails 40% of runs across 4 iterations -- timing-dependent assertion
tier: unit
iterationsSeen[N]: 2, 4, 6, 8
lastError: "Timeout: operation exceeded 5000ms"
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `testId` | string | yes | Unique identifier for the flaky test. Format: `{suite}-{descriptor}-{NNN}`. |
| `file` | string | yes | Relative path to the test file containing this test. |
| `testName` | string | yes | Human-readable test name (the `it()` or `test()` description). |
| `failureRate` | float | yes | Ratio of failures to total runs (0.0 to 1.0). Updated after each iteration. |
| `totalRuns` | integer | yes | Total number of times this test has been executed across all iterations. |
| `failures` | integer | yes | Total number of times this test has failed across all iterations. |
| `lastSeen` | ISO 8601 | yes | Timestamp of the most recent failure. |
| `firstSeen` | ISO 8601 | yes | Timestamp of the first observed failure. |
| `quarantined` | boolean | yes | Whether this test is currently quarantined (excluded from gating). |
| `quarantineReason` | string | no | Human-readable explanation of why the test was quarantined. Required when `quarantined: true`. |
| `tier` | enum | yes | Convergence tier this test belongs to: `unit`, `integration`, `e2e`, `qa-review`. See `convergence-tier.schema.md`. |
| `iterationsSeen` | integer[] | yes | List of iteration numbers where this test failed. |
| `lastError` | string | no | The error message or assertion failure from the most recent failure. |

---

## Flaky Detection Algorithm

A test is flagged as **flaky** when it meets ALL of the following conditions:

1. **Intermittent failure pattern.** The test has both passed and failed across convergence iterations (not consistently failing).
2. **Minimum sample size.** The test has run at least 3 times (`totalRuns >= 3`).
3. **Failure rate threshold.** The failure rate is between 10% and 90% (`0.10 <= failureRate <= 0.90`). Tests failing >90% are likely genuinely broken, not flaky. Tests failing <10% may be one-off environment issues.

### Detection Trigger

The convergence driver checks for flaky tests after each iteration's test run completes. For each test that failed in the current iteration:

1. Look up the test in the flaky test registry (`.plan-execution/convergence/flaky-tests.toon`).
2. If the test exists, increment `totalRuns` and `failures`, update `failureRate`, append the current iteration to `iterationsSeen`, update `lastSeen` and `lastError`.
3. If the test does not exist but has passed in a prior iteration, create a new `FlakyTest` record.
4. If the test meets the flaky criteria above, set `quarantined: true` with an auto-generated `quarantineReason`.

For each test that passed in the current iteration:

1. If the test exists in the registry, increment `totalRuns` only (not `failures`), recalculate `failureRate`.
2. If `failureRate` drops below `0.10` after recalculation, set `quarantined: false` (auto-unquarantine).

---

## Quarantine Behavior

Quarantined tests still execute in every iteration but their results are treated differently:

### What changes when a test is quarantined

1. **Gating is bypassed.** A quarantined test failure does NOT count toward the tier's `passCondition`. For example, if `unit` tier requires `all-pass`, a quarantined unit test that fails is excluded from the pass/fail count.
2. **Results are logged as warnings.** The convergence driver emits a warning-level log entry for each quarantined test that fails, including the `testId`, `failureRate`, and `lastError`.
3. **Delta reports include quarantined results.** The delta report's `findings` array includes quarantined test failures with severity `quarantined` (not `blocking`), so they remain visible for post-mortem analysis.
4. **Iteration summaries track quarantine counts.** Each iteration summary includes `quarantinedTests` and `quarantinedFailures` counts.

### What does NOT change

1. **Tests still run.** Quarantined tests are never skipped. They execute every iteration to track whether their flakiness resolves.
2. **Failure rate continues updating.** The `failureRate` is recalculated after every run, enabling auto-unquarantine when the rate drops.
3. **Manual unquarantine is always available.** A user or agent can set `quarantined: false` at any time to re-enable gating for a specific test.

---

## Registry File

The flaky test registry is stored at:

```
.plan-execution/convergence/flaky-tests.toon
```

### Format

```toon
schemaVersion: 1
updatedAt: 2026-04-19T10:30:00Z
totalTracked: 3
totalQuarantined: 2

tests[3]{testId,file,testName,failureRate,totalRuns,failures,quarantined,tier}:
  auth-middleware-timeout-001,src/auth/__tests__/middleware.test.ts,should timeout after 5 seconds,0.40,10,4,true,unit
  db-connection-retry-002,src/db/__tests__/pool.test.ts,should retry on connection loss,0.25,8,2,true,integration
  api-health-check-003,src/api/__tests__/health.test.ts,should return 200,0.08,12,1,false,unit
```

The registry file uses atomic writes (write to `.tmp`, then rename) per execution conventions.

---

## Typed Array Form

```toon
flakyTests[N]{testId,file,testName,failureRate,totalRuns,failures,lastSeen,firstSeen,quarantined,quarantineReason,tier}:
  auth-middleware-timeout-001,src/auth/__tests__/middleware.test.ts,should timeout after 5 seconds,0.40,10,4,2026-04-19T10:30:00Z,2026-04-19T09:00:00Z,true,Fails 40% of runs -- timing-dependent,unit
```

---

## Validation Rules

1. **testId is unique.** No two records in the registry may share the same `testId`.
2. **failureRate consistency.** `failureRate` must equal `failures / totalRuns` (within floating point tolerance).
3. **totalRuns >= failures.** The failure count cannot exceed the total run count.
4. **quarantineReason required when quarantined.** If `quarantined: true`, `quarantineReason` must be non-empty.
5. **tier enum.** Must be one of: `unit`, `integration`, `e2e`, `qa-review`.
6. **iterationsSeen non-empty.** A flaky test record must have at least one iteration in `iterationsSeen`.
7. **lastSeen >= firstSeen.** The last failure timestamp must not precede the first.
8. **file exists.** The `file` path should reference a valid test file in the project.

---

## Relationship to Other Schemas

- **convergence-tier.schema.md** -- Quarantine bypasses the tier's `passCondition` for gating. The `tier` field references tier names defined there.
- **criteria-plan.schema.md** -- Criteria with `type: hard` and `verifier: test-runner` may reference tests that become flaky. Quarantined tests do not block criteria convergence.
- **behavioral-guidelines.md** -- The "Diagnose Before Fix" protocol applies when investigating flaky tests. Agents should diagnose root cause (timing, state leakage, external dependency) before quarantining.
- **agent-result.schema.md** -- Convergence driver AgentResults include quarantine warnings in the `issues` array with `severity: warning`.
- **execution-conventions.md** -- The flaky test registry lives under `.plan-execution/convergence/` and follows atomic write conventions.
- **convergence-rollback.md** -- On rollback, the flaky test registry is preserved for post-mortem analysis. Quarantine state survives rollback.

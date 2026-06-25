# Execution Log Schema

Defines the structure of `.loom/wiki/execution-log.toon` — the narrative history of decisions, pivots, milestones, and observations across all executions. Unlike wave summaries (which track state), the execution log captures **rationale and reasoning** — why things happened, what was tried and failed, and what was learned.

## Schema

```toon
schemaVersion: 1
projectName: my-project
entryCount: 43
lastEntry: 2026-04-12T16:00:00Z

entries[43]{timestamp,type,actor,summary,detail,relatedPages,tier}:
  2026-04-12T09:00:00Z,decision,human,Chose JWT over session-based auth,Performance requirements favor stateless tokens for API-first architecture,decision-auth-strategy,
  2026-04-12T09:30:00Z,execution,loom-execute-plan,Wave 0 contracts completed,3 contract files with 12 types exported — types.ts schema.sql api-types.ts,execution-record-wave-0,
  2026-04-12T10:00:00Z,pivot,human,Switched from Redis to Postgres for sessions,Reduced infrastructure complexity — single database instead of two data stores,decision-session-storage,
  2026-04-12T10:30:00Z,review-finding,security-reviewer,Auth middleware missing rate limiting,No request throttling on login endpoint — allows brute force,component-auth-middleware,
  2026-04-12T11:00:00Z,convergence-result,convergence-driver,API parity reached 23/47 endpoints,Stalled on timezone differences in token expiry fields,execution-record-convergence-1,
  2026-04-12T14:30:00Z,observation,wiki-lint-agent,Contract drift detected,Types in contracts/types.ts no longer match implemented UserService interface,component-user-service,
  2026-04-12T15:00:00Z,milestone,loom-auto,Execution complete — all tests passing,3 outer iterations — 2 fix cycles — 42 agents spawned,,
  2026-04-12T15:30:00Z,escalation,loom-auto,Circuit breaker tripped — fix stall,Same 2 review findings persisted across 2 fix cycles — manual intervention needed,,
  2026-04-12T15:35:00Z,criteria-plan-created,criteria-planner,Criteria plan for auth feature — 12 criteria,Mapped 12 acceptance criteria to 4 tiers with 23 test cases,execution-record-criteria-auth,
  2026-04-12T15:36:00Z,interpretation-conflict-found,interpretation-reviewer,Conflicting token expiry interpretations,Agent A assumes 1hr expiry vs Agent B assumes 24hr — needs human decision,component-auth-tokens,
  2026-04-12T15:37:00Z,conflict-resolved,human,Token expiry set to 1hr with refresh,Human resolved: 1hr access token with 7d refresh token,component-auth-tokens,
  2026-04-12T15:38:00Z,tdd-red-confirmed,vitest-runner,Red phase — auth.test.ts 3 tests failing,Tests written for token refresh flow — confirmed failing before implementation,execution-record-wave-2,unit
  2026-04-12T15:40:00Z,unit-gate-pass,vitest-runner,All 23 unit tests pass for wave 2,,execution-record-wave-2,unit
  2026-04-12T15:42:00Z,tdd-green-confirmed,vitest-runner,Green phase — auth.test.ts all 3 pass,Token refresh implementation passes all red-phase tests,execution-record-wave-2,unit
  2026-04-12T15:45:00Z,integration-test-complete,integration-test-agent,Auth feature integration — 8/8 pass,Cross-module token validation and middleware chain verified,execution-record-integration-auth,integration
  2026-04-12T15:50:00Z,e2e-story-written,e2e-test-writer,E2E story: user login and token refresh,Generated Playwright test from E2EStory user-login-flow,execution-record-e2e-auth,e2e
  2026-04-12T15:52:00Z,e2e-run-complete,e2e-runner-agent,E2E milestone-1 — 5/5 stories pass,All user auth workflows verified,execution-record-milestone-1,e2e
  2026-04-12T15:55:00Z,qa-review-complete,qa-review-agent,QA review phase 1 — 2 warnings 0 critical,Code style and error message consistency findings only,execution-record-qa-phase-1,qa-review
  2026-04-12T15:56:00Z,qa-finding-bulk-approved,human,Approved 2 QA warnings as accept-risk,Style findings deferred to post-launch cleanup,execution-record-qa-phase-1,qa-review
  2026-04-12T15:58:00Z,convergence-tier-complete,convergence-driver,Unit tier converged — iteration 2,All unit tests pass after 2 outer iterations,execution-record-convergence-2,unit
  2026-04-12T16:00:00Z,diagnosis-logged,implementer-agent,Diagnosed flaky timezone test,Test assumed UTC but CI runs in PST — fix: explicit timezone in test setup,component-auth-tokens,unit
  2026-04-12T16:00:00Z,verification-status-set,implementer-agent,Verification status: verified,All 12 acceptance criteria confirmed met,execution-record-wave-2,
```

## Entry Types

### Core Types

| Type | Actor | When Created |
|------|-------|-------------|
| `decision` | `human` | Human makes an architectural or design choice at a gate |
| `execution` | orchestrator command | Wave completes, plan revision happens, execution stage finishes |
| `pivot` | `human` | Human changes direction or reverses a prior decision |
| `observation` | any agent | Agent discovers something noteworthy during work |
| `milestone` | orchestrator command | Major pipeline milestone reached (execution complete, convergence done) |
| `escalation` | orchestrator command | Circuit breaker trips, quality gate fails, human intervention needed |
| `review-finding` | reviewer agent | Significant review finding with architectural implications |
| `convergence-result` | `convergence-driver` | Convergence iteration produces notable result (stall, regression, or completion) |

### Test & Verification Types

These event types track test lifecycle, QA review, convergence, and TDD events. All test-related types include an optional `tier` field (see Tier Field below).

| Type | Actor | When Created | Tier |
|------|-------|-------------|------|
| `criteria-plan-created` | `criteria-planner` | A criteria plan is generated from acceptance criteria | optional |
| `interpretation-conflict-found` | `interpretation-reviewer` | Ambiguous or conflicting interpretations detected across agents | optional |
| `conflict-resolved` | `interpretation-reviewer` or `human` | A previously detected interpretation conflict is resolved | optional |
| `unit-gate-pass` | `vitest-runner` | All unit tests pass for a wave | `unit` |
| `unit-gate-fail` | `vitest-runner` | One or more unit tests fail for a wave | `unit` |
| `integration-test-complete` | `integration-test-agent` | Integration test suite finishes (pass or fail) for a feature | `integration` |
| `e2e-story-written` | `e2e-test-writer` | An E2E story test file is generated from an E2EStory definition | `e2e` |
| `e2e-run-complete` | `e2e-runner-agent` | An E2E test run finishes (all stories in a milestone) | `e2e` |
| `e2e-step-failed` | `e2e-runner-agent` | A specific step within an E2E story fails | `e2e` |
| `qa-review-complete` | `qa-review-agent` | QA review finishes for a phase with finding summary | `qa-review` |
| `qa-finding-bulk-approved` | `human` | Human bulk-approves a set of QA findings (accept-risk) | `qa-review` |
| `convergence-tier-complete` | `convergence-driver` | A convergence tier finishes its verification pass | required |
| `tdd-red-confirmed` | `vitest-runner` | TDD red phase confirmed -- test written and verified failing | `unit` |
| `tdd-green-confirmed` | `vitest-runner` | TDD green phase confirmed -- previously failing test now passes | `unit` |
| `diagnosis-logged` | any agent | Agent logs a diagnosis before applying a fix (see AgentResult.diagnoseLog) | optional |
| `verification-status-set` | any agent | Agent sets its verificationStatus in AgentResult (verified, unverified, skipped) | optional |

## Tier Field

Test and verification event types may include an optional `tier` field that references a convergence tier name from `convergence-tier.schema.md`. The tier field indicates which convergence level the event belongs to.

Valid tier values: `unit`, `integration`, `e2e`, `qa-review`.

For some event types, the tier is fixed (e.g., `unit-gate-pass` always has tier `unit`). For others, it is optional and set when the event is contextually tied to a specific tier (e.g., `diagnosis-logged` during a unit test fix cycle would set tier to `unit`). See the Tier column in the Test & Verification Types table for whether the tier is required, fixed, or optional for each event type.

When present, the tier field appears as an additional column in the typed array:

```toon
entries[2]{timestamp,type,actor,summary,detail,relatedPages,tier}:
  2026-04-12T11:00:00Z,unit-gate-pass,vitest-runner,All 23 unit tests pass,,execution-record-wave-2,unit
  2026-04-12T11:30:00Z,e2e-run-complete,e2e-runner-agent,E2E milestone-1 complete — 5/5 stories pass,All user workflows verified including edge cases,execution-record-milestone-1,e2e
```

When the tier is not applicable or not set, the field is empty (trailing comma or omitted if last column).

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `timestamp` | yes | ISO-8601 when the event occurred |
| `type` | yes | One of the entry types above (core or test/verification) |
| `actor` | yes | Agent name, command name, or `human` |
| `summary` | yes | One-line description (< 100 chars) |
| `detail` | no | Fuller explanation with context. Omit for self-explanatory events. |
| `relatedPages` | no | Comma-separated pageIds of related wiki pages. May be empty. |
| `tier` | no | Convergence tier name: `unit`, `integration`, `e2e`, `qa-review`. See Tier Field section. |

## Rules

1. **Append-only.** Same as wiki log — never modify existing entries.
2. **Atomic writes.** Read, append, write `.tmp`, rename.
3. **Append verification.** After writing, agents SHOULD verify that the entry count increased by exactly the number of new entries and that no existing entries were modified. If verification fails, log a warning to stderr. This is a soft check — it does not block operations but provides tamper detection for debugging.
4. **Not every event gets logged.** Only events with rationale value: decisions, pivots, significant findings, milestones, escalations. Routine wave completions with no surprises can be a single `execution` entry.
5. **`detail` captures the why.** The summary says what happened; the detail says why it matters or what was learned. This is the field future agents read to avoid rediscovering knowledge. If the summary is self-explanatory, `detail` may be omitted.
6. **`relatedPages` enables navigation.** Cross-reference to wiki pages so agents can follow the trail from event to compiled knowledge.

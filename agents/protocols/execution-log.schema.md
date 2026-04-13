# Execution Log Schema

Defines the structure of `.loom/wiki/execution-log.toon` — the narrative history of decisions, pivots, milestones, and observations across all executions. Unlike wave summaries (which track state), the execution log captures **rationale and reasoning** — why things happened, what was tried and failed, and what was learned.

## Schema

```toon
schemaVersion: 1
projectName: my-project
entryCount: 35
lastEntry: 2026-04-12T14:30:00Z

entries[35]{timestamp,type,actor,summary,detail,relatedPages}:
  2026-04-12T09:00:00Z,decision,human,Chose JWT over session-based auth,Performance requirements favor stateless tokens for API-first architecture,decision-auth-strategy
  2026-04-12T09:30:00Z,execution,loom-execute-plan,Wave 0 contracts completed,3 contract files with 12 types exported — types.ts schema.sql api-types.ts,execution-record-wave-0
  2026-04-12T10:00:00Z,pivot,human,Switched from Redis to Postgres for sessions,Reduced infrastructure complexity — single database instead of two data stores,decision-session-storage
  2026-04-12T10:30:00Z,review-finding,security-reviewer,Auth middleware missing rate limiting,No request throttling on login endpoint — allows brute force,component-auth-middleware
  2026-04-12T11:00:00Z,convergence-result,convergence-driver,API parity reached 23/47 endpoints,Stalled on timezone differences in token expiry fields,execution-record-convergence-1
  2026-04-12T14:30:00Z,observation,wiki-lint-agent,Contract drift detected,Types in contracts/types.ts no longer match implemented UserService interface,component-user-service
  2026-04-12T15:00:00Z,milestone,loom-auto,Execution complete — all tests passing,3 outer iterations — 2 fix cycles — 42 agents spawned,
  2026-04-12T15:30:00Z,escalation,loom-auto,Circuit breaker tripped — fix stall,Same 2 review findings persisted across 2 fix cycles — manual intervention needed,
```

## Entry Types

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

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `timestamp` | yes | ISO-8601 when the event occurred |
| `type` | yes | One of the entry types above |
| `actor` | yes | Agent name, command name, or `human` |
| `summary` | yes | One-line description (< 100 chars) |
| `detail` | no | Fuller explanation with context. Omit for self-explanatory events. |
| `relatedPages` | no | Comma-separated pageIds of related wiki pages. May be empty. |

## Rules

1. **Append-only.** Same as wiki log — never modify existing entries.
2. **Atomic writes.** Read, append, write `.tmp`, rename.
3. **Append verification.** After writing, agents SHOULD verify that the entry count increased by exactly the number of new entries and that no existing entries were modified. If verification fails, log a warning to stderr. This is a soft check — it does not block operations but provides tamper detection for debugging.
4. **Not every event gets logged.** Only events with rationale value: decisions, pivots, significant findings, milestones, escalations. Routine wave completions with no surprises can be a single `execution` entry.
5. **`detail` captures the why.** The summary says what happened; the detail says why it matters or what was learned. This is the field future agents read to avoid rediscovering knowledge. If the summary is self-explanatory, `detail` may be omitted.
6. **`relatedPages` enables navigation.** Cross-reference to wiki pages so agents can follow the trail from event to compiled knowledge.

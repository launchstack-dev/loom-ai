# AgentResult Schema

Standard return envelope for all execution agents. Every agent MUST return valid TOON matching this schema as the last content block in its response.

## Schema

```toon
agent: contracts-agent
wave: 0
taskId: task-001
status: success

filesCreated[N]: src/types.ts, src/schema.ts
filesModified[N]: package.json
filesDeleted[N]:

exportsAdded[N]{file,name,kind}:
  src/types.ts,UserType,type
  src/schema.ts,createUser,function

dependenciesAdded[N]: zod@3.22.0, drizzle-orm@0.30.0

integrationNotes: "Used Zod for runtime validation. Downstream agents should import UserType from src/types.ts."

issues[N]{severity,description,file,line}:
  warning,"Missing index on users.email — add before production",src/schema.ts,42

contractAmendments[N]{file,issue}:

crossBoundaryRequests[N]{file,reason,suggestedChange}:
  package.json,"Need to add drizzle-kit as devDependency","Add drizzle-kit@0.22.0 to devDependencies"

durationMs: 12500

verificationStatus: verified
diagnoseLog: "Ran type-check and unit tests. All 14 tests pass. No type errors detected."

gate: pass
gateReason: "All schema migrations have matching rollback scripts and pass dry-run validation."
failAction: halt
retryMax: 3
```

## Rules

1. **Always return valid TOON.** The orchestrator parses this programmatically.
2. **Status meanings:**
   - `success` — all acceptance criteria met, no blocking issues
   - `partial` — some work completed but blocking issues remain
   - `failure` — could not complete the task
3. **integrationNotes** is the most important field for downstream agents. Write what the wiring-agent or next-wave implementers need to know. Omit obvious things.
4. **crossBoundaryRequests** — instead of modifying files outside your ownership, write a request here. The wiring-agent will process these.
5. **contractAmendments** — if contracts are wrong or incomplete, document it here. The orchestrator decides whether to re-run contracts-agent or proceed.
6. **Arrays can be empty** but must be present. All fields are required.
7. **verificationStatus** indicates whether the agent's output has been verified against acceptance criteria:
   - `verified` — output passes all acceptance criteria checks
   - `unverified` — output was produced but not yet verified
   - `skipped` — verification was intentionally skipped (e.g., contracts-only wave)
8. **diagnoseLog** is an optional narrative written by the agent before applying fixes. It captures the diagnosis reasoning so downstream agents or reviewers can understand what was found and why fixes were applied. Omit if no diagnosis was performed.

## Gate Primitive

Gate fields extend the AgentResult envelope for agents that act as quality gates in the pipeline. These fields are used by kit gate agents registered under `[[kit.<name>.gates]]` in orchestration.toml.

### Gate Fields

| Field | Type | Default | Description |
|---|---|---|---|
| gate | enum: null, pass, fail, warn | null (omit) | Gate verdict. Non-gate agents omit this field entirely. |
| gateReason | string | (required when gate is not null) | Structured explanation referencing specific failing checks. |
| failAction | enum: halt, warn, retry | halt | Action the orchestrator takes when gate is `fail`. |
| retryMax | integer | 3 | Maximum retry attempts. Only used when failAction is `retry`. |

### Rules

1. **Gate fields are OPTIONAL.** Non-gate agents omit them entirely (equivalent to `gate: null`). The base AgentResult schema remains unchanged for non-gate agents.
2. **Gate-returning agents** registered under `[[kit.<name>.gates]]` in orchestration.toml MUST include `gate` and `gateReason` in their result.
3. **failAction semantics:**
   - `halt` — Pipeline stops immediately. The user sees: gate agent name, insertion point, gateReason, and available actions (retry / skip / abort).
   - `warn` — Pipeline continues. Warning is displayed inline during execution. A summary count of all warnings is shown at pipeline completion.
   - `retry` — The gate agent is re-spawned up to `retryMax` times. A visible retry indicator is shown (e.g., `[retry 2/3]`). On exhaustion, falls through to `halt` behavior.
4. **Malformed gate response** — If the `gate` field is present but the response is not valid TOON, the orchestrator treats it as `gate: warn` with `gateReason: "malformed gate response from {agent}"`. The pipeline never halts on bad data from a gate agent.
5. **Agent timeout** — If a gate agent does not return within its configured timeout, the orchestrator treats it as `gate: warn` with `gateReason: "gate agent timed out"`. The pipeline continues.
6. **Equivalence to blocker** — `gate: fail` with `failAction: halt` produces the same user-facing BLOCKED screen as `outputRole: blocker` with blocking-severity findings. Same UX, different trigger path.

### Example: Passing Gate

```toon
agent: data-quality-gate
wave: 1
taskId: task-gate-001
status: success
filesCreated[N]:
filesModified[N]:
filesDeleted[N]:
exportsAdded[N]{file,name,kind}:
dependenciesAdded[N]:
integrationNotes: "All schema checks passed. No blocking issues."
issues[N]{severity,description,file,line}:
contractAmendments[N]{file,issue}:
crossBoundaryRequests[N]{file,reason,suggestedChange}:
durationMs: 3200
verificationStatus: verified
diagnoseLog:
gate: pass
gateReason: "All 12 schema migration checks passed. Rollback scripts verified."
failAction: halt
retryMax: 3
```

### Example: Failing Gate with Halt

```toon
agent: data-quality-gate
wave: 1
taskId: task-gate-002
status: failure
filesCreated[N]:
filesModified[N]:
filesDeleted[N]:
exportsAdded[N]{file,name,kind}:
dependenciesAdded[N]:
integrationNotes: "Schema migration 003_add_users_index.sql has no rollback script."
issues[N]{severity,description,file,line}:
  blocking,"Missing rollback script for migration 003",migrations/003_add_users_index.sql,1
contractAmendments[N]{file,issue}:
crossBoundaryRequests[N]{file,reason,suggestedChange}:
durationMs: 1800
verificationStatus: unverified
diagnoseLog: "Scanned migrations/ for rollback scripts. Found 12 of 13 migrations have corresponding rollback. Migration 003 is missing."
gate: fail
gateReason: "1 of 12 checks failed: migration 003_add_users_index.sql missing rollback script."
failAction: halt
retryMax: 3
```

## Relationship to Progress Reporting

During execution, agents write periodic progress updates to `.plan-execution/ephemeral/progress/{taskId}.toon` (see `agent-monitoring.schema.md`). AgentProgress is **informational** — the orchestrator uses it for dashboards and stale detection. AgentResult is **authoritative** — it is the final source of truth for files created, issues found, and task status. If progress data disagrees with the AgentResult, the AgentResult wins.

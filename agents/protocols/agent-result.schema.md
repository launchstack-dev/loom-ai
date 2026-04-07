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

## Relationship to Progress Reporting

During execution, agents write periodic progress updates to `.plan-execution/progress/{taskId}.toon` (see `agent-monitoring.schema.md`). AgentProgress is **informational** — the orchestrator uses it for dashboards and stale detection. AgentResult is **authoritative** — it is the final source of truth for files created, issues found, and task status. If progress data disagrees with the AgentResult, the AgentResult wins.

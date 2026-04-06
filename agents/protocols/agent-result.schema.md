# AgentResult Schema

Standard return envelope for all execution agents. Every agent MUST return valid JSON matching this schema as the last content block in its response.

## Schema

```json
{
  "agent": "string — agent name (e.g., 'contracts-agent', 'implementer-agent')",
  "wave": "number — wave index this agent executed in",
  "taskId": "string — unique task identifier assigned by orchestrator",
  "status": "success | failure | partial",

  "filesCreated": ["string — absolute paths of newly created files"],
  "filesModified": ["string — absolute paths of modified files"],
  "filesDeleted": ["string — absolute paths of deleted files"],

  "exportsAdded": [
    {
      "file": "string — path to file containing the export",
      "name": "string — exported symbol name",
      "kind": "function | class | const | type | interface | enum"
    }
  ],

  "dependenciesAdded": ["string — package@version format"],

  "integrationNotes": "string — max 500 tokens. Key decisions, assumptions, or gotchas for downstream agents. Keep concise.",

  "issues": [
    {
      "severity": "blocking | warning | info",
      "description": "string — what went wrong or needs attention",
      "file": "string | null — file path if applicable",
      "line": "number | null — line number if applicable"
    }
  ],

  "contractAmendments": [
    {
      "file": "string — contract file path that needs updating",
      "issue": "string — what's wrong or missing in the contract"
    }
  ],

  "crossBoundaryRequests": [
    {
      "file": "string — file path outside ownership boundary that needs changes",
      "reason": "string — why this file needs modification",
      "suggestedChange": "string — what change is needed"
    }
  ],

  "durationMs": "number — wall-clock time for this agent's execution"
}
```

## Rules

1. **Always return valid JSON.** The orchestrator parses this programmatically.
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

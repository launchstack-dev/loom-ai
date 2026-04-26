```toon
pageId: convention-agent-result
title: AgentResult Envelope
category: convention
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: agents/protocols/agent-result.schema.md
crossRefs[3]{pageId,relationship}:
  structure-agent-taxonomy,relates-to
  concept-execution-pipeline,relates-to
  convention-toon-format,depends-on
tags[4]: agent-result, protocol, toon, envelope
staleness: fresh
confidence: high
```

# AgentResult Envelope

Every execution agent in Loom MUST return a valid TOON block matching the AgentResult schema as the **last content block** in its response. The orchestrator parses this programmatically to determine task outcomes, file ownership, and pipeline progression.

Source: `agents/protocols/agent-result.schema.md`

---

## Required Fields

All fields are required. Empty arrays must be present (e.g., `filesDeleted[0]:`).

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent name from frontmatter |
| `wave` | integer | Wave number (0 for contracts, 1+ for implementation) |
| `taskId` | string | Task identifier from the plan |
| `status` | enum | `success`, `partial`, or `failure` |
| `filesCreated` | array | Files created during this task |
| `filesModified` | array | Files modified during this task |
| `filesDeleted` | array | Files deleted during this task |
| `exportsAdded` | typed array | New exports: `{file, name, kind}` |
| `dependenciesAdded` | array | npm packages added |
| `integrationNotes` | string | Critical context for downstream agents |
| `issues` | typed array | Problems found: `{severity, description, file, line}` |
| `contractAmendments` | typed array | Contract corrections needed: `{file, issue}` |
| `crossBoundaryRequests` | typed array | Changes needed in other agents' files: `{file, reason, suggestedChange}` |
| `durationMs` | integer | Elapsed milliseconds |
| `verificationStatus` | enum | `verified`, `unverified`, or `skipped` |
| `diagnoseLog` | string | Narrative diagnosis reasoning (optional, omit if no diagnosis) |

---

## Status Meanings

- **`success`** — All acceptance criteria met, no blocking issues. Pipeline proceeds.
- **`partial`** — Some work completed but blocking issues remain. Orchestrator evaluates whether to continue.
- **`failure`** — Could not complete the task. Orchestrator triggers fix cycle or halts.

---

## Key Design Rules

**`integrationNotes` is the most important field.** It is the primary channel for one agent to communicate what downstream agents need to know — import paths, schema decisions, non-obvious constraints. Write precisely what the next wave needs. Omit obvious things.

**`crossBoundaryRequests` prevents ownership conflicts.** Agents must never modify files they do not own. If implementation requires a change in another agent's file, write the request here. The wiring-agent processes these requests after all agents in the wave complete.

**`contractAmendments` escalates contract problems.** If the contracts-agent's output is wrong or incomplete, document it here. The orchestrator decides whether to re-run Wave 0 or proceed with caveats.

---

## Gate Extension

Gate agents (registered under `[[kit.<name>.gates]]` in `orchestration.toml`) extend the envelope with four additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `gate` | enum | `pass`, `fail`, or `warn` |
| `gateReason` | string | Explanation referencing specific failing checks |
| `failAction` | enum | `halt`, `warn`, or `retry` |
| `retryMax` | integer | Max retries before falling through to halt |

Non-gate agents omit all four fields. Gate fields are optional extensions; the base schema is unchanged.

### failAction Semantics

- **`halt`** — Pipeline stops immediately. User sees the gate name, insertion point, gateReason, and options to retry/skip/abort.
- **`warn`** — Pipeline continues. Warning is shown inline. A summary count of all warnings appears at pipeline completion.
- **`retry`** — Gate agent is re-spawned up to `retryMax` times with a visible retry indicator. On exhaustion, falls through to `halt`.

A malformed gate response (present `gate` field but invalid TOON) is treated as `gate: warn`. A timed-out gate agent is treated as `gate: warn`. The pipeline never halts on bad data from a gate agent.

---

## Relationship to Progress Reporting

During execution, agents write periodic heartbeats to `.plan-execution/progress/{taskId}.toon` (AgentProgress format). These are **informational** — used for dashboards and stale detection only.

The AgentResult is **authoritative**. If progress data disagrees with the final AgentResult, the AgentResult wins.

---

## Minimal Example

```toon
agent: implementer-agent
wave: 1
taskId: w1-auth
status: success

filesCreated[2]: src/auth/middleware.ts, src/auth/types.ts
filesModified[1]: src/routes/index.ts
filesDeleted[0]:

exportsAdded[2]{file,name,kind}:
  src/auth/middleware.ts,authMiddleware,function
  src/auth/types.ts,TokenPayload,interface

dependenciesAdded[0]:
integrationNotes: "Downstream agents import TokenPayload from src/auth/types.ts. The middleware reads JWT_SECRET from process.env."

issues[1]{severity,description,file,line}:
  warning,Hardcoded 15-minute refresh window — make configurable,src/auth/middleware.ts,42

contractAmendments[0]:
crossBoundaryRequests[0]:
durationMs: 34500
verificationStatus: verified
diagnoseLog:
```

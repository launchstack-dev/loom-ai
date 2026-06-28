---
pageId: state-machine-triage
category: state-machine
tags[5]: triage,loom-note,state-machine,wontfix,30-day-timeout
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: The TriageState machine for loom-note inbox entries has 5 states (needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix) with a 30-day timeout on needs-info, an explicit reopen ceremony, and mandatory reason fields on critical transitions.
estimatedTokens: 850
bodySections[4]: Summary,States,Valid Transitions,Invalid Transitions
relatedFiles[1]:
  planning/plans/PLAN-F-18-matt-pocock-skills.md
crossRefs[2]{pageId,relationship}:
  feature-f18-mattpocock-skills-adoption,implemented-by
  protocol-out-of-scope,relates-to
---

## Summary

The `TriageState` state machine (plan §488-531, F-18 Phase D, sub-13) governs inbox entries managed by `loom-note`. Entries live at `inbox/{id}.md` (TOON frontmatter). Every transition appends to `transitions[]` (append-only audit log) with a mandatory `reason` field on critical paths. The 30-day timeout on `needs-info` prevents stale entries from clogging the inbox indefinitely.

## States

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| `needs-triage` | New entry; un-classified. | Default on `loom-note add`. |
| `needs-info` | Bot/agent asked the reporter for details. | Triage agent posts a question. |
| `ready-for-agent` | Sufficient detail; an agent can act without human input. | Triage agent classifies the entry. |
| `ready-for-human` | Sufficient detail but requires human action or decision. | Triage agent classifies the entry. |
| `wontfix` | Terminal but reopenable. | Explicit human/agent decision OR `needs-info` aged 30 days without response. |

## State Diagram

```
needs-triage ─→ needs-info ─→ ready-for-agent ─→ (graduates to feature)
     │             │  ▲    │
     │             │  │    └─→ ready-for-human
     │             │  │
     │             ▼  │ (reporter activity = any wiki/issue comment)
     │           needs-triage
     │             │
     ▼             ▼ (30 days no response)
ready-for-human  wontfix (terminal, reopenable only via /loom-note reopen <id>)
```

## Valid Transitions

| From | To | Trigger | Side Effects |
|------|----|---------|--------------|
| `needs-triage` | `needs-info` | Triage agent posts question | Append `transitions[]`; refresh `updatedAt` |
| `needs-triage` | `ready-for-agent` | Triage classifies | Append `transitions[]` |
| `needs-triage` | `ready-for-human` | Triage classifies | Append `transitions[]` |
| `needs-triage` | `wontfix` | Explicit decision | Append `transitions[]` with **mandatory** `reason` |
| `needs-info` | `needs-triage` | Reporter activity (any wiki/issue comment) | Append `transitions[]` |
| `needs-info` | `wontfix` | 30 days no response | Append `transitions[]` with `reason: timeout-30d` |
| `ready-for-agent` | `ready-for-human` | Agent escalates | Append `transitions[]` |
| `ready-for-human` | `ready-for-agent` | Human re-routes | Append `transitions[]` |
| `wontfix` | `needs-triage` | `/loom-note reopen <id>` with mandatory reason | Append `transitions[]` with `actor` and `reason`; never silent |

### Mandatory `reason` validation

`reason` MUST be non-null (FC-B1) when:
- `from=needs-triage AND to=wontfix`
- `from=wontfix AND to=*` (reopen path)
- `from=needs-info AND to=wontfix`

The schema parser rejects null `reason` on these transitions.

## Invalid Transitions

| From | To | Error Code | Message |
|------|----|-----------|---------|
| `wontfix` | any (without explicit reopen) | `WONTFIX_REOPEN_REQUIRED` | Use `/loom-note reopen <id> --reason "..."` |
| `ready-for-agent` | `needs-triage` | `INVALID_TRANSITION` | Re-triage by closing and creating a new note |

## Schema Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `NOTE-{NN}`, unique |
| `category` | enum | `bug` \| `enhancement` |
| `state` | enum | 5-value TriageState enum above |
| `createdAt` | ISO 8601 | required |
| `updatedAt` | ISO 8601 | refreshed on every transition |
| `transitions[]` | typed array | append-only; `{from, to, at, actor, reason}` |

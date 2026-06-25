# TOON Format Protocol

Authoritative reference for TOON (Token-Oriented Object Notation) usage across all agents and orchestrators.

## Convention

**TOON is the default format for all on-disk runtime artifacts and agent-to-agent communication.** JSON is only used for:
- External tooling that requires it (package.json, tsconfig.json)
- AJV schema files (`*.schema.json`) used in test validation
- Third-party API payloads

Every file that agents read or write during execution uses `.toon` extension.

## Format Quick Reference

### Flat objects — key: value (no quotes)

```toon
agent: contracts-agent
wave: 0
status: success
durationMs: 34500
```

### Simple arrays — header with count

```toon
filesCreated[3]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts
```

### Arrays of objects — header declares fields

```toon
exportsAdded[2]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface
```

### Nested objects — indentation

```toon
context:
  task: Build auth module
  location: src/auth
  deadline: 2026-04-10
```

### Empty arrays

```toon
filesDeleted[0]:
contractAmendments[0]:
```

### Combining patterns

```toon
agent: implementer-agent
wave: 1
taskId: w1-auth
status: success

filesCreated[2]: src/auth/middleware.ts,src/auth/types.ts
filesModified[1]: src/routes/index.ts
filesDeleted[0]:

exportsAdded[2]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface

issues[1]{severity,description,file,line}:
  warning,Hardcoded refresh window,src/auth/middleware.ts,42

crossBoundaryRequests[0]:
contractAmendments[0]:
durationMs: 34500
```

## Roundtrip Guarantee

TOON is a lossless encoding of the JSON data model:

```
encode(json) → toon    // compact representation
decode(toon) → json    // exact original restored
decode(encode(json)) === json  // always true
```

Types are preserved: numbers stay numbers, booleans stay booleans, null stays null, strings stay strings.

## When Agents Read/Write TOON

### Reading
1. Read the `.toon` file from disk
2. Parse using the TOON format rules above (or `decode()` from `@toon-format/toon`)
3. Use the resulting data structure

### Writing
1. Construct the data as a structured object
2. Encode to TOON (or write directly using the format above)
3. Write to disk with `.toon` extension
4. For shared state files: use atomic writes (`{file}.tmp` → rename to `{file}`)

### Agent output
Agents MAY return TOON in fenced code blocks tagged ` ```toon `. The orchestrator accepts both TOON and JSON output and normalizes internally.

## Runtime Artifacts

All execution artifacts use TOON:

| File | Purpose |
|------|---------|
| `state.toon` | Execution state (resumable) |
| `contracts/manifest.toon` | Contract file registry |
| `progress/{taskId}.toon` | Agent heartbeat/progress |
| `requests/{taskId}.toon` | Cross-boundary change requests |
| `wave-N-summary.toon` | Per-wave results |
| `scope-coverage.toon` | Acceptance criteria coverage matrix |
| `test-spec.toon` | Test specifications |
| `rolling-context.md` | Cross-wave context (markdown with embedded TOON blocks) |

## Common Patterns

### State file
```toon
schemaVersion: 1
runId: abc-123-def
planFile: PLAN.md
status: running
currentWave: 2
startedAt: 2026-04-06T10:00:00Z
updatedAt: 2026-04-06T10:15:00Z
rollingContextFile: .plan-execution/rolling-context.md
```

### Manifest
```toon
contracts[2]{file,purpose,exports}:
  types.ts,Shared TypeScript types,"User,Site,Event"
  schema.sql,Database schema,"users,sites,events"
```

### Agent progress
```toon
taskId: w1-auth
agent: implementer-agent
phase: executing
checkpoint: 3
heartbeatAt: 2026-04-06T10:05:30Z
percentComplete: 60
currentFile: src/auth/middleware.ts
issuesSoFar: 0
```

### Scope coverage
```toon
criteria[3]{phaseId,criterion,coveringTasks,status}:
  1,GET /api/users returns 200 with JSON array,w1-api-routes,pending
  1,POST /api/users creates user and returns 201,w1-api-routes,covered
  2,Dashboard renders user list,w2-frontend,orphaned
```

## npm Package

`@toon-format/toon` provides programmatic conversion:

```typescript
import { encode, decode } from '@toon-format/toon'

const json = { agent: 'contracts-agent', wave: 0, status: 'success' }
const toon = encode(json)   // "agent: contracts-agent\nwave: 0\nstatus: success"
const back = decode(toon)   // { agent: 'contracts-agent', wave: 0, status: 'success' }
```

## Test Validation Strategy

Tests keep AJV JSON Schema files for structural validation. The roundtrip test pattern:

1. Build data as JS object
2. Encode to TOON via `encode()`
3. Decode back to JSON via `decode()`
4. Validate decoded JSON against AJV schema
5. Assert roundtrip fidelity: `decoded` deep-equals `original`

This validates both TOON encoding correctness AND schema compliance in one pass.

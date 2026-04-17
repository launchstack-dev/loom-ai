# Stage Context Schema

Defines the `StageContext` TOON format written at every pipeline boundary, and the `ConvergenceIterationSummary` format written after each convergence iteration. These structured summaries are the authoritative source for stage outcomes; `rolling-context.md` is the compressed derivative.

## File Locations

- **Stage summaries:** `.plan-execution/stage-context/{stage}.toon` — one file per stage, overwritten each time that stage runs.
- **Convergence iterations:** `.plan-execution/convergence/iterations/iter-{N}.toon` — one file per iteration, preserved across iterations.
- **Atomic writes required:** Write to `{path}.tmp`, then rename to `{path}`. See `execution-conventions.md § Atomic Writes`.

```
.plan-execution/
├── stage-context/
│   ├── contracts.toon
│   ├── execute.toon
│   ├── review.toon
│   ├── test.toon
│   ├── converge.toon
│   └── fix.toon
└── convergence/
    └── iterations/
        ├── iter-1.toon
        ├── iter-2.toon
        └── ...
```

## StageContext Schema

```toon
stage: contracts
wave: 0
iteration: 0
startedAt: 2026-04-17T09:00:00Z
completedAt: 2026-04-17T09:02:34Z
durationMs: 154000
inputTokensEstimate: 12400
outputTokensEstimate: 8200
filesChanged[3]: src/types.ts,src/schema.sql,src/api-types.ts
exportsAdded[4]: User,Site,Event,ApiResponse
findingsResolved: 0
findingsRemaining: 0
summary: Generated shared contracts for User, Site, and Event entities with API response types.
keyDecisions[2]:
  Used discriminated unions for API error types
  Chose UUID over auto-increment for primary keys
nextStageHints[2]:
  auth middleware will need User type from contracts
  migration-agent should read schema.sql for table order
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `stage` | enum | One of: `contracts`, `execute`, `review`, `test`, `converge`, `fix`. |
| `wave` | integer >= 0 | Current wave number. |
| `iteration` | integer >= 0 | Convergence iteration number. `0` for non-convergence stages. |
| `startedAt` | ISO 8601 | When the stage began. |
| `completedAt` | ISO 8601 | When the stage finished. |
| `durationMs` | integer >= 0 | Wall-clock duration in milliseconds. |
| `inputTokensEstimate` | integer | Estimated input tokens consumed (characters / 4 heuristic). |
| `outputTokensEstimate` | integer | Estimated output tokens produced. |
| `filesChanged` | string[] | Paths of all files created or modified during this stage. |
| `exportsAdded` | string[] | New exports introduced (types, functions, components). |
| `findingsResolved` | integer | Number of findings resolved during this stage. |
| `findingsRemaining` | integer | Number of findings still open after this stage. |
| `summary` | string | 1-3 sentence description of what happened. |
| `keyDecisions` | string[] | Architectural or implementation decisions made during this stage. |
| `nextStageHints` | string[] | Context the next stage should know about. |

## Stage-Specific Examples

### contracts

```toon
stage: contracts
wave: 0
iteration: 0
startedAt: 2026-04-17T09:00:00Z
completedAt: 2026-04-17T09:02:34Z
durationMs: 154000
inputTokensEstimate: 12400
outputTokensEstimate: 8200
filesChanged[3]: src/types.ts,src/schema.sql,src/api-types.ts
exportsAdded[4]: User,Site,Event,ApiResponse
findingsResolved: 0
findingsRemaining: 0
summary: Generated shared contracts for User, Site, and Event entities with API response types.
keyDecisions[1]:
  Used discriminated unions for API error types
nextStageHints[1]:
  migration-agent should read schema.sql for table order
```

### execute

```toon
stage: execute
wave: 2
iteration: 0
startedAt: 2026-04-17T09:10:00Z
completedAt: 2026-04-17T09:18:42Z
durationMs: 522000
inputTokensEstimate: 45000
outputTokensEstimate: 32000
filesChanged[6]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts,src/routes/auth.ts,src/routes/users.ts,src/services/user-service.ts
exportsAdded[5]: authMiddleware,signToken,verifyToken,UserService,authRouter
findingsResolved: 0
findingsRemaining: 0
summary: Implemented auth middleware with JWT validation and user CRUD endpoints across 3 agents.
keyDecisions[2]:
  JWT refresh handled via sliding window rather than explicit refresh endpoint
  User passwords hashed with bcrypt cost factor 12
nextStageHints[2]:
  authMiddleware must be registered before protected routes in app.ts
  JWT_SECRET env var required -- add to .env.example
```

### review

```toon
stage: review
wave: 2
iteration: 0
startedAt: 2026-04-17T09:19:00Z
completedAt: 2026-04-17T09:22:15Z
durationMs: 195000
inputTokensEstimate: 38000
outputTokensEstimate: 12000
filesChanged[0]:
exportsAdded[0]:
findingsResolved: 0
findingsRemaining: 4
summary: Code review found 4 findings -- 1 blocking SQL injection in user lookup, 2 warnings for error handling, 1 info for naming.
keyDecisions[1]:
  Flagged user lookup query as blocking -- must use parameterized query
nextStageHints[2]:
  Fix stage must address SQL injection in src/services/user-service.ts:47 first
  Error handling in auth/middleware.ts should return 401 not 500
```

### test

```toon
stage: test
wave: 2
iteration: 0
startedAt: 2026-04-17T09:22:30Z
completedAt: 2026-04-17T09:25:10Z
durationMs: 160000
inputTokensEstimate: 28000
outputTokensEstimate: 18000
filesChanged[4]: test/auth/middleware.test.ts,test/auth/token.test.ts,test/routes/auth.test.ts,test/services/user-service.test.ts
exportsAdded[0]:
findingsResolved: 0
findingsRemaining: 3
summary: Generated 24 test cases across 4 test files. 3 tests fail due to unimplemented error paths in auth middleware.
keyDecisions[1]:
  Used factory pattern for test user fixtures to avoid brittle setup
nextStageHints[1]:
  Failing tests target the same error handling paths flagged by review
```

### converge

```toon
stage: converge
wave: 2
iteration: 3
startedAt: 2026-04-17T09:30:00Z
completedAt: 2026-04-17T09:45:22Z
durationMs: 922000
inputTokensEstimate: 120000
outputTokensEstimate: 65000
filesChanged[3]: src/auth/middleware.ts,src/services/user-service.ts,src/routes/auth.ts
exportsAdded[0]:
findingsResolved: 6
findingsRemaining: 1
summary: Converged over 3 iterations. Fixed SQL injection, error handling, and 3 test failures. 1 advisory finding remains (naming).
keyDecisions[2]:
  Froze naming advisory after iteration 2 -- not worth another cycle
  Prioritized test failures over code review findings in iteration 1
nextStageHints[1]:
  Remaining naming finding is non-blocking -- can be addressed in a future wave
```

### fix

```toon
stage: fix
wave: 2
iteration: 0
startedAt: 2026-04-17T09:46:00Z
completedAt: 2026-04-17T09:49:30Z
durationMs: 210000
inputTokensEstimate: 25000
outputTokensEstimate: 15000
filesChanged[2]: src/services/user-service.ts,src/auth/middleware.ts
exportsAdded[0]:
findingsResolved: 3
findingsRemaining: 1
summary: Fixed SQL injection in user lookup and improved error handling in auth middleware. 1 advisory naming finding deferred.
keyDecisions[1]:
  Used parameterized queries via db.query($1) instead of template literals
nextStageHints[1]:
  Verification should re-run tests to confirm fixes pass
```

## ConvergenceIterationSummary Schema

Written to `.plan-execution/convergence/iterations/iter-{N}.toon` after each convergence iteration.

```toon
iteration: 1
mode: criteria
startedAt: 2026-04-17T09:30:00Z
completedAt: 2026-04-17T09:35:12Z
durationMs: 312000
harnessResult: partial
findingsBefore: 7
findingsAfter: 4
findingsFixed[3]:
  C-01: SQL injection in user lookup
  C-02: Missing 401 on expired token
  T-03: auth middleware test -- invalid token path
findingsNew[0]:
filesModified[2]: src/services/user-service.ts,src/auth/middleware.ts
stalled: false
summary: Fixed 3 findings (1 security, 1 error handling, 1 test failure). No regressions introduced. 4 findings remain.
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `iteration` | integer >= 1 | Iteration number (1-indexed). |
| `mode` | enum | One of: `criteria`, `target`. |
| `startedAt` | ISO 8601 | When the iteration began. |
| `completedAt` | ISO 8601 | When the iteration finished. |
| `durationMs` | integer | Wall-clock duration in milliseconds. |
| `harnessResult` | enum | One of: `pass`, `fail`, `partial`. |
| `findingsBefore` | integer | Finding count at the start of the iteration. |
| `findingsAfter` | integer | Finding count after fixes applied. |
| `findingsFixed` | string[] | Descriptions of findings resolved in this iteration. |
| `findingsNew` | string[] | Descriptions of new findings introduced (regressions). |
| `filesModified` | string[] | Paths of files modified by fixer agents. |
| `stalled` | boolean | `true` if no net progress was made (findingsAfter >= findingsBefore). |
| `summary` | string | 1-2 sentence description of iteration outcome. |

### Additional Iteration Examples

#### Target mode -- passing iteration

```toon
iteration: 2
mode: target
startedAt: 2026-04-17T09:36:00Z
completedAt: 2026-04-17T09:40:45Z
durationMs: 285000
harnessResult: pass
findingsBefore: 3
findingsAfter: 0
findingsFixed[3]:
  T-01: GET /api/users response body mismatch
  T-02: POST /api/users missing validation error format
  T-03: Login page layout shift in header
findingsNew[0]:
filesModified[3]: src/routes/users.ts,src/validation/user.ts,src/components/LoginHeader.tsx
stalled: false
summary: All 3 remaining targets now passing. Convergence complete.
```

#### Stalled iteration

```toon
iteration: 4
mode: criteria
startedAt: 2026-04-17T09:50:00Z
completedAt: 2026-04-17T09:55:30Z
durationMs: 330000
harnessResult: fail
findingsBefore: 2
findingsAfter: 2
findingsFixed[1]:
  C-05: Error response format inconsistency
findingsNew[1]:
  C-08: New type error in validation middleware (regression)
filesModified[1]: src/validation/middleware.ts
stalled: true
summary: Fixed 1 finding but introduced 1 regression. Net progress zero -- stall detected.
```

## Validation Rules

### StageContext

1. **Required fields.** `stage`, `wave`, `startedAt`, `completedAt`, `durationMs`, `summary` must be present and non-empty.
2. **Valid stage enum.** `stage` must be one of: `contracts`, `execute`, `review`, `test`, `converge`, `fix`.
3. **Non-negative integers.** `wave`, `iteration`, `durationMs`, `inputTokensEstimate`, `outputTokensEstimate`, `findingsResolved`, `findingsRemaining` must be >= 0.
4. **Iteration only in convergence.** `iteration` must be `0` unless `stage` is `converge` or `fix` during convergence.
5. **Timestamps ordered.** `completedAt` must be after `startedAt`.
6. **Duration consistent.** `durationMs` must approximately equal the difference between `completedAt` and `startedAt` (within 1000ms tolerance for clock skew).
7. **Arrays may be empty.** `filesChanged`, `exportsAdded`, `keyDecisions`, `nextStageHints` may be empty arrays (`[0]:`) but must be present.

### ConvergenceIterationSummary

1. **Required fields.** `iteration`, `mode`, `startedAt`, `completedAt`, `durationMs`, `harnessResult`, `findingsBefore`, `findingsAfter`, `stalled`, `summary` must be present.
2. **Iteration positive.** `iteration` must be >= 1.
3. **Valid mode.** `mode` must be one of: `criteria`, `target`.
4. **Valid harness result.** `harnessResult` must be one of: `pass`, `fail`, `partial`.
5. **Stall consistency.** If `stalled` is `true`, then `findingsAfter` must be >= `findingsBefore`.
6. **Finding math.** `findingsAfter` must equal `findingsBefore - len(findingsFixed) + len(findingsNew)`.
7. **Timestamps ordered.** `completedAt` must be after `startedAt`.

## Relationship to rolling-context.md

Stage context files are the **structured source of truth** for what happened at each pipeline stage. The orchestrator reads these files and compresses them into `rolling-context.md` using the tiered compression rules from `execution-conventions.md`:

- **Hot (current - 1):** Full stage summary with all fields.
- **Warm (current - 2 to current - 4):** Key decisions and interface changes only.
- **Cold (older):** One-line summary per stage.

When a stage runs, the orchestrator:

1. Writes the stage context to `.plan-execution/stage-context/{stage}.toon` (atomic write).
2. Reads all current stage context files.
3. Regenerates `rolling-context.md` with updated tiering.

Agents read `rolling-context.md` from their prompt -- they never read stage context files directly. Only the orchestrator and lead dispatcher read stage context files from disk.

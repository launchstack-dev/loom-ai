# Convergence Plan Schema

Defines the `convergence-plan.toon` format produced by the convergence-planner-agent. The convergence plan is the single source of truth for what outputs to verify, how to compare them, and what tolerances to apply. Downstream agents (target-parser, harness-builder, convergence-driver) read this plan.

## Schema

```toon
schemaVersion: 1
createdAt: 2026-04-16T10:30:00Z
updatedAt: 2026-04-16T10:45:00Z
sourceContext: PLAN.md + codebase scan
mode: interactive

intent: Verify API response parity and UI visual fidelity after team management feature implementation.

targets[3]{id,name,category,comparisonMethod,tolerance,captureMethod,goldenSource,goldenPath,ignoreFields,metadata,rationale}:
  T-01,GET /api/users response,api,json-deep-equal,1.0,http-get,reference-run,.plan-execution/convergence/golden/api-users-get.json,"timestamp,requestId",,API contract must match exactly
  T-02,POST /api/users response,api,json-deep-equal,1.0,http-post,reference-run,.plan-execution/convergence/golden/api-users-post.json,"timestamp,requestId",requestBody=fixtures/create-user.json,API contract must match exactly
  T-03,Login page screenshot,ui,pixel-diff,0.95,playwright-screenshot,reference-run,.plan-execution/convergence/golden/login.png,,"viewport=1280x720 density=2",Visual fidelity check with anti-aliasing tolerance

captureConfig:
  http-get:
    baseUrl: http://localhost:3000
    headers: "Content-Type: application/json"
  http-post:
    baseUrl: http://localhost:3000
    headers: "Content-Type: application/json"
    fixturesDir: test/fixtures
  playwright-screenshot:
    baseUrl: http://localhost:3000
    viewportWidth: 1280
    viewportHeight: 720
    pixelDensity: 2

budget:
  maxIterations: 10
  agentBudget: 30
  estimatedWorstCase: 42

decisions[N]{id,question,answer,source}:
  CP-01,Include health endpoint?,No -- too dynamic (uptime changes per-call),user-choice
  CP-02,Pixel diff tolerance for login page?,0.95 -- allows anti-aliasing but catches layout shifts,user-choice

nonTargets[N]:
  WebSocket connections -- non-deterministic
  Log output -- timing-dependent
  Database state -- verified by integration tests instead
```

## Field Descriptions

### Header Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | integer | Schema version. Currently `1`. |
| `createdAt` | ISO 8601 timestamp | When the plan was first generated. |
| `updatedAt` | ISO 8601 timestamp | Last modification time. |
| `sourceContext` | string | What sources informed the plan (e.g., "PLAN.md + codebase scan"). |
| `mode` | enum | Planning mode used: `interactive`, `light`, or `auto`. |
| `intent` | string | 1-2 sentence convergence goal. What we are verifying and why. |

### targets

Typed array. Every convergence target with full configuration.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique target ID. Format: `T-NN` (zero-padded two digits). |
| `name` | string | Human-readable target name. |
| `category` | enum | One of: `api`, `generated-file`, `cli-output`, `ui`, `data-pipeline`, `custom`. |
| `comparisonMethod` | enum | One of: `json-deep-equal`, `pixel-diff`, `text-diff`, `semantic-html`, `row-diff`, `custom`. |
| `tolerance` | float | Score threshold 0.0-1.0. 1.0 = exact match. |
| `captureMethod` | enum | One of: `http-get`, `http-post`, `file-read`, `script-exec`, `playwright-screenshot`, `query-exec`, `custom`. |
| `goldenSource` | enum | One of: `user-provided`, `reference-run`, `spec-extracted`, `inline`. |
| `goldenPath` | string | Where the golden artifact is or will be stored. Relative to project root. |
| `ignoreFields` | string | Comma-separated fields to ignore during comparison (for json-deep-equal). Empty if not applicable. |
| `metadata` | string | Method-specific metadata. Key=value pairs comma-separated. Examples: `viewport=1280x720 density=2`, `requestBody=fixtures/create-user.json`. |
| `rationale` | string | Why this target was included and this method/tolerance chosen. |

### captureConfig

Nested block. Per-capture-method configuration used by the harness runner.

| Capture Method | Common Fields |
|---------------|---------------|
| `http-get` | `baseUrl`, `headers` |
| `http-post` | `baseUrl`, `headers`, `fixturesDir` |
| `file-read` | `outputDir` |
| `script-exec` | `command`, `workingDir` |
| `playwright-screenshot` | `baseUrl`, `viewportWidth`, `viewportHeight`, `pixelDensity` |
| `query-exec` | `connectionString`, `queriesDir` |
| `custom` | `script` |

### budget

Nested block. Iteration and agent budget parameters.

| Field | Type | Description |
|-------|------|-------------|
| `maxIterations` | integer | Maximum convergence loop iterations. Default: 10. |
| `agentBudget` | integer | Maximum total fixer agents spawned across all iterations. Default: 30. |
| `estimatedWorstCase` | integer | Estimated worst-case agent invocations: 2 (setup) + maxIterations x (1 + targetCount). |

### decisions

Typed array. Planning decisions made during the interview (similar to scope-contract decisions).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | Unique decision ID. Format: `CP-NN`. |
| `question` | string | The decision point. |
| `answer` | string | What was decided. |
| `source` | enum | One of: `user-choice`, `default-accepted`, `codebase-pattern`, `inferred`. |

### nonTargets

Simple inline array. Each entry is a short phrase with rationale for why this output was explicitly excluded from convergence. Prevents re-discovery on subsequent runs.

## Validation Rules

A plan is "complete" and ready for downstream consumption when:

1. **All header fields present.** `schemaVersion`, `createdAt`, `sourceContext`, `mode`, `intent` must be non-empty.
2. **At least one target.** The `targets` array must contain at least one entry.
3. **Valid enums.** All `category`, `comparisonMethod`, `captureMethod`, `goldenSource` values must be valid enum members.
4. **Tolerances in range.** Every tolerance must be between 0.0 and 1.0 inclusive.
5. **Unique IDs.** All `id` values in `targets` and `decisions` must be unique within their arrays.
6. **Golden path set.** Every target must have a non-empty `goldenPath`.
7. **Capture config coverage.** `captureConfig` must have a section for every `captureMethod` used in `targets`.
8. **Budget set.** `maxIterations` and `agentBudget` must be positive integers.

## Relationship to Other Schemas

- **Target Manifest** (`target-parser.md` output): target-parser reads this plan and normalizes targets into the existing manifest format. Each plan target becomes a manifest target.
- **converge.config** (`harness-builder.md` output): harness-builder reads the manifest (from target-parser) and builds the config. Plan tolerances, ignore fields, and metadata flow through.
- **Scope Contract** (`scope-contract.schema.md`): Plan non-targets should include scope-contract non-goals. Plan targets may reference scope-contract success criteria.
- **Pipeline State** (`pipeline-state.schema.md`): The auto pipeline reads `convergence-plan.toon` to feed target-parser when convergence is enabled.

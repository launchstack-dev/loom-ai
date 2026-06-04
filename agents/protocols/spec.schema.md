# Spec Section Reference

Detailed format specification for the spec-level sections introduced in `planVersion: 2`. These sections transform PLAN.md from a task breakdown into a complete implementation specification.

The `plan.schema.md` defines WHEN these sections are required (v2 plans only). This document defines HOW each section is structured.

All orchestrators and the `plan-builder-agent` MUST use these formats when generating or validating v2 plans.

---

## API Specification

**Required for v2 plans that define HTTP/REST/GraphQL endpoints.**

Each endpoint gets its own subsection within `## API Specification`.

### Endpoint Format

```markdown
### {METHOD} {path}

**Description:** {one sentence describing the endpoint's purpose}
**Auth:** {none | bearer | session | api-key}

**Path parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| id | string (UUID) | Resource identifier |

**Query parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | number | no | 20 | Max results per page |
| offset | number | no | 0 | Pagination offset |

**Request body:**
| Field | Type | Required | Constraints | Default |
|-------|------|----------|-------------|---------|
| name | string | yes | non-empty, max 255 chars | — |
| email | string | yes | valid email format, unique | — |
| role | string | no | one of: "admin", "member", "viewer" | "member" |

**Success response:** {status code}
```json
{
  "id": "string (UUID)",
  "name": "string",
  "email": "string",
  "role": "string",
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)"
}
```

**Error responses:**
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Missing required field, invalid format |
| 404 | NOT_FOUND | Resource with given ID does not exist |
| 409 | CONFLICT | Unique constraint violation (e.g., duplicate email) |
| 500 | INTERNAL_ERROR | Unhandled server error |

**Behavior notes:**
- {concrete implementation detail 1}
- {concrete implementation detail 2}
```

### Rules

- Every endpoint referenced in any feature or acceptance criterion MUST be specified here
- Path parameters use `:param` syntax in the path (e.g., `/api/users/:id`)
- Request body section is omitted for GET/DELETE requests with no body
- Query parameters section is omitted if none exist
- Error responses must cover at least: validation errors (400), not found (404), and server errors (500)
- Behavior notes capture implementation-specific details that don't fit in the table format:
  - UUID generation strategy
  - Timestamp handling
  - Side effects (sending emails, updating caches)
  - Pagination behavior
  - Rate limiting
- Auth field documents the authentication requirement — `none` for public endpoints

### Validation Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Endpoint referenced but not specified | blocking | An endpoint mentioned in acceptance criteria must have a full spec |
| Missing error responses | warning | Every endpoint should document at least 400 and 500 error cases |
| No request body on POST/PUT/PATCH | warning | Write endpoints typically need a request body spec |
| Ambiguous constraints | warning | Constraints like "valid format" without specifying the format |

---

## State Machines

**Required for v2 plans where any entity has a status/lifecycle/state field.**

Each entity with a state field gets its own subsection within `## State Machines`.

### State Machine Format

```markdown
### {Entity} {Field}

```
{initial_state} ──→ {state_2} ──→ {state_3}
     ↑                               │
     └───────────────────────────────┘
```

**States:**
| State | Description | Entry condition |
|-------|-------------|-----------------|
| todo | Task is created but not started | Default on creation |
| in_progress | Task is actively being worked on | Assigned user starts work |
| done | Task is completed | User marks as done |

**Valid transitions:**
| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| todo | in_progress | PUT /api/tasks/:id {status: "in_progress"} | Sets updatedAt |
| in_progress | done | PUT /api/tasks/:id {status: "done"} | Sets updatedAt, sets completedAt |
| done | todo | PUT /api/tasks/:id {status: "todo"} | Sets updatedAt, clears completedAt, clears assigneeId |

**Invalid transitions:**
| From | To | Error code | Message |
|------|----|-----------|---------|
| todo | done | INVALID_TRANSITION | Cannot skip in_progress state |
| done | in_progress | INVALID_TRANSITION | Must reset to todo first |
```

### Rules

- Every entity with a `status`, `state`, or `lifecycle` field in the Schema section MUST have a state machine defined
- The ASCII diagram is required — it provides a visual overview for both humans and agents
- All states must appear in both the States table and the diagram
- Every valid transition must specify its trigger (typically an API call) and side effects
- Invalid transitions must be explicitly listed with their error codes
- The initial state must be clearly marked (entry condition = "Default on creation" or similar)
- State machines inform the contracts-agent about validation logic and the implementer-agent about transition enforcement

### Validation Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Entity with status field but no state machine | blocking | Must define transitions for lifecycle fields |
| Unreachable state | warning | A state with no inbound transition (other than initial) |
| Dead-end state with no explicit terminal marking | warning | A state with no outbound transitions should be marked terminal |
| Transition without trigger | warning | Every transition should specify how it's invoked |

---

## Error Handling Specification

**Required for v2 plans that define APIs or user-facing interfaces.**

### Format

```markdown
## Error Handling Specification

### Error Response Format

All API errors return a consistent JSON structure:

```json
{
  "error": {
    "code": "string — machine-readable error code",
    "message": "string — human-readable description",
    "details": "object | null — additional context (field-level errors, etc.)"
  }
}
```

### Error Categories

| Code | HTTP Status | When Used | Retryable |
|------|------------|-----------|-----------|
| VALIDATION_ERROR | 400 | Request body fails schema validation | No — fix the request |
| NOT_FOUND | 404 | Entity lookup returns null | No — resource doesn't exist |
| CONFLICT | 409 | Unique constraint violation | No — resolve the conflict |
| UNAUTHORIZED | 401 | Missing or invalid auth token | Yes — re-authenticate |
| FORBIDDEN | 403 | Valid auth but insufficient permissions | No — need different role |
| INTERNAL_ERROR | 500 | Unhandled exception | Yes — transient failure |

### Field-Level Validation Errors

When `code` is `VALIDATION_ERROR`, the `details` field contains per-field errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": {
        "email": "Must be a valid email address",
        "name": "Required field"
      }
    }
  }
}
```

### Retry Behavior

| Error type | Strategy | Max retries |
|-----------|----------|-------------|
| 5xx errors | Exponential backoff (1s, 2s, 4s) | 3 |
| Network timeout | Immediate retry once, then backoff | 2 |
| 4xx errors | Do not retry — fix the request | 0 |
```

### Rules

- The error response format MUST be consistent across all endpoints
- Every error code used in the API Specification's error response tables must be defined here
- The `code` field uses SCREAMING_SNAKE_CASE (e.g., `VALIDATION_ERROR`, not `validationError`)
- Field-level validation format is recommended for 400 errors
- Retry behavior section is optional — include only if the project has retry logic

### Validation Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Error code used but not defined | blocking | Every error code in API Specification must appear in Error Categories |
| Inconsistent HTTP status | warning | Same error code should always map to the same HTTP status |
| No error handling section for API plan | warning | v2 plans with API endpoints should define error handling |

---

## Configuration Specification

**Optional for v2 plans. Required if the project uses environment variables or config files.**

### Format

```markdown
## Configuration Specification

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| PORT | number | 3000 | no | Server listen port |
| DATABASE_PATH | string | ./data/app.db | no | SQLite database file path |
| JWT_SECRET | string | — | yes | Secret key for JWT signing (min 32 chars) |
| LOG_LEVEL | string | info | no | One of: debug, info, warn, error |
| CORS_ORIGINS | string | * | no | Comma-separated allowed origins |

### Validation

- `JWT_SECRET` must be at least 32 characters
- `PORT` must be a valid port number (1-65535)
- `LOG_LEVEL` must be one of the allowed values
- `DATABASE_PATH` parent directory must exist and be writable

### Config Loading

Configuration is loaded from environment variables with optional `.env` file support via `dotenv`. Environment variables take precedence over `.env` values.
```

### Rules

- Required variables MUST NOT have defaults (the user must provide them)
- Sensitive values (secrets, keys, passwords) should be marked as required and never have defaults
- Validation rules for each variable should be specified
- Config loading mechanism should be documented

---

## Validation Rules Specification

**Optional section for v2 plans. Extends the Schema / Type Definitions with per-field validation detail.**

### Format

```markdown
## Validation Rules

### User

| Field | Rule | Error message |
|-------|------|--------------|
| name | non-empty string, 1-255 chars | "Name is required and must be under 255 characters" |
| email | valid email (RFC 5322), unique across users | "Must be a valid email address" / "Email already in use" |
| passwordHash | bcrypt hash, 60 chars | Internal — never from user input |

### Task

| Field | Rule | Error message |
|-------|------|--------------|
| title | non-empty string, 1-500 chars | "Title is required and must be under 500 characters" |
| status | one of: "todo", "in_progress", "done" | "Invalid status. Must be: todo, in_progress, done" |
| boardId | valid UUID, must reference existing Board | "Board not found" |
| assigneeId | valid UUID or null, must reference existing User if set | "User not found" |
```

### Rules

- Every required field in the Schema section should have a validation rule
- Error messages should be user-facing and specific (not "invalid input")
- Reference uniqueness constraints, foreign key checks, and format validations
- These rules inform both the contracts-agent (for type generation) and the implementer-agent (for validation middleware)

---

## Expanded Schema / Type Definitions (v2 additions)

For v2 plans, the existing `## Schema / Type Definitions` section gains additional sub-sections per entity:

### Indexing

```markdown
#### Indexes

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| pk_users | id | PRIMARY | Row lookup |
| uq_users_email | email | UNIQUE | Email uniqueness enforcement |
| idx_tasks_board | boardId | INDEX | Fast task-by-board queries |
| idx_tasks_board_status | boardId, status | COMPOUND | Filtered task listing |
```

### Cascade Behavior

```markdown
#### Cascade Behavior

| Parent | Child | On Delete | On Update |
|--------|-------|-----------|-----------|
| User | Board | CASCADE | CASCADE |
| Board | Task | CASCADE | CASCADE |
| User | Task (assigneeId) | SET NULL | CASCADE |
```

### SQL Schema (when applicable)

```markdown
#### SQL

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) > 0 AND length(name) <= 255),
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);
```
```

### Rules

- v2 plans MUST include Indexing and Cascade Behavior for every entity
- SQL Schema is optional but recommended — it removes ambiguity for the contracts-agent
- Index names should follow a convention: `pk_` for primary, `uq_` for unique, `idx_` for regular
- Cascade behavior must specify both ON DELETE and ON UPDATE for every foreign key relationship

---

## Scenarios

**Optional for v2 plans. The canonical leaf-level testable unit, parallel in role to `## API Specification` and `## State Machines`.**

The `## Scenarios` section hosts Given/When/Then blocks that describe externally observable behaviors. Scenarios are the source of truth that the convergence-planner-agent uses to emit verification targets, the criteria-planner derives criteria from, and the e2e-test-writer-agent maps onto stories.

This section is parallel to (not nested inside) the per-phase `#### Scenarios` subsections defined in `plan.schema.md`. The plan-level `## Scenarios` section collects cross-phase or top-of-plan scenarios that don't fit cleanly under a single phase; the per-phase subsections collect phase-local scenarios. Both forms conform to `scenario.schema.md`.

### Format

````markdown
## Scenarios

### {Feature or Entity Name}

```toon
id: S-01
title: Create user with valid signup payload
given[2]: No user with email "alice@example.com" exists, The signup endpoint is reachable
when: A client POSTs to /api/users with valid signup payload for "alice@example.com"
whenTriggerType: api-call
then[3]: Response status MUST be 201, Response body MUST contain id and email fields, A row MUST exist in users where email = "alice@example.com"
stateRef:
tags[1]: happy-path
testTier: integration
automatable: true
```

```toon
id: S-02
title: Reject signup when email already exists
given[1]: A user with email "alice@example.com" exists
when: A client POSTs to /api/users with email "alice@example.com"
whenTriggerType: api-call
then[2]: Response status MUST be 409, Response body MUST contain error code "email-exists"
stateRef:
tags[2]: error, regression
testTier: integration
automatable: true
```
````

### Rules

- Every block under `## Scenarios` MUST conform to `scenario.schema.md` (required fields, locked tag enum, valid `whenTriggerType`, valid `testTier`).
- Scenario `id`s MUST be unique within the plan document — across all `## Scenarios` blocks AND all per-phase `#### Scenarios` blocks.
- Scenarios SHOULD reference entities defined in `## Schema / Type Definitions`. The validator emits a warning when an UpperCamelCase token in `given`/`when`/`then` cannot be resolved to a known entity.
- When a scenario sets `stateRef`, the referenced state MUST appear in `## State Machines`.
- Acceptance criteria across all phases SHOULD be covered by at least one scenario; uncovered criteria are flagged by `scenario-coverage.schema.md`.
- Subsection headings (e.g., `### {Feature or Entity Name}`) are recommended for readability when there are many scenarios. They are advisory — the validator parses scenario blocks regardless of subsection structure.

### Validation Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Scenario block format | blocking | Every fenced TOON block under `## Scenarios` must satisfy `scenario.schema.md` rules. |
| Cross-block id uniqueness | blocking | A scenario `id` cannot appear in two places within the same plan document (top-level `## Scenarios` plus per-phase `#### Scenarios` are a single namespace). |
| `## Scenarios` in v1 plans | blocking | This section is v2-only. v1 plans MUST omit it. |
| stateRef resolves | blocking | If `stateRef` is set, the referenced state must exist in `## State Machines`. |
| Acceptance criteria covered | warning | Every phase's acceptance criteria SHOULD have ≥1 scenario covering it; uncovered criteria flagged. |
| Every scenario tied to acceptance | info | Scenarios that do not appear to back any acceptance criterion are flagged for review. |

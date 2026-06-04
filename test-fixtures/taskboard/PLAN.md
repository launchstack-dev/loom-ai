# TaskBoard App Plan

## Overview

TaskBoard is a task management REST API with three entities: **User**, **Board**, and **Task**. It provides full CRUD operations on all entities with relational integrity enforced at the database level. The API follows RESTful conventions and returns JSON responses with appropriate HTTP status codes.

### Entity Relationships

- A **User** has many **Boards** (one-to-many)
- A **Board** belongs to a **User** and has many **Tasks** (one-to-many)
- A **Task** belongs to a **Board** and is assigned to a **User** (many-to-one on both)

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript 5.4+ (strict mode)
- **Framework:** Express 4.18+
- **Database:** SQLite via better-sqlite3 11+
- **Testing:** vitest 2+
- **Module System:** ESM (`"type": "module"` in package.json)

## Schema / Type Definitions

### User

| Field      | Type   | Constraints                     |
|------------|--------|---------------------------------|
| id         | string | UUID, primary key               |
| name       | string | non-empty, max 255 chars        |
| email      | string | valid email, unique, max 255    |
| createdAt  | string | ISO 8601 timestamp              |
| updatedAt  | string | ISO 8601 timestamp              |

### Board

| Field       | Type   | Constraints                      |
|-------------|--------|----------------------------------|
| id          | string | UUID, primary key                |
| name        | string | non-empty, max 255 chars         |
| description | string | max 1000 chars, default ""       |
| ownerId     | string | FK -> User.id, NOT NULL          |
| createdAt   | string | ISO 8601 timestamp               |
| updatedAt   | string | ISO 8601 timestamp               |

### Task

| Field       | Type   | Constraints                             |
|-------------|--------|-----------------------------------------|
| id          | string | UUID, primary key                       |
| title       | string | non-empty, max 255 chars                |
| description | string | max 2000 chars, default ""              |
| status      | string | enum: "todo", "in_progress", "done"     |
| boardId     | string | FK -> Board.id, NOT NULL                |
| assigneeId  | string | FK -> User.id, nullable                 |
| createdAt   | string | ISO 8601 timestamp                      |
| updatedAt   | string | ISO 8601 timestamp                      |

### Database Schema SQL

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) > 0 AND length(name) <= 255),
  email TEXT NOT NULL UNIQUE CHECK(length(email) > 0 AND length(email) <= 255),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) > 0 AND length(name) <= 255),
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) > 0 AND length(title) <= 255),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### API Route Definitions

| Method | Path                        | Request Body                     | Response          | Status Codes     |
|--------|-----------------------------|----------------------------------|-------------------|------------------|
| GET    | /api/users                  | -                                | User[]            | 200              |
| GET    | /api/users/:id              | -                                | User              | 200, 404         |
| POST   | /api/users                  | { name, email }                  | User              | 201, 400         |
| PUT    | /api/users/:id              | { name?, email? }                | User              | 200, 400, 404    |
| DELETE | /api/users/:id              | -                                | -                 | 204, 404         |
| GET    | /api/boards                 | -                                | Board[]           | 200              |
| GET    | /api/boards/:id             | -                                | Board             | 200, 404         |
| POST   | /api/boards                 | { name, description?, ownerId }  | Board             | 201, 400         |
| PUT    | /api/boards/:id             | { name?, description? }          | Board             | 200, 400, 404    |
| DELETE | /api/boards/:id             | -                                | -                 | 204, 404         |
| GET    | /api/boards/:boardId/tasks  | -                                | Task[]            | 200, 404         |
| GET    | /api/tasks/:id              | -                                | Task              | 200, 404         |
| POST   | /api/tasks                  | { title, description?, status?, boardId, assigneeId? } | Task | 201, 400 |
| PUT    | /api/tasks/:id              | { title?, description?, status?, assigneeId? } | Task   | 200, 400, 404    |
| DELETE | /api/tasks/:id              | -                                | -                 | 204, 404         |

### Error Response Format

```json
{
  "error": {
    "code": "NOT_FOUND | VALIDATION_ERROR | INTERNAL_ERROR",
    "message": "Human-readable error description"
  }
}
```

### TypeScript Types (contract specification)

The contracts-agent should produce these exports in `src/contracts/types.ts`:

```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  boardId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput { name: string; email: string; }
export interface UpdateUserInput { name?: string; email?: string; }
export interface CreateBoardInput { name: string; description?: string; ownerId: string; }
export interface UpdateBoardInput { name?: string; description?: string; }
export interface CreateTaskInput { title: string; description?: string; status?: TaskStatus; boardId: string; assigneeId?: string; }
export interface UpdateTaskInput { title?: string; description?: string; status?: TaskStatus; assigneeId?: string | null; }

export type ErrorCode = "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
export interface ApiError { error: { code: ErrorCode; message: string; }; }
```

Additionally, the contracts-agent should produce `src/contracts/schema.sql` with the SQL above, and `src/contracts/api-types.ts` with request/response type helpers.

---

## Execution Phases

### Phase 0 — Wave 0: Shared Contracts

**Agent:** contracts-agent

**Objective:** Create the shared type definitions, database schema, and API contract types that all downstream agents depend on.

**Deliverables:**
1. `src/contracts/types.ts` — All entity types, input types, and error types as specified above
2. `src/contracts/schema.sql` — SQLite CREATE TABLE statements for all 3 entities
3. `src/contracts/api-types.ts` — Request/response wrapper types for route handlers

**File Ownership:**
- `src/contracts/` (all files within)

**Acceptance Criteria:**
- All types compile with `npx tsc --noEmit`
- Types match the schema tables defined in this plan
- Input types use optional fields for update operations
- Error types match the error response format

---

### Phase 1 — Wave 1: Parallel Implementation

Two independent tracks execute simultaneously. Neither track may modify files owned by the other.

#### Track A: Data Layer

**Agent:** implementer-agent (data-layer)

**Objective:** Implement the SQLite database setup and repository functions for CRUD operations on all 3 entities.

**File Ownership:**
- `src/db/` (all files within)
- `src/repositories/` (all files within)

**Deliverables:**
1. `src/db/connection.ts` — Database connection factory. Exports `getDb()` that returns a better-sqlite3 Database instance. Accepts optional file path (defaults to `:memory:` for tests).
2. `src/db/migrate.ts` — Reads `src/contracts/schema.sql` and runs it against the database. Exports `migrate(db)`.
3. `src/repositories/user.repository.ts` — Exports: `createUser(db, input)`, `getUserById(db, id)`, `getAllUsers(db)`, `updateUser(db, id, input)`, `deleteUser(db, id)`. All functions accept a db instance as the first parameter.
4. `src/repositories/board.repository.ts` — Exports: `createBoard(db, input)`, `getBoardById(db, id)`, `getAllBoards(db)`, `updateBoard(db, id, input)`, `deleteBoard(db, id)`.
5. `src/repositories/task.repository.ts` — Exports: `createTask(db, input)`, `getTaskById(db, id)`, `getTasksByBoardId(db, boardId)`, `updateTask(db, id, input)`, `deleteTask(db, id)`.
6. `src/repositories/__tests__/user.repository.test.ts` — Unit tests for user CRUD operations.
7. `src/repositories/__tests__/board.repository.test.ts` — Unit tests for board CRUD operations.
8. `src/repositories/__tests__/task.repository.test.ts` — Unit tests for task CRUD operations.

**Acceptance Criteria:**
- All repository functions use parameterized queries (no string interpolation of values)
- UUID generation uses `crypto.randomUUID()`
- Create functions return the created entity
- Update functions return the updated entity or null if not found
- Delete functions return boolean (true if deleted, false if not found)
- Get-by-id returns entity or null
- All tests pass via `npx vitest run`

**Reads (from contracts):**
- `src/contracts/types.ts`
- `src/contracts/schema.sql`

---

#### Track B: API Routes

**Agent:** implementer-agent (api-routes)

**Objective:** Implement Express route handlers for all 3 entities and shared middleware.

**File Ownership:**
- `src/routes/` (all files within)
- `src/middleware/` (all files within)

**Deliverables:**
1. `src/middleware/error-handler.ts` — Express error-handling middleware. Catches errors and returns `ApiError` JSON responses with appropriate status codes. Exports `errorHandler`.
2. `src/middleware/validate.ts` — Simple request body validation helper. Exports `validateBody(schema)` middleware factory where schema is a plain object describing required fields. Returns 400 with `VALIDATION_ERROR` on failure.
3. `src/routes/user.routes.ts` — Express Router with all 5 user endpoints. Handlers accept `req, res, next` and call repository functions from `req.app.locals.repositories`. Exports `userRouter`.
4. `src/routes/board.routes.ts` — Express Router with all 5 board endpoints. Exports `boardRouter`.
5. `src/routes/task.routes.ts` — Express Router with all 5 task endpoints (including GET tasks by board). Exports `taskRouter`.
6. `src/routes/__tests__/user.routes.test.ts` — Route handler tests using mocked repositories.
7. `src/routes/__tests__/board.routes.test.ts` — Route handler tests using mocked repositories.
8. `src/routes/__tests__/task.routes.test.ts` — Route handler tests using mocked repositories.

**Acceptance Criteria:**
- Routes do NOT import database code directly; they access repositories through `req.app.locals.repositories`
- All routes use try/catch and pass errors to `next()`
- Validation middleware rejects requests with missing required fields
- Route handlers return correct HTTP status codes per the API route table
- All tests pass via `npx vitest run`

**Reads (from contracts):**
- `src/contracts/types.ts`
- `src/contracts/api-types.ts`

---

### Phase 2 — Wave 2: Integration and Wiring

**Agent:** wiring-agent

**Objective:** Wire together routes and repositories, create the app entry point, and ensure all cross-boundary integrations work.

**File Ownership:**
- `src/app.ts`
- `src/index.ts`

**Deliverables:**
1. `src/app.ts` — Creates and configures Express app:
   - Sets up JSON body parsing
   - Creates database connection and runs migrations
   - Instantiates repositories and attaches to `app.locals.repositories`
   - Mounts all route modules at their prefixes
   - Attaches error-handling middleware last
   - Exports `createApp(dbPath?)` for testing and `app` as default
2. `src/index.ts` — Entry point that imports `createApp`, starts server on `PORT` env var (default 3000), logs startup message.

**Acceptance Criteria:**
- `createApp()` with no arguments uses in-memory SQLite (for tests)
- `createApp(path)` uses file-based SQLite
- All route prefixes match the API route table (`/api/users`, `/api/boards`, `/api/tasks`)
- Error handler is mounted after all routes
- Application starts without errors: `npx tsx src/index.ts`

**Reads (from contracts and prior waves):**
- `src/contracts/types.ts`
- `src/db/connection.ts` (exports)
- `src/db/migrate.ts` (exports)
- `src/repositories/*.ts` (exports)
- `src/routes/*.ts` (exports)
- `src/middleware/error-handler.ts` (exports)

**Cross-Boundary Requests to Process:**
- Any requests from Wave 1 agents in `.plan-execution/ephemeral/requests/`

---

### Verification — After Each Wave

**Agent:** verification-agent

**Verification Commands:**
1. `npx tsc --noEmit` — TypeScript compilation check (all waves)
2. `npx vitest run` — Test execution (waves 1 and 2)
3. `npx eslint src/` — Lint check (all waves)

**Wave 0 Checks:**
- TypeScript compiles
- Contract files exist and export expected symbols

**Wave 1 Checks:**
- TypeScript compiles
- All repository tests pass
- All route tests pass
- No file ownership violations (no track crossed into the other's directories)

**Wave 2 Checks:**
- TypeScript compiles
- All tests pass (unit + integration)
- Application starts and responds to health check
- All CRUD endpoints return correct status codes

---

## Acceptance Criteria (Final)

1. `npx tsc --noEmit` exits with code 0
2. `npx vitest run` exits with code 0 with all tests passing
3. `npx eslint src/` exits with code 0 (or only warnings, no errors)
4. All 15 API endpoints return the correct HTTP status codes
5. Foreign key constraints are enforced (deleting a user cascades to boards and tasks)
6. No hardcoded values; all configuration via environment variables or function parameters

## Verification Commands

```bash
npx tsc --noEmit
npx vitest run
npx eslint src/
```

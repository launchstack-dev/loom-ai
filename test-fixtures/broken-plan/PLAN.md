# Social Feed App Plan

## Overview

A social media feed application with user profiles, posts, and comments. Uses Node.js with FizzBuzz ORM for database access.

## Tech Stack

- Node.js, TypeScript, Express
- FizzBuzz ORM for database access (handles all queries and migrations)
- PostgreSQL

## Schema / Type Definitions

### Post

| Field     | Type   | Constraints       |
|-----------|--------|-------------------|
| id        | string | UUID, primary key |
| content   | string | max 5000 chars    |
| authorId  | string | FK -> UserProfile |
| createdAt | string | ISO 8601          |

### Comment

| Field    | Type   | Constraints       |
|----------|--------|-------------------|
| id       | string | UUID, primary key |
| body     | string | max 2000 chars    |
| postId   | string | FK -> Post.id     |
| authorId | string | FK -> UserProfile |

Note: The `authorId` fields reference the `UserProfile` type which defines the user schema.

## Execution Phases

### Phase 1 — Wave 1: Base Infrastructure

**Agent:** implementer-agent

**Deliverables:**
1. `src/models/post.ts`
2. `src/models/comment.ts`
3. `src/routes/posts.ts`

**File Ownership:**
- `src/models/`
- `src/routes/`

---

### Phase 2 — Wave 2: Feed Aggregation

**Depends on:** Phase 3

**Agent:** implementer-agent

**File Ownership:**
- `src/services/`
- `src/utils/helpers.ts`

**Deliverables:**
1. `src/services/feed.ts` — Feed aggregation service
2. `src/services/ranking.ts` — Post ranking algorithm
3. `src/utils/helpers.ts` — Shared utility functions

---

### Phase 3 — Wave 3: Notifications and Realtime

**Depends on:** Phase 2

**Agent:** implementer-agent

**File Ownership:**
- `src/notifications/`
- `src/utils/helpers.ts`
- `src/websocket/`

**Deliverables:**
1. `src/notifications/email.ts` — Email notification sender
2. `src/notifications/push.ts` — Push notification sender
3. `src/notifications/templates/welcome.ts` — Welcome email template
4. `src/notifications/templates/comment.ts` — Comment notification template
5. `src/notifications/templates/like.ts` — Like notification template
6. `src/utils/helpers.ts` — Shared utility functions
7. `src/websocket/server.ts` — WebSocket server setup
8. `src/websocket/handlers/feed.ts` — Live feed handler
9. `src/websocket/handlers/notifications.ts` — Live notification handler
10. `src/websocket/handlers/presence.ts` — User presence handler
11. `src/websocket/handlers/typing.ts` — Typing indicator handler
12. `src/websocket/middleware/auth.ts` — WebSocket auth middleware
13. `src/websocket/middleware/rateLimit.ts` — WebSocket rate limiter
14. `src/websocket/middleware/logging.ts` — WebSocket logging
15. `src/websocket/events/index.ts` — Event type definitions
16. `src/websocket/events/validators.ts` — Event payload validators

---

## Acceptance Criteria

1. All feeds load in under 200ms
2. Notifications are delivered within 5 seconds
3. WebSocket connections handle 1000 concurrent users

# Wiki Page Schema

Defines the structure of individual wiki pages stored in `.loom/wiki/pages/`. Each page is a Markdown file with a TOON frontmatter block. All wiki agents MUST read this schema before creating or modifying pages.

## Page File Format

Wiki pages use a fenced TOON block at the top of the file (the frontmatter), followed by Markdown body content. This parallels how agent `.md` files use YAML frontmatter.

````markdown
```toon
pageId: component-auth-middleware
title: Auth Middleware
category: component
domain: code
createdAt: 2026-04-12T10:00:00Z
updatedAt: 2026-04-12T14:30:00Z
createdBy: wiki-ingest-agent
updatedBy: wiki-maintainer-agent
sourceRefs[2]: src/auth/middleware.ts, src/auth/types.ts
crossRefs[3]{pageId,relationship}:
  component-jwt-utils,depends-on
  decision-auth-strategy,implements
  pattern-middleware-chain,exemplifies
tags[3]: auth, middleware, security
staleness: fresh
confidence: high
```

# Auth Middleware

The authentication middleware validates JWT tokens on protected routes...

## Dependencies
- **JWT Utils** — token signing and verification
- ...

## Key Behaviors
- Extracts Bearer token from Authorization header
- ...
````

## Frontmatter Schema

```toon
pageId: {category}-{kebab-case-name}
title: Human-Readable Title
category: component
domain: code
createdAt: ISO-8601
updatedAt: ISO-8601
createdBy: {agent-name or "human"}
updatedBy: {agent-name or "human"}
sourceRefs[N]: file-path-1, file-path-2
crossRefs[N]{pageId,relationship}:
  other-page-id,relationship-type
tags[N]: tag1, tag2
staleness: fresh
confidence: high
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `pageId` | yes | Unique identifier. Format: `{category}-{kebab-case-name}`. Must match filename without `.md`. |
| `title` | yes | Human-readable title displayed in index and cross-references. |
| `category` | yes | One of the defined page categories (see below). |
| `domain` | yes | Project domain: `code`, `research`, `creative`, `business`, or custom. |
| `createdAt` | yes | ISO-8601 timestamp of page creation. |
| `updatedAt` | yes | ISO-8601 timestamp of last modification. |
| `createdBy` | yes | Agent name or `human` that created the page. |
| `updatedBy` | yes | Agent name or `human` that last modified the page. |
| `sourceRefs` | yes | Files, URLs, or artifact paths this page is derived from. Empty array if conceptual. |
| `crossRefs` | yes | Bidirectional references to other wiki pages. Empty array if none. |
| `tags` | yes | Free-form tags for search and filtering. |
| `staleness` | yes | `fresh`, `aging`, or `stale` — **recomputed on every page write** from `updatedAt` vs threshold. Agents MUST recompute this field whenever writing a page, not rely on the stored value. Readers should treat the stored value as a cache that may be stale. |
| `confidence` | yes | `high`, `medium`, or `low` — how reliable the content is. |

## Page Categories

| Category | Prefix | Description | Examples |
|----------|--------|-------------|----------|
| `component` | `component-` | A code module, service, or architectural component | `component-auth-middleware`, `component-user-service` |
| `concept` | `concept-` | A domain concept, theory, or principle | `concept-jwt-tokens`, `concept-rate-limiting` |
| `decision` | `decision-` | An architectural or design decision with rationale | `decision-auth-strategy`, `decision-database-choice` |
| `pattern` | `pattern-` | A recurring pattern or best practice in the project | `pattern-middleware-chain`, `pattern-repository` |
| `convention` | `convention-` | A project convention or coding standard | `convention-naming`, `convention-error-handling` |
| `api-surface` | `api-surface-` | An API endpoint group or external integration surface | `api-surface-users`, `api-surface-stripe` |
| `tech-debt` | `tech-debt-` | A known technical debt item or improvement opportunity | `tech-debt-old-migrations`, `tech-debt-missing-tests` |
| `external` | `external-` | An external integration, service, or dependency | `external-stripe-webhooks`, `external-sendgrid` |
| `execution-record` | `execution-record-` | A record of a specific execution event or outcome | `execution-record-wave-2-auth` |

## Cross-Reference Relationships

| Relationship | Meaning | Example |
|-------------|---------|---------|
| `depends-on` | This page's subject depends on the referenced page's subject | Auth middleware depends on JWT utils |
| `depended-by` | Inverse of depends-on (auto-generated for bidirectionality) | JWT utils is depended on by auth middleware |
| `implements` | This page's subject implements a decision or pattern | Auth middleware implements the auth strategy decision |
| `exemplifies` | This page demonstrates a pattern | Auth middleware exemplifies the middleware chain pattern |
| `supersedes` | This page replaces an older page | New auth strategy supersedes old auth strategy |
| `relates-to` | General association | Auth middleware relates to rate limiting concept |
| `conflicts-with` | This page's claims conflict with another page | Flagged by wiki-lint-agent |

## Staleness Model

Staleness is computed from the `updatedAt` field relative to a configurable threshold (default: 30 days, set via `orchestration.toml [wiki].stalenessDays`):

| State | Condition | Meaning |
|-------|-----------|---------|
| `fresh` | `updatedAt` < N days ago | Content is current |
| `aging` | `updatedAt` between N and 2N days ago | Content may need review |
| `stale` | `updatedAt` > 2N days ago | Content likely outdated — wiki-lint-agent flags this |

Staleness is also triggered when a page's `sourceRefs` files have been modified more recently than the page's `updatedAt`.

**Important:** `staleness` is a cached computation, not a source of truth. It is recomputed whenever any agent writes the page. Between writes, the stored value may drift. Wiki-lint-agent detects drift via W-003.

## Naming Rules

1. **Filename matches pageId**: `component-auth-middleware.md` has `pageId: component-auth-middleware`
2. **Category prefix is mandatory**: Every pageId starts with its category prefix
3. **Kebab-case after prefix**: `component-user-service`, not `component-UserService`
4. **No spaces or special characters** in pageId or filename
5. **Maximum 120 characters** for pageId

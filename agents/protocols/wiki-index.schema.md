# Wiki Index Schema

Defines the structure of `.loom/wiki/index.toon` — the categorical catalog of all wiki pages. The index is the primary navigation tool for wiki agents and the entry point for queries.

## Schema

```toon
schemaVersion: 1
projectName: my-project
domain: code
wikiVersion: 14
pageCount: 48
lastUpdated: 2026-04-12T14:30:00Z

pages[48]{pageId,title,category,staleness,updatedAt}:
  component-auth-middleware,Auth Middleware,component,fresh,2026-04-12T14:30:00Z
  component-user-service,User Service,component,fresh,2026-04-12T12:00:00Z
  concept-jwt-tokens,JWT Tokens,concept,fresh,2026-04-12T10:00:00Z
  decision-auth-strategy,Auth Strategy,decision,fresh,2026-04-12T09:00:00Z
  decision-database-choice,Database Choice,decision,aging,2026-03-20T10:00:00Z
  pattern-middleware-chain,Middleware Chain,pattern,fresh,2026-04-12T10:00:00Z
  api-surface-users,Users API,api-surface,fresh,2026-04-12T14:00:00Z
  tech-debt-old-migrations,Old Migrations,tech-debt,stale,2026-03-01T10:00:00Z
  execution-record-wave-0,Wave 0 Contracts,execution-record,fresh,2026-04-12T09:30:00Z

categories[9]{name,count}:
  component,23
  concept,8
  decision,7
  pattern,5
  convention,4
  api-surface,3
  tech-debt,2
  external,1
  execution-record,1
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `schemaVersion` | yes | Always `1`. For future format changes. |
| `projectName` | yes | Name of the project this wiki belongs to. |
| `domain` | yes | Project domain: `code`, `research`, `creative`, `business`, or custom. |
| `wikiVersion` | yes | Monotonically increasing counter. Incremented on every index write. |
| `pageCount` | yes | Total number of pages. Must match actual row count in `pages` array. |
| `lastUpdated` | yes | ISO-8601 timestamp of last index modification. |
| `pages` | yes | Typed array of all wiki pages with summary fields. |
| `categories` | yes | Category counts for quick overview. Must match actual page distribution. |

## Rules

1. **Single source of truth.** The index is the authoritative list of wiki pages. Pages not listed in the index are considered orphaned.
2. **Atomic writes.** Write to `index.toon.tmp`, rename to `index.toon`.
3. **Increment `wikiVersion`** on every write. This enables clients to detect changes.
4. **Keep `pageCount` and `categories` in sync** with the actual `pages` array. Wiki-lint-agent checks for drift.
5. **Sorted by category then pageId.** Maintain consistent ordering for diffability.
6. **The wiki-query-agent reads this first** when answering questions — it uses title, category, and staleness to identify candidate pages without reading every page file.

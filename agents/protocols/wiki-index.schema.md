# Wiki Index Schema

Defines the structure of `.loom/wiki/index.toon` — the categorical catalog of all wiki pages. The index is the primary navigation tool for wiki agents and the entry point for queries. As of `schemaVersion: 2`, the index also carries enough information (`summary`, `estimatedTokens`, `subtype`) for the rolling-context packer to make O(1) packing decisions without reading page bodies.

## Schema (schemaVersion 2)

```toon
schemaVersion: 2
projectName: my-project
domain: code
wikiVersion: 14
pageCount: 50
lastUpdated: 2026-04-12T14:30:00Z

pages[50]{pageId,title,category,subtype,staleness,updatedAt,summary,estimatedTokens}:
  component-auth-middleware,Auth Middleware,component,,fresh,2026-04-12T14:30:00Z,Validates JWT tokens on protected routes; fail-closed on signature mismatch.,420
  component-user-service,User Service,component,,fresh,2026-04-12T12:00:00Z,User CRUD with role-based permission checks against the policy service.,510
  concept-jwt-tokens,JWT Tokens,concept,,fresh,2026-04-12T10:00:00Z,Signed JSON tokens carrying user identity; verified per request via shared secret.,210
  decision-auth-strategy,Auth Strategy,decision,,fresh,2026-04-12T09:00:00Z,JWT chosen over sessions for stateless horizontal scaling.,180
  decision-database-choice,Database Choice,decision,,aging,2026-03-20T10:00:00Z,PostgreSQL chosen for ACID guarantees and pgvector future-proofing.,220
  pattern-middleware-chain,Middleware Chain,pattern,,fresh,2026-04-12T10:00:00Z,Express-style middleware composition; each step calls next() or terminates.,260
  api-surface-users,Users API,api-surface,,fresh,2026-04-12T14:00:00Z,Public users endpoints — CRUD plus password reset and email verification.,340
  tech-debt-old-migrations,Old Migrations,tech-debt,,stale,2026-03-01T10:00:00Z,Pre-Prisma migrations still required for legacy customer schemas; cleanup pending.,150
  execution-record-wave-0,Wave 0 Contracts,execution-record,,fresh,2026-04-12T09:30:00Z,Wave 0 produced shared TypeScript contracts for user and order entities.,290
  flow-user-signup,User Signup,flow,user-journey,fresh,2026-05-23T11:00:00Z,Five-step signup flow: validate, dedupe, hash, insert, queue welcome email.,310
  contract-user-create,User Create Contract,contract,api,fresh,2026-05-23T11:00:00Z,POST /api/users → 201 {id,email,name} | 400; email-unique invariant; backward-compatible.,180

categories[11]{name,count}:
  component,23
  concept,8
  decision,7
  pattern,5
  convention,4
  api-surface,3
  tech-debt,2
  external,1
  execution-record,1
  flow,1
  contract,1
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `schemaVersion` | yes | `2` as of the flows-and-contracts upgrade. Was `1` previously. `/loom-upgrade` Rule 7 migrates v1 → v2. |
| `projectName` | yes | Name of the project this wiki belongs to. |
| `domain` | yes | Project domain: `code`, `research`, `creative`, `business`, or custom. |
| `wikiVersion` | yes | Monotonically increasing counter. Incremented on every index write. |
| `pageCount` | yes | Total number of pages. Must match actual row count in `pages` array. |
| `lastUpdated` | yes | ISO-8601 timestamp of last index modification. |
| `pages` | yes | Typed array of all wiki pages with summary fields. See pages columns below. |
| `categories` | yes | Category counts for quick overview. Must match actual page distribution. As of schemaVersion 2, includes `flow` and `contract` rows. |

### `pages[]` columns (schemaVersion 2)

| Column | Type | Description |
|--------|------|-------------|
| `pageId` | string | Unique page identifier (e.g., `flow-user-signup`) |
| `title` | string | Human-readable title |
| `category` | string | Page category (one of the 11 categories) |
| `subtype` | string | Category-specific subtype. Empty for most categories. For `flow-*`: mirrors `flowType`. For `contract-*`: mirrors `contractType`. Enables category-aware filtering without body reads. |
| `staleness` | string | `fresh` / `aging` / `stale` — cached value; readers should treat as best-effort. |
| `updatedAt` | string | ISO-8601 timestamp of last page write. |
| `summary` | string | 1-2 sentence elevator pitch mirroring the page's frontmatter `summary` field. Max 200 chars. The orchestrator packs summaries first into the rolling-context `[WIKI]` block before expanding any bodies. Legacy placeholder `"(legacy — pending refresh)"` may appear post-migration until a real summary is written. |
| `estimatedTokens` | int | `Math.ceil(charCount / 4)` for the full page (frontmatter + body). Enables budget-aware packing — the orchestrator can pack the 1k `[WIKI]` budget by token cost without reading any page body. |

## Rules

1. **Single source of truth.** The index is the authoritative list of wiki pages. Pages not listed in the index are considered orphaned.
2. **Atomic writes.** Write to `index.toon.tmp`, rename to `index.toon`.
3. **Increment `wikiVersion`** on every write. This enables clients to detect changes.
4. **Keep `pageCount` and `categories` in sync** with the actual `pages` array. Wiki-lint-agent checks for drift.
5. **Sorted by category then pageId.** Maintain consistent ordering for diffability.
6. **The wiki-query-agent reads this first** when answering questions — it uses title, category, subtype, summary, and staleness to identify candidate pages without reading page bodies.
7. **The orchestrator's rolling-context packer reads this exclusively** to make `[WIKI]` block packing decisions. It MUST NOT read page bodies for packing — `summary` and `estimatedTokens` are designed to make body reads unnecessary for the packing step. Bodies are read only after a page wins a slot in the budget.
8. **Mirror discipline.** `summary`, `estimatedTokens`, and `subtype` in the index MUST match the page's frontmatter at write time. Drift between index and frontmatter is a wiki-lint finding (W-003 family).

## Migration from schemaVersion 1

`/loom-upgrade` Rule 7 handles legacy index files:

- If `schemaVersion: 1` → bump to `2`.
- If `schemaVersion` field missing entirely → insert `schemaVersion: 2` as the first line.
- If `categories[]` array missing → reconstruct by scanning `.loom/wiki/pages/` and counting per-prefix.
- Add `summary` and `estimatedTokens` columns to the `pages[]` typed-array header.
- For each page row, backfill `summary: "(legacy — pending refresh)"` and `estimatedTokens` computed from the page file's character count. Add `subtype: ""` for non-flow/non-contract pages.
- For each page file in `.loom/wiki/pages/`, also write the new fields into the page's TOON frontmatter (atomic per page). Lint W-026 treats the legacy placeholder as `info` severity, not `warn`, until the next agent write replaces it with a real summary.

The migration is idempotent — re-running on a v2 wiki is a no-op.

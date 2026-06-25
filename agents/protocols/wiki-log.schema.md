---
description: "Wiki Log Schema"
---

# Wiki Log Schema

Defines the structure of `.loom/wiki/log.toon` — the append-only chronological record of all wiki operations. Provides a timeline of wiki evolution and helps agents understand recent activity.

## Schema

```toon
schemaVersion: 1
entryCount: 142
lastEntry: 2026-04-12T14:30:00Z

entries[142]{timestamp,operation,pageId,agent,summary}:
  2026-04-12T10:00:00Z,create,component-auth-middleware,wiki-ingest-agent,Created page from codebase analysis
  2026-04-12T10:00:05Z,create,component-user-service,wiki-ingest-agent,Created page from codebase analysis
  2026-04-12T10:01:00Z,cross-ref-add,component-auth-middleware,wiki-maintainer-agent,Added cross-ref to component-jwt-utils (depends-on)
  2026-04-12T14:30:00Z,update,component-auth-middleware,wiki-maintainer-agent,Updated after Wave 2 execution — new rate limiting behavior
```

## Operations

| Operation | Meaning |
|-----------|---------|
| `create` | New page created |
| `update` | Existing page content modified |
| `delete` | Page removed |
| `cross-ref-add` | Cross-reference added between pages |
| `cross-ref-remove` | Cross-reference removed |
| `merge` | Two pages merged into one |
| `lint-fix` | Automated fix applied by wiki-lint-agent |
| `ingest` | Page created or updated as part of a `/loom-ingest` batch |
| `note-assimilate` | Page created or updated from a `/loom-note --tag wiki` entry |

## Rules

1. **Append-only.** Never modify or delete existing entries. Only append new entries at the end.
2. **Atomic writes.** Read existing content, append new entries, write to `.tmp`, rename.
3. **Keep `entryCount` accurate.** Must match actual entry rows. Updated on every append.
4. **Chronological order.** Entries are always in ascending timestamp order.
5. **One entry per operation.** A single ingest that creates 15 pages produces 15 `ingest` entries.
6. **Parseable with unix tools.** Each entry row has consistent comma-separated fields. The log can be grepped for specific operations, pages, or agents.

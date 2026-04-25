# Wiki Conventions

Shared rules that all wiki agents and wiki-aware orchestrators follow. Reference this document in every wiki agent's instructions.

## Directory Structure

```
.loom/                                  # Persistent knowledge base (git-tracked)
  wiki/
    index.toon                          # Categorical catalog (see wiki-index.schema.md)
    log.toon                            # Append-only operation log (see wiki-log.schema.md)
    execution-log.toon                  # Narrative decision/pivot history (see execution-log.schema.md)
    pages/                              # Individual wiki pages
      component-*.md                    # Code modules, services, architectural components
      concept-*.md                      # Domain concepts, theories, principles
      decision-*.md                     # Architectural/design decisions with rationale
      pattern-*.md                      # Recurring patterns and best practices
      convention-*.md                   # Project conventions and coding standards
      structure-*.md                    # Directory layout blueprints and file organization
      api-surface-*.md                  # API endpoint groups and integration surfaces
      tech-debt-*.md                    # Known tech debt and improvement opportunities
      external-*.md                     # External integrations, services, dependencies
      execution-record-*.md             # Records of specific execution events/outcomes
```

## Page File Format

Each page is a Markdown file with a TOON frontmatter block. See `wiki-page.schema.md` for the full schema.

```markdown
 ```toon
 pageId: component-auth-middleware
 title: Auth Middleware
 category: component
 ...
 ```

 # Auth Middleware

 Body content in Markdown...
```

The TOON frontmatter is wrapped in a fenced code block (triple backticks with `toon` language tag) at the very start of the file. The Markdown body follows immediately after the closing fence.

## Initialization

When `.loom/wiki/` is first created (by `/loom-init` or manually):

1. Create directory structure: `.loom/wiki/pages/`
2. Create empty `index.toon`:
   ```toon
   schemaVersion: 1
   projectName: {project name}
   domain: {domain from orchestration.toml or "code"}
   wikiVersion: 0
   pageCount: 0
   lastUpdated: {now}

   pages[0]{pageId,title,category,staleness,updatedAt}:

   categories[0]{name,count}:
   ```
3. Create empty `log.toon`:
   ```toon
   schemaVersion: 1
   entryCount: 0
   lastEntry: {now}

   entries[0]{timestamp,operation,pageId,agent,summary}:
   ```
4. Create empty `execution-log.toon`:
   ```toon
   schemaVersion: 1
   projectName: {project name}
   entryCount: 0
   lastEntry: {now}

   entries[0]{timestamp,type,actor,summary,detail,relatedPages}:
   ```

## Wiki Maintenance Triggers

The orchestrator spawns wiki-maintainer-agent at these points during execution:

| Event | Trigger Point | What the Maintainer Does |
|-------|--------------|--------------------------|
| Wave completes | After verification-agent passes | Update/create component pages for changed files, record exports, update cross-refs |
| Code review finishes | After review report is assembled | Create decision pages for architectural findings, flag issues in component pages |
| Fix cycle completes | After fixer verification passes | Update affected component pages, resolve flagged issues |
| Convergence iteration | After delta report | Record convergence observations, update pages with discovered constraints |
| Human gate decision | After approval/rejection | Record decision in execution-log.toon, create/update decision page |
| Plan revision | After `--refine` completes | Update wiki pages for changed scope, mark stale pages |

Wiki maintenance is **non-blocking**: if wiki-maintainer-agent fails, the orchestrator logs a warning and continues. Wiki health is additive, never gating.

## Cross-Reference Maintenance

When a page is created or updated, the wiki-maintainer-agent MUST:

1. **Scan for cross-reference candidates.** Read the page body for mentions of entities that match other page titles or pageIds.
2. **Add bidirectional cross-refs.** If page A references page B, add `crossRefs` entries to both pages. Use the appropriate relationship type (see `wiki-page.schema.md`).
3. **Remove stale cross-refs.** If a page no longer mentions a referenced entity, remove the cross-ref from both sides.
4. **Update index.toon.** Reflect any page changes in the index.
5. **Append to log.toon.** Record each cross-ref operation.

Cross-ref updates are **batched per event** — if an ingest creates 15 pages, the maintainer does one cross-ref pass across all 15, not 15 separate passes.

**Cross-reference cap.** Pages are limited to a maximum of 20 cross-references. If a page body mentions more than 20 other entities, keep only the 20 strongest relationships (prefer `depends-on` and `implements` over `relates-to`). For pages with `confidence: low` (typically from external document ingestion), skip automatic cross-reference generation entirely — cross-refs for low-confidence pages must be added manually or by explicit review.

### Partial Failure Handling

Cross-reference updates are bidirectional, so partial writes can leave the wiki in an inconsistent state. To mitigate this:

1. **Collect all cross-ref operations in memory before writing any files.** Build the full list of page writes needed (both sides of every cross-ref pair) before touching disk.
2. **Write all affected pages in sequence.** Apply the collected operations one page at a time using atomic writes.
3. **If any page write fails,** log which pages were successfully written and which failed. Do not attempt to roll back already-written pages.
4. **Set agent status to `partial`** (not `success`) when any cross-ref pair is incomplete — i.e., one side was written but the other was not.
5. **Include incomplete pairs in the output `issues` array** with severity `warning`, describing which pages have one-sided cross-refs.
6. **Run `wiki-lint --fix` after partial failures** to repair consistency. The wiki-lint-agent's W-004 (broken cross-ref) and W-006 (missing cross-ref) checks detect and fix one-sided references.

## Staleness Model

Pages have a `staleness` field computed from `updatedAt` relative to a configurable threshold:

- **Threshold** (N): `orchestration.toml [wiki].stalenessDays` (default: 30)
- **`fresh`**: `updatedAt` is less than N days ago
- **`aging`**: `updatedAt` is between N and 2N days ago
- **`stale`**: `updatedAt` is more than 2N days ago

Additionally, a page is marked `stale` if ANY of its `sourceRefs` files have been modified more recently than the page's `updatedAt` timestamp (detected by comparing git modification times via `git log` or file timestamps as a fallback).

Wiki-lint-agent checks staleness during health sweeps and reports `stale` pages as `info`-severity findings.

## Atomic Writes

All agents and orchestrators MUST use atomic writes for wiki state files:

1. Write content to `{filename}.tmp`
2. Rename `{filename}.tmp` to `{filename}`
3. Before writing, check if `{filename}.tmp` already exists. If it does, delete it — it is from a previous failed write.
4. Use unique temp names when concurrent writes are possible: `{filename}.tmp.{timestamp}` to avoid collisions.

This prevents partial reads of corrupted state. Applies to `index.toon`, `log.toon`, `execution-log.toon`, and individual page files.

**Concurrency rule.** Orchestrators MUST serialize wiki state file writes. Only one agent should write to `index.toon` or `log.toon` at a time. The orchestrator ensures this by spawning wiki-maintainer-agent and wiki-lint-agent sequentially, never in parallel. Individual page files may be written concurrently if they target different pages.

Wiki-lint-agent should detect orphaned `.tmp` files in `.loom/wiki/` as an enhancement to the W-* check suite (e.g., a future W-014 check).

## Wiki-Execution Boundary

The wiki and execution state are separate persistence layers:

| Layer | Location | Lifecycle | Git-tracked |
|-------|----------|-----------|-------------|
| **Wiki** | `.loom/wiki/` | Persistent across executions | Yes |
| **Execution** | `.plan-execution/` | Ephemeral per execution run | No |
| **History** | `.plan-history/` | Persistent execution records | Yes |

The **wiki-maintainer-agent** bridges these layers:
- Reads execution results from `.plan-execution/` (wave summaries, AgentResults, review reports)
- Updates wiki pages in `.loom/wiki/pages/`
- Records narrative entries in `.loom/wiki/execution-log.toon`

Wiki agents NEVER write to `.plan-execution/` or `.plan-history/`. Execution agents NEVER write to `.loom/wiki/` (enforced by `wiki-write-guard` hook).

## Wiki in Rolling Context

Orchestrators MAY include wiki page summaries in `rolling-context.md` for agents that need project knowledge beyond the immediate wave context. When included, wiki content goes in a separate section:

```markdown
## Project Knowledge [WIKI]
Key components: auth-middleware (JWT validation), user-service (CRUD + permissions).
Key decisions: JWT over sessions (performance), Postgres over Redis (simplicity).
Known issues: auth-middleware lacks rate limiting (tech-debt-rate-limiting).
```

This section should be kept under 1k tokens and only include pages relevant to the current wave's tasks.

## Domain Independence

Wiki pages use the same TOON frontmatter format regardless of domain. The `domain` field in each page's frontmatter indicates the project type:

| Domain | Components become | Decisions become | Patterns become |
|--------|------------------|-----------------|-----------------|
| `code` | Modules, services, APIs | Architecture choices | Design patterns |
| `research` | Chapters, sections | Methodology choices | Analysis frameworks |
| `creative` | Scenes, characters, arcs | Narrative choices | Storytelling techniques |
| `business` | Departments, processes | Strategy choices | Business patterns |

The page categories, cross-reference system, staleness model, and maintenance rules are identical across all domains.

## Significance Threshold

Not every file or concept deserves a wiki page. The wiki-ingest-agent uses these heuristics to determine significance:

1. **Exported symbols**: File exports public API (types, functions, classes)
2. **Size threshold**: File exceeds 50 lines of meaningful code
3. **Multi-file references**: Entity is imported or referenced by 2+ other files
4. **Architectural role**: File serves a structural role (middleware, routes, models, config)
5. **External integration**: File connects to an external service

Trivial utilities, test helpers, and single-use internal functions should NOT get their own pages. They may be mentioned within a parent component's page.

## Page Archiving

Pages that remain stale for an extended period are candidates for archiving, which keeps the active wiki focused and within the `maxPages` budget.

1. **Archive threshold.** Pages marked `stale` for longer than 3x the `stalenessDays` threshold (i.e., `updatedAt` is more than 6N days ago at default settings) are candidates for archiving. This multiplier is configurable via `archiveThresholdMultiplier` (default: 3).
2. **Detection.** Wiki-lint-agent proposes archive candidates via a W-015 check (`archive-candidate`), reported at `info` severity.
3. **Archiving action.** `/loom-lint --fix` moves archive candidates to `.loom/wiki/archive/` and removes them from `index.toon`. The `archive/` directory is created automatically if it does not exist.
4. **Preservation.** Archived pages retain their full frontmatter for potential restoration. No content is deleted — pages are only relocated.
5. **Page counting.** The `maxPages` circuit breaker counts only active (non-archived) pages. Archived pages do not count toward the limit.
6. **Restoration.** To restore an archived page, move it back to `.loom/wiki/pages/` and re-add it to `index.toon` (manually or via `/loom-ingest --source`).

## Configuration

Wiki behavior is configured via `orchestration.toml`:

```toml
[wiki]
path = ".loom/wiki"                  # Wiki root directory
maxPages = 500                       # Page count circuit breaker
stalenessDays = 30                   # Days before a page is marked stale
archiveThresholdMultiplier = 3       # Stale pages archived after stalenessDays * this multiplier
autoLint = true                      # Run lint checks automatically
lintSchedule = "post-wave"           # "post-wave" | "post-execution" | "manual"
```

All fields are optional. Defaults are shown above. If `[wiki]` section is absent, wiki features still work with defaults when `.loom/wiki/` exists.

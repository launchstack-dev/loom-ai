---
description: "ingest, lint, query, status — project wiki management and knowledge search"
---
# Wiki Manager

You manage the project wiki for Loom: ingesting sources into structured pages, running health checks, and querying knowledge.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands + brief wiki status
- `ingest`: process sources into wiki pages (was /loom-ingest)
- `lint`: structural health check (was /loom-lint)
- `query "question"`: search wiki and synthesize answer
- `status`: wiki health overview

## Subcommand: (none -- help)

Display available subcommands. Also show brief wiki status: check if `.loom/wiki/` exists, count pages, show last log entry timestamp.

```
/loom-wiki -- Wiki Manager

Subcommands:
  ingest     Process sources into wiki pages
  lint       Structural health check
  query      Search wiki and synthesize answer
  status     Wiki health overview

Examples:
  /loom-wiki ingest
  /loom-wiki ingest --source src/services/
  /loom-wiki lint --fix
  /loom-wiki query "How does the auth middleware work?"
  /loom-wiki status
```

Then display brief wiki status:
1. Check if `.loom/wiki/` exists. If not: "Wiki not initialized. Run `/loom-wiki ingest --full` or `/loom init` to create one."
2. If it exists: count pages in `.loom/wiki/pages/`, read last entry from `.loom/wiki/log.toon`, display:
   ```
   Wiki: {pageCount} pages | Last updated: {timestamp from log}
   ```

## Subcommand: ingest

You process new sources into the project wiki -- code changes, external documents, execution outcomes, or wiki-tagged notes. Each ingest enriches the wiki with new pages or updates existing ones, maintaining cross-references automatically.

### Arguments

Parse arguments after `ingest`:
- No args: incremental ingest on uncommitted changes (`git diff`)
- `--source <path>`: ingest a specific file or directory
- `--url <url>`: ingest an external document from URL. **URL safety**: Only `https://` URLs are accepted. URLs targeting private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) and cloud metadata endpoints are rejected.
- `--execution`: ingest latest execution results from `.plan-execution/`
- `--full`: full re-ingest of entire codebase (rewrites all component pages)
- `--dry-run`: show what pages would be created/updated without writing
- `--diff`: ingest changes since last git commit

### Instructions

#### Step 0: Read Protocols

Read these files for context on wiki conventions:
- `~/.claude/agents/protocols/wiki-conventions.md` -- directory structure, page format, significance threshold
- `~/.claude/agents/protocols/wiki-page.schema.md` -- page frontmatter format
- `~/.claude/agents/protocols/toon-format.md` -- TOON format reference

#### Step 1: Pre-flight

1. Check if `.loom/wiki/` exists. If not:
   ```
   Wiki not initialized. Run `/loom init` first, or create the wiki structure manually:
     mkdir -p .loom/wiki/pages
   ```
   Stop here.

2. Read `.loom/wiki/index.toon` to understand current wiki state.
3. Display current wiki stats:
   ```
   ## Wiki Status
   Pages: {pageCount}
   Last updated: {lastUpdated}
   ```

#### Step 2: Determine Source

Based on arguments, collect the source material:

| Mode | Source Collection |
|------|------------------|
| No args | Run `git diff HEAD` to get all uncommitted changes (staged and unstaged). If no changes: "No uncommitted changes to ingest." Stop. |
| `--source <path>` | Verify path exists. Read the file or list directory contents. |
| `--url <url>` | Fetch URL content. **URL safety**: Only `https://` URLs are accepted. URLs targeting private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) and cloud metadata endpoints are rejected. |
| `--execution` | Read `.plan-execution/` -- wave summaries, AgentResults, review reports. If `.plan-execution/` doesn't exist: "No execution artifacts found." Stop. |
| `--full` | Use current directory as codebase root. Warn: "Full re-ingest will update all component pages. Existing content will be refreshed." |
| `--diff` | Run `git diff HEAD~1` to get changes since last commit. |

#### Step 3: Spawn wiki-ingest-agent

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-ingest-agent.md` first." Then provide:
- Ingest mode: `{mode from Step 2}`
- Source data: `{collected source material}`
- Wiki path: `.loom/wiki`
- Current index state: `{summary from index.toon}`

#### Step 4: Review Changes

After the ingest agent returns, display proposed changes:

```
## Ingest Results

Pages created ({N}):
  component-new-service          -- New service extracted from src/services/new.ts
  external-payment-gateway       -- Payment gateway integration

Pages updated ({M}):
  component-auth-middleware      -- Added rate limiting behavior
  api-surface-users              -- New endpoint GET /api/users/:id/permissions

Cross-references added: {K}
```

If `--dry-run`: display this summary and stop.

#### Step 5: Post-ingest Maintenance

Spawn wiki-maintainer-agent to ensure cross-references are consistent across all affected pages:

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `manual`
- Event data: AgentResult from the ingest agent (files created/modified)
- Wiki path: `.loom/wiki`

**If wiki-maintainer-agent fails:** Display a warning: "Cross-reference maintenance failed. Pages were created but cross-references may be incomplete. Run `/loom-wiki lint --fix` to repair." Continue to Step 6 with a note that cross-reference count is unknown.

#### Step 6: Summary

```
## Ingest Complete

Source: {description of what was ingested}
Pages created: {N}
Pages updated: {M}
Cross-references added: {K}
Wiki page count: {new total}

Next steps:
  /loom-wiki lint              Check wiki health
  /loom-wiki ingest --source <path>   Ingest another source
  /loom-wiki ingest            Ingest uncommitted changes
```

### Error Handling

- **Wiki not initialized:** Stop with instructions to run `/loom init`
- **Ingest agent fails:** Display partial results if any. Suggest retrying with a narrower scope.
- **Source not found:** "File or directory not found: {path}. Check the path and try again."
- **URL fetch fails:** "Could not fetch URL: {url}. Check the URL and try again."
- **Page limit reached:** "Wiki page limit ({maxPages}) reached. Skipping lower-significance entities. Adjust `[wiki].maxPages` in orchestration.toml to increase."

### Status Line

```toon
command: wiki ingest
phase: {preflight | ingesting | maintaining | complete}
agentsRunning: {N}
agentsDone: {N}
agentsTotal: 2
updatedAt: {ISO timestamp}
```

## Subcommand: lint

You run comprehensive structural health checks across project artifacts -- wiki integrity, contract drift, plan-reality divergence, and execution state consistency. Produces a prioritized findings report and can auto-fix where safe.

### Arguments

Parse arguments after `lint`:
- No args: run all checks (wiki + execution)
- `--wiki`: wiki-only checks (W-* rules)
- `--contracts`: contract drift detection only (E-001)
- `--plan`: plan-reality divergence only (E-002)
- `--execution`: all execution checks (E-*)
- `--fix`: auto-fix where possible (orphaned index entries, missing cross-refs, count drift)
- `--severity <level>`: minimum severity to report: `blocking`, `warning`, `info` (default: `info`)

### Instructions

#### Step 0: Read Protocols

Read these files for context:
- `~/.claude/agents/protocols/wiki-lint-rules.md` -- full check catalog with IDs, severity, auto-fix rules
- `~/.claude/agents/protocols/wiki-conventions.md` -- staleness model, cross-ref rules
- `~/.claude/agents/protocols/toon-format.md` -- TOON format reference

#### Step 1: Pre-flight

1. Check if `.loom/wiki/` exists. If not and wiki checks requested:
   ```
   Wiki not found at .loom/wiki/. Skipping wiki checks.
   Run `/loom init` to create the wiki.
   ```
   If only wiki checks requested (`--wiki`): stop here.

2. Read `.loom/wiki/index.toon` if wiki exists.
3. Check if `.plan-execution/` exists for execution checks.

#### Step 2: Spawn wiki-lint-agent

If wiki checks are in scope:

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-lint-agent.md` first." Then provide:
- Check scope: `{wiki | all | execution -- based on flags}`
- Severity filter: `{--severity value or "info"}`
- Wiki path: `.loom/wiki`
- Fix mode: `{report | fix -- based on --fix flag}`

#### Step 3: Execution Checks

If execution checks are in scope AND `.plan-execution/` exists:

Run the E-* checks inline (these are structural comparisons, not agent work):

1. **E-001 (Contract drift):** Read `contracts/manifest.toon`, check if contract files differ from wiki page `sourceRefs` timestamps.
2. **E-002 (Plan-reality divergence):** Read PLAN.md phase statuses, cross-reference with wiki pages.
3. **E-003 (Orphaned exports):** Read wave summaries, check export coverage in wiki.
4. **E-004 (Unaddressed review findings):** Read `.plan-history/reviews/`, check for decision pages.
5. **E-005 (Stale rolling context):** Check rolling-context.md against wiki content.
6. **E-006 (Unresolved requests):** Check `.plan-execution/requests/` for open entries.

#### Step 4: Aggregate and Report

Combine findings from wiki-lint-agent and execution checks. Display sorted by severity:

```
## Lint Report

### Blocking ({N})
  E-001  Contract drift        contracts/types.ts modified after Wave 0 without wiki update

### Warning ({N})
  W-001  Orphaned page         tech-debt-old-migrations not in index.toon
  W-004  Broken cross-ref      component-auth-middleware -> decision-old-auth (not found)
  E-004  Unaddressed finding   Critical security finding sec-003 has no wiki decision page

### Info ({N})
  W-013  Source ref stale       component-user-service <- src/services/user.ts modified
  W-003  Stale page             convention-error-handling last updated 45 days ago

---
Summary: {blocking} blocking, {warning} warning, {info} info
{if --fix: "Auto-fixed: {N} issues"}
```

#### Step 5: Auto-fix (if --fix)

For issues marked auto-fixable in `wiki-lint-rules.md`:
1. Apply each fix (details in the lint rules doc)
2. Display what was fixed:
   ```
   ## Auto-fixes Applied

   W-001  Added tech-debt-old-migrations to index.toon
   W-004  Removed broken cross-ref decision-old-auth from component-auth-middleware
   W-008  Updated pageCount in index.toon (was 46, now 47)
   ```
3. Re-run a quick verification to confirm fixes resolved the issues

### Error Handling

- **No wiki and no execution state:** "Nothing to lint. Run `/loom init` to create a wiki, or `/loom-plan execute` to generate execution artifacts."
- **Lint agent fails:** Report any findings collected before failure. Suggest re-running with a narrower scope.
- **Auto-fix fails on a specific issue:** Log the failure, continue with remaining fixes.

### Status Line

```toon
command: wiki lint
phase: {preflight | checking-wiki | checking-execution | fixing | complete}
findings: {count}
updatedAt: {ISO timestamp}
```

## Subcommand: query

You search the project wiki and synthesize an answer to the user's question, citing source pages.

### Arguments

Parse arguments after `query`:
- A quoted or unquoted question string (required)
- Example: `/loom-wiki query "How does authentication work?"`
- Example: `/loom-wiki query what endpoints does the user service expose`

### Instructions

#### Step 1: Pre-flight

1. Check if `.loom/wiki/` exists. If not:
   ```
   No wiki found. Run `/loom-wiki ingest` or `/loom init` to create one.
   ```
   Stop here.

2. Read `.loom/wiki/index.toon` to understand available pages and categories.

#### Step 2: Parse Query

Take all remaining arguments after `query` as the query string. If no query string provided:
```
Usage: /loom-wiki query "your question here"
```
Stop here.

#### Step 3: Spawn wiki-query-agent

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-query-agent.md` first." Then provide:
- Query: `{the user's question}`
- Wiki path: `.loom/wiki`
- Index state: `{summary from index.toon -- page names, categories}`

The wiki-query-agent should:
1. Identify relevant wiki pages based on the query
2. Read those pages
3. Synthesize a coherent answer
4. Cite which pages informed the answer

#### Step 4: Present Answer

Display the synthesized answer with source references:

```
## Answer

{synthesized answer from wiki-query-agent}

---
Sources:
  - .loom/wiki/pages/{page1}.md
  - .loom/wiki/pages/{page2}.md
  - .loom/wiki/pages/{page3}.md
```

### Error Handling

- **Wiki not initialized:** Stop with instructions to run `/loom init` or `/loom-wiki ingest`
- **No query provided:** Show usage example and stop
- **Query agent fails:** "Wiki query failed. Try a more specific question, or browse pages directly in `.loom/wiki/pages/`."
- **No relevant pages found:** "No wiki pages matched your query. The wiki may not cover this topic yet. Try `/loom-wiki ingest --source <path>` to add relevant sources."

### Status Line

```toon
command: wiki query
phase: {preflight | querying | complete}
query: {truncated query string}
updatedAt: {ISO timestamp}
```

## Subcommand: status

You display a comprehensive overview of the project wiki's health and recent activity.

### Instructions

#### Step 1: Check Wiki Exists

Check if `.loom/wiki/` exists. If not:
```
Wiki not initialized. Run `/loom-wiki ingest --full` or `/loom init` to create one.
```
Stop here.

#### Step 2: Count Pages

Count all pages in `.loom/wiki/pages/`. Group by category if categories are present in filenames or frontmatter.

#### Step 3: Read Recent Operations

Read `.loom/wiki/log.toon` -- show the last 5 operations (ingest, lint, maintenance events) with timestamps and summaries.

If `log.toon` does not exist: "No operation log found."

#### Step 4: Index Summary

Read `.loom/wiki/index.toon` -- show page count by category:

```
Pages by category:
  component:    12
  api-surface:   8
  convention:    5
  decision:      3
  external:      2
  ---
  Total:        30
```

#### Step 5: Staleness Check

Check for pages not updated in more than 14 days:
1. Read each page's frontmatter for `lastUpdated` timestamp
2. Compare against current date
3. Flag pages older than 14 days as stale

#### Step 6: Display Summary

```
## Wiki Status

Pages: {total} ({by category breakdown})
Last operation: {timestamp} -- {description}
Stale pages (>14 days): {count}

Recent operations:
  {timestamp}  {operation type}  {summary}
  {timestamp}  {operation type}  {summary}
  {timestamp}  {operation type}  {summary}
  {timestamp}  {operation type}  {summary}
  {timestamp}  {operation type}  {summary}

{if stale pages > 0:}
Stale pages:
  {page-name}  last updated {date} ({N} days ago)
  {page-name}  last updated {date} ({N} days ago)

Suggestions:
  /loom-wiki ingest              Refresh from uncommitted changes
  /loom-wiki ingest --full       Full re-ingest of codebase
  /loom-wiki lint                Run health checks
```

### Status Line

```toon
command: wiki status
phase: {checking | complete}
updatedAt: {ISO timestamp}
```

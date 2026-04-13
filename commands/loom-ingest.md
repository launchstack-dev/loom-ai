# Wiki Ingest

You process new sources into the project wiki — code changes, external documents, execution outcomes, or wiki-tagged notes. Each ingest enriches the wiki with new pages or updates existing ones, maintaining cross-references automatically.

## Requirements

$ARGUMENTS

Parse arguments:
- No args: incremental ingest on uncommitted changes (`git diff`)
- `--source <path>`: ingest a specific file or directory
- `--url <url>`: ingest an external document from URL. **URL safety**: Only `https://` URLs are accepted. URLs targeting private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) and cloud metadata endpoints are rejected.
- `--execution`: ingest latest execution results from `.plan-execution/`
- `--full`: full re-ingest of entire codebase (rewrites all component pages)
- `--dry-run`: show what pages would be created/updated without writing
- `--diff`: ingest changes since last git commit

## Instructions

### Step 0: Read Protocols

Read these files for context on wiki conventions:
- `~/.claude/agents/protocols/wiki-conventions.md` — directory structure, page format, significance threshold
- `~/.claude/agents/protocols/wiki-page.schema.md` — page frontmatter format
- `~/.claude/agents/protocols/toon-format.md` — TOON format reference

### Step 1: Pre-flight

1. Check if `.loom/wiki/` exists. If not:
   ```
   Wiki not initialized. Run `/loom-init` first, or create the wiki structure manually:
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

### Step 2: Determine Source

Based on arguments, collect the source material:

| Mode | Source Collection |
|------|------------------|
| No args | Run `git diff HEAD` to get all uncommitted changes (staged and unstaged). If no changes: "No uncommitted changes to ingest." Stop. |
| `--source <path>` | Verify path exists. Read the file or list directory contents. |
| `--url <url>` | Fetch URL content. **URL safety**: Only `https://` URLs are accepted. URLs targeting private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) and cloud metadata endpoints are rejected. |
| `--execution` | Read `.plan-execution/` — wave summaries, AgentResults, review reports. If `.plan-execution/` doesn't exist: "No execution artifacts found." Stop. |
| `--full` | Use current directory as codebase root. Warn: "Full re-ingest will update all component pages. Existing content will be refreshed." |
| `--diff` | Run `git diff HEAD~1` to get changes since last commit. |

### Step 3: Spawn wiki-ingest-agent

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-ingest-agent.md` first." Then provide:
- Ingest mode: `{mode from Step 2}`
- Source data: `{collected source material}`
- Wiki path: `.loom/wiki`
- Current index state: `{summary from index.toon}`

### Step 4: Review Changes

After the ingest agent returns, display proposed changes:

```
## Ingest Results

Pages created ({N}):
  component-new-service          — New service extracted from src/services/new.ts
  external-payment-gateway       — Payment gateway integration

Pages updated ({M}):
  component-auth-middleware      — Added rate limiting behavior
  api-surface-users              — New endpoint GET /api/users/:id/permissions

Cross-references added: {K}
```

If `--dry-run`: display this summary and stop.

### Step 5: Post-ingest Maintenance

Spawn wiki-maintainer-agent to ensure cross-references are consistent across all affected pages:

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first." Then provide:
- Event type: `manual`
- Event data: AgentResult from the ingest agent (files created/modified)
- Wiki path: `.loom/wiki`

**If wiki-maintainer-agent fails:** Display a warning: "Cross-reference maintenance failed. Pages were created but cross-references may be incomplete. Run `/loom-lint --wiki --fix` to repair." Continue to Step 6 with a note that cross-reference count is unknown.

### Step 6: Summary

```
## Ingest Complete

Source: {description of what was ingested}
Pages created: {N}
Pages updated: {M}
Cross-references added: {K}
Wiki page count: {new total}

Next steps:
  /loom-lint --wiki              Check wiki health
  /loom-ingest --source <path>   Ingest another source
  /loom-ingest                   Ingest uncommitted changes
```

## Error Handling

- **Wiki not initialized:** Stop with instructions to run `/loom-init`
- **Ingest agent fails:** Display partial results if any. Suggest retrying with a narrower scope.
- **Source not found:** "File or directory not found: {path}. Check the path and try again."
- **URL fetch fails:** "Could not fetch URL: {url}. Check the URL and try again."
- **Page limit reached:** "Wiki page limit ({maxPages}) reached. Skipping lower-significance entities. Adjust `[wiki].maxPages` in orchestration.toml to increase."

## Status Line

```toon
command: ingest
phase: {preflight | ingesting | maintaining | complete}
agentsRunning: {N}
agentsDone: {N}
agentsTotal: 2
updatedAt: {ISO timestamp}
```

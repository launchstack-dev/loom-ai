---
description: "add, --review, --assimilate, --organize, --connect, --briefing, --review-tasks, --done, --defer, --backlog, --promote, reopen — capture, organize, and manage tasks; includes inbox triage state machine"
---
# Notes Manager

You manage a running notes log that accumulates observations, ideas, concerns, and decisions during development. Notes persist across conversations and can be reviewed and assimilated into ROADMAP.md, PLAN.md, or CONTEXT.md when the time is right.

## Requirements

$ARGUMENTS

Parse arguments:
- No flag + text: add a note (e.g., `/loom-note consider rate limiting on the API`)
- `--tag <tag>`: categorize the note (architecture, bug, idea, decision, concern, perf, security, ux, debt, wiki, backlog)
- `--priority <level>`: high, medium, low (default: medium)
- `--review`: review all pending notes, group by tag, suggest where each belongs
- `--assimilate`: review notes AND apply them — update roadmap/plan/context docs with relevant notes. In brain repos (repos with `scratch*.md` files), also process scratch pads and daily notes per the project's CLAUDE.md conventions.
- `--organize`: light scratch pad organization — cluster and group entries by theme. No wiki reads, no archiving. Rewrites scratch pads in-place. Follow the project's CLAUDE.md for specific organize conventions.
- `--connect`: deep scratch pad organization — like organize but reads wiki and ontology to annotate entries with connections, contradictions, and new-page indicators. No archiving or wiki modification. Follow the project's CLAUDE.md for specific connect conventions.
- `--briefing`: EA daily briefing — scan wiki for tasks, deadlines, stale items, follow-ups. Write to today's daily note and display. Read-only (no wiki modifications). Follow the project's CLAUDE.md for briefing conventions.
- `--review-tasks`: show all open tasks across wiki pages, grouped by status and priority. Follow the project's CLAUDE.md for task review conventions.
- `--done "fragment"`: mark a task as done by matching a text fragment against wiki page tasks.
- `--defer "fragment"`: defer a task. Optionally pass `--to YYYY-MM-DD` for a specific date.
- `--list`: show all notes (pending + assimilated + dismissed)
- `--dismiss <id>`: mark a note as dismissed (won't appear in review)
- `--backlog`: show only backlog-tagged notes, sorted by priority
- `--promote <id>`: move a backlog item to ROADMAP.md feature list
- `--clear`: clear all dismissed notes from the log
- `reopen <id> --reason "..."`: reopen a `wontfix` inbox entry; reason is mandatory

### Inbox Triage Subcommands

These subcommands operate on `inbox/{id}.md` triage entries (distinct from the
general notes log at `.plan-execution/notes.toon`):

- `add <text> [--category bug|enhancement]`: create a new triage inbox entry at
  `inbox/{NOTE-NNN}.md` with `state: needs-triage`, `createdAt`, `updatedAt`,
  and an initial `transitions[]` row.
- `reopen <id> --reason "..."`: transition a `wontfix` entry back to
  `needs-triage`. The `--reason` flag is mandatory; omitting it is an error.
  Appends a `transitions[]` row with `actor` and `reason`.
- `transition <id> <toState> [--reason "..."] [--actor human|agent]`: run an
  explicit state transition via `scripts/triage/state-machine.ts`. Rejects
  undocumented transitions with `INVALID_TRANSITION`. Rejects `wontfix→*`
  without `--reason` with `WONTFIX_REOPEN_REQUIRED`.

## Instructions

### Inbox Triage Entry Storage Format

Inbox entries live at `inbox/{id}.md`. Each file has a TOON frontmatter block
followed by an optional Markdown body.

```toon
---
id: NOTE-001
category: enhancement
state: needs-triage
createdAt: 2026-06-25T10:00:00.000Z
updatedAt: 2026-06-25T10:00:00.000Z
transitions[1]{from,to,at,actor,reason}:
  ,needs-triage,2026-06-25T10:00:00.000Z,human,null
---
Proposed feature: add dark mode support.
```

The `transitions[]` table is **append-only**. Every state change appends a new
row. The first row (initial) uses an empty `from` field to mark entry creation.

### Creating an Inbox Triage Entry (`loom-note add`)

When the user runs `/loom-note add <text>` (or the intent routes here):

1. Scan `inbox/` to determine the next `NOTE-NNN` id.
2. Create `inbox/{NOTE-NNN}.md` with:
   - `createdAt` and `updatedAt` set to the current ISO 8601 timestamp.
   - `state: needs-triage`.
   - `transitions[1]` with a single row: `from=` (empty), `to=needs-triage`,
     `at={timestamp}`, `actor=human`, `reason=null`.
3. Write atomically: write to `inbox/{NOTE-NNN}.md.tmp`, then rename.
4. Confirm: `Inbox entry created: NOTE-NNN (needs-triage)`

### Reopening a wontfix Entry (`loom-note reopen <id> --reason "..."`)

1. Read `inbox/{id}.md`. If not found: "Inbox entry {id} not found."
2. Verify `state == wontfix`. If not: "Entry {id} is not in wontfix state."
3. Validate `--reason` is present and non-empty. If missing:
   ```
   Error: WONTFIX_REOPEN_REQUIRED
   Use /loom-note reopen {id} --reason "..." with a mandatory reason.
   ```
4. Call `transition(entry, "needs-triage", { actor: "human", reason, explicitReopen: true })`.
5. Serialize the updated entry (including the new `transitions[]` row) back to
   `inbox/{id}.md` atomically.
6. Confirm: `Reopened {id}: wontfix → needs-triage. Reason: {reason}`

### Transitioning State (`loom-note transition <id> <toState>`)

1. Read `inbox/{id}.md`.
2. Call `transition(entry, toState, opts)` from `scripts/triage/state-machine.ts`.
3. On error: print the `errorCode` and `message`, exit non-zero.
4. On success: write updated entry atomically; confirm the transition.

**Bot-posted comments (AI-generated triage questions):**

Every comment or question posted by an AI agent during triage MUST begin with
the following literal prefix on its own line before the comment body:

```
> *This was generated by AI during triage.*
```

This prefix is required on every bot-posted comment without exception.

### Adding a Note

When the user provides text (with or without `--tag` / `--priority`):

1. Read `.plan-execution/notes.toon` if it exists. If not, initialize it.
2. Generate a note ID: `note-{NNN}` where NNN is the next sequential number.
3. Auto-detect tag if not provided:
   - Contains "bug", "broken", "fails", "wrong" → `bug`
   - Contains "should", "could", "idea", "maybe" → `idea`
   - Contains "concern", "worried", "risk" → `concern`
   - Contains "decided", "decision", "agreed" → `decision`
   - Contains "slow", "performance", "latency" → `perf`
   - Contains "security", "auth", "injection", "xss" → `security`
   - Contains "debt", "refactor", "cleanup", "hack" → `debt`
   - Contains "wiki", "knowledge", "document this", "remember that" → `wiki`
   - Contains "backlog", "later", "someday", "future", "v2", "v3" → `backlog`
   - Otherwise → `idea`
4. Append the note to `notes.toon`.
5. Confirm briefly: `Noted: [{tag}] {first 60 chars}... (#{id})`

#### Notes Storage Format

File: `.plan-execution/notes.toon`

```toon
noteCount: 5
lastUpdated: 2026-04-07T14:30:00Z

notes[5]{id,timestamp,tag,priority,status,content,assimilatedTo}:
  note-001,2026-04-07T10:00:00Z,architecture,high,pending,"Service layer needs an event bus for async operations",
  note-002,2026-04-07T10:15:00Z,idea,medium,pending,"Consider adding rate limiting to public API endpoints",
  note-003,2026-04-07T11:00:00Z,bug,high,assimilated,"Auth token refresh not handled in mobile client",PLAN.md Phase 3
  note-004,2026-04-07T12:00:00Z,debt,low,dismissed,"Old migration files could be squashed",
  note-005,2026-04-07T14:30:00Z,decision,medium,pending,"Use Postgres for primary store — Redis only for cache",
```

### Reviewing Notes (`--review`)

1. Read `.plan-execution/notes.toon`.
2. Filter to `status == pending` notes only.
3. Group by tag.
4. For each note, suggest where it belongs:

```
## Pending Notes Review ({N} notes)

### Architecture ({count})
- [#note-001] **HIGH** Service layer needs an event bus for async operations
  → Suggest: ROADMAP.md (new feature) or PLAN.md (architecture constraint)

### Ideas ({count})
- [#note-002] **MED** Consider adding rate limiting to public API endpoints
  → Suggest: ROADMAP.md (feature backlog)

### Decisions ({count})
- [#note-005] **MED** Use Postgres for primary store — Redis only for cache
  → Suggest: CONTEXT.md (locked decision)

### Concerns ({count})
(none)

---
Actions:
- To assimilate into docs: `/loom-note --assimilate`
- To dismiss a note: `/loom-note --dismiss note-002`
- To add more notes: `/loom-note "your note here"`
```

Placement suggestions follow these rules:

| Tag | Default Destination | When |
|-----|-------------------|------|
| `architecture` | PLAN.md (architecture section) | If it's a constraint or pattern decision |
| `architecture` | ROADMAP.md (feature) | If it's a new capability need |
| `bug` | PLAN.md (acceptance criteria) | If it's a known issue to fix |
| `idea` | ROADMAP.md (feature backlog) | Default for ideas |
| `decision` | CONTEXT.md (locked decision) | Always — decisions must be recorded |
| `concern` | ROADMAP.md (constraints) | If it's a risk or limitation |
| `perf` | PLAN.md (non-functional requirements) | If it's a performance target |
| `security` | PLAN.md (security requirements) | If it's a security constraint |
| `ux` | ROADMAP.md (feature detail) | If it's a UX requirement |
| `debt` | PLAN.md (tech debt phase) | If actionable now |
| `debt` | Dismiss suggestion | If aspirational / not blocking |
| `wiki` | `.loom/wiki/` (via wiki-ingest-agent) | Always — queued for wiki ingestion |
| `backlog` | ROADMAP.md (feature backlog) | When promoted via `--promote` |

### Viewing Backlog (`--backlog`)

1. Read `.plan-execution/notes.toon`.
2. Filter to `tag == backlog` AND `status == pending`.
3. Group by priority (high, medium, low).
4. Display:

```
## Backlog ({N} items)

HIGH:
- [#042] Debugging agent — scientific method with persistent state
- [#043] UI-specific workflows — design spec, implementation, audit

MEDIUM:
- [#044] Developer profiling — behavioral analysis, preference adaptation

LOW:
(none)

Promote to roadmap: /loom-note --promote 042
```

### Promoting Backlog Items (`--promote <id>`)

1. Read `.plan-execution/notes.toon`, find note by id.
2. Verify it's tagged `backlog` and `status == pending`. If not: "Note #{id} is not a pending backlog item."
3. Read ROADMAP.md. If it doesn't exist: "No ROADMAP.md found. Create one with `/loom-roadmap init` first."
4. Find the feature list section in ROADMAP.md.
5. Append the note content as a new feature entry.
6. Update note status to `assimilated` with `assimilatedTo: ROADMAP.md`.
7. Confirm: "Promoted #{id} to ROADMAP.md feature backlog: {first 60 chars}"

### Assimilating Notes (`--assimilate`)

1. Run the review step first (show the grouped notes).
2. For each pending note, determine the target document and section:
   - Read the target doc (ROADMAP.md, PLAN.md, or CONTEXT.md)
   - Find the appropriate section
   - Propose the specific edit
3. Present all proposed edits as a batch:

```
## Assimilation Plan

### CONTEXT.md
**Add decision D-04:**
> ## D-04: Primary Database
> **Decision:** Use Postgres for primary store — Redis only for cache
> **Rationale:** From development note #note-005
> **Impact:** medium

### ROADMAP.md
**Add to Feature Backlog:**
> - Rate limiting on public API endpoints (from #note-002)

**Add to Architecture section:**
> - Event bus for async service-layer operations (from #note-001)

### PLAN.md
**Add to Phase 3 acceptance criteria:**
> - Auth token refresh handled correctly in mobile client (from #note-003)

Apply these changes? (yes / edit / skip specific notes)
```

4. On confirmation:
   - Apply the edits to each document
   - For notes tagged `wiki`: spawn wiki-ingest-agent in `note` mode instead of editing docs:
     ```
     subagent_type: "general-purpose"
     ```
     Prompt: "Read your instructions from `~/.claude/agents/wiki-ingest-agent.md` first." Then provide:
     - Ingest mode: `note`
     - Source data: the note text and tags
     - Wiki path: `.loom/wiki`
     The ingest agent creates or updates the appropriate wiki page(s) and sets `assimilatedTo` to the wiki page path.
   - Update each note's `status` to `assimilated` and `assimilatedTo` to the target doc + section (or wiki page path)
   - Update `notes.toon`
5. Confirm: `Assimilated {N} notes into {list of docs}.`

### Listing Notes (`--list`)

Show all notes regardless of status, with status indicators:

```
## All Notes ({N} total)

| ID | Status | Tag | Pri | Content |
|----|--------|-----|-----|---------|
| #001 | pending | arch | HIGH | Service layer needs event bus... |
| #002 | pending | idea | MED | Rate limiting on public API... |
| #003 | assimilated | bug | HIGH | Auth token refresh... → PLAN.md Phase 3 |
| #004 | dismissed | debt | LOW | Old migration files... |
| #005 | pending | decision | MED | Postgres primary, Redis cache... |

Pending: {n} | Assimilated: {n} | Dismissed: {n}
```

### Dismissing Notes (`--dismiss <id>`)

1. Read `notes.toon`.
2. Find the note by ID.
3. Set `status: dismissed`.
4. Write updated file.
5. Confirm: `Dismissed #note-{id}: {first 40 chars}...`

### Clearing Dismissed (`--clear`)

1. Read `notes.toon`.
2. Remove all notes where `status == dismissed`.
3. Re-number remaining notes (keep original IDs — don't renumber).
4. Update `noteCount`.
5. Write updated file.
6. Confirm: `Cleared {N} dismissed notes. {M} notes remaining.`

## Integration with loom-auto

When `/loom-auto` reaches these stages, it should check for pending notes:

- **Before plan-create / plan-revise:** Read pending notes and include them as context for the plan builder agent. Notes tagged `architecture`, `decision`, `security`, `perf` are especially relevant.
- **Before roadmap-create / roadmap-revise:** Read pending notes tagged `idea`, `concern`, `ux`, `architecture` as input for the roadmap builder.
- **During review-code:** If notes tagged `bug` or `concern` exist, pass them to reviewers as "known issues to check."

This integration is advisory — notes inform the agents but don't override plan/roadmap structure.

## Rules

1. **Notes are append-only during add.** Never modify existing notes when adding new ones.
2. **Atomic writes.** Write to `notes.toon.tmp` then rename to `notes.toon`.
3. **Assimilation requires confirmation.** Never auto-assimilate notes into docs without human approval.
4. **Decisions always go to CONTEXT.md.** The `decision` tag has a fixed destination — decisions must be recorded as locked decisions.
5. **Don't duplicate.** Before assimilating, check if the target doc already contains the substance of the note. If so, mark as assimilated with a note "already present" rather than adding a duplicate.
6. **Preserve note history.** Even dismissed and assimilated notes stay in `notes.toon` until explicitly cleared. This provides an audit trail.
7. **Auto-tag is a suggestion.** If the auto-detected tag seems wrong, the user can override with `--tag`.

## Status Line

```toon
command: note
phase: {adding | reviewing | assimilating | listing}
updatedAt: {ISO timestamp}
```

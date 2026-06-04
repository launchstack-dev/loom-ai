# Execution Conventions

Shared rules that all execution agents and the orchestrator follow. Reference this document in every agent's instructions.

## Directory Structure

`.plan-execution/` is split into two zones: **tracked** artifacts that survive across sessions and worktrees (committed to git), and **ephemeral** artifacts that are session-specific (gitignored).

```
.plan-execution/
├── .gitignore                  # Auto-generated: ignores only ephemeral/
│
│── # ── TRACKED (committed to git) ──────────────────────────
├── state.toon                  # Execution state (see state.schema.md)
├── pipeline-state.toon         # /loom-auto pipeline state (see pipeline-state.schema.md)
├── rolling-context.md          # Tiered summary of all prior waves
├── contracts/                  # Wave 0 output — shared types/schemas
│   ├── manifest.toon           # Lists all contract files + their purpose
│   └── [contract files]        # e.g., types.ts, schema.sql, api-contract.ts
├── scope-coverage.toon         # Acceptance criteria coverage matrix
├── stage-context/              # Structured stage summaries (see stage-context.schema.md)
│   ├── contracts.toon
│   ├── execute.toon
│   ├── review.toon
│   ├── test.toon
│   ├── converge.toon
│   └── fix.toon
├── conflicts/                  # Interpretation conflict reports (interpretation-reviewer-agent)
│   └── {conflictId}.toon       # Per-conflict report — see interpretation-conflict.schema.md
├── convergence/
│   ├── iterations/             # Per-iteration summaries (preserved across iterations)
│   │   ├── iter-1.toon
│   │   └── ...
│   └── e2e/                    # End-to-end convergence artifacts (tier 2)
│       ├── stories/            # E2E story definitions — see e2e-story.schema.md
│       │   └── {storyId}.toon
│       ├── tests/              # Generated test scripts (e2e-test-writer-agent output)
│       │   └── {storyId}.test.ts
│       └── screenshots/        # Visual regression captures (e2e-runner-agent output)
│           └── {storyId}-{timestamp}.png
├── wave-0-summary.toon         # Machine-readable wave summary
├── wave-0-summary.md           # Human-readable wave summary
├── wave-1-summary.toon
├── wave-1-summary.md
├── debrief.toon                # Debrief report written at execution end (see § Mandatory Debrief)
└── ...
│
│── # ── EPHEMERAL (gitignored via ephemeral/) ───────────────
├── ephemeral/
│   ├── .lock                   # PID lock file — prevents concurrent runs
│   ├── progress/               # Agent heartbeat files (cleared per wave)
│   │   └── {taskId}.toon       # Per-agent progress — see agent-monitoring.schema.md
│   ├── requests/               # Cross-boundary requests from implementers
│   │   └── {taskId}.toon       # One file per request
│   └── status.toon             # Live status for statusline integration
```

### .gitignore for .plan-execution/

The auto-generated `.plan-execution/.gitignore` ignores ONLY the ephemeral subdirectory:

```
# Ephemeral session artifacts — locks, heartbeats, live status
ephemeral/
```

All other files in `.plan-execution/` are tracked by git and survive worktree cleanup.

### Migration from Pre-v2 Layout

Existing projects using the old layout (where `.plan-execution/.gitignore` contained `*` to ignore everything) need migration before the gitignore negation rules take effect. Without migration, adding `!.plan-execution/` to the project's `.gitignore` causes all stale artifacts to appear as untracked files.

`/loom-upgrade` handles this automatically:

1. Detect the old `.plan-execution/.gitignore` (contains `*`)
2. Run a debrief on any existing artifacts (flush to `.plan-history/` and wiki)
3. Delete stale contents of `.plan-execution/` (everything except the new `.gitignore`)
4. Write the new `.plan-execution/.gitignore` (ignores only `ephemeral/`)
5. Create the `ephemeral/` subdirectory structure
6. Only then apply the gitignore negation rules to the project's `.gitignore`

If `/loom-init` or `/loom-auto` detect the old layout, they warn: "Old .plan-execution/ layout detected. Run `/loom-upgrade` first to migrate."

## File Naming Conventions

### Contract files
- Use descriptive names: `types.ts`, `schema.sql`, `api-types.ts`, `db-models.ts`
- Always include a `manifest.toon`:
  ```toon
  contracts[2]{file,purpose,exports}:
    types.ts,Shared TypeScript type definitions,"User,Site,Event"
    schema.sql,Database schema,"users,sites,events"
  ```

### Wave summaries
- `wave-N-summary.toon` — machine-readable, follows this structure:
  ```toon
  wave: 0
  agentResults[N]: (array of AgentResult objects)
  filesChanged[N]: (deduplicated list of all files created/modified/deleted)
  exportsAdded[N]: (deduplicated list of all new exports)
  unresolvedIssues[N]: (any blocking/warning issues from agents)
  ```
- `wave-N-summary.md` — human-readable narrative for inspection

### Cross-boundary requests
- `requests/{taskId}.toon`:
  ```toon
  taskId: string
  agent: string
  requests[N]{file,reason,suggestedChange}:
    path,why,what
  ```

## Data Formats — TOON vs JSON

TOON (Token-Oriented Object Notation) is the **default format for all runtime artifacts**. See `agents/protocols/toon-format.md` for the full spec.

### TOON — Runtime Artifacts (Default)
- **state.toon**, **manifest.toon**, **wave-N-summary.toon** — on-disk persistence
- **ephemeral/progress/{taskId}.toon**, **ephemeral/requests/{taskId}.toon** — ephemeral runtime files
- Agent prompts and inter-agent data in rolling-context.md
- Review findings passed between agents
- Any structured data embedded in LLM context

TOON achieves **30-60% token reduction** vs JSON while maintaining lossless roundtrip fidelity.

### JSON — Schema Definitions Only
- `*.schema.json` files for AJV validation
- `package.json`, `tsconfig.json` — toolchain configs (not owned by this system)

**Conversion rule:** Orchestrators validate against `*.schema.json` by decoding TOON to in-memory objects, then running AJV. On-disk artifacts remain TOON.

### TOON Format Quick Reference

```toon
# Flat object — key: value (no quotes needed)
agent: agent-auth
wave: 0
status: success
durationMs: 34500

# Array with typed header
filesCreated[3]: src/auth/middleware.ts,src/auth/token.ts,src/auth/types.ts

# Array of objects — header declares fields
exportsAdded[2]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface

# Nested object
issues[1]{severity,description,file,line}:
  warning,Hardcoded refresh window,src/auth/middleware.ts,42

# Empty arrays
filesDeleted[0]:
contractAmendments[0]:
```

**Agent output:** Agents MAY return TOON instead of JSON for their AgentResult. The orchestrator accepts either format. When an agent returns a fenced code block tagged ` ```toon `, the orchestrator decodes it with `@toon-format/toon`.

**npm package:** `@toon-format/toon` — `encode(json)` and `decode(toon)` for lossless conversion.

## Agent Instruction Loading (Lean Orchestrator Pattern)

Orchestrators MUST NOT embed full agent `.md` file contents in spawned agent prompts. Instead:

1. **Pass the file path.** Include an instruction like: `"Read your instructions from ~/.claude/agents/{name}.md first."`
2. **The agent reads its own instructions from disk** as its first action.
3. **Orchestrator context stays lean** — only task-specific data (file ownership, acceptance criteria, contract paths, rolling context) goes in the prompt.

**Why:** Embedding agent .md content inflates every spawned prompt by 2-5K tokens of identical text. When an orchestrator spawns 4+ parallel agents per wave across multiple waves, this compounds. Agents already read files from disk (contracts, rolling-context) — their own instructions are no different.

**Built-in agents** (via `subagent_type: "agent-name"`) handle this automatically — their instructions are resolved by the agent registry. This convention applies to:
- Execution agents spawned as `general-purpose` (contracts-agent, implementer-agent, wiring-agent, verification-agent)
- Project-specific agents from `orchestration.toml`
- Bespoke reviewers (security-reviewer, architecture-reviewer, plan-compliance-reviewer)
- Plan-builder-agent (also reads `plan.schema.md` from disk)

## Orchestration Status (Status Line Integration)

The orchestrator writes `.plan-execution/ephemeral/status.toon` to surface live progress in the Claude Code status line. This file is read by the user's `statusline-command.sh` and must remain small and fast to parse (simple `grep` per field).

**Format:**

```toon
command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsRunning: 3
agentsDone: 1
agentsTotal: 5
agentsFailed: 0
findings: 0
updatedAt: 2026-04-06T10:30:00Z
```

**Field reference:**

| Field | When set | Example values |
|-------|----------|---------------|
| `command` | Always | `execute-plan`, `review-code`, `fix-code`, `review-plan`, `test-plan` |
| `phase` | Always | `initializing`, `contracts`, `implementing`, `wiring`, `verifying`, `reviewing`, `fixing`, `complete` |
| `wave` | execute-plan | Current wave number |
| `totalWaves` | execute-plan | Total wave count |
| `agentsRunning` | When agents spawned | Count of in-flight agents |
| `agentsDone` | When agents spawned | Count of completed agents |
| `agentsTotal` | When agents spawned | Total agents in this step |
| `agentsFailed` | When agents spawned | Count of failed agents |
| `findings` | review-code, fix-code | Finding count (total or remaining) |
| `updatedAt` | Always | ISO timestamp |

**Write rules:**
- Use atomic writes (write `.tmp`, rename)
- Update at every state transition (wave start, agent complete, phase change)
- Delete the file when the command completes (clean idle state)
- If file cannot be written (no `.plan-execution/ephemeral/` dir), skip silently — status line is additive, never gating

**Status line reads this via `awk` — keep one key per line, no nesting, no arrays.**

### Per-Command Updates

Each orchestrator command sets `command` to its name and updates these additional fields:

| Command | Additional fields to update |
|---------|----------------------------|
| `execute-plan` | `wave`, `totalWaves`, `agentsRunning/Done/Total/Failed` per wave |
| `review-code` | `agentsRunning/Done/Total` as reviewers complete, `findings` when report assembled |
| `review-plan` | `agentsRunning/Done/Total` as planning agents complete |
| `test-plan` | `agentsRunning/Done/Total` as test generators complete |
| `fix-code` | `agentsRunning/Done/Total` per fixer batch, `findings` (remaining count, decremented as fixes apply) |

All commands: create `.plan-execution/ephemeral/` if needed, delete `ephemeral/status.toon` when complete.

## Atomic Writes

All agents and the orchestrator MUST use atomic writes for shared state:
1. Write content to `{filename}.tmp`
2. Rename `{filename}.tmp` to `{filename}`

This prevents partial reads of corrupted state.

## File Ownership Rules

1. **One owner per file.** No two implementer-agents may modify the same file in the same wave.
2. **Ownership is explicit.** Each implementer receives an exact list of files it may create/modify in its prompt.
3. **Cross-boundary needs → request file.** If an implementer needs a file outside its boundary, it writes to `.plan-execution/ephemeral/requests/{taskId}.toon`. The wiring-agent processes these.
4. **Wiring-agent owns shared files.** Package.json, barrel/index files, route registrations, and migration files are explicitly owned by the wiring-agent.
5. **Contracts are read-only after Wave 0.** No agent may modify contract files after the contracts-agent completes. If amendments are needed, the orchestrator decides whether to re-run Wave 0.

### Hook Enforcement

Rules 1-2 and 5 above are **deterministically enforced** by Claude Code hooks in `hooks/`:

- `file-ownership.ts` (PreToolUse) — blocks writes to files not in the current task's ownership list
- `contract-lock.ts` (PreToolUse) — blocks writes to `contracts/` after Wave 0 completes
- `budget-tracker.ts` (PreToolUse + SubagentStop) — tracks agent count, blocks spawns at budget limit

These hooks fail open: if `.plan-execution/state.toon` is missing or unreadable, writes are allowed. Note: `state.toon` is in the tracked zone (not ephemeral) so hooks can read it across sessions. See `hooks/lib/run-hook.ts` for the shared defensive harness. Registered in `.claude/settings.json`.

## Context Injection Rules

### What goes in the prompt (small, essential)
- Task objective and acceptance criteria
- File ownership list
- Specific contract file paths relevant to this task (not the whole directory)
- The rolling-context.md content (compressed prior wave history)

### What the agent reads from disk (larger, on-demand)
- Contract files (read the specific files listed in prompt)
- Existing code in owned files (if modifying, not creating)
- For wiring-agent: export surfaces of modified files

### What agents NEVER read
- Raw wave-N-summary files (the rolling-context.md replaces these)
- Other agents' full output (only the orchestrator sees this)
- state.toon (only the orchestrator reads/writes this)

## Tiered Context Compression (rolling-context.md)

The orchestrator maintains this file. Agents receive it in their prompt.

- **Hot (wave N-1):** Full summary including all file changes, exports, integration notes. ~3-5k tokens.
- **Warm (waves N-2 to N-4):** Key decisions and interface changes only. ~500-1k tokens each.
- **Cold (waves older than N-4):** One-line summary per wave. ~50-100 tokens each.
- **Target:** Total rolling-context.md stays under 10k tokens regardless of wave count.

Format (uses TOON for structured data within markdown):
```markdown
# Execution Context

## Wave 4 (current - 1) [HOT]

```toon
filesChanged[8]: src/auth/middleware.ts,src/auth/token.ts,...
exportsAdded[3]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  signToken,src/auth/jwt.ts,function
  TokenPayload,src/auth/types.ts,interface
issues[1]{severity,description,file}:
  warning,Hardcoded refresh window,src/auth/middleware.ts
```

Integration notes: authMiddleware must be registered before protected routes. JWT_SECRET required in env.

## Wave 3 [WARM]
Key changes: Added auth middleware, JWT util. Exports: authMiddleware, signToken, TokenPayload.

## Wave 2 [WARM]
Key changes: Database schema, User model. Exports: UserModel.

## Wave 1 [COLD]
Base API structure with health endpoint.

## Wave 0 [COLD]
Shared contracts: types.ts, schema.sql, api-types.ts.
```

## Auto-Commit Convention

By default, the orchestrator creates a git commit after each wave completes verification. This keeps diffs reviewable and git history aligned with the plan structure.

### Per-Wave Commits (execution)

After verification passes (Step 3 for Wave 0, Step 8 for Wave N) and before the human/auto gate:

1. Stage all files created or modified by this wave's agents (from the wave summary's `filesCreated` + `filesModified`).
2. Also stage `.plan-history/executions/wave-N-summary.toon` if it was written.
3. Create a commit with a conventional message derived from the wave summary:

```
{prefix}(wave-{N}): {summary from wave description}
```

Prefix rules (same as `/loom-git commit`):
- Wave 0 → `feat(wave-0): contracts — {entity list}`
- Implementation waves → `feat(wave-{N}): {phase description}`
- If wave only modified existing files (no new files) → `refactor(wave-{N}): {description}`

Examples:
```
feat(wave-0): contracts — User, Post, Comment types + API routes
feat(wave-1): auth middleware and user CRUD endpoints
feat(wave-2): post service with comment threading
refactor(wave-3): extract shared validation helpers
```

4. If the commit fails (nothing to stage, hook rejection), log a warning and continue. Auto-commit is best-effort — it never blocks the pipeline.

### Per-Iteration Commits (convergence)

After each convergence iteration completes (harness re-run + fixers applied):

1. Stage all files modified by fixer agents in this iteration.
2. Create a commit:

```
fix(converge-iter-{N}): {summary of what was fixed}
```

For criteria mode, the summary is derived from the delta report's resolved findings:
```
fix(converge-iter-1): 3 test failures fixed (auth middleware)
fix(converge-iter-2): SQL injection in user lookup (C-04)
fix(converge-iter-3): code review findings — naming, error handling
```

For target mode, from the delta report's improved targets:
```
fix(converge-iter-1): 6 API response targets now passing
fix(converge-iter-2): pixel diff for login page within tolerance
```

3. If the iteration made no code changes (only harness ran), skip the commit.

### Opting Out

Pass `--no-auto-commit` to `/loom-plan execute`, `/loom-converge`, or `/loom-auto` to disable auto-commits. All code changes accumulate in the working tree as before. Git tags (`plan-exec-wave-N-pre`) are still created regardless of this flag.

### Interaction with Git Tags

Git tags (`plan-exec-wave-N-pre`) are created **before** the wave runs. Auto-commits happen **after** verification passes. This means:
- `plan-exec-wave-N-pre` → tag points to the state before wave N
- The auto-commit after wave N → contains wave N's changes
- `--rollback-wave N` still works: reset to the pre-tag, which is before both the code and the commit

## Stage Context Writing

Stage context files capture structured summaries of what happened at each pipeline boundary. They follow the `StageContext` schema defined in `stage-context.schema.md`.

### When to Write

- **`/loom-plan execute`:** After each wave's verification step -- write `stage-context/contracts.toon` after Wave 0 verification, write `stage-context/execute.toon` after Wave N verification.
- **`/loom-auto`:** After each pipeline stage completes -- write the corresponding `stage-context/{stage}.toon` at every stage boundary (execute, test, review, converge, fix).

### What to Include

Every stage context file must contain all `StageContext` fields per `stage-context.schema.md`:

- `stage`, `wave`, `iteration` -- identity fields
- `startedAt`, `completedAt`, `durationMs` -- timing
- `inputTokensEstimate`, `outputTokensEstimate` -- token usage
- `filesChanged`, `exportsAdded` -- artifact tracking
- `findingsResolved`, `findingsRemaining` -- quality tracking
- `summary` -- 1-3 sentence description of outcomes
- `keyDecisions` -- architectural or implementation decisions made
- `nextStageHints` -- context the next stage should know about

### Atomic Write Requirement

Stage context files MUST use atomic writes: write to `stage-context/{stage}.toon.tmp`, then rename to `stage-context/{stage}.toon`. This prevents partial reads by downstream consumers (rolling-context regeneration, convergence driver).

### Relationship to rolling-context.md

Stage context files are the **structured source of truth** for stage outcomes. `rolling-context.md` is the **compressed derivative** -- the orchestrator reads stage context files and regenerates `rolling-context.md` using tiered compression (hot/warm/cold). Agents never read stage context files directly; they consume `rolling-context.md` from their prompt. Only the orchestrator and lead dispatcher read stage context files from disk.

---

## Persistence — .plan-history/

Ephemeral execution artifacts in `.plan-execution/` are NOT committed to git. For cross-session and cross-worktree persistence, orchestrators write key artifacts to `.plan-history/` which IS committed:

```
.plan-history/
├── reviews/
│   └── YYYY-MM-DD-review.toon       # /loom-review-plan findings
├── decisions/
│   └── NNN-description.md            # Architecture Decision Records from gates
├── executions/
│   └── wave-N-summary.toon           # Preserved wave results
├── roadmap.toon                      # Milestones, status, dependencies
└── changelog.md                      # Plan revision history
```

Orchestrators write to `.plan-history/` when:
- `/loom-review-plan` completes → saves synthesized findings
- `/loom-execute-plan` completes a wave → saves wave summary
- Human approves/rejects at a gate → saves decision record
- Plan is modified after review → appends to changelog

This directory syncs via git, survives worktree cleanup, and is available in future sessions.

---

## Mandatory Debrief Protocol

Every execution — whether it succeeds, fails, stalls, or is interrupted — MUST run a debrief step before `.plan-execution/` artifacts can be cleaned up or a worktree can be destroyed. The debrief ensures that decisions, failures, and convergence history are flushed to persistent storage (wiki + `.plan-history/`) so knowledge is never silently lost.

**The debrief is BLOCKING.** It is not optional, not non-blocking, not best-effort. If the debrief fails, the orchestrator MUST NOT clean up `.plan-execution/` or destroy the worktree. Instead, it warns the user and leaves artifacts in place for manual recovery.

### When Debrief Fires

| Event | Trigger |
|-------|---------|
| Execution completes successfully | After final wave verification, before cleanup |
| Execution fails (circuit breaker, budget exhaustion) | After failure is recorded, before cleanup |
| Pipeline completes (`/loom-auto`) | After final stage, before pipeline-state cleanup |
| Convergence stalls or regresses | After circuit breaker trips, before cleanup |
| Worktree about to be destroyed | Before `git worktree remove` |
| Session ends with active execution | Stop hook detects `.plan-execution/state.toon` |
| Crash recovery (next session start) | Stale lock detected — see § Crash Recovery |

### Crash Recovery

The Stop hook fires on graceful session end, but force-kill, OOM, or power loss skip all hooks. The debrief never runs. To handle this, orchestrators MUST check for stale execution state at session start:

1. At the beginning of any `/loom-auto`, `/loom-plan execute`, or `/loom-converge` invocation, check for `.plan-execution/ephemeral/.lock`.
2. If the lock file exists, read the PID from it.
3. Check if the PID is still running (`kill -0 {pid} 2>/dev/null`).
4. If the PID is dead (stale lock), the previous session crashed without debriefing:
   ```
   ## Stale Execution Detected

   A previous execution (run {runId}) did not complete its debrief.
   Execution artifacts in .plan-execution/ may contain uncaptured knowledge.

   Options:
     debrief    Run the debrief now to capture knowledge before continuing
     discard    Clear stale state and start fresh
     inspect    Show what's in .plan-execution/ before deciding
   ```
5. If the user chooses `debrief`, run the full Mandatory Debrief Protocol using the stale artifacts.
6. If the user chooses `discard`, delete `.plan-execution/ephemeral/.lock` and warn that knowledge may be lost.
7. In `--auto` mode, default to `debrief` — always attempt to preserve knowledge.

### What Debrief Captures

The orchestrator reads `.plan-execution/` and flushes to persistent storage:

#### 1. To `.plan-history/` (always)

| Source | Destination | Condition |
|--------|-------------|-----------|
| `stage-context/*.toon` | `.plan-history/executions/stage-context/` | Always — copy all stage context files |
| `wave-N-summary.toon` | `.plan-history/executions/wave-N-summary.toon` | Always — copy all wave summaries |
| `convergence/iterations/` | `.plan-history/executions/convergence/` | If convergence ran |
| `conflicts/` | `.plan-history/executions/conflicts/` | If conflicts exist |
| `scope-coverage.toon` | `.plan-history/executions/scope-coverage.toon` | Always |
| `contracts/manifest.toon` | `.plan-history/executions/contracts-manifest.toon` | If Wave 0 ran |

#### 2. To wiki (via wiki-maintainer-agent — BLOCKING)

The orchestrator spawns wiki-maintainer-agent with event type `execution-debrief` and the following data:

- **Decisions made** → wiki decision pages (architecture choices, technology selections, tradeoff resolutions)
- **What was built** → wiki execution log entries (wave summaries, files changed, exports added)
- **What failed and why** → wiki pages tagged `failure` (circuit breaker trips, stalled convergence, agent failures with root cause)
- **Convergence history** → wiki quality pages (approaches tried, what stalled, final pass rates)
- **Unresolved conflicts** → wiki pages tagged `open-conflict` (so future sessions can pick them up)

#### 3. Debrief report (always)

Write `.plan-execution/debrief.toon`:

```toon
debriefedAt: {ISO timestamp}
trigger: {success | failure | stall | interrupt | worktree-cleanup}
executionId: {from state.toon runId}

wavesCompleted: {N}
wavesTotal: {N}
stagesCompleted[N]: contracts, execute, review
stagesFailed[N]: converge

decisionsRecorded: {count flushed to wiki}
conflictsOpen: {count of unresolved conflicts}
conflictsResolved: {count flushed to wiki}
convergenceIterations: {total iterations across all tiers}

planHistoryFiles[N]: {list of files written to .plan-history/}
wikiPagesCreated[N]: {list of wiki pages created or updated}

failureReason: {if trigger is failure/stall — one-line summary}
```

### State Sentinel for Auto-Commits

`state.toon` is in the tracked zone so hooks can read it across sessions. However, committing mid-execution state (`status: in-progress`) creates dirty sentinels in git history. To prevent this:

1. **Before any auto-commit** (per-wave or debrief), write `status: committed` to `state.toon`.
2. **After the commit**, restore the actual status (e.g., `status: in-progress`).
3. This ensures checked-out commits never show a false "execution running" signal.

### Debrief Execution Order

1. **Copy tracked artifacts to `.plan-history/`** — file copies, atomic writes, no agent needed
2. **Spawn wiki-maintainer-agent** with event `execution-debrief` — **BLOCKING**, wait for completion, **timeout: 120 seconds**. If the agent has not completed after 120s, treat it as a failure (see Failure Handling).
3. **Secret scan.** Before staging any files, scan all tracked artifacts for potential secrets:
   - Pattern-match against common secret formats: API keys (`sk-`, `ghp_`, `AKIA`), tokens (`Bearer`, `token:`), connection strings, base64-encoded credentials
   - Scan `rolling-context.md`, `stage-context/*.toon`, `wave-*-summary.*` — these contain freeform agent output most likely to capture leaked values
   - If any matches are found: warn the user, list the files and matched patterns, and **do NOT auto-commit**. Ask the user to review and redact before proceeding.
4. **Write `debrief.toon`** — summary of what was captured
5. **Commit** (unless `--no-auto-commit` is active or secret scan flagged issues):
   - Set `state.toon` status to `committed` (see § State Sentinel)
   - `git add .plan-history/ .loom/wiki/ .plan-execution/debrief.toon .plan-execution/state.toon`
   - **In a worktree:** commit to the worktree's current branch, NOT main. Defer merging to the worktree-merge step or manual merge by the user.
   - **In the main tree:** commit directly:
     ```
     chore(debrief): capture execution knowledge — {N} decisions, {M} wiki pages
     ```
   - Restore `state.toon` to its actual status after the commit.
6. **Only then** may the orchestrator clean up ephemeral artifacts or destroy the worktree

### Opting Out of Debrief Commits

The `--no-auto-commit` flag (already supported by `/loom-plan execute`, `/loom-converge`, and `/loom-auto`) also applies to the debrief commit. When active:

- The debrief still runs (artifact copy + wiki update are mandatory)
- Files are staged but NOT committed
- The user sees: "Debrief complete. Changes staged but not committed (--no-auto-commit). Review with `git diff --cached` and commit when ready."

### Failure Handling

- **Wiki-maintainer-agent fails or times out (>120s):** Retry once. If retry fails, write `.plan-execution/debrief-failed.toon` with the error, warn the user: "Debrief failed — execution artifacts preserved in .plan-execution/ for manual recovery. Run `/loom-wiki ingest --source .plan-execution/` to retry." Do NOT clean up.
- **Secret scan finds matches:** Block the auto-commit. Warn the user with file paths and matched patterns. Debrief is otherwise complete — artifacts are copied and wiki is updated.
- **File copy to .plan-history/ fails:** Warn and continue — the tracked files in `.plan-execution/` are still committed to git as a fallback.
- **Worktree debrief fails:** Block worktree destruction. Warn: "Cannot destroy worktree — debrief incomplete. Artifacts may be lost."

---

## Wiki Integration

The project wiki (`.loom/wiki/`) is a persistent knowledge base that compounds across executions. See `wiki-conventions.md` for the full specification.

### Wiki Maintenance Triggers

The orchestrator spawns wiki-maintainer-agent at specific execution events. See `wiki-conventions.md § Wiki Maintenance Triggers` for the full trigger table and what the maintainer does at each point.

Wiki maintenance is **non-blocking** for mid-execution triggers (criteria-plan-created, convergence-complete, e2e-stories-verified): if wiki-maintainer-agent fails, the orchestrator logs a warning and continues.

**Exception: the `execution-debrief` trigger is BLOCKING.** See § Mandatory Debrief Protocol. The debrief ensures that execution knowledge is flushed to the wiki before cleanup. If the debrief wiki update fails, the orchestrator must NOT clean up artifacts.

### Execution Log Entries

These execution events are recorded in `.loom/wiki/execution-log.toon`:

- Wave completions (with summary of what was built)
- Quality gate results (pass/fail with context)
- Circuit breaker trips (which breaker, why)
- Human approvals and rejections (with rationale)
- Fix cycle outcomes (what was fixed, what remains)
- Convergence milestones (stalls, regressions, completion)

Routine events with no surprises get a single `execution` entry. Decisions, pivots, and escalations get more detailed entries with the `detail` field capturing rationale.

### Wiki Content in Rolling Context

Orchestrators MAY include a wiki summary section in `rolling-context.md` for agents that benefit from project knowledge beyond the immediate wave:

```markdown
## Project Knowledge [WIKI]
Key components: auth-middleware (JWT validation), user-service (CRUD + permissions).
Key decisions: JWT over sessions (performance), Postgres over Redis (simplicity).
Known issues: auth-middleware lacks rate limiting (tech-debt-rate-limiting).
```

This section should be kept under 1k tokens and only include pages relevant to the current wave's tasks. It is refreshed from wiki pages at the start of each wave.

## Domain Abstraction

The `[domain]` section in `orchestration.toml` enables Loom to work beyond code projects. See `orchestration-config.schema.md` for the full config schema.

### Configurable Verification Pipeline

Instead of hardcoded typecheck/lint/test commands, the verification-agent reads `[domain].verificationPipeline` from orchestration.toml:

```toml
[domain]
verificationPipeline = ["tsc --noEmit", "bun run lint", "bun test"]
```

If no `[domain]` section exists, the verification-agent falls back to auto-detection based on manifest files (current behavior). This ensures backward compatibility.

### Domain Types

The `[domain].type` field declares the project domain. Currently supported:
- `code` (default) — software projects with type files, tests, linting
- `research`, `creative`, `business` — declared for future agent packs

The domain type affects wiki page semantics (what "component" means) but not the orchestration machinery. See `wiki-conventions.md` for domain-specific page interpretations.

## Convergence and Quality Infrastructure

### 4-Tier Convergence

The convergence pipeline uses a 4-tier model defined in `convergence-tier.schema.md` (see `orchestration-patterns.md § 4-Tier Convergence Model` for the full pattern description). Tier-aware agents and their schemas:

| Tier | Agent | Schema | Directory |
|------|-------|--------|-----------|
| unit (4) | vitest-runner (CLI) | — | — |
| integration (3) | integration-test-agent | — | — |
| e2e (1) | `e2e-runner-agent.md`, `e2e-test-writer-agent.md` | `e2e-story.schema.md` | `.plan-execution/convergence/e2e/` |
| qa-review (2) | `interpretation-reviewer-agent.md` | `interpretation-conflict.schema.md`, `interpretation-report.schema.md` | `.plan-execution/conflicts/` |

### Flaky Test Quarantine

Tests that produce inconsistent results across convergence iterations are tracked in `.plan-execution/convergence/flaky-tests.toon` per `flaky-test.schema.md`. Quarantined tests are excluded from pass/fail gating but preserved for post-mortem. The convergence-driver reads this registry before evaluating circuit breaker conditions.

### Convergence Rollback

When a convergence loop regresses beyond recovery, the rollback protocol (`convergence-rollback.md`) archives the current state to `.plan-execution/convergence/rollback-archive/{timestamp}/` and resets to the last known-good checkpoint. Archives include iteration summaries, flaky-test registry, and harness config.

### Interpretation Conflict Detection

The `interpretation-reviewer-agent` runs at the qa-review tier (or on-demand via `/loom-auto`). It detects conflicts between agents' interpretations of plan criteria and writes conflict reports to `.plan-execution/conflicts/`. The report format follows `interpretation-conflict.schema.md`, and the aggregate output follows `interpretation-report.schema.md`.

### E2E Story Verification

End-to-end stories are defined in `e2e-story.schema.md` and stored in `.plan-execution/convergence/e2e/stories/`. The `e2e-test-writer-agent` generates test scripts from stories into `.plan-execution/convergence/e2e/tests/`. The `e2e-runner-agent` executes those tests and captures screenshots to `.plan-execution/convergence/e2e/screenshots/`.

### Wiki Maintenance Triggers

The orchestrator spawns `wiki-maintainer-agent` at execution events defined in `wiki-maintainer-triggers.md`. This includes convergence milestones, wave completions, and quality gate results. Wiki maintenance is non-blocking (see § Wiki Integration above).

### Preflight Budget Checks

Before spawning test or convergence agents, the orchestrator runs `hooks/context-budget-test.ts` (`checkTestAgentBudget`) to verify the agent's estimated token usage is within the 100k budget cap. See `context-budget.md` and `stage-context.schema.md` for the budget and stage context specifications.

### Planning Taxonomy

The planning hierarchy (milestone > feature > phase > wave) is defined in `taxonomy.md`. It is referenced by the convergence-tier schema, criteria-plan schema (`criteria-plan.schema.md` — `testTier` field), and the convergence-planner-agent for tier assignment.

### Execution Logging

Execution events are logged to `.loom/wiki/execution-log.toon` following `execution-log.schema.md`. The schema includes 16 event types for convergence, testing, and QA tracking. The statusline contract (`statusline-contract.md`) defines 5 segments for surfacing convergence and test progress.

### Schema Upgrades

When protocol schemas evolve across versions, `schema-upgrade.md` defines the migration procedure. The `/loom-upgrade` command (`loom-upgrade.md`) reads migration definitions and applies transformations to on-disk artifacts. The `interpretation-reviewer-agent` also references `schema-upgrade.md` for backward-compatible schema transitions during conflict detection.

### Behavioral Guidelines

All execution agents follow `behavioral-guidelines.md`, which mandates TDD-first development, diagnose-before-fix discipline, and verification gates on all AgentResults. The `agent-result.schema.md` requires `verificationStatus` and `diagnoseLog` fields.

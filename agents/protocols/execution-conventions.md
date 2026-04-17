# Execution Conventions

Shared rules that all execution agents and the orchestrator follow. Reference this document in every agent's instructions.

## Directory Structure

```
.plan-execution/
├── .lock                       # PID lock file — prevents concurrent runs
├── .gitignore                  # Auto-generated: ignores everything in this dir
├── state.toon                  # Execution state (see state.schema.md)
├── pipeline-state.toon         # /loom-auto pipeline state (see pipeline-state.schema.md)
├── rolling-context.md          # Tiered summary of all prior waves
├── contracts/                  # Wave 0 output — shared types/schemas
│   ├── manifest.toon           # Lists all contract files + their purpose
│   └── [contract files]        # e.g., types.ts, schema.sql, api-contract.ts
├── progress/                   # Agent heartbeat files (ephemeral, cleared per wave)
│   └── {taskId}.toon           # Per-agent progress — see agent-monitoring.schema.md
├── requests/                   # Cross-boundary requests from implementers
│   └── {taskId}.toon           # One file per request
├── scope-coverage.toon         # Acceptance criteria coverage matrix
├── stage-context/              # Structured stage summaries (see stage-context.schema.md)
│   ├── contracts.toon
│   ├── execute.toon
│   ├── review.toon
│   ├── test.toon
│   ├── converge.toon
│   └── fix.toon
├── convergence/
│   └── iterations/             # Per-iteration summaries (preserved across iterations)
│       ├── iter-1.toon
│       └── ...
├── wave-0-summary.toon         # Machine-readable wave summary
├── wave-0-summary.md           # Human-readable wave summary
├── wave-1-summary.toon
├── wave-1-summary.md
└── ...
```

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
- **progress/{taskId}.toon**, **requests/{taskId}.toon** — ephemeral runtime files
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

The orchestrator writes `.plan-execution/status.toon` to surface live progress in the Claude Code status line. This file is read by the user's `statusline-command.sh` and must remain small and fast to parse (simple `grep` per field).

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
- If file cannot be written (no `.plan-execution/` dir), skip silently — status line is additive, never gating

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

All commands: create `.plan-execution/` if needed, delete `status.toon` when complete.

## Atomic Writes

All agents and the orchestrator MUST use atomic writes for shared state:
1. Write content to `{filename}.tmp`
2. Rename `{filename}.tmp` to `{filename}`

This prevents partial reads of corrupted state.

## File Ownership Rules

1. **One owner per file.** No two implementer-agents may modify the same file in the same wave.
2. **Ownership is explicit.** Each implementer receives an exact list of files it may create/modify in its prompt.
3. **Cross-boundary needs → request file.** If an implementer needs a file outside its boundary, it writes to `.plan-execution/requests/{taskId}.toon`. The wiring-agent processes these.
4. **Wiring-agent owns shared files.** Package.json, barrel/index files, route registrations, and migration files are explicitly owned by the wiring-agent.
5. **Contracts are read-only after Wave 0.** No agent may modify contract files after the contracts-agent completes. If amendments are needed, the orchestrator decides whether to re-run Wave 0.

### Hook Enforcement

Rules 1-2 and 5 above are **deterministically enforced** by Claude Code hooks in `hooks/`:

- `file-ownership.ts` (PreToolUse) — blocks writes to files not in the current task's ownership list
- `contract-lock.ts` (PreToolUse) — blocks writes to `contracts/` after Wave 0 completes
- `budget-tracker.ts` (PreToolUse + SubagentStop) — tracks agent count, blocks spawns at budget limit

These hooks fail open: if `.plan-execution/state.toon` is missing or unreadable, writes are allowed. See `hooks/lib/run-hook.ts` for the shared defensive harness. Registered in `.claude/settings.json`.

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

Pass `--no-auto-commit` to `/loom-plan execute`, `/loom converge`, or `/loom auto` to disable auto-commits. All code changes accumulate in the working tree as before. Git tags (`plan-exec-wave-N-pre`) are still created regardless of this flag.

### Interaction with Git Tags

Git tags (`plan-exec-wave-N-pre`) are created **before** the wave runs. Auto-commits happen **after** verification passes. This means:
- `plan-exec-wave-N-pre` → tag points to the state before wave N
- The auto-commit after wave N → contains wave N's changes
- `--rollback-wave N` still works: reset to the pre-tag, which is before both the code and the commit

## Stage Context Writing

Stage context files capture structured summaries of what happened at each pipeline boundary. They follow the `StageContext` schema defined in `stage-context.schema.md`.

### When to Write

- **`/loom-plan execute`:** After each wave's verification step -- write `stage-context/contracts.toon` after Wave 0 verification, write `stage-context/execute.toon` after Wave N verification.
- **`/loom auto`:** After each pipeline stage completes -- write the corresponding `stage-context/{stage}.toon` at every stage boundary (execute, test, review, converge, fix).

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

## Wiki Integration

The project wiki (`.loom/wiki/`) is a persistent knowledge base that compounds across executions. See `wiki-conventions.md` for the full specification.

### Wiki Maintenance Triggers

The orchestrator spawns wiki-maintainer-agent at specific execution events. See `wiki-conventions.md § Wiki Maintenance Triggers` for the full trigger table and what the maintainer does at each point.

Wiki maintenance is **non-blocking**: if wiki-maintainer-agent fails, the orchestrator logs a warning and continues. Wiki health is additive, never gating.

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

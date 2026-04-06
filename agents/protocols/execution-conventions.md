# Execution Conventions

Shared rules that all execution agents and the orchestrator follow. Reference this document in every agent's instructions.

## Directory Structure

```
.plan-execution/
├── .lock                       # PID lock file — prevents concurrent runs
├── .gitignore                  # Auto-generated: ignores everything in this dir
├── state.json                  # Execution state (see state.schema.md)
├── rolling-context.md          # Tiered summary of all prior waves
├── contracts/                  # Wave 0 output — shared types/schemas
│   ├── manifest.json           # Lists all contract files + their purpose
│   └── [contract files]        # e.g., types.ts, schema.sql, api-contract.ts
├── progress/                   # Agent heartbeat files (ephemeral, cleared per wave)
│   └── {taskId}.json           # Per-agent progress — see agent-monitoring.schema.md
├── requests/                   # Cross-boundary requests from implementers
│   └── {taskId}.json           # One file per request
├── wave-0-summary.json         # Machine-readable wave summary
├── wave-0-summary.md           # Human-readable wave summary
├── wave-1-summary.json
├── wave-1-summary.md
└── ...
```

## File Naming Conventions

### Contract files
- Use descriptive names: `types.ts`, `schema.sql`, `api-types.ts`, `db-models.ts`
- Always include a `manifest.json`:
  ```json
  {
    "contracts": [
      {"file": "types.ts", "purpose": "Shared TypeScript type definitions", "exports": ["User", "Site", "Event"]},
      {"file": "schema.sql", "purpose": "Database schema", "tables": ["users", "sites", "events"]}
    ]
  }
  ```

### Wave summaries
- `wave-N-summary.json` — machine-readable, follows this structure:
  ```json
  {
    "wave": 0,
    "agentResults": ["array of AgentResult objects"],
    "filesChanged": ["deduplicated list of all files created/modified/deleted"],
    "exportsAdded": ["deduplicated list of all new exports"],
    "unresolvedIssues": ["any blocking/warning issues from agents"]
  }
  ```
- `wave-N-summary.md` — human-readable narrative for inspection

### Cross-boundary requests
- `requests/{taskId}.json`:
  ```json
  {
    "taskId": "string",
    "agent": "string",
    "requests": [
      {"file": "path", "reason": "why", "suggestedChange": "what"}
    ]
  }
  ```

## Data Formats — TOON vs JSON

The system uses two data formats for different purposes:

### JSON — Storage and Validation
- **state.json**, **manifest.json**, **wave-N-summary.json** — on-disk persistence
- Schema validation via AJV against `*.schema.json` files
- Machine-to-machine data exchange

### TOON (Token-Oriented Object Notation) — Agent Communication
- Agent prompts and inter-agent data in rolling-context.md
- Review findings passed between agents
- Any structured data embedded in LLM context

TOON achieves **30-60% token reduction** vs JSON while maintaining lossless roundtrip fidelity.

**Conversion rule:** Orchestrators convert JSON to TOON before injecting into agent prompts, and parse TOON back to JSON when collecting agent output.

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

## Atomic Writes

All agents and the orchestrator MUST use atomic writes for shared state:
1. Write content to `{filename}.tmp`
2. Rename `{filename}.tmp` to `{filename}`

This prevents partial reads of corrupted state.

## File Ownership Rules

1. **One owner per file.** No two implementer-agents may modify the same file in the same wave.
2. **Ownership is explicit.** Each implementer receives an exact list of files it may create/modify in its prompt.
3. **Cross-boundary needs → request file.** If an implementer needs a file outside its boundary, it writes to `.plan-execution/requests/{taskId}.json`. The wiring-agent processes these.
4. **Wiring-agent owns shared files.** Package.json, barrel/index files, route registrations, and migration files are explicitly owned by the wiring-agent.
5. **Contracts are read-only after Wave 0.** No agent may modify contract files after the contracts-agent completes. If amendments are needed, the orchestrator decides whether to re-run Wave 0.

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
- state.json (only the orchestrator reads/writes this)

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

## Persistence — .plan-history/

Ephemeral execution artifacts in `.plan-execution/` are NOT committed to git. For cross-session and cross-worktree persistence, orchestrators write key artifacts to `.plan-history/` which IS committed:

```
.plan-history/
├── reviews/
│   └── YYYY-MM-DD-review.toon       # /review-plan findings
├── decisions/
│   └── NNN-description.md            # Architecture Decision Records from gates
├── executions/
│   └── wave-N-summary.toon           # Preserved wave results
├── roadmap.toon                      # Milestones, status, dependencies
└── changelog.md                      # Plan revision history
```

Orchestrators write to `.plan-history/` when:
- `/review-plan` completes → saves synthesized findings
- `/execute-plan` completes a wave → saves wave summary
- Human approves/rejects at a gate → saves decision record
- Plan is modified after review → appends to changelog

This directory syncs via git, survives worktree cleanup, and is available in future sessions.

# Validation Rules

Rules that orchestrators enforce when collecting agent output and reading configuration. Every orchestrator command (`execute-plan`, `review-plan`, `test-plan`, `review-code`, `roadmap`) MUST apply these validations.

## 1. AgentResult Validation

Every agent returns an `AgentResult` (JSON or TOON). The orchestrator MUST validate it before processing.

### Required fields
All of these must be present and non-null:
- `agent` — non-empty string
- `wave` — number >= 0
- `taskId` — non-empty string
- `status` — one of: `"success"`, `"failure"`, `"partial"`
- `filesCreated` — array of strings
- `filesModified` — array of strings
- `exportsAdded` — array of objects with `file`, `name`, `kind`
- `issues` — array of objects with `severity`, `description`

### Validation checks
1. **Status consistency**: If `status` is `"success"`, there MUST be zero issues with `severity: "blocking"`
2. **File paths**: All paths in `filesCreated` and `filesModified` must be relative (no leading `/` unless absolute paths are expected)
3. **No duplicate files**: A file cannot appear in both `filesCreated` and `filesModified`
4. **Export consistency**: Every file in `exportsAdded[].file` must appear in either `filesCreated` or `filesModified`
5. **Kind validation**: `exportsAdded[].kind` must be one of: `"function"`, `"class"`, `"const"`, `"type"`, `"interface"`, `"enum"`

### On validation failure
- Log which fields failed validation and the agent name
- Mark the agent's task as `failed` in state.json
- Include validation errors in the wave summary
- Do NOT silently accept malformed results — surface them to the user

## 2. orchestration.toml Validation

When an orchestrator reads `.claude/orchestration.toml`, validate before spawning any agents from it.

### Structure checks
1. **Top-level sections**: Only `planning`, `execution`, `testing`, `review`, `patterns`, and `settings` are valid
2. **Agent entries require**: `source` (file path that must exist on disk)
3. **Agent entries optional**: `model` (one of: `"opus"`, `"sonnet"`, `"haiku"`), `outputRole` (one of: `"reviewer"`, `"producer"`, `"blocker"`), `phase`, `modes`, `input`
4. **Source files must exist**: Before spawning, verify the `.md` file at `source` exists. If not, warn and skip (don't fail the entire pipeline)
5. **Pattern entries**: Must have a valid `type` (one of: `"debate"`, `"chain"`, `"vote"`, `"triage"`)

### On validation failure
- Warn the user about invalid entries
- Skip invalid agents but continue with valid ones
- Never silently ignore a config file that exists but can't be parsed

## 3. Blocker Gate Enforcement

Project-specific agents with `outputRole: "blocker"` have special semantics.

### Rules
1. **Blockers must pass**: If a blocker agent returns `status: "failure"` or has any `issues` with `severity: "blocking"`, the pipeline MUST halt
2. **Blockers run before synthesis**: In `/review-plan`, blockers must complete and pass before the synthesis step
3. **Blockers run before proceeding**: In `/execute-plan`, a blocker in the `pre-contracts` phase must pass before contracts-agent runs
4. **Blocker failure reporting**: When a blocker fails, display its issues prominently with a clear "BLOCKED" label and ask the user how to proceed (fix and retry / override / abort)
5. **Override tracking**: If the user overrides a blocker, log this decision to `.plan-history/decisions/` with the reason

### Example blocker flow
```
1. Orchestrator reads orchestration.toml
2. Finds agent with outputRole: "blocker"
3. Spawns blocker agent alongside other agents
4. Blocker returns status: "failure" with blocking issues
5. Orchestrator halts pipeline:

   BLOCKED by domain-validator:
   - Missing required HIPAA audit trail in schema
   - No encryption-at-rest specified for PII fields

   Options: (fix and re-run / override with reason / abort)

6. If user overrides: log to .plan-history/decisions/NNN-blocker-override.md
7. Continue pipeline
```

## 4. State.json Integrity

### On write
- Always use atomic writes (write to `.tmp`, rename)
- Increment `updatedAt` timestamp
- Validate status transitions: `pending → in_progress → succeeded/failed` (no skipping)

### On read (especially --resume)
- Verify `schemaVersion` matches expected version
- Check that `currentWave` is consistent with wave statuses
- Warn if `updatedAt` is more than 24 hours old (stale state)

## 5. Cross-Boundary Request Validation

When processing `.plan-execution/requests/{taskId}.json`:

1. **Source agent exists**: The `agent` field must match an agent that ran in the current wave
2. **Requested files are valid**: Each `file` in `requests[]` must be a real path (or a path that will exist after wiring)
3. **No self-requests**: An agent cannot request changes to files it already owns
4. **Dedup**: If multiple agents request changes to the same file, flag for human review

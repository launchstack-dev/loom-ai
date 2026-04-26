# Schema Upgrade Protocol

Defines migration rules for upgrading old-format Loom project artifacts to current schema versions. The governing principle is **automatic detection with explicit migration**: agents detect old formats at read-time and warn on stderr, but only `/loom-upgrade` performs the actual transformation.

## Overview

As Loom schemas evolve, existing project artifacts may fall behind the current version. Rather than silently breaking or silently patching, Loom uses a two-phase approach:

1. **Detection phase** — any agent reading an artifact checks for version markers and required fields. If the artifact is outdated, the agent emits a stderr warning and continues with best-effort reading.
2. **Migration phase** — the user explicitly runs `/loom-upgrade`, which scans, backs up, transforms, and validates all outdated artifacts in one pass.

This separation ensures agents never silently mutate files the user has not asked to change, while still surfacing staleness early.

## Upgrade Scopes

The protocol defines two scopes, selected by the `/loom-upgrade` command:

| Scope | Flag | What it covers |
|-------|------|----------------|
| Execution artifacts | *(default, no flag)* | In-flight `.plan-execution/` files: state, agent results, criteria plans, PLAN.md |
| Project infrastructure | `--project` | Orchestration config, CLAUDE.md conventions, hook wiring, wiki, protocol files, roadmap schema |

Rules 1-5 are execution-artifact rules (original scope). Rules 6-11 are project-infrastructure rules (new `--project` scope). When `--project` is passed, ALL rules (1-11) are evaluated.

---

## Version Detection

Each schema has a detection strategy based on field presence or explicit version markers.

### Execution Artifact Detection (Rules 1-5)

```toon
detectionRules[N]{schema,file,strategy,oldIndicator,currentVersion}:
  criteria-plan,criteria-plan.toon,field-absence,missing testTier column in criteria array,1
  agent-result,*.agent-result.toon,field-absence,missing verificationStatus or diagnoseLog,1
  plan,PLAN.md,field-absence,missing CLI Command Spec / State Machines / Error Handling sections,2
  state,.plan-execution/state.toon,field-absence,missing schemaVersion field,1
  convergence-tier,convergence-tier.schema.md,new-file,file does not exist yet — no migration needed,1
```

### Project Infrastructure Detection (Rules 6-11)

```toon
projectDetectionRules[N]{schema,file,strategy,oldIndicator,currentVersion}:
  orchestration-config,.claude/orchestration.toml,field-absence,missing contextBudget / wiki / domain sections or key fields,2
  roadmap,ROADMAP.md,field-absence,missing roadmapVersion frontmatter or required sections per roadmap.schema.md,1
  claude-md,CLAUDE.md,section-absence,missing TOON / model resolution / context budget conventions,2
  hooks,.claude/settings.json,hook-absence,missing contract-lock / file-ownership / budget-tracker / context-budget hooks,1
  wiki,.loom/wiki/,dir-absence,wiki directory does not exist or has no index.toon,1
  protocols,agents/protocols/,file-set,missing protocol files that should exist for current Loom version,1
```

### Detection Logic (pseudocode)

```
function detectVersion(schema, content):
  match schema:
    "criteria-plan":
      if criteria array header lacks "testTier" column → return { outdated: true, reason: "missing testTier" }
    "agent-result":
      if content lacks "verificationStatus:" → return { outdated: true, reason: "missing verificationStatus" }
      if content lacks "diagnoseLog:" → return { outdated: true, reason: "missing diagnoseLog" }
    "plan":
      if content lacks "## CLI Command Spec" AND lacks "## State Machines" → return { outdated: true, reason: "v1 format" }
    "state":
      if content lacks "schemaVersion:" → return { outdated: true, reason: "missing schemaVersion" }
    "convergence-tier":
      return { outdated: false }  // new file, nothing to migrate
  return { outdated: false }
```

### Project Infrastructure Detection Logic (pseudocode)

```
function detectProjectVersion(schema, projectRoot):
  match schema:
    "orchestration-config":
      configPath = projectRoot + "/.claude/orchestration.toml"
      if file does not exist → return { outdated: true, reason: "orchestration.toml missing entirely" }
      content = read(configPath)
      missing = []
      if content lacks "[settings.contextBudget]" → missing.push("contextBudget section")
      if content lacks "[wiki]" → missing.push("wiki section")
      if content lacks "[domain]" → missing.push("domain section")
      if content lacks "contractType" → missing.push("contractType field")
      if content lacks "verificationPipeline" → missing.push("verificationPipeline field")
      if content lacks "dataFormat" → missing.push("dataFormat field")
      if missing.length > 0 → return { outdated: true, reason: "missing: " + missing.join(", ") }

    "roadmap":
      rmPath = projectRoot + "/ROADMAP.md"
      if file does not exist → return { outdated: false }  // no roadmap is valid (not every project has one)
      content = read(rmPath)
      if content lacks "roadmapVersion:" in frontmatter → return { outdated: true, reason: "missing roadmapVersion frontmatter" }
      requiredSections = ["## Vision", "## Success Metrics", "## Constraints & Decisions",
                          "## Tech Stack", "## Features", "## Data Model", "## Milestones",
                          "## Risks & Mitigations", "## Out of Scope"]
      missing = requiredSections.filter(s => content lacks s)
      if missing.length > 0 → return { outdated: true, reason: "missing sections: " + missing.join(", ") }

    "claude-md":
      cmdPath = projectRoot + "/CLAUDE.md"
      if file does not exist → return { outdated: true, reason: "CLAUDE.md missing entirely" }
      content = read(cmdPath)
      missing = []
      if content lacks "TOON" → missing.push("TOON format convention")
      if content lacks "model resolution" or "Model resolution" → missing.push("model resolution convention")
      if content lacks "context" and "budget" → missing.push("context budget convention")
      if content lacks "Stage Summary" or "stage-context" → missing.push("stage summary convention")
      if missing.length > 0 → return { outdated: true, reason: "missing conventions: " + missing.join(", ") }

    "hooks":
      settingsPath = projectRoot + "/.claude/settings.json"
      if file does not exist → return { outdated: true, reason: "settings.json missing entirely" }
      content = read(settingsPath)
      requiredHooks = ["contract-lock", "file-ownership", "context-budget", "budget-tracker", "quality-gate"]
      missing = requiredHooks.filter(h => content lacks h)
      if missing.length > 0 → return { outdated: true, reason: "missing hooks: " + missing.join(", ") }

    "wiki":
      wikiPath = projectRoot + "/.loom/wiki/"
      if directory does not exist → return { outdated: true, reason: "wiki directory missing" }
      if wikiPath + "index.toon" does not exist → return { outdated: true, reason: "wiki index.toon missing" }

    "protocols":
      protocolDir = projectRoot + "/agents/protocols/"
      if directory does not exist → return { outdated: true, reason: "agents/protocols/ directory missing entirely" }
      requiredProtocols = [
        "agent-result.schema.md", "execution-conventions.md", "behavioral-guidelines.md",
        "scope-contract.schema.md", "plan.schema.md", "roadmap.schema.md",
        "convergence-tier.schema.md", "schema-upgrade.md", "context-budget.md",
        "stage-context.schema.md", "toon-format.md", "orchestration-config.schema.md",
        "wiki-conventions.md"
      ]
      missing = requiredProtocols.filter(p => file does not exist at protocolDir + p)
      if missing.length > 0 → return { outdated: true, reason: "missing protocols: " + missing.join(", ") }

  return { outdated: false }
```

## Migration Rules

### Rule 1: criteria-plan.toon — add testTier

**Trigger**: criteria array header does not include `testTier` column.

**Migration**:
- Append `testTier` to the typed-array column header.
- For each existing row, append default value `unit`.

Before:
```toon
criteria[N]{id,name,type,verifier,passCondition,blocking,priority,source,rationale}:
  C-01,Blocks unauthenticated requests,hard,test-runner,all-pass,true,P0,plan-acceptance,Explicit acceptance criterion
```

After:
```toon
criteria[N]{id,name,type,verifier,passCondition,blocking,priority,source,rationale,testTier}:
  C-01,Blocks unauthenticated requests,hard,test-runner,all-pass,true,P0,plan-acceptance,Explicit acceptance criterion,unit
```

**Default value**: `unit`

### Rule 2: AgentResult files — add verificationStatus and diagnoseLog

**Trigger**: file content lacks `verificationStatus:` line or `diagnoseLog:` line.

**Migration**:
- If `verificationStatus:` is missing, insert after the `durationMs:` line with default `unverified`.
- If `diagnoseLog:` is missing, insert after the `verificationStatus:` line with default value `null`.

Before:
```toon
agent: implementer-agent
wave: 1
taskId: task-003
status: success
durationMs: 8200
gate: pass
```

After:
```toon
agent: implementer-agent
wave: 1
taskId: task-003
status: success
durationMs: 8200
verificationStatus: unverified
diagnoseLog: null
gate: pass
```

**Default values**: `verificationStatus: unverified`, `diagnoseLog: null`

### Rule 3: PLAN.md — v1 to v2 structural migration

**Trigger**: PLAN.md exists but matches one or more of these v1 indicators:
- No YAML frontmatter (`planVersion`, `roadmapRef`, `totalPhases`, `totalWaves`)
- No `## Schema / Type Definitions` section
- Phases lack structured `#### Deliverables` tables
- Phases lack structured `#### Acceptance Criteria` checklists
- No wave assignments on phases
- No `roadmapRef` linking to ROADMAP.md

**Migration tiers** (applied in order, each tier independent):

#### Tier A: Frontmatter (auto-patchable)

If PLAN.md lacks YAML frontmatter, prepend it. Infer values:
- `planVersion: 2`
- `name`: extract from first `# ` heading, or `"Unknown"`
- `status: draft`
- `created`: file modification date (ISO format)
- `lastReviewed: null`
- `roadmapRef`: if ROADMAP.md exists in same directory, set to `ROADMAP.md`; otherwise `null`
- `totalPhases`: count `## Phase` headings
- `totalWaves`: infer from phase count (default: `ceil(totalPhases / 3)`)

#### Tier B: Missing sections (auto-patchable, stubs only)

Append stubs for missing sections:
- `## CLI Command Spec` — `<!-- TODO -->`
- `## State Machines` — `<!-- TODO -->`
- `## Error Handling` — `<!-- TODO -->`

#### Tier C: Structural migration (agent-driven, inline)

These transformations require semantic understanding of the plan's prose content and CANNOT be done with grep-and-patch. `/loom-upgrade --project` spawns a `plan-upgrade-agent` to handle them inline — no separate follow-up command needed.

After applying Tier A and B patches, the upgrade spawns the agent with:
- The patched PLAN.md content
- The current `plan.schema.md` as the target format
- ROADMAP.md (if present) for cross-reference resolution
- Instruction: "Migrate this plan to match the current schema. Preserve all existing content and intent. Add structure, don't change meaning."

The agent restructures in place:

| Element | Before (any old format) | After (current schema) |
|---------|------------------------|----------------------|
| Schema | Prose descriptions or absent | Typed tables per entity (Field, Type, Constraints, Validation Rules) with Indexes and Cascade Behavior |
| Phase deliverables | Numbered prose lists | `#### Deliverables` table (File, Action, Owner hint) |
| Phase acceptance | Prose paragraph or absent | `#### Acceptance Criteria` checkbox list, each testable |
| Wave assignment | No concept | Each phase assigned to a wave; wave 0 = contracts-agent |
| Cross-refs | None | `roadmapRef` in frontmatter, `featureRef` / `milestoneRef` on phases |
| Scope contract | Doesn't exist | `scope-contract.toon` generated with decisions, assumptions, nonGoals, successCriteria |
| Convergence tiers | Doesn't exist | Per-phase tier assignments referencing `convergence-tier.schema.md` |

The agent writes the migrated PLAN.md atomically. If the agent fails or produces output that doesn't pass `plan.schema.md` validation, the original (Tier A+B patched) file is kept and the failure is recorded in the upgrade report.

**Confirmation gate**: Before the agent writes, the upgrade prints a diff summary and asks for confirmation (unless `--force`). The user can accept the structural migration, skip it (keep Tier A+B only), or abort.

### Rule 4: state.toon — add schemaVersion

**Trigger**: `.plan-execution/state.toon` lacks `schemaVersion:` field.

**Migration**:
- Insert `schemaVersion: 1` as the first line of the file.

Before:
```toon
runId: a1b2c3d4-uuid
planFile: PLAN.md
status: running
```

After:
```toon
schemaVersion: 1
runId: a1b2c3d4-uuid
planFile: PLAN.md
status: running
```

**Default value**: `schemaVersion: 1`

### Rule 5: convergence-tier.schema.md — no migration

This is a new schema file introduced in the current version. No existing artifacts need migration. Detection returns `outdated: false` unconditionally.

---

## Project Infrastructure Migration Rules (Rules 6-11)

These rules run only when `/loom-upgrade --project` is invoked. They bring a project's Loom infrastructure up to the current version.

### Rule 6: orchestration.toml — add missing sections and fields

**Trigger**: `.claude/orchestration.toml` is missing entirely, or lacks required sections/fields.

**Migration (file missing entirely)**:
- Create `.claude/orchestration.toml` with the minimal viable config:

```toml
[settings]
maxParallelAgents = 6
defaultModel = "sonnet"
persistHistory = true
dataFormat = "toon"

[settings.contextBudget]
contextWindow = 200000

[wiki]
enabled = true
path = ".loom/wiki"
maxPages = 500
stalenessDays = 30
archiveThresholdMultiplier = 3
autoLint = true
lintSchedule = "post-wave"

[domain]
type = "code"
contractType = "type-files"
verificationPipeline = ["tsc --noEmit", "bun run lint", "bun test"]
```

**Migration (file exists, missing sections)**:
- For each missing section, append it to the end of the file with defaults from `orchestration-config.schema.md`.
- Missing `[settings.contextBudget]`: append with `contextWindow = 200000`.
- Missing `[wiki]`: append with defaults above.
- Missing `[domain]`: append with defaults above.
- Missing individual fields within existing sections: append the field with its default value from the schema.

**Default values**: See `orchestration-config.schema.md` for all field defaults.

### Rule 7: ROADMAP.md — migrate to roadmap.schema.md v1

**Trigger**: ROADMAP.md exists but matches one or more of these indicators:
- No YAML frontmatter (`roadmapVersion`, `name`, `status`, `totalFeatures`, `totalMilestones`)
- Features lack `F-XX` IDs, structured Priority/Milestone/Description/Key behaviors fields
- Milestones lack `M-XX` IDs, structured Depends on/Acceptance/Effort fields
- No Data Model section with entity/relationship tables
- No cross-references between features ↔ milestones ↔ entities
- No convergence targets on features
- Missing required sections per `roadmap.schema.md`

**Migration tiers** (applied in order, each tier independent):

#### Tier A: Frontmatter (auto-patchable)

If ROADMAP.md lacks YAML frontmatter, prepend it. Infer values:
- `roadmapVersion: 1`
- `name`: extract from `# Roadmap: {name}` title, or first `#` heading, or `"Unknown"`
- `status: draft`
- `created`: file modification date (ISO format)
- `lastReviewed: null`
- `targetDate: null`
- `totalFeatures`: count `### F-` headings (or count any `###` headings under `## Features`), or `0`
- `totalMilestones`: count `### M-` headings (or count any `###` headings under `## Milestones`), or `0`

#### Tier B: Missing sections (auto-patchable, stubs only)

For each missing section from the required set, append a stub with `<!-- TODO -->` placeholder. Stubs are inserted in correct order per `roadmap.schema.md`. Only missing sections are added — existing sections are never modified.

Required sections: `## Vision`, `## Success Metrics`, `## Constraints & Decisions`, `## Tech Stack`, `## Features`, `## Data Model (Conceptual)`, `## Milestones`, `## Risks & Mitigations`, `## Out of Scope`.

#### Tier C: Structural migration (agent-driven, inline)

These transformations require semantic understanding and CANNOT be done with grep-and-patch. `/loom-upgrade --project` spawns a `roadmap-upgrade-agent` to handle them inline.

After applying Tier A and B patches, the upgrade spawns the agent with:
- The patched ROADMAP.md content
- The current `roadmap.schema.md` as the target format
- Instruction: "Migrate this roadmap to match the current schema. Preserve all existing content and intent. Add structure, IDs, and cross-references — don't change meaning."

The agent restructures in place:

| Element | Before (any old format) | After (current schema) |
|---------|------------------------|----------------------|
| Features | Free-form prose, no IDs | `### F-XX: Name` with Priority, Milestone, Description, Key behaviors, Entities involved, Convergence targets |
| Milestones | Unstructured or absent | `### M-XX: Name` with Features list, Depends on (DAG), Acceptance, Effort (S/M/L/XL) |
| Data Model | Absent or inline mentions | Entity table (Entity, Key Fields, Description) + Relationship table (From, To, Type, Description) |
| Constraints | Prose or absent | `### C-XX: Title` with Decision, Rationale, Alternatives considered, Impact |
| Success Metrics | Prose or absent | Table with Metric, Target, Measurement columns — each objectively verifiable |
| Cross-refs | None | Features reference M-XX milestones; features reference entity names; milestones list F-XX features |
| Convergence | Doesn't exist | Per-feature convergence targets (verifiable outputs) consumed by convergence-planner-agent |

The agent writes the migrated ROADMAP.md atomically. If the agent fails or produces output that doesn't pass `roadmap.schema.md` validation, the original (Tier A+B patched) file is kept and the failure is recorded.

**Confirmation gate**: Before the agent writes, the upgrade prints a diff summary and asks for confirmation (unless `--force`). The user can accept, skip (keep Tier A+B only), or abort.

**Roadmap → Plan cascade**: If both ROADMAP.md and PLAN.md need Tier C migration, the roadmap is migrated first. The plan agent then receives the migrated roadmap for cross-reference resolution.

### Rule 8: CLAUDE.md — add missing Loom conventions

**Trigger**: CLAUDE.md is missing entirely, or lacks key Loom convention sections.

**Migration (file missing)**:
- Do NOT generate a full CLAUDE.md — that requires codebase analysis. Instead, report `status: manual-required` with guidance:
  ```
  CLAUDE.md is missing. Run `/loom-init` to generate it from codebase analysis.
  ```

**Migration (file exists, missing conventions)**:
- Append a `## Loom Conventions` section (if not present) with the missing subsections. Only add subsections that are missing — never overwrite existing content.
- Check for and append these convention blocks if absent:

```markdown
## Loom Conventions

### Data Format: TOON Everywhere

All Loom on-disk artifacts, agent output formats, protocol schemas, state files, and inter-agent communication MUST use TOON (Token-Oriented Object Notation). See `agents/protocols/toon-format.md` for the full spec.

Exceptions: app-specific data (JSON API responses, SQL), standard tooling config (`package.json`, `orchestration.toml`), hook stdin/stdout.

### Agent Conventions

- All agents return a standard AgentResult envelope in TOON (see `agents/protocols/agent-result.schema.md`)
- Execution agents write progress heartbeats to `.plan-execution/progress/{taskId}.toon`
- File writes must be atomic: write to `.tmp`, then rename
- **Model resolution is mandatory.** Before every Agent tool call, read the target agent's `.md` frontmatter `model:` field and pass `model: "{value}"` on the call.

### Context Management

- **Hard cap: 100k tokens** per agent spawn (half the 200k context window)
- Token estimation: characters / 4 heuristic, plus 5000-token overhead
- Every pipeline stage writes a StageContext summary to `.plan-execution/stage-context/{stage}.toon`
- Writes must be atomic: write to `{path}.tmp`, then `fs.renameSync`
```

**Detection granularity**: each subsection is checked independently. If CLAUDE.md already has "TOON" mentioned but lacks "Model resolution", only the Agent Conventions block is appended.

### Rule 9: Hook wiring — add missing hooks to settings.json

**Trigger**: `.claude/settings.json` is missing, or lacks required hook entries.

**Migration (file missing)**:
- Do NOT create settings.json from scratch — that could overwrite user permissions and other settings. Report `status: manual-required` with guidance:
  ```
  .claude/settings.json is missing. Create it with hook entries, or copy from the Loom template.
  ```

**Migration (file exists, missing hooks)**:
- Parse the JSON. For each missing hook, add it to the appropriate matcher array.
- Required hooks and their matchers:

```toon
requiredHooks[N]{matcher,hookCommand,timeout}:
  Write|Edit,contract-lock.ts,10
  Write|Edit,file-ownership.ts,10
  Agent,context-budget.ts,10
  Agent,budget-tracker.ts,10
  Stop,quality-gate.ts,10
```

- For each missing hook:
  1. Find the `PreToolUse` / `PostToolUse` / `Stop` array matching the hook's matcher.
  2. If the matcher group doesn't exist, create it.
  3. Append the hook entry: `{ "type": "command", "command": "bun \"$CLAUDE_PROJECT_DIR/hooks/{hookFile}\"", "timeout": {timeout} }`
  4. Verify the hook source file exists at `hooks/{hookFile}`. If it doesn't, report `status: partial` — the hook entry was added but the hook file is missing.

**Atomic write**: write to `settings.json.tmp`, then rename.

### Rule 10: Wiki bootstrapping — create wiki directory

**Trigger**: `.loom/wiki/` directory does not exist, or exists but has no `index.toon`.

**Migration (directory missing)**:
- Do NOT auto-generate wiki pages — that requires codebase analysis. Instead, create the directory structure and empty state files:

```
.loom/wiki/
  pages/          (empty directory)
  index.toon      (empty index per wiki-index.schema.md)
  log.toon        (empty log)
  execution-log.toon  (empty execution log)
```

- `index.toon` content:
  ```toon
  wikiVersion: 1
  pageCount: 0
  pages[N]{id,title,category,path,status,lastUpdated}:
  ```

- Report `status: scaffolded` with guidance:
  ```
  Wiki directory created with empty state files. Run `/loom-wiki ingest` to populate pages from codebase analysis.
  ```

**Migration (directory exists, index.toon missing)**:
- Create `index.toon` with the empty scaffold above.
- Scan `pages/` for any existing `.md` files and add them to the index.

### Rule 11: Protocol files — copy missing protocols

**Trigger**: `agents/protocols/` directory is missing, or lacks required protocol files.

**Migration (directory missing)**:
- Create `agents/protocols/`.
- Copy all required protocol files from the Loom source (the repo where `/loom-upgrade` is defined).

**Migration (directory exists, files missing)**:
- For each missing protocol file, copy it from the Loom source.
- Required protocol files (minimum set for current Loom version):

```toon
requiredProtocols[N]{file,purpose}:
  agent-result.schema.md,AgentResult envelope format
  execution-conventions.md,shared execution rules
  behavioral-guidelines.md,agent behavioral guardrails
  scope-contract.schema.md,pre-execution scope contract
  plan.schema.md,PLAN.md format spec
  roadmap.schema.md,ROADMAP.md format spec
  convergence-tier.schema.md,convergence tier definitions
  schema-upgrade.md,this file — migration rules
  context-budget.md,context budget spec
  stage-context.schema.md,stage summary format
  toon-format.md,TOON format reference
  orchestration-config.schema.md,orchestration.toml spec
  wiki-conventions.md,wiki structure and rules
  wiki-index.schema.md,wiki index format
  wiki-page.schema.md,wiki page format
```

- Files are copied, not generated. The source is the Loom installation directory (`~/.claude/agents/protocols/` or the repo's `agents/protocols/`).
- If the source file cannot be found, report `status: failed` with `details: "Source protocol file not found: {file}"`.
- Existing protocol files are NEVER overwritten — only missing files are added. To update existing protocols to newer versions, use `/loom-library sync`.

---

## Automatic Detection Protocol

When any agent reads a Loom artifact, it MUST apply the detection logic above. If the artifact is outdated:

1. **Emit a stderr warning** in this exact format:
   ```
   [loom:schema-upgrade] Old format detected in {filePath}. Run `/loom-upgrade` to migrate.
   ```
2. **Continue reading** — do NOT block, abort, or refuse to process the file. Apply best-effort defaults in memory so the agent can proceed.
3. **Do NOT mutate the file** — agents never write migration changes. Only `/loom-upgrade` does that.
4. **Log the detection** — if a progress heartbeat is active, include a note in the heartbeat:
   ```toon
   warnings[N]: Old format detected in criteria-plan.toon (missing testTier)
   ```

This ensures the user is informed without disrupting agent execution.

## Explicit Migration Protocol

The `/loom-upgrade` command performs the full migration pass.

### Execution Steps

1. **Scan** — walk the project for known artifact patterns:

   Execution artifact targets (always scanned):
   ```toon
   scanTargets[N]{pattern,schema}:
     criteria-plan.toon,criteria-plan
     .plan-execution/**/*.agent-result.toon,agent-result
     PLAN.md,plan
     .plan-execution/state.toon,state
   ```

   Project infrastructure targets (scanned when `--project` is passed):
   ```toon
   projectScanTargets[N]{pattern,schema}:
     .claude/orchestration.toml,orchestration-config
     ROADMAP.md,roadmap
     CLAUDE.md,claude-md
     .claude/settings.json,hooks
     .loom/wiki/,wiki
     agents/protocols/,protocols
   ```

2. **Detect** — run version detection on each found file. Collect a list of files needing migration.

3. **Backup** — create a timestamped backup directory and copy all files that will be modified:
   ```
   .plan-execution/backups/{ISO-timestamp}/
   ```

4. **Migrate** — apply migration rules in-place. Each file is written atomically (write to `.tmp`, then `fs.renameSync`).

5. **Validate** — re-run detection on every migrated file. If any file still reports outdated, the migration for that file failed.

6. **Report** — print a summary to stdout:
   ```toon
   upgradeReport:
     timestamp: 2026-04-19T14:30:00Z
     scope: project
     filesScanned: 18
     filesMigrated: 4
     filesAgentMigrated: 2
     filesScaffolded: 1
     filesManualRequired: 1
     filesSkipped: 10
     backupDir: .plan-execution/backups/2026-04-19T14-30-00Z
     results[N]{file,schema,status,details}:
       criteria-plan.toon,criteria-plan,migrated,added testTier column with default unit
       .plan-execution/wave-0/task-001.agent-result.toon,agent-result,migrated,added verificationStatus and diagnoseLog
       PLAN.md,plan,agent-migrated,Tier A+B patches + structural migration via plan-upgrade-agent
       .plan-execution/state.toon,state,migrated,added schemaVersion: 1
       .claude/orchestration.toml,orchestration-config,migrated,added contextBudget + wiki + domain sections
       ROADMAP.md,roadmap,agent-migrated,Tier A+B patches + structural migration via roadmap-upgrade-agent
       .claude/settings.json,hooks,migrated,added contract-lock + file-ownership + budget-tracker hooks
       .loom/wiki/,wiki,scaffolded,empty structure created; run /loom-wiki ingest
       CLAUDE.md,claude-md,manual-required,run /loom-init
   ```

   Status values: `migrated` (auto, fully done), `agent-migrated` (structural migration via upgrade agent), `scaffolded` (empty structure created), `manual-required` (needs user action), `failed` (migration error), `skipped` (up to date or unparseable).

## Agent-Driven Migration Design

Rules 3 (plan) and 7 (roadmap) use inline agent spawns for structural migration — no separate follow-up commands needed. The principle: **upgrade always migrates from current state to latest schema**, regardless of how old the artifact is. There are no version-specific flags.

### Migration agents

| Agent | Spawned by | Input | Output |
|-------|-----------|-------|--------|
| `plan-upgrade-agent` | Rule 3 Tier C | Existing PLAN.md + `plan.schema.md` + ROADMAP.md (if present) | Restructured PLAN.md conforming to current schema |
| `roadmap-upgrade-agent` | Rule 7 Tier C | Existing ROADMAP.md + `roadmap.schema.md` | Restructured ROADMAP.md conforming to current schema |

### Ordering

When both artifacts need migration, roadmap runs first (plan depends on roadmap for cross-refs).

### Confirmation

Each agent migration pauses for user confirmation before writing (unless `--force`). Options:
- **Accept** — write the migrated file
- **Skip** — keep Tier A+B patches only, skip structural migration
- **Abort** — stop the entire upgrade

### Fallback

If the user skips agent migration or the agent fails, the Tier A+B patches remain applied. The upgrade report includes guidance:
- `/loom-plan create` — re-create from approved roadmap
- `/loom-roadmap init` — re-create interactively

These are not version-specific commands — they always produce output matching the current schema.

## Backup Protocol

### Directory Structure

```
.plan-execution/backups/
  2026-04-19T14-30-00Z/
    criteria-plan.toon
    PLAN.md
    state.toon
    wave-0/
      task-001.agent-result.toon
```

The backup directory mirrors the relative paths of the original files so restore is unambiguous.

### Restore Instructions

To restore from backup, copy files back from the backup directory:

```bash
# Restore all files from a specific backup
cp -r .plan-execution/backups/2026-04-19T14-30-00Z/* .

# Restore a single file
cp .plan-execution/backups/2026-04-19T14-30-00Z/criteria-plan.toon ./criteria-plan.toon
```

### Retention

Backup directories are never automatically deleted. The user is responsible for cleanup. The `/loom-upgrade` command prints the backup path so the user can verify and remove old backups at their discretion.

## Error Handling

### SCHEMA_VERSION_MISMATCH

When detection finds an outdated artifact, agents MAY attach the error code `SCHEMA_VERSION_MISMATCH` to their internal diagnostics. This code is used for:

- Filtering warnings in agent output
- Triggering upgrade suggestions in `/loom-status`
- Tracking migration debt across the project

```toon
error:
  code: SCHEMA_VERSION_MISMATCH
  file: criteria-plan.toon
  schema: criteria-plan
  expected: 1
  detected: 0
  message: "Missing testTier column in criteria array. Run `/loom-upgrade` to migrate."
  severity: warning
  action: continue
```

### Migration Failure

If a migration rule fails (parse error, unexpected format, write failure):

1. The original file is left untouched (the `.tmp` file is deleted).
2. The backup copy is retained.
3. The failure is reported in the upgrade report with `status: failed` and a `details` field describing the error.
4. Other files continue migrating — one failure does not abort the batch.

### Unknown Format

If a file matches a scan pattern but cannot be parsed at all (not valid TOON, corrupted), it is logged as `status: skipped` with `details: "Unparseable file"` and left untouched.

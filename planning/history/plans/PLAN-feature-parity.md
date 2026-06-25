# Feature Parity Plan — Loom v2.1

## Overview

Four features identified from competitive analysis against GSD, Compound Engineering, and Anthropic's official plugins. All are independent, low-risk additions that fill gaps without changing existing architecture.

## Phase 1: Session Pause/Resume

**Goal:** Allow users to pause mid-workflow and resume in a new conversation with full context restoration.

### Deliverables

1. **`/loom-pause` command** (`commands/loom-pause.md`)
   - Reads current workflow state from `.plan-execution/` (status.toon, state.toon, pipeline-state.toon, notes.toon)
   - Snapshots: current command, step, wave, pending decisions, blockers, recent agent results
   - Writes `.plan-execution/continue-here.toon`:
     ```toon
     pausedAt: {ISO timestamp}
     command: {running command, e.g. execute-plan}
     phase: {current step, e.g. wave-2-wiring}
     planPath: PLAN.md
     resumeStep: {exact step to resume from}
     pendingDecisions[N]: {any unanswered prompts}
     completedWork[N]{wave,status,filesChanged}:
       0,complete,12
       1,complete,8
     nextAction: {what was about to happen}
     context: {compressed rolling-context.md snapshot}
     gitRef: {current HEAD sha}
     ```
   - Creates git commit: "WIP: paused at {phase}"
   - Prints resume instructions

2. **`/loom-resume` command** (`commands/loom-resume.md`)
   - Reads `.plan-execution/continue-here.toon`
   - If not found: scans for incomplete state (state.toon with in_progress waves, pipeline-state.toon with active stages) and offers to resume from detected position
   - Validates git state: compares HEAD with `gitRef`, warns on drift
   - Restores context: loads rolling-context.md, state.toon, relevant wave summaries
   - Dispatches to the paused command at the correct step (e.g. `/loom-execute-plan --resume` already exists — wire into it)
   - Deletes `continue-here.toon` after successful resume

3. **Integration with existing `--resume` flags**
   - `/loom-execute-plan --resume` already reads state.toon — `/loom-resume` becomes the universal entry point that detects which command to resume and delegates
   - `/loom-auto` has pipeline-state.toon — same pattern

### Acceptance Criteria
- User can `/loom-pause` during any long-running command, close the session, and `/loom-resume` in a new session
- Resume loads enough context that the workflow continues without re-reading everything from scratch
- Git drift detection warns but doesn't block (user may have made manual changes)
- Works with: execute-plan, auto, converge, create-plan

---

## Phase 2: Smart Routing (`/loom-do`)

**Goal:** Natural language dispatch to the right Loom command.

### Deliverables

1. **`/loom-do` command** (`commands/loom-do.md`)
   - Takes freeform text: `/loom-do fix the auth bug` or `/loom-do review my code`
   - Reads the library catalog (`~/.claude/skills/library/library.yaml`) to get all available commands with descriptions
   - Reads project state: checks for ROADMAP.md, PLAN.md, `.plan-execution/state.toon`, `.loom/wiki/` to understand context
   - Pattern matching + LLM reasoning to select the best command:
     - "fix" / "bug" / "debug" → `/loom-fix-code` or debugging workflow
     - "review" / "check" → `/loom-review-code` or `/loom-review-plan`
     - "plan" / "create plan" → `/loom-create-plan`
     - "build" / "execute" / "implement" → `/loom-execute-plan`
     - "test" → `/loom-test-plan`
     - "note" / "remember" / "idea" → `/loom-note`
     - "status" / "progress" → `/loom-roadmap --status`
     - "what's next" / "next step" → smart next-action detection (check state.toon, roadmap progress, pending reviews)
   - Presents the match with confidence: "Routing to `/loom-review-code` — is that right? (yes / pick another)"
   - On confirmation, invokes the Skill tool with the matched command
   - If ambiguous, shows top 2-3 matches with reasoning

2. **`/loom-next` command** (`commands/loom-next.md`)
   - No arguments needed
   - Reads project state to determine the logical next step:
     - No ROADMAP.md → suggest `/loom-roadmap --init`
     - ROADMAP.md exists, not approved → suggest `/loom-review-roadmap` or `/loom-roadmap --approve-roadmap`
     - Approved roadmap, no PLAN.md → suggest `/loom-create-plan`
     - PLAN.md exists, no review → suggest `/loom-review-plan`
     - Plan reviewed, not executed → suggest `/loom-execute-plan`
     - Execution in progress (state.toon) → suggest `/loom-resume` or next wave
     - Execution complete, no tests → suggest `/loom-test-plan`
     - Tests done, no review → suggest `/loom-review-code`
     - Review done with findings → suggest `/loom-fix-code`
     - All clean → suggest `/loom-roadmap --status`
   - Presents the suggestion with context and executes on confirmation

### Acceptance Criteria
- `/loom-do "natural language"` routes correctly for common intents (plan, build, review, fix, test, note, status)
- `/loom-next` detects project state and suggests the right step
- Ambiguous input shows options rather than guessing wrong
- Both commands work with no project state (suggests `/loom-init` or `/loom-roadmap --init`)

---

## Phase 3: Model Cost Profiles

**Goal:** System-wide model allocation so users control cost/quality tradeoffs per agent tier.

### Deliverables

1. **Profile schema in `orchestration.toml`**
   ```toml
   [settings]
   modelProfile = "balanced"  # quality | balanced | budget

   [settings.profiles.quality]
   planning = "opus"       # roadmap-builder, plan-builder, questioner
   execution = "opus"      # contracts, implementer, wiring
   review = "opus"         # all reviewers
   verification = "sonnet" # verification-agent
   utility = "sonnet"      # meta-agent, wiki agents, fixer

   [settings.profiles.balanced]
   planning = "opus"
   execution = "sonnet"
   review = "sonnet"
   verification = "sonnet"
   utility = "haiku"

   [settings.profiles.budget]
   planning = "sonnet"
   execution = "sonnet"
   review = "haiku"
   verification = "haiku"
   utility = "haiku"
   ```

2. **Schema update** (`protocols/orchestration-config.schema.md`)
   - Add `modelProfile` field and profile definitions to the schema
   - Document the agent tier classification (planning, execution, review, verification, utility)

3. **Orchestrator passthrough**
   - Update commands that spawn agents (`loom-execute-plan`, `loom-review-plan`, `loom-review-code`, `loom-auto`, `loom-create-plan`, `loom-roadmap`) to:
     1. Read `orchestration.toml` for `modelProfile`
     2. Resolve the agent's tier → model mapping
     3. Pass `model` parameter to Agent tool calls
   - If no `orchestration.toml` or no `modelProfile`: default behavior (inherit parent model)

4. **`/loom-profile` command** (or extend `/loom` with `--profile`)
   - Show current profile and estimated cost tier
   - Switch profiles: `/loom-profile balanced`
   - Writes to `orchestration.toml`

### Acceptance Criteria
- Setting `modelProfile = "budget"` in orchestration.toml causes review agents to use haiku
- Profiles are overridable per-agent in orchestration.toml (existing `model` field takes precedence)
- Default behavior unchanged when no profile is set
- Profile switch takes effect on next command invocation (no restart needed)

---

## Phase 4: Backlog Management

**Goal:** Extend `/loom-note` with a `backlog` tag and `/loom-note --backlog` view for tracking future feature ideas separately from active notes.

### Deliverables

1. **Extend `/loom-note`** (`commands/loom-note.md`)
   - Add `backlog` to the tag list
   - Add `--backlog` flag: shows only backlog-tagged notes, sorted by priority
   - Add `--promote <id>` subcommand: moves a backlog item to a new roadmap phase via `/loom-roadmap --add-feature` or appends to ROADMAP.md feature list
   - Auto-detect: "backlog", "later", "someday", "future", "v2", "v3" → `backlog` tag

2. **Backlog view format:**
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

3. **Integration with `/loom-roadmap --status`**
   - When showing status, append a line: `Backlog: {N} items ({H} high, {M} medium, {L} low)`
   - Does not display full backlog — just the count as a reminder

### Acceptance Criteria
- `/loom-note --tag backlog "debugging agent"` adds to backlog
- `/loom-note --backlog` shows only backlog items grouped by priority
- `/loom-note --promote <id>` moves item to ROADMAP.md
- Backlog count appears in `/loom-roadmap --status` output
- Existing note behavior unchanged

---

## Execution Order

Phases are independent — can execute in any order. Recommended sequence by value:

1. **Session pause/resume** — highest daily impact
2. **Smart routing** — reduces friction for all users
3. **Backlog management** — small change, enables structured feature tracking
4. **Model cost profiles** — requires testing across model tiers

## Files Changed

| Phase | New files | Modified files |
|-------|-----------|----------------|
| 1 | `commands/loom-pause.md`, `commands/loom-resume.md` | `skills/library.yaml` |
| 2 | `commands/loom-do.md`, `commands/loom-next.md` | `skills/library.yaml` |
| 3 | `commands/loom-profile.md` | `protocols/orchestration-config.schema.md`, `commands/loom-execute-plan.md`, `commands/loom-review-plan.md`, `commands/loom-review-code.md`, `commands/loom-auto.md`, `commands/loom-create-plan.md`, `commands/loom-roadmap.md`, `skills/library.yaml` |
| 4 | None | `commands/loom-note.md`, `commands/loom-roadmap.md` |

## Backlog (future phases, not in this plan)

- **Debugging agent** — dedicated `/loom-debug` command with scientific-method agent, checkpoint state, subagent isolation. References behavioral-guidelines.md as protocol.
- **Developer profiling** — `/loom-profile-user` analyzing interaction patterns, writing preferences that agents read for style adaptation.
- **UI-specific workflows** — UI-SPEC generation, design system detection, frontend implementation agents, 6-pillar visual audit. Multiple new agents and protocols.

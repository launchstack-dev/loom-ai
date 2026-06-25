---
planVersion: 1
name: "Loom Quick Command"
status: draft
created: 2026-04-09
lastReviewed: null
roadmapRef: null
totalPhases: 5
totalWaves: 3
---

# Plan: Loom Quick Command

## Overview

Add a `/loom-quick` command to loom-ai that provides zero-ceremony task execution in three modes: standalone (no plan context), plan-aware (PLAN.md exists but not executing), and mid-execution injection (plan actively running). The command accepts a single natural-language string, auto-detects the appropriate mode, executes the task with verification, and logs results to `.plan-history/quick-tasks/`.

## Tech Stack

- Markdown: Claude Code command file format (`commands/loom-quick.md`)
- TOON: Quick-task log format, mode detection state, plan injection records
- Shell: `git`, verification commands executed via Bash tool
- YAML: `skills/library.yaml` catalog registration

## Schema / Type Definitions

### QuickTaskLog

| Field | Type | Constraints |
|-------|------|-------------|
| taskId | string | ISO-date + slug, e.g. `2026-04-09-add-rate-limiting` |
| description | string | Original natural-language input from $ARGUMENTS |
| mode | enum("standalone", "plan-aware", "injection") | Auto-detected or flag-forced |
| startedAt | ISO-8601 datetime | When execution began |
| completedAt | ISO-8601 datetime | When execution finished |
| filesChanged | string[] | Paths of files created or modified |
| verificationResult | enum("pass", "fail", "skipped") | Result of post-execution verification |
| verificationOutput | string | Stdout/stderr from verification commands |
| commitHash | string or null | Git commit SHA if committed; null if skipped |
| planContext | string or null | Path to PLAN.md if plan-aware or injection mode; null for standalone |
| injectedPhase | integer or null | Phase number if appended to plan; null otherwise |
| injectedWave | integer or null | Wave number if injected into execution; null otherwise |

### ModeDetectionResult

| Field | Type | Constraints |
|-------|------|-------------|
| planExists | boolean | True if PLAN.md exists in project root |
| executionRunning | boolean | True if `.plan-execution/state.toon` exists with status=running |
| detectedMode | enum("standalone", "plan-aware", "injection") | Auto-detected from above signals |
| forcedMode | enum("standalone", "plan-aware", "injection") or null | Non-null if --append or --inject flag was used |
| effectiveMode | enum("standalone", "plan-aware", "injection") | forcedMode if set, else detectedMode |

### PlanInjection

| Field | Type | Constraints |
|-------|------|-------------|
| taskDescription | string | Natural-language task from user |
| targetWave | integer | Wave to inject into (current or next) |
| phaseNumber | integer | Auto-assigned next available phase number |
| fileOwnership | string[] | Auto-detected from task description and codebase analysis |
| acceptanceCriteria | string[] | Auto-generated testable criteria |
| ownershipConflict | boolean | True if detected files overlap with in-progress agents |
| conflictResolution | enum("queued-next-wave", "no-conflict") | How conflict was resolved |

## Execution Phases

### Phase 0 — Wave 0: Contracts

**Agent:** contracts-agent
**Objective:** Define the quick-task TOON log format, mode detection logic, plan-injection schema, and the verification reuse protocol that the command file references.
**Dependencies:** None
**File Ownership:** protocols/quick-task-contract.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/quick-task-contract.md | Create | contracts |

#### Acceptance Criteria
- [ ] Contract defines the QuickTaskLog TOON format with all fields from the schema section, using TOON syntax (not JSON)
- [ ] Contract defines the mode detection algorithm: check PLAN.md existence, check `.plan-execution/state.toon` existence and status field, derive mode
- [ ] Contract defines flag override behavior: `--append` forces plan-aware mode, `--inject` forces injection mode, flags error if preconditions not met (e.g. --inject without running execution)
- [ ] Contract defines the plan-injection protocol: read current state.toon, find next available phase number, detect file ownership conflicts against in-progress tasks, inject or queue
- [ ] Contract defines the verification reuse protocol: if PLAN.md exists, extract verification commands from its `## Verification Commands` section; otherwise fall back to auto-detection (look for `package.json` scripts, `tsconfig.json`, `Makefile`, etc.)
- [ ] Contract defines the log file naming convention: `.plan-history/quick-tasks/{YYYY-MM-DD}-{slug}.toon` where slug is derived from the first 5 words of the description, lowercased, hyphenated
- [ ] File is valid markdown with clear section headers for each protocol

### Phase 1 — Wave 1: Core Command File

**Agent:** implementer-agent
**Objective:** Create `commands/loom-quick.md` implementing all three modes (standalone, plan-aware, injection) with zero-ceremony input, verification, logging, and commit offer.
**Dependencies:** Phase 0
**File Ownership:** commands/loom-quick.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-quick.md | Create | implementer-1 |

#### Acceptance Criteria
- [ ] File begins with a title and description matching Claude Code command file conventions (reference `commands/loom-git.md` for format)
- [ ] File accepts `$ARGUMENTS` as a single natural-language task description string
- [ ] File shows usage help when `$ARGUMENTS` is empty or equals `--help`
- [ ] **Mode detection**: reads PLAN.md and `.plan-execution/state.toon` to auto-detect mode per the contract
- [ ] **Standalone mode**: reads CLAUDE.md and relevant source files, executes the described task, runs verification, logs result to `.plan-history/quick-tasks/`, offers `/loom-git commit`
- [ ] **Plan-aware mode**: detects PLAN.md, offers user choice between "execute independently" and "append as new phase to PLAN.md"
- [ ] **Plan-aware append**: when user chooses append, creates a new phase in PLAN.md with auto-generated file ownership, acceptance criteria, and `Dependencies:` set to the last existing phase number
- [ ] **Plan-aware independent**: when user chooses independent, runs standalone mode but includes `planContext` in the log
- [ ] **Injection mode**: reads `.plan-execution/state.toon`, checks file ownership of in-progress tasks for conflicts, injects task into current wave if no conflict or queues for next wave if conflict exists, updates state.toon
- [ ] **Verification**: after task execution, runs verification commands — reuses PLAN.md verification commands if available, otherwise auto-detects from project config files (`package.json` test/typecheck scripts, `tsconfig.json`, `Makefile`)
- [ ] **Logging**: writes a TOON log file to `.plan-history/quick-tasks/{YYYY-MM-DD}-{slug}.toon` with all QuickTaskLog fields
- [ ] **Commit offer**: after successful execution, offers to run `/loom-git commit` unless `--no-commit` flag is present
- [ ] **Flag handling**: supports `--no-verify` (skip verification), `--no-commit` (skip commit offer), `--append` (force plan-aware append), `--inject` (force injection mode)
- [ ] Flags are parsed from `$ARGUMENTS` before the task description — flags start with `--`, everything else is the task description
- [ ] Creates `.plan-history/quick-tasks/` directory if it does not exist before writing the log file

### Phase 2 — Wave 1: Wiring and Registration

**Agent:** wiring-agent
**Objective:** Register `loom-quick` in the library catalog, add it to the `loom.md` reference, and register the contract as a skill.
**Dependencies:** Phase 0
**File Ownership:** skills/library.yaml, commands/loom.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/library.yaml | Modify | wiring |
| commands/loom.md | Modify | wiring |

#### Acceptance Criteria
- [ ] `library.yaml` registers `loom-quick` under `prompts` with name, description, source `commands/loom-quick.md`, and `requires: [skill:quick-task-contract]`
- [ ] `library.yaml` registers `quick-task-contract` under `skills` with source `protocols/quick-task-contract.md`
- [ ] `commands/loom.md` adds `/loom-quick` and its flag variants to the Commands table with descriptions
- [ ] `commands/loom.md` adds `/loom-quick "description"` to the Typical Workflow section as a quick-task alternative to the full pipeline
- [ ] `python3 -c "import yaml; yaml.safe_load(open('skills/library.yaml'))"` exits with code 0 (valid YAML)
- [ ] No duplicate entries in `library.yaml` — `loom-quick` appears exactly once under `prompts`

### Phase 3 — Wave 2: Quick-Task Routing Skill

**Agent:** implementer-agent
**Objective:** Create a routing skill so natural-language requests like "quickly fix this", "just do X", or "quick task: Y" automatically trigger `/loom-quick`.
**Dependencies:** Phase 1, Phase 2
**File Ownership:** skills/loom-quick-routing.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/loom-quick-routing.md | Create | implementer-2 |

#### Acceptance Criteria
- [ ] Skill file defines trigger patterns: "quickly", "just do", "quick task", "quick fix", "real quick", "do this quickly", "fast task", "one-off task"
- [ ] Skill maps each trigger to `/loom-quick` invocation, passing the remaining user text as the task description argument
- [ ] Skill includes a description field: "Use when the user asks for a quick, one-off task execution without full plan ceremony"
- [ ] Skill does NOT intercept requests that explicitly mention `/loom-execute-plan`, `/loom-auto`, or other pipeline commands
- [ ] Skill does NOT intercept requests that are clearly asking about speed/performance (e.g. "how quickly does this run") — only requests that are delegating a task
- [ ] Skill file follows the existing skills format in the project (reference `skills/loom-git-routing.md` for structure)

### Phase 4 — Wave 2: Routing Skill Registration

**Agent:** wiring-agent
**Objective:** Register the quick-task routing skill in library.yaml so it is discoverable and installable.
**Dependencies:** Phase 2, Phase 3
**File Ownership:** skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| skills/library.yaml | Modify | wiring |

#### Acceptance Criteria
- [ ] `library.yaml` registers `loom-quick-routing` under `skills` with name, description, and source `skills/loom-quick-routing.md`
- [ ] `python3 -c "import yaml; yaml.safe_load(open('skills/library.yaml'))"` exits with code 0 (valid YAML)
- [ ] No duplicate skill entries — `loom-quick-routing` appears exactly once under `skills`
- [ ] The `loom-quick` prompt entry's `requires` list includes `skill:loom-quick-routing` (or it is listed as an optional dependency)

## Verification Commands

```bash
# Command file exists
test -f commands/loom-quick.md && echo "OK: command file exists" || echo "FAIL: missing"

# Contract file exists
test -f protocols/quick-task-contract.md && echo "OK: contract exists" || echo "FAIL: missing"

# Routing skill exists
test -f skills/loom-quick-routing.md && echo "OK: routing skill exists" || echo "FAIL: missing"

# Library catalog is valid YAML
python3 -c "import yaml; yaml.safe_load(open('skills/library.yaml'))" && echo "OK: valid YAML" || echo "FAIL: invalid YAML"

# loom-quick registered in library
grep -q "name: loom-quick" skills/library.yaml && echo "OK: command registered" || echo "FAIL: not registered"

# quick-task-contract registered in library
grep -q "name: quick-task-contract" skills/library.yaml && echo "OK: contract registered" || echo "FAIL: not registered"

# loom-quick-routing registered in library
grep -q "name: loom-quick-routing" skills/library.yaml && echo "OK: routing skill registered" || echo "FAIL: not registered"

# loom-quick referenced in loom.md
grep -q "loom-quick" commands/loom.md && echo "OK: referenced in help" || echo "FAIL: not referenced"

# All 3 modes mentioned in command file
for mode in standalone plan-aware injection; do
  grep -qi "$mode" commands/loom-quick.md && echo "OK: $mode mode found" || echo "FAIL: $mode mode missing"
done

# Flag support in command file
for flag in no-verify no-commit append inject; do
  grep -q "\-\-$flag" commands/loom-quick.md && echo "OK: --$flag found" || echo "FAIL: --$flag missing"
done

# Quick-tasks log directory convention referenced
grep -q "quick-tasks" commands/loom-quick.md && echo "OK: log directory referenced" || echo "FAIL: log directory not referenced"
```

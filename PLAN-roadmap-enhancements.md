# Plan: Roadmap Management & Multi-Persona Explore

## Overview

Add 5 subcommands to `/loom-roadmap`: `add`, `insert`, `remove`, `reorder`, and `explore`. The first four are lightweight roadmap manipulation. `explore` is a multi-persona interactive brainstorming session that surfaces requirements, constraints, and edge cases through simulated stakeholder perspectives before committing features to the roadmap.

## Phase 1: Roadmap Manipulation Subcommands

**Goal:** Quick structural changes to ROADMAP.md without regenerating.

### Subcommand: `add`

```
/loom-roadmap add "user management with RBAC"
/loom-roadmap add "real-time notifications" --priority high --milestone v2
```

Instructions:
1. Read ROADMAP.md. If not found, suggest `/loom-roadmap init`.
2. Parse the feature description from args.
3. Determine placement:
   - Default: append to the current milestone's feature list
   - `--milestone <name>`: append to a specific milestone
   - `--priority high`: place at top of the feature list
   - `--after <feature-name>`: place after a specific existing feature
4. If ROADMAP.md has phases, also create a new phase entry:
   - Auto-number: next sequential integer after the last phase
   - Generate a slug from the description (e.g., "user-management-rbac")
   - Set dependencies to `[]` (user can refine later)
   - Set status to `planned`
5. Write updated ROADMAP.md
6. Append to changelog: `## {date} — Feature added: {description}`
7. Display: the new feature entry and phase, with suggestion to run `/loom-roadmap review` or `/loom-plan create`

### Subcommand: `insert`

```
/loom-roadmap insert 3 "urgent auth fix"
/loom-roadmap insert 3 "auth fix" --reason "security vulnerability discovered"
```

Instructions:
1. Read ROADMAP.md.
2. Parse: position (integer), description, optional `--reason`.
3. Create a decimal phase (e.g., 3.1) that slots between phase 3 and phase 4:
   - If 3.1 already exists, use 3.2, etc.
   - Copy the dependency list from the phase it follows (phase 3) as a starting point
4. Add the phase to ROADMAP.md in the correct position
5. Add the feature to the feature list
6. Append to changelog with reason if provided
7. Display the inserted phase with a note: "This phase will execute after Phase 3 and before Phase 4. Run `/loom-roadmap deps` to verify the dependency graph."

### Subcommand: `remove`

```
/loom-roadmap remove 5
/loom-roadmap remove "user-management"    (by slug)
```

Instructions:
1. Read ROADMAP.md.
2. Find the phase by number or slug.
3. Check dependencies: scan all other phases for `dependencies: [... N ...]` references to this phase.
4. If dependents exist, warn:
   ```
   Phase 5 (user-management) is depended on by:
     - Phase 7 (admin-dashboard)
     - Phase 8 (audit-logging)

   Remove anyway? Dependents will have this dependency dropped. (yes / no)
   ```
5. If confirmed:
   - Remove the phase from ROADMAP.md
   - Remove the feature from the feature list
   - Update dependent phases: remove the deleted phase from their dependency lists
   - Do NOT renumber remaining phases (preserves references in notes, wiki, etc.)
   - Append to changelog
6. Display what was removed and what dependents were updated

### Subcommand: `reorder`

```
/loom-roadmap reorder              (interactive)
/loom-roadmap reorder 5 --after 2  (move phase 5 to after phase 2)
```

Instructions:
1. Read ROADMAP.md. Extract all phases with their dependencies.
2. If `--after` specified: move the phase and validate no circular dependencies result.
3. If no args (interactive mode):
   a. Display current phase order with dependencies
   b. Ask: "Which phase do you want to move, and where?"
   c. After each move, run cycle detection (Kahn's algorithm from the existing `deps` subcommand)
   d. If the move creates a cycle, reject it and explain why
   e. Allow multiple moves before confirming
4. Write updated ROADMAP.md with new phase order
5. Append to changelog
6. Suggest: "Run `/loom-roadmap deps` to see the updated dependency graph."

---

## Phase 2: Multi-Persona Explore

**Goal:** Interactive brainstorming that simulates multiple stakeholder perspectives to deeply explore a feature idea before it enters the roadmap.

### Subcommand: `explore`

```
/loom-roadmap explore "real-time collaboration"
/loom-roadmap explore "should we add AI-powered search?"
/loom-roadmap explore "real-time collab" --personas engineer,designer,pm
/loom-roadmap explore "migration to microservices" --depth deep
```

#### Arguments

- `"topic"` (required): the feature, question, or idea to explore
- `--personas <list>`: comma-separated persona names (default: auto-select based on topic)
- `--depth quick|standard|deep`: exploration depth (default: standard)
  - `quick`: 1 round, 3 personas, ~2 min
  - `standard`: 2 rounds, 4-5 personas, ~5 min
  - `deep`: 3 rounds, 5-6 personas, ~10 min
- `--add`: after exploration, automatically add the explored feature to the roadmap
- `--debate`: after exploration, trigger a `/loom debate` on the key decision point surfaced

#### Protocols

Read before starting:
- `~/.claude/agents/protocols/orchestration-patterns.md` — for multi-agent patterns
- `CLAUDE.md` and `CONTEXT.md` if they exist — for project context
- `ROADMAP.md` if it exists — for existing features and constraints

#### Persona Library

Auto-select personas based on topic keywords. Each persona has a distinct perspective and question style:

| Persona | Perspective | Asks about |
|---------|------------|------------|
| **engineer** | Technical feasibility | Architecture impact, tech debt, implementation complexity, performance implications, existing code reuse |
| **designer** | User experience | User flows, edge cases in UI, accessibility, information architecture, interaction patterns |
| **pm** | Product strategy | User value, prioritization, market fit, scope creep risk, success metrics, MVP vs full version |
| **security** | Security & compliance | Auth implications, data exposure, OWASP risks, compliance requirements, audit trail needs |
| **ops** | Operations & reliability | Deployment impact, monitoring needs, scaling concerns, rollback strategy, on-call implications |
| **user** | End-user perspective | Confusion points, workflow disruption, learning curve, what they'd actually use vs what sounds cool |
| **skeptic** | Devil's advocate | Why NOT do this, hidden costs, opportunity cost, simpler alternatives, what could go wrong |
| **data** | Data & analytics | Data model impact, migration needs, reporting requirements, data privacy, tracking needs |

Default selection:
- `quick`: engineer, pm, user
- `standard`: engineer, designer, pm, skeptic
- `deep`: engineer, designer, pm, security, ops, skeptic

#### Instructions

##### Step 0: Gather Context

1. Read ROADMAP.md (existing features, milestones, constraints)
2. Read CLAUDE.md (tech stack, conventions)
3. Read PLAN.md if it exists (current execution state)
4. Scan codebase: `ls src/` or project root for structure context

##### Step 1: Frame the Exploration

Present the topic and selected personas:

```
## Exploring: {topic}

Personas: {icon} Engineer, {icon} Designer, {icon} PM, {icon} Skeptic

Context loaded: {ROADMAP.md (N features), CLAUDE.md (tech stack), codebase (N files)}

Starting Round 1...
```

##### Step 2: Round N — Persona Perspectives

For each round, spawn ALL personas in parallel using the Agent tool. Each persona agent is `general-purpose` with a role prompt:

```
You are a {persona} evaluating this feature idea for a software project.

Project context:
{tech stack, existing features, constraints from ROADMAP.md}

Feature being explored:
{topic}

{If round > 1: Previous round insights:
{compressed summary of prior round outputs}}

From your {persona} perspective, address:
1. What excites you about this? (1-2 sentences)
2. What concerns you? (1-2 sentences)
3. What question would you ask before committing? (1 specific question)
4. What's the one thing the team might overlook? (1 sentence)

Be specific to THIS project, not generic. Reference existing features/code where relevant.
Keep total response under 200 words.
```

After collecting all persona responses, synthesize and present:

```
### Round {N}

**{icon} Engineer ({name}):**
> {excitement} — {concern}
> Question: {question}
> Blind spot: {overlooked thing}

**{icon} Designer:**
> ...

**{icon} PM:**
> ...

**{icon} Skeptic:**
> ...

### Emerging Themes
- {theme 1 — surfaced by multiple personas}
- {theme 2}

### Open Questions
1. {most important unresolved question}
2. {second question}
```

##### Step 3: Between Rounds (standard and deep only)

After presenting Round N results, ask the user:

```
Round {N} complete. What would you like to do?

1. [continue]     Next round — personas respond to each other's insights
2. [focus]        Focus next round on a specific question or concern
3. [add persona]  Bring in another perspective (e.g., security, ops, data)
4. [decide]       End exploration and summarize
5. [debate]       Trigger a /loom debate on the key decision point
```

If user chooses `focus`, the next round's prompts include: "The team wants to focus on: {user's focus area}. Address this specifically from your perspective."

If user chooses `add persona`, add the new persona to the next round. Present updated persona list.

##### Step 4: Synthesis

After all rounds (or user chooses `decide`):

1. Compile all persona insights across rounds
2. Generate an exploration summary:

```
## Exploration Summary: {topic}

### Recommendation
{Should this be added to the roadmap? With what scope?}

### Key Insights
1. {insight from multiple personas}
2. {insight}
3. {insight}

### Requirements Surfaced
- {requirement 1 — from {persona}}
- {requirement 2 — from {persona}}
- {requirement 3}

### Risks & Mitigations
| Risk | Severity | Mitigation | Surfaced by |
|------|----------|------------|-------------|
| {risk} | {H/M/L} | {mitigation} | {persona} |

### Open Questions (unresolved)
1. {question — needs user/stakeholder input}
2. {question}

### Suggested Scope
- **MVP:** {minimal version that delivers value}
- **Full:** {complete vision}
- **Skip if:** {conditions under which this shouldn't be done}

### Personas Consulted
{list with round participation}
```

3. Save to `.plan-history/explorations/{date}-{slug}.toon`

##### Step 5: Optional Actions

If `--add` was specified, or user confirms: run `/loom-roadmap add "{topic}"` with the surfaced requirements included as acceptance criteria context.

If `--debate` was specified, or user chooses debate: run `/loom debate "{key decision point}"` using the exploration summary as context.

#### Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent:
- Event type: `exploration-complete`
- Event data: topic, key insights, requirements surfaced, risks, recommendation
- Wiki path: `.loom/wiki`

#### Error Handling

- **No topic provided:** Print usage with examples
- **Agent failure:** Continue with remaining personas. Note the gap in synthesis.
- **No ROADMAP.md:** Exploration still works — it just won't reference existing features. Note this in the output.
- **User aborts mid-round:** Save partial exploration to `.plan-history/explorations/` with `status: partial`

---

## Files Changed

| Phase | Modified files |
|-------|---------------|
| 1 | `commands/loom-roadmap.md` (add 4 subcommands + arg parsing) |
| 2 | `commands/loom-roadmap.md` (add explore subcommand) |

Also update:
- `skills/library.yaml` — update loom-roadmap description
- `README.md` — add explore to command table
- Copy updated files to `~/.claude/commands/`

## Execution Order

Phase 1 first (simpler, less risk), Phase 2 second (more complex, multi-agent). Both modify the same file so they're sequential.

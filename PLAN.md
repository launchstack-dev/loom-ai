---
planVersion: 1
name: "Strategy/UX Agent Split"
status: draft
created: 2026-04-07
lastReviewed: null
totalPhases: 4
totalWaves: 2
---

# Plan: Strategy/UX Agent Split

## Overview

Split the combined `strategy-ux-agent` into two independent lifecycle agents that each operate in both planning and review modes:

1. **strategy-agent** — strategic lens across the full lifecycle
   - Planning mode: positioning, differentiation, audience, feature prioritization
   - Review mode: strategic drift detection, sequencing critique, scope creep

2. **ux-agent** — user experience lens across the full lifecycle
   - Planning mode: user flows, screen inventory, state coverage, interaction patterns, a11y targets
   - Review mode: enforce planned UX, catch missing states, deviations from defined flows

Remove the old `strategy-ux-agent` and update all references.

## Tech Stack

- Agent definitions: Markdown with YAML frontmatter
- No runtime dependencies — pure agent/skill library

## Execution Phases

### Phase 0 — Wave 0: Create New Agents

**Objective:** Create strategy-agent.md and ux-agent.md with dual-mode (planning + review) capabilities.
**Dependencies:** None
**File Ownership:** agents/strategy-agent.md, agents/ux-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/strategy-agent.md | Create | implementer-1 |
| agents/ux-agent.md | Create | implementer-2 |

#### Acceptance Criteria
- [ ] strategy-agent.md has valid frontmatter with model: sonnet
- [ ] strategy-agent.md defines planning mode: positioning, differentiation, audience, feature prioritization, competitive landscape
- [ ] strategy-agent.md defines review mode: strategic drift, sequencing critique, scope creep, priority alignment
- [ ] strategy-agent.md detects its mode from input context (plan text = planning, git diff + plan = review)
- [ ] strategy-agent.md output uses TOON AgentResult envelope
- [ ] ux-agent.md has valid frontmatter with model: sonnet
- [ ] ux-agent.md defines planning mode: user flows, screen inventory, state coverage requirements, interaction patterns, a11y targets
- [ ] ux-agent.md defines review mode: enforce planned UX, missing states, deviations from defined flows, accessibility gaps
- [ ] ux-agent.md detects its mode from input context (plan text = planning, git diff + plan = review)
- [ ] ux-agent.md output uses TOON AgentResult envelope

### Phase 1 — Wave 1: Update References

**Objective:** Replace all references to strategy-ux-agent with the two new agents.
**Dependencies:** Phase 0
**File Ownership:** commands/*, skills/library.yaml

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-review-plan.md | Modify | wiring |
| commands/loom-review-roadmap.md | Modify | wiring |
| commands/loom.md | Modify | wiring |
| skills/library.yaml | Modify | wiring |
| agents/scope-feasibility-agent.md | Modify | wiring |

#### Acceptance Criteria
- [ ] loom-review-plan.md references strategy-agent AND ux-agent instead of strategy-ux-agent (now 6 agents)
- [ ] loom-review-roadmap.md references strategy-agent AND ux-agent instead of strategy-ux-agent (now 4 agents)
- [ ] loom.md Agent Groups updated with both new agents
- [ ] library.yaml registers strategy-agent and ux-agent, removes strategy-ux-agent
- [ ] library.yaml requires lists updated in loom-review-plan and loom-review-roadmap
- [ ] scope-feasibility-agent.md mentions strategy-agent and ux-agent instead of strategy-ux-agent

### Phase 2 — Wave 1: Delete Old Agent

**Objective:** Remove the combined strategy-ux-agent.
**Dependencies:** Phase 1
**File Ownership:** agents/strategy-ux-agent.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| agents/strategy-ux-agent.md | Delete | wiring |

#### Acceptance Criteria
- [ ] agents/strategy-ux-agent.md no longer exists
- [ ] No remaining references to strategy-ux-agent anywhere in the codebase

### Phase 3 — Verification

**Objective:** Confirm no stale references remain.
**Dependencies:** Phase 2

#### Acceptance Criteria
- [ ] `grep -r "strategy-ux-agent" .` returns zero matches (excluding .git/)
- [ ] Both new agent files have valid YAML frontmatter
- [ ] Agent count in library.yaml increased by net +1 (removed 1, added 2)

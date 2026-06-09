## Command: `split [path]`

1. Read the plan
2. Run validation (`--validate`) — if there are structural issues, report them first
3. Spawn `plan-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/plan-builder-agent.md` first."
   - Include the current plan
   - Instruction: "Identify natural boundaries (by domain, by layer, by milestone). Create sub-plans that reference shared contracts. Each sub-plan must be independently executable via /loom-plan execute."
4. Present the proposed split with rationale
5. On approval: write sub-plan files (`PLAN-{name}.md`), update roadmap.toon

---

## Command: `diff`

1. Find the most recent snapshot in `planning/history/snapshots/`
2. If no snapshots exist, check git history: `git log --oneline -1 -- PLAN.md`
3. Compare current `PLAN.md` against the snapshot
4. Show a structured diff (not raw text diff):
   - Added phases / removed phases
   - Changed deliverables (files added/removed per phase)
   - Changed acceptance criteria
   - Schema/type definition changes
   - Dependency changes

---

## Command: `history`

Read and display `planning/history/changelog.md`. Format each entry clearly with date, action, and details.

If `planning/history/changelog.md` doesn't exist, scan git log for plan file changes and reconstruct:
```bash
git log --oneline --follow -- PLAN.md
```

---

## Command: `milestone`

Manage milestones in `planning/history/roadmap.toon`.

### `milestone add "name"`
1. Ask: target phase, dependencies (other milestone names), description
2. Determine effort sizing from deliverable count:
   - S (Small): 1-3 deliverables, 1-2 criteria
   - M (Medium): 4-6 deliverables, 3-4 criteria
   - L (Large): 7-8 deliverables, 5-6 criteria
   - XL (Extra Large): multi-phase or >8 deliverables
3. Append to roadmap.toon
4. Append to changelog

### `milestone complete "name"`
1. Find the milestone in roadmap.toon
2. Mark as completed with current timestamp
3. Append to changelog
4. If milestone corresponds to a phase, verify the phase's wave is `succeeded` in state.toon

### `milestone list`
1. Read roadmap.toon
2. If milestones are empty but plan has phases, auto-derive:
   - One milestone per phase: "{Phase Name} Complete"
   - One terminal milestone: "Plan Complete"
   - Effort sizing from deliverable counts
3. Reconcile against execution state: completed waves → completed milestones
4. Display sorted by dependency order

---

## Command: `snapshot`

1. Copy `PLAN.md` to `planning/history/snapshots/YYYY-MM-DD-plan.md`
2. If `.plan-execution/state.toon` exists, save execution summary alongside
3. Append to changelog: "Snapshot saved: YYYY-MM-DD"

---

---

## Roadmap TOON Format

`planning/history/roadmap.toon`:

```toon
planFile: PLAN.md
planVersion: 1
lastUpdated: 2026-04-05
status: in_progress

milestones[4]{name,targetPhase,status,effort,dependencies,completedAt}:
  Contracts Ready,0,completed,S,,2026-04-04
  Data Layer Done,1,in_progress,M,Contracts Ready,
  API Routes Done,1,in_progress,M,Contracts Ready,
  Plan Complete,-,pending,XL,Data Layer Done;API Routes Done,

phases[3]{id,name,wave,status,deliverableCount,criteriaCount}:
  0,Contracts,0,completed,3,4
  1,Implementation,1,in_progress,16,8
  2,Integration,2,pending,2,3
```

---

## Agent Monitoring (simplified)

When spawning agents via `run_in_background: true` (plan-builder-agent, planning agents in `--init` Step 4, `--refine` Step 2), apply lightweight monitoring per `agent-monitoring.schema.md`:

1. Include the agent's `taskId` in its prompt so it can write to `.plan-execution/ephemeral/progress/{taskId}.toon`
2. Create `.plan-execution/ephemeral/progress/` directory if it doesn't exist
3. After spawning, poll every 15 seconds:
   - Read progress files for running agents
   - Classify: `reporting` (heartbeat < 90s), `silent` (no file), `stale` (heartbeat > 90s)
   - Print a one-line status per agent: `{taskId}  {phase}  {percentComplete}%  "activity"  ♥ Ns ago`
4. Escalation:
   - Silent > 120s → warn
   - Stale > 180s → SendMessage nudge
   - Stale > 270s → ask user
   - Wall clock > 300s (5 min default for planning agents) → present timeout options

This is additive — if agents don't support progress reporting, the orchestrator waits normally.

## Error Handling

- **No plan exists**: suggest `init` to create one
- **No planning/history/**: create it on first write operation (any command that writes)
- **No execution state**: show plan-derived status (all phases pending)
- **Stale roadmap.toon**: reconcile against actual plan file, warn about drift
- **Review files not found**: skip review integration, note it
- **Validation failures in init**: retry with plan-builder-agent (max 2), then ask user
- **Agent failure**: report which agent failed, continue with available results
- **Large plan (>15 phases)**: warn about complexity, suggest `split`

## Integration Points

- `/loom-plan review` → writes findings to `planning/history/reviews/`
- `/loom-plan execute` → reads plan (validates stages 1-4 as gate), updates state.toon
- `/loom-plan test` → acceptance criteria from plan phases feed test spec generation
- `refine` → consumes review findings + agent analysis → updated plan
- `review-integrate` → automates roadmap review → roadmap update cycle
- `validate` → used by `init`, `refine`, and `/loom-plan execute` as a pre-flight check
- `status` → reads plan + state.toon + roadmap.toon + changelog for unified view

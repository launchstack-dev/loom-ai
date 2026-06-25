---
status: archived
archivedAt: 2026-05-30
archivedReason: superseded
supersededBy: PLAN-repo-map.md (committed d5bb177)
---

# Archive note

This plan proposed integrating `mksglu/context-mode` (a Claude Code plugin) as a tool-call-level sandboxing and cost-telemetry layer beneath Loom's orchestration-level context management. It was authored 2026-05-01 and never reviewed.

**Why archived:** Lost to `PLAN-repo-map.md` (Aider-style proactive context pack) on the platform-agnostic principle. context-mode requires installing a Claude Code plugin and brings an FTS5 SQLite sidecar — both couple Loom to the Claude Code runtime. Repo-map (tree-sitter + personalized PageRank + math) gives a deterministic, runtime-agnostic answer to the "what context does an agent need" question with no external services.

**What's still worth stealing if revisited:**
- Phase 2 cost-visibility design (per-stage token consumption surfaced in `/loom status` and `debrief.toon`) — implementable inside Loom hooks without context-mode.
- Phase 3 sandboxing patterns for test-runner / harness / delta output — also implementable inside Loom hooks.
- Phase 4 FTS5 vs HOT/WARM/COLD comparison framing — kept for reference if a session-state retrieval question comes back.

The original 4-phase plan follows verbatim for archaeology.

---

---
planVersion: 1
name: "Context-Mode Integration"
status: draft
created: 2026-05-01
lastReviewed: null
roadmapRef: ROADMAP.md
totalPhases: 4
totalWaves: 4
---

# Plan: Context-Mode Integration

## Overview

Integrate context-mode (mksglu/context-mode) as a companion layer for Loom that operates at the tool-call level — sandboxing raw tool output, providing cost visibility via ctx_stats/ctx_insight, and preserving session state through FTS5-indexed SQLite. Loom manages context at the orchestration layer (budget caps, rolling compression); context-mode manages it at the execution layer. They stack.

## Goal

Reduce context consumption during convergence loops by sandboxing test runner output, delta reports, and harness results. Add per-stage cost visibility to `/loom status` and debrief reports. Evaluate FTS5 session state as a potential upgrade to HOT/WARM/COLD rolling-context compression.

## Phases

### Phase 1: Install and Configure Hook Coexistence

**Wave:** 0
**Goal:** context-mode installed and running alongside Loom hooks without interference.
**Files:**
- `.claude/settings.json` (modify — add context-mode hooks after Loom hooks)
- `hooks/lib/context-mode-compat.ts` (create — exclusion pattern config for Loom output)

**Tasks:**

1. Install context-mode as Claude Code plugin:
   ```
   /plugin marketplace add mksglu/context-mode
   /plugin install context-mode@context-mode
   ```

2. Configure hook ordering in `.claude/settings.json`:
   - Loom PreToolUse hooks (budget, ownership, contract lock) fire FIRST
   - context-mode PreToolUse hooks fire SECOND (sandboxing, routing)
   - Verify: Loom hooks can still block tool calls; context-mode doesn't interfere with blocks

3. Configure exclusion patterns — context-mode must NOT:
   - Redirect Loom agent file reads to ctx_execute (agents read files intentionally via orchestration)
   - Apply terse compression to TOON-formatted output or AgentResult envelopes
   - Sandbox tool calls that Loom hooks have already processed and modified
   - Route `/loom-*` command tool calls through context-mode's routing layer

4. Create `hooks/lib/context-mode-compat.ts` with exclusion configuration:
   - List of tool name patterns to exclude from context-mode routing
   - List of output patterns (TOON headers, AgentResult fields) to exclude from compression
   - Export as config object consumed by context-mode's SessionStart hook

**Acceptance criteria:**
- [ ] context-mode hooks fire after Loom hooks in PreToolUse chain
- [ ] Loom's budget-tracker can still block tool calls (exit code behavior preserved)
- [ ] TOON output from agents is not compressed or mangled
- [ ] `/loom auto` completes a simple plan with context-mode active (no regressions)

---

### Phase 2: Cost Visibility (ctx_stats + ctx_insight)

**Wave:** 1
**Goal:** `/loom status` shows per-stage token consumption; debrief.toon includes cost metrics.
**Files:**
- `commands/loom-status.md` (modify — add context-mode stats section)
- `protocols/execution-conventions.md` (modify — add ctx_stats to debrief report)

**Tasks:**

1. Wire ctx_stats into `/loom status` output:
   - After existing status output, add a "Context Health" section
   - Call ctx_stats MCP tool to get per-tool token consumption breakdown
   - Display: total tokens saved, top 5 tools by consumption, sandbox hit rate
   - If context-mode not installed, skip this section silently

2. Wire ctx_insight into debrief.toon:
   - Add optional `contextHealth` block to debrief.toon schema:
     ```toon
     contextHealth:
       totalTokensSaved: {N}
       sandboxHitRate: {percent}
       topConsumers[5]{tool,tokens,sandboxed}:
         bash,45000,true
         read,12000,false
         ...
       productivityScore: {0-100}
       delegationScore: {0-100}
     ```
   - Debrief protocol reads ctx_stats/ctx_insight before writing debrief.toon
   - If context-mode not installed, omit the block (optional field)

3. Add cost-per-stage tracking:
   - At each stage boundary (contracts, execute, review, test, converge, fix), read ctx_stats
   - Compute delta from previous stage → per-stage cost
   - Include in stage-context/*.toon as optional `contextModeStats` block

**Acceptance criteria:**
- [ ] `/loom status` shows token savings when context-mode is active
- [ ] debrief.toon includes contextHealth block after convergence run
- [ ] Stage context files include per-stage cost breakdown
- [ ] All stats sections degrade gracefully (absent, not broken) without context-mode

---

### Phase 3: Convergence Loop Optimization

**Wave:** 2
**Goal:** Reduce compaction events during iterative convergence by sandboxing the biggest context consumers.
**Files:**
- context-mode configuration (modify — add convergence-specific sandbox rules)

**Tasks:**

1. Identify the largest context consumers in convergence loops:
   - Test runner output (vitest/jest stdout — often 10-50KB per run)
   - Delta report generation (file diffs, finding lists)
   - Harness re-run output (comparison results across iterations)
   - Agent heartbeat/progress reads (polling multiple files)

2. Configure context-mode sandboxing for these patterns:
   - Test runner bash output → sandbox via ctx_execute, return only pass/fail + failure details
   - Delta report file reads → index via ctx_index, retrieve via ctx_search on subsequent iterations
   - Harness output → sandbox, compress to structured summary

3. Measure before/after:
   - Run the same convergence loop (use an existing test fixture plan) with and without context-mode sandboxing
   - Track: total tokens consumed, number of compaction events, iterations completed before context pressure
   - Target: 50%+ reduction in compaction events during a 5+ iteration convergence loop

**Acceptance criteria:**
- [ ] Test runner output is sandboxed (summary only in context, full output in SQLite)
- [ ] Convergence loop completes with fewer compaction events vs baseline
- [ ] No regression in convergence correctness (same pass/fail outcomes)

---

### Phase 4: Evaluate FTS5 as Rolling-Context Upgrade (Decision Gate)

**Wave:** 3
**Goal:** Determine whether BM25-indexed session state should replace HOT/WARM/COLD rolling-context compression.
**Files:**
- (evaluation only — no code changes unless decision is "adopt")

**Tasks:**

1. Design the comparison:
   - Same convergence loop, same plan, same fixture
   - Run A: standard HOT/WARM/COLD rolling-context.md (current behavior)
   - Run B: context-mode FTS5 indexed state with BM25 retrieval
   - Measure: agent accuracy (do agents reference correct prior decisions?), token consumption, iteration count, convergence rate

2. Run the comparison:
   - Execute both runs, capture all artifacts
   - Compare agent outputs for quality of cross-wave knowledge reference

3. Decision gate:
   - If FTS5 retrieval produces equal or better agent accuracy with lower token consumption → plan the migration (new roadmap feature)
   - If HOT/WARM/COLD is equivalent or better → document the finding, keep current approach, close this phase
   - Document decision in `.plan-history/decisions/` as an ADR

**Acceptance criteria:**
- [ ] Side-by-side comparison completed with documented results
- [ ] Decision recorded as ADR in .plan-history/decisions/
- [ ] If "adopt": follow-up plan created for rolling-context migration
- [ ] If "keep": rationale documented, no further work needed

## Verification

After all phases:
- context-mode coexists with Loom hooks without interference
- `/loom status` shows cost visibility when context-mode is present
- Convergence loops consume measurably less context
- FTS5 evaluation has a documented decision

## Out of Scope

- Replacing Loom's budget cap system (context-mode complements, doesn't replace)
- Modifying context-mode's source code (we configure it, not fork it)
- Cross-platform context-mode support (OpenCode/Pi — deferred to M-04 timeline)
- Real-time cost dashboards or web UI

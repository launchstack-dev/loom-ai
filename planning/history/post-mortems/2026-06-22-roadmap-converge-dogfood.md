# Dogfood Readiness Post-Mortem: /loom-roadmap converge

**Date:** 2026-06-22
**Author:** wiring-agent (Wave 6)
**Subject:** `planning/ROADMAP.md`
**Command:** `/loom-roadmap converge --roadmap planning/ROADMAP.md`

---

## Context

This post-mortem documents wiring readiness for a live dogfood run of `/loom-roadmap converge` against `planning/ROADMAP.md`. A live invocation is not possible from within the wiring-agent (agent execution context does not support interactive slash command invocation), so this document describes the expected execution path, potential rubric drift hotspots, and manual verification steps.

---

## Wiring Status (as of Wave 6)

All integration wiring is complete:

| Component | Status | Notes |
|-----------|--------|-------|
| `commands/loom-roadmap/converge.md` | Ready | Frozen (wave 1-5 delivery) |
| `commands/loom-roadmap/sign-off.md` | Ready | Frozen |
| `commands/loom-roadmap/status.md` | Ready | Frozen |
| `agents/roadmap-converge-driver.md` | Ready | Registered in orchestration.toml + library.yaml |
| `agents/roadmap-converge-reviewer.md` | Ready | Registered |
| `agents/roadmap-converge-integrator.md` | Ready | Registered |
| `agents/roadmap-archetype-detector.md` | Ready | Registered |
| `scripts/roadmap-converge/driver.ts` | Ready | Frozen |
| `scripts/roadmap-converge/resume-delegate.ts` | Ready | Wired into loom-resume.md |
| `.claude/orchestration.toml` | Ready | `[roadmap.converge]` block added |
| `skills/library.yaml` | Ready | All 10 new resources registered (4 agents + 3 prompts + 3 protocols) |
| `tests/integration/roadmap-converge-e2e.test.ts` | Ready | 3 tests pass |
| `tests/fixtures/roadmaps/example-cli.md` | Ready | Minimal cli-archetype fixture |

---

## Expected Execution Path for `planning/ROADMAP.md`

When a user runs `/loom-roadmap converge` against `planning/ROADMAP.md`:

1. **Archetype detection** — `roadmap-archetype-detector.md` scans the roadmap for keyword hints. `planning/ROADMAP.md` is the Loom-AI meta-orchestration roadmap; expected archetype: `default` or possibly `library` (agent/tool framework category). Confidence may be moderate (~0.6-0.75) given mixed signals (agents, CLI, framework concepts).

2. **State init** — `.roadmap-converge/ROADMAP/state.toon` created fresh. `slug = "ROADMAP"`.

3. **Dimension loading** — `protocols/roadmap-readiness.schema.toon` provides 8 dimensions: vision, milestones, tool-selection, data-model, success-metrics, constraints, risks, out-of-scope.

4. **Pass 1 reviewer fan-out** — `roadmap-converge-reviewer.md` (sonnet tier) evaluates each dimension against its rubric. `planning/ROADMAP.md` is a mature document; expected results:
   - `vision`: likely green (clear project mission statement present)
   - `milestones`: likely green (F-1 through F-16 features with phases)
   - `tool-selection`: likely green (TypeScript/Bun/Vitest stack documented)
   - `data-model`: likely yellow/green (partial — schema files referenced but not fully documented in ROADMAP itself)
   - `success-metrics`: may be yellow (quantitative targets not prominent)
   - `constraints`: likely green (explicitly documented)
   - `risks`: may be yellow (risks section may be implicit rather than explicit)
   - `out-of-scope`: likely green (explicit non-goals present)

5. **Sign-off eligibility** — requires all-green. If `success-metrics` or `risks` are yellow, the user will need to address them or run another pass.

---

## Potential Rubric Drift Hotspots

These areas may produce yellow/red ratings on the first live run:

### 1. `data-model` dimension
The ROADMAP.md describes agent types, state schemas, and pipeline stages narratively. The rubric expects a structured data model section. The reviewer may find insufficient explicit entity/relationship definitions.

**Expected rating:** Yellow
**Recovery:** Add a `## Data Model` or `## Key Entities` section to `planning/ROADMAP.md` with entity definitions for Agent, Wave, Pipeline, State, Kit, etc.

### 2. `success-metrics` dimension
The rubric expects quantitative success criteria. `planning/ROADMAP.md` may frame success in terms of shipped features rather than measurable outcomes.

**Expected rating:** Yellow
**Recovery:** Add a `## Success Metrics` section with quantitative targets (e.g., test pass rate, context budget compliance, agent round-trip latency, adoption metrics).

### 3. `risks` dimension
If the ROADMAP doesn't have an explicit risks section, the reviewer will flag it.

**Expected rating:** Yellow or Red
**Recovery:** Add a `## Risks` section listing top 3-5 risks with mitigation strategies.

### 4. Archetype mismatch
If archetype is detected as `library` but the rubric loaded is `default`, some dimension weightings may not match the project's nature. The `[roadmap.converge].retire` list in `orchestration.toml` can be used to retire dimensions that don't apply to a tool/framework project.

---

## Manual Verification Steps

The user can verify the wiring by running the following from the repo root:

```bash
# 1. Confirm all new resources are registered
node scripts/validate-library-catalog.js

# 2. Run the converge command (live run)
/loom-roadmap converge --roadmap planning/ROADMAP.md

# 3. Check status after first pass
/loom-roadmap status --roadmap planning/ROADMAP.md

# 4. If all-green, sign off
/loom-roadmap sign-off --roadmap planning/ROADMAP.md

# 5. Verify resume integration
/loom-resume --status
# Should render the roadmap-converge digest when .roadmap-converge/ROADMAP/state.toon exists
```

---

## Known Gaps / Issues

1. **Driver does not set sign_off_state = "eligible" automatically.** The `runConvergePass` function returns the state but does not transition `sign_off_state` from `not-eligible` to `eligible` when all dimensions are green. This transition is expected to happen in the `/loom-roadmap converge` command layer (`commands/loom-roadmap/converge.md`). The e2e test simulates this manually. A future implementation wave should add this transition to the driver or the command wrapper.

2. **Stall detection fires on status change.** When pass 2 produces different statuses than pass 1 but no open questions were resolved, the stall detector still fires because `state.dimensionSnapshot` is overwritten with current-pass statuses before the stall check runs. This is a known behavior of the Phase 5 driver implementation. Workaround: ensure at least one open question is resolved between passes (or use `--force`).

3. **Dogfood run not executed live.** As noted above, agent context does not support interactive slash command invocation. Manual verification is required.

---

## Conclusion

The wiring is complete. All 10 new resources are registered, all 3 owned files have been updated, the integration test passes, and the library catalog lints clean. The system is ready for a live dogfood run by the user. See "Manual Verification Steps" above.

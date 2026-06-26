---
pageId: feature-f18-mattpocock-skills-adoption
category: feature
tags[5]: F-18,mattpocock,feedback-loop,skills-adoption,behavioural-gate
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: F-18 adopts 6 Matt Pocock patterns (MIT) into Loom across 9 phases / 7 waves — headline change is the tight-red loop-construction gate that halts loom-converge and loom-bugfix until a verified-red FeedbackLoop envelope exists.
estimatedTokens: 1100
bodySections[5]: Summary,Scope,Headline Behavioural Change,Phases,References
relatedFiles[6]:
  planning/plans/PLAN-F-18-matt-pocock-skills.md
  NOTICE
  docs/adr/0000-adr-convention.md
  docs/adr/0001-hook-merge-decision-2026-04-25.md
  docs/adr/0002-sign-off-as-sole-path-to-converged.md
  docs/adr/0003-archetype-selected-pedagogical-rubrics.md
crossRefs[4]{pageId,relationship}:
  protocol-feedback-loop,implements
  command-loom-which,implements
  state-machine-feedback-loop,implements
  decision-context-decisions-split,implements
---

## Summary

F-18 (Matt Pocock Skills Adoption) incorporates the highest-leverage engineering patterns from `mattpocock/skills` (MIT) into Loom per locked decision C-06. The feature shipped 23 sub-items across 9 phases in 7 waves, targeting Milestone M-08. All 23 sub-items have coverage mapped in `planning/history/coverage/F-18-coverage.toon`.

## Scope

F-18 covers 23 sub-items grouped into five phases (A/B/C/D/E) plus a coverage-audit phase. The phases are:

- **Phase A** — Foundation: codebase-design vocabulary, CONTEXT.md/DECISIONS.md split, ADR convention, convergence-state migration, `/loom-which` router.
- **Phase B** — Feedback-Loop Discipline: FeedbackLoop schema, feedback-loop skill (10-rung ladder + TRDA gate), `loom-bugfix` Phase-1 gate, `loom-converge` loop binding.
- **Phase C** — Planning Quality: TDD-coach agent, findings.schema confidence field, `/loom-deepen`, planning-agent sharpening with vertical tracer-bullet framing.
- **Phase D** — Inbox + ADR Hygiene: `/loom-prototype`, triage state machine, out-of-scope schema, ADR conflict callouts.
- **Phase E** — Polish: `loom-pause` handoff hygiene, grilling discipline 12-question cap, conditional HTML report mode, skill autoload audit, sediment sweep.
- **Phase 6** — Coverage audit via `scripts/coverage-audit/f18-audit.ts` and NOTICE attribution file.

F-19 is explicitly **out of scope** for this plan.

## Headline Behavioural Change

The loop-construction gate introduced in Phase B is the headline behavioural change. Before this feature, `loom-converge` and `loom-bugfix` would begin iteration without a verified reproduction signal. After F-18:

1. `loom-converge` Phase-0 writes a `loop.toon` FeedbackLoop envelope and validates it against the **TRDA gate** (tight + redCapable + deterministic + agentRunnable — all four must be true).
2. `loom-bugfix` Phase-1 applies the same gate before generating a fix hypothesis.
3. If the 10-rung escalation ladder is exhausted without a TRDA pass, the loop enters `stuck-at-loop-construction` — a named HITL state with structured escalation guidance rather than a silent block.

The escape hatch `--override-loop-gate "<reason>"` bypasses the gate with an explicit operator acknowledgement recorded in the convergence digest.

## Six Attributed Patterns (NOTICE)

Per `NOTICE`, six patterns are attributed to Matt Pocock (MIT License):

1. Codebase-design vocabulary (`protocols/codebase-design.md`)
2. Feedback-loop ladder (`skills/feedback-loop/SKILL.md`)
3. Writing-great-skills no-op test (`protocols/skill-authoring.md`)
4. Horizontal-slice anti-pattern (`agents/tdd-coach.md`)
5. Throwaway-prototype branches (`commands/loom-prototype.md`)
6. Grilling discipline (`protocols/grilling.md`)

## ADRs Shipped in F-18

| ADR | Title | Status |
|-----|-------|--------|
| ADR-0000 | ADR convention | accepted |
| ADR-0001 | Hook merge decision (2026-04-25) | accepted |
| ADR-0002 | Sign-off as sole path to converged | accepted |
| ADR-0003 | Archetype-selected pedagogical rubrics | accepted |

## References

- Canonical plan: `planning/plans/PLAN-F-18-matt-pocock-skills.md`
- Attribution: `NOTICE`
- Coverage audit: `planning/history/coverage/F-18-coverage.toon`
- ADRs: `docs/adr/`

---
description: "Plan-Critic Concerns Checklist"
---

# Plan-Critic Concerns Checklist

A distilled checklist of common issues across the 6 reviewer dimensions. The `plan-critic-agent` walks this list against a draft plan and emits a `predictedFindings[]` row for each match.

Each concern is tagged with one of the locked 6-dimension enum values: `feature-coverage`, `strategy`, `ux`, `phasing`, `parallelization`, `agentic-workflow`. The `dimension` field on emitted findings MUST match the bracketed tag of the concern that triggered it.

Concerns are SPECIFIC and CHECKABLE against a plan body (no runtime data required). The critic skips silently when a concern does not match — it never emits "clean" rows.

---

1. **[feature-coverage]** A locked decision cited in the roadmap (e.g., `C-06`, `D-04`) is not referenced anywhere in the plan body — predicted-severity `blocking`.
2. **[feature-coverage]** A feature listed in the plan's Features section has no corresponding acceptance criterion in any phase — predicted-severity `blocking`.
3. **[feature-coverage]** A schema, API endpoint, or contract field mentioned in the Overview is missing from the contracts wave's deliverables — predicted-severity `warning`.
4. **[feature-coverage]** Plan declares it implements a competitor's named feature but lacks the field, endpoint, or surface that feature requires — predicted-severity `warning`.
5. **[feature-coverage]** Export/integration formats (CSV, JSON, webhook) are promised in the Overview but absent from phase deliverables — predicted-severity `info`.

6. **[strategy]** Overview lists features without naming the target audience or differentiator versus alternatives — predicted-severity `blocking`.
7. **[strategy]** A phase introduces capabilities (auth providers, integrations, infra) not traceable to a plan-stated deliverable — scope creep, predicted-severity `warning`.
8. **[strategy]** The plan reorders or descopes a roadmap-locked deliverable without recording the reason in a Decisions or Notes section — predicted-severity `warning`.
9. **[strategy]** Risks section enumerates risks without naming a mitigation owner (phase number or agent) — predicted-severity `warning`.
10. **[strategy]** Early phases ship pure infrastructure with no user-visible value, burying the differentiator behind setup work — predicted-severity `info`.

11. **[ux]** A user-facing component named in a phase has no loading state, empty state, or error state mentioned in its acceptance criteria — predicted-severity `blocking`.
12. **[ux]** Acceptance criteria mention error handling without naming the user-facing copy or recovery action — predicted-severity `warning`.
13. **[ux]** Plan introduces a destructive action (delete, reset, overwrite) with no confirmation or undo described — predicted-severity `warning`.
14. **[ux]** Overview exceeds the 1-3 sentence guideline — predicted-severity `info`.
15. **[ux]** Accessibility target (e.g., WCAG 2.1 AA) is not stated anywhere in the plan despite frontend deliverables existing — predicted-severity `info`.

16. **[phasing]** A phase's acceptance criteria depend on a deliverable produced in a LATER phase or wave — forward reference, predicted-severity `blocking`.
17. **[phasing]** A phase declares more than 8 distinct deliverables — predicted-severity `blocking`.
18. **[phasing]** A phase declares fewer than 2 deliverables and is adjacent to a same-wave phase that could absorb it — predicted-severity `warning`.
19. **[phasing]** A phase ends without a verification gate (no tests pass / demo works / metrics named) — predicted-severity `warning`.
20. **[phasing]** A high-risk validation (new dependency, novel integration, unproven assumption) is sequenced late instead of early as a spike — predicted-severity `info`.

21. **[parallelization]** Two phases in the same wave declare overlapping File Ownership entries (same glob or same file path) — predicted-severity `blocking`.
22. **[parallelization]** A wave declares parallel execution but its phases must touch the same barrel/index file without a designated wiring step — predicted-severity `blocking`.
23. **[parallelization]** Wave 0 (contracts) is absent or merged into Wave 1, leaving parallel implementers without stable shared interfaces — predicted-severity `warning`.
24. **[parallelization]** A wave declares more parallel phases than the dispatcher's configured concurrency cap (typically 3-4) — predicted-severity `warning`.
25. **[parallelization]** A merge order is not stated for waves that produce shared-file edits — predicted-severity `info`.

26. **[agentic-workflow]** A phase's acceptance criteria require reading more than 15-20 files for context (estimated by file ownership + cited dependencies) — predicted-severity `blocking`.
27. **[agentic-workflow]** A phase lists deliverables without naming the agent (e.g., implementer, wiring, contracts) responsible for producing them — predicted-severity `warning`.
28. **[agentic-workflow]** An acceptance criterion is not automatically verifiable (no command, test path, or schema check named) — predicted-severity `warning`.
29. **[agentic-workflow]** Plan declares `planVersion: 2` in frontmatter but omits the State Machines section the version requires — predicted-severity `warning`.
30. **[agentic-workflow]** A phase invokes a custom or non-default agent without citing its registration in `.claude/orchestration.toml` — predicted-severity `info`.

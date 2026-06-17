# Rubric: Milestones

Milestones group features into ordered, deliverable units. A strong milestone set forms a DAG (no cycles, no forward references), names what is acceptable at each boundary, and sizes effort honestly. Each milestone should be independently demoable or describable as a coherent slice of value — if removing a milestone would leave a half-built scaffold rather than a smaller working system, the milestone boundary is wrong.

## Green

> "**M-01: Planning Foundation** — Features F-01, F-02, F-06. Depends on: None. Acceptance: Taxonomy formalized, dual-track planning runs in parallel, interpretation-reviewer catches known ambiguities in test-fixture plans. Effort: L.
>
> **M-02: 4-Tier Convergence Engine** — Features F-03, F-07. Depends on: M-01. Acceptance: All 4 tiers execute at their correct hierarchy levels, unit tests gate waves, red-green TDD gate enforced by implementer, fixer diagnoses before fixing. Effort: XL.
>
> **M-03: Cross-System Integration** — Features F-08. Depends on: M-02. Acceptance: Wiki captures test decisions, context budget holds for all test agents, statusline shows test metrics. Effort: L."

This is green because every milestone declares its features, dependencies, acceptance, and effort. The dependency chain is linear and forward-acyclic (M-01 → M-02 → M-03). Each acceptance line is observable — you could run a test against "unit tests gate waves" — and the effort sizing is consistent with feature count. A reader can predict the demo at each milestone boundary without reading the features.

## Yellow

> "**M-01: Build the foundation** — Features F-01, F-02. Depends on: None. Acceptance: foundation works. Effort: L.
>
> **M-02: Build the rest** — Features F-03, F-04, F-05, F-06, F-07, F-08. Depends on: M-01. Acceptance: everything works end-to-end. Effort: XL."

This is yellow because the structure is present but the content is hollow. "Foundation works" and "everything works end-to-end" are not falsifiable acceptance criteria. M-02 also concentrates six features into one milestone, which is too coarse to slice progress against — the >5-feature warning in the schema sizing guidelines applies. The reviewer agent should echo: "acceptance lines must name observable outcomes; M-02 should be split because six features in one milestone hides risk."

## Red

> "We will deliver this in phases. The first phase is the basics, then we add features, then we polish."

This is red because there are no identified milestone IDs, no feature assignments, no dependencies, no acceptance criteria, and no effort sizing. "Basics", "features", and "polish" are not deliverable units — they are placeholder labels. Cycle detection, orphan-feature checks, and forward-reference validation all fail because there is nothing to validate. The reviewer must mark as blocking and require a structured milestone table.

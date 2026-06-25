# Planning Taxonomy

Defines the 4-level planning hierarchy used across the Loom meta-orchestration pipeline, plus the canonical leaf-level testable unit (the scenario) that hangs off the hierarchy. Every plan, roadmap, and convergence artifact references this taxonomy to determine scope boundaries and convergence tier assignments.

---

## Hierarchy Levels

The planning hierarchy contains exactly 4 levels, ordered from broadest to narrowest scope. Scenarios are the canonical leaf-level **testable unit** — they are not a hierarchy level themselves; they are individual behavioral assertions hosted by features (in roadmaps) and phases (in plans).

| Level | Name | Description | Parent | Contains |
|-------|------|-------------|--------|----------|
| 1 | milestone | Major delivery boundary grouping multiple features | (root) | features |
| 2 | feature | User-facing capability with observable behaviors | milestone | phases, **scenarios** |
| 3 | phase | Execution unit within a feature, assigned to one agent | feature | waves, **scenarios** |
| 4 | wave | Parallel execution batch of phases | phase | (leaf) |

Scenarios (`S-NN`) are the **canonical leaf-level testable unit**. They appear under features in the roadmap (`Scenarios:` subsection) and under phases in a `planVersion: 2` plan (`#### Scenarios` subsection). Every plan-phase scenario derives from at most one roadmap-feature scenario (preserving `id`) plus zero or more plan-only additions. Scenarios are not a separate hierarchy level — they are attached behavioral specifications that the convergence-planner reads when emitting verification targets.

```toon
levels[4]: milestone, feature, phase, wave

hierarchy:
  feature: milestone
  phase: feature
  wave: phase

testableUnit: scenario
testableUnitHosts[2]: feature, phase
testableUnitIdFormat: S-NN
```

---

## Convergence Tier Assignments

Each hierarchy level maps to exactly one convergence tier. Higher-level scopes require broader verification.

| Hierarchy Level | Convergence Tier | Rationale |
|----------------|-----------------|-----------|
| milestone | e2e | End-to-end stories verify the full user workflow across all features in the milestone |
| feature | integration | Integration tests verify feature-level contracts and cross-phase wiring |
| phase | qa-review | QA review verifies phase deliverables meet acceptance criteria |
| wave | unit | Unit tests verify individual wave outputs in isolation |

```toon
convergenceLevels:
  milestone: e2e
  feature: integration
  phase: qa-review
  wave: unit
```

---

## ID Formats

Each hierarchy level uses a distinct ID format for unambiguous cross-referencing. Scenarios are addressed via their host's ID plus the scenario ID:

| Level / Unit | Format | Example |
|-------|--------|---------|
| milestone | M-NN | M-01, M-02 |
| feature | F-NN | F-01, F-12 |
| phase | Phase N | Phase 0, Phase 3 |
| wave | Wave N | Wave 0, Wave 1 |
| scenario (within feature) | F-NN.S-NN | F-01.S-01, F-12.S-04 |
| scenario (within phase) | Phase N.S-NN | Phase 3.S-02, Phase 7.S-11 |

Scenario IDs (`S-NN`) are unique within their host (feature or phase). Cross-host reuse of the same `S-NN` is permitted; the disambiguating prefix is always the host ID. Validators flag duplicate scenario IDs within a single host as blocking.

---

## Validation Rules

1. **Exactly 4 levels.** The `levels` array must contain exactly 4 entries.
2. **Exactly 4 convergence tier assignments.** Every hierarchy level must map to exactly one convergence tier in `convergenceLevels`.
3. **No tier reuse.** Each convergence tier name appears in exactly one mapping.
4. **Hierarchy is a strict chain.** milestone > feature > phase > wave, with no branching or skipping.
5. **Valid tier names.** Convergence tier values must be one of: `unit`, `integration`, `e2e`, `qa-review`.
6. **Scenario is the only testable unit.** The `testableUnit` field MUST equal `scenario`. Scenarios MUST NOT be added as a 5th hierarchy level — they are leaf-level attached behavioral specs, not a scope tier.
7. **Scenario hosts.** The `testableUnitHosts` array MUST equal `[feature, phase]`. Milestones do not host scenarios directly (they aggregate features); waves do not host scenarios (they are execution batches, not behavioral scopes).

---

## Relationship to Other Schemas

- **plan.schema.md** -- Plans define phases and waves; the taxonomy provides their hierarchical context. (v2) Plan phases host scenarios via `#### Scenarios`.
- **roadmap.schema.md** -- Roadmaps define features and milestones; the taxonomy maps these to convergence tiers. Features host scenarios via the `Scenarios:` subsection.
- **convergence-tier.schema.md** -- Defines the full schema for each convergence tier referenced in `convergenceLevels`, plus the canonical Scenario-to-Tier resolution chain.
- **criteria-plan.schema.md** -- Criteria entries include a `testTier` column whose valid values come from the convergence tier names, and a `scenarioRef` column citing the host-prefixed scenario IDs defined here.
- **e2e-story.schema.md** -- E2E stories operate at the milestone convergence level as defined by this taxonomy and MUST cite source scenarios via `derivedFrom[]`.
- **scenario.schema.md** -- Defines the canonical leaf-level testable unit. Scenarios are hosted by features and phases per this taxonomy; their IDs are always prefixed with the host ID when referenced cross-document.

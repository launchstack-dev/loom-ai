# Planning Taxonomy

Defines the 4-level planning hierarchy used across the Loom meta-orchestration pipeline. Every plan, roadmap, and convergence artifact references this taxonomy to determine scope boundaries and convergence tier assignments.

---

## Hierarchy Levels

The planning hierarchy contains exactly 4 levels, ordered from broadest to narrowest scope:

| Level | Name | Description | Parent | Contains |
|-------|------|-------------|--------|----------|
| 1 | milestone | Major delivery boundary grouping multiple features | (root) | features |
| 2 | feature | User-facing capability with observable behaviors | milestone | phases |
| 3 | phase | Execution unit within a feature, assigned to one agent | feature | waves |
| 4 | wave | Parallel execution batch of phases | phase | (leaf) |

```toon
levels[4]: milestone, feature, phase, wave

hierarchy:
  feature: milestone
  phase: feature
  wave: phase
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

Each hierarchy level uses a distinct ID format for unambiguous cross-referencing:

| Level | Format | Example |
|-------|--------|---------|
| milestone | M-NN | M-01, M-02 |
| feature | F-NN | F-01, F-12 |
| phase | Phase N | Phase 0, Phase 3 |
| wave | Wave N | Wave 0, Wave 1 |

---

## Validation Rules

1. **Exactly 4 levels.** The `levels` array must contain exactly 4 entries.
2. **Exactly 4 convergence tier assignments.** Every hierarchy level must map to exactly one convergence tier in `convergenceLevels`.
3. **No tier reuse.** Each convergence tier name appears in exactly one mapping.
4. **Hierarchy is a strict chain.** milestone > feature > phase > wave, with no branching or skipping.
5. **Valid tier names.** Convergence tier values must be one of: `unit`, `integration`, `e2e`, `qa-review`.

---

## Relationship to Other Schemas

- **plan.schema.md** -- Plans define phases and waves; the taxonomy provides their hierarchical context.
- **roadmap.schema.md** -- Roadmaps define features and milestones; the taxonomy maps these to convergence tiers.
- **convergence-tier.schema.md** -- Defines the full schema for each convergence tier referenced in `convergenceLevels`.
- **criteria-plan.schema.md** -- Criteria entries include a `testTier` column whose valid values come from the convergence tier names.
- **e2e-story.schema.md** -- E2E stories operate at the milestone convergence level as defined by this taxonomy.

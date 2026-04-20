# Convergence Tier Schema

Defines the 4 convergence tiers that map to the planning hierarchy levels defined in `taxonomy.md`. Each tier specifies how convergence is verified at its scope level, which agent or tool runs the verification, and how failures gate downstream execution.

---

## Schema

```toon
name: unit
level: 1
hierarchyLevel: wave
runner: vitest-runner
passCondition: all-pass
defaultEnabled: true
gatingBehavior: block-wave
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | enum | yes | Tier name: `unit`, `integration`, `e2e`, `qa-review`. |
| level | integer | yes | Numeric level 1-4, ascending order of cost. 1 = cheapest (unit), 4 = most expensive (qa-review). |
| hierarchyLevel | enum | yes | Planning hierarchy level this tier maps to: `wave`, `phase`, `feature`, `milestone`. |
| runner | string | yes | Agent or CLI tool that executes verification at this tier. |
| passCondition | enum | yes | What constitutes a pass: `all-pass`, `zero-critical`, `zero-blocking`. |
| defaultEnabled | boolean | yes | Whether this tier runs by default in the convergence pipeline. |
| gatingBehavior | enum | yes | How a failure at this tier affects execution: `block-wave`, `block-feature`, `block-milestone`, `advisory`. |

---

## Tier Definitions

### Unit (Level 1 -- Wave)

```toon
name: unit
level: 1
hierarchyLevel: wave
runner: vitest-runner
passCondition: all-pass
defaultEnabled: true
gatingBehavior: block-wave
```

Unit tests verify individual wave outputs in isolation. Every wave must pass all unit tests before the next wave can begin. The default runner is `vitest-runner` but can be overridden per project (e.g., `jest-runner`, `pytest-runner`).

### Integration (Level 2 -- Feature)

```toon
name: integration
level: 2
hierarchyLevel: feature
runner: integration-test-agent
passCondition: all-pass
defaultEnabled: true
gatingBehavior: block-feature
```

Integration tests verify cross-phase wiring within a feature. A feature cannot be marked complete until its integration tests pass. The `integration-test-agent` runs generated integration tests and reports results.

### E2E (Level 3 -- Milestone)

```toon
name: e2e
level: 3
hierarchyLevel: milestone
runner: e2e-runner-agent
passCondition: zero-blocking
defaultEnabled: true
gatingBehavior: block-milestone
```

End-to-end stories verify complete user workflows across all features in a milestone. The `e2e-test-writer-agent` converts criteria-plan e2e specs into YAML stories and Playwright test files; the `e2e-runner-agent` executes them. Blocking stories must all pass; advisory stories may fail without preventing milestone completion.

### QA Review (Level 4 -- Phase)

```toon
name: qa-review
level: 4
hierarchyLevel: phase
runner: qa-review-agent
passCondition: zero-critical
defaultEnabled: true
gatingBehavior: advisory
```

QA review verifies phase deliverables against acceptance criteria using agent-based review (code review, security review, etc.). The pass condition is `zero-critical` -- critical findings block, but warnings and info findings are advisory.

---

## Typed Array Form

All 4 tiers as a typed array:

```toon
tiers[4]{name,level,hierarchyLevel,runner,passCondition,defaultEnabled,gatingBehavior}:
  unit,1,wave,vitest-runner,all-pass,true,block-wave
  integration,2,feature,integration-test-agent,all-pass,true,block-feature
  e2e,3,milestone,e2e-runner-agent,zero-blocking,true,block-milestone
  qa-review,4,phase,qa-review-agent,zero-critical,true,advisory
```

---

## Validation Rules

1. **Exactly 4 tiers.** The tier set must contain exactly 4 entries.
2. **Name enum.** Must be one of: `unit`, `integration`, `e2e`, `qa-review`.
3. **Level range.** Must be an integer from 1 to 4 inclusive.
4. **Hierarchy level enum.** Must be one of: `wave`, `phase`, `feature`, `milestone`.
5. **Unique names.** No two tiers may share the same `name`.
6. **Unique levels.** No two tiers may share the same `level`.
7. **Unique hierarchy levels.** No two tiers may share the same `hierarchyLevel`.
8. **Pass condition enum.** Must be one of: `all-pass`, `zero-critical`, `zero-blocking`.
9. **Gating behavior enum.** Must be one of: `block-wave`, `block-feature`, `block-milestone`, `advisory`.
10. **Consistency with taxonomy.** The `hierarchyLevel` for each tier must match the mapping defined in `taxonomy.md` `convergenceLevels`.

---

## Relationship to Other Schemas

- **taxonomy.md** -- Defines the hierarchy-to-tier mapping that this schema implements in detail.
- **criteria-plan.schema.md** -- Criteria entries reference tier names via the `testTier` column.
- **e2e-story.schema.md** -- E2E stories are executed at the `e2e` tier (level 1, milestone scope).
- **plan.schema.md** -- Plan phases may reference convergence tiers for their verification strategy.
- **agent-result.schema.md** -- Tier runners return results in the AgentResult envelope.

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

## Scenario-to-Tier Mapping

Scenarios (defined in `scenario.schema.md`) carry an optional `testTier` field. When omitted, the validator resolves the tier using the chain below. This chain is the **canonical** algorithm — schemas, validators, and convergence-planner implementations MUST follow it verbatim.

### Resolution Chain

When `testTier` is omitted from a scenario block, the validator computes it in this order. The first rule that matches wins:

1. **`automatable: false` → `qa-review`.** Non-automatable scenarios cannot be verified by deterministic runners; they are always routed to QA review regardless of tags or trigger type.
2. **Single-tag default.** When `tags[]` contains exactly one entry from the locked enum, use that tag's default tier:
   - `happy-path` → `integration` (for `api-call` trigger) or `e2e` (for `actor-action` trigger).
   - `edge-case` → `unit`.
   - `error` → `integration`.
   - `regression` → matches the originating bug's reproduction tier (resolved at criterion-creation time; if unknown, falls through to rule 3).
3. **Multi-tag highest-cost wins.** When `tags[]` contains 2+ entries, pick the highest-cost tier among each tag's defaults. Cost order (high → low): `qa-review` > `e2e` > `integration` > `unit`.
4. **`whenTriggerType` fallback.** When no tag yields a tier (e.g., all project-local tags from `scenarios.local.yaml`), fall back to:
   - `api-call` → `integration`.
   - `actor-action` → `e2e`.
   - `system-event` → `unit`.
5. **Explicit `testTier` always overrides.** If the scenario specifies a `testTier` value, that value wins over rules 1-4. The validator emits an info-level note when an explicit `testTier` conflicts with the resolved default (e.g., `automatable: false` with an explicit `testTier: unit` is a warning because it bypasses QA review).

### Worked Examples

| Scenario inputs | Resolved tier | Rule applied |
|-----------------|---------------|--------------|
| `automatable: false`, `tags: [happy-path]`, no `testTier` | `qa-review` | Rule 1 |
| `automatable: true`, `tags: [happy-path]`, `whenTriggerType: api-call`, no `testTier` | `integration` | Rule 2 |
| `automatable: true`, `tags: [happy-path]`, `whenTriggerType: actor-action`, no `testTier` | `e2e` | Rule 2 |
| `automatable: true`, `tags: [edge-case]`, no `testTier` | `unit` | Rule 2 |
| `automatable: true`, `tags: [error]`, no `testTier` | `integration` | Rule 2 |
| `automatable: true`, `tags: [edge-case, error]`, `whenTriggerType: api-call`, no `testTier` | `integration` | Rule 3 (highest-cost of {unit, integration} = integration) |
| `automatable: true`, `tags: [happy-path, edge-case]`, `whenTriggerType: api-call`, no `testTier` | `integration` | Rule 3 (highest-cost of {integration, unit} = integration) |
| `automatable: true`, `tags: [custom-tag]` (project-local), `whenTriggerType: actor-action`, no `testTier` | `e2e` | Rule 4 |
| `automatable: true`, `tags: [happy-path]`, `whenTriggerType: system-event`, no `testTier` | `unit` | Rule 4 (`system-event` overrides the api-call-only default for `happy-path`) |
| Any inputs, `testTier: e2e` explicit | `e2e` | Rule 5 |

### Where This Matters

- **criteria-planner-agent** uses this chain when materializing criteria from scenarios — the resolved tier becomes the criterion's `testTier`.
- **convergence-planner** uses this chain to decide which tier runner verifies a given scenario.
- **e2e-test-writer-agent** filters source scenarios by `testTier == e2e` (resolved) when picking candidates for story generation.
- **interpretation-reviewer-agent** uses this chain to detect tier mismatches between scenarios and their derived criteria.

The resolution chain is a static, deterministic function of the scenario fields. Two validators executing this chain on the same scenario MUST produce the same tier.

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
- **scenario.schema.md** -- Scenarios reference tier names via `testTier`. The Scenario-to-Tier Mapping section above documents the canonical resolution chain that the validator and convergence-planner use when `testTier` is omitted.
- **agent-result.schema.md** -- Tier runners return results in the AgentResult envelope.

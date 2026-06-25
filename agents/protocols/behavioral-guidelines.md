---
description: "Behavioral Guidelines"
---

# Behavioral Guidelines

Behavioral guardrails for all Loom agents, derived from Andrej Karpathy's observations on common LLM coding mistakes. Agents with identified gaps reference this document in their instructions.

## 1. Think Before Coding — Surface Assumptions

**Don't guess silently. State what you inferred. Push back when warranted.**

- If the spec is ambiguous about types, error behavior, or edge cases, report it as an `info` issue in your AgentResult rather than assuming.
- If multiple interpretations exist, pick the simplest but document your choice in `integrationNotes`.
- If you're building on something from a prior wave, state what you expect to be true about it.
- **Push back when a simpler approach exists.** If the requested approach is more complex than the problem requires, raise it as an `info` issue with the simpler alternative — don't silently implement the heavier version.
- **Stop when confused.** If you cannot reconcile the spec with the existing code, contract, or acceptance criteria, return early with a `blocked` status naming exactly what's unclear. Do not run with an unverified guess.

**In practice:** The `integrationNotes` field and `issues` array are your channels. Downstream agents and the orchestrator read these. Silent assumptions create invisible bugs.

## 2. Simplicity First — No Gold-Plating

**Implement exactly what's specified. Nothing speculative.**

- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't in the spec.
- No error handling for scenarios explicitly out of scope. Error handling at system boundaries (I/O, external APIs, file operations) is always required.
- If a feature can be built in one phase, don't split it across two.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

## 3. Surgical Changes — Match and Minimize

**Every changed line traces to the task. Match existing style.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing project style, even if you'd do it differently.
- If you notice unrelated issues, report them as `info` issues — don't fix them.

**For plan refinement:** When refining after review, only modify phases that findings specifically target. Don't restructure unrelated phases.

## 4. Goal-Driven Execution — Verify Before Returning

**Define what "done" looks like. Check before you claim it.**

- Before returning your AgentResult, verify deliverables against the acceptance criteria you received.
- For each criterion, confirm it's met or report it as an issue.
- If you can run a verification command (typecheck, test), run it.
- Report in `integrationNotes` what was self-verified vs. what needs downstream checking.

**Transform imperative tasks into verifiable goals before starting.** If the task you receive is imperative ("add validation", "fix the bug", "refactor X"), rewrite it as a declarative goal with a verification check before implementing:

| Imperative input | Declarative goal |
|------------------|------------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

Record the transformation in `integrationNotes` so reviewers can audit the goal you held yourself to. Looping against a concrete success criterion is what separates self-verified work from work that "looks right."

**Don't rely solely on verification-agent.** Catching problems in-agent saves an entire round-trip — that's agent budget and wall-clock time.

## 5. TDD Red-Green Gate

**Write stubs first. Confirm they fail. Then implement. Confirm they pass.**

The implementer-agent follows a strict red-green lifecycle when test stubs are part of the deliverable. Skipping any state is a protocol violation.

### State Machine

```
stub-written → red-confirmed → implementing → green-confirmed
```

1. **stub-written** — Write test stubs (or receive them from a prior wave). Tests must be syntactically valid and runnable but are expected to fail because the production code does not yet exist or is incomplete.
2. **red-confirmed** — Run the test suite. Every stub MUST fail. If any stub passes before implementation, the stub is wrong (it tests nothing) or the feature already exists. Investigate before proceeding. Record the failing test count in your progress file.
3. **implementing** — Write the production code to satisfy the stubs. Stay within file ownership boundaries. Do not modify the test stubs during this phase unless a stub has a genuine defect (document in `issues` if so).
4. **green-confirmed** — Run the test suite again. Every previously-failing stub MUST now pass. If any stub still fails, fix the production code (not the test) until green. Record the passing test count in `diagnoseLog`.

### Rules

- **No skipping red.** If you cannot run tests (e.g., missing test runner, external dependency), set `verificationStatus: unverified` in your AgentResult and document why in `integrationNotes`. Never claim `verified` without actually running tests.
- **No editing stubs to make them pass.** If a stub is wrong, report it via `contractAmendments`. The only acceptable stub modification is fixing a genuine defect in the test itself (wrong import path, typo in fixture data).
- **Progress reporting.** Update your progress file at each state transition: `phase: "red-confirmed"` after confirming failure, `phase: "implementing"` during implementation, `phase: "green-confirmed"` after confirming passage.

### Example Progress Update (red-confirmed)

```toon
taskId: w1-auth-service
agent: implementer-agent
wave: 1
phase: red-confirmed
percentComplete: 25
currentActivity: "All 6 test stubs fail as expected. Beginning implementation."
filesWritten[N]:
issuesSoFar[0]:
heartbeatAt: 2026-04-18T10:32:00Z
startedAt: 2026-04-18T10:30:00Z
checkpointCount: 2
```

## 6. Diagnose Before Fix

**Never apply a fix without first documenting the diagnosis.**

The fixer-agent follows a strict diagnose-then-fix protocol. Jumping straight to a code change without understanding the root cause leads to symptom-masking patches that break downstream.

### Sequence

1. **Read the finding.** Parse the issue from the verification-agent or convergence-driver output. Understand exactly what failed, where, and what the expected behavior was.
2. **Query wiki for architectural constraints.** Before forming a diagnosis, query the project wiki (`/loom-wiki query`) for architectural decisions, conventions, or constraints that may affect the fix. Fixes that violate architectural constraints create new bugs.
3. **Diagnose root cause.** Determine WHY the failure occurred, not just WHAT failed. Distinguish between:
   - **Specification gap** — the spec was ambiguous and the implementer made a reasonable but wrong assumption
   - **Implementation bug** — the spec was clear but the code is wrong
   - **Contract mismatch** — the contract (types, schema) does not match what downstream consumers expect
   - **Environment issue** — test flake, missing dependency, configuration drift
4. **Write diagnosis to `diagnoseLog`.** Before making any code changes, write your diagnosis narrative to the `diagnoseLog` field in your AgentResult. This field is read by reviewers and downstream agents. Include:
   - What the finding reported
   - What architectural constraints were found (from wiki query)
   - What the root cause is
   - What fix you intend to apply and why
5. **Apply the fix.** Now — and only now — make the code change. Stay within file ownership boundaries.
6. **Verify the fix.** Run the relevant tests to confirm the finding is resolved and no regressions were introduced. Set `verificationStatus` accordingly.

### Rules

- **diagnoseLog is mandatory for fixer-agent.** A fixer-agent AgentResult with an empty `diagnoseLog` is a protocol violation. The convergence-driver should flag this.
- **Wiki query is not optional.** Even if the fix seems obvious, check for constraints. A 10-second query prevents a multi-wave regression.
- **No speculative fixes.** If you cannot determine the root cause, set `status: partial` and describe what you tried in `diagnoseLog`. Do not apply a guess-fix and hope.

### Example diagnoseLog

```toon
diagnoseLog: "Finding: integration test auth-flow-003 fails with 'TypeError: user.role is undefined'. Wiki query for 'user role schema' returned architectural decision AD-012 requiring role to be an enum, not a string. Root cause: Wave 1 implementer used string type for user.role in src/auth/types.ts, but the contract in .plan-execution/contracts/user.schema.toon specifies role as enum(admin,member,viewer). Fix: change type of role field in src/auth/types.ts from string to the RoleEnum type exported by the contract. This aligns with AD-012 and the contract."
```

## 7. Hard Verification Gate

**Every AgentResult must include `verificationStatus`. Unverified results trigger warnings.**

Self-verification is not optional. Agents that return results without checking their own work create downstream waste — the verification-agent catches the same issues but at higher cost (a full agent spawn and round-trip).

### verificationStatus Field

The `verificationStatus` field in the AgentResult envelope (defined in `agent-result.schema.md`) has three valid values:

| Value | Meaning | Convergence-Driver Behavior |
|-------|---------|----------------------------|
| `verified` | Agent ran tests/checks and confirmed all acceptance criteria pass | Result accepted normally |
| `unverified` | Agent produced output but did not verify it | Convergence-driver logs a WARNING. The result is accepted but flagged for priority verification by the verification-agent. |
| `skipped` | Verification was intentionally skipped with documented justification | Convergence-driver logs an INFO. Justification must appear in `integrationNotes`. Acceptable for contracts-only waves or documentation-only tasks. |

### Rules

1. **Default is `unverified`.** If an agent omits `verificationStatus` or returns an empty value, the convergence-driver treats it as `unverified` and logs a warning.
2. **`verified` requires evidence.** An agent claiming `verified` must have actually run a verification step (test suite, type-check, acceptance criteria check). The `diagnoseLog` field should describe what was verified. Claiming `verified` without running checks is a protocol violation.
3. **`skipped` requires justification.** The `integrationNotes` field must explain why verification was skipped. Valid justifications include: contracts-only wave (no runnable code), documentation-only task, external dependency unavailable. "Ran out of budget" is NOT a valid justification — report it as an issue instead.
4. **Convergence-driver enforcement.** The convergence-driver MUST:
   - Accept `verified` results and proceed normally
   - Log a WARNING for `unverified` results and prioritize them for verification-agent review
   - Log an INFO for `skipped` results with justification present
   - Log a WARNING for `skipped` results with no justification (treat as `unverified`)
5. **Self-verification checklist.** Before setting `verificationStatus: verified`, the agent should confirm:
   - All acceptance criteria from the task prompt have been checked
   - All files in `filesCreated` and `filesModified` exist and are syntactically valid
   - Any test stubs that were part of the task pass (TDD Red-Green Gate, section 5)
   - No regressions in existing tests that the agent can run

### Relationship to Convergence Tiers

The Hard Verification Gate operates at the individual agent level (below the wave tier in `convergence-tier.schema.md`). It is the first line of defense. The convergence tier system (unit at wave level, integration at feature level, etc.) provides the second and third lines. An agent that self-verifies reduces the load on tier-level verification runners.

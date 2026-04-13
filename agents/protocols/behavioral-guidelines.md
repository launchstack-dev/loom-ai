# Behavioral Guidelines

Behavioral guardrails for all Loom agents, derived from [Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on common LLM coding mistakes. Agents with identified gaps reference this document in their instructions.

## 1. Think Before Coding — Surface Assumptions

**Don't guess silently. State what you inferred.**

- If the spec is ambiguous about types, error behavior, or edge cases, report it as an `info` issue in your AgentResult rather than assuming.
- If multiple interpretations exist, pick the simplest but document your choice in `integrationNotes`.
- If you're building on something from a prior wave, state what you expect to be true about it.

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

**Don't rely solely on verification-agent.** Catching problems in-agent saves an entire round-trip — that's agent budget and wall-clock time.

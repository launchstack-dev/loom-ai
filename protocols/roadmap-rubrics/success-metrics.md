# Rubric: Success Metrics

Success Metrics define the project-level outcomes that determine whether the roadmap was a success. A strong metric has a **name**, a **target value**, and a **measurement method** that references a concrete tool or command. Metrics must be objectively measurable — no "good performance" or "reliable" — and they feed directly into PLAN.md acceptance criteria during plan generation. The set of metrics should cover both correctness (does it work?) and quality (is it well-built?) dimensions.

## Green

> "| Metric | Target | Measurement |
> |--------|--------|-------------|
> | API response time | p95 < 200ms on /api/* endpoints | `vitest bench` suite under `tests/bench/` |
> | Test coverage | > 80% lines, > 70% branches | `vitest --coverage` (V8 reporter) |
> | Type safety | Zero `any` types in `src/**` | `npx tsc --noEmit --strict` plus `eslint --rule no-explicit-any:error` |
> | Schema validation | 100% of endpoints validated via Zod | `tests/contract/zod-coverage.test.ts` enumerates routes and asserts presence |"

This is green because every metric names a target value with explicit units or thresholds, and a measurement column that points at a runnable command or test file. The metrics span correctness (schema validation), performance (p95 latency), and code quality (coverage, type safety). A criteria-planner-agent reading this can transcribe each row into a phase-level acceptance criterion verbatim. A reviewer can independently re-run the measurement column and verify whether the target is met.

## Yellow

> "| Metric | Target |
> |--------|--------|
> | Performance | Fast |
> | Tests | Lots of coverage |
> | Code quality | High |"

This is yellow because the metric names are present but the targets are subjective adjectives ("Fast", "High") and the measurement column is missing entirely. Downstream agents cannot derive acceptance criteria from "Fast" — fast at what percentile, on what endpoint, under what load? Reviewer should echo: "every metric needs a numeric target with units and a measurement command — name the percentile, the threshold, and the tool that produces the number."

## Red

> "Success means the project ships and users are happy."

This is red because no metric is named, no target is specified, and no measurement method exists. There is nothing for the plan-builder-agent to translate into acceptance criteria, nothing for the verification-agent to check, and nothing for a reviewer to gate against. The roadmap effectively has no definition of done. Reviewer must mark as blocking and require at least two measurable metrics (the schema minimum) before downstream dimensions are evaluated.

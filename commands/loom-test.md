---
description: "Run tests; with --autoconverge, drive fix→test→fix until convergence"
---

# Loom Test

Test runner wrapper. With `--autoconverge`, generates a `converge.config.toon` for F-02 (test-run convergence) and dispatches `/loom-converge` so a failing test suite is iteratively fixed by `fixer-agent` until convergence.

Without `--autoconverge`, this command is a thin pass-through that invokes `scripts/test-harness.ts` once and reports the parsed findings.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `test`:

If arguments are empty or equal `--help`, print the following help text and stop:

```
/loom-test [flags] [<subject>]

Run tests against a subject (file or directory). With --autoconverge, iterate
fix→test→fix via /loom-converge until blockingCount == 0 or maxIterations is hit.

Flags:
  --subject <path>          Subject under test (required when not positional)
  --runner <kind>           bun | vitest | pytest (default: bun)
  --autoconverge            Generate converge.config and dispatch /loom-converge
  --max-iterations <N>      Override maxIterations (default: 5)
  --output <path>           Where the harness writes findings.toon
                            (default: .plan-execution/convergence/findings.toon)
  --output-dir <path>       Convergence working dir (default: .plan-execution/convergence/)
  --iteration <N>           Single-shot mode only: pass a 1-indexed iteration number

Examples:
  /loom-test --subject test/fixtures/foo --runner bun
  /loom-test --autoconverge --subject src --runner vitest
  /loom-test --autoconverge --subject tests --runner pytest --max-iterations 3
```

### Instructions

#### Step 1: Flag Parsing

Parse arguments left-to-right. Track:

- `subject` — from `--subject <path>` or the first positional argument
- `runner` — from `--runner <kind>` (default: `bun`); MUST be one of `bun`, `vitest`, `pytest`
- `autoconverge` — boolean flag (`--autoconverge`)
- `maxIterations` — from `--max-iterations <N>` (default: `5`); positive integer
- `output` — from `--output <path>` (default: `.plan-execution/convergence/findings.toon`)
- `outputDir` — from `--output-dir <path>` (default: `.plan-execution/convergence/`)
- `iteration` — from `--iteration <N>` (single-shot mode only; default: `1`)

If `--subject` is missing AND no positional subject is supplied, print:

```
error: --subject <path> is required
```

and stop with exit code 1.

If `--runner` is supplied but not one of `bun|vitest|pytest`, print:

```
error: --runner must be one of bun|vitest|pytest (got '<value>')
```

and stop with exit code 1.

#### Step 2: Single-shot mode (no `--autoconverge`)

If `--autoconverge` is NOT set:

1. Invoke the harness directly via Bash:

   ```bash
   bun run scripts/test-harness.ts \
     --subject <subject> \
     --runner <runner> \
     --iteration <iteration> \
     --output <output>
   ```

2. Read the emitted `findings.toon` and report:

   - Total `blockingCount`
   - Each failing test row (file, anchor, summary)

3. Stop. Do NOT dispatch `/loom-converge` and do NOT spawn `fixer-agent`.

#### Step 3: Autoconverge mode (with `--autoconverge`)

If `--autoconverge` is set, generate a `converge.config.toon` per the locked
schema (`protocols/converge.config.schema.md`) and per the F-02
field-value matrix in `protocols/converge.config.applications.md`.

**Spawn-count contract:** Per F-02 acceptance, the per-iteration spawn budget
is exactly 2 agents (1 test-harness invocation + 1 fixer-agent). At
`maxIterations=5`, the total ceiling is `1 + 5×2 = 11` agent spawns. The
wrapper MUST set `agentBudget = 1 + (maxIterations × 2)` so the
`convergence-driver` enforces this cap.

##### Step 3a: Generate converge.config

Compose a TOON document and atomically write it to
`<outputDir>/converge.config.toon` (write to `.tmp`, rename). The fields:

| Field | Value | Source |
|---|---|---|
| `runId` | `conv-{YYYY-MM-DD-HH-mm-ss}-{NNN}` (timestamp + 3-digit sequence) | wrapper-generated |
| `convergenceMode` | `document` | F-02 binding |
| `subject` | `<subject>` | CLI |
| `harness` | `scripts/test-harness.ts` | F-02 binding |
| `integrator` | `fixer-agent` | F-02 binding |
| `maxIterations` | `<maxIterations>` (default 5) | CLI |
| `agentBudget` | `1 + (maxIterations × 2)` (so default = 11) | F-02 spawn ceiling |
| `snapshotEnabled` | `true` | document-mode default (DF-02) |
| `outputDir` | `<outputDir>` | CLI |
| `runner` | `<runner>` | F-02 binding |

Example (subject = `test/fixtures/test-harness/converges-in-2-iters/src`,
runner = `bun`, maxIterations = 5):

```toon
runId: conv-2026-06-14-12-30-00-001
convergenceMode: document
subject: test/fixtures/test-harness/converges-in-2-iters/src
harness: scripts/test-harness.ts
integrator: fixer-agent
maxIterations: 5
agentBudget: 11
snapshotEnabled: true
outputDir: .plan-execution/convergence/
runner: bun
```

##### Step 3b: Dispatch /loom-converge

After writing the config, invoke:

```
/loom-converge --config <outputDir>/converge.config.toon --mode document
```

The driver reads `converge.config.toon`, runs the loop, and writes
`convergence-summary.toon` at termination. Per F-02 acceptance, the fixture at
`test/fixtures/test-harness/converges-in-2-iters/` MUST converge in exactly 2
iterations.

#### Step 4: Reporting

When `/loom-converge` returns:

- Read `convergence-summary.toon` from `<outputDir>/`.
- Print the final status (`converged` | `max-iterations` | `budget-exhausted`),
  iteration count, and final `blockingCount`.
- Exit with code 0 if `status == converged`; non-zero otherwise.

### Error Handling

| Symptom | Cause | Response |
|---|---|---|
| `RUNNER_OUTPUT_UNPARSEABLE` | Runner version emits a format the parser does not recognize | Surface the AgentResult at `<outputDir>/test-harness.agent-result.toon` to the operator. Halt; the driver records the failure and does NOT retry indefinitely. |
| `runner '<cmd>' not found on PATH (ENOENT)` | Runner binary missing | Stop with exit code 2 and ask the user to install the runner. |
| `MAX_ITERATIONS` | Loop hit `maxIterations` without converging | Print final `blockingCount` and the last 3 finding summaries; suggest increasing `--max-iterations` or inspecting the diff. |
| `BUDGET_EXHAUSTED` | Driver hit `agentBudget` | Indicates a wrapper bug (the ceiling formula is `1 + maxIterations×2`); report and halt. |

### Cross-references

- `scripts/test-harness.ts` — the harness this wrapper drives
- `scripts/lib/test-runners/{bun,vitest,pytest}.ts` — output parsers
- `protocols/converge.config.schema.md` — canonical config schema (locked)
- `protocols/converge.config.applications.md` — F-02 field-value matrix
- `protocols/findings.applications-rows.md` — F-02 row variant
- `commands/loom-converge.md` — the driver dispatched in autoconverge mode

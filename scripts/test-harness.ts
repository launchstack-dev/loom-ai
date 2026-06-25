#!/usr/bin/env -S bun run
/**
 * F-02 test-run convergence harness.
 *
 * Mode:     `convergenceMode: document` per `protocols/converge.config.applications.md`
 * Output:   `ConvergenceFindings` TOON per `protocols/findings.schema.md`
 *           (F-02 row variant per `protocols/findings.applications-rows.md`).
 *
 * Pattern:
 *
 *   1. Shell out to the selected runner (`bun test`, `vitest run`, `pytest -q`).
 *   2. Capture stdout/stderr/exit-code.
 *   3. Parse runner output via the adapter under `scripts/lib/test-runners/`.
 *   4. Emit one `findings.toon` row per failure (severity: blocking,
 *      reviewerAgent: <runner>, locationAnchor: "{describe chain} > {it name}",
 *      summary: ANSI-stripped first failure line).
 *
 * Locked decisions wired:
 *
 *   - F-02 binding (`converge.config.applications.md`): `runner` ∈ {bun,vitest,pytest},
 *     `integrator: fixer-agent`, `maxIterations: 5`, `mode: document`.
 *   - W-01 (ISO 8601 ms-precision): every `producedAt` is `Date#toISOString()`.
 *   - S-03 (`RUNNER_OUTPUT_UNPARSEABLE`): when the runner output matches
 *     none of the expected patterns we emit an AgentResult TOON next to the
 *     findings file and exit 2.
 *
 * Spawn-count contract (per Phase 2 AC):
 *
 *   - Per iteration: 1 (this harness) + 1 (fixer-agent) = 2.
 *   - At maxIterations=5: 1 (initial driver) + 5×2 = 11 total. Asserted in
 *     `test/test-harness.test.ts`.
 *
 * Usage:
 *
 *   bun run scripts/test-harness.ts \
 *     --subject <src-path> \
 *     --runner <bun|vitest|pytest> \
 *     --iteration <N> \
 *     [--output <findings.toon path>]
 *
 * Exit codes:
 *
 *   0 — runner ran (test failures are findings, not infra errors).
 *   1 — argument error.
 *   2 — runner output unparseable (RUNNER_OUTPUT_UNPARSEABLE per S-03)
 *       OR runner binary not found / crashed before producing parseable output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { bunRunner } from "./lib/test-runners/bun.js";
import { vitestRunner } from "./lib/test-runners/vitest.js";
import { pytestRunner } from "./lib/test-runners/pytest.js";
import {
  type RunnerKind,
  type TestFailure,
  type TestRunner,
} from "./lib/test-runners/types.js";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  subject: string;
  runner: RunnerKind;
  iteration: number;
  output: string;
}

const DEFAULT_OUTPUT = ".plan-execution/convergence/findings.toon";

export function parseArgs(
  argv: string[],
  exit: (code: number) => never = ((c: number) => process.exit(c)) as never,
): CliArgs {
  const userArgs = argv.slice(2);
  let subject: string | undefined;
  let runnerRaw: string | undefined;
  let iterationRaw: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    switch (arg) {
      case "--subject":
        subject = userArgs[++i];
        break;
      case "--runner":
        runnerRaw = userArgs[++i];
        break;
      case "--iteration":
        iterationRaw = userArgs[++i];
        break;
      case "--output":
        output = userArgs[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        process.stderr.write(`error: unrecognized argument '${arg}'\n`);
        printUsage();
        exit(1);
    }
  }

  if (!subject) {
    process.stderr.write("error: --subject <path> is required\n");
    exit(1);
  }
  if (!runnerRaw) {
    process.stderr.write("error: --runner <bun|vitest|pytest> is required\n");
    exit(1);
  }
  if (runnerRaw !== "bun" && runnerRaw !== "vitest" && runnerRaw !== "pytest") {
    process.stderr.write(
      `error: --runner must be one of bun|vitest|pytest (got '${runnerRaw}')\n`,
    );
    exit(1);
  }
  if (iterationRaw === undefined) {
    process.stderr.write("error: --iteration <N> is required\n");
    exit(1);
  }
  const iteration = Number(iterationRaw);
  if (!Number.isInteger(iteration) || iteration < 0) {
    process.stderr.write(
      `error: --iteration must be a non-negative integer (got ${iterationRaw})\n`,
    );
    exit(1);
  }

  return {
    subject: subject!,
    runner: runnerRaw as RunnerKind,
    iteration,
    output: output ?? DEFAULT_OUTPUT,
  };
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  bun run scripts/test-harness.ts \\",
      "    --subject <path> \\",
      "    --runner <bun|vitest|pytest> \\",
      "    --iteration <N> \\",
      "    [--output <findings.toon path>]",
      "",
      "Exit codes:",
      "  0 — wrote findings.toon (zero or more failures).",
      "  1 — argument error.",
      "  2 — runner output unparseable (RUNNER_OUTPUT_UNPARSEABLE).",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Runner registry
// ---------------------------------------------------------------------------

export const RUNNERS: Record<RunnerKind, TestRunner> = {
  bun: bunRunner,
  vitest: vitestRunner,
  pytest: pytestRunner,
};

// ---------------------------------------------------------------------------
// TOON encoding
// ---------------------------------------------------------------------------

/** CSV-quote a cell if it contains commas/quotes/newlines (RFC 4180-lite). */
function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export interface FindingRow {
  id: string;
  dimension: string;
  severity: "blocking";
  locationPath: string;
  locationAnchor: string;
  summary: string;
  suggestion: string;
  reviewerAgent: string;
}

export interface FindingsDoc {
  subject: string;
  harnessName: string;
  iteration: number;
  blockingCount: number;
  advisoryCount: number;
  producedAt: string;
  findings: FindingRow[];
}

/**
 * Build a `ConvergenceFindings` doc from parsed failures. Severity is always
 * `blocking` (F-02 row variant); `dimension` is the stable per-application
 * token `test` per `findings.applications-rows.md`.
 */
export function buildFindingsDoc(args: {
  subject: string;
  iteration: number;
  reviewerAgent: string;
  failures: TestFailure[];
  now: Date;
  summaryMaxLen?: number;
}): FindingsDoc {
  const max = args.summaryMaxLen ?? 200;
  const rows: FindingRow[] = args.failures.map((f, i) => ({
    id: `F-${String(i + 1).padStart(2, "0")}`,
    dimension: "test",
    severity: "blocking" as const,
    locationPath: f.file,
    locationAnchor: f.anchor,
    summary: clipSummary(f.summary, max),
    suggestion: "",
    reviewerAgent: args.reviewerAgent,
  }));

  return {
    subject: args.subject,
    harnessName: "test",
    iteration: args.iteration,
    blockingCount: rows.length,
    advisoryCount: 0,
    producedAt: args.now.toISOString(),
    findings: rows,
  };
}

function clipSummary(message: string, max: number): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

export function encodeFindingsToon(doc: FindingsDoc): string {
  const header = [
    `subject: ${doc.subject}`,
    `harnessName: ${doc.harnessName}`,
    `iteration: ${doc.iteration}`,
    `blockingCount: ${doc.blockingCount}`,
    `advisoryCount: ${doc.advisoryCount}`,
    `producedAt: ${doc.producedAt}`,
    "",
  ];
  const arrayHeader = `findings[${doc.findings.length}]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:`;
  const rows = doc.findings.map((f) => {
    const cells = [
      f.id,
      f.dimension,
      f.severity,
      f.locationPath,
      f.locationAnchor,
      f.summary,
      f.suggestion,
      f.reviewerAgent,
    ].map(csvQuote);
    return `  ${cells.join(",")}`;
  });
  return [...header, arrayHeader, ...rows, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

export function atomicWriteFile(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, absPath);
}

// ---------------------------------------------------------------------------
// AgentResult emission for RUNNER_OUTPUT_UNPARSEABLE (S-03)
// ---------------------------------------------------------------------------

/**
 * Emit an AgentResult TOON envelope next to the findings file with
 * `errors[].code = RUNNER_OUTPUT_UNPARSEABLE` per S-03 acceptance. The path is
 * `<output-dir>/test-harness.agent-result.toon` so the driver can pick it up
 * via a stable name.
 */
export function writeUnparseableAgentResult(args: {
  outputPath: string;
  runner: RunnerKind;
  subject: string;
  iteration: number;
  stdoutPreview: string;
  stderrPreview: string;
  exitCode: number;
  now: Date;
}): string {
  const dir = path.dirname(path.resolve(args.outputPath));
  const arPath = path.join(dir, "test-harness.agent-result.toon");
  const preview = (args.stdoutPreview + "\n" + args.stderrPreview)
    .slice(0, 500)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const text = [
    `agent: test-harness`,
    `status: failure`,
    `wave: 0`,
    `taskId: test-harness-iter-${args.iteration}`,
    `producedAt: ${args.now.toISOString()}`,
    `subject: ${args.subject}`,
    `runner: ${args.runner}`,
    `runnerExitCode: ${args.exitCode}`,
    ``,
    `errors[1]{code,message,detail}:`,
    `  RUNNER_OUTPUT_UNPARSEABLE,Runner ${args.runner} produced output that did not match any expected pattern,${csvQuote(preview)}`,
    ``,
  ].join("\n");
  atomicWriteFile(arPath, text);
  return arPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Override spawnSync for tests. */
  spawn?: typeof spawnSync;
  /** Injected clock for determinism in tests. */
  now?: () => Date;
}

export function runHarness(
  args: CliArgs,
  exit: (code: number) => never,
  opts: RunOptions = {},
): void {
  const runner = RUNNERS[args.runner];
  const spawn = opts.spawn ?? spawnSync;
  const now = opts.now ?? (() => new Date());

  const { cmd, args: spawnArgs } = runner.buildCommand(args.subject);
  const result = spawn(cmd, spawnArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    // Inherit env so PATH-resolved runners (npx, pytest) work.
    env: process.env,
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write(
      `error: runner '${cmd}' not found on PATH (ENOENT)\n`,
    );
    writeUnparseableAgentResult({
      outputPath: args.output,
      runner: args.runner,
      subject: args.subject,
      iteration: args.iteration,
      stdoutPreview: "",
      stderrPreview: `ENOENT: ${cmd}`,
      exitCode: -1,
      now: now(),
    });
    return exit(2);
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : -1;

  const parsed = runner.parse(stdout, stderr, exitCode);

  if (!parsed.parseable) {
    process.stderr.write(
      `error: runner output unparseable (RUNNER_OUTPUT_UNPARSEABLE) — runner=${args.runner}, exit=${exitCode}\n`,
    );
    writeUnparseableAgentResult({
      outputPath: args.output,
      runner: args.runner,
      subject: args.subject,
      iteration: args.iteration,
      stdoutPreview: stdout,
      stderrPreview: stderr,
      exitCode,
      now: now(),
    });
    return exit(2);
  }

  const doc = buildFindingsDoc({
    subject: args.subject,
    iteration: args.iteration,
    reviewerAgent: runner.name,
    failures: parsed.failures,
    now: now(),
  });

  const outAbs = path.resolve(args.output);
  atomicWriteFile(outAbs, encodeFindingsToon(doc));
  process.stderr.write(
    `wrote ${args.output} (blockingCount=${doc.blockingCount}, runner=${args.runner}, iteration=${args.iteration})\n`,
  );
  return exit(0);
}

export function main(
  argv: string[] = process.argv,
  exit: (code: number) => never = ((c: number) => process.exit(c)) as never,
  opts: RunOptions = {},
): void {
  const args = parseArgs(argv, exit);
  runHarness(args, exit, opts);
}

// Direct-invocation detection (parallels plan-review-harness).
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = typeof __filename !== "undefined" ? __filename : "";
  if (!here) return false;
  return path.resolve(entry) === here;
}

if (typeof __filename !== "undefined" && isInvokedDirectly()) {
  main();
}

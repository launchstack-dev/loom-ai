#!/usr/bin/env -S bun run
/**
 * Debug-mode convergence harness (F-03).
 *
 * Mode:     `convergenceMode: document` per `protocols/converge.config.applications.md`.
 * Output:   `ConvergenceFindings` TOON per `protocols/findings.schema.md`.
 * Row variants: `protocols/findings.applications-rows.md` § F-03.
 *
 * Pipeline (per iteration):
 *
 *   1. Invoke debug-investigator-agent against (symptom, subject); collect
 *      probable-cause findings as `AgentResult.issues[]`.
 *   2. Re-run the symptom (executes `--symptom` directly as a shell script if
 *      it ends in `.sh`, otherwise as a `bun test` invocation).
 *   3. If the symptom STILL reproduces (re-run exits non-zero), APPEND a
 *      synthetic blocking row (`F-99 / "symptom still reproduces" /
 *      reviewerAgent=debug-harness`) per `scripts/lib/debug-harness/synthetic-symptom.ts`.
 *   4. If the symptom no longer reproduces, the synthetic row is OMITTED. If
 *      the investigator also produced no `blocking` rows, `blockingCount → 0`
 *      and the driver declares CONVERGED via the existing terminal check.
 *   5. Atomically write `findings.toon` to `--output` (default
 *      `.plan-execution/convergence/findings.toon`).
 *   6. Exit 0 in all converging/diverging cases (the driver reads
 *      `findings.toon` to decide what to do next). Non-zero exit is reserved
 *      for argument errors and invariant violations.
 *
 * Investigator results resolution (in priority order):
 *
 *   1. `--investigator-results <path>` (explicit, aggregate mode)
 *   2. `<symptom-dir>/investigator-results.toon` (fixture convention; used by
 *      `test/fixtures/debug/converges-in-2-iters/`)
 *   3. None — the harness writes ONLY the synthetic row when the symptom
 *      reproduces (degenerate but valid; emits a stderr warning).
 *
 * Synthetic-row contract per OQ-01 (locked): `convergence-summary.schema.md`
 * MUST NOT gain any new termination-outcome field. The synthetic row is the
 * mechanism by which the existing `blockingCount == 0` terminal check carries
 * the debug-mode semantics (see findings.applications-rows.md § F-03).
 *
 * Usage:
 *
 *   bun run scripts/debug-harness.ts \
 *     --symptom <path> \
 *     --subject <path> \
 *     --iteration <N> \
 *     [--output <path>] \
 *     [--investigator-results <path>]
 *
 * Exit codes:
 *
 *   0 — wrote findings.toon (regardless of whether symptom converged).
 *   1 — argument error or invariant violation.
 *   2 — symptom path resolution error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  encodeFindingsToToon,
  severityToConvergenceSeverity,
  type AgentIssueSeverity,
  type ConvergenceFinding,
  type ConvergenceFindings,
} from "./lib/aggregate-findings.js";

import {
  buildSyntheticSymptomRow,
  F03_DIMENSION,
} from "./lib/debug-harness/synthetic-symptom.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  symptom: string;
  subject: string;
  iteration: number;
  output: string;
  investigatorResults?: string;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  bun run scripts/debug-harness.ts \\",
      "    --symptom <path> \\",
      "    --subject <path> \\",
      "    --iteration <N> \\",
      "    [--output <path>] \\",
      "    [--investigator-results <path>]",
      "",
    ].join("\n"),
  );
}

function parseArgs(
  argv: string[],
  exit: (code: number) => never,
): CliArgs {
  const userArgs = argv.slice(2);
  let symptom: string | undefined;
  let subject: string | undefined;
  let iterationRaw: string | undefined;
  let output: string | undefined;
  let investigatorResults: string | undefined;

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    switch (arg) {
      case "--symptom":
        symptom = userArgs[++i];
        break;
      case "--subject":
        subject = userArgs[++i];
        break;
      case "--iteration":
        iterationRaw = userArgs[++i];
        break;
      case "--output":
        output = userArgs[++i];
        break;
      case "--investigator-results":
        investigatorResults = userArgs[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        process.stderr.write(`error: unknown argument: ${arg}\n`);
        printUsage();
        exit(1);
    }
  }

  if (!symptom) {
    process.stderr.write("error: --symptom <path> is required\n");
    printUsage();
    exit(1);
  }
  if (!subject) {
    process.stderr.write("error: --subject <path> is required\n");
    printUsage();
    exit(1);
  }
  if (iterationRaw === undefined) {
    process.stderr.write("error: --iteration <N> is required\n");
    printUsage();
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
    symptom: symptom!,
    subject: subject!,
    iteration,
    output: output ?? ".plan-execution/convergence/findings.toon",
    investigatorResults,
  };
}

// ---------------------------------------------------------------------------
// Symptom re-run
// ---------------------------------------------------------------------------

/**
 * Re-run the symptom and return `true` if it STILL reproduces (non-zero exit),
 * `false` if it no longer reproduces (zero exit).
 *
 * Heuristic: `.sh` files run as shell scripts; everything else falls back to
 * `bun test <path>` (works for both `.test.ts` and `.test.js`). The fixture
 * convention is to ship a `repro.sh`.
 */
export function reproduceSymptom(symptomPath: string): boolean {
  const absSymptom = path.resolve(symptomPath);
  if (!fs.existsSync(absSymptom)) {
    process.stderr.write(
      `error: --symptom path does not exist: ${absSymptom}\n`,
    );
    process.exit(2);
  }

  const isShellScript = absSymptom.endsWith(".sh");
  const cmd = isShellScript ? "bash" : "bun";
  const args = isShellScript ? [absSymptom] : ["test", absSymptom];

  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  // Non-zero exit (or spawn failure) means the symptom STILL reproduces.
  return result.status !== 0;
}

// ---------------------------------------------------------------------------
// Investigator results reader
// ---------------------------------------------------------------------------

/**
 * Narrow subset of AgentResult.issues[] the harness consumes. Mirrors the
 * fields the F-03 row variant references in
 * `findings.applications-rows.md` § F-03.
 */
interface InvestigatorIssue {
  severity: AgentIssueSeverity;
  file?: string;
  location?: string;
  description: string;
  suggestion?: string;
}

/**
 * Parse an investigator-results TOON file. Reads the `issues[]` typed-array.
 *
 * Accepted shapes (both work):
 *   issues[N]{severity,file,location,description,suggestion}:
 *     blocking,src/buggy.ts,:10,"missing null check","add `if (!x) return;`"
 *
 *   issues[N]{severity,description,file,location,suggestion}:
 *     ...
 *
 * Column order is determined by the header. The reader is permissive and
 * picks columns by name.
 */
export function readInvestigatorResults(
  filePath: string,
): InvestigatorIssue[] {
  const absPath = path.resolve(filePath);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read investigator-results at ${absPath}: ${(err as Error).message}`,
    );
  }
  return parseInvestigatorResults(text);
}

/**
 * Pure parser separated from I/O for testability.
 * Handles a minimal TOON typed-array slice; tolerates other top-level keys.
 */
export function parseInvestigatorResults(toonText: string): InvestigatorIssue[] {
  const lines = toonText.split("\n");
  let columns: string[] | null = null;
  const issues: InvestigatorIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^issues\[(\d+)\]\{([^}]+)\}:\s*$/);
    if (headerMatch) {
      columns = headerMatch[2].split(",").map((c) => c.trim());
      // Subsequent indented rows are issue rows.
      for (let j = i + 1; j < lines.length; j++) {
        const row = lines[j];
        if (!row.startsWith("  ")) break;
        const trimmed = row.trim();
        if (!trimmed) continue;
        const cells = splitCsvRow(trimmed);
        if (cells.length !== columns.length) {
          throw new Error(
            `investigator-results row column-count mismatch at line ${j + 1}: expected ${columns.length}, got ${cells.length}`,
          );
        }
        const record: Record<string, string> = {};
        for (let k = 0; k < columns.length; k++) {
          record[columns[k]] = cells[k];
        }
        const severity = record.severity as AgentIssueSeverity;
        if (!severity) {
          throw new Error(
            `investigator-results row missing severity at line ${j + 1}`,
          );
        }
        const description = record.description ?? record.summary ?? "";
        if (!description) {
          throw new Error(
            `investigator-results row missing description at line ${j + 1}`,
          );
        }
        issues.push({
          severity,
          file: record.file || undefined,
          location: record.location || undefined,
          description,
          suggestion: record.suggestion || undefined,
        });
      }
      break;
    }
  }
  return issues;
}

/**
 * Minimal CSV row splitter. Honors double-quoted cells with `""` escapes
 * (RFC 4180 / TOON typed-array convention).
 */
function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === ",") {
        cells.push(current);
        current = "";
      } else if (c === '"' && current === "") {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  cells.push(current);
  return cells;
}

// ---------------------------------------------------------------------------
// Findings construction
// ---------------------------------------------------------------------------

/**
 * Build the ConvergenceFindings object the harness writes per iteration.
 *
 * Iteration semantics: the harness CLI accepts iteration 0 for compatibility
 * with the fixture-driven AC, but `findings.schema.md` requires `iteration >= 1`.
 * We clamp to `max(iteration, 1)` so the emitted findings.toon validates.
 */
export function buildFindings(opts: {
  symptom: string;
  subject: string;
  iteration: number;
  investigatorIssues: InvestigatorIssue[];
  symptomReproduces: boolean;
  now?: () => Date;
}): ConvergenceFindings {
  const { symptom, subject, investigatorIssues, symptomReproduces } = opts;
  const now = opts.now ?? (() => new Date());
  const iteration = opts.iteration < 1 ? 1 : opts.iteration;

  const findings: ConvergenceFinding[] = [];
  let nextId = 1;

  for (const issue of investigatorIssues) {
    const severity = severityToConvergenceSeverity(issue.severity);
    if (severity === "advisory") {
      // The aggregator's severity mapping never produces `advisory`; defend
      // against an upstream change by failing loudly.
      throw new Error(
        `unexpected 'advisory' severity from investigator (id F-${String(nextId).padStart(2, "0")})`,
      );
    }
    const finding: ConvergenceFinding = {
      id: `F-${String(nextId++).padStart(2, "0")}`,
      // F-03 dimension token per `findings.applications-rows.md`.
      dimension: F03_DIMENSION as unknown as ConvergenceFinding["dimension"],
      severity,
      locationPath: issue.file ?? subject,
      locationAnchor: issue.location ?? "",
      summary: issue.description.replace(/\s+/g, " ").trim().slice(0, 200),
      reviewerAgent:
        "debug-investigator-agent" as unknown as ConvergenceFinding["reviewerAgent"],
    };
    if (issue.suggestion) {
      finding.suggestion = issue.suggestion;
    }
    findings.push(finding);
  }

  if (symptomReproduces) {
    findings.push(buildSyntheticSymptomRow(symptom));
  }

  // Recompute counts and enforce schema invariants.
  let blockingCount = 0;
  let advisoryCount = 0;
  for (const f of findings) {
    if (f.severity === "blocking") {
      blockingCount++;
    } else if (f.severity === "warning" || f.severity === "info") {
      advisoryCount++;
    }
  }

  return {
    subject,
    // Cast: schema's `harnessName` literal type is "plan-review" in the
    // aggregator module, but findings.schema.md allows any registered harness
    // name. F-03's harness is `debug-harness`.
    harnessName:
      "debug-harness" as unknown as ConvergenceFindings["harnessName"],
    iteration,
    blockingCount,
    advisoryCount,
    producedAt: now().toISOString(),
    findings,
  };
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

function atomicWrite(outputPath: string, contents: string): void {
  const absPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.tmp`;
  fs.writeFileSync(tmpPath, contents, "utf8");
  fs.renameSync(tmpPath, absPath);
}

// ---------------------------------------------------------------------------
// Investigator-results resolver
// ---------------------------------------------------------------------------

function resolveInvestigatorResultsPath(args: CliArgs): string | undefined {
  if (args.investigatorResults) {
    return path.resolve(args.investigatorResults);
  }
  // Fixture convention: sibling file next to the symptom.
  const symptomDir = path.dirname(path.resolve(args.symptom));
  const candidate = path.join(symptomDir, "investigator-results.toon");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv: string[]): number {
  const exit = ((code: number): never => {
    process.exit(code);
  }) as (code: number) => never;
  const args = parseArgs(argv, exit);

  // 1. Read investigator results (if any).
  let investigatorIssues: InvestigatorIssue[] = [];
  const resultsPath = resolveInvestigatorResultsPath(args);
  if (resultsPath) {
    try {
      investigatorIssues = readInvestigatorResults(resultsPath);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      return 1;
    }
  } else {
    process.stderr.write(
      "warning: no investigator-results file found; emitting findings without investigator rows.\n",
    );
  }

  // 2. Re-run the symptom.
  const symptomReproduces = reproduceSymptom(args.symptom);

  // 3. Build findings.
  const findings = buildFindings({
    symptom: args.symptom,
    subject: args.subject,
    iteration: args.iteration,
    investigatorIssues,
    symptomReproduces,
  });

  // 4. Atomic write.
  atomicWrite(args.output, encodeFindingsToToon(findings));

  return 0;
}

// Only run main when executed as a script (not when imported by tests).
// Bun sets `import.meta.main` to true for the entry-point module.
const isEntryPoint =
  // @ts-expect-error - Bun-specific import.meta extension
  (import.meta.main === true) ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(__filename));

if (isEntryPoint) {
  process.exit(main(process.argv));
}

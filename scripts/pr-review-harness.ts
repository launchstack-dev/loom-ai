#!/usr/bin/env -S bun run
/**
 * F-04 PR-review convergence dispatcher harness.
 *
 * Mode:     `convergenceMode: document` per
 *           `protocols/converge.config.schema.md`
 * Subject:  `.plan-execution/pr-review/pr-state.toon` (synthetic projection
 *           per OQ-02, refreshed by this harness each iteration)
 * Output:   `ConvergenceFindings` TOON per
 *           `protocols/findings.schema.md` with F-04 row variant per
 *           `protocols/findings.applications-rows.md`.
 *
 * Pattern: dispatcher — read `botAdapter` from converge.config, refresh
 * `pr-state.toon`, then delegate to the per-bot adapter under
 * `scripts/lib/pr-review-adapters/`.
 *
 * Usage:
 *
 *   bun run scripts/pr-review-harness.ts \
 *     --config <converge.config-path> \
 *     --iteration <N> \
 *     [--output <path>] \
 *     [--prior-findings <path>]
 *
 * Exit codes:
 *   0 — wrote findings.toon.
 *   1 — argument error, invariant violation, or unknown adapter
 *       (AgentResult issues[].description prefixed `CODE: ADAPTER_UNKNOWN`).
 *   2 — config/subject resolution error.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { geminiAdapter } from "./lib/pr-review-adapters/gemini.js";
import type {
  BotComment,
  BotCommentFetcher,
  ConvergenceFindings,
  PrReviewAdapter,
} from "./lib/pr-review-adapters/types.js";

import {
  buildPrState,
  writePrStateFile,
  defaultGhRunner,
  type GhRunner,
  type PrState,
} from "./lib/pr-review-harness/pr-state-writer.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const ADAPTERS: Record<string, PrReviewAdapter> = {
  gemini: geminiAdapter,
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  configPath: string;
  iteration: number;
  outputPath?: string;
  priorFindingsPath?: string;
}

export function parseArgs(
  argv: string[],
  exit: (code: number) => never,
): CliArgs {
  const userArgs = argv.slice(2);
  let configPath: string | undefined;
  let iterationRaw: string | undefined;
  let outputPath: string | undefined;
  let priorFindingsPath: string | undefined;

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    switch (arg) {
      case "--config":
        configPath = userArgs[++i];
        break;
      case "--iteration":
        iterationRaw = userArgs[++i];
        break;
      case "--output":
        outputPath = userArgs[++i];
        break;
      case "--prior-findings":
        priorFindingsPath = userArgs[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        if (arg?.startsWith("--")) {
          process.stderr.write(`unknown flag: ${arg}\n`);
          printUsage();
          exit(1);
        } else {
          process.stderr.write(
            `error: unrecognized positional argument '${arg}'\n`,
          );
          printUsage();
          exit(1);
        }
    }
  }

  if (!configPath) {
    process.stderr.write("error: --config <path> is required\n");
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
  return { configPath: configPath!, iteration, outputPath, priorFindingsPath };
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  bun run scripts/pr-review-harness.ts \\",
      "    --config <converge.config-path> \\",
      "    --iteration <N> \\",
      "    [--output <path>] \\",
      "    [--prior-findings <path>]",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// converge.config reader (minimal — only fields F-04 consumes)
// ---------------------------------------------------------------------------

export interface F04ConvergeConfig {
  mode?: string;
  subject?: string;
  harness?: string;
  integrator?: string;
  maxIterations?: number;
  botAdapter?: string;
  prNumber?: number;
  outputPath?: string;
  outputDir?: string;
}

export function readConvergeConfig(
  configPath: string,
  exit: (code: number) => never,
): F04ConvergeConfig {
  const absPath = path.resolve(configPath);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    process.stderr.write(
      `error: cannot read converge.config at ${absPath}: ${(err as Error).message}\n`,
    );
    return exit(2);
  }
  const config: F04ConvergeConfig = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\w+\[/.test(trimmed)) continue;
    if (line.startsWith("  ")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    switch (key) {
      case "mode":
      case "convergenceMode":
        config.mode = value;
        break;
      case "subject":
        config.subject = value;
        break;
      case "harness":
        config.harness = value;
        break;
      case "integrator":
        config.integrator = value;
        break;
      case "maxIterations": {
        const n = Number(value);
        if (Number.isInteger(n)) config.maxIterations = n;
        break;
      }
      case "botAdapter":
        config.botAdapter = value;
        break;
      case "prNumber": {
        const n = Number(value);
        if (Number.isInteger(n)) config.prNumber = n;
        break;
      }
      case "outputPath":
        config.outputPath = value;
        break;
      case "outputDir":
        config.outputDir = value;
        break;
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// AgentResult emitter (used for ADAPTER_UNKNOWN failure path)
// ---------------------------------------------------------------------------

interface AgentResultIssue {
  severity: "blocking" | "warning" | "info";
  description: string;
  file?: string;
}

export function emitAgentResult(args: {
  status: "success" | "failure";
  issues: AgentResultIssue[];
  filesCreated?: string[];
  destination?: NodeJS.WritableStream;
}): void {
  const dest = args.destination ?? process.stderr;
  const lines: string[] = [];
  lines.push("agent: pr-review-harness");
  lines.push(`status: ${args.status}`);
  const created = args.filesCreated ?? [];
  if (created.length === 0) {
    lines.push("filesCreated[0]:");
  } else {
    lines.push(`filesCreated[${created.length}]: ${created.join(", ")}`);
  }
  if (args.issues.length === 0) {
    lines.push("issues[0]:");
  } else {
    lines.push(`issues[${args.issues.length}]{severity,description,file}:`);
    for (const issue of args.issues) {
      lines.push(
        `  ${issue.severity},${csvQuote(issue.description)},${csvQuote(issue.file ?? "")}`,
      );
    }
  }
  lines.push("");
  dest.write(lines.join("\n"));
}

function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Atomic write + TOON encoder for ConvergenceFindings
// ---------------------------------------------------------------------------

export function atomicWriteFile(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, absPath);
}

export function encodeFindingsToToon(findings: ConvergenceFindings): string {
  const header = [
    `subject: ${findings.subject}`,
    `harnessName: ${findings.harnessName}`,
    `iteration: ${findings.iteration}`,
    `blockingCount: ${findings.blockingCount}`,
    `advisoryCount: ${findings.advisoryCount}`,
    `producedAt: ${findings.producedAt}`,
    "",
  ];
  const arrayHeader = `findings[${findings.findings.length}]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:`;
  const rows = findings.findings.map((f) => {
    const cells = [
      f.id,
      f.dimension,
      f.severity,
      f.locationPath,
      f.locationAnchor,
      f.summary,
      f.suggestion ?? "",
      f.reviewerAgent,
    ].map(csvQuote);
    return `  ${cells.join(",")}`;
  });
  return [...header, arrayHeader, ...rows, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Default output path resolution
// ---------------------------------------------------------------------------

function defaultOutputPath(iteration: number, outputDir?: string): string {
  const dir = outputDir
    ? outputDir
    : `.plan-execution/convergence/iterations/iter-${iteration}`;
  return path.join(dir, "findings.toon");
}

// ---------------------------------------------------------------------------
// Fetcher: wrap the gh-runner so the adapter sees a BotCommentFetcher
// ---------------------------------------------------------------------------

function makeFetcherFromState(state: PrState): BotCommentFetcher {
  // The adapter just needs an array of BotComment. We already collected them
  // in pr-state, so we project the rows verbatim.
  const comments: BotComment[] = state.comments.map((c) => ({
    path: c.path,
    line: c.line,
    body: c.body,
    id: c.id,
    author: c.author,
    createdAt: c.createdAt,
  }));
  return async () => comments;
}

// ---------------------------------------------------------------------------
// Main (dependency-injected for testing)
// ---------------------------------------------------------------------------

export interface RunOptions {
  argv?: string[];
  exit?: (code: number) => never;
  runner?: GhRunner;
  /** Override the adapter map (for tests). */
  adapters?: Record<string, PrReviewAdapter>;
  /** Override `now` for deterministic timestamps. */
  now?: () => Date;
}

export async function run(opts: RunOptions = {}): Promise<void> {
  const exit: (code: number) => never =
    opts.exit ?? ((code: number) => process.exit(code) as never);
  const argv = opts.argv ?? process.argv;
  const adapters = opts.adapters ?? ADAPTERS;
  const runner = opts.runner ?? defaultGhRunner;
  const now = opts.now ?? (() => new Date());

  const args = parseArgs(argv, exit);
  const cfg = readConvergeConfig(args.configPath, exit);

  if (!cfg.botAdapter) {
    emitAgentResult({
      status: "failure",
      issues: [
        {
          severity: "blocking",
          description:
            "CODE: ADAPTER_UNKNOWN — converge.config does not specify botAdapter",
          file: args.configPath,
        },
      ],
    });
    return exit(1);
  }
  if (!cfg.prNumber) {
    process.stderr.write(
      `error: converge.config at ${args.configPath} is missing prNumber\n`,
    );
    return exit(2);
  }

  // Refresh pr-state.toon (the F-04 synthetic subject) before adapter
  // dispatch. The driver snapshots `subject` after the harness exits.
  const subjectPath = cfg.subject ?? ".plan-execution/pr-review/pr-state.toon";
  const state = await buildPrState({
    prNumber: cfg.prNumber,
    runner,
    now,
  });
  writePrStateFile(state, subjectPath);

  const adapter = adapters[cfg.botAdapter];
  if (!adapter) {
    emitAgentResult({
      status: "failure",
      issues: [
        {
          severity: "blocking",
          description: `CODE: ADAPTER_UNKNOWN — no adapter registered for botAdapter='${cfg.botAdapter}'`,
          file: args.configPath,
        },
      ],
    });
    return exit(1);
  }

  // Iteration 0 is the bootstrap "write pr-state only" mode used by the
  // wrapper's preflight; the driver calls back with iteration >= 1 once it
  // starts the loop. We DO still produce findings for iteration 0 callers
  // (smoke tests) by treating it as iteration 1 input to the adapter so the
  // schema invariant `iteration >= 1` holds.
  const adapterIteration = args.iteration < 1 ? 1 : args.iteration;

  const findings = await adapter.fetchFindings({
    prNumber: cfg.prNumber,
    iteration: adapterIteration,
    priorFindingsPath: args.priorFindingsPath,
    subject: subjectPath,
    fetcher: makeFetcherFromState(state),
    now,
  });

  const outputPath =
    args.outputPath ??
    cfg.outputPath ??
    defaultOutputPath(args.iteration, cfg.outputDir);
  const absOut = path.resolve(outputPath);
  atomicWriteFile(absOut, encodeFindingsToToon(findings));

  process.stderr.write(
    `wrote ${outputPath} (blockingCount=${findings.blockingCount}, advisoryCount=${findings.advisoryCount}, findings=${findings.findings.length})\n`,
  );
  return exit(0);
}

// Direct-invocation guard.
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const resolvedEntry = path.resolve(entry);
  const here = typeof __filename !== "undefined" ? __filename : "";
  if (!here) return false;
  return resolvedEntry === here;
}

if (typeof __filename !== "undefined" && isInvokedDirectly()) {
  // Top-level await is fine under bun; fall back to `.catch` for node tsc.
  run().catch((err) => {
    process.stderr.write(`pr-review-harness fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}

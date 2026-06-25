#!/usr/bin/env -S bun run
/**
 * F-01 code-review convergence harness.
 *
 * Mode:     `convergenceMode: document` per
 *           `protocols/converge.config.schema.md`
 * Output:   `ConvergenceFindings` TOON per
 *           `protocols/findings.schema.md` with F-01 row variant per
 *           `protocols/findings.applications-rows.md`.
 * Schema version: 1 (registered as `convergence-findings`)
 *
 * Pattern: ONE-PHASE-VIA-INJECTION — same as `scripts/plan-review-harness.ts`.
 *
 *   Mode A — spawn-request mode: when no envelopes are present in
 *            `--results-dir`, the harness writes a spawn-request.toon via
 *            `hooks/lib/spawn-agent.ts` so the convergence-driver can fan out
 *            the 9 reviewers, write the envelopes, then re-invoke this script.
 *
 *   Mode B — aggregate mode: when `--results-dir` contains envelopes for the
 *            9 reviewers, the harness reads them, calls
 *            `aggregateCodeReviewFindings`, and atomically writes
 *            `findings.toon`.
 *
 *   Standalone smoke test (Phase 1 AC1): the fixture under
 *   `test/fixtures/code-review/converges-in-2-iters/` ships pre-canned
 *   reviewer envelopes at `reviewer-results/` next to the subject so a bare
 *   `bun run` invocation produces a findings.toon without invoking real
 *   reviewers.
 *
 * Reuses `scripts/lib/aggregate-findings.ts::severityToConvergenceSeverity`
 * verbatim per the W-03 reviewer-attribution lock. Reviewer attribution is
 * preserved per-row via the F-01 aggregator in
 * `scripts/lib/code-review-harness/spawn-reviewers.ts`.
 *
 * Usage:
 *
 *   bun run scripts/code-review-harness.ts \
 *     --subject <path> \
 *     --iteration <N> \
 *     [--output <path>] \
 *     [--results-dir <path>] \
 *     [--config <converge.config-path>]
 *
 * Exit codes:
 *   0 — wrote findings.toon (aggregate mode) or spawn-request.toon
 *       (request mode).
 *   1 — argument error or invariant violation.
 *   2 — config/subject resolution error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  CODE_REVIEWER_AGENTS,
  aggregateCodeReviewFindings,
  encodeCodeReviewFindingsToToon,
  type AgentResultEnvelope,
  type AgentResultIssue,
} from "./lib/code-review-harness/spawn-reviewers.js";

import type { AgentIssueSeverity } from "./lib/aggregate-findings.js";

import {
  writeSpawnRequest,
  type SpawnAgentRequest,
  type SpawnAgentSpec,
} from "../hooks/lib/spawn-agent.js";

// ---------------------------------------------------------------------------
// Severity validator (matches plan-review-harness for cross-enum tolerance)
// ---------------------------------------------------------------------------

const VALID_AGENT_ISSUE_SEVERITIES: readonly AgentIssueSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "advisory",
  "blocking",
  "warning",
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  subject?: string;
  configPath?: string;
  iteration: number;
  outputPath?: string;
  resultsDir?: string;
}

export function parseArgs(
  argv: string[],
  exit: (code: number) => never,
): CliArgs {
  const userArgs = argv.slice(2);
  let subject: string | undefined;
  let configPath: string | undefined;
  let iterationRaw: string | undefined;
  let outputPath: string | undefined;
  let resultsDir: string | undefined;

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    switch (arg) {
      case "--subject":
        subject = userArgs[++i];
        break;
      case "--config":
        configPath = userArgs[++i];
        break;
      case "--iteration":
        iterationRaw = userArgs[++i];
        break;
      case "--output":
        outputPath = userArgs[++i];
        break;
      case "--results-dir":
        resultsDir = userArgs[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        if (arg.startsWith("--")) {
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

  if (!subject && !configPath) {
    process.stderr.write(
      "error: one of --subject <path> or --config <converge.config-path> is required\n",
    );
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
  return { subject, configPath, iteration, outputPath, resultsDir };
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  bun run scripts/code-review-harness.ts \\",
      "    --subject <path> | --config <converge.config-path> \\",
      "    --iteration <N> \\",
      "    [--output <path>] \\",
      "    [--results-dir <path>]",
      "",
      "Modes:",
      "  Without envelopes in results-dir: writes spawn-request.toon, exits 0.",
      "  With envelopes:                  aggregates, writes findings.toon.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// converge.config reader (minimal — only fields the harness consumes)
// ---------------------------------------------------------------------------

interface ConvergeConfig {
  convergenceMode?: string;
  subject?: string;
  harness?: string;
  outputDir?: string;
  outputPath?: string;
}

export function readConvergeConfig(
  configPath: string,
  exit: (code: number) => never,
): ConvergeConfig {
  const absPath = path.resolve(configPath);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    process.stderr.write(
      `error: cannot read converge.config at ${absPath}: ${(err as Error).message}\n`,
    );
    exit(2);
  }
  const config: ConvergeConfig = {};
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
      case "convergenceMode":
        config.convergenceMode = value;
        break;
      case "subject":
        config.subject = value;
        break;
      case "harness":
        config.harness = value;
        break;
      case "outputDir":
        config.outputDir = value;
        break;
      case "outputPath":
        config.outputPath = value;
        break;
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Agent model resolution (frontmatter)
// ---------------------------------------------------------------------------

export function readAgentModel(agentFile: string): string {
  if (!agentFile) return "inherit";
  const absPath = path.resolve(agentFile);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return "inherit";
  }
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return "inherit";
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const m = line.match(/^model:\s*(.+)$/);
    if (m) {
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  return "inherit";
}

// ---------------------------------------------------------------------------
// AgentResult envelope reader (TOON → in-memory record)
// ---------------------------------------------------------------------------

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < row.length) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        out.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
    }
  }
  out.push(current.trim());
  return out;
}

export function readAgentResultEnvelope(
  filePath: string,
): AgentResultEnvelope | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  let agent = "";
  let status: AgentResultEnvelope["status"] | null = null;
  const issues: AgentResultIssue[] = [];

  // First pass: scalars.
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\w+\[/.test(trimmed)) continue;
    if (line.startsWith("  ")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key === "agent") agent = value;
    if (key === "status") {
      if (value === "success" || value === "failure" || value === "partial") {
        status = value;
      } else if (value === "failed") {
        status = "failure";
      }
    }
  }

  // Second pass: issues table.
  let fields: string[] | null = null;
  let inIssues = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inIssues) {
      const headerMatch = trimmed.match(/^issues\[(\d+)\]\{([^}]+)\}:$/);
      if (headerMatch) {
        const count = Number(headerMatch[1]);
        if (count === 0) {
          inIssues = false;
          continue;
        }
        fields = headerMatch[2].split(",").map((s) => s.trim());
        inIssues = true;
        continue;
      }
      if (trimmed.match(/^issues\[0\]/)) {
        inIssues = false;
        continue;
      }
    } else {
      if (!line.startsWith("  ") || !trimmed) {
        inIssues = false;
        continue;
      }
      if (!fields) continue;
      const cells = splitCsvRow(trimmed);
      const row: Record<string, string> = {};
      for (let i = 0; i < fields.length; i++) {
        row[fields[i]] = cells[i] ?? "";
      }
      const severityRaw = row.severity ?? "";
      if (
        !VALID_AGENT_ISSUE_SEVERITIES.includes(
          severityRaw as AgentIssueSeverity,
        )
      ) {
        process.stderr.write(
          `warning: skipping issue with unrecognized severity '${severityRaw}' in ${filePath}\n`,
        );
        continue;
      }
      const issue: AgentResultIssue = {
        severity: severityRaw as AgentIssueSeverity,
        message: row.description ?? row.message ?? row.summary ?? "",
      };
      if (row.file) issue.file = row.file;
      if (row.location) issue.location = row.location;
      if (row.line && !row.location) issue.location = row.line;
      if (row.suggestion) issue.suggestion = row.suggestion;
      if (row.category) issue.category = row.category;
      issues.push(issue);
    }
  }

  if (!agent || !status) return null;
  return { agent, status, issues };
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
// Mode A: spawn-request builder
// ---------------------------------------------------------------------------

export function buildSpawnRequest(args: {
  configPath: string;
  subject: string;
  resultDir: string;
  iteration: number;
  outputPath: string;
  now: Date;
}): SpawnAgentRequest {
  const spawns: SpawnAgentSpec[] = CODE_REVIEWER_AGENTS.map((row) => ({
    agentName: row.reviewerAgent,
    agentFile: row.agentFile,
    model: row.builtin ? "inherit" : readAgentModel(row.agentFile),
    subject: args.subject,
    extraInputs: {
      iteration: String(args.iteration),
      builtin: String(row.builtin),
    },
  }));

  const fingerprint = createHash("sha256")
    .update(
      [
        args.configPath,
        args.subject,
        args.resultDir,
        String(args.iteration),
        ...spawns.map((s) => `${s.agentName}|${s.model}`),
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 16);
  const requestId = `${fingerprint}-${randomUUID().slice(0, 8)}`;

  const parts = ["bun run scripts/code-review-harness.ts"];
  if (args.configPath) parts.push(`--config ${args.configPath}`);
  parts.push(`--subject ${args.subject}`);
  parts.push(`--iteration ${args.iteration}`);
  parts.push(`--output ${args.outputPath}`);
  parts.push(`--results-dir ${args.resultDir}`);
  const rerunCommand = parts.join(" ");

  return {
    requestId,
    requestedBy: "scripts/code-review-harness.ts",
    createdAt: args.now.toISOString(),
    spawns,
    resultDir: args.resultDir,
    rerunCommand,
  };
}

// ---------------------------------------------------------------------------
// Mode B: envelope collection
// ---------------------------------------------------------------------------

export interface AggregateResult {
  envelopes: AgentResultEnvelope[];
  missing: string[];
  failed: string[];
  corrupted: string[];
}

export function collectEnvelopes(resultsDir: string): AggregateResult {
  const envelopes: AgentResultEnvelope[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const corrupted: string[] = [];

  for (const row of CODE_REVIEWER_AGENTS) {
    const candidate = path.resolve(resultsDir, `${row.reviewerAgent}.toon`);
    if (!fs.existsSync(candidate)) {
      missing.push(row.reviewerAgent);
      continue;
    }
    const env = readAgentResultEnvelope(candidate);
    if (!env) {
      corrupted.push(row.reviewerAgent);
      continue;
    }
    env.agent = row.reviewerAgent;
    if (env.status === "failure") {
      failed.push(row.reviewerAgent);
    }
    envelopes.push(env);
  }

  return { envelopes, missing, failed, corrupted };
}

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

function defaultOutputPath(iteration: number, outputDir?: string): string {
  const dir = outputDir
    ? outputDir
    : `.plan-execution/convergence/iterations/iter-${iteration}`;
  return path.join(dir, "findings.toon");
}

function defaultResultsDir(subject: string): string {
  return path.join(path.dirname(subject), "reviewer-results");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(
  argv: string[] = process.argv,
  exit: (code: number) => never = (code) => process.exit(code) as never,
): void {
  const args = parseArgs(argv, exit);

  // Resolve subject + outputPath from CLI > config.
  let subject = args.subject;
  let outputPath = args.outputPath;
  let configForFingerprint = args.configPath ?? "";
  if (args.configPath) {
    const cfg = readConvergeConfig(args.configPath, exit);
    if (!subject) subject = cfg.subject;
    if (!outputPath) {
      if (cfg.outputPath) outputPath = cfg.outputPath;
      else if (cfg.outputDir)
        outputPath = defaultOutputPath(args.iteration, cfg.outputDir);
    }
  }

  if (!subject) {
    process.stderr.write(
      "error: subject is required (pass --subject or set in --config)\n",
    );
    return exit(2);
  }
  if (!outputPath) {
    outputPath = defaultOutputPath(args.iteration);
  }

  const resultsDir = args.resultsDir ?? defaultResultsDir(subject);

  const collection = collectEnvelopes(resultsDir);

  if (collection.corrupted.length > 0) {
    process.stderr.write(
      [
        `error: corrupted or unparseable reviewer envelopes found at ${resultsDir}/:`,
        ...collection.corrupted.map((name) => `  - ${name}.toon`),
        "Halt: re-spawning these reviewers would risk an infinite loop on persistent parse failures.",
        "Fix the on-disk envelopes (or delete them so the driver respawns cleanly) before re-invoking the harness.",
        "",
      ].join("\n"),
    );
    return exit(1);
  }

  const haveAll =
    collection.missing.length === 0 &&
    collection.envelopes.length === CODE_REVIEWER_AGENTS.length;

  if (!haveAll) {
    // Mode A: spawn-request.
    const spawnRequestPath = path.join(
      path.dirname(outputPath),
      "spawn-request.toon",
    );
    const request = buildSpawnRequest({
      configPath: configForFingerprint,
      subject,
      resultDir: resultsDir,
      iteration: args.iteration,
      outputPath,
      now: new Date(),
    });
    writeSpawnRequest(request, spawnRequestPath);
    process.stderr.write(
      [
        `Harness wrote spawn-request.toon at ${spawnRequestPath}.`,
        `Driver: spawn ${CODE_REVIEWER_AGENTS.length} reviewers per request, write results to ${resultsDir}/, then re-invoke this harness with --results-dir ${resultsDir}.`,
        `Missing envelopes: ${collection.missing.join(", ") || "(none — first invocation)"}.`,
        "",
      ].join("\n"),
    );
    return exit(0);
  }

  for (const name of collection.failed) {
    process.stderr.write(
      `warning: reviewer ${name} returned status=failed; findings aggregated from remaining ${CODE_REVIEWER_AGENTS.length - collection.failed.length} reviewers.\n`,
    );
  }

  // Aggregator requires iteration >= 0 (we accept 0 for the standalone smoke
  // test). When the driver invokes us with iteration >= 1, this is a no-op.
  const findings = aggregateCodeReviewFindings({
    subject,
    iteration: args.iteration,
    envelopes: collection.envelopes,
  });

  const outAbs = path.resolve(outputPath);
  atomicWriteFile(outAbs, encodeCodeReviewFindingsToToon(findings));
  process.stderr.write(
    `wrote ${outputPath} (blockingCount=${findings.blockingCount}, advisoryCount=${findings.advisoryCount}, findings=${findings.findings.length})\n`,
  );
  return exit(0);
}

// Direct-invocation guard (mirrors plan-review-harness).
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const resolvedEntry = path.resolve(entry);
  const here = __filename ?? "";
  if (!here) return false;
  return resolvedEntry === here;
}

if (typeof __filename !== "undefined" && isInvokedDirectly()) {
  main();
}

export { CODE_REVIEWER_AGENTS };

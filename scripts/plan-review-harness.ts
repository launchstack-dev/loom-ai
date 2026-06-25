#!/usr/bin/env -S bun run
/**
 * plan-review convergence harness.
 *
 * Mode:     `convergenceMode: document` per `protocols/convergence-tier.schema.md`
 * Output:   `ConvergenceFindings` TOON per `protocols/findings.schema.md`
 * Outputs to: `converge.config.outputPath` (default `.plan-execution/convergence/findings.toon`)
 * Schema version: 1 (registered as `convergence-findings`)
 *
 * Pattern: ONE-PHASE-VIA-INJECTION.
 *
 *   The harness coordinates 6 reviewer agents but cannot invoke Claude Code's
 *   Agent tool directly (it is a standalone Bun script, not an agent). It
 *   uses two modes:
 *
 *     Mode A — spawn-request mode (when `--results-dir` is not provided
 *              OR the directory does not yet contain all 6 reviewer
 *              AgentResult files):
 *
 *       The harness writes
 *       `.plan-execution/convergence/spawn-request.toon` via
 *       `hooks/lib/spawn-agent.ts::writeSpawnRequest` and exits 0 with a
 *       stderr message instructing the convergence-driver to:
 *
 *         1. Read the spawn-request.
 *         2. Spawn the 6 reviewer agents in parallel via its Agent tool.
 *         3. Write each AgentResult envelope to
 *            `.plan-execution/convergence/reviewer-results/{agent-name}.toon`.
 *         4. Re-invoke this script with `--results-dir
 *            .plan-execution/convergence/reviewer-results/`.
 *
 *     Mode B — aggregate mode (when `--results-dir` IS provided AND
 *              contains all 6 reviewer AgentResult files):
 *
 *       The harness reads each AgentResult envelope, calls the pure
 *       `aggregateFindings` function in `scripts/lib/aggregate-findings.ts`,
 *       and atomically writes the resulting `ConvergenceFindings` TOON to
 *       `converge.config.outputPath`.
 *
 *   This two-mode design keeps the script side-effect-free in CI (it never
 *   tries to call an LLM) and keeps the aggregator unit-testable as a pure
 *   function.
 *
 * Locked decisions wired:
 *   - W-01 (ISO 8601 ms-precision): every `producedAt` and `createdAt`
 *     timestamp is formatted via `Date#toISOString()`.
 *   - W-03 (reviewer attribution): preserved per-row via the aggregator.
 *   - C-04 (critic advisory-only): N/A — this harness has no critic role.
 *   - C-11 (loom-auto compat): the harness writes only `findings.toon` and
 *     (in spawn-request mode) `spawn-request.toon`. No `pipeline-state.toon`
 *     mutation, no mid-flight orchestrator-state changes.
 *
 * Acceptance criteria reference: see plan-execution Phase 9 AC list.
 *
 * Usage:
 *
 *   bun run scripts/plan-review-harness.ts \
 *     --config <converge.config-path> \
 *     --iteration <N> \
 *     [--results-dir <path>]
 *
 * Exit codes:
 *
 *   0 — wrote findings.toon (aggregate mode) or spawn-request.toon (request mode).
 *   1 — argument error or invariant violation (defect; halts driver).
 *   2 — config-resolution error (missing/invalid converge.config).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  aggregateFindings,
  encodeFindingsToToon,
  type AgentResultEnvelope,
  type AgentResultIssue,
  type AgentIssueSeverity,
  CANONICAL_REVIEWER_AGENTS,
  type ReviewerAgent,
} from "./lib/aggregate-findings.js";

import {
  writeSpawnRequest,
  type SpawnAgentRequest,
  type SpawnAgentSpec,
} from "../hooks/lib/spawn-agent.js";

// ---------------------------------------------------------------------------
// Canonical reviewer-agent mapping
// ---------------------------------------------------------------------------

/**
 * Each row maps the schema-side `reviewerAgent` name (with `-reviewer-agent`
 * suffix) to the actual `agents/{name}.md` file (with `-agent` suffix,
 * without `-reviewer-` infix). The mapping is closed: any addition here
 * REQUIRES a corresponding update to `CANONICAL_REVIEWER_AGENTS` in
 * `scripts/lib/aggregate-findings.ts`.
 */
interface ReviewerAgentRow {
  /** Schema-side name carried into findings.toon. */
  reviewerAgent: ReviewerAgent;
  /** Path to the actual agent .md file (relative to repo root). */
  agentFile: string;
}

const REVIEWER_AGENT_FILES: ReviewerAgentRow[] = [
  {
    reviewerAgent: "feature-coverage-reviewer-agent",
    agentFile: "agents/feature-coverage-agent.md",
  },
  {
    reviewerAgent: "strategy-reviewer-agent",
    agentFile: "agents/strategy-agent.md",
  },
  {
    reviewerAgent: "ux-reviewer-agent",
    agentFile: "agents/ux-agent.md",
  },
  {
    reviewerAgent: "phasing-reviewer-agent",
    agentFile: "agents/phasing-agent.md",
  },
  {
    reviewerAgent: "parallelization-reviewer-agent",
    agentFile: "agents/parallelization-agent.md",
  },
  {
    reviewerAgent: "agentic-workflow-reviewer-agent",
    agentFile: "agents/agentic-workflow-agent.md",
  },
];

const VALID_AGENT_ISSUE_SEVERITIES: readonly AgentIssueSeverity[] = [
  // Classic severity ladder (legacy findings.schema.md mapping).
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "advisory",
  // Convergence-aligned values emitted by Loom reviewer agents per
  // agent-result.schema.md (added 2026-06-13 per Smoke 2 Finding A —
  // reviewers were emitting these and the harness silently dropped them).
  "blocking",
  "warning",
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  configPath: string;
  iteration: number;
  resultsDir?: string;
}

function parseArgs(
  argv: string[],
  exit: (code: number) => never,
): CliArgs {
  // argv layout: [bun/node, scriptPath, ...userArgs]
  const userArgs = argv.slice(2);
  let configPath: string | undefined;
  let iterationRaw: string | undefined;
  let resultsDir: string | undefined;

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    switch (arg) {
      case "--config":
        configPath = userArgs[++i];
        break;
      case "--iteration":
        iterationRaw = userArgs[++i];
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
          // Bare positional argument — likely a typo (e.g., omitted `--`
          // before a flag name, or a stray path). Reject explicitly rather
          // than silently dropping; the smoke wrapper depends on
          // deterministic argv handling. (Gemini review 2026-06-14.)
          process.stderr.write(
            `error: unrecognized positional argument '${arg}'\n`,
          );
          printUsage();
          exit(1);
        }
    }
  }

  if (!configPath) {
    process.stderr.write("error: --config <converge.config-path> is required\n");
    printUsage();
    exit(1);
  }
  if (!iterationRaw) {
    process.stderr.write("error: --iteration <N> is required\n");
    printUsage();
    exit(1);
  }
  const iteration = Number(iterationRaw);
  if (!Number.isInteger(iteration) || iteration < 1) {
    process.stderr.write(
      `error: --iteration must be a positive integer (got ${iterationRaw})\n`,
    );
    exit(1);
  }

  return { configPath: configPath!, iteration, resultsDir };
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  bun run scripts/plan-review-harness.ts \\",
      "    --config <converge.config-path> \\",
      "    --iteration <N> \\",
      "    [--results-dir <path>]",
      "",
      "Modes:",
      "  Without --results-dir: writes spawn-request.toon and exits 0.",
      "  With --results-dir:    reads AgentResult envelopes from the dir,",
      "                        aggregates, writes findings.toon, exits 0.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// converge.config reader
// ---------------------------------------------------------------------------

interface ConvergeConfig {
  convergenceMode?: string;
  subject: string;
  harness?: string;
  outputPath: string;
}

/**
 * Minimal converge.config reader. Pulls only the fields the harness needs:
 * `subject` (required) and `outputPath` (defaults to the canonical path).
 *
 * Full validation is the convergence-driver's responsibility; the harness
 * trusts the driver did preflight before invocation.
 */
function readConvergeConfig(
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

  const config: Partial<ConvergeConfig> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Skip array headers / indented rows; the harness only needs flat scalars.
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
      case "outputPath":
        config.outputPath = value;
        break;
      default:
        // Ignore unknown keys — forward-compat with future config additions.
        break;
    }
  }

  if (!config.subject) {
    process.stderr.write(
      `error: converge.config at ${absPath} is missing required field 'subject'\n`,
    );
    exit(2);
  }

  return {
    convergenceMode: config.convergenceMode,
    subject: config.subject,
    harness: config.harness,
    outputPath:
      config.outputPath ?? ".plan-execution/convergence/findings.toon",
  };
}

// ---------------------------------------------------------------------------
// Agent .md frontmatter reader
// ---------------------------------------------------------------------------

/**
 * Extract the `model:` field from an agent's frontmatter. Returns "inherit"
 * if the file is missing or the field is absent — the driver's responsibility
 * is to honor the CLAUDE.md model-resolution rule on top of this value.
 */
function readAgentModel(agentFile: string): string {
  const absPath = path.resolve(agentFile);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    // Missing agent file is a driver-preflight error, not a harness error.
    // Record "inherit" so the spawn-request is still valid TOON.
    return "inherit";
  }

  // Frontmatter block: starts with `---` on the first line, ends with `---`.
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return "inherit";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const match = line.match(/^model:\s*(.+)$/);
    if (match) {
      // Strip surrounding quotes if present.
      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return "inherit";
}

// ---------------------------------------------------------------------------
// AgentResult TOON reader
// ---------------------------------------------------------------------------

/**
 * Read a single AgentResult envelope from disk. Pulls the fields the
 * aggregator consumes: `agent`, `status`, and the typed-array `issues[]` with
 * columns {severity, description, file, line, ...}.
 *
 * The schema (agent-result.schema.md) names the issue columns
 * `{severity,description,file,line}` in its base example. Reviewer agents
 * may emit additional columns (e.g., `location`, `suggestion`, `dimension`).
 * This reader is permissive: it picks up whatever columns are present and
 * passes them through.
 *
 * Returns null on parse failure (which the caller treats as a missing result).
 */
function readAgentResultEnvelope(filePath: string): AgentResultEnvelope | null {
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
        // Tolerate the colloquial alias: `failed` → `failure`.
        status = "failure";
      }
    }
  }

  // Second pass: locate `issues[N]{...}:` header, then parse rows.
  let fields: string[] | null = null;
  let inIssues = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inIssues) {
      // Match issues[N]{fields...}:
      const headerMatch = trimmed.match(
        /^issues\[(\d+)\]\{([^}]+)\}:$/,
      );
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
      // Also tolerate the bare `issues[0]:` form.
      if (trimmed.match(/^issues\[0\]/)) {
        inIssues = false;
        continue;
      }
    } else {
      // Row lines are indented; bail when indentation breaks.
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
      if (!VALID_AGENT_ISSUE_SEVERITIES.includes(severityRaw as AgentIssueSeverity)) {
        // Skip rows with unrecognized severity — emit warning to stderr but
        // continue (don't fail the whole envelope on a single bad row).
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
      if (row.suggestion) issue.suggestion = row.suggestion;
      if (row.category) issue.category = row.category;
      if (row.dimension) {
        // The aggregator narrows this back to the ReviewerDimension enum.
        issue.dimension = row.dimension as AgentResultIssue["dimension"];
      }
      issues.push(issue);
    }
  }

  if (!agent || !status) return null;
  return { agent, status, issues };
}

/** Split a CSV row honoring double-quoted cells (RFC 4180). */
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

// ---------------------------------------------------------------------------
// Atomic write helper for findings.toon
// ---------------------------------------------------------------------------

function atomicWriteFile(absPath: string, text: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, absPath);
}

// ---------------------------------------------------------------------------
// Mode A: spawn-request
// ---------------------------------------------------------------------------

function buildSpawnRequest(args: {
  configPath: string;
  subject: string;
  resultDir: string;
  iteration: number;
  now: Date;
}): SpawnAgentRequest {
  const spawns: SpawnAgentSpec[] = REVIEWER_AGENT_FILES.map((row) => ({
    agentName: row.reviewerAgent,
    agentFile: row.agentFile,
    model: readAgentModel(row.agentFile),
    subject: args.subject,
    extraInputs: { iteration: String(args.iteration) },
  }));

  // requestId is content-derived so re-runs with identical inputs produce
  // identical request ids — useful for the driver's idempotency check.
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

  const rerunCommand = [
    "bun run scripts/plan-review-harness.ts",
    `--config ${args.configPath}`,
    `--iteration ${args.iteration}`,
    `--results-dir ${args.resultDir}`,
  ].join(" ");

  return {
    requestId,
    requestedBy: "scripts/plan-review-harness.ts",
    createdAt: args.now.toISOString(),
    spawns,
    resultDir: args.resultDir,
    rerunCommand,
  };
}

// ---------------------------------------------------------------------------
// Mode B: aggregate
// ---------------------------------------------------------------------------

interface AggregateResult {
  envelopes: AgentResultEnvelope[];
  /** Envelope file did not exist on disk. Triggers Mode A (spawn-request). */
  missing: string[];
  /** Envelope parsed and surfaced `status: failure`. Aggregated as zero findings + stderr warning. */
  failed: string[];
  /**
   * Envelope file existed on disk but could not be parsed.
   *
   * Distinct from `missing` (no file) and `failed` (parsed envelope with
   * status=failure). A corrupted envelope on disk is a signal of a real bug
   * — either the reviewer agent emitted malformed TOON or the file was
   * truncated mid-write. Treating it as `missing` would silently re-spawn
   * all reviewers and could loop forever on persistent parse failures.
   * The harness halts with exit 1 + diagnostic in this state.
   *
   * Added per Gemini review 2026-06-14 (PR #18) HIGH finding.
   */
  corrupted: string[];
}

function collectEnvelopes(resultsDir: string): AggregateResult {
  const envelopes: AgentResultEnvelope[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const corrupted: string[] = [];

  for (const row of REVIEWER_AGENT_FILES) {
    const candidate = path.resolve(resultsDir, `${row.reviewerAgent}.toon`);
    if (!fs.existsSync(candidate)) {
      missing.push(row.reviewerAgent);
      continue;
    }
    const env = readAgentResultEnvelope(candidate);
    if (!env) {
      // File exists but won't parse. This is a real bug (malformed TOON or
      // mid-write truncation); treat as a halt condition rather than a
      // silent re-spawn trigger. See AggregateResult.corrupted docs.
      corrupted.push(row.reviewerAgent);
      continue;
    }
    // Force the envelope's `agent` field to the canonical schema-side name.
    // The actual agent file may emit `agent: feature-coverage-agent` (no
    // `-reviewer-` infix) per its frontmatter `name:` field; we normalize
    // here so the aggregator sees the schema-side name.
    env.agent = row.reviewerAgent;
    if (env.status === "failure") {
      failed.push(row.reviewerAgent);
    }
    envelopes.push(env);
  }

  return { envelopes, missing, failed, corrupted };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv: string[] = process.argv, exit: (code: number) => never = (code) => process.exit(code) as never): void {
  const args = parseArgs(argv, exit);
  const config = readConvergeConfig(args.configPath, exit);

  const resultsDirDefault = ".plan-execution/convergence/reviewer-results";
  const resultsDir = args.resultsDir ?? resultsDirDefault;

  // Check if the results dir already contains all 6 envelopes.
  const collection = collectEnvelopes(resultsDir);

  // Halt on corrupted envelopes — distinct from missing (Mode A respawn
  // trigger). A corrupted file on disk signals a real bug; silently
  // re-spawning could loop forever if the same reviewer keeps producing
  // unparseable output. Surface the failure to the operator instead.
  // (Gemini review 2026-06-14, HIGH finding.)
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

  const haveAll = collection.missing.length === 0 && collection.envelopes.length === REVIEWER_AGENT_FILES.length;

  if (!haveAll) {
    // Mode A: write spawn-request and exit so the driver can fulfill it.
    const spawnRequestPath =
      ".plan-execution/convergence/spawn-request.toon";
    const request = buildSpawnRequest({
      configPath: args.configPath,
      subject: config.subject,
      resultDir: resultsDir,
      iteration: args.iteration,
      now: new Date(),
    });
    writeSpawnRequest(request, spawnRequestPath);
    process.stderr.write(
      [
        `Harness wrote spawn-request.toon at ${spawnRequestPath}.`,
        `Driver: spawn ${REVIEWER_AGENT_FILES.length} reviewers per request, write results to ${resultsDir}/, then re-invoke this harness with --results-dir ${resultsDir}.`,
        `Missing envelopes: ${collection.missing.join(", ") || "(none — first invocation)"}.`,
        "",
      ].join("\n"),
    );
    return exit(0);
  }

  // Mode B: aggregate. Note any failed reviewers via stderr warning (AC 8).
  for (const name of collection.failed) {
    process.stderr.write(
      `warning: reviewer ${name} returned status=failed; findings aggregated from remaining ${REVIEWER_AGENT_FILES.length - collection.failed.length} reviewers.\n`,
    );
  }

  const findings = aggregateFindings({
    subject: config.subject,
    iteration: args.iteration,
    envelopes: collection.envelopes,
  });

  const outAbs = path.resolve(config.outputPath);
  atomicWriteFile(outAbs, encodeFindingsToToon(findings));
  process.stderr.write(
    `wrote ${config.outputPath} (blockingCount=${findings.blockingCount}, advisoryCount=${findings.advisoryCount}, findings=${findings.findings.length})\n`,
  );
  return exit(0);
}

// Run only when invoked directly (not when imported by tests). Comparing
// `process.argv[1]` against this file's resolved path works under both Bun
// and Node without depending on `import.meta` (which the local tsconfig may
// resolve as CommonJS for files outside the `hooks/` ESM package).
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  // Match either the .ts file (Bun, ts-node) or a built .js sibling.
  const resolvedEntry = path.resolve(entry);
  const here = __filename ?? "";
  if (!here) return false;
  return resolvedEntry === here;
}

if (typeof __filename !== "undefined" && isInvokedDirectly()) {
  main();
}

// Exported for tests and for the convergence-driver to consume programmatically.
export {
  main,
  parseArgs,
  readConvergeConfig,
  readAgentModel,
  readAgentResultEnvelope,
  buildSpawnRequest,
  collectEnvelopes,
  atomicWriteFile,
  REVIEWER_AGENT_FILES,
};

// Suppress unused-name lint by re-exporting the canonical enum (used by tests).
export { CANONICAL_REVIEWER_AGENTS };

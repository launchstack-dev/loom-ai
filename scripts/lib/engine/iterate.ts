#!/usr/bin/env tsx
/**
 * Engine step-recorder CLI (M-2, D-M2-01). Owns every LOCKED convergence
 * semantic on the executable path so the Workflow driver stays pure
 * choreography and no policy is duplicated:
 *
 *   preflight  — validate converge.config, resolve harness/integrator;
 *                failures emit an AgentResult envelope to
 *                .plan-execution/convergence-preflight.toon (never a summary).
 *   record     — validate findings.toon (FINDINGS_SCHEMA_INVALID), update
 *                convergence-state.toon, write iter-{N}.toon, evaluate
 *                breakers (scripts/lib/engine/breakers.ts), emit the locked
 *                C-09 stdout line (+ C-10 halt block on halt).
 *   finalize   — write convergence-summary.toon exactly once, atomically,
 *                with all locked C-11 fields.
 *
 * Every subcommand prints a single JSON verdict as the LAST stdout line, so
 * the agent relaying to the Workflow driver returns it as structured output.
 *
 * Usage:
 *   iterate.ts preflight --config <path>
 *   iterate.ts record    --config <path> --iteration N --findings <path> \
 *                        --agents-spawned <cumulative> [--scope-expansion] \
 *                        [--all-blocking-frozen]
 *   iterate.ts finalize  --config <path> [--halt-reason <reason>] \
 *                        [--started-at <iso>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon, parseToonArray } from "../../../hooks/lib/toon-reader.js";
import * as crypto from "node:crypto";
import { resolveAgentModel } from "./model-resolution.js";
import { readCoverageMatrix, uncoveredGaps } from "./coverage.js";
import {
  evaluateBreakers,
  detectScopeExpansion,
  renderIterationLine,
  renderHaltMessage,
  STATUS_BY_HALT_REASON,
  HALT_CAUSE,
  HALT_RECOVERY,
  type ConvergenceMode,
  type HaltReason,
  type IterationRecord,
} from "./breakers.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface ConvergeConfig {
  runId: string;
  convergenceMode: ConvergenceMode;
  subject: string | null;
  harness: string;
  integrator: string;
  maxIterations: number;
  agentBudget: number;
  outputDir: string;
  outputPath: string;
  snapshotEnabled: boolean;
  scopeGuardEnabled: boolean;
  snapshotDir: string;
}

export function readConvergeConfig(configPath: string): ConvergeConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  const flat = parseToon(content);
  const mode = String(flat["convergenceMode"] ?? "target") as ConvergenceMode;
  const outputDir = String(flat["outputDir"] ?? ".plan-execution/convergence/");
  return {
    runId: String(flat["runId"] ?? `conv-${Math.abs(hashString(content))}`),
    convergenceMode: mode,
    subject: flat["subject"] != null && flat["subject"] !== "" ? String(flat["subject"]) : null,
    harness: String(flat["harness"] ?? ""),
    integrator: String(
      flat["integrator"] ?? (mode === "document" ? "" : "fixer-agent")
    ),
    maxIterations: Number(flat["maxIterations"] ?? (mode === "document" ? 3 : 10)),
    agentBudget: Number(flat["agentBudget"] ?? 0),
    outputDir,
    outputPath: String(flat["outputPath"] ?? path.join(outputDir, "findings.toon")),
    snapshotEnabled: flat["snapshotEnabled"] !== false && mode === "document",
    scopeGuardEnabled: flat["scopeGuardEnabled"] !== false && mode === "document",
    snapshotDir: String(flat["snapshotDir"] ?? "planning/history/snapshots/"),
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath + ".tmp", content, "utf-8");
  fs.renameSync(filePath + ".tmp", filePath);
}

function emitVerdict(verdict: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(verdict) + "\n");
}

// ---------------------------------------------------------------------------
// Findings validation (findings.schema.md invariants)
// ---------------------------------------------------------------------------

const BLOCKING_SEVERITIES = new Set(["blocking"]);
const ADVISORY_SEVERITIES = new Set(["warning", "info", "advisory"]);

export interface FindingsSummary {
  blockingCount: number;
  advisoryCount: number;
  iteration: number;
  errors: string[];
}

export function validateFindings(
  findingsPath: string,
  expectedIteration: number
): FindingsSummary {
  const errors: string[] = [];
  if (!fs.existsSync(findingsPath)) {
    return { blockingCount: -1, advisoryCount: -1, iteration: -1, errors: ["findings.toon missing"] };
  }
  const content = fs.readFileSync(findingsPath, "utf-8");
  const flat = parseToon(content);
  const rows = parseToonArray(content, "findings");

  for (const field of ["subject", "harnessName", "iteration", "blockingCount", "advisoryCount", "producedAt"]) {
    if (flat[field] == null || flat[field] === "") errors.push(`missing field: ${field}`);
  }
  const blockingCount = Number(flat["blockingCount"] ?? -1);
  const advisoryCount = Number(flat["advisoryCount"] ?? -1);
  const iteration = Number(flat["iteration"] ?? -1);

  if (blockingCount < 0 || advisoryCount < 0) errors.push("negative counts");
  if (iteration !== expectedIteration) {
    errors.push(`iteration mismatch: findings=${iteration} expected=${expectedIteration}`);
  }
  const producedAt = String(flat["producedAt"] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(producedAt)) {
    errors.push("producedAt not ISO 8601 millisecond precision");
  }

  const ids = new Set<string>();
  let blockingRows = 0;
  let advisoryRows = 0;
  for (const row of rows) {
    const id = String(row["id"] ?? "");
    if (ids.has(id)) errors.push(`duplicate finding id: ${id}`);
    ids.add(id);
    const severity = String(row["severity"] ?? "");
    if (BLOCKING_SEVERITIES.has(severity)) blockingRows += 1;
    else if (ADVISORY_SEVERITIES.has(severity)) advisoryRows += 1;
    else errors.push(`invalid severity: ${severity || "(empty)"} on ${id}`);
  }
  if (blockingRows !== blockingCount) {
    errors.push(`blockingCount ${blockingCount} != blocking rows ${blockingRows}`);
  }
  if (advisoryRows !== advisoryCount) {
    errors.push(`advisoryCount ${advisoryCount} != advisory rows ${advisoryRows}`);
  }

  return { blockingCount, advisoryCount, iteration, errors };
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

interface EngineState {
  runId: string;
  mode: ConvergenceMode;
  consecutiveStalls: number;
  totalAgentsSpawned: number;
  startedAt: string;
  history: IterationRecord[];
  /** Subject content as of the last record call — scope-guard baseline (C-06). */
  subjectBaseline: string | null;
}

function statePath(config: ConvergeConfig): string {
  return path.join(path.dirname(config.outputPath), "..", "convergence-state.toon");
}

export function readEngineState(config: ConvergeConfig): EngineState {
  const p = statePath(config);
  const fallback: EngineState = {
    runId: config.runId,
    mode: config.convergenceMode,
    consecutiveStalls: 0,
    totalAgentsSpawned: 0,
    startedAt: new Date().toISOString(),
    history: [],
    subjectBaseline: null,
  };
  try {
    if (!fs.existsSync(p)) return fallback;
    const content = fs.readFileSync(p, "utf-8");
    const flat = parseToon(content);
    const history = parseToonArray(content, "history").map((r) => ({
      iteration: Number(r["iteration"] ?? 0),
      blocking: Number(r["blocking"] ?? 0),
    }));
    let subjectBaseline: string | null = null;
    const baselinePath = subjectBaselinePath(config);
    if (fs.existsSync(baselinePath)) {
      subjectBaseline = fs.readFileSync(baselinePath, "utf-8");
    }
    return {
      runId: String(flat["runId"] ?? config.runId),
      mode: (flat["convergenceMode"] as ConvergenceMode) ?? config.convergenceMode,
      consecutiveStalls: Number(flat["consecutiveStalls"] ?? 0),
      totalAgentsSpawned: Number(flat["totalAgentsSpawned"] ?? 0),
      startedAt: String(flat["startedAt"] ?? fallback.startedAt),
      history,
      subjectBaseline,
    };
  } catch {
    return fallback;
  }
}

/** Sidecar holding the prior subject content for the C-06 scope guard. */
function subjectBaselinePath(config: ConvergeConfig): string {
  return path.join(path.dirname(config.outputPath), "subject-baseline.snapshot");
}

function writeEngineState(config: ConvergeConfig, state: EngineState): void {
  const last = state.history[state.history.length - 1];
  const prior = state.history[state.history.length - 2];
  const lines = [
    `runId: ${state.runId}`,
    `convergenceMode: ${state.mode}`,
    `subject: ${config.subject ?? ""}`,
    `currentBlockingCount: ${last ? last.blocking : ""}`,
    `priorBlockingCount: ${prior ? prior.blocking : ""}`,
    `consecutiveStalls: ${state.consecutiveStalls}`,
    `totalAgentsSpawned: ${state.totalAgentsSpawned}`,
    `startedAt: ${state.startedAt}`,
    `updatedAt: ${new Date().toISOString()}`,
    ``,
    `history[${state.history.length}]{iteration,blocking}:`,
    ...state.history.map((h) => `  ${h.iteration},${h.blocking}`),
    ``,
  ];
  atomicWrite(statePath(config), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export function preflight(configPath: string, cwd = process.cwd()): number {
  let config: ConvergeConfig;
  const preflightPath = path.resolve(cwd, ".plan-execution", "convergence-preflight.toon");

  const fail = (haltReason: HaltReason, detail: string): number => {
    const envelope = [
      `agent: engine-preflight`,
      `status: failure`,
      `haltReason: ${haltReason}`,
      `detail: ${detail}`,
      `cause: ${HALT_CAUSE[haltReason]}`,
      `recovery: ${HALT_RECOVERY[haltReason]}`,
      ``,
    ].join("\n");
    atomicWrite(preflightPath, envelope);
    emitVerdict({ ok: false, haltReason, detail });
    return 1;
  };

  try {
    config = readConvergeConfig(configPath);
  } catch (err) {
    return fail("FINDINGS_SCHEMA_INVALID", `converge.config unreadable: ${(err as Error).message}`);
  }

  if (!config.harness || !fs.existsSync(path.resolve(cwd, config.harness))) {
    return fail("HARNESS_MISSING", `harness path: ${config.harness || "(unset)"}`);
  }

  const integratorFile = path.resolve(cwd, "agents", `${config.integrator}.md`);
  const integratorAlt = path.resolve(cwd, ".claude", "agents", `${config.integrator}.md`);
  if (!config.integrator || (!fs.existsSync(integratorFile) && !fs.existsSync(integratorAlt))) {
    return fail("INTEGRATOR_NOT_FOUND", `integrator: ${config.integrator || "(unset)"}`);
  }

  if (config.convergenceMode === "document" && !config.subject) {
    return fail("FINDINGS_SCHEMA_INVALID", "document mode requires subject");
  }
  if (config.agentBudget < 1) {
    return fail("FINDINGS_SCHEMA_INVALID", "agentBudget must be >= 1");
  }
  if (config.maxIterations < 1 || config.maxIterations > 10) {
    return fail("FINDINGS_SCHEMA_INVALID", "maxIterations must be 1..10");
  }

  // Resume position + integrator model, so the Workflow driver needs no
  // second bootstrap call. Model chain per CLAUDE.md (toml -> frontmatter ->
  // inherit) via the shared resolver.
  const state = readEngineState(config);
  const integratorAgentFile = fs.existsSync(integratorFile) ? integratorFile : integratorAlt;
  const integratorModel = resolveAgentModel({
    agentFile: integratorAgentFile,
    agentName: config.integrator,
    cwd,
  });

  emitVerdict({
    ok: true,
    runId: config.runId,
    mode: config.convergenceMode,
    subject: config.subject,
    harness: config.harness,
    integrator: config.integrator,
    integratorAgentFile: path.relative(cwd, integratorAgentFile),
    integratorModel,
    maxIterations: config.maxIterations,
    agentBudget: config.agentBudget,
    outputPath: config.outputPath,
    nextIteration: state.history.length + 1,
    totalAgentsSpawned: state.totalAgentsSpawned,
  });
  return 0;
}

export function record(opts: {
  configPath: string;
  iteration: number;
  findingsPath: string;
  agentsSpawned: number;
  scopeExpansion: boolean;
  allBlockingFrozen: boolean;
}): number {
  const config = readConvergeConfig(opts.configPath);
  const state = readEngineState(config);

  const findings = validateFindings(opts.findingsPath, opts.iteration);
  if (findings.errors.length > 0) {
    const reason: HaltReason = findings.errors.includes("findings.toon missing")
      ? "HARNESS_MISSING"
      : "FINDINGS_SCHEMA_INVALID";
    process.stdout.write(renderHaltMessage(reason) + "\n");
    emitVerdict({ halt: true, haltReason: reason, errors: findings.errors });
    return 1;
  }

  // Goal-backward verification (C-08): uncovered coverage-matrix rows —
  // including phase promises — are blocking conditions. "All tasks completed"
  // cannot converge past an unwired promise; each gap gets one bounded fix.
  const planExecRoot = path.dirname(statePath(config));
  const gaps = uncoveredGaps(readCoverageMatrix(planExecRoot));
  const effectiveBlocking = findings.blockingCount + gaps.length;
  if (gaps.length > 0) {
    process.stderr.write(
      `[loom:engine] goal-backward: ${gaps.length} uncovered requirement(s) count as blocking: ` +
        gaps.map((g) => g.requirementId).join(", ") +
        "\n"
    );
  }

  const prior = state.history[state.history.length - 1];
  state.history.push({ iteration: opts.iteration, blocking: effectiveBlocking });
  state.totalAgentsSpawned = opts.agentsSpawned;

  // Scope-expansion guard (locked C-06): compare the subject's top-level
  // structural headings against the baseline captured at the previous record
  // call — the delta is what the integrator added in between.
  let scopeExpansion = opts.scopeExpansion;
  let newSections: string[] = [];
  if (config.scopeGuardEnabled && config.subject && fs.existsSync(config.subject)) {
    const current = fs.readFileSync(config.subject, "utf-8");
    if (state.subjectBaseline !== null) {
      newSections = detectScopeExpansion(state.subjectBaseline, current);
      if (newSections.length > 0) scopeExpansion = true;
    }
    atomicWrite(subjectBaselinePath(config), current);
  }

  const verdict = evaluateBreakers({
    mode: config.convergenceMode,
    iteration: opts.iteration,
    maxIterations: config.maxIterations,
    agentBudget: config.agentBudget,
    totalAgentsSpawned: opts.agentsSpawned,
    history: state.history,
    scopeExpansionDetected: scopeExpansion && config.scopeGuardEnabled,
    allBlockingFrozen: opts.allBlockingFrozen,
  });
  state.consecutiveStalls = verdict.consecutiveStalls;
  writeEngineState(config, state);

  // Auto-snapshot writer (locked C-07): before the integrator runs, for
  // iterations >= 2 in document mode. `record` sits between harness and
  // integrator in the loop, so this is the spec'd insertion point.
  let snapshotRef: string | null = null;
  if (
    config.snapshotEnabled &&
    config.subject &&
    !verdict.halt &&
    opts.iteration >= 2 &&
    fs.existsSync(config.subject)
  ) {
    try {
      const ext = path.extname(config.subject);
      const slug = path.basename(config.subject, ext); // W-02: final extension only
      const snapPath = path.join(config.snapshotDir, `${slug}-pass-${opts.iteration}${ext}`);
      const content = fs.readFileSync(config.subject, "utf-8");
      atomicWrite(snapPath, content);
      const checksum = crypto.createHash("sha256").update(content).digest("hex");
      atomicWrite(
        path.join(config.snapshotDir, `${slug}-pass-${opts.iteration}.toon`),
        [
          `sourcePath: ${config.subject}`,
          `snapshotPath: ${snapPath}`,
          `snapshotChecksum: sha256-${checksum}`,
          `iteration: ${opts.iteration}`,
          `timestamp: ${new Date().toISOString()}`,
          `slug: ${slug}`,
          ``,
        ].join("\n")
      );
      snapshotRef = snapPath;
    } catch (err) {
      // SNAPSHOT_WRITE_FAILED: warn and continue — never halt (schema rule).
      process.stderr.write(`SNAPSHOT_WRITE_FAILED: ${(err as Error).message}\n`);
    }
  }

  const prev = prior ? prior.blocking : effectiveBlocking;
  const fixed = Math.max(0, prev - effectiveBlocking);
  const fresh = Math.max(0, effectiveBlocking - prev);

  // iter-{N}.toon — uniform shape across modes
  const iterPath = path.join(
    path.dirname(config.outputPath),
    "iterations",
    `iter-${opts.iteration}.toon`
  );
  const haltSuffix = verdict.haltReason
    ? ` HALT ${verdict.haltReason}: ${HALT_CAUSE[verdict.haltReason]} Recovery: ${HALT_RECOVERY[verdict.haltReason]}`
    : "";
  atomicWrite(
    iterPath,
    [
      `iteration: ${opts.iteration}`,
      `mode: ${config.convergenceMode}`,
      `completedAt: ${new Date().toISOString()}`,
      `findingsBefore: ${prev}`,
      `findingsAfter: ${effectiveBlocking}`,
      `findingsFixed: ${fixed}`,
      `findingsNew: ${fresh}`,
      `advisoryCount: ${findings.advisoryCount}`,
      `stalled: ${verdict.consecutiveStalls > 0}`,
      `haltReason: ${verdict.haltReason ?? ""}`,
      `snapshotRef: ${snapshotRef ?? ""}`,
      `summary: iteration ${opts.iteration} — blocking ${prev} -> ${effectiveBlocking}${gaps.length ? ` (${gaps.length} goal-backward gap(s))` : ""}.${haltSuffix}`,
      ``,
    ].join("\n")
  );

  // Locked C-09 stdout line, then C-10 halt block when a breaker fired.
  process.stdout.write(
    renderIterationLine(opts.iteration, config.maxIterations, prev, effectiveBlocking, fixed, fresh) + "\n"
  );
  if (verdict.halt && verdict.haltReason) {
    process.stdout.write(renderHaltMessage(verdict.haltReason) + "\n");
  }

  emitVerdict({
    halt: verdict.halt,
    haltReason: verdict.haltReason ?? null,
    status: verdict.status ?? null,
    blockingCount: effectiveBlocking,
    findingsBlockingCount: findings.blockingCount,
    gaps: gaps.map((g) => ({ requirementId: g.requirementId, requirementText: g.requirementText, source: g.source })),
    advisoryCount: findings.advisoryCount,
    priorBlockingCount: prev,
    fixed,
    new: fresh,
    consecutiveStalls: verdict.consecutiveStalls,
    totalAgentsSpawned: opts.agentsSpawned,
    snapshotRef,
    newSections,
  });
  return 0;
}

export function finalize(opts: {
  configPath: string;
  haltReason?: HaltReason;
  startedAt?: string;
}): number {
  const config = readConvergeConfig(opts.configPath);
  const state = readEngineState(config);
  const last = state.history[state.history.length - 1];
  const status = opts.haltReason
    ? STATUS_BY_HALT_REASON[opts.haltReason]
    : "converged";

  const summaryPath = path.join(path.dirname(statePath(config)), "convergence-summary.toon");
  atomicWrite(
    summaryPath,
    [
      `runId: ${state.runId}`,
      `convergenceMode: ${config.convergenceMode}`,
      `subject: ${config.subject ?? ""}`,
      `harnessName: ${path.basename(config.harness).replace(/\.(ts|mjs|js)$/, "")}`,
      `integratorName: ${config.integrator}`,
      `status: ${status}`,
      `finalBlockingCount: ${last ? last.blocking : 0}`,
      `iterationsRun: ${state.history.length}`,
      `haltReason: ${opts.haltReason ?? ""}`,
      `startedAt: ${opts.startedAt ?? state.startedAt}`,
      `completedAt: ${new Date().toISOString()}`,
      ``,
    ].join("\n")
  );

  emitVerdict({
    ok: true,
    status,
    haltReason: opts.haltReason ?? null,
    finalBlockingCount: last ? last.blocking : 0,
    iterationsRun: state.history.length,
    summaryPath,
  });
  return 0;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[]): number {
  const [sub] = argv;
  const configPath = argValue(argv, "--config");
  if (!configPath) {
    process.stderr.write("--config is required\n");
    return 2;
  }
  switch (sub) {
    case "preflight":
      return preflight(configPath);
    case "record":
      return record({
        configPath,
        iteration: Number(argValue(argv, "--iteration") ?? 0),
        findingsPath: argValue(argv, "--findings") ?? "",
        agentsSpawned: Number(argValue(argv, "--agents-spawned") ?? 0),
        scopeExpansion: argv.includes("--scope-expansion"),
        allBlockingFrozen: argv.includes("--all-blocking-frozen"),
      });
    case "finalize":
      return finalize({
        configPath,
        haltReason: argValue(argv, "--halt-reason") as HaltReason | undefined,
        startedAt: argValue(argv, "--started-at"),
      });
    default:
      process.stderr.write(`Unknown subcommand: ${sub ?? "(none)"}\n`);
      return 2;
  }
}

const isEntry =
  import.meta.main === true || import.meta.url === `file://${process.argv[1]}`;

if (isEntry) {
  process.exit(main(process.argv.slice(2)));
}

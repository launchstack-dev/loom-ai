/**
 * Canned harness + canned integrator + fixture-local driver substrate for the
 * document-mode e2e test (`test/e2e/convergence/document-mode.test.ts`,
 * Phase 13 of `PLAN-convergence-generalization.md`).
 *
 * This module is NOT the production plan-review harness. It is a deterministic
 * fixture that emulates the harness/integrator contract documented in:
 *   - `protocols/findings.schema.md` (ConvergenceFindings TOON shape)
 *   - `protocols/iteration-snapshot.schema.md` (IterationSnapshot TOON
 *     shape and slug derivation rule)
 *   - `protocols/stage-context.schema.md` (ConvergenceIterationSummary
 *     shape — uniform across modes)
 *   - `agents/convergence-driver.md` § Document Mode Safeguards (scope guard
 *     regex set + auto-snapshot writer placement)
 *
 * The fixture exposes three exports:
 *   - `runCannedHarness(ctx)`     — writes a `findings.toon` per the scripted
 *     blockingCount + dimension sequence; the test calls this in place of
 *     spawning a real harness process.
 *   - `runDocumentModeLoop(ctx)`  — minimal driver substrate that drives the
 *     scripted harness, fires the integrator, runs the scope-expansion guard,
 *     and writes `iter-{N}.toon` + `convergence-state.toon` +
 *     `convergence-summary.toon`. Mirrors the deterministic on-disk pieces of
 *     `agents/convergence-driver.md` so the test can assert the contract end-
 *     to-end without actually spawning agents.
 *   - `resolveIntegratorPath(...)` — fixture-local integrator resolver. Mirrors
 *     production's "agent name -> {dir}/{name}.md" lookup, parameterized over
 *     a fixture directory so the test can point at
 *     `fixtures/document-mode/canned-integrator.md` instead of
 *     `~/.claude/agents/`.
 *
 * Determinism guarantees (acceptance criteria #5 in the Phase 13 prompt):
 *   - All timestamps are injected via the optional `now` parameter — defaults
 *     to a fixed string for reproducibility.
 *   - All writes are atomic (write to `.tmp`, then rename) via either Node's
 *     `fs.renameSync` or the production `writeIterationSnapshot` helper.
 *   - No `Math.random`, no `Date.now()` without injection, no network.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  writeIterationSnapshot,
  type IterationSnapshotRecord,
} from "../../../../../hooks/lib/iteration-snapshot.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Mirrors the locked enum in `findings.schema.md`. */
export type FindingSeverity = "blocking" | "warning" | "info" | "advisory";

/** Mirrors one row of `findings[]` in `ConvergenceFindings`. */
export interface ScriptedFinding {
  id: string;
  dimension: string;
  severity: FindingSeverity;
  summary: string;
  /** Optional — empty string is fine for whole-file findings. */
  locationAnchor?: string;
}

/** One iteration's scripted harness output. */
export interface HarnessScriptStep {
  /** 1-indexed iteration number this step applies to. */
  iteration: number;
  findings: ScriptedFinding[];
}

/** Mirrors `IntegratorAction` in the test prompt's scope-expansion case. */
export type IntegratorAction =
  | { kind: "noop" }
  | { kind: "rewrite-existing-phase"; newPhaseBody: string }
  | { kind: "add-top-level-phase"; phaseNumber: number; body?: string };

/** One iteration's scripted integrator behaviour. */
export interface IntegratorScriptStep {
  iteration: number;
  action: IntegratorAction;
}

/** Mirrors the `converge.config` fields the substrate reads. */
export interface CannedConvergeConfig {
  convergenceMode: "document";
  subject: string;
  integrator: string;
  harness: string;
  outputPath: string;
  maxIterations: number;
  agentBudget: number;
  scopeGuardEnabled: boolean;
  snapshotEnabled: boolean;
  snapshotDir: string;
}

/** Run context shared by all the fixture helpers. */
export interface DocumentModeFixtureContext {
  /** Working directory for the run — analogous to repo root. */
  workDir: string;
  /** Resolved config (already loaded + defaulted by the test). */
  config: CannedConvergeConfig;
  /** Harness script — one entry per iteration the harness will be asked to run. */
  harnessScript: HarnessScriptStep[];
  /** Integrator script — one entry per iteration the integrator will be asked to run. */
  integratorScript: IntegratorScriptStep[];
  /**
   * Optional clock. Defaults to a fixed ISO 8601 string sequenced by call
   * count so timestamps within a single run remain strictly monotonic without
   * leaking wall-clock state.
   */
  now?: () => Date;
  /**
   * Optional run identifier — defaults to a fixed value so
   * `convergence-summary.toon` is deterministic across runs.
   */
  runId?: string;
}

/** Terminal status mirroring `convergence-summary.schema.md` Status Enum. */
export type ConvergenceTerminalStatus =
  | "converged"
  | "halted-stall"
  | "halted-regression"
  | "halted-budget"
  | "halted-max-iter"
  | "halted-scope-expansion";

/** Terminal halt reasons per `convergence-summary.schema.md`. */
export type HaltReason =
  | "STALL"
  | "REGRESSION"
  | "BUDGET_EXHAUSTED"
  | "MAX_ITERATIONS"
  | "SCOPE_EXPANSION"
  | "INTEGRATOR_NOT_FOUND"
  | "HARNESS_MISSING"
  | "FINDINGS_SCHEMA_INVALID";

/** Aggregate result of running the full fixture loop. */
export interface FixtureLoopResult {
  status: ConvergenceTerminalStatus;
  iterationsRun: number;
  finalBlockingCount: number;
  haltReason: HaltReason | null;
  /** Paths the loop wrote to disk (relative to workDir). */
  iterationSummaries: string[];
  snapshotRecords: IterationSnapshotRecord[];
  convergenceStatePath: string;
  convergenceSummaryPath: string;
}

// ---------------------------------------------------------------------------
// Constants (kept in sync with `agents/convergence-driver.md` § Document Mode Safeguards)
// ---------------------------------------------------------------------------

/**
 * The three regexes that detect a scope-expansion event. Reproduced from
 * `agents/convergence-driver.md § Scope-Expansion Guard (locked C-06)`. If the
 * driver doc changes these, this fixture must change in lockstep — that is the
 * Phase 13 acceptance criterion that the on-disk artifacts validate against
 * the SAME shape used by target/criteria modes.
 */
export const SCOPE_EXPANSION_REGEXES: readonly RegExp[] = [
  /^### Phase \d+/m,
  /^### F-\d+/m,
  /^### M-\d+/m,
];

/**
 * Run the three scope-expansion regexes against a multi-line string and
 * return every matched heading text. Each match keeps the full heading line
 * (everything up to the first newline) so the diff is identity-based.
 */
export function collectScopeHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  const lines = content.split("\n");
  // Use line-anchored regexes WITHOUT the `m` flag because we're testing each
  // line independently — keeps the per-line semantics the driver doc spells
  // out (line-start anchor at column 0).
  const perLine: readonly RegExp[] = [
    /^### Phase \d+/,
    /^### F-\d+/,
    /^### M-\d+/,
  ];
  for (const line of lines) {
    for (const rx of perLine) {
      if (rx.test(line)) {
        headings.add(line);
        break;
      }
    }
  }
  return headings;
}

// ---------------------------------------------------------------------------
// Integrator dispatch
// ---------------------------------------------------------------------------

/**
 * Fixture-local integrator resolver. Mirrors production's dispatch contract:
 * given an agent name, look for `{dir}/{name}.md`. Returns the absolute path
 * on success or throws so the caller can map the failure to
 * `INTEGRATOR_NOT_FOUND` per `agents/convergence-driver.md` preflight check 4.
 *
 * The base directory is parameterized so the test can point at the fixture
 * directory (`fixtures/document-mode/`) instead of the production agent root.
 * This is the dispatch path declared in `converge.config.integrator`.
 */
export function resolveIntegratorPath(
  integratorName: string,
  baseDir: string,
): string {
  const candidate = join(baseDir, `${integratorName}.md`);
  if (!existsSync(candidate)) {
    throw new Error(
      `INTEGRATOR_NOT_FOUND: integrator '${integratorName}' did not resolve to ${candidate}. Fix the 'integrator' field in converge.config.`,
    );
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Canned harness
// ---------------------------------------------------------------------------

/** Arguments accepted by `runCannedHarness`. */
export interface RunCannedHarnessArgs {
  /** Absolute path the harness writes its findings.toon to. */
  outputPath: string;
  /** Subject path recorded inside findings.toon (matches converge.config). */
  subject: string;
  /** 1-indexed iteration number. */
  iteration: number;
  /** The script step for this iteration. */
  step: HarnessScriptStep;
  /** Harness name to record in findings.toon. */
  harnessName?: string;
  /** Injectable clock; defaults to a fixed ISO timestamp. */
  now?: () => Date;
}

/**
 * Write a `findings.toon` per the script, atomically. The on-disk shape
 * matches `protocols/findings.schema.md` — including the three
 * count invariants (severity-mapping is enforced row-by-row below).
 */
export function runCannedHarness(args: RunCannedHarnessArgs): {
  blockingCount: number;
  advisoryCount: number;
  path: string;
} {
  const {
    outputPath,
    subject,
    iteration,
    step,
    harnessName = "canned-harness",
    now = () => new Date("2026-06-13T00:00:00.000Z"),
  } = args;

  if (step.iteration !== iteration) {
    throw new Error(
      `canned-harness script mismatch: requested iteration ${iteration}, script step is for iteration ${step.iteration}`,
    );
  }

  let blockingCount = 0;
  let advisoryCount = 0;
  for (const f of step.findings) {
    if (f.severity === "blocking") blockingCount += 1;
    else advisoryCount += 1;
  }

  const producedAt = now().toISOString();
  const lines: string[] = [];
  lines.push(`subject: ${subject}`);
  lines.push(`harnessName: ${harnessName}`);
  lines.push(`iteration: ${iteration}`);
  lines.push(`blockingCount: ${blockingCount}`);
  lines.push(`advisoryCount: ${advisoryCount}`);
  lines.push(`producedAt: ${producedAt}`);
  lines.push("");
  lines.push(
    `findings[${step.findings.length}]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:`,
  );
  for (const f of step.findings) {
    const row = [
      f.id,
      f.dimension,
      f.severity,
      subject,
      f.locationAnchor ?? "",
      f.summary,
      "",
      "",
    ].join(",");
    lines.push(`  ${row}`);
  }
  lines.push("");

  atomicWrite(outputPath, lines.join("\n"));

  return { blockingCount, advisoryCount, path: outputPath };
}

// ---------------------------------------------------------------------------
// Canned integrator
// ---------------------------------------------------------------------------

/**
 * Apply the scripted integrator action to the subject file in-place. This is
 * the test's stand-in for "spawn the integrator agent" — the agent .md file
 * (`canned-integrator.md`) exists purely so the dispatch path resolves; the
 * actual edit is performed deterministically here.
 */
export function applyIntegratorAction(
  subjectAbs: string,
  action: IntegratorAction,
): void {
  if (action.kind === "noop") {
    return;
  }
  const current = readFileSync(subjectAbs, "utf8");
  if (action.kind === "rewrite-existing-phase") {
    // Replace the FIRST `### Phase 1` block's bullet line with the new body.
    // Specifically: locate `### Phase 1`, take everything before it, then
    // emit `### Phase 1\n` + the new body. This deepens the existing phase
    // without adding a NEW top-level heading — so the scope guard MUST NOT
    // fire for this action.
    const marker = "### Phase 1";
    const idx = current.indexOf(marker);
    if (idx < 0) {
      throw new Error(
        `rewrite-existing-phase: subject does not contain '${marker}'`,
      );
    }
    const head = current.slice(0, idx + marker.length);
    const updated = `${head}\n${action.newPhaseBody.trimEnd()}\n`;
    atomicWrite(subjectAbs, updated);
    return;
  }
  if (action.kind === "add-top-level-phase") {
    // Append a brand-new `### Phase {N}` heading to the end of the file. This
    // is the scope-expansion case the C-06 guard MUST detect.
    const trailer = current.endsWith("\n") ? "" : "\n";
    const newBody = action.body ?? "- New top-level phase added by integrator.";
    const updated = `${current}${trailer}\n### Phase ${action.phaseNumber}\n${newBody}\n`;
    atomicWrite(subjectAbs, updated);
    return;
  }
  // Exhaustiveness — TS will complain at compile time if a new kind is added.
  const _exhaustive: never = action;
  throw new Error(`unhandled integrator action: ${JSON.stringify(_exhaustive)}`);
}

// ---------------------------------------------------------------------------
// Iteration summary writer (uniform shape across modes — Phase 13 AC #3)
// ---------------------------------------------------------------------------

/** Subset of `ConvergenceIterationSummary` fields the fixture writes. */
export interface IterationSummary {
  iteration: number;
  mode: "document";
  subject: string;
  snapshotRef: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  harnessResult: "pass" | "fail" | "partial";
  findingsBefore: number;
  findingsAfter: number;
  findingsFixed: string[];
  findingsNew: string[];
  filesModified: string[];
  stalled: boolean;
  summary: string;
  haltReason?: HaltReason | null;
}

export function serializeIterationSummary(s: IterationSummary): string {
  const lines: string[] = [];
  lines.push(`iteration: ${s.iteration}`);
  lines.push(`mode: ${s.mode}`);
  lines.push(`subject: ${s.subject}`);
  lines.push(`snapshotRef: ${s.snapshotRef ?? ""}`);
  lines.push(`startedAt: ${s.startedAt}`);
  lines.push(`completedAt: ${s.completedAt}`);
  lines.push(`durationMs: ${s.durationMs}`);
  lines.push(`harnessResult: ${s.harnessResult}`);
  lines.push(`findingsBefore: ${s.findingsBefore}`);
  lines.push(`findingsAfter: ${s.findingsAfter}`);
  lines.push(`findingsFixed[${s.findingsFixed.length}]:${s.findingsFixed.length ? "" : ""}`);
  for (const f of s.findingsFixed) lines.push(`  ${f}`);
  lines.push(`findingsNew[${s.findingsNew.length}]:`);
  for (const f of s.findingsNew) lines.push(`  ${f}`);
  lines.push(`filesModified[${s.filesModified.length}]: ${s.filesModified.join(",")}`);
  lines.push(`stalled: ${s.stalled}`);
  lines.push(`summary: ${s.summary}`);
  if (s.haltReason) {
    lines.push(`haltReason: ${s.haltReason}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Parse only the subset of fields the test asserts against. */
export function parseIterationSummary(content: string): IterationSummary {
  // Note: `\s*` would match newlines and bleed into the next field's value.
  // We use `[ \t]*` to keep the match anchored to the current line.
  const get = (key: string): string | undefined => {
    const m = content.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    return m ? m[1].trim() : undefined;
  };
  const findingsBefore = parseInt(get("findingsBefore") ?? "0", 10);
  const findingsAfter = parseInt(get("findingsAfter") ?? "0", 10);
  const filesModifiedRaw = get("filesModified")?.replace(/^\[\d+\]:[ \t]*/, "") ?? "";
  const filesModified = filesModifiedRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const snapshotRefRaw = get("snapshotRef") ?? "";
  return {
    iteration: parseInt(get("iteration") ?? "0", 10),
    mode: "document",
    subject: get("subject") ?? "",
    snapshotRef: snapshotRefRaw.length > 0 ? snapshotRefRaw : null,
    startedAt: get("startedAt") ?? "",
    completedAt: get("completedAt") ?? "",
    durationMs: parseInt(get("durationMs") ?? "0", 10),
    harnessResult: (get("harnessResult") ?? "fail") as "pass" | "fail" | "partial",
    findingsBefore,
    findingsAfter,
    findingsFixed: [],
    findingsNew: [],
    filesModified,
    stalled: (get("stalled") ?? "false") === "true",
    summary: get("summary") ?? "",
    haltReason: (get("haltReason") as HaltReason | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------
// State + summary writers (for AC #6 — resume from state.toon)
// ---------------------------------------------------------------------------

export interface DocumentModeState {
  iteration: number;
  maxIterations: number;
  convergenceMode: "document";
  configPath: string;
  subject: string;
  status: "iterating" | "converged" | "halted";
  blockingCount: number;
  agentsSpawned: number;
  agentBudget: number;
  history: Array<{ iteration: number; blockingCount: number; agentsUsed: number }>;
}

export function serializeState(s: DocumentModeState): string {
  const lines: string[] = [];
  lines.push(`iteration: ${s.iteration}`);
  lines.push(`maxIterations: ${s.maxIterations}`);
  lines.push(`convergenceMode: ${s.convergenceMode}`);
  lines.push(`configPath: ${s.configPath}`);
  lines.push(`subject: ${s.subject}`);
  lines.push(`status: ${s.status}`);
  lines.push(`blockingCount: ${s.blockingCount}`);
  lines.push(`agentsSpawned: ${s.agentsSpawned}`);
  lines.push(`agentBudget: ${s.agentBudget}`);
  lines.push(
    `history[${s.history.length}]{iteration,blockingCount,agentsUsed}:`,
  );
  for (const h of s.history) {
    lines.push(`  ${h.iteration},${h.blockingCount},${h.agentsUsed}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function parseState(content: string): DocumentModeState {
  // `\s*` would match across newlines; pin to spaces/tabs only.
  const get = (key: string): string => {
    const m = content.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const history: DocumentModeState["history"] = [];
  // Match the typed-array block: header line + indented rows until a blank
  // line or end-of-file.
  const headerIdx = content.search(/^history\[\d+\]\{iteration,blockingCount,agentsUsed\}:/m);
  if (headerIdx >= 0) {
    const after = content.slice(headerIdx).split("\n").slice(1);
    for (const line of after) {
      if (!line.startsWith("  ")) break;
      const trimmed = line.trim();
      if (!trimmed) break;
      const [it, bc, au] = trimmed.split(",").map((s) => parseInt(s, 10));
      history.push({ iteration: it, blockingCount: bc, agentsUsed: au });
    }
  }
  return {
    iteration: parseInt(get("iteration") || "0", 10),
    maxIterations: parseInt(get("maxIterations") || "5", 10),
    convergenceMode: "document",
    configPath: get("configPath"),
    subject: get("subject"),
    status: (get("status") || "iterating") as DocumentModeState["status"],
    blockingCount: parseInt(get("blockingCount") || "0", 10),
    agentsSpawned: parseInt(get("agentsSpawned") || "0", 10),
    agentBudget: parseInt(get("agentBudget") || "30", 10),
    history,
  };
}

export interface ConvergenceSummary {
  runId: string;
  convergenceMode: "document";
  subject: string;
  harnessName: string;
  integratorName: string;
  status: ConvergenceTerminalStatus;
  finalBlockingCount: number;
  iterationsRun: number;
  haltReason: HaltReason | null;
  startedAt: string;
  completedAt: string;
}

export function serializeSummary(s: ConvergenceSummary): string {
  const lines: string[] = [];
  lines.push(`runId: ${s.runId}`);
  lines.push(`convergenceMode: ${s.convergenceMode}`);
  lines.push(`subject: ${s.subject}`);
  lines.push(`harnessName: ${s.harnessName}`);
  lines.push(`integratorName: ${s.integratorName}`);
  lines.push(`status: ${s.status}`);
  lines.push(`finalBlockingCount: ${s.finalBlockingCount}`);
  lines.push(`iterationsRun: ${s.iterationsRun}`);
  lines.push(`haltReason: ${s.haltReason ?? ""}`);
  lines.push(`startedAt: ${s.startedAt}`);
  lines.push(`completedAt: ${s.completedAt}`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Driver substrate
// ---------------------------------------------------------------------------

/**
 * Run the full document-mode convergence loop against the canned harness +
 * canned integrator. Returns the terminal status + iteration trace.
 *
 * Loop order mirrors `agents/convergence-driver.md` § Convergence Loop:
 *   1. Read state (or initialize).
 *   2. Run harness for iteration N -> write findings.toon.
 *   3. If blockingCount == 0 -> converged. Write iter-N.toon (no integrator).
 *   4. Else, if N >= 2 and snapshotEnabled -> write snapshot.
 *   5. Apply integrator action (canned).
 *   6. Run scope-expansion guard against snapshot vs current subject. If new
 *      top-level headings present -> halt SCOPE_EXPANSION.
 *   7. Otherwise continue to iteration N+1 (re-run harness).
 *
 * Stall/regression checks compare blockingCount vs prior iteration per the
 * driver's circuit-breaker contract.
 */
export async function runDocumentModeLoop(
  ctx: DocumentModeFixtureContext,
  options: {
    /** When provided, resume from this pre-existing state.toon path. */
    resumeFromStatePath?: string;
    /** When provided, resume re-uses these prior iter-N.toon paths. */
    resumeFromIterationPaths?: string[];
  } = {},
): Promise<FixtureLoopResult> {
  const { workDir, config, harnessScript, integratorScript } = ctx;
  const runId = ctx.runId ?? "conv-2026-06-13-00-00-00-001";

  // Deterministic clock: each call advances by 1 second.
  let clockCount = 0;
  const baseClock = new Date("2026-06-13T00:00:00.000Z").getTime();
  const now = ctx.now ?? (() => new Date(baseClock + (clockCount++ * 1000)));

  const findingsPath = resolveUnder(workDir, config.outputPath);
  const snapshotDirAbs = resolveUnder(workDir, config.snapshotDir);
  const subjectAbs = resolveUnder(workDir, config.subject);

  const iterDir = join(workDir, "convergence", "iterations");
  mkdirSync(iterDir, { recursive: true });
  mkdirSync(dirname(findingsPath), { recursive: true });
  mkdirSync(snapshotDirAbs, { recursive: true });

  // Optional resume.
  let startIteration = 1;
  let priorBlocking: number | null = null;
  let agentsSpawned = 0;
  let history: DocumentModeState["history"] = [];
  const iterationSummaries: string[] = [];
  const snapshotRecords: IterationSnapshotRecord[] = [];

  if (options.resumeFromStatePath) {
    const stateContent = readFileSync(options.resumeFromStatePath, "utf8");
    const prior = parseState(stateContent);
    startIteration = prior.iteration + 1;
    priorBlocking = prior.blockingCount;
    agentsSpawned = prior.agentsSpawned;
    history = prior.history.slice();
    if (options.resumeFromIterationPaths) {
      iterationSummaries.push(...options.resumeFromIterationPaths);
    }
  }

  const runStartedAt = now().toISOString();
  let status: ConvergenceTerminalStatus = "halted-max-iter";
  let haltReason: HaltReason | null = "MAX_ITERATIONS";
  let finalBlocking = 0;
  let lastIteration = startIteration - 1;

  for (let i = startIteration; i <= config.maxIterations; i++) {
    lastIteration = i;
    const iterStartedAt = now().toISOString();
    const harnessStep = harnessScript.find((s) => s.iteration === i);
    if (!harnessStep) {
      throw new Error(`canned-harness script has no step for iteration ${i}`);
    }
    // Step 2: run harness.
    const harnessOut = runCannedHarness({
      outputPath: findingsPath,
      subject: config.subject,
      iteration: i,
      step: harnessStep,
      now,
    });
    finalBlocking = harnessOut.blockingCount;

    // Step 3: convergence check.
    if (harnessOut.blockingCount === 0) {
      status = "converged";
      haltReason = null;
      const summary: IterationSummary = {
        iteration: i,
        mode: "document",
        subject: config.subject,
        snapshotRef: null,
        startedAt: iterStartedAt,
        completedAt: now().toISOString(),
        durationMs: 1000,
        harnessResult: "pass",
        findingsBefore: priorBlocking ?? 0,
        findingsAfter: 0,
        findingsFixed: harnessStep.findings.map((f) => `${f.id}: ${f.summary}`),
        findingsNew: [],
        filesModified: [],
        stalled: false,
        summary: "Converged at iteration " + i + ".",
        haltReason: null,
      };
      const iterPath = join(iterDir, `iter-${i}.toon`);
      atomicWrite(iterPath, serializeIterationSummary(summary));
      iterationSummaries.push(iterPath);
      history.push({ iteration: i, blockingCount: 0, agentsUsed: 0 });
      break;
    }

    // Stall / regression checks against prior iteration.
    if (priorBlocking !== null) {
      if (harnessOut.blockingCount > priorBlocking) {
        status = "halted-regression";
        haltReason = "REGRESSION";
        const summary: IterationSummary = {
          iteration: i,
          mode: "document",
          subject: config.subject,
          snapshotRef: null,
          startedAt: iterStartedAt,
          completedAt: now().toISOString(),
          durationMs: 1000,
          harnessResult: "fail",
          findingsBefore: priorBlocking,
          findingsAfter: harnessOut.blockingCount,
          findingsFixed: [],
          findingsNew: harnessStep.findings.map((f) => `${f.id}: ${f.summary}`),
          filesModified: [],
          stalled: false,
          summary: "Regression detected: blockingCount increased from " + priorBlocking + " to " + harnessOut.blockingCount + ".",
          haltReason: "REGRESSION",
        };
        const iterPath = join(iterDir, `iter-${i}.toon`);
        atomicWrite(iterPath, serializeIterationSummary(summary));
        iterationSummaries.push(iterPath);
        history.push({ iteration: i, blockingCount: harnessOut.blockingCount, agentsUsed: 0 });
        break;
      }
      if (harnessOut.blockingCount === priorBlocking) {
        status = "halted-stall";
        haltReason = "STALL";
        const summary: IterationSummary = {
          iteration: i,
          mode: "document",
          subject: config.subject,
          snapshotRef: null,
          startedAt: iterStartedAt,
          completedAt: now().toISOString(),
          durationMs: 1000,
          harnessResult: "fail",
          findingsBefore: priorBlocking,
          findingsAfter: harnessOut.blockingCount,
          findingsFixed: [],
          findingsNew: [],
          filesModified: [],
          stalled: true,
          summary: "Stall detected: blockingCount unchanged at " + harnessOut.blockingCount + " across 2 iterations.",
          haltReason: "STALL",
        };
        const iterPath = join(iterDir, `iter-${i}.toon`);
        atomicWrite(iterPath, serializeIterationSummary(summary));
        iterationSummaries.push(iterPath);
        history.push({ iteration: i, blockingCount: harnessOut.blockingCount, agentsUsed: 0 });
        break;
      }
    }

    // Step 4: snapshot (iteration >= 2 only, per C-07).
    let snapshotRef: string | null = null;
    if (config.snapshotEnabled && i >= 2) {
      try {
        const record = await writeIterationSnapshot({
          subject: subjectAbs,
          iteration: i,
          snapshotDir: snapshotDirAbs,
          repoRoot: workDir,
          now,
        });
        snapshotRecords.push(record);
        snapshotRef = record.snapshotPath;
      } catch (err) {
        // Warn-and-continue per the schema; snapshotRef stays null.
        snapshotRef = null;
      }
    }

    // Capture the pre-integration subject for the scope guard diff. This is
    // either the snapshot we just wrote (preferred) or the subject we read
    // from disk on iteration 1.
    const preIntegration = readFileSync(subjectAbs, "utf8");
    const preHeadings = collectScopeHeadings(preIntegration);

    // Step 5: integrator.
    const integratorStep = integratorScript.find((s) => s.iteration === i);
    if (!integratorStep) {
      throw new Error(`canned-integrator script has no step for iteration ${i}`);
    }
    applyIntegratorAction(subjectAbs, integratorStep.action);
    agentsSpawned += 1;

    // Step 6: scope-expansion guard.
    if (config.scopeGuardEnabled && i >= 2) {
      const postIntegration = readFileSync(subjectAbs, "utf8");
      const postHeadings = collectScopeHeadings(postIntegration);
      const newHeadings: string[] = [];
      for (const h of postHeadings) {
        if (!preHeadings.has(h)) newHeadings.push(h);
      }
      if (newHeadings.length > 0) {
        status = "halted-scope-expansion";
        haltReason = "SCOPE_EXPANSION";
        const summary: IterationSummary = {
          iteration: i,
          mode: "document",
          subject: config.subject,
          snapshotRef,
          startedAt: iterStartedAt,
          completedAt: now().toISOString(),
          durationMs: 1000,
          harnessResult: "partial",
          findingsBefore: priorBlocking ?? 0,
          findingsAfter: harnessOut.blockingCount,
          findingsFixed: [],
          findingsNew: [],
          filesModified: [config.subject],
          stalled: false,
          summary: `Scope expansion detected: integrator added ${newHeadings.join(", ")} to subject`,
          haltReason: "SCOPE_EXPANSION",
        };
        const iterPath = join(iterDir, `iter-${i}.toon`);
        atomicWrite(iterPath, serializeIterationSummary(summary));
        iterationSummaries.push(iterPath);
        history.push({ iteration: i, blockingCount: harnessOut.blockingCount, agentsUsed: 1 });
        break;
      }
    }

    // Step 7: write the iter-{N}.toon row and continue.
    const summary: IterationSummary = {
      iteration: i,
      mode: "document",
      subject: config.subject,
      snapshotRef,
      startedAt: iterStartedAt,
      completedAt: now().toISOString(),
      durationMs: 1000,
      harnessResult: "partial",
      findingsBefore: priorBlocking ?? 0,
      findingsAfter: harnessOut.blockingCount,
      findingsFixed: [],
      findingsNew: [],
      filesModified: [config.subject],
      stalled: false,
      summary: "Iteration " + i + " completed with " + harnessOut.blockingCount + " blocking finding(s) remaining.",
      haltReason: null,
    };
    const iterPath = join(iterDir, `iter-${i}.toon`);
    atomicWrite(iterPath, serializeIterationSummary(summary));
    iterationSummaries.push(iterPath);
    history.push({ iteration: i, blockingCount: harnessOut.blockingCount, agentsUsed: 1 });
    priorBlocking = harnessOut.blockingCount;
  }

  // If the loop exhausted maxIterations without converging, surface
  // MAX_ITERATIONS.
  if (status === "halted-max-iter" && history.length === config.maxIterations) {
    haltReason = "MAX_ITERATIONS";
  }

  // Write convergence-state.toon
  const state: DocumentModeState = {
    iteration: lastIteration,
    maxIterations: config.maxIterations,
    convergenceMode: "document",
    configPath: config.harness,
    subject: config.subject,
    status: status === "converged" ? "converged" : "halted",
    blockingCount: finalBlocking,
    agentsSpawned,
    agentBudget: config.agentBudget,
    history,
  };
  const convergenceStatePath = join(workDir, "convergence-state.toon");
  atomicWrite(convergenceStatePath, serializeState(state));

  // Write convergence-summary.toon
  const summary: ConvergenceSummary = {
    runId,
    convergenceMode: "document",
    subject: config.subject,
    harnessName: "canned-harness",
    integratorName: config.integrator,
    status,
    finalBlockingCount: finalBlocking,
    iterationsRun: history.length,
    haltReason,
    startedAt: runStartedAt,
    completedAt: now().toISOString(),
  };
  const convergenceSummaryPath = join(workDir, "convergence-summary.toon");
  atomicWrite(convergenceSummaryPath, serializeSummary(summary));

  return {
    status,
    iterationsRun: history.length,
    finalBlockingCount: finalBlocking,
    haltReason,
    iterationSummaries,
    snapshotRecords,
    convergenceStatePath,
    convergenceSummaryPath,
  };
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function resolveUnder(workDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(workDir, p);
}

function atomicWrite(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, absPath);
}

/** Helper exposed for the test: compute sha256 of a buffer as sha256:hex. */
export function sha256Hex(content: Buffer | string): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

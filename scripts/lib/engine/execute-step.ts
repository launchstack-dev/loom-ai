#!/usr/bin/env tsx
/**
 * Wave-execution step CLI (M-2, D-M2-01). The executable counterpart of
 * `commands/loom-plan/execute.md`'s state machine for the Workflow driver
 * (`workflows/loom-execute.mjs`). Owns everything deterministic:
 *
 *   init        — create .plan-execution/ skeleton + state.toon + start tag
 *   start-wave  — mark wave in_progress (tasks pending), rollback tag
 *                 `plan-exec-wave-N-pre`
 *   record-wave — apply task results, verification outcome, and the AUTO
 *                 quality-gate rules (PROCEED / RETRY / ESCALATE per
 *                 execute.md Step 4/9); write wave-N-summary.toon
 *   finalize    — terminal plan status
 *
 * Scope notes (recorded design decisions):
 * - The Workflow driver is the `--auto` path. Human-gated execution keeps the
 *   markdown driver on every profile — a Workflow run cannot pause mid-run
 *   for approval.
 * - PLAN.md parsing is the preflight AGENT's job (structured output); this
 *   CLI consumes the parsed wave/task structure as JSON files.
 * - state.toon stays the canonical interop artifact (hooks read it); the
 *   driver's complete loop state lives in ephemeral/execute-driver-state.json.
 *
 * Every subcommand prints a single JSON verdict as the LAST stdout line.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannedTask {
  taskId: string;
  agent: string;
  description: string;
  fileOwnership: string[];
  /** Resolved model for the spawn (mandatory chain). */
  model?: string;
  status?: TaskStatus;
  retryCount?: number;
}

export type TaskStatus = "pending" | "in_progress" | "succeeded" | "failed";

export interface TaskResult {
  taskId: string;
  status: "succeeded" | "failed";
  filesModified?: string[];
  blockingIssues?: number;
  summary?: string;
}

export interface VerificationResult {
  result: "pass" | "fail";
  /** Failing checks, if any. */
  failures?: string[];
  /** True when every failure is inside this wave's owned files. */
  failuresInOwnedFiles?: boolean;
}

export type GateDecision = "proceed" | "retry" | "escalate";

interface DriverState {
  runId: string;
  planFile: string;
  status: "running" | "completed" | "failed" | "paused";
  currentWave: number;
  startedAt: string;
  waves: Record<
    string,
    {
      status: "pending" | "in_progress" | "succeeded" | "failed";
      tasks: PlannedTask[];
      verificationResult?: "pass" | "fail";
      gateDecision?: GateDecision;
    }
  >;
}

const PLAN_EXEC = ".plan-execution";
const DRIVER_STATE = path.join(PLAN_EXEC, "ephemeral", "execute-driver-state.json");
const MAX_RETRIES = 2; // execute.md retry rule: retryCount >= 2 → escalate

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath + ".tmp", content, "utf-8");
  fs.renameSync(filePath + ".tmp", filePath);
}

function emitVerdict(v: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(v) + "\n");
}

function readDriverState(): DriverState {
  return JSON.parse(fs.readFileSync(DRIVER_STATE, "utf-8")) as DriverState;
}

function writeDriverState(state: DriverState): void {
  atomicWrite(DRIVER_STATE, JSON.stringify(state, null, 2));
  writeStateToon(state);
}

/** Render the canonical state.toon (state.schema.md) — hooks read this. */
function writeStateToon(state: DriverState): void {
  const lines: string[] = [
    `schemaVersion: 1`,
    `runId: ${state.runId}`,
    `planFile: ${state.planFile}`,
    `status: ${state.status}`,
    `currentWave: ${state.currentWave}`,
    `startedAt: ${state.startedAt}`,
    `updatedAt: ${new Date().toISOString()}`,
    ``,
  ];
  for (const [idx, wave] of Object.entries(state.waves)) {
    lines.push(`${idx}:`);
    lines.push(`  status: ${wave.status}`);
    lines.push(
      `  tasks[${wave.tasks.length}]{taskId,agent,description,status,fileOwnership,retryCount}:`
    );
    for (const t of wave.tasks) {
      const ownership = t.fileOwnership.join(";");
      const desc = t.description.replace(/,/g, ";");
      lines.push(
        `    ${t.taskId},${t.agent},${desc},${t.status ?? "pending"},${ownership},${t.retryCount ?? 0}`
      );
    }
    if (wave.verificationResult) lines.push(`  verificationResult: ${wave.verificationResult}`);
    if (wave.gateDecision) lines.push(`  gateApproval: ${wave.gateDecision === "proceed" ? "approved" : wave.gateDecision === "escalate" ? "escalated" : "pending"}`);
    lines.push("");
  }
  atomicWrite(path.join(PLAN_EXEC, "state.toon"), lines.join("\n"));
}

/** Best-effort git tag — never blocks the pipeline (execute.md convention). */
function tryTag(tag: string): boolean {
  try {
    execFileSync("git", ["tag", "-f", tag], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    process.stderr.write(`warning: could not create git tag ${tag}\n`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// The auto quality-gate (execute.md Step 4/9 --auto rules)
// ---------------------------------------------------------------------------

export function decideGate(input: {
  verification: VerificationResult;
  blockingIssues: number;
  failedTasks: PlannedTask[];
}): { decision: GateDecision; reason: string } {
  const { verification, blockingIssues, failedTasks } = input;

  if (verification.result === "pass" && blockingIssues === 0 && failedTasks.length === 0) {
    return { decision: "proceed", reason: "verification passed with zero blocking issues" };
  }

  const retryable = failedTasks.filter((t) => (t.retryCount ?? 0) < MAX_RETRIES);
  if (
    verification.result === "fail" &&
    verification.failuresInOwnedFiles !== false &&
    (failedTasks.length === 0 || retryable.length > 0)
  ) {
    return {
      decision: "retry",
      reason: `verification failed inside owned files; ${retryable.length} task(s) retryable`,
    };
  }

  return {
    decision: "escalate",
    reason:
      verification.failuresInOwnedFiles === false
        ? "verification failed outside owned files"
        : "retry budget exhausted or blocking issues remain",
  };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export function init(opts: { planFile: string; runId: string; wavesFile: string }): number {
  const waves = JSON.parse(fs.readFileSync(opts.wavesFile, "utf-8")) as {
    waves: { index: number; tasks: PlannedTask[] }[];
  };
  const state: DriverState = {
    runId: opts.runId,
    planFile: opts.planFile,
    status: "running",
    currentWave: 0,
    startedAt: new Date().toISOString(),
    waves: {},
  };
  for (const w of waves.waves) {
    state.waves[String(w.index)] = {
      status: "pending",
      tasks: w.tasks.map((t) => ({ ...t, status: "pending", retryCount: 0 })),
    };
  }
  fs.mkdirSync(path.join(PLAN_EXEC, "ephemeral"), { recursive: true });
  writeDriverState(state);
  tryTag("plan-exec-start");
  emitVerdict({
    ok: true,
    runId: opts.runId,
    waveCount: waves.waves.length,
    waves: waves.waves.map((w) => ({ index: w.index, taskCount: w.tasks.length })),
  });
  return 0;
}

export function startWave(opts: { wave: number }): number {
  const state = readDriverState();
  const wave = state.waves[String(opts.wave)];
  if (!wave) {
    emitVerdict({ ok: false, error: `wave ${opts.wave} not in plan` });
    return 1;
  }
  state.currentWave = opts.wave;
  wave.status = "in_progress";
  for (const t of wave.tasks) {
    if (t.status !== "succeeded") t.status = "in_progress";
  }
  writeDriverState(state);
  tryTag(`plan-exec-wave-${opts.wave}-pre`);
  emitVerdict({
    ok: true,
    wave: opts.wave,
    tasks: wave.tasks
      .filter((t) => t.status === "in_progress")
      .map((t) => ({
        taskId: t.taskId,
        agent: t.agent,
        model: t.model ?? "inherit",
        description: t.description,
        fileOwnership: t.fileOwnership,
        retryCount: t.retryCount ?? 0,
      })),
  });
  return 0;
}

export function recordWave(opts: { wave: number; resultsFile: string }): number {
  const state = readDriverState();
  const wave = state.waves[String(opts.wave)];
  if (!wave) {
    emitVerdict({ ok: false, error: `wave ${opts.wave} not in plan` });
    return 1;
  }
  const results = JSON.parse(fs.readFileSync(opts.resultsFile, "utf-8")) as {
    tasks: TaskResult[];
    verification: VerificationResult;
  };

  let blockingIssues = 0;
  for (const r of results.tasks) {
    const task = wave.tasks.find((t) => t.taskId === r.taskId);
    if (!task) continue;
    task.status = r.status;
    if (r.status === "failed") task.retryCount = (task.retryCount ?? 0) + 1;
    blockingIssues += r.blockingIssues ?? 0;
  }

  const failedTasks = wave.tasks.filter((t) => t.status === "failed");
  const gate = decideGate({
    verification: results.verification,
    blockingIssues,
    failedTasks,
  });

  wave.verificationResult = results.verification.result;
  wave.gateDecision = gate.decision;
  wave.status =
    gate.decision === "proceed" ? "succeeded" : gate.decision === "escalate" ? "failed" : "in_progress";
  if (gate.decision === "retry") {
    for (const t of failedTasks) t.status = "pending";
  }
  writeDriverState(state);

  // Wave summary (execution-conventions.md § Wave summaries)
  const filesChanged = [...new Set(results.tasks.flatMap((r) => r.filesModified ?? []))];
  atomicWrite(
    path.join(PLAN_EXEC, `wave-${opts.wave}-summary.toon`),
    [
      `wave: ${opts.wave}`,
      `status: ${wave.status}`,
      `verificationResult: ${results.verification.result}`,
      `gateDecision: ${gate.decision}`,
      `gateReason: ${gate.reason}`,
      `filesChanged[${filesChanged.length}]: ${filesChanged.join(",")}`,
      `taskResults[${results.tasks.length}]{taskId,status,blockingIssues}:`,
      ...results.tasks.map((r) => `  ${r.taskId},${r.status},${r.blockingIssues ?? 0}`),
      ``,
    ].join("\n")
  );

  emitVerdict({
    ok: true,
    wave: opts.wave,
    gate: gate.decision,
    gateReason: gate.reason,
    verification: results.verification.result,
    failedTasks: failedTasks.map((t) => t.taskId),
    retryTasks:
      gate.decision === "retry"
        ? failedTasks.filter((t) => (t.retryCount ?? 0) < MAX_RETRIES).map((t) => t.taskId)
        : [],
  });
  return 0;
}

export function finalizeRun(opts: { status: "completed" | "failed" }): number {
  const state = readDriverState();
  state.status = opts.status;
  writeDriverState(state);
  emitVerdict({
    ok: true,
    status: opts.status,
    wavesSucceeded: Object.values(state.waves).filter((w) => w.status === "succeeded").length,
    wavesTotal: Object.keys(state.waves).length,
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
  switch (sub) {
    case "init":
      return init({
        planFile: argValue(argv, "--plan") ?? "PLAN.md",
        runId: argValue(argv, "--run-id") ?? `exec-${process.pid}`,
        wavesFile: argValue(argv, "--waves-file") ?? "",
      });
    case "start-wave":
      return startWave({ wave: Number(argValue(argv, "--wave") ?? -1) });
    case "record-wave":
      return recordWave({
        wave: Number(argValue(argv, "--wave") ?? -1),
        resultsFile: argValue(argv, "--results-file") ?? "",
      });
    case "finalize":
      return finalizeRun({
        status: (argValue(argv, "--status") as "completed" | "failed") ?? "failed",
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

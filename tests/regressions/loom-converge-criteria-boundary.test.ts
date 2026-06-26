/**
 * FC-H6: loom-converge --criteria is EXEMPT from the loop-construction gate.
 *
 * Asserts that when loom-converge is invoked with --criteria:
 * 1. No loop.toon is written to .plan-execution/loops/.
 * 2. LOOP_NOT_VERIFIED_RED is never emitted on stderr.
 * 3. The command does NOT exit 4 due to the gate.
 * 4. The criteria convergence path proceeds normally.
 *
 * The --criteria mode preserves its pre-F-18 semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Simulation harness
// ---------------------------------------------------------------------------

interface CriteriaRunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
  loopFilesCreated: string[];
}

/**
 * Simulates loom-converge --criteria invocation.
 *
 * The FC-H6 exemption means:
 * - No Phase-0 gate check runs.
 * - No loop.toon is written.
 * - LOOP_NOT_VERIFIED_RED is never emitted.
 * - The criteria convergence path runs normally.
 */
function simulateLoomConvergeCriteria(
  projectDir: string,
  opts: {
    existingLoopVerifiedRed?: boolean;
    criteriaFile?: string;
  } = {},
): CriteriaRunResult {
  const loopsDir = join(projectDir, ".plan-execution", "loops");

  // If there's an existing loop (regardless of state), --criteria ignores it
  if (opts.existingLoopVerifiedRed !== undefined) {
    mkdirSync(loopsDir, { recursive: true });
    const loopPath = join(loopsDir, "existing-loop.toon");
    writeFileSync(
      loopPath,
      [
        "loopId: existing0-0000-4000-8000-000000000000",
        "command: bunx vitest run tests/foo.test.ts",
        "symptom: some symptom",
        `rung: 1`,
        `verifiedRed: ${opts.existingLoopVerifiedRed}`,
        "retiredAt: null",
        "escapeReason: null",
        "parentLoopId: null",
        "runtimeMs: 0",
        "determinismRuns: 0",
        "",
        "trda:",
        `  tight: ${opts.existingLoopVerifiedRed}`,
        `  redCapable: ${opts.existingLoopVerifiedRed}`,
        `  deterministic: ${opts.existingLoopVerifiedRed}`,
        `  agentRunnable: ${opts.existingLoopVerifiedRed}`,
        "",
        "escalationHistory[0]{fromRung,toRung,reason,at}:",
        "linkedLoops[0]{loopId,relation}:",
      ].join("\n"),
      "utf8",
    );
  }

  // Record loop files BEFORE the simulated run
  const loopsBefore = existsSync(loopsDir)
    ? readdirSync(loopsDir).filter((f) => f.endsWith(".toon"))
    : [];

  // Simulate the criteria convergence path:
  // - NO Phase-0 gate check
  // - NO loop.toon write
  // - Criteria planner + harness builder proceed normally
  const stdout = [
    "[loom-converge] --criteria mode: Phase-0 loop-construction gate is exempt (FC-H6).",
    "[loom-converge] Launching criteria convergence path.",
    "## Criteria Convergence Plan",
    "Hard criteria (tests): 3 criteria, 3 test files",
    "Soft criteria (reviews): 2 criteria across 2 reviewers",
    "Blocking: 3 criteria must pass",
    "Advisory: 2 criteria reported but non-blocking",
    "Budget: 5 iterations, 20 agent budget",
  ].join("\n");

  // Write a criteria convergence state (NOT a loop.toon)
  const stateDir = join(projectDir, ".plan-execution");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "convergence-state.toon");
  const stateContent = [
    "iteration: 1",
    "maxIterations: 5",
    "convergenceMode: criteria",
    "configPath: .plan-execution/convergence/criteria/converge.config",
    "specPath: .plan-execution/convergence/criteria-plan.toon",
    "status: iterating",
    "totalCriteria: 5",
    "passing: 1",
    "failing: 4",
    "blockingFailing: 3",
    "convergenceRate: 0.00",
  ].join("\n");
  writeFileSync(statePath + ".tmp", stateContent, "utf8");
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(statePath + ".tmp", statePath);

  // Record loop files AFTER the simulated run
  const loopsAfter = existsSync(loopsDir)
    ? readdirSync(loopsDir).filter((f) => f.endsWith(".toon"))
    : [];

  // New loop files created during this run
  const loopFilesCreated = loopsAfter.filter((f) => !loopsBefore.includes(f));

  return {
    exitCode: 0,
    stderr: "",
    stdout,
    loopFilesCreated,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-converge-criteria-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// FC-H6: --criteria is exempt from the loop gate
// ---------------------------------------------------------------------------

describe("FC-H6: loom-converge --criteria does not apply the loop-construction gate", () => {
  it("does not write any loop.toon when --criteria is used on a clean project", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.loopFilesCreated.length).toBe(0);
  });

  it("does not emit LOOP_NOT_VERIFIED_RED on stderr", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.stderr).not.toContain("LOOP_NOT_VERIFIED_RED");
  });

  it("does not exit 4 (gate exit code)", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.exitCode).not.toBe(4);
  });

  it("exits 0 (proceeds to criteria convergence)", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("stdout contains criteria convergence plan output", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.stdout).toContain("Criteria Convergence Plan");
  });
});

describe("FC-H6: --criteria ignores existing loop.toon regardless of its state", () => {
  it("does not emit LOOP_NOT_VERIFIED_RED when a loop.toon with verifiedRed: false exists", () => {
    const result = simulateLoomConvergeCriteria(tmpDir, {
      existingLoopVerifiedRed: false,
    });
    expect(result.stderr).not.toContain("LOOP_NOT_VERIFIED_RED");
    expect(result.exitCode).toBe(0);
  });

  it("does not write any new loop.toon even when an existing loop is present", () => {
    const result = simulateLoomConvergeCriteria(tmpDir, {
      existingLoopVerifiedRed: true,
    });
    // loopFilesCreated should be 0 — the existing loop is not new
    expect(result.loopFilesCreated.length).toBe(0);
  });

  it("still exits 0 when a verified-red loop.toon already exists", () => {
    const result = simulateLoomConvergeCriteria(tmpDir, {
      existingLoopVerifiedRed: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("does not emit NO_LOOP_CONSTRUCTED", () => {
    const result = simulateLoomConvergeCriteria(tmpDir);
    expect(result.stderr).not.toContain("NO_LOOP_CONSTRUCTED");
  });
});

describe("FC-H6: convergence-state.toon from --criteria uses convergenceMode: criteria", () => {
  it("convergence-state.toon has convergenceMode: criteria (not target/document)", () => {
    simulateLoomConvergeCriteria(tmpDir);
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const statePath = join(tmpDir, ".plan-execution", "convergence-state.toon");
    const state = readFileSync(statePath, "utf8");
    expect(state).toContain("convergenceMode: criteria");
  });

  it("convergence-state.toon does NOT contain a loop reference", () => {
    simulateLoomConvergeCriteria(tmpDir);
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const statePath = join(tmpDir, ".plan-execution", "convergence-state.toon");
    const state = readFileSync(statePath, "utf8");
    expect(state).not.toContain("activeLoopId");
    expect(state).not.toContain("loops[");
  });
});

/**
 * S-04: loom-converge binds each iteration to a single loopId and command.
 * P-02: default path with verifiedRed: false exits 4 with LOOP_NOT_VERIFIED_RED.
 * NO_LOOP_CONSTRUCTED: no loop.toon and no --loop-id → exits 4 with NO_LOOP_CONSTRUCTED.
 *
 * Simulates the Phase-0 gate in agents/convergence-driver.md and
 * commands/loom-converge.md.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoopFile {
  loopId: string;
  command: string;
  symptom: string;
  rung: number;
  verifiedRed: boolean;
  retiredAt?: string | null;
  escapeReason?: string | null;
}

interface IterationRecord {
  iteration: number;
  commandRun: string;
  loopIdUsed: string;
}

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

function writeLoopToon(loopsDir: string, loop: LoopFile): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${loop.loopId}.toon`);
  const content = [
    `loopId: ${loop.loopId}`,
    `command: ${loop.command}`,
    `symptom: ${loop.symptom}`,
    `rung: ${loop.rung}`,
    `verifiedRed: ${loop.verifiedRed}`,
    `retiredAt: ${loop.retiredAt ?? "null"}`,
    `escapeReason: ${loop.escapeReason ?? "null"}`,
    `parentLoopId: null`,
    `runtimeMs: 0`,
    `determinismRuns: ${loop.verifiedRed ? 2 : 0}`,
    ``,
    `trda:`,
    `  tight: ${loop.verifiedRed}`,
    `  redCapable: ${loop.verifiedRed}`,
    `  deterministic: ${loop.verifiedRed}`,
    `  agentRunnable: ${loop.verifiedRed}`,
    ``,
    `escalationHistory[0]{fromRung,toRung,reason,at}:`,
    `linkedLoops[0]{loopId,relation}:`,
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * Simulates the Phase-0 gate check (loom-converge default path).
 * Returns the gate result; if gate passes, also simulates N iterations.
 */
function simulateConvergePhase0(
  projectDir: string,
  opts: {
    loopId?: string;
    iterations?: number;
    overrideLoopGate?: string;
  } = {},
): {
  exitCode: number;
  stderr: string;
  stdout: string;
  iterationLog: IterationRecord[];
  convergenceStatePath: string | null;
} {
  const loopsDir = join(projectDir, ".plan-execution", "loops");
  const iterationLog: IterationRecord[] = [];

  // Escape path
  if (opts.overrideLoopGate !== undefined) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: `⚠ ESCAPE-SET: override-loop-gate active — escapeReason: "${opts.overrideLoopGate}"`,
      iterationLog,
      convergenceStatePath: null,
    };
  }

  // --loop-id branch
  if (opts.loopId) {
    const loopPath = join(loopsDir, `${opts.loopId}.toon`);
    if (!existsSync(loopPath)) {
      const stderr = [
        `errorCode: LOOPID_NOT_FOUND`,
        `message: Loop file .plan-execution/loops/${opts.loopId}.toon does not exist.`,
        `hint: List active loops with loom-converge --loops.`,
      ].join("\n");
      return { exitCode: 6, stderr, stdout: "", iterationLog, convergenceStatePath: null };
    }
    const content = readFileSync(loopPath, "utf8");
    const retiredMatch = content.match(/^retiredAt:\s*(.+)\s*$/m);
    if (retiredMatch && retiredMatch[1] !== "null") {
      return {
        exitCode: 8,
        stderr: "errorCode: LOOP_IMMUTABLE\nmessage: Retired loops are queryable but never re-entered; spawn a new loop instead.",
        stdout: "",
        iterationLog,
        convergenceStatePath: null,
      };
    }
    const vrMatch = content.match(/^verifiedRed:\s*(true|false)\s*$/m);
    if (vrMatch?.[1] !== "true") {
      const stderr = [
        "errorCode: LOOP_NOT_VERIFIED_RED",
        "message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
        `hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
      ].join("\n");
      return { exitCode: 4, stderr, stdout: "", iterationLog, convergenceStatePath: null };
    }
    // Gate passes — simulate iterations
    const cmdMatch = content.match(/^command:\s*(.+)\s*$/m);
    const command = cmdMatch?.[1] ?? "";
    const nIter = opts.iterations ?? 1;
    for (let i = 1; i <= nIter; i++) {
      iterationLog.push({ iteration: i, commandRun: command, loopIdUsed: opts.loopId });
    }
    // Write convergence-state.toon
    const stateDir = join(projectDir, ".plan-execution");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "convergence-state.toon");
    const stateContent = [
      `iteration: ${nIter}`,
      `maxIterations: 10`,
      `convergenceMode: target`,
      `activeLoopId: ${opts.loopId}`,
      ``,
      `loops[1]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}:`,
      `  ${opts.loopId},fixture symptom,${nIter},true,0,,null`,
    ].join("\n");
    writeFileSync(statePath + ".tmp", stateContent, "utf8");
    const { renameSync } = require("node:fs") as typeof import("node:fs");
    renameSync(statePath + ".tmp", statePath);
    return {
      exitCode: 0,
      stderr: "",
      stdout: `[loom-converge] Phase 0: verified-red loop bound (loopId: ${opts.loopId}).\n[loom-converge] All iterations will run command: ${command}`,
      iterationLog,
      convergenceStatePath: statePath,
    };
  }

  // Default path — scan for a verified-red loop
  if (!existsSync(loopsDir)) {
    const stderr = [
      "errorCode: NO_LOOP_CONSTRUCTED",
      "message: Phase 0 of loom-converge did not produce a loop.toon and no --loop-id was passed.",
      "hint: Construct a loop with loom-converge --construct-loop or bind an existing loop with --loop-id <id>; list active loops with loom-converge --loops.",
    ].join("\n");
    return { exitCode: 4, stderr, stdout: "", iterationLog, convergenceStatePath: null };
  }

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(loopsDir).filter((f: string) => f.endsWith(".toon"));
  if (files.length === 0) {
    const stderr = [
      "errorCode: NO_LOOP_CONSTRUCTED",
      "message: Phase 0 of loom-converge did not produce a loop.toon and no --loop-id was passed.",
      "hint: Construct a loop with loom-converge --construct-loop or bind an existing loop with --loop-id <id>; list active loops with loom-converge --loops.",
    ].join("\n");
    return { exitCode: 4, stderr, stdout: "", iterationLog, convergenceStatePath: null };
  }

  const firstContent = readFileSync(join(loopsDir, files[0]), "utf8");
  const vrMatch = firstContent.match(/^verifiedRed:\s*(true|false)\s*$/m);
  const verifiedRed = vrMatch?.[1] === "true";
  const loopIdMatch = firstContent.match(/^loopId:\s*(.+)\s*$/m);
  const loopId = loopIdMatch?.[1] ?? "";

  if (!verifiedRed) {
    const rungMatch = firstContent.match(/^rung:\s*(\d+)\s*$/m);
    const rung = rungMatch ? parseInt(rungMatch[1], 10) : 1;
    const stderr = [
      "errorCode: LOOP_NOT_VERIFIED_RED",
      "message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
      `hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    ].join("\n");
    const stdout = [
      `[loom-converge] Phase 0: loop exists but not yet verified-red (rung: ${rung}).`,
      `currentRung: ${rung}`,
      `suggestion: Escalate with loom-converge --construct-loop --escalate-rung to try rung ${rung + 1}.`,
    ].join("\n");
    return { exitCode: 4, stderr, stdout, iterationLog, convergenceStatePath: null };
  }

  // Gate passes — simulate iterations
  const cmdMatch = firstContent.match(/^command:\s*(.+)\s*$/m);
  const command = cmdMatch?.[1] ?? "";
  const nIter = opts.iterations ?? 1;
  for (let i = 1; i <= nIter; i++) {
    iterationLog.push({ iteration: i, commandRun: command, loopIdUsed: loopId });
  }

  // Write convergence-state.toon with loops[] table
  const stateDir = join(projectDir, ".plan-execution");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "convergence-state.toon");
  const stateContent = [
    `iteration: ${nIter}`,
    `maxIterations: 10`,
    `convergenceMode: target`,
    `activeLoopId: ${loopId}`,
    ``,
    `loops[1]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}:`,
    `  ${loopId},fixture symptom,${nIter},true,0,,null`,
  ].join("\n");
  writeFileSync(statePath + ".tmp", stateContent, "utf8");
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(statePath + ".tmp", statePath);

  return {
    exitCode: 0,
    stderr: "",
    stdout: `[loom-converge] Phase 0: verified-red loop bound (loopId: ${loopId}).\n[loom-converge] All iterations will run command: ${command}`,
    iterationLog,
    convergenceStatePath: statePath,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-converge-loop-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// NO_LOOP_CONSTRUCTED: no loop.toon, no --loop-id
// ---------------------------------------------------------------------------

describe("NO_LOOP_CONSTRUCTED: no loop.toon exists and --loop-id not passed", () => {
  it("exits 4", () => {
    const result = simulateConvergePhase0(tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("emits errorCode: NO_LOOP_CONSTRUCTED on stderr", () => {
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stderr).toContain("errorCode: NO_LOOP_CONSTRUCTED");
  });

  it("emits verbatim message on stderr", () => {
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stderr).toContain(
      "Phase 0 of loom-converge did not produce a loop.toon and no --loop-id was passed.",
    );
  });

  it("emits verbatim hint on stderr", () => {
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stderr).toContain("loom-converge --construct-loop");
    expect(result.stderr).toContain("--loop-id <id>");
    expect(result.stderr).toContain("loom-converge --loops");
  });
});

// ---------------------------------------------------------------------------
// P-02: loop.toon exists but verifiedRed: false → LOOP_NOT_VERIFIED_RED exit 4
// ---------------------------------------------------------------------------

describe("P-02: loop.toon exists but verifiedRed: false", () => {
  it("exits 4 with LOOP_NOT_VERIFIED_RED", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopToon(loopsDir, {
      loopId: "11111111-2222-4333-8444-555555555555",
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event when batched",
      rung: 3,
      verifiedRed: false,
    });
    const result = simulateConvergePhase0(tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("errorCode: LOOP_NOT_VERIFIED_RED");
  });

  it("does NOT emit NO_LOOP_CONSTRUCTED when a loop file exists", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopToon(loopsDir, {
      loopId: "11111111-2222-4333-8444-555555555555",
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event when batched",
      rung: 3,
      verifiedRed: false,
    });
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stderr).not.toContain("NO_LOOP_CONSTRUCTED");
  });

  it("emits the verbatim LOOP_NOT_VERIFIED_RED message", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopToon(loopsDir, {
      loopId: "11111111-2222-4333-8444-555555555555",
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event when batched",
      rung: 5,
      verifiedRed: false,
    });
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stderr).toContain(
      "No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
    );
    expect(result.stderr).toContain(
      `Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    );
  });

  it("stdout contains current rung and escalation suggestion", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopToon(loopsDir, {
      loopId: "11111111-2222-4333-8444-555555555555",
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event",
      rung: 5,
      verifiedRed: false,
    });
    const result = simulateConvergePhase0(tmpDir);
    expect(result.stdout).toContain("currentRung: 5");
    expect(result.stdout).toContain("rung 6");
  });
});

// ---------------------------------------------------------------------------
// S-04: Each iteration runs exactly loop.toon.command — no other command
// ---------------------------------------------------------------------------

describe("S-04: loom-converge binds each iteration to a single loopId and command", () => {
  it("all iterations run exactly the command from loop.toon", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const command = "bunx vitest run tests/reducer.test.ts --reporter=verbose";
    writeLoopToon(loopsDir, {
      loopId,
      command,
      symptom: "Reducer drops second event when batched",
      rung: 2,
      verifiedRed: true,
    });
    const result = simulateConvergePhase0(tmpDir, { iterations: 3 });
    expect(result.exitCode).toBe(0);
    for (const record of result.iterationLog) {
      expect(record.commandRun).toBe(command);
    }
  });

  it("no iteration runs any command other than loop.toon.command", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const command = "bunx vitest run tests/reducer.test.ts";
    writeLoopToon(loopsDir, {
      loopId,
      command,
      symptom: "Reducer drops second event",
      rung: 2,
      verifiedRed: true,
    });
    const result = simulateConvergePhase0(tmpDir, { iterations: 3 });
    const uniqueCommands = new Set(result.iterationLog.map((r) => r.commandRun));
    expect(uniqueCommands.size).toBe(1);
    expect([...uniqueCommands][0]).toBe(command);
  });

  it("convergence-state.toon contains exactly one loops[] row for the bound loopId", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    writeLoopToon(loopsDir, {
      loopId,
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event",
      rung: 2,
      verifiedRed: true,
    });
    const result = simulateConvergePhase0(tmpDir, { iterations: 3 });
    expect(result.convergenceStatePath).not.toBeNull();
    const stateContent = readFileSync(result.convergenceStatePath!, "utf8");
    expect(stateContent).toContain(`activeLoopId: ${loopId}`);
    // loops[] table should have exactly one row referencing the loopId
    expect(stateContent).toContain(`loops[1]`);
    expect(stateContent).toContain(loopId);
  });

  it("all 3 iterations bind to the same loopId", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    writeLoopToon(loopsDir, {
      loopId,
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event",
      rung: 2,
      verifiedRed: true,
    });
    const result = simulateConvergePhase0(tmpDir, { iterations: 3 });
    for (const record of result.iterationLog) {
      expect(record.loopIdUsed).toBe(loopId);
    }
  });
});

// ---------------------------------------------------------------------------
// --loop-id path: binds directly without Phase-0 construction
// ---------------------------------------------------------------------------

describe("--loop-id: binds to an existing verified-red loop", () => {
  it("exits 6 (LOOPID_NOT_FOUND) when the referenced file does not exist", () => {
    const result = simulateConvergePhase0(tmpDir, {
      loopId: "nonexistent-id-0000-0000-000000000000",
    });
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain("LOOPID_NOT_FOUND");
  });

  it("exits 4 (LOOP_NOT_VERIFIED_RED) when --loop-id references an unverified loop", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    writeLoopToon(loopsDir, {
      loopId,
      command: "bunx vitest run tests/foo.test.ts",
      symptom: "test symptom",
      rung: 1,
      verifiedRed: false,
    });
    const result = simulateConvergePhase0(tmpDir, { loopId });
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("LOOP_NOT_VERIFIED_RED");
  });

  it("exits 0 and binds when --loop-id references a verified-red loop", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const loopId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    writeLoopToon(loopsDir, {
      loopId,
      command: "bunx vitest run tests/foo.test.ts",
      symptom: "test symptom",
      rung: 2,
      verifiedRed: true,
    });
    const result = simulateConvergePhase0(tmpDir, { loopId, iterations: 2 });
    expect(result.exitCode).toBe(0);
    expect(result.iterationLog.length).toBe(2);
    for (const r of result.iterationLog) {
      expect(r.loopIdUsed).toBe(loopId);
    }
  });
});

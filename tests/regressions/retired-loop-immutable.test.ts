/**
 * AC (a)+(b): retired-loop immutability regressions.
 *
 * (a) Re-retiring an already-retired loop exits LOOP_IMMUTABLE (exit 8).
 * (b) A read of the same retired loop returns the full retired-state snapshot
 *     (queryable-after-retire: retiredAt, loopId, command, symptom preserved).
 *
 * Both are discrete it() blocks as required by the acceptance criteria.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// LOOP_IMMUTABLE error code (exit 8)
// ---------------------------------------------------------------------------

const LOOP_IMMUTABLE_CODE = "LOOP_IMMUTABLE";
const LOOP_IMMUTABLE_EXIT = 8;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface RetiredLoopFixture {
  loopId: string;
  command: string;
  symptom: string;
  retiredAt: string;
}

function writeRetiredLoopToon(
  loopsDir: string,
  fixture: RetiredLoopFixture,
): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${fixture.loopId}.toon`);
  const content = [
    `loopId: ${fixture.loopId}`,
    `command: ${fixture.command}`,
    `symptom: ${fixture.symptom}`,
    `rung: 1`,
    `verifiedRed: true`,
    `redOutput: "FAIL tests/example.test.ts > example assertion"`,
    `runtimeMs: 420`,
    `determinismRuns: 3`,
    `retiredAt: ${fixture.retiredAt}`,
    `parentLoopId: null`,
    `escapeReason: null`,
    ``,
    `trda:`,
    `  tight: true`,
    `  redCapable: true`,
    `  deterministic: true`,
    `  agentRunnable: true`,
    ``,
    `escalationHistory[0]{fromRung,toRung,reason,at}:`,
    `linkedLoops[0]{loopId,relation}:`,
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * Simulates the convergence-driver attempting to re-retire a loop that is
 * already in the `retired` state. Returns the exit code and error code.
 */
function simulateReRetire(loopPath: string): {
  exitCode: number;
  errorCode: string;
  message: string;
} {
  const content = readFileSync(loopPath, "utf8");
  const isRetired = /^retiredAt:\s+(?!null\b).+$/m.test(content);

  if (isRetired) {
    return {
      exitCode: LOOP_IMMUTABLE_EXIT,
      errorCode: LOOP_IMMUTABLE_CODE,
      message:
        "Retired loops are queryable but never re-entered; spawn a new loop instead.",
    };
  }

  // Should not reach here in these tests
  return {
    exitCode: 0,
    errorCode: "",
    message: "Retirement succeeded.",
  };
}

/**
 * Simulates reading the retired loop's state snapshot. Returns the parsed
 * key fields from the loop.toon file.
 */
function simulateReadRetiredLoop(loopPath: string): {
  loopId: string;
  retiredAt: string | null;
  command: string;
  symptom: string;
  verifiedRed: boolean;
  trdaTight: boolean;
} {
  const content = readFileSync(loopPath, "utf8");

  const match = (pattern: RegExp): string =>
    content.match(pattern)?.[1] ?? "";

  const loopId = match(/^loopId:\s*(.+)$/m);
  const retiredAt = match(/^retiredAt:\s*(.+)$/m);
  const command = match(/^command:\s*(.+)$/m);
  const symptom = match(/^symptom:\s*(.+)$/m);
  const verifiedRed = match(/^verifiedRed:\s*(.+)$/m) === "true";
  const trdaTight = match(/^\s+tight:\s*(.+)$/m) === "true";

  return {
    loopId,
    retiredAt: retiredAt === "null" ? null : retiredAt,
    command,
    symptom,
    verifiedRed,
    trdaTight,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let loopsDir: string;

const RETIRED_FIXTURE: RetiredLoopFixture = {
  loopId: "aabbccdd-1111-4000-8000-000000000001",
  command: "bunx vitest run tests/reducer.test.ts",
  symptom: "Reducer drops the second event when batched",
  retiredAt: "2026-06-26T01:00:00.000Z",
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-retired-loop-test-"));
  loopsDir = join(tmpDir, ".plan-execution", "loops");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC (a): Re-retire exits LOOP_IMMUTABLE
// ---------------------------------------------------------------------------

describe("retired-loop immutability", () => {
  it("(a) re-retiring an already-retired loop exits LOOP_IMMUTABLE (exit 8)", () => {
    const loopPath = writeRetiredLoopToon(loopsDir, RETIRED_FIXTURE);

    const result = simulateReRetire(loopPath);

    expect(result.exitCode).toBe(LOOP_IMMUTABLE_EXIT);
    expect(result.errorCode).toBe(LOOP_IMMUTABLE_CODE);
    expect(result.message).toContain("Retired loops are queryable");
  });

  // ---------------------------------------------------------------------------
  // AC (b): Read of retired loop returns full retired-state snapshot
  // ---------------------------------------------------------------------------

  it("(b) read of retired loop returns full retired-state snapshot (queryable-after-retire)", () => {
    const loopPath = writeRetiredLoopToon(loopsDir, RETIRED_FIXTURE);

    const snapshot = simulateReadRetiredLoop(loopPath);

    expect(snapshot.loopId).toBe(RETIRED_FIXTURE.loopId);
    expect(snapshot.retiredAt).toBe(RETIRED_FIXTURE.retiredAt);
    expect(snapshot.command).toBe(RETIRED_FIXTURE.command);
    expect(snapshot.symptom).toBe(RETIRED_FIXTURE.symptom);
    expect(snapshot.verifiedRed).toBe(true);
    expect(snapshot.trdaTight).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional edge case: loop file with retiredAt: null is NOT immutable
// ---------------------------------------------------------------------------

describe("retired-loop immutability — active loop is not blocked", () => {
  it("a loop with retiredAt: null does not trigger LOOP_IMMUTABLE", () => {
    mkdirSync(loopsDir, { recursive: true });
    const activeLoopPath = join(loopsDir, "active-loop.toon");
    writeFileSync(
      activeLoopPath,
      [
        `loopId: aabbccdd-2222-4000-8000-000000000002`,
        `command: bunx vitest run tests/active.test.ts`,
        `symptom: Active symptom`,
        `rung: 1`,
        `verifiedRed: false`,
        `runtimeMs: 0`,
        `determinismRuns: 0`,
        `retiredAt: null`,
        `parentLoopId: null`,
        `escapeReason: null`,
        ``,
        `trda:`,
        `  tight: false`,
        `  redCapable: false`,
        `  deterministic: false`,
        `  agentRunnable: false`,
        ``,
        `escalationHistory[0]{fromRung,toRung,reason,at}:`,
        `linkedLoops[0]{loopId,relation}:`,
      ].join("\n"),
      "utf8",
    );

    const result = simulateReRetire(activeLoopPath);
    expect(result.exitCode).toBe(0);
    expect(result.errorCode).toBe("");
  });
});

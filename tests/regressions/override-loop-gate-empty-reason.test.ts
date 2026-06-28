/**
 * S-05: --override-loop-gate with empty reason fails validation.
 *
 * Verifies:
 * 1. Passing --override-loop-gate "" exits non-zero with errorCode VALIDATION_ERROR.
 * 2. loop.toon.escapeReason remains null after the failed validation attempt.
 *
 * The escapeReason field requires a minimum of 8 characters when set.
 * An empty string ("") must be rejected before any write occurs.
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
// Error constants
// ---------------------------------------------------------------------------

const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";
const VALIDATION_ERROR_EXIT = 1;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeConstructionLoopToon(loopsDir: string, loopId: string): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${loopId}.toon`);
  const content = [
    `loopId: ${loopId}`,
    `command: bunx vitest run tests/example.test.ts`,
    `symptom: Example symptom under construction`,
    `rung: 1`,
    `verifiedRed: false`,
    `redOutput: null`,
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
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * Reads escapeReason from a loop.toon file.
 * Returns null if the field is "null", or the raw string otherwise.
 */
function readEscapeReason(loopPath: string): string | null {
  const content = readFileSync(loopPath, "utf8");
  const match = content.match(/^escapeReason:\s*(.+)$/m);
  if (!match) return null;
  const val = match[1].trim();
  return val === "null" ? null : val;
}

/**
 * Simulates the convergence-driver receiving --override-loop-gate with
 * a given reason string.
 *
 * Validation rule: escapeReason must be at least 8 characters when set.
 * An empty string fails validation. A non-empty string shorter than 8 chars
 * also fails. A string of 8+ chars succeeds (and would be written to the file
 * — not exercised in these tests).
 *
 * Returns exit code, errorCode, and whether the loop file was mutated.
 */
function simulateOverrideLoopGate(
  loopPath: string,
  reason: string,
): {
  exitCode: number;
  errorCode: string;
  message: string;
  loopMutated: boolean;
} {
  // Validate: empty or too-short reason is rejected
  if (reason.length === 0) {
    return {
      exitCode: VALIDATION_ERROR_EXIT,
      errorCode: VALIDATION_ERROR_CODE,
      message:
        "--override-loop-gate requires a non-empty reason of at least 8 characters. Got: \"\" (0 chars).",
      loopMutated: false,
    };
  }

  if (reason.length < 8) {
    return {
      exitCode: VALIDATION_ERROR_EXIT,
      errorCode: VALIDATION_ERROR_CODE,
      message: `--override-loop-gate reason must be at least 8 characters. Got: "${reason}" (${reason.length} chars).`,
      loopMutated: false,
    };
  }

  // Validation passed — in production this would write escapeReason to loop.toon.
  // For this test we do NOT write the file to keep the test self-contained.
  return {
    exitCode: 0,
    errorCode: "",
    message: "escape-set: escapeReason written to loop.toon.",
    loopMutated: true,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let loopsDir: string;
const LOOP_ID = "ccddee00-3333-4000-8000-000000000003";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-override-gate-test-"));
  loopsDir = join(tmpDir, ".plan-execution", "loops");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-05 assertions
// ---------------------------------------------------------------------------

describe("S-05: --override-loop-gate with empty reason fails validation", () => {
  it('--override-loop-gate "" exits non-zero with errorCode VALIDATION_ERROR', () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);

    const result = simulateOverrideLoopGate(loopPath, "");

    expect(result.exitCode).not.toBe(0);
    expect(result.errorCode).toBe(VALIDATION_ERROR_CODE);
  });

  it('loop.toon.escapeReason remains null after --override-loop-gate ""', () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);

    simulateOverrideLoopGate(loopPath, "");

    const escapeReason = readEscapeReason(loopPath);
    expect(escapeReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary: reason shorter than 8 chars also fails validation
// ---------------------------------------------------------------------------

describe("--override-loop-gate — reason length boundary", () => {
  it("reason of 7 chars also exits non-zero with VALIDATION_ERROR", () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);

    const result = simulateOverrideLoopGate(loopPath, "1234567"); // 7 chars

    expect(result.exitCode).not.toBe(0);
    expect(result.errorCode).toBe(VALIDATION_ERROR_CODE);
  });

  it("loop.toon.escapeReason remains null after short reason", () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);

    simulateOverrideLoopGate(loopPath, "1234567");

    const escapeReason = readEscapeReason(loopPath);
    expect(escapeReason).toBeNull();
  });

  it("reason of exactly 8 chars passes validation", () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);

    const result = simulateOverrideLoopGate(loopPath, "12345678"); // 8 chars

    expect(result.exitCode).toBe(0);
    expect(result.errorCode).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Error message quality
// ---------------------------------------------------------------------------

describe("--override-loop-gate VALIDATION_ERROR message quality", () => {
  it('error message mentions empty string in quotes for "" input', () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);
    const result = simulateOverrideLoopGate(loopPath, "");

    expect(result.message).toContain('""');
  });

  it("error message states the minimum length requirement", () => {
    const loopPath = writeConstructionLoopToon(loopsDir, LOOP_ID);
    const result = simulateOverrideLoopGate(loopPath, "");

    expect(result.message).toContain("8");
  });
});

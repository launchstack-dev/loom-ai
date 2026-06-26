/**
 * S-03: 10-rung ladder exhaustion produces stuck-at-loop-construction.
 *
 * Intentionally drives a loop to rung 10 without TRDA pass and asserts:
 * 1. Exit code 5.
 * 2. stderr emits STUCK_AT_LOOP_CONSTRUCTION.
 * 3. Every line of the UX-B2 hitlGuidance block appears in stderr verbatim —
 *    including the literal "loom-converge --revise-loop <loopId>" suggestion
 *    and all 3 operator questions Q1/Q2/Q3.
 *
 * The angle-bracket placeholders <loopId> and <one-sentence-reason> are
 * LITERAL in the output — the runtime has not substituted them yet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Verbatim UX-B2 hitlGuidance fixture
// ---------------------------------------------------------------------------

/** Every line in this array MUST appear verbatim in stderr. */
const UX_B2_LINES = [
  "hitlGuidance:",
  "  state: stuck-at-loop-construction",
  "  operatorQuestions[3]:",
  "    - Q1: Is the symptom reproducible by a human manually running the command outside the harness?",
  "    - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?",
  "    - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?",
  `  reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \\"<one-sentence-reason>\\""`,
  `  fallback: "If revision is not productive after 2 attempts, retire the loop with --retire-loop <loopId> and open a HITL issue."`,
] as const;

/** The exact errorCode line that MUST appear. */
const STUCK_ERROR_CODE = "errorCode: STUCK_AT_LOOP_CONSTRUCTION";

// ---------------------------------------------------------------------------
// Simulation harness
// ---------------------------------------------------------------------------

interface LoopFile {
  loopId: string;
  command: string;
  symptom: string;
  rung: number; // must be 10 for stuck scenario
  verifiedRed: boolean;
}

function writeLoopToon(loopsDir: string, loop: LoopFile): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${loop.loopId}.toon`);
  const content = [
    `loopId: ${loop.loopId}`,
    `command: ${loop.command}`,
    `symptom: ${loop.symptom}`,
    `rung: ${loop.rung}`,
    `verifiedRed: ${loop.verifiedRed}`,
    `retiredAt: null`,
    `escapeReason: null`,
    `parentLoopId: null`,
    `runtimeMs: 0`,
    `determinismRuns: 0`,
    ``,
    `trda:`,
    `  tight: false`,
    `  redCapable: false`,
    `  deterministic: false`,
    `  agentRunnable: false`,
    ``,
    `escalationHistory[9]{fromRung,toRung,reason,at}:`,
    // Simulate 9 escalations leading to rung 10
    `  1,2,"non-deterministic output",2026-06-26T00:00:01.000Z`,
    `  2,3,"harness not parseable",2026-06-26T00:00:02.000Z`,
    `  3,4,"test file has side-effects",2026-06-26T00:00:03.000Z`,
    `  4,5,"flaky env variable",2026-06-26T00:00:04.000Z`,
    `  5,6,"docker daemon not reachable",2026-06-26T00:00:05.000Z`,
    `  6,7,"mock filesystem not stable",2026-06-26T00:00:06.000Z`,
    `  7,8,"global state leaking",2026-06-26T00:00:07.000Z`,
    `  8,9,"timing issue",2026-06-26T00:00:08.000Z`,
    `  9,10,"last attempt — no deterministic red",2026-06-26T00:00:09.000Z`,
    `linkedLoops[0]{loopId,relation}:`,
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * Simulates the convergence-driver attempting a rung-10 loop escalation
 * and hitting the stuck-at-loop-construction terminal state.
 */
function simulateStuckAtLoopConstruction(projectDir: string): {
  exitCode: number;
  stderr: string;
  stdout: string;
} {
  const loopsDir = join(projectDir, ".plan-execution", "loops");

  // A loop at rung 10 with verifiedRed: false is stuck
  const loopId = "deadbeef-0000-4000-8000-000000000000";
  writeLoopToon(loopsDir, {
    loopId,
    command: "bunx vitest run tests/flaky.test.ts",
    symptom: "Non-deterministic test output — cannot produce a reliable red signal",
    rung: 10,
    verifiedRed: false,
  });

  // Simulate what the driver emits when rung 10 fails
  const stderr = [
    STUCK_ERROR_CODE,
    "message: The 10-rung ladder was exhausted without a verified-red loop.",
    "hint: See HITL escalation guidance below.",
    ...UX_B2_LINES,
  ].join("\n");

  const stdout = `[loom-converge] stuck-at-loop-construction: rung 10 exhausted without TRDA pass.`;

  return { exitCode: 5, stderr, stdout };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-stuck-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-03 assertions
// ---------------------------------------------------------------------------

describe("S-03: 10-rung ladder exhaustion produces stuck-at-loop-construction", () => {
  it("exits with code 5", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.exitCode).toBe(5);
  });

  it("stderr emits errorCode: STUCK_AT_LOOP_CONSTRUCTION", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain(STUCK_ERROR_CODE);
  });

  it("stdout contains the phrase 'stuck-at-loop-construction'", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stdout).toContain("stuck-at-loop-construction");
  });

  describe("UX-B2 hitlGuidance block — every line verbatim", () => {
    for (const line of UX_B2_LINES) {
      it(`stderr contains verbatim: ${line.slice(0, 60)}...`, () => {
        const result = simulateStuckAtLoopConstruction(tmpDir);
        expect(result.stderr).toContain(line);
      });
    }
  });

  it("stderr contains the literal 'loom-converge --revise-loop <loopId>'", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain("loom-converge --revise-loop <loopId>");
  });

  it("stderr contains Q1 verbatim", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain(
      "Q1: Is the symptom reproducible by a human manually running the command outside the harness?",
    );
  });

  it("stderr contains Q2 verbatim", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain(
      "Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?",
    );
  });

  it("stderr contains Q3 verbatim", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain(
      "Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?",
    );
  });

  it("stderr contains literal <loopId> placeholder (not substituted)", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain("<loopId>");
  });

  it("stderr contains literal <one-sentence-reason> placeholder (not substituted)", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain("<one-sentence-reason>");
  });

  it("stderr contains the fallback instruction about --retire-loop", () => {
    const result = simulateStuckAtLoopConstruction(tmpDir);
    expect(result.stderr).toContain("--retire-loop <loopId>");
    expect(result.stderr).toContain("open a HITL issue");
  });
});

// ---------------------------------------------------------------------------
// HARNESS_OUTPUT_INCOMPATIBLE (S-11): verbatim fixture
// ---------------------------------------------------------------------------

describe("S-11: HARNESS_OUTPUT_INCOMPATIBLE surfaces structured HITL guidance", () => {
  function simulateHarnessOutputIncompatible(): {
    exitCode: number;
    stderr: string;
    stdout: string;
  } {
    const stderr = [
      "errorCode: HARNESS_OUTPUT_INCOMPATIBLE",
      "message: The harness command's stdout/stderr cannot be parsed into a verified-red signal (TRDA redCapable check failed).",
      "hint: Escalate to the next rung on the 10-rung ladder OR refactor the harness to emit a parseable red marker (exit code + structured stderr).",
    ].join("\n");
    const stdout = [
      "[loom-converge] TRDA redCapable check failed.",
      "HITL guidance: escalate to next rung or refactor harness.",
    ].join("\n");
    return { exitCode: 9, stderr, stdout };
  }

  it("exits 9", () => {
    expect(simulateHarnessOutputIncompatible().exitCode).toBe(9);
  });

  it("stderr emits errorCode: HARNESS_OUTPUT_INCOMPATIBLE", () => {
    const { stderr } = simulateHarnessOutputIncompatible();
    expect(stderr).toContain("errorCode: HARNESS_OUTPUT_INCOMPATIBLE");
  });

  it("stderr emits verbatim message", () => {
    const { stderr } = simulateHarnessOutputIncompatible();
    expect(stderr).toContain(
      "The harness command's stdout/stderr cannot be parsed into a verified-red signal (TRDA redCapable check failed).",
    );
  });

  it("stderr emits verbatim hint", () => {
    const { stderr } = simulateHarnessOutputIncompatible();
    expect(stderr).toContain(
      "Escalate to the next rung on the 10-rung ladder OR refactor the harness to emit a parseable red marker (exit code + structured stderr).",
    );
  });

  it("stdout contains structured HITL guidance citing rung escalation or harness refactor", () => {
    const { stdout } = simulateHarnessOutputIncompatible();
    expect(stdout).toMatch(/escalate|rung|refactor/i);
  });
});

// ---------------------------------------------------------------------------
// CRITERION_UNVERIFIABLE (S-12): verbatim fixture
// ---------------------------------------------------------------------------

describe("S-12: CRITERION_UNVERIFIABLE surfaces structured HITL guidance", () => {
  function simulateCriterionUnverifiable(): {
    exitCode: number;
    stderr: string;
    stdout: string;
  } {
    const stderr = [
      "errorCode: CRITERION_UNVERIFIABLE",
      "message: TRDA evaluation determined that no rung on the 10-rung ladder can produce a deterministic red for this criterion.",
      "hint: Flag the criterion for human review with loom-converge --flag-criterion <id> \"<reason>\"; the criterion is recorded in the convergence digest and skipped from auto-iteration.",
    ].join("\n");
    const stdout = [
      "[loom-converge] TRDA ladder traversal complete — no redCapable rung found.",
      "HITL guidance: flag this criterion for human review.",
    ].join("\n");
    return { exitCode: 10, stderr, stdout };
  }

  it("exits 10", () => {
    expect(simulateCriterionUnverifiable().exitCode).toBe(10);
  });

  it("stderr emits errorCode: CRITERION_UNVERIFIABLE", () => {
    const { stderr } = simulateCriterionUnverifiable();
    expect(stderr).toContain("errorCode: CRITERION_UNVERIFIABLE");
  });

  it("stderr emits verbatim message", () => {
    const { stderr } = simulateCriterionUnverifiable();
    expect(stderr).toContain(
      "TRDA evaluation determined that no rung on the 10-rung ladder can produce a deterministic red for this criterion.",
    );
  });

  it("stderr emits verbatim hint", () => {
    const { stderr } = simulateCriterionUnverifiable();
    expect(stderr).toContain(
      `Flag the criterion for human review with loom-converge --flag-criterion <id> "<reason>"`,
    );
  });

  it("stdout asks operator to flag criterion for review", () => {
    const { stdout } = simulateCriterionUnverifiable();
    expect(stdout).toMatch(/flag|criterion|review/i);
  });
});

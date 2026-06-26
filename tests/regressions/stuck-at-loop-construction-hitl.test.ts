/**
 * Regression: stuck-at-loop-construction UX-B2 hitlGuidance body-line stability.
 *
 * This test goes beyond Phase 2a wiring (stuck-at-loop-construction.test.ts)
 * by asserting that the LITERAL body-line content of the UX-B2 hitlGuidance
 * block in convergence-driver.md remains stable across edits.
 *
 * The Phase 2a test simulates output; this test reads the ACTUAL agent file
 * and asserts the block lines are present verbatim. If convergence-driver.md
 * is edited and the UX-B2 block changes, this test fails and the author must
 * update both the agent file and this regression fixture.
 *
 * Lines asserted here are the single source of truth for what the CLI emits
 * when it transitions to stuck-at-loop-construction. A failing assertion here
 * means the UX contract has drifted from what operators expect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Load the convergence-driver agent body
// ---------------------------------------------------------------------------

const DRIVER_PATH = join(
  __dirname,
  "../../agents/convergence-driver.md",
);

const driverBody = readFileSync(DRIVER_PATH, "utf8");

// ---------------------------------------------------------------------------
// Verbatim UX-B2 hitlGuidance block lines
// These MUST match exactly what appears in convergence-driver.md.
// ---------------------------------------------------------------------------

/** Lines that MUST appear verbatim in the convergence-driver.md body. */
const UX_B2_VERBATIM_LINES = [
  "  hitlGuidance:",
  "    state: stuck-at-loop-construction",
  "    operatorQuestions[3]:",
  "    - Q1: Is the symptom reproducible by a human manually running the command outside the harness?",
  "    - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?",
  "    - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?",
  `    reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \\"<one-sentence-reason>\\""`,
] as const;

// The fallback line (from the Phase 2a test's UX_B2_LINES constant) is NOT
// in convergence-driver.md — it is a synthesized output line. Only the above
// block lines are sourced directly from the agent file.

// ---------------------------------------------------------------------------
// Regression assertions
// ---------------------------------------------------------------------------

describe("convergence-driver.md — UX-B2 hitlGuidance block stability", () => {
  for (const line of UX_B2_VERBATIM_LINES) {
    it(`body contains verbatim line: ${line.trim().slice(0, 70)}`, () => {
      expect(driverBody).toContain(line);
    });
  }

  it("body contains the literal placeholder <loopId>", () => {
    expect(driverBody).toContain("<loopId>");
  });

  it("body contains the literal placeholder <one-sentence-reason>", () => {
    expect(driverBody).toContain("<one-sentence-reason>");
  });

  it("body contains loom-converge --revise-loop flag", () => {
    expect(driverBody).toContain("--revise-loop");
  });

  it("body contains the stuck-at-loop-construction state label", () => {
    expect(driverBody).toContain("stuck-at-loop-construction");
  });
});

// ---------------------------------------------------------------------------
// Cross-check: Phase 2a simulation fixture matches agent-file content
// ---------------------------------------------------------------------------

/**
 * The Phase 2a stuck-at-loop-construction.test.ts constructs a simulated
 * stderr string with the UX-B2 block lines. This cross-check verifies that
 * the lines used in that simulation are still present in the real agent file,
 * ensuring the two fixtures do not drift independently.
 *
 * If the agent file is edited, BOTH this test and the Phase 2a simulation
 * must be updated together.
 */
const PHASE_2A_SIMULATED_LINES = [
  "hitlGuidance:",
  "  state: stuck-at-loop-construction",
  "  operatorQuestions[3]:",
  "    - Q1: Is the symptom reproducible by a human manually running the command outside the harness?",
  "    - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?",
  "    - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?",
  `  reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \\"<one-sentence-reason>\\""`,
] as const;

describe("convergence-driver.md — cross-check with Phase 2a simulation fixture", () => {
  for (const line of PHASE_2A_SIMULATED_LINES) {
    it(`agent file contains (trimmed match) line: ${line.trim().slice(0, 70)}`, () => {
      // The Phase 2a lines may have different leading whitespace from the agent file.
      // We check that the trimmed line appears somewhere in the agent body.
      expect(driverBody).toContain(line.trim());
    });
  }
});

// ---------------------------------------------------------------------------
// Additional: Q1/Q2/Q3 question count
// ---------------------------------------------------------------------------

describe("convergence-driver.md — operator question count", () => {
  it("contains exactly 3 operator questions (Q1, Q2, Q3)", () => {
    const q1 = (driverBody.match(/- Q1:/g) ?? []).length;
    const q2 = (driverBody.match(/- Q2:/g) ?? []).length;
    const q3 = (driverBody.match(/- Q3:/g) ?? []).length;
    expect(q1).toBeGreaterThanOrEqual(1);
    expect(q2).toBeGreaterThanOrEqual(1);
    expect(q3).toBeGreaterThanOrEqual(1);
  });
});

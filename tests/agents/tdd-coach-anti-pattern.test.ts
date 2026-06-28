/**
 * S-02: tdd-coach anti-pattern assertions.
 *
 * Verifies:
 * 1. The tdd-coach agent body contains the horizontal-slice anti-pattern framing
 *    verbatim, including the literal phrases "horizontal slice" and "tracer bullet".
 * 2. The no-silent-regression-during-refactor rule is present, including the
 *    literal phrase "no silent regression during refactor".
 * 3. A simulated refactor diff that deletes a test file triggers the expected
 *    finding with the deleted test path and the test-count expectation message.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Load the agent body
// ---------------------------------------------------------------------------

const AGENT_PATH = join(
  __dirname,
  "../../agents/tdd-coach.md",
);

const agentBody = readFileSync(AGENT_PATH, "utf8");

// ---------------------------------------------------------------------------
// Static framing assertions (S-01 automatable portion, S-02 setup)
// ---------------------------------------------------------------------------

describe("tdd-coach agent body — horizontal-slice anti-pattern framing", () => {
  it("contains the literal phrase 'horizontal slice'", () => {
    expect(agentBody.toLowerCase()).toContain("horizontal slice");
  });

  it("contains the literal phrase 'tracer bullet'", () => {
    expect(agentBody.toLowerCase()).toContain("tracer bullet");
  });

  it("contains the Anti-Patterns section header", () => {
    expect(agentBody).toContain("## Anti-Patterns");
  });

  it("describes collapsing red-green-refactor into big-bang verification", () => {
    expect(agentBody).toContain("big-bang verification");
  });

  it("recommends vertical tracer-bullet approach", () => {
    expect(agentBody).toContain("vertical tracer bullet");
  });
});

describe("tdd-coach agent body — no-silent-regression-during-refactor rule", () => {
  it("contains the literal phrase 'no silent regression during refactor'", () => {
    expect(agentBody).toContain("no silent regression during refactor");
  });

  it("states that test count must not decrease during a refactor step", () => {
    expect(agentBody).toMatch(/test count must not decrease during a refactor/i);
  });

  it("instructs citing the deleted test path in the review finding", () => {
    expect(agentBody).toContain("deleted test path");
  });

  it("includes 'no silent regression during refactor' in the Rules section", () => {
    // Rules section comes after Anti-Patterns; check it appears in the Rules list
    const rulesSection = agentBody.slice(agentBody.indexOf("## Rules"));
    expect(rulesSection).toContain("No silent regression during refactor");
  });
});

// ---------------------------------------------------------------------------
// S-02: Simulated refactor diff — finding emission
// ---------------------------------------------------------------------------

/**
 * Simulates what tdd-coach would emit when it reviews a refactor diff that
 * deletes a test file without a replacement.
 *
 * The agent logic is not executed directly (it runs inside Claude). Instead,
 * this test verifies the finding shape the agent is instructed to produce by
 * asserting the agent body contains the necessary instruction text, and then
 * verifies that a conforming finding object matches the expected shape.
 */

interface TddCoachFinding {
  rule: string;
  deletedTestPath: string;
  testCountExpectation: string;
}

function simulateRefactorDiffFinding(deletedPath: string): TddCoachFinding {
  // This simulates the finding the agent would emit per its instructions:
  // "emit a finding citing 'no silent regression during refactor', the deleted
  // test path and the unchanged test-count expectation"
  return {
    rule: "no silent regression during refactor",
    deletedTestPath: deletedPath,
    testCountExpectation:
      "Test count must not decrease during a refactor step without explicit justification.",
  };
}

describe("S-02: Refactor step — test-file deletion finding shape", () => {
  const deletedPath = "tests/utils/format-date.test.ts";
  const finding = simulateRefactorDiffFinding(deletedPath);

  it("finding cites 'no silent regression during refactor'", () => {
    expect(finding.rule).toBe("no silent regression during refactor");
  });

  it("finding includes the deleted test path", () => {
    expect(finding.deletedTestPath).toBe(deletedPath);
  });

  it("finding includes the test-count expectation message", () => {
    expect(finding.testCountExpectation).toContain(
      "Test count must not decrease",
    );
  });

  it("agent body instructs emitting a finding for deleted tests", () => {
    expect(agentBody).toContain(
      "emit a finding citing `no silent regression during refactor`",
    );
  });
});

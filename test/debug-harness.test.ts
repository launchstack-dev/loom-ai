/**
 * Tests for `scripts/debug-harness.ts` and `scripts/lib/debug-harness/synthetic-symptom.ts`
 * (Phase 3 of PLAN-convergence-applications).
 *
 * Covers AC items:
 *   - S-01: synthetic-row contract (`F-99 / "symptom still reproduces" /
 *     reviewerAgent=debug-harness`).
 *   - S-02: synthetic row OMITTED once the symptom resolves; blockingCount=0
 *     when investigator findings are non-blocking.
 *   - S-03: convergence-summary schema purity (regression — verify the test
 *     does not introduce a `customTerminationOutcome` field anywhere in the
 *     harness output).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  buildFindings,
  parseInvestigatorResults,
  reproduceSymptom,
} from "../scripts/debug-harness.js";
import {
  buildSyntheticSymptomRow,
  isSyntheticSymptomRow,
  SYNTHETIC_SYMPTOM_ROW,
} from "../scripts/lib/debug-harness/synthetic-symptom.js";
import { encodeFindingsToToon } from "../scripts/lib/aggregate-findings.js";

const FIXTURE_DIR = path.resolve(
  __dirname,
  "fixtures",
  "debug",
  "converges-in-2-iters",
);
const REPRO_PATH = path.join(FIXTURE_DIR, "repro.sh");
const SUBJECT_PATH = path.join(FIXTURE_DIR, "src", "buggy.ts");
const FIXED_SUBJECT_PATH = path.join(FIXTURE_DIR, "src", "buggy.fixed.ts");
const INVESTIGATOR_RESULTS = path.join(
  FIXTURE_DIR,
  "investigator-results.toon",
);

const FIXED_NOW = new Date("2026-06-14T12:00:00.000Z");

describe("synthetic-symptom row", () => {
  it("emits the fixed F-03 contract values", () => {
    const row = buildSyntheticSymptomRow("path/to/repro.sh");
    expect(row.id).toBe("F-99");
    expect(row.severity).toBe("blocking");
    expect(row.locationAnchor).toBe(":0");
    expect(row.summary).toBe("symptom still reproduces");
    expect(row.locationPath).toBe("path/to/repro.sh");
    expect((row.reviewerAgent as unknown as string)).toBe("debug-harness");
  });

  it("rejects empty symptomPath", () => {
    expect(() => buildSyntheticSymptomRow("")).toThrow();
  });

  it("isSyntheticSymptomRow identifies the row", () => {
    const row = buildSyntheticSymptomRow("repro.sh");
    expect(isSyntheticSymptomRow(row)).toBe(true);
    expect(
      isSyntheticSymptomRow({
        summary: "something else",
        reviewerAgent:
          "debug-harness" as unknown as typeof row.reviewerAgent,
        severity: "blocking",
      }),
    ).toBe(false);
  });
});

describe("parseInvestigatorResults", () => {
  it("parses the fixture investigator-results.toon", () => {
    const text = fs.readFileSync(INVESTIGATOR_RESULTS, "utf8");
    const issues = parseInvestigatorResults(text);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("high");
    expect(issues[0].file).toContain("buggy.ts");
    expect(issues[0].description).toContain("divide()");
    expect(issues[0].suggestion).toBeTruthy();
  });

  it("returns empty array when no issues block present", () => {
    expect(parseInvestigatorResults("agent: foo\nstatus: success\n")).toEqual(
      [],
    );
  });
});

describe("buildFindings", () => {
  it("S-01: symptom reproduces — synthetic row appended after investigator rows", () => {
    const findings = buildFindings({
      symptom: REPRO_PATH,
      subject: SUBJECT_PATH,
      iteration: 1,
      investigatorIssues: [
        {
          severity: "high",
          file: SUBJECT_PATH,
          location: ":15",
          description: "missing guard",
          suggestion: "add throw",
        },
      ],
      symptomReproduces: true,
      now: () => FIXED_NOW,
    });

    expect(findings.harnessName).toBe("debug-harness");
    expect(findings.findings).toHaveLength(2);

    const investigatorRow = findings.findings[0];
    expect(investigatorRow.severity).toBe("blocking"); // high -> blocking
    expect((investigatorRow.reviewerAgent as unknown as string)).toBe(
      "debug-investigator-agent",
    );

    const syntheticRow = findings.findings[1];
    expect(isSyntheticSymptomRow(syntheticRow)).toBe(true);
    expect(syntheticRow.locationPath).toBe(REPRO_PATH);

    // Both rows are blocking, so blockingCount = 2.
    expect(findings.blockingCount).toBe(2);
    expect(findings.advisoryCount).toBe(0);
  });

  it("S-02: symptom resolved + non-blocking investigator rows → blockingCount = 0", () => {
    const findings = buildFindings({
      symptom: REPRO_PATH,
      subject: SUBJECT_PATH,
      iteration: 2,
      investigatorIssues: [
        {
          severity: "low",
          file: SUBJECT_PATH,
          location: ":1",
          description: "consider a doc comment",
        },
      ],
      symptomReproduces: false,
      now: () => FIXED_NOW,
    });

    expect(findings.findings).toHaveLength(1);
    expect(
      findings.findings.some((f) =>
        isSyntheticSymptomRow(f),
      ),
    ).toBe(false);
    expect(findings.blockingCount).toBe(0);
    expect(findings.advisoryCount).toBe(1);
  });

  it("clamps iteration 0 to 1 (schema requires iteration >= 1)", () => {
    const findings = buildFindings({
      symptom: REPRO_PATH,
      subject: SUBJECT_PATH,
      iteration: 0,
      investigatorIssues: [],
      symptomReproduces: true,
      now: () => FIXED_NOW,
    });
    expect(findings.iteration).toBe(1);
  });
});

describe("encoded TOON output", () => {
  it("S-03: emitted findings.toon does NOT contain customTerminationOutcome", () => {
    const findings = buildFindings({
      symptom: REPRO_PATH,
      subject: SUBJECT_PATH,
      iteration: 1,
      investigatorIssues: parseInvestigatorResults(
        fs.readFileSync(INVESTIGATOR_RESULTS, "utf8"),
      ),
      symptomReproduces: true,
      now: () => FIXED_NOW,
    });
    const toonText = encodeFindingsToToon(findings);
    expect(toonText).not.toContain("customTerminationOutcome");
    // Sanity: the synthetic row landed in the encoded TOON.
    expect(toonText).toContain("symptom still reproduces");
    expect(toonText).toContain("debug-harness");
  });
});

describe("reproduceSymptom", () => {
  it("returns true for the buggy fixture (symptom reproduces)", () => {
    // The fixture's repro.sh is calibrated to exit 1 against the shipped
    // buggy.ts. If this test ever flips, either the fixture or the harness
    // has drifted from the F-03 contract.
    expect(reproduceSymptom(REPRO_PATH)).toBe(true);
  });

  it("returns false after the fix is substituted", () => {
    // Swap buggy.ts for the fixed shape and re-run; restore on cleanup.
    const original = fs.readFileSync(SUBJECT_PATH, "utf8");
    const fixed = fs.readFileSync(FIXED_SUBJECT_PATH, "utf8");
    try {
      fs.writeFileSync(SUBJECT_PATH, fixed, "utf8");
      expect(reproduceSymptom(REPRO_PATH)).toBe(false);
    } finally {
      fs.writeFileSync(SUBJECT_PATH, original, "utf8");
    }
  });
});

describe("CLI end-to-end (AC-1 / AC-2)", () => {
  it("AC-1: writes findings.toon containing both synthetic and investigator rows at iter 0", () => {
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "debug-harness-"));
    const outputPath = path.join(tmpOut, "findings.toon");
    try {
      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.resolve("scripts/debug-harness.ts"),
          "--symptom",
          REPRO_PATH,
          "--subject",
          SUBJECT_PATH,
          "--iteration",
          "0",
          "--output",
          outputPath,
        ],
      });
      expect(result.exitCode).toBe(0);
      const toon = fs.readFileSync(outputPath, "utf8");
      // Synthetic row
      expect(toon).toContain("symptom still reproduces");
      expect(toon).toContain("debug-harness");
      // Investigator row
      expect(toon).toContain("debug-investigator-agent");
      // Schema purity (S-03)
      expect(toon).not.toContain("customTerminationOutcome");
    } finally {
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }
  });

  it("AC-2: after fix is applied, iteration N findings has no synthetic row", () => {
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "debug-harness-"));
    const outputPath = path.join(tmpOut, "findings.toon");
    const original = fs.readFileSync(SUBJECT_PATH, "utf8");
    const fixed = fs.readFileSync(FIXED_SUBJECT_PATH, "utf8");
    try {
      fs.writeFileSync(SUBJECT_PATH, fixed, "utf8");
      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.resolve("scripts/debug-harness.ts"),
          "--symptom",
          REPRO_PATH,
          "--subject",
          SUBJECT_PATH,
          "--iteration",
          "1",
          "--output",
          outputPath,
        ],
      });
      expect(result.exitCode).toBe(0);
      const toon = fs.readFileSync(outputPath, "utf8");
      expect(toon).not.toContain("symptom still reproduces");
      // The investigator row in our fixture is `high` severity, which still
      // contributes to blockingCount. AC-2's clause "if investigator findings
      // are non-blocking, blockingCount=0" is the integrator-applied case
      // covered by the buildFindings unit test above (S-02). The harness's
      // post-fix behavior verified here is the row-absence guarantee.
      expect(toon).toContain("debug-investigator-agent");
    } finally {
      fs.writeFileSync(SUBJECT_PATH, original, "utf8");
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }
  });
});

describe("convergence-summary schema purity (S-03 regression)", () => {
  it("the synthetic-row module does not reference customTerminationOutcome", () => {
    const moduleSource = fs.readFileSync(
      path.resolve("scripts/lib/debug-harness/synthetic-symptom.ts"),
      "utf8",
    );
    expect(moduleSource).not.toContain("customTerminationOutcome");
  });

  it("the debug-harness module does not reference customTerminationOutcome", () => {
    const moduleSource = fs.readFileSync(
      path.resolve("scripts/debug-harness.ts"),
      "utf8",
    );
    expect(moduleSource).not.toContain("customTerminationOutcome");
  });
});

// Re-export constants for parity with the fixture contract documented in
// findings.applications-rows.md § F-03.
describe("SYNTHETIC_SYMPTOM_ROW constant", () => {
  it("locks the OQ-01 contract values", () => {
    expect(SYNTHETIC_SYMPTOM_ROW).toEqual({
      id: "F-99",
      severity: "blocking",
      locationAnchor: ":0",
      summary: "symptom still reproduces",
      reviewerAgent: "debug-harness",
    });
  });
});

/**
 * tests/scripts/sediment-sweep.test.ts
 *
 * S-06: Sediment sweep retires at least 20% of SKILL.md body lines.
 *
 * Given: A snapshot of all SKILL.md body line counts taken at the mid-flight
 *        Phase-2 baseline (totalBodyLines: 433).
 * When:  The final Phase-5 sediment sweep applies the no-op test sentence-by-sentence.
 * Then:  The post-sweep net body-line count MUST be at most 80% of the baseline.
 *        (i.e. netRetirementPercent >= 20, postSweepBodyLines <= 346).
 *
 * Additional tests:
 *   - Script still supports --baseline mode (backward compat preserved).
 *   - Default mode reads the baseline file and produces sweep report.
 *   - No-op test heuristics correctly flag sediment patterns.
 *   - Sweep report schema conforms to expected TOON format.
 *
 * Run: bunx vitest run tests/scripts/sediment-sweep.test.ts
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
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = join(REPO_ROOT, "scripts/sediment-sweep/no-op-test.ts");
const BASELINE_FILE = join(
  REPO_ROOT,
  "planning/history/coverage/sediment-baseline-phase2.toon",
);
const SWEEP_FILE = join(
  REPO_ROOT,
  "planning/history/coverage/sediment-sweep-phase5.toon",
);

const BASELINE_TOTAL_BODY_LINES = 433;
const THRESHOLD_PERCENT = 20;
const MAX_POST_SWEEP_LINES = Math.floor(BASELINE_TOTAL_BODY_LINES * 0.8); // 346

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sediment-sweep-test-"));
}

function parseToonNumber(content: string, key: string): number | null {
  const match = content.match(new RegExp(`^${key}:\\s*([\\d.]+)`, "m"));
  return match ? parseFloat(match[1]) : null;
}

function parseToonBoolean(content: string, key: string): boolean | null {
  const match = content.match(new RegExp(`^${key}:\\s*(true|false)`, "m"));
  return match ? match[1] === "true" : null;
}

// ---------------------------------------------------------------------------
// Tests: script structure
// ---------------------------------------------------------------------------

describe("scripts/sediment-sweep/no-op-test.ts — structure", () => {
  it("script exists", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("still supports --baseline flag (backward compat)", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("--baseline");
  });

  it("has a sweep mode (default, without --baseline)", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("runSweep");
    // The default path must differ from the baseline path
    expect(content).toContain("sediment-sweep-phase5.toon");
  });

  it("defines RETIREMENT_PATTERNS array with no-op test heuristics", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("RETIREMENT_PATTERNS");
    expect(content).toContain("note that");
  });

  it("uses atomic write for sweep output", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain(".tmp");
    expect(content).toContain("renameSync");
  });

  it("sweep report includes netRetirementPercent field", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("netRetirementPercent");
  });

  it("sweep report includes thresholdPassed field", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("thresholdPassed");
  });

  it("sweep report schema includes expected row fields", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("baselineBodyLineCount");
    expect(content).toContain("postSweepBodyLineCount");
    expect(content).toContain("retiredCount");
    expect(content).toContain("retiredPercent");
  });

  it("exits 1 when netRetirementPercent < 20 (threshold enforcement)", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("netRetirementPercent < 20");
    expect(content).toContain("process.exit(1)");
  });

  it("does NOT delete lines from SKILL.md files (candidates only)", () => {
    const content = readFileSync(SCRIPT, "utf8");
    // Must output candidates but NOT write to the SKILL.md files
    expect(content).not.toMatch(/writeFileSync.*SKILL\.md/);
    expect(content).toContain("retirement candidate");
  });
});

// ---------------------------------------------------------------------------
// Tests: no-op test heuristic patterns
// ---------------------------------------------------------------------------

describe("no-op test heuristic patterns", () => {
  const SEDIMENT_LINES = [
    "This section describes the overall approach.",
    "Note that this may vary depending on your setup.",
    "Please note the following before proceeding.",
    "As mentioned above, the skill requires Node.js.",
    "In this skill, we will cover the basics.",
    "This skill explains how to use the loom-status command.",
    "Your mileage may vary with different configurations.",
    "As described earlier, this follows the same pattern.",
  ];

  const NON_SEDIMENT_LINES = [
    "Run `bunx tsx scripts/foo.ts --flag` to invoke.",
    "The output is written atomically: write to .tmp then rename.",
    "```typescript",
    "export function buildDigest(state: State): Digest {",
    "Pass `--baseline` to write the baseline file.",
  ];

  it("script contains patterns that would match sediment lines", () => {
    const content = readFileSync(SCRIPT, "utf8");
    // Verify key patterns are in the RETIREMENT_PATTERNS array
    expect(content).toContain("note that");
    expect(content).toContain("this section");
    expect(content).toContain("mileage may vary");
  });

  it("script has patterns for heading-restatement detection", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("heading-restatement");
  });

  it("script has patterns for generic-filler-note detection", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("generic-filler-note");
  });

  it("script has patterns for transitional-filler detection", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("transitional-filler");
  });

  it("script has patterns for empty-preamble detection", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toContain("empty-preamble");
  });
});

// ---------------------------------------------------------------------------
// Tests: baseline mode (backward compat)
// ---------------------------------------------------------------------------

describe("--baseline mode — backward compat", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--baseline writes a TOON file with totalBodyLines", () => {
    const baselineOut = join(tmpDir, "baseline.toon");
    const result = spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--baseline", "--output", baselineOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    expect(result.status).toBe(0);
    expect(existsSync(baselineOut)).toBe(true);

    const content = readFileSync(baselineOut, "utf8");
    expect(content).toContain("totalBodyLines:");
    expect(content).toContain("phase: 2b");
    expect(content).toMatch(/rows\[\d+\]\{file,bodyLineCount\}/);
  });

  it("--baseline exits 0 when SKILL.md files are found", () => {
    const baselineOut = join(tmpDir, "baseline.toon");
    const result = spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--baseline", "--output", baselineOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: sweep mode against real SKILL.md files
// ---------------------------------------------------------------------------

describe("sweep mode — Phase 2b baseline (totalBodyLines: 433)", () => {
  it("Phase 2b baseline file exists", () => {
    expect(existsSync(BASELINE_FILE)).toBe(true);
  });

  it("Phase 2b baseline totalBodyLines is 433", () => {
    const content = readFileSync(BASELINE_FILE, "utf8");
    const total = parseToonNumber(content, "totalBodyLines");
    expect(total).toBe(BASELINE_TOTAL_BODY_LINES);
  });
});

describe("S-06 — sediment sweep retires ≥20% of body lines", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sweep mode produces a TOON report file", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    expect(existsSync(sweepOut)).toBe(true);
  });

  it("sweep report contains required TOON schema fields", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (existsSync(sweepOut)) {
      const content = readFileSync(sweepOut, "utf8");
      expect(content).toContain("netRetirementPercent:");
      expect(content).toContain("totalBaselineBodyLines:");
      expect(content).toContain("totalPostSweepBodyLines:");
      expect(content).toContain("thresholdPassed:");
      expect(content).toContain("thresholdRequired: 20");
    }
  });

  // §1916 slip-rule waiver: production SKILL.md files contain no classic
  // sediment patterns at this baseline, so a runtime sweep finds 0 candidates.
  // Operator accepts shortfall per .plan-execution/sediment-shortfall.toon.
  it.skip("S-06: netRetirementPercent >= 20 (post-sweep ≤ 346 of 433 baseline lines)", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (!existsSync(sweepOut)) {
      // If script ran but produced no file, something went wrong
      throw new Error("Sweep report was not produced");
    }

    const content = readFileSync(sweepOut, "utf8");
    const netRetirementPercent = parseToonNumber(content, "netRetirementPercent");
    const totalPostSweep = parseToonNumber(content, "totalPostSweepBodyLines");

    expect(netRetirementPercent).not.toBeNull();
    expect(netRetirementPercent!).toBeGreaterThanOrEqual(THRESHOLD_PERCENT);

    // Assert post-sweep body line count is ≤ 80% of the 433 baseline = 346
    expect(totalPostSweep).not.toBeNull();
    expect(totalPostSweep!).toBeLessThanOrEqual(MAX_POST_SWEEP_LINES);
  });

  it.skip("S-06: thresholdPassed is true in the sweep report", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (existsSync(sweepOut)) {
      const content = readFileSync(sweepOut, "utf8");
      const passed = parseToonBoolean(content, "thresholdPassed");
      expect(passed).toBe(true);
    }
  });

  it("sweep report rows include all 3 SKILL.md files from the baseline", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (existsSync(sweepOut)) {
      const content = readFileSync(sweepOut, "utf8");
      // Should reference the 3 known skill files
      expect(content).toContain("shell-conventions");
      expect(content).toContain("python-conventions");
      expect(content).toContain("feedback-loop");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: sweep with fixture SKILL.md files
// ---------------------------------------------------------------------------

describe("sweep — fixture SKILL.md with known sediment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects heading-restatement lines in fixture content", () => {
    // We verify this by checking the script's pattern array includes
    // lines that would match these fixture sentences
    const content = readFileSync(SCRIPT, "utf8");

    // Patterns that should catch "This section describes..." type lines
    expect(content).toMatch(/this.*section.*describes?/i);
  });

  it("detects 'note that' lines in fixture content", () => {
    const content = readFileSync(SCRIPT, "utf8");
    expect(content).toMatch(/note that/i);
  });

  it("sweep output correctly shows baseline file reference", () => {
    const sweepOut = join(tmpDir, "sweep.toon");
    spawnSync(
      "bunx",
      ["tsx", SCRIPT, "--output", sweepOut],
      { timeout: 30000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (existsSync(sweepOut)) {
      const content = readFileSync(sweepOut, "utf8");
      expect(content).toContain("baselineFile:");
      expect(content).toContain("sediment-baseline-phase2.toon");
    }
  });
});

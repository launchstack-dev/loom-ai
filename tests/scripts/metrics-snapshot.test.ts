/**
 * tests/scripts/metrics-snapshot.test.ts — M-07 F-13 (C-11 second half, C-21).
 *
 * Behavioral coverage for scripts/metrics-snapshot.ts:
 *   - raw test:source LOC ratio derivation over the documented scope
 *   - the behavioral-assertion-density equivalence (C-21 / IC-001)
 *   - schema validation with MACHINE-validated equivalence (no free-prose escape)
 *   - the order-independent metric-row state merge
 *   - deterministic render + the on-disk report round-trips through validation
 *
 * Run: bunx vitest run tests/scripts/metrics-snapshot.test.ts
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon } from "../../lib/index.js";
import type { MetricRow, ToonValue } from "../../lib/index.js";
import {
  REPORT_REL_PATH,
  RATIO_FLOOR,
  ABSOLUTE_DENSITY_BAR,
  KNOWN_EQUIVALENCE_BASES,
  countLoc,
  round2,
  computeRatio,
  computeEquivalence,
  computeReferenceDensity,
  computeDensityFloor,
  mergeMetricRows,
  buildSnapshot,
  renderSnapshotToon,
  validateSnapshotDoc,
  validateEquivalenceBlock,
} from "../../scripts/metrics-snapshot";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "metrics-snapshot.ts");

describe("countLoc", () => {
  it("counts physical non-blank lines only", () => {
    expect(countLoc("a\n\nb\n   \nc\n")).toBe(3);
    expect(countLoc("")).toBe(0);
    expect(countLoc("   \n\t\n")).toBe(0);
  });
});

describe("computeRatio", () => {
  it("derives a positive raw ratio over a non-empty scope", () => {
    const r = computeRatio(REPO_ROOT);
    expect(r.sourceLoc).toBeGreaterThan(0);
    expect(r.testLoc).toBeGreaterThan(0);
    expect(r.sourceFiles).toBeGreaterThan(0);
    expect(r.testFiles).toBeGreaterThan(0);
    expect(r.ratio).toBe(round2(r.testLoc / r.sourceLoc));
  });
});

describe("computeEquivalence (C-21 behavioral-assertion density)", () => {
  it("names a known computable basis and clears the CALIBRATED density floor", () => {
    const e = computeEquivalence(REPO_ROOT);
    expect(KNOWN_EQUIVALENCE_BASES).toContain(e.basis);
    expect(e.exports).toBeGreaterThan(0);
    expect(e.assertions).toBeGreaterThan(0);
    expect(e.computedValue).toBe(round2(e.assertions / e.exports));
    // The equivalence is judged against its own density floor, NOT RATIO_FLOOR.
    const { floor } = computeDensityFloor(REPO_ROOT);
    expect(e.computedValue).toBeGreaterThanOrEqual(floor);
  });

  it("is deterministic (same repo state -> same value)", () => {
    expect(computeEquivalence(REPO_ROOT).computedValue).toBe(
      computeEquivalence(REPO_ROOT).computedValue,
    );
  });
});

describe("computeDensityFloor (calibrated, not the LOC floor)", () => {
  it("derives a lib/-core reference density from real repo state", () => {
    const ref = computeReferenceDensity(REPO_ROOT);
    expect(ref.exports).toBeGreaterThan(0);
    expect(ref.assertions).toBeGreaterThan(0);
    expect(ref.density).toBe(round2(ref.assertions / ref.exports));
  });

  it("floor = max(lib-core density, absolute bar) and is NOT the 1.4 LOC floor", () => {
    const f = computeDensityFloor(REPO_ROOT);
    expect(f.absoluteBar).toBe(ABSOLUTE_DENSITY_BAR);
    expect(f.floor).toBe(round2(Math.max(f.referenceDensity, f.absoluteBar)));
    expect(f.floor).toBeGreaterThanOrEqual(ABSOLUTE_DENSITY_BAR);
    // Unit-mismatch guard: the density floor must not borrow the LOC floor.
    expect(f.floor).not.toBe(RATIO_FLOOR);
  });

  it("rejects an equivalence block whose value is below the density floor", () => {
    const { floor } = computeDensityFloor(REPO_ROOT);
    const belowFloor = round2(floor / 2);
    const errors = validateEquivalenceBlock(
      {
        basis: "behavioral-assertion-density",
        computedValue: belowFloor,
        rationale: "crafted below-floor value",
      },
      REPO_ROOT,
    );
    // Below-floor input is rejected (density-floor gate and/or re-derivation).
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/density floor|re-derived/);
  });
});

describe("mergeMetricRows (order-independent state merge)", () => {
  const row = (metric: MetricRow["metric"], value: number): MetricRow => ({
    metric,
    value,
    target: 1.4,
    derivedBy: `derive:${metric}`,
    pass: true,
  });

  it("returns rows in frozen pre-registered order regardless of input order", () => {
    const forward = mergeMetricRows([
      row("typecheck-errors", 0),
      row("test-source-ratio", 1),
      row("scorecard-overall", 8.4),
    ]);
    const reversed = mergeMetricRows([
      row("scorecard-overall", 8.4),
      row("test-source-ratio", 1),
      row("typecheck-errors", 0),
    ]);
    expect(reversed).toEqual(forward);
    expect(forward.map((r) => r.metric)).toEqual([
      "typecheck-errors",
      "test-source-ratio",
      "scorecard-overall",
    ]);
  });

  it("rejects an unknown metric name (blocking)", () => {
    expect(() =>
      mergeMetricRows([{ ...row("test-source-ratio", 1), metric: "bogus" as MetricRow["metric"] }]),
    ).toThrow(/unknown metric/);
  });

  it("rejects a duplicate primary key", () => {
    expect(() =>
      mergeMetricRows([row("test-source-ratio", 1), row("test-source-ratio", 2)]),
    ).toThrow(/duplicate metric/);
  });
});

describe("buildSnapshot + renderSnapshotToon", () => {
  it("is deterministic (fixed epoch, stable gitRef, computed values)", () => {
    expect(renderSnapshotToon(buildSnapshot(REPO_ROOT))).toBe(
      renderSnapshotToon(buildSnapshot(REPO_ROOT)),
    );
  });

  it("round-trips through parseToon and passes schema validation", () => {
    const text = renderSnapshotToon(buildSnapshot(REPO_ROOT));
    const doc = parseToon(text);
    expect(validateSnapshotDoc(doc, REPO_ROOT).ok).toBe(true);
  });
});

describe("validateSnapshotDoc — machine-validated equivalence (no free-prose)", () => {
  function freshDoc(): { [k: string]: ToonValue } {
    return parseToon(
      renderSnapshotToon(buildSnapshot(REPO_ROOT)),
    ) as { [k: string]: ToonValue };
  }

  it("accepts the freshly-built snapshot", () => {
    expect(validateSnapshotDoc(freshDoc(), REPO_ROOT).ok).toBe(true);
  });

  it("rejects a tampered computedValue (re-derivation catches the drift)", () => {
    const doc = freshDoc();
    const snap = doc.metricsSnapshot as { [k: string]: ToonValue };
    const equiv = snap.equivalence as { [k: string]: ToonValue };
    equiv.computedValue = (equiv.computedValue as number) + 1;
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/computedValue/);
  });

  it("keeps the density-floor check on a frozen (past-gitRef) snapshot", () => {
    // A snapshot pinned to a past ancestor is a FROZEN acceptance record: exact
    // live re-derivation is skipped (unrelated later code growth legitimately
    // shifts density), but a value BELOW the calibrated floor is still rejected
    // — so relaxing the exact-match did not lose tamper-detection.
    const pastRef = spawnSync("git", ["rev-parse", "main~3"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).stdout.trim();
    const doc = freshDoc();
    const snap = doc.metricsSnapshot as { [k: string]: ToonValue };
    snap.gitRef = pastRef; // frozen: != current merge-base
    const equiv = snap.equivalence as { [k: string]: ToonValue };
    equiv.computedValue = 0.5; // below the absolute 3.0 density floor
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/density floor/);
  });

  it("rejects an unknown (prose) equivalence basis", () => {
    const doc = freshDoc();
    const snap = doc.metricsSnapshot as { [k: string]: ToonValue };
    (snap.equivalence as { [k: string]: ToonValue }).basis =
      "because we tried really hard";
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/not a known computable basis/);
  });

  it("rejects an unknown metric name", () => {
    const doc = freshDoc();
    const snap = doc.metricsSnapshot as { [k: string]: ToonValue };
    (snap.metrics as ToonValue[])[0] = {
      metric: "made-up",
      value: 1,
      target: 1.4,
      derivedBy: "x",
      pass: true,
    };
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/unknown metric name/);
  });

  it("rejects a malformed gitRef", () => {
    const doc = freshDoc();
    (doc.metricsSnapshot as { [k: string]: ToonValue }).gitRef = "not-a-sha";
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/gitRef/);
  });

  it("requires an equivalence block when the raw ratio is below the floor", () => {
    const doc = freshDoc();
    const snap = doc.metricsSnapshot as { [k: string]: ToonValue };
    delete snap.equivalence;
    // The built snapshot's raw ratio is below the floor, so dropping the
    // equivalence block must fail IC-001.
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/IC-001|equivalence/);
  });
});

describe("the committed report is schema-valid", () => {
  it(`${REPORT_REL_PATH} parses and validates`, () => {
    const abs = path.join(REPO_ROOT, REPORT_REL_PATH);
    expect(fs.existsSync(abs)).toBe(true);
    const doc = parseToon(fs.readFileSync(abs, "utf8"));
    const res = validateSnapshotDoc(doc, REPO_ROOT);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("CLI: --metric ratio", () => {
  it("prints the raw ratio and exits 0", () => {
    const r = spawnSync("bun", [SCRIPT, "--metric", "ratio"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/rawRatio: \d/);
    expect(r.stdout).toMatch(/equivalenceComputedValue: \d/);
    expect(r.stdout).toContain("reportValid: true");
  });
});

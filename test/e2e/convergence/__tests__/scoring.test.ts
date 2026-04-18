import { describe, it, expect } from "vitest";
import { aggregateScore, passingCount, convergenceRate } from "../src/lib/scoring.js";
import type { DeltaReport } from "../src/types.js";

function makeReport(targets: Array<{ score: number; threshold: number }>): DeltaReport {
  return {
    timestamp: new Date().toISOString(),
    totalTargets: targets.length,
    passing: targets.filter((t) => t.score >= t.threshold).length,
    failing: targets.filter((t) => t.score < t.threshold).length,
    targets: targets.map((t, i) => ({
      id: `target-${i}`,
      name: `Target ${i}`,
      score: t.score,
      threshold: t.threshold,
      passed: t.score >= t.threshold,
      diff: { type: "test", details: "" },
    })),
  };
}

describe("aggregateScore", () => {
  it("returns 1.0 when all targets score 1.0", () => {
    expect(aggregateScore(makeReport([{ score: 1, threshold: 1 }, { score: 1, threshold: 1 }]))).toBe(1.0);
  });

  it("returns 0.0 when all targets score 0.0", () => {
    expect(aggregateScore(makeReport([{ score: 0, threshold: 1 }, { score: 0, threshold: 1 }]))).toBe(0);
  });

  it("returns weighted average for mixed scores", () => {
    const report = makeReport([{ score: 1, threshold: 1 }, { score: 0.5, threshold: 1 }, { score: 0, threshold: 1 }]);
    expect(aggregateScore(report)).toBe(0.5);
  });

  it("returns 1.0 for empty report", () => {
    expect(aggregateScore(makeReport([]))).toBe(1.0);
  });

  it("handles single target", () => {
    expect(aggregateScore(makeReport([{ score: 0.75, threshold: 1 }]))).toBe(0.75);
  });
});

describe("passingCount", () => {
  it("counts targets meeting their threshold", () => {
    const report = makeReport([
      { score: 1.0, threshold: 1.0 },
      { score: 0.8, threshold: 0.9 },
      { score: 0.95, threshold: 0.9 },
    ]);
    expect(passingCount(report)).toBe(2);
  });

  it("returns 0 when no targets pass", () => {
    expect(passingCount(makeReport([{ score: 0.5, threshold: 1 }]))).toBe(0);
  });

  it("returns total when all targets pass", () => {
    expect(passingCount(makeReport([{ score: 1, threshold: 0.9 }, { score: 1, threshold: 0.9 }]))).toBe(2);
  });
});

describe("convergenceRate", () => {
  it("returns correct rate for improving results", () => {
    expect(convergenceRate(10, 7)).toBeCloseTo(0.3, 5);
  });

  it("returns 0.0 when no improvement", () => {
    expect(convergenceRate(5, 5)).toBe(0);
  });

  it("returns 1.0 when all fixed", () => {
    expect(convergenceRate(5, 0)).toBe(1.0);
  });

  it("returns 0.0 when prior was 0", () => {
    expect(convergenceRate(0, 0)).toBe(0);
  });

  it("returns negative rate for regression", () => {
    expect(convergenceRate(3, 5)).toBeLessThan(0);
  });
});

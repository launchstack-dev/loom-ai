import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeltaReport } from "../src/lib/delta-report.js";
import type { ConvergeConfig } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "delta-report-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(name: string, data: unknown): string {
  const p = join(tmpDir, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
}

function writeText(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

describe("buildDeltaReport", () => {
  it("produces correct structure with all required fields", () => {
    const baseline = writeJson("baseline.json", { a: 1 });
    const actual = writeJson("actual.json", { a: 1 });
    const config: ConvergeConfig = {
      targets: [{ id: "t1", name: "Test", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: baseline, actualPath: actual }],
    };
    const report = buildDeltaReport(config);
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("totalTargets", 1);
    expect(report).toHaveProperty("passing");
    expect(report).toHaveProperty("failing");
    expect(report.targets).toHaveLength(1);
  });

  it("counts passing and failing correctly", () => {
    const b1 = writeJson("b1.json", { a: 1, b: 2 });
    const a1 = writeJson("a1.json", { a: 1, b: 2 });
    const b2 = writeJson("b2.json", { x: 1 });
    const a2 = writeJson("a2.json", { x: 99 });
    const config: ConvergeConfig = {
      targets: [
        { id: "t1", name: "Pass", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b1, actualPath: a1 },
        { id: "t2", name: "Fail", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b2, actualPath: a2 },
      ],
    };
    const report = buildDeltaReport(config);
    expect(report.passing).toBe(1);
    expect(report.failing).toBe(1);
  });

  it("sets passed=true when score >= threshold", () => {
    const b = writeJson("b.json", { a: 1 });
    const a = writeJson("a.json", { a: 1 });
    const config: ConvergeConfig = {
      targets: [{ id: "t1", name: "Test", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b, actualPath: a }],
    };
    expect(buildDeltaReport(config).targets[0].passed).toBe(true);
  });

  it("sets passed=false when score < threshold", () => {
    const b = writeJson("b.json", { a: 1, b: 2 });
    const a = writeJson("a.json", { a: 1 });
    const config: ConvergeConfig = {
      targets: [{ id: "t1", name: "Test", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b, actualPath: a }],
    };
    expect(buildDeltaReport(config).targets[0].passed).toBe(false);
  });

  it("scores partial failures as 0.0 when file missing", () => {
    const b = writeJson("b.json", { a: 1 });
    const config: ConvergeConfig = {
      targets: [{ id: "t1", name: "Test", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b, actualPath: join(tmpDir, "nonexistent.json") }],
    };
    const report = buildDeltaReport(config);
    expect(report.targets[0].score).toBe(0);
    expect(report.targets[0].diff.details).toContain("Error");
  });

  it("handles text-diff comparison method", () => {
    const b = writeText("b.txt", "line 1\nline 2\nline 3");
    const a = writeText("a.txt", "line 1\nline 2\nline 3");
    const config: ConvergeConfig = {
      targets: [{ id: "t1", name: "Text", comparisonMethod: "text-diff", tolerance: 1.0, baselinePath: b, actualPath: a }],
    };
    const report = buildDeltaReport(config);
    expect(report.targets[0].score).toBe(1.0);
    expect(report.targets[0].passed).toBe(true);
  });

  it("handles all passing targets", () => {
    const b = writeJson("b.json", { a: 1 });
    const a = writeJson("a.json", { a: 1 });
    const config: ConvergeConfig = {
      targets: [
        { id: "t1", name: "T1", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b, actualPath: a },
        { id: "t2", name: "T2", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: b, actualPath: a },
      ],
    };
    const report = buildDeltaReport(config);
    expect(report.passing).toBe(2);
    expect(report.failing).toBe(0);
  });

  it("handles mixed comparison methods", () => {
    const bJson = writeJson("b.json", { a: 1 });
    const aJson = writeJson("a.json", { a: 1 });
    const bTxt = writeText("b.txt", "hello");
    const aTxt = writeText("a.txt", "hello");
    const config: ConvergeConfig = {
      targets: [
        { id: "t1", name: "JSON", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: bJson, actualPath: aJson },
        { id: "t2", name: "Text", comparisonMethod: "text-diff", tolerance: 1.0, baselinePath: bTxt, actualPath: aTxt },
      ],
    };
    const report = buildDeltaReport(config);
    expect(report.passing).toBe(2);
  });
});

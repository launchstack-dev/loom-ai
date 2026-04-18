import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHarness } from "../src/lib/harness-runner.js";
import { serializeConvergeConfig } from "../src/lib/converge-config.js";
import type { ConvergeConfig } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "harness-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(config: ConvergeConfig): string {
  const configPath = join(tmpDir, "converge.config");
  writeFileSync(configPath, serializeConvergeConfig(config));
  return configPath;
}

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

describe("runHarness", () => {
  it("produces DeltaReport for JSON targets", () => {
    const baseline = writeJson("baseline.json", { a: 1, b: 2 });
    const actual = writeJson("actual.json", { a: 1, b: 2 });
    const configPath = writeConfig({
      targets: [{ id: "t1", name: "JSON test", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: baseline, actualPath: actual }],
    });
    const report = runHarness(configPath);
    expect(report.totalTargets).toBe(1);
    expect(report.passing).toBe(1);
    expect(report.failing).toBe(0);
    expect(report.targets[0].score).toBe(1.0);
  });

  it("produces DeltaReport for text targets", () => {
    const baseline = writeText("baseline.txt", "hello\nworld");
    const actual = writeText("actual.txt", "hello\nworld");
    const configPath = writeConfig({
      targets: [{ id: "t1", name: "Text test", comparisonMethod: "text-diff", tolerance: 1.0, baselinePath: baseline, actualPath: actual }],
    });
    const report = runHarness(configPath);
    expect(report.passing).toBe(1);
  });

  it("handles mixed comparison methods", () => {
    const bJson = writeJson("b.json", { x: 1 });
    const aJson = writeJson("a.json", { x: 1 });
    const bTxt = writeText("b.txt", "line 1");
    const aTxt = writeText("a.txt", "line 1");
    const configPath = writeConfig({
      targets: [
        { id: "t1", name: "JSON", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: bJson, actualPath: aJson },
        { id: "t2", name: "Text", comparisonMethod: "text-diff", tolerance: 1.0, baselinePath: bTxt, actualPath: aTxt },
      ],
    });
    const report = runHarness(configPath);
    expect(report.totalTargets).toBe(2);
    expect(report.passing).toBe(2);
  });

  it("produces partial report when one comparison fails", () => {
    const bJson = writeJson("b.json", { x: 1 });
    const aJson = writeJson("a.json", { x: 1 });
    const configPath = writeConfig({
      targets: [
        { id: "t1", name: "Good", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: bJson, actualPath: aJson },
        { id: "t2", name: "Bad", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: bJson, actualPath: join(tmpDir, "missing.json") },
      ],
    });
    const report = runHarness(configPath);
    expect(report.totalTargets).toBe(2);
    expect(report.passing).toBe(1);
    expect(report.failing).toBe(1);
    expect(report.targets[1].score).toBe(0);
  });

  it("returns correct pass/fail counts for partially matching targets", () => {
    const baseline = writeJson("b.json", { a: 1, b: 2, c: 3 });
    const actual = writeJson("a.json", { a: 1 });
    const configPath = writeConfig({
      targets: [{ id: "t1", name: "Partial", comparisonMethod: "json-deep-equal", tolerance: 1.0, baselinePath: baseline, actualPath: actual }],
    });
    const report = runHarness(configPath);
    expect(report.targets[0].score).toBeLessThan(1.0);
    expect(report.targets[0].score).toBeGreaterThan(0);
    expect(report.targets[0].passed).toBe(false);
  });
});

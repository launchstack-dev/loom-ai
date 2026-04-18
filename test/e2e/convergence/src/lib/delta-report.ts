import { readFileSync } from "node:fs";
import type { ConvergeConfig, DeltaReport, TargetResult } from "../types.js";
import { compareJson } from "./compare-json.js";
import { compareText } from "./compare-text.js";

export function buildDeltaReport(config: ConvergeConfig): DeltaReport {
  const results: TargetResult[] = [];

  for (const target of config.targets) {
    try {
      const baselineContent = readFileSync(target.baselinePath, "utf-8");
      const actualContent = readFileSync(target.actualPath, "utf-8");

      let score: number;
      let details: string;

      if (target.comparisonMethod === "json-deep-equal") {
        const baseline = JSON.parse(baselineContent);
        const actual = JSON.parse(actualContent);
        const result = compareJson(baseline, actual, target.options);
        score = result.score;
        details = result.details;
      } else if (target.comparisonMethod === "text-diff") {
        const result = compareText(baselineContent, actualContent, target.options);
        score = result.score;
        details = result.details;
      } else {
        score = 0;
        details = `Unknown comparison method: ${target.comparisonMethod}`;
      }

      results.push({
        id: target.id,
        name: target.name,
        score,
        threshold: target.tolerance,
        passed: score >= target.tolerance,
        diff: { type: target.comparisonMethod, details },
      });
    } catch (err) {
      results.push({
        id: target.id,
        name: target.name,
        score: 0,
        threshold: target.tolerance,
        passed: false,
        diff: {
          type: target.comparisonMethod,
          details: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }

  const passing = results.filter((r) => r.passed).length;
  return {
    timestamp: new Date().toISOString(),
    totalTargets: results.length,
    passing,
    failing: results.length - passing,
    targets: results,
  };
}

import { readFileSync } from "node:fs";
import type { ConvergeConfig, Target, ComparisonMethod } from "../types.js";
import { buildDeltaReport } from "./delta-report.js";
import { parseConvergeConfig } from "./converge-config.js";

export function loadConfig(configPath: string): ConvergeConfig {
  const raw = readFileSync(configPath, "utf-8");
  return parseConvergeConfig(raw);
}

export function runHarness(configPath: string) {
  const config = loadConfig(configPath);
  return buildDeltaReport(config);
}

import type { DeltaReport } from "../types.js";

export function aggregateScore(report: DeltaReport): number {
  if (report.targets.length === 0) return 1.0;
  const sum = report.targets.reduce((acc, t) => acc + t.score, 0);
  return Math.round((sum / report.targets.length) * 1000) / 1000;
}

export function passingCount(report: DeltaReport): number {
  return report.targets.filter((t) => t.passed).length;
}

export function convergenceRate(
  priorFailing: number,
  currentFailing: number
): number {
  if (priorFailing === 0) return 0;
  return (priorFailing - currentFailing) / priorFailing;
}

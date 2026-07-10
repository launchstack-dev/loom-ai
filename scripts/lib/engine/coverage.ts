/**
 * Spec→coverage matrix + goal-backward verification (roadmap C-08, CT6 A3 +
 * GSD goal-backward lens).
 *
 * `.plan-execution/coverage-matrix.toon` maps every requirement — plan
 * acceptance criteria AND phase promises (what the phase said it would
 * deliver, `.plan-execution/phase-promise.toon`) — to its coverage status.
 * The convergence step-recorder treats every `uncovered` row as blocking:
 * "all tasks completed" cannot converge past an unwired promise. Each gap
 * gets ONE bounded fix per iteration (never an unbounded loop).
 *
 * Schemas: protocols/coverage-matrix.schema.md, protocols/phase-promise.schema.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToonArray } from "../../../hooks/lib/toon-reader.js";

export type CoverageStatus = "covered" | "partial" | "uncovered";

export interface CoverageRow {
  requirementId: string;
  requirementText: string;
  /** criteria (plan acceptance criteria) | phase-promise (goal-backward). */
  source: "criteria" | "phase-promise";
  coverageStatus: CoverageStatus;
  testRefs: string[];
}

export const COVERAGE_MATRIX_FILE = "coverage-matrix.toon";

export function coverageMatrixPath(planExecDir: string): string {
  return path.join(planExecDir, COVERAGE_MATRIX_FILE);
}

/** Read the matrix. Missing file → [] (the matrix is opt-in until criteria mode emits it). */
export function readCoverageMatrix(planExecDir: string): CoverageRow[] {
  const p = coverageMatrixPath(planExecDir);
  if (!fs.existsSync(p)) return [];
  try {
    const content = fs.readFileSync(p, "utf-8");
    return parseToonArray(content, "matrix").map((r) => ({
      requirementId: String(r["requirementId"] ?? ""),
      requirementText: String(r["requirementText"] ?? ""),
      source: (String(r["source"] ?? "criteria") as CoverageRow["source"]),
      coverageStatus: (String(r["coverageStatus"] ?? "uncovered") as CoverageStatus),
      testRefs: String(r["testRefs"] ?? "")
        .split(";")
        .filter(Boolean),
    }));
  } catch {
    return [];
  }
}

/** Gaps = rows that are not fully covered. Every gap is a blocking condition. */
export function uncoveredGaps(matrix: CoverageRow[]): CoverageRow[] {
  return matrix.filter((r) => r.coverageStatus !== "covered");
}

/** Render the matrix in schema shape (atomic write is the caller's job). */
export function renderCoverageMatrix(rows: CoverageRow[], generatedAt: string): string {
  return [
    `schemaVersion: 1`,
    `generatedAt: ${generatedAt}`,
    ``,
    `matrix[${rows.length}]{requirementId,requirementText,source,coverageStatus,testRefs}:`,
    ...rows.map(
      (r) =>
        `  ${r.requirementId},${r.requirementText.replace(/,/g, ";")},${r.source},${r.coverageStatus},${r.testRefs.join(";")}`
    ),
    ``,
  ].join("\n");
}

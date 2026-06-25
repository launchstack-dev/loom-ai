/**
 * Synthetic "symptom still reproduces" finding-row helper for F-03 (debug)
 * convergence harness.
 *
 * Contract:    `protocols/findings.applications-rows.md` § F-03 OQ-01.
 * Schema:      `protocols/findings.schema.md` (ConvergenceFindings v1).
 *
 * The debug-harness re-runs the symptom after invoking the investigator. If
 * the symptom still reproduces (the re-run exits non-zero), the harness
 * appends a single synthetic row to the findings:
 *
 *   id:              F-99
 *   severity:        blocking
 *   locationPath:    <symptom path supplied via --symptom>
 *   locationAnchor:  ":0"
 *   summary:         "symptom still reproduces"
 *   suggestion:      (empty)
 *   reviewerAgent:   "debug-harness"
 *
 * Per OQ-01, this synthetic-row workaround REPLACES a proposed extra outcome
 * field on `convergence-summary.schema.md`. The convergence-summary schema is
 * NOT extended (see findings.applications-rows.md § F-03 for the OQ-01 trail).
 *
 * This module is PURE — no `fs`, no `Date.now()`. The harness owns I/O.
 */

import type { ConvergenceFinding } from "../aggregate-findings.js";

/**
 * Fixed row contract per `findings.applications-rows.md` § F-03.
 * Values are locked — any change requires updating that companion contract.
 */
export const SYNTHETIC_SYMPTOM_ROW = {
  id: "F-99",
  severity: "blocking" as const,
  locationAnchor: ":0",
  summary: "symptom still reproduces",
  reviewerAgent: "debug-harness",
} as const;

/**
 * The dimension token used for the synthetic row. Per
 * `findings.applications-rows.md` § "Canonical row shape", applications that
 * do not produce a meaningful dimension MAY set it to a stable per-application
 * token. F-03 uses `debug`.
 */
export const F03_DIMENSION = "debug";

/**
 * Build the synthetic symptom-still-reproduces finding row. Caller supplies
 * the `--symptom` path. The row's other fields are constant.
 *
 * The return type uses `ConvergenceFinding` from the aggregator module so the
 * synthetic row composes cleanly into the same `findings[]` array.
 */
export function buildSyntheticSymptomRow(
  symptomPath: string,
): ConvergenceFinding {
  if (!symptomPath || typeof symptomPath !== "string") {
    throw new Error(
      "buildSyntheticSymptomRow: symptomPath is required and must be a non-empty string",
    );
  }
  return {
    id: SYNTHETIC_SYMPTOM_ROW.id,
    // F-03 dimension token (not one of the 6 plan-review dimensions). Cast
    // through unknown because the locked `ReviewerDimension` enum is closed
    // around plan-review reviewers; the debug application owns a different
    // dimension namespace per the applications-rows companion contract.
    dimension: F03_DIMENSION as unknown as ConvergenceFinding["dimension"],
    severity: SYNTHETIC_SYMPTOM_ROW.severity,
    locationPath: symptomPath,
    locationAnchor: SYNTHETIC_SYMPTOM_ROW.locationAnchor,
    summary: SYNTHETIC_SYMPTOM_ROW.summary,
    // suggestion intentionally omitted (empty per OQ-01 contract).
    reviewerAgent:
      SYNTHETIC_SYMPTOM_ROW.reviewerAgent as unknown as ConvergenceFinding["reviewerAgent"],
  };
}

/**
 * Predicate: does the given finding match the synthetic-symptom row shape?
 *
 * Used by tests and by the harness to verify presence/absence of the row
 * across iterations.
 */
export function isSyntheticSymptomRow(
  finding: Pick<ConvergenceFinding, "summary" | "reviewerAgent" | "severity">,
): boolean {
  return (
    finding.summary === SYNTHETIC_SYMPTOM_ROW.summary &&
    (finding.reviewerAgent as unknown as string) ===
      SYNTHETIC_SYMPTOM_ROW.reviewerAgent &&
    finding.severity === SYNTHETIC_SYMPTOM_ROW.severity
  );
}

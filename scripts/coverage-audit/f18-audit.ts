#!/usr/bin/env bun
/**
 * scripts/coverage-audit/f18-audit.ts
 *
 * Coverage audit validator for F-18 sub-items.
 *
 * Usage:
 *   bun run scripts/coverage-audit/f18-audit.ts --validate <path-to-coverage.toon>
 *
 * Exit codes:
 *   0 — all rows pass validation
 *   1 — one or more validation errors found
 *
 * Validation rules:
 *   1. Every row has either a non-empty convergenceTargetRefs[] OR a
 *      noTestRationale beginning with "no-test:".
 *   2. Sub-items sub-4, sub-16, sub-17, sub-20 MUST NOT carry a
 *      noTestRationale beginning with "no-test:". These were promoted from
 *      no-test per interpretation-review IC-001.
 *   3. All 23 expected sub-items must appear.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Sub-items that MUST resolve to a real convergence target (no no-test: allowed). */
export const PROMOTED_SUB_ITEMS = ["sub-4", "sub-16", "sub-17", "sub-20"] as const;

/** All 23 expected F-18 sub-item ids. */
export const EXPECTED_SUB_ITEMS = [
  "sub-1",
  "sub-2",
  "sub-3",
  "sub-4",
  "sub-4b",
  "sub-4c",
  "sub-5",
  "sub-6",
  "sub-7",
  "sub-8",
  "sub-9",
  "sub-9b",
  "sub-10",
  "sub-11",
  "sub-12",
  "sub-13",
  "sub-14",
  "sub-15",
  "sub-16",
  "sub-17",
  "sub-18",
  "sub-20",
  "sub-21",
] as const;

export interface CoverageRow {
  subItemId: string;
  summary: string;
  convergenceTargetRefs: string[];
  noTestRationale: string;
  tier: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  rows: CoverageRow[];
}

/**
 * Parse the TOON coverage manifest into structured rows.
 *
 * The rows table uses the format:
 *   rows[N]{subItemId,summary,convergenceTargetRefs[],noTestRationale,tier}:
 *     sub-1,Summary text,C-01+C-02,,unit+qa-review
 *
 * convergenceTargetRefs is a '+'-delimited list of C-NN ids; empty string means none.
 */
export function parseCoverageToon(content: string): CoverageRow[] {
  const rows: CoverageRow[] = [];

  // Find the rows table block
  const tableMatch = content.match(
    /^rows\[\d+\]\{subItemId,summary,convergenceTargetRefs\[\],noTestRationale,tier\}:\s*\n((?:  .+\n?)*)/m
  );

  if (!tableMatch) {
    throw new Error(
      'Could not find rows table with header "rows[N]{subItemId,summary,convergenceTargetRefs[],noTestRationale,tier}:"'
    );
  }

  const tableBody = tableMatch[1];
  const lines = tableBody.split("\n").filter((l) => l.trim().length > 0);

  for (const line of lines) {
    // Strip leading 2-space indent
    const trimmed = line.startsWith("  ") ? line.slice(2) : line;

    // Split on comma but we have exactly 5 fields:
    // subItemId, summary (may contain commas), convergenceTargetRefs, noTestRationale, tier
    // We parse from left (1 field) and right (3 fields), leaving summary as the middle.
    const parts = trimmed.split(",");

    if (parts.length < 5) {
      throw new Error(`Coverage row has too few fields (expected ≥5): "${trimmed}"`);
    }

    const subItemId = parts[0].trim();
    const tier = parts[parts.length - 1].trim();
    const noTestRationale = parts[parts.length - 2].trim();
    const convergenceTargetRefsRaw = parts[parts.length - 3].trim();
    const summary = parts.slice(1, parts.length - 3).join(",").trim();

    const convergenceTargetRefs =
      convergenceTargetRefsRaw.length > 0
        ? convergenceTargetRefsRaw.split("+").map((s) => s.trim()).filter(Boolean)
        : [];

    rows.push({
      subItemId,
      summary,
      convergenceTargetRefs,
      noTestRationale,
      tier,
    });
  }

  return rows;
}

/**
 * Validate the coverage manifest against F-18 rules.
 */
export function validateCoverage(rows: CoverageRow[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const foundSubItems = new Set(rows.map((r) => r.subItemId));

  // Rule 1: All expected sub-items must appear
  for (const expected of EXPECTED_SUB_ITEMS) {
    if (!foundSubItems.has(expected)) {
      errors.push(`Missing sub-item: ${expected} is not present in the coverage manifest`);
    }
  }

  // Rule 2: Every row must have coverage (convergenceTargetRefs OR no-test: rationale)
  for (const row of rows) {
    const hasTargets = row.convergenceTargetRefs.length > 0;
    const hasNoTest = row.noTestRationale.startsWith("no-test:");

    if (!hasTargets && !hasNoTest) {
      errors.push(
        `${row.subItemId}: row has neither convergenceTargetRefs[] nor a noTestRationale beginning with "no-test:"`
      );
    }
  }

  // Rule 3: Promoted sub-items (sub-4, sub-16, sub-17, sub-20) MUST NOT carry no-test:
  for (const row of rows) {
    if (
      (PROMOTED_SUB_ITEMS as readonly string[]).includes(row.subItemId) &&
      row.noTestRationale.startsWith("no-test:")
    ) {
      errors.push(
        `${row.subItemId}: promoted sub-item MUST NOT carry a noTestRationale beginning with "no-test:" — it must resolve to a real convergence target`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    rows,
  };
}

/** Main entry point: --validate <path> */
function main() {
  const args = process.argv.slice(2);
  const validateIdx = args.indexOf("--validate");

  if (validateIdx === -1 || !args[validateIdx + 1]) {
    console.error("Usage: bun run scripts/coverage-audit/f18-audit.ts --validate <path>");
    process.exit(1);
  }

  const manifestPath = resolve(args[validateIdx + 1]);

  if (!existsSync(manifestPath)) {
    console.error(`Error: manifest not found at ${manifestPath}`);
    process.exit(1);
  }

  const content = readFileSync(manifestPath, "utf-8");

  let rows: CoverageRow[];
  try {
    rows = parseCoverageToon(content);
  } catch (err) {
    console.error(`Parse error: ${(err as Error).message}`);
    process.exit(1);
  }

  const result = validateCoverage(rows);

  if (result.valid) {
    console.log(
      `ok: ${rows.length} sub-items validated — all have convergence targets or explicit no-test: rationale`
    );
    process.exit(0);
  } else {
    for (const error of result.errors) {
      console.error(`FAIL: ${error}`);
    }
    for (const warning of result.warnings) {
      console.warn(`WARN: ${warning}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

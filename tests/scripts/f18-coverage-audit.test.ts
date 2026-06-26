/**
 * tests/scripts/f18-coverage-audit.test.ts
 *
 * S-01: Every F-18 sub-item appears in the coverage audit.
 * S-02: Coverage-gap sub-items (sub-4, sub-16, sub-17, sub-20) resolve to
 *       real convergence targets (MUST NOT carry no-test:).
 *
 * Run: bunx vitest run tests/scripts/f18-coverage-audit.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseCoverageToon,
  validateCoverage,
  EXPECTED_SUB_ITEMS,
  PROMOTED_SUB_ITEMS,
} from "../../scripts/coverage-audit/f18-audit";

const MANIFEST_PATH = resolve(
  __dirname,
  "../../planning/history/coverage/F-18-coverage.toon"
);

describe("F-18 coverage audit — S-01: all sub-items present", () => {
  it("manifest file exists and is parseable", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    const rows = parseCoverageToon(content);
    expect(rows.length).toBe(23);
  });

  it("every expected sub-item appears as a row", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    const rows = parseCoverageToon(content);
    const foundIds = new Set(rows.map((r) => r.subItemId));

    for (const expected of EXPECTED_SUB_ITEMS) {
      expect(foundIds.has(expected), `sub-item ${expected} must appear in coverage manifest`).toBe(
        true
      );
    }
  });

  it("every row has either convergenceTargetRefs[] or a no-test: rationale", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    const rows = parseCoverageToon(content);

    for (const row of rows) {
      const hasTargets = row.convergenceTargetRefs.length > 0;
      const hasNoTest = row.noTestRationale.startsWith("no-test:");
      expect(
        hasTargets || hasNoTest,
        `${row.subItemId}: must have convergenceTargetRefs[] or noTestRationale beginning with "no-test:"`
      ).toBe(true);
    }
  });

  it("validateCoverage returns valid:true for the manifest", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    const rows = parseCoverageToon(content);
    const result = validateCoverage(rows);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("F-18 coverage audit — S-02: promoted sub-items resolve to real targets", () => {
  it("sub-4, sub-16, sub-17, sub-20 all have non-empty convergenceTargetRefs[]", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    const rows = parseCoverageToon(content);
    const rowMap = new Map(rows.map((r) => [r.subItemId, r]));

    for (const promotedId of PROMOTED_SUB_ITEMS) {
      const row = rowMap.get(promotedId);
      expect(row, `${promotedId} must exist in the manifest`).toBeDefined();
      expect(
        row!.convergenceTargetRefs.length,
        `${promotedId} must have at least one convergenceTargetRefs[] entry`
      ).toBeGreaterThan(0);
    }
  });

  it("sub-4, sub-16, sub-17, sub-20 do NOT carry no-test: rationale", () => {
    const content = readFileSync(MANIFEST_PATH, "utf-8");
    const rows = parseCoverageToon(content);
    const rowMap = new Map(rows.map((r) => [r.subItemId, r]));

    for (const promotedId of PROMOTED_SUB_ITEMS) {
      const row = rowMap.get(promotedId);
      expect(row, `${promotedId} must exist in the manifest`).toBeDefined();
      expect(
        row!.noTestRationale.startsWith("no-test:"),
        `${promotedId} MUST NOT carry a noTestRationale beginning with "no-test:" — it was promoted to a real convergence target`
      ).toBe(false);
    }
  });
});

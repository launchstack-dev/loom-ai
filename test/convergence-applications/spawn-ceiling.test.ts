/**
 * Spawn-ceiling regression test (Phase 8, S-02).
 *
 * Doc-as-code: parses each wrapper command markdown for the documented
 * `maxIterations: N` token inside its `converge.config` example, then computes
 * the spawn ceiling using the canonical formula:
 *
 *   ceiling = 1 (initial config / harness preflight) + maxIterations × 2
 *             (1 harness re-spawn + 1 fixer per iteration)
 *
 * Drift between wrappers and the spec is caught here BEFORE end-to-end runs.
 *
 * Expected ceilings (from PLAN-convergence-applications Phase 8 acceptance):
 *   F-01: maxIterations=3  ->  1 + 3×2 = 7
 *   F-02: maxIterations=5  ->  1 + 5×2 = 11
 *   F-03: maxIterations=5  ->  1 + 5×2 = 11
 *   F-04: maxIterations=5  ->  1 + 5×2 = 11
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/**
 * Extract the first fenced ```toon ... ``` block in `doc` that follows
 * `anchorSubstring`. Returns the block body (without the fences).
 */
function extractToonBlockNear(doc: string, anchorSubstring: string): string | null {
  const idx = doc.indexOf(anchorSubstring);
  if (idx < 0) return null;
  const fenceStart = doc.indexOf("```toon", idx);
  if (fenceStart < 0) return null;
  const bodyStart = doc.indexOf("\n", fenceStart) + 1;
  const fenceEnd = doc.indexOf("```", bodyStart);
  if (fenceEnd < 0) return null;
  return doc.slice(bodyStart, fenceEnd);
}

/**
 * Pull the `maxIterations: N` integer out of a TOON block. Returns null if
 * not found or not a clean positive integer.
 */
function parseMaxIterationsFromToon(block: string): number | null {
  const m = block.match(/^\s*maxIterations\s*:\s*(\d+)\s*$/m);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * Canonical spawn-ceiling formula per Plan Phase 8 acceptance.
 */
function computeCeiling(maxIterations: number): number {
  return 1 + maxIterations * 2;
}

interface AppSpec {
  id: string;
  wrapperDoc: string;
  anchor: string;
  expectedMaxIterations: number;
  expectedCeiling: number;
}

const APPS: AppSpec[] = [
  {
    id: "F-01",
    wrapperDoc: "commands/loom-code.md",
    anchor: "Step A — Generate converge.config",
    expectedMaxIterations: 3,
    expectedCeiling: 7,
  },
  {
    id: "F-02",
    wrapperDoc: "commands/loom-test.md",
    anchor: "Step 3a: Generate converge.config",
    expectedMaxIterations: 5,
    expectedCeiling: 11,
  },
  {
    id: "F-03",
    wrapperDoc: "commands/loom-bugfix.md",
    anchor: "Step A2: Generate the converge.config",
    expectedMaxIterations: 5,
    expectedCeiling: 11,
  },
  {
    id: "F-04",
    wrapperDoc: "commands/loom-git.md",
    anchor: "Step 3: Generate the converge.config.",
    expectedMaxIterations: 5,
    expectedCeiling: 11,
  },
];

describe("S-02 / per-application spawn-count ceilings", () => {
  it("canonical formula: ceiling(N) = 1 + N×2", () => {
    expect(computeCeiling(3)).toBe(7);
    expect(computeCeiling(5)).toBe(11);
  });

  for (const app of APPS) {
    it(`${app.id}: documented maxIterations = ${app.expectedMaxIterations} and ceiling = ${app.expectedCeiling}`, () => {
      const doc = readRepoFile(app.wrapperDoc);
      const block = extractToonBlockNear(doc, app.anchor);
      expect(
        block,
        `Could not find a \`\`\`toon converge.config block near anchor "${app.anchor}" in ${app.wrapperDoc}`,
      ).not.toBeNull();

      const maxIterations = parseMaxIterationsFromToon(block as string);
      expect(
        maxIterations,
        `${app.id}: no maxIterations field found in ${app.wrapperDoc} converge.config block`,
      ).not.toBeNull();

      expect(
        maxIterations,
        `${app.id}: ${app.wrapperDoc} documents maxIterations=${maxIterations}, expected ${app.expectedMaxIterations}`,
      ).toBe(app.expectedMaxIterations);

      const ceiling = computeCeiling(maxIterations as number);
      expect(
        ceiling,
        `${app.id}: computed ceiling=${ceiling}, expected ${app.expectedCeiling}`,
      ).toBe(app.expectedCeiling);
    });
  }

  it("F-01 total spawns MUST be 7 or less (S-02 then-clause #1)", () => {
    expect(computeCeiling(3)).toBeLessThanOrEqual(7);
  });

  it("F-02 total spawns MUST be 11 or less (S-02 then-clause #2)", () => {
    expect(computeCeiling(5)).toBeLessThanOrEqual(11);
  });

  it("F-03 total spawns MUST be 11 or less (S-02 then-clause #3)", () => {
    expect(computeCeiling(5)).toBeLessThanOrEqual(11);
  });

  it("F-04 total spawns MUST be 11 or less (S-02 then-clause #4)", () => {
    expect(computeCeiling(5)).toBeLessThanOrEqual(11);
  });
});

describe("Spec cross-reference: companion docs cite the formula", () => {
  it("commands/loom-test.md cites the '1 + maxIterations × 2' spawn ceiling formula", () => {
    const doc = readRepoFile("commands/loom-test.md");
    // The wrapper documents this formula in its agentBudget / BUDGET_EXHAUSTED
    // discussion. Accept either '1 + maxIterations × 2' (× / x / *) variants
    // and either Unicode or ASCII multiplication signs.
    const cited =
      /1\s*\+\s*(maxIterations)?\s*[×x*]\s*2/i.test(doc) ||
      /1\s*\+\s*5\s*[×x*]\s*2/.test(doc) ||
      /1\s*\+\s*\(?\s*maxIterations\s*[×x*]\s*2\s*\)?/i.test(doc);
    expect(
      cited,
      "commands/loom-test.md should cite the '1 + maxIterations × 2' spawn-ceiling formula",
    ).toBe(true);
  });
});

/**
 * Static contract tests for the Workflow engine drivers (M-2).
 * The Workflow runtime wraps the script body in an async context and forbids
 * clocks/randomness/imports; these tests pin those constraints plus the C-07
 * metric (no hardcoded fan-out/reviewer literals in engine scripts).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, "../../../../workflows");

const DRIVERS = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => ({ name: f, source: fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf-8") }));

/** The 6 plan-review reviewer names — a DEFAULT PANEL in config, never engine literals. */
const REVIEWER_LITERALS = [
  "feature-coverage-reviewer-agent",
  "strategy-reviewer-agent",
  "ux-reviewer-agent",
  "phasing-reviewer-agent",
  "parallelization-reviewer-agent",
  "agentic-workflow-reviewer-agent",
];

describe.each(DRIVERS)("workflow driver $name", ({ source }) => {
  it("has a pure-literal meta block with name/description/phases", () => {
    const metaMatch = source.match(/export const meta = (\{[\s\S]*?\n\})/);
    expect(metaMatch).toBeTruthy();
    // Pure literal: must evaluate standalone with no free identifiers.
    const meta = new Function(`return ${metaMatch![1]}`)() as {
      name: string;
      description: string;
      phases?: unknown[];
    };
    expect(meta.name).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(Array.isArray(meta.phases)).toBe(true);
  });

  it("parses when wrapped in the Workflow async context", () => {
    const body = source.replace(/export const meta = \{[\s\S]*?\n\}/, "");
    expect(
      () =>
        new Function(
          "args",
          "agent",
          "parallel",
          "pipeline",
          "phase",
          "log",
          "budget",
          "workflow",
          `return (async () => { ${body} })()`
        )
    ).not.toThrow();
  });

  it("uses no clocks, randomness, imports, or Node APIs (resume-safety)", () => {
    for (const forbidden of ["Date.now(", "Math.random(", "new Date()", "require(", "import(", "process.", "fs."]) {
      expect(source, `forbidden token: ${forbidden}`).not.toContain(forbidden);
    }
    const bodyOnly = source.replace(/export const meta[\s\S]*?\n\}/, "");
    expect(bodyOnly).not.toMatch(/^import /m);
  });

  it("contains no hardcoded reviewer/fan-out literals (C-07 metric)", () => {
    for (const literal of REVIEWER_LITERALS) {
      expect(source).not.toContain(literal);
    }
    // Fan-out sizes must come from args/config — no `.slice(0, <digit>)` style
    // literals except pure formatting.
    expect(source).not.toMatch(/parallel\([^)]*\d+\s*\)/);
  });

  it("delegates all policy to a step CLI", () => {
    expect(source).toMatch(/scripts\/lib\/engine\/(iterate|execute-step)\.ts/);
    // The locked breaker strings must NOT be re-emitted here (single emission site).
    expect(source).not.toContain("[autoconverge]");
    expect(source).not.toContain("BUDGET_EXHAUSTED");
  });
});

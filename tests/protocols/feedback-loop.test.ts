/**
 * Phase 0: protocols/feedback-loop.schema.md schema-parse smoke test —
 * every field documented in the plan's FeedbackLoop schema appears in the
 * protocol's field-schema table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(__dirname, "../../protocols/feedback-loop.schema.md");

const REQUIRED_FIELDS = [
  "loopId",
  "command",
  "symptom",
  "rung",
  "verifiedRed",
  "redOutput",
  "runtimeMs",
  "determinismRuns",
  "retiredAt",
  "parentLoopId",
  "escapeReason",
  "trda",
  "escalationHistory",
  "linkedLoops",
];

describe("protocols/feedback-loop.schema.md", () => {
  const content = readFileSync(DOC_PATH, "utf8");

  it("documents every FeedbackLoop field", () => {
    for (const field of REQUIRED_FIELDS) {
      const bare = "`" + field + "`";
      const arr = "`" + field + "[]`";
      expect(content.includes(bare) || content.includes(arr)).toBe(true);
    }
  });

  it("documents all four TRDA bits", () => {
    for (const bit of ["tight", "redCapable", "deterministic", "agentRunnable"]) {
      expect(content.includes("`" + bit + "`")).toBe(true);
    }
  });

  it("includes a Retirement Ceremony subsection", () => {
    expect(content).toMatch(/##\s+Retirement Ceremony/);
  });

  it("documents the loopId UUID v4 regex constraint", () => {
    expect(content).toMatch(/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/);
  });

  it("documents cascade behaviour for parentLoopId", () => {
    expect(content).toMatch(/parentLoopId/);
    expect(content).toMatch(/SET NULL/);
    expect(content).toMatch(/CASCADE/);
  });
});

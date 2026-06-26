/**
 * Phase 0: protocols/out-of-scope.schema.md schema-parse smoke test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(__dirname, "../../protocols/out-of-scope.schema.md");

const REQUIRED_FIELDS = [
  "id",
  "idea",
  "rejectedAt",
  "rejectedBy",
  "rationale",
  "sourceProposalId",
];

describe("protocols/out-of-scope.schema.md", () => {
  const content = readFileSync(DOC_PATH, "utf8");

  it("documents every OutOfScopeEntry field", () => {
    for (const field of REQUIRED_FIELDS) {
      expect(content.includes("`" + field + "`")).toBe(true);
    }
  });

  it("documents the OOS-{NN} id regex", () => {
    expect(content).toMatch(/\^OOS-\\d\{2,\}\$/);
  });

  it("documents the human|agent rejectedBy enum", () => {
    expect(content).toMatch(/`human`/);
    expect(content).toMatch(/`agent`/);
  });

  it("includes an Indexes section with pk_oos and idx_oos_source", () => {
    expect(content).toMatch(/pk_oos/);
    expect(content).toMatch(/idx_oos_source/);
  });

  it("states the immutability rule", () => {
    expect(content.toLowerCase()).toMatch(/immutable/);
  });
});

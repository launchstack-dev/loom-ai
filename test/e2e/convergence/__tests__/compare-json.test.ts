import { describe, it, expect } from "vitest";
import { compareJson } from "../src/lib/compare-json.js";

describe("compareJson", () => {
  it("returns 1.0 for identical objects", () => {
    const obj = { a: 1, b: "hello", c: true };
    expect(compareJson(obj, obj).score).toBe(1.0);
  });

  it("returns 1.0 for identical nested objects", () => {
    const obj = { a: { b: { c: 42 } }, d: [1, 2, 3] };
    expect(compareJson(obj, obj).score).toBe(1.0);
  });

  it("scores missing fields proportionally", () => {
    const baseline = { a: 1, b: 2, c: 3 };
    const actual = { a: 1, b: 2 };
    const result = compareJson(baseline, actual);
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.details).toContain("c:");
  });

  it("scores extra fields as mismatches", () => {
    const baseline = { a: 1 };
    const actual = { a: 1, b: 2 };
    const result = compareJson(baseline, actual);
    expect(result.score).toBeLessThan(1.0);
  });

  it("returns 0.0 for type mismatches on all fields", () => {
    const baseline = { a: "string", b: "other" };
    const actual = { a: 42, b: true };
    expect(compareJson(baseline, actual).score).toBe(0);
  });

  it("handles nested object diffs recursively", () => {
    const baseline = { a: { b: 1, c: 2 } };
    const actual = { a: { b: 1, c: 999 } };
    const result = compareJson(baseline, actual);
    expect(result.score).toBe(0.5);
    expect(result.details).toContain("a.c");
  });

  it("handles array comparisons element-by-element", () => {
    const baseline = { arr: [1, 2, 3] };
    const actual = { arr: [1, 2, 99] };
    const result = compareJson(baseline, actual);
    expect(result.score).toBeCloseTo(0.667, 2);
  });

  it("respects ignoreFields option", () => {
    const baseline = { id: 1, name: "Alice", timestamp: "2025-01-01" };
    const actual = { id: 1, name: "Alice", timestamp: "2026-04-07" };
    const result = compareJson(baseline, actual, { ignoreFields: ["timestamp"] });
    expect(result.score).toBe(1.0);
  });

  it("respects numericTolerance option", () => {
    const baseline = { val: 0.3 };
    const actual = { val: 0.30000000000000004 };
    const result = compareJson(baseline, actual, { numericTolerance: 0.001 });
    expect(result.score).toBe(1.0);
  });

  it("returns 0.0 for completely different structures", () => {
    const baseline = { a: 1, b: 2, c: 3 };
    const actual = { x: 10, y: 20, z: 30 };
    const result = compareJson(baseline, actual);
    expect(result.score).toBe(0);
  });

  it("handles null and undefined values", () => {
    const baseline = { a: null, b: 1 };
    const actual = { a: null, b: 1 };
    expect(compareJson(baseline, actual).score).toBe(1.0);
  });

  it("handles empty objects", () => {
    expect(compareJson({}, {}).score).toBe(1.0);
  });

  it("scores the api-users fixture progression correctly", () => {
    const target = {
      users: [
        { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
        { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
      ],
      pagination: { page: 1, totalPages: 1, totalItems: 2 },
    };
    const v0 = { users: [{ id: 1, name: "Alice" }] };
    const v1 = {
      users: [
        { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
        { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
      ],
    };

    const s0 = compareJson(target, v0).score;
    const s1 = compareJson(target, v1).score;
    const s2 = compareJson(target, target).score;

    expect(s0).toBeLessThan(s1);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBe(1.0);
  });
});

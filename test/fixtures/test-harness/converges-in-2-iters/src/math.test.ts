// F-02 fixture: 3 failing tests on the buggy `add` implementation in
// ./math.ts. After the fixer-agent flips `a - b` to `a + b`, all 3 pass.

import { describe, it, expect } from "bun:test";
import { add, double } from "./math";

describe("add", () => {
  it("adds two positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("adds a positive and a negative", () => {
    expect(add(10, -4)).toBe(6);
  });

  it("returns its argument when adding zero", () => {
    expect(add(7, 0)).toBe(7);
  });
});

describe("double", () => {
  it("doubles a positive number", () => {
    expect(double(4)).toBe(8);
  });
});

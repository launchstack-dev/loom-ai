import { describe, it, expect } from "vitest";
import { compareText } from "../src/lib/compare-text.js";

describe("compareText", () => {
  it("returns 1.0 for identical text", () => {
    expect(compareText("hello", "hello").score).toBe(1.0);
  });

  it("returns 1.0 for identical multi-line text", () => {
    const text = "line 1\nline 2\nline 3";
    expect(compareText(text, text).score).toBe(1.0);
  });

  it("scores missing lines proportionally", () => {
    const baseline = "line 1\nline 2\nline 3\nline 4";
    const actual = "line 1\nline 2\nline 3";
    const result = compareText(baseline, actual);
    expect(result.score).toBe(0.75);
  });

  it("scores extra lines proportionally", () => {
    const baseline = "line 1\nline 2";
    const actual = "line 1\nline 2\nextra";
    const result = compareText(baseline, actual);
    expect(result.score).toBeCloseTo(0.667, 2);
  });

  it("returns 0.0 for completely different text", () => {
    const baseline = "aaa\nbbb\nccc";
    const actual = "xxx\nyyy\nzzz";
    expect(compareText(baseline, actual).score).toBe(0);
  });

  it("handles whitespace with ignoreWhitespace option", () => {
    const baseline = "hello  ";
    const actual = "hello";
    expect(compareText(baseline, actual, { ignoreWhitespace: true }).score).toBe(1.0);
  });

  it("handles blank lines with ignoreBlankLines option", () => {
    const baseline = "line 1\n\nline 2";
    const actual = "line 1\nline 2";
    expect(compareText(baseline, actual, { ignoreBlankLines: true }).score).toBe(1.0);
  });

  it("handles empty actual", () => {
    const result = compareText("hello\nworld", "");
    expect(result.score).toBe(0);
  });

  it("handles both empty", () => {
    expect(compareText("", "").score).toBe(1.0);
  });

  it("produces diff details listing mismatched line numbers", () => {
    const result = compareText("a\nb\nc", "a\nX\nc");
    expect(result.details).toContain("2");
    expect(result.score).toBeCloseTo(0.667, 2);
  });

  it("scores the readme fixture progression correctly", () => {
    const target = "# My Project\nA CLI calculator that supports add, subtract, multiply, divide.\nUsage: calc <left> <op> <right>";
    const v0 = "# My App\nA calculator.";
    const v1 = target;

    const s0 = compareText(target, v0).score;
    const s1 = compareText(target, v1).score;

    expect(s0).toBeLessThan(s1);
    expect(s1).toBe(1.0);
  });
});

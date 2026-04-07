import { describe, it, expect } from "vitest";
import { parseArgs, parseNumber, validateOperator, isValidOperator } from "../validation.js";

describe("isValidOperator", () => {
  it("returns true for valid operators", () => {
    expect(isValidOperator("add")).toBe(true);
    expect(isValidOperator("subtract")).toBe(true);
    expect(isValidOperator("multiply")).toBe(true);
    expect(isValidOperator("divide")).toBe(true);
  });

  it("returns false for invalid operators", () => {
    expect(isValidOperator("modulo")).toBe(false);
    expect(isValidOperator("")).toBe(false);
    expect(isValidOperator("plus")).toBe(false);
  });
});

describe("parseNumber", () => {
  it("parses valid integers", () => {
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("-7")).toBe(-7);
    expect(parseNumber("0")).toBe(0);
  });

  it("parses valid decimals", () => {
    expect(parseNumber("3.14")).toBe(3.14);
    expect(parseNumber("-0.5")).toBe(-0.5);
  });

  it("throws for non-numeric strings", () => {
    expect(() => parseNumber("foo")).toThrow(/invalid number/i);
    expect(() => parseNumber("abc")).toThrow(/invalid number/i);
  });

  it("throws for Infinity", () => {
    expect(() => parseNumber("Infinity")).toThrow(/invalid number/i);
  });

  it("throws for NaN", () => {
    expect(() => parseNumber("NaN")).toThrow(/invalid number/i);
  });
});

describe("validateOperator", () => {
  it("returns valid operator", () => {
    expect(validateOperator("add")).toBe("add");
  });

  it("throws for invalid operator", () => {
    expect(() => validateOperator("modulo")).toThrow(/invalid operator/i);
  });
});

describe("parseArgs", () => {
  it("parses valid arguments", () => {
    expect(parseArgs(["2", "add", "3"])).toEqual({
      left: 2,
      operator: "add",
      right: 3,
    });
  });

  it("throws for wrong number of arguments", () => {
    expect(() => parseArgs(["2", "add"])).toThrow(/expected 3 arguments/i);
    expect(() => parseArgs([])).toThrow(/expected 3 arguments/i);
  });

  it("throws for invalid number in left position", () => {
    expect(() => parseArgs(["foo", "add", "3"])).toThrow(/invalid number/i);
  });

  it("throws for invalid operator", () => {
    expect(() => parseArgs(["5", "modulo", "3"])).toThrow(/invalid operator/i);
  });

  it("throws for invalid number in right position", () => {
    expect(() => parseArgs(["5", "add", "bar"])).toThrow(/invalid number/i);
  });
});

import { describe, it, expect } from "vitest";
import { parseArgs, calculate } from "../index.js";
import type { CalculatorInput } from "../types.js";

describe("parseArgs", () => {
  it("parses valid arguments with word operator", () => {
    const result = parseArgs(["2", "add", "3"]);
    expect(result).toEqual({ left: 2, operator: "add", right: 3 });
  });

  it("parses valid arguments with symbol operator", () => {
    const result = parseArgs(["10", "/", "5"]);
    expect(result).toEqual({ left: 10, operator: "divide", right: 5 });
  });

  it("normalizes symbol operators to word form", () => {
    expect(parseArgs(["1", "+", "2"]).operator).toBe("add");
    expect(parseArgs(["1", "-", "2"]).operator).toBe("subtract");
    expect(parseArgs(["1", "*", "2"]).operator).toBe("multiply");
    expect(parseArgs(["1", "/", "2"]).operator).toBe("divide");
  });

  it("throws on non-numeric left operand", () => {
    expect(() => parseArgs(["foo", "add", "3"])).toThrow('Invalid number: "foo"');
  });

  it("throws on non-numeric right operand", () => {
    expect(() => parseArgs(["3", "add", "bar"])).toThrow('Invalid number: "bar"');
  });

  it("throws on unsupported operator", () => {
    expect(() => parseArgs(["2", "modulo", "3"])).toThrow('Unsupported operator: "modulo"');
  });

  it("throws on wrong number of arguments", () => {
    expect(() => parseArgs(["2", "add"])).toThrow("Expected 3 arguments");
    expect(() => parseArgs([])).toThrow("Expected 3 arguments");
  });

  it("handles negative numbers", () => {
    const result = parseArgs(["-5", "add", "3"]);
    expect(result).toEqual({ left: -5, operator: "add", right: 3 });
  });

  it("handles decimal numbers", () => {
    const result = parseArgs(["1.5", "multiply", "2"]);
    expect(result).toEqual({ left: 1.5, operator: "multiply", right: 2 });
  });
});

describe("calculate", () => {
  it("adds two numbers", () => {
    const input: CalculatorInput = { left: 2, operator: "add", right: 3 };
    expect(calculate(input)).toEqual({ success: true, value: 5 });
  });

  it("subtracts two numbers", () => {
    const input: CalculatorInput = { left: 10, operator: "subtract", right: 4 };
    expect(calculate(input)).toEqual({ success: true, value: 6 });
  });

  it("multiplies two numbers", () => {
    const input: CalculatorInput = { left: 3, operator: "multiply", right: 7 };
    expect(calculate(input)).toEqual({ success: true, value: 21 });
  });

  it("divides two numbers", () => {
    const input: CalculatorInput = { left: 10, operator: "divide", right: 2 };
    expect(calculate(input)).toEqual({ success: true, value: 5 });
  });

  it("returns error on division by zero", () => {
    const input: CalculatorInput = { left: 10, operator: "divide", right: 0 };
    const result = calculate(input);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Division by zero.");
  });

  it("handles symbol operator forms", () => {
    expect(calculate({ left: 2, operator: "+", right: 3 })).toEqual({
      success: true,
      value: 5,
    });
    expect(calculate({ left: 10, operator: "-", right: 3 })).toEqual({
      success: true,
      value: 7,
    });
    expect(calculate({ left: 4, operator: "*", right: 3 })).toEqual({
      success: true,
      value: 12,
    });
    expect(calculate({ left: 8, operator: "/", right: 2 })).toEqual({
      success: true,
      value: 4,
    });
  });
});

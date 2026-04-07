import { describe, it, expect } from "vitest";
import { calculate } from "../operations.js";
import type { CalculatorInput } from "../types.js";

describe("calculate", () => {
  it("adds two numbers", () => {
    const input: CalculatorInput = { left: 2, operator: "add", right: 3 };
    expect(calculate(input)).toEqual({ success: true, value: 5, error: null });
  });

  it("subtracts two numbers", () => {
    const input: CalculatorInput = { left: 10, operator: "subtract", right: 4 };
    expect(calculate(input)).toEqual({ success: true, value: 6, error: null });
  });

  it("multiplies two numbers", () => {
    const input: CalculatorInput = { left: 5, operator: "multiply", right: 6 };
    expect(calculate(input)).toEqual({ success: true, value: 30, error: null });
  });

  it("divides two numbers", () => {
    const input: CalculatorInput = { left: 20, operator: "divide", right: 4 };
    expect(calculate(input)).toEqual({ success: true, value: 5, error: null });
  });

  it("returns error for division by zero", () => {
    const input: CalculatorInput = { left: 10, operator: "divide", right: 0 };
    const result = calculate(input);
    expect(result.success).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/division by zero/i);
  });

  it("handles negative numbers", () => {
    const input: CalculatorInput = { left: -3, operator: "add", right: -7 };
    expect(calculate(input)).toEqual({ success: true, value: -10, error: null });
  });

  it("handles decimal numbers", () => {
    const input: CalculatorInput = { left: 1.5, operator: "multiply", right: 2 };
    expect(calculate(input)).toEqual({ success: true, value: 3, error: null });
  });
});

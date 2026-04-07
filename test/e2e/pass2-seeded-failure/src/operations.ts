import type { CalculatorInput, CalculatorResult } from "./types.js";

export function calculate(input: CalculatorInput): CalculatorResult {
  const { left, operator, right } = input;

  switch (operator) {
    case "add":
      return { success: true, value: left + right, error: null };
    case "subtract":
      return { success: true, value: left - right, error: null };
    case "multiply":
      return { success: true, value: left * right, error: null };
    case "divide":
      if (right === 0) {
        return { success: false, value: null, error: "Division by zero" };
      }
      return { success: true, value: left / right, error: null };
  }
}

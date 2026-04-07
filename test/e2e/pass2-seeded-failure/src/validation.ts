import type { CalculatorInput, Operator } from "./types.js";

const VALID_OPERATORS: readonly string[] = ["add", "subtract", "multiply", "divide"];

export function isValidOperator(value: string): value is Operator {
  return VALID_OPERATORS.includes(value);
}

export function parseNumber(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number: "${value}"`);
  }
  return num;
}

export function validateOperator(value: string): Operator {
  if (!isValidOperator(value)) {
    throw new Error(
      `Invalid operator: "${value}". Valid operators are: ${VALID_OPERATORS.join(", ")}`
    );
  }
  return value;
}

export function parseArgs(args: string[]): CalculatorInput {
  if (args.length !== 3) {
    throw new Error(
      `Expected 3 arguments (left operator right), got ${args.length}`
    );
  }

  const left = parseNumber(args[0]);
  const operator = validateOperator(args[1]);
  const right = parseNumber(args[2]);

  if (operator === "divide" && right === 0) {
    throw new Error("Division by zero: right operand cannot be 0 when dividing");
  }

  return { left, operator, right };
}

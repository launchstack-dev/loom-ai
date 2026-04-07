/**
 * Supported arithmetic operators.
 * Accepts both word forms and symbol aliases.
 */
export type Operator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "+"
  | "-"
  | "*"
  | "/";

/**
 * Input to the calculator: two operands and an operator.
 */
export interface CalculatorInput {
  /** Left operand — must be a finite number (not NaN, not Infinity). */
  left: number;
  /** The arithmetic operator to apply. */
  operator: Operator;
  /** Right operand — must be a finite number (not NaN, not Infinity). */
  right: number;
}

/**
 * Result of a calculation attempt.
 * Exactly one of `value` or `error` is present depending on `success`.
 */
export interface CalculatorResult {
  /** Whether the calculation succeeded. */
  success: boolean;
  /** The numeric result (present when success === true). */
  value?: number;
  /** Error message (present when success === false). */
  error?: string;
}

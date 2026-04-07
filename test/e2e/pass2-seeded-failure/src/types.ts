export type Operator = "add" | "subtract" | "multiply" | "divide";

export interface CalculatorInput {
  left: number;
  operator: Operator;
  right: number;
}

export interface CalculatorResult {
  success: boolean;
  value: number | null;
  error: string | null;
}

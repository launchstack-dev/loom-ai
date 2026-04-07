import type { Operator, CalculatorInput, CalculatorResult } from "./types.js";

/** Map symbol aliases to their canonical word forms. */
const OPERATOR_ALIASES: Record<string, Operator> = {
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
};

const VALID_OPERATORS = new Set<string>([
  "add",
  "subtract",
  "multiply",
  "divide",
  "+",
  "-",
  "*",
  "/",
]);

/** Normalize an operator string to its canonical word form. */
function normalizeOperator(raw: string): Operator {
  return (OPERATOR_ALIASES[raw] ?? raw) as Operator;
}

/** Validate and parse CLI arguments into a CalculatorInput. */
export function parseArgs(args: string[]): CalculatorInput {
  if (args.length !== 3) {
    throw new Error(
      `Expected 3 arguments (<number> <operator> <number>), got ${args.length}.`
    );
  }

  const [leftRaw, opRaw, rightRaw] = args;

  const left = Number(leftRaw);
  if (!Number.isFinite(left)) {
    throw new Error(`Invalid number: "${leftRaw}".`);
  }

  if (!VALID_OPERATORS.has(opRaw)) {
    throw new Error(
      `Unsupported operator: "${opRaw}". Supported: add (+), subtract (-), multiply (*), divide (/).`
    );
  }

  const right = Number(rightRaw);
  if (!Number.isFinite(right)) {
    throw new Error(`Invalid number: "${rightRaw}".`);
  }

  return { left, operator: normalizeOperator(opRaw), right };
}

/** Perform the arithmetic calculation. */
export function calculate(input: CalculatorInput): CalculatorResult {
  const { left, operator, right } = input;

  switch (operator) {
    case "add":
    case "+":
      return { success: true, value: left + right };
    case "subtract":
    case "-":
      return { success: true, value: left - right };
    case "multiply":
    case "*":
      return { success: true, value: left * right };
    case "divide":
    case "/":
      if (right === 0) {
        return { success: false, error: "Division by zero." };
      }
      return { success: true, value: left / right };
    default:
      return { success: false, error: `Unknown operator: "${operator}".` };
  }
}

const HELP_TEXT = `Usage: calculator <number> <operator> <number>

Operators:
  add      (+)   Addition
  subtract (-)   Subtraction
  multiply (*)   Multiplication
  divide   (/)   Division

Examples:
  npx tsx src/index.ts 2 add 3       # prints 5
  npx tsx src/index.ts 10 divide 2   # prints 5
  npx tsx src/index.ts 4 "*" 3       # prints 12
`;

/** CLI entry point. */
function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  try {
    const input = parseArgs(args);
    const result = calculate(input);

    if (result.success) {
      process.stdout.write(`${result.value}\n`);
    } else {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

// Only run when executed directly (not when imported by tests).
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("src/index.ts");

if (isDirectRun) {
  main();
}

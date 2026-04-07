import { parseArgs } from "./validation.js";
import { calculate } from "./operations.js";

const HELP_TEXT = `Usage: bun run src/cli.ts <left> <operator> <right>

Operators:
  add        Add two numbers
  subtract   Subtract right from left
  multiply   Multiply two numbers
  divide     Divide left by right

Examples:
  bun run src/cli.ts 2 add 3
  bun run src/cli.ts 10 subtract 4
  bun run src/cli.ts 5 multiply 6
  bun run src/cli.ts 20 divide 4
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  try {
    const input = parseArgs(args);
    const result = calculate(input);

    if (result.success) {
      console.log(result.value);
      process.exit(0);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();

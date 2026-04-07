## Code Review Report

### Critical

#### [BUG] src/operations.ts:12 — Multiply uses addition instead of multiplication
> `return { success: true, value: left + right, error: null };`
**Fix**: Change `left + right` to `left * right` on line 12.
*Severity: critical*

#### [BUG] src/operations.ts:13-14 — Division by zero not handled
> `case "divide":`
> `  return { success: true, value: left / right, error: null };`
**Fix**: Check if `right === 0` before dividing and return `{ success: false, value: null, error: "Division by zero" }` instead. Currently dividing by zero returns `Infinity` (or `NaN` for `0/0`) with `success: true`, which is incorrect.
*Severity: critical*

### Warnings

#### [WARN] src/validation.ts:26-38 — No validation that division by zero is caught at input level
> `return { left, operator, right };`
**Fix**: Consider adding a check in `parseArgs` (or a dedicated validation step) that rejects `right === 0` when `operator === "divide"`. This would provide a clearer user-facing error message than relying solely on the operations layer.
*Severity: warning*

#### [WARN] src/cli.ts:22-25 — --help flag is processed even when mixed with other arguments
> `if (args.includes("--help")) {`
**Fix**: This means `cli.ts 2 add --help` prints help instead of reporting an argument error. Consider checking `args[0] === "--help"` or checking argument count first.
*Severity: warning*

### Summary
| Severity | Count |
|----------|-------|
| Critical | 2 |
| Warning  | 2 |

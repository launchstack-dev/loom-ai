/**
 * F-03 fixture — buggy subject under iteration.
 *
 * The bug: `divide(a, b)` returns NaN-or-Infinity on b === 0 instead of
 * throwing. The repro script asserts `divide(10, 0)` throws; on the buggy
 * version that assertion fails and the symptom reproduces.
 *
 * The fix (applied by the integrator in iter 1 during real convergence runs)
 * is to add a guard: `if (b === 0) throw new Error("division by zero");`.
 *
 * This file ships in the "buggy" state. The companion file
 * `src/buggy.fixed.ts` shows the post-fix shape for reference and is what
 * the integrator would produce.
 */

export function divide(a: number, b: number): number {
  return a / b;
}

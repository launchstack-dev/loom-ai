/**
 * F-03 fixture — post-fix reference shape (NOT loaded by the fixture's
 * repro.sh; this is the state the integrator would produce in iter 1).
 *
 * The unit test `test/debug-harness.test.ts` substitutes this file into the
 * symptom path to simulate the post-fix iteration and confirm the synthetic
 * row is OMITTED.
 */

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("division by zero");
  }
  return a / b;
}

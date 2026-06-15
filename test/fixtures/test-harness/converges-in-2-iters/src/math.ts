// Subject under test for the F-02 convergence fixture.
//
// The starter version of `add` returns the wrong value so the test suite has
// 3 failing tests on iteration 0. The fixer-agent's job (Phase 4 Integrator
// Mode) is to change `a - b` to `a + b`, after which all tests pass on
// iteration 1 and the convergence loop exits with `status: converged`.

export function add(a: number, b: number): number {
  // BUG: subtraction instead of addition. Fixer-agent target.
  return a - b;
}

export function double(n: number): number {
  return n * 2;
}

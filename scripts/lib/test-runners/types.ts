/**
 * Shared types and helpers for runner adapters under `scripts/lib/test-runners/`.
 *
 * Each adapter exports a `TestRunner` object that the harness selects based
 * on the `--runner` CLI flag (`bun`, `vitest`, `pytest`).
 *
 * Contract per `protocols/findings.applications-rows.md` F-02:
 *
 *   - `severity` is always `blocking` (set by the harness, not the runner).
 *   - `locationPath` is the test-file path returned in `TestFailure.file`.
 *   - `locationAnchor` is the `{describe chain} > {it name}` string returned
 *     in `TestFailure.anchor`.
 *   - `summary` is the ANSI-stripped first non-empty line of the failure
 *     message returned in `TestFailure.summary`.
 *   - `reviewerAgent` is the runner's `name` field (`bun-test`, `vitest`,
 *     `pytest`).
 */

/** A single parsed test failure ready for `ConvergenceFindings.findings[]`. */
export interface TestFailure {
  /** Repo-relative test file path. */
  file: string;
  /** `{describe chain} > {it name}` or pytest nodeid tail. */
  anchor: string;
  /** First non-empty failure line, ANSI-stripped. */
  summary: string;
}

/** A runner adapter. Each runner file exports one of these. */
export interface TestRunner {
  /** Used as `reviewerAgent` in emitted findings. */
  name: "bun-test" | "vitest" | "pytest";
  /** Build the child-process invocation. The harness owns spawn + capture. */
  buildCommand(subject: string): { cmd: string; args: string[] };
  /**
   * Parse runner output into a list of failures.
   *
   * Returns `{ parseable: false }` when the output does not match any
   * expected pattern (no failure rows AND no summary line) — the harness
   * converts this into `RUNNER_OUTPUT_UNPARSEABLE` per S-03.
   *
   * Returns `{ parseable: true, failures: [] }` when the runner ran cleanly
   * with zero failures (S-02 / convergence reached).
   */
  parse(
    stdout: string,
    stderr: string,
    exitCode: number,
  ): { failures: TestFailure[]; parseable: boolean };
}

/**
 * Strip ANSI escape sequences from a string. Pure; used by all three runner
 * adapters to keep their parse paths reporter-agnostic.
 *
 * Pattern matches CSI (`\x1b[...m`), OSC (`\x1b]...\x07`), and bare ESC
 * sequences emitted by progress reporters.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** All runner kinds the harness understands. */
export type RunnerKind = "bun" | "vitest" | "pytest";

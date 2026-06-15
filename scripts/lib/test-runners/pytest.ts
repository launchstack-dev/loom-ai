/**
 * Pytest runner adapter for `scripts/test-harness.ts`.
 *
 * Parses `pytest -q` short summary output (the most stable format across
 * pytest 7.x and 8.x):
 *
 *   ```
 *   FAILED tests/test_foo.py::TestThing::test_does_the_thing - AssertionError: expected 1 == 2
 *   FAILED tests/test_bar.py::test_other - ValueError: ...
 *   ===================== 2 failed, 3 passed in 0.42s ======================
 *   ```
 *
 * The `FAILED <nodeid> - <error>` lines are emitted by the short test summary
 * info block (pytest's `-r f` is on by default in `-q` mode). We use the
 * trailing summary `===== N failed, M passed =====` line as the
 * parse-success disambiguator.
 */

import { type TestFailure, type TestRunner, stripAnsi } from "./types.js";

const PYTEST_FAIL_RE = /^FAILED\s+([^\s]+)\s+-\s+(.+)$/;
const PYTEST_SUMMARY_RE = /=+\s+(\d+\s+(?:failed|passed|skipped|errors?|warnings?)(?:,\s*\d+\s+(?:failed|passed|skipped|errors?|warnings?))*).*=+/;

export const pytestRunner: TestRunner = {
  name: "pytest",

  buildCommand(subject: string): { cmd: string; args: string[] } {
    return { cmd: "pytest", args: ["-q", subject] };
  },

  parse(stdout: string, stderr: string, _exitCode: number) {
    const combined = stripAnsi(`${stdout}\n${stderr}`);
    const lines = combined.split("\n");
    const failures: TestFailure[] = [];
    let sawSummary = false;

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (PYTEST_SUMMARY_RE.test(line)) {
        sawSummary = true;
        continue;
      }

      const match = line.match(PYTEST_FAIL_RE);
      if (!match) continue;

      const nodeId = match[1];
      const errorMsg = match[2].trim();

      // pytest nodeids: `path/to/file.py::ClassName::test_name` or
      // `path/to/file.py::test_name`. Split at the first `::`.
      const sepIdx = nodeId.indexOf("::");
      const file = sepIdx === -1 ? nodeId : nodeId.slice(0, sepIdx);
      const rawAnchor = sepIdx === -1 ? "" : nodeId.slice(sepIdx + 2);
      // Convert `Class::method` to `Class > method` to match the F-02
      // `{describe chain} > {it name}` convention.
      const anchor = rawAnchor.replace(/::/g, " > ");

      failures.push({ file, anchor, summary: errorMsg });
    }

    const parseable = sawSummary || failures.length > 0;
    return { failures, parseable };
  },
};

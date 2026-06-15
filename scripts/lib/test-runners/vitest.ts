/**
 * Vitest runner adapter for `scripts/test-harness.ts`.
 *
 * Parses `vitest run --reporter=default` output (the default in vitest 1.x
 * and 2.x). Vitest emits one `FAIL` block per failing test:
 *
 *   ```
 *    FAIL  test/foo.test.ts > describe one > nested > it does the thing
 *      AssertionError: expected 1 to equal 2
 *        ❯ test/foo.test.ts:12:5
 *   ```
 *
 * The `❯ <file>:<line>:<col>` cursor line is optional in some reporter
 * variants; we fall back to the file extracted from the `FAIL` header.
 *
 * Trailing summary lines look like `Tests  3 passed | 1 failed` and serve
 * as the parse-success disambiguator.
 */

import { type TestFailure, type TestRunner, stripAnsi } from "./types.js";

const VITEST_FAIL_RE = /^\s*(?:×|❯|FAIL)\s+(.+?\.(?:test|spec)\.[jt]sx?)\s*>\s*(.+)$/;
const VITEST_SUMMARY_RE = /^\s*Tests\s+/;
const VITEST_ERROR_RE = /^\s*(?:AssertionError|Error|TypeError|RangeError|ReferenceError|SyntaxError|[A-Z][A-Za-z]*Error):\s*(.+)$/;

export const vitestRunner: TestRunner = {
  name: "vitest",

  buildCommand(subject: string): { cmd: string; args: string[] } {
    return { cmd: "npx", args: ["vitest", "run", "--reporter=default", subject] };
  },

  parse(stdout: string, stderr: string, _exitCode: number) {
    const combined = stripAnsi(`${stdout}\n${stderr}`);
    const lines = combined.split("\n");
    const failures: TestFailure[] = [];
    let sawSummary = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();

      if (VITEST_SUMMARY_RE.test(line)) {
        sawSummary = true;
        continue;
      }

      const failMatch = line.match(VITEST_FAIL_RE);
      if (!failMatch) continue;

      const file = failMatch[1].trim();
      const chain = failMatch[2].trim();

      let summary = "";
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const candidate = lines[j].trim();
        if (!candidate) continue;
        if (VITEST_FAIL_RE.test(candidate)) break;
        const errMatch = candidate.match(VITEST_ERROR_RE);
        if (errMatch) {
          summary = errMatch[1].trim();
          break;
        }
        // First non-empty non-error line is also acceptable as a fallback.
        if (!summary) summary = candidate;
      }
      if (!summary) summary = chain;

      failures.push({ file, anchor: chain, summary });
    }

    const parseable = sawSummary || failures.length > 0;
    return { failures, parseable };
  },
};

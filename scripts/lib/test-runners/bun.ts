/**
 * Bun test runner adapter for `scripts/test-harness.ts`.
 *
 * Parses `bun test` output into a list of `TestFailure` rows that the harness
 * converts into `ConvergenceFindings.findings[]` (severity always `blocking`,
 * `reviewerAgent: "bun-test"` per `findings.applications-rows.md` F-02).
 *
 * Output format (bun >= 1.0):
 *
 *   ```
 *   path/to/file.test.ts:
 *   (fail) describe one > nested > it does the thing
 *     error: expected 1 to equal 2
 *       at ...
 *   (pass) ...
 *    3 pass
 *    1 fail
 *   ```
 *
 * Some bun versions prefix with `✗` instead of `(fail)` — we accept both.
 * The describe chain + it name is one space-joined segment after `>`-delimited
 * parts; we preserve the join with the `>` separator per the F-02 row variant.
 */

import { type TestFailure, type TestRunner, stripAnsi } from "./types.js";

const BUN_FAIL_RE = /^\s*(?:\(fail\)|✗|✘)\s+(.+)$/;
const BUN_FILE_HEADER_RE = /^([^\s:][^\s]*\.(?:test|spec)\.[jt]sx?):\s*$/;
const BUN_ERROR_RE = /^\s*(?:error|FAIL):\s*(.+)$/i;
/**
 * Standalone summary tail line emitted by bun >= 1.0. Format example:
 *
 *   ```
 *    3 pass
 *    1 fail
 *   ```
 *
 * We use the presence of this line as the disambiguator between "ran cleanly"
 * (parseable, possibly 0 failures) and "produced unexpected output" (parser
 * should signal RUNNER_OUTPUT_UNPARSEABLE).
 */
const BUN_SUMMARY_RE = /^\s*\d+\s+(?:pass|fail|skip|todo)\b/;

export const bunRunner: TestRunner = {
  name: "bun-test",

  buildCommand(subject: string): { cmd: string; args: string[] } {
    return { cmd: "bun", args: ["test", subject] };
  },

  parse(stdout: string, stderr: string, _exitCode: number) {
    const combined = stripAnsi(`${stdout}\n${stderr}`);
    const lines = combined.split("\n");
    const failures: TestFailure[] = [];

    let currentFile = "";
    let sawSummary = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trimEnd();

      if (BUN_SUMMARY_RE.test(line)) {
        sawSummary = true;
        continue;
      }

      const fileMatch = line.match(BUN_FILE_HEADER_RE);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      const failMatch = line.match(BUN_FAIL_RE);
      if (!failMatch) continue;

      // Bun joins the describe chain and `it` name with " > ". We preserve
      // the chain verbatim per the F-02 row variant (locationAnchor =
      // "{describe chain} > {it name}").
      const chain = failMatch[1].trim();

      // Look ahead a few lines for the first non-empty error message.
      let summary = "";
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const candidate = lines[j].trim();
        if (!candidate) continue;
        // Stop scanning if we hit the next (fail)/(pass) or file header.
        if (
          BUN_FAIL_RE.test(candidate) ||
          BUN_FILE_HEADER_RE.test(candidate) ||
          BUN_SUMMARY_RE.test(candidate) ||
          /^\(pass\)|^✓/.test(candidate)
        ) {
          break;
        }
        const errMatch = candidate.match(BUN_ERROR_RE);
        summary = errMatch ? errMatch[1].trim() : candidate;
        break;
      }
      if (!summary) summary = chain;

      failures.push({
        file: currentFile || "unknown",
        anchor: chain,
        summary,
      });
    }

    // Parse-success heuristic: we either parsed at least one failure or saw
    // the bun summary line (which implies "ran cleanly even if zero
    // failures"). If neither holds, the output is unparseable.
    const parseable = sawSummary || failures.length > 0;
    return { failures, parseable };
  },
};

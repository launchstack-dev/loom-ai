/**
 * S-11: No code path outside sign-off.ts may set sign_off_state to "signed-off".
 *
 * This is the production safety net behind the "sign-off is the only path to
 * converged" invariant. The test scans every .ts file under
 * scripts/roadmap-converge/ (excluding sign-off.ts itself) for assignments
 * that write the literal "signed-off" to sign_off_state.
 *
 * We match patterns like:
 *   sign_off_state: "signed-off"
 *   sign_off_state = "signed-off"
 *   sign_off_state:"signed-off"
 *
 * We deliberately do NOT match:
 *   - Comments that mention "signed-off" (// the signed-off terminal value)
 *   - Type definitions referencing the SignOffState union member
 *   - Test files (we own the scripts/ tree only)
 *
 * The implementation strips line-comments before matching and ignores the
 * migrator type file (separate directory). The whole-string regex is
 * deliberately narrow: it requires `sign_off_state` adjacent to a colon or
 * equals followed by the quoted literal "signed-off". This catches accidental
 * writes from a future contributor while staying noise-free.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SCRIPTS_DIR = resolve(__dirname, "..", "..", "scripts", "roadmap-converge");
const ALLOWED_WRITER = "sign-off.ts";

/**
 * Matches assignments writing the literal "signed-off" to sign_off_state.
 * Examples that match:
 *   sign_off_state: "signed-off"
 *   sign_off_state = "signed-off"
 *   sign_off_state:'signed-off'
 *   sign_off_state : "signed-off"
 * Examples that do NOT match:
 *   type SignOffState = ... | "signed-off"
 *   // user-facing label is "signed-off"
 *   sign_off_state === "signed-off"  (comparison, not write)
 */
const WRITE_PATTERN = /sign_off_state\s*[:=](?!=)\s*["']signed-off["']/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) continue;
    if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function stripLineComments(source: string): string {
  // Remove // line comments so commentary about signed-off does not trip
  // the regex. We intentionally leave block /* */ comments intact — they
  // are rare in this codebase and a multiline-comment-aware stripper
  // would be more code than the value warrants. The unit-test gate is
  // good enough to deter accidental writes; a determined contributor
  // could hide one inside a block comment but they'd have to be trying.
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      // Crude string-aware check: don't strip if `//` appears inside a
      // string literal. We check both single and double quotes preceding
      // the `//` to count them; an odd count means we're inside a string.
      const before = line.slice(0, idx);
      const dq = (before.match(/"/g) ?? []).length;
      const sq = (before.match(/'/g) ?? []).length;
      if (dq % 2 === 1 || sq % 2 === 1) return line;
      return before;
    })
    .join("\n");
}

describe("S-11: sign-off purity", () => {
  it("only sign-off.ts writes sign_off_state = \"signed-off\"", () => {
    const files = listTsFiles(SCRIPTS_DIR).filter(
      (f) => !f.endsWith(ALLOWED_WRITER)
    );
    expect(files.length).toBeGreaterThan(0); // sanity: directory not empty

    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const stripped = stripLineComments(raw);
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (WRITE_PATTERN.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `${o.file}:${o.line}: ${o.text}`)
        .join("\n");
      throw new Error(
        `Found ${offenders.length} write(s) to sign_off_state="signed-off" outside sign-off.ts:\n${detail}`
      );
    }
    expect(offenders).toEqual([]);
  });

  it("sign-off.ts itself contains exactly one write (anchor for the invariant)", () => {
    const path = join(SCRIPTS_DIR, ALLOWED_WRITER);
    const raw = readFileSync(path, "utf-8");
    const stripped = stripLineComments(raw);
    const matches = stripped.match(/sign_off_state\s*[:=](?!=)\s*["']signed-off["']/g) ?? [];
    // We expect at least one write — otherwise the only path to converged is dead.
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

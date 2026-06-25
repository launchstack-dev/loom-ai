/**
 * Hook: bash-portability-on-write (PostToolUse — Write/Edit)
 *
 * Regex-based scan for known macOS-BSD vs Linux-GNU coreutils divergences.
 * Feedback-only. Catches the class of "works on dev, breaks on CI" bugs that
 * bit PR #18 — e.g. `mktemp -d -t prefix` (no trailing XXXXXX), `sed -i ''`
 * without backup arg, `readlink -f`, `grep -P`, `date -d`.
 *
 * Lighter-weight than shellcheck — no external binary, runs in process. Pairs
 * with shellcheck-on-write.ts (which catches a broader class of issues) and
 * the skills/shell-conventions/ skill (which prevents authoring the bug in
 * the first place).
 *
 * Rule definitions and the scanContent helper live in
 * `hooks/lib/portability-rules.ts` — shared with `scripts/git-hooks/
 * pre-commit` so the write-time hook and the commit-time gate cannot
 * diverge.
 *
 * Skipped silently when:
 *   - file is not a shell script,
 *   - LOOM_SKIP_PORTABILITY env var is set.
 */

import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";
import { isShellScript } from "./lib/file-probe.js";
import { scanContent } from "./lib/portability-rules.js";

runHook("bash-portability-on-write", async (input) => {
  if (process.env.LOOM_SKIP_PORTABILITY) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();
  if (!isShellScript(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();

  let content: string;
  try {
    content = fs.readFileSync(filePath, { encoding: "utf-8" });
  } catch (err: any) {
    process.stderr.write(
      `[bash-portability-on-write] could not read ${filePath}: ${err?.code ?? "unknown"}\n`,
    );
    return allow();
  }

  const findings = scanContent(content);
  if (findings.length === 0) return allow();

  const formatted = findings.map((f) =>
    `  ${filePath}:${f.line}: ${f.ruleName}\n    ${f.content}\n    Fix: ${f.fix.split("\n").join("\n         ")}`,
  );

  const message =
    `bash-portability concerns in ${filePath}:\n${formatted.join("\n\n")}\n\n` +
    `Disable for one file by setting LOOM_SKIP_PORTABILITY=1 in your env.`;
  return allow(message);
});

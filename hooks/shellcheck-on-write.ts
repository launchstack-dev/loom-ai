/**
 * Hook: shellcheck-on-write (PostToolUse — Write/Edit)
 *
 * Runs shellcheck after writes to *.sh / *.bash. Feedback-only — never blocks
 * the operation. Catches the class of shell-quality bugs that bit PR #18:
 * unquoted variable expansions into Python -c, masked `2>/dev/null`, etc.
 *
 * Skipped silently when:
 *   - file is not a shell script (extension + shebang check via file-probe),
 *   - LOOM_SKIP_SHELLCHECK env var is set,
 *   - shellcheck binary is not installed (probed once, cached).
 *
 * Tool failure vs findings:
 *   shellcheck exits 1 on findings, 2-4 on fatal/support errors, killed by
 *   signal on timeout. Only status 1 is forwarded to the user as "findings".
 *   Status >=2 or signal is logged to stderr as a tool failure so the user
 *   knows the gate didn't run rather than seeing tool error output mislabeled
 *   as findings in their file.
 *
 * The companion skill at `skills/shell-conventions/SKILL.md` documents the
 * rules this hook checks (and a few that shellcheck doesn't cover). The hook
 * is the deterministic safety net; the skill is the authoring guidance.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";
import {
  commandAvailable,
  detectShellFlavor,
  isShellScript,
} from "./lib/file-probe.js";

const SHELLCHECK_TIMEOUT = 10_000;

runHook("shellcheck-on-write", async (input) => {
  if (process.env.LOOM_SKIP_SHELLCHECK) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();

  if (!isShellScript(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();
  if (!commandAvailable("shellcheck")) return allow();

  const shell = detectShellFlavor(filePath);

  try {
    execFileSync(
      "shellcheck",
      ["-s", shell, "-f", "gcc", "--", filePath],
      {
        timeout: SHELLCHECK_TIMEOUT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return allow();
  } catch (err: any) {
    // shellcheck exit codes: 1 = real findings, 2-4 = fatal/support, signal =
    // killed (likely timeout). Distinguish so tool failures don't masquerade
    // as code findings in the user's file.
    const status: number | null = err.status ?? null;
    const signal: string | null = err.signal ?? null;
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).trim();

    if (signal) {
      process.stderr.write(
        `[shellcheck-on-write] tool killed by signal ${signal} on ${filePath}\n`,
      );
      return allow();
    }
    if (status !== null && status >= 2) {
      process.stderr.write(
        `[shellcheck-on-write] shellcheck exited ${status} on ${filePath} (fatal/support error, not findings)\n`,
      );
      if (output) {
        process.stderr.write(`  ${output.slice(0, 500)}\n`);
      }
      return allow();
    }
    if (!output) return allow();
    const truncated =
      output.length > 2_000 ? output.slice(0, 2_000) + "\n... (truncated)" : output;
    return allow(`shellcheck findings in ${filePath}:\n${truncated}`);
  }
});

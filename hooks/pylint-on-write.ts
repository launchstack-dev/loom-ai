/**
 * Hook: pylint-on-write (PostToolUse — Write/Edit)
 *
 * Runs `ruff check` and `mypy --strict` (when available) after writes to *.py
 * files. Feedback-only — never blocks. Closes the Python static-analysis hole
 * that lets `json.loads(...).get(...)` chains ship without isinstance guards
 * (PR #18 rounds 4-5).
 *
 * Skipped silently when:
 *   - file is not Python,
 *   - LOOM_SKIP_PYLINT env var is set,
 *   - neither ruff nor mypy is installed (probed once, cached).
 *
 * Tool failure vs findings: ruff and mypy exit 1 on findings, >=2 on tool
 * crash. Only status 1 is surfaced to the user as findings; >=2 / signal is
 * logged to stderr so a tool crash doesn't masquerade as Python errors in
 * the user's file.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";
import { commandAvailable, isPython } from "./lib/file-probe.js";

const TOOL_TIMEOUT = 15_000;

interface ToolReport {
  /** Real lint findings to forward to the user. */
  findings?: string;
  /** Tool-level failure (timeout, crash); logged to stderr, NOT shown to user. */
  failure?: string;
}

function runTool(toolName: string, bin: string, args: string[]): ToolReport {
  try {
    execFileSync(bin, args, {
      timeout: TOOL_TIMEOUT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {};
  } catch (err: any) {
    const status: number | null = err.status ?? null;
    const signal: string | null = err.signal ?? null;
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).trim();

    if (signal) {
      return { failure: `${toolName} killed by signal ${signal}` };
    }
    if (status !== null && status >= 2) {
      return {
        failure: `${toolName} exited ${status} (tool error, not findings)${
          output ? ":\n  " + output.slice(0, 500) : ""
        }`,
      };
    }
    if (!output) return {};
    return {
      findings: output.length > 1_500 ? output.slice(0, 1_500) + "\n... (truncated)" : output,
    };
  }
}

runHook("pylint-on-write", async (input) => {
  if (process.env.LOOM_SKIP_PYLINT) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();
  if (!isPython(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();

  const findings: string[] = [];

  if (commandAvailable("ruff")) {
    const r = runTool("ruff", "ruff", [
      "check", "--no-fix", "--output-format=concise", "--", filePath,
    ]);
    if (r.failure) {
      process.stderr.write(`[pylint-on-write] ${r.failure} (file: ${filePath})\n`);
    } else if (r.findings) {
      findings.push(`ruff:\n${r.findings}`);
    }
  }

  if (commandAvailable("mypy")) {
    const r = runTool("mypy", "mypy", [
      "--strict", "--no-color-output", "--", filePath,
    ]);
    if (r.failure) {
      process.stderr.write(`[pylint-on-write] ${r.failure} (file: ${filePath})\n`);
    } else if (r.findings) {
      findings.push(`mypy:\n${r.findings}`);
    }
  }

  if (findings.length === 0) return allow();

  return allow(`Python lint findings in ${filePath}:\n${findings.join("\n\n")}`);
});

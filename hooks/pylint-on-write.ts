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
 *   - neither ruff nor mypy is installed (fail-open).
 *
 * Tools are run independently — a missing ruff doesn't block mypy and vice
 * versa. Mirrors typecheck-on-write.ts for TypeScript.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";

const PY_EXTENSIONS = [".py", ".pyi"];
const TOOL_TIMEOUT = 15_000;

function isPython(filePath: string): boolean {
  if (PY_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return true;
  try {
    const head = fs.readFileSync(filePath, { encoding: "utf-8" }).slice(0, 64);
    return /^#!\s*\/(usr\/)?bin\/(env\s+)?python[23]?\b/.test(head);
  } catch {
    return false;
  }
}

function toolAvailable(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], {
      timeout: 2_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function runTool(bin: string, args: string[]): string | undefined {
  try {
    execFileSync(bin, args, {
      timeout: TOOL_TIMEOUT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return undefined;
  } catch (err: any) {
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    if (!output) return undefined;
    return output.length > 1_500 ? output.slice(0, 1_500) + "\n... (truncated)" : output;
  }
}

runHook("pylint-on-write", async (input) => {
  if (process.env.LOOM_SKIP_PYLINT) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();
  if (!isPython(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();

  const reports: string[] = [];

  if (toolAvailable("ruff")) {
    const ruff = runTool("ruff", ["check", "--no-fix", "--output-format=concise", filePath]);
    if (ruff) reports.push(`ruff:\n${ruff}`);
  }

  if (toolAvailable("mypy")) {
    const mypy = runTool("mypy", ["--strict", "--no-color-output", filePath]);
    if (mypy) reports.push(`mypy:\n${mypy}`);
  }

  if (reports.length === 0) return allow();

  return allow(`Python lint findings in ${filePath}:\n${reports.join("\n\n")}`);
});

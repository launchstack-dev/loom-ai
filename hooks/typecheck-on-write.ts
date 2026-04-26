/**
 * Hook: typecheck-on-write (PostToolUse — Write/Edit)
 * Runs tsc --noEmit after TypeScript file writes and feeds errors back.
 * Never blocks — only provides feedback via stdout.
 * Skipped if LOOM_SKIP_TYPECHECK env var is set.
 */

import { execSync } from "node:child_process";
import { runHook, allow } from "./lib/run-hook.js";

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const TYPECHECK_TIMEOUT = 30_000;

runHook("typecheck-on-write", async (input) => {
  if (process.env.LOOM_SKIP_TYPECHECK) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();

  const isTs = TS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (!isTs) return allow();

  try {
    execSync("tsc --noEmit --pretty 2>&1", {
      timeout: TYPECHECK_TIMEOUT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return allow();
  } catch (err: any) {
    const output = err.stdout ?? err.message ?? "Typecheck failed";
    // Truncate to avoid overwhelming the agent
    const truncated =
      output.length > 2000 ? output.slice(0, 2000) + "\n... (truncated)" : output;
    return allow(`Typecheck errors after writing ${filePath}:\n${truncated}`);
  }
});

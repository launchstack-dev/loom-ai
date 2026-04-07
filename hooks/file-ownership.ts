/**
 * Hook: file-ownership (PreToolUse — Write/Edit)
 * Blocks writes to files not owned by the current wave's active tasks.
 * Fail-open: if state is unreadable or no active wave, allows all writes.
 */

import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, getOwnedFiles } from "./lib/context.js";

runHook("file-ownership", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();

  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow(); // Not in a Loom run

  const absPath = path.resolve(filePath);

  // Meta-files in .plan-execution/ are always writable
  if (absPath.startsWith(path.resolve(planExecDir))) {
    return allow();
  }

  const owned = getOwnedFiles(planExecDir);
  if (owned === null) {
    // No active tasks (orchestrator is between waves) — allow all writes
    return allow();
  }

  if (owned.has(absPath)) {
    return allow();
  }

  const ownedList = [...owned].map((p) => path.basename(p)).join(", ");
  return block(
    `File "${path.basename(absPath)}" is not in your file ownership boundary. ` +
      `Owned files: [${ownedList}]. ` +
      `If you need this file, write a request to .plan-execution/requests/.`
  );
});

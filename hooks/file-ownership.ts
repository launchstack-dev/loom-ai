/**
 * Hook: file-ownership (PreToolUse — Write/Edit)
 * Blocks writes to files not owned by the current wave's active tasks.
 * Fail-open: if state is unreadable or no active wave, allows all writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, getOwnedFiles } from "./lib/context.js";

runHook("file-ownership", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();

  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow(); // Not in a Loom run

  // Canonicalize path to handle macOS /var → /private/var symlinks
  let absPath = path.resolve(filePath);
  try {
    let current = absPath;
    let tail = "";
    while (!fs.existsSync(current) && current !== path.dirname(current)) {
      tail = tail ? path.join(path.basename(current), tail) : path.basename(current);
      current = path.dirname(current);
    }
    if (fs.existsSync(current)) {
      absPath = tail ? path.join(fs.realpathSync(current), tail) : fs.realpathSync(current);
    }
  } catch {
    // Resolve failed — path.resolve is the best we can do
  }

  // Meta-files in .plan-execution/ are always writable
  if (absPath.startsWith(path.resolve(planExecDir))) {
    return allow();
  }

  // .loom/wiki/ is guarded by wiki-write-guard hook
  if (absPath.startsWith(path.resolve(".loom", "wiki") + path.sep)) {
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

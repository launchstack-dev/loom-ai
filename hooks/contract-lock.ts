/**
 * Hook: contract-lock (PreToolUse — Write/Edit)
 * Blocks modifications to contracts/ after Wave 0 completes.
 * Fail-open: if state is unreadable, allows the write.
 */

import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, isContractPhaseComplete } from "./lib/context.js";

runHook("contract-lock", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();

  // Only care about contract files
  if (!filePath.includes("/contracts/") && !filePath.includes("\\contracts\\")) {
    return allow();
  }

  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow(); // Not in a Loom run

  if (!isContractPhaseComplete(planExecDir)) {
    return allow(); // Wave 0 still in progress — contracts are writable
  }

  return block(
    `Contracts are locked after Wave 0. ` +
      `File "${filePath}" is in the contracts directory. ` +
      `Request changes via .plan-execution/requests/ instead.`
  );
});

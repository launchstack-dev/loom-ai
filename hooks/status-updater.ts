/**
 * Hook: status-updater (SubagentStop)
 * Updates status.toon timestamps after each agent completes.
 * Side effect only — never blocks.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { findPlanExecutionDir } from "./lib/context.js";

runHook("status-updater", async (_input) => {
  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow();

  const statusPath = path.join(planExecDir, "ephemeral", "status.toon");
  try {
    const content = fs.readFileSync(statusPath, "utf-8");
    const updated = content.replace(
      /^updatedAt:\s*.+$/m,
      `updatedAt: ${new Date().toISOString()}`
    );

    const tmpPath = statusPath + ".tmp";
    fs.writeFileSync(tmpPath, updated, "utf-8");
    fs.renameSync(tmpPath, statusPath);
  } catch {
    // Fail open — status update is best-effort
  }

  return allow();
});

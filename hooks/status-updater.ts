/**
 * Hook: status-updater (SubagentStop)
 *
 * DEPRECATED — scaffold layer, active only under the `strict` discipline
 * profile (roadmap M-3). Native replacement: the Workflow runtime's live
 * progress display (/workflows) — heartbeat files exist because a markdown
 * orchestrator could not observe its agents. See
 * protocols/discipline.schema.md.
 *
 * Updates status.toon timestamps after each agent completes.
 * Side effect only — never blocks.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteText } from "../lib/index.js";
import { runHook, allow } from "./lib/run-hook.js";
import { findPlanExecutionDir } from "./lib/context.js";
import { hookActive } from "./lib/discipline.js";

runHook("status-updater", async (_input) => {
  // Scaffold layer — inactive below the strict discipline profile
  if (!hookActive("status-updater")) return allow();

  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow();

  const statusPath = path.join(planExecDir, "ephemeral", "status.toon");
  try {
    const content = fs.readFileSync(statusPath, "utf-8");
    const updated = content.replace(
      /^updatedAt:\s*.+$/m,
      `updatedAt: ${new Date().toISOString()}`
    );

    atomicWriteText(statusPath, updated);
  } catch {
    // Fail open — status update is best-effort
  }

  return allow();
});

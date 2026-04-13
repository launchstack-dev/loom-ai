/**
 * Hook: wiki-write-guard (PreToolUse — Write/Edit)
 * Blocks non-wiki-agents from writing to .loom/wiki/ during active execution.
 * Fail-open: if state is unreadable or no active execution, allows all writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, getCurrentWave } from "./lib/context.js";

const WIKI_AGENTS = new Set([
  "wiki-maintainer-agent",
  "wiki-ingest-agent",
  "wiki-lint-agent",
  "wiki-query-agent",
]);

runHook("wiki-write-guard", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();

  // Canonicalize the path to handle macOS /var → /private/var symlinks.
  // The file may not exist yet, so walk up to the first existing ancestor,
  // resolve it, then reattach the remaining segments.
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

  // Anchor wiki path check to project root (via .plan-execution/ parent)
  // to avoid false positives from project paths that happen to contain /.loom/wiki/
  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) {
    // No active Loom run — allow manual edits and standalone commands
    return allow();
  }

  // Anchor wiki path check to project root (via .plan-execution/ parent)
  // to avoid false positives from project paths that happen to contain /.loom/wiki/
  const projectRoot = path.dirname(planExecDir);
  const wikiDir = path.join(projectRoot, ".loom", "wiki");

  if (!absPath.startsWith(wikiDir + path.sep) && absPath !== wikiDir) {
    return allow();
  }

  // Derive agent identity from execution state: check if all active tasks
  // in the current wave are assigned to wiki agents.
  const wave = getCurrentWave(planExecDir);
  if (!wave) {
    // No active wave or state unreadable — orchestrator is between waves, allow
    return allow();
  }

  const activeTasks = wave.tasks.filter((t) => t.status === "in_progress");
  // LIMITATION: Hook cannot identify the specific calling agent.
  // Using .every() ensures writes are only allowed when all active tasks
  // are wiki agents (e.g., during Step 3.25 wiki maintenance).
  const allActiveAreWikiAgents = activeTasks.every((t) => WIKI_AGENTS.has(t.agent));

  if (allActiveAreWikiAgents) {
    return allow();
  }

  // Active execution confirmed, no wiki agent task is active — block the write
  return block(
    `Wiki files are managed by wiki agents during execution. ` +
      `File "${path.basename(absPath)}" is in .loom/wiki/. ` +
      `Use /loom-ingest to update wiki content, or add a wiki note ` +
      `with /loom-note --tag wiki "your observation".`
  );
});

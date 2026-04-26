/**
 * Hook: budget-tracker (PreToolUse — Agent)
 * Blocks new agent spawns if budget exhausted, and increments the spawn
 * counter on each spawn. Counter increments on spawn (PreToolUse) rather
 * than completion because Claude Code has no SubagentStop event.
 * Fail-open: if state is unreadable, allows the operation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, readPipelineState } from "./lib/context.js";

runHook("budget-tracker", async (input) => {
  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow();

  const pipeline = readPipelineState(planExecDir);
  if (!pipeline) return allow();

  // Check budget before spawning
  if (pipeline.agentsSpawned >= pipeline.maxAgents) {
    return block(
      `Agent budget exhausted: ${pipeline.agentsSpawned}/${pipeline.maxAgents}. ` +
        `Pipeline should escalate. Do not spawn more agents.`
    );
  }

  // Increment counter on spawn (we count spawns, not completions)
  const pipelinePath = path.join(planExecDir, "pipeline-state.toon");
  try {
    const content = fs.readFileSync(pipelinePath, "utf-8");
    const newCount = pipeline.agentsSpawned + 1;
    const updated = content.replace(
      /^agentsSpawned:\s*.+$/m,
      `agentsSpawned: ${newCount}`
    );

    const tmpPath = pipelinePath + ".tmp";
    fs.writeFileSync(tmpPath, updated, "utf-8");
    fs.renameSync(tmpPath, pipelinePath);

    if (newCount >= pipeline.maxAgents * 0.8) {
      return allow(
        `Agent budget at ${Math.round((newCount / pipeline.maxAgents) * 100)}%: ${newCount}/${pipeline.maxAgents}.`
      );
    }
  } catch {
    // Fail open — increment failed, but don't block the spawn
  }

  return allow();
});

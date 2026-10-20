/**
 * Hook: budget-tracker
 * - SubagentStop: Increment agent count, warn if near/at budget.
 * - PreToolUse (Agent): Block new agent spawns if budget exhausted.
 * Fail-open: if state is unreadable, allows the operation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteText } from "../lib/index.js";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, readPipelineState } from "./lib/context.js";
import { parseToon } from "./lib/toon-reader.js";

const TERMINAL_STAGES = new Set(["complete", "escalated"]);

runHook("budget-tracker", async (input) => {
  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow();

  const pipeline = readPipelineState(planExecDir);
  if (!pipeline) return allow();

  // A finished run has no budget to enforce. Without this, every ad-hoc subagent
  // after the run keeps incrementing its counter and is eventually blocked.
  if (TERMINAL_STAGES.has(pipeline.currentStage)) return allow();

  // Determine if this is a PreToolUse (Agent) or SubagentStop call
  const isPreToolUse = input.tool_name !== undefined;

  if (isPreToolUse) {
    // PreToolUse on Agent tool — check if budget allows spawning
    if (pipeline.agentsSpawned >= pipeline.maxAgents) {
      return block(
        `Agent budget exhausted: ${pipeline.agentsSpawned}/${pipeline.maxAgents}. ` +
          `Pipeline should escalate. Do not spawn more agents.`
      );
    }

    if (pipeline.agentsSpawned >= pipeline.maxAgents * 0.8) {
      return allow(
        `Warning: Agent budget at ${Math.round((pipeline.agentsSpawned / pipeline.maxAgents) * 100)}% ` +
          `(${pipeline.agentsSpawned}/${pipeline.maxAgents}).`
      );
    }

    return allow();
  }

  // SubagentStop — increment counter
  const pipelinePath = path.join(planExecDir, "pipeline-state.toon");
  try {
    const content = fs.readFileSync(pipelinePath, "utf-8");
    const newCount = pipeline.agentsSpawned + 1;
    const updated = content.replace(
      /^agentsSpawned:\s*.+$/m,
      `agentsSpawned: ${newCount}`
    );

    // Atomic write via shared-core (C-02, lib/atomic-fs.ts)
    atomicWriteText(pipelinePath, updated);

    if (newCount >= pipeline.maxAgents) {
      return allow(
        `Agent budget exhausted: ${newCount}/${pipeline.maxAgents}. Pipeline should escalate.`
      );
    }
    if (newCount >= pipeline.maxAgents * 0.8) {
      return allow(
        `Agent budget at ${Math.round((newCount / pipeline.maxAgents) * 100)}%: ${newCount}/${pipeline.maxAgents}.`
      );
    }
  } catch {
    // Fail open — write failed, but don't block
  }

  return allow();
});

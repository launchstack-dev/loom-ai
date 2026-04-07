/**
 * Hook: quality-gate (Stop)
 * Blocks premature stops when pipeline is mid-stage.
 * Does NOT implement the full quality gate decision matrix —
 * that stays in the orchestrator prompt where it can reason about nuance.
 * This hook only prevents the orchestrator from stopping before a stage completes.
 */

import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, readPipelineState } from "./lib/context.js";

const TERMINAL_STAGES = new Set(["complete", "escalated"]);
const KNOWN_STAGES = new Set([
  "plan-create", "plan-review", "plan-integrate", "plan-validate",
  "execute", "test", "review-code", "fix-code",
  "complete", "escalated",
]);

const STAGE_NAMES: Record<string, string> = {
  "plan-create": "Plan Creation",
  "plan-review": "Plan Review",
  "plan-integrate": "Review Integration",
  "plan-validate": "Plan Validation",
  execute: "Execution",
  test: "Testing",
  "review-code": "Code Review",
  "fix-code": "Fix Cycle",
};

runHook("quality-gate", async (_input) => {
  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow(); // Not in a Loom run

  const pipeline = readPipelineState(planExecDir);
  if (!pipeline) return allow(); // Can't read state — fail open

  if (TERMINAL_STAGES.has(pipeline.currentStage)) {
    return allow(); // Legitimate stop
  }

  // Unknown stage — fail open rather than blocking on corrupted state
  if (!KNOWN_STAGES.has(pipeline.currentStage)) {
    return allow();
  }

  const stageName = STAGE_NAMES[pipeline.currentStage] ?? pipeline.currentStage;
  return block(
    `Pipeline stage "${stageName}" (iteration ${pipeline.outerIteration}) is not complete. ` +
      `Continue execution. The pipeline will signal completion by setting currentStage to "complete" or "escalated".`
  );
});

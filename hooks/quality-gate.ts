/**
 * Hook: quality-gate (Stop)
 * Blocks premature stops when pipeline is mid-stage.
 * Does NOT implement the full quality gate decision matrix —
 * that stays in the orchestrator prompt where it can reason about nuance.
 * This hook only prevents the orchestrator from stopping before a stage completes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, readPipelineState } from "./lib/context.js";

/** Minutes of inactivity before pipeline state is considered stale. */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

const TERMINAL_STAGES = new Set(["complete", "escalated"]);
const KNOWN_STAGES = new Set([
  "roadmap-create", "roadmap-review", "roadmap-integrate", "roadmap-approve",
  "plan-create", "plan-review", "plan-integrate", "plan-validate",
  "execute", "converge", "test", "review-code", "fix-code",
  "complete", "escalated",
]);

const STAGE_NAMES: Record<string, string> = {
  "roadmap-create": "Roadmap Creation",
  "roadmap-review": "Roadmap Review",
  "roadmap-integrate": "Roadmap Integration",
  "roadmap-approve": "Roadmap Approval",
  "plan-create": "Plan Creation",
  "plan-review": "Plan Review",
  "plan-integrate": "Review Integration",
  "plan-validate": "Plan Validation",
  execute: "Execution",
  converge: "Convergence",
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

  // Stale pipeline detection: if pipeline-state.toon hasn't been written
  // in 30 minutes, this is leftover state from an abandoned session.
  try {
    const pipelinePath = path.join(planExecDir, "pipeline-state.toon");
    const stat = fs.statSync(pipelinePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > STALE_THRESHOLD_MS) {
      return allow(
        `[quality-gate] Pipeline state is stale (last modified ${Math.round(ageMs / 60000)}m ago). ` +
          `Allowing stop. Run \`/loom resume\` to continue the abandoned pipeline, ` +
          `or delete .plan-execution/pipeline-state.toon to clear it.`
      );
    }
  } catch {
    // Can't stat — fail open
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

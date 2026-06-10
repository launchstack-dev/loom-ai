/**
 * Hook: quality-gate (Stop)
 * Blocks premature stops when pipeline is mid-stage.
 * Does NOT implement the full quality gate decision matrix —
 * that stays in the orchestrator prompt where it can reason about nuance.
 * This hook only prevents the orchestrator from stopping before a stage completes.
 *
 * Staleness rule: if pipeline-state.toon hasn't been touched in
 * STALE_PIPELINE_DAYS, treat it as an abandoned run from a prior session
 * and allow the stop. The block exists to keep an active run from being
 * interrupted mid-stage, not to chain new sessions to abandoned old ones.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { findPlanExecutionDir, readPipelineState } from "./lib/context.js";

const STALE_PIPELINE_DAYS = 7;
const STALE_PIPELINE_MS = STALE_PIPELINE_DAYS * 24 * 60 * 60 * 1000;

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

  // Unknown stage — fail open rather than blocking on corrupted state
  if (!KNOWN_STAGES.has(pipeline.currentStage)) {
    return allow();
  }

  // Staleness check: abandoned pipeline-state.toon should not block new sessions.
  try {
    const statePath = path.join(planExecDir, "pipeline-state.toon");
    const ageMs = Date.now() - fs.statSync(statePath).mtimeMs;
    if (ageMs > STALE_PIPELINE_MS) {
      process.stderr.write(
        `[loom:quality-gate] pipeline-state.toon hasn't been touched in ` +
          `${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d (> ${STALE_PIPELINE_DAYS}d threshold) — ` +
          `treating as abandoned. Archive with: ` +
          `mv .plan-execution/pipeline-state.toon planning/history/abandoned/\n`
      );
      return allow();
    }
  } catch {
    // stat failed — fall through to the block path, same as before
  }

  const stageName = STAGE_NAMES[pipeline.currentStage] ?? pipeline.currentStage;
  return block(
    `Pipeline stage "${stageName}" (iteration ${pipeline.outerIteration}) is not complete. ` +
      `Continue execution. The pipeline will signal completion by setting currentStage to "complete" or "escalated". ` +
      `(If this run is actually abandoned, archive .plan-execution/pipeline-state.toon to planning/history/abandoned/ — ` +
      `automatic after ${STALE_PIPELINE_DAYS} days of inactivity.)`
  );
});

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
import { findPlanExecutionDir, readPipelineState, readExecutionState } from "./lib/context.js";
import { hookActive } from "./lib/discipline.js";
import { revalidateCompletion } from "./lib/revalidation.js";

const STALE_PIPELINE_DAYS = 7;
const STALE_PIPELINE_MS = STALE_PIPELINE_DAYS * 24 * 60 * 60 * 1000;

const TERMINAL_STAGES = new Set(["complete", "escalated"]);
const KNOWN_STAGES = new Set([
  "roadmap-create", "roadmap-review", "roadmap-integrate", "roadmap-approve",
  "plan-create", "plan-review", "plan-integrate", "plan-validate",
  "execute", "converge", "test", "review-code", "fix-code",
  "complete", "escalated",
]);

/**
 * Acceptance re-validation gate (roadmap C-08 / CT6 A2): a completion claim
 * is only allowed to stop after the acceptance checks pass on an independent
 * re-run. Fail-closed on failing checks; the failing criterion is named.
 */
function gateCompletionClaim(planExecDir: string) {
  const result = revalidateCompletion(planExecDir);
  switch (result.verdict) {
    case "pass":
    case "already-validated":
    case "operator-skip":
      return allow();
    case "fail":
      return block(
        `Completion claimed, but acceptance re-validation FAILED:\n` +
          result.failures.map((f) => `  - ${f}`).join("\n") +
          `\nFix the failing checks before finishing (or re-run them manually to inspect). ` +
          `This gate re-runs [domain].verificationPipeline independently — a claim is not a verdict.`
      );
    case "skipped-checks":
      return block(
        `Completion claimed, but verification was skipped or unrecorded:\n` +
          result.failures.map((f) => `  - ${f}`).join("\n") +
          `\nRun the verification pipeline and record wave verificationResult before finishing. ` +
          `Self-certified completion is blocked under every discipline profile (C-08).`
      );
  }
}

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
  // Core layer (C-08): the Stop-time gate holds under every profile. The
  // hookActive call is kept so the single seam stays the only decision point.
  if (!hookActive("quality-gate")) return allow();

  const planExecDir = findPlanExecutionDir();
  if (!planExecDir) return allow(); // Not in a Loom run

  const pipeline = readPipelineState(planExecDir);
  if (!pipeline) {
    // No pipeline run — but an execution-only run claiming completion still
    // gets the acceptance re-validation gate (C-08: no self-certification).
    const execution = readExecutionState(planExecDir);
    if (execution && execution.status === "completed") {
      return gateCompletionClaim(planExecDir);
    }
    return allow(); // No completion claim — fail open as before
  }

  if (TERMINAL_STAGES.has(pipeline.currentStage)) {
    // "escalated" is not a done-claim; only "complete" is re-validated.
    if (pipeline.currentStage === "complete") {
      return gateCompletionClaim(planExecDir);
    }
    return allow();
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

/**
 * Hook: checkpoint-trigger (PostToolUse + Stop)
 * Monitors accumulated context and suggests checkpoint+clear when estimated
 * context exceeds 80% of the context window. Fires on every tool use but
 * only injects a suggestion every 10 tool uses (unless critical).
 * Fail-open: any error allows the operation to proceed silently.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { estimateTokens, estimateFileTokens } from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

interface CheckpointConfig {
  contextWindow: number;
  checkpointWarning: number;
  checkpointCritical: number;
}

/** State file to track invocation count across hook calls (scoped per project). */
const STATE_FILE = path.join(process.cwd(), ".plan-execution", "checkpoint-trigger-state.json");

interface TriggerState {
  invocationCount: number;
  lastSuggestionAt: number;
}

function readTriggerState(): TriggerState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { invocationCount: 0, lastSuggestionAt: 0 };
  }
}

function writeTriggerState(state: TriggerState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // fail open
  }
}

/** Parse checkpoint config from orchestration.toml. */
function readCheckpointConfig(): CheckpointConfig {
  const defaults: CheckpointConfig = {
    contextWindow: 200000,
    checkpointWarning: 0.35,
    checkpointCritical: 0.25,
  };

  try {
    const tomlPath = path.resolve(".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return defaults;

    const content = fs.readFileSync(tomlPath, "utf-8");

    if (!content.includes("[settings.contextBudget]")) return defaults;

    const sectionMatch = content.match(
      /\[settings\.contextBudget\]([\s\S]*?)(?=\n\s*\[|\s*$)/
    );
    if (!sectionMatch) return defaults;

    const section = sectionMatch[1];

    const windowMatch = section.match(/contextWindow\s*=\s*(\d+)/);
    const warningMatch = section.match(/checkpointWarning\s*=\s*([\d.]+)/);
    const criticalMatch = section.match(/checkpointCritical\s*=\s*([\d.]+)/);

    return {
      contextWindow: windowMatch ? parseInt(windowMatch[1], 10) : defaults.contextWindow,
      checkpointWarning: warningMatch ? parseFloat(warningMatch[1]) : defaults.checkpointWarning,
      checkpointCritical: criticalMatch ? parseFloat(criticalMatch[1]) : defaults.checkpointCritical,
    };
  } catch {
    return defaults;
  }
}

/**
 * Estimate total accumulated context by summing key on-disk artifacts
 * that the orchestrator has consumed: rolling-context, stage summaries,
 * wave summaries, and the conversation overhead estimate.
 */
async function estimateAccumulatedContext(planExecDir: string | null): Promise<number> {
  let total = 0;

  // System prompt + conversation overhead baseline
  total += 5000;

  if (!planExecDir) return total;

  // rolling-context.md
  const rcPath = path.join(planExecDir, "rolling-context.md");
  total += await estimateFileTokens(rcPath);

  // stage-context files
  try {
    const stageDir = path.join(planExecDir, "stage-context");
    if (fs.existsSync(stageDir)) {
      const files = fs.readdirSync(stageDir).filter((f: string) => f.endsWith(".toon"));
      for (const f of files) {
        total += await estimateFileTokens(path.join(stageDir, f));
      }
    }
  } catch {
    // fail open
  }

  // Wave summaries
  try {
    const entries = fs.readdirSync(planExecDir).filter(
      (f: string) => f.match(/^wave-\d+-summary\.toon$/)
    );
    for (const f of entries) {
      total += await estimateFileTokens(path.join(planExecDir, f));
    }
  } catch {
    // fail open
  }

  // state.toon + pipeline-state.toon
  total += await estimateFileTokens(path.join(planExecDir, "state.toon"));
  total += await estimateFileTokens(path.join(planExecDir, "pipeline-state.toon"));

  // Multiply by a conversational expansion factor:
  // On-disk artifacts represent ~30% of actual context consumption
  // (agent prompts, tool outputs, prior messages account for the rest).
  // Use invocation count as a proxy for conversation length.
  const state = readTriggerState();
  const conversationEstimate = state.invocationCount * 200; // ~200 tokens per tool use average
  total += conversationEstimate;

  return total;
}

/** Determine the appropriate resume command based on which state files exist. */
function detectResumeCommand(planExecDir: string | null): string {
  if (!planExecDir) return "/loom resume";

  try {
    if (fs.existsSync(path.join(planExecDir, "pipeline-state.toon"))) {
      return "/loom auto --resume";
    }
    if (fs.existsSync(path.join(planExecDir, "convergence-state.toon"))) {
      return "/loom converge --resume";
    }
    if (fs.existsSync(path.join(planExecDir, "state.toon"))) {
      return "/loom-plan execute --resume";
    }
  } catch {
    // fail open
  }

  return "/loom resume";
}

runHook("checkpoint-trigger", async (input) => {
  const config = readCheckpointConfig();
  const planExecDir = findPlanExecutionDir();

  // Only fire when a pipeline is active
  if (!planExecDir) return allow();

  // Track invocations
  const state = readTriggerState();
  state.invocationCount++;
  writeTriggerState(state);

  // Estimate on every call so we never miss a critical threshold
  const estimated = await estimateAccumulatedContext(planExecDir);
  const remaining = config.contextWindow - estimated;
  const remainingFraction = remaining / config.contextWindow;

  // No checkpoint needed
  if (remainingFraction > config.checkpointWarning) return allow();

  const isCritical = remainingFraction <= config.checkpointCritical;

  // Debounce the message (every 10 tool uses), but critical always fires
  if (state.invocationCount % 10 !== 0 && !isCritical) return allow();

  const resumeCmd = detectResumeCommand(planExecDir);

  let message: string;
  if (isCritical) {
    message = [
      "",
      "--- CONTEXT CHECKPOINT (CRITICAL) ---",
      `Estimated context: ${Math.round((1 - remainingFraction) * 100)}% used (~${estimated} tokens of ${config.contextWindow})`,
      `Remaining: ~${remaining} tokens (${Math.round(remainingFraction * 100)}%)`,
      "",
      "Recommended action:",
      `  1. Run \`/loom pause --compact\` to save all state`,
      `  2. Run \`/clear\` for fresh context`,
      `  3. Then: \`${resumeCmd}\``,
      "---",
      "",
    ].join("\n");
  } else {
    message = [
      "",
      "--- Context Checkpoint Suggestion ---",
      `Estimated context: ${Math.round((1 - remainingFraction) * 100)}% used (~${estimated} tokens of ${config.contextWindow})`,
      `Consider checkpointing soon. When ready:`,
      `  Run \`/clear\` then: \`${resumeCmd}\``,
      "---",
      "",
    ].join("\n");
  }

  return allow(message);
});

/**
 * Hook: context-monitor (PostToolUse)
 * Monitors remaining context percentage and injects warnings into tool output.
 * Writes contextRemaining to .plan-execution/status.toon for statusline display.
 * Thresholds read from orchestration.toml [settings.contextBudget].
 * Debounced: warns every 5 tool uses; severity escalation bypasses debounce.
 * Fail-open: any error allows the operation silently.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { estimateTokens, estimateFileTokens } from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

interface MonitorConfig {
  contextWindow: number;
  checkpointWarning: number;
  checkpointCritical: number;
}

/** Persistent state across hook invocations (scoped per project). */
const MONITOR_STATE_FILE = path.join(process.cwd(), ".plan-execution", "context-monitor-state.json");

interface MonitorState {
  toolUseCount: number;
  lastWarnAt: number;         // toolUseCount when last warning was emitted
  lastSeverity: string;       // "none" | "warning" | "critical"
}

function readMonitorState(): MonitorState {
  try {
    const raw = fs.readFileSync(MONITOR_STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { toolUseCount: 0, lastWarnAt: 0, lastSeverity: "none" };
  }
}

function writeMonitorState(state: MonitorState): void {
  try {
    fs.writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
  } catch {
    // fail open
  }
}

/** Parse monitor config from orchestration.toml. */
function readMonitorConfig(): MonitorConfig {
  const defaults: MonitorConfig = {
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
 * Estimate context consumption. Combines on-disk artifact sizes with
 * a conversation-length heuristic based on tool use count.
 */
async function estimateContextUsed(
  planExecDir: string | null,
  toolUseCount: number
): Promise<number> {
  let total = 5000; // system prompt + overhead

  // Conversation estimate: ~200 tokens per tool interaction on average
  total += toolUseCount * 200;

  if (!planExecDir) return total;

  // rolling-context.md
  total += await estimateFileTokens(path.join(planExecDir, "rolling-context.md"));

  // stage-context files
  try {
    const stageDir = path.join(planExecDir, "stage-context");
    if (fs.existsSync(stageDir)) {
      for (const f of fs.readdirSync(stageDir).filter((f: string) => f.endsWith(".toon"))) {
        total += await estimateFileTokens(path.join(stageDir, f));
      }
    }
  } catch {
    // fail open
  }

  // Wave summaries
  try {
    for (const f of fs.readdirSync(planExecDir).filter((f: string) => /^wave-\d+-summary\.toon$/.test(f))) {
      total += await estimateFileTokens(path.join(planExecDir, f));
    }
  } catch {
    // fail open
  }

  // Core state files
  total += await estimateFileTokens(path.join(planExecDir, "state.toon"));
  total += await estimateFileTokens(path.join(planExecDir, "pipeline-state.toon"));

  return total;
}

/** Determine the appropriate resume command based on active state files. */
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

/**
 * Write contextRemaining to status.toon so the statusline renderer
 * can display context pressure (e.g., ctx:65% or ctx:25% !).
 * Uses atomic write: write .tmp then rename.
 */
function writeContextRemainingToStatus(
  planExecDir: string,
  remainingPct: number,
  isCritical: boolean
): void {
  try {
    const statusPath = path.join(planExecDir, "status.toon");

    // Read existing status.toon content if present, and append/update contextRemaining
    let content = "";
    try {
      content = fs.readFileSync(statusPath, "utf-8");
    } catch {
      // no existing status file -- nothing to update
      // Only append if status.toon already exists (owned by orchestrator)
      return;
    }

    // Remove any existing contextRemaining line
    const lines = content.split("\n").filter(
      (l) => !l.startsWith("contextRemaining:") && !l.startsWith("contextCritical:")
    );

    // Append contextRemaining fields
    lines.push(`contextRemaining: ${remainingPct}`);
    if (isCritical) {
      lines.push(`contextCritical: true`);
    }

    const updated = lines.join("\n");
    const tmpPath = statusPath + ".tmp";
    fs.writeFileSync(tmpPath, updated);
    fs.renameSync(tmpPath, statusPath);
  } catch {
    // fail open -- status line is additive, never gating
  }
}

runHook("context-monitor", async (input) => {
  const config = readMonitorConfig();
  const planExecDir = findPlanExecutionDir();

  // Track state
  const state = readMonitorState();
  state.toolUseCount++;

  const estimated = await estimateContextUsed(planExecDir, state.toolUseCount);
  const remaining = config.contextWindow - estimated;
  const remainingFraction = Math.max(0, remaining / config.contextWindow);
  const remainingPct = Math.round(remainingFraction * 100);

  // Write context remaining to status.toon for statusline display
  if (planExecDir) {
    const isCritical = remainingFraction <= config.checkpointCritical;
    writeContextRemainingToStatus(planExecDir, remainingPct, isCritical);
  }

  // Determine current severity
  let currentSeverity = "none";
  if (remainingFraction <= config.checkpointCritical) {
    currentSeverity = "critical";
  } else if (remainingFraction <= config.checkpointWarning) {
    currentSeverity = "warning";
  }

  // No warning needed if above threshold
  if (currentSeverity === "none") {
    writeMonitorState(state);
    return allow();
  }

  // Debounce logic: warn every 5 tool uses, but severity escalation bypasses debounce
  const sinceLastWarn = state.toolUseCount - state.lastWarnAt;
  const severityEscalated = currentSeverity === "critical" && state.lastSeverity !== "critical";
  const shouldWarn = sinceLastWarn >= 5 || severityEscalated;

  if (!shouldWarn) {
    writeMonitorState(state);
    return allow();
  }

  // Update state
  state.lastWarnAt = state.toolUseCount;
  state.lastSeverity = currentSeverity;
  writeMonitorState(state);

  const resumeCmd = detectResumeCommand(planExecDir);

  let message: string;
  if (currentSeverity === "critical") {
    message = [
      "",
      `[CONTEXT CRITICAL] ~${remainingPct}% remaining (~${remaining} of ${config.contextWindow} tokens)`,
      `Recommended: Run \`/loom pause --compact\` then \`/clear\``,
      `Resume with: \`${resumeCmd}\``,
      "",
    ].join("\n");
  } else {
    message = [
      "",
      `[context warning] ~${remainingPct}% context remaining (~${remaining} of ${config.contextWindow} tokens)`,
      `When ready to checkpoint: \`/clear\` then \`${resumeCmd}\``,
      "",
    ].join("\n");
  }

  return allow(message);
});

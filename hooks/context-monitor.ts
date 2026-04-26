/**
 * Hook: context-monitor (PostToolUse + Stop)
 * Monitors remaining context percentage and injects warnings into tool output.
 * Writes contextRemaining to .plan-execution/status.toon for statusline display.
 * Thresholds read from orchestration.toml [settings.contextBudget].
 * Debounced: warns every 5 tool uses; severity escalation bypasses debounce.
 * On Stop: fires unconditionally (no debounce) if context is below warning threshold.
 * Fail-open: any error allows the operation silently.
 *
 * Merged from former context-monitor + checkpoint-trigger hooks to avoid
 * duplicate filesystem walks on every tool use.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { estimateFileTokens } from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

interface MonitorConfig {
  contextWindow: number;
  checkpointWarning: number;
  checkpointCritical: number;
}

const MONITOR_STATE_FILE = path.join(process.cwd(), ".plan-execution", "context-monitor-state.json");

interface MonitorState {
  toolUseCount: number;
  lastWarnAt: number;
  lastSeverity: string;
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

async function estimateContextUsed(
  planExecDir: string | null,
  toolUseCount: number
): Promise<number> {
  let total = 5000; // system prompt + overhead
  total += toolUseCount * 200; // ~200 tokens per tool interaction

  if (!planExecDir) return total;

  total += await estimateFileTokens(path.join(planExecDir, "rolling-context.md"));

  try {
    const stageDir = path.join(planExecDir, "stage-context");
    if (fs.existsSync(stageDir)) {
      for (const f of fs.readdirSync(stageDir).filter((f: string) => f.endsWith(".toon"))) {
        total += await estimateFileTokens(path.join(stageDir, f));
      }
    }
  } catch { /* fail open */ }

  try {
    for (const f of fs.readdirSync(planExecDir).filter((f: string) => /^wave-\d+-summary\.toon$/.test(f))) {
      total += await estimateFileTokens(path.join(planExecDir, f));
    }
  } catch { /* fail open */ }

  total += await estimateFileTokens(path.join(planExecDir, "state.toon"));
  total += await estimateFileTokens(path.join(planExecDir, "pipeline-state.toon"));

  return total;
}

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
  } catch { /* fail open */ }

  return "/loom resume";
}

function writeContextRemainingToStatus(
  planExecDir: string,
  remainingPct: number,
  isCritical: boolean
): void {
  try {
    const statusPath = path.join(planExecDir, "status.toon");
    let content = "";
    try {
      content = fs.readFileSync(statusPath, "utf-8");
    } catch {
      return; // Only update if status.toon already exists
    }

    const lines = content.split("\n").filter(
      (l) => !l.startsWith("contextRemaining:") && !l.startsWith("contextCritical:")
    );
    lines.push(`contextRemaining: ${remainingPct}`);
    if (isCritical) {
      lines.push(`contextCritical: true`);
    }

    const tmpPath = statusPath + ".tmp";
    fs.writeFileSync(tmpPath, lines.join("\n"));
    fs.renameSync(tmpPath, statusPath);
  } catch { /* fail open */ }
}

runHook("context-monitor", async (input) => {
  const config = readMonitorConfig();
  const planExecDir = findPlanExecutionDir();

  const state = readMonitorState();
  state.toolUseCount++;

  const estimated = await estimateContextUsed(planExecDir, state.toolUseCount);
  const remaining = config.contextWindow - estimated;
  const remainingFraction = Math.max(0, remaining / config.contextWindow);
  const remainingPct = Math.round(remainingFraction * 100);

  if (planExecDir) {
    writeContextRemainingToStatus(planExecDir, remainingPct, remainingFraction <= config.checkpointCritical);
  }

  let currentSeverity = "none";
  if (remainingFraction <= config.checkpointCritical) {
    currentSeverity = "critical";
  } else if (remainingFraction <= config.checkpointWarning) {
    currentSeverity = "warning";
  }

  if (currentSeverity === "none") {
    writeMonitorState(state);
    return allow();
  }

  // On Stop events, always emit the warning (no debounce)
  const isStopEvent = input.tool_name === undefined;

  // Debounce: warn every 5 tool uses, but severity escalation and Stop bypass
  const sinceLastWarn = state.toolUseCount - state.lastWarnAt;
  const severityEscalated = currentSeverity === "critical" && state.lastSeverity !== "critical";
  const shouldWarn = isStopEvent || sinceLastWarn >= 5 || severityEscalated;

  if (!shouldWarn) {
    writeMonitorState(state);
    return allow();
  }

  state.lastWarnAt = state.toolUseCount;
  state.lastSeverity = currentSeverity;
  writeMonitorState(state);

  const resumeCmd = detectResumeCommand(planExecDir);

  let message: string;
  if (currentSeverity === "critical") {
    message = [
      "",
      `--- CONTEXT CHECKPOINT (CRITICAL) ---`,
      `Estimated context: ${100 - remainingPct}% used (~${estimated} tokens of ${config.contextWindow})`,
      `Remaining: ~${remaining} tokens (${remainingPct}%)`,
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
      `[context warning] ~${remainingPct}% context remaining (~${remaining} of ${config.contextWindow} tokens)`,
      `When ready to checkpoint: \`/clear\` then \`${resumeCmd}\``,
      "",
    ].join("\n");
  }

  return allow(message);
});

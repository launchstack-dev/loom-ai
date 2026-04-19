/**
 * Shared token estimation utilities for the context budget system.
 * Uses characters / 4 heuristic per context-budget.md spec.
 * All functions are fail-safe: file read errors return 0.
 */

import * as fs from "node:fs";

export interface ContextBudgetBreakdown {
  agentInstructions: number;
  rollingContext: number;
  stageContext: number;
  taskPrompt: number;
  overhead: number;
}

export interface ContextBudgetEstimate {
  estimatedPromptTokens: number;
  breakdown: ContextBudgetBreakdown;
  withinBudget: boolean;
  budgetUtilization: number;
}

/** Estimate tokens from a string: characters / 4, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens from a file by stat size. Returns 0 if file doesn't exist or is unreadable. */
export async function estimateFileTokens(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath);
    return Math.ceil(stat.size / 4);
  } catch (err) {
    process.stderr.write(`[token-estimator] Failed to stat file "${filePath}": ${err}\n`);
    return 0;
  }
}

/**
 * Compute a full context budget estimate with per-component breakdown.
 * Any component that fails to read contributes 0 tokens (fail-open).
 */
export async function estimateContextBudget(components: {
  agentPrompt: string;
  agentMdPath?: string;
  rollingContextPath?: string;
  stageContextPaths?: string[];
}): Promise<ContextBudgetEstimate> {
  const overhead = 5000;
  const taskPrompt = estimateTokens(components.agentPrompt);

  const agentInstructions = components.agentMdPath
    ? await estimateFileTokens(components.agentMdPath)
    : 0;

  const rollingContext = components.rollingContextPath
    ? await estimateFileTokens(components.rollingContextPath)
    : 0;

  let stageContext = 0;
  if (components.stageContextPaths) {
    for (const p of components.stageContextPaths) {
      stageContext += await estimateFileTokens(p);
    }
  }

  const estimatedPromptTokens =
    agentInstructions + rollingContext + stageContext + taskPrompt + overhead;

  const breakdown: ContextBudgetBreakdown = {
    agentInstructions,
    rollingContext,
    stageContext,
    taskPrompt,
    overhead,
  };

  // withinBudget and budgetUtilization cannot be computed here because the budget
  // cap is not available in this scope — the caller (checkTestAgentBudget) computes
  // these from config.agentBudgetCap and overrides them in its return value.
  return {
    estimatedPromptTokens,
    breakdown,
    withinBudget: true, // caller overrides with actual cap comparison
    budgetUtilization: 0, // caller overrides with estimatedTokens / cap
  };
}

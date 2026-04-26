/**
 * Hook: context-budget (PreToolUse — Agent)
 * Intercepts Agent tool calls (subagent spawns) and estimates prompt size.
 * Blocks spawns that would exceed the configured agentBudgetCap.
 * For test agents (e2e-runner, qa-review, etc.), applies tier-specific
 * budget multipliers — lower tiers get reduced caps.
 * Fail-open: any estimation error allows the spawn.
 *
 * Merged from former context-budget + context-budget-test hooks to avoid
 * spawning two bun processes per Agent call.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { estimateFileTokens, estimateContextBudget } from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

// --- Config ---

interface BudgetConfig {
  contextWindow: number;
  agentBudgetCap: number;
}

/**
 * Parse budget config from orchestration.toml using regex. Falls back to defaults.
 *
 * NOTE: Uses regex to extract flat key=value pairs from the
 * [settings.contextBudget] TOML section. This is intentionally simple —
 * we only parse `contextWindow` and `agentBudgetCap` (both integers).
 * A full TOML parser is not warranted for this narrow use case, but this
 * approach will misparse quoted strings, multi-line values, or inline
 * tables if they ever appear in this section.
 */
export function readBudgetConfig(): BudgetConfig {
  const defaults: BudgetConfig = { contextWindow: 200000, agentBudgetCap: 100000 };

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
    const capMatch = section.match(/agentBudgetCap\s*=\s*(\d+)/);

    const contextWindow = windowMatch ? parseInt(windowMatch[1], 10) : defaults.contextWindow;
    const agentBudgetCap = capMatch
      ? parseInt(capMatch[1], 10)
      : Math.floor(contextWindow / 2);

    return { contextWindow, agentBudgetCap };
  } catch (err) {
    process.stderr.write(`[context-budget] Failed to read config: ${err}\n`);
    return defaults;
  }
}

// --- Agent path resolution ---

/**
 * Find an agent .md file referenced in the prompt.
 * Looks for paths like ~/.claude/agents/*.md or agents/*.md.
 */
export function findAgentMdPath(prompt: string): string | undefined {
  const patterns = [
    /(?:~\/\.claude\/agents\/[\w./-]+\.md)/g,
    /(?:~\/\.loom-ai\/agents\/[\w./-]+\.md)/g,
    /(?:\.claude\/agents\/[\w./-]+\.md)/g,
    /(?:\.loom-ai\/agents\/[\w./-]+\.md)/g,
    /(?:agents\/[\w./-]+\.md)/g,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      let mdPath = match[0];
      if (mdPath.startsWith("~")) {
        const home = process.env.HOME ?? (() => {
          process.stderr.write(`[context-budget] HOME is unset, falling back to /tmp\n`);
          return "/tmp";
        })();
        mdPath = mdPath.replace("~", home);
      }
      const resolved = path.resolve(mdPath);
      // Validate resolved path stays within expected directories
      const home = process.env.HOME ?? "/tmp";
      const allowedPrefixes = [
        path.resolve(home, ".claude", "agents"),
        path.resolve(home, ".loom-ai", "agents"),
        path.resolve("agents"),
      ];
      const isAllowed = allowedPrefixes.some((prefix) => resolved.startsWith(prefix + path.sep) || resolved === prefix);
      if (!isAllowed) {
        process.stderr.write(`[context-budget] Rejected agent path outside allowed directories: ${resolved}\n`);
        return undefined;
      }
      if (fs.existsSync(resolved)) return resolved;
    }
  }

  return undefined;
}

// --- Test agent detection and tier-based budgets ---

const TEST_AGENTS = [
  "e2e-runner-agent",
  "qa-review-agent",
  "vitest-runner",
  "integration-test-agent",
  "e2e-test-writer-agent",
];

const TEST_STAGES = ["test", "e2e", "qa-review"];

export type ConvergenceTier = "unit" | "integration" | "e2e" | "qa-review";

const AGENT_TO_TIER: Record<string, ConvergenceTier> = {
  "vitest-runner": "unit",
  "integration-test-agent": "integration",
  "e2e-runner-agent": "e2e",
  "e2e-test-writer-agent": "e2e",
  "qa-review-agent": "qa-review",
};

/**
 * Tier budget multipliers. Higher tiers need more budget for fixtures,
 * expected outputs, screenshots, etc.
 */
const TIER_BUDGET_MULTIPLIERS: Record<ConvergenceTier, number> = {
  unit: 0.6,
  integration: 0.8,
  e2e: 1.0,
  "qa-review": 0.75,
};

export function isTestAgentSpawn(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  for (const agent of TEST_AGENTS) {
    if (lower.includes(agent)) return true;
  }
  if (lower.includes("stage: e2e") || lower.includes("stage: qa-review")) return true;
  return false;
}

export function detectConvergenceTier(prompt: string): ConvergenceTier | undefined {
  const lower = prompt.toLowerCase();

  for (const [agent, tier] of Object.entries(AGENT_TO_TIER)) {
    if (lower.includes(agent)) return tier;
  }

  if (lower.includes("stage: e2e") || lower.includes("tier: e2e")) return "e2e";
  if (lower.includes("stage: qa-review") || lower.includes("tier: qa-review")) return "qa-review";
  if (lower.includes("tier: integration")) return "integration";
  if (lower.includes("tier: unit") || lower.includes("stage: test")) return "unit";

  return undefined;
}

export function getEffectiveBudgetCap(
  baseCap: number,
  tier: ConvergenceTier | undefined
): number {
  if (!tier) return baseCap;
  return Math.floor(baseCap * TIER_BUDGET_MULTIPLIERS[tier]);
}

function getTestStageContextPaths(planExecDir: string): string[] {
  const paths: string[] = [];
  try {
    const stageDir = path.join(planExecDir, "stage-context");
    if (!fs.existsSync(stageDir)) return paths;

    for (const stage of TEST_STAGES) {
      const stagePath = path.join(stageDir, `${stage}.toon`);
      if (fs.existsSync(stagePath)) {
        paths.push(stagePath);
      }
    }
  } catch (err) {
    process.stderr.write(`[context-budget] Failed to read stage context paths: ${err}\n`);
  }
  return paths;
}

// --- Exported programmatic API ---

export interface TestBudgetCheckResult {
  withinBudget: boolean;
  estimatedTokens: number;
  budgetCap: number;
  effectiveBudgetCap: number;
  budgetUtilization: number;
  isTestAgent: boolean;
  detectedTier: ConvergenceTier | undefined;
  breakdown: {
    agentInstructions: number;
    rollingContext: number;
    stageContext: number;
    taskPrompt: number;
    overhead: number;
  };
}

export async function checkTestAgentBudget(prompt: string): Promise<TestBudgetCheckResult> {
  const config = readBudgetConfig();
  const isTest = isTestAgentSpawn(prompt);
  const detectedTier = isTest ? detectConvergenceTier(prompt) : undefined;

  const planExecDir = findPlanExecutionDir();
  const rollingContextPath = planExecDir
    ? path.join(planExecDir, "rolling-context.md")
    : undefined;

  const stageContextPaths = planExecDir
    ? getTestStageContextPaths(planExecDir)
    : undefined;

  const agentMdPath = findAgentMdPath(prompt);

  const estimate = await estimateContextBudget({
    agentPrompt: prompt,
    agentMdPath,
    rollingContextPath,
    stageContextPaths,
  });

  const est = estimate.estimatedPromptTokens;
  const effectiveCap = getEffectiveBudgetCap(config.agentBudgetCap, detectedTier);
  const utilization = est / effectiveCap;

  return {
    withinBudget: est <= effectiveCap,
    estimatedTokens: est,
    budgetCap: config.agentBudgetCap,
    effectiveBudgetCap: effectiveCap,
    budgetUtilization: Math.round(utilization * 100) / 100,
    isTestAgent: isTest,
    detectedTier,
    breakdown: estimate.breakdown,
  };
}

// --- Hook entry point ---

runHook("context-budget", async (input) => {
  if (input.tool_name !== "Agent") return allow();

  const prompt: string = input.tool_input?.prompt ?? "";
  if (!prompt) return allow();

  const config = readBudgetConfig();
  const isTest = isTestAgentSpawn(prompt);

  // Test agents get tier-specific budget checks
  if (isTest) {
    const result = await checkTestAgentBudget(prompt);

    const tierLabel = result.detectedTier ? ` [tier=${result.detectedTier}]` : "";
    const capLabel = result.effectiveBudgetCap !== result.budgetCap
      ? `${result.effectiveBudgetCap} effective cap (${result.budgetCap} base)`
      : `${result.budgetCap} cap`;

    if (!result.withinBudget) {
      return block(
        `Test agent budget exceeded${tierLabel}: estimated ${result.estimatedTokens} tokens vs ${capLabel} ` +
          `(${Math.round(result.budgetUtilization * 100)}% utilization). ` +
          `Breakdown: agent=${result.breakdown.agentInstructions}, ` +
          `rolling-ctx=${result.breakdown.rollingContext}, ` +
          `stage-ctx=${result.breakdown.stageContext}, ` +
          `prompt=${result.breakdown.taskPrompt}, ` +
          `overhead=${result.breakdown.overhead}. ` +
          `Consider compressing rolling context or splitting the test task.`
      );
    }

    if (result.budgetUtilization >= 0.8) {
      return allow(
        `Test agent budget at ${Math.round(result.budgetUtilization * 100)}%${tierLabel}: ` +
          `${result.estimatedTokens}/${result.effectiveBudgetCap} tokens. ` +
          `Consider compressing context before next iteration.`
      );
    }

    return allow();
  }

  // General agents: standard budget check
  const planExecDir = findPlanExecutionDir();
  const rollingContextPath = planExecDir
    ? path.join(planExecDir, "rolling-context.md")
    : undefined;

  let stageContextPaths: string[] | undefined;
  if (planExecDir) {
    try {
      const stageDir = path.join(planExecDir, "stage-context");
      if (fs.existsSync(stageDir)) {
        stageContextPaths = fs
          .readdirSync(stageDir)
          .filter((f) => f.endsWith(".toon"))
          .map((f) => path.join(stageDir, f));
      }
    } catch { /* fail open */ }
  }

  const agentMdPath = findAgentMdPath(prompt);

  const estimate = await estimateContextBudget({
    agentPrompt: prompt,
    agentMdPath,
    rollingContextPath,
    stageContextPaths,
  });

  if (estimate.estimatedPromptTokens > config.agentBudgetCap) {
    return block(
      `Estimated prompt size ${estimate.estimatedPromptTokens} tokens exceeds budget cap ${config.agentBudgetCap} tokens. Consider splitting the task.`
    );
  }

  return allow();
});

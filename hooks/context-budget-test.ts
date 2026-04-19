/**
 * Hook: context-budget-test (PreToolUse -- Agent)
 * Preflight budget check specifically for test agent spawns.
 * Ensures test agents (e2e-runner-agent, qa-review-agent, vitest-runner,
 * integration-test-agent) stay within the 100k token budget cap.
 *
 * Exports `checkTestAgentBudget` for programmatic use by the orchestrator.
 * Also runs as a Claude Code hook when invoked via stdin.
 *
 * Fail-open: any estimation error allows the spawn.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import {
  estimateTokens,
  estimateFileTokens,
  estimateContextBudget,
} from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

/** Test-related agent names that this hook intercepts. */
const TEST_AGENTS = [
  "e2e-runner-agent",
  "qa-review-agent",
  "vitest-runner",
  "integration-test-agent",
  "e2e-test-writer-agent",
];

/** Test-related stage names for stage-context loading. */
const TEST_STAGES = ["test", "e2e", "qa-review"];

interface BudgetConfig {
  contextWindow: number;
  agentBudgetCap: number;
}

/**
 * Parse budget config from orchestration.toml. Falls back to defaults.
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

/**
 * Detect if a prompt is spawning a test-related agent.
 * Checks for agent names in the prompt text and common patterns
 * like "Read your instructions from ~/.claude/agents/{test-agent}.md".
 */
export function isTestAgentSpawn(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  for (const agent of TEST_AGENTS) {
    if (lower.includes(agent)) return true;
  }
  // Also check for stage references in task definitions
  if (lower.includes("stage: e2e") || lower.includes("stage: qa-review")) return true;
  return false;
}

/**
 * Find the agent .md file path from a prompt string.
 * Looks for paths like ~/.claude/agents/*.md.
 */
export function findAgentMdPath(prompt: string): string | undefined {
  const patterns = [
    /(?:~\/\.claude\/agents\/[\w./-]+\.md)/g,
    /(?:~\/\.loom-ai\/agents\/[\w./-]+\.md)/g,
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

/**
 * Gather test-related stage context file paths.
 * Only includes stage files for test/e2e/qa-review stages.
 */
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
    // fail open
  }
  return paths;
}

export interface TestBudgetCheckResult {
  withinBudget: boolean;
  estimatedTokens: number;
  budgetCap: number;
  budgetUtilization: number;
  isTestAgent: boolean;
  breakdown: {
    agentInstructions: number;
    rollingContext: number;
    stageContext: number;
    taskPrompt: number;
    overhead: number;
  };
}

/**
 * Check whether a test agent spawn is within the token budget cap.
 * Exported for programmatic use by the orchestrator and convergence driver.
 *
 * @param prompt - The agent prompt text
 * @returns TestBudgetCheckResult with budget details
 */
export async function checkTestAgentBudget(prompt: string): Promise<TestBudgetCheckResult> {
  const config = readBudgetConfig();
  const isTest = isTestAgentSpawn(prompt);

  const planExecDir = findPlanExecutionDir();
  const rollingContextPath = planExecDir
    ? path.join(planExecDir, "rolling-context.md")
    : undefined;

  // For test agents, only load test-related stage context (not all stages)
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
  const utilization = est / config.agentBudgetCap;

  return {
    withinBudget: est <= config.agentBudgetCap,
    estimatedTokens: est,
    budgetCap: config.agentBudgetCap,
    budgetUtilization: Math.round(utilization * 100) / 100,
    isTestAgent: isTest,
    breakdown: estimate.breakdown,
  };
}

// --- Hook entry point (runs when invoked as a Claude Code hook) ---

runHook("context-budget-test", async (input) => {
  // Only intercept Agent tool calls
  if (input.tool_name !== "Agent") return allow();

  const prompt: string = input.tool_input?.prompt ?? "";
  if (!prompt) return allow();

  // Only apply to test agent spawns
  if (!isTestAgentSpawn(prompt)) return allow();

  const result = await checkTestAgentBudget(prompt);

  if (!result.withinBudget) {
    return block(
      `Test agent budget exceeded: estimated ${result.estimatedTokens} tokens vs ${result.budgetCap} cap ` +
        `(${Math.round(result.budgetUtilization * 100)}% utilization). ` +
        `Breakdown: agent=${result.breakdown.agentInstructions}, ` +
        `rolling-ctx=${result.breakdown.rollingContext}, ` +
        `stage-ctx=${result.breakdown.stageContext}, ` +
        `prompt=${result.breakdown.taskPrompt}, ` +
        `overhead=${result.breakdown.overhead}. ` +
        `Consider compressing rolling context or splitting the test task.`
    );
  }

  // Warn at 80% utilization
  if (result.budgetUtilization >= 0.8) {
    return allow(
      `Test agent budget at ${Math.round(result.budgetUtilization * 100)}%: ` +
        `${result.estimatedTokens}/${result.budgetCap} tokens. ` +
        `Consider compressing context before next iteration.`
    );
  }

  return allow();
});

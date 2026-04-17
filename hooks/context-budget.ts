/**
 * Hook: context-budget (PreToolUse — Agent)
 * Intercepts Agent tool calls (subagent spawns) and estimates prompt size.
 * Blocks spawns that would exceed the configured agentBudgetCap.
 * Fail-open: any estimation error allows the spawn.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow, block } from "./lib/run-hook.js";
import { estimateTokens, estimateFileTokens, estimateContextBudget } from "./lib/token-estimator.js";
import { findPlanExecutionDir } from "./lib/context.js";

interface BudgetConfig {
  contextWindow: number;
  agentBudgetCap: number;
}

/** Parse budget config from orchestration.toml using regex. Falls back to defaults. */
function readBudgetConfig(): BudgetConfig {
  const defaults: BudgetConfig = { contextWindow: 200000, agentBudgetCap: 100000 };

  try {
    const tomlPath = path.resolve(".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return defaults;

    const content = fs.readFileSync(tomlPath, "utf-8");

    // Check if [settings.contextBudget] section exists
    if (!content.includes("[settings.contextBudget]")) return defaults;

    // Extract the section content (everything between this header and the next [...] header)
    const sectionMatch = content.match(
      /\[settings\.contextBudget\]([\s\S]*?)(?=\n\s*\[|\s*$)/
    );
    if (!sectionMatch) return defaults;

    const section = sectionMatch[1];

    const windowMatch = section.match(/contextWindow\s*=\s*(\d+)/);
    const capMatch = section.match(/agentBudgetCap\s*=\s*(\d+)/);

    const contextWindow = windowMatch ? parseInt(windowMatch[1], 10) : defaults.contextWindow;

    // agentBudgetCap defaults to contextWindow / 2 unless explicitly set
    const agentBudgetCap = capMatch
      ? parseInt(capMatch[1], 10)
      : Math.floor(contextWindow / 2);

    return { contextWindow, agentBudgetCap };
  } catch {
    return defaults;
  }
}

/**
 * Try to find an agent .md file referenced in the prompt.
 * Looks for paths like ~/.claude/agents/*.md or ~/.loom-ai/agents/*.md.
 */
function findAgentMdPath(prompt: string): string | undefined {
  // Match common agent md path patterns
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
      // Expand ~ to home directory
      if (mdPath.startsWith("~")) {
        const home = process.env.HOME ?? "/tmp";
        mdPath = mdPath.replace("~", home);
      }
      const resolved = path.resolve(mdPath);
      if (fs.existsSync(resolved)) return resolved;
    }
  }

  return undefined;
}

runHook("context-budget", async (input) => {
  // Only intercept Agent tool calls
  if (input.tool_name !== "Agent") return allow();

  const prompt: string = input.tool_input?.prompt ?? "";
  if (!prompt) return allow();

  const config = readBudgetConfig();

  // Locate plan execution dir for rolling-context and stage-context
  const planExecDir = findPlanExecutionDir();
  const rollingContextPath = planExecDir
    ? path.join(planExecDir, "rolling-context.md")
    : undefined;

  // Gather stage-context files
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
    } catch {
      // fail open
    }
  }

  const agentMdPath = findAgentMdPath(prompt);

  const estimate = await estimateContextBudget({
    agentPrompt: prompt,
    agentMdPath,
    rollingContextPath,
    stageContextPaths,
  });

  const est = estimate.estimatedPromptTokens;

  if (est > config.agentBudgetCap) {
    return block(
      `Estimated prompt size ${est} tokens exceeds budget cap ${config.agentBudgetCap} tokens. Consider splitting the task.`
    );
  }

  return allow();
});

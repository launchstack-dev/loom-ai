/**
 * CLI tool for structured state extraction.
 * Usage: bun run hooks/lib/loom-context.ts <subcommand>
 *
 * Subcommands:
 *   all-stages        — concatenate all stage-context/*.toon files into TOON output
 *   pipeline-position — read pipeline-state.toon, output current stage + progress as TOON
 *   budget-status     — read budget config, estimate current context usage, output as TOON
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findPlanExecutionDir, readPipelineState } from "./context.js";

const subcommand = process.argv[2];

function writeToon(lines: string[]): void {
  process.stdout.write(lines.join("\n") + "\n");
}

function unavailable(reason: string): void {
  writeToon([`status: unavailable`, `reason: ${reason}`]);
}

/** all-stages: reads all .plan-execution/stage-context/*.toon files, concatenates into TOON. */
function allStages(): void {
  try {
    const planExecDir = findPlanExecutionDir();
    if (!planExecDir) {
      unavailable("no .plan-execution directory found");
      return;
    }

    const stageDir = path.join(planExecDir, "stage-context");
    if (!fs.existsSync(stageDir)) {
      unavailable("no stage-context directory found");
      return;
    }

    const files = fs
      .readdirSync(stageDir)
      .filter((f) => f.endsWith(".toon"))
      .sort();

    if (files.length === 0) {
      unavailable("no stage-context .toon files found");
      return;
    }

    const output: string[] = [`status: ok`, `stageCount: ${files.length}`];

    for (const file of files) {
      const name = file.replace(/\.toon$/, "");
      const content = fs.readFileSync(path.join(stageDir, file), "utf-8").trim();
      output.push(`${name}:`);
      // Indent each line of the stage content by 2 spaces
      for (const line of content.split("\n")) {
        output.push(`  ${line}`);
      }
    }

    writeToon(output);
  } catch (err) {
    unavailable(`error reading stage context: ${err}`);
  }
}

/** pipeline-position: reads pipeline-state.toon, outputs current stage + progress. */
function pipelinePosition(): void {
  try {
    const planExecDir = findPlanExecutionDir();
    if (!planExecDir) {
      unavailable("no .plan-execution directory found");
      return;
    }

    const pipeline = readPipelineState(planExecDir);
    if (!pipeline) {
      unavailable("pipeline-state.toon not found or unreadable");
      return;
    }

    writeToon([
      `status: ok`,
      `currentStage: ${pipeline.currentStage}`,
      `outerIteration: ${pipeline.outerIteration}`,
      `agentsSpawned: ${pipeline.agentsSpawned}`,
      `maxAgents: ${pipeline.maxAgents}`,
      `fixCycleCount: ${pipeline.fixCycleCount}`,
    ]);
  } catch (err) {
    unavailable(`error reading pipeline state: ${err}`);
  }
}

/** budget-status: reads budget config from orchestration.toml, estimates current context usage. */
function budgetStatus(): void {
  try {
    let contextWindow = 200000;
    let agentBudgetCap = 100000;

    // Try reading orchestration.toml
    const tomlPath = path.resolve(".claude", "orchestration.toml");
    if (fs.existsSync(tomlPath)) {
      const content = fs.readFileSync(tomlPath, "utf-8");
      const sectionMatch = content.match(
        /\[settings\.contextBudget\]([\s\S]*?)(?=\n\s*\[|\s*$)/
      );
      if (sectionMatch) {
        const section = sectionMatch[1];
        const windowMatch = section.match(/contextWindow\s*=\s*(\d+)/);
        const capMatch = section.match(/agentBudgetCap\s*=\s*(\d+)/);
        if (windowMatch) contextWindow = parseInt(windowMatch[1], 10);
        agentBudgetCap = capMatch
          ? parseInt(capMatch[1], 10)
          : Math.floor(contextWindow / 2);
      }
    }

    // Estimate current context usage from rolling-context and stage-context sizes
    const planExecDir = findPlanExecutionDir();
    let rollingContextTokens = 0;
    let stageContextTokens = 0;

    if (planExecDir) {
      try {
        const rcPath = path.join(planExecDir, "rolling-context.md");
        if (fs.existsSync(rcPath)) {
          rollingContextTokens = Math.ceil(fs.statSync(rcPath).size / 4);
        }
      } catch {
        // fail open
      }

      try {
        const stageDir = path.join(planExecDir, "stage-context");
        if (fs.existsSync(stageDir)) {
          for (const f of fs.readdirSync(stageDir).filter((f) => f.endsWith(".toon"))) {
            stageContextTokens += Math.ceil(
              fs.statSync(path.join(stageDir, f)).size / 4
            );
          }
        }
      } catch {
        // fail open
      }
    }

    const totalEstimated = rollingContextTokens + stageContextTokens + 5000; // overhead
    const utilization = agentBudgetCap > 0 ? (totalEstimated / agentBudgetCap).toFixed(2) : "0.00";

    writeToon([
      `status: ok`,
      `contextWindow: ${contextWindow}`,
      `agentBudgetCap: ${agentBudgetCap}`,
      `estimatedCurrentTokens: ${totalEstimated}`,
      `breakdown:`,
      `  rollingContext: ${rollingContextTokens}`,
      `  stageContext: ${stageContextTokens}`,
      `  overhead: 5000`,
      `budgetUtilization: ${utilization}`,
      `withinBudget: ${totalEstimated <= agentBudgetCap}`,
    ]);
  } catch (err) {
    unavailable(`error computing budget status: ${err}`);
  }
}

// --- Main dispatch ---
switch (subcommand) {
  case "all-stages":
    allStages();
    break;
  case "pipeline-position":
    pipelinePosition();
    break;
  case "budget-status":
    budgetStatus();
    break;
  default:
    process.stderr.write(
      `Usage: bun run hooks/lib/loom-context.ts <all-stages|pipeline-position|budget-status>\n`
    );
    process.exit(1);
}

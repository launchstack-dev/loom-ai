/**
 * Loom execution context resolver.
 * Reads state.toon and pipeline-state.toon to provide context to hooks.
 * All functions return null on any error (fail open).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon, parseToonArray, parseToonSimpleArray } from "./toon-reader.js";

export interface WaveTask {
  taskId: string;
  agent: string;
  status: string;
  fileOwnership: string[];
}

export interface WaveState {
  index: number;
  status: string;
  tasks: WaveTask[];
}

export interface ExecutionState {
  status: string;
  currentWave: number;
  waves: Record<string, WaveState>;
}

export interface PipelineState {
  currentStage: string;
  outerIteration: number;
  agentsSpawned: number;
  maxAgents: number;
  fixCycleCount: number;
}

/**
 * Walk up from startDir to find a directory containing `.plan-execution/`.
 * Returns the `.plan-execution/` path or null.
 */
export function findPlanExecutionDir(startDir?: string): string | null {
  try {
    let dir = startDir ?? process.cwd();
    for (let i = 0; i < 20; i++) {
      const candidate = path.join(dir, ".plan-execution");
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read and parse state.toon. Returns null on any error. */
export function readExecutionState(planExecDir: string): ExecutionState | null {
  try {
    const statePath = path.join(planExecDir, "state.toon");
    const content = fs.readFileSync(statePath, "utf-8");
    const flat = parseToon(content);

    const status = String(flat["status"] ?? "unknown");
    const currentWave = Number(flat["currentWave"] ?? 0);

    const waves: Record<string, WaveState> = {};

    // Extract wave blocks from state.toon
    const waveBlocks = extractWaveBlocks(content);
    for (const [waveIdx, waveContent] of Object.entries(waveBlocks)) {
      // Parse the indented content by stripping leading whitespace
      const dedented = waveContent
        .split("\n")
        .map((l) => l.replace(/^  /, ""))
        .join("\n");
      const waveToon = parseToon(dedented);
      const tasks = parseToonArray(dedented, "tasks");
      const waveTasks: WaveTask[] = tasks.map((t) => ({
        taskId: String(t["taskId"] ?? ""),
        agent: String(t["agent"] ?? ""),
        status: String(t["status"] ?? "pending"),
        fileOwnership: parseToonSimpleArray(dedented, `tasks.${t["taskId"]}.fileOwnership`),
      }));

      waves[waveIdx] = {
        index: Number(waveIdx),
        status: String(waveToon["status"] ?? "pending"),
        tasks: waveTasks,
      };
    }

    return { status, currentWave, waves };
  } catch {
    return null;
  }
}

/** Read and parse pipeline-state.toon. Returns null on any error. */
export function readPipelineState(planExecDir: string): PipelineState | null {
  try {
    const statePath = path.join(planExecDir, "pipeline-state.toon");
    const content = fs.readFileSync(statePath, "utf-8");
    const flat = parseToon(content);

    return {
      currentStage: String(flat["currentStage"] ?? "unknown"),
      outerIteration: Number(flat["outerIteration"] ?? 1),
      agentsSpawned: Number(flat["agentsSpawned"] ?? 0),
      maxAgents: Number(flat["maxAgents"] ?? 50),
      fixCycleCount: Number(flat["fixCycleCount"] ?? 0),
    };
  } catch {
    return null;
  }
}

/** Get the current wave state. */
export function getCurrentWave(planExecDir: string): WaveState | null {
  const state = readExecutionState(planExecDir);
  if (!state) return null;
  return state.waves[String(state.currentWave)] ?? null;
}

/**
 * Collect all fileOwnership paths from in_progress tasks in the current wave.
 * Returns empty set if no active wave (allows all writes — orchestrator is running).
 */
export function getOwnedFiles(planExecDir: string): Set<string> | null {
  const wave = getCurrentWave(planExecDir);
  if (!wave) return null;

  // If no tasks are in_progress, return null (orchestrator is between waves)
  const activeTasks = wave.tasks.filter((t) => t.status === "in_progress");
  if (activeTasks.length === 0) return null;

  const owned = new Set<string>();
  for (const task of activeTasks) {
    for (const fp of task.fileOwnership) {
      owned.add(path.resolve(fp));
    }
  }
  return owned;
}

/** Check if Wave 0 (contracts phase) is complete. */
export function isContractPhaseComplete(planExecDir: string): boolean {
  const state = readExecutionState(planExecDir);
  if (!state) return false;
  const wave0 = state.waves["0"];
  if (!wave0) return false;
  return wave0.status === "succeeded" || wave0.status === "failed";
}

/** Get agent budget info from pipeline-state.toon. */
export function getAgentBudget(planExecDir: string): { spawned: number; max: number } | null {
  const pipeline = readPipelineState(planExecDir);
  if (!pipeline) return null;
  return { spawned: pipeline.agentsSpawned, max: pipeline.maxAgents };
}

/**
 * Extract wave blocks from state.toon content.
 * Looks for wave-N sections delimited by wave headers.
 * This is a simplified parser — real state.toon uses nested TOON objects.
 */
function extractWaveBlocks(content: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const lines = content.split("\n");
  let currentWaveIdx: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    // Match wave header like "wave.0:" or "waves.0:" or "0:" at proper indent
    const waveMatch = line.match(/^(?:waves?\.)?(\d+):$/);
    if (waveMatch) {
      if (currentWaveIdx !== null) {
        blocks[currentWaveIdx] = currentLines.join("\n");
      }
      currentWaveIdx = waveMatch[1];
      currentLines = [];
      continue;
    }

    if (currentWaveIdx !== null) {
      // If we hit a non-indented non-empty line, end the current wave block
      if (line.trim() && !line.startsWith("  ") && !line.startsWith("\t")) {
        blocks[currentWaveIdx] = currentLines.join("\n");
        currentWaveIdx = null;
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }
  }

  if (currentWaveIdx !== null) {
    blocks[currentWaveIdx] = currentLines.join("\n");
  }

  return blocks;
}

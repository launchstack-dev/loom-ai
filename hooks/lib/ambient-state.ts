/**
 * Ambient/idle state gatherer for the Claude Code status line.
 * Reads plan metadata, notes, last command status, and git branch.
 * Every field read is wrapped in try/catch — returns null on any error (fail open).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parseToon } from "./toon-reader.js";
import type { AmbientState } from "./statusline-types.js";

/**
 * Gather ambient/idle state indicators for the status line.
 * Returns an AmbientState with null for any field that cannot be determined.
 */
export function gatherAmbientState(projectDir: string): AmbientState {
  return {
    planStatus: readPlanField(projectDir, "status"),
    planName: readPlanField(projectDir, "name"),
    pendingNotes: countNotes(projectDir),
    lastCommand: readLastCommand(projectDir),
    lastResult: readLastResult(projectDir),
    gitBranch: readGitBranch(projectDir),
  };
}

/**
 * Read a field from PLAN.md YAML-ish frontmatter via regex.
 * Frontmatter is delimited by leading `---` lines.
 */
function readPlanField(projectDir: string, field: string): string | null {
  try {
    const planPath = path.join(projectDir, "PLAN.md");
    const content = fs.readFileSync(planPath, "utf-8");

    // Match frontmatter between --- delimiters
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;

    const frontmatter = fmMatch[1];
    const fieldRegex = new RegExp(`^${field}:\\s*(.+)$`, "m");
    const match = frontmatter.match(fieldRegex);
    if (!match) return null;

    // Strip surrounding quotes if present
    const raw = match[1].trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Count non-empty, non-comment top-level lines in .plan-execution/notes.toon.
 * These represent pending/unprocessed loom notes.
 */
function countNotes(projectDir: string): number {
  try {
    const notesPath = path.join(projectDir, ".plan-execution", "notes.toon");
    const content = fs.readFileSync(notesPath, "utf-8");
    const lines = content.split("\n");

    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, comments, and indented lines (array row data)
      if (!trimmed) continue;
      if (trimmed.startsWith("#")) continue;
      if (line.startsWith("  ")) continue;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Read the last orchestrator command from .plan-execution/status.toon.
 */
function readLastCommand(projectDir: string): string | null {
  try {
    const statusPath = path.join(projectDir, ".plan-execution", "status.toon");
    const content = fs.readFileSync(statusPath, "utf-8");
    const parsed = parseToon(content);
    const command = parsed["command"];
    return typeof command === "string" ? command : command != null ? String(command) : null;
  } catch {
    return null;
  }
}

/**
 * Derive last result from status.toon staleness and phase field.
 * If phase is "complete" → "ok"; if phase indicates failure → "failed"; otherwise null.
 */
function readLastResult(projectDir: string): "ok" | "failed" | null {
  try {
    const statusPath = path.join(projectDir, ".plan-execution", "status.toon");
    const content = fs.readFileSync(statusPath, "utf-8");
    const parsed = parseToon(content);

    const phase = parsed["phase"];
    if (typeof phase !== "string") return null;

    if (phase === "complete") return "ok";
    if (phase === "failed" || phase === "error") return "failed";

    // Check staleness — if updatedAt is present and beyond threshold, treat as stale (no result)
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current git branch name via child_process with a 100ms timeout.
 */
function readGitBranch(projectDir: string): string | null {
  try {
    const result = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectDir,
      timeout: 100,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const branch = result.trim();
    return branch || null;
  } catch {
    return null;
  }
}

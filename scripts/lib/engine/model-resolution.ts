/**
 * Mechanical model resolution for agent spawns (CLAUDE.md § Agent Conventions).
 * Priority: (1) orchestration.toml profile tier, (2) agent frontmatter
 * `model:`, (3) "inherit" (spawn without an override).
 *
 * Until now this rule lived as prose in CLAUDE.md and the markdown drivers;
 * the Workflow drivers need it as code so every spawn resolves identically.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ModelResolutionInput {
  /** Path to the agent .md file (absolute, or relative to cwd). */
  agentFile: string;
  /** Agent name as registered (used for orchestration.toml tier lookup). */
  agentName?: string;
  /** Project root for .claude/orchestration.toml (default: process.cwd()). */
  cwd?: string;
}

/** Read the `model:` value from an agent file's YAML frontmatter. */
export function readFrontmatterModel(agentFile: string): string | null {
  try {
    const content = fs.readFileSync(agentFile, "utf-8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return null;
    const modelMatch = fm[1].match(/^model:\s*["']?([\w.-]+)["']?\s*$/m);
    return modelMatch ? modelMatch[1] : null;
  } catch {
    return null;
  }
}

/**
 * Read a per-agent model override from orchestration.toml. Checks the
 * registration tables ([[planning.agents]] etc.) for `name = "<agent>"`
 * blocks carrying a `model =` key.
 */
export function readTomlModelOverride(agentName: string, cwd?: string): string | null {
  try {
    const tomlPath = path.resolve(cwd ?? process.cwd(), ".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return null;
    const content = fs.readFileSync(tomlPath, "utf-8");
    // Match any [[...agents]] block whose name equals agentName and grab its model.
    const blockRe = /\[\[[\w.]*agents\]\]([\s\S]*?)(?=\n\s*\[|\s*$)/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(content)) !== null) {
      const block = m[1];
      const nameMatch = block.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (!nameMatch || nameMatch[1] !== agentName) continue;
      const modelMatch = block.match(/^\s*model\s*=\s*"([^"]+)"/m);
      if (modelMatch) return modelMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the model for a spawn. Never throws; falls through the priority
 * chain and lands on "inherit" when nothing is declared.
 */
export function resolveAgentModel(input: ModelResolutionInput): string {
  if (input.agentName) {
    const override = readTomlModelOverride(input.agentName, input.cwd);
    if (override) return override;
  }
  const frontmatter = readFrontmatterModel(
    path.resolve(input.cwd ?? process.cwd(), input.agentFile)
  );
  if (frontmatter) return frontmatter;
  return "inherit";
}

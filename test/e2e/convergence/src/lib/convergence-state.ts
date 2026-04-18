import type { ConvergenceState, ConvergenceStatus, IterationRecord } from "../types.js";

// Minimal TOON parser inlined to avoid cross-project import issues.
// Mirrors parseToon from hooks/lib/toon-reader.ts
function parseToonFlat(content: string): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    // Skip array headers
    if (/^\w+\[\d+\]/.test(trimmed)) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();

    // Type inference
    if (raw === "true") result[key] = true;
    else if (raw === "false") result[key] = false;
    else if (raw === "null" || raw === "") result[key] = null;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) result[key] = parseFloat(raw);
    else if (raw.startsWith('"') && raw.endsWith('"')) result[key] = raw.slice(1, -1);
    else result[key] = raw;
  }
  return result;
}

function parseToonArray(content: string, arrayName: string): Record<string, string>[] {
  const headerPattern = new RegExp(`^${arrayName}\\[(\\d+)\\]\\{([^}]+)\\}:`);
  const lines = content.split("\n");
  let fields: string[] = [];
  let collecting = false;
  const rows: Record<string, string>[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(headerPattern);
    if (match) {
      fields = match[2].split(",").map((f) => f.trim());
      collecting = true;
      continue;
    }
    if (collecting) {
      if (!trimmed || (!trimmed.startsWith(" ") && !trimmed.includes(","))) {
        // Non-indented non-empty line = end of array
        if (trimmed && !trimmed.startsWith("#")) break;
        continue;
      }
      const values = trimmed.split(",").map((v) => v.trim());
      const row: Record<string, string> = {};
      for (let i = 0; i < fields.length && i < values.length; i++) {
        row[fields[i]] = values[i];
      }
      rows.push(row);
    }
  }
  return rows;
}

export function parseConvergenceState(content: string): ConvergenceState {
  const flat = parseToonFlat(content);
  const historyRows = parseToonArray(content, "history");

  const history: IterationRecord[] = historyRows.map((r) => ({
    iteration: parseInt(r.iteration, 10),
    passing: parseInt(r.passing, 10),
    failing: parseInt(r.failing, 10),
    rate: parseFloat(r.rate),
    agentsUsed: parseInt(r.agentsUsed, 10),
  }));

  return {
    iteration: (flat.iteration as number) ?? 0,
    maxIterations: (flat.maxIterations as number) ?? 10,
    status: (flat.status as ConvergenceStatus) ?? "iterating",
    totalTargets: (flat.totalTargets as number) ?? 0,
    passing: (flat.passing as number) ?? 0,
    failing: (flat.failing as number) ?? 0,
    convergenceRate: (flat.convergenceRate as number) ?? 0,
    totalAgentsSpawned: (flat.totalAgentsSpawned as number) ?? 0,
    agentBudget: (flat.agentBudget as number) ?? 30,
    consecutiveStalls: (flat.consecutiveStalls as number) ?? 0,
    history,
  };
}

export function serializeConvergenceState(state: ConvergenceState): string {
  const lines: string[] = [
    `iteration: ${state.iteration}`,
    `maxIterations: ${state.maxIterations}`,
    `status: ${state.status}`,
    `totalTargets: ${state.totalTargets}`,
    `passing: ${state.passing}`,
    `failing: ${state.failing}`,
    `convergenceRate: ${state.convergenceRate}`,
    `totalAgentsSpawned: ${state.totalAgentsSpawned}`,
    `agentBudget: ${state.agentBudget}`,
    `consecutiveStalls: ${state.consecutiveStalls}`,
    "",
    `history[${state.history.length}]{iteration,passing,failing,rate,agentsUsed}:`,
  ];

  for (const h of state.history) {
    lines.push(`  ${h.iteration},${h.passing},${h.failing},${h.rate},${h.agentsUsed}`);
  }

  return lines.join("\n") + "\n";
}

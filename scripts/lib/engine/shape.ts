/**
 * Decomposition-shape clamping (roadmap C-07: parameterized scaffolding, not
 * fixed shapes). The session model chooses shape — reviewer panel, fan-out
 * breadth, pass structure — and this module enforces only the CAPS. Engine
 * scripts must contain no fixed fan-out literals; defaults live in config
 * (converge.config, orchestration.toml, criteria-plan reviewers[]), and any
 * request exceeding a cap is clamped and reported, never silently obeyed and
 * never silently truncated.
 */

export interface ShapeCaps {
  /** Cumulative agent-spawn ceiling for the run (converge.config.agentBudget). */
  agentBudget: number;
  /** Iteration ceiling (converge.config.maxIterations, 1..10 per schema). */
  maxIterations: number;
  /** Ceiling on parallel reviewers per round (orchestration.toml maxParallelAgents). */
  maxParallelAgents: number;
  /** Findings kept per dimension per round (driver PER_DIMENSION_FINDING_CAP lineage). */
  perDimensionFindingCap: number;
}

export interface RequestedShape {
  /** Reviewer panel chosen by the model/config for this run. */
  reviewers: string[];
  maxIterations?: number;
}

export interface ClampedShape {
  reviewers: string[];
  maxIterations: number;
  /** Human-readable notes for every clamp applied — MUST be logged (no silent caps). */
  clamps: string[];
}

/** Clamp a requested shape to the caps. Pure; never throws. */
export function clampShape(requested: RequestedShape, caps: ShapeCaps): ClampedShape {
  const clamps: string[] = [];

  let reviewers = [...new Set(requested.reviewers)];
  if (reviewers.length !== requested.reviewers.length) {
    clamps.push(
      `deduplicated reviewer panel (${requested.reviewers.length} → ${reviewers.length})`
    );
  }
  if (reviewers.length > caps.maxParallelAgents) {
    clamps.push(
      `reviewer panel clamped ${reviewers.length} → ${caps.maxParallelAgents} (maxParallelAgents); dropped: ${reviewers
        .slice(caps.maxParallelAgents)
        .join(", ")}`
    );
    reviewers = reviewers.slice(0, caps.maxParallelAgents);
  }

  let maxIterations = requested.maxIterations ?? caps.maxIterations;
  if (maxIterations > caps.maxIterations) {
    clamps.push(`maxIterations clamped ${maxIterations} → ${caps.maxIterations}`);
    maxIterations = caps.maxIterations;
  }
  if (maxIterations < 1) {
    clamps.push(`maxIterations raised ${maxIterations} → 1 (floor)`);
    maxIterations = 1;
  }

  return { reviewers, maxIterations, clamps };
}

/**
 * Remaining agent budget for the next spawn round. The driver asks before
 * every fan-out; a round larger than the remainder is cut to fit (and the cut
 * reported), so BUDGET_EXHAUSTED fires at the breaker, not mid-round.
 */
export function fitRoundToBudget(
  roundSize: number,
  totalAgentsSpawned: number,
  agentBudget: number
): { size: number; note: string | null } {
  const remaining = Math.max(0, agentBudget - totalAgentsSpawned);
  if (roundSize <= remaining) return { size: roundSize, note: null };
  return {
    size: remaining,
    note: `spawn round cut ${roundSize} → ${remaining} (agentBudget ${agentBudget}, spawned ${totalAgentsSpawned})`,
  };
}

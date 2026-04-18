export interface CompareOptions {
  ignoreFields?: string[];
  numericTolerance?: number;
  ignoreWhitespace?: boolean;
  ignoreBlankLines?: boolean;
}

export interface CompareResult {
  score: number;
  details: string;
}

export type ComparisonMethod = "json-deep-equal" | "text-diff";

export interface Target {
  id: string;
  name: string;
  comparisonMethod: ComparisonMethod;
  tolerance: number;
  baselinePath: string;
  actualPath: string;
  options?: CompareOptions;
}

export interface ConvergeConfig {
  targets: Target[];
}

export interface TargetResult {
  id: string;
  name: string;
  score: number;
  threshold: number;
  passed: boolean;
  diff: { type: string; details: string };
}

export interface DeltaReport {
  timestamp: string;
  totalTargets: number;
  passing: number;
  failing: number;
  targets: TargetResult[];
}

export interface IterationRecord {
  iteration: number;
  passing: number;
  failing: number;
  rate: number;
  agentsUsed: number;
}

export type CircuitBreakReason =
  | "stall"
  | "regression"
  | "budget_exhausted"
  | "max_iterations";

export interface CircuitBreakResult {
  triggered: boolean;
  reason: CircuitBreakReason | null;
  details?: string;
}

export type ConvergenceStatus =
  | "iterating"
  | "converged"
  | "stalled"
  | "regression"
  | "budget_exhausted"
  | "max_iterations";

export interface ConvergenceState {
  iteration: number;
  maxIterations: number;
  status: ConvergenceStatus;
  totalTargets: number;
  passing: number;
  failing: number;
  convergenceRate: number;
  totalAgentsSpawned: number;
  agentBudget: number;
  consecutiveStalls: number;
  history: IterationRecord[];
}

import type {
  CircuitBreakResult,
  ConvergenceState,
  IterationRecord,
} from "../types.js";

const ok: CircuitBreakResult = { triggered: false, reason: null };

export function checkStall(
  history: IterationRecord[],
  threshold: number = 0.01
): CircuitBreakResult {
  if (history.length < 2) return ok;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  if (last.rate < threshold && prev.rate < threshold) {
    return {
      triggered: true,
      reason: "stall",
      details: `Convergence rate < ${threshold * 100}% for 2 consecutive iterations (${prev.rate}, ${last.rate})`,
    };
  }
  return ok;
}

export function checkRegression(
  priorFailing: number,
  currentFailing: number
): CircuitBreakResult {
  if (currentFailing > priorFailing) {
    return {
      triggered: true,
      reason: "regression",
      details: `Failing targets increased: ${priorFailing} → ${currentFailing}`,
    };
  }
  return ok;
}

export function checkBudget(
  totalSpawned: number,
  budget: number
): CircuitBreakResult {
  if (totalSpawned >= budget) {
    return {
      triggered: true,
      reason: "budget_exhausted",
      details: `Agent budget exhausted: ${totalSpawned}/${budget}`,
    };
  }
  return ok;
}

export function checkMaxIterations(
  current: number,
  max: number
): CircuitBreakResult {
  if (current >= max) {
    return {
      triggered: true,
      reason: "max_iterations",
      details: `Max iterations reached: ${current}/${max}`,
    };
  }
  return ok;
}

export function checkAll(state: ConvergenceState): CircuitBreakResult {
  // Priority: regression > stall > budget > max_iterations
  if (state.history.length >= 2) {
    const last = state.history[state.history.length - 1];
    const prev = state.history[state.history.length - 2];
    const regression = checkRegression(prev.failing, last.failing);
    if (regression.triggered) return regression;
  }

  const stall = checkStall(state.history);
  if (stall.triggered) return stall;

  const budget = checkBudget(state.totalAgentsSpawned, state.agentBudget);
  if (budget.triggered) return budget;

  const maxIter = checkMaxIterations(state.iteration, state.maxIterations);
  if (maxIter.triggered) return maxIter;

  return ok;
}

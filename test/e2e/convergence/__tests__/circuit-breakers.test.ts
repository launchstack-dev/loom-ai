import { describe, it, expect } from "vitest";
import {
  checkStall,
  checkRegression,
  checkBudget,
  checkMaxIterations,
  checkAll,
} from "../src/lib/circuit-breakers.js";
import type { ConvergenceState, IterationRecord } from "../src/types.js";

function makeHistory(...entries: Array<[number, number, number]>): IterationRecord[] {
  return entries.map(([passing, failing, rate], i) => ({
    iteration: i + 1,
    passing,
    failing,
    rate,
    agentsUsed: 1,
  }));
}

function makeState(overrides: Partial<ConvergenceState> = {}): ConvergenceState {
  return {
    iteration: 1,
    maxIterations: 10,
    status: "iterating",
    totalTargets: 10,
    passing: 5,
    failing: 5,
    convergenceRate: 0.5,
    totalAgentsSpawned: 5,
    agentBudget: 30,
    consecutiveStalls: 0,
    history: [],
    ...overrides,
  };
}

describe("checkStall", () => {
  it("does not trigger with empty history", () => {
    expect(checkStall([]).triggered).toBe(false);
  });

  it("does not trigger with only one low-rate iteration", () => {
    expect(checkStall(makeHistory([5, 5, 0.005])).triggered).toBe(false);
  });

  it("triggers when 2 consecutive iterations have rate < 1%", () => {
    const result = checkStall(makeHistory([5, 5, 0.005], [5, 5, 0.003]));
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("stall");
  });

  it("does not trigger when one of last two has rate >= 1%", () => {
    const result = checkStall(makeHistory([5, 5, 0.005], [6, 4, 0.02]));
    expect(result.triggered).toBe(false);
  });

  it("respects custom threshold", () => {
    const result = checkStall(makeHistory([5, 5, 0.04], [5, 5, 0.04]), 0.05);
    expect(result.triggered).toBe(true);
  });

  it("triggers with rate exactly 0.0 for 2 iterations", () => {
    const result = checkStall(makeHistory([5, 5, 0], [5, 5, 0]));
    expect(result.triggered).toBe(true);
  });
});

describe("checkRegression", () => {
  it("does not trigger when failing count decreased", () => {
    expect(checkRegression(5, 3).triggered).toBe(false);
  });

  it("does not trigger when failing count unchanged", () => {
    expect(checkRegression(5, 5).triggered).toBe(false);
  });

  it("triggers when failing count increased", () => {
    const result = checkRegression(3, 5);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("regression");
    expect(result.details).toContain("3");
    expect(result.details).toContain("5");
  });
});

describe("checkBudget", () => {
  it("does not trigger when under budget", () => {
    expect(checkBudget(10, 30).triggered).toBe(false);
  });

  it("triggers when at budget", () => {
    const result = checkBudget(30, 30);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("budget_exhausted");
  });

  it("triggers when over budget", () => {
    expect(checkBudget(31, 30).triggered).toBe(true);
  });

  it("does not trigger at budget minus 1", () => {
    expect(checkBudget(29, 30).triggered).toBe(false);
  });
});

describe("checkMaxIterations", () => {
  it("does not trigger before max", () => {
    expect(checkMaxIterations(5, 10).triggered).toBe(false);
  });

  it("triggers at max", () => {
    const result = checkMaxIterations(10, 10);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("max_iterations");
  });

  it("triggers over max", () => {
    expect(checkMaxIterations(11, 10).triggered).toBe(true);
  });
});

describe("checkAll", () => {
  it("returns null reason when nothing triggers", () => {
    const state = makeState({ history: makeHistory([3, 7, 0.3], [5, 5, 0.29]) });
    expect(checkAll(state).triggered).toBe(false);
    expect(checkAll(state).reason).toBe(null);
  });

  it("returns regression first when multiple breakers fire", () => {
    const state = makeState({
      totalAgentsSpawned: 30,
      agentBudget: 30,
      history: makeHistory([5, 5, 0.1], [3, 7, -0.4]),
    });
    const result = checkAll(state);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("regression");
  });

  it("returns stall over budget when both fire", () => {
    const state = makeState({
      totalAgentsSpawned: 30,
      agentBudget: 30,
      history: makeHistory([5, 5, 0.005], [5, 5, 0.003]),
    });
    const result = checkAll(state);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("stall");
  });

  it("returns budget when only budget fires", () => {
    const state = makeState({
      totalAgentsSpawned: 30,
      agentBudget: 30,
      iteration: 3,
      maxIterations: 10,
      history: makeHistory([3, 7, 0.3], [5, 5, 0.29]),
    });
    const result = checkAll(state);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("budget_exhausted");
  });

  it("returns max_iterations when only that fires", () => {
    const state = makeState({
      iteration: 10,
      maxIterations: 10,
      history: makeHistory([5, 5, 0.3], [7, 3, 0.4]),
    });
    const result = checkAll(state);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("max_iterations");
  });
});

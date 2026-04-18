import { describe, it, expect } from "vitest";
import {
  parseConvergenceState,
  serializeConvergenceState,
} from "../src/lib/convergence-state.js";
import type { ConvergenceState } from "../src/types.js";

const SAMPLE_TOON = `iteration: 3
maxIterations: 10
status: iterating
totalTargets: 12
passing: 8
failing: 4
convergenceRate: 0.33
totalAgentsSpawned: 7
agentBudget: 30
consecutiveStalls: 0

history[3]{iteration,passing,failing,rate,agentsUsed}:
  1,3,9,0.00,3
  2,6,6,0.33,2
  3,8,4,0.33,2
`;

describe("parseConvergenceState", () => {
  it("parses flat fields from convergence-state.toon", () => {
    const state = parseConvergenceState(SAMPLE_TOON);
    expect(state.iteration).toBe(3);
    expect(state.maxIterations).toBe(10);
    expect(state.status).toBe("iterating");
    expect(state.totalTargets).toBe(12);
    expect(state.passing).toBe(8);
    expect(state.failing).toBe(4);
    expect(state.convergenceRate).toBe(0.33);
    expect(state.totalAgentsSpawned).toBe(7);
    expect(state.agentBudget).toBe(30);
    expect(state.consecutiveStalls).toBe(0);
  });

  it("parses iteration history array", () => {
    const state = parseConvergenceState(SAMPLE_TOON);
    expect(state.history).toHaveLength(3);
    expect(state.history[0]).toEqual({ iteration: 1, passing: 3, failing: 9, rate: 0, agentsUsed: 3 });
    expect(state.history[1]).toEqual({ iteration: 2, passing: 6, failing: 6, rate: 0.33, agentsUsed: 2 });
    expect(state.history[2]).toEqual({ iteration: 3, passing: 8, failing: 4, rate: 0.33, agentsUsed: 2 });
  });

  it("handles empty history (iteration 0)", () => {
    const toon = `iteration: 0
maxIterations: 10
status: iterating
totalTargets: 5
passing: 0
failing: 5
convergenceRate: 0
totalAgentsSpawned: 0
agentBudget: 30
consecutiveStalls: 0

history[0]{iteration,passing,failing,rate,agentsUsed}:
`;
    const state = parseConvergenceState(toon);
    expect(state.history).toHaveLength(0);
    expect(state.iteration).toBe(0);
  });

  it("parses convergence rate as float", () => {
    const state = parseConvergenceState(SAMPLE_TOON);
    expect(typeof state.convergenceRate).toBe("number");
    expect(state.convergenceRate).toBe(0.33);
  });

  it("parses status field", () => {
    const convergedToon = SAMPLE_TOON.replace("status: iterating", "status: converged");
    expect(parseConvergenceState(convergedToon).status).toBe("converged");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = `iteration: 1
status: iterating
`;
    const state = parseConvergenceState(minimal);
    expect(state.iteration).toBe(1);
    expect(state.maxIterations).toBe(10);
    expect(state.agentBudget).toBe(30);
    expect(state.history).toHaveLength(0);
  });
});

describe("serializeConvergenceState", () => {
  it("produces valid TOON that round-trips through parseConvergenceState", () => {
    const original: ConvergenceState = {
      iteration: 3,
      maxIterations: 10,
      status: "iterating",
      totalTargets: 12,
      passing: 8,
      failing: 4,
      convergenceRate: 0.33,
      totalAgentsSpawned: 7,
      agentBudget: 30,
      consecutiveStalls: 0,
      history: [
        { iteration: 1, passing: 3, failing: 9, rate: 0, agentsUsed: 3 },
        { iteration: 2, passing: 6, failing: 6, rate: 0.33, agentsUsed: 2 },
        { iteration: 3, passing: 8, failing: 4, rate: 0.33, agentsUsed: 2 },
      ],
    };

    const serialized = serializeConvergenceState(original);
    const parsed = parseConvergenceState(serialized);

    expect(parsed.iteration).toBe(original.iteration);
    expect(parsed.maxIterations).toBe(original.maxIterations);
    expect(parsed.status).toBe(original.status);
    expect(parsed.totalTargets).toBe(original.totalTargets);
    expect(parsed.passing).toBe(original.passing);
    expect(parsed.failing).toBe(original.failing);
    expect(parsed.convergenceRate).toBe(original.convergenceRate);
    expect(parsed.totalAgentsSpawned).toBe(original.totalAgentsSpawned);
    expect(parsed.agentBudget).toBe(original.agentBudget);
    expect(parsed.history).toHaveLength(3);
    expect(parsed.history[0]).toEqual(original.history[0]);
  });

  it("writes history array in correct format", () => {
    const state: ConvergenceState = {
      iteration: 1,
      maxIterations: 5,
      status: "iterating",
      totalTargets: 3,
      passing: 1,
      failing: 2,
      convergenceRate: 0,
      totalAgentsSpawned: 1,
      agentBudget: 10,
      consecutiveStalls: 0,
      history: [{ iteration: 1, passing: 1, failing: 2, rate: 0, agentsUsed: 1 }],
    };
    const toon = serializeConvergenceState(state);
    expect(toon).toContain("history[1]{iteration,passing,failing,rate,agentsUsed}:");
    expect(toon).toContain("1,1,2,0,1");
  });
});
